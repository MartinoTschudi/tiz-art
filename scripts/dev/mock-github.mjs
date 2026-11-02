/**
 * In-memory fake of the GitHub REST endpoints the admin and its setup use (Git Data API,
 * repository info, Actions runs) plus raw files — for `npm run admin:dev` and the admin tests.
 *
 * Behaves like GitHub where it matters for the admin:
 *   - blobs get real git SHA-1s; trees and commits are content-addressed too
 *   - POST /git/trees applies entries on top of base_tree; deleting a missing path → 422
 *   - PATCH /git/refs/heads/{branch} with force:false → 422 "Update is not a fast forward"
 *     when the new commit does not descend from the current tip
 *   - unknown token → 401, read-only token → push:false and 403 on writes
 *   - every ref update starts a "Deploy" run: in progress for `runDurationMs`, then success
 * Debug helpers (not GitHub): state(), raceNextPatch(), failNext(), reset().
 *
 * The handler takes a WHATWG Request and returns a Response, so tests call `mock.fetch` directly
 * and scripts/dev/admin-dev.mjs serves it over HTTP.
 */
import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

const enc = new TextEncoder();
const dec = new TextDecoder();

const sha1 = (...parts) => {
  const h = createHash('sha1');
  for (const p of parts) h.update(p);
  return h.digest('hex');
};

