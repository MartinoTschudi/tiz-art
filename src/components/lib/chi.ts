/**
 * Layout rules of the "Chi sono" picture (frames 1h / 1i): her portrait, or, without one, the first
 * hero painting. Pure functions (no `astro:*` imports, erasable TypeScript only), tested in
 * scripts/test/chi.test.mjs through Node's type stripping.
 *
 * The picture sits in a box per breakpoint (desktop 400 × 500, i.e. the 4:5 portrait of the design;
 * tablet 360 × 450; phone 280 × 350), indented from the column edge so the brushstroke behind it can
 * show on the left. Keep these numbers in step with the CSS of src/components/chi/ChiFigure.astro.
 * - The portrait is a photo, so it may fill the 4:5 box with `object-fit: cover` (the only place on
 *   the site where cropping is allowed).
 * - A painting is never cropped: it is scaled to fit inside the box at its own ratio ("contain").
 */
import { gutterAt } from './composition.ts';

export interface ChiBox {
  /** Viewport width (px) from which this box applies. */
  minWidth: number;
  /** Box width and height (px). */
  w: number;
  h: number;
  /** Left indent of the picture inside its column (px). */
  indent: number;
  /** Page gutter at this breakpoint (px), = --tiz-gutter. */
  gutter: number;
}

export const CHI_BOXES: readonly ChiBox[] = [
  { minWidth: 1024, w: 400, h: 500, indent: 30, gutter: gutterAt(1024) },
  { minWidth: 640, w: 360, h: 450, indent: 40, gutter: gutterAt(640) },
  { minWidth: 0, w: 280, h: 350, indent: 40, gutter: gutterAt(0) },
];

/** Width / height of the portrait box (4:5). */
export const PORTRAIT_RATIO = 4 / 5;

/** Width (px) of a picture of `ratio` (width / height) fitted inside a box: never wider or taller. */
export function fitWidth(box: Pick<ChiBox, 'w' | 'h'>, ratio: number): number {
  const r = validRatio(ratio);
  return Math.round(Math.min(box.w, box.h * r));
}

/**
 * How much wider than its box an image is drawn with `object-fit: cover` (1 when the photo is at
 * least as tall as the box; a wider photo is scaled to the box height and overflows sideways).
 */
export function coverFactor(boxRatio: number, photoRatio: number): number {
  return Math.max(1, validRatio(photoRatio) / validRatio(boxRatio));
}

/**
 * `sizes` for the Chi sono picture. `ratio` = width / height of the photo.
 * - `cover: true` (portrait): the box is 4:5 and the photo fills it.
 * - otherwise (painting): the box is the painting itself, fitted in the breakpoint's box.
 * On phones narrower than the box plus gutters and indent, the box shrinks with the viewport.
 * Example, portrait 4:5: "(min-width: 1024px) 400px, (min-width: 640px) 360px, (min-width: 360px) 280px, calc(100vw - 80px)".
 */
export function chiSizes(ratio: number, { cover = false }: { cover?: boolean } = {}): string {
  const factor = cover ? coverFactor(PORTRAIT_RATIO, ratio) : 1;
  const boxRatio = cover ? PORTRAIT_RATIO : ratio;
  const px = (n: number) => `${Math.round(n * factor)}px`;
  const when = (from: number) => (from > 0 ? `(min-width: ${from}px) ` : '');
  const parts: string[] = [];
  let upper = Infinity; // an earlier entry already answers for viewports ≥ upper
  for (const box of CHI_BOXES) {
    const width = fitWidth(box, boxRatio);
    const margin = 2 * box.gutter + box.indent; // viewport width minus this = room for the picture
    const full = width + margin; // viewport width from which the picture has its full size
    if (full <= box.minWidth) {
      parts.push(`${when(box.minWidth)}${px(width)}`);
    } else {
      if (full < upper) parts.push(`${when(full)}${px(width)}`);
      const shrinking = factor === 1 ? `calc(100vw - ${margin}px)` : `calc((100vw - ${margin}px) * ${round(factor)})`;
      parts.push(`${when(box.minWidth)}${shrinking}`);
    }
    upper = box.minWidth;
  }
  return parts.join(', ');
}

function validRatio(ratio: number): number {
  return Number.isFinite(ratio) && ratio > 0 ? ratio : 1;
}

function round(n: number): number {
  return Math.round(n * 1000) / 1000;
}
