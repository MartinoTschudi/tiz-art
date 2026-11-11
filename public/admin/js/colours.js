/**
 * «Colori più vivi»: a light, automatic correction that makes a phone photo of a painting look less
 * washed out. A close-up shot in bright light often comes out pale: its darkest paint is grey instead
 * of black, the middle tones are too light and the colours are weak. This undoes that, for the whole
 * picture at once and the same way for red, green and blue (so no colour cast is added):
 *
 *   1. levels    the darkest 1 % of the picture becomes black, the lightest highlights white
 *                (at most 45 levels of haze are taken away, highlights are lifted by at most 15)
 *   2. midtones  only a picture that is both light in the middle and grey in its blacks (the sign
 *                of a washed-out photo, not of a light painting) is darkened a little (a gamma
 *                between 1 and 1.35); a dark painting is never lightened
 *   3. contrast  a gentle S-curve, at full strength only on a washed-out photo
 *   Steps 2 and 3 act on each pixel's brightest channel and scale its three channels together: the
 *   hue stays, and a strong red or blue keeps its strength instead of turning muddy.
 *   4. colour    more saturation where colours are weak, little where they are already strong
 *                (vibrance); near-greys are left alone (no colour cast or noise is amplified) and
 *                no colour is pushed into pure white or out of what the screen can show
 *
 * Nothing is painted or moved: every pixel keeps its place and its hue. No DOM in this module, so it
 * is unit-tested in Node (scripts/test/admin-colours.test.mjs). Pixels are RGBA bytes
 * ({ data, width, height }, like ImageData).
 */

/** Share of the picture (darkest pixels) that may become pure black. */
const BLACK_SHARE = 0.01;
/** Share of the picture (lightest pixels) that may become pure white. */
const WHITE_SHARE = 0.003;
/** At most this many levels (of 255) of grey haze are taken away. */
export const MAX_BLACK = 45;
/** Highlights are lifted to white by at most this many levels. */
export const MAX_WHITE_LIFT = 15;
/**
 * The middle tone (median of the brightest channel, 0–1) a pale photo is moved towards, and how far
 * (0 = not at all, 1 = all the way). Her well-exposed photos lie between 0.36 and 0.6; the pale
 * close-ups between 0.6 and 0.75.
 */
const MID_TARGET = 0.6;
const MID_PULL = 0.6;
export const MAX_GAMMA = 1.35;
/** Strength of the S-curve (on a washed-out photo; 40 % of it on a well-exposed one) and of the extra colour. */
const CONTRAST = 0.1;
/** Below this saturation the extra colour fades out, so a grey with a slight cast stays grey. */
const NEUTRAL = 0.15;
/** Extra colour never pushes a channel above this (a light colour keeps its last highlight). */
const CEILING = 0.97;
const VIBRANCE = 0.6;

const LR = 0.2126;
const LG = 0.7152;
const LB = 0.0722;

/**
 * What to do to this picture, read from the middle 80 % of it (the edges of a photo that was not
 * straightened are often wall). Sampled on a grid, so it is quick also on 12 megapixels.
 * @returns {{black: number, white: number, gamma: number, contrast: number}}  black and white in levels 0–255
 */
