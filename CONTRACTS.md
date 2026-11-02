# CONTRACTS — tiz-art.ch

Shared rules between the public site (Astro), the admin (static JS in `public/admin/`), the deploy
workflow and the scripts. Every part must follow this file. If something here is wrong or missing,
do not silently diverge: write the problem in your final report.

## 1. What this is

Portfolio website of the painter **Tiziana Tschudi Belloli** (signature "TIZ"), domain **tiz-art.ch**.
Italian only. Pure portfolio: no prices, no shop, no availability. Visitors contact her only through a
**contact form** (no e-mail address, phone or street address is ever shown on the site). Every artwork
page has a "Chiedi di quest’opera" action that opens the contact form pre-filled with that artwork (with
JavaScript; without it the form opens without the work, §5.5).

Her mother-tongue admin (`/admin/`) runs on a phone: log in, take/choose photos, fill a few fields,
save. Saving commits to GitHub; GitHub Actions rebuilds and publishes the site (≈1–3 minutes).

The public site is built in the design **«Lo studio»** by Claude Design; `docs/DESIGN-HANDOFF.md`
describes it as built. Its structure stays clean, semantic and easy to restyle. The admin keeps its own
simple, phone-first look.

## 2. Stack

- Astro 7 (static output), Node ≥ 22.23.4 (Astro 7.4.4 refuses older versions), `sharp` for images, `@astrojs/sitemap`. No other runtime
  dependencies. No UI framework, no Tailwind. Plain CSS with custom properties.
- Hosting: GitHub Pages via GitHub Actions, repository **MartinoTschudi/tiz-art** (public), branch `main`.
- Until the DNS of tiz-art.ch is switched, the site is served at
  `https://martinotschudi.github.io/tiz-art/` (base path `/tiz-art/`). After the switch it is served at
  `https://tiz-art.ch/` (base path `/`). **Everything must work under both**: never hard-code `/` in
  links or asset URLs — use `import.meta.env.BASE_URL` (site) or a base computed from `location` (admin).
- Build env (set by the workflow from `actions/configure-pages`): `SITE_URL` (origin, e.g.
  `https://martinotschudi.github.io`) and `BASE_PATH` (e.g. `/tiz-art/`, always ends with `/`). Locally both
  default to `https://tiz-art.ch` and `/`. An `http://` `SITE_URL` is upgraded to `https://` (except on
  localhost): configure-pages reports `http://` while "Enforce HTTPS" is still off.
- When `SITE_URL` contains `github.io`, the site is a preview: every page gets
  `<meta name="robots" content="noindex">` and `robots.txt` disallows everything.

## 3. Repository layout

```
astro.config.mjs                 site agent
src/content.config.ts            site agent (zod schema = section 4, must match exactly)
src/components/lib/              site agent (TypeScript helpers)
tsconfig.json                    site agent
src/content/opere/<slug>/opera.json      one folder per artwork (written by the admin)
src/content/opere/<slug>/<image>.jpg     its photos (written by the admin)
src/content/profilo/profilo.json         bio etc. (written by the admin)
src/content/profilo/<image>.jpg          optional portrait (written by the admin)
src/data/sito.json               fixed technical config (NOT editable in the admin)
src/layouts/, src/components/, src/styles/, src/pages/   site agent
src/pages/admin/anteprime.json.ts         site agent (thumbnail index for the admin, section 6)
public/ (except public/admin/)            site agent (favicon etc.)
public/admin/**                  admin agent (index.html, admin.css, js/*.js, manifest, icons, setup/)
public/admin/auth.json           created by the setup page / setup script, never by hand
scripts/admin-setup.mjs          admin agent (CLI alternative to the setup page)
scripts/dev/admin-dev.mjs        admin agent (`npm run admin:dev`: local mock GitHub API, section 7.6)
scripts/check-content.mjs        infra agent (`npm run check:content`, validates section 4)
scripts/test/admin-*.test.mjs    admin agent       scripts/test/content-*.test.mjs   infra agent
scripts/test/{composition,home,opera,chi,contatti,design-sync}.test.mjs   site agent (the site's design rules)
scripts/dev/make-mano-font.py, src/assets/fonts/   site agent (the self-hosted fonts, docs/DESIGN-HANDOFF.md §4)
scripts/test/fixtures/repo/      admin agent (small committed copy of src/content for the tests, section 8)
scripts/dev/site-icons.mjs       site agent (renders favicon-32.png / apple-touch-icon.png from favicon.svg)
.github/workflows/deploy.yml     infra agent
docs/DESIGN-HANDOFF.md           site agent
docs/GUIDA-ADMIN.md              admin agent (Italian, for Tiziana)
docs/SETUP.md, README.md, AGENTS.md, CLAUDE.md   infra agent
package.json, CONTRACTS.md       fixed — do not edit (report needed changes instead)
```

