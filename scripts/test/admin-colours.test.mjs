// «Colori più vivi»: the correction of public/admin/js/colours.js (no DOM).
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { gradeParams, gradeRows, MAX_BLACK, MAX_WHITE_LIFT, MAX_GAMMA } from '../../public/admin/js/colours.js';

/** RGBA picture from a function (x, y) → [r, g, b]. */
function picture(width, height, colour) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) data.set([...colour(x, y), 255], (y * width + x) * 4);
  return { data, width, height };
}
const luma = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
const saturation = (r, g, b) => (Math.max(r, g, b) ? (Math.max(r, g, b) - Math.min(r, g, b)) / Math.max(r, g, b) : 0);
function stats({ data }) {
  let l = 0;
  let s = 0;
  let n = 0;
  for (let p = 0; p < data.length; p += 4) {
    l += luma(data[p], data[p + 1], data[p + 2]);
    s += saturation(data[p], data[p + 1], data[p + 2]);
    n++;
  }
  return { luma: l / n, saturation: s / n };
}
let seed = 11;
const random = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);

/**
 * A «painting»: paint in several hues, from deep shadow to light, like her canvases (median of the
 * brightest channel about 0.55). `pale` turns it into a washed-out photo of it, as a close-up in
 * bright light comes out: weaker colours, lighter middle tones, grey instead of black.
 */
function painting(width = 160, height = 120, { pale = false } = {}) {
  const hues = [[0.9, 0.25, 0.2], [0.85, 0.75, 0.3], [0.35, 0.6, 0.25], [0.25, 0.35, 0.75], [0.8, 0.7, 0.6]];
  return picture(width, height, (x, y) => {
    // patches of every lightness spread over the whole canvas (the middle 80 % decides)
    const u = ((Math.floor(x / 6) * 37 + Math.floor(y / 6) * 91) % 64) / 63;
    const light = 0.03 + 0.95 * u ** 0.8 * (0.94 + 0.06 * random());
    let c = hues[(Math.floor(x / 6) + Math.floor(y / 6)) % hues.length].map((v) => (light * v) / 0.9);
    if (pale) {
      const grey = 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
      c = c.map((v) => grey + (v - grey) * 0.6).map((v) => 0.04 + 0.96 * Math.max(0, v) ** 0.45);
    }
    return c.map((v) => Math.min(255, 255 * v));
  });
}

