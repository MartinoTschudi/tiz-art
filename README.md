# TIZ — tiz-art.ch

Portfolio website of the painter **Tiziana Tschudi Belloli** (signature "TIZ"). Italian only, a pure portfolio:
no prices, no shop. Visitors reach her through a contact form; no e-mail address, phone number or street
address appears anywhere on the site. She adds and edits her paintings herself, from her phone, in a small
admin page.

| | |
|---|---|
| **Website** | https://tiz-art.ch (after the DNS switch, [docs/SETUP.md §5](docs/SETUP.md#5-custom-domain-tiz-artch)) |
| **Preview** | https://martinotschudi.github.io/tiz-art/ (until the switch; `noindex`) |
| **Admin (phone)** | `<site>/admin/`: Tiziana's e-mail + admin password |
| **Code** | https://github.com/MartinoTschudi/tiz-art (public, branch `main`), the source of truth |
| **Owner** | Martino Tschudi |

## Status (2 November 2026)

| Area | State |
|---|---|
| Code | complete: site, admin, deploy workflow, 12 artworks migrated from the old WordPress site |
| GitHub Pages | to enable ([SETUP §1](docs/SETUP.md#1-enable-github-pages)) |
| Admin login | to configure: token + password ([SETUP §2–3](docs/SETUP.md#2-create-the-access-token-for-the-admin)) |
| Contact form | Web3Forms key still empty ([SETUP §4](docs/SETUP.md#4-contact-form-web3forms)) |
| Domain | `tiz-art.ch` still points to the old WordPress.com site ([SETUP §5](docs/SETUP.md#5-custom-domain-tiz-artch)) |

## How it works

No server and no database: the GitHub repository *is* the database, GitHub Actions builds the site,
GitHub Pages serves it.

```
 Tiziana's phone                 GitHub: MartinoTschudi/tiz-art                         Visitors
 ┌─────────────────┐  1 commit   ┌──────────────────────────┐ push  ┌────────────────────────────┐
 │ <site>/admin/   │  per save   │ branch main              │ ────▶ │ Actions "Deploy"           │
 │ static JS page  │ ──────────▶ │  src/content/opere/<slug>│       │  npm test                  │
 │ (no build step) │  Git Data   │    opera.json + photos   │       │  npm run check:content     │
 │                 │  API        │  src/content/profilo/    │       │  astro build (sharp: AVIF, │
 │ token decrypted │ ◀────────── │  src/data/sito.json      │       │    WebP, image cache)      │
 │ from auth.json  │ reads tree, │  public/admin/auth.json  │       │  GitHub Pages ─────────────┼──▶ tiz-art.ch
 └─────────────────┘ run status  └──────────────────────────┘       └────────────────────────────┘

 Contact form on /contatti/ ──fetch──▶ api.web3forms.com ──e-mail──▶ Tiziana's inbox
```

- **Site**: [Astro 7](https://astro.build), static output, plain CSS with design tokens, no UI framework.
  Artwork photos are converted by Astro (`astro:assets` + sharp) into AVIF/WebP in several widths.
- **Admin**: `public/admin/`, plain ES modules served as-is at `<site>/admin/`. Login = e-mail + password,
  which decrypt a GitHub fine-grained token stored in `public/admin/auth.json` (AES-256-GCM, PBKDF2-SHA256
  600 000 rounds). It reads and writes the repository through the GitHub REST API; one commit per save.
- **Deploy**: `.github/workflows/deploy.yml`: tests → content check → build → GitHub Pages. The address
  (`SITE_URL`, `BASE_PATH`) comes from the Pages settings, so the same code works under `/tiz-art/` and `/`.
- **Contact form**: [Web3Forms](https://web3forms.com) (no backend of our own); the access key in
  `src/data/sito.json` is public by design.

## How content flows

1. Tiziana saves an artwork in the admin → the admin validates it (CONTRACTS.md §4), resizes the photos in
   the browser (≤ 2400 px JPEG, no EXIF/GPS) and commits `src/content/opere/<slug>/` to `main`.
2. The push starts **Deploy**: `npm test`, `npm run check:content` (the same rules again, with a clear
   message per file), `astro build`, upload, deploy. About 1–3 minutes.
3. The admin follows the latest Deploy run and shows "Pubblicazione in corso…" → "Online ✓".
4. If any step fails, nothing is published and the previous version stays online; the admin shows
   "Problema nell'ultima pubblicazione" with a link to the run.

Other changes (code, `src/data/sito.json`) go through normal commits on `main` and deploy the same way.

## Repository layout

```
.github/workflows/deploy.yml   build + publish (keep the file name: the admin reads its runs)
astro.config.mjs               site/base from SITE_URL/BASE_PATH, redirects from sito.json, sitemap
src/content.config.ts          content schema (= CONTRACTS.md §4)
src/content/opere/<slug>/      opera.json + photos, one folder per artwork (written by the admin)
src/content/profilo/           profilo.json + optional portrait (written by the admin)
src/data/sito.json             fixed settings: name, repository, Web3Forms key, old WordPress redirects
src/pages/ layouts/ components/ styles/   the public site (design values in src/styles/tokens.css)
public/admin/                  the admin (index.html, admin.css, js/, setup/, manifest, icons, auth.json)
scripts/check-content.mjs      content validator (npm run check:content)
scripts/admin-setup.mjs        creates public/admin/auth.json from the terminal (npm run admin:setup)
scripts/dev/admin-dev.mjs      local mock of the GitHub API for the admin (npm run admin:dev)
scripts/test/                  node:test suites (npm test, entry point index.js), no network
docs/                          SETUP (owner), GUIDA-ADMIN (Tiziana), DESIGN-HANDOFF (designer)
CONTRACTS.md                   the binding spec: data formats, pages, admin behaviour, deploy
```

## Running it

Requirements: **Node.js 22.23.4 or newer** (`.nvmrc` = 22; Astro 7.4 refuses older 22.x versions), npm, git.

```bash
git clone https://github.com/MartinoTschudi/tiz-art.git && cd tiz-art
npm ci                  # exactly the locked dependencies
npm run dev             # http://localhost:4321
npm test                # all tests (admin, setup, content check), no network
npm run check:content   # validate src/content and src/data/sito.json
npm run build           # static site in dist/
npm run preview         # serve dist/
```

Check the preview base path before pushing changes to links or assets:

```bash
SITE_URL=https://martinotschudi.github.io BASE_PATH=/tiz-art/ npm run build && npm run preview
# → http://localhost:4321/tiz-art/ : every link and image must stay under /tiz-art/
```

| Command | What it does |
|---|---|
| `npm run check:content [-- <folder>]` | Validates every artwork folder, the profile and `sito.json` (CONTRACTS.md §4). Exit code 1 on errors; warnings for photos > 3 MB or > 3000 px and an empty Web3Forms key |
| `npm run admin:setup` | Asks for e-mail, password and GitHub token and writes `public/admin/auth.json` (alternative to `<site>/admin/setup/`, [SETUP §3](docs/SETUP.md#3-admin-login-for-tiziana)) |
| `npm run admin:dev` | Mock GitHub API on `http://localhost:8787`, seeded from your working tree, plus a throw-away login (`public/admin/auth.dev.json`, printed in the console) |

**Trying the admin without touching GitHub**: run `npm run admin:dev` in one terminal and `npm run dev` in
another, then open `http://localhost:4321/admin/index.html?api=http://localhost:8787` and log in with the
printed test login. The `?api=` override only works on `localhost`/`127.0.0.1`; on any other address the
admin always talks to the real repository.

## Documentation

| Document | For | Content |
|---|---|---|
| [CONTRACTS.md](CONTRACTS.md) | developers, AI agents | Data formats, pages, admin behaviour, deploy: the rules every part follows |
| [AGENTS.md](AGENTS.md) | AI assistants, developers | How to work in this repository safely |
| [docs/SETUP.md](docs/SETUP.md) | Martino | One-time setup: Pages, token, admin login, contact form, domain switch, troubleshooting |
| [docs/GUIDA-ADMIN.md](docs/GUIDA-ADMIN.md) | Tiziana (Italian) | Using the admin on the phone |
| [docs/DESIGN-HANDOFF.md](docs/DESIGN-HANDOFF.md) | designer | Structure, tokens and components for the redesign |

No password, token or API key is stored in this repository in readable form. The admin token exists only
encrypted inside `public/admin/auth.json`; the Web3Forms key is public by design.
