/**
 * Where the admin runs and which services it talks to.
 *
 * The site is served under a base path that changes with the hosting:
 *   https://martinotschudi.github.io/tiz-art/admin/   → site base "/tiz-art/"
 *   https://tiz-art.ch/admin/                          → site base "/"
 * so every URL is computed from the page's own location, never hard-coded.
 *
 * Production: GitHub API + raw.githubusercontent.com + ./auth.json.
 * Local development: when the page runs on localhost / 127.0.0.1 AND the URL has
 * ?api=<url of a local server>, the API and the raw files come from that server (the mock of
 * scripts/dev/admin-dev.mjs) and the login file is ./auth.dev.json. On any other host the
 * parameter is ignored, so nobody can redirect the real admin to a server of their own.
 */

export const GITHUB_API = 'https://api.github.com';
export const GITHUB_RAW = 'https://raw.githubusercontent.com';

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1']);

/** Encodes every segment of a path but keeps the slashes. */
export function encodePath(path) {
  return String(path).split('/').map(encodeURIComponent).join('/');
}

/** The local API origin from ?api=…, or null when the override does not apply. */
function devApiOrigin(hostname, search) {
  if (!LOCAL_HOSTS.has(hostname)) return null;
  const value = new URLSearchParams(search).get('api');
  if (!value) return null;
  try {
    const url = new URL(value);
    const ok = (url.protocol === 'http:' || url.protocol === 'https:') && LOCAL_HOSTS.has(url.hostname);
    return ok ? url.origin : null;
  } catch {
    return null;
  }
}

/**
 * @param {{origin: string, hostname: string, pathname: string, search: string}} loc  usually `location`
 */
export function resolveEnv(loc) {
  const cut = loc.pathname.lastIndexOf('/admin/');
  const siteBase = cut >= 0 ? loc.pathname.slice(0, cut + 1) : '/';
  const adminBase = `${siteBase}admin/`;
  const devApi = devApiOrigin(loc.hostname, loc.search);
  return {
    dev: Boolean(devApi),
    siteBase,
    adminBase,
    apiBase: devApi || GITHUB_API,
    authFile: `${adminBase}${devApi ? 'auth.dev.json' : 'auth.json'}`,
    /** Query string to keep on internal links (the dev override must survive navigation). */
    query: devApi ? `?api=${encodeURIComponent(devApi)}` : '',
    /** Public page of an artwork / of the profile, e.g. https://tiz-art.ch/opere/sorellanza/ */
    siteUrl(path = '') {
      return `${loc.origin}${siteBase}${path}`;
    },
    /** A file of the repository at an exact commit (public repository: no login needed). */
    rawUrl(owner, repo, commitSha, path) {
      return devApi
        ? `${devApi}/raw/${encodeURIComponent(commitSha)}/${encodePath(path)}`
        : `${GITHUB_RAW}/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/${encodeURIComponent(commitSha)}/${encodePath(path)}`;
    },
  };
}
