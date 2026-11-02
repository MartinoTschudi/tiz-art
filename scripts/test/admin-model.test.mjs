// Data rules of the admin (public/admin/js/model.js) against CONTRACTS.md section 4:
// slugs, parsing, validation, serialisation — and a round trip of the files of the test fixture.
// (The live src/content is NOT read here: the admin changes it every day and Deploy runs these tests;
// `npm run check:content` validates it, and only warns about formatting.)
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as m from '../../public/admin/js/model.js';

const FIXTURE = fileURLToPath(new URL('./fixtures/repo/', import.meta.url));

const valid = () => ({
  titolo: 'Sorellanza',
  anno: 2023,
  larghezza: 120,
  altezza: 150,
  tecnica: 'Acrilico su tela',
  collezione: 'noi, DONNA.',
  testo: 'Primo paragrafo.\n\nSecondo paragrafo.',
  immagini: ['./01.jpg', './02-k2x9qa.jpg'],
  ordine: 120,
  inEvidenza: true,
  pubblicata: true,
  creataIl: '2023-09-23T12:00:00.000Z',
  aggiornataIl: '2023-09-23T12:00:00.000Z',
});

describe('slugs', () => {
  test('examples of the contract and the migrated works', () => {
    assert.equal(m.slugify('Gioventù'), 'gioventu');
    assert.equal(m.slugify('…e fuori piove'), 'e-fuori-piove');
    assert.equal(m.slugify('Guardami!'), 'guardami');
    assert.equal(m.slugify('Il coraggio di guardare oltre'), 'il-coraggio-di-guardare-oltre');
    assert.equal(m.slugify('Donna Sapiens'), 'donna-sapiens');
  });

  test('accents, apostrophes, symbols, special letters, empty titles', () => {
    assert.equal(m.slugify('Perché così? Sì!'), 'perche-cosi-si');
    assert.equal(m.slugify('L’attesa'), 'l-attesa');
    assert.equal(m.slugify("Dall'alba al tramonto"), 'dall-alba-al-tramonto');
    assert.equal(m.slugify('Straße & Œuvre — Ø'), 'strasse-oeuvre-o');
    assert.equal(m.slugify('«noi, DONNA.»'), 'noi-donna');
    assert.equal(m.slugify('2024'), '2024');
    assert.equal(m.slugify('   '), 'opera');
    assert.equal(m.slugify('…'), 'opera');
  });

  test('at most 60 characters, cut at a word boundary, always valid', () => {
    const long = 'Una lunghissima opera con un titolo che non finisce mai e poi mai davvero';
    const slug = m.slugify(long);
    assert.ok(slug.length <= 60);
    assert.equal(slug, 'una-lunghissima-opera-con-un-titolo-che-non-finisce-mai-e');
    assert.ok(m.isValidSlug(slug));
    assert.equal(m.slugify('a'.repeat(80)), 'a'.repeat(60));
  });

  test('made unique with -2, -3… (still ≤ 60 characters)', () => {
    assert.equal(m.uniqueSlug('sorellanza', []), 'sorellanza');
    assert.equal(m.uniqueSlug('sorellanza', ['sorellanza']), 'sorellanza-2');
    assert.equal(m.uniqueSlug('sorellanza', new Set(['sorellanza', 'sorellanza-2'])), 'sorellanza-3');
    const sixty = m.slugify('parola '.repeat(12));
    const unique = m.uniqueSlug(sixty, [sixty]);
    assert.ok(unique.length <= 60 && unique.endsWith('-2') && m.isValidSlug(unique));
  });

  test('every generated slug matches the contract pattern', () => {
    for (const title of ['A–B', '-x-', 'Ünïcödé', 'tre  spazi', 'ÉTÉ 2024', '1/2']) {
      assert.ok(m.isValidSlug(m.slugify(title)), title);
    }
  });
});

