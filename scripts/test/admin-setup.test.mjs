// Both ways to create public/admin/auth.json:
//  - scripts/admin-setup.mjs (terminal; writes the local file)
//  - the setup page's logic (public/admin/setup/configure.js; checks the token and commits the
//    file with that same token) — run here against the mock GitHub API.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Readable, Writable } from 'node:stream';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { encryptAuth, suggestPassphrase, verifyToken, runSetup, parseArgs, FALLBACK_REPOSITORY } from '../admin-setup.mjs';
import { isEmail, checkPassword, checkToken, suggestPassphrase as sharedPassphrase, suggestPasswordFor } from '../../public/admin/setup/rules.js';
import { configure, AUTH_PATH, COMMIT_MESSAGE } from '../../public/admin/setup/configure.js';
import * as browser from '../../public/admin/js/crypto.js';
import { createMockGitHub } from '../dev/mock-github.mjs';

// Obviously fake (a value shaped like a real GitHub token would trip GitHub push protection).
const TOKEN = 'test-token-not-a-real-secret';
const EMAIL = 'tiziana@example.ch';
const PASSWORD = 'toravi-memuso-bilena-carepo';
const SCRIPT = fileURLToPath(new URL('../admin-setup.mjs', import.meta.url));
const ENV = { ADMIN_OWNER: 'MartinoTschudi', ADMIN_REPO: 'tiz-art', ADMIN_BRANCH: 'main', ADMIN_EMAIL: EMAIL, ADMIN_PASSWORD: PASSWORD, ADMIN_TOKEN: TOKEN };

/** Collects what the script prints. */
function sink() {
  const chunks = [];
  const stream = new Writable({
    write(chunk, _enc, cb) {
      chunks.push(String(chunk));
      cb();
    },
  });
  stream.text = () => chunks.join('');
  return stream;
}

const mockWith = (tokens) => createMockGitHub({ files: { 'README.md': 'tiz-art\n' }, tokens });

describe('shared rules (setup page and terminal)', () => {
  test('e-mail, password and token checks', () => {
    assert.equal(isEmail(' Tiziana@Example.ch '), true);
    assert.equal(isEmail('tiziana'), false);
    assert.equal(isEmail('a b@c.ch'), false);
    assert.match(checkPassword('corta'), /almeno 12/);
    assert.match(checkPassword('aaaaaaaaaaaaaaa'), /ripetuto/);
    assert.match(checkPassword('password12345'), /facile/);
    assert.match(checkPassword('ciao-tiziana-2026', EMAIL), /e-mail/);
    assert.equal(checkPassword(PASSWORD, EMAIL), null);
    assert.equal(checkPassword('pennello tela colore luce', EMAIL), null);
    assert.equal(checkPassword('x7#Kp2!vQ9mZ&rL4', EMAIL), null, 'a long random string is fine too');
    assert.match(checkToken(''), /Incolla/);
    assert.match(checkToken('abc def'), /spazi/);
    assert.equal(checkToken(` ${TOKEN} `), null);
  });

  test('guessable passwords are refused (auth.json is public and can be attacked offline)', () => {
    const email = 'tiziana.belloli@example.ch';
    const refused = {
      Sorellanza2023: /tre parole/, // artwork title + year
      'Sorellanza2023Estasi': /tre parole/, // two titles + year
      belloli123456: /e-mail/, // a part of the e-mail
      Tschudi12345: /facile/, // her name
      MiaPassword2024: /facile/, // "password" anywhere, not only at the start
      'Mia-Password-2024': /facile/,
      abc123abc123: /ripete/,
      iloveyou1234: /tre parole/,
      sorellanza12: /tre parole/,
      'Tiz2024!Tiz2024': /tre parole/,
      abcdefghijkl: /tre parole/,
      Contemporaneamente: /tre parole/, // one long word
      '0987654321098765': /tre parole/, // long but only digits
      'la casa di mare': /tre parole/, // two real words of 3+ letters
    };
    for (const [pw, problem] of Object.entries(refused)) assert.match(checkPassword(pw, email) || '', problem, pw);
    assert.match(checkPassword('Tiziàna-tela-luce', 'x@example.ch'), /facile/, 'accents do not hide her name');
  });

  test('only fine-grained tokens: classic and OAuth tokens are refused', () => {
    for (const t of ['ghp_abcdef', 'gho_x', 'ghu_x', 'ghs_x', 'ghr_x']) assert.match(checkToken(t), /fine-grained/, t);
    for (const t of ['github_pat_11AAAAAAA_bbbb', TOKEN, 'dev-sola-lettura']) assert.equal(checkToken(t), null, t);
  });

  test('suggestPassphrase: 4 pronounceable words, different every time, shared by the page and the terminal', () => {
    assert.equal(suggestPassphrase, sharedPassphrase, 'one implementation (public/admin/setup/rules.js)');
    const p = suggestPassphrase();
    assert.match(p, /^([a-z]{6}-){3}[a-z]{6}$/);
    assert.notEqual(p, suggestPassphrase());
    assert.equal(checkPassword(p, EMAIL), null);
    for (let i = 0; i < 200; i++) assert.equal(checkPassword(suggestPasswordFor(EMAIL), EMAIL), null);
  });
});

