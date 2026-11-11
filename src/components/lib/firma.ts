/**
 * Her signature: the «TiZ» she paints in a corner of her canvases with the edge of a palette knife
 * (one long bar over the T's stem, the «i» and the Z). The drawing is src/assets/firma.svg, traced
 * from her paint in the photo of «Il risveglio di Madre Natura» (scripts/dev/firma/make.py rebuilds
 * it); it is one colour, painted with currentColor.
 *
 * BaseLayout puts it in the page once, as <symbol id="tiz-firma">; Firma.astro shows it wherever the
 * site signs (header, footer, under her text on an Opera page). public/favicon.svg is the same drawing
 * on a lino tile: `node scripts/dev/site-icons.mjs` writes it, scripts/test/design-sync.test.mjs
 * checks it.
 */
import source from '../../assets/firma.svg?raw';

const parsed = /<svg\b[^>]*\bviewBox="([^"]+)"[^>]*>([\s\S]*)<\/svg>/.exec(source);
if (!parsed) throw new Error('src/assets/firma.svg: expected <svg viewBox="…">…</svg>');

export const FIRMA = {
  /** id of the <symbol> in BaseLayout. */
  id: 'tiz-firma',
  viewBox: parsed[1],
  /** The shapes inside the <svg>, as markup. */
  shapes: parsed[2].trim(),
} as const;
