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
  `scripts/check-content.mjs` and their tests. Change them together, never one alone.
- **No contact details on the site**: no e-mail, phone, street address or social links anywhere (CONTRACTS §5.1).
- **Text**: user-facing text is Italian with correct typography (’ « » … ×); code comments in English.
  Artwork texts are plain text (`\n\n` = paragraph), always rendered as text, never as HTML/Markdown.
- **Site**: semantic HTML, no UI framework, no Tailwind, no trackers or third-party scripts. All design values
  are custom properties in `src/styles/tokens.css`; the redesign brief is `docs/DESIGN-HANDOFF.md`. Artwork
  images go through `astro:assets` (AVIF/WebP); never crop a painting.
- **Admin**: plain ES modules, no build step, no CDN, no external fonts; strict CSP in `index.html`. Never
  put untrusted strings into `innerHTML` (use `textContent`/DOM APIs). Phone first: 375 px wide, touch
  targets ≥ 44 px. It reads data only from the GitHub API, never from the deployed site.
- **Deploy**: keep the file name `deploy.yml` (the admin reads its runs by name), `permissions` minimal, the
  official actions on their newest major version. Dependencies: only `astro`, `@astrojs/sitemap`, `sharp`;
  ask before adding one.

## Where things are

| What | Where |
|---|---|
| Content schema | `src/content.config.ts` (= CONTRACTS §4) |
| Pages, layout, components, styles | `src/pages/`, `src/layouts/`, `src/components/`, `src/styles/` |
| Name, repository, Web3Forms key, old WordPress redirects | `src/data/sito.json` |
| Site address and base path, redirects, sitemap | `astro.config.mjs` (from `SITE_URL` / `BASE_PATH`) |
| Admin | `public/admin/` (`js/` modules, `setup/` page); local mock: `scripts/dev/admin-dev.mjs` |
| Content validator | `scripts/check-content.mjs` |
| Tests | `scripts/test/` (`admin-*.test.mjs`, `content-*.test.mjs`; `npm test` runs every `scripts/test/*.test.mjs` through the glob in `package.json`, there is no index file). The admin tests use the committed fixture `scripts/test/fixtures/repo/`, never the live `src/content` (Deploy runs `npm test` after every save of Tiziana) |
| Docs | `docs/SETUP.md` (owner), `docs/GUIDA-ADMIN.md` (Tiziana, Italian), `docs/DESIGN-HANDOFF.md` |
| Site icons | `public/favicon.svg` → `node scripts/dev/site-icons.mjs` renders `favicon-32.png` and `apple-touch-icon.png` |
