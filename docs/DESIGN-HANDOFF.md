# Design handoff — public site tiz-art.ch

For the designer / engineer who will give the public site its final look. The current design is a
deliberately neutral placeholder: warm paper background, system serif for titles, system sans for
text, one earth-red accent. Structure, data flow, images, SEO and behaviour are done; the look is
yours to change.

The binding rules (data format, file ownership, admin) are in `CONTRACTS.md`. This file explains
the public site only.

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

| URL | File | What it shows |
|---|---|---|
| `/` | `src/pages/index.astro` | Name (h1) + motto, buttons "Scopri le opere" / "Chi sono"; section "Opere in evidenza" (works marked *in evidenza* in the admin, or the first 6 if none) with link "Tutte le opere (N)"; "Chi sono" teaser (first paragraph of the bio); contact call-to-action "Un’opera ti ha colpito?" |
| `/opere/` | `src/pages/opere/index.astro` | All published works in the order set in the admin. One series → a single grid with "Dalla serie «…»"; several series → one titled section per series (works without a series last, "Altre opere") |
| `/opere/<slug>/` | `src/pages/opere/[slug].astro` | Cover large (whole painting, fits the screen height), other photos as thumbnails, full-screen viewer; title, facts (Anno, Misure, Tecnica, Collezione), text, button "Chiedi informazioni su quest’opera" → `/contatti/?opera=<slug>`, previous / next work |
| `/chi-sono/` | `src/pages/chi-sono.astro` | Motto, bio, buttons to works and contact; the portrait when the admin has one, otherwise the first featured painting (linked) |
| `/contatti/` | `src/pages/contatti.astro` | Contact form (the only way to reach the artist). `?opera=<slug>` pre-selects the work and shows its thumbnail |
| `/404.html` | `src/pages/404.astro` | "Pagina non trovata" + links to works and home |
| `/robots.txt` | `src/pages/robots.txt.ts` | Generated (base path, sitemap URL, preview = disallow all) |
| `/admin/anteprime.json` | `src/pages/admin/anteprime.json.ts` | Not a page: 480 px thumbnails for the admin (CONTRACTS §6). Do not remove |
| old WordPress URLs | `astro.config.mjs` | Redirect pages generated from `src/data/sito.json` → `redirectVecchioSito` |

Every page uses `src/layouts/BaseLayout.astro` (head, skip link, header, `<main>`, footer).

## 3. Components

All in `src/components/`. Each `.astro` file has its own scoped `<style>`.

| File | Purpose | Props / data |
|---|---|---|
| `SiteHeader.astro` | "TIZ" signature + name → home, nav Opere · Chi sono · Contatti (`aria-current` on the active section). Below 48 rem only "TIZ" is visible | — (reads `Astro.url`) |
| `SiteFooter.astro` | Signature, © year + name, link Contatti | — |
| `PageHeader.astro` | Title block of inner pages: small label, h1, lead | `title`, `eyebrow?`, `lead?` |
| `ArtworkGrid.astro` | Justified rows of works (each row one height, real proportions, left → right order). Pure CSS | `opere`, `headingLevel?` (2/3), `priorityCount?` (eager covers above the fold), `label?` |
| `ArtworkCard.astro` | One work in a grid: cover, title, "2023 · 100 × 140 cm" | `opera`, `headingLevel?`, `priority?` |
| `ArtworkGallery.astro` | Cover + detail thumbnails on an artwork page; links open the viewer (no JS: the full-size JPEG) | `opera` |
| `ImageViewer.astro` + `image-viewer.ts` | Full-screen `<dialog>` viewer (see §6) | `images` (srcset, full, width, height, alt), `label` |
| `ArtworkFacts.astro` | `<dl>` Anno / Misure / Tecnica / Collezione, empty ones skipped | `data` (artwork data) |
| `ArtworkPager.astro` | Previous / next work (wraps around) | `prev?`, `next?` |
| `PlainText.astro` | The admin’s plain text → paragraphs and line breaks, always escaped | `text` |
| `ResponsivePicture.astro` | `<picture>` AVIF + WebP with width presets; never crops | `image`, `alt`, `preset` (`card`/`artwork`/`thumb`), `sizes`, `priority?` |
| `ContactForm.astro` + `contact-form.ts` | Contact form (see §6) | `opere` (published works for the select) |

