// Tests for scripts/check-content.mjs (CONTRACTS.md section 4): the image header reader, every kind
// of error and warning on a small content tree in a temp folder, the command line, and the real
// content of this repository.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { checkContent, readImageSize } from '../check-content.mjs';

const SCRIPT = fileURLToPath(new URL('../check-content.mjs', import.meta.url));
const REPO = fileURLToPath(new URL('../../', import.meta.url));

// sharp (a dependency of the site) produces real encoder output; skip those tests if it is not installed.
const sharp = await import('sharp').then((module) => module.default).catch(() => null);

// ── Minimal image files: the checker reads only the header, never the pixels ─────────────────────

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function segment(marker, payload) {
  const length = payload.length + 2;
  return Buffer.concat([Buffer.from([0xff, marker, length >> 8, length & 0xff]), payload]);
}

function jpeg(width, height, { sof = 0xc0, before = [] } = {}) {
  return Buffer.concat([
    Buffer.from([0xff, 0xd8]),
    segment(0xe0, Buffer.from('JFIF\0\x01\x01\0\0\x01\0\x01\0\0', 'latin1')),
    ...before,
    segment(sof, Buffer.from([8, height >> 8, height & 0xff, width >> 8, width & 0xff, 1, 1, 0x11, 0])),
    Buffer.from([0xff, 0xd9]),
  ]);
}

function png(width, height) {
  const ihdr = Buffer.alloc(25); // length, "IHDR", 13 bytes of data, CRC (left 0: not read)
  ihdr.writeUInt32BE(13, 0);
  ihdr.write('IHDR', 4, 'latin1');
  ihdr.writeUInt32BE(width, 8);
  ihdr.writeUInt32BE(height, 12);
  ihdr.set([8, 2], 16); // 8-bit RGB
  return Buffer.concat([PNG_SIGNATURE, ihdr]);
}

function webp(width, height) {
  const buf = Buffer.alloc(30); // RIFF header + extended (VP8X) chunk
  buf.write('RIFF', 0, 'latin1');
  buf.writeUInt32LE(22, 4);
  buf.write('WEBP', 8, 'latin1');
  buf.write('VP8X', 12, 'latin1');
  buf.writeUInt32LE(10, 16);
  buf.writeUIntLE(width - 1, 24, 3);
  buf.writeUIntLE(height - 1, 27, 3);
  return buf;
}

// ── A valid content tree ─────────────────────────────────────────────────────────────────────────

const OPERA_JSON = 'src/content/opere/prima-opera/opera.json';
const BOZZA_JSON = 'src/content/opere/bozza/opera.json';
const PROFILO_JSON = 'src/content/profilo/profilo.json';
const SITO_JSON = 'src/data/sito.json';

const OPERA = {
  titolo: 'Prima opera',
  anno: 2024,
  larghezza: 100,
  altezza: 80.5,
  tecnica: 'Acrilico su tela',
  collezione: 'noi, DONNA.',
  colore: 'terracotta',
  testo: 'Primo paragrafo.\n\nSecondo paragrafo.',
  immagini: ['./01.jpg', './02-a1b2c3.png'],
  ordine: 10,
  inEvidenza: true,
  pubblicata: true,
  creataIl: '2024-05-01T10:00:00.000Z',
  aggiornataIl: '2024-05-02T10:00:00.000Z',
};
// A hidden draft with every optional value empty.
const BOZZA = {
  ...OPERA,
  titolo: 'Bozza',
  anno: null,
  larghezza: null,
  altezza: null,
  tecnica: '',
  collezione: '',
  colore: null,
  testo: '',
  immagini: ['./01.webp'],
  ordine: -10,
  inEvidenza: false,
  pubblicata: false,
};
const PROFILO = {
  motto: 'Dialogo tra testa e cuore.',
  bio: 'Paragrafo.',
  ritratto: './ritratto-ab12cd.jpg',
  aggiornatoIl: '2026-11-02T12:00:00.000Z',
};
const SITO = {
  nome: 'Tiziana Tschudi Belloli',
  firma: 'TIZ',
  dominio: 'https://tiz-art.ch',
  lingua: 'it',
  repository: { owner: 'MartinoTschudi', repo: 'tiz-art', branch: 'main' },
  contatto: { web3formsAccessKey: '0b5c2f1e-3d4a-4b6c-8d7e-9f0a1b2c3d4e' },
  redirectVecchioSito: { '/2023/09/23/vecchia/': '/opere/prima-opera/' },
};

