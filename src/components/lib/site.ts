/**
 * Site-wide constants and URL helpers.
 *
 * The site lives under a base path ("/" on tiz-art.ch, "/tiz-art/" on the GitHub Pages preview), so
 * internal links must NEVER be written as "/opere/": always go through `routes` / `withBase()`.
 */
import sito from '../../data/sito.json';

export const SITE = {
  /** "Tiziana Tschudi Belloli" */
  nome: sito.nome,
  /** "TIZ" */
  firma: sito.firma,
  lingua: sito.lingua,
  web3formsAccessKey: sito.contatto.web3formsAccessKey.trim(),
} as const;

/** import.meta.env.BASE_URL, always ending with "/". */
export const BASE = import.meta.env.BASE_URL.endsWith('/') ? import.meta.env.BASE_URL : `${import.meta.env.BASE_URL}/`;

/** The GitHub Pages preview must stay out of search engines (CONTRACTS section 2). */
export const IS_PREVIEW = (import.meta.env.SITE ?? '').includes('github.io');

/** "opere/" → "/tiz-art/opere/" (or "/opere/" on the final domain). */
export function withBase(path = ''): string {
  return BASE + path.replace(/^\/+/, '');
}

/** "/tiz-art/opere/" → "https://martinotschudi.github.io/tiz-art/opere/" (canonical, Open Graph, JSON-LD). */
export function absoluteUrl(pathWithBase: string): string {
  return new URL(pathWithBase, import.meta.env.SITE).href;
}

/** Every internal page, base path included. */
export const routes = {
  home: withBase(),
  opere: withBase('opere/'),
  opera: (slug: string) => withBase(`opere/${slug}/`),
  chiSono: withBase('chi-sono/'),
  contatti: withBase('contatti/'),
  /** Contact form with the artwork pre-selected (read by ContactForm). */
  contattiOpera: (slug: string) => withBase(`contatti/?opera=${encodeURIComponent(slug)}`),
  /** The form's success page for visitors without JS (Web3Forms redirects there; noindex). */
  contattiGrazie: withBase('contatti/grazie/'),
} as const;

/**
 * Short line under a series title on the home page (site copy, not admin data). Keyed by the exact
 * `collezione`; a series without an entry simply shows no line.
 */
export const SERIE_NOTE: Record<string, string> = {
  'noi, DONNA.': 'Sorellanza, coraggio, gioventù, istinto. Donne che chiudono gli occhi per guardarsi dentro.',
};
