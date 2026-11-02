/**
 * Composition rules of the «Lo studio» design: which colour a work's stroke gets, how works are hung
 * in lists, how the motto breaks, which works fill the home hero, which sentence becomes the quote and
 * which series the home shows.
 *
 * Pure functions on plain data: no `astro:*` imports and only erasable TypeScript (no enums, no
 * parameter properties), so `scripts/test/composition.test.mjs` imports this file directly through
 * Node's type stripping. Pages map their content entries to these small shapes.
 */

// ── Paint (stroke colour) ─────────────────────────────────────────────────────────────────────────

/** The five paints a work's `colore` can name (CONTRACTS §4.1). */
export const PAINTS = ['ocra', 'rosso', 'terracotta', 'ottanio', 'blu'] as const;
export type PaintName = (typeof PAINTS)[number];

/** Automatic colour (`colore: null`), indexed by the work's position in the full published list. */
export const PAINT_CYCLE: readonly PaintName[] = ['ocra', 'rosso', 'ottanio', 'terracotta', 'blu'];

export function isPaintName(value: unknown): value is PaintName {
  return typeof value === 'string' && (PAINTS as readonly string[]).includes(value);
}

/**
 * The work's paint: its own `colore`, else the automatic one from its index in `getPublishedOpere()`
 * (so a work keeps its colour on every page). A missing/unknown value or index counts as automatic.
 */
export function paintName(colore: string | null | undefined, publishedIndex: number): PaintName {
  if (isPaintName(colore)) return colore;
  const index = Number.isInteger(publishedIndex) && publishedIndex > 0 ? publishedIndex : 0;
  return PAINT_CYCLE[index % PAINT_CYCLE.length];
}

/** "ottanio" → "var(--tiz-ottanio)". */
export function paintVar(name: PaintName): string {
  return `var(--tiz-${name})`;
}

// ── Hung by eye (HungWorks) ───────────────────────────────────────────────────────────────────────

/** Desktop/tablet margin-top cycle (px), index mod 8. */
export const MT = [0, 140, 60, 200, 20, 110, 40, 170] as const;
/** Phone align-self cycle, index mod 5. */
export const AL = ['flex-start', 'flex-end', 'center', 'flex-end', 'flex-start'] as const;
/** Stroke offset cycles behind a painting (index mod 4): left, top, rotate. */
export const SWL = ['-36px', '30%', '-24px', '25%'] as const;
export const SWT = ['40px', '-30px', '25%', '10px'] as const;
export const SWR = ['-5deg', '4deg', '-3deg', '7deg'] as const;

export interface StrokePlacement {
  left: string;
  top: string;
  rotate: string;
}

/** Stroke position for the n-th painting of a list (any integer, negative included). */
export function strokeAt(index: number): StrokePlacement {
  const i = mod(index, 4);
  return { left: SWL[i], top: SWT[i], rotate: SWR[i] };
}

export interface HungPlacement {
  /** margin-top in px (≥ 640). */
  mt: number;
  /** align-self (< 640). */
  align: (typeof AL)[number];
  /** Only even indexes get a stroke. */
  stroke: StrokePlacement | null;
}

export function hungAt(index: number): HungPlacement {
  return {
    mt: MT[mod(index, MT.length)],
    align: AL[mod(index, AL.length)],
    stroke: mod(index, 2) === 0 ? strokeAt(index) : null,
  };
}

// ── Page frame (shared by every layout helper: opera.ts and chi.ts import these) ──────────────────

/** --tiz-page-max of tokens.css: the page column (gutters included) never gets wider. */
export const PAGE_MAX = 1440;

/** --tiz-gutter of tokens.css per breakpoint (px), widest first. */
export const GUTTERS = [
  { minWidth: 1024, gutter: 48 },
  { minWidth: 640, gutter: 32 },
  { minWidth: 0, gutter: 20 },
] as const;

/** The page gutter at a viewport width (px). */
export function gutterAt(viewport: number): number {
  return (GUTTERS.find(({ minWidth }) => viewport >= minWidth) ?? GUTTERS[GUTTERS.length - 1]).gutter;
}

