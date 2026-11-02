/**
 * Login (one person, e-mail + password): encryption of public/admin/auth.json.
 *
 * auth.json is published with the site, so the GitHub token inside it is encrypted with a key
 * derived from the e-mail AND the password. The e-mail itself is not stored in the file.
 *
 *   {"v":2,"owner":"…","repo":"…","branch":"main","kdf":"PBKDF2-SHA256","iterations":600000,
 *    "salt":"<base64 16 bytes>","iv":"<base64 12 bytes>","ciphertext":"<base64 AES-256-GCM, 16-byte tag appended>"}
 *
 *   key       = PBKDF2-SHA256(UTF-8 of email.trim().toLowerCase() + "\n" + password, salt, iterations) → AES-256-GCM
 *   plaintext = UTF-8 JSON {"token":"<GitHub token>"}
 *
 * A wrong e-mail and a wrong password give the same error: the AES-GCM tag check fails in both
 * cases, so nobody can tell which of the two was wrong.
 *
 * Same format as the Chère Pochette admin. scripts/admin-setup.mjs writes it with node:crypto and
 * the setup page (setup/) with this module; tests check both directions. Uses only
 * globalThis.crypto.subtle (WebCrypto), so this file also runs in Node 22.
 */

export const AUTH_VERSION = 2;
export const AUTH_KDF = 'PBKDF2-SHA256';
export const DEFAULT_ITERATIONS = 600000;
export const WRONG_CREDENTIALS_MESSAGE = 'E-mail o password non corretti';

/** Thrown by decryptAuth when e-mail and password do not open auth.json. */
export class WrongCredentialsError extends Error {
  constructor() {
    super(WRONG_CREDENTIALS_MESSAGE);
    this.name = 'WrongCredentialsError';
    this.code = 'BAD_CREDENTIALS';
  }
}

/** " Tiziana@Example.CH " → "tiziana@example.ch" (phones capitalise the first letter). */
export function normalizeEmail(email) {
  return String(email ?? '').trim().toLowerCase();
}

/** The secret the key is derived from: normalized e-mail, a line feed, the password as typed. */
export function keyMaterial(email, password) {
  return `${normalizeEmail(email)}\n${String(password ?? '')}`;
}

/* ---------- base64 (also used to upload photos to GitHub) ---------- */

/** Uint8Array → base64 (chunked, so big photos do not overflow the call stack). */
export function bytesToBase64(bytes) {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

/** base64 → Uint8Array. */
export function base64ToBytes(base64) {
  const binary = atob(String(base64).trim());
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/* ---------- key derivation ---------- */

function subtle() {
  const s = globalThis.crypto && globalThis.crypto.subtle;
  if (!s) throw new Error('Questo browser non supporta la crittografia: apri la pagina in Safari o Chrome aggiornati.');
  return s;
}

async function deriveKey(email, password, salt, iterations, usages) {
  const baseKey = await subtle().importKey(
    'raw',
    new TextEncoder().encode(keyMaterial(email, password)),
    'PBKDF2',
    false,
    ['deriveKey'],
  );
  return subtle().deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    usages,
  );
}

/* ---------- public API ---------- */

/**
 * Builds the content of auth.json (keys in the documented order).
 * @param {{token: string}} payload  what to protect
 * @param {string} email             not stored
 * @param {string} password
 * @param {{owner?: string, repo?: string, branch?: string, iterations?: number}} [meta]
 */
export async function encryptAuth(payload, email, password, meta = {}) {
  if (!payload || typeof payload.token !== 'string' || !payload.token) throw new Error('encryptAuth: token mancante');
  if (!normalizeEmail(email)) throw new Error('encryptAuth: e-mail mancante');
  if (!password) throw new Error('encryptAuth: password mancante');
  const iterations = meta.iterations || DEFAULT_ITERATIONS;
  const salt = globalThis.crypto.getRandomValues(new Uint8Array(16));
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(email, password, salt, iterations, ['encrypt']);
  const plaintext = new TextEncoder().encode(JSON.stringify({ token: payload.token }));
  const ciphertext = new Uint8Array(await subtle().encrypt({ name: 'AES-GCM', iv }, key, plaintext));
  return {
    v: AUTH_VERSION,
    owner: meta.owner || '',
    repo: meta.repo || '',
    branch: meta.branch || 'main',
    kdf: AUTH_KDF,
    iterations,
    salt: bytesToBase64(salt),
    iv: bytesToBase64(iv),
    ciphertext: bytesToBase64(ciphertext),
  };
}

/** True when `json` looks like an auth.json this page can open (format v2). */
export function isAuthConfig(json) {
  return Boolean(
    json && json.v === AUTH_VERSION && json.kdf === AUTH_KDF && json.owner && json.repo &&
      Number(json.iterations) > 0 && json.salt && json.iv && json.ciphertext,
  );
}

/**
 * Opens auth.json with e-mail and password.
 * @returns {Promise<{owner: string, repo: string, branch: string, token: string}>}
 * @throws {WrongCredentialsError} for a wrong e-mail or password
 */
export async function decryptAuth(authJson, email, password) {
  const a = authJson || {};
  if (!isAuthConfig(a)) {
    throw new Error('Il file di accesso dell’admin non è valido: chiedi a Martino di rifare la configurazione.');
  }
  if (!normalizeEmail(email) || !password) throw new WrongCredentialsError();
  const key = await deriveKey(email, password, base64ToBytes(a.salt), Number(a.iterations), ['decrypt']);
  let plaintext;
  try {
    plaintext = await subtle().decrypt({ name: 'AES-GCM', iv: base64ToBytes(a.iv) }, key, base64ToBytes(a.ciphertext));
  } catch {
    // AES-GCM authentication failed: wrong e-mail or password (or a damaged file).
    throw new WrongCredentialsError();
  }
  let payload = null;
  try {
    payload = JSON.parse(new TextDecoder().decode(plaintext));
  } catch {
    /* handled below */
  }
  if (!payload || typeof payload.token !== 'string' || !payload.token) {
    throw new Error('Il file di accesso dell’admin è danneggiato: chiedi a Martino di rifare la configurazione.');
  }
  return { owner: a.owner, repo: a.repo, branch: a.branch || 'main', token: payload.token };
}