describe('setup page logic (configure.js) against the mock API', () => {
  test('checks the token, encrypts, commits public/admin/auth.json with the same token', async () => {
    const mock = mockWith({ [TOKEN]: { push: true, actions: true } });
    const steps = [];
    const { commitSha, notes } = await configure({
      owner: 'MartinoTschudi', repo: 'tiz-art', branch: 'main', token: TOKEN, email: EMAIL, password: PASSWORD,
      apiBase: 'http://localhost:8787', iterations: 1000, fetchImpl: mock.fetch, onStep: (s) => steps.push(s),
    });
    assert.equal(commitSha, mock.head());
    assert.deepEqual(notes, []);
    assert.equal(steps.length, 3);
    assert.equal(mock.log()[0].message, COMMIT_MESSAGE);
    const text = mock.read(AUTH_PATH);
    assert.ok(text.endsWith('}\n') && !text.includes(TOKEN) && !text.includes(EMAIL));
    const opened = await browser.decryptAuth(JSON.parse(text), EMAIL, PASSWORD);
    assert.deepEqual(opened, { owner: 'MartinoTschudi', repo: 'tiz-art', branch: 'main', token: TOKEN });
    assert.ok(mock.requests().filter((r) => !r.startsWith('GET')).length >= 4, 'blob, tree, commit, ref');
  });

  test('refuses a read-only token, an unknown token and a missing branch — nothing committed', async () => {
    const mock = mockWith({ 'sola-lettura': { push: false } });
    const base = { owner: 'MartinoTschudi', repo: 'tiz-art', branch: 'main', email: EMAIL, password: PASSWORD, apiBase: 'http://x', iterations: 1000, fetchImpl: mock.fetch };
    await assert.rejects(() => configure({ ...base, token: 'sola-lettura' }), /può solo leggere/);
    await assert.rejects(() => configure({ ...base, token: 'sconosciuto' }), /non è valido o è scaduto/);
    const writer = mockWith({ [TOKEN]: { push: true } });
    await assert.rejects(() => configure({ ...base, fetchImpl: writer.fetch, token: TOKEN, branch: 'altro' }), /Non trovo MartinoTschudi\/tiz-art/);
    assert.equal(mock.log().length, 1);
    assert.equal(writer.log().length, 1);
  });

  test('a token without Actions access still works, with a note', async () => {
    const mock = mockWith({ [TOKEN]: { push: true, actions: false } });
    const { notes } = await configure({
      owner: 'MartinoTschudi', repo: 'tiz-art', branch: 'main', token: TOKEN, email: EMAIL, password: PASSWORD,
      apiBase: 'http://x', iterations: 1000, fetchImpl: mock.fetch,
    });
    assert.match(notes.join(), /Actions/);
    assert.ok(mock.read(AUTH_PATH));
  });
});