/** Real-scale factor k (px per cm) per breakpoint; keep in step with --tiz-k in tokens.css. */
export const REAL_SCALE = [
  { minWidth: 1024, k: 2.3, gutter: gutterAt(1024) },
  { minWidth: 640, k: 2.0, gutter: gutterAt(640) },
  { minWidth: 0, k: 2.2, gutter: gutterAt(0) },
] as const;
/** Width used for the layout when a work has no `larghezza` (the size text is then hidden). */
export const DEFAULT_CM = 100;

/**
 * `sizes` for a painting shown at real scale (`min(cm × k px, 100%)` inside a .container), without
 * min() so every browser understands it. Example (100 cm):
 * "(min-width: 1024px) 230px, (min-width: 640px) 200px, (min-width: 260px) 220px, calc(100vw - 40px)".
 */
export function realScaleSizes(cm: number | null | undefined): string {
  const width = typeof cm === 'number' && cm > 0 ? cm : DEFAULT_CM;
  const parts: string[] = [];
  let upper = Infinity; // an earlier entry already answers for viewports ≥ upper
  const when = (from: number) => (from > 0 ? `(min-width: ${from}px) ` : '');
  for (const { minWidth, k, gutter } of REAL_SCALE) {
    const px = Math.round(width * k);
    const full = px + 2 * gutter; // viewport width from which the painting has its full real-scale size
    if (minWidth === 1024 && px > PAGE_MAX - 2 * gutter) {
      parts.push(`${when(PAGE_MAX)}${PAGE_MAX - 2 * gutter}px`);
      upper = PAGE_MAX;
    }
    if (full <= minWidth) {
      parts.push(`${when(minWidth)}${px}px`);
    } else {
      if (full < upper) parts.push(`${when(full)}${px}px`);
      parts.push(`${when(minWidth)}calc(100vw - ${2 * gutter}px)`);
    }
    upper = minWidth;
  }
  return parts.join(', ');
}

// ── Motto ─────────────────────────────────────────────────────────────────────────────────────────

/** How many characters the first motto line may be shorter than the best split and still win. */
const NEAR_TIE = 2;

export interface MottoParts {
  /** The lines; the last one is `lastWord` alone. Empty for an empty motto. */
  lines: string[];
  /** Shown in rosso. "" for an empty motto. */
  lastWord: string;
}

/**
 * "Dialogo tra testa e cuore." → { lines: ["Dialogo tra", "testa e", "cuore"], lastWord: "cuore" }.
 * The trailing "." / "!" is dropped (the hero draws a beating dot instead). The last word gets its
 * own line; the other words are split into two lines balanced by character count, and on a tie or
 * near-tie (≤ 2 characters) the first line is the longer one. 1 word → 1 line, 2 words → 2 lines.
 */
export function mottoParts(motto: string): MottoParts {
  const words = collapse(motto).replace(/[.!]+$/u, '').trim().split(' ').filter(Boolean);
  if (words.length === 0) return { lines: [], lastWord: '' };
  const lastWord = words[words.length - 1];
  const rest = words.slice(0, -1);
  if (rest.length <= 1) return { lines: [...rest, lastWord], lastWord };

  // Every split after word 1 … n-1: diff = first − second (in characters).
  const splits = rest.slice(1).map((_, i) => {
    const first = rest.slice(0, i + 1).join(' ');
    const second = rest.slice(i + 1).join(' ');
    return { first, second, diff: first.length - second.length };
  });
  const best = Math.min(...splits.map((s) => Math.abs(s.diff)));
  // First line longer (or equal) and within NEAR_TIE of the best balance wins; else the best balance.
  const firstLonger = splits.filter((s) => s.diff >= 0 && s.diff <= best + NEAR_TIE);
  const pick = firstLonger.length > 0 ? firstLonger.reduce((a, b) => (b.diff < a.diff ? b : a)) : splits.find((s) => Math.abs(s.diff) === best)!;
  return { lines: [pick.first, pick.second, lastWord], lastWord };
}

