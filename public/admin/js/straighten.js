/**
 * «Raddrizza»: the geometry that turns a photo of a canvas taken a little from the side into a flat,
 * front-facing picture. Only her own pixels are moved (a perspective warp): nothing is drawn or
 * invented. No DOM in this module, so it is unit-tested in Node (scripts/test/admin-straighten.test.mjs).
 *
 * Conventions: a point is [x, y] in pixels of the photo, x to the right, y down, (0, 0) = the outer
 * corner of the top-left pixel (so the centre of pixel i is i + 0.5). A quad is the four corners of
 * the canvas in the order top-left, top-right, bottom-right, bottom-left.
 */

/** Longest side of a straightened picture is never below this (a quad smaller than that is a slip of the finger). */
export const MIN_OUTPUT_SIDE = 200;
/**
 * Assumed when the photo does not say its focal length (a photo taken with «Scatta foto» never does):
 * the widest main camera of a current phone. Guessing too short costs little, too long a lot.
 */
export const DEFAULT_FOCAL_35 = 24;
/** Without the photo's own focal length the lens may have been any of these (wide to 2.5× tele). */
const FOCALS_UNKNOWN = [18, 21, 24, 28, 35, 45, 60];
/** Her measurements decide the shape when they are within this of what the photo allows… */
const MEASURES_SLACK = 0.02;
/** …and never further than this from the photo's own best estimate (so a slip of the keyboard cannot bend the picture). */
const MEASURES_LIMIT = 0.12;
/** Diagonal of the 35 mm film frame (36 × 24 mm), which «35 mm equivalent» focal lengths refer to. */
const FILM_DIAGONAL = Math.hypot(36, 24);

const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

/* ---------- small linear algebra ---------- */

/** Solves A·x = b (Gaussian elimination, partial pivoting). Returns null when A is singular. */
function solve(A, b) {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(M[r][col]) > Math.abs(M[pivot][col])) pivot = r;
    if (Math.abs(M[pivot][col]) < 1e-12) return null;
    [M[col], M[pivot]] = [M[pivot], M[col]];
    for (let r = col + 1; r < n; r++) {
      const f = M[r][col] / M[col][col];
      if (f === 0) continue;
      for (let c = col; c <= n; c++) M[r][c] -= f * M[col][c];
    }
  }
  const x = new Array(n);
  for (let r = n - 1; r >= 0; r--) {
    let sum = M[r][n];
    for (let c = r + 1; c < n; c++) sum -= M[r][c] * x[c];
    x[r] = sum / M[r][r];
  }
  return x;
}

/** 3×3 matrices as arrays of 9 numbers, row by row. */
function mul3(a, b) {
  const out = new Array(9);
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) out[r * 3 + c] = a[r * 3] * b[c] + a[r * 3 + 1] * b[3 + c] + a[r * 3 + 2] * b[6 + c];
  }
  return out;
}

/** Shift + scale that centres four points on 0 with a mean distance of √2 (keeps the solve well conditioned). */
function normaliser(points) {
  const cx = (points[0][0] + points[1][0] + points[2][0] + points[3][0]) / 4;
  const cy = (points[0][1] + points[1][1] + points[2][1] + points[3][1]) / 4;
  const mean = points.reduce((sum, p) => sum + Math.hypot(p[0] - cx, p[1] - cy), 0) / 4;
  const s = mean > 0 ? Math.SQRT2 / mean : 1;
  return { forward: [s, 0, -s * cx, 0, s, -s * cy, 0, 0, 1], inverse: [1 / s, 0, cx, 0, 1 / s, cy, 0, 0, 1] };
}

/**
 * The perspective map that sends the four points `from` to the four points `to`
 * (3×3 matrix as 9 numbers, row by row), or null when the points do not define one.
 */