const json = (data) => `${JSON.stringify(data, null, 2)}\n`;

function write(root, rel, content) {
  mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
  writeFileSync(path.join(root, rel), content);
}

function remove(root, rel) {
  rmSync(path.join(root, rel), { recursive: true });
}

/** Rewrites a JSON file of the tree: `edit` changes the parsed data in place. */
function editJson(root, rel, edit) {
  const data = JSON.parse(readFileSync(path.join(root, rel), 'utf8'));
  edit(data);
  write(root, rel, json(data));
}

/** A valid tree in a temp folder, deleted after the test. */
function makeTree(t) {
  const root = mkdtempSync(path.join(tmpdir(), 'tiz-content-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  write(root, OPERA_JSON, json(OPERA));
  write(root, 'src/content/opere/prima-opera/01.jpg', jpeg(1200, 900));
  write(root, 'src/content/opere/prima-opera/02-a1b2c3.png', png(800, 600));
  write(root, BOZZA_JSON, json(BOZZA));
  write(root, 'src/content/opere/bozza/01.webp', webp(640, 480));
  write(root, PROFILO_JSON, json(PROFILO));
  write(root, 'src/content/profilo/ritratto-ab12cd.jpg', jpeg(600, 800));
  write(root, SITO_JSON, json(SITO));
  return root;
}

const lines = (issues) => issues.map(({ file, message }) => `${file}: ${message}`);

// ── Image headers ────────────────────────────────────────────────────────────────────────────────

describe('check-content: image header reader', () => {
  test('reads JPEG, PNG and WebP sizes', () => {
    assert.deepEqual(readImageSize(jpeg(1200, 900)), { format: 'jpeg', width: 1200, height: 900 });
    assert.deepEqual(readImageSize(png(800, 600)), { format: 'png', width: 800, height: 600 });
    assert.deepEqual(readImageSize(webp(4000, 3)), { format: 'webp', width: 4000, height: 3 });
  });

  test('finds a progressive JPEG frame behind metadata, tables and fill bytes', () => {
    const exif = segment(0xe1, Buffer.alloc(60000, 0x45)); // large EXIF block
    const huffmanTable = segment(0xc4, Buffer.alloc(30)); // DHT shares the SOF marker range
    const fill = Buffer.from([0xff, 0xff]); // padding before the next marker
    const bytes = jpeg(2400, 1800, { sof: 0xc2, before: [exif, huffmanTable, fill] });
    assert.deepEqual(readImageSize(bytes), { format: 'jpeg', width: 2400, height: 1800 });
  });

  test('accepts a view into a larger buffer', () => {
    const bytes = Buffer.concat([Buffer.from('xxxx'), png(3, 2)]);
    assert.deepEqual(readImageSize(bytes.subarray(4)), { format: 'png', width: 3, height: 2 });
  });

  test('rejects anything that is not a readable image', () => {
    const scanBeforeFrame = Buffer.concat([Buffer.from([0xff, 0xd8]), segment(0xda, Buffer.alloc(4)), jpeg(10, 10).subarray(2)]);
    for (const bytes of [
      Buffer.alloc(0),
      Buffer.from('not an image at all, just some text'),
      jpeg(1200, 900).subarray(0, 24), // cut off before the frame header
      scanBeforeFrame,
      jpeg(0, 900),
      Buffer.from('ftypheic HEIC from an iPhone'.padEnd(40)),
    ]) {
      assert.equal(readImageSize(bytes), null, JSON.stringify(bytes.subarray(0, 12).toString('latin1')));
    }
  });

  test('matches the sizes of real encoder output', { skip: !sharp && 'sharp is not installed' }, async () => {
    const pixels = sharp({ create: { width: 37, height: 23, channels: 4, background: { r: 200, g: 80, b: 40, alpha: 0.5 } } });
    const outputs = {
      'JPEG baseline': [await pixels.clone().jpeg().toBuffer(), 'jpeg'],
      'JPEG progressive': [await pixels.clone().jpeg({ progressive: true }).toBuffer(), 'jpeg'],
      PNG: [await pixels.clone().png().toBuffer(), 'png'],
      'WebP lossy (VP8)': [await pixels.clone().flatten().webp().toBuffer(), 'webp'],
      'WebP lossless (VP8L)': [await pixels.clone().webp({ lossless: true }).toBuffer(), 'webp'],
      'WebP with alpha (VP8X)': [await pixels.clone().webp().toBuffer(), 'webp'],
    };
    for (const [name, [bytes, format]] of Object.entries(outputs)) {
      assert.deepEqual(readImageSize(bytes), { format, width: 37, height: 23 }, name);
    }
  });
});

// ── Valid content ────────────────────────────────────────────────────────────────────────────────

describe('check-content: valid content', () => {
  test('a valid tree has no errors and no warnings', (t) => {
    const root = makeTree(t);
    assert.deepEqual(checkContent(root), { errors: [], warnings: [], works: 2, published: 1 });
  });

  test('accepts every limit of CONTRACTS.md section 4', (t) => {
    const root = makeTree(t);
    const names = Array.from({ length: 8 }, (_, i) => `0${i + 1}-abc12${i}.jpg`);
    for (const name of names) write(root, `src/content/opere/bozza/${name}`, jpeg(3000, 10));
    remove(root, 'src/content/opere/bozza/01.webp');
    editJson(root, BOZZA_JSON, (data) => {
      Object.assign(data, {
        titolo: 'T'.repeat(120),
        anno: 1900,
        larghezza: 1000,
        altezza: 0.1,
        tecnica: 't'.repeat(120),
        collezione: 'c'.repeat(120),
        testo: 'x'.repeat(5000),
        immagini: names.map((name) => `./${name}`),
        creataIl: '2024-02-29T23:59:59Z',
      });
    });
    editJson(root, OPERA_JSON, (data) => Object.assign(data, { anno: 2100, ordine: -2147483648 }));
    editJson(root, PROFILO_JSON, (data) => Object.assign(data, { motto: 'm'.repeat(160), bio: 'b'.repeat(8000), ritratto: null }));
    remove(root, 'src/content/profilo/ritratto-ab12cd.jpg');
    assert.deepEqual(lines(checkContent(root).errors), []);
    assert.deepEqual(lines(checkContent(root).warnings), []);
  });

  test('accepts every colour name and null (automatic)', (t) => {
    const root = makeTree(t);
    for (const colore of ['ocra', 'rosso', 'terracotta', 'ottanio', 'blu', null]) {
      setOpera({ colore })(root);
      assert.deepEqual(checkContent(root), { errors: [], warnings: [], works: 2, published: 1 }, String(colore));
    }
  });

  test('ignores .DS_Store files from macOS', (t) => {
    const root = makeTree(t);
    for (const folder of ['src/content/opere', 'src/content/opere/prima-opera', 'src/content/profilo']) {
      write(root, `${folder}/.DS_Store`, 'junk');
    }
    assert.deepEqual(checkContent(root), { errors: [], warnings: [], works: 2, published: 1 });
  });
});

// ── Errors ───────────────────────────────────────────────────────────────────────────────────────

const setOpera = (changes) => (root) => editJson(root, OPERA_JSON, (data) => Object.assign(data, changes));
const setProfilo = (changes) => (root) => editJson(root, PROFILO_JSON, (data) => Object.assign(data, changes));
const setSito = (changes) => (root) => editJson(root, SITO_JSON, (data) => Object.assign(data, changes));
const opereFolder = (root, name) => path.join(root, 'src/content/opere', name);

// [name, change to the valid tree, the single error it must cause]
const ERROR_CASES = [
  // Folders and files
  ['folder name is not a slug', (root) => renameSync(opereFolder(root, 'bozza'), opereFolder(root, 'Bozza_1')), /opere\/Bozza_1: folder name is not a valid slug/],
  ['slug longer than 60 characters', (root) => renameSync(opereFolder(root, 'bozza'), opereFolder(root, 'a'.repeat(61))), /folder name is not a valid slug/],
  ['slug with a double hyphen', (root) => renameSync(opereFolder(root, 'bozza'), opereFolder(root, 'e--fuori')), /folder name is not a valid slug/],
  ['artwork folder without opera.json', (root) => remove(root, BOZZA_JSON), /opere\/bozza\/opera\.json: file is missing/],
  ['a file directly in the artworks folder', (root) => write(root, 'src/content/opere/note.txt', 'x'), /opere\/note\.txt: only artwork folders/],
  ['a subfolder in an artwork folder', (root) => mkdirSync(opereFolder(root, 'prima-opera/vecchie')), /prima-opera\/vecchie: does not belong here/],
  ['an image file not listed in opera.json', (root) => write(root, 'src/content/opere/prima-opera/03.jpg', jpeg(10, 10)), /prima-opera\/03\.jpg: file is not listed in "immagini"/],
  ['a listed image is missing', (root) => remove(root, 'src/content/opere/prima-opera/01.jpg'), /prima-opera\/01\.jpg: image listed in the JSON file is missing/],
  ['an image name differing only in case', (root) => renameSync(opereFolder(root, 'bozza/01.webp'), opereFolder(root, 'bozza/01.WEBP')), /bozza\/01\.webp: image listed in the JSON file is missing|bozza\/01\.WEBP: file is not listed/],
  ['an image that is not an image', (root) => write(root, 'src/content/opere/prima-opera/01.jpg', 'GIF89a…'), /prima-opera\/01\.jpg: is not a readable JPEG, PNG or WebP image/],
  // JSON syntax
  ['invalid JSON', (root) => write(root, OPERA_JSON, '{ "titolo": '), /prima-opera\/opera\.json: is not valid JSON/],
  ['not UTF-8', (root) => write(root, OPERA_JSON, Buffer.from([0x7b, 0xff, 0x7d])), /is not valid UTF-8 text/],
  ['UTF-8 with a byte order mark', (root) => write(root, OPERA_JSON, `﻿${json(OPERA)}`), /byte order mark/],
  ['a list instead of an object', (root) => write(root, OPERA_JSON, '[]\n'), /must contain a JSON object/],
  // Artwork fields
  ['missing field', (root) => editJson(root, OPERA_JSON, (data) => delete data.testo), /missing field "testo"/],
  ['misspelt field', (root) => editJson(root, OPERA_JSON, (data) => { data.titlo = data.titolo; delete data.titolo; }), /missing field "titolo"|unknown field "titlo"/],
  ['empty title', setOpera({ titolo: '   ' }), /"titolo" must not be empty/],
  ['title with outer spaces', setOpera({ titolo: ' Sorellanza' }), /"titolo" must not start or end with spaces/],
  ['title too long', setOpera({ titolo: 'x'.repeat(121) }), /"titolo" must be at most 120 characters \(has 121\)/],
  ['title that is not text', setOpera({ titolo: 42 }), /"titolo" must be a text \(string\) \(found 42\)/],
  ['year before 1900', setOpera({ anno: 1899 }), /"anno" must be a year from 1900 to 2100, or null \(found 1899\)/],
  ['year as text', setOpera({ anno: '2023' }), /"anno" must be a year/],
  ['year with decimals', setOpera({ anno: 2023.5 }), /"anno" must be a year/],
  ['width 0', setOpera({ larghezza: 0 }), /"larghezza" must be a size in cm/],
  ['width over 1000 cm', setOpera({ larghezza: 1000.5 }), /"larghezza" must be a size in cm/],
  ['height with two decimals', setOpera({ altezza: 80.25 }), /"altezza" must be a size in cm/],
  ['height as text', setOpera({ altezza: '80' }), /"altezza" must be a size in cm/],
  ['technique too long', setOpera({ tecnica: 'x'.repeat(121) }), /"tecnica" must be at most 120 characters/],
  ['collection that is null', setOpera({ collezione: null }), /"collezione" must be a text/],
  ['unknown colour', setOpera({ colore: 'verde' }), /"colore" must be null \(automatic\) or one of "ocra", "rosso", "terracotta", "ottanio", "blu" \(found "verde"\)/],
  ['colour with a capital', setOpera({ colore: 'Ocra' }), /"colore" must be null \(automatic\) or one of/],
  ['colour as empty text', setOpera({ colore: '' }), /"colore" must be null \(automatic\) or one of/],
  ['colour as a hex value', setOpera({ colore: '#d6982b' }), /"colore" must be null \(automatic\) or one of/],
  ['text too long', setOpera({ testo: 'x'.repeat(5001) }), /"testo" must be at most 5000 characters/],
  ['no images', setOpera({ immagini: [] }), /"immagini" must be a list of 1 to 8 images/],
  ['nine images', setOpera({ immagini: Array.from({ length: 9 }, (_, i) => `./0${i}.jpg`) }), /"immagini" must be a list of 1 to 8 images/],
  ['image name with capitals', setOpera({ immagini: ['./IMG_01.JPG'] }), /"immagini" has an invalid entry "\.\/IMG_01\.JPG"/],
  ['image without "./"', setOpera({ immagini: ['01.jpg'] }), /"immagini" has an invalid entry "01\.jpg"/],
  ['image outside the folder', setOpera({ immagini: ['./../01.jpg'] }), /"immagini" has an invalid entry/],
  ['image in another format', setOpera({ immagini: ['./01.gif'] }), /"immagini" has an invalid entry/],
  ['the same image twice', setOpera({ immagini: ['./01.jpg', './01.jpg'] }), /"immagini" lists "\.\/01\.jpg" twice/],
  ['order with decimals', setOpera({ ordine: 10.5 }), /"ordine" must be a whole number/],
  ['boolean as text', setOpera({ inEvidenza: 'true' }), /"inEvidenza" must be true or false \(found "true"\)/],
  ['published missing a value', setOpera({ pubblicata: null }), /"pubblicata" must be true or false/],
  ['date without time zone', setOpera({ creataIl: '2024-05-01T10:00:00' }), /"creataIl" must be a UTC date/],
  ['date with an offset', setOpera({ aggiornataIl: '2024-05-01T10:00:00+02:00' }), /"aggiornataIl" must be a UTC date/],
  ['impossible date', setOpera({ creataIl: '2023-02-30T12:00:00.000Z' }), /"creataIl" is not a real date and time/],
  // Profile
  ['profile missing', (root) => remove(root, PROFILO_JSON), /profilo\/profilo\.json: file is missing/],
  ['profile with an unknown field', setProfilo({ email: 'x@example.com' }), /unknown field "email"/],
  ['motto too long', setProfilo({ motto: 'm'.repeat(161) }), /"motto" must be at most 160 characters/],
  ['bio too long', setProfilo({ bio: 'b'.repeat(8001) }), /"bio" must be at most 8000 characters/],
  ['portrait with an invalid name', setProfilo({ ritratto: './Ritratto.JPG' }), /"ritratto" must be "\.\/<file>"/],
  ['portrait file missing', (root) => remove(root, 'src/content/profilo/ritratto-ab12cd.jpg'), /profilo\/ritratto-ab12cd\.jpg: image listed in the JSON file is missing/],
  ['profile date missing', (root) => editJson(root, PROFILO_JSON, (data) => delete data.aggiornatoIl), /missing field "aggiornatoIl"/],
  // Site settings
  ['site settings missing', (root) => remove(root, SITO_JSON), /data\/sito\.json: file is missing/],
  ['site settings with an unknown field', setSito({ telefono: '+41' }), /unknown field "telefono"/],
  ['repository owner missing', (root) => editJson(root, SITO_JSON, (data) => delete data.repository.owner), /missing field "repository\.owner"/],
  ['unknown field in contatto', (root) => editJson(root, SITO_JSON, (data) => { data.contatto.email = 'x@example.com'; }), /unknown field "contatto\.email"/],
  ['contatto that is not an object', setSito({ contatto: '' }), /"contatto" must be an object/],
  ['access key that is not text', setSito({ contatto: { web3formsAccessKey: null } }), /"contatto\.web3formsAccessKey" must be a text/],
  ['domain with a trailing slash', setSito({ dominio: 'https://tiz-art.ch/' }), /"dominio" must be an https:\/\/ address/],
  ['domain over http', setSito({ dominio: 'http://tiz-art.ch' }), /"dominio" must be an https:\/\/ address/],
  ['empty signature', setSito({ firma: '' }), /"firma" must not be empty/],
  ['language that is not a code', setSito({ lingua: 'italiano' }), /"lingua" must be a language code/],
  ['old path without trailing slash', setSito({ redirectVecchioSito: { '/2023/09/23/vecchia': '/' } }), /invalid old path "\/2023\/09\/23\/vecchia"/],
  ['old path with a query', setSito({ redirectVecchioSito: { '/?p=12/': '/' } }), /invalid old path/],
  ['old path replacing a page', setSito({ redirectVecchioSito: { '/opere/': '/' } }), /old path "\/opere\/", which would replace a page/],
  ['old path inside the admin', setSito({ redirectVecchioSito: { '/admin/vecchio/': '/' } }), /would replace a page/],
  ['target that is not a site path', setSito({ redirectVecchioSito: { '/vecchia/': 'https://example.com/' } }), /invalid target "https:\/\/example\.com\/"/],
  ['redirect to itself', setSito({ redirectVecchioSito: { '/vecchia/': '/vecchia/' } }), /redirects "\/vecchia\/" to itself/],
];

describe('check-content: errors', () => {
  for (const [name, change, expected] of ERROR_CASES) {
    test(name, (t) => {
      const root = makeTree(t);
      change(root);
      const errors = lines(checkContent(root).errors);
      assert.ok(errors.length >= 1 && errors.every((line) => expected.test(line)), `expected ${expected}, got:\n${errors.join('\n')}`);
    });
  }
});

// ── Warnings: reported, never an error ───────────────────────────────────────────────────────────

// [name, change to the valid tree, the warning it must cause]
const WARNING_CASES = [
  ['image over 3 MB', (root) => write(root, 'src/content/opere/prima-opera/01.jpg', Buffer.concat([jpeg(1200, 900), Buffer.alloc(3 * 1024 * 1024)])), /prima-opera\/01\.jpg: is 3\.0 MB \(over 3 MB\)/],
  ['image over 3000 px', (root) => write(root, 'src/content/opere/prima-opera/01.jpg', jpeg(2000, 4032)), /prima-opera\/01\.jpg: is 2000 × 4032 px/],
  ['PNG content with a .jpg name', (root) => write(root, 'src/content/opere/prima-opera/01.jpg', png(10, 10)), /01\.jpg: is a PNG image with a \.jpg name/],
  ['contact form key empty', setSito({ contatto: { web3formsAccessKey: '' } }), /sito\.json: contatto\.web3formsAccessKey is empty/],
  ['contact form key malformed', setSito({ contatto: { web3formsAccessKey: 'my-key' } }), /does not look like a Web3Forms access key/],
  ['JSON not in the admin format', (root) => write(root, OPERA_JSON, JSON.stringify(OPERA)), /prima-opera\/opera\.json: is valid but not in the format the admin writes/],
  // An older admin (or a branch opened before the field existed) wrote the file: valid, read as null.
  ['artwork saved before "colore" existed', (root) => editJson(root, OPERA_JSON, (data) => delete data.colore), /prima-opera\/opera\.json: missing field "colore": read as null \(automatic colour\); the next save in the admin adds it/],
  ['"colore" in another position', (root) => write(root, OPERA_JSON, json({ colore: OPERA.colore, ...OPERA })), /prima-opera\/opera\.json: is valid but not in the format/],
  ['fields in another order', (root) => write(root, PROFILO_JSON, json({ bio: PROFILO.bio, ...PROFILO })), /profilo\.json: is valid but not in the format/],
  ['redirect to a hidden artwork', setSito({ redirectVecchioSito: { '/vecchia/': '/opere/bozza/' } }), /redirect \/vecchia\/ → \/opere\/bozza\/: the target page does not exist/],
  ['redirect to an unknown page', setSito({ redirectVecchioSito: { '/vecchia/': '/galleria/' } }), /the target page does not exist/],
  ['old portrait left in the profile folder', (root) => write(root, 'src/content/profilo/ritratto-old000.jpg', jpeg(10, 10)), /profilo\/ritratto-old000\.jpg: is not used by profilo\.json/],
];

describe('check-content: warnings', () => {
  for (const [name, change, expected] of WARNING_CASES) {
    test(name, (t) => {
      const root = makeTree(t);
      change(root);
      const { errors, warnings } = checkContent(root);
      assert.deepEqual(lines(errors), []);
      assert.deepEqual(
        lines(warnings).filter((line) => !expected.test(line)),
        [],
        'no other warning expected',
      );
      assert.equal(warnings.length, 1, `expected ${expected}`);
    });
  }

  test('no artworks folder at all (every artwork deleted) is only a warning', (t) => {
    const root = makeTree(t);
    remove(root, 'src/content/opere');
    const result = checkContent(root);
    assert.deepEqual(lines(result.errors), []);
    assert.equal(result.works, 0);
    assert.match(lines(result.warnings).join('\n'), /src\/content\/opere: folder not found/);
    assert.match(lines(result.warnings).join('\n'), /redirect \/2023\/09\/23\/vecchia\/ → \/opere\/prima-opera\//);
  });
});

// ── Command line ─────────────────────────────────────────────────────────────────────────────────

function run(args, { cwd = REPO, ci = false } = {}) {
  return spawnSync(process.execPath, [SCRIPT, ...args], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, GITHUB_ACTIONS: ci ? 'true' : 'false' },
  });
}

describe('check-content: command line', () => {
  test('exit code 0 and a summary for valid content', (t) => {
    const root = makeTree(t);
    const result = run([root]);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stdout, /Content OK: 2 artworks \(1 published\), profile and site settings \(0 errors, 0 warnings\)\./);
  });

  test('exit code 1 and one line per problem for invalid content', (t) => {
    const root = makeTree(t);
    setOpera({ anno: 1800 })(root);
    setSito({ contatto: { web3formsAccessKey: '' } })(root);
    const result = run([root]);
    assert.equal(result.status, 1);
    assert.match(result.stdout, /^ERROR +src\/content\/opere\/prima-opera\/opera\.json: "anno" must be a year/m);
    assert.match(result.stdout, /^warning src\/data\/sito\.json: contatto\.web3formsAccessKey is empty/m);
    assert.match(result.stdout, /Content check failed: 1 error, 1 warning\./);
  });

  test('prints GitHub annotations on GitHub Actions', (t) => {
    const root = makeTree(t);
    setOpera({ titolo: '' })(root);
    setSito({ contatto: { web3formsAccessKey: '' } })(root);
    const result = run([root], { cwd: root, ci: true });
    assert.equal(result.status, 1);
    assert.match(result.stdout, /^::error file=src\/content\/opere\/prima-opera\/opera\.json,title=Content check::src\/content\/opere\/prima-opera\/opera\.json: "titolo" must not be empty/m);
    assert.match(result.stdout, /^::warning file=src\/data\/sito\.json,title=Content check::src\/data\/sito\.json: /m);
  });

  test('exit code 1 when the folder does not exist', () => {
    const result = run([path.join(tmpdir(), 'tiz-content-does-not-exist')]);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /is not a folder/);
  });
});

// ── This repository ──────────────────────────────────────────────────────────────────────────────

// Same check as `npm run check:content` in Deploy. No assertion on the number of works: deleting
// every work in the admin must not stop the site from being published.
test('check-content: the content of this repository is valid', () => {
  const { errors } = checkContent(REPO);
  assert.deepEqual(lines(errors), [], `content errors (same as npm run check:content):\n${lines(errors).join('\n')}`);
});
