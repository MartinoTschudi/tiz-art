/**
 * Layout rules of the artwork page (/opere/<slug>/, frames 1f desktop and 1g phone): the counter
 * line and the `sizes` of the stage and thumbnail images, computed from the same numbers as the CSS
 * of ArtworkGallery.astro and ArtworkPager.astro (keep them in step).
 *
 * Pure functions on plain data: no `astro:*` imports and only erasable TypeScript, so
 * `scripts/test/opera.test.mjs` imports this file directly through Node's type stripping.
 */
import { PAGE_MAX, gutterAt } from './composition.ts';

/** --tiz-page-max of tokens.css (from composition.ts): the page column stops growing there. */
export { PAGE_MAX };

/** Desktop aside of the artwork page and the gap before it (grid `minmax(0,1fr) 400px`, gap 64). */
const ASIDE = 400;
const ASIDE_GAP = 64;

export interface StageLayout {
  /** Breakpoint from which this layout applies (px). */
  minWidth: number;
  /** Viewport width minus the stage column width (gutters, and on desktop the 400 px aside + 64 px gap). */
  off: number;
  /** Highest stage height (px). On desktop and tablet it gets lower on short screens (svh), never higher. */
  height: number;
  /** The painting fills at most fitW of the stage width and fitH of its height (never cropped). */
  fitW: number;
  fitH: number;
}

/**
 * Stage of the cover, widest layout first.
 * - ≥ 1024: grid `minmax(0,1fr) 400px`, gap 64, gutters 48; stage 720 high, painting ≤ 88 % × 92 %.
 * - 640–1023: stacked, gutters 32; stage 600 high, same fit.
 * - < 640: gutters 20; a 440 px box the painting fills (max-width/max-height 100 %).
 */
export const STAGE: readonly StageLayout[] = [
  { minWidth: 1024, off: 2 * gutterAt(1024) + ASIDE + ASIDE_GAP, height: 720, fitW: 0.88, fitH: 0.92 },
  { minWidth: 640, off: 2 * gutterAt(640), height: 600, fitW: 0.88, fitH: 0.92 },
  { minWidth: 0, off: 2 * gutterAt(0), height: 440, fitW: 1, fitH: 1 },
];

/** Height of the extra-photo thumbnails under the stage (px): phone, then from 640 px. */
export const THUMB_H = { phone: 64, wide: 84 } as const;
/** Height of the previous / next thumbnails (px). */
export const PAGER_THUMB_H = 84;

const px = (value: number) => `${Math.round(value)}px`;
const safeRatio = (ratio: number) => (Number.isFinite(ratio) && ratio > 0 ? ratio : 1);

/** fitW × (100vw − off) as a CSS calc(): "calc(88vw - 493px)", "calc(100vw - 40px)". */
function fluid({ fitW, off }: StageLayout): string {
  const vw = Math.round(fitW * 100 * 100) / 100;
  return `calc(${vw}vw - ${Math.round(fitW * off)}px)`;
}

/**
 * `sizes` of a photo on the stage, from its aspect ratio (width / height), without min() so every
 * browser understands it. The painting is `min(fitW × column, fitH × height × ratio)` wide.
 * Example (Sorellanza, photo 1574 × 2400):
 * "(min-width: 1054px) 434px, (min-width: 1024px) calc(88vw - 493px), (min-width: 640px) 362px,
 *  (min-width: 329px) 289px, calc(100vw - 40px)".
 */
export function stageSizes(ratio: number): string {
  const r = safeRatio(ratio);
  const parts: string[] = [];
  const push = (minWidth: number, value: string) => parts.push(minWidth > 0 ? `(min-width: ${minWidth}px) ${value}` : value);
  let upper = Infinity;
  for (const layout of STAGE) {
    const cap = layout.fitH * layout.height * r; // width when the height is the limit
    const at = (vw: number) => layout.fitW * (vw - layout.off); // width when the column is the limit
    const cross = cap / layout.fitW + layout.off; // viewport width from which the height limits
    let hi = upper;
    if (layout.minWidth >= 1024 && cross > PAGE_MAX) {
      // The column stops growing at the page width before the height limit is reached.
      push(PAGE_MAX, px(at(PAGE_MAX)));
      hi = PAGE_MAX;
    }
    if (cross <= layout.minWidth) {
      push(layout.minWidth, px(cap));
    } else {
      if (cross < hi) push(Math.ceil(cross), px(cap));
      push(layout.minWidth, fluid(layout));
    }
    upper = layout.minWidth;
  }
  return parts.join(', ');
}

/** `sizes` of an extra-photo thumbnail under the stage (fixed height, real proportions). */
export function thumbSizes(ratio: number): string {
  const r = safeRatio(ratio);
  return `(min-width: 640px) ${Math.ceil(THUMB_H.wide * r)}px, ${Math.ceil(THUMB_H.phone * r)}px`;
}

/** `sizes` of a previous / next thumbnail. */
export function pagerThumbSizes(ratio: number): string {
  return `${Math.ceil(PAGER_THUMB_H * safeRatio(ratio))}px`;
}

export interface Counter {
  /** "01 / 12" as shown: the number with two digits at least. */
  text: string;
  /** "Opera 1 di 12" for screen readers. */
  spoken: string;
}

/** The work's position in the published list: index 0 of 12 → "01 / 12". */
export function operaCounter(index: number, total: number): Counter {
  const n = Math.max(0, index) + 1;
  return { text: `${String(n).padStart(2, '0')} / ${total}`, spoken: `Opera ${n} di ${total}` };
}