export function homography(from, to) {
  const nf = normaliser(from);
  const nt = normaliser(to);
  const A = [];
  const b = [];
  for (let i = 0; i < 4; i++) {
    const [x, y] = apply(nf.forward, from[i][0], from[i][1]);
    const [u, v] = apply(nt.forward, to[i][0], to[i][1]);
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]);
    b.push(u);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y]);
    b.push(v);
  }
  const hn = solve(A, b);
  if (!hn) return null;
  hn.push(1);
  // a map that squashes the plane onto a line (three of the points in a row) is no use
  const det =
    hn[0] * (hn[4] * hn[8] - hn[5] * hn[7]) - hn[1] * (hn[3] * hn[8] - hn[5] * hn[6]) + hn[2] * (hn[3] * hn[7] - hn[4] * hn[6]);
  if (!(Math.abs(det) > 1e-9)) return null;
  const H = mul3(nt.inverse, mul3(hn, nf.forward));
  return H.every(Number.isFinite) ? H : null;
}

/** Where the map H sends the point (x, y). */
export function apply(H, x, y) {
  const w = H[6] * x + H[7] * y + H[8];
  return [(H[0] * x + H[1] * y + H[2]) / w, (H[3] * x + H[4] * y + H[5]) / w];
}

/* ---------- the quad ---------- */

/**
 * Puts four points in the order top-left, top-right, bottom-right, bottom-left as she sees them in
 * the photo, whatever handle ended up where (she may drag one past another): clockwise around their
 * centre, starting so that each lies nearest to «its» corner of the box around them. The picture can
 * then never come out mirrored or turned.
 */
export function orderCorners(points) {
  const cx = points.reduce((s, p) => s + p[0], 0) / 4;
  const cy = points.reduce((s, p) => s + p[1], 0) / 4;
  // clockwise on the screen (y points down)
  const sorted = [...points].sort((a, b) => Math.atan2(a[1] - cy, a[0] - cx) - Math.atan2(b[1] - cy, b[0] - cx));
  const xs = points.map((p) => p[0]);
  const ys = points.map((p) => p[1]);
  const box = [
    [Math.min(...xs), Math.min(...ys)],
    [Math.max(...xs), Math.min(...ys)],
    [Math.max(...xs), Math.max(...ys)],
    [Math.min(...xs), Math.max(...ys)],
  ];
  let best = 0;
  let bestCost = Infinity;
  for (let start = 0; start < 4; start++) {
    let cost = 0;
    for (let i = 0; i < 4; i++) cost += (sorted[(start + i) % 4][0] - box[i][0]) ** 2 + (sorted[(start + i) % 4][1] - box[i][1]) ** 2;
    if (cost < bestCost - 1e-9) {
      bestCost = cost;
      best = start;
    }
  }
  return [0, 1, 2, 3].map((i) => sorted[(best + i) % 4]);
}

/** Twice the signed area of the quad (positive when the corners run clockwise on the screen). */
function area2(q) {
  let sum = 0;
  for (let i = 0; i < 4; i++) {
    const a = q[i];
    const b = q[(i + 1) % 4];
    sum += a[0] * b[1] - b[0] * a[1];
  }
  return sum;
}

/**
 * Can this quad be straightened? It must be convex and in the right order (else the picture would
 * come out folded or mirrored), not tiny, not a sliver, and not seen so much from the side that one
 * edge is less than 40 % of the opposite one (such a photo has too little of the far side to show).
 * @param {number[][]} quad  corners in photo pixels, already ordered
 * @param {number} width     of the photo
 * @param {number} height    of the photo
 */
export function quadIsUsable(quad, width, height) {
  if (!Array.isArray(quad) || quad.length !== 4 || !quad.every((p) => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1]))) return false;
  const area = area2(quad);
  if (!(area / 2 >= 0.02 * width * height)) return false;
  for (let i = 0; i < 4; i++) {
    const a = quad[i];
    const b = quad[(i + 1) % 4];
    const c = quad[(i + 2) % 4];
    const cross = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
    if (!(cross > 0.02 * area)) return false; // a corner folded inwards or nearly flat, or the wrong order
  }
  const sides = [dist(quad[0], quad[1]), dist(quad[1], quad[2]), dist(quad[2], quad[3]), dist(quad[3], quad[0])];
  if (Math.min(...sides) < 0.05 * Math.min(width, height)) return false;
  const lopsided = (a, b) => Math.min(a, b) / Math.max(a, b) < 0.4;
  return !lopsided(sides[0], sides[2]) && !lopsided(sides[1], sides[3]);
}

