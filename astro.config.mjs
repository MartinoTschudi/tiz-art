// @ts-check
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { defineConfig, sharpImageService } from 'astro/config';
import sitemap from '@astrojs/sitemap';

// SITE_URL (origin) and BASE_PATH are set by the deploy workflow from actions/configure-pages.
// Preview on GitHub Pages: https://martinotschudi.github.io + /tiz-art/. Final domain: https://tiz-art.ch + /.
const site = process.env.SITE_URL || 'https://tiz-art.ch';
const base = withSlashes(process.env.BASE_PATH || '/');

/** @type {{ contatto: { web3formsAccessKey: string }, redirectVecchioSito: Record<string, string> }} */
const sito = JSON.parse(readFileSync(new URL('./src/data/sito.json', import.meta.url), 'utf8'));

// Old WordPress URLs → new pages. Astro serves the "from" side under `base` by itself but writes the
// destination as given, so the base path is added here (otherwise the preview would redirect to the
// domain root).
const redirects = Object.fromEntries(
  Object.entries(sito.redirectVecchioSito).map(([from, to]) => [from, base + to.replace(/^\/+/, '')]),
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
