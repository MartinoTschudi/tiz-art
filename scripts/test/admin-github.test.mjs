// GitHub client of the admin (public/admin/js/github.js) with a scripted fake fetch:
// exact requests of a commit (blobs → tree with base_tree and sha:null deletions → commit →
// PATCH force:false), the retry when the branch moved, error mapping and the blob cache.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { GitHubClient, GitHubError, isKeyError, KEY_INVALID_MESSAGE, TIMEOUT_MESSAGE } from '../../public/admin/js/github.js';

const API = 'https://api.github.com';
const REPO = '/repos/MartinoTschudi/tiz-art';

/**
 * Fake fetch: `routes` maps "METHOD /path" (without the API origin) to a handler returning
 * [status, body] (or a function of the parsed body). Every call is recorded in `calls`.
 */
function fakeFetch(routes) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    assert.ok(url.startsWith(API), url);
    const key = `${init.method} ${url.slice(API.length)}`;
    const body = init.body ? JSON.parse(init.body) : undefined;
    calls.push({ key, body, init });
    const route = routes[key];
    if (!route) throw new Error(`unexpected request ${key}`);
    const [status, payload, headers = {}] = typeof route === 'function' ? route(body, calls) : route;
    return new Response(typeof payload === 'string' ? payload : JSON.stringify(payload), { status, headers });
  };
  return { fetchImpl, calls };
}

const client = (fetchImpl, extra = {}) =>
  new GitHubClient({ owner: 'MartinoTschudi', repo: 'tiz-art', branch: 'main', token: 'secret-token' }, { fetchImpl, retryDelay: 0, ...extra });

/** A branch whose head moves from c1 to c2 after `movesAfter` reads of the ref. */
function headRoutes({ heads = ['c1'] } = {}) {
  let reads = 0;
  return {
    [`GET ${REPO}/git/ref/heads/main`]: () => [200, { object: { sha: heads[Math.min(reads++, heads.length - 1)] } }],
    [`GET ${REPO}/git/commits/c1`]: [200, { sha: 'c1', tree: { sha: 't1' } }],
    [`GET ${REPO}/git/commits/c2`]: [200, { sha: 'c2', tree: { sha: 't2' } }],
  };
}

describe('GitHubClient: requests', () => {
  test('every request carries the token, the API version and cache: no-store', async () => {
    const { fetchImpl, calls } = fakeFetch({ [`GET ${REPO}`]: [200, { permissions: { push: true } }] });
    await client(fetchImpl).getRepo();
    const { init } = calls[0];
    assert.equal(init.headers.Authorization, 'Bearer secret-token');
    assert.equal(init.headers['X-GitHub-Api-Version'], '2022-11-28');
    assert.equal(init.cache, 'no-store');
  });

  test('the token is not visible on the object (private field)', () => {
    const gh = client(async () => new Response('{}'));
    assert.ok(!JSON.stringify(gh).includes('secret-token'));
    assert.ok(!Object.values(gh).includes('secret-token'));
  });

  test('getHead: ref → commit → tree; the commit is cached', async () => {
    const { fetchImpl, calls } = fakeFetch(headRoutes());
    const gh = client(fetchImpl);
    assert.deepEqual(await gh.getHead(), { commitSha: 'c1', treeSha: 't1' });
    await gh.getHead();
    assert.equal(calls.filter((c) => c.key.includes('/git/commits/')).length, 1);
  });

  test('listFiles: one recursive request per tree, only blobs, cached', async () => {
    const { fetchImpl, calls } = fakeFetch({
      [`GET ${REPO}/git/trees/t1?recursive=1`]: [200, {
        tree: [
          { path: 'src', type: 'tree', sha: 's' },
          { path: 'src/content/opere/a/opera.json', type: 'blob', sha: 'b1', size: 10 },
        ],
      }],
    });
    const gh = client(fetchImpl);
    const files = await gh.listFiles('t1');
    assert.deepEqual([...files.keys()], ['src/content/opere/a/opera.json']);
    await gh.listFiles('t1');
    assert.equal(calls.length, 1);
  });

  test('a truncated tree is an error, not a silently partial list', async () => {
    const { fetchImpl } = fakeFetch({ [`GET ${REPO}/git/trees/t1?recursive=1`]: [200, { tree: [], truncated: true }] });
    await assert.rejects(() => client(fetchImpl).listFiles('t1'), /Non riesco a leggere tutte le opere/);
  });

  test('readText: raw blob, cached by SHA in memory and in `persist`', async () => {
    const stored = new Map();
    const persist = { get: (k) => stored.get(k) ?? null, set: (k, v) => stored.set(k, v) };
    const { fetchImpl, calls } = fakeFetch({ [`GET ${REPO}/git/blobs/b1`]: [200, '{"titolo":"Gioventù"}'] });
    const gh = client(fetchImpl, { persist });
    assert.equal(await gh.readText('b1'), '{"titolo":"Gioventù"}');
    assert.equal(await gh.readText('b1'), '{"titolo":"Gioventù"}');
    assert.equal(calls.length, 1);
    assert.equal(calls[0].init.headers.Accept, 'application/vnd.github.raw+json');
    assert.equal(stored.get('b1'), '{"titolo":"Gioventù"}');
    // a new client (next app start) reads it from `persist` without any request
    const again = client(async () => assert.fail('no request expected'), { persist });
    assert.equal(await again.readText('b1'), '{"titolo":"Gioventù"}');
  });

  test('createBlob: text as utf-8, bytes as base64', async () => {
    const { fetchImpl, calls } = fakeFetch({ [`POST ${REPO}/git/blobs`]: [201, { sha: 'new' }] });
    const gh = client(fetchImpl);
    await gh.createBlob('ciao');
    await gh.createBlob(new Blob([new Uint8Array([255, 216, 255])]));
    assert.deepEqual(calls[0].body, { content: 'ciao', encoding: 'utf-8' });
    assert.deepEqual(calls[1].body, { content: '/9j/', encoding: 'base64' });
  });
});