/* ---------- the true shape of the canvas ---------- */

/** Focal length in pixels of a photo `width` × `height` whose 35 mm equivalent focal length is `focal35`. */
export function focalPixels(focal35, width, height) {
  const f35 = Number.isFinite(focal35) && focal35 >= 10 && focal35 <= 300 ? focal35 : DEFAULT_FOCAL_35;
  return (f35 / FILM_DIAGONAL) * Math.hypot(width, height);
}

/** Zhang & He's formula as it is: NaN when the quad cannot be a rectangle seen with this focal length. */
function rectangleRatio(quad, width, height, focal) {
  const [tl, tr, br, bl] = quad;
  const m = (p) => [p[0] - width / 2, p[1] - height / 2, 1];
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const m1 = m(tl);
  const m2 = m(tr);
  const m3 = m(bl);
  const m4 = m(br);
  const k2 = dot(cross(m1, m4), m3) / dot(cross(m2, m4), m3);
  const k3 = dot(cross(m1, m4), m2) / dot(cross(m3, m4), m2);
  const n2 = [k2 * m2[0] - m1[0], k2 * m2[1] - m1[1], k2 - 1];
  const n3 = [k3 * m3[0] - m1[0], k3 * m3[1] - m1[1], k3 - 1];
  const f2 = focal * focal;
  return Math.sqrt(((n2[0] * n2[0] + n2[1] * n2[1]) / f2 + n2[2] * n2[2]) / ((n3[0] * n3[0] + n3[1] * n3[1]) / f2 + n3[2] * n3[2]));
}

/** The plain ratio of the quad's sides: right for a photo taken straight on, too «square» from the side. */
function sidesRatio(quad) {
  const [tl, tr, br, bl] = quad;
  return (dist(tl, tr) + dist(bl, br)) / (dist(tl, bl) + dist(tr, br));
}

/**
 * Width ÷ height of the real, rectangular canvas whose corners appear at `quad` in a photo
 * `width` × `height` taken with a focal length of `focal` pixels (Zhang & He, «Whiteboard scanning
 * and image enhancement», 2007; the lens looks at the centre of the photo).
 * A photo taken straight on gives the ratio of the sides; from the side, the far edge looks shorter
 * and this undoes it. The focal length is always given, never worked out from the quad itself (the
 * paper's formula for that blows up for a photo taken nearly straight on). Falls back to the plain
 * ratio of the sides if the numbers break down.
 */
export function aspectRatio(quad, width, height, focal) {
  const plain = sidesRatio(quad);
  const ratio = rectangleRatio(quad, width, height, focal);
  // The correction can only be moderate for a photo she would keep: anything wild is a numeric accident.
  return Number.isFinite(ratio) && ratio > 0 && ratio / plain > 0.6 && ratio / plain < 1 / 0.6 ? ratio : plain;
}

/**
 * The shape (width ÷ height) to give the straightened picture.
 *
 * The photo alone tells it only as well as the lens is known: exactly for a photo taken straight on,
 * within a few per cent from the side. So when she has written the canvas' measurements and the photo
 * does not contradict them (they lie within what the photo allows for any plausible lens, plus 2 %,
 * and at most 12 % from the photo's own estimate), her measurements decide; otherwise the photo does. Measurements that do not fit (a typing slip, or
 * the photo of a detail) are ignored.
 *
 * @param {number[][]} quad  corners in photo pixels, ordered
 * @param {number} width     of the photo
 * @param {number} height    of the photo
 * @param {{focal35?: number|null, measures?: {larghezza: number, altezza: number}|null}} [known]
 *   focal35: from the photo's Exif, trusted only for an uncropped 4:3 photo
 * @returns {{ratio: number, from: 'measures'|'photo'}}
 */
