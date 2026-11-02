// The admin's data layer (public/admin/js/store.js) against the mock GitHub API
// (scripts/dev/mock-github.mjs) seeded with this working tree's src/content: every action is ONE
// commit and leaves files that follow CONTRACTS.md section 4.
import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createMockGitHub, readFilesFrom } from '../dev/mock-github.mjs';
import { Store, runState } from '../../public/admin/js/store.js';
import { resolveEnv } from '../../public/admin/js/env.js';
import { validateOpera, validateProfilo, serializeOpera, IMAGE_FILE_RE, OPERA_KEYS } from '../../public/admin/js/model.js';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const SEED = await readFilesFrom(ROOT, ['src/content', 'src/data']);
const TOKEN = 'test-token';
const OPERE = 'src/content/opere';
const NOW = new Date('2026-11-02T10:00:00.000Z');

const env = resolveEnv({ origin: 'http://localhost:4330', hostname: 'localhost', pathname: '/admin/index.html', search: '?api=http://localhost:8787' });

const jpeg = (n) => new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xe0, n, n, n, 0xff, 0xd9])], { type: 'image/jpeg' });
const upload = (n) => ({ upload: { blob: jpeg(n), preview: jpeg(n + 100), width: 2400, height: 1800 } });

const fields = (over = {}) => ({
  titolo: 'Nuova opera', anno: 2026, larghezza: 80.5, altezza: 100, tecnica: 'Olio su tela', collezione: '',
  testo: 'Primo.\n\nSecondo.', inEvidenza: false, pubblicata: true, ...over,
});

let mock;
let store;

function makeStore() {
  return new Store({ owner: 'MartinoTschudi', repo: 'tiz-art', branch: 'main', token: TOKEN }, env, {
    fetchImpl: mock.fetch,
    cache: null,
    fetchIndex: async () => null,
    now: () => NOW,
    retryDelay: 0,
  });
}

/** Folder contents at head: Map(name → blob) for one artwork. */
function folder(slug) {
  const out = new Map();
  for (const [p] of mock.files()) if (p.startsWith(`${OPERE}/${slug}/`)) out.set(p.slice(OPERE.length + slug.length + 2), mock.readBytes(p));
  return out;
}

/** Checks one artwork folder against section 4.1 and returns its parsed opera.json. */
function assertValidFolder(slug) {
  const files = folder(slug);
  const text = mock.read(`${OPERE}/${slug}/opera.json`);
  assert.ok(text, `${slug}/opera.json exists`);
  const data = JSON.parse(text);
  assert.deepEqual(validateOpera(data), [], slug);
  assert.equal(text, serializeOpera(data), 'key order, indentation, trailing newline');
  assert.deepEqual(Object.keys(data), OPERA_KEYS);
  const names = data.immagini.map((r) => r.slice(2));
  assert.deepEqual([...files.keys()].sort(), ['opera.json', ...names].sort(), 'exactly opera.json + the referenced images');
  return data;
}

beforeEach(() => {
  mock = createMockGitHub({ files: SEED, tokens: { [TOKEN]: { push: true, actions: true }, 'read-only': { push: false } } });
  store = makeStore();
});

