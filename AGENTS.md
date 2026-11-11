# Guide for AI assistants and developers

Portfolio website of the painter **Tiziana Tschudi Belloli** ("TIZ"), **https://tiz-art.ch**: Italian only,
no shop, contact only through a form. Astro 7 static site on GitHub Pages; Tiziana edits her artworks with a
phone admin (`public/admin/`) that commits to this repository. Owner: Martino Tschudi.

**Read [CONTRACTS.md](CONTRACTS.md) first.** It is the binding spec: data formats (§4), pages (§5), the
admin's thumbnail index (§6), admin behaviour (§7), deploy (§8). Overview: [README.md](README.md); owner
setup: [docs/SETUP.md](docs/SETUP.md).

## Before you change anything

- **Every push to `main` goes live** in about 1–3 minutes (`.github/workflows/deploy.yml`). If a step fails,
  nothing is published and the previous version stays online. Prefer a branch + pull request for anything
  larger than a text fix.
- **The repository is public.** Never commit passwords, tokens, API keys, `.env` files or personal data.
  `public/admin/auth.json` is the encrypted admin login: only the setup page (`<site>/admin/setup/`) or
  `npm run admin:setup` writes it; never edit or "fix" it by hand. `public/admin/auth.dev.json` is local only
  (git-ignored).
- **Content belongs to the admin.** `src/content/opere/**` and `src/content/profilo/**` are written by
  Tiziana's admin. Do not edit them unless asked; if you must, keep the admin's exact format
  (`JSON.stringify(data, null, 2)` + final newline, keys in contract order; `npm run check:content` warns
  otherwise) and never rename an artwork folder (the folder name is the slug, i.e. the public URL).
- `src/data/sito.json` holds fixed settings; the Web3Forms key in it is public by design.

## Commands

```bash
npm ci                  # install (Node ≥ 22.23.4, see .nvmrc; Astro 7.4 refuses older versions)
npm run dev             # http://localhost:4321
npm test                # node:test suites in scripts/test/, no network
npm run check:content   # validates src/content + src/data/sito.json against CONTRACTS.md §4
npm run build           # dist/
SITE_URL=https://martinotschudi.github.io BASE_PATH=/tiz-art/ npm run build && npm run preview   # preview base path
npm run admin:dev       # mock GitHub API on :8787 → http://localhost:4321/admin/index.html?api=http://localhost:8787
```

**Before every push**: `npm test`, `npm run check:content` and `npm run build` must pass; if you touched links
or assets, also the `/tiz-art/` build above. These are the same checks Deploy runs.

## Rules for code

- **Base path**: the site runs under `/tiz-art/` (preview) and `/` (tiz-art.ch). Never hard-code a leading `/`
  in a link or asset URL: use `import.meta.env.BASE_URL` in the site and the base computed from `location` in
  the admin (`public/admin/js/env.js`). Trailing slash on every page URL.
- **Keep the data rules in sync.** A change to a data format touches all of: CONTRACTS.md §4,
  `src/content.config.ts` (zod schema), `public/admin/js/model.js` (admin validation and serialisation),
  `scripts/check-content.mjs` and their tests. Change them together, never one alone. The paint names
  of `colore` also live in `src/components/lib/composition.ts` (`PAINTS`, which the schema imports, and
  `PAINT_CYCLE`), `src/styles/tokens.css` (`--tiz-<paint>`), `public/admin/admin.css` (`.swatch-<paint>`)
  and `public/admin/js/screens/form.js` (`COLORE_LABELS`); `scripts/test/design-sync.test.mjs` fails
  when any of them differs.
- **No contact details on the site**: no e-mail, phone, street address or social links anywhere (CONTRACTS §5.1).
- **Text**: user-facing text is Italian with correct typography (’ « » … ×); code comments in English.
  Artwork texts are plain text (`\n\n` = paragraph), always rendered as text, never as HTML/Markdown.
- **Site**: semantic HTML, no UI framework, no Tailwind, no trackers or third-party scripts. Colours, fonts,
  the type and spacing scales, gutters, shadows and motion are custom properties in `src/styles/tokens.css`
  (write a value that equals a token as the token; layout px read off one frame stay in the component); the
  design («Lo studio») is described as built in `docs/DESIGN-HANDOFF.md`. Artwork images go through `astro:assets` (AVIF/WebP); never crop a painting.