export function chooseRatio(quad, width, height, { focal35 = null, measures = null } = {}) {
  const uncropped = Math.abs(Math.max(width, height) / Math.min(width, height) - 4 / 3) < 0.02;
  const known = uncropped && Number.isFinite(focal35) && focal35 >= 10 && focal35 <= 300;
  const ratio = aspectRatio(quad, width, height, focalPixels(known ? focal35 : DEFAULT_FOCAL_35, width, height));
  const cm = measures && measures.larghezza > 0 && measures.altezza > 0 ? measures.larghezza / measures.altezza : null;
  if (cm) {
    // every shape the photo allows: with the lens it names (give or take a tenth), or with any plausible lens
    const lenses = known ? [focal35 * 0.9, focal35, focal35 * 1.1] : FOCALS_UNKNOWN;
    const allowed = [ratio, ...lenses.map((f35) => rectangleRatio(quad, width, height, focalPixels(f35, width, height))).filter((r) => Number.isFinite(r) && r > 0)];
    const low = Math.max(Math.min(...allowed) * (1 - MEASURES_SLACK), ratio * (1 - MEASURES_LIMIT));
    const high = Math.min(Math.max(...allowed) * (1 + MEASURES_SLACK), ratio * (1 + MEASURES_LIMIT));
    if (cm >= low && cm <= high) return { ratio: cm, from: 'measures' };
  }
  return { ratio, from: 'photo' };
}

/**
 * Size in pixels of the straightened picture: the shape `ratio` (width ÷ height), never more pixels
 * than the photo had on the canvas (no enlargement), at most `maxSide` on the longest side.
 */
export function outputSize(quad, ratio, maxSide) {
  const [tl, tr, br, bl] = quad;
  const naturalW = Math.max(dist(tl, tr), dist(bl, br));
  const naturalH = Math.max(dist(tl, bl), dist(tr, br));
  let w;
  let h;
  if (naturalW / ratio >= naturalH) {
    h = naturalH;
    w = naturalH * ratio;
  } else {
    w = naturalW;
    h = naturalW / ratio;
  }
  const k = Math.min(1, maxSide / Math.max(w, h));
  return { width: Math.max(1, Math.round(w * k)), height: Math.max(1, Math.round(h * k)) };
}

/* ---------- moving the pixels ---------- */

/**
 * How much is cut inside the marked corners, in pixels of the straightened picture (the same on all
 * four sides): corners placed by finger are a few pixels off and a stretcher bar bows, so without it
 * a sliver of wall would show along an edge. About 4 mm per metre of canvas.
 */
export function edgeMargin(width, height) {
  return Math.max(3, Math.round(0.004 * Math.min(width, height)));
}

/**
 * The map from a pixel position of the straightened picture to the photo. `width` × `height` is the
 * size the whole marked canvas would have (outputSize); the picture itself is that minus `margin`
 * pixels on every side, so it measures (width − 2·margin) × (height − 2·margin).
 */
export function outputToPhoto(quad, width, height, margin = 0) {
  const whole = homography(
    [
      [0, 0],
      [width, 0],
      [width, height],
      [0, height],
    ],
    quad,
  );
  return whole && mul3(whole, [1, 0, margin, 0, 1, margin, 0, 0, 1]);
}

/**
 * The largest number of photo pixels that one pixel of a `width` × `height` picture covers under
 * `map`, in any direction. It is not the same everywhere: the side of the canvas that was nearer to
 * the camera is denser in the photo. Above about 1.6 a picture read pixel by pixel starts to shimmer.
 */
