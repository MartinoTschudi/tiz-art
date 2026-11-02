#!/usr/bin/env node
// Content check: validates everything the admin (or a person on github.com) can commit against
// CONTRACTS.md section 4, so that a broken file stops the Deploy workflow with a clear message
// instead of a cryptic build error.
//
//   node scripts/check-content.mjs [root]        (npm run check:content)
//
// root = the repository to check (default: this repository). Errors make the exit code 1.
// Warnings (very large photos, contact form not configured, …) are printed but never fail.
// Node only, no dependencies: it can check any copy of the content without `npm ci`.

import { readdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const OPERE_DIR = 'src/content/opere';
const PROFILO_DIR = 'src/content/profilo';
const SITO_FILE = 'src/data/sito.json';

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SLUG_MAX = 60;
const IMAGE_NAME_RE = /^[a-z0-9][a-z0-9._-]*\.(jpg|jpeg|png|webp)$/;
const FORMAT_BY_EXTENSION = { jpg: 'jpeg', jpeg: 'jpeg', png: 'png', webp: 'webp' };
const MAX_IMAGES = 8;
const ISO_UTC_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/;
// String(n) of a positive number with at most one decimal ("120", "60.5"); exact, unlike n * 10 % 1.
const CENTIMETRES_RE = /^\d+(?:\.\d)?$/;
// Site path: starts and ends with "/", no "." or ".." segments, no query or fragment.
const SITE_PATH_RE = /^\/(?:(?!\.\.?\/)[A-Za-z0-9._~%-]+\/)*$/;
const WEB3FORMS_KEY_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Pages of the new site (CONTRACTS.md 5.1). An old WordPress path must never replace one of them.
const FIXED_PAGES = ['/', '/opere/', '/chi-sono/', '/contatti/'];
const RESERVED_PREFIXES = ['/opere/', '/admin/', '/_astro/'];

const WARN_IMAGE_BYTES = 3 * 1024 * 1024;
const WARN_IMAGE_SIDE = 3000;

// Created by macOS in every folder it opens; git ignores it (.gitignore), so it never reaches the repo.
const OS_JUNK = new Set(['.DS_Store']);

// ── Field rules ────────────────────────────────────────────────────────────────────────────────
// Each rule returns null when the value is fine, otherwise the problem (without the field name).

const isPlainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const show = (value) => {
  const json = JSON.stringify(value) ?? String(value);
  return json.length > 40 ? `${json.slice(0, 39)}…` : json;
};

function text({ max = Infinity, required = false, trimmed = false } = {}) {
  return (value) => {
    if (typeof value !== 'string') return 'must be a text (string)';
    if (required && value.trim() === '') return 'must not be empty';
    if (trimmed && value !== value.trim()) return 'must not start or end with spaces';
    if (value.length > max) return `must be at most ${max} characters (has ${value.length})`;
    return null;
  };
}

const token = (value) =>
  typeof value === 'string' && /^\S+$/.test(value) ? null : 'must be a non-empty text without spaces';
const year = (value) =>
  value === null || (Number.isInteger(value) && value >= 1900 && value <= 2100)
    ? null
    : 'must be a year from 1900 to 2100, or null';
const centimetres = (value) =>
  value === null || (typeof value === 'number' && value > 0 && value <= 1000 && CENTIMETRES_RE.test(String(value)))
    ? null
    : 'must be a size in cm, greater than 0 and at most 1000, with at most one decimal, or null';
const integer = (value) => (Number.isSafeInteger(value) ? null : 'must be a whole number');
const boolean = (value) => (typeof value === 'boolean' ? null : 'must be true or false');

function isoDate(value) {
  const problem = 'must be a UTC date like "2026-11-02T12:00:00.000Z"';
  if (typeof value !== 'string' || !ISO_UTC_RE.test(value)) return problem;
  const date = new Date(value);
  // Date silently rolls 30 February over to 2 March: compare the normalised form.
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 19) !== value.slice(0, 19)) {
    return 'is not a real date and time';
  }
  return null;
}

function imageRef(value) {
  return typeof value === 'string' && value.startsWith('./') && IMAGE_NAME_RE.test(value.slice(2))
    ? null
    : 'must be "./<file>": a lower-case file name (letters, digits, . _ -) ending in .jpg, .jpeg, .png or .webp';
}

function imageList(value) {
  if (!Array.isArray(value) || value.length < 1 || value.length > MAX_IMAGES) {
    return `must be a list of 1 to ${MAX_IMAGES} images`;
  }
  for (const ref of value) {
    const problem = imageRef(ref);
    if (problem) return `has an invalid entry ${show(ref)}: ${problem}`;
  }
  const duplicate = value.find((ref, index) => value.indexOf(ref) !== index);
  return duplicate ? `lists ${show(duplicate)} twice` : null;
}