describe('Store: reading', () => {
  test('loads the 12 migrated works sorted by ordine, and the profile', async () => {
    const data = await store.load();
    assert.equal(data.opere.length, 12);
    assert.deepEqual(data.problems, []);
    const ordini = data.opere.map((o) => o.data.ordine);
    assert.deepEqual(ordini, [...ordini].sort((a, b) => a - b));
    assert.equal(data.opere[0].slug, 'il-risveglio-di-madre-natura');
    assert.equal(data.profilo.motto, 'Dialogo tra testa e cuore.');
    assert.equal(data.head.commitSha, mock.head());
  });

  test('blobs are read once per SHA (cache) and the tree with one recursive request', async () => {
    await store.load();
    await store.load();
    const blobReads = mock.requests().filter((r) => r.includes('/git/blobs/'));
    assert.equal(blobReads.length, 13, '12 opera.json + profilo.json, only the first time');
    assert.ok(mock.requests().some((r) => r.includes('/git/trees/') && r.endsWith('?recursive=1')));
  });

  test('image sources: device preview, then the site thumbnail (exact path), then the raw file at the commit', async () => {
    store.fetchIndex = async () => ({ opere: { sorellanza: { immagini: { './01.jpg': '/_astro/01.abc.webp', './02.jpg': 'https://evil.example/x.webp' } } } });
    await store.load();
    const head = mock.head();
    assert.deepEqual(store.operaImageSources('sorellanza', './01.jpg'), [
      '/_astro/01.abc.webp',
      `http://localhost:8787/raw/${head}/src/content/opere/sorellanza/01.jpg`,
    ]);
    assert.deepEqual(store.operaImageSources('sorellanza', './02.jpg'), [`http://localhost:8787/raw/${head}/src/content/opere/sorellanza/02.jpg`], 'only same-site paths from the index');
    const res = await mock.fetch(store.operaImageSources('sorellanza', './01.jpg')[1]);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('content-type'), 'image/jpeg');
  });

  test('a broken opera.json is reported, it does not block the list', async () => {
    mock = createMockGitHub({ files: { ...SEED, [`${OPERE}/rotta/opera.json`]: '{ non è json', [`${OPERE}/vuota/01.jpg`]: 'x' } });
    store = makeStore();
    const data = await store.load();
    assert.equal(data.opere.length, 12);
    assert.equal(data.problems.length, 2);
  });

  test('verify: a read-only key is refused at login', async () => {
    await store.verify();
    const ro = new Store({ owner: 'MartinoTschudi', repo: 'tiz-art', branch: 'main', token: 'read-only' }, env, { fetchImpl: mock.fetch, cache: null });
    await assert.rejects(() => ro.verify(), (err) => err.kind === 'forbidden');
  });
});