export function maxDensity(map, width, height) {
  const [a, b, c, d, e, f, g, h, i] = map;
  let worst = 0;
  for (const [x, y] of [[0, 0], [width, 0], [width, height], [0, height]]) {
    const w = g * x + h * y + i;
    const px = (a * x + b * y + c) / w;
    const py = (d * x + e * y + f) / w;
    // how the photo position moves per pixel of the picture, to the right (j11, j21) and down (j12, j22)
    const j11 = (a - g * px) / w;
    const j12 = (b - h * px) / w;
    const j21 = (d - g * py) / w;
    const j22 = (e - h * py) / w;
    const sum = j11 * j11 + j12 * j12 + j21 * j21 + j22 * j22;
    const det = j11 * j22 - j12 * j21;
    worst = Math.max(worst, Math.sqrt((sum + Math.sqrt(Math.max(0, sum * sum - 4 * det * det))) / 2));
  }
  return worst;
}

/**
 * Which part of the photo to work on, and how much to reduce it: the box around the quad (2 pixels
 * more on each side), scaled by about `scale` and never above `maxSide` pixels or `maxArea` pixels
 * in all (the limits of a canvas on an iPhone). `quad` comes back in pixels of that working copy.
 * @returns {{sx: number, sy: number, sw: number, sh: number, dw: number, dh: number, quad: number[][]}}
 *   drawImage(photo, sx, sy, sw, sh, 0, 0, dw, dh)
 */
export function sourcePlan(quad, width, height, scale = 1, { maxSide = 4096, maxArea = 4096 * 4096 } = {}) {
  const xs = quad.map((p) => p[0]);
  const ys = quad.map((p) => p[1]);
  const sx = Math.max(0, Math.floor(Math.min(...xs)) - 2);
  const sy = Math.max(0, Math.floor(Math.min(...ys)) - 2);
  const sw = Math.max(1, Math.min(width, Math.ceil(Math.max(...xs)) + 2) - sx);
  const sh = Math.max(1, Math.min(height, Math.ceil(Math.max(...ys)) + 2) - sy);
  const k = Math.min(1, scale, maxSide / Math.max(sw, sh), Math.sqrt(maxArea / (sw * sh)));
  const dw = Math.max(1, Math.round(sw * k));
  const dh = Math.max(1, Math.round(sh * k));
  return { sx, sy, sw, sh, dw, dh, quad: quad.map(([x, y]) => [((x - sx) * dw) / sw, ((y - sy) * dh) / sh]) };
}

/**
 * Fills the rows y0 ≤ y < y1 of `target` with the photo seen through `map` (see outputToPhoto).
 * Each pixel is weighed from the 4 × 4 photo pixels around its position (bicubic, Catmull-Rom):
 * sharper than a plain mean of four and exact wherever the photo is flat or a smooth ramp. Positions
 * outside the photo take the nearest pixel on its edge. Works on RGBA bytes ({ data, width, height },
 * like ImageData, whose Uint8ClampedArray rounds and clamps what is stored); the result is opaque.
 * Called in slices of rows so the page can keep breathing.
 */
