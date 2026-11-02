/**
 * The unsaved "Nuova opera" (fields + prepared photos) kept in IndexedDB, so it survives a closed
 * tab, a reload or the phone killing the page while the camera is open.
 *
 * Stored value: { fields: {…as typed}, photos: [{ blob, preview, width, height }], savedAt }.
 * Everything here is best effort: in private mode or when storage is full, nothing is kept and
 * the admin works as before.
 */

const DB_NAME = 'tiz-admin';
const DB_VERSION = 1;
const STORE = 'bozze';
const KEY = 'nuova-opera';

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
export async function loadDraft() {
  try {
    const value = await run('readonly', (s) => s.get(KEY));
    return value && value.fields ? value : null;
  } catch {
    return null;
  }
}

/** Saves (replaces) the draft. Returns false when the browser could not keep it. */
export async function saveDraft(value) {
  try {
    await run('readwrite', (s) => s.put({ ...value, savedAt: new Date().toISOString() }, KEY));
    return true;
  } catch {
    return false;
  }
}

export async function clearDraft() {
  try {
    await run('readwrite', (s) => s.delete(KEY));
  } catch {
    /* nothing stored */
  }
}
