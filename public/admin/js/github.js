/**
 * Minimal GitHub REST client for the admin and the setup page.
 *
 * Reading uses the Git Data API: branch ref → commit → recursive tree → blobs. Trees and blobs
 * are addressed by their SHA, so they are cached forever (a SHA never changes content).
 *
 * Writing creates ONE commit per user action:
 *   blobs → tree (base_tree = current head tree, deleted paths with sha null) → commit (parent = head)
 *   → PATCH the branch ref with force:false.
 * If the branch moved in the meantime (422/409), the head is read again and the commit is rebuilt
 * on top of it, up to 3 times. The caller's `prepare(head)` runs on every attempt, so it always
 * merges its change into the latest version of the files.
 * If the answer to the final PATCH is lost (network drop, timeout, 5xx), the branch is read once
 * more: when it already points at our commit the save worked, and «Riprova» must not save twice.
 *
 * Every request has a timeout (longer for photo uploads), so a stalled phone connection ends in a
 * plain "connessione" error instead of an endless "Pubblico…".
 *
 * The token lives in a private class field: it is never logged, rendered or serialised.
 */
import { bytesToBase64 } from './crypto.js';
import { GITHUB_API, encodePath } from './env.js';
import { sleep } from './util.js';

export const KEY_INVALID_MESSAGE = 'La chiave di accesso è scaduta o non è valida: chiedi a Martino di rinnovarla.';

/** Error with a plain Italian message and a `kind` the UI can react to. */
export class GitHubError extends Error {
  /**
   * @param {string} message
   * @param {{status?: number, kind?: string, detail?: string}} [info]
   *   kind: 'auth' | 'forbidden' | 'ratelimit' | 'notfound' | 'conflict' | 'server' | 'network' | 'http'
   */
  constructor(message, { status = 0, kind = 'http', detail = '' } = {}) {
    super(message);
    this.name = 'GitHubError';
    this.status = status;
    this.kind = kind;
    this.detail = detail;
  }
}

/** True for errors that mean "the access key does not work any more" (→ log out). */
export function isKeyError(err) {
  return Boolean(err && (err.kind === 'auth' || err.kind === 'forbidden'));
}

async function errorFromResponse(res) {
  let detail = '';
  try {
    detail = (await res.json()).message || '';
  } catch {
    /* body is not JSON */
  }
  const status = res.status;
  const remaining = res.headers.get('x-ratelimit-remaining');
  if (status === 401) return new GitHubError(KEY_INVALID_MESSAGE, { status, kind: 'auth', detail });
  if (status === 429 || (status === 403 && (remaining === '0' || /rate limit/i.test(detail)))) {
    const retryAfter = Number(res.headers.get('retry-after')) || 0;
    const reset = Number(res.headers.get('x-ratelimit-reset')) || 0;
    const minutes = retryAfter
      ? Math.ceil(retryAfter / 60)
      : reset
        ? Math.max(1, Math.ceil((reset * 1000 - Date.now()) / 60000))
        : 1;
    return new GitHubError(
      `GitHub ha ricevuto troppe richieste. Riprova tra ${minutes} ${minutes === 1 ? 'minuto' : 'minuti'}.`,
      { status, kind: 'ratelimit', detail },
    );
  }
  // 403 = the key works but may not do this (e.g. read-only): for her it is the same problem.
  if (status === 403) return new GitHubError(KEY_INVALID_MESSAGE, { status, kind: 'forbidden', detail });
  if (status === 404) return new GitHubError('Non trovo più questo dato: tocca ↻ per ricaricare e riprova.', { status, kind: 'notfound', detail });
  if (status === 409 || status === 422) {
    return new GitHubError('Il salvataggio non è riuscito. Riprova tra qualche secondo.', { status, kind: 'conflict', detail });
  }
  if (status >= 500) {
    return new GitHubError('GitHub non risponde in questo momento. Riprova tra poco.', { status, kind: 'server', detail });
  }
  return new GitHubError(`GitHub ha risposto con un errore (${status}). Riprova tra poco.`, { status, kind: 'http', detail });
}

const MAX_CACHED_TREES = 6;

export const NETWORK_MESSAGE = 'Connessione assente o instabile. Controlla la rete e riprova.';
export const TIMEOUT_MESSAGE = 'La connessione è troppo lenta o si è interrotta. Controlla la rete e riprova.';
/** Base time limit of one request; uploads get more (see `request`). */
export const REQUEST_TIMEOUT = 30000;
/** Upload speed assumed for the time limit of a request body: a weak mobile link (~160 kbit/s). */
const SLOW_UPLOAD_BYTES_PER_SECOND = 20000;

