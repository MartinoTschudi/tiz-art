// The admin's data layer (public/admin/js/store.js) against the mock GitHub API
// (scripts/dev/mock-github.mjs): every action is ONE commit and leaves files that follow CONTRACTS.md
// section 4, and repeating a save (lost answer, «Riprova», reopened draft) never does harm.
//
// The mock is seeded from the committed fixture scripts/test/fixtures/repo/, NOT from the live
// src/content: Tiziana's admin changes that content every day, and Deploy runs these tests before
// every build. Expected values are derived from the fixture, so editing it keeps the tests valid.
import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createMockGitHub, readFilesFrom } from '../dev/mock-github.mjs';
import { Store, runState, withSaved, withOrder, CHANGED_MEANWHILE_OPERA, CHANGED_MEANWHILE_PROFILO } from '../../public/admin/js/store.js';
import { resolveEnv } from '../../public/admin/js/env.js';
import {
  validateOpera, validateProfilo, serializeOpera, compareOpere, parseOperaForm, IMAGE_FILE_RE, OPERA_KEYS,
} from '../../public/admin/js/model.js';
import { createDraft } from '../../public/admin/js/screens/form.js';

const FIXTURE = fileURLToPath(new URL('./fixtures/repo/', import.meta.url));
const SEED = await readFilesFrom(FIXTURE, ['src/content', 'src/data']);
const TOKEN = 'test-token';
const OPERE = 'src/content/opere';
const NOW = new Date('2026-11-02T10:00:00.000Z');

/** What the fixture contains, for the expected values: [{ slug, data }] sorted like the admin. */
const decoder = new TextDecoder();
const SEED_OPERE = Object.entries(SEED)
  .filter(([p]) => p.startsWith(`${OPERE}/`) && p.endsWith('/opera.json'))
  .map(([p, bytes]) => ({ slug: p.slice(OPERE.length + 1, -'/opera.json'.length), data: JSON.parse(decoder.decode(bytes)) }))
  .sort(compareOpere);
const SEED_PROFILO = JSON.parse(decoder.decode(SEED['src/content/profilo/profilo.json']));
const seedWork = (slug) => SEED_OPERE.find((o) => o.slug === slug);
// The fixture's work saved by an older admin, before `colore` existed (see fixtures/README.md).
const LEGACY = 'guardami';

const env = resolveEnv({ origin: 'http://localhost:4330', hostname: 'localhost', pathname: '/admin/index.html', search: '?api=http://localhost:8787' });

const jpeg = (n) => new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xe0, n, n, n, 0xff, 0xd9])], { type: 'image/jpeg' });
const upload = (n) => ({ upload: { blob: jpeg(n), preview: jpeg(n + 100), width: 2400, height: 1800 } });

const fields = (over = {}) => ({
  titolo: 'Nuova opera', anno: 2026, larghezza: 80.5, altezza: 100, tecnica: 'Olio su tela', collezione: '',
  colore: null, testo: 'Primo.\n\nSecondo.', inEvidenza: false, pubblicata: true, ...over,
});

/** What «Salva» sends for a work opened in the form and saved without touching anything. */
function unchangedSave(opera) {
  const draft = createDraft(opera);
  return { slug: opera.slug, fields: parseOperaForm(draft.fields).fields, photos: opera.data.immagini.map((r) => ({ file: r.slice(2) })), base: opera.data.aggiornataIl };
}

let mock;
let store;