describe('GitHubClient: one commit per action', () => {
  test('blobs → tree on base_tree (deletions with sha null) → commit with parent → PATCH force:false', async () => {
    const { fetchImpl, calls } = fakeFetch({
      ...headRoutes(),
      [`POST ${REPO}/git/blobs`]: [201, { sha: 'json-blob' }],
      [`POST ${REPO}/git/trees`]: [201, { sha: 't-new' }],
      [`POST ${REPO}/git/commits`]: [201, { sha: 'c-new' }],
      [`PATCH ${REPO}/git/refs/heads/main`]: [200, { object: { sha: 'c-new' } }],
    });
    const result = await client(fetchImpl).commit({
      prepare: (head) => {
        assert.deepEqual(head, { commitSha: 'c1', treeSha: 't1' });
        return {
          message: 'opera: aggiunta «Prova»',
          files: [{ path: 'src/content/opere/prova/opera.json', text: '{}\n' }, { path: 'src/content/opere/prova/01-abcdef.jpg', sha: 'img-blob' }],
          deletes: ['src/content/opere/prova/02-old.jpg'],
        };
      },
    });
    assert.deepEqual(result, { commitSha: 'c-new', treeSha: 't-new' });
    const tree = calls.find((c) => c.key === `POST ${REPO}/git/trees`).body;
    assert.deepEqual(tree, {
      base_tree: 't1',
      tree: [
        { path: 'src/content/opere/prova/opera.json', mode: '100644', type: 'blob', sha: 'json-blob' },
        { path: 'src/content/opere/prova/01-abcdef.jpg', mode: '100644', type: 'blob', sha: 'img-blob' },
        { path: 'src/content/opere/prova/02-old.jpg', mode: '100644', type: 'blob', sha: null },
      ],
    });
    assert.deepEqual(calls.find((c) => c.key === `POST ${REPO}/git/commits`).body, { message: 'opera: aggiunta «Prova»', tree: 't-new', parents: ['c1'] });
    assert.deepEqual(calls.find((c) => c.key.startsWith('PATCH')).body, { sha: 'c-new', force: false });
  });

  test('nothing to do (prepare returns null or an empty plan) → no write at all', async () => {
    const { fetchImpl, calls } = fakeFetch(headRoutes());
    const gh = client(fetchImpl);
    assert.equal((await gh.commit({ prepare: () => null })).skipped, true);
    assert.equal((await gh.commit({ prepare: () => ({ message: 'x', files: [], deletes: [] }) })).skipped, true);
    assert.ok(calls.every((c) => c.init.method === 'GET'));
  });

  test('the branch moved (422 not a fast forward) → re-read head, rebuild on it, succeed', async () => {
    let patches = 0;
    const { fetchImpl, calls } = fakeFetch({
      ...headRoutes({ heads: ['c1', 'c2'] }),
      [`POST ${REPO}/git/blobs`]: [201, { sha: 'json-blob' }],
      [`POST ${REPO}/git/trees`]: (body) => [201, { sha: `tree-on-${body.base_tree}` }],
      [`POST ${REPO}/git/commits`]: (body) => [201, { sha: `commit-on-${body.parents[0]}` }],
      [`PATCH ${REPO}/git/refs/heads/main`]: () => (++patches === 1 ? [422, { message: 'Update is not a fast forward' }] : [200, {}]),
    });
    const heads = [];
    const result = await client(fetchImpl).commit({
      prepare: (head, attempt) => {
        heads.push([head.commitSha, attempt]);
        return { message: 'm', files: [{ path: 'a.json', text: `${head.commitSha}\n` }] };
      },
    });
    assert.deepEqual(heads, [['c1', 0], ['c2', 1]]);
    assert.deepEqual(result, { commitSha: 'commit-on-c2', treeSha: 'tree-on-t2' });
    const trees = calls.filter((c) => c.key === `POST ${REPO}/git/trees`).map((c) => c.body.base_tree);
    assert.deepEqual(trees, ['t1', 't2'], 'the second tree is built on the new head');
  });

  test('409 is retried too; after 3 retries a clear Italian message', async () => {
    let patches = 0;
    const { fetchImpl } = fakeFetch({
      ...headRoutes(),
      [`POST ${REPO}/git/blobs`]: [201, { sha: 'b' }],
      [`POST ${REPO}/git/trees`]: [201, { sha: 't' }],
      [`POST ${REPO}/git/commits`]: [201, { sha: 'c' }],
      [`PATCH ${REPO}/git/refs/heads/main`]: () => {
        patches++;
        return [patches % 2 ? 409 : 422, { message: 'Reference update failed' }];
      },
    });
    let attempts = 0;
    await assert.rejects(
      () => client(fetchImpl).commit({ prepare: () => (attempts++, { message: 'm', files: [{ path: 'a', text: 'x' }] }) }),
      (err) => err instanceof GitHubError && err.kind === 'conflict' && /Qualcun altro sta salvando/.test(err.message),
    );
    assert.equal(attempts, 4, '1 try + 3 retries');
    assert.equal(patches, 4);
  });

  test('a protected branch is not retried', async () => {
    let patches = 0;
    const { fetchImpl } = fakeFetch({
      ...headRoutes(),
      [`POST ${REPO}/git/blobs`]: [201, { sha: 'b' }],
      [`POST ${REPO}/git/trees`]: [201, { sha: 't' }],
      [`POST ${REPO}/git/commits`]: [201, { sha: 'c' }],
      [`PATCH ${REPO}/git/refs/heads/main`]: () => (patches++, [422, { message: 'Protected branch update failed' }]),
    });
    await assert.rejects(() => client(fetchImpl).commit({ prepare: () => ({ message: 'm', files: [{ path: 'a', text: 'x' }] }) }), /non accetta modifiche/);
    assert.equal(patches, 1);
  });

  /** Routes of a commit whose PATCH answer is lost; `refAfter` = what the branch says afterwards. */
  function lostPatch({ patch = () => { throw new TypeError('Load failed'); }, refAfter = 'c-new' } = {}) {
    let patched = false;
    const routes = {
      [`GET ${REPO}/git/ref/heads/main`]: () => [200, { object: { sha: patched ? (typeof refAfter === 'function' ? refAfter() : refAfter) : 'c1' } }],
      [`GET ${REPO}/git/commits/c1`]: [200, { sha: 'c1', tree: { sha: 't1' } }],
      [`POST ${REPO}/git/blobs`]: [201, { sha: 'b' }],
      [`POST ${REPO}/git/trees`]: [201, { sha: 't-new' }],
      [`POST ${REPO}/git/commits`]: [201, { sha: 'c-new' }],
    };
    const { fetchImpl, calls } = fakeFetch(routes);
    const wrapped = async (url, init) => {
      if (init.method === 'PATCH') {
        calls.push({ key: `PATCH ${url.slice(API.length)}`, init });
        patched = true; // GitHub applied it…
        return patch(); // …but the answer is lost (or an error)
      }
      return fetchImpl(url, init);
    };
    return { fetchImpl: wrapped, calls };
  }
  const plan = () => ({ message: 'm', files: [{ path: 'a', text: 'x' }] });

  test('the PATCH answer is lost but the branch now points at our commit → success, no retry', async () => {
    const { fetchImpl, calls } = lostPatch();
    let attempts = 0;
    const result = await client(fetchImpl).commit({ prepare: () => (attempts++, plan()) });
    assert.deepEqual(result, { commitSha: 'c-new', treeSha: 't-new' });
    assert.equal(attempts, 1);
    assert.equal(calls.filter((c) => c.key.startsWith('PATCH')).length, 1);
  });

  test('a 502 on the PATCH that was applied anyway → success; one that was not → the 502 error', async () => {
    const applied = lostPatch({ patch: () => new Response('{}', { status: 502 }) });
    assert.equal((await client(applied.fetchImpl).commit({ prepare: plan })).commitSha, 'c-new');
    const notApplied = lostPatch({ patch: () => new Response('{}', { status: 502 }), refAfter: 'c1' });
    await assert.rejects(() => client(notApplied.fetchImpl).commit({ prepare: plan }), (err) => err.kind === 'server');
  });

  test('the answer is lost and the branch cannot be read either → the original network error', async () => {
    let reads = 0;
    const { fetchImpl } = lostPatch({ refAfter: () => { throw new TypeError('Load failed'); } });
    const counting = async (url, init) => {
      if (init.method === 'GET' && url.includes('/git/ref/')) reads++;
      return fetchImpl(url, init);
    };
    await assert.rejects(() => client(counting).commit({ prepare: plan }), (err) => err.kind === 'network' && /Connessione assente/.test(err.message));
    assert.equal(reads, 1 + 2, 'head, then two checks');
  });

  test('an error of prepare (e.g. validation) stops before any write', async () => {
    const { fetchImpl, calls } = fakeFetch(headRoutes());
    await assert.rejects(() => client(fetchImpl).commit({ prepare: () => { throw new Error('dati non validi'); } }), /dati non validi/);
    assert.ok(calls.every((c) => c.init.method === 'GET'));
  });
});