export function gradeParams(image) {
  const { data, width: w, height: h } = image;
  if (!(w > 0 && h > 0) || data.length < w * h * 4) return { black: 0, white: 255, gamma: 1, contrast: CONTRAST * 0.4 };
  const x0 = Math.floor(w * 0.1);
  const x1 = Math.max(x0 + 1, Math.ceil(w * 0.9));
  const y0 = Math.floor(h * 0.1);
  const y1 = Math.max(y0 + 1, Math.ceil(h * 0.9));
  const step = Math.max(1, Math.floor(Math.sqrt(((x1 - x0) * (y1 - y0)) / 250000)));
  const hist = new Float64Array(256); // brightness (luma), for black and white
  const top = new Float64Array(256); // brightest channel, for the middle tone
  let n = 0;
  for (let y = y0; y < y1; y += step) {
    for (let x = x0, p = (y * w + x0) * 4; x < x1; x += step, p += 4 * step) {
      const r = data[p];
      const g = data[p + 1];
      const b = data[p + 2];
      hist[Math.round(LR * r + LG * g + LB * b)]++;
      top[r > g ? (r > b ? r : b) : g > b ? g : b]++;
      n++;
    }
  }
  const level = (counts, share) => {
    let sum = 0;
    for (let v = 0; v < 256; v++) {
      sum += counts[v];
      if (sum >= share * n) return v;
    }
    return 255;
  };
  const black = Math.min(Math.max(level(hist, BLACK_SHARE) - 2, 0), MAX_BLACK);
  const white = 255 - Math.min(Math.max(250 - level(hist, 1 - WHITE_SHARE), 0), MAX_WHITE_LIFT);
  // the middle tone after the levels (they are the same for every channel, so the median moves with them)
  const median = Math.min(1, Math.max(0, (level(top, 0.5) - black) / (white - black)));
  // how washed out the photo is: 0 = real blacks (a well-exposed photo), 1 = ten or more levels of haze
  const haze = Math.min(1, black / 10);
  let gamma = 1;
  if (median > MID_TARGET && median < 1) gamma = Math.min(MAX_GAMMA, Math.exp(MID_PULL * Math.log(Math.log(MID_TARGET) / Math.log(median))));
  gamma = 1 + (gamma - 1) * haze; // a light painting photographed well keeps its middle tones
  return { black, white, gamma, contrast: CONTRAST * (0.4 + 0.6 * haze) };
}

/** Brightest channel 0–1 → its new value, for the midtones and the S-curve (a table of 4096 steps). */
function toneTable(gamma, contrast) {
  const table = new Float32Array(4097);
  for (let i = 0; i <= 4096; i++) {
    const l = (i / 4096) ** gamma;
    table[i] = Math.min(1, Math.max(0, l + contrast * Math.sin(Math.PI * (l - 0.5)) * l * (1 - l) * 4));
  }
  return table;
}

/**
 * Applies the correction to the rows y0 ≤ y < y1 of `image`, in place (so it can be done in slices
 * while the page keeps breathing). Alpha is left as it is.
 */
export function gradeRows(image, params, y0 = 0, y1 = image.height) {
  const { data, width } = image;
  const { black, white, gamma, contrast = CONTRAST } = params;
  const table = toneTable(gamma, contrast);
  const scale = 1 / (white - black);
  const off = black;
  const end = y1 * width * 4;
  for (let p = y0 * width * 4; p < end; p += 4) {
    // 1. levels
    let r = (data[p] - off) * scale;
    let g = (data[p + 1] - off) * scale;
    let b = (data[p + 2] - off) * scale;
    r = r < 0 ? 0 : r > 1 ? 1 : r;
    g = g < 0 ? 0 : g > 1 ? 1 : g;
    b = b < 0 ? 0 : b > 1 ? 1 : b;
    // 2 + 3. midtones and contrast on the brightest channel, all three scaled alike so the hue stays
    const v = r > g ? (r > b ? r : b) : g > b ? g : b;
    if (v > 1e-4) {
      const k = table[Math.round(v * 4096)] / v;
      r *= k;
      g *= k;
      b *= k;
    }
    // 4. vibrance around the (new) brightness
    const max = r > g ? (r > b ? r : b) : g > b ? g : b;
    const min = r < g ? (r < b ? r : b) : g < b ? g : b;
    if (max > 0 && max > min) {
      const s = (max - min) / max;
      let gain = 1 + VIBRANCE * (1 - s) * Math.sqrt(1 - s) * Math.min(1, s / NEUTRAL);
      const y = LR * r + LG * g + LB * b;
      // keep every channel within range: less extra colour rather than a clipped one
      const cap = max > CEILING ? max : CEILING;
      const hiMax = y + (max - y) * gain;
      if (hiMax > cap && max > y) gain = Math.min(gain, Math.max(1, (cap - y) / (max - y)));
      const loMin = y + (min - y) * gain;
      if (loMin < 0 && min < y) gain = Math.min(gain, Math.max(1, y / (y - min)));
      r = y + (r - y) * gain;
      g = y + (g - y) * gain;
      b = y + (b - y) * gain;
    }
    data[p] = r * 255; // a Uint8ClampedArray (ImageData) rounds and clamps
    data[p + 1] = g * 255;
    data[p + 2] = b * 255;
  }
}
