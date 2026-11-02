/**
 * Data rules of the portfolio (CONTRACTS.md section 4), with no DOM and no network:
 * slugs, parsing of what she types, validation and serialisation of opera.json / profilo.json.
 *
 * Everything is validated here BEFORE a commit: a file that breaks the schema would stop the
 * site build, so the admin must never write one.
 */
import { randomId } from './util.js';

export const OPERE_DIR = 'src/content/opere';
export const PROFILO_DIR = 'src/content/profilo';
export const OPERA_FILE = 'opera.json';
export const PROFILO_FILE = 'profilo.json';

export const MAX_IMMAGINI = 8;
export const LIMITS = { titolo: 120, tecnica: 120, collezione: 120, testo: 5000, motto: 160, bio: 8000, slug: 60 };
export const ANNO_MIN = 1900;
export const ANNO_MAX = 2100;
export const MISURA_MAX = 1000;

/** Keys in the documented order (the serialisers write them in this order, and only these). */
export const OPERA_KEYS = [
  'titolo', 'anno', 'larghezza', 'altezza', 'tecnica', 'collezione', 'testo', 'immagini',
  'ordine', 'inEvidenza', 'pubblicata', 'creataIl', 'aggiornataIl',
];
export const PROFILO_KEYS = ['motto', 'bio', 'ritratto', 'aggiornatoIl'];

export const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const IMAGE_FILE_RE = /^[a-z0-9][a-z0-9._-]*\.(jpg|jpeg|png|webp)$/;
const ISO_UTC_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/;

/* ---------- slugs ---------- */

/** Letters that NFD does not split into "base letter + accent". */
const SPECIAL_LETTERS = { ß: 'ss', æ: 'ae', œ: 'oe', ø: 'o', đ: 'd', ł: 'l', þ: 'th', ð: 'd' };

/** Cuts a slug to `max` characters, preferably at a dash. */
function truncateSlug(slug, max) {
  if (slug.length <= max) return slug;
  const cut = slug.slice(0, max + 1);
  const dash = cut.lastIndexOf('-');
  return (dash > 0 ? cut.slice(0, dash) : slug.slice(0, max)).replace(/-+$/, '');
}

/**
 * Title → URL slug: "Gioventù" → "gioventu", "…e fuori piove" → "e-fuori-piove",
 * "L’attesa" → "l-attesa". Never empty (falls back to "opera"), at most 60 characters.
 */
