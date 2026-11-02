/** Small generic helpers (no DOM, no network). */

/** Waits `ms` milliseconds. */
export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Runs `fn` on every item with at most `limit` calls in flight; keeps the order of results.
 * Used to read many small files without flooding the phone's connection or GitHub.
 */
export async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  }
  const workers = [];
  for (let w = 0; w < Math.min(limit, items.length); w++) workers.push(worker());
  await Promise.all(workers);
  return results;
}

const ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';

/** `length` crypto-random characters from [a-z0-9] (used in file names). */
export function randomId(length = 6) {
  let out = '';
  while (out.length < length) {
    for (const byte of globalThis.crypto.getRandomValues(new Uint8Array(length * 2))) {
      // 252 = 7 × 36: rejecting the top bytes keeps every character equally likely
      if (byte < 252 && out.length < length) out += ALPHABET[byte % 36];
    }
  }
  return out;
}
