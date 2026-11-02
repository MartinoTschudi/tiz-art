// @ts-check
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { defineConfig, sharpImageService } from 'astro/config';
import sitemap from '@astrojs/sitemap';

// SITE_URL (origin) and BASE_PATH are set by the deploy workflow from actions/configure-pages.
// Preview on GitHub Pages: https://martinotschudi.github.io + /tiz-art/. Final domain: https://tiz-art.ch + /.
const site = httpsOrigin(process.env.SITE_URL || 'https://tiz-art.ch');
const base = withSlashes(process.env.BASE_PATH || '/');

/** @type {{ contatto: { web3formsAccessKey: string }, redirectVecchioSito: Record<string, string> }} */
const sito = JSON.parse(readFileSync(new URL('./src/data/sito.json', import.meta.url), 'utf8'));

// Old WordPress URLs → new pages. Astro serves the "from" side under `base` by itself but writes the
// destination as given, so the base path is added here (otherwise the preview would redirect to the
// domain root). A redirect to an artwork that is hidden or deleted in the admin goes to the list of
// works instead of the 404 page.
const redirects = Object.fromEntries(
  Object.entries(sito.redirectVecchioSito).map(([from, to]) => [from, base + (artworkOnline(to) ? to : '/opere/').replace(/^\/+/, '')]),
);

// Pages that must not appear in the sitemap: the admin and the redirect pages.
const notInSitemap = [
  new URL(`${base}admin/`, site).href,
  ...Object.keys(redirects).map((from) => new URL(base + from.replace(/^\/+/, ''), site).href),
];

export default defineConfig({
  site,
  base,
  trailingSlash: 'always',
  output: 'static',
  redirects,
  image: { service: sharpImageService() },
  integrations: [
    sitemap({ filter: (page) => !notInSitemap.some((excluded) => page.startsWith(excluded)) }),
    contactFormWarning(sito.contatto.web3formsAccessKey),
    dropDevLoginFile(),
  ],
});

/** "/tiz-art" → "/tiz-art/", "" → "/". */
function withSlashes(path) {
  return `/${path.replace(/^\/+|\/+$/g, '')}/`.replace(/^\/\/$/, '/');
}

/**
 * The site's origin, always https except on localhost. configure-pages derives SITE_URL from the Pages
 * html_url, which is http:// while "Enforce HTTPS" is still off (e.g. the build right after the domain
 * switch): canonical links, og:url, the sitemap and JSON-LD must not keep http:// until the next push.
 * @param {string} url
 */
function httpsOrigin(url) {
  const u = new URL(url);
  if (u.protocol === 'http:' && !['localhost', '127.0.0.1', '[::1]'].includes(u.hostname)) u.protocol = 'https:';
  return u.origin;
}

/**
 * False when a redirect target "/opere/<slug>/" has no page: the artwork was deleted (no opera.json)
 * or hidden (pubblicata is not true). Other targets are left alone.
 * @param {string} to
 */
function artworkOnline(to) {
  const slug = /^\/opere\/([^/]+)\/$/.exec(to)?.[1];
  if (!slug) return true;
  try {
    const opera = JSON.parse(readFileSync(new URL(`./src/content/opere/${slug}/opera.json`, import.meta.url), 'utf8'));
    return opera.pubblicata === true;
  } catch {
    return false;
  }
}

/**
 * Prints a build warning while the contact form has no Web3Forms key (CONTRACTS 5.4): the page
 * still renders, but sending only shows "Il modulo non è ancora attivo".
 * @param {string} accessKey
 * @returns {import('astro').AstroIntegration}
 */
function contactFormWarning(accessKey) {
  return {
    name: 'tiz-art:contact-form-warning',
    hooks: {
      'astro:build:start': ({ logger }) => {
        if (!accessKey.trim()) {
          logger.warn(
            'src/data/sito.json → contatto.web3formsAccessKey is empty: the contact form will not send messages.',
          );
        }
      },
    },
  };
}

/**
 * `npm run admin:dev` writes public/admin/auth.dev.json (git-ignored) for local admin tests. A local
 * build made while it runs would copy it into dist/; drop it, so a local dist matches what CI publishes.
 * @returns {import('astro').AstroIntegration}
 */
function dropDevLoginFile() {
  return {
    name: 'tiz-art:drop-dev-login',
    hooks: {
      'astro:build:done': ({ dir, logger }) => {
        const file = new URL('admin/auth.dev.json', dir);
        if (existsSync(file)) {
          rmSync(file);
          logger.info('admin/auth.dev.json (local test login of npm run admin:dev) left out of the build output.');
        }
      },
    },
  };
}
