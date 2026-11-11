// «Raddrizza»: the geometry of public/admin/js/straighten.js (no DOM, no network).
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  MIN_OUTPUT_SIDE,
  DEFAULT_FOCAL_35,
  homography,
  apply,
  orderCorners,
  quadIsUsable,
  focalPixels,
  aspectRatio,
  chooseRatio,
  outputSize,
  edgeMargin,
  outputToPhoto,
  maxDensity,
  sourcePlan,
  warpRows,
  detectCorners,
  defaultQuad,
  readFocal35,
} from '../../public/admin/js/straighten.js';

const close = (actual, expected, tolerance, message) =>
  assert.ok(Math.abs(actual - expected) <= tolerance, `${message || 'value'}: ${actual} is not within ${tolerance} of ${expected}`);

/**
 * Corners in the photo of a real rectangle `W` × `H` (any unit) hanging `distance` away, seen by a
 * camera with a focal length of `f` pixels that is turned `yaw` sideways and `pitch` up or down
 * (degrees). The lens looks at the centre of a photo `w` × `h`.
 */
function photograph({ W, H, yaw = 0, pitch = 0, roll = 0, f, w, h, distance, shift = [0, 0] }) {
  const rad = Math.PI / 180;
  const [cy, sy, cp, sp, cr, sr] = [Math.cos(yaw * rad), Math.sin(yaw * rad), Math.cos(pitch * rad), Math.sin(pitch * rad), Math.cos(roll * rad), Math.sin(roll * rad)];
  return [
    [-W / 2, -H / 2],
    [W / 2, -H / 2],
    [W / 2, H / 2],
    [-W / 2, H / 2],
  ].map(([X0, Y0]) => {
    const X = X0 * cr - Y0 * sr; // the canvas hangs a little crooked
    const Y = X0 * sr + Y0 * cr;
    const x = X * cy; // turned sideways
    const z = X * sy;
    const y2 = Y * cp - z * sp; // tilted
    const z2 = Y * sp + z * cp + distance;
    return [w / 2 + shift[0] + (f * x) / z2, h / 2 + shift[1] + (f * y2) / z2];
  });
}

/** RGBA picture from a function (x, y) → [r, g, b] evaluated at the pixel centres. */
function picture(width, height, colour) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const [r, g, b] = colour(x + 0.5, y + 0.5);
      data.set([r, g, b, 255], (y * width + x) * 4);
    }
  }
  return { data, width, height };
}

const blank = (width, height) => ({ data: new Uint8ClampedArray(width * height * 4), width, height });

/* The corners found in the trial on three of her 2023 photos (4032 × 3024 px, 24 mm equivalent). */
const TRIAL = {
  confidenze: { quad: [[284.0, 368.1], [3757.6, 333.8], [3714.7, 2750.2], [373.5, 2798.8]], w: 4032, h: 3024, cm: [140, 100] },
  istinto: { quad: [[391.9, 736.7], [2906.6, 819.3], [2757.0, 3227.8], [409.7, 3178.0]], w: 3024, h: 4032, cm: [100, 100] },
};

describe('homography', () => {
  test('sends each of the four points exactly where asked', () => {
    const from = [[0, 0], [2400, 0], [2400, 1710], [0, 1710]];
    const to = TRIAL.confidenze.quad;
    const H = homography(from, to);
    from.forEach((p, i) => {
      const [x, y] = apply(H, p[0], p[1]);
      close(x, to[i][0], 1e-6, `corner ${i} x`);
      close(y, to[i][1], 1e-6, `corner ${i} y`);
    });
  });

  test('is the identity for identical point sets and inverts cleanly', () => {
    const quad = [[10, 20], [900, 35], [880, 700], [25, 690]];
    const same = homography(quad, quad);
    close(apply(same, 400, 300)[0], 400, 1e-8);
    close(apply(same, 400, 300)[1], 300, 1e-8);
    const there = homography(defaultQuad(1000, 800, 0), quad);
    const back = homography(quad, defaultQuad(1000, 800, 0));
    const [x, y] = apply(back, ...apply(there, 123.4, 567.8));
    close(x, 123.4, 1e-6);
    close(y, 567.8, 1e-6);
  });

  test('stays accurate with coordinates of a 48-megapixel photo', () => {
    const from = [[0, 0], [2400, 0], [2400, 1800], [0, 1800]];
    const to = [[1011.2, 603.9], [7400.5, 512.2], [7333.3, 5600.1], [1100.7, 5512.8]];
    const H = homography(from, to);
    from.forEach((p, i) => close(Math.hypot(apply(H, ...p)[0] - to[i][0], apply(H, ...p)[1] - to[i][1]), 0, 1e-5));
  });

  test('refuses points that define no map (three on a line, repeated points)', () => {
    const square = [[0, 0], [1, 0], [1, 1], [0, 1]];
    assert.equal(homography(square, [[0, 0], [5, 5], [10, 10], [0, 10]]), null);
    assert.equal(homography(square, [[3, 3], [3, 3], [3, 3], [3, 3]]), null);
  });
});