const CONTENT_TYPES = { '.json': 'application/json; charset=utf-8', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' };

/** Reads every file below `dirs` (relative to `rootDir`) → { 'src/content/…': Uint8Array }. */
export async function readFilesFrom(rootDir, dirs) {
  const files = {};
  async function walk(rel) {
    let entries;
    try {
      entries = await readdir(path.join(rootDir, rel), { withFileTypes: true });
    } catch {
      return; // missing folder
    }
    for (const e of entries) {
      if (e.name.startsWith('.')) continue;
      const child = `${rel}/${e.name}`;
      if (e.isDirectory()) await walk(child);
      else if (e.isFile()) files[child] = new Uint8Array(await readFile(path.join(rootDir, child)));
    }
  }
  for (const dir of dirs) await walk(dir);
  return files;
}

/**
 * @param {{owner?: string, repo?: string, branch?: string, files?: Record<string, string|Uint8Array>,
 *          tokens?: Record<string, {push?: boolean, actions?: boolean}>, runDurationMs?: number,
 *          delayMs?: number, now?: () => number}} [options]
 */
export function createMockGitHub({
  owner = 'MartinoTschudi',
  repo = 'tiz-art',
  branch = 'main',
  files = {},
  tokens = { 'test-token': { push: true, actions: true } },
  runDurationMs = 20000,
  delayMs = 0,
  now = () => Date.now(),
} = {}) {
  let blobs; // sha → Uint8Array
  let trees; // tree sha → Map(path → blob sha)   (flat, full paths)
  let subtrees; // synthetic sha of a folder → { root, prefix }
  let commits; // sha → { tree, parents, message, date }
  let ref; // commit sha of the branch
  let runs; // newest first
  let requests; // log of API calls (method + path)
  let race; // number of upcoming PATCHes preceded by an external commit
  let failures; // [{ match, status, count }]
  let seq;

  function putBlob(bytes) {
    const sha = sha1(`blob ${bytes.length}\0`, bytes);
    blobs.set(sha, bytes);
    return sha;
  }

  function putTree(map) {
    const sorted = [...map.entries()].sort(([a], [b]) => (a < b ? -1 : 1));
    const sha = sha1('tree\n', sorted.map(([p, s]) => `${p} ${s}`).join('\n'));
    trees.set(sha, new Map(sorted));
    return sha;
  }

  function putCommit(tree, parents, message) {
    const date = new Date(now()).toISOString();
    const sha = sha1('commit\n', tree, parents.join(','), message, String(++seq));
    commits.set(sha, { tree, parents, message, date });
    return sha;
  }

  function startRun(headSha) {
    const created = now();
    runs.unshift({ id: runs.length + 1, head_sha: headSha, created, html_url: `https://github.com/${owner}/${repo}/actions/runs/${runs.length + 1}` });
  }

  function reset() {
    blobs = new Map();
    trees = new Map();
    subtrees = new Map();
    commits = new Map();
    runs = [];
    requests = [];
    race = 0;
    failures = [];
    seq = 0;
    const map = new Map();
    for (const [p, content] of Object.entries(files)) map.set(p, putBlob(typeof content === 'string' ? enc.encode(content) : content));
    ref = putCommit(putTree(map), [], 'contenuto iniziale');
    startRun(ref);
    runs[0].created -= runDurationMs; // the initial publish is already done
  }
  reset();

  const runView = (r) => {
    const done = now() - r.created >= runDurationMs;
    return {
      id: r.id,
      name: 'Deploy',
      head_branch: branch,
      head_sha: r.head_sha,
      status: done ? 'completed' : 'in_progress',
      conclusion: done ? 'success' : null,
      html_url: r.html_url,
      created_at: new Date(r.created).toISOString(),
      updated_at: new Date(done ? r.created + runDurationMs : now()).toISOString(),
    };
  };

  /** Is `ancestor` reachable from `sha` through parents? */
  function descends(sha, ancestor) {
    const stack = [sha];
    const seen = new Set();
    while (stack.length) {
      const s = stack.pop();
      if (s === ancestor) return true;
      if (seen.has(s) || !commits.has(s)) continue;
      seen.add(s);
      stack.push(...commits.get(s).parents);
    }
    return false;
  }

  function subtreeId(root, prefix) {
    const id = sha1('subtree\n', root, prefix);
    subtrees.set(id, { root, prefix });
    return id;
  }

  /** GitHub-like listing of a tree (root or folder), recursive or not. */
  function listing(sha, recursive) {
    const where = trees.has(sha) ? { root: sha, prefix: '' } : subtrees.get(sha);
    if (!where) return null;
    const out = [];
    const dirs = new Set();
    for (const [p, blobSha] of trees.get(where.root)) {
      if (!p.startsWith(where.prefix)) continue;
      const rest = p.slice(where.prefix.length);
      const parts = rest.split('/');
      const upto = recursive ? parts.length - 1 : Math.min(1, parts.length - 1);
      for (let i = 1; i <= upto; i++) {
        const dir = parts.slice(0, i).join('/');
        if (!dirs.has(dir)) {
          dirs.add(dir);
          out.push({ path: dir, mode: '040000', type: 'tree', sha: subtreeId(where.root, `${where.prefix}${dir}/`) });
        }
      }
      if (recursive || parts.length === 1) {
        out.push({ path: rest, mode: '100644', type: 'blob', sha: blobSha, size: blobs.get(blobSha).length });
      }
    }
    return out;
  }

  /** Simulates a push from somewhere else (same files, new commit): the next PATCH must retry. */
  function externalCommit(message = 'commit esterno') {
    ref = putCommit(commits.get(ref).tree, [ref], message);
  }

  const json = (status, body, headers = {}) =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', ...headers } });
  const notFound = (what = 'Not Found') => json(404, { message: what, documentation_url: 'https://docs.github.com/rest' });

  function rawFile(refOrSha, filePath) {
    const commitSha = refOrSha === branch || refOrSha === 'HEAD' ? ref : refOrSha;
    const commit = commits.get(commitSha);
    const blobSha = commit && trees.get(commit.tree).get(filePath);
    if (!blobSha) return new Response('404: Not Found', { status: 404 });
    const type = CONTENT_TYPES[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
    return new Response(blobs.get(blobSha), { status: 200, headers: { 'content-type': type, 'cache-control': 'max-age=300' } });
  }

  async function api(request, url) {
    const method = request.method;
    const p = decodeURIComponent(url.pathname);
    const base = `/repos/${owner}/${repo}`;
    const auth = /^(?:Bearer|token) (.+)$/.exec(request.headers.get('authorization') || '');
    const perms = auth && tokens[auth[1]];
    if (!perms) return json(401, { message: 'Bad credentials' });
    const readOnly = 'Resource not accessible by personal access token';
    let m;

    if (!p.startsWith(base)) return notFound();
    const rest = p.slice(base.length);
    const body = method === 'POST' || method === 'PATCH' ? await request.json() : null;

    if (method === 'GET' && rest === '') {
      return json(200, {
        full_name: `${owner}/${repo}`, private: false, default_branch: branch,
        permissions: { admin: false, maintain: false, push: Boolean(perms.push), triage: true, pull: true },
      });
    }
    if (method === 'GET' && (rest === `/git/ref/heads/${branch}` || rest === `/git/refs/heads/${branch}`)) {
      return json(200, { ref: `refs/heads/${branch}`, object: { sha: ref, type: 'commit' } });
    }
    if (method === 'GET' && rest.startsWith('/git/ref/heads/')) return notFound();
    if (method === 'GET' && rest === `/branches/${branch}`) return json(200, { name: branch, commit: { sha: ref } });
    if (method === 'GET' && (m = /^\/git\/commits\/(\w+)$/.exec(rest))) {
      const c = commits.get(m[1]);
      return c
        ? json(200, { sha: m[1], tree: { sha: c.tree }, parents: c.parents.map((sha) => ({ sha })), message: c.message, author: { date: c.date } })
        : notFound();
    }
    if (method === 'GET' && (m = /^\/git\/trees\/(\w+)$/.exec(rest))) {
      const tree = listing(m[1], url.searchParams.get('recursive') === '1');
      return tree ? json(200, { sha: m[1], tree, truncated: false }) : notFound();
    }
    if (method === 'GET' && (m = /^\/git\/blobs\/(\w+)$/.exec(rest))) {
      const bytes = blobs.get(m[1]);
      if (!bytes) return notFound();
      if (/raw/.test(request.headers.get('accept') || '')) return new Response(bytes, { status: 200, headers: { 'content-type': 'application/vnd.github.raw' } });
      return json(200, { sha: m[1], size: bytes.length, encoding: 'base64', content: Buffer.from(bytes).toString('base64') });
    }
    if (method === 'GET' && rest === '/actions/workflows/deploy.yml/runs') {
      if (perms.actions === false) return json(403, { message: readOnly });
      return json(200, { total_count: runs.length, workflow_runs: runs.slice(0, Number(url.searchParams.get('per_page')) || 30).map(runView) });
    }

    if (method !== 'GET' && !perms.push) return json(403, { message: readOnly });

    if (method === 'POST' && rest === '/git/blobs') {
      if (typeof body.content !== 'string' || !['utf-8', 'base64'].includes(body.encoding)) return json(422, { message: 'Invalid request' });
      const bytes = body.encoding === 'base64' ? new Uint8Array(Buffer.from(body.content, 'base64')) : enc.encode(body.content);
      return json(201, { sha: putBlob(bytes) });
    }
    if (method === 'POST' && rest === '/git/trees') {
      const baseMap = body.base_tree ? trees.get(body.base_tree) : new Map();
      if (!baseMap) return json(422, { message: 'Invalid tree info: base_tree is not a root tree' });
      const map = new Map(baseMap);
      for (const e of body.tree || []) {
        if (e.mode !== '100644' || e.type !== 'blob') return json(422, { message: `Unsupported tree entry ${e.path}` });
        if (e.sha === null) {
          if (!map.has(e.path)) return json(422, { message: `GitRPC::BadObjectState: ${e.path} does not exist` });
          map.delete(e.path);
        } else if (!blobs.has(e.sha)) {
          return json(422, { message: `tree.sha ${e.sha} is not a valid blob` });
        } else {
          map.set(e.path, e.sha);
        }
      }
      return json(201, { sha: putTree(map) });
    }
    if (method === 'POST' && rest === '/git/commits') {
      if (!trees.has(body.tree)) return json(422, { message: 'Tree SHA does not exist' });
      if (!Array.isArray(body.parents) || body.parents.some((s) => !commits.has(s))) return json(422, { message: 'Parent SHA does not exist' });
      if (typeof body.message !== 'string' || !body.message) return json(422, { message: 'Missing message' });
      return json(201, { sha: putCommit(body.tree, body.parents, body.message) });
    }
    if (method === 'PATCH' && rest === `/git/refs/heads/${branch}`) {
      if (race > 0) {
        race -= 1;
        externalCommit();
      }
      if (!commits.has(body.sha)) return json(422, { message: 'Object does not exist' });
      if (!body.force && !descends(body.sha, ref)) return json(422, { message: 'Update is not a fast forward' });
      ref = body.sha;
      startRun(ref);
      return json(200, { ref: `refs/heads/${branch}`, object: { sha: ref, type: 'commit' } });
    }
    return notFound(`Not Found (${method} ${rest})`);
  }

  async function handle(request) {
    const url = new URL(request.url);
    if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
    let m;
    if ((m = /^\/raw\/([^/]+)\/(.+)$/.exec(url.pathname)) && request.method === 'GET') {
      return rawFile(decodeURIComponent(m[1]), decodeURIComponent(m[2]));
    }
    if (url.pathname.startsWith('/repos/')) {
      requests.push(`${request.method} ${url.pathname}${url.search}`);
      const failure = failures.find((f) => f.count > 0 && (!f.method || f.method === request.method) && url.pathname.includes(f.match || ''));
      if (failure) {
        failure.count -= 1;
        return json(failure.status, { message: 'Simulated failure' });
      }
      return api(request, url);
    }
    return notFound();
  }

  const mock = {
    owner,
    repo,
    branch,
    handle,
    /** fetch-compatible entry point (tests). */
    fetch: (input, init) => handle(new Request(input, init)),
    reset,
    /** The next `n` PATCHes of the branch find it moved by someone else (→ the admin must retry). */
    raceNextPatch(n = 1) {
      race += n;
    },
    /** The next `count` API calls whose path contains `match` (and method, if given) fail with `status`. */
    failNext({ match = '', method = null, status = 500, count = 1 } = {}) {
      failures.push({ match, method, status, count });
    },
    externalCommit,
    head: () => ref,
    files: () => trees.get(commits.get(ref).tree),
    read(filePath) {
      const sha = mock.files().get(filePath);
      return sha ? dec.decode(blobs.get(sha)) : null;
    },
    readBytes(filePath) {
      const sha = mock.files().get(filePath);
      return sha ? blobs.get(sha) : null;
    },
    /** Commits from the newest: [{ sha, message, parents, date }]. */
    log() {
      const out = [];
      for (let s = ref; s; s = commits.get(s).parents[0]) out.push({ sha: s, ...commits.get(s) });
      return out;
    },
    requests: () => requests,
    /** Everything a test or the e2e script wants to check, as JSON. */
    state() {
      const filesObj = {};
      for (const [p, s] of mock.files()) filesObj[p] = { sha: s, size: blobs.get(s).length };
      return { owner, repo, branch, head: ref, commits: mock.log(), files: filesObj, runs: runs.map(runView) };
    },
  };
  return mock;
}
