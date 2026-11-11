/**
 * Photo pipeline: runs entirely on the phone, before anything is uploaded.
 *
 * Every photo is decoded with its EXIF rotation applied, drawn on a canvas at most 2400 px on the
 * longest side and re-encoded as JPEG 0.88. Re-encoding drops all metadata (EXIF, GPS position):
 * important, because the repository and the website are public. A small preview (480 px) is made
 * at the same time for the screens of the admin.
 *
 * «Raddrizza» (straightenPhoto) makes a flat, front-facing picture of a canvas photographed a little
 * from the side: a perspective warp of her own pixels (straighten.js), encoded the same way.
 * «Colori più vivi» (colours.js) takes the grey haze out of a pale photo and strengthens weak colours;
 * a photo of a work is prepared both ways, so she can switch it off without anything being lost.
 *
 * Memory: a 12-megapixel photo needs ~48 MB once decoded and iOS Safari kills pages that use too
 * much. The callers process photos one at a time; here every bitmap, object URL and canvas is
 * released as soon as it is no longer needed.
 */
import { base64ToBytes } from './crypto.js';
import { gradeParams, gradeRows } from './colours.js';
import { quadIsUsable, chooseRatio, outputSize, edgeMargin, outputToPhoto, maxDensity, sourcePlan, warpRows, detectCorners, readFocal35, MIN_OUTPUT_SIDE } from './straighten.js';

export const MAX_SIDE = 2400;
export const JPEG_QUALITY = 0.88;
export const PREVIEW_SIDE = 480;
const PREVIEW_QUALITY = 0.8;
/** «Raddrizza»: the photo as shown while she places the corners, and the small copy the first guess is made on. */
export const EDIT_SIDE = 1600;
const DETECT_SIDE = 480;
/**
 * The warp reads the photo's own pixels as long as no pixel of the result covers more than this many
 * of them (a 12-megapixel photo: about 1.5 on the near side of the canvas); a larger photo is first
 * reduced to that, so that fine paint texture does not shimmer.
 */
const WARP_DENSITY = 1.6;
/** The warp pauses this often (milliseconds) so the page stays alive. */
const WARP_BREATH = 40;

/** A photo that cannot be used; the message is meant for her. */
export class PhotoError extends Error {
  constructor(message) {
    super(message);
    this.name = 'PhotoError';
  }
}

/* 2×1 px JPEG with EXIF orientation 6 (rotated 90°): decodes as 1×2 when orientation is applied. */
const ORIENTATION_PROBE =
  '/9j/4QC8RXhpZgAASUkqAAgAAAAGABIBAwABAAAABgAAABoBBQABAAAAVgAAABsBBQABAAAAXgAAACgBAwABAAAAAgAAABMCAwABAAAAAQAAAGmHBAABAAAAZgAAAAAAAAA4YwAA6AMAADhjAADoAwAABgAAkAcABAAAADAyMTABkQcABAAAAAECAwAAoAcABAAAADAxMDABoAMAAQAAAP//AAACoAQAAQAAAAIAAAADoAQAAQAAAAEAAAAAAAAA/9sAQwBQNzxGPDJQRkFGWlVQX3jIgnhubnj1r7mRyP///////////////////////////////////////////////////9sAQwFVWlp4aXjrgoLr/////////////////////////////////////////////////////////////////////////8AAEQgAAQACAwEiAAIRAQMRAf/EABQAAQAAAAAAAAAAAAAAAAAAAAD/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFAEBAAAAAAAAAAAAAAAAAAAAAP/EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAMAwEAAhEDEQA/AAAP/9k=';

let bitmapProbe = null;

/**
 * Does createImageBitmap(…, {imageOrientation: 'from-image'}) really apply the EXIF rotation here?
 * Some Safari versions ignore it (photos would come out sideways), so it is tested once.
 */
function bitmapAppliesOrientation() {
  if (typeof createImageBitmap !== 'function') return Promise.resolve(false);
  bitmapProbe ??= (async () => {
    try {
      const blob = new Blob([base64ToBytes(ORIENTATION_PROBE)], { type: 'image/jpeg' });
      const bitmap = await createImageBitmap(blob, { imageOrientation: 'from-image' });
      const ok = bitmap.width === 1 && bitmap.height === 2;
      bitmap.close();
      return ok;
    } catch {
      return false;
    }
  })();
  return bitmapProbe;
}

async function decodeWithBitmap(file) {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  return { source: bitmap, width: bitmap.width, height: bitmap.height, release: () => bitmap.close() };
}

