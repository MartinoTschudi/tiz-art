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
 * A new photo of a work can be changed in two ways; `result` then holds the picture to upload and
 * also, kept in the draft:
 *   colori        «Colori più vivi» is on (the default for a photo of a work, see colours.js)
 *   straightened  «Raddrizza» made it a flat picture of the canvas, with `ratio` (width ÷ height)
 *   whole         { blob, preview, width, height }: the photo as prepared, neither straightened nor
 *                 livelier; there whenever the picture differs from it, so every change can be undone
 *                 without losing quality, also after a reload
 *   corners       the four points she last placed, as fractions of the whole photo's sides
 *   focal35       the focal length the phone wrote in the picked file, if any (see straighten.js)
 * The file name's `id` never changes. While the form is open a new photo also keeps `original`, the
 * file she picked (a handle, not its megabytes): a new picture is then made from all of its pixels,
 * not from the 2400 px copy. `busy` is set while a new picture is being made.
 */
import { preparePhoto, photoFocal35, straightenPhoto, PhotoError } from './images.js';
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
    // a damaged draft: the picture stays as it is, but there is nothing to go back to, and the points
    // (placed on the lost whole photo) mean nothing on it
    delete result.whole;
    delete result.corners;
    delete result.straightened;
    result.locked = true;
  }
  return { key: newKey(), kind: 'new', status: 'ready', result, previewUrl: URL.createObjectURL(result.preview) };
}

/**
 * Starts preparing a picked file. `onDone(photo)` runs when it is ready or failed.
 * `photo.ready` resolves in both cases. `colours`: «Colori più vivi» from the start (photos of a work).
 */
export function newPhoto(file, onDone, { colours = false } = {}) {
  const photo = { key: newKey(), kind: 'new', status: 'processing', file };
  photo.ready = queue.then(async () => {
    if (photo.removed) return;
    try {
      const focal35 = await photoFocal35(photo.file);
      const made = await preparePhoto(photo.file, { colours });
      const { blob, preview, width, height } = made;
      photo.result = { blob, preview, width, height, id: randomId(6), focal35, colori: made.colours };
      if (made.plain) photo.result.whole = { ...made.plain, width, height };
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

/* ---------- «Raddrizza» and «Colori più vivi» ---------- */

/** Can this photo be changed? Only a new one that is ready (not one already online). */
export function canStraighten(photo) {
  return photo.kind === 'new' && photo.status === 'ready' && !photo.removed;
}

/** The photo as prepared, neither straightened nor livelier. */
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

/** Runs `task(source)` with the file she picked, or with the prepared copy if that fails (memory) or is all there is. */
async function fromBestSource(photo, task) {
  const whole = wholeOf(photo).blob;
  if (!photo.original) return task(whole);
  try {
    return await task(photo.original);
  } catch {
    return task(whole);
  }
}

/** Runs `task` in the photo queue, with `photo.busy` set meanwhile. */
function queued(photo, task) {
  const run = queue.then(async () => {
    if (!canStraighten(photo)) return null;
    return task();
  });
  queue = run.catch(() => {});
  const busy = run.catch(() => {}).then(() => {
    if (photo.busy === busy) photo.busy = null;
  });
  photo.busy = busy;
  return run;
}

/**
 * The flat picture of the canvas marked by `corners` (fractions of the whole photo's sides), without
 * touching the photo yet: she looks at it first. Livelier when the photo is. Waits for its turn like
 * the preparation of a new photo. Resolves null when the photo was removed meanwhile.
 * @param {{larghezza: number, altezza: number}|null} [measures]  the canvas' size in cm, if she wrote it
 * @returns {Promise<{blob: Blob, preview: Blob, width: number, height: number, shape: string, ratio: number, colours: boolean}|null>}
 * @throws {PhotoError} with a message for her
 */
export function makeStraightened(photo, corners, measures = null) {
  return queued(photo, async () => {
    const whole = wholeOf(photo);
    const known = { focal35: photo.result.focal35 ?? null, measures, expect: { width: whole.width, height: whole.height }, colours: Boolean(photo.result.colori) };
    const made = await fromBestSource(photo, (source) => straightenPhoto(source, corners, known));
    return photo.removed ? null : made;
  });
}

/** She keeps the flat picture: it replaces the photo (same file name id, so a repeated save is still recognised). */
export function useStraightened(photo, made, corners) {
  if (!canStraighten(photo) || !made) return;
  const { id, focal35 = null } = photo.result;
  setResult(photo, {
    blob: made.blob, preview: made.preview, width: made.width, height: made.height, id, focal35,
    colori: Boolean(made.colours), straightened: true, ratio: made.ratio, whole: wholeOf(photo), corners,
  });
}

/** Keeps the points she placed although she did not straighten (yet): the screen shows them again. */
export function rememberCorners(photo, corners) {
  if (canStraighten(photo)) photo.result.corners = corners;
}

/** Is this photo straightened (so there is a whole photo to go back to)? */
export function isStraightened(photo) {
  return canStraighten(photo) && Boolean(photo.result.straightened);
}

/** Is «Colori più vivi» on for this photo? */
export function hasColours(photo) {
  return canStraighten(photo) && Boolean(photo.result.colori);
}

/** Can «Colori più vivi» be switched for this photo (a damaged draft has nothing to go back to)? */
export function canSwitchColours(photo) {
  return canStraighten(photo) && !photo.result.locked;
}

/**
 * Makes the picture for the photo as she wants it now (straightened or not, livelier or not) from
 * the whole photo, never from a picture made earlier, so nothing gets worse by switching back and forth.
 * @throws {PhotoError} with a message for her; the photo is then left as it was
 */
function remake(photo, { straightened, colori }) {
  return queued(photo, async () => {
    const whole = wholeOf(photo);
    const { id, focal35 = null, corners, ratio } = photo.result;
    let next;
    if (!straightened && !colori) {
      next = { ...whole, id, focal35, colori: false };
    } else if (!straightened) {
      const made = await fromBestSource(photo, (source) => preparePhoto(source, { colours: true }));
      if (!made.colours) throw new PhotoError('Il telefono non è riuscito a ravvivare i colori (memoria piena?). Chiudi altre app e riprova.');
      next = { blob: made.blob, preview: made.preview, width: made.width, height: made.height, id, focal35, colori: true, whole };
    } else {
      const known = { focal35, ratio, expect: { width: whole.width, height: whole.height }, colours: colori };
      const made = await fromBestSource(photo, (source) => straightenPhoto(source, corners, known));
      next = { blob: made.blob, preview: made.preview, width: made.width, height: made.height, id, focal35, colori: made.colours, straightened: true, ratio, whole };
    }
    if (corners) next.corners = corners;
    if (!photo.removed) setResult(photo, next);
    return next;
  });
}

/** «Togli il raddrizzamento»: the photo as it was before «Raddrizza», livelier if it was; her points are kept for another try. */
export async function restoreWhole(photo) {
  if (!isStraightened(photo)) return;
  await remake(photo, { straightened: false, colori: Boolean(photo.result.colori) });
}

/** Switches «Colori più vivi» on or off. */
export async function setColours(photo, on) {
  if (!canSwitchColours(photo) || Boolean(photo.result.colori) === Boolean(on)) return;
  await remake(photo, { straightened: Boolean(photo.result.straightened), colori: Boolean(on) });
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
  for (const p of photos) if (p.busy) await p.busy; // a picture being remade (e.g. «Colori più vivi»)
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
