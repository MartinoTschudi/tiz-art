// auth.json compatibility: the file written by scripts/admin-setup.mjs (node:crypto) must open in
// the admin page (public/admin/js/crypto.js, WebCrypto) and vice versa — including files made by
// the setup page, which uses the browser module. If one side changes the format (iterations,
// salt/iv length, tag position, key material…) these tests fail.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import * as node from '../admin-setup.mjs';
import * as browser from '../../public/admin/js/crypto.js';

// Obviously fake (a value shaped like a real GitHub token would trip GitHub push protection).
const TOKEN = 'test-token-not-a-real-secret';
const EMAIL = 'tiziana@example.ch';
const META = { owner: 'MartinoTschudi', repo: 'tiz-art', branch: 'main' };
const KEYS = ['v', 'owner', 'repo', 'branch', 'kdf', 'iterations', 'salt', 'iv', 'ciphertext'];
const FAST = 1000; // iterations for the tests that do not check the default

/** What really happens: the object is written to auth.json and the page fetches + parses it. */
const viaFile = (auth) => JSON.parse(`${JSON.stringify(auth, null, 2)}\n`);

function assertFormat(auth) {
  assert.deepEqual(Object.keys(auth), KEYS);
  assert.equal(auth.v, 2);
  assert.equal(auth.kdf, 'PBKDF2-SHA256');
  assert.equal(Buffer.from(auth.salt, 'base64').length, 16);
  assert.equal(Buffer.from(auth.iv, 'base64').length, 12);
  assert.equal(Buffer.from(auth.ciphertext, 'base64').length, Buffer.byteLength(JSON.stringify({ token: TOKEN })) + 16);
  const text = JSON.stringify(auth);
  assert.ok(!text.includes(TOKEN), 'the token is never stored in clear');
  assert.ok(!text.toLowerCase().includes('tiziana'), 'the e-mail is not stored');
}

