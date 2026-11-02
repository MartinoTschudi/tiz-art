# Design of the public site tiz-art.ch — «Lo studio»

The public site is built in the design **«Lo studio»** by Claude Design, implemented in this
repository: a raw linen ground, coloured brushstrokes *behind* the paintings, her hand (TIZ Mano) for
titles, the motto and notes, and the works hung "by eye" at their real relative scale. The paintings
are the hero. This file describes the site **as built**, for anyone who changes its look or adds a page.
The binding rules (data format, file ownership, admin) are in `CONTRACTS.md`; this file covers the
public site only.

**The original design files are not in the repository.** The owner keeps them in Google Drive
`TIZ-ART/design-lo-studio/` (README, tokens.css, reference HTML and rendered frames). The frame ids
below refer to them: 1a design system · 1b / 1c Home desktop / phone · 1c-menu phone menu · 1d / 1e
Opere · 1l Opere with 3 works · 1f / 1g Opera · 1h / 1i Chi sono · 1j / 1k Contatti · 1j-sent /
1k-sent after sending. Desktop frames are 1280 px wide, phone frames 390 px. The reference HTML has the
exact px values inline, per frame (`<div id="1x">`).

Where the build deliberately differs from the design's README:

- Content stays the JSON the admin writes (CONTRACTS §4), not Markdown files. `paint` is `colore`,
  there is no `quote` field (the home quote is derived from her texts), `featured` is `inEvidenza`.
- **Every stroke behind a work is in that work's own paint** (`colore`, chosen by Tiziana in the admin;
  automatic = `PAINT_CYCLE` by position): in the lists, on the Opera stage, on Chi sono, and also in the
  home hero and the quote band. Strokes not behind a work keep their design colour (Chi sono portrait
  ocra, the Contatti block ottanio, the phone menu ocra, the 404 canvas terracotta).
- The Chi sono bio is her own text (`profilo.bio`), not the design's draft.
- Fonts are self-hosted; Nanum Brush Script is patched for Italian and renamed TIZ Mano (§4).
- No Astro `<ClientRouter />`: native cross-document view transitions, so the vanilla scripts keep
  normal page loads.
- The contact form posts to Web3Forms; without JS it is a normal POST that comes back to
  `/contatti/grazie/`.

## 1. Run it locally

Requirements: Node ≥ 22.23.4 (Astro 7 refuses older versions), npm.

```sh
npm ci
npm run dev          # http://localhost:4321/ — live reload while you edit styles and components
npm run build        # static site in dist/ (same as production on tiz-art.ch)
npm run preview      # serves dist/
```

The GitHub Pages preview lives under a sub-path. Build it like that to check that nothing is
hard-coded to `/`:

```sh
SITE_URL=https://martinotschudi.github.io BASE_PATH=/tiz-art/ npm run build
```

In that mode every page also gets `noindex` and `robots.txt` blocks everything (it is a preview).

## 2. Pages

Every page uses `src/layouts/BaseLayout.astro` (head, skip link «Vai al contenuto», header, `<main>`,
footer, the `#tiz-rough` stroke filter, the reveal script). Breakpoints (px, as in the design):
phone < 640 · tablet 640–1023 · desktop ≥ 1024.