/** AbortSignal that fires after `ms` (AbortSignal.timeout is missing in Safari < 16). */
function timeoutSignal(ms) {
  if (typeof AbortSignal.timeout === 'function') return AbortSignal.timeout(ms);
  const controller = new AbortController();
  setTimeout(() => controller.abort(), ms);
  return controller.signal;
}

/** The request did not get a (complete) answer: dropped connection or time limit. */
const networkError = (signal) => new GitHubError(signal.aborted ? TIMEOUT_MESSAGE : NETWORK_MESSAGE, { kind: 'network' });

export class GitHubClient {
  #token;

  /**
   * @param {{owner: string, repo: string, branch?: string, token: string, apiBase?: string}} session
   * @param {{fetchImpl?: Function, persist?: {get(sha: string): string|null, set(sha: string, text: string): void},
   *          retryDelay?: number, timeout?: number}} [options]
   *   fetchImpl: injectable fetch (tests) · persist: long-lived cache of blob texts ·
   *   retryDelay: base wait before rebuilding a commit on a moved branch (ms) ·
   *   timeout: time limit of a request without body (ms)
   */
  constructor({ owner, repo, branch = 'main', token, apiBase = GITHUB_API }, { fetchImpl, persist, retryDelay = 400, timeout = REQUEST_TIMEOUT } = {}) {
    if (!owner || !repo || !token) throw new Error('Servono proprietario, repository e chiave di accesso.');
    this.owner = owner;
    this.repo = repo;
    this.branch = branch || 'main';
    this.apiBase = apiBase.replace(/\/+$/, '');
    this.#token = token;
    this.fetchImpl = fetchImpl || ((...args) => globalThis.fetch(...args));
    this.persist = persist || null;
    this.retryDelay = retryDelay;
    this.timeout = timeout;
    this.commits = new Map(); // commit sha → tree sha
    this.trees = new Map(); // tree sha → Promise<Map(path → {sha, size})>
    this.texts = new Map(); // blob sha → Promise<string>
  }

  get repoPath() {
    return `/repos/${encodeURIComponent(this.owner)}/${encodeURIComponent(this.repo)}`;
  }

  /**
   * Low-level call. `as`: 'json' (default) | 'text' | 'none'.
   * `cache: 'no-store'` matters: GitHub sends max-age=60 and a stale branch ref would make us
   * commit on top of an old version.
   * Time limit: `timeout`, plus the time a slow mobile link needs to send the body (a 2 MB photo is
   * ~2.7 MB of base64, i.e. about 2 more minutes).
   */
  async request(method, path, { body, accept = 'application/vnd.github+json', as = 'json' } = {}) {
    const headers = {
      Accept: accept,
      Authorization: `Bearer ${this.#token}`,
      'X-GitHub-Api-Version': '2022-11-28',
    };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const payload = body === undefined ? undefined : JSON.stringify(body);
    const signal = timeoutSignal(this.timeout + Math.round(((payload || '').length / SLOW_UPLOAD_BYTES_PER_SECOND) * 1000));
    let res;
    try {
      res = await this.fetchImpl(this.apiBase + path, { method, headers, body: payload, cache: 'no-store', signal });
    } catch {
      throw networkError(signal);
    }
    if (!res.ok) throw await errorFromResponse(res);
    if (res.status === 204 || as === 'none') return null;
    try {
      return await (as === 'text' ? res.text() : res.json());
    } catch {
      throw networkError(signal); // the answer was cut off
    }
  }

  /** Repository info (also tells whether the key may write: permissions.push). */
  getRepo() {
    return this.request('GET', this.repoPath);
  }

  /** Current tip of the branch: { commitSha, treeSha }. */
  async getHead() {
    const ref = await this.request('GET', `${this.repoPath}/git/ref/heads/${encodePath(this.branch)}`);
    const commitSha = ref.object.sha;
    let treeSha = this.commits.get(commitSha);
    if (!treeSha) {
      const commit = await this.request('GET', `${this.repoPath}/git/commits/${commitSha}`);
      treeSha = commit.tree.sha;
      this.commits.set(commitSha, treeSha);
    }
    return { commitSha, treeSha };
  }

  /** Every file of a tree: Map(path → { sha, size }). One request (recursive), cached by tree SHA. */
  listFiles(treeSha) {
    if (!this.trees.has(treeSha)) {
      const p = this.request('GET', `${this.repoPath}/git/trees/${treeSha}?recursive=1`).then((t) => {
        if (t.truncated) {
          throw new GitHubError('Non riesco a leggere tutte le opere insieme. Avvisa Martino.');
        }
        const files = new Map();
        for (const e of t.tree || []) if (e.type === 'blob') files.set(e.path, { sha: e.sha, size: e.size || 0 });
        return files;
      });
      p.catch(() => this.trees.delete(treeSha)); // never cache a failure
      this.trees.set(treeSha, p);
      if (this.trees.size > MAX_CACHED_TREES) this.trees.delete(this.trees.keys().next().value);
    }
    return this.trees.get(treeSha);
  }

