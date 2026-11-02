# One-time setup

Everything Martino has to do once (and how to redo each part later), in this order:

1. [Enable GitHub Pages](#1-enable-github-pages): the site goes online at the preview address
2. [Create the access token for the admin](#2-create-the-access-token-for-the-admin)
3. [Admin login for Tiziana](#3-admin-login-for-tiziana)
4. [Contact form (Web3Forms)](#4-contact-form-web3forms)
5. [Custom domain (tiz-art.ch)](#5-custom-domain-tiz-artch): switch from WordPress.com to the new site
6. [The old WordPress site](#6-the-old-wordpress-site)
7. [Troubleshooting](#7-troubleshooting)

> Never paste a password or token into a file of the repository, an e-mail or a chat. The token goes only
> into the setup page (step 3) or `npm run admin:setup`, which store it **encrypted**. Keep the admin password
> in a password manager and give it to Tiziana in person.

**Before you start**: the repository **`MartinoTschudi/tiz-art`** exists on GitHub, is **public** (needed
for free GitHub Pages; the admin also loads photos from it without logging in) and has the code on `main`.
To create it from scratch: https://github.com/new → Owner `MartinoTschudi`, name `tiz-art`, **Public**, no
README/licence → then in the project folder `git remote add origin https://github.com/MartinoTschudi/tiz-art.git`
and `git push -u origin main`.

---

## 1. Enable GitHub Pages

1. Open https://github.com/MartinoTschudi/tiz-art → tab **Settings** → left sidebar, section *Code and
   automation* → **Pages**.
2. Under **Build and deployment** → **Source**, choose **GitHub Actions**. It is applied immediately (no
   Save button). Leave everything else as it is; do not pick a suggested workflow.
3. Tab **Actions** → workflow **Deploy** (left) → button **Run workflow** (right) → branch `main` → **Run
   workflow**.
   - A Deploy run from the first push that is red at the step *Read GitHub Pages settings* is expected: it
     ran before Pages was enabled. The new run replaces it.
4. Wait until the run is green (the first run converts all photos and takes a few minutes; later runs
   reuse them and take 1–3 minutes). Click the run: the **deploy** box shows the address.
5. Open **https://martinotschudi.github.io/tiz-art/** and click through it.

While no custom domain is set, every page carries `noindex` and `robots.txt` blocks everything: the preview
never competes with the real site in search engines. This switches off by itself with the domain (step 5).

## 2. Create the access token for the admin

The admin saves Tiziana's work with a GitHub *fine-grained personal access token* that can do exactly one
thing: read and write the files of `tiz-art`.

1. github.com → your profile picture (top right) → **Settings** → left sidebar, at the bottom → **Developer
   settings** → **Personal access tokens** → **Fine-grained tokens** → **Generate new token**.
2. Fill in:

   | Field | Value |
   |---|---|
   | Token name | `tiz-art-admin` |
   | Description | `Admin of tiz-art.ch (Tiziana)` |
   | Resource owner | **MartinoTschudi** |
   | Expiration | the longest period GitHub offers (*Custom* → a date about one year ahead) |
   | Repository access | **Only select repositories** → **MartinoTschudi/tiz-art** |

3. **Permissions** → **Repository permissions** (in the newer layout: **Add permissions** → tick them, then
   choose the level):

   | Permission | Access | Why |
   |---|---|---|
   | **Contents** | **Read and write** | read the artworks, commit new ones and photos |
   | **Actions** | **Read-only** | the "Online ✓ / Pubblicazione in corso…" line in the admin |
   | **Metadata** | **Read-only** | mandatory, added automatically |

   Nothing else: no account permissions, no other repository.
4. **Generate token** → copy it (it is shown only once) and go straight to step 3.
5. **Write the expiry date down and set a calendar reminder two weeks before it.** When the token expires,
   the admin says "La chiave di accesso è scaduta o non è valida: chiedi a Martino di rinnovarla" until you
   repeat steps 2 and 3. Expiry date of the current token: `__________`.

## 3. Admin login for Tiziana

The login is Tiziana's e-mail address + an admin password. Together they decrypt the token, which is stored
only encrypted in `public/admin/auth.json` (AES-256-GCM, key derived with PBKDF2-SHA256, 600 000 rounds).
Neither the e-mail nor the password is stored anywhere.

**With the setup page** (any computer, nothing to install):

1. Open **https://martinotschudi.github.io/tiz-art/admin/setup/** (after step 5:
   https://tiz-art.ch/admin/setup/).
2. Owner / repository / branch: keep `MartinoTschudi` / `tiz-art` / `main`.
3. E-mail: Tiziana's address. Password: twice, at least 12 characters; best a passphrase of 4–5 words that
   she uses nowhere else (not her e-mail or GitHub password).
4. GitHub token: paste the token from step 2.
5. Save. The page checks the token with GitHub (it must have write access to `tiz-art`), encrypts it in the
   browser and commits `public/admin/auth.json` with that same token (commit "admin: configura accesso").
6. Wait for the Deploy run (≈ 2 minutes), then log in at **…/tiz-art/admin/** with her e-mail + password.
7. On her iPhone: open the admin in **Safari** → **Share** button → **Add to Home Screen** → "TIZ Admin".
   Show her [GUIDA-ADMIN.md](GUIDA-ADMIN.md); give her the password in person.

**Or from the terminal** (project checked out, `npm ci` done):

```bash
npm run admin:setup        # asks for e-mail, password (hidden, twice) and token, checks the token
git add public/admin/auth.json
git commit -m "admin: configura accesso"
git push
```

**Renewing the token or changing the password** = the same steps again (a new token from step 2, then the
setup page). After a renewal, revoke the old token: Developer settings → Fine-grained tokens → the old token
→ **Delete**. The old login stops working at once; Tiziana logs in again with the (new) password.

## 4. Contact form (Web3Forms)

The form on `/contatti/` sends messages through [Web3Forms](https://web3forms.com) straight to Tiziana's
inbox; there is no server of our own and her address never appears on the site.

1. Open https://web3forms.com → **Create your Access Key** → enter **Tiziana's e-mail address** → the access
   key (looks like `xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx`) arrives by e-mail at that address. Messages from
   the form will go to that address.
2. Put the key into the site: https://github.com/MartinoTschudi/tiz-art/blob/main/src/data/sito.json →
   pencil icon (**Edit this file**) → write the key between the quotes of
   `"web3formsAccessKey": ""` → **Commit changes…** → message `contatto: chiave Web3Forms` → *Commit directly
   to the main branch* → **Commit changes**. Deploy publishes it in ≈ 2 minutes.
3. Test: open `/contatti/`, send a message, check Tiziana's inbox (the first ones may land in spam: mark them
   as "not spam").

The key is **public by design**: it sits in every visitor's browser and only allows sending a message to
her address, which is exactly what the form does. Bots are filtered by a hidden honeypot field. While the
key is empty the form shows "Il modulo non è ancora attivo", and `npm run check:content` and the build print a
warning.

## 5. Custom domain (tiz-art.ch)

### Where the domain is today (checked 2 November 2026)

| | |
|---|---|
| Name servers | `ns1.wordpress.com`, `ns2.wordpress.com`, `ns3.wordpress.com` → **WordPress.com hosts the DNS** |
| Registrar of record | GoDaddy.com LLC, first registered 23.09.2023 (WordPress.com registers its customers' domains through partner registrars, so it was most likely bought together with the WordPress.com site) |
| `tiz-art.ch` | A records `192.0.78.24`, `192.0.78.25` (WordPress.com) → 301 redirect to `https://tizianatschudi.wordpress.com/` |
| `www.tiz-art.ch` | CNAME → `tiz-art.ch` |
| E-mail | no MX records: no mailbox on this domain, nothing to preserve |

First check where the domain is paid: log in at https://wordpress.com/domains/manage with the account of
the old site. If `tiz-art.ch` is listed there with a renewal date, it is registered through WordPress.com
(the usual case). If it is not, someone owns it directly at GoDaddy (godaddy.com → My Products).

### Option A (recommended): keep WordPress.com as DNS host, point the records to GitHub

1. https://wordpress.com/domains/manage → **tiz-art.ch** → **DNS records** → **Manage**. (WordPress.com
   renames menus now and then; the records page is always under the domain.) Take a screenshot of the
   current records first.
2. **Delete** the A records that point to WordPress.com (`192.0.78.24`, `192.0.78.25`; sometimes shown as
   default/"WordPress.com" records) and the `www` CNAME.
3. **Add** (type, name, value; leave TTL at its default):

   | Type | Name | Value |
   |---|---|---|
   | A | `@` (or empty) | `185.199.108.153` |
   | A | `@` | `185.199.109.153` |
   | A | `@` | `185.199.110.153` |
   | A | `@` | `185.199.111.153` |
   | AAAA | `@` | `2606:50c0:8000::153` |
   | AAAA | `@` | `2606:50c0:8001::153` |
   | AAAA | `@` | `2606:50c0:8002::153` |
   | AAAA | `@` | `2606:50c0:8003::153` |
   | CNAME | `www` | `martinotschudi.github.io` |

   (Current values: [GitHub docs, "Managing a custom domain"](https://docs.github.com/en/pages/configuring-a-custom-domain-for-your-github-pages-site/managing-a-custom-domain-for-your-github-pages-site).)
4. Remove the WordPress.com redirect: the domain is attached to the site `tizianatschudi.wordpress.com` as an
   extra address, which is why it redirects. In the domain's settings, detach/disconnect it from that site
   if WordPress.com offers it (wording varies, e.g. "Detach from site" or "Change site"). **Keep the domain
   itself in the account: never delete or cancel the domain registration.** Changing the A records alone
   already sends the visitors to GitHub; detaching only keeps WordPress.com from trying to serve it.

### Option B: move the DNS elsewhere

- **Registered through WordPress.com**: transfer the domain to a registrar that also hosts DNS (for example a
  Swiss one such as Infomaniak or Hostpoint): WordPress.com → the domain → **Transfer** → transfer to another
  registrar → unlock it and get the transfer (auth) code → start the transfer at the new registrar (it
  includes one year of renewal there) → create the records of option A in the new registrar's DNS.
- **Registered directly at GoDaddy**: GoDaddy → My Products → **tiz-art.ch** → **DNS** → **Nameservers** →
  *Change* → GoDaddy's default name servers → then add the records of option A in GoDaddy's DNS.
- A name-server change takes from a few hours up to 48 hours to reach everyone; meanwhile some visitors still
  see the old site.

### Then, in GitHub (both options)

1. Recommended, once: **verify the domain** for your account, so no other GitHub user can ever claim it:
   profile picture → **Settings** → **Pages** (left sidebar) → **Add a domain** → `tiz-art.ch` → GitHub shows a
   TXT record (name `_github-pages-challenge-MartinoTschudi`, value: a code) → add it in the DNS (same place as
   above) → back in GitHub → **Verify**. Keep that TXT record forever.
2. Repository → **Settings** → **Pages** → **Custom domain**: `tiz-art.ch` → **Save**. GitHub checks the DNS
   ("DNS check successful"; can take a few minutes after the DNS change). No `CNAME` file is needed in the
   repository: with GitHub Actions deployments the domain lives only in this setting.
3. **Actions** → **Deploy** → **Run workflow**. Required: the site online was built for `/tiz-art/`; the new
   run builds it for `https://tiz-art.ch/` (base `/`) and removes `noindex`.
4. When the certificate is ready (usually within an hour; the box becomes clickable), tick **Enforce HTTPS**.
5. Check:
   - https://tiz-art.ch shows the new site; https://www.tiz-art.ch and
     https://martinotschudi.github.io/tiz-art/ redirect to it;
   - an old WordPress link such as https://tiz-art.ch/2023/12/27/gioventu/ lands on the artwork page
     (redirects listed in `src/data/sito.json` → `redirectVecchioSito`);
   - in a terminal: `dig +short tiz-art.ch A` prints the four `185.199.…` addresses.
6. Tell Tiziana: the admin is now at **https://tiz-art.ch/admin/**. She logs in once more there (the login is
   remembered per address) and replaces the Home Screen icon.

Good to know: the old site told browsers to always use HTTPS for `tiz-art.ch` (HSTS). Between the DNS change
and GitHub's certificate, recent visitors may see a certificate warning. It lasts minutes to an hour, so
switch at a quiet moment, e.g. in the evening.

## 6. The old WordPress site

- **Keep it until the new site works at https://tiz-art.ch** (step 5, check list) for a few days.
- Old links to `tiz-art.ch/2023/…/<post>/` are redirected by the new site to the matching artwork:
  nothing to do.
- Links that point directly to `tizianatschudi.wordpress.com` (e.g. shared on social media) keep showing the
  old site. Choose one:
  - leave it online with a short post "Il mio nuovo sito: tiz-art.ch";
  - make it private: WordPress.com → the site → **Settings** → **Privacy** (or *Site visibility*) → Private;
  - WordPress.com's paid **Site Redirect** upgrade sends the whole old address to `tiz-art.ch`.
- Before deleting anything, export a copy: WordPress.com → the site → **Tools** → **Export** → *Export all*
  (all 12 artworks are already migrated to this repository).
- **Do not let the domain expire.** If it is registered through WordPress.com, cancelling the WordPress.com
  plan must not cancel the domain: check that `tiz-art.ch` still shows a renewal date and auto-renew in
  WordPress.com → Domains (or transfer it, option B).
- Optional: Google Search Console → add the property `tiz-art.ch` → submit `https://tiz-art.ch/sitemap-index.xml`
  to speed up the switch in Google.

## 7. Troubleshooting

| Symptom | Cause | What to do |
|---|---|---|
| Deploy run red; the admin says "Problema nell'ultima pubblicazione" | a step failed; **nothing was published, the previous version is still online** | Actions → the red **Deploy** run → open the red step. *Check content*: the annotations at the top of the run name each file and problem (e.g. a photo that is not a JPEG) → fix the file (in the admin or on github.com) → the next commit deploys again. *Run tests* / *Build site*: a code problem → fix it, or revert the last commit. *Read GitHub Pages settings*: Pages is not enabled (step 1). A temporary GitHub problem: **Re-run jobs** |
| Admin: "La chiave di accesso è scaduta o non è valida: chiedi a Martino di rinnovarla" | the token expired or was deleted | new token (step 2) → setup page (step 3); the same e-mail and password may be reused |
| Admin: "L'admin non è ancora configurato" | `public/admin/auth.json` does not exist | step 3 |
| Tiziana forgot the password | the token cannot be recovered from `auth.json` without it | new token (step 2) + new password (step 3), then delete the old token |
| Phone lost or password shared by mistake | | delete the token on GitHub at once (step 3, "Renewing"), then steps 2 and 3 with a new password |
| Contact form: "Il modulo non è ancora attivo" | the Web3Forms key is empty | step 4 |
| Messages do not arrive | spam folder; key created for another address; key mistyped | check spam; create the key again for Tiziana's address (step 4) |
| GitHub Pages: "DNS check unsuccessful" | records not propagated yet or not exactly as listed | wait (up to 24 h); compare with step 5; `dig +short tiz-art.ch A` |
| "Enforce HTTPS" stays greyed out | certificate not issued yet | wait; after 24 h: clear the custom domain, Save, enter it again, Save |
| Links point to `/tiz-art/…` after the domain switch | the site was not rebuilt | Actions → Deploy → **Run workflow** (step 5.3) |
| Admin save works but the site does not change | the run is still busy or waiting | Actions shows a yellow run; runs never overlap, a waiting one starts after the current one |

Checking the content locally (same check as the Deploy run): `npm run check:content`.

### Yearly

| When | What |
|---|---|
| Two weeks before the token expires | steps 2 and 3 (new token, same login) |
| Before the domain renewal date | make sure `tiz-art.ch` renews (WordPress.com → Domains, or the registrar of option B) |