function makeStore(fetchImpl = mock.fetch, now = () => NOW) {
  return new Store({ owner: 'MartinoTschudi', repo: 'tiz-art', branch: 'main', token: TOKEN }, env, {
    fetchImpl,
    cache: null,
    fetchIndex: async () => null,
    now,
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
  test('the fixture has the works these tests use', () => {
    assert.ok(SEED_OPERE.length >= 4);
    for (const slug of ['sorellanza', 'guardami', 'istinto', 'estasi']) assert.ok(seedWork(slug), slug);
    assert.ok(SEED[`${OPERE}/sorellanza/02.jpg`], 'sorellanza has two photos');
  });

  test('loads every work sorted by ordine, and the profile', async () => {
    const data = await store.load();
    assert.equal(data.opere.length, SEED_OPERE.length);
    assert.deepEqual(data.problems, []);
    const ordini = data.opere.map((o) => o.data.ordine);
    assert.deepEqual(ordini, [...ordini].sort((a, b) => a - b));
    assert.deepEqual(data.opere.map((o) => o.slug), SEED_OPERE.map((o) => o.slug));
    assert.equal(data.profilo.motto, SEED_PROFILO.motto);
    assert.equal(data.head.commitSha, mock.head());
  });

  test('blobs are read once per SHA (cache) and the tree with one recursive request', async () => {
    await store.load();
    await store.load();
    const blobReads = mock.requests().filter((r) => r.includes('/git/blobs/'));
    assert.equal(blobReads.length, SEED_OPERE.length + 1, 'every opera.json + profilo.json, only the first time');
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

  test('a file saved before «colore» existed reads as colore null, without a problem, and is marked outdated', async () => {
    assert.ok(!('colore' in seedWork(LEGACY).data), 'the fixture keeps one work without the key');
    const data = await store.load();
    assert.deepEqual(data.problems, []);
    const legacy = data.opere.find((o) => o.slug === LEGACY);
    assert.equal(legacy.data.colore, null);
    assert.deepEqual(validateOpera(legacy.data), []);
    assert.equal(legacy.outdated, true, '«Salva» rewrites it even without a change');
    for (const o of data.opere.filter((x) => x.slug !== LEGACY)) {
      assert.equal(o.outdated, false, o.slug);
      assert.equal(o.data.colore, seedWork(o.slug).data.colore, o.slug);
    }
  });

  test('a broken opera.json is reported, it does not block the list', async () => {
    mock = createMockGitHub({ files: { ...SEED, [`${OPERE}/rotta/opera.json`]: '{ non è json', [`${OPERE}/vuota/01.jpg`]: 'x' } });
    store = makeStore();
    const data = await store.load();
    assert.equal(data.opere.length, SEED_OPERE.length);
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
    assert.equal(result.commitSha, mock.head());
    assert.equal(mock.log().length, before + 1);
    assert.equal(mock.log()[0].message, 'opera: aggiunta «Sorellanza»');
    const data = assertValidFolder('sorellanza-2');
    assert.equal(data.ordine, Math.min(...SEED_OPERE.map((o) => o.data.ordine)) - 10, 'min(ordine) − 10');
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

  test('colore: the choice of the form is written right after collezione; automatico is null', async () => {
    const created = await store.saveOpera({ slug: null, fields: fields({ titolo: 'Pennellata', colore: 'ottanio' }), photos: [upload(1)] });
    assert.equal(assertValidFolder(created.slug).colore, 'ottanio');
    assert.match(mock.read(`${OPERE}/${created.slug}/opera.json`), /\n {2}"collezione": "",\n {2}"colore": "ottanio",\n {2}"testo": /);
    const { opere } = await store.load();
    const sorellanza = opere.find((o) => o.slug === 'sorellanza');
    await store.saveOpera({ ...unchangedSave(sorellanza), fields: { ...unchangedSave(sorellanza).fields, colore: null } });
    assert.equal(assertValidFolder('sorellanza').colore, null);
  });

  test('a work without «colore» saved unchanged → rewritten once with colore null, nothing else changes', async () => {
    const { opere } = await store.load();
    const legacy = opere.find((o) => o.slug === LEGACY);
    const before = mock.log().length;
    const result = await store.saveOpera(unchangedSave(legacy));
    assert.equal(result.action, 'update');
    assert.equal(mock.log().length, before + 1);
    const data = assertValidFolder(LEGACY);
    assert.equal(data.colore, null);
    assert.deepEqual({ ...data, aggiornataIl: '' }, { ...legacy.data, aggiornataIl: '' }, 'only colore and the time are new');
    assert.equal(data.aggiornataIl, NOW.toISOString());
    const reloaded = (await store.load()).opere.find((o) => o.slug === LEGACY);
    assert.equal(reloaded.outdated, false, 'now in the admin’s format');
  });

  test('«Salva l’ordine» rewrites a work without «colore»: withOrder no longer marks it outdated', async () => {
    const before = await store.load();
    assert.equal(before.opere.find((o) => o.slug === LEGACY).outdated, true);
    const order = await store.reorder(before.opere.map((o) => o.slug).reverse());
    assert.notEqual(order.ordini[LEGACY], seedWork(LEGACY).data.ordine, 'the reorder rewrites the legacy work');
    const after = await store.load();
    assert.equal(after.opere.find((o) => o.slug === LEGACY).outdated, false);
    assert.match(mock.read(`${OPERE}/${LEGACY}/opera.json`), /\n {2}"colore": null,\n/);
    // What the admin shows right after the reorder is what the next load says (an unchanged «Salva» makes no commit).
    const view = (d) => d.opere.map((o) => [o.slug, o.data, o.outdated]);
    assert.deepEqual(view(withOrder(before, order.ordini)), view(after));
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
    assert.deepEqual(result, { action: 'delete', slug: 'estasi', titolo: seedWork('estasi').data.titolo });
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
    const result = await store.reorder(wanted);
    assert.equal(mock.log().length, before + 1);
    assert.equal(mock.log()[0].message, 'opere: nuovo ordine');
    assert.deepEqual(result.ordini, Object.fromEntries(wanted.map((s, i) => [s, (i + 1) * 10])), 'the new order, for the screen');
    const after = await store.load();
    assert.deepEqual(after.opere.map((o) => o.slug), wanted);
    assert.deepEqual(after.opere.map((o) => o.data.ordine), wanted.map((_, i) => (i + 1) * 10));
    for (const slug of wanted) assertValidFolder(slug);
    // only the works whose ordine really changed are written
    const expected = wanted.filter((s, i) => seedWork(s).data.ordine !== (i + 1) * 10).map((s) => `${OPERE}/${s}/opera.json`);
    const changed = [...mock.files()].filter(([p, sha]) => shasBefore.get(p) !== sha).map(([p]) => p);
    assert.deepEqual(changed.sort(), expected.sort());
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

/**
 * fetch that lets GitHub apply the next `patches` branch updates but loses their answer (like a
 * dropped mobile connection), and then fails `refReads` reads of the branch as well.
 */
function losingAnswers({ patches = 1, refReads = 0 } = {}) {
  return async (input, init) => {
    const req = new Request(input, init);
    const isRefRead = req.method === 'GET' && /\/git\/ref\/heads\//.test(req.url);
    if (isRefRead && refReads > 0 && patches === 0) {
      refReads -= 1;
      throw new TypeError('Load failed');
    }
    const res = await mock.handle(req);
    if (req.method === 'PATCH' && patches > 0) {
      patches -= 1;
      throw new TypeError('Load failed'); // the branch moved, the phone never hears it
    }
    return res;
  };
}

const folders = () => [...new Set([...mock.files().keys()].filter((p) => p.startsWith(`${OPERE}/`)).map((p) => p.split('/')[3]))];
const blobPosts = () => mock.requests().filter((r) => r === 'POST /repos/MartinoTschudi/tiz-art/git/blobs').length;

describe('Store: saving twice never does harm', () => {
  test('withSaved / withOrder: the loaded data shows a save at once, as the next load will', async () => {
    const loaded = await store.load();
    const opened = loaded.opere.find((o) => o.slug === 'sorellanza').data;
    const edit = await store.saveOpera({ slug: 'sorellanza', fields: fields({ titolo: 'Sorellanza (prima modifica)' }), photos: [{ file: '01.jpg' }], base: opened.aggiornataIl });
    const created = await store.saveOpera({ slug: null, fields: fields({ titolo: 'Nuova' }), photos: [upload(1)] });
    const deleted = await store.deleteOpera('estasi');
    const profilo = await store.saveProfilo({ motto: 'Motto nuovo', bio: '', ritratto: null, base: SEED_PROFILO.aggiornatoIl });
    let data = loaded;
    for (const result of [edit, created, deleted, profilo]) data = withSaved(data, result);
    const fresh = await store.load();
    const view = (d) => ({ opere: d.opere.map((o) => [o.slug, o.data, [...o.files].sort()]), profilo: d.profilo });
    assert.deepEqual(view(data), view(fresh));
    assert.equal(loaded.opere.length, SEED_OPERE.length, 'the old object is not changed');
    // the form opened again right away carries the base of the version just saved: no false conflict
    const reopened = data.opere.find((o) => o.slug === 'sorellanza').data;
    await store.saveOpera({ slug: 'sorellanza', fields: fields({ titolo: reopened.titolo, anno: 2019 }), photos: [{ file: '01.jpg' }], base: reopened.aggiornataIl });
    assert.equal(assertValidFolder('sorellanza').titolo, 'Sorellanza (prima modifica)', 'the first edit is not undone');

    const order = await store.reorder(fresh.opere.map((o) => o.slug).reverse());
    assert.deepEqual(view(withOrder(await store.load(), order.ordini)), view(await store.load()));
    assert.deepEqual(withOrder(fresh, order.ordini).opere.map((o) => o.slug), fresh.opere.map((o) => o.slug).reverse());
  });

  test('an edit opened before another save of the same work stops instead of undoing it', async () => {
    const opened = seedWork('sorellanza').data;
    const photos = opened.immagini.map((r) => ({ file: r.slice(2) }));
    // first save of the work (another device, or this phone while the list was not reloaded yet)
    const first = await makeStore().saveOpera({ slug: 'sorellanza', fields: fields({ titolo: 'Sorellanza (prima modifica)' }), photos, base: opened.aggiornataIl });
    const before = mock.log().length;
    await assert.rejects(
      () => store.saveOpera({ slug: 'sorellanza', fields: fields({ titolo: opened.titolo, anno: 2022 }), photos, base: opened.aggiornataIl }),
      (err) => err.kind === 'store' && err.message === CHANGED_MEANWHILE_OPERA,
    );
    assert.equal(mock.log().length, before, 'nothing written');
    assert.equal(JSON.parse(mock.read(`${OPERE}/sorellanza/opera.json`)).titolo, 'Sorellanza (prima modifica)', 'the first save is kept');
    // the admin opens the form again with the version just saved (applySaved): then it saves
    await store.saveOpera({ slug: 'sorellanza', fields: fields({ titolo: 'Sorellanza (prima modifica)', anno: 2022 }), photos, base: first.opera.aggiornataIl });
    assert.equal(assertValidFolder('sorellanza').anno, 2022);
  });

  test('a new order saved meanwhile is not a conflict (it keeps aggiornataIl)', async () => {
    const opened = seedWork('istinto').data;
    await makeStore().reorder(SEED_OPERE.map((o) => o.slug).reverse());
    const result = await store.saveOpera({ slug: 'istinto', fields: fields({ titolo: 'Istinto' }), photos: [{ file: '01.jpg' }], base: opened.aggiornataIl });
    assert.equal(result.action, 'update');
    assert.equal(assertValidFolder('istinto').ordine, (SEED_OPERE.length - SEED_OPERE.findIndex((o) => o.slug === 'istinto')) * 10, 'the new order is kept');
  });

  test('the answer of the branch update is lost but it was applied → success, one work, one commit', async () => {
    store = makeStore(losingAnswers({ patches: 1 }));
    const before = mock.log().length;
    const result = await store.saveOpera({ slug: null, fields: fields({ titolo: 'Mare d’inverno' }), photos: [upload(1)] });
    assert.equal(result.slug, 'mare-d-inverno');
    assert.equal(result.commitSha, mock.head());
    assert.equal(mock.log().length, before + 1);
    assert.deepEqual(folders().filter((f) => f.startsWith('mare')), ['mare-d-inverno']);
  });

  test('«Riprova» after a lost answer that could not be checked → no copy of the new work', async () => {
    store = makeStore(losingAnswers({ patches: 1, refReads: 2 }));
    const photos = [upload(1), upload(2)];
    const before = mock.log().length;
    await assert.rejects(() => store.saveOpera({ slug: null, fields: fields({ titolo: 'Mare d’inverno' }), photos }), (err) => err.kind === 'network');
    assert.equal(mock.log().length, before + 1, 'the first attempt did reach GitHub');
    const again = await store.saveOpera({ slug: null, fields: fields({ titolo: 'Mare d’inverno' }), photos });
    assert.equal(again.action, 'create');
    assert.equal(again.slug, 'mare-d-inverno');
    assert.equal(mock.log().length, before + 1, 'nothing written twice');
    assert.deepEqual(folders().filter((f) => f.startsWith('mare')), ['mare-d-inverno']);
    assertValidFolder('mare-d-inverno');
  });

  test('«Riprova» of an edit whose save already landed → recognised as done, nothing written twice', async () => {
    const opened = seedWork('guardami').data;
    const later = new Date(NOW.getTime() + 60000);
    store = makeStore(losingAnswers({ patches: 1, refReads: 2 }), () => later);
    const change = { slug: 'guardami', fields: fields({ titolo: opened.titolo, testo: 'Nuovo testo.' }), photos: [{ file: '01.jpg' }], base: opened.aggiornataIl };
    await assert.rejects(() => store.saveOpera(change), (err) => err.kind === 'network');
    const before = mock.log().length;
    const again = await store.saveOpera(change);
    assert.equal(again.action, 'update');
    assert.equal(mock.log().length, before, 'nothing written twice');
    assert.equal(assertValidFolder('guardami').testo, 'Nuovo testo.');
  });

  test('the page was closed after the save reached GitHub: the restored draft saves into the same folder', async () => {
    const photos = [upload(1), upload(2)];
    const first = await store.saveOpera({ slug: null, fields: fields({ titolo: 'Tramonto' }), photos });
    // next day: the draft comes back from IndexedDB (same photo ids, new Blob objects), a fresh session
    const restored = () => photos.map((p) => ({ upload: { ...p.upload, blob: new Blob([p.upload.blob]) } }));
    const before = mock.log().length;
    const same = await makeStore().saveOpera({ slug: null, fields: fields({ titolo: 'Tramonto' }), photos: restored() });
    assert.equal(same.slug, 'tramonto');
    assert.equal(mock.log().length, before, 'identical: nothing to write');
    // she also changed the title and put the second photo first before saving again
    const [a, b] = restored();
    const changed = await makeStore().saveOpera({ slug: null, fields: fields({ titolo: 'Tramonto rosso' }), photos: [b, a] });
    assert.equal(changed.slug, 'tramonto', 'same folder, no "tramonto-2"');
    assert.equal(mock.log()[0].message, 'opera: modificata «Tramonto rosso»');
    const data = assertValidFolder('tramonto');
    assert.deepEqual(data.immagini, [first.opera.immagini[1], first.opera.immagini[0]], 'the photos keep their names');
    assert.equal(data.creataIl, first.opera.creataIl);
    assert.deepEqual(folders().filter((f) => f.startsWith('tramonto')), ['tramonto']);
  });

  test('«Riprova» after a failure in the commit step does not upload the photos again', async () => {
    const photos = [upload(1), upload(2), upload(3)];
    mock.failNext({ match: '/git/refs/heads/', method: 'PATCH', status: 502 });
    const posts = blobPosts();
    await assert.rejects(() => store.saveOpera({ slug: null, fields: fields({ titolo: 'Tre foto' }), photos }), (err) => err.kind === 'server');
    assert.equal(blobPosts() - posts, 4, '3 photos + opera.json');
    const result = await store.saveOpera({ slug: null, fields: fields({ titolo: 'Tre foto' }), photos });
    assert.equal(blobPosts() - posts, 5, 'only opera.json again');
    assert.equal(result.slug, 'tre-foto');
    assertValidFolder('tre-foto');
  });

  test('profile: stale screen → stop; lost answer + «Riprova» with a new portrait → saved once', async () => {
    const opened = SEED_PROFILO.aggiornatoIl;
    await makeStore().saveProfilo({ motto: 'Da un altro telefono', bio: SEED_PROFILO.bio, ritratto: null, base: opened });
    await assert.rejects(() => store.saveProfilo({ motto: 'Vecchio', bio: '', ritratto: null, base: opened }), (err) => err.message === CHANGED_MEANWHILE_PROFILO);
    assert.equal(JSON.parse(mock.read('src/content/profilo/profilo.json')).motto, 'Da un altro telefono');

    const later = new Date(NOW.getTime() + 60000); // a minute later: every save has its own time
    store = makeStore(losingAnswers({ patches: 1, refReads: 2 }), () => later);
    const portrait = upload(9);
    const base = NOW.toISOString(); // what the screen showed: the save above
    await assert.rejects(() => store.saveProfilo({ motto: 'Nuovo', bio: 'Bio.', ritratto: portrait, base }), (err) => err.kind === 'network');
    const before = mock.log().length;
    const again = await store.saveProfilo({ motto: 'Nuovo', bio: 'Bio.', ritratto: portrait, base });
    assert.equal(mock.log().length, before, 'already saved: nothing written twice');
    assert.match(again.profilo.ritratto, /^\.\/ritratto-[a-z0-9]{6}\.jpg$/);
    assert.deepEqual([...mock.files().keys()].filter((p) => p.startsWith('src/content/profilo/')).sort(),
      ['src/content/profilo/profilo.json', `src/content/profilo/${again.profilo.ritratto.slice(2)}`].sort());
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
