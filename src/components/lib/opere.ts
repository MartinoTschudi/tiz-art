/**
 * Artworks: queries (what is shown, in which order) and text formatting shared by all pages.
 */
import { getCollection, getEntry, type CollectionEntry } from 'astro:content';
import { SITE } from './site';
import { paintName, paintVar, type PaintName } from './composition';

export type Opera = CollectionEntry<'opere'>;
export type Profilo = CollectionEntry<'profilo'>;

/** Works on the home page when none is marked "in evidenza". */
const FEATURED_FALLBACK = 6;

/** `ordine` ascending; ties: newest `creataIl` first (CONTRACTS 4.1). */
function byOrder(a: Opera, b: Opera): number {
  return a.data.ordine - b.data.ordine || b.data.creataIl.localeCompare(a.data.creataIl);
}

/** Every work, drafts included (only for the admin thumbnail index). */
export async function getAllOpere(): Promise<Opera[]> {
  return (await getCollection('opere')).sort(byOrder);
}

/** The works visible on the public site, in display order. */
export async function getPublishedOpere(): Promise<Opera[]> {
  return (await getCollection('opere', ({ data }) => data.pubblicata)).sort(byOrder);
}

/** Home-page selection: the works "in evidenza", or the first few if none is marked. */
export async function getFeaturedOpere(): Promise<Opera[]> {
  const published = await getPublishedOpere();
  const featured = published.filter(({ data }) => data.inEvidenza);
  return featured.length > 0 ? featured : published.slice(0, FEATURED_FALLBACK);
}

export async function getProfilo(): Promise<Profilo['data']> {
  const entry = await getEntry('profilo', 'profilo');
  if (!entry) throw new Error('src/content/profilo/profilo.json is missing.');
  return entry.data;
}

export interface Gruppo {
  /** Series name; "" for works without one. */
  collezione: string;
  opere: Opera[];
}

/** Groups works by series, in the order the series first appear (works keep their order). */
export function groupByCollezione(opere: Opera[]): Gruppo[] {
  const groups = new Map<string, Opera[]>();
  for (const opera of opere) {
    const key = opera.data.collezione.trim();
    groups.set(key, [...(groups.get(key) ?? []), opera]);
  }
  // Works without a series go last.
  return [...groups]
    .map(([collezione, list]) => ({ collezione, opere: list }))
    .sort((a, b) => Number(a.collezione === '') - Number(b.collezione === ''));
}

/** Previous / next published work (wraps around), for the artwork page. */
export function neighbours(opere: Opera[], slug: string): { prev?: Opera; next?: Opera } {
  const index = opere.findIndex((opera) => opera.id === slug);
  if (index === -1 || opere.length < 2) return {};
  return {
    prev: opere[(index - 1 + opere.length) % opere.length],
    next: opere[(index + 1) % opere.length],
  };
}

// Italian decimal comma ("100,5"), exactly as the admin shows sizes and asks her to type them.
// ('it-CH' would print "100.5"; sizes are ≤ 1000, so no thousands separator is ever needed.)
const numberFormat = new Intl.NumberFormat('it', { maximumFractionDigits: 1, useGrouping: false });

/** "100 × 140 cm" (width × height), or null unless both are set. */
export function formatDimensions({ larghezza, altezza }: Opera['data']): string | null {
  if (larghezza == null || altezza == null) return null;
  return `${numberFormat.format(larghezza)} × ${numberFormat.format(altezza)} cm`;
}

/** Year and size, whichever are set: ["2023", "100 × 140 cm"]. */
export function metaParts(data: Opera['data']): string[] {
  return [data.anno ? String(data.anno) : '', formatDimensions(data) ?? ''].filter(Boolean);
}

/** Short line for cards and lists: "2023 · 100 × 140 cm". */
export function metaLine(data: Opera['data']): string {
  return metaParts(data).join(' · ');
}

/** «Titolo», Tiziana Tschudi Belloli, 2023 (+ ", dettaglio N" for the extra photos). */
export function altText(data: Opera['data'], imageIndex = 0): string {
  const parts = [`«${data.titolo}»`, SITE.nome, data.anno].filter(Boolean);
  if (imageIndex > 0) parts.push(`dettaglio ${imageIndex}`);
  return parts.join(', ');
}

/**
 * Plain text (CONTRACTS 4.1) → paragraphs → lines.
 * A blank line separates paragraphs, a single newline is a line break. Never interpreted as HTML.
 */
export function paragraphs(text: string): string[][] {
  return text
    .replace(/\r\n?/g, '\n')
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.split('\n').map((line) => line.trim()).filter(Boolean))
    .filter((lines) => lines.length > 0);
}

/** One line of at most `max` characters, cut at a word boundary (meta descriptions). */
export function excerpt(text: string, max = 155): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  if (flat.length <= max) return flat;
  const cut = flat.slice(0, max - 1);
  const atWord = cut.slice(0, Math.max(cut.lastIndexOf(' '), max / 2));
  return `${atWord.replace(/[\s,;:.–—-]+$/, '')}…`;
}

/** Meta description of an artwork: its text, or a factual sentence when the text is empty. */
export function operaDescription(data: Opera['data']): string {
  if (data.testo.trim()) return excerpt(data.testo);
  const facts = [data.anno, data.tecnica.toLowerCase(), formatDimensions(data)].filter(Boolean).join(', ');
  return excerpt(`«${data.titolo}»${facts ? `, ${facts}` : ''}. Un’opera di ${SITE.nome}.`);
}

/**
 * Colour of the work's brushstroke: its `colore`, or the automatic one from its position in the
 * published list (lib/composition.ts → paintName), so it is the same on every page. `published` =
 * getPublishedOpere(). Reads `colore` defensively: works saved by an older admin have no such key.
 */
export function operaPaint(opera: Opera, published: readonly Opera[]): PaintName {
  const colore = (opera.data as Record<string, unknown>).colore;
  return paintName(typeof colore === 'string' ? colore : null, published.findIndex(({ id }) => id === opera.id));
}

/** The paint as a CSS value for Stroke: "var(--tiz-ottanio)". */
export function operaPaintVar(opera: Opera, published: readonly Opera[]): string {
  return paintVar(operaPaint(opera, published));
}

/** A work in the plain shape the composition rules take (heroSlots, pickQuote, pickSeries). */
export interface ComposableOpera {
  id: string;
  w: number | null;
  h: number | null;
  /** width / height from the centimetres, else from the cover photo. */
  ratio: number;
  featured: boolean;
  testo: string;
  collezione: string;
  anno: number | null;
  opera: Opera;
}

/**
 *   const works = composable(await getPublishedOpere());
 *   const hero = heroSlots(works);                          // hero.large?.opera …
 *   const quote = pickQuote(works, hero.picked.map((w) => w.id));
 */
export function composable(opere: readonly Opera[]): ComposableOpera[] {
  return opere.map((opera) => {
    const { larghezza: w, altezza: h, immagini, inEvidenza, testo, collezione, anno } = opera.data;
    const ratio = w && h ? w / h : immagini[0].width / immagini[0].height;
    return { id: opera.id, w, h, ratio, featured: inEvidenza, testo, collezione, anno, opera };
  });
}