## 4. Data

### 4.1 Artwork — `src/content/opere/<slug>/opera.json`

```json
{
  "titolo": "Sorellanza",
  "anno": 2023,
  "larghezza": 120,
  "altezza": 150,
  "tecnica": "Acrilico su tela",
  "collezione": "noi, DONNA.",
  "colore": "terracotta",
  "testo": "Primo paragrafo.\n\nSecondo paragrafo.",
  "immagini": ["./01.jpg", "./02.jpg"],
  "ordine": 120,
  "inEvidenza": true,
  "pubblicata": true,
  "creataIl": "2023-09-23T12:00:00.000Z",
  "aggiornataIl": "2023-09-23T12:00:00.000Z"
}
```

| field | type | rule |
|---|---|---|
| `titolo` | string | required, 1–120 chars, no spaces at the start or end (rejected, not stripped) |
| `anno` | integer \| null | 1900–2100 |
| `larghezza`, `altezza` | number \| null | centimetres, > 0, ≤ 1000, max 1 decimal. Displayed "100 × 140 cm" / "100,5 × 80 cm" (width × height, Italian decimal comma). Shown only when both are set |
| `tecnica` | string | may be `""`, ≤ 120 chars (e.g. "Acrilico su tela", "Acrilico e olio su tela") |
| `collezione` | string | series name, may be `""`, ≤ 120 chars |
| `colore` | string \| null | colour of the brushstroke painted behind the work on the site: `"ocra"`, `"rosso"`, `"terracotta"`, `"ottanio"` or `"blu"`; `null` = automatic (see below). The admin always writes the key; a file without it is still valid and reads as `null` |
| `testo` | string | may be `""`, ≤ 5000 chars. Plain text: paragraphs separated by a blank line (`\n\n`), single `\n` = line break. Never HTML/Markdown — render as text |
| `immagini` | string[] | 1–8 entries, each `./<file>` in the same folder, file name `^[a-z0-9][a-z0-9._-]*\.(jpg\|jpeg\|png\|webp)$`. The FIRST image is the cover. No duplicate entries |
| `ordine` | integer | ascending = shown first. Ties broken by `creataIl` descending |
| `inEvidenza` | boolean | featured: the first 3 published `inEvidenza` works in display order make the composition at the top of the home page (§5.1); any further ones have no effect there |
| `pubblicata` | boolean | `false` = hidden everywhere on the public site (draft), no page generated |
| `creataIl`, `aggiornataIl` | string | ISO 8601 UTC |

- **Brushstroke colour.** Every stroke behind this work, on every page (lists, the work's page, Chi sono,
  the home hero and quote band), is `var(--tiz-<colore>)` (design tokens: ocra
  `#d6982b`, rosso `#c3262b`, terracotta `#b5532f`, ottanio `#1d7377`, blu `#2c55a0`). When `colore` is
  `null` (or the key is missing), the colour is automatic:
  `PAINT_CYCLE = ['ocra', 'rosso', 'ottanio', 'terracotta', 'blu']`, indexed by the work's position in the full
  published list in display order (`getPublishedOpere()`, index mod 5). So a work keeps the same colour on every
  page; it changes only when the published order changes.
- **A missing `colore` key** (a file saved by an admin older than this field) is accepted everywhere and
  treated as `null`: the zod schema defaults it, the admin normalises it when reading (and rewrites the file
  in the current format on the next «Salva», even without a change), and `npm run check:content` only
  **warns**. Every other key stays required.