function origin(value) {
  try {
    const url = new URL(value);
    if (url.protocol === 'https:' && url.origin === value) return null;
  } catch {
    // not a URL at all: same message
  }
  return 'must be an https:// address without path or trailing slash, like "https://tiz-art.ch"';
}

function redirects(value) {
  if (!isPlainObject(value)) return 'must be an object { "/old/path/": "/new/path/" }';
  for (const [from, to] of Object.entries(value)) {
    if (!SITE_PATH_RE.test(from) || from === '/') {
      return `has an invalid old path ${show(from)}: it must start and end with "/"`;
    }
    if (FIXED_PAGES.includes(from) || RESERVED_PREFIXES.some((prefix) => from.startsWith(prefix))) {
      return `has the old path ${show(from)}, which would replace a page of the new site`;
    }
    if (typeof to !== 'string' || !SITE_PATH_RE.test(to)) {
      return `has an invalid target ${show(to)} for ${show(from)}: it must start and end with "/"`;
    }
    if (from === to) return `redirects ${show(from)} to itself`;
  }
  return null;
}

// Schemas. The key order is the order the admin writes (CONTRACTS.md 4.1 and 4.2).
// A nested object is a nested schema.
const OPERA_FIELDS = {
  titolo: text({ max: 120, required: true, trimmed: true }),
  anno: year,
  larghezza: centimetres,
  altezza: centimetres,
  tecnica: text({ max: 120 }),
  collezione: text({ max: 120 }),
  testo: text({ max: 5000 }),
  immagini: imageList,
  ordine: integer,
  inEvidenza: boolean,
  pubblicata: boolean,
  creataIl: isoDate,
  aggiornataIl: isoDate,
};

const PROFILO_FIELDS = {
  motto: text({ max: 160 }),
  bio: text({ max: 8000 }),
  ritratto: (value) => (value === null ? null : imageRef(value)),
  aggiornatoIl: isoDate,
};

const SITO_FIELDS = {
  nome: text({ required: true, trimmed: true }),
  firma: text({ required: true, trimmed: true }),
  dominio: origin,
  lingua: (value) => (typeof value === 'string' && /^[a-z]{2}$/.test(value) ? null : 'must be a language code like "it"'),
  repository: { owner: token, repo: token, branch: token },
  contatto: { web3formsAccessKey: text() },
  redirectVecchioSito: redirects,
};

/** Checks `value` against `schema`: every field present, no unknown field, every rule passes. */
function checkFields(value, schema, fail, prefix = '') {
  if (!isPlainObject(value)) {
    fail(prefix ? `"${prefix.slice(0, -1)}" must be an object { … }` : 'must contain a JSON object { … }');
    return false;
  }
  let valid = true;
  for (const [key, rule] of Object.entries(schema)) {
    const name = prefix + key;
    if (!Object.hasOwn(value, key)) {
      fail(`missing field "${name}"`);
      valid = false;
    } else if (isPlainObject(rule)) {
      valid = checkFields(value[key], rule, fail, `${name}.`) && valid;
    } else {
      const problem = rule(value[key]);
      if (problem) {
        // Lists and objects are named in the message itself; for single values show what was found.
        const got = value[key] !== null && typeof value[key] === 'object' ? '' : ` (found ${show(value[key])})`;
        fail(`"${name}" ${problem}${got}`);
        valid = false;
      }
    }
  }
  for (const key of Object.keys(value)) {
    if (!Object.hasOwn(schema, key)) {
      fail(`unknown field "${prefix + key}" (allowed: ${Object.keys(schema).join(', ')})`);
      valid = false;
    }
  }
  return valid;
}

/** The exact text the admin writes for `data`: schema key order, 2-space indentation, final newline. */
function canonicalJson(data, schema) {
  const ordered = Object.fromEntries(Object.keys(schema).map((key) => [key, data[key]]));
  return `${JSON.stringify(ordered, null, 2)}\n`;
}

// ── Image headers ──────────────────────────────────────────────────────────────────────────────

/**
 * Format and pixel size of a JPEG, PNG or WebP file, read from its header only.
 * @param {Uint8Array} bytes
 * @returns {{ format: 'jpeg' | 'png' | 'webp', width: number, height: number } | null}
 *   null when the bytes are not a readable JPEG, PNG or WebP image.
 */