describe('the quad', () => {
  test('orderCorners: top-left, top-right, bottom-right, bottom-left from every one of the 24 orders', () => {
    const permutations = (list) => (list.length < 2 ? [list] : list.flatMap((x, i) => permutations([...list.slice(0, i), ...list.slice(i + 1)]).map((rest) => [x, ...rest])));
    const rolled = [[140, 60], [700, 180], [640, 560], [70, 430]]; // a canvas hanging 12° crooked
    const tall = [[760.1, 162.8], [2451.1, 232.6], [2230.4, 3903.3], [743.1, 3843.2]];
    for (const quad of [TRIAL.istinto.quad, TRIAL.confidenze.quad, rolled, tall]) {
      for (const order of permutations([0, 1, 2, 3])) assert.deepEqual(orderCorners(order.map((i) => quad[i])), quad);
    }
  });

  test('orderCorners: a square standing on its point still starts at the top', () => {
    const diamond = [[100, 0], [200, 100], [100, 200], [0, 100]];
    const ordered = orderCorners([diamond[2], diamond[0], diamond[3], diamond[1]]);
    assert.equal(quadIsUsable(ordered, 400, 400), true, 'clockwise, so it can be straightened');
    assert.deepEqual(ordered[0], [100, 0]);
    assert.deepEqual([...ordered].sort(), [...diamond].sort());
  });

  test('quadIsUsable: accepts a real canvas, refuses folded, crossed, tiny and sliver quads', () => {
    const { quad, w, h } = TRIAL.confidenze;
    assert.equal(quadIsUsable(quad, w, h), true);
    assert.equal(quadIsUsable(defaultQuad(w, h), w, h), true);
    assert.equal(quadIsUsable([quad[1], quad[0], quad[2], quad[3]], w, h), false, 'crossed');
    assert.equal(quadIsUsable([quad[3], quad[2], quad[1], quad[0]], w, h), false, 'anticlockwise');
    assert.equal(quadIsUsable([quad[0], quad[1], [2000, 900], quad[3]], w, h), false, 'a corner folded inwards');
    assert.equal(quadIsUsable([[100, 100], [140, 100], [140, 140], [100, 140]], w, h), false, 'tiny');
    assert.equal(quadIsUsable([[100, 100], [3900, 100], [3900, 130], [100, 130]], w, h), false, 'sliver');
    assert.equal(quadIsUsable([[400, 400], [3600, 1300], [3600, 1700], [400, 2600]], w, h), false, 'seen far too much from the side');
    assert.equal(quadIsUsable([[400, 400], [3600, 900], [3600, 2100], [400, 2600]], w, h), true, 'from the side, but usable');
    assert.equal(quadIsUsable([quad[0], [2000, 351], quad[1], quad[2]], w, h), false, 'three corners in a row');
    assert.equal(quadIsUsable([[0, 0], [NaN, 0], [10, 10], [0, 10]], w, h), false);
    assert.equal(quadIsUsable([[0, 0], [10, 0], [10, 10], 'x'], w, h), false);
    assert.equal(quadIsUsable([quad[0], quad[1], quad[2]], w, h), false);
  });

  test('defaultQuad: the whole photo, or a rectangle a little inside it', () => {
    assert.deepEqual(defaultQuad(1000, 500), [[0, 0], [1000, 0], [1000, 500], [0, 500]]);
    assert.deepEqual(defaultQuad(1000, 500, 0.1), [[100, 50], [900, 50], [900, 450], [100, 450]]);
  });
});