export interface LastWord {
  /** Everything before the word. */
  before: string;
  /** The last run of letters or digits ("alleanza", "2023"); "" when the text has neither. */
  word: string;
  /** What follows it: the closing punctuation ("." / "!" / "…»"). */
  after: string;
}

/**
 * "…un’altra: alleanza." → { before: "…un’altra: ", word: "alleanza", after: "." } (whitespace collapsed).
 * A closing number is the last word too ("…nel 2023." → "2023"), never the word before it.
 */
export function splitLastWord(text: string): LastWord {
  const flat = collapse(text);
  const match = /([\p{L}\p{N}][\p{L}\p{M}\p{N}]*)([^\p{L}\p{N}]*)$/u.exec(flat);
  if (!match) return { before: flat, word: '', after: '' };
  return { before: flat.slice(0, match.index), word: match[1], after: match[2] };
}

// ── Hero ──────────────────────────────────────────────────────────────────────────────────────────

export interface HeroWork {
  id: string;
  /** Centimetres (may be null). */
  w: number | null;
  h: number | null;
  /** width / height: from cm, else from the cover's pixel size. */
  ratio: number;
  /** `inEvidenza`. */
  featured: boolean;
}

export interface HeroSlots<T extends HeroWork> {
  /** The most square work. */
  large?: T;
  /** The tallest of the rest. */
  narrow?: T;
  small?: T;
  /** The chosen works in the order they were picked (featured in display order, then the fill). */
  picked: T[];
}

/**
 * The home hero. `works` = the published works in display order. Picks the first 3 featured works,
 * fills up with the first other published works, then: most square (|ratio − 1|; ties → larger
 * canvas area, then display order) → large; tallest of the rest (smallest ratio) → narrow; the
 * remaining one → small. Fewer than 3 works → only the slots used.
 */
export function heroSlots<T extends HeroWork>(works: readonly T[]): HeroSlots<T> {
  const featured = works.filter((work) => work.featured).slice(0, 3);
  const picked = [...featured, ...works.filter((work) => !featured.includes(work))].slice(0, 3);
  const order = (work: T) => works.indexOf(work);
  const area = (work: T) => (work.w ?? 0) * (work.h ?? 0);
  const squareness = (work: T) => Math.abs(work.ratio - 1);

  const bySquare = [...picked].sort(
    (a, b) => squareness(a) - squareness(b) || area(b) - area(a) || order(a) - order(b),
  );
  const large = bySquare[0];
  const rest = picked.filter((work) => work !== large).sort((a, b) => a.ratio - b.ratio || order(a) - order(b));
  const slots: HeroSlots<T> = { picked };
  if (large) slots.large = large;
  if (rest[0]) slots.narrow = rest[0];
  if (rest[1]) slots.small = rest[1];
  return slots;
}

// ── Quote ─────────────────────────────────────────────────────────────────────────────────────────

const CLOSERS = '»”’"\')\\]';
const OPENERS = '«“‘"\'(';

/**
 * The first sentence: up to and including the first . ! ? followed by whitespace or the end.
 * Closing quotes/brackets right after it are kept, and then it ends only before an uppercase letter
 * or at the end («Basta.» Poi… ends; «Guardami!» disse lei… goes on). An ellipsis (… or ...) ends a
 * sentence only before whitespace + an uppercase letter, or at the end. Whitespace is collapsed; no
 * terminator → the whole text.
 */
export function firstSentence(text: string): string {
  const flat = collapse(text);
  const beforeCapital = `(?=$|\\s+[${OPENERS}]?\\p{Lu})`;
  const end = new RegExp(
    `(?:…|\\.{3})[${CLOSERS}]*${beforeCapital}|(?<!\\.)[.!?](?!\\.)(?:(?=$|\\s)|[${CLOSERS}]+${beforeCapital})`,
    'u',
  );
  const match = end.exec(flat);
  return match ? flat.slice(0, match.index + match[0].length) : flat;
}

