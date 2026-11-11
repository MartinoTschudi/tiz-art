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
- Where a frame and the README disagree, the build follows the README (the spec): the beating dot after
  the motto also on phones (1c has none); «Guarda le opere →» under the phone intro (CONTRACTS §5.1);
  the phone quote attribution with the size and an arrow («— Tiziana, su «Sorellanza», 120 × 150 cm →»;
  1c shows the title only); on Contatti the label «La tua e-mail, per risponderti», a 5-row textarea and
  the chip with «Mi interessa» (1k: «La tua e-mail», 4 rows, no label); the Opere note «{n} tele, appese
  come nello studio» also with 3 works (1l shows «3 tele»).
- Captions in the hung lists that lie on their stroke (as in 1d / 1e / 1l) get a soft lino halo around
  the letters, invisible on the linen: dark script on blu or rosso would otherwise be below 3:1.
- Data the frames do not show is laid out so it cannot break the page: a small canvas keeps a caption at
  least 120 px wide; a title or series name over 40 characters gets the next smaller size; a motto with
  a line over 26 characters flows as text (40 / 56 px) instead of the three lines; a tall hero work is
  capped at 1.25 × its slot width; a wide work's stroke on the Opera stage stays within 40 px of it;
  with two published works the Opera page shows one neighbour, not the same one twice.
- The arrows ← → (neither font has them) are drawn in Lucida Grande, the font the frames fall back to
  on a Mac; elsewhere the system font.
