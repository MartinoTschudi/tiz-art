#!/usr/bin/env node
/**
 * `npm run admin:dev` — try the admin locally without touching GitHub.
 *
 * Starts a mock of the GitHub API on http://localhost:8787 (in memory, seeded from this working
 * tree's src/content and src/data; see mock-github.mjs) and writes a throwaway
 * public/admin/auth.dev.json (git-ignored, deleted again on exit) for test@example.com with a
 * random password printed below. Then, with `npm run dev` running, open
 *   http://localhost:4321/admin/index.html?api=http://localhost:8787
 * The admin only accepts ?api= on localhost / 127.0.0.1 (see public/admin/js/env.js).
 *
 * Options: --port 8787 · --delay <ms> (slow network) · --run-seconds 20 (duration of a "deploy")
 * Debug endpoints (not GitHub): GET /__state · GET /__requests · POST /__reset ·
 *   POST /__race?n=1 (the next save finds the branch moved) ·
 *   POST /__fail?match=/git/trees&method=POST&status=500&count=1 (simulated errors)
 */
import http from 'node:http';
import { randomBytes } from 'node:crypto';
import { readFile, writeFile, rm } from 'node:fs/promises';
import { rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createMockGitHub, readFilesFrom } from './mock-github.mjs';
import { encryptAuth, suggestPassphrase } from '../admin-setup.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const AUTH_DEV = path.join(ROOT, 'public', 'admin', 'auth.dev.json');
const DEV_EMAIL = 'test@example.com';
const READ_ONLY_TOKEN = 'dev-sola-lettura';

function parseArgs(argv) {
  const opts = { port: 8787, delay: 0, runSeconds: 20 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--port') opts.port = Number(argv[++i]);
    else if (a === '--delay') opts.delay = Number(argv[++i]);
    else if (a === '--run-seconds') opts.runSeconds = Number(argv[++i]);
    else throw new Error(`opzione sconosciuta ${a}`);
  }
  return opts;
}

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, PATCH, OPTIONS',
  'access-control-allow-headers': 'Authorization, Content-Type, Accept, X-GitHub-Api-Version',
  'access-control-max-age': '600',
};

/** Node request → WHATWG Request (body buffered: requests are small JSON or base64 photos). */
async function toRequest(req, origin) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const body = chunks.length ? Buffer.concat(chunks) : undefined;
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) if (typeof v === 'string') headers.set(k, v);
  return new Request(new URL(req.url, origin), { method: req.method, headers, body: req.method === 'GET' || req.method === 'HEAD' ? undefined : body });
}

async function send(res, response) {
  const headers = { ...CORS };
  response.headers.forEach((v, k) => {
    headers[k] = v;
  });
  res.writeHead(response.status, headers);
  res.end(Buffer.from(await response.arrayBuffer()));
}

const jsonResponse = (body) => new Response(JSON.stringify(body, null, 2), { headers: { 'content-type': 'application/json; charset=utf-8' } });

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const sito = JSON.parse(await readFile(path.join(ROOT, 'src', 'data', 'sito.json'), 'utf8'));
  const { owner, repo, branch } = sito.repository;
  const token = `dev-${randomBytes(16).toString('hex')}`;
  const password = suggestPassphrase();

  const mock = createMockGitHub({
    owner,
    repo,
    branch,
    files: await readFilesFrom(ROOT, ['src/content', 'src/data']),
    tokens: { [token]: { push: true, actions: true }, [READ_ONLY_TOKEN]: { push: false, actions: true } },
    runDurationMs: opts.runSeconds * 1000,
    delayMs: opts.delay,
  });

  const auth = encryptAuth({ owner, repo, branch, email: DEV_EMAIL, password, token });
  await writeFile(AUTH_DEV, `${JSON.stringify(auth, null, 2)}\n`);

  const origin = `http://localhost:${opts.port}`;
  const handler = async (req, res) => {
    try {
      if (req.method === 'OPTIONS') {
        res.writeHead(204, CORS);
        return res.end();
      }
      const url = new URL(req.url, origin);
      if (url.pathname === '/__state') return send(res, jsonResponse(mock.state()));
      if (url.pathname === '/__requests') return send(res, jsonResponse(mock.requests()));
      if (url.pathname === '/__reset' && req.method === 'POST') {
        mock.reset();
        return send(res, jsonResponse({ ok: true, head: mock.head() }));
      }
      if (url.pathname === '/__race' && req.method === 'POST') {
        mock.raceNextPatch(Number(url.searchParams.get('n')) || 1);
        return send(res, jsonResponse({ ok: true }));
      }
      if (url.pathname === '/__fail' && req.method === 'POST') {
        const q = url.searchParams;
        mock.failNext({ match: q.get('match') || '', method: q.get('method'), status: Number(q.get('status')) || 500, count: Number(q.get('count')) || 1 });
        return send(res, jsonResponse({ ok: true }));
      }
      return send(res, await mock.handle(await toRequest(req, origin)));
    } catch (err) {
      console.error(err);
      res.writeHead(500, CORS);
      res.end(JSON.stringify({ message: String(err.message || err) }));
    }
  };

  // Both loopback addresses: browsers may resolve "localhost" to either.
  const servers = [];
  for (const host of ['127.0.0.1', '::1']) {
    const server = http.createServer(handler);
    try {
      await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(opts.port, host, resolve);
      });
      servers.push(server);
    } catch (err) {
      if (host === '127.0.0.1') throw err; // no IPv6 loopback is fine
    }
  }

  const cleanup = () => rmSync(AUTH_DEV, { force: true });
  process.on('exit', cleanup);
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () => {
      for (const s of servers) s.close();
      process.exit(0);
    });
  }

  console.log(`
Mock dell’API GitHub pronto su ${origin}  (${owner}/${repo}, ramo ${branch}, ${mock.files().size} file)

  1. In un altro terminale:  npm run dev
  2. Apri:  http://localhost:4321/admin/index.html?api=${origin}
  3. Accedi con  ${DEV_EMAIL}  /  ${password}

  Pagina di configurazione:  http://localhost:4321/admin/setup/index.html?api=${origin}
    token valido: ${token}   ·   token di sola lettura: ${READ_ONLY_TOKEN}
    (salva public/admin/auth.json nel mock, non sul disco; il login locale usa auth.dev.json)

  Stato del mock: ${origin}/__state   ·   Ctrl-C per fermare (cancella auth.dev.json)
`);
}

main().catch(async (err) => {
  console.error(`admin:dev non è partito: ${err.message}`);
  await rm(AUTH_DEV, { force: true });
  process.exitCode = 1;
});