describe('admin-setup.mjs (terminal)', () => {
  test('verifyToken: push permission required; notes for Actions', async () => {
    const ok = mockWith({ [TOKEN]: { push: true, actions: false } });
    const r = await verifyToken({ owner: 'MartinoTschudi', repo: 'tiz-art', branch: 'main', token: TOKEN, api: 'http://mock', fetch: ok.fetch });
    assert.equal(r.ok, true);
    assert.match(r.notes.join(), /Actions/);
    const ro = await verifyToken({ owner: 'MartinoTschudi', repo: 'tiz-art', branch: 'main', token: 'ro', api: 'http://mock', fetch: mockWith({ ro: { push: false } }).fetch });
    assert.equal(ro.ok, false);
    assert.match(ro.problems.join(), /solo leggere/);
    const bad = await verifyToken({ owner: 'MartinoTschudi', repo: 'tiz-art', branch: 'main', token: 'x', api: 'http://mock', fetch: ok.fetch });
    assert.match(bad.problems.join(), /non è valido/);
    const offline = await verifyToken({ owner: 'o', repo: 'r', branch: 'main', token: 't', fetch: async () => { throw new TypeError('fetch failed'); } });
    assert.match(offline.problems.join(), /non riesco a raggiungere/);
  });

  test('env vars: checks the token, writes an auth.json the admin page opens; never prints secrets', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'tiz-admin-setup-'));
    try {
      const out = path.join(dir, 'auth.json');
      const output = sink();
      const mock = mockWith({ [TOKEN]: { push: true, actions: true } });
      const result = await runSetup({
        argv: ['--out', out, '--api', 'http://mock'], env: { ...ENV, ADMIN_EMAIL: ' Tiziana@Example.ch ' }, input: Readable.from([]), output, fetch: mock.fetch,
      });
      assert.equal(result.out, out);
      const file = await readFile(out, 'utf8');
      assert.ok(file.endsWith('}\n'));
      const auth = JSON.parse(file);
      assert.deepEqual(Object.keys(auth), ['v', 'owner', 'repo', 'branch', 'kdf', 'iterations', 'salt', 'iv', 'ciphertext']);
      assert.equal(auth.iterations, 600000);
      assert.deepEqual(await browser.decryptAuth(auth, EMAIL, PASSWORD), { owner: 'MartinoTschudi', repo: 'tiz-art', branch: 'main', token: TOKEN });
      const text = output.text();
      assert.ok(!text.includes(PASSWORD) && !text.includes(TOKEN), 'secrets are never printed');
      assert.match(text, /git add/);

      // existing file: refused without --force, overwritten with --force
      await assert.rejects(() => runSetup({ argv: ['--out', out, '--skip-verify'], env: ENV, input: Readable.from([]), output: sink() }), /non ho scritto niente/);
      await runSetup({ argv: ['--out', out, '--skip-verify', '--force'], env: { ...ENV, ADMIN_REPO: 'altro' }, input: Readable.from([]), output: sink() });
      assert.equal(JSON.parse(await readFile(out, 'utf8')).repo, 'altro');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('answers piped on stdin (Enter = default from sito.json, password twice)', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'tiz-admin-setup-'));
    try {
      const out = path.join(dir, 'auth.json');
      const answers = ['', '', '', EMAIL, PASSWORD, PASSWORD, TOKEN].map((l) => `${l}\n`);
      const output = sink();
      await runSetup({ argv: ['--out', out, '--skip-verify'], env: {}, input: Readable.from(answers), output, rootDir: dir });
      const auth = JSON.parse(await readFile(out, 'utf8'));
      assert.equal(auth.owner, FALLBACK_REPOSITORY.owner);
      assert.equal(auth.repo, FALLBACK_REPOSITORY.repo);
      assert.equal((await browser.decryptAuth(auth, EMAIL, PASSWORD)).token, TOKEN);
      assert.ok(!output.text().includes(PASSWORD));

      const out2 = path.join(dir, 'auth2.json');
      const differ = ['', '', '', EMAIL, PASSWORD, `${PASSWORD}x`, TOKEN].map((l) => `${l}\n`);
      await assert.rejects(() => runSetup({ argv: ['--out', out2, '--skip-verify'], env: {}, input: Readable.from(differ), output: sink(), rootDir: dir }), /non sono uguali/);
      await assert.rejects(() => runSetup({ argv: ['--out', out2, '--skip-verify'], env: { ...ENV, ADMIN_PASSWORD: 'corta' }, input: Readable.from([]), output: sink(), rootDir: dir }), /almeno 12/);
      await assert.rejects(() => readFile(out2), /ENOENT/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('defaults come from src/data/sito.json; options are parsed', async () => {
    assert.deepEqual(FALLBACK_REPOSITORY, { owner: 'MartinoTschudi', repo: 'tiz-art', branch: 'main' });
    const args = parseArgs(['--skip-verify', '--force', '--api', 'http://localhost:8787/']);
    assert.equal(args.skipVerify && args.force, true);
    assert.equal(args.api, 'http://localhost:8787');
    assert.throws(() => parseArgs(['--nope']), /sconosciuta/);
  });

  test('CLI: `node scripts/admin-setup.mjs` without a terminal, exit code 1 on errors', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'tiz-admin-cli-'));
    const run = (args, env) =>
      new Promise((resolve) => {
        const child = execFile(process.execPath, [SCRIPT, ...args], { env: { ...process.env, ...env }, timeout: 60000 }, (err, stdout, stderr) =>
          resolve({ code: err ? err.code : 0, stdout, stderr }));
        child.stdin.end();
      });
    try {
      const out = path.join(dir, 'auth.json');
      // owner / repo / branch not given: the defaults of src/data/sito.json are used
      const { ADMIN_OWNER, ADMIN_REPO, ADMIN_BRANCH, ...secretsOnly } = ENV;
      const ok = await run(['--skip-verify', '--out', out], { ADMIN_OWNER: '', ADMIN_REPO: '', ADMIN_BRANCH: '', ...secretsOnly });
      assert.equal(ok.code, 0, ok.stderr);
      assert.match(ok.stdout, /Scritto:/);
      const written = JSON.parse(await readFile(out, 'utf8'));
      assert.deepEqual([written.owner, written.repo, written.branch], [ADMIN_OWNER, ADMIN_REPO, ADMIN_BRANCH]);
      assert.equal((await browser.decryptAuth(written, EMAIL, PASSWORD)).token, TOKEN);
      const bad = await run(['--skip-verify', '--out', path.join(dir, 'x.json')], { ...ENV, ADMIN_PASSWORD: 'solo-11-car' });
      assert.equal(bad.code, 1);
      assert.match(bad.stderr, /Configurazione interrotta: ADMIN_PASSWORD: La password deve avere almeno 12/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('a fixed-salt file from the terminal matches the documented format', () => {
    const auth = encryptAuth({ owner: 'o', repo: 'r', email: EMAIL, password: PASSWORD, token: TOKEN, iterations: 1000, salt: Buffer.alloc(16, 1), iv: Buffer.alloc(12, 2) });
    assert.equal(auth.salt, Buffer.alloc(16, 1).toString('base64'));
    assert.equal(auth.iv, Buffer.alloc(12, 2).toString('base64'));
    assert.equal(auth.branch, 'main');
  });
});