  /** UTF-8 content of a blob, cached by SHA (in memory and in `persist`). */
  readText(sha) {
    if (!this.texts.has(sha)) {
      const stored = this.persist && this.persist.get(sha);
      const p =
        stored != null
          ? Promise.resolve(stored)
          : this.request('GET', `${this.repoPath}/git/blobs/${sha}`, { accept: 'application/vnd.github.raw+json', as: 'text' })
              .then((text) => {
                if (this.persist) this.persist.set(sha, text);
                return text;
              });
      p.catch(() => this.texts.delete(sha));
      this.texts.set(sha, p);
    }
    return this.texts.get(sha);
  }

  /** Uploads a file (string → UTF-8; Blob / Uint8Array → base64). Returns its SHA. */
  async createBlob(data) {
    let body;
    if (typeof data === 'string') body = { content: data, encoding: 'utf-8' };
    else {
      const bytes = data instanceof Uint8Array ? data : new Uint8Array(await data.arrayBuffer());
      body = { content: bytesToBase64(bytes), encoding: 'base64' };
    }
    return (await this.request('POST', `${this.repoPath}/git/blobs`, { body })).sha;
  }

  /**
   * Does the branch point at `sha` right now? null when that cannot be read either.
   * Two tries a moment apart: right after a dropped connection the next request often fails too.
   */
  async branchIs(sha) {
    for (let attempt = 0; attempt < 2; attempt++) {
      if (attempt) await sleep(this.retryDelay * 2);
      try {
        const ref = await this.request('GET', `${this.repoPath}/git/ref/heads/${encodePath(this.branch)}`);
        return ref.object.sha === sha;
      } catch {
        /* try once more */
      }
    }
    return null;
  }

  /**
   * Creates ONE commit on the branch.
   * `prepare(head, attempt)` gets the fresh branch tip on every attempt and returns
   *   { message, files: [{ path, sha } | { path, text }], deletes: [path] }
   * or null when there is nothing to do. Paths in `deletes` must exist in head's tree.
   * @returns {Promise<{commitSha: string, treeSha: string, skipped?: true}>}
   */
  async commit({ prepare, maxRetries = 3 }) {
    for (let attempt = 0; ; attempt++) {
      const head = await this.getHead();
      const plan = await prepare(head, attempt);
      if (!plan || (!(plan.files || []).length && !(plan.deletes || []).length)) return { ...head, skipped: true };

      const tree = [];
      for (const file of plan.files || []) {
        const sha = file.sha || (await this.createBlob(file.text));
        tree.push({ path: file.path, mode: '100644', type: 'blob', sha });
      }
      for (const path of plan.deletes || []) tree.push({ path, mode: '100644', type: 'blob', sha: null });

      const newTree = await this.request('POST', `${this.repoPath}/git/trees`, { body: { base_tree: head.treeSha, tree } });
      const commit = await this.request('POST', `${this.repoPath}/git/commits`, {
        body: { message: plan.message, tree: newTree.sha, parents: [head.commitSha] },
      });
      try {
        await this.request('PATCH', `${this.repoPath}/git/refs/heads/${encodePath(this.branch)}`, {
          body: { sha: commit.sha, force: false },
        });
      } catch (err) {
        // No answer, or a 5xx: GitHub may have moved the branch anyway (then the save worked).
        if ((err.kind === 'network' || err.kind === 'server') && (await this.branchIs(commit.sha))) {
          this.commits.set(commit.sha, newTree.sha);
          return { commitSha: commit.sha, treeSha: newTree.sha };
        }
        if (err.kind !== 'conflict') throw err;
        if (/protected/i.test(err.detail)) {
          throw new GitHubError('Il sito non accetta modifiche in questo momento. Avvisa Martino.', {
            status: err.status,
            kind: 'http',
            detail: err.detail,
          });
        }
        if (attempt >= maxRetries) {
          throw new GitHubError('Qualcun altro sta salvando proprio adesso. Aspetta qualche secondo e riprova.', {
            status: err.status,
            kind: 'conflict',
            detail: err.detail,
          });
        }
        await sleep(this.retryDelay * (attempt + 1)); // the branch moved: rebuild on top of it
        continue;
      }
      this.commits.set(commit.sha, newTree.sha);
      return { commitSha: commit.sha, treeSha: newTree.sha };
    }
  }

  /** Latest run of a workflow on the branch, or null. */
  async latestRun(workflowFile) {
    const query = `branch=${encodeURIComponent(this.branch)}&per_page=1`;
    const data = await this.request('GET', `${this.repoPath}/actions/workflows/${encodeURIComponent(workflowFile)}/runs?${query}`);
    return (data && data.workflow_runs && data.workflow_runs[0]) || null;
  }
}