describe('the true shape of the canvas', () => {
  test('focalPixels: 35 mm equivalent → pixels by the diagonal; nonsense falls back to a phone’s main camera', () => {
    close(focalPixels(24, 4032, 3024), (24 / Math.hypot(36, 24)) * 5040, 1e-9);
    assert.equal(focalPixels(24, 4032, 3024), focalPixels(24, 3024, 4032), 'same for a portrait photo');
    assert.equal(DEFAULT_FOCAL_35, 24, 'the widest main camera: guessing short costs little, guessing long a lot');
    for (const bad of [undefined, null, NaN, 0, -5, 3, 5000]) {
      assert.equal(focalPixels(bad, 4000, 3000), focalPixels(DEFAULT_FOCAL_35, 4000, 3000), String(bad));
    }
  });

  test('exact for a rectangle photographed from the side, up, down and crooked', () => {
    const [w, h] = [4032, 3024];
    const f = focalPixels(24, w, h);
    for (const [W, H] of [[140, 100], [100, 100], [60, 140]]) {
      for (const view of [{}, { yaw: 25 }, { yaw: -18, pitch: 9 }, { pitch: -14, roll: 3 }, { yaw: 8, pitch: 6, roll: -2 }]) {
        const quad = photograph({ W, H, f, w, h, distance: 320, ...view });
        close(aspectRatio(quad, w, h, f), W / H, 1e-6, `${W}×${H} ${JSON.stringify(view)}`);
      }
    }
  });

  test('a photo taken straight on gives the plain ratio of the sides, whatever the focal length', () => {
    const quad = [[500, 400], [3300, 400], [3300, 2400], [500, 2400]];
    for (const f35 of [13, 24, 26, 77]) close(aspectRatio(quad, 4032, 3024, focalPixels(f35, 4032, 3024)), 1.4, 1e-9);
  });

  test('a wrong guess of the lens costs little for a photo taken nearly straight on, more from the side', () => {
    const [w, h] = [4032, 3024];
    const taken = (yaw, f35) => photograph({ W: 140, H: 100, yaw, pitch: 3, f: focalPixels(f35, w, h), w, h, distance: (300 * f35) / 26 });
    const guessed = (quad) => aspectRatio(quad, w, h, focalPixels(DEFAULT_FOCAL_35, w, h));
    close(guessed(taken(8, 26)), 1.4, 0.006);
    close(guessed(taken(8, 48)), 1.4, 0.02);
    close(guessed(taken(25, 26)), 1.4, 0.03);
    // guessing too short is bounded by «no correction at all»; this is the worst a tele photo from the side can do
    const tele = taken(25, 77);
    const plain = aspectRatio(tele, w, h, NaN);
    assert.ok(guessed(tele) < 1.4 && guessed(tele) > plain - 0.12, `${guessed(tele)} vs plain ${plain}`);
  });

  test('chooseRatio: her measurements decide when the photo does not contradict them', () => {
    const [w, h] = [4032, 3024];
    const quad = photograph({ W: 140, H: 100, yaw: 20, pitch: 4, f: focalPixels(26, w, h), w, h, distance: 300 });
    // no measurements: the photo, with the lens it names or the assumed one
    assert.deepEqual(chooseRatio(quad, w, h, { focal35: 26 }).from, 'photo');
    close(chooseRatio(quad, w, h, { focal35: 26 }).ratio, 1.4, 1e-6);
    close(chooseRatio(quad, w, h).ratio, 1.4, 0.03);
    // right measurements: exactly their shape, also when the lens is unknown
    assert.deepEqual(chooseRatio(quad, w, h, { measures: { larghezza: 140, altezza: 100 } }), { ratio: 1.4, from: 'measures' });
    assert.deepEqual(chooseRatio(quad, w, h, { focal35: 26, measures: { larghezza: 70, altezza: 50 } }), { ratio: 1.4, from: 'measures' });
    // measurements the photo contradicts are ignored: typed the wrong way round, a slip, or a detail photo
    for (const measures of [{ larghezza: 100, altezza: 140 }, { larghezza: 140, altezza: 80 }, { larghezza: 160, altezza: 100 }]) {
      assert.equal(chooseRatio(quad, w, h, { focal35: 26, measures }).from, 'photo', JSON.stringify(measures));
    }
    // incomplete or nonsense measurements
    for (const measures of [null, {}, { larghezza: 140, altezza: null }, { larghezza: 0, altezza: 100 }, { larghezza: -3, altezza: 2 }]) {
      assert.equal(chooseRatio(quad, w, h, { measures }).from, 'photo', JSON.stringify(measures));
    }
  });

  test('chooseRatio: with the lens known, measurements must agree closely; a photo straight on allows no slack', () => {
    const [w, h] = [4032, 3024];
    const side = photograph({ W: 140, H: 100, yaw: 25, f: focalPixels(24, w, h), w, h, distance: 300 });
    assert.equal(chooseRatio(side, w, h, { focal35: 24, measures: { larghezza: 146, altezza: 100 } }).from, 'photo', '4 % off with a known lens');
    assert.equal(chooseRatio(side, w, h, { measures: { larghezza: 146, altezza: 100 } }).from, 'measures', 'the same with an unknown lens is within what the photo allows');
    const front = [[500, 400], [3300, 400], [3300, 2400], [500, 2400]];
    assert.equal(chooseRatio(front, w, h, { measures: { larghezza: 146, altezza: 100 } }).from, 'photo', 'straight on, the photo knows');
    assert.equal(chooseRatio(front, w, h, { measures: { larghezza: 141, altezza: 100 } }).from, 'measures');
    // her 2023 Estasi: the form said 60 × 130 cm, four photos say 0.43: the photo wins
    const estasi = [[760.1, 162.8], [2451.1, 232.6], [2230.4, 3903.3], [743.1, 3843.2]];
    const chosen = chooseRatio(estasi, 3024, 4032, { focal35: 24, measures: { larghezza: 60, altezza: 130 } });
    assert.equal(chosen.from, 'photo');
    close(chosen.ratio, 0.4284, 0.001);
  });

  test('chooseRatio: measurements never bend the picture more than 12 % from the photo’s own estimate', () => {
    // far from the side with an ultra-wide lens the photo allows almost any shape: the cap still holds
    const [w, h] = [4032, 3024];
    const quad = photograph({ W: 140, H: 100, yaw: 28, pitch: 5, f: focalPixels(13, w, h), w, h, distance: 150 });
    assert.equal(quadIsUsable(quad, w, h), true);
    const estimate = chooseRatio(quad, w, h).ratio;
    assert.equal(chooseRatio(quad, w, h, { measures: { larghezza: estimate * 1.115, altezza: 1 } }).from, 'measures');
    assert.equal(chooseRatio(quad, w, h, { measures: { larghezza: estimate * 1.125, altezza: 1 } }).from, 'photo');
  });

  test('chooseRatio: the focal length in the photo is trusted only for an uncropped 4:3 photo', () => {
    const [w, h] = [4032, 3024];
    const f = focalPixels(60, w, h);
    const quad = photograph({ W: 140, H: 100, yaw: 25, f, w, h, distance: 700 });
    close(chooseRatio(quad, w, h, { focal35: 60 }).ratio, 1.4, 1e-6);
    // the same corners in a photo cropped to 16:9: the stated 60 mm no longer describes it
    const cropped = chooseRatio(quad.map(([x, y]) => [x, y - 378]), 4032, 2268, { focal35: 60 });
    close(cropped.ratio, aspectRatio(quad.map(([x, y]) => [x, y - 378]), 4032, 2268, focalPixels(DEFAULT_FOCAL_35, 4032, 2268)), 1e-9);
  });

  test('her 2023 photos: the shape found matches the measured canvases', () => {
    for (const [name, { quad, w, h, cm }] of Object.entries(TRIAL)) {
      close(aspectRatio(quad, w, h, focalPixels(24, w, h)), cm[0] / cm[1], 0.005, name);
    }
  });

  test('numbers that break down fall back to the plain ratio of the sides', () => {
    const quad = [[500, 400], [3300, 400], [3300, 2400], [500, 2400]];
    assert.equal(aspectRatio(quad, 4032, 3024, 0), 1.4);
    assert.equal(aspectRatio(quad, 4032, 3024, NaN), 1.4);
  });

  test('outputSize: the right shape, never enlarged, at most 2400 px', () => {
    const { quad } = TRIAL.confidenze;
    assert.deepEqual(outputSize(quad, 1.4, 2400), { width: 2400, height: 1714 });
    assert.deepEqual(outputSize(quad, 1.4, 4096), { width: 3405, height: 2432 }, 'limited by the pixels the photo has on the canvas');
    assert.equal(edgeMargin(2400, 1714), 7);
    assert.equal(edgeMargin(400, 300), 3, 'never less than 3 pixels');
    const small = [[100, 100], [700, 110], [690, 520], [95, 500]];
    const size = outputSize(small, 1.5, 2400);
    assert.ok(size.width <= 605 && size.height <= 420, JSON.stringify(size));
    close(size.width / size.height, 1.5, 0.01);
    assert.ok(MIN_OUTPUT_SIDE >= 100);
  });
});