describe('what she types', () => {
  test('sizes: "100", "100,5", "100.5", "100 cm"; at most one decimal; 0 < x ≤ 1000', () => {
    assert.deepEqual(m.parseMisura('100'), { value: 100 });
    assert.deepEqual(m.parseMisura('100,5'), { value: 100.5 });
    assert.deepEqual(m.parseMisura('100.5'), { value: 100.5 });
    assert.deepEqual(m.parseMisura(' 120 cm '), { value: 120 });
    assert.deepEqual(m.parseMisura(''), { value: null });
    assert.deepEqual(m.parseMisura('1000'), { value: 1000 });
    for (const bad of ['100,55', '0', '0,0', '1000,1', '12a', '-5', '1e3', '100,']) {
      assert.ok(m.parseMisura(bad).error, bad);
    }
  });

  test('year: empty or 4 digits between 1900 and 2100', () => {
    assert.deepEqual(m.parseAnno('2024'), { value: 2024 });
    assert.deepEqual(m.parseAnno(''), { value: null });
    for (const bad of ['24', '1899', '2101', '20 24', 'duemila']) assert.ok(m.parseAnno(bad).error, bad);
  });

  test('texts: line ends, blank lines and spaces are tidied', () => {
    assert.equal(m.cleanText('  Uno.  \r\n\r\n\r\n\r\nDue.\rTre.\t \n'), 'Uno.\n\nDue.\nTre.');
    assert.equal(m.cleanText('a\u0000b'), 'ab');
    assert.equal(m.cleanLine('  Acrilico \n su   tela '), 'Acrilico su tela');
  });

  test('parseOperaForm: clean fields or Italian errors per field', () => {
    const ok = m.parseOperaForm({
      titolo: '  Nuova  opera ', anno: '2025', larghezza: '80,5', altezza: '', tecnica: ' Olio ', collezione: '',
      testo: 'Testo\r\n', inEvidenza: 1, pubblicata: true,
    });
    assert.deepEqual(ok.fields, {
      titolo: 'Nuova opera', anno: 2025, larghezza: 80.5, altezza: null, tecnica: 'Olio', collezione: '',
      testo: 'Testo', inEvidenza: true, pubblicata: true,
    });
    const bad = m.parseOperaForm({ titolo: ' ', anno: '19', larghezza: 'x', altezza: '0', tecnica: '', collezione: '', testo: 'x'.repeat(5001) });
    assert.equal(bad.fields, null);
    assert.deepEqual(Object.keys(bad.errors).sort(), ['altezza', 'anno', 'larghezza', 'testo', 'titolo']);
    assert.match(bad.errors.titolo, /titolo/);
  });

  test('formatMisure: "100 × 140 cm", decimal comma, only when both are set', () => {
    assert.equal(m.formatMisure(100, 140), '100 × 140 cm');
    assert.equal(m.formatMisure(100.5, 70), '100,5 × 70 cm');
    assert.equal(m.formatMisure(100, null), '');
  });
});

describe('validation (section 4.1 / 4.2)', () => {
  test('a valid artwork passes', () => {
    assert.deepEqual(m.validateOpera(valid()), []);
    assert.deepEqual(m.validateOpera({ ...valid(), anno: null, larghezza: null, altezza: null, tecnica: '', collezione: '', testo: '' }), []);
  });

  test('every rule is enforced', () => {
    const cases = {
      titolo: ['', ' Spazio', 'x'.repeat(121), 3],
      anno: [1899, 2101, 2023.5, '2023'],
      larghezza: [0, -1, 1000.5, 12.34, '100', Infinity],
      tecnica: ['x'.repeat(121), null],
      collezione: ['x'.repeat(121)],
      testo: ['x'.repeat(5001)],
      immagini: [[], Array.from({ length: 9 }, (_, i) => `./0${i}.jpg`), ['01.jpg'], ['./sub/01.jpg'], ['./01.gif'], ['./Foto.JPG'], ['./01.jpg', './01.jpg']],
      ordine: [1.5, '10', null],
      inEvidenza: ['true', 1],
      pubblicata: [null],
      creataIl: ['2023-09-23', '2023-09-23T12:00:00+02:00', 'ieri'],
    };
    for (const [key, values] of Object.entries(cases)) {
      for (const v of values) assert.ok(m.validateOpera({ ...valid(), [key]: v }).length > 0, `${key} = ${JSON.stringify(v)}`);
    }
  });

  test('unknown and missing keys are refused (strict schema)', () => {
    assert.match(m.validateOpera({ ...valid(), prezzo: 100 }).join(), /sconosciuto «prezzo»/);
    const { ordine, ...missing } = valid();
    assert.match(m.validateOpera(missing).join(), /manca il campo «ordine»/);
    assert.ok(m.validateOpera(null).length);
  });

  test('profile: motto ≤ 160, bio ≤ 8000, ritratto null or ./file, strict', () => {
    const p = { motto: 'Dialogo tra testa e cuore.', bio: 'Bio.', ritratto: null, aggiornatoIl: '2026-11-02T12:00:00.000Z' };
    assert.deepEqual(m.validateProfilo(p), []);
    assert.deepEqual(m.validateProfilo({ ...p, ritratto: './ritratto-ab12cd.jpg' }), []);
    for (const bad of [{ motto: 'x'.repeat(161) }, { bio: 'x'.repeat(8001) }, { ritratto: 'ritratto.jpg' }, { ritratto: './R.JPG' }, { aggiornatoIl: '' }, { extra: 1 }]) {
      assert.ok(m.validateProfilo({ ...p, ...bad }).length > 0, JSON.stringify(bad));
    }
  });
});