export function warpRows(target, source, map, y0 = 0, y1 = target.height) {
  const { data: out, width: ow } = target;
  const { data: src, width: sw, height: sh } = source;
  const [a, b, c, d, e, f, g, h, i] = map;
  const maxX = sw - 1;
  const maxY = sh - 1;
  const stride = sw * 4;
  for (let y = y0; y < y1; y++) {
    const yc = y + 0.5;
    let nx = a * 0.5 + b * yc + c;
    let ny = d * 0.5 + e * yc + f;
    let nw = g * 0.5 + h * yc + i;
    let o = y * ow * 4;
    for (let x = 0; x < ow; x++) {
      let sx = nx / nw - 0.5;
      let sy = ny / nw - 0.5;
      nx += a;
      ny += d;
      nw += g;
      if (!(sx > 0)) sx = 0; // also catches NaN
      else if (sx > maxX) sx = maxX;
      if (!(sy > 0)) sy = 0;
      else if (sy > maxY) sy = maxY;
      const xi = sx | 0;
      const yi = sy | 0;
      const tx = sx - xi;
      const ty = sy - yi;
      // the four columns and rows around the position (repeating the edge) and their weights
      const c0 = (xi > 0 ? xi - 1 : 0) * 4;
      const c1 = xi * 4;
      const c2 = (xi < maxX ? xi + 1 : maxX) * 4;
      const c3 = (xi + 2 < maxX ? xi + 2 : maxX) * 4;
      const wx0 = ((-0.5 * tx + 1) * tx - 0.5) * tx;
      const wx1 = (1.5 * tx - 2.5) * tx * tx + 1;
      const wx2 = ((-1.5 * tx + 2) * tx + 0.5) * tx;
      const wx3 = (0.5 * tx - 0.5) * tx * tx;
      const r0 = (yi > 0 ? yi - 1 : 0) * stride;
      const r1 = yi * stride;
      const r2 = (yi < maxY ? yi + 1 : maxY) * stride;
      const r3 = (yi + 2 < maxY ? yi + 2 : maxY) * stride;
      const wy0 = ((-0.5 * ty + 1) * ty - 0.5) * ty;
      const wy1 = (1.5 * ty - 2.5) * ty * ty + 1;
      const wy2 = ((-1.5 * ty + 2) * ty + 0.5) * ty;
      const wy3 = (0.5 * ty - 0.5) * ty * ty;
      for (let k = 0; k < 3; k++) {
        out[o + k] =
          (src[r0 + c0 + k] * wx0 + src[r0 + c1 + k] * wx1 + src[r0 + c2 + k] * wx2 + src[r0 + c3 + k] * wx3) * wy0 +
          (src[r1 + c0 + k] * wx0 + src[r1 + c1 + k] * wx1 + src[r1 + c2 + k] * wx2 + src[r1 + c3 + k] * wx3) * wy1 +
          (src[r2 + c0 + k] * wx0 + src[r2 + c1 + k] * wx1 + src[r2 + c2 + k] * wx2 + src[r2 + c3 + k] * wx3) * wy2 +
          (src[r3 + c0 + k] * wx0 + src[r3 + c1 + k] * wx1 + src[r3 + c2 + k] * wx2 + src[r3 + c3 + k] * wx3) * wy3;
      }
      out[o + 3] = 255;
      o += 4;
    }
  }
}

/* ---------- a first guess of the corners ---------- */

/** Median of a list of bytes (0–255) given as a histogram-friendly array. */
function median(values) {
  const sorted = Uint8Array.from(values).sort();
  return sorted[sorted.length >> 1];
}

/**
 * First guess of the canvas' corners in a small copy of the photo (RGBA bytes, a few hundred pixels
 * wide): a painting on a plain wall. The wall's colour is read along the border of the photo; a soft
 * shadow (the wall's own colour, only darker) still counts as wall. The largest patch that differs
 * is taken as the canvas and its four extreme points as the corners.
 *
 * Returns the quad in pixels of the small copy, or null when it is not clearly a canvas with wall
 * all around: the patch must be a filled four-sided shape with roughly square corners whose edges
 * really separate paint from wall. It is only a starting point: she checks and moves the corners.
 */