describe('Store: artworks', () => {
  test('create: unique slug, ordine = min − 10, photos NN-xxxxxx.jpg, one commit', async () => {
    const before = mock.log().length;
    const result = await store.saveOpera({ slug: null, fields: fields({ titolo: 'Sorellanza' }), photos: [upload(1), upload(2)] });
    assert.equal(result.action, 'create');
    assert.equal(result.slug, 'sorellanza-2');
    assert.equal(mock.log().length, before + 1);
    assert.equal(mock.log()[0].message, 'opera: aggiunta «Sorellanza»');
    const data = assertValidFolder('sorellanza-2');
    assert.equal(data.ordine, 0, 'min(10…120) − 10');
    assert.equal(data.creataIl, NOW.toISOString());
    assert.equal(data.aggiornataIl, NOW.toISOString());
    assert.equal(data.larghezza, 80.5);
    assert.match(data.immagini[0], /^\.\/01-[a-z0-9]{6}\.jpg$/);
    assert.match(data.immagini[1], /^\.\/02-[a-z0-9]{6}\.jpg$/);
    assert.deepEqual([...mock.readBytes(`${OPERE}/sorellanza-2/${data.immagini[1].slice(2)}`)], [...new Uint8Array(await jpeg(2).arrayBuffer())]);
    assert.ok(store.previews.has(`${OPERE}/sorellanza-2/${data.immagini[0].slice(2)}`), 'the photo just taken shows immediately');
    // the new work comes first in the list
    const list = await store.load();
    assert.equal(list.opere[0].slug, 'sorellanza-2');
    assert.ok(IMAGE_FILE_RE.test(data.immagini[0].slice(2)));
  });

  test('edit: title changes but the slug does not; cover change; removed photo file is deleted', async () => {
    const created = await store.saveOpera({ slug: null, fields: fields({ titolo: 'Prova' }), photos: [upload(1), upload(2)] });
    const [first, second] = created.opera.immagini.map((r) => r.slice(2));
    const before = mock.log().length;
    const result = await store.saveOpera({
      slug: 'prova',
      fields: fields({ titolo: 'Prova rinominata', inEvidenza: true }),
      photos: [{ file: second }], // second photo as cover, first removed
    });
    assert.equal(result.action, 'update');
    assert.equal(result.slug, 'prova');
    assert.equal(mock.log().length, before + 1);
    assert.equal(mock.log()[0].message, 'opera: modificata «Prova rinominata»');
    const data = assertValidFolder('prova');
    assert.deepEqual(data.immagini, [`./${second}`]);
    assert.equal(mock.read(`${OPERE}/prova/${first}`), null, 'the removed photo is gone');
    assert.equal(data.titolo, 'Prova rinominata');
    assert.equal(data.inEvidenza, true);
    assert.equal(data.ordine, created.opera.ordine, 'editing keeps the position');
    assert.equal(data.creataIl, created.opera.creataIl);
  });

  test('edit a migrated work: adding a photo keeps 01.jpg, file names never collide', async () => {
    await store.saveOpera({ slug: 'guardami', fields: fields({ titolo: 'Guardami!' }), photos: [{ file: '01.jpg' }, upload(5)] });
    const data = assertValidFolder('guardami');
    assert.equal(data.immagini[0], './01.jpg');
    assert.match(data.immagini[1], /^\.\/02-[a-z0-9]{6}\.jpg$/);
  });

  test('hide: pubblicata false is saved as a normal edit', async () => {
    await store.saveOpera({ slug: 'istinto', fields: fields({ titolo: 'Istinto', pubblicata: false }), photos: [{ file: '01.jpg' }] });
    assert.equal(assertValidFolder('istinto').pubblicata, false);
  });

  test('invalid data never reaches GitHub (validated before the commit)', async () => {
    const before = mock.log().length;
    await assert.rejects(() => store.saveOpera({ slug: null, fields: fields({ anno: 1700 }), photos: [upload(1)] }), /Non posso salvare/);
    await assert.rejects(() => store.saveOpera({ slug: null, fields: fields(), photos: [] }), /Non posso salvare/);
    await assert.rejects(() => store.saveOpera({ slug: 'sorellanza', fields: fields(), photos: [{ file: 'manca.jpg' }] }), /non esiste più/);
    await assert.rejects(() => store.saveOpera({ slug: 'non-esiste', fields: fields(), photos: [upload(1)] }), /non esiste più/);
    assert.equal(mock.log().length, before, 'no commit');
  });

  test('delete: the whole folder disappears in one commit', async () => {
    const before = mock.log().length;
    const result = await store.deleteOpera('estasi');
    assert.deepEqual(result, { action: 'delete', slug: 'estasi', titolo: 'Estasi' });
    assert.equal(mock.log().length, before + 1);
    assert.equal(mock.log()[0].message, 'opera: eliminata «Estasi»');
    assert.equal(folder('estasi').size, 0);
    // deleting again is harmless (no empty commit)
    await store.deleteOpera('estasi');
    assert.equal(mock.log().length, before + 1);
  });

  test('reorder: 10, 20, 30… in the given order, only changed files, one commit', async () => {
    const { opere } = await store.load();
    const slugs = opere.map((o) => o.slug);
    const wanted = [slugs[1], slugs[0], ...slugs.slice(2)];
    const before = mock.log().length;
    const shasBefore = new Map(mock.files());
    await store.reorder(wanted);
    assert.equal(mock.log().length, before + 1);
    assert.equal(mock.log()[0].message, 'opere: nuovo ordine');
    const after = await store.load();
    assert.deepEqual(after.opere.map((o) => o.slug), wanted);
    assert.deepEqual(after.opere.map((o) => o.data.ordine), wanted.map((_, i) => (i + 1) * 10));
    for (const slug of wanted) assertValidFolder(slug);
    // the migrated works already had 10…120 in this order: only the two swapped files changed
    const changed = [...mock.files()].filter(([p, sha]) => shasBefore.get(p) !== sha).map(([p]) => p);
    assert.deepEqual(changed.sort(), wanted.slice(0, 2).map((s) => `${OPERE}/${s}/opera.json`).sort());
    // same order again → nothing to commit
    await store.reorder(wanted);
    assert.equal(mock.log().length, before + 1);
  });

  test('the branch moved during a save (another device) → rebuilt on top, nothing lost', async () => {
    mock.raceNextPatch(2);
    const result = await store.saveOpera({ slug: null, fields: fields({ titolo: 'Concorrenza' }), photos: [upload(3)] });
    assert.equal(result.slug, 'concorrenza');
    const messages = mock.log().map((c) => c.message);
    assert.equal(messages[0], 'opera: aggiunta «Concorrenza»');
    assert.equal(messages.filter((m) => m === 'commit esterno').length, 2);
    assertValidFolder('concorrenza');
  });

  test('a work created on another device meanwhile: the slug stays unique', async () => {
    await store.load();
    const other = makeStore();
    await other.saveOpera({ slug: null, fields: fields({ titolo: 'Doppione' }), photos: [upload(1)] });
    const mine = await store.saveOpera({ slug: null, fields: fields({ titolo: 'Doppione' }), photos: [upload(2)] });
    assert.equal(mine.slug, 'doppione-2');
    assertValidFolder('doppione');
    assertValidFolder('doppione-2');
  });
});