export function slugify(title) {
  const slug = String(title ?? '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '') // accents
    .toLowerCase()
    .replace(/[ßæœøđłþð]/g, (c) => SPECIAL_LETTERS[c])
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return truncateSlug(slug, LIMITS.slug) || 'opera';
}

/** `base`, or `base-2`, `base-3`… — the first one not in `taken` (still ≤ 60 characters). */
export function uniqueSlug(base, taken) {
  const used = taken instanceof Set ? taken : new Set(taken);
  if (!used.has(base)) return base;
  for (let n = 2; ; n++) {
    const suffix = `-${n}`;
    const candidate = truncateSlug(base, LIMITS.slug - suffix.length) + suffix;
    if (!used.has(candidate)) return candidate;
  }
}

export function isValidSlug(slug) {
  return typeof slug === 'string' && slug.length <= LIMITS.slug && SLUG_RE.test(slug);
}

/* ---------- what she types → values ---------- */

/** One-line text: spaces and line breaks collapsed, trimmed. */
export function cleanLine(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

/**
 * Multi-line text (testo, bio): Windows line ends → \n, no control characters, no spaces at line
 * ends, at most one blank line between paragraphs, trimmed.
 */
export function cleanText(value) {
  return String(value ?? '')
    .replace(/\r\n?/g, '\n')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
    .replace(/[ \t]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** "100", "100,5", "100.5", "100 cm" → number; "" → null. Returns { value } or { error }. */
export function parseMisura(input) {
  const text = String(input ?? '').trim().replace(/\s*cm$/i, '');
  if (!text) return { value: null };
  if (!/^\d{1,4}(?:[.,]\d+)?$/.test(text)) {
    return { error: 'Scrivi solo il numero dei centimetri, per esempio 100 o 100,5.' };
  }
  if (/[.,]\d{2,}$/.test(text)) return { error: 'Al massimo un decimale, per esempio 100,5.' };
  const value = Number(text.replace(',', '.'));
  if (!(value > 0) || value > MISURA_MAX) return { error: `La misura deve essere tra 0,1 e ${MISURA_MAX} cm.` };
  return { value };
}

/** "2024" → 2024; "" → null. Returns { value } or { error }. */
export function parseAnno(input) {
  const text = String(input ?? '').trim();
  if (!text) return { value: null };
  if (!/^\d{4}$/.test(text)) return { error: 'Scrivi l’anno con 4 cifre, per esempio 2024.' };
  const value = Number(text);
  if (value < ANNO_MIN || value > ANNO_MAX) return { error: `L’anno deve essere tra ${ANNO_MIN} e ${ANNO_MAX}.` };
  return { value };
}

/** 100.5 → "100,5" (Italian decimal comma). */
export function formatNumber(n) {
  return String(n).replace('.', ',');
}

/** "100 × 140 cm" (width × height), or "" unless both are set. */
export function formatMisure(larghezza, altezza) {
  if (larghezza == null || altezza == null) return '';
  return `${formatNumber(larghezza)} × ${formatNumber(altezza)} cm`;
}

/**
 * Form values (strings and booleans as typed) → clean artwork fields, or errors by field name.
 * @returns {{fields: object|null, errors: Record<string, string>}}
 */
export function parseOperaForm(form) {
  const errors = {};
  const titolo = cleanLine(form.titolo);
  if (!titolo) errors.titolo = 'Scrivi il titolo dell’opera.';
  else if (titolo.length > LIMITS.titolo) errors.titolo = `Il titolo può avere al massimo ${LIMITS.titolo} caratteri.`;
  const anno = parseAnno(form.anno);
  if (anno.error) errors.anno = anno.error;
  const larghezza = parseMisura(form.larghezza);
  if (larghezza.error) errors.larghezza = larghezza.error;
  const altezza = parseMisura(form.altezza);
  if (altezza.error) errors.altezza = altezza.error;
  const tecnica = cleanLine(form.tecnica);
  if (tecnica.length > LIMITS.tecnica) errors.tecnica = `Al massimo ${LIMITS.tecnica} caratteri.`;
  const collezione = cleanLine(form.collezione);
  if (collezione.length > LIMITS.collezione) errors.collezione = `Al massimo ${LIMITS.collezione} caratteri.`;
  const testo = cleanText(form.testo);
  if (testo.length > LIMITS.testo) errors.testo = `Il testo può avere al massimo ${LIMITS.testo} caratteri (ora ne ha ${testo.length}).`;
  if (Object.keys(errors).length) return { fields: null, errors };
  return {
    fields: {
      titolo,
      anno: anno.value,
      larghezza: larghezza.value,
      altezza: altezza.value,
      tecnica,
      collezione,
      testo,
      inEvidenza: Boolean(form.inEvidenza),
      pubblicata: Boolean(form.pubblicata),
    },
    errors,
  };
}

/* ---------- validation (section 4) ---------- */

const isIso = (v) => typeof v === 'string' && ISO_UTC_RE.test(v) && !Number.isNaN(Date.parse(v));
const hasOneDecimalAtMost = (v) => Math.abs(v * 10 - Math.round(v * 10)) < 1e-9;

function checkKeys(obj, keys, problems) {
  for (const key of Object.keys(obj)) if (!keys.includes(key)) problems.push(`campo sconosciuto «${key}»`);
  for (const key of keys) if (!(key in obj)) problems.push(`manca il campo «${key}»`);
}

function checkString(obj, key, max, problems, { required = false } = {}) {
  const v = obj[key];
  if (typeof v !== 'string') return problems.push(`«${key}» deve essere un testo`);
  if (required && !v.trim()) problems.push(`«${key}» è obbligatorio`);
  if (v.length > max) problems.push(`«${key}» supera ${max} caratteri`);
}

/** `./name.jpg` with a valid file name, or null. */
export function imageRefName(ref) {
  const m = typeof ref === 'string' ? /^\.\/([^/]+)$/.exec(ref) : null;
  return m && IMAGE_FILE_RE.test(m[1]) ? m[1] : null;
}

/** All problems of an opera.json object (empty array = valid). Messages are Italian, for logs and errors. */
export function validateOpera(o) {
  const problems = [];
  if (!o || typeof o !== 'object' || Array.isArray(o)) return ['non è un oggetto JSON'];
  checkKeys(o, OPERA_KEYS, problems);
  checkString(o, 'titolo', LIMITS.titolo, problems, { required: true });
  if (typeof o.titolo === 'string' && o.titolo !== o.titolo.trim()) problems.push('«titolo» ha spazi all’inizio o alla fine');
  if (o.anno !== null && !(Number.isInteger(o.anno) && o.anno >= ANNO_MIN && o.anno <= ANNO_MAX)) {
    problems.push(`«anno» deve essere vuoto o tra ${ANNO_MIN} e ${ANNO_MAX}`);
  }
  for (const key of ['larghezza', 'altezza']) {
    const v = o[key];
    if (v === null) continue;
    if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0 || v > MISURA_MAX || !hasOneDecimalAtMost(v)) {
      problems.push(`«${key}» deve essere vuoto o un numero tra 0,1 e ${MISURA_MAX} con al massimo un decimale`);
    }
  }
  checkString(o, 'tecnica', LIMITS.tecnica, problems);
  checkString(o, 'collezione', LIMITS.collezione, problems);
  checkString(o, 'testo', LIMITS.testo, problems);
  if (!Array.isArray(o.immagini) || o.immagini.length < 1 || o.immagini.length > MAX_IMMAGINI) {
    problems.push(`«immagini» deve avere da 1 a ${MAX_IMMAGINI} foto`);
  } else {
    for (const ref of o.immagini) if (!imageRefName(ref)) problems.push(`nome di foto non valido: ${String(ref)}`);
    if (new Set(o.immagini).size !== o.immagini.length) problems.push('la stessa foto compare due volte');
  }
  if (!Number.isInteger(o.ordine)) problems.push('«ordine» deve essere un numero intero');
  for (const key of ['inEvidenza', 'pubblicata']) if (typeof o[key] !== 'boolean') problems.push(`«${key}» deve essere vero o falso`);
  for (const key of ['creataIl', 'aggiornataIl']) if (!isIso(o[key])) problems.push(`«${key}» non è una data ISO (UTC)`);
  return problems;
}

/** All problems of a profilo.json object (empty array = valid). */
export function validateProfilo(p) {
  const problems = [];
  if (!p || typeof p !== 'object' || Array.isArray(p)) return ['non è un oggetto JSON'];
  checkKeys(p, PROFILO_KEYS, problems);
  checkString(p, 'motto', LIMITS.motto, problems);
  checkString(p, 'bio', LIMITS.bio, problems);
  if (p.ritratto !== null && !imageRefName(p.ritratto)) problems.push('«ritratto» deve essere vuoto o una foto ./nome.jpg');
  if (!isIso(p.aggiornatoIl)) problems.push('«aggiornatoIl» non è una data ISO (UTC)');
  return problems;
}

/* ---------- serialisation ---------- */

function serialize(obj, keys) {
  return `${JSON.stringify(Object.fromEntries(keys.map((k) => [k, obj[k]])), null, 2)}\n`;
}

/** opera.json text: documented key order, 2-space indent, trailing newline. */
export function serializeOpera(opera) {
  return serialize(opera, OPERA_KEYS);
}

/** profilo.json text: documented key order, 2-space indent, trailing newline. */
export function serializeProfilo(profilo) {
  return serialize(profilo, PROFILO_KEYS);
}

/* ---------- order, names, commit messages ---------- */

/** Ascending `ordine`; ties: newest `creataIl` first. Items are { data } or plain opera objects. */
export function compareOpere(a, b) {
  const x = a.data || a;
  const y = b.data || b;
  if (x.ordine !== y.ordine) return x.ordine - y.ordine;
  return x.creataIl < y.creataIl ? 1 : x.creataIl > y.creataIl ? -1 : 0;
}

/** `ordine` for a new work: shown first (min − 10), or 10 for the very first one. */
export function nextOrdine(ordini) {
  const values = ordini.filter(Number.isInteger);
  return values.length ? Math.min(...values) - 10 : 10;
}

/** "03-k2x9qa.jpg": 2-digit position at upload time + 6 random characters. */
export function imageFileName(position, random = randomId(6)) {
  return `${String(position).padStart(2, '0')}-${random}.jpg`;
}

/** "ritratto-k2x9qa.jpg" */
export function portraitFileName(random = randomId(6)) {
  return `ritratto-${random}.jpg`;
}

export function commitMessage(action, titolo = '') {
  switch (action) {
    case 'create':
      return `opera: aggiunta «${titolo}»`;
    case 'update':
      return `opera: modificata «${titolo}»`;
    case 'delete':
      return `opera: eliminata «${titolo}»`;
    case 'reorder':
      return 'opere: nuovo ordine';
    case 'profilo':
      return 'profilo: aggiornato';
    default:
      throw new Error(`commitMessage: azione sconosciuta ${action}`);
  }
}