export function detectCorners(image, { threshold = 40 } = {}) {
  const { data, width: w, height: h } = image;
  if (w < 16 || h < 16) return null;

  // the wall: median colour of a frame 4 % thick along the border
  const band = Math.max(2, Math.round(Math.min(w, h) * 0.04));
  const ring = [[], [], []];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (x >= band && x < w - band && y >= band && y < h - band) {
        x = w - band - 1; // jump over the inside of the photo
        continue;
      }
      const p = (y * w + x) * 4;
      ring[0].push(data[p]);
      ring[1].push(data[p + 1]);
      ring[2].push(data[p + 2]);
    }
  }
  const wall = ring.map(median);
  const wallSum = wall[0] + wall[1] + wall[2];

  // pixels that are not wall
  const mask = new Uint8Array(w * h);
  let borderHits = 0;
  for (let y = 0, p = 0, i = 0; y < h; y++) {
    for (let x = 0; x < w; x++, p += 4, i++) {
      const r = data[p];
      const g = data[p + 1];
      const b = data[p + 2];
      if (Math.max(Math.abs(r - wall[0]), Math.abs(g - wall[1]), Math.abs(b - wall[2])) <= threshold) continue;
      // a shadow on the wall: the same colour, up to 40 % darker
      const k = wallSum ? (r + g + b) / wallSum : 0;
      if (k > 0.6 && k < 1 && Math.max(Math.abs(r - wall[0] * k), Math.abs(g - wall[1] * k), Math.abs(b - wall[2] * k)) <= 14) continue;
      mask[i] = 1;
      if (x < band || x >= w - band || y < band || y >= h - band) borderHits++;
    }
  }
  // the border is not one plain colour: the canvas fills the photo or the wall is busy
  if (borderHits > 0.25 * ring[0].length) return null;

  // largest connected patch (4 neighbours)
  const labels = new Int32Array(w * h);
  const stack = new Int32Array(w * h);
  let best = 0;
  let bestSize = 0;
  let label = 0;
  for (let start = 0; start < mask.length; start++) {
    if (!mask[start] || labels[start]) continue;
    label++;
    let size = 0;
    let top = 0;
    stack[top++] = start;
    labels[start] = label;
    while (top) {
      const i = stack[--top];
      size++;
      const x = i % w;
      if (x > 0 && mask[i - 1] && !labels[i - 1]) (labels[i - 1] = label), (stack[top++] = i - 1);
      if (x < w - 1 && mask[i + 1] && !labels[i + 1]) (labels[i + 1] = label), (stack[top++] = i + 1);
      if (i >= w && mask[i - w] && !labels[i - w]) (labels[i - w] = label), (stack[top++] = i - w);
      if (i < mask.length - w && mask[i + w] && !labels[i + w]) (labels[i + w] = label), (stack[top++] = i + w);
    }
    if (size > bestSize) {
      bestSize = size;
      best = label;
    }
  }
  if (!best) return null;

  // its extreme points along the two diagonals
  let tl = null;
  let tr = null;
  let br = null;
  let bl = null;
  for (let y = 0, i = 0; y < h; y++) {
    for (let x = 0; x < w; x++, i++) {
      if (labels[i] !== best) continue;
      if (!tl || x + y < tl[0] + tl[1]) tl = [x, y];
      if (!tr || x - y > tr[0] - tr[1]) tr = [x, y];
      if (!br || x + y > br[0] + br[1]) br = [x, y];
      if (!bl || x - y < bl[0] - bl[1]) bl = [x, y];
    }
  }
  // outer corners of those pixels
  const quad = [
    [tl[0], tl[1]],
    [tr[0] + 1, tr[1]],
    [br[0] + 1, br[1] + 1],
    [bl[0], bl[1] + 1],
  ];
  if (!quadIsUsable(quad, w, h)) return null;
  const quadArea = area2(quad) / 2;
  // a canvas is a filled four-sided patch that takes a fair part of the photo
  if (quadArea < 0.08 * w * h || bestSize < 0.8 * quadArea || bestSize > 1.1 * quadArea) return null;

  // …with corners that are roughly square (a photo from the side bends them only so far)
  for (let i = 0; i < 4; i++) {
    const p = quad[i];
    const a = quad[(i + 3) % 4];
    const b = quad[(i + 1) % 4];
    const cos = ((a[0] - p[0]) * (b[0] - p[0]) + (a[1] - p[1]) * (b[1] - p[1])) / (dist(a, p) * dist(b, p));
    if (Math.abs(cos) > 0.57) return null; // outside 55°–125°
  }

  // …and edges that really run between paint (just inside) and wall (just outside)
  const cx = (quad[0][0] + quad[1][0] + quad[2][0] + quad[3][0]) / 4;
  const cy = (quad[0][1] + quad[1][1] + quad[2][1] + quad[3][1]) / 4;
  const isCanvas = (x, y) => x >= 0 && y >= 0 && x < w && y < h && labels[(y | 0) * w + (x | 0)] === best;
  const isWall = (x, y) => x >= 0 && y >= 0 && x < w && y < h && !mask[(y | 0) * w + (x | 0)];
  for (let i = 0; i < 4; i++) {
    const a = quad[i];
    const b = quad[(i + 1) % 4];
    // unit vector across the edge, pointing to the inside
    let nx = -(b[1] - a[1]);
    let ny = b[0] - a[0];
    const len = Math.hypot(nx, ny);
    nx /= len;
    ny /= len;
    if (nx * (cx - a[0]) + ny * (cy - a[1]) < 0) {
      nx = -nx;
      ny = -ny;
    }
    let inside = 0;
    let outside = 0;
    const steps = 24;
    for (let n = 0; n < steps; n++) {
      const t = 0.1 + (0.8 * n) / (steps - 1);
      const x = a[0] + (b[0] - a[0]) * t;
      const y = a[1] + (b[1] - a[1]) * t;
      if (isCanvas(x + nx * 3, y + ny * 3)) inside++;
      if (isWall(x - nx * 3, y - ny * 3)) outside++;
    }
    if (inside < 0.85 * steps || outside < 0.85 * steps) return null;
  }
  return quad;
}