describe('moving the pixels', () => {
  test('the whole photo as quad gives the photo back, pixel for pixel', () => {
    const source = picture(40, 30, (x, y) => [x * 6, y * 8, (x * 7 + y * 3) % 256]);
    const target = blank(40, 30);
    warpRows(target, source, outputToPhoto(defaultQuad(40, 30), 40, 30));
    assert.deepEqual(target.data, source.data);
  });

  test('each output pixel shows the photo at the place the map says (to within a rounding)', () => {
    // a photo whose red is its column and green its row: the warp's result can be checked against the map itself
    const source = picture(200, 160, (x, y) => [x - 0.5, y - 0.5, 128]);
    const quad = [[31.5, 22.25], [170, 30.5], [160.75, 140], [25, 131.5]];
    const target = blank(120, 96);
    const map = outputToPhoto(quad, 120, 96);
    warpRows(target, source, map);
    for (const [x, y] of [[0, 0], [119, 0], [119, 95], [0, 95], [60, 48], [17, 80], [101, 9]]) {
      const [sx, sy] = apply(map, x + 0.5, y + 0.5);
      const p = (y * 120 + x) * 4;
      close(target.data[p], sx - 0.5, 0.51, `red at ${x},${y}`);
      close(target.data[p + 1], sy - 0.5, 0.51, `green at ${x},${y}`);
      assert.equal(target.data[p + 2], 128);
      assert.equal(target.data[p + 3], 255);
    }
  });

  test('done in slices of rows it gives the same picture as in one go', () => {
    const source = picture(90, 70, (x, y) => [(x * 13) % 256, (y * 17) % 256, (x + y) % 256]);
    const map = outputToPhoto([[8, 6], [80, 10], [84, 62], [5, 66]], 70, 54, 3);
    const whole = blank(64, 48);
    warpRows(whole, source, map);
    const sliced = blank(64, 48);
    for (let y = 0; y < 48; y += 7) warpRows(sliced, source, map, y, Math.min(48, y + 7));
    assert.deepEqual(sliced.data, whole.data);
  });

  test('a canvas photographed from the side comes out flat: its checks are square again', () => {
    // paint a chessboard of 8 × 6 checks on a rectangle, photograph it from the side, straighten it
    const [w, h] = [400, 300];
    const f = focalPixels(26, w, h);
    const quad = photograph({ W: 80, H: 60, yaw: 28, pitch: 7, f, w, h, distance: 150 });
    const toCanvas = homography(quad, [[0, 0], [8, 0], [8, 6], [0, 6]]);
    const source = picture(w, h, (x, y) => {
      const [u, v] = apply(toCanvas, x, y);
      if (u < 0 || u > 8 || v < 0 || v > 6) return [235, 232, 226]; // wall
      return (Math.floor(u) + Math.floor(v)) % 2 ? [20, 20, 20] : [200, 60, 40];
    });
    const ratio = aspectRatio(quad, w, h, f);
    close(ratio, 8 / 6, 1e-6);
    const target = blank(160, 120);
    warpRows(target, source, outputToPhoto(quad, 160, 120));
    let wrong = 0;
    for (let cy = 0; cy < 6; cy++) {
      for (let cx = 0; cx < 8; cx++) {
        const p = ((cy * 20 + 10) * 160 + cx * 20 + 10) * 4; // centre of each check
        const dark = target.data[p] < 100;
        if (dark !== Boolean((cx + cy) % 2)) wrong++;
      }
    }
    assert.equal(wrong, 0);
    // no wall along the edges
    for (let x = 0; x < 160; x++) assert.ok(target.data[x * 4 + 2] < 220 && target.data[(119 * 160 + x) * 4 + 2] < 220, `wall at column ${x}`);
  });

  test('keeps a fine line sharp: no more blur than the photo itself', () => {
    // a one-pixel dark line on a light ground, read half a pixel off: bicubic keeps most of its depth
    const source = picture(40, 9, (x) => (Math.floor(x) === 20 ? [0, 0, 0] : [200, 200, 200]));
    const target = blank(40, 9);
    warpRows(target, source, outputToPhoto([[0.5, 0], [40.5, 0], [40.5, 9], [0.5, 9]], 40, 9));
    const row = [...target.data.subarray(4 * 40 * 4, 5 * 40 * 4)].filter((_, i) => i % 4 === 0);
    assert.ok(Math.min(...row) < 90, `the line stays dark (${Math.min(...row)}); a plain mean of neighbours gives 100`);
    assert.ok(Math.max(...row) <= 225, 'only a slight halo beside it');
    assert.equal(row[5], 200);
  });

  test('positions outside the photo take its edge instead of garbage', () => {
    const source = picture(20, 20, () => [10, 200, 30]);
    const target = blank(30, 30);
    warpRows(target, source, outputToPhoto([[-15, -15], [35, -15], [35, 35], [-15, 35]], 30, 30));
    for (let p = 0; p < target.data.length; p += 4) assert.deepEqual([...target.data.subarray(p, p + 4)], [10, 200, 30, 255]);
  });

  test('outputToPhoto: the margin cuts the same few pixels inside the marked corners on every side', () => {
    const quad = [[100, 100], [900, 100], [900, 700], [100, 700]];
    const exact = outputToPhoto(quad, 800, 600);
    assert.deepEqual(apply(exact, 0, 0).map(Math.round), [100, 100]);
    assert.deepEqual(apply(exact, 800, 600).map(Math.round), [900, 700]);
    // with a margin of 5 the picture is 790 × 590 and starts 5 pixels inside
    const inside = outputToPhoto(quad, 800, 600, 5);
    close(apply(inside, 0, 0)[0], 105, 1e-9);
    close(apply(inside, 0, 0)[1], 105, 1e-9);
    close(apply(inside, 790, 590)[0], 895, 1e-9);
    close(apply(inside, 790, 590)[1], 695, 1e-9);
    assert.equal(outputToPhoto([[0, 0], [5, 5], [10, 10], [0, 10]], 800, 600, 5), null);
  });

  test('maxDensity: photo pixels per picture pixel, at the densest corner', () => {
    const front = [[400, 300], [3600, 300], [3600, 2700], [400, 2700]];
    close(maxDensity(outputToPhoto(front, 1600, 1200), 1600, 1200), 2, 1e-9);
    close(maxDensity(outputToPhoto(front, 3200, 2400), 3200, 2400), 1, 1e-9);
    // from the side the near edge is denser than the plain ratio of the sizes suggests
    const [w, h] = [4032, 3024];
    const side = photograph({ W: 140, H: 100, yaw: 25, f: focalPixels(26, w, h), w, h, distance: 185 });
    const size = outputSize(side, 1.4, 2400);
    const density = maxDensity(outputToPhoto(side, size.width, size.height), size.width, size.height);
    const naive = Math.max(...side.map((p) => p[0])) - Math.min(...side.map((p) => p[0]));
    assert.ok(density > (naive / size.width) * 1.15, `${density} vs ${naive / size.width}`);
    assert.ok(density < 3);
  });

  test('sourcePlan: the box around the quad, reduced within the limits of a phone canvas', () => {
    const quad = [[284.0, 368.1], [3757.6, 333.8], [3714.7, 2750.2], [373.5, 2798.8]];
    const plan = sourcePlan(quad, 4032, 3024);
    assert.deepEqual([plan.sx, plan.sy, plan.sw, plan.sh, plan.dw, plan.dh], [282, 331, 3478, 2470, 3478, 2470]);
    close(plan.quad[0][0], 2, 1e-9);
    close(plan.quad[0][1], 37.1, 1e-9);
    // reduced: the quad follows exactly, also when rounding makes the two factors differ a hair
    const half = sourcePlan(quad, 4032, 3024, 0.5);
    assert.deepEqual([half.dw, half.dh], [1739, 1235]);
    close(half.quad[2][0], ((3714.7 - 282) * 1739) / 3478, 1e-9);
    close(half.quad[2][1], ((2750.2 - 331) * 1235) / 2470, 1e-9);
    // a 48-megapixel photo: never more than 4096 px on a side
    const big = sourcePlan([[100, 100], [7900, 150], [7950, 5900], [80, 5950]], 8064, 6048);
    assert.ok(big.dw <= 4096 && big.dh <= 4096 && big.dw * big.dh <= 4096 * 4096, JSON.stringify(big));
    // a quad at the very edge stays inside the photo
    const edge = sourcePlan([[0, 0], [4032, 0], [4032, 3024], [0, 3024]], 4032, 3024);
    assert.deepEqual([edge.sx, edge.sy, edge.sw, edge.sh], [0, 0, 4032, 3024]);
    // warping through the plan gives the same picture as warping the photo itself
    const source = picture(120, 90, (x, y) => [x * 2, y * 2.5, (x + y) % 256]);
    const q = [[20.5, 14], [101, 18.25], [97, 80], [16, 73.5]];
    const direct = blank(60, 48);
    warpRows(direct, source, outputToPhoto(q, 60, 48));
    const p = sourcePlan(q, 120, 90);
    const cropped = blank(p.dw, p.dh);
    for (let y = 0; y < p.dh; y++) cropped.data.set(source.data.subarray(((y + p.sy) * 120 + p.sx) * 4, ((y + p.sy) * 120 + p.sx + p.sw) * 4), y * p.dw * 4);
    const viaPlan = blank(60, 48);
    warpRows(viaPlan, cropped, outputToPhoto(p.quad, 60, 48));
    assert.deepEqual(viaPlan.data, direct.data);
  });
});