- Unknown extra keys are not allowed (the schema is strict) — this catches typos.
- **Slug** = folder name, `^[a-z0-9]+(?:-[a-z0-9]+)*$`, ≤ 60 chars, derived once from the title at
  creation (lowercase, accents stripped: "Gioventù" → `gioventu`, "…e fuori piove" → `e-fuori-piove`),
  made unique with `-2`, `-3`… It never changes afterwards (stable URLs), even if the title changes.
- JSON files: UTF-8, 2-space indentation, keys in the order above, trailing newline.
- Images written by the admin: JPEG, longest side ≤ 2400 px, quality ≈ 0.88, no EXIF (no GPS), file
  name `NN-xxxxxx.jpg` (2-digit position at upload time + 6 random `[a-z0-9]`), so a replaced photo always
  gets a new name (no stale caches). Migrated works use `01.jpg`, `02.jpg`… Both are valid.
- A folder contains exactly `opera.json` + the images it references. Deleting an artwork deletes the
  whole folder. Removing a photo from an artwork deletes its file.

### 4.2 Profile — `src/content/profilo/profilo.json`

```json
{
  "motto": "Dialogo tra testa e cuore.",
  "bio": "Paragrafo.\n\nParagrafo.",
  "ritratto": null,
  "aggiornatoIl": "2026-11-02T12:00:00.000Z"
}
```

`motto` ≤ 160 chars (may be `""`), `bio` ≤ 8000 chars plain text like `testo`, `ritratto` = `null` or
`"./<file>"` in the same folder (same file-name rule as artwork images; the admin writes `ritratto-xxxxxx.jpg`), strict schema.

### 4.3 Fixed config — `src/data/sito.json`

`nome` (artist name), `firma` ("TIZ"), `dominio`, `lingua`, `repository {owner, repo, branch}`,
`contatto.web3formsAccessKey` (empty until the owner creates it — section 5.4), `redirectVecchioSito`
(old WordPress paths → new paths). Read by the site at build time and by the admin at runtime
(`<base>/admin/../` is not reachable for `src/` files, so the admin gets owner/repo/branch from `auth.json`).

## 5. Public site (site agent)

### 5.1 Pages (all Italian, all under BASE_PATH, trailing slash always)