- **The film** on Chi sono (CONTRACTS §5.6) is site copy, not admin data: `public/video/noi-donna-2023.mp4`
  (MP4 H.264 + AAC, 720 px wide, ≤ 50 MB, faststart; never re-encode or rename it in passing) with its facts
  and texts in `src/components/lib/film.ts`. Replace the file and those constants together (`npm test`
  compares them; steps in `docs/SETUP.md` §8). A native `<video>`: `preload="none"`, no autoplay, usable
  without JS, no third-party player. It has no subtitles yet (§5.6).
- **Admin**: plain ES modules, no build step, no CDN, no external fonts; strict CSP in `index.html`. Never
  put untrusted strings into `innerHTML` (use `textContent`/DOM APIs). Phone first: 375 px wide, touch
  targets ≥ 44 px. It reads data only from the GitHub API, never from the deployed site.
- **Deploy**: keep the file name `deploy.yml` (the admin reads its runs by name), `permissions` minimal, the
  official actions on their newest major version. `.github/workflows/image-cache.yml` reads the
  Astro image cache every day so GitHub does not delete it after 7 quiet days (a cold build takes 3–5
  minutes instead of about 1); its cache key step, path and runner must equal deploy.yml's
  (`scripts/test/workflows.test.mjs`). Dependencies: only `astro`, `@astrojs/sitemap`, `sharp`;
  ask before adding one.

## Where things are

| What | Where |
|---|---|
| Content schema | `src/content.config.ts` (= CONTRACTS §4) |
| Pages, layout, components, styles | `src/pages/`, `src/layouts/`, `src/components/`, `src/styles/` |
| Name, repository, Web3Forms key, old WordPress redirects | `src/data/sito.json` |
| The film of the exhibition on Chi sono | `public/video/` (the MP4), `src/assets/video/` (its poster frame), `src/components/lib/film.ts` (facts, texts, box sizes), `src/components/chi/ChiFilm.astro` (player) |
| Site address and base path, redirects, sitemap | `astro.config.mjs` (from `SITE_URL` / `BASE_PATH`) |
| Deploy, image cache keep-alive | `.github/workflows/deploy.yml` (test, build, publish), `.github/workflows/image-cache.yml` (restores deploy.yml's Astro image cache every day; same key, path and runner, checked by `scripts/test/workflows.test.mjs`) |
| Admin | `public/admin/` (`js/` modules, `setup/` page); local mock: `scripts/dev/admin-dev.mjs` |
| Content validator | `scripts/check-content.mjs` |
| Tests | `scripts/test/` (`admin-*.test.mjs`, `content-*.test.mjs`, the site's design rules `composition`, `home`, `opera`, `chi`, `film` (also checks the committed film against its constants), `contatti`, `workflows` (image-cache.yml restores exactly deploy.yml's image cache), and `design-sync`, which checks the values the CSS, the `sizes` helpers, the admin and CONTRACTS share; `npm test` runs every `scripts/test/*.test.mjs` through the glob in `package.json`, there is no index file). The admin tests use the committed fixture `scripts/test/fixtures/repo/`, never the live `src/content` (Deploy runs `npm test` after every save of Tiziana) |
| Docs | `docs/SETUP.md` (owner), `docs/GUIDA-ADMIN.md` (Tiziana, Italian), `docs/DESIGN-HANDOFF.md` (the site's design as built) |
| Her signature (the logo) | `src/assets/firma.svg`: the «TiZ» she paints on her canvases, traced from her paint (one colour, `currentColor`). `src/components/Firma.astro` shows it (header, footer, under her text on an Opera page); BaseLayout carries the drawing once per page as a `<symbol>` (`src/components/lib/firma.ts`). Rebuild from the photo: `python3 scripts/dev/firma/make.py` (Pillow + numpy) |
| Site icons | `node scripts/dev/site-icons.mjs` writes `public/favicon.svg`, `favicon-32.png` and `apple-touch-icon.png` from `src/assets/firma.svg` and the colours in `tokens.css`; never edit them by hand (`design-sync` compares) |
