// Values that live in more than one file and must agree (no live src/content involved):
// - the paint names and colours: site (composition.ts, content.config.ts, tokens.css), admin
//   (model.js, form.js, admin.css), validator (check-content.mjs) and CONTRACTS §4.1;
// - the layout numbers the `sizes` helpers compute with, against the CSS that really lays the page out
//   (tokens.css, ArtworkGallery, ArtworkPager, ChiFigure, ChiFilm, HomeHero, HomeQuote, the Opera page
//   grid);
// - the film's file and its size limit: lib/film.ts and CONTRACTS §5.6;
// - her signature: the drawing src/assets/firma.svg and the favicon made from it.
// A CSS-only change that breaks one of these pairs fails here instead of silently making every
// `sizes` attribute (or the admin's colour swatches) wrong.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { GUTTERS, PAGE_MAX, PAINTS, PAINT_CYCLE, REAL_SCALE } from '../../src/components/lib/composition.ts';
import { PAGER_THUMB_H, STAGE, THUMB_H } from '../../src/components/lib/opera.ts';
import { CHI_BOXES } from '../../src/components/lib/chi.ts';
import { FILM_BOXES, FILM_MAX_BYTES, FILM_PATH } from '../../src/components/lib/film.ts';
import { HERO_SIZES, QUOTE_SIZES } from '../../src/components/lib/home.ts';
import { COLORI } from '../../public/admin/js/model.js';
import { currentFaviconSvg } from '../dev/site-icons.mjs';

const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
const TOKENS = read('src/styles/tokens.css');

/** The body of the first `@media (min-width: Npx) { … }` block (or the whole text for N = 0) whose
    rules mention `marker`. Good enough for the flat CSS of these files. */
function mediaBlock(css, minWidth, marker) {
  if (minWidth === 0) return css;
  const re = new RegExp(`@media \\(min-width: ${minWidth}px\\)\\s*\\{`, 'g');
  for (const match of css.matchAll(re)) {
    let depth = 1;
    let i = match.index + match[0].length;
    const start = i;
    while (depth > 0 && i < css.length) {
      if (css[i] === '{') depth++;
      if (css[i] === '}') depth--;
      i++;
    }
    const body = css.slice(start, i - 1);
    if (!marker || body.includes(marker)) return body;
  }
  throw new Error(`no @media (min-width: ${minWidth}px) block with ${marker}`);
}

/** Value of `--name:` in a CSS text (first occurrence). */
function prop(css, name) {
  const match = new RegExp(`${name.replace(/[-]/g, '\\-')}:\\s*([^;]+);`).exec(css);
  assert.ok(match, `${name} not found`);
  return match[1].trim();
}

/** The CSS before its first @media block (the base, phone-first rules; @media in a comment ignored). */
const baseOf = (css) => css.slice(0, css.search(/^\s*@media/m));
const styleOf = (file) => {
  const text = read(file);
  return text.slice(text.indexOf('<style'), text.lastIndexOf('</style>'));
};