- **Added after the handoff, without a frame**: the exhibition «noi, DONNA.» with its film on Chi sono
  (§2 «The exhibition block»). It is derived from frames 1h / 1i above it; nothing else on that page changed.

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
| `/` | `src/pages/index.astro` + `components/home/*` | **Hero** (1b / 1c, 800 px high at 1280): the motto in her hand, 150 px desktop, last word in rosso with the beating dot (the artist's name when the motto is empty; a long motto flows at 40 / 56 px), the intro line and «Guarda le opere →»; up to 3 works from `heroSlots` (the first 3 *in evidenza*, filled up with the first published works): the most square → large (with the note «{titolo}, {anno}»; at most 1.25 × its width high), the tallest → narrow, the other → small. Below 1024: motto → the large work → intro. **Series**: «noi, DONNA.» + year in her hand (a name over 40 characters at 84 / 48 px), the line from `SERIE_NOTE`, up to 5 works of the series outside hero and quote, hung by eye without sizes, «Tutte le {n} opere →» («Le ultime opere» when no work has a series). **Quote band** (gesso): the first sentence (20–140 characters) of a work's text, from the last work backwards, outside the hero; key word in rosso; «— Tiziana, su «{titolo}», {misure} →» links to the work; hidden when there is none. Large home footer |
| `/opere/` | `src/pages/opere/index.astro` | «Opere» (84 / 120 / 150 px) and the note «{n} tele, appese come nello studio» («{n} tele» on phones, «1 tela»), then ONE list of all published works in display order, hung by eye (1d / 1e / 1l). No grouping by series. No works: «Le opere saranno pubblicate presto.» |
| `/opere/<slug>/` | `src/pages/opere/[slug].astro` | **Opera** (1f / 1g). Desktop: «← Tutte le opere»; grid `minmax(0,1fr) 400px`, gap 64: the stage (720 px high, lower on short screens) with the painting whole (≤ 88 % × 92 %) and its stroke; the column «{nn} / {total} · {collezione}», the title in her hand, `<dl>` Anno / Misure / Tecnica (empty ones skipped), her text + «— TIZ» (block omitted when the text is empty), «Chiedi di quest’opera →» → `/contatti/?opera=<slug>`; a title over 40 characters is 64 px (48 phone). With 2 or more photos all of them as thumbnails under the stage (the one on the stage marked). Previous / next (wrapping; with two works only the other one, once) as two halves with 84 px thumbnails. 640–1023: the same, stacked. Phone: «← Opere» + TIZ in the header, the painting in a 440 px box, «{nn} / {total}», title, «anno · misure» / tecnica, text; a fixed bottom bar ← · «Chiedi di quest’opera» · →. JSON-LD `VisualArtwork` |
| `/chi-sono/` | `src/pages/chi-sono.astro` | «chi sono» in her hand, her name (h1), the portrait (`profilo.ritratto`, 4:5 crop allowed here only) with an ocra stroke and the note «nello studio» — without a portrait the first hero painting, uncropped, in its own paint, captioned «titolo», anno and linked; the motto (last word in rosso), the bio (`PlainText`, paragraphs 18 px apart), the dark button «Vedi le opere» and «Scrivimi →». Desktop (1h): grid `clamp(430px, 36vw, 460px)` | text, the picture sticky on tall screens; phone (1i): stacked. Under it, after a dashed line, the exhibition block with the film (no frame, see below). JSON-LD `Person` + `VideoObject` |
| `/contatti/` | `src/pages/contatti.astro` + `components/contatti/*` | **Contatti** (1j / 1k): the ottanio stroke block with «Scrivimi» (h1) and her line; the form (`ContactForm`): optional chip «Mi interessa» + title for `?opera=<slug>`, underline fields «Il tuo nome», «La tua e-mail, per risponderti», «Il tuo messaggio», «Invia →», the privacy note. Sent (1j-sent / 1k-sent): «Grazie!», «Il tuo messaggio è arrivato. Ti rispondo presto.», «Scrivi ancora». Stacked below 1024 |
| `/contatti/grazie/` | `src/pages/contatti/grazie.astro` | Where Web3Forms sends visitors without JS: the Scrivimi block as a decorative echo, «Grazie!» (h1), the line, «Guarda le opere →» / «Torna alla home». `noindex`, no canonical, not in the sitemap |
| `/404.html` | `src/pages/404.astro` | «pagina non trovata», «Qui la tela è ancora bianca.» (h1, one line), one line of text, «Guarda le opere →» / «Torna alla home» (as on Grazie), a blank canvas with a terracotta stroke. Served by GitHub Pages at any depth, so every URL is absolute with the base path; no canonical, noindex |
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

### The exhibition block on Chi sono (added after the handoff: no Claude Design frame)

Built in November 2026 from the page above it, not from a frame; rules in CONTRACTS §5.6. A `<section
id="mostra">` after the portrait / bio grid, set apart by a dashed line (`--tiz-divider`), on the same
grid (`.chi__grid`), so the film hangs on the portrait's line and the text on the bio's.

- **Text**: «la mostra» in her hand (the page's «chi sono» label: terracotta, −2deg), the title «noi,
  DONNA.» as an h2 in Bricolage 800 (48 / 56 / 64 px, tight, as the series title on the home), «Atelier
  Attila, Bellinzona · 22 aprile – 7 maggio 2023» in terra-2 (two lines on phones), the exhibition's own
  sentence in guillemets at the bio's size (18 / 20 px), and in small terra-2 «Il film dura 6 minuti e
  mezzo, con audio, senza sottotitoli.» (the film has no subtitles yet, CONTRACTS §5.6). From 640 px the
  middle dot between place and dates is drawn by CSS; the text itself has a comma there, hidden from
  the eye, so a screen reader and a copy of the line get one clean sentence.
- **The film** (`chi/ChiFilm.astro`): a tall tela, 340 × 606 / 320 × 571 / 280 × 499 px (≥ 1024 / ≥ 640 /
  phone), with the portrait's indent, `--tiz-shadow-tela`,
  an **ottanio** stroke across its lower half (shape 2, +5deg: the cold counterpoint to the warm frame and
  to the portrait's ocra) and the note «il film della mostra» in her hand (−3deg), as «nello studio» above.
  The tela has the ratio of the picture without the thin black bars at its sides (`FILM.bars`, 4 of 720
  px each) and film and posters fill it (`object-fit: cover`), so the bars are cut off; in full screen
  the whole picture shows (`contain`). On a short screen the tela gets smaller so that the film stays
  whole, down to 200 px wide (the play button is about 180 px): below about 360 px of screen height it
  is taller than the screen.
- **Play**: with JS the poster carries the site's rosso button «▶ Guarda il film» (`.tiz-btn`), low on the
  tela, clear of the painted face; the whole tela is the button. Its focus ring is the site's (2px rosso,
  3px offset) on a lino gap. After the press the browser's own controls take over. Without JS: the native
  controls on a light poster.
- **Layout**: ≥ 1024 the film left, the text right, title and words meeting at half the film's height
  (the label beside a painting); below 1024 one column: «la mostra» + title + place and dates → the film
  → the sentence and the line about the film.
- **Motion**: the tela settles and its stroke wipes in when it scrolls into view (`data-reveal` on the
  frame), the note is written in; nothing with reduced motion. The film never starts by itself.

## 3. Components and helpers

All in `src/components/`. Each `.astro` file has its own scoped `<style>` and a header comment with
the details; this is the map.

### Shared pieces

| File | Purpose | Props |
|---|---|---|
| `SiteHeader.astro` | Header and phone menu (§2, behaviour in §6). Its root `<header>` must stay a direct child of `<body>` | `back?` (`{ href, label }`: the phone back link instead of Menu; BaseLayout `headerBack`) |
| `SiteFooter.astro` | Footer, default or the large home one | `variant?` (`default` / `home`; BaseLayout `footerVariant`) |
| `Stroke.astro` | Decorative brushstroke behind a painting (`aria-hidden`, z-index −1; the parent needs `position: relative; isolation: isolate`). Wipes in on load, or when its `[data-reveal]` parent is revealed. Rough edge = `#tiz-rough` | `color` (normally `operaPaintVar(opera, published)`), `top` / `left` / `width` / `height` or `inset`, `rotate?` (−5deg), `delay?`, `shape?` (1 / 2), `class?` |
| `HungWorks.astro` | Works hung by eye at real scale: painting `min(cm × --tiz-k, 100%)` (k 2.3 / 2.0 / 2.2; 100 cm when `larghezza` is missing, then no size line), the item (caption) at least 120 px wide; MT margin cycle from 640, AL align cycle below, strokes on even indexes in the work's paint, laid out on the painting plus a 60 px caption allowance (`.tiz-hung__stroke-box`); caption title + «{w} × {h} cm» above the stroke with a lino halo; the link is named by its caption (`aria-labelledby`); reveal and hover lift, `view-transition-name: opera-<slug>`. Put it in a `.container` (it reaches into the gutter and clips there). Gaps from the parent: `--hung-gap` (phone, 52px), `--hung-gap-row` / `--hung-gap-col` (from 640, 48px / 56px) | `opere`, `offset?`, `headingLevel?` (2 / 3 / 4, default 3), `priorityCount?`, `transitionNames?` (default true; false for a second list of the same works), `label?`, `showSize?` (default true) |
| `ResponsivePicture.astro` | `<picture>` AVIF + WebP, width/height attributes, never crops; unstyled | `image`, `alt`, `preset` (`card` / `artwork` / `thumb`), `sizes`, `priority?` |
| `PlainText.astro` | The admin's plain text → paragraphs and line breaks, always escaped. Paragraph gap `var(--plain-text-gap, 1em)` (set it on a parent) | `text` |

### Home (`components/home/`)

| File | Purpose | Props |
|---|---|---|
| `HomeHero.astro` | Motto (lines written in at 0 / .5 / 1 s, size from the longest line; `mottoFlows` → one flowing text), the hero slots with strokes and the note, the intro. ≥ 1024 one grid with a "wall" of `min(622px, 52.53%)` of the content box (the 1280 frame's proportions from 1024 up), `min-height: min(800px, 62.5vw)`; the large work at most 1.25 × its slot width high. Entered through a view transition (`html.tiz-vt-in`) the paintings skip their settle | `hero` (`heroSlots(...)`), `motto`, `alone?` (nothing follows on the page) |
| `HomeSeries.astro` | The series section (title, year, `SERIE_NOTE`, `HungWorks showSize={false}` with closer gaps, «Tutte le {n} opere →»); nothing when there is no work | `series` (`pickSeries(...)`), `total` |
| `HomeQuote.astro` | The quote band: the painting with its stroke beside the quote (≥ 1024 a 400 px column with the 340 px painting, 640–1023 a 240 px column, phone the text alone) | `quote` (`pickQuote(...)`), `opera`, `afterHero?` (no series section above it) |

### Opera (`/opere/<slug>/`)

| File | Purpose | Props |
|---|---|---|
| `ArtworkGallery.astro` | The stage (stroke in the work's paint, its insets clamped to the cover with container units; the cover whole, `view-transition-name: opera-<slug>`), the photo thumbnails (swap with the `--tiz-dur-fade` crossfade) and the `ImageViewer` | `opera`, `paint` (`operaPaintVar(...)`) |
| `ImageViewer.astro` + `image-viewer.ts` | Full-screen `<dialog>` viewer: lino ground, round 48 px buttons, ×, counter (§6) | `images` (srcset, full, width, height, alt), `label` |
| `ArtworkFacts.astro` | `<dl>` Anno / Misure / Tecnica, empty ones skipped; phone: «anno · misure» / tecnica, terms for screen readers | `data` |
| `ArtworkPager.astro` | Previous / next (wrapping), two halves with 84 px thumbnails, a long title wraps inside its half; from 640 px | `prev?`, `next?` |
| `opera/OperaBar.astro` | Phone fixed bottom bar (88 px + safe area, below `--tiz-z-header`): ← · «Chiedi di quest’opera» · → (15 px below 360 px, one line); plain links | `prev?`, `next?`, `ask` (`routes.contattiOpera(slug)`) |

### Chi sono and Contatti

| File | Purpose | Props |
|---|---|---|
| `chi/ChiFigure.astro` | The Chi sono picture with its stroke and handwritten note: the portrait 4:5 (`object-fit: cover`, the only crop on the site) or a painting at its own ratio | `kind` (`ritratto` / `opera`), `image`, `alt`, `caption`, `paint`, `href?`, `transitionName?` |
| `chi/ChiFilm.astro` | The film of the exhibition (no frame): the tela with its stroke and note, the native `<video>` (`preload="none"`, light `poster`), the JS play button with the sharp lazy poster picture, kept in a `<template>` until the script runs (§6) | `poster` (a frame of the film), `caption?` («il film della mostra»), `paint?` (ottanio) |
| `contatti/Pagina.astro` | The two columns of the contact pages: Scrivimi block left (on top below 1024), the slot right | `titleId?` (makes «Scrivimi» the h1) |
| `contatti/Scrivimi.astro` | The ottanio stroke block with «Scrivimi» and her line (lino text with an ottanio halo for contrast); decorative echo without `titleId` | `titleId?` |
| `contatti/Grazie.astro` | «Grazie!» in rosso, the line, a slot for the actions | `level?` (1 / 2), `id?`, `focusable?` |
| `ContactForm.astro` + `contact-form.ts` | The contact form (§6) | `opere` (published works, for the chip), `labelledBy?` |

### Helpers (`src/components/lib/`, TypeScript, no markup)

`composition.ts`, `home.ts`, `opera.ts`, `chi.ts`, `film.ts` and `contatti.ts` are pure (no `astro:*` imports,
erasable TypeScript only): `scripts/test/<name>.test.mjs` imports them directly through Node's type
stripping. Between themselves they import with the explicit `.ts` extension (`import { PAGE_MAX } from
'./composition.ts'`), which both Vite and Node resolve. Their layout numbers are checked against the CSS
by `scripts/test/design-sync.test.mjs`.

| File | What |
|---|---|
| `composition.ts` | The design's rules: `PAINTS`, `PAINT_CYCLE`, `paintName`, `paintVar`; `MT` / `AL` / `SWL` / `SWT` / `SWR` with `hungAt` / `strokeAt`; the page frame `PAGE_MAX`, `GUTTERS`, `gutterAt` (the only copy: opera.ts and chi.ts import them); `REAL_SCALE`, `DEFAULT_CM`, `realScaleSizes`; `mottoParts`, `splitLastWord`; `heroSlots`; `firstSentence`, `pickQuote`; `pickSeries`; `LONG_TITLE`, `isLongTitle` |
| `home.ts` | Home / Opere copy and sizes: `HOME_INTRO`, `HERO_SIZES`, `QUOTE_SIZES`, `heroNote`, `longestLine`, `MOTTO_FLOW_CHARS`, `mottoFlows`, `allWorksLabel`, `firstName`, `quoteAttribution`, `opereCountNote` |
| `opera.ts` | Opera page layout numbers (keep in step with the CSS of ArtworkGallery / ArtworkPager): `STAGE`, `stageSizes`, `thumbSizes`, `pagerThumbSizes`, `neighbourIndexes` (wrap-around; two works: one neighbour each), `operaCounter` («01 / 12», spoken «Opera 1 di 12») |
| `chi.ts` | Chi sono picture boxes (400 × 500 / 360 × 450 / 280 × 350) and `chiSizes` (keep in step with ChiFigure; it takes other `boxes` for the film) |
| `film.ts` | The film of the exhibition: `FILM` (file, pixel size, the black side bars, seconds, bytes, upload date; `scripts/test/film.test.mjs` compares the committed file with it), `FILM_PATH`, `FILM_MAX_BYTES`, `MOSTRA` (title, place, dates, its sentence), `isoDuration` («PT6M38S»), `durationLabel` («6 minuti e mezzo»), `megabytes`, `FILM_BOXES` and `filmSizes` (keep in step with ChiFilm) |
| `contatti.ts` | Contact form rules and texts: endpoint, `SUBJECT`, `FROM_NAME`, `MIN_MESSAGE`, `LIMITS`, `MESSAGES`, `fieldError`, `subjectFor`, `operaLine`, `buildPayload`, `withoutOpera`, `isSent` |
| `opere.ts` | Queries (`getPublishedOpere`, `getAllOpere`, `getProfilo`, `firstHeroWork` (the first hero work: the sharing image of pages without one, Chi sono without a portrait), `groupByCollezione`, `neighbours`), text helpers (`formatDimensions` → «100 × 140 cm» with no-break spaces, `altText`, `paragraphs`, `excerpt`, `operaDescription`), `operaPaint` / `operaPaintVar` (the work's paint) and `composable()` (works → the shapes the composition rules take) |
| `site.ts` | `SITE`, `BASE`, `routes.*` (every internal URL with the base path, incl. `contattiOpera(slug)` and `contattiGrazie`), `withBase()`, `absoluteUrl()`, `IS_PREVIEW`, `SERIE_NOTE` |
| `images.ts` | Width presets and image helpers (§5) |
| `structured-data.ts` | JSON-LD `Person`, `VisualArtwork` and the film's `VideoObject` |

Data available on an artwork (`opera.data`): `titolo`, `anno` (number or null), `larghezza` /
`altezza` (cm or null), `tecnica`, `collezione`, `colore` (paint or null = automatic), `testo`,
`immagini` (ImageMetadata[], first = cover), `ordine`, `inEvidenza`, `pubblicata`, `creataIl`,
`aggiornataIl`. Profile: `motto`, `bio`, `ritratto` (ImageMetadata or null). Schema:
`src/content.config.ts` (= CONTRACTS §4 — do not change it for design reasons; the admin writes exactly
that format).

## 4. Tokens, fonts and global styles

- **`src/styles/tokens.css`**, all `--tiz-*`: colours (lino, gesso, filo, terra,
  terra-2 / -3, rosso, ocra, terracotta, ottanio, blu, and the roles `--tiz-error`, `--tiz-viewer-bg`),
  the two fonts, the type scale (`--tiz-mano-l` / `-s`, `--tiz-h1-name`, `--tiz-lead`, `--tiz-body`,
  `--tiz-small`, `--tiz-mano-caption`, `--tiz-signature`; the handoff's `--tiz-mano-xl`, `--tiz-mano-m`
  and `--tiz-display` are kept at their design values but not read: the home motto, the quote and
  «Opere» use the frames' fixed steps per breakpoint), spacing `--tiz-s1…8` and `--tiz-gutter`
  (20 / 32 / 48), layout (`--tiz-page-max` 1440,
  `--tiz-measure`, `--tiz-hit` 44px, header heights, `--tiz-bar-h` 88px, `--tiz-divider`,
  `--tiz-z-header`), shapes, shadows (`--tiz-shadow-tela` for paintings, `--tiz-shadow-tela-l` for the
  desktop Opera stage, `--tiz-shadow-thumb` / `-thumb-l` for the contact chip and the pager
  thumbnails), the linen / bristle / marker gradients (`--tiz-marker` for phones, `--tiz-marker-hit`
  from 640: the desktop frames' 37 px band inside the 44 px hit box, `--tiz-marker-nav`), focus
  (`--tiz-focus`, 2px rosso, 3px offset), motion (eases, durations, `--tiz-stagger`, `--tiz-lift`, the
  phone menu's `--tiz-dur-menu-*` / `--tiz-menu-*`), `--tiz-k` and the keyframes `tiz-stroke`,
  `tiz-write`, `tiz-settle`, `tiz-beat`. Reduced motion switches every animation off there.
- **What is a token**: colours, fonts, the type and spacing scales, gutters, shapes, shadows and motion
  always come from tokens.css; a value equal to a token is written as the token (`gap: var(--tiz-s4)`,
  `font: 600 var(--tiz-body)/1 …`). Layout numbers read off one frame (a box width, an offset, a margin
  of 28 or 56 px) stay as px in the component that uses them.
- **`src/styles/global.css`**: reset, the linen page, links, focus, the primitives `.container`,
  `.tiz-btn` / `.tiz-btn--dark` / `.tiz-btn--round`, `.tiz-marker` (the arrow after a word space:
  `Tutte le opere <span aria-hidden="true">→</span>`), `.tiz-write` / `.tiz-settle` (one-off load
  animations, delay `--d`), `.visually-hidden`, `.skip-link`, the reveal system and the view transitions.
- **Components**: scoped `<style>`, BEM-ish class names (shared pieces `tiz-hung`, `tiz-header`,
  `tiz-footer`, `tiz-stroke`; page-level pieces by their own name: `gallery`, `pager`, `opera-bar`,
  `chip`, `field`…). To change a child component from a parent, prefer the custom properties it offers;
  those are named after the component, without the `tiz-` prefix that is kept for tokens
  (`--hung-gap`, `--hung-gap-row`, `--hung-gap-col`, `--plain-text-gap`); otherwise wrap it and use
  `:global()`.
- **Fonts**: self-hosted in `src/assets/fonts/` (Vite hashes them and adds the base path),
  `@font-face` in tokens.css with `font-display: swap`, both preloaded in BaseLayout.
  - **TIZ Mano** (`--tiz-font-mano`) = Nanum Brush Script, latin subset, patched with the glyphs Italian
    needs (àèéìòù ÀÈÌÒÙ áéíóú « » ‹ › … – — ·) and renamed, because "Nanum" is an OFL Reserved Font
    Name. Rebuild it with `scripts/dev/make-mano-font.py` (fontTools + brotli). Her hand: titles, motto,
    signature, notes; never below 28px, never for paragraphs.
  - **Bricolage Grotesque** (`--tiz-font-voce`): one variable file, latin, wght 200–800, opsz 12–96.
  - **Until TIZ Mano has loaded** (swap): `'TIZ Mano fallback'`, a local Arial (or Liberation Sans /
    Arimo) with `size-adjust: 71%` and TIZ Mano's ascent / descent / line gap, so the motto and the
    titles break into the same lines and nothing moves when the font arrives (no layout shift on a slow
    connection). Re-measure the size-adjust if TIZ Mano is rebuilt.
  - **Arrows**: neither font has ← →. `'TIZ Frecce'` (local Lucida Grande, U+2190–2193 only) follows
    Bricolage in `--tiz-font-voce`: that is the arrow the frames show on a Mac (their stacks end at
    Bricolage); without Lucida Grande the system font draws them.
  - Licences: `public/fonts/OFL-tiz-mano.txt`, `public/fonts/OFL-bricolage-grotesque.txt`.
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
| Chi sono film: the poster in the play button (JS only: in a `<template>` until the script runs, then lazy) | `card` | `filmSizes` (film.ts): 340 / 320 / 280 px |
| Chi sono film: the `poster` attribute | One WebP as wide as the phone box (280 px), quality 60 (`posterUrl`): fetched with the page, so kept light | — |
| Opera stage | `artwork`: 540, 720, 960, 1280, 1600 | `stageSizes(ratio)` (opera.ts) |
| Opera photo thumbnails, pager | `thumb`: 360, 540, 720 | `thumbSizes` (84 / 64 px high), `pagerThumbSizes` (84 px high) |
| Full-screen viewer | WebP 1280, 1920 + a **full-size JPEG** (quality 90) as the largest candidate; also the no-JS link target and the JSON-LD `image` | — |
| Open Graph / Twitter; the film's JSON-LD `thumbnailUrl` | JPEG inside 1200 × 1200, quality 75 | — |
| Contact chip | One WebP at twice the size it is drawn at (`CONTACT_THUMB_SCALE`), the painting fitted into 96 × 64 (7/8 on phones) | — |
| Admin `anteprime.json` | WebP 480 | — |

Presets live in `src/components/lib/images.ts`; widths larger than the original are dropped. Rules:

- **Never crop, overlay, filter, round or recolour a painting** (no `object-fit: cover` on art; the
  portrait photo on Chi sono is the only exception). The only effect is a shadow token. Every `<img>`
  has width/height attributes and keeps its real aspect ratio (no layout shift).
- Alt text: `«Titolo», Tiziana Tschudi Belloli, 2023` (+ `, dettaglio N` for extra photos) from
  `altText()`.
- Only the first screen loads eagerly (`priority` / `priorityCount`); the rest is lazy.
- `sizes` is the true CSS width: a 3× phone picks the 3× candidate (on /opere/ about 1.3 MB of
  images against 0.6 MB at 2×). Capping 3× screens at about 2× (a `(min-resolution: 2.5dppx)` branch
  in front of every `sizes`) is an open choice for the owner; nothing does it today.
- On Opere and Chi sono the first paintings are `[data-reveal]` items: they are fetched with high
  priority but appear with the 800 ms settle, so the Largest Contentful Paint follows the animation
  (≈ 0.9 s / 1.4 s locally), not the network. That is the design's entrance; the Opera stage has none.

## 6. Behaviour (keep the hooks when restyling)

All vanilla TypeScript in Astro `<script>`s; everything is readable without JS.

- **`js` class and fallbacks** (BaseLayout): an inline script adds `js` to `<html>` before the first
  paint; CSS hides unrevealed elements and shows the Menu button only under `.js`. At
  DOMContentLoaded `js` is removed again unless the reveal and the menu scripts both wrote
  `document.documentElement.dataset.reveal` / `.menu = 'ready'` (keep those writes).
- **Reveal**: `[data-reveal]` (settle) and `[data-reveal="write"]` (handwriting wipe) get `.is-in` when
  they enter the viewport; elements that enter together are staggered by `--tiz-stagger`, unless they
  set `--tiz-reveal-delay`. Until then both kinds are hidden by `opacity` only, never by `clip-path`:
  Chrome's IntersectionObserver does not report an element that its own clip-path has clipped away, so
  such a line would never appear once it starts below the fold (`scripts/test/design-sync.test.mjs`
  guards it). Do not put plain `data-reveal` on an element with its own `transform`, nor
  the named Opera stage inside a `[data-reveal]` element.
- **View transitions**: native cross-document (`@view-transition`, 700 ms, only without reduced
  motion). Painting boxes carry `view-transition-name: opera-<slug>` in the lists, the hero, the quote
  band, Chi sono and on the Opera stage; each name must be unique on a page. A page entered through a
  view transition gets `html.tiz-vt-in` (BaseLayout, on `pagereveal`): a named painting that has a load
  animation must skip it there (HomeHero does), or the morph lands on an invisible box.
- **Hung list hooks**: `data-opera="<slug>"` on each `.tiz-hung__item` (for test scripts; no site code
  reads it); the caption ids `hung-<slug>-title` / `-size` name the link (`hung2-…` in a list with
  `transitionNames={false}`).
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
  its own `data-viewer-open` link, the thumbnails `[data-gallery-thumb="<i>"]` (one per photo, the cover
  included; `aria-current="true"` on the photo shown) and `[data-gallery-status]` (announces «Foto 2 di
  3»). A thumbnail swaps the stage photo with the slides' CSS crossfade (`--tiz-dur-fade`, 700 ms; at
  once with reduced motion: the script reads the transition time from the computed style); clicking
  the stage opens the viewer at that photo. Without JS every link opens the full-size JPEG.
- **Film** (`chi/ChiFilm.astro`): `[data-film]` holds the `<video>` (in the markup with `controls`: that
  is the page without JS) and the hidden `[data-film-play]` button with the poster picture in a
  `template[data-film-picture]` (inert: without JS nothing of it is fetched). The script unpacks the
  template, shows the button and takes `controls` off (one play symbol, also on iOS Safari); a press
  copies the picture's URL to `video.poster` if it has loaded, hides the button, puts `controls` back,
  focuses the video and calls `play()`. The film is not fetched before that (`preload="none"`), never
  loops or starts muted.
- **Contact form** (`ContactForm.astro`, `contact-form.ts`, rules in `lib/contatti.ts`):
  - Hooks: `[data-contact]` (root), `form[data-contact-form]` (`data-active`), the works as JSON in
    `script[data-contact-opere]`, the chip `[data-opera-chip]` (`data-slug`, `[data-opera-thumb]`,
    `[data-opera-title]`, `[data-opera-clear]`), `[data-error-for=name|email|message]`, `[data-submit]`,
    `[data-status]` (`data-tone` = `busy` / `error` / `failure` / `inactive`, `[data-status-title]`,
    `[data-status-text]`), `[data-contact-offline]`, `[data-contact-success]` with
    `[data-grazie-title]` and `[data-contact-again]`, the live region `[data-contact-live]`.
  - Order at the end of the form: the button «Invia →», the privacy note, then the **reserved status
    slot**: the height of the tallest message the form can show is kept (the not-active note while the
    key is empty, else the failure line), so a message never moves anything; it may reach 40 px into
    the space under the form (Pagina keeps at least 56 px there).
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
  the `?opera` chip — without JS «Chiedi di quest’opera» opens the form without the work —, the
  viewer, the phone menu overlay, the photo swap, the film's play button and the animations need it), mobile-first, no
  horizontal scroll at 320 px, no layout shift (also while the fonts load).
- **No new dependencies**, no framework, no Tailwind, no CDN or third-party scripts.
- **SEO** is handled in `BaseLayout.astro` (title «Titolo — Tiziana Tschudi Belloli», description,
  canonical, Open Graph, JSON-LD); pages pass `title`, `description`, `path`.

## 8. Checking your work

- `npm test`, `npm run check:content`, `npm run build` and the `/tiz-art/` build (§1) must pass.
  `scripts/test/design-sync.test.mjs` fails when a layout number in the CSS (stage, boxes, gutters,
  k, the hero wall, the film's box) no longer matches the helper that computes `sizes` from it, or when the paint
  names / colours of site, admin, validator and CONTRACTS differ: change both sides together.
  `scripts/test/film.test.mjs` fails when the committed film differs from `FILM` in lib/film.ts.
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
  - The film on Chi sono: without JS (native controls on the light poster), by keyboard (the button,
    then the player), in full screen (the whole picture, black beside it), on a short screen (a phone
    held sideways: the film stays whole down to about 360 px of screen height), with the play
    button pressed before the sharp poster has loaded.
  - `colore` missing (a file of an older admin: automatic) or set to any of the five paints: the
    stroke behind that work changes on every page, home included.
  - `?opera=` with an unknown or hidden slug (no chip), an empty Web3Forms key.
  - The 404 page at depth (`/tiz-art/a/b/c/`): styles, fonts and links still load.