describe('auth.json v2: admin-setup.mjs (node:crypto) ⇄ admin page (WebCrypto)', () => {
  test('same constants and key material on both sides', () => {
    assert.equal(node.KDF, browser.AUTH_KDF);
    assert.equal(node.KDF_ITERATIONS, browser.DEFAULT_ITERATIONS);
    assert.equal(node.KDF_ITERATIONS, 600000);
    assert.equal(node.AUTH_VERSION, browser.AUTH_VERSION);
    const typed = ' Tiziana@Example.CH ';
    assert.equal(browser.keyMaterial(typed, 'pw x'), 'tiziana@example.ch\npw x');
    assert.equal(node.keyMaterial(typed, 'pw x'), browser.keyMaterial(typed, 'pw x'));
  });

  test('node encrypts → the browser decrypts (default 600 000 iterations)', async () => {
    const password = 'toravi-memuso-bilena-carepo';
    const auth = node.encryptAuth({ ...META, email: EMAIL, token: TOKEN, password });
    assertFormat(auth);
    assert.equal(auth.iterations, 600000);
    assert.deepEqual(await browser.decryptAuth(viaFile(auth), EMAIL, password), { ...META, token: TOKEN });
  });

  test('the browser encrypts (setup page) → node decrypts', async () => {
    const password = 'Pennelli e colori 2026!';
    const auth = await browser.encryptAuth({ token: TOKEN }, EMAIL, password, { ...META, iterations: FAST });
    assertFormat(auth);
    assert.deepEqual(node.decryptAuth(viaFile(auth), EMAIL, password), { token: TOKEN });
    assert.equal((await browser.decryptAuth(viaFile(auth), EMAIL, password)).token, TOKEN);
  });

  test('fixed salt and iv give byte-identical files on both sides', async () => {
    const salt = new Uint8Array(16).fill(7);
    const iv = new Uint8Array(12).fill(9);
    const fromNode = node.encryptAuth({ ...META, email: EMAIL, token: TOKEN, password: 'una-frase-lunga-sicura', iterations: FAST, salt, iv });
    // Recreate the browser ciphertext with the same salt/iv through raw WebCrypto.
    const { subtle } = globalThis.crypto;
    const base = await subtle.importKey('raw', new TextEncoder().encode(`${EMAIL}\nuna-frase-lunga-sicura`), 'PBKDF2', false, ['deriveKey']);
    const key = await subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: FAST }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt']);
    const ct = new Uint8Array(await subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(JSON.stringify({ token: TOKEN }))));
    assert.equal(fromNode.ciphertext, browser.bytesToBase64(ct));
  });

  test('the e-mail is case- and space-insensitive (phones capitalise the first letter)', async () => {
    const auth = node.encryptAuth({ ...META, email: EMAIL, token: TOKEN, password: 'una-frase-lunga-sicura', iterations: FAST });
    for (const typed of ['Tiziana@example.ch', ' TIZIANA@EXAMPLE.CH ', 'tiziana@example.ch\t']) {
      assert.equal((await browser.decryptAuth(viaFile(auth), typed, 'una-frase-lunga-sicura')).token, TOKEN, typed);
    }
  });

  test('non-ASCII passwords are encoded the same way (UTF-8, no normalisation)', async () => {
    const password = 'Pittura è vita – Ünïcode ✓ 🎨';
    const fromNode = node.encryptAuth({ ...META, email: EMAIL, token: TOKEN, password, iterations: FAST });
    assert.equal((await browser.decryptAuth(viaFile(fromNode), EMAIL, password)).token, TOKEN);
    const fromBrowser = await browser.encryptAuth({ token: TOKEN }, EMAIL, password, { ...META, iterations: FAST });
    assert.equal(node.decryptAuth(viaFile(fromBrowser), EMAIL, password).token, TOKEN);
  });

  test('wrong e-mail OR wrong password → the same message "E-mail o password non corretti"', async () => {
    const auth = node.encryptAuth({ ...META, email: EMAIL, token: TOKEN, password: 'the-right-passphrase', iterations: FAST });
    const cases = [
      ['qualcuno@example.ch', 'the-right-passphrase'],
      [EMAIL, 'the-wrong-passphrase'],
      [EMAIL, 'The-right-passphrase'], // the password IS case-sensitive
      [EMAIL, 'the-right-passphrase '], // and not trimmed
      ['', 'the-right-passphrase'],
      [EMAIL, ''],
    ];
    for (const [email, password] of cases) {
      await assert.rejects(() => browser.decryptAuth(viaFile(auth), email, password), (err) => {
        assert.ok(err instanceof browser.WrongCredentialsError);
        assert.equal(err.message, 'E-mail o password non corretti');
        assert.equal(err.code, 'BAD_CREDENTIALS');
        return true;
      }, `${email} / ${password}`);
    }
    assert.throws(() => node.decryptAuth(viaFile(auth), 'x@y.ch', 'the-right-passphrase'), /non corretti/);
  });

  test('a damaged file is rejected by the tag check; other versions are refused', async () => {
    const auth = node.encryptAuth({ ...META, email: EMAIL, token: TOKEN, password: 'the-right-passphrase', iterations: FAST });
    const bytes = Buffer.from(auth.ciphertext, 'base64');
    bytes[bytes.length - 1] ^= 1;
    await assert.rejects(() => browser.decryptAuth({ ...auth, ciphertext: bytes.toString('base64') }, EMAIL, 'the-right-passphrase'), browser.WrongCredentialsError);
    await assert.rejects(() => browser.decryptAuth({ ...auth, v: 1 }, EMAIL, 'the-right-passphrase'), /non è valido/);
    assert.equal(browser.isAuthConfig(auth), true);
    assert.equal(browser.isAuthConfig({ ...auth, v: 1 }), false);
    assert.equal(browser.isAuthConfig({ ...auth, owner: '' }), false);
    assert.equal(browser.isAuthConfig(null), false);
  });

  test('base64 helpers match Node (also for big photos)', () => {
    const big = Uint8Array.from({ length: 300_001 }, (_, i) => (i * 7 + (i >> 8)) % 256);
    assert.equal(browser.bytesToBase64(big), Buffer.from(big).toString('base64'));
    assert.deepEqual(browser.base64ToBytes(Buffer.from(big).toString('base64')), big);
  });
});
