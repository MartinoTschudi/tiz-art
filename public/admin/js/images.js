/**
 * Photo pipeline: runs entirely on the phone, before anything is uploaded.
 *
 * Every photo is decoded with its EXIF rotation applied, drawn on a canvas at most 2400 px on the
 * longest side and re-encoded as JPEG 0.88. Re-encoding drops all metadata (EXIF, GPS position):
 * important, because the repository and the website are public. A small preview (480 px) is made
 * at the same time for the screens of the admin.
 *
 * Memory: a 12-megapixel photo needs ~48 MB once decoded and iOS Safari kills pages that use too
 * much. The callers process photos one at a time; here every bitmap, object URL and canvas is
 * released as soon as it is no longer needed.
 */
import { base64ToBytes } from './crypto.js';

export const MAX_SIDE = 2400;
export const JPEG_QUALITY = 0.88;
export const PREVIEW_SIDE = 480;
const PREVIEW_QUALITY = 0.8;

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
 * Photo file from the camera or the gallery → web-ready JPEG without metadata.
 * @param {File|Blob} file
 * @returns {Promise<{blob: Blob, preview: Blob, width: number, height: number}>}
 * @throws {PhotoError} with a message for her
 */
export async function preparePhoto(file) {
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
    const blob = await toJpeg(canvas, JPEG_QUALITY);
    const small = fitSize(size.width, size.height, PREVIEW_SIDE);
    previewCanvas = drawScaled(canvas, small.width, small.height);
    releaseCanvas(canvas);
    canvas = null;
    const preview = await toJpeg(previewCanvas, PREVIEW_QUALITY);
    return { blob, preview, width: size.width, height: size.height };
  } catch (err) {
    throw err instanceof PhotoError ? err : unreadable(file);
  } finally {
    releaseCanvas(canvas);
    releaseCanvas(previewCanvas);
  }
}
