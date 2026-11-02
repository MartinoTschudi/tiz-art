/**
 * Unsaved work kept in IndexedDB, so it survives a closed tab, a reload, the phone killing the page
 * while the camera is open, a back swipe, or an expired key:
 *   NEW_WORK      the "Nuova opera" being written
 *   workKey(slug) unsaved changes to an existing work
 *   PROFILE       unsaved changes to the profile
 *
 * Stored values: new work { fields: {…as typed}, photos: [{ blob, preview, width, height, id }], savedAt };
 * an edit also has `base` (the `aggiornataIl` / `aggiornatoIl` it started from) and keeps existing
 * photos as { ref }. Everything here is best effort: in private mode or when storage is full,
 * nothing is kept and the admin works as before.
 */

const DB_NAME = 'tiz-admin';
const DB_VERSION = 1;
const STORE = 'bozze';

export const NEW_WORK = 'nuova-opera';
export const PROFILE = 'profilo';
export const workKey = (slug) => `opera:${slug}`;

let dbPromise = null;

function openDb() {
  if (typeof indexedDB === 'undefined') return Promise.reject(new Error('IndexedDB non disponibile'));
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('IndexedDB bloccato'));
  }).catch((err) => {
    dbPromise = null; // allow a later retry
    throw err;
  });
  return dbPromise;
}

async function run(mode, action) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const req = action(tx.objectStore(STORE));
    tx.oncomplete = () => resolve(req.result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

/** The saved draft, or null. */
export async function loadDraft(key = NEW_WORK) {
  try {
    const value = await run('readonly', (s) => s.get(key));
    return value && value.fields ? value : null;
  } catch {
    return null;
  }
}

/** Saves (replaces) the draft. Returns false when the browser could not keep it. */
export async function saveDraft(value, key = NEW_WORK) {
  try {
    await run('readwrite', (s) => s.put({ ...value, savedAt: new Date().toISOString() }, key));
    return true;
  } catch {
    return false;
  }
}

export async function clearDraft(key = NEW_WORK) {
  try {
    await run('readwrite', (s) => s.delete(key));
  } catch {
    /* nothing stored */
  }
}

/** Forgets every draft of this device ("Esci"). */
export async function clearAllDrafts() {
  try {
    await run('readwrite', (s) => s.clear());
  } catch {
    /* nothing stored */
  }
}