/** <img> applies the EXIF rotation in every current browser (CSS image-orientation: from-image). */
async function decodeWithImg(file) {
  const url = URL.createObjectURL(file);
  const img = new Image();
  try {
    img.src = url;
    await img.decode();
    if (!img.naturalWidth || !img.naturalHeight) throw new Error('empty image');
  } catch (err) {
    URL.revokeObjectURL(url);
    throw err;
  }
  return {
    source: img,
    width: img.naturalWidth,
    height: img.naturalHeight,
    release: () => {
      URL.revokeObjectURL(url);
      img.removeAttribute('src');
    },
  };
}

function unreadable(file) {
  const heic = /hei[cf]/i.test(file.type || '') || /\.hei[cf]$/i.test(file.name || '');
  return new PhotoError(
    heic
      ? 'Questa foto è in formato HEIC e questo browser non la sa leggere. Sull’iPhone usa Safari, oppure scegli un’altra foto.'
      : 'Non riesco a leggere questa foto. Prova con un’altra, oppure scattala di nuovo.',
  );
}

/** Decoded photo with the right rotation: createImageBitmap when trustworthy, else <img>. */
async function decode(file) {
  const order = (await bitmapAppliesOrientation()) ? [decodeWithBitmap, decodeWithImg] : [decodeWithImg];
  for (const attempt of order) {
    try {
      return await attempt(file);
    } catch {
      /* try the next decoder */
    }
  }
  throw unreadable(file);
}

function drawScaled(source, width, height) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new PhotoError('Il telefono non ha abbastanza memoria per preparare la foto. Chiudi altre app e riprova.');
  ctx.fillStyle = '#ffffff'; // JPEG has no transparency: transparent PNG areas become white, not black
  ctx.fillRect(0, 0, width, height);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, 0, 0, width, height);
  return canvas;
}

/** Frees a canvas' pixels right away (iOS limits the total canvas memory of a page). */
function releaseCanvas(canvas) {
  if (!canvas) return;
  canvas.width = 0;
  canvas.height = 0;
}

function toJpeg(canvas, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) =>
        blob && blob.size
          ? resolve(blob)
          : reject(new PhotoError('Il telefono non è riuscito a preparare la foto (memoria piena?). Chiudi altre app e riprova.')),
      'image/jpeg',
      quality,
    );
  });
}

