/**
 * Photos being edited in a form (artwork or portrait): the ones already online and the new ones
 * prepared on the phone. Shared by the artwork form and the profile screen.
 *
 * A photo is { key, kind: 'existing', ref, file }  (already in the repository)
 *          or { key, kind: 'new', status: 'processing'|'ready'|'error', file?, result?, previewUrl?, error? }.
 */
import { preparePhoto } from './images.js';
import { imageRefName } from './model.js';

let keySeq = 0;
const newKey = () => `foto-${++keySeq}`;

/** One photo at a time: resizing several 12-megapixel photos at once would exhaust the phone's memory. */
let queue = Promise.resolve();

export function existingPhoto(ref) {
  return { key: newKey(), kind: 'existing', ref, file: imageRefName(ref) };
}

/** A photo prepared earlier (restored from the draft). */
export function readyPhoto(result) {
  return { key: newKey(), kind: 'new', status: 'ready', result, previewUrl: URL.createObjectURL(result.preview) };
}

/**
 * Starts preparing a picked file. `onDone(photo)` runs when it is ready or failed.
 * `photo.ready` resolves in both cases.
 */
export function newPhoto(file, onDone) {
  const photo = { key: newKey(), kind: 'new', status: 'processing', file };
  photo.ready = queue.then(async () => {
    if (photo.removed) return;
    try {
      photo.result = await preparePhoto(photo.file);
      if (!photo.removed) photo.previewUrl = URL.createObjectURL(photo.result.preview);
      photo.status = 'ready';
    } catch (err) {
      photo.status = 'error';
      photo.error = err.message || 'Non riesco a leggere questa foto.';
    }
    photo.file = null; // the original can be 10+ MB
    if (!photo.removed) onDone(photo);
  });
  queue = photo.ready.catch(() => {});
  return photo;
}

/** Frees a photo's preview; a photo still being prepared is skipped. */
export function releasePhoto(photo) {
  photo.removed = true;
  if (photo.previewUrl) URL.revokeObjectURL(photo.previewUrl);
  photo.previewUrl = null;
}

/** What the store needs: { file } for photos already online, { upload } for new ones. */
export function toSavePhoto(photo) {
  return photo.kind === 'existing' ? { file: photo.file } : { upload: photo.result };
}

/**
 * Waits until every new photo is prepared, calling `onCount(done, total)` meanwhile.
 * Resolves false when one could not be read.
 */
export async function photosReady(photos, onCount) {
  const pending = photos.filter((p) => p.kind === 'new');
  const done = () => pending.filter((p) => p.status !== 'processing').length;
  if (done() < pending.length) {
    onCount(done(), pending.length);
    for (const p of pending) {
      await p.ready;
      onCount(done(), pending.length);
    }
  }
  return !photos.some((p) => p.status === 'error');
}