describe('«Colori più vivi»', () => {
  test('a pale photo: the haze is taken away, the middle tones come down, the colours get stronger', () => {
    const pale = painting(160, 120, { pale: true });
    const before = stats(pale);
    const params = gradeParams(pale);
    assert.ok(params.black > 10 && params.black <= MAX_BLACK, JSON.stringify(params));
    assert.ok(params.gamma > 1.1 && params.gamma <= MAX_GAMMA, JSON.stringify(params));
    gradeRows(pale, params);
    const after = stats(pale);
    assert.ok(after.luma < before.luma - 10, `${before.luma} → ${after.luma}`);
    assert.ok(after.saturation > before.saturation * 1.2, `${before.saturation} → ${after.saturation}`);
    // the darkest paint is black again
    let darkest = 255;
    for (let p = 0; p < pale.data.length; p += 4) darkest = Math.min(darkest, luma(pale.data[p], pale.data[p + 1], pale.data[p + 2]));
    assert.ok(darkest < 8, String(darkest));
  });

  test('a photo that is already good changes only a little', () => {
    const good = painting();
    const before = stats(good);
    const params = gradeParams(good);
    assert.ok(params.black <= 4, JSON.stringify(params));
    assert.equal(params.gamma, 1, 'a dark or balanced picture is never darkened or lightened in the middle');
    gradeRows(good, params);
    const after = stats(good);
    assert.ok(Math.abs(after.luma - before.luma) < 10, `${before.luma} → ${after.luma}`);
    assert.ok(after.saturation >= before.saturation && after.saturation < before.saturation * 1.35, `${before.saturation} → ${after.saturation}`);
  });

  test('never more than the set limits, whatever the photo', () => {
    const fog = picture(100, 100, () => [200, 200, 200]);
    const p1 = gradeParams(fog);
    assert.ok(p1.black <= MAX_BLACK && 255 - p1.white <= MAX_WHITE_LIFT && p1.gamma <= MAX_GAMMA, JSON.stringify(p1));
    const dark = picture(100, 100, (x) => [x / 3, x / 4, x / 5]);
    const p2 = gradeParams(dark);
    assert.ok(255 - p2.white <= MAX_WHITE_LIFT && p2.gamma === 1, JSON.stringify(p2));
    assert.deepEqual(gradeParams({ data: new Uint8ClampedArray(0), width: 0, height: 0 }), { black: 0, white: 255, gamma: 1 });
  });

  test('greys stay grey and every hue stays the same hue: no colour cast is added', () => {
    const image = picture(64, 1, (x) => (x < 32 ? [x * 8, x * 8, x * 8] : [180 - x, 90, 40 + x]));
    const before = Uint8ClampedArray.from(image.data);
    gradeRows(image, { black: 12, white: 240, gamma: 1.2 });
    for (let x = 0; x < 32; x++) {
      const [r, g, b] = image.data.subarray(x * 4, x * 4 + 3);
      assert.ok(Math.max(r, g, b) - Math.min(r, g, b) <= 1, `grey ${x}: ${r},${g},${b}`);
    }
    const hue = (r, g, b) => {
      const mx = Math.max(r, g, b);
      const mn = Math.min(r, g, b);
      if (mx === mn) return 0;
      const h = mx === r ? (g - b) / (mx - mn) : mx === g ? 2 + (b - r) / (mx - mn) : 4 + (r - g) / (mx - mn);
      return ((h * 60) + 360) % 360;
    };
    for (let x = 32; x < 64; x++) {
      const a = hue(...before.subarray(x * 4, x * 4 + 3));
      const b = hue(...image.data.subarray(x * 4, x * 4 + 3));
      assert.ok(Math.abs(a - b) < 4, `hue ${x}: ${a} → ${b}`);
    }
  });

  test('a strong colour is not pushed beyond what the screen shows; alpha is untouched', () => {
    const image = picture(4, 1, (x) => [[250, 10, 10], [10, 240, 10], [255, 255, 0], [0, 0, 0]][x]);
    image.data[3] = 128;
    gradeRows(image, { black: 0, white: 255, gamma: 1 });
    assert.equal(image.data[3], 128);
    for (const v of image.data) assert.ok(v >= 0 && v <= 255);
    // the red stays red and strong
    assert.ok(image.data[0] > 230 && image.data[1] < 20, [...image.data.subarray(0, 4)].join());
  });

  test('done in slices of rows it gives the same picture as in one go', () => {
    const a = painting(50, 41, { pale: true });
    const b = { ...a, data: Uint8ClampedArray.from(a.data) };
    const params = gradeParams(a);
    gradeRows(a, params);
    for (let y = 0; y < 41; y += 6) gradeRows(b, params, y, Math.min(41, y + 6));
    assert.deepEqual(b.data, a.data);
  });

  test('the edges of the photo (often wall) do not decide', () => {
    // the same painting with a white wall around it, 10 % on each side
    const inner = painting(128, 96, { pale: true });
    const framed = picture(160, 120, (x, y) => {
      if (x < 16 || x >= 144 || y < 12 || y >= 108) return [240, 238, 232];
      const p = ((y - 12) * 128 + (x - 16)) * 4;
      return [...inner.data.subarray(p, p + 3)];
    });
    const a = gradeParams(inner);
    const b = gradeParams(framed);
    assert.ok(Math.abs(a.black - b.black) <= 2 && Math.abs(a.gamma - b.gamma) < 0.05, `${JSON.stringify(a)} vs ${JSON.stringify(b)}`);
  });
});