describe('Store: profile and publishing', () => {
  test('portrait added, replaced (old file deleted), removed; motto and bio saved', async () => {
    const r1 = await store.saveProfilo({ motto: 'Nuovo motto', bio: 'Uno.\n\nDue.', ritratto: upload(7) });
    assert.equal(mock.log()[0].message, 'profilo: aggiornato');
    const p1 = JSON.parse(mock.read('src/content/profilo/profilo.json'));
    assert.deepEqual(validateProfilo(p1), []);
    assert.match(p1.ritratto, /^\.\/ritratto-[a-z0-9]{6}\.jpg$/);
    assert.deepEqual(r1.profilo, p1);
    const first = p1.ritratto.slice(2);
    assert.ok(mock.readBytes(`src/content/profilo/${first}`));

    await store.saveProfilo({ motto: 'Nuovo motto', bio: 'Uno.', ritratto: { file: first } });
    assert.equal(JSON.parse(mock.read('src/content/profilo/profilo.json')).ritratto, `./${first}`, 'kept');

    await store.saveProfilo({ motto: 'Nuovo motto', bio: 'Uno.', ritratto: upload(8) });
    const p3 = JSON.parse(mock.read('src/content/profilo/profilo.json'));
    assert.notEqual(p3.ritratto, p1.ritratto);
    assert.equal(mock.readBytes(`src/content/profilo/${first}`), null, 'the replaced portrait is deleted');

    await store.saveProfilo({ motto: '', bio: 'Uno.', ritratto: null });
    const p4 = JSON.parse(mock.read('src/content/profilo/profilo.json'));
    assert.equal(p4.ritratto, null);
    assert.deepEqual([...mock.files().keys()].filter((p) => p.startsWith('src/content/profilo/')), ['src/content/profilo/profilo.json']);
    assert.ok(mock.read('src/content/profilo/profilo.json').endsWith('"\n}\n'));
  });

  test('deploy status: running right after a commit, then online', async () => {
    const clock = { t: Date.parse('2026-11-02T10:00:00Z') };
    mock = createMockGitHub({ files: SEED, runDurationMs: 20000, now: () => clock.t });
    store = makeStore();
    assert.equal((await store.deployStatus()).state, 'online');
    await store.saveOpera({ slug: null, fields: fields(), photos: [upload(1)] });
    assert.equal((await store.deployStatus()).state, 'running');
    clock.t += 21000;
    const status = await store.deployStatus();
    assert.equal(status.state, 'online');
    assert.match(status.url, /^https:\/\/github\.com\//);
  });

  test('runState maps the GitHub run to the three lines of the list', () => {
    assert.equal(runState({ status: 'queued' }), 'running');
    assert.equal(runState({ status: 'in_progress' }), 'running');
    assert.equal(runState({ status: 'completed', conclusion: 'success' }), 'online');
    assert.equal(runState({ status: 'completed', conclusion: 'failure' }), 'error');
    assert.equal(runState({ status: 'completed', conclusion: 'cancelled' }), null);
    assert.equal(runState(null), null);
  });
});