describe('paints', () => {
  test('the same five names everywhere', () => {
    assert.deepEqual([...PAINTS], COLORI, 'admin model.js COLORI');
    const validator = /const COLORI = \[([^\]]+)\]/.exec(read('scripts/check-content.mjs'))[1];
    assert.deepEqual(validator.match(/'([a-z]+)'/g).map((s) => s.slice(1, -1)), [...PAINTS], 'check-content.mjs');
    const schema = read('src/content.config.ts');
    assert.match(schema, /import \{ PAINTS \} from '\.\/components\/lib\/composition'/, 'content.config.ts imports PAINTS');
    assert.match(schema, /const COLORI = PAINTS;/);
    const labels = /const COLORE_LABELS = \{([^}]+)\}/.exec(read('public/admin/js/screens/form.js'))[1];
    assert.deepEqual(
      [...labels.matchAll(/(\w+): '/g)].map((m) => m[1]),
      [...PAINTS],
      'admin form.js COLORE_LABELS',
    );
    const contract = /`colore` \| string \\\| null \| ([^|]+)\|/.exec(read('CONTRACTS.md'))[1];
    assert.deepEqual(contract.match(/"([a-z]+)"/g).map((s) => s.slice(1, -1)), [...PAINTS], 'CONTRACTS §4.1 table');
  });

  test('the automatic cycle uses each paint once', () => {
    assert.deepEqual([...PAINT_CYCLE].sort(), [...PAINTS].sort());
    assert.match(read('CONTRACTS.md'), new RegExp(`PAINT_CYCLE = \\[${PAINT_CYCLE.map((p) => `'${p}'`).join(', ')}\\]`));
  });

  test('the same colour for each paint: tokens, admin swatches, CONTRACTS', () => {
    const admin = read('public/admin/admin.css');
    const contract = read('CONTRACTS.md');
    const hexes = {};
    for (const paint of PAINTS) {
      const token = prop(TOKENS, `--tiz-${paint}`).replace(/\s*\/\*.*$/, '').toLowerCase();
      hexes[paint] = token;
      assert.match(token, /^#[0-9a-f]{6}$/, `--tiz-${paint}`);
      assert.equal(new RegExp(`\\.swatch-${paint} \\{\\s*background: (#[0-9a-f]{6})`).exec(admin)?.[1], token, `admin.css .swatch-${paint}`);
      assert.match(contract, new RegExp(`${paint}\\s+\`${token}\``), `CONTRACTS §4.1 ${paint}`);
    }
    // The admin's «Automatico» swatch shows the cycle in the site's order.
    const auto = /\.swatch-auto \{\s*background: linear-gradient\(90deg, ([^;]+)\);/.exec(admin)[1];
    assert.deepEqual(auto.match(/#[0-9a-f]{6}/g), PAINT_CYCLE.map((paint) => hexes[paint]));
  });
});

describe('page frame and real scale (tokens.css)', () => {
  test('--tiz-page-max = PAGE_MAX', () => {
    assert.equal(prop(TOKENS, '--tiz-page-max'), `${PAGE_MAX}px`);
  });

  test('--tiz-gutter and --tiz-k per breakpoint = GUTTERS / REAL_SCALE', () => {
    for (const { minWidth, gutter } of GUTTERS) {
      const css = minWidth === 0 ? baseOf(TOKENS) : mediaBlock(TOKENS, minWidth, '--tiz-gutter');
      assert.equal(prop(css, '--tiz-gutter').replace(/\s*\/\*.*$/, ''), `${gutter}px`, `gutter from ${minWidth}`);
    }
    for (const { minWidth, k, gutter } of REAL_SCALE) {
      const css = minWidth === 0 ? baseOf(TOKENS) : mediaBlock(TOKENS, minWidth, '--tiz-k');
      assert.equal(Number(prop(css, '--tiz-k').replace(/\s*\/\*.*$/, '')), k, `k from ${minWidth}`);
      assert.equal(gutter, GUTTERS.find((g) => g.minWidth === minWidth).gutter);
    }
  });
});

describe('Opera page (ArtworkGallery, ArtworkPager, [slug].astro)', () => {
  const gallery = styleOf('src/components/ArtworkGallery.astro');
  const page = styleOf('src/pages/opere/[slug].astro');

  test('stage height and fit per breakpoint = STAGE', () => {
    for (const layout of STAGE) {
      const css = layout.minWidth === 0 ? baseOf(gallery) : mediaBlock(gallery, layout.minWidth, '--stage-h');
      const height = prop(css, '--stage-h');
      // The plain value, before the @supports rule that lowers it on short screens (never raises it).
      assert.equal(height, `${layout.height}px`, `--stage-h from ${layout.minWidth}`);
      if (layout.minWidth !== 1024) {
        assert.equal(Number(prop(css, '--fit-w')), layout.fitW, `--fit-w from ${layout.minWidth}`);
        assert.equal(Number(prop(css, '--fit-h')), layout.fitH, `--fit-h from ${layout.minWidth}`);
      }
    }
    // ≥ 1024 the fit is inherited from 640 (same values in STAGE).
    assert.equal(STAGE[0].fitW, STAGE[1].fitW);
    assert.equal(STAGE[0].fitH, STAGE[1].fitH);
  });

  test('the svh rules only ever lower the stage to its STAGE height or below', () => {
    for (const layout of STAGE.filter(({ minWidth }) => minWidth > 0)) {
      const css = mediaBlock(gallery, layout.minWidth, '100svh');
      assert.match(css, new RegExp(`--stage-h: min\\(${layout.height}px, `), `svh rule from ${layout.minWidth}`);
    }
  });

  test('desktop grid: STAGE.off = 2 × gutter + the aside column + the gap', () => {
    const desktop = mediaBlock(page, 1024, 'grid-template-columns');
    const aside = Number(/grid-template-columns: minmax\(0, 1fr\) (\d+)px;/.exec(desktop)[1]);
    const gap = Number(/\.opera__layout \{[^}]*?gap: (\d+)px;/s.exec(desktop)[1]);
    assert.equal(STAGE[0].off, 2 * GUTTERS[0].gutter + aside + gap);
    assert.equal(STAGE[1].off, 2 * GUTTERS[1].gutter);
    assert.equal(STAGE[2].off, 2 * GUTTERS[2].gutter);
  });

  test('thumbnail heights = THUMB_H / PAGER_THUMB_H', () => {
    assert.equal(prop(baseOf(gallery), '--thumb-h'), `${THUMB_H.phone}px`);
    assert.equal(prop(mediaBlock(gallery, 640, '--thumb-h'), '--thumb-h'), `${THUMB_H.wide}px`);
    const pager = styleOf('src/components/ArtworkPager.astro');
    assert.match(pager, new RegExp(`\\.pager__thumb :global\\(img\\) \\{[^}]*height: ${PAGER_THUMB_H}px;`, 's'));
  });
});

describe('Chi sono picture (ChiFigure) = CHI_BOXES', () => {
  const figure = styleOf('src/components/chi/ChiFigure.astro');
  test('box and indent per breakpoint', () => {
    let indent = null;
    for (const box of [...CHI_BOXES].reverse()) {
      const css = box.minWidth === 0 ? baseOf(figure) : mediaBlock(figure, box.minWidth, '--chi-box-w');
      assert.equal(prop(css, '--chi-box-w'), `${box.w}px`, `width from ${box.minWidth}`);
      assert.equal(prop(css, '--chi-box-h'), `${box.h}px`, `height from ${box.minWidth}`);
      // A breakpoint without its own --chi-indent keeps the narrower one's.
      indent = css.includes('--chi-indent') ? prop(css, '--chi-indent') : indent;
      assert.equal(indent, `${box.indent}px`, `indent from ${box.minWidth}`);
    }
  });
});

describe('Chi sono film (ChiFilm) = FILM_BOXES', () => {
  const film = styleOf('src/components/chi/ChiFilm.astro');

  test('box width and indent per breakpoint; the indent is the portrait\'s', () => {
    const figure = styleOf('src/components/chi/ChiFigure.astro');
    let indent = null;
    let portraitIndent = null;
    for (const box of [...FILM_BOXES].reverse()) {
      const css = box.minWidth === 0 ? baseOf(film) : mediaBlock(film, box.minWidth, '--film-box-w');
      assert.equal(prop(css, '--film-box-w'), `${box.w}px`, `width from ${box.minWidth}`);
      // A breakpoint without its own indent keeps the narrower one's (in both components).
      indent = css.includes('--film-indent') ? prop(css, '--film-indent') : indent;
      assert.equal(indent, `${box.indent}px`, `indent from ${box.minWidth}`);
      const portrait = box.minWidth === 0 ? baseOf(figure) : mediaBlock(figure, box.minWidth, '--chi-box-w');
      portraitIndent = portrait.includes('--chi-indent') ? prop(portrait, '--chi-indent') : portraitIndent;
      assert.equal(indent, portraitIndent, `film and portrait on one line from ${box.minWidth}`);
    }
  });

  test('the short-screen rule only ever makes the box smaller (sizes stays an upper bound)', () => {
    assert.match(film, /width: min\(var\(--film-box-w\), 100%\);/);
    assert.match(film, /@supports \(height: 100svh\) \{\s*\.chi-film__frame \{\s*width: min\(var\(--film-box-w\), 100%, /);
  });

  test('its floor (the play button needs that width) is the limit CONTRACTS §5.6 names', () => {
    const floor = /width: min\(var\(--film-box-w\), 100%, max\((\d+)px, \(100svh - \d+px\) \* var\(--film-ratio\)\)\);/.exec(film);
    assert.ok(floor, 'the short-screen rule has a floor in px');
    assert.ok(Number(floor[1]) <= Math.min(...FILM_BOXES.map((box) => box.w)), 'the floor never widens a box');
    assert.ok(read('CONTRACTS.md').includes(`never below ${floor[1]} px wide`), `CONTRACTS names the ${floor[1]} px floor`);
  });

  test('full screen shows the whole film: "contain" again, over the box\'s "cover"', () => {
    assert.match(film, /\.chi-film__video,\s*\.chi-film__play :global\(img\) \{[^}]*object-fit: cover;/);
    assert.match(film, /\.chi-film__video:fullscreen \{\s*object-fit: contain;\s*\}/);
  });

  test('CONTRACTS §5.6 names the same file and size limit', () => {
    const contract = read('CONTRACTS.md');
    // Only §5.6 itself: the file name is also in the layout listing of §3.
    const section = contract.slice(contract.indexOf('### 5.6'), contract.indexOf('## 6.'));
    assert.ok(section.startsWith('### 5.6'), 'CONTRACTS has a §5.6 before §6');
    assert.ok(section.includes(`public/${FILM_PATH}`), `CONTRACTS §5.6 names public/${FILM_PATH}`);
    assert.match(section, new RegExp(`≤ ${FILM_MAX_BYTES / 1_000_000} MB`));
  });

  test('the player never fetches or starts the film unasked (CONTRACTS §5.6)', () => {
    // The opening tag in the template (the comments only say "<video>", without attributes).
    const tag = /<video\s[^>]*>/.exec(read('src/components/chi/ChiFilm.astro'))?.[0];
    assert.ok(tag, 'ChiFilm has a <video …> element');
    for (const attribute of ['controls', 'preload="none"', 'playsinline', 'poster=']) {
      assert.ok(tag.includes(attribute), `<video> has ${attribute}`);
    }
    assert.doesNotMatch(tag, /\b(autoplay|loop|muted)\b/);
  });
});

describe('Reveal on scroll (global.css)', () => {
  // BaseLayout's IntersectionObserver must be able to see an element that waits for its reveal.
  // Chrome never reports one that its own clip-path has clipped away: such an element below the fold
  // would stay hidden for good (the handwritten notes on Chi sono once did).
  test('an element that waits is hidden by opacity, never by clip-path', () => {
    const css = read('src/styles/global.css');
    const waiting = [...css.matchAll(/([^{}]*:not\(\.is-in\)[^{}]*)\{([^}]*)\}/g)];
    assert.ok(waiting.length > 0, 'global.css hides [data-reveal]:not(.is-in)');
    for (const [, selector, body] of waiting) {
      assert.doesNotMatch(body, /clip-path|visibility|display/, selector.trim());
    }
    assert.ok(waiting.some(([, , body]) => /opacity: 0;/.test(body)));
  });
});

describe('Home (HomeHero, HomeQuote) = HERO_SIZES / QUOTE_SIZES', () => {
  test('the wall and the slot shares give the 1280 px widths of HERO_SIZES', () => {
    const hero = styleOf('src/components/home/HomeHero.astro');
    const wall = Number(/--wall: min\((\d+)px, 52\.53cqi\)/.exec(hero)[1]);
    const columns = /grid-template-columns:\s*minmax\(0, 1fr\) calc\(var\(--wall\) \* ([\d.]+)\) calc\(var\(--wall\) \* ([\d.]+)\) calc\(var\(--wall\) \* ([\d.]+)\)\s*calc\(var\(--wall\) \* ([\d.]+)\)/.exec(hero);
    const [, c2, c3, , c5] = columns.map(Number);
    const small = Number(/\.home-hero__work--small \{[^}]*width: calc\(var\(--wall\) \* ([\d.]+)\)/s.exec(hero)[1]);
    const at1280 = (sizes) => Number(/^\(min-width: 1280px\) (\d+)px/.exec(sizes)[1]);
    assert.ok(Math.abs(wall * (c2 + c3) - at1280(HERO_SIZES.large)) < 1, 'large = columns 2–3');
    assert.ok(Math.abs(wall * c5 - at1280(HERO_SIZES.narrow)) < 1, 'narrow = column 5');
    assert.ok(Math.abs(wall * small - at1280(HERO_SIZES.small)) < 1, 'small');
    assert.match(HERO_SIZES.large, /calc\(33\.78vw - 32px\)/);
    // 0.64309 × 52.53 % of (100vw − 96px) = 33.78vw − 32px
    assert.ok(Math.abs((c2 + c3) * 52.53 - 33.78) < 0.01);
  });

  test('the quote painting: 85 % of the 400 px / 240 px column', () => {
    const quote = styleOf('src/components/home/HomeQuote.astro');
    const share = Number(/\.home-quote__frame \{[^}]*width: (\d+)%;/s.exec(quote)[1]) / 100;
    const desktop = Number(/grid-template-columns: (\d+)px minmax\(0, 1fr\);/.exec(mediaBlock(quote, 1024, 'grid-template-columns'))[1]);
    const tablet = Number(/grid-template-columns: (\d+)px minmax\(0, 1fr\);/.exec(mediaBlock(quote, 640, 'grid-template-columns'))[1]);
    assert.equal(QUOTE_SIZES, `(min-width: 1024px) ${desktop * share}px, (min-width: 640px) ${tablet * share}px, ${desktop * share}px`);
  });
});

describe('Her signature (src/assets/firma.svg) and the site icons', () => {
  const firma = read('src/assets/firma.svg');

  test('the drawing is shapes in one colour: currentColor, so each place paints it with `color`', () => {
    assert.match(firma, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" viewBox="0 0 [\d.]+ [\d.]+">/);
    assert.ok(firma.includes('currentColor'), 'painted with currentColor');
    const paints = [...firma.matchAll(/\b(?:fill|stroke)="([^"]+)"/g)].map((m) => m[1]);
    assert.deepEqual(paints.filter((paint) => paint !== 'currentColor' && paint !== 'none'), [], 'no other colour');
    assert.doesNotMatch(firma, /<(?:text|image|style|script|filter|mask|linearGradient|radialGradient)\b|\bid=|\bwidth=|\bheight=/);
    assert.ok(Buffer.byteLength(firma) <= 10_000, 'every page carries it once (the <symbol> in BaseLayout): keep it under 10 kB');
  });

  test('the page carries the drawing once: a <symbol> in BaseLayout, shown by Firma.astro with <use>', () => {
    const id = /id: '([\w-]+)'/.exec(read('src/components/lib/firma.ts'))[1];
    assert.ok(read('src/layouts/BaseLayout.astro').includes('<symbol id={FIRMA.id} viewBox={FIRMA.viewBox} set:html={FIRMA.shapes} />'));
    assert.ok(read('src/components/Firma.astro').includes('<use href={`#${FIRMA.id}`}></use>'));
    assert.doesNotMatch(firma, new RegExp(`\\bid="${id}"`));
    for (const file of ['src/components/SiteHeader.astro', 'src/components/SiteFooter.astro', 'src/pages/opere/[slug].astro']) {
      assert.match(read(file), /<Firma class="[\w-]+"/, `${file} signs with <Firma>`);
    }
  });

  test('public/favicon.svg is what scripts/dev/site-icons.mjs writes from it and from --tiz-lino / --tiz-rosso', async () => {
    const { svg, lino } = await currentFaviconSvg();
    assert.equal(read('public/favicon.svg'), svg, 'run: node scripts/dev/site-icons.mjs (and commit the three icons)');
    assert.ok(read('src/layouts/BaseLayout.astro').includes(`<meta name="theme-color" content="${lino}" />`), 'theme-color = --tiz-lino');
  });
});