/** A rectangle `margin` (a fraction of each side) inside the photo; with 0, the whole photo. */
export function defaultQuad(width, height, margin = 0) {
  const mx = width * margin;
  const my = height * margin;
  return [
    [mx, my],
    [width - mx, my],
    [width - mx, height - my],
    [mx, height - my],
  ];
}

/* ---------- the focal length written in the photo ---------- */

/**
 * «Focal length in 35 mm film» (Exif tag A405) from the first bytes of a JPEG file, or null.
 * Phones write it; it tells how wide the lens saw, which the true shape of the canvas depends on.
 * Only read here: the published photo is re-encoded without any Exif data.
 * @param {Uint8Array} bytes  the start of the file (the Exif block sits in its first 64 KB)
 */
export function readFocal35(bytes) {
  try {
    if (!bytes || bytes.length < 12 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let pos = 2;
    while (pos + 4 <= view.byteLength) {
      if (view.getUint8(pos) !== 0xff) return null;
      const marker = view.getUint8(pos + 1);
      if (marker === 0xda || marker === 0xd9) return null; // image data: no Exif before it
      const length = view.getUint16(pos + 2);
      if (marker === 0xe1 && length >= 8 && view.getUint32(pos + 4) === 0x45786966 && view.getUint16(pos + 8) === 0) {
        return focalFromTiff(view, pos + 10, Math.min(view.byteLength, pos + 2 + length));
      }
      pos += 2 + length;
    }
  } catch {
    /* cut short or malformed: no focal length */
  }
  return null;
}

function focalFromTiff(view, tiff, end) {
  const order = view.getUint16(tiff);
  if (order !== 0x4949 && order !== 0x4d4d) return null;
  const little = order === 0x4949;
  const u16 = (at) => view.getUint16(at, little);
  const u32 = (at) => view.getUint32(at, little);
  /** Value of a SHORT or LONG tag of the directory at `ifd`, or null. */
  const tag = (ifd, wanted) => {
    if (ifd + 2 > end) return null;
    const count = u16(ifd);
    for (let n = 0; n < count; n++) {
      const entry = ifd + 2 + n * 12;
      if (entry + 12 > end) return null;
      if (u16(entry) !== wanted) continue;
      const type = u16(entry + 2);
      return type === 3 ? u16(entry + 8) : type === 4 ? u32(entry + 8) : null;
    }
    return null;
  };
  const exifOffset = tag(tiff + u32(tiff + 4), 0x8769);
  if (!exifOffset) return null;
  const focal = tag(tiff + exifOffset, 0xa405);
  return focal && focal >= 8 && focal <= 400 ? focal : null;
}