describe('a first guess of the corners', () => {
  /** A small photo: light wall with a little noise, a dark canvas at `quad`, plus extras. */
  function scene(quad, { label = false, shadow = false, wall = [232, 229, 222] } = {}) {
    const [w, h] = [320, 240];
    const toUnit = homography(quad, [[0, 0], [1, 0], [1, 1], [0, 1]]);
    let seed = 7;
    const noise = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) % 9) - 4;
    return picture(w, h, (x, y) => {
      const [u, v] = apply(toUnit, x, y);
      if (u >= 0 && u <= 1 && v >= 0 && v <= 1) return [60 + u * 120, 40 + v * 60, 30 + ((u * 7 + v * 5) % 1) * 90]; // paint
      if (label && x > 14 && x < 30 && y > 150 && y < 160) return [120, 120, 120]; // the label next to it
      if (shadow && u >= 0 && u <= 1.02 && v > 1 && v < 1.03) return [wall[0] - 22, wall[1] - 22, wall[2] - 22]; // soft shadow below
      return wall.map((c) => c + noise());
    });
  }

  test('finds a canvas on a plain wall to within a couple of pixels', () => {
    const quad = [[62, 40], [270, 48], [262, 200], [58, 190]];
    const found = detectCorners(scene(quad, { label: true, shadow: true }));
    assert.ok(found, 'a quad is found');
    found.forEach((p, i) => close(Math.hypot(p[0] - quad[i][0], p[1] - quad[i][1]), 0, 2.5, `corner ${i}`));
  });

  test('works on a tall, narrow canvas and on a coloured wall', () => {
    const quad = [[120, 12], [205, 16], [200, 228], [118, 224]];
    const found = detectCorners(scene(quad, { wall: [150, 170, 190] }));
    assert.ok(found);
    found.forEach((p, i) => close(Math.hypot(p[0] - quad[i][0], p[1] - quad[i][1]), 0, 2.5, `corner ${i}`));
  });

  test('a soft shadow beside the canvas does not move the corners', () => {
    const quad = [[62, 40], [270, 48], [262, 200], [58, 190]];
    const [w, h] = [320, 240];
    const toUnit = homography(quad, [[0, 0], [1, 0], [1, 1], [0, 1]]);
    // a shadow 7 px wide to the right and below, 20 % darker than the wall
    const image = picture(w, h, (x, y) => {
      const [u, v] = apply(toUnit, x, y);
      if (u >= 0 && u <= 1 && v >= 0 && v <= 1) return [70 + u * 100, 50, 40 + v * 80];
      const [us, vs] = apply(toUnit, x - 7, y - 7);
      return us >= 0 && us <= 1 && vs >= 0 && vs <= 1 ? [186, 183, 178] : [232, 229, 222];
    });
    const found = detectCorners(image);
    assert.ok(found);
    found.forEach((p, i) => close(Math.hypot(p[0] - quad[i][0], p[1] - quad[i][1]), 0, 2.5, `corner ${i}`));
  });

  test('gives up when the canvas runs out of the photo or part of it looks like the wall', () => {
    assert.equal(detectCorners(scene([[62, -20], [270, -12], [262, 200], [58, 190]])), null, 'cut off at the top');
    // the top-left third of the painting is as light as the wall: the patch found is not the canvas
    const quad = [[62, 40], [270, 48], [262, 200], [58, 190]];
    const toUnit = homography(quad, [[0, 0], [1, 0], [1, 1], [0, 1]]);
    const pale = picture(320, 240, (x, y) => {
      const [u, v] = apply(toUnit, x, y);
      if (u < 0 || u > 1 || v < 0 || v > 1 || u + v < 0.7) return [232, 229, 222];
      return [60, 50, 90];
    });
    assert.equal(detectCorners(pale), null);
  });

  test('gives up (null) when there is no believable canvas', () => {
    assert.equal(detectCorners(picture(320, 240, () => [230, 228, 220])), null, 'bare wall');
    assert.equal(detectCorners(picture(320, 240, (x, y) => [(x * 3) % 256, (y * 5) % 256, (x * y) % 256])), null, 'a close-up: paint everywhere');
    assert.equal(detectCorners(scene([[150, 110], [170, 110], [170, 126], [150, 126]])), null, 'only a small thing on the wall');
    // an L-shaped patch is not a canvas
    const l = picture(320, 240, (x, y) => ((x > 60 && x < 110 && y > 30 && y < 210) || (x > 60 && x < 260 && y > 160 && y < 210) ? [40, 40, 40] : [230, 228, 220]));
    assert.equal(detectCorners(l), null, 'L shape');
    assert.equal(detectCorners(picture(8, 8, () => [0, 0, 0])), null, 'too small to say');
  });
});