Helpers (TypeScript, no markup) in `src/components/lib/`:

| File | What |
|---|---|
| `site.ts` | `SITE` (name, signature, Web3Forms key), `BASE`, `routes.*` (every internal URL, base path included), `withBase()`, `absoluteUrl()`, `IS_PREVIEW` |
| `opere.ts` | Queries (`getPublishedOpere`, `getFeaturedOpere`, `getAllOpere`, `getProfilo`, `groupByCollezione`, `neighbours`) and text helpers (`formatDimensions` → "100 × 140 cm", `metaLine`, `altText`, `paragraphs`, `excerpt`, `operaDescription`) |
| `images.ts` | Width presets and image helpers (§5) |
| `structured-data.ts` | JSON-LD `Person` and `VisualArtwork` |

Data available on an artwork (`opera.data`): `titolo`, `anno` (number or null), `larghezza` /
`altezza` (cm or null), `tecnica`, `collezione`, `testo`, `immagini` (ImageMetadata[], first =
cover), `ordine`, `inEvidenza`, `pubblicata`, `creataIl`, `aggiornataIl`. Profile: `motto`, `bio`,
`ritratto` (ImageMetadata or null). Schema: `src/content.config.ts` (= CONTRACTS §4 — do not change
it for design reasons; the admin writes exactly that format).

## 4. Design tokens and styles

- **`src/styles/tokens.css`** — every design value as a CSS custom property: colours
  (`--color-*`, including the viewer’s), font stacks and type scale (`--font-*`, `--text-*`,
  `--leading-*`, `--tracking-*`, `--weight-*`), spacing (`--space-1…9`, `--gutter`,
  `--section-gap`), layout (`--width-page`, `--width-text`, `--header-height`, `--tap-target`,
  `--grid-row` / `--grid-gap` / `--grid-row-gap` for the artwork grids, `--artwork-max-height`),
  shape (`--radius-*`, `--focus-ring`, `--shadow-art`) and motion (`--duration-*`, `--ease`;
  set to 0 under `prefers-reduced-motion`). Breakpoints used: 48 rem, 64 rem, 80 rem.
- **`src/styles/global.css`** — reset, page defaults, and the shared primitives: `.container`,
  `.button` / `.button--quiet`, `.arrow-link`, `.eyebrow`, `.visually-hidden`, `.skip-link`.
- **Components** — scoped `<style>` with BEM-ish class names (`.artwork-card__title`,
  `.gallery__cover`…), values only from tokens. To style the inside of a child component from a
  parent, wrap it and use `:global()` (example: `.artwork-card__media :global(img)`).
- `theme-color` in `BaseLayout.astro` and the colours in `public/favicon.svg` repeat
  `--color-bg` / `--color-highlight` (they cannot read CSS variables): update them together.
- Fonts: system fonts only, no request to a font service. If the new design needs a web font,
  self-host the `.woff2` files (e.g. `public/fonts/`, referenced with the base path) and preload
  the one used by the h1.

## 5. Images

Photos are uploaded through the admin as JPEG (longest side ≤ 2400 px) next to `opera.json`.
Everything else is generated at build time by `astro:assets` + sharp (cached in CI):