export function readImageSize(bytes) {
  const buf = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const size = jpegSize(buf) ?? pngSize(buf) ?? webpSize(buf);
  return size && size.width > 0 && size.height > 0 ? size : null;
}

// JPEG: walk the marker segments up to the first "start of frame" (SOFn), which holds the size.
function jpegSize(buf) {
  if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return null;
  let i = 2;
  while (i + 1 < buf.length) {
    if (buf[i] !== 0xff) return null; // not at a marker: corrupt file
    const marker = buf[i + 1];
    if (marker === 0xff) {
      i += 1; // fill byte before a marker
      continue;
    }
    i += 2;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) continue; // markers without a length
    if (marker === 0xd9 || marker === 0xda) return null; // end of image / scan data before any frame
    if (i + 2 > buf.length) return null;
    const length = buf.readUInt16BE(i);
    // SOF0–SOF15, except DHT (C4), JPG (C8) and DAC (CC), which share the range.
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      if (i + 7 > buf.length) return null; // length (2), precision (1), height (2), width (2)
      return { format: 'jpeg', width: buf.readUInt16BE(i + 5), height: buf.readUInt16BE(i + 3) };
    }
    if (length < 2) return null;
    i += length;
  }
  return null;
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

// PNG: the first chunk is always IHDR, with width and height as 32-bit big-endian numbers.
function pngSize(buf) {
  if (buf.length < 24 || !buf.subarray(0, 8).equals(PNG_SIGNATURE)) return null;
  if (buf.toString('latin1', 12, 16) !== 'IHDR') return null;
  return { format: 'png', width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

// WebP: RIFF container; the first chunk is VP8 (lossy), VP8L (lossless) or VP8X (extended).
function webpSize(buf) {
  if (buf.length < 30 || buf.toString('latin1', 0, 4) !== 'RIFF' || buf.toString('latin1', 8, 12) !== 'WEBP') {
    return null;
  }
  switch (buf.toString('latin1', 12, 16)) {
    case 'VP8 ': // key frame start code 9D 01 2A, then 14-bit width and height
      if (buf[23] !== 0x9d || buf[24] !== 0x01 || buf[25] !== 0x2a) return null;
      return { format: 'webp', width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff };
    case 'VP8L': {
      // signature 0x2F, then width − 1 (14 bits) and height − 1 (14 bits), little-endian bit order
      if (buf[20] !== 0x2f) return null;
      const bits = buf.readUInt32LE(21);
      return { format: 'webp', width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
    }
    case 'VP8X': // canvas width − 1 and height − 1 as 24-bit little-endian numbers
      return { format: 'webp', width: buf.readUIntLE(24, 3) + 1, height: buf.readUIntLE(27, 3) + 1 };
    default:
      return null;
  }
}

// ── Files and folders ──────────────────────────────────────────────────────────────────────────

/** Entries of a folder, sorted, without OS junk; null when the folder does not exist. */
function listFolder(ctx, rel) {
  try {
    return readdirSync(path.join(ctx.root, rel), { withFileTypes: true })
      .filter((entry) => !OS_JUNK.has(entry.name))
      .sort((a, b) => a.name.localeCompare(b.name));
  } catch (error) {
    if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return null;
    throw error;
  }
}

/** Names of the regular files among folder entries. */
const fileNames = (entries) => new Set(entries.filter((entry) => entry.isFile()).map((entry) => entry.name));

/**
 * Reads and validates a JSON file. Returns the parsed data (also when a field is wrong, so callers
 * can use the parts that are fine) and whether it matches the schema; data is null when unreadable.
 */
function readJsonFile(ctx, rel, schema, { canonical }) {
  let raw;
  try {
    raw = readFileSync(path.join(ctx.root, rel));
  } catch (error) {
    ctx.error(rel, error.code === 'ENOENT' ? 'file is missing' : `cannot be read (${error.code})`);
    return { data: null, valid: false };
  }
  let source;
  try {
    source = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(raw);
  } catch {
    ctx.error(rel, 'is not valid UTF-8 text');
    return { data: null, valid: false };
  }
  if (source.startsWith('﻿')) {
    ctx.error(rel, 'starts with a byte order mark (BOM): save it as UTF-8 without BOM');
    return { data: null, valid: false };
  }
  let data;
  try {
    data = JSON.parse(source);
  } catch (error) {
    ctx.error(rel, `is not valid JSON: ${error.message}`);
    return { data: null, valid: false };
  }
  const valid = checkFields(data, schema, (message) => ctx.error(rel, message));
  if (valid && canonical && source !== canonicalJson(data, schema)) {
    ctx.warn(
      rel,
      'is valid but not in the format the admin writes (fields in contract order, 2-space indentation, ' +
        'final newline); the next save in the admin rewrites it',
    );
  }
  return { data, valid };
}

/** Checks one image referenced by a JSON file. `files` = names of the regular files in its folder. */
function checkImage(ctx, folder, name, files) {
  const rel = `${folder}/${name}`;
  // Looked up in the folder listing (not with existsSync), so "01.JPG" does not count as "01.jpg"
  // on case-insensitive disks: the Linux build server would not find it either.
  if (!files.has(name)) {
    ctx.error(rel, 'image listed in the JSON file is missing from the folder');
    return;
  }
  const bytes = readFileSync(path.join(ctx.root, rel));
  const size = readImageSize(bytes);
  if (!size) {
    ctx.error(rel, 'is not a readable JPEG, PNG or WebP image');
    return;
  }
  const extension = name.slice(name.lastIndexOf('.') + 1);
  if (size.format !== FORMAT_BY_EXTENSION[extension]) {
    ctx.warn(rel, `is a ${size.format.toUpperCase()} image with a .${extension} name`);
  }
  if (bytes.length > WARN_IMAGE_BYTES) {
    ctx.warn(rel, `is ${(bytes.length / 1024 / 1024).toFixed(1)} MB (over 3 MB); the admin saves photos of about 1 MB`);
  }
  if (Math.max(size.width, size.height) > WARN_IMAGE_SIDE) {
    ctx.warn(rel, `is ${size.width} × ${size.height} px (longest side over ${WARN_IMAGE_SIDE} px); it slows the build down`);
  }
}

// ── Content parts ──────────────────────────────────────────────────────────────────────────────

/** Validates every artwork folder. Returns slug → published (true/false) for the redirect check. */
function checkOpere(ctx) {
  const works = new Map();
  const entries = listFolder(ctx, OPERE_DIR);
  if (!entries) {
    // git keeps no empty folders: after the last artwork is deleted the folder is gone. Valid, but odd.
    ctx.warn(OPERE_DIR, 'folder not found: the site has no artworks');
    return works;
  }
  for (const entry of entries) {
    const folder = `${OPERE_DIR}/${entry.name}`;
    if (!entry.isDirectory()) {
      ctx.error(folder, `only artwork folders belong in ${OPERE_DIR}/`);
      continue;
    }
    // The slug is the folder name, so slugs are unique by construction; lower case only also rules
    // out "Sorellanza" next to "sorellanza", which would clash on case-insensitive disks.
    if (!SLUG_RE.test(entry.name) || entry.name.length > SLUG_MAX) {
      ctx.error(
        folder,
        `folder name is not a valid slug: lower-case letters and digits, single hyphens in between, at most ${SLUG_MAX} characters`,
      );
    }
    works.set(entry.name, checkOpera(ctx, folder)?.pubblicata === true);
  }
  return works;
}

/** One artwork folder: exactly opera.json + the images it lists. Returns the parsed opera.json. */
function checkOpera(ctx, folder) {
  const entries = listFolder(ctx, folder);
  const files = fileNames(entries);
  for (const entry of entries) {
    if (!entry.isFile()) {
      ctx.error(`${folder}/${entry.name}`, 'does not belong here: an artwork folder holds only opera.json and its images');
    }
  }
  if (!files.has('opera.json')) {
    ctx.error(`${folder}/opera.json`, 'file is missing: every artwork folder needs one');
    return null;
  }
  const { data } = readJsonFile(ctx, `${folder}/opera.json`, OPERA_FIELDS, { canonical: true });
  // Image files are compared with the list only when the list itself is valid (else: one clear error).
  if (isPlainObject(data) && OPERA_FIELDS.immagini(data.immagini) === null) {
    const listed = new Set(data.immagini.map((ref) => ref.slice(2)));
    for (const name of listed) checkImage(ctx, folder, name, files);
    for (const name of files) {
      if (name !== 'opera.json' && !listed.has(name)) {
        ctx.error(`${folder}/${name}`, 'file is not listed in "immagini" of opera.json: delete it or add it to the list');
      }
    }
  }
  return data;
}

/** The profile folder: profilo.json + the optional portrait. */
function checkProfilo(ctx) {
  const rel = `${PROFILO_DIR}/profilo.json`;
  const entries = listFolder(ctx, PROFILO_DIR) ?? [];
  const files = fileNames(entries);
  if (!files.has('profilo.json')) {
    ctx.error(rel, 'file is missing');
    return;
  }
  const { data, valid } = readJsonFile(ctx, rel, PROFILO_FIELDS, { canonical: true });
  if (!valid) return;
  const portrait = data.ritratto === null ? null : data.ritratto.slice(2);
  if (portrait) checkImage(ctx, PROFILO_DIR, portrait, files);
  // Not an error (CONTRACTS.md requires "exactly" only for artwork folders): a leftover old portrait
  // does not break anything, it only takes space.
  for (const entry of entries) {
    if (entry.name !== 'profilo.json' && entry.name !== portrait) {
      ctx.warn(`${PROFILO_DIR}/${entry.name}`, 'is not used by profilo.json (an old portrait?)');
    }
  }
}

/** The fixed site settings. `works` = slug → published, to check where the redirects lead. */
function checkSito(ctx, works) {
  const { data, valid } = readJsonFile(ctx, SITO_FILE, SITO_FIELDS, { canonical: false });
  if (!valid) return;
  const key = data.contatto.web3formsAccessKey;
  if (key === '') {
    ctx.warn(
      SITO_FILE,
      'contatto.web3formsAccessKey is empty: the contact form says "Il modulo non è ancora attivo" (docs/SETUP.md, step 4)',
    );
  } else if (!WEB3FORMS_KEY_RE.test(key)) {
    ctx.warn(SITO_FILE, 'contatto.web3formsAccessKey does not look like a Web3Forms access key (xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx)');
  }
  // A warning, not an error: deleting or hiding an artwork in the admin must never block publishing.
  for (const [from, to] of Object.entries(data.redirectVecchioSito)) {
    const slug = /^\/opere\/([^/]+)\/$/.exec(to)?.[1];
    if (!FIXED_PAGES.includes(to) && !(slug && works.get(slug) === true)) {
      ctx.warn(
        SITO_FILE,
        slug
          ? `redirect ${from} → ${to}: the target page does not exist (artwork deleted or hidden?); the build sends it to /opere/ instead`
          : `redirect ${from} → ${to}: the target page does not exist`,
      );
    }
  }
}

// ── Entry points ───────────────────────────────────────────────────────────────────────────────

/**
 * Validates the content of the repository at `root`.
 * @param {string} root
 * @returns {{ errors: Issue[], warnings: Issue[], works: number, published: number }}
 * @typedef {{ file: string, message: string }} Issue  file = path relative to root, with "/"
 */
export function checkContent(root) {
  const errors = [];
  const warnings = [];
  const ctx = {
    root,
    error: (file, message) => errors.push({ file, message }),
    warn: (file, message) => warnings.push({ file, message }),
  };
  const works = checkOpere(ctx);
  checkProfilo(ctx);
  checkSito(ctx, works);
  const published = [...works.values()].filter(Boolean).length;
  return { errors, warnings, works: works.size, published };
}

// GitHub Actions workflow commands: https://docs.github.com/actions/reference/workflow-commands-for-github-actions
const escapeData = (s) => s.replaceAll('%', '%25').replaceAll('\r', '%0D').replaceAll('\n', '%0A');
const escapeProperty = (s) => escapeData(s).replaceAll(':', '%3A').replaceAll(',', '%2C');

function printIssue(level, { file, message }, root) {
  if (process.env.GITHUB_ACTIONS === 'true') {
    // Shown as an annotation on the run's summary page (and in the log).
    const location = path.relative(process.cwd(), path.join(root, file)).split(path.sep).join('/');
    console.log(`::${level} file=${escapeProperty(location)},title=Content check::${escapeData(`${file}: ${message}`)}`);
  } else {
    console.log(`${level === 'error' ? 'ERROR  ' : 'warning'} ${file}: ${message}`);
  }
}

function main(args) {
  const folder = path.resolve(args[0] ?? fileURLToPath(new URL('..', import.meta.url)));
  if (!statSync(folder, { throwIfNoEntry: false })?.isDirectory()) {
    console.error(`check-content: ${folder} is not a folder`);
    return 1;
  }
  // Real path, like process.cwd(), so annotation paths come out relative (e.g. /tmp → /private/tmp on macOS).
  const root = realpathSync(folder);
  const { errors, warnings, works, published } = checkContent(root);
  for (const issue of errors) printIssue('error', issue, root);
  for (const issue of warnings) printIssue('warning', issue, root);
  const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
  const counts = `${plural(errors.length, 'error')}, ${plural(warnings.length, 'warning')}`;
  if (errors.length) {
    console.log(`\nContent check failed: ${counts}.`);
    return 1;
  }
  console.log(`Content OK: ${plural(works, 'artwork')} (${published} published), profile and site settings (${counts}).`);
  return 0;
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}