describe('serialisation', () => {
  test('documented key order, 2-space indent, trailing newline, unknown keys dropped', () => {
    const shuffled = Object.fromEntries(Object.entries({ ...valid(), extra: 'x' }).reverse());
    const text = m.serializeOpera(shuffled);
    assert.ok(text.endsWith('}\n') && !text.endsWith('\n\n'));
    assert.deepEqual(Object.keys(JSON.parse(text)), m.OPERA_KEYS);
    assert.match(text, /^\{\n {2}"titolo": "Sorellanza",\n {2}"anno": 2023,/);
    assert.ok(!text.includes('extra'));
    const p = m.serializeProfilo({ aggiornatoIl: '2026-11-02T12:00:00.000Z', ritratto: null, bio: 'b', motto: 'm' });
    assert.deepEqual(Object.keys(JSON.parse(p)), ['motto', 'bio', 'ritratto', 'aggiornatoIl']);
  });

  test('files written in the admin\'s format (test fixture) are valid and re-serialise byte for byte', () => {
    const dir = `${FIXTURE}src/content/opere`;
    const slugs = readdirSync(dir).filter((s) => existsSync(`${dir}/${s}/opera.json`));
    assert.ok(slugs.length > 0);
    for (const slug of slugs) {
      assert.ok(m.isValidSlug(slug), slug);
      const text = readFileSync(`${dir}/${slug}/opera.json`, 'utf8');
      const data = JSON.parse(text);
      assert.deepEqual(m.validateOpera(data), [], slug);
      assert.equal(m.serializeOpera(data), text, `${slug}/opera.json`);
      for (const ref of data.immagini) assert.ok(existsSync(`${dir}/${slug}/${m.imageRefName(ref)}`), `${slug}: ${ref}`);
    }
    const profilo = readFileSync(`${FIXTURE}src/content/profilo/profilo.json`, 'utf8');
    assert.deepEqual(m.validateProfilo(JSON.parse(profilo)), []);
    assert.equal(m.serializeProfilo(JSON.parse(profilo)), profilo);
  });
});

describe('order, names, messages', () => {
  test('ordine ascending, ties by creataIl descending; new works go first', () => {
    const a = { ordine: 10, creataIl: '2023-01-01T00:00:00Z' };
    const b = { ordine: 10, creataIl: '2024-01-01T00:00:00Z' };
    const c = { ordine: 5, creataIl: '2020-01-01T00:00:00Z' };
    assert.deepEqual([a, b, c].sort(m.compareOpere), [c, b, a]);
    assert.equal(m.nextOrdine([10, 20, 30]), 0);
    assert.equal(m.nextOrdine([0, 20]), -10);
    assert.equal(m.nextOrdine([]), 10);
  });

  test('photo names: NN-xxxxxx.jpg and ritratto-xxxxxx.jpg, valid by the contract', () => {
    for (let i = 0; i < 50; i++) {
      const name = m.imageFileName(3);
      assert.match(name, /^03-[a-z0-9]{6}\.jpg$/);
      assert.ok(m.IMAGE_FILE_RE.test(name));
    }
    assert.equal(m.imageFileName(12, 'abcdef'), '12-abcdef.jpg');
    assert.match(m.portraitFileName(), /^ritratto-[a-z0-9]{6}\.jpg$/);
  });

  test('commit messages (Italian, as in section 7.4)', () => {
    assert.equal(m.commitMessage('create', 'Sorellanza'), 'opera: aggiunta «Sorellanza»');
    assert.equal(m.commitMessage('update', 'Sorellanza'), 'opera: modificata «Sorellanza»');
    assert.equal(m.commitMessage('delete', 'Sorellanza'), 'opera: eliminata «Sorellanza»');
    assert.equal(m.commitMessage('reorder'), 'opere: nuovo ordine');
    assert.equal(m.commitMessage('profilo'), 'profilo: aggiornato');
  });
});