/** Size that fits `max` on the longest side, never enlarged. */
export function fitSize(width, height, max) {
  const scale = Math.min(1, max / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

/**
 * «Colori più vivi» on the pixels of `canvas`, in place, in slices so the page keeps breathing.
 * Returns false (and leaves the canvas as it was) when the phone cannot read the pixels back.
 */
async function gradeCanvas(canvas) {
  let pixels;
  try {
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    pixels = ctx && ctx.getImageData(0, 0, canvas.width, canvas.height);
    if (!pixels || pixels.data[3] !== 255) return false; // a canvas the phone could not really allocate
    const params = gradeParams(pixels);
    let since = performance.now();
    for (let y = 0; y < pixels.height; y += 64) {
      gradeRows(pixels, params, y, Math.min(pixels.height, y + 64));
      if (performance.now() - since > 40) {
        await breathe();
        since = performance.now();
      }
    }
    ctx.putImageData(pixels, 0, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Photo file from the camera or the gallery → web-ready JPEG without metadata.
 * With `colours`, also with «Colori più vivi»: then `blob`/`preview` are the livelier picture and
 * `plain` the photo as it was; `colours` says whether the correction was made (the phone may lack the
 * memory for it: the photo is then simply as it was).
 * @param {File|Blob} file
 * @param {{colours?: boolean}} [opts]
 * @returns {Promise<{blob: Blob, preview: Blob, width: number, height: number, colours: boolean, plain?: {blob: Blob, preview: Blob}}>}
 * @throws {PhotoError} with a message for her
 */
export async function preparePhoto(file, { colours = false } = {}) {
  const image = await decode(file);
  let canvas = null;
  let previewCanvas = null;
  try {
    const size = fitSize(image.width, image.height, MAX_SIDE);
    try {
      canvas = drawScaled(image.source, size.width, size.height);
    } finally {
      image.release(); // the full-size pixels are no longer needed
    }
    const small = fitSize(size.width, size.height, PREVIEW_SIDE);
    const encode = async () => {
      const blob = await toJpeg(canvas, JPEG_QUALITY);
      releaseCanvas(previewCanvas);
      previewCanvas = drawScaled(canvas, small.width, small.height);
      return { blob, preview: await toJpeg(previewCanvas, PREVIEW_QUALITY) };
    };
    const plain = await encode();
    if (!colours || !(await gradeCanvas(canvas))) return { ...plain, width: size.width, height: size.height, colours: false };
    const vivid = await encode();
    return { ...vivid, width: size.width, height: size.height, colours: true, plain };
  } catch (err) {
    throw err instanceof PhotoError ? err : unreadable(file);
  } finally {
    releaseCanvas(canvas);
    releaseCanvas(previewCanvas);
  }
}

/* ---------- «Raddrizza» ---------- */

const NO_MEMORY = 'Il telefono non è riuscito a raddrizzare la foto (memoria piena?). Chiudi altre app e riprova.';
const BAD_CORNERS = 'I quattro punti non formano un quadro: mettine uno su ogni angolo della tela.';

/** The focal length the phone wrote in the photo (35 mm equivalent), or null. Read before the photo is re-encoded. */
export async function photoFocal35(file) {
  try {
    return readFocal35(new Uint8Array(await file.slice(0, 131072).arrayBuffer()));
  } catch {
    return null;
  }
}

/** Lets the page handle touches and draw; unlike a timer it is not slowed down in a background tab. */
function breathe() {
  return new Promise((resolve) => {
    if (typeof MessageChannel !== 'function') return setTimeout(resolve, 0);
    const channel = new MessageChannel();
    channel.port1.onmessage = () => resolve();
    channel.port2.postMessage(0);
  });
}

/**
 * What the «Raddrizza» screen needs to show a photo: a canvas at most EDIT_SIDE px (the caller puts it
 * in the page and frees it with `release()`), the first guess of the canvas' corners as fractions of
 * the photo's sides (or null when no canvas with wall around it is recognised) and the photo's size.
 * @param {Blob} photo  the prepared JPEG (at most 2400 px): opening the screen never decodes a 12-megapixel original
 * @returns {Promise<{canvas: HTMLCanvasElement, width: number, height: number, guess: number[][]|null, release: () => void}>}
 * @throws {PhotoError}
 */
export async function openForStraighten(photo) {
  const image = await decode(photo);
  let canvas = null;
  let small = null;
  try {
    const { width, height } = image;
    const size = fitSize(width, height, EDIT_SIDE);
    try {
      canvas = drawScaled(image.source, size.width, size.height);
    } finally {
      image.release();
    }
    const tiny = fitSize(size.width, size.height, DETECT_SIDE);
    small = drawScaled(canvas, tiny.width, tiny.height);
    const found = detectCorners(small.getContext('2d').getImageData(0, 0, tiny.width, tiny.height));
    const shown = canvas;
    canvas = null; // now the caller's
    return {
      canvas: shown,
      width,
      height,
      guess: found ? found.map(([x, y]) => [x / tiny.width, y / tiny.height]) : null,
      release: () => releaseCanvas(shown),
    };
  } catch (err) {
    throw err instanceof PhotoError ? err : unreadable(photo);
  } finally {
    releaseCanvas(canvas);
    releaseCanvas(small);
  }
}

/**
 * The canvas marked by `corners` as a flat, front-facing picture, made only of the photo's own pixels.
 *
 * Steps, each freeing what the one before needed: decode · copy the part of the photo that holds the
 * canvas to a working canvas (reduced only if it is much denser than the result) · read its pixels ·
 * warp them into the result (straighten.js) · JPEG. The largest things in memory at once are the
 * decoded photo and the working copy.
 *
 * @param {Blob} source          the photo: the original file while at hand, else the prepared JPEG
 * @param {number[][]} corners   top-left, top-right, bottom-right, bottom-left as fractions (0–1) of the photo's sides
 * @param {object} [known]
 * @param {number|null} [known.focal35]   from photoFocal35
 * @param {{larghezza: number, altezza: number}|null} [known.measures]  the canvas' size in cm, if she wrote it
 * @param {{width: number, height: number}|null} [known.expect]  size of the prepared photo: `source` must have its shape
 * @param {number|null} [known.ratio]  the shape to give it (width ÷ height), when it was chosen before
 * @param {boolean} [known.colours]    also «Colori più vivi», worked out on the canvas alone
 * @returns {Promise<{blob: Blob, preview: Blob, width: number, height: number, shape: 'measures'|'photo'|'given', ratio: number, colours: boolean}>}
 * @throws {PhotoError} with a message for her
 */
export async function straightenPhoto(source, corners, { focal35 = null, measures = null, expect = null, ratio = null, colours = false } = {}) {
  const image = await decode(source);
  let work = null;
  let out = null;
  let previewCanvas = null;
  try {
    let pixels;
    let plan;
    let full; // size of the whole marked canvas in the result, before the margin is cut
    let chosen;
    try {
      const { width, height } = image;
      // iOS answers a photo it has no memory for with a 1 × 1 picture instead of an error
      if (width < 16 || height < 16) throw new PhotoError(NO_MEMORY);
      if (expect && Math.abs((width / height) * (expect.height / expect.width) - 1) > 0.02) throw new PhotoError(NO_MEMORY);
      const quad = corners.map(([x, y]) => [x * width, y * height]);
      if (!quadIsUsable(quad, width, height)) throw new PhotoError(BAD_CORNERS);
      chosen = ratio > 0 ? { ratio, from: 'given' } : chooseRatio(quad, width, height, { focal35, measures });
      full = outputSize(quad, chosen.ratio, MAX_SIDE);
      if (Math.max(full.width, full.height) < MIN_OUTPUT_SIDE) throw new PhotoError('Il quadro è troppo piccolo in questa foto: scattala più da vicino.');
      const margin = edgeMargin(full.width, full.height);
      const direct = outputToPhoto(quad, full.width, full.height, margin);
      if (!direct) throw new PhotoError(BAD_CORNERS);
      const density = maxDensity(direct, full.width - 2 * margin, full.height - 2 * margin);
      plan = sourcePlan(quad, width, height, Math.min(1, WARP_DENSITY / density));
      work = document.createElement('canvas');
      work.width = plan.dw;
      work.height = plan.dh;
      const ctx = work.getContext('2d', { willReadFrequently: true });
      if (!ctx) throw new PhotoError(NO_MEMORY);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, plan.dw, plan.dh);
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(image.source, plan.sx, plan.sy, plan.sw, plan.sh, 0, 0, plan.dw, plan.dh);
      image.release(); // the decoded photo is no longer needed
      pixels = ctx.getImageData(0, 0, plan.dw, plan.dh);
    } finally {
      image.release();
    }
    releaseCanvas(work);
    work = null;
    // a canvas the phone could not really allocate reads back as transparent black
    for (const [fx, fy] of [[0.5, 0.5], [0.1, 0.1], [0.9, 0.1], [0.9, 0.9], [0.1, 0.9]]) {
      if (pixels.data[((Math.floor(fy * plan.dh) * plan.dw + Math.floor(fx * plan.dw)) * 4) + 3] !== 255) throw new PhotoError(NO_MEMORY);
    }

    const margin = edgeMargin(full.width, full.height);
    const width = full.width - 2 * margin;
    const height = full.height - 2 * margin;
    const map = outputToPhoto(plan.quad, full.width, full.height, margin);
    if (!map) throw new PhotoError(BAD_CORNERS);
    out = document.createElement('canvas');
    out.width = width;
    out.height = height;
    const outCtx = out.getContext('2d');
    if (!outCtx) throw new PhotoError(NO_MEMORY);
    const target = outCtx.createImageData(width, height);
    let since = performance.now();
    for (let y = 0; y < height; y += 16) {
      warpRows(target, pixels, map, y, Math.min(height, y + 16));
      if (performance.now() - since > WARP_BREATH) {
        await breathe();
        since = performance.now();
      }
    }
    pixels = null;
    let graded = false;
    if (colours) {
      const params = gradeParams(target);
      since = performance.now();
      for (let y = 0; y < height; y += 64) {
        gradeRows(target, params, y, Math.min(height, y + 64));
        if (performance.now() - since > WARP_BREATH) {
          await breathe();
          since = performance.now();
        }
      }
      graded = true;
    }
    outCtx.putImageData(target, 0, 0);

    const blob = await toJpeg(out, JPEG_QUALITY);
    const small = fitSize(width, height, PREVIEW_SIDE);
    previewCanvas = drawScaled(out, small.width, small.height);
    releaseCanvas(out);
    out = null;
    const preview = await toJpeg(previewCanvas, PREVIEW_QUALITY);
    return { blob, preview, width, height, shape: chosen.from, ratio: chosen.ratio, colours: graded };
  } catch (err) {
    throw err instanceof PhotoError ? err : new PhotoError(NO_MEMORY);
  } finally {
    releaseCanvas(work);
    releaseCanvas(out);
    releaseCanvas(previewCanvas);
  }
}