| URL | File | What it shows |
|---|---|---|
| `/` | `src/pages/index.astro` + `components/home/*` | **Hero** (1b / 1c): the motto in her hand, 150 px desktop, last word in rosso with the beating dot (the artist's name when the motto is empty), the intro line and «Guarda le opere →»; up to 3 works from `heroSlots` (the first 3 *in evidenza*, filled up with the first published works): the most square → large (with the note «{titolo}, {anno}»), the tallest → narrow, the other → small. Below 1024: motto → the large work → intro. **Series**: «noi, DONNA.» + year in her hand, the line from `SERIE_NOTE`, up to 5 works of the series outside hero and quote, hung by eye without sizes, «Tutte le {n} opere →» («Le ultime opere» when no work has a series). **Quote band** (gesso): the first sentence (20–140 characters) of a work's text, from the last work backwards, outside the hero; key word in rosso; «— Tiziana, su «{titolo}», {misure} →» links to the work; hidden when there is none. Large home footer |
| `/opere/` | `src/pages/opere/index.astro` | «Opere» (84 / 120 / 150 px) and the note «{n} tele, appese come nello studio» («{n} tele» on phones, «1 tela»), then ONE list of all published works in display order, hung by eye (1d / 1e / 1l). No grouping by series. No works: «Le opere saranno pubblicate presto.» |
| `/opere/<slug>/` | `src/pages/opere/[slug].astro` | **Opera** (1f / 1g). Desktop: «← Tutte le opere»; grid `minmax(0,1fr) 400px`, gap 64: the stage (720 px high, lower on short screens) with the painting whole (≤ 88 % × 92 %) and its stroke; the column «{nn} / {total} · {collezione}», the title in her hand, `<dl>` Anno / Misure / Tecnica (empty ones skipped), her text + «— TIZ» (block omitted when the text is empty), «Chiedi di quest’opera →» → `/contatti/?opera=<slug>`. Extra photos as thumbnails under the stage. Previous / next (wrapping) as two halves with 84 px thumbnails. 640–1023: the same, stacked. Phone: «← Opere» + TIZ in the header, the painting in a 440 px box, «{nn} / {total}», title, «anno · misure» / tecnica, text; a fixed bottom bar ← · «Chiedi di quest’opera» · →. JSON-LD `VisualArtwork` |
| `/chi-sono/` | `src/pages/chi-sono.astro` | «chi sono» in her hand, her name (h1), the portrait (`profilo.ritratto`, 4:5 crop allowed here only) with an ocra stroke and the note «nello studio» — without a portrait the first hero painting, uncropped, in its own paint, captioned «titolo», anno and linked; the motto (last word in rosso), the bio (`PlainText`, paragraphs 18 px apart), the dark button «Vedi le opere» and «Scrivimi →». Desktop (1h): grid 460 px | text, the picture sticky on tall screens; phone (1i): stacked |
| `/contatti/` | `src/pages/contatti.astro` + `components/contatti/*` | **Contatti** (1j / 1k): the ottanio stroke block with «Scrivimi» (h1) and her line; the form (`ContactForm`): optional chip «Mi interessa» + title for `?opera=<slug>`, underline fields «Il tuo nome», «La tua e-mail, per risponderti», «Il tuo messaggio», «Invia →», the privacy note. Sent (1j-sent / 1k-sent): «Grazie!», «Il tuo messaggio è arrivato. Ti rispondo presto.», «Scrivi ancora». Stacked below 1024 |
| `/contatti/grazie/` | `src/pages/contatti/grazie.astro` | Where Web3Forms sends visitors without JS: the Scrivimi block as a decorative echo, «Grazie!» (h1), the line, «Guarda le opere →» / «Torna alla home». `noindex`, no canonical, not in the sitemap |
| `/404.html` | `src/pages/404.astro` | «pagina non trovata», «Qui la tela è ancora bianca.» (h1, one line), one line of text, «Vedi le opere →» / «Torna alla home», a blank canvas with a terracotta stroke. Served by GitHub Pages at any depth, so every URL is absolute with the base path; no canonical, noindex |
| `/robots.txt` | `src/pages/robots.txt.ts` | Generated (base path, sitemap URL, preview = disallow all) |
| `/admin/anteprime.json` | `src/pages/admin/anteprime.json.ts` | Not a page: 480 px thumbnails for the admin (CONTRACTS §6). Do not remove |
| old WordPress URLs | `astro.config.mjs` | Redirect pages generated from `src/data/sito.json` → `redirectVecchioSito` |

**Header** (all pages): «TIZ» (TIZ Mano, rosso) + the name → home; nav Opere · Chi sono · Contatti
with the ocra marker on the current section: `aria-current="page"` on the item's own page,
`aria-current="true"` on a page inside its section (`/opere/<slug>/`, `/contatti/grazie/`). Phone with
JS: «Menu» opens the full-screen lino menu (1c-menu); without JS the three links form a row.
**Footer**: dashed top border, «TIZ», «© {year} Tiziana Tschudi Belloli»; on the home the large
variant with the motto, the nav Opere · Chi sono · Scrivimi and «© {year} Tiziana Tschudi Belloli ·
tiz-art.ch». No contact details anywhere.

## 3. Components and helpers

All in `src/components/`. Each `.astro` file has its own scoped `<style>` and a header comment with
the details; this is the map.

### Shared pieces

| File | Purpose | Props |
|---|---|---|
| `SiteHeader.astro` | Header and phone menu (§2, behaviour in §6). Its root `<header>` must stay a direct child of `<body>` | `back?` (`{ href, label }`: the phone back link instead of Menu; BaseLayout `headerBack`) |
| `SiteFooter.astro` | Footer, default or the large home one | `variant?` (`default` / `home`; BaseLayout `footerVariant`) |
| `Stroke.astro` | Decorative brushstroke behind a painting (`aria-hidden`, z-index −1; the parent needs `position: relative; isolation: isolate`). Wipes in on load, or when its `[data-reveal]` parent is revealed. Rough edge = `#tiz-rough` | `color` (normally `operaPaintVar(opera, published)`), `top` / `left` / `width` / `height` or `inset`, `rotate?` (−5deg), `delay?`, `shape?` (1 / 2), `class?` |
| `HungWorks.astro` | Works hung by eye at real scale: width `min(cm × --tiz-k, 100%)` (k 2.3 / 2.0 / 2.2; 100 cm when `larghezza` is missing, then no size line), MT margin cycle from 640, AL align cycle below, strokes on even indexes in the work's paint, caption title + «{w} × {h} cm», reveal and hover lift, `view-transition-name: opera-<slug>`. Put it in a `.container` (it reaches into the gutter and clips there). Gaps from the parent: `--tiz-hung-gap` (phone, 52px), `--tiz-hung-gap-row` / `--tiz-hung-gap-col` (from 640, 48px / 56px) | `opere`, `offset?`, `headingLevel?` (2 / 3 / 4, default 3), `priorityCount?`, `transitionNames?` (default true; false for a second list of the same works), `label?`, `showSize?` (default true) |
| `ResponsivePicture.astro` | `<picture>` AVIF + WebP, width/height attributes, never crops; unstyled | `image`, `alt`, `preset` (`card` / `artwork` / `thumb`), `sizes`, `priority?` |
| `PlainText.astro` | The admin's plain text → paragraphs and line breaks, always escaped. Paragraph gap `var(--plain-text-gap, 1em)` (set it on a parent) | `text` |

### Home (`components/home/`)

| File | Purpose | Props |
|---|---|---|
| `HomeHero.astro` | Motto (lines written in at 0 / .5 / 1 s, size from the longest line), the hero slots with strokes and the note, the intro. ≥ 1024 one grid with a "wall" of `min(622px, 52.53%)` of the content box (the 1280 frame's proportions from 1024 up) | `hero` (`heroSlots(...)`), `motto` |
| `HomeSeries.astro` | The series section (title, year, `SERIE_NOTE`, `HungWorks showSize={false}` with closer gaps, «Tutte le {n} opere →»); nothing when there is no work | `series` (`pickSeries(...)`), `total` |
| `HomeQuote.astro` | The quote band: the painting with its stroke beside the quote (≥ 1024 a 400 px column with the 340 px painting, 640–1023 a 240 px column, phone the text alone) | `quote` (`pickQuote(...)`), `opera` |

### Opera (`/opere/<slug>/`)

| File | Purpose | Props |
|---|---|---|
| `ArtworkGallery.astro` | The stage (stroke in the work's paint, the cover whole, `view-transition-name: opera-<slug>`), the extra-photo thumbnails (swap with a 700 ms crossfade) and the `ImageViewer` | `opera`, `paint` (`operaPaintVar(...)`) |
| `ImageViewer.astro` + `image-viewer.ts` | Full-screen `<dialog>` viewer: lino ground, round 48 px buttons, ×, counter (§6) | `images` (srcset, full, width, height, alt), `label` |
| `ArtworkFacts.astro` | `<dl>` Anno / Misure / Tecnica, empty ones skipped; phone: «anno · misure» / tecnica, terms for screen readers | `data` |
| `ArtworkPager.astro` | Previous / next (wrapping), two halves with 84 px thumbnails; from 640 px | `prev?`, `next?` |
| `opera/OperaBar.astro` | Phone fixed bottom bar (88 px + safe area, below `--tiz-z-header`): ← · «Chiedi di quest’opera» · →; plain links | `prev?`, `next?`, `ask` (`routes.contattiOpera(slug)`) |

### Chi sono and Contatti

| File | Purpose | Props |
|---|---|---|
| `chi/ChiFigure.astro` | The Chi sono picture with its stroke and handwritten note: the portrait 4:5 (`object-fit: cover`, the only crop on the site) or a painting at its own ratio | `kind` (`ritratto` / `opera`), `image`, `alt`, `caption`, `paint`, `href?`, `transitionName?` |
| `contatti/Pagina.astro` | The two columns of the contact pages: Scrivimi block left (on top below 1024), the slot right | `titleId?` (makes «Scrivimi» the h1) |
| `contatti/Scrivimi.astro` | The ottanio stroke block with «Scrivimi» and her line (lino text with an ottanio halo for contrast); decorative echo without `titleId` | `titleId?` |
| `contatti/Grazie.astro` | «Grazie!» in rosso, the line, a slot for the actions | `level?` (1 / 2), `id?`, `focusable?` |
| `ContactForm.astro` + `contact-form.ts` | The contact form (§6) | `opere` (published works, for the chip), `labelledBy?` |

### Helpers (`src/components/lib/`, TypeScript, no markup)

`composition.ts`, `home.ts`, `opera.ts`, `chi.ts` and `contatti.ts` are pure (no `astro:*` imports,
erasable TypeScript only): `scripts/test/<name>.test.mjs` imports them directly through Node's type
stripping.

| File | What |
|---|---|
| `composition.ts` | The design's rules: `PAINTS`, `PAINT_CYCLE`, `paintName`, `paintVar`; `MT` / `AL` / `SWL` / `SWT` / `SWR` with `hungAt` / `strokeAt`; `REAL_SCALE`, `DEFAULT_CM`, `realScaleSizes`; `mottoParts`, `splitLastWord`; `heroSlots`; `firstSentence`, `pickQuote`; `pickSeries` |
| `home.ts` | Home / Opere copy and sizes: `HOME_INTRO`, `HERO_SIZES`, `QUOTE_SIZES`, `heroNote`, `longestLine`, `allWorksLabel`, `firstName`, `quoteAttribution`, `opereCountNote` |
| `opera.ts` | Opera page layout numbers (keep in step with the CSS of ArtworkGallery / ArtworkPager): `STAGE`, `stageSizes`, `thumbSizes`, `pagerThumbSizes`, `operaCounter` («01 / 12», spoken «Opera 1 di 12») |
| `chi.ts` | Chi sono picture boxes (400 × 500 / 360 × 450 / 280 × 350) and `chiSizes` (keep in step with ChiFigure) |
| `contatti.ts` | Contact form rules and texts: endpoint, `SUBJECT`, `FROM_NAME`, `MIN_MESSAGE`, `LIMITS`, `MESSAGES`, `fieldError`, `subjectFor`, `operaLine`, `buildPayload`, `withoutOpera`, `isSent` |
| `opere.ts` | Queries (`getPublishedOpere`, `getFeaturedOpere`, `getAllOpere`, `getProfilo`, `groupByCollezione`, `neighbours`), text helpers (`formatDimensions` → «100 × 140 cm», `altText`, `paragraphs`, `excerpt`, `operaDescription`), `operaPaint` / `operaPaintVar` (the work's paint) and `composable()` (works → the shapes the composition rules take) |
| `site.ts` | `SITE`, `BASE`, `routes.*` (every internal URL with the base path, incl. `contattiOpera(slug)` and `contattiGrazie`), `withBase()`, `absoluteUrl()`, `IS_PREVIEW`, `SERIE_NOTE` |
| `images.ts` | Width presets and image helpers (§5) |
| `structured-data.ts` | JSON-LD `Person` and `VisualArtwork` |

Data available on an artwork (`opera.data`): `titolo`, `anno` (number or null), `larghezza` /
`altezza` (cm or null), `tecnica`, `collezione`, `colore` (paint or null = automatic), `testo`,
`immagini` (ImageMetadata[], first = cover), `ordine`, `inEvidenza`, `pubblicata`, `creataIl`,
`aggiornataIl`. Profile: `motto`, `bio`, `ritratto` (ImageMetadata or null). Schema:
`src/content.config.ts` (= CONTRACTS §4 — do not change it for design reasons; the admin writes exactly
that format).

## 4. Tokens, fonts and global styles

- **`src/styles/tokens.css`**: every design value, all `--tiz-*`: colours (lino, gesso, filo, terra,
  terra-2 / -3, rosso, ocra, terracotta, ottanio, blu, and the roles `--tiz-error`, `--tiz-viewer-bg`),
  the two fonts, the type scale (`--tiz-mano-xl` / `-l` / `-m` / `-s`, `--tiz-display`,
  `--tiz-h1-name`, `--tiz-lead`, `--tiz-body`, `--tiz-small`, `--tiz-mano-caption`, `--tiz-signature`),
  spacing `--tiz-s1…8` and `--tiz-gutter` (20 / 32 / 48), layout (`--tiz-page-max` 1440,
  `--tiz-measure`, `--tiz-hit` 44px, header heights, `--tiz-bar-h` 88px, `--tiz-divider`,
  `--tiz-z-header`), shapes, shadows (`--tiz-shadow-tela` for paintings, `--tiz-shadow-tela-l` for the
  desktop Opera stage, `--tiz-shadow-thumb` / `-thumb-l` for the contact chip and the pager
  thumbnails), the linen / bristle / marker gradients, focus (`--tiz-focus`, 2px rosso, 3px offset),
  motion (eases, durations, `--tiz-stagger`, `--tiz-lift`), `--tiz-k` and the keyframes `tiz-stroke`,
  `tiz-write`, `tiz-settle`, `tiz-beat`. Reduced motion switches every animation off there.
- **`src/styles/global.css`**: reset, the linen page, links, focus, the primitives `.container`,
  `.tiz-btn` / `.tiz-btn--dark` / `.tiz-btn--round`, `.tiz-marker` (the arrow after a word space:
  `Tutte le opere <span aria-hidden="true">→</span>`), `.tiz-write` / `.tiz-settle` (one-off load
  animations, delay `--d`), `.visually-hidden`, `.skip-link`, the reveal system and the view transitions.
- **Components**: scoped `<style>`, BEM-ish class names, values only from tokens. To change a child
  component from a parent, prefer the custom properties it offers (`--tiz-hung-gap*`,
  `--plain-text-gap`); otherwise wrap it and use `:global()`.
- **Fonts**: self-hosted in `src/assets/fonts/` (Vite hashes them and adds the base path),
  `@font-face` in tokens.css with `font-display: swap`, both preloaded in BaseLayout.
  - **TIZ Mano** (`--tiz-font-mano`) = Nanum Brush Script, latin subset, patched with the glyphs Italian
    needs (àèéìòù ÀÈÌÒÙ áéíóú « » ‹ › … – — ·) and renamed, because "Nanum" is an OFL Reserved Font
    Name. Rebuild it with `scripts/dev/make-mano-font.py` (fontTools + brotli). Her hand: titles, motto,
    signature, notes; never below 28px, never for paragraphs.
  - **Bricolage Grotesque** (`--tiz-font-voce`): one variable file, latin, wght 200–800, opsz 12–96.
  - Licences: `public/fonts/OFL-tiz-mano.txt`, `public/fonts/OFL-bricolage-grotesque.txt`. Neither font
    has ← → arrows; they fall back to the system font, as in the design.
- `theme-color` in `BaseLayout.astro` and the colours in `public/favicon.svg` («TIZ» in rosso strokes
  on lino) repeat `--tiz-lino` / `--tiz-rosso` (they cannot read CSS variables): update them together,
  then regenerate `public/favicon-32.png` and `public/apple-touch-icon.png` with
  `node scripts/dev/site-icons.mjs` and commit them.

## 5. Images

Photos are uploaded through the admin as JPEG (longest side ≤ 2400 px) next to `opera.json`.
Everything else is generated at build time by `astro:assets` + sharp (cached in CI). `sizes` always
comes from the width the layout really gives the image, computed by the helpers in §3 from the same
numbers as the CSS (most of them from the real-scale widths, cm × k):

| Where | Preset / format | `sizes` from |
|---|---|---|
| Hung lists (Opere, home series) | `card`: 360, 540, 720, 960, 1280 | `realScaleSizes(larghezza)` (composition.ts) |
| Home hero | `card` | `HERO_SIZES` (home.ts): 400 / 150 / 230 px at 1280, shrinking with the wall from 1024, 290 px on phones |
| Home quote | `card` | `QUOTE_SIZES` (home.ts): 340 px ≥ 1024, 204 px at 640–1023 |
| Chi sono picture | `card` | `chiSizes` (chi.ts) |
| Opera stage | `artwork`: 540, 720, 960, 1280, 1600 | `stageSizes(ratio)` (opera.ts) |
| Opera extra-photo thumbnails, pager | `thumb`: 360, 540, 720 | `thumbSizes` (84 / 64 px high), `pagerThumbSizes` (84 px high) |
| Full-screen viewer | WebP 1280, 1920 + a **full-size JPEG** (quality 90) as the largest candidate; also the no-JS link target and the JSON-LD `image` | — |
| Open Graph / Twitter | JPEG inside 1200 × 1200, quality 75 | — |
| Contact chip | WebP 240, fitted into 96 × 64 (7/8 on phones) | — |
| Admin `anteprime.json` | WebP 480 | — |

Presets live in `src/components/lib/images.ts`; widths larger than the original are dropped. Rules:

- **Never crop, overlay, filter, round or recolour a painting** (no `object-fit: cover` on art; the
  portrait photo on Chi sono is the only exception). The only effect is a shadow token. Every `<img>`
  has width/height attributes and keeps its real aspect ratio (no layout shift).
- Alt text: `«Titolo», Tiziana Tschudi Belloli, 2023` (+ `, dettaglio N` for extra photos) from
  `altText()`.
- Only the first screen loads eagerly (`priority` / `priorityCount`); the rest is lazy.

## 6. Behaviour (keep the hooks when restyling)

All vanilla TypeScript in Astro `<script>`s; everything is readable without JS.

- **`js` class and fallbacks** (BaseLayout): an inline script adds `js` to `<html>` before the first
  paint; CSS hides unrevealed elements and shows the Menu button only under `.js`. At
  DOMContentLoaded `js` is removed again unless the reveal and the menu scripts both wrote
  `document.documentElement.dataset.reveal` / `.menu = 'ready'` (keep those writes).
- **Reveal**: `[data-reveal]` (settle) and `[data-reveal="write"]` (handwriting wipe) get `.is-in` when
  they enter the viewport; elements that enter together are staggered by `--tiz-stagger`, unless they
  set `--tiz-reveal-delay`. Do not put plain `data-reveal` on an element with its own `transform`, nor
  the named Opera stage inside a `[data-reveal]` element.
- **View transitions**: native cross-document (`@view-transition`, 700 ms, only without reduced
  motion). Painting boxes carry `view-transition-name: opera-<slug>` in the lists, the hero, the quote
  band, Chi sono and on the Opera stage; each name must be unique on a page.
- **Phone menu** (`SiteHeader.astro`): `[data-tiz-header]`, `[data-menu-toggle]` (`aria-expanded`,
  «Menu» / «Chiudi»), `[data-menu]`; state `.is-open` on the header and `html.tiz-menu-open`. Esc, the
  button or a link closes it; focus is trapped, the rest of the page is inert, focus returns to the
  button.
- **Image viewer** (`image-viewer.ts`, unchanged by the redesign): opens from links with
  `data-viewer-open="<index>"` inside `[data-viewer-gallery]`. Native modal `<dialog>` (focus stays
  inside, Esc closes, focus returns to the link). Swipe / ← → change image, tap or click the painting
  to zoom at that point, pinch / wheel zoom, drag to pan, `+ − 0` keys, tap outside the painting
  closes. Required inner hooks: `data-viewer-stage`, `-image`, `-zoom`, `-close`, `-announcer`;
  optional `-prev`, `-next`, `-counter`. State classes: `.is-zoomed`, `.is-dragging`.
- **Stage / thumbnail swap** (`ArtworkGallery.astro`): `[data-gallery]` holds one
  `[data-gallery-slide="<i>"]` per photo (the first `.is-current`, the others `[hidden]`), each with
  its own `data-viewer-open` link, the thumbnails `[data-gallery-thumb="<i>"]` (`aria-current="true"` on
  the photo shown) and `[data-gallery-status]` (announces «Foto 2 di 3»). A thumbnail swaps the stage
  photo with a 700 ms crossfade (at once with reduced motion); clicking the stage opens the viewer at
  that photo. Without JS every link opens the full-size JPEG.
- **Contact form** (`ContactForm.astro`, `contact-form.ts`, rules in `lib/contatti.ts`):
  - Hooks: `[data-contact]` (root), `form[data-contact-form]` (`data-active`), the works as JSON in
    `script[data-contact-opere]`, the chip `[data-opera-chip]` (`data-slug`, `[data-opera-thumb]`,
    `[data-opera-title]`, `[data-opera-clear]`), `[data-error-for=name|email|message]`, `[data-submit]`,
    `[data-status]` (`data-tone` = `busy` / `error` / `failure` / `inactive`, `[data-status-title]`,
    `[data-status-text]`), `[data-contact-offline]`, `[data-contact-success]` with
    `[data-grazie-title]` and `[data-contact-again]`, the live region `[data-contact-live]`.
  - Order at the end of the form: the button «Invia →», the privacy note, then the **reserved status
    slot** (the height of the tallest message is kept, so a message never moves anything).
  - `?opera=<slug>`: a small inline script draws the chip while the page is parsed (no jump after
    the first paint); the hidden `opera` field and the subject follow; × clears both and removes
    `?opera` from the URL. An unknown or hidden slug is ignored.
  - Validation in Italian under each field (`aria-describedby`, `aria-invalid`), the input kept; JSON
    POST to Web3Forms with `fetch`; «Grazie!» replaces the form (focus on its heading, announced),
    «Scrivi ancora» brings back an empty form.
  - **Without JS**: a normal POST with hidden `access_key`, `subject`, `from_name`, the honeypot
    `botcheck` and `redirect` = `absoluteUrl(routes.contattiGrazie)`; Web3Forms then sends the visitor
    to `/contatti/grazie/`.
  - Until `src/data/sito.json → contatto.web3formsAccessKey` is set: «Il modulo non è ancora attivo»
    (with JS after validation; without JS at once, with the button off) and a build warning.

## 7. Constraints

- **Base path**: the site runs under `/tiz-art/` (preview) and `/` (tiz-art.ch). Never write
  `href="/…"` or `src="/…"`: use `routes.*`, `withBase()` or Astro’s generated asset URLs.
- **Italian only**, correct typography: ’ (not '), « », …, ×, –.
- **No contact details anywhere**: no e-mail address, phone, street address or social links — only
  the contact form.
- **Pure portfolio**: no prices, availability or shop elements.
- **Admin is separate**: `public/admin/` (her phone admin) has its own look and is not part of
  this design; `/admin/anteprime.json` must keep working; don’t link the admin from the site.
- **Quality bar**: semantic HTML, keyboard accessible, visible focus (`--tiz-focus`), touch
  targets ≥ 44 px, `prefers-reduced-motion`, everything readable without JS (only the form's fetch,
  the viewer, the phone menu overlay, the photo swap and the animations need it), mobile-first, no
  horizontal scroll at 320 px, no layout shift.
- **No new dependencies**, no framework, no Tailwind, no CDN or third-party scripts.
- **SEO** is handled in `BaseLayout.astro` (title «Titolo — Tiziana Tschudi Belloli», description,
  canonical, Open Graph, JSON-LD); pages pass `title`, `description`, `path`.

## 8. Checking your work

- `npm test`, `npm run check:content`, `npm run build` and the `/tiz-art/` build (§1) must pass.
- Look at every page at 320, 390, 800, 1280 and 1440 px, also without JS and with reduced motion: the
  phone menu, the viewer, the photo swap, the contact form with `?opera=sorellanza`, sending, and
  `/contatti/grazie/`. Compare with the frames (§ intro).
- Content edge cases (every layout must hold for them):
  - 1, 3 (frame 1l) or 60 published works; square, very tall («Estasi», 60 × 130 cm) and wide
    («…e fuori piove») canvases; a work without `larghezza` (laid out at 100 cm, no size line).
  - A work with an empty text («Guardami!»: no text block, no quote), with 3 photos («Il coraggio di
    guardare oltre»), without a year, with a 120-character title or one long word.
  - Fewer than 3 works *in evidenza* (the hero fills up), no work with a series («Le ultime opere»), no
    text that makes a quote (band hidden), only the hero works published.
  - No portrait (Chi sono shows the first hero painting), an empty motto (the artist's name) or bio.
  - `colore` missing (a file of an older admin: automatic) or set to any of the five paints: the
    stroke behind that work changes on every page, home included.
  - `?opera=` with an unknown or hidden slug (no chip), an empty Web3Forms key.
  - The 404 page at depth (`/tiz-art/a/b/c/`): styles, fonts and links still load.
