/**
 * Photos being edited in a form (artwork or portrait): the ones already online and the new ones
 * prepared on the phone. Shared by the artwork form and the profile screen.
 *
 * A photo is { key, kind: 'existing', ref, file }  (already in the repository)
 *          or { key, kind: 'new', status: 'processing'|'ready'|'error', file?, result?, previewUrl?, error? }.
 *
 * `result` = { blob, preview, width, height, id }: `id` is the random part of the photo's future file
 * name ("03-<id>.jpg"), chosen once and kept with the draft, so a save repeated after a lost answer
 * is recognised (store.js) instead of creating the work twice.
 *
 * «Raddrizza» (makeStraightened + useStraightened) replaces the picture in `result` with the flat
 * picture of the canvas; the file name's `id` stays. `result` then also holds, and the draft keeps:
 *   whole     { blob, preview, width, height }: the photo as it was, so she can move the corners
 *             again or go back to it («Torna alla foto originale»), also after a reload
 *   corners   the four points she last placed, as fractions of the whole photo's sides
 *   focal35   the focal length the phone wrote in the picked file, if any (see straighten.js)
 * While the form is open a new photo also keeps `original`, the file she picked (a handle, not its
 * megabytes): the flat picture is then made from all of its pixels, not from the 2400 px copy.
 */
import { preparePhoto, photoFocal35, straightenPhoto } from './images.js';
import { imageRefName } from './model.js';
import { randomId } from './util.js';

let keySeq = 0;
const newKey = () => `foto-${++keySeq}`;

/** One photo at a time: resizing several 12-megapixel photos at once would exhaust the phone's memory. */
let queue = Promise.resolve();

export function existingPhoto(ref) {
  return { key: newKey(), kind: 'existing', ref, file: imageRefName(ref) };
}

/** A photo prepared earlier (restored from the draft). */
export function readyPhoto(result) {
  if (!result.id) result.id = randomId(6); // drafts saved before ids existed
  if (result.whole && !(result.whole.blob && result.whole.preview)) {
    // a damaged draft: a plain photo, and the points (placed on the lost whole photo) mean nothing on it
    delete result.whole;
    delete result.corners;
  }
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
      const focal35 = await photoFocal35(photo.file);
      photo.result = { ...(await preparePhoto(photo.file)), id: randomId(6), focal35 };
      if (!photo.removed) {
        photo.previewUrl = URL.createObjectURL(photo.result.preview);
        photo.original = photo.file; // a handle to the file on the phone, not its 10+ MB
      }
      photo.status = 'ready';
    } catch (err) {
      photo.status = 'error';
      photo.error = err.message || 'Non riesco a leggere questa foto.';
    }
    photo.file = null;
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
  photo.original = null;
}

/* ---------- «Raddrizza» ---------- */

/** Can this photo be straightened? Only a new one that is ready (not one already online). */
export function canStraighten(photo) {
  return photo.kind === 'new' && photo.status === 'ready' && !photo.removed;
}

/** The photo as it was before «Raddrizza» (the prepared picture itself when it was never straightened). */
function wholeOf(photo) {
  const { blob, preview, width, height } = photo.result.whole || photo.result;
  return { blob, preview, width, height };
}

/** What the «Raddrizza» screen shows: the whole photo and the points she placed last time, if any. */
export function straightenView(photo) {
  return { blob: wholeOf(photo).blob, corners: photo.result.corners || null };
}

/** Swaps a photo's prepared picture (and its preview on the screen) for another one. */
function setResult(photo, result) {
  if (photo.previewUrl) URL.revokeObjectURL(photo.previewUrl);
  photo.result = result;
  photo.previewUrl = URL.createObjectURL(result.preview);
}

/**
 * The flat picture of the canvas marked by `corners` (fractions of the whole photo's sides), without
 * touching the photo yet: she looks at it first. Made from the file she picked while it is at hand;
 * if the phone cannot do that (memory), from the prepared copy. Waits for its turn like the
 * preparation of a new photo. Resolves null when the photo was removed meanwhile.
 * @param {{larghezza: number, altezza: number}|null} [measures]  the canvas' size in cm, if she wrote it
 * @returns {Promise<{blob: Blob, preview: Blob, width: number, height: number, shape: 'measures'|'photo'}|null>}
 * @throws {PhotoError} with a message for her
 */
export function makeStraightened(photo, corners, measures = null) {
  const run = queue.then(async () => {
    if (!canStraighten(photo)) return null;
    const whole = wholeOf(photo);
    const known = { focal35: photo.result.focal35 ?? null, measures, expect: { width: whole.width, height: whole.height } };
    let made;
    try {
      made = await straightenPhoto(photo.original || whole.blob, corners, known);
    } catch (err) {
      if (!photo.original) throw err;
      made = await straightenPhoto(whole.blob, corners, known);
    }
    return photo.removed ? null : made;
  });
  queue = run.catch(() => {});
  return run;
}

/** She keeps the flat picture: it replaces the photo (same file name id, so a repeated save is still recognised). */
export function useStraightened(photo, made, corners) {
  if (!canStraighten(photo) || !made) return;
  const { id, focal35 = null } = photo.result;
  setResult(photo, { blob: made.blob, preview: made.preview, width: made.width, height: made.height, id, focal35, whole: wholeOf(photo), corners });
}

/** Keeps the points she placed although she did not straighten (yet): the screen shows them again. */
export function rememberCorners(photo, corners) {
  if (canStraighten(photo)) photo.result.corners = corners;
}

/** Is this photo straightened (so there is a whole photo to go back to)? */
export function isStraightened(photo) {
  return canStraighten(photo) && Boolean(photo.result.whole);
}

/** «Torna alla foto originale»: the photo as it was before «Raddrizza»; her points are kept for another try. */
export function restoreWhole(photo) {
  if (!isStraightened(photo)) return;
  const { id, focal35 = null, corners } = photo.result;
  setResult(photo, { ...wholeOf(photo), id, focal35, corners });
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
