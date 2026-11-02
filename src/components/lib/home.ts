/**
 * Copy and small text rules of the Home page (frames 1b / 1c) and the Opere list (1d / 1e / 1l).
 *
 * Pure functions on plain data: no `astro:*` imports and only erasable TypeScript, so
 * `scripts/test/home.test.mjs` imports this file directly through Node's type stripping.
 */
import type { PaintName } from './composition';

/** The hero paragraph under the motto (site copy of the design, not admin data). */
export const HOME_INTRO = 'Volti e corpi di donna, in acrilico e olio, a strati spessi. Quadri che nascono di getto — dal cuore, poi dalla testa.';

/**
 * Stroke colour of each hero slot. The hero is one composition, so the colours belong to the slots
 * (frame 1b: rosso behind the large work, ottanio behind the narrow one, ocra behind the small one),
 * not to the works: three featured works with the same `colore` would otherwise give three strokes
 * of one colour.
 */
export const HERO_PAINTS: Readonly<Record<'large' | 'narrow' | 'small', PaintName>> = {
  large: 'rosso',
  narrow: 'ottanio',
  small: 'ocra',
};

/**
 * `sizes` of the hero paintings. ≥ 1024 the works hang on a "wall" of min(622px, 52.53%) of the
 * content box (1184 px wide at 1280, the reference frame), so up to 1280 they shrink with the
 * viewport: content = 100vw − 2 × 48 px. Below 1024 only the large one shows (flow layout).
 */
export const HERO_SIZES = {
  // 400 px at 1280 (= 64.31% of the wall); phone: 290 px, or the column minus its 40 px inset.
  large: '(min-width: 1280px) 400px, (min-width: 1024px) calc(33.78vw - 32px), (min-width: 640px) 400px, (min-width: 370px) 290px, calc(100vw - 80px)',
  // 150 px at 1280 (24.12% of the wall); hidden below 1024 (lazy, so never fetched there).
  narrow: '(min-width: 1280px) 150px, (min-width: 1024px) calc(12.67vw - 12px), 150px',
  // 230 px at 1280 (36.98% of the wall); hidden below 1024.
  small: '(min-width: 1280px) 230px, (min-width: 1024px) calc(19.43vw - 19px), 230px',
} as const;

/** `sizes` of the quote painting: 340 px ≥ 1024, 85% of the 240 px column at 640–1023, hidden below. */
export const QUOTE_SIZES = '(min-width: 1024px) 340px, (min-width: 640px) 204px, 340px';

/** The handwritten note under the large hero work: "Guardami!, 2023" (no year → the title alone). */
export function heroNote(titolo: string, anno: number | null | undefined): string {
  return anno ? `${titolo}, ${anno}` : titolo;
}

/**
 * Longest motto line in characters (at least 8), for the font-size rule that keeps the longest
 * line inside its column (TIZ Mano is ≈ 0.31 em per character).
 */
export function longestLine(lines: readonly string[]): number {
  return Math.max(8, ...lines.map((line) => [...line].length));
}

/**
 * The link under the series: "Tutte le 12 opere". The series only shows works outside the hero
 * (up to 3), so there are always at least 4 when the link is on the page.
 */
export function allWorksLabel(count: number): string {
  return `Tutte le ${count} opere`;
}

/** "Tiziana Tschudi Belloli" → "Tiziana". */
export function firstName(name: string): string {
  return name.trim().split(/\s+/u)[0] ?? '';
}

/**
 * Attribution under the home quote: "— Tiziana, su «Sorellanza», 120 × 150 cm" (the size only when
 * it is known). The arrow is added by the page (decorative).
 */
export function quoteAttribution(artist: string, titolo: string, misure: string | null | undefined): string {
  return `— ${artist}, su «${titolo}»${misure ? `, ${misure}` : ''}`;
}

export interface CountNote {
  /** Phone: "12 tele" / "1 tela". */
  short: string;
  /** The rest of the desktop note: ", appese come nello studio" / ", appesa come nello studio". */
  rest: string;
}

/** The handwritten note next to "Opere": "12 tele, appese come nello studio" (phone: "12 tele"). */
export function opereCountNote(count: number): CountNote {
  const one = count === 1;
  return { short: one ? '1 tela' : `${count} tele`, rest: one ? ', appesa come nello studio' : ', appese come nello studio' };
}