describe('GitHubClient: errors in plain Italian', () => {
  const failing = (status, body = {}, headers = {}) => fakeFetch({ [`GET ${REPO}`]: [status, body, headers] }).fetchImpl;

  test('401 / 403 → the access key message, and isKeyError', async () => {
    for (const status of [401, 403]) {
      await assert.rejects(() => client(failing(status, { message: 'Bad credentials' })).getRepo(), (err) => {
        assert.equal(err.message, KEY_INVALID_MESSAGE);
        assert.ok(isKeyError(err));
        return true;
      });
    }
  });

  test('rate limit (403 with remaining 0, or 429) is NOT a key problem', async () => {
    const reset = String(Math.floor(Date.now() / 1000) + 600);
    await assert.rejects(() => client(failing(403, { message: 'API rate limit exceeded' }, { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': reset })).getRepo(),
      (err) => err.kind === 'ratelimit' && /Riprova tra 10 minuti/.test(err.message) && !isKeyError(err));
    await assert.rejects(() => client(failing(429, {}, { 'retry-after': '60' })).getRepo(), /Riprova tra 1 minuto\./);
  });

  test('network failure, 404, 5xx', async () => {
    await assert.rejects(() => client(async () => { throw new TypeError('Load failed'); }).getRepo(),
      (err) => err.kind === 'network' && /Connessione assente/.test(err.message));
    await assert.rejects(() => client(failing(404)).getRepo(), (err) => err.kind === 'notfound');
    await assert.rejects(() => client(failing(502)).getRepo(), (err) => err.kind === 'server' && /non risponde/.test(err.message));
  });

  test('a request that never answers ends with a plain timeout error (not an endless «Pubblico…»)', async () => {
    const stalled = (url, init) => new Promise((_resolve, reject) => init.signal.addEventListener('abort', () => reject(init.signal.reason)));
    const keepAlive = setTimeout(() => {}, 5000); // Node's AbortSignal.timeout does not keep the process alive
    const started = Date.now();
    await assert.rejects(() => client(stalled, { timeout: 30 }).getRepo(), (err) => err.kind === 'network' && err.message === TIMEOUT_MESSAGE);
    clearTimeout(keepAlive);
    assert.ok(Date.now() - started < 2000);
  });

  test('uploads get more time: the limit grows with the size of the body', async () => {
    let signal;
    const { fetchImpl } = fakeFetch({ [`POST ${REPO}/git/blobs`]: [201, { sha: 'b' }] });
    const spy = (url, init) => {
      signal = init.signal;
      return fetchImpl(url, init);
    };
    await client(spy, { timeout: 30 }).createBlob(new Uint8Array(30000));
    assert.ok(signal instanceof AbortSignal);
    await new Promise((r) => setTimeout(r, 60));
    assert.equal(signal.aborted, false, '40 kB of base64 at 20 kB/s: about 2 s more than the base limit');
  });

  test('an answer cut off in the middle is a network error', async () => {
    const cut = async () => new Response(new ReadableStream({ start(c) { c.error(new TypeError('network')); } }), { status: 200 });
    await assert.rejects(() => client(cut).getRepo(), (err) => err.kind === 'network');
  });

  test('latestRun reads the deploy.yml runs of the branch', async () => {
    const { fetchImpl, calls } = fakeFetch({
      [`GET ${REPO}/actions/workflows/deploy.yml/runs?branch=main&per_page=1`]: [200, { workflow_runs: [{ status: 'completed', conclusion: 'success' }] }],
    });
    assert.deepEqual(await client(fetchImpl).latestRun('deploy.yml'), { status: 'completed', conclusion: 'success' });
    assert.equal(calls.length, 1);
  });
});