describe('the focal length written in the photo', () => {
  /** Minimal JPEG start: SOI, optional other segment, APP1 Exif with IFD0 → Exif IFD → tag A405. */
  function jpegWithFocal(focal, { little = true, before = true, type = 3 } = {}) {
    const tiff = new DataView(new ArrayBuffer(8 + 2 + 12 + 4 + 2 + 2 * 12 + 4));
    const u16 = (at, v) => tiff.setUint16(at, v, little);
    const u32 = (at, v) => tiff.setUint32(at, v, little);
    tiff.setUint16(0, little ? 0x4949 : 0x4d4d);
    u16(2, 42);
    u32(4, 8); // IFD0 right after the header
    u16(8, 1);
    u16(10, 0x8769); u16(12, 4); u32(14, 1); u32(18, 26); // pointer to the Exif IFD at 26
    u32(22, 0);
    u16(26, 2);
    u16(28, 0x9003); u16(30, 2); u32(32, 1); u32(36, 0); // some other tag first
    u16(40, 0xa405); u16(42, type); u32(44, 1);
    if (type === 3) u16(48, focal);
    else u32(48, focal);
    const tiffBytes = new Uint8Array(tiff.buffer);
    const app1 = [0xff, 0xe1, ((tiffBytes.length + 8) >> 8) & 0xff, (tiffBytes.length + 8) & 0xff, 0x45, 0x78, 0x69, 0x66, 0, 0, ...tiffBytes];
    const app0 = before ? [0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0] : [];
    return Uint8Array.from([0xff, 0xd8, ...app0, ...app1, 0xff, 0xdb, 0, 4, 0, 0, 0xff, 0xda, 0, 2]);
  }

  test('reads tag A405 in both byte orders, after other segments, as SHORT or LONG', () => {
    assert.equal(readFocal35(jpegWithFocal(24)), 24);
    assert.equal(readFocal35(jpegWithFocal(26, { little: false })), 26);
    assert.equal(readFocal35(jpegWithFocal(77, { before: false })), 77);
    assert.equal(readFocal35(jpegWithFocal(13, { type: 4 })), 13);
    // also when the bytes are a window into a larger buffer
    const bytes = jpegWithFocal(48);
    const padded = new Uint8Array(bytes.length + 10);
    padded.set(bytes, 5);
    assert.equal(readFocal35(padded.subarray(5, 5 + bytes.length)), 48);
  });

  test('null for anything else: no Exif, not a JPEG, nonsense values, a file cut short', () => {
    assert.equal(readFocal35(Uint8Array.from([0xff, 0xd8, 0xff, 0xdb, 0, 4, 0, 0, 0xff, 0xda, 0, 2])), null);
    assert.equal(readFocal35(Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4, 5, 6, 7, 8, 9])), null);
    assert.equal(readFocal35(new Uint8Array(0)), null);
    assert.equal(readFocal35(null), null);
    assert.equal(readFocal35(jpegWithFocal(0)), null);
    assert.equal(readFocal35(jpegWithFocal(4000)), null);
    const whole = jpegWithFocal(24);
    for (let cut = 3; cut < whole.length - 14; cut += 5) assert.equal(readFocal35(whole.subarray(0, cut)), null, `cut at ${cut}`);
  });
});