| path | content |
|---|---|
| `/` | **Hero composition**: the motto (last word in rosso; the artist's name when the motto is empty) and up to 3 works = the first 3 published `inEvidenza` works in display order, filled up with the first published works not already picked when fewer than 3. Slots by aspect ratio: the most square → large (ties: larger canvas, then display order), the tallest of the rest → narrow, the other → small; the handwritten note "{titolo}, {anno}" under the large one; the intro paragraph with "Guarda le opere →". Below 1024 px: motto → the large work → paragraph. Then the **series section**: the `collezione` of the first hero work (else the most common non-empty one) with the highest `anno` of its works and up to 5 of its published works that are not in the hero or the quote ("Le ultime opere" and the first 5 such works when no work has a series), and the link "Tutte le {n} opere →". Then the **quote band**: the first sentence (20–140 chars) of a published work's text outside the hero, searched from the last work in display order backwards, with that painting; hidden when there is none; the attribution links to the work. Then the large home footer. No bio teaser, no contact call-to-action |
| `/opere/` | ONE list of all published works in display order (`ordine`), hung at real relative scale ("{n} tele, appese come nello studio"; "1 tela"). No grouping or filtering by `collezione` |
| `/opere/<slug>/` | the cover on a stage with the work's brushstroke behind it (whole painting); with 2 or more photos all of them as thumbnails under it, the one on the stage marked (tap = swap the stage image; without JS a link to the full-size JPEG); tap on the stage = full-screen viewer with zoom, keyboard + swipe; "{nn} / {total} · {collezione}" (series part omitted when empty), title, `<dl>` Anno / Misure / Tecnica (empty ones skipped), her text + "— TIZ" (the block is omitted when the text is empty), "Chiedi di quest’opera →" → `/contatti/?opera=<slug>`, previous/next work (wrapping around; with two published works only the other one, as next on the first and previous on the second). Phone: a fixed bottom bar with ← · the button · → |
| `/chi-sono/` | `profilo.ritratto` (4:5 crop allowed here only: it is a photo, not a painting) with an ocra brushstroke and the note "nello studio"; without a portrait the first hero painting, uncropped, captioned «titolo», anno. Name, motto (last word in rosso), bio (`profilo.bio`, plain text), "Vedi le opere" and "Scrivimi →" |
| `/contatti/` | contact form (5.4) |
| `/contatti/grazie/` | the form's success page for visitors without JS (5.4); `noindex`, not in the sitemap |
| `/404.html` | Italian 404: "Qui la tela è ancora bianca.", "Guarda le opere →" and "Torna alla home" |
| old WordPress paths | static redirect pages from `sito.json` `redirectVecchioSito` (meta refresh + canonical, noindex); a target artwork that is hidden or deleted redirects to `/opere/` instead |
| `/admin/anteprime.json` | section 6 |
| `/sitemap-index.xml`, `/robots.txt` | sitemap of public pages only (not `/contatti/grazie/`); robots allows all except `/admin/` (preview: disallow all) |

Header: "TIZ" + name → home; nav Opere · Chi sono · Contatti with the marker on the current section:
`aria-current="page"` on its own page, `aria-current="true"` on a page inside it (`/opere/<slug>/`,
`/contatti/grazie/`). On phones a "Menu" button opens a full-screen menu ("Chiudi" closes it); without JS the
three links show as a row.
Footer: "TIZ" and "© {year} Tiziana Tschudi Belloli"; the home page has a larger footer with the motto, the
nav Opere · Chi sono · Scrivimi (= Contatti) and "© {year} Tiziana Tschudi Belloli · tiz-art.ch".
**No address, phone, e-mail or social links anywhere.**

### 5.2 Images
Use `astro:assets` (`<Picture>`/`getImage`) with AVIF + WebP + responsive widths. Never ship the
original file at all: the full-screen viewer's largest size (and the no-JS link / JSON-LD image) is a full-size JPEG rendition generated at build time (Astro deletes originals it considers unreferenced, per emitted file name, so linking originals breaks when two photos are byte-identical). Covers on
listing pages keep the painting's real aspect ratio (no cropping of art). Alt text: `«Titolo», Tiziana
Tschudi Belloli, anno` (+ "dettaglio N" for extra images).

### 5.3 SEO
Per page `<title>` ("Titolo — Tiziana Tschudi Belloli"; home: "Tiziana Tschudi Belloli — TIZ"),
meta description (from text, ≤ 155 chars), canonical, Open Graph + Twitter card (cover image
inside a 1200 × 1200 box, JPEG quality 75, never cropped), `lang="it"`, JSON-LD (`Person` on home/chi-sono, `VisualArtwork` on artwork pages with
`artMedium`, `width`/`height` in cm, `dateCreated`, `image`, `creator`).

### 5.4 Contact form
Fields: nome (`name`, required), email (`email`, required, type email), messaggio (`message`, required,
≥ 10 chars), hidden honeypot `botcheck`.

**The work** (no `<select>`): the page's script reads `?opera=<slug>` and matches it against the published
works embedded in the page as data (slug, title, URL, thumbnail). On a match it shows a chip (thumbnail,
"Mi interessa", the title) and sets the hidden input `opera`; the chip's × button (≥ 44 × 44 px) removes the
chip and clears the input. An unknown or hidden slug is ignored.

**Sending (with JS)**: `fetch` POST JSON to `https://api.web3forms.com/submit` with `access_key`
(`sito.json`), `subject` ("Nuovo messaggio da tiz-art.ch" or "Richiesta su «Titolo» — tiz-art.ch"),
`from_name` "tiz-art.ch", `name`, `email`, `message`, `opera` (title + URL when chosen). A filled honeypot
fakes success and sends nothing (it is not sent to Web3Forms). Italian validation: the error shows inline
under its field (`aria-describedby`) and the input is kept; the button ("Invia →") is disabled while sending;
error and status lines reserve their height (no layout shift).

**Success**: "Grazie!" replaces the form (focus moved to it, announced through `aria-live`), with "Scrivi
ancora" to bring back an empty form.

**Without JS**: the form is a normal `POST` to the same endpoint with hidden `access_key`, `subject`
("Nuovo messaggio da tiz-art.ch"), `from_name` and `redirect` = the absolute URL of `/contatti/grazie/`
(base path included); Web3Forms then sends the visitor to that page, which shows the success design.
The honeypot is part of that POST (Web3Forms rejects a submission with `botcheck` filled).

If `web3formsAccessKey` is empty the page still renders the form, but submit shows "Il modulo non è
ancora attivo" and the build prints a warning.

### 5.5 Quality bar
Semantic HTML, keyboard accessible, visible focus, `prefers-reduced-motion` respected, works without
JS (only the viewer, the phone menu overlay, the photo swap, the `?opera` chip and the animations need
it; the contact form falls back to a normal POST, §5.4, which then carries no work), Lighthouse-friendly
(no layout shift, also while the fonts load; lazy images below the fold), mobile-first. Colours, fonts,
the type and spacing scales, gutters, shadows and motion are CSS custom properties in
`src/styles/tokens.css` (a value equal to a token is written as the token); layout numbers read off a
single frame stay as px in the component that uses them.

## 6. Thumbnail index for the admin — `/admin/anteprime.json`

Built by the site (Astro endpoint). Lets the admin show light thumbnails of works that are already
online.

```json
{ "generato": "2026-11-02T12:00:00.000Z",
  "opere": { "<slug>": { "immagini": { "./01.jpg": "/tiz-art/_astro/01.abc123_Z1x.webp" } } },
  "profilo": { "ritratto": { "./ritratto-ab12cd.jpg": "/tiz-art/_astro/…webp" } } }
```

Includes ALL works (also `pubblicata: false`). Each URL is a 480 px-wide WebP, absolute path including
BASE_PATH. The admin falls back to the raw image (section 7.3) for anything not in the index yet.

## 7. Admin (admin agent)

### 7.1 Basics
Static files in `public/admin/` → served at `<base>/admin/`. Plain ES modules, no build step, no CDN,
no external fonts. Italian UI, phone-first (one column, big touch targets ≥ 44 px, works one-handed
on a 375 px wide iPhone in Safari), also fine on desktop. `noindex`. Strict CSP meta:
`default-src 'self'; img-src 'self' blob: data: https://raw.githubusercontent.com http://localhost:8787 http://127.0.0.1:8787; connect-src 'self' https://api.github.com https://raw.githubusercontent.com http://localhost:8787 http://127.0.0.1:8787; style-src 'self'; script-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`
(meta CSP ignores frame-ancestors; keep it anyway). Never inject untrusted strings as HTML (use
`textContent` / DOM APIs). Web-app manifest + icons so she can "Add to Home Screen" ("TIZ Admin").

### 7.2 Login — `public/admin/auth.json`
Same format as the Chère Pochette admin (`v: 2`):

```json
{"v":2,"owner":"MartinoTschudi","repo":"tiz-art","branch":"main","kdf":"PBKDF2-SHA256",
 "iterations":600000,"salt":"<b64 16 bytes>","iv":"<b64 12 bytes>","ciphertext":"<b64 AES-256-GCM, tag appended>"}
```
`key = PBKDF2-SHA256(UTF-8 of email.trim().toLowerCase() + "\n" + password, salt, iterations, 256 bit)`,
plaintext = UTF-8 JSON `{"token":"<GitHub fine-grained token>"}`. Wrong e-mail or password → the same
message "E-mail o password non corretti". After login the token is kept in `localStorage` until
"Esci". If `auth.json` is missing (404) show "L'admin non è ancora configurato" with a link to the
setup page. If GitHub answers 401/403 with a valid login, show "La chiave di accesso è scaduta o non è
valida: chiedi a Martino di rinnovarla" (no technical jargon) and log out.

Setup page `<base>/admin/setup/` (for the owner, not for Tiziana): fields e-mail, password (twice,
min 12 chars), GitHub token (password-type input). Because `auth.json` and its git history are public
(offline guessing, no rate limit), the shared rules (`public/admin/setup/rules.js`) also refuse guessable
passwords: no part of the e-mail, no name/site words or "password"/"12345", and either 3 different words
or 16+ mostly random characters; the page offers a generated passphrase ("Usa questa"). Only
fine-grained tokens: classic/OAuth prefixes (`ghp_`, `gho_`, `ghu_`, `ghs_`, `ghr_`) are refused. It checks the token against
`GET /repos/{owner}/{repo}` (`permissions.push` must be true), encrypts in the browser, and commits
`public/admin/auth.json` to `main` **using that same token** (commit message
`admin: configura accesso`). Owner/repo/branch defaults: `MartinoTschudi` / `tiz-art` / `main`
(editable). Also used later to renew the token or change the password. `scripts/admin-setup.mjs`
does the same from the terminal (interactive prompts, hidden input; writes the local file, does not
commit). Both directions are covered by tests (browser crypto ⇄ node:crypto).

### 7.3 Reading data
Always from the GitHub API (never from the deployed site, which can be minutes behind):
`GET /repos/{o}/{r}/git/ref/heads/{branch}` → commit → `GET …/git/trees/{treeSha}?recursive=1`,
then each `opera.json` / `profilo.json` via `GET …/git/blobs/{sha}` (cache blobs by sha — they are
immutable). Images: thumbnail from `<base>/admin/anteprime.json` when present for that exact path,
else `https://raw.githubusercontent.com/{o}/{r}/{commitSha}/src/content/opere/<slug>/<file>`
(public repo, no auth needed).

### 7.4 Writing data
One commit per user action via the Git Data API: create blobs (images base64, JSON utf-8) → create tree
with `base_tree` = current head tree (deleted paths: entry with `sha: null`) → create commit (parent =
head) → `PATCH …/git/refs/heads/{branch}` with `force: false`. If the ref moved (422/409), re-read head
and retry up to 3 times (rebuild the tree on the new head). Commit messages (Italian):
`opera: aggiunta «Titolo»`, `opera: modificata «Titolo»`, `opera: eliminata «Titolo»`,
`opere: nuovo ordine`, `profilo: aggiornato`. Validate everything against section 4 BEFORE committing
(a bad file would break the build).

Saving twice must never do harm:
- Every request has a time limit (30 s, plus time for the body of a photo upload); a limit or a dropped
  connection is a "connessione" error. When the answer to the final `PATCH` is lost (network error,
  time limit, 5xx), the branch is read again: if it points at the new commit, the save succeeded.
- A new photo's file name `NN-xxxxxx.jpg` takes its random part from an id chosen once per photo and
  kept in the draft. Creating a work whose folder already holds one of those photos (an earlier
  attempt that reached GitHub unnoticed) saves into that folder instead of creating `<slug>-2`.
- An edit (work or profile) carries the `aggiornataIl` / `aggiornatoIl` the form was opened with; if
  the file changed since, the save stops with "… è stata cambiata dopo che l’hai aperta…" instead of
  overwriting it — unless the file already holds exactly this edit (then nothing is written).
- «Riprova» reuses the photo blobs already uploaded in this session.

### 7.5 Screens
1. **Accedi** — e-mail, password (eye toggle), "Entra" (shows "Verifico…", PBKDF2 takes ~1 s).
2. **Le mie opere** — publish status line from `GET /repos/{o}/{r}/actions/workflows/deploy.yml/runs?branch={branch}&per_page=1`
   ("Online ✓" / "Pubblicazione in corso… (1–3 minuti)" / "Problema nell'ultima pubblicazione" + link).
   List: thumbnail, title, year · size, badges "In evidenza" / "Nascosta". "Cambia l’ordine" mode with
   ↑/↓ buttons and one "Salva l’ordine" (renumbers `ordine` 10, 20, 30… for all works, one commit). Big "+ Nuova opera" button.
   Links "Profilo" and "Esci", reload button.
3. **Nuova / Modifica opera** — Foto (1–8): "Scatta foto" (`capture="environment"`) and "Dalla galleria"
   (multiple); each photo is resized in the browser (≤ 2400 px, JPEG 0.88, orientation applied, EXIF/GPS
   dropped by re-encoding); "Fai copertina" button to make one the first (the first shows "★ Copertina");
   "×" to remove. Fields: Titolo*,
   Anno (default current year), Larghezza cm, Altezza cm, Tecnica (datalist from existing values),
   Collezione (datalist from existing values), "Colore della pennellata" (radio buttons drawn as large
   swatches with their names: Automatico (default, `null`) · Ocra · Rosso · Terracotta · Ottanio · Blu),
   Testo (textarea), "In evidenza in home" toggle (hint: the first 3 make the home composition),
   "Visibile sul sito" toggle (default on). "Salva" with nothing changed says "Nessuna modifica da salvare",
   except for a file not in the current format (e.g. without `colore`, §4.1): that one is rewritten. "Salva" → progress ("Preparo le foto…", "Carico la foto 1 di 3…",
   "Pubblico…") → "Fatto! Sarà online tra circa 2 minuti" with "Vedi sul sito", "Torna alle opere",
   "Aggiungi un'altra opera". Existing work: "Elimina opera" at the bottom with confirmation dialog.
   New works get `ordine = min(existing) - 10` (shown first). Unsaved new work is kept as a draft
   (IndexedDB, including photos) and offered again ("Stai continuando un'opera non salvata · Ricomincia").
   Unsaved changes to an existing work are kept the same way (also after a back swipe, a reload or an
   expired key) and shown again when it is reopened ("Hai modifiche non ancora salvate · Annulla
   modifiche"); the in-app back arrow still asks "Uscire senza salvare?".
4. **Profilo** — motto, bio (textarea), portrait photo (add/replace/remove). Save = one commit. Unsaved
   changes are kept like those of a work.

"Vedi sul sito" = `<site base>/opere/<slug>/` where site base = the admin URL without `admin/…`. After a
save from this device the button stays disabled ("Vedi sul sito (tra circa 2 minuti)") until the publish
status is "Online ✓" (about 3 minutes when Actions cannot be read), and the URL gets `?v=<commit>` so the
browser does not show its cached copy. Right after a save the admin shows the saved data at once (it
does not wait for the reload from GitHub).

### 7.6 Local testing
`npm run admin:dev` starts a mock GitHub API on `http://localhost:8787` (in memory, seeded from the
working tree's `src/content`, implements every endpoint the admin and the setup page use, including
raw image URLs at `http://localhost:8787/raw/{commitSha}/{path}`, and an actions-runs endpoint that
reports "in progress" for ~20 s after each commit, then "success"), writes a throwaway
`public/admin/auth.dev.json` (git-ignored) for `test@example.com` with a random password printed in
the console. The admin uses `https://api.github.com`, `https://raw.githubusercontent.com` and
`auth.json` — **except** when the page runs on `localhost`/`127.0.0.1` and the URL has `?api=<url>`:
then API + raw base = that URL and it loads `auth.dev.json`. The override must be impossible on any
other host. `astro dev` has no folder index for `public/`, so locally open
`http://localhost:4321/admin/index.html?api=http://localhost:8787` (on GitHub Pages `/admin/` works).

## 8. Deploy (infra agent)

`.github/workflows/deploy.yml`, name `Deploy`, file name exactly `deploy.yml` (the admin reads its runs).
Triggers: push to `main`, `workflow_dispatch`. Concurrency group `pages`, `cancel-in-progress: false`.
`npm test` must never depend on the live `src/content` (Tiziana changes it every day; a test that counted
her works would block every deploy): the admin tests use the fixture `scripts/test/fixtures/repo/`.
Steps: checkout → Node (from `.nvmrc`) + npm cache → `npm ci` → `npm test` → `npm run check:content` →
`actions/configure-pages` (gives `origin` + `base_path`) → restore Astro image cache
(`node_modules/.astro/assets`, keyed on package-lock + astro.config) → `npm run build` with `SITE_URL`
and `BASE_PATH` (`<base_path>/`) → save cache → `actions/upload-pages-artifact` → `actions/deploy-pages`.
Minimal `permissions`. Use the newest major versions of the official actions.