| Where | Format | Widths (px, never larger than the original) |
|---|---|---|
| Grid cards (home, /opere/), Chi sono picture | AVIF `<source>` + WebP `<img>` | 360, 540, 720, 960, 1280 (`card`) |
| Artwork page cover | AVIF + WebP | 540, 720, 960, 1280, 1600 (`artwork`) |
| Artwork page thumbnails | AVIF + WebP | 360, 540, 720 (`thumb`) |
| Full-screen viewer | WebP 1280, 1920 + a **full-size JPEG** (quality 90, the photo's own size) as largest candidate; zooming loads it. Also the no-JS link target and the JSON-LD `image` | — |
| Open Graph / Twitter | JPEG | 1200 |
| Contact form thumbnail | WebP | 240 |
| Admin `anteprime.json` | WebP | 480 |

Presets live in `src/components/lib/images.ts`; `sizes` is set where the image is used (update it
if you change a layout width). Rules to keep:

- **Never crop a painting** (no `object-fit: cover` on art). Every `<img>` has width/height
  attributes and keeps its real aspect ratio (no layout shift). Cards and the cover expose the
  ratio as `--ratio`.
- Alt text: `«Titolo», Tiziana Tschudi Belloli, 2023` (+ `, dettaglio N` for extra photos) from
  `altText()`.
- Only the first screen loads eagerly (`priority` / `priorityCount`); the rest is lazy.

## 6. Behaviour (keep the hooks when restyling)

- **Image viewer** (`image-viewer.ts`, vanilla, no dependency): opens from links with
  `data-viewer-open="<index>"` inside `[data-viewer-gallery]`. Native modal `<dialog>` (focus stays
  inside, Esc closes, focus returns to the link). Swipe / ← → change image, tap or click the painting
  to zoom at that point, pinch / wheel zoom, drag to pan, `+ − 0` keys, tap outside the painting
  closes. Required inner hooks: `data-viewer-stage`, `-image`, `-zoom`, `-close`, `-announcer`;
  optional `-prev`, `-next`, `-counter`. State classes for styling: `.is-zoomed`, `.is-dragging`.
- **Contact form** (`contact-form.ts`): Italian validation, sends JSON to Web3Forms with `fetch`
  (works without JS as a normal POST). Hooks: `form[data-contact-form]`, `[data-error-for=…]`,
  `[data-status]` (tone in `data-tone="success|error"`), `[data-submit]`, `[data-opera-preview]`.
  Error lines and the status line reserve their height (no jumping). Until
  `src/data/sito.json → contatto.web3formsAccessKey` is set, sending shows "Il modulo non è ancora
  attivo" and the build prints a warning.

## 7. Constraints

- **Base path**: the site runs under `/tiz-art/` (preview) and `/` (tiz-art.ch). Never write
  `href="/…"` or `src="/…"`: use `routes.*`, `withBase()` or Astro’s generated asset URLs.
- **Italian only**, correct typography: ’ (not '), « », …, ×, –.
- **No contact details anywhere**: no e-mail address, phone, street address or social links — only
  the contact form.
- **Pure portfolio**: no prices, availability or shop elements.
- **Admin is separate**: `public/admin/` (her phone admin) has its own look and is not part of
  this design; `/admin/anteprime.json` must keep working; don’t link the admin from the site.
- **Quality bar**: semantic HTML, keyboard accessible, visible focus (`--focus-ring`), touch
  targets ≥ 44 px, `prefers-reduced-motion`, everything readable without JS (except form submit
  and viewer), mobile-first, no horizontal scroll at 320 px.
- **SEO** is handled in `BaseLayout.astro` (title "Titolo — Tiziana Tschudi Belloli", description,
  canonical, Open Graph, JSON-LD); pages pass `title`, `description`, `path`.

## 8. Checking your work

- `npm run build` must pass (the content schema also validates every artwork).
- Check both base paths (§1) and at phone (390 px) and desktop (1440 px) widths, including the
  viewer and the contact form with `?opera=sorellanza`.
- Content edge cases worth a look: a work with an empty text ("Guardami!"), a very tall work
  ("Estasi", 60 × 130 cm), a wide one ("…e fuori piove"), a work with 3 photos
  ("Il coraggio di guardare oltre"), a long title.