export interface QuoteWork {
  id: string;
  testo: string;
}

export interface Quote {
  id: string;
  sentence: string;
  before: string;
  /** Last word of the sentence without punctuation (shown in rosso). */
  keyWord: string;
  /** The closing punctuation after it. */
  after: string;
}

export const QUOTE_MIN = 20;
export const QUOTE_MAX = 140;

/**
 * The home quote: from the LAST published work backwards (display order), skipping `heroIds`, the
 * first work whose first sentence is 20–140 characters long. null = none (the band is hidden).
 */
export function pickQuote(works: readonly QuoteWork[], heroIds: Iterable<string> = []): Quote | null {
  const hero = new Set(heroIds);
  for (let i = works.length - 1; i >= 0; i--) {
    const work = works[i];
    if (hero.has(work.id)) continue;
    const sentence = firstSentence(work.testo);
    const length = [...sentence].length;
    if (length < QUOTE_MIN || length > QUOTE_MAX) continue;
    const { before, word, after } = splitLastWord(sentence);
    if (!word) continue;
    return { id: work.id, sentence, before, keyWord: word, after };
  }
  return null;
}

// ── Series ────────────────────────────────────────────────────────────────────────────────────────

export interface SeriesWork {
  id: string;
  collezione: string;
  anno: number | null;
}

export interface Series<T extends SeriesWork> {
  /** The series name; null = no series (the caller titles the section "Le ultime opere"). */
  name: string | null;
  /** Latest `anno` of the series' published works, or null. */
  year: number | null;
  works: T[];
}

export const SERIES_COUNT = 5;

/**
 * The home series section. `works` = published works in display order. The series is the
 * `collezione` of `seriesOf` (default: the first id of `excludeIds`, so pass the hero ids first),
 * else the most common non-empty `collezione` (ties → the one met first). Returns up to 5 of its
 * works not in `excludeIds`. No series, or none of its works left → name null and the first 5
 * works not excluded.
 */
export function pickSeries<T extends SeriesWork>(
  works: readonly T[],
  excludeIds: Iterable<string> = [],
  seriesOf?: string,
): Series<T> {
  const excludedList = [...excludeIds];
  const excluded = new Set(excludedList);
  const anchorId = seriesOf ?? excludedList[0];
  const anchor = works.find((work) => work.id === anchorId);
  const name = anchor?.collezione.trim() || mostCommonSeries(works);
  const free = works.filter((work) => !excluded.has(work.id));
  if (name) {
    const inSeries = works.filter((work) => work.collezione.trim() === name);
    const shown = free.filter((work) => work.collezione.trim() === name).slice(0, SERIES_COUNT);
    if (shown.length > 0) {
      const years = inSeries.map((work) => work.anno).filter((anno): anno is number => typeof anno === 'number');
      return { name, year: years.length > 0 ? Math.max(...years) : null, works: shown };
    }
  }
  return { name: null, year: null, works: free.slice(0, SERIES_COUNT) };
}

function mostCommonSeries(works: readonly SeriesWork[]): string | null {
  const counts = new Map<string, number>();
  for (const work of works) {
    const name = work.collezione.trim();
    if (name) counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  let best: string | null = null;
  for (const [name, count] of counts) if (best === null || count > counts.get(best)!) best = name;
  return best;
}

// ── Long titles ───────────────────────────────────────────────────────────────────────────────────

/**
 * A work title or a series name longer than this (characters) gets the next smaller type step where
 * it is a display heading (the Opera h1, the home series title): up to 120 are allowed.
 */
export const LONG_TITLE = 40;

export function isLongTitle(text: string): boolean {
  return [...collapse(text)].length > LONG_TITLE;
}

// ── Utilities ─────────────────────────────────────────────────────────────────────────────────────

function collapse(text: string): string {
  return (text ?? '').replace(/\s+/gu, ' ').trim();
}

function mod(n: number, m: number): number {
  return ((Math.trunc(n) % m) + m) % m;
}
