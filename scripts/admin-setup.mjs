#!/usr/bin/env node
/**
 * Admin setup from the terminal — the alternative to the setup page (<site>/admin/setup/).
 * Creates public/admin/auth.json, the encrypted access file the admin needs to save to GitHub.
 * It only writes the local file: commit and push it yourself (the setup page commits by itself).
 *
 *   npm run admin:setup                        interactive (hidden input for password and token)
 *   npm run admin:setup -- --skip-verify       do not check the token with GitHub
 *   npm run admin:setup -- --force             overwrite an existing auth.json without asking
 *   npm run admin:setup -- --out <file>        write somewhere else (default public/admin/auth.json)
 *   npm run admin:setup -- --api <url>         another API (e.g. the local mock http://localhost:8787)
 *
 * Without a terminal (CI, tests) every answer can come from an environment variable —
 * ADMIN_OWNER, ADMIN_REPO, ADMIN_BRANCH, ADMIN_EMAIL, ADMIN_PASSWORD, ADMIN_TOKEN — and missing
 * answers are read line by line from stdin.
 *
 * Format v2 (public/admin/js/crypto.js reads it — keep both in sync; tests check both directions):
 *   { "v": 2, "owner", "repo", "branch", "kdf": "PBKDF2-SHA256", "iterations": 600000,
 *     "salt": base64(16 bytes), "iv": base64(12 bytes), "ciphertext": base64(AES-256-GCM ciphertext || 16-byte tag) }
 *   key       = PBKDF2-SHA256(UTF-8 of email.trim().toLowerCase() + "\n" + password, salt, iterations, 32 bytes)
 *   plaintext = UTF-8 JSON {"token": "..."}; the e-mail is NOT stored.
 *
 * Only Node.js built-ins (plus the shared password rules of the setup page).
 */
import { pbkdf2Sync, randomBytes, randomInt, createCipheriv, createDecipheriv } from 'node:crypto';
import { readFile, writeFile, mkdir, access } from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { StringDecoder } from 'node:string_decoder';
import { fileURLToPath } from 'node:url';
import { isEmail, checkPassword, checkToken, MIN_PASSWORD_LENGTH } from '../public/admin/setup/rules.js';

export const AUTH_VERSION = 2;
export const KDF = 'PBKDF2-SHA256';
export const KDF_ITERATIONS = 600_000;
export const FALLBACK_REPOSITORY = { owner: 'MartinoTschudi', repo: 'tiz-art', branch: 'main' };

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_OUT = path.join(ROOT_DIR, 'public', 'admin', 'auth.json');
const GITHUB_API = 'https://api.github.com';

// ─── Crypto (byte-compatible with public/admin/js/crypto.js) ─────────────────

/** " Tiziana@Example.CH " → "tiziana@example.ch" */
export function normalizeEmail(email) {
  return String(email ?? '').trim().toLowerCase();
}

/** The secret the key is derived from: normalized e-mail, a line feed, the password as typed. */
export function keyMaterial(email, password) {
  return `${normalizeEmail(email)}\n${String(password ?? '')}`;
}

/** PBKDF2-SHA256 → 32-byte AES key (UTF-8 bytes, exactly like TextEncoder in the browser). */
export function deriveKey(email, password, salt, iterations = KDF_ITERATIONS) {
  return pbkdf2Sync(Buffer.from(keyMaterial(email, password), 'utf8'), salt, iterations, 32, 'sha256');
}

/** Encrypts the token → auth.json object (documented key order). `salt` / `iv` only for tests. */
export function encryptAuth({ owner, repo, branch = 'main', email, password, token, iterations = KDF_ITERATIONS, salt, iv }) {
  if (!token) throw new Error('manca il token');
  if (!normalizeEmail(email)) throw new Error('manca l’e-mail');
  if (!password) throw new Error('manca la password');
  salt ??= randomBytes(16);
  iv ??= randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', deriveKey(email, password, salt, iterations), iv);
  const plaintext = Buffer.from(JSON.stringify({ token }), 'utf8');
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final(), cipher.getAuthTag()]);
  return {
    v: AUTH_VERSION,
    owner,
    repo,
    branch,
    kdf: KDF,
    iterations,
    salt: Buffer.from(salt).toString('base64'),
    iv: Buffer.from(iv).toString('base64'),
    ciphertext: ciphertext.toString('base64'),
  };
}

/** Decrypts an auth.json object → { token }. Throws on wrong e-mail / password. */
export function decryptAuth(auth, email, password) {
  if (!auth || auth.v !== AUTH_VERSION || auth.kdf !== KDF) throw new Error('formato di auth.json non supportato');
  const data = Buffer.from(auth.ciphertext, 'base64');
  if (data.length < 17) throw new Error('auth.json danneggiato');
  const decipher = createDecipheriv('aes-256-gcm', deriveKey(email, password, Buffer.from(auth.salt, 'base64'), auth.iterations), Buffer.from(auth.iv, 'base64'));
  decipher.setAuthTag(data.subarray(data.length - 16));
  try {
    return JSON.parse(Buffer.concat([decipher.update(data.subarray(0, data.length - 16)), decipher.final()]).toString('utf8'));
  } catch {
    throw new Error('e-mail o password non corretti (oppure auth.json danneggiato)');
  }
}

/**
 * Suggests a passphrase of 4 pronounceable made-up words, e.g. "toravi-memuso-bilena-carepo"
 * (each word ≈ 18 bits, ≈ 73 bits in all): strong and easy to type on a phone.
 */
export function suggestPassphrase(words = 4) {
  const consonants = 'bcdfglmnprstvz';
  const vowels = 'aeiou';
  const syllable = () => consonants[randomInt(consonants.length)] + vowels[randomInt(vowels.length)];
  return Array.from({ length: words }, () => syllable() + syllable() + syllable()).join('-');
}

// ─── GitHub check ────────────────────────────────────────────────────────────

/**
 * Checks the token like the setup page does. Returns { ok, problems[], notes[] }.
 * Needs push access (fine-grained token: Contents → Read and write); Actions → Read is optional.
 */
export async function verifyToken({ owner, repo, branch, token, api = GITHUB_API, fetch = globalThis.fetch }) {
  const gh = (p) =>
    fetch(`${api}${p}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'tiz-art-admin-setup',
      },
    });
  const base = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
  const problems = [];
  const notes = [];

  let res;
  try {
    res = await gh(base);
  } catch (err) {
    return { ok: false, problems: [`non riesco a raggiungere GitHub (${err.message}): controlla la connessione o usa --skip-verify`], notes };
  }
  if (res.status === 401) return { ok: false, problems: ['il token non è valido o è scaduto'], notes };
  if (res.status === 403 || res.status === 404) {
    return { ok: false, problems: [`repository ${owner}/${repo} non trovato, oppure il token non ha accesso`], notes };
  }
  if (!res.ok) return { ok: false, problems: [`GitHub ha risposto HTTP ${res.status}`], notes };
  const info = await res.json();
  if (info.permissions?.push !== true) problems.push('il token può solo leggere: serve «Contents: Read and write»');

  const ref = await gh(`${base}/git/ref/heads/${encodeURIComponent(branch)}`);
  if (ref.status === 404 || ref.status === 409) problems.push(`il ramo «${branch}» non esiste (il repository è vuoto?)`);

  const runs = await gh(`${base}/actions/workflows/deploy.yml/runs?per_page=1`);
  if (runs.status === 403) notes.push('il token non può leggere GitHub Actions: l’admin non mostrerà lo stato della pubblicazione (aggiungi «Actions: Read»)');
  else if (runs.status === 404) notes.push('il flusso deploy.yml non esiste ancora (va bene se il codice non è ancora pubblicato)');
  return { ok: problems.length === 0, problems, notes };
}

// ─── Terminal input ──────────────────────────────────────────────────────────

/** Removes terminal escape sequences (arrow keys, bracketed paste markers…) from raw input. */
const ESCAPES = /\u001b\[[0-9;?]*[ -/]*[@-~]|\u001b[O[][A-Za-z~]?|\u001b./g;

/**
 * Asks questions on a terminal (visible: readline; hidden: raw mode, nothing echoed) or, when
 * stdin is not a terminal, reads the answers line by line from stdin.
 */
export function createPrompter({ input = process.stdin, output = process.stdout } = {}) {
  const interactive = Boolean(input.isTTY) && typeof input.setRawMode === 'function';
  const abort = () => {
    output.write('\nInterrotto: non ho scritto niente.\n');
    process.exit(130);
  };

  if (!interactive) {
    let lines = null; // created on first use: with only env vars, stdin is never touched
    let rl = null;
    /** Next line of stdin; when stdin has ended, '' if the question has a default, else an error. */
    const next = async (question, hasDefault = false) => {
      if (!lines) {
        rl = readline.createInterface({ input, terminal: false });
        lines = rl[Symbol.asyncIterator]();
      }
      const { value, done } = await lines.next();
      if (!done) return value;
      if (hasDefault) return '';
      throw new Error(`nessuna risposta per «${question}» (stdin finito: usa le variabili ADMIN_*)`);
    };
    return {
      interactive,
      async ask(question, fallback = '') {
        output.write(fallback ? `${question} [${fallback}]: ` : `${question}: `);
        const value = (await next(question, Boolean(fallback))).trim();
        output.write(`${value}\n`);
        return value || fallback;
      },
      async askHidden(question) {
        output.write(`${question}: `);
        const value = await next(question);
        output.write('(nascosto)\n');
        return value;
      },
      close() {
        if (rl) rl.close();
      },
    };
  }

  return {
    interactive,
    ask(question, fallback = '') {
      return new Promise((resolve) => {
        const rl = readline.createInterface({ input, output, terminal: true });
        rl.on('SIGINT', abort);
        rl.question(fallback ? `${question} [${fallback}]: ` : `${question}: `, (answer) => {
          rl.close();
          resolve(answer.trim() || fallback);
        });
      });
    },
    /** Raw mode: every key press arrives here and nothing is echoed. */
    askHidden(question) {
      return new Promise((resolve, reject) => {
        output.write(`${question}: `);
        const decoder = new StringDecoder('utf8');
        const wasRaw = Boolean(input.isRaw);
        let value = '';
        const finish = (err) => {
          input.removeListener('data', onData);
          input.setRawMode(wasRaw);
          input.pause();
          output.write('\n');
          if (err) reject(err);
          else resolve(value);
        };
        const onData = (chunk) => {
          for (const ch of decoder.write(chunk).replace(ESCAPES, '')) {
            if (ch === '\r' || ch === '\n') return finish();
            if (ch === '\u0003') {
              input.setRawMode(wasRaw);
              return abort(); // Ctrl-C
            }
            if (ch === '\u0004') {
              if (!value) return finish(new Error('input terminato'));
              continue;
            }
            if (ch === '\u007f' || ch === '\b') {
              value = Array.from(value).slice(0, -1).join('');
              continue;
            }
            if (ch === '\u0015') {
              value = ''; // Ctrl-U
              continue;
            }
            if (ch < ' ') continue;
            value += ch;
          }
        };
        input.setRawMode(true);
        input.on('data', onData);
        input.resume();
      });
    },
    close() {},
  };
}

// ─── Setup flow ──────────────────────────────────────────────────────────────

export function parseArgs(argv) {
  const args = { skipVerify: false, force: false, out: DEFAULT_OUT, api: GITHUB_API, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--skip-verify') args.skipVerify = true;
    else if (a === '--force') args.force = true;
    else if (a === '--out') args.out = path.resolve(argv[++i] ?? '');
    else if (a === '--api') args.api = String(argv[++i] ?? '').replace(/\/+$/, '');
    else if (a === '-h' || a === '--help') args.help = true;
    else throw new Error(`opzione sconosciuta ${a}`);
  }
  return args;
}

/** owner / repo / branch from src/data/sito.json (falls back to the known repository). */
async function readRepository(rootDir) {
  try {
    const sito = JSON.parse(await readFile(path.join(rootDir, 'src', 'data', 'sito.json'), 'utf8'));
    return { ...FALLBACK_REPOSITORY, ...sito.repository };
  } catch {
    return { ...FALLBACK_REPOSITORY };
  }
}

const HELP = `Uso: npm run admin:setup [-- --skip-verify] [-- --force] [-- --out <file>] [-- --api <url>]

Crea public/admin/auth.json (e-mail + password di Tiziana, token GitHub cifrato).
Senza terminale: ADMIN_OWNER, ADMIN_REPO, ADMIN_BRANCH, ADMIN_EMAIL, ADMIN_PASSWORD, ADMIN_TOKEN.
In alternativa usa la pagina <sito>/admin/setup/ (salva e pubblica il file da sola).`;

/**
 * The whole setup. Every dependency is injectable for tests.
 * @returns {Promise<{out: string, auth: object}|null>}
 */
export async function runSetup({
  argv = process.argv.slice(2),
  env = process.env,
  input = process.stdin,
  output = process.stdout,
  fetch = globalThis.fetch,
  rootDir = ROOT_DIR,
} = {}) {
  const args = parseArgs(argv);
  const say = (line = '') => output.write(`${line}\n`);
  if (args.help) {
    say(HELP);
    return null;
  }
  const defaults = await readRepository(rootDir);
  const prompt = createPrompter({ input, output });
  const fromEnv = (name) => (typeof env[name] === 'string' && env[name] !== '' ? env[name] : null);

  try {
    say('\nTIZ Admin – configurazione dell’accesso');
    say('Crea il file cifrato con cui l’admin (/admin/) salva sul repository GitHub.\n');

    const owner = fromEnv('ADMIN_OWNER')?.trim() ?? (await prompt.ask('Proprietario GitHub', defaults.owner));
    const repo = fromEnv('ADMIN_REPO')?.trim() ?? (await prompt.ask('Repository', defaults.repo));
    const branch = fromEnv('ADMIN_BRANCH')?.trim() ?? (await prompt.ask('Ramo', defaults.branch));
    if (!owner || !repo || !branch) throw new Error('servono proprietario, repository e ramo');

    let email = fromEnv('ADMIN_EMAIL');
    if (email != null && !isEmail(email)) throw new Error('ADMIN_EMAIL non è un’e-mail valida');
    while (email == null) {
      const answer = await prompt.ask('\nE-mail di Tiziana (per entrare)');
      if (isEmail(answer)) email = answer;
      else if (!prompt.interactive) throw new Error(`«${answer}» non è un’e-mail valida`);
      else say('  ✗ non sembra un’e-mail, riprova');
    }
    email = normalizeEmail(email);

    say(`\nOra la password dell’admin (almeno ${MIN_PASSWORD_LENGTH} caratteri), usata solo qui.`);
    say(`Consiglio: 4 parole sono sicure e facili da scrivere sul telefono, per esempio  ${suggestPassphrase()}`);
    let password = fromEnv('ADMIN_PASSWORD');
    if (password != null) {
      const problem = checkPassword(password, email);
      if (problem) throw new Error(`ADMIN_PASSWORD: ${problem}`);
      say('Password: da ADMIN_PASSWORD');
    }
    while (password == null) {
      const first = await prompt.askHidden('Password (nascosta, poi Invio)');
      const problem = checkPassword(first, email);
      if (problem) {
        if (!prompt.interactive) throw new Error(problem);
        say(`  ✗ ${problem}`);
        continue;
      }
      const again = await prompt.askHidden('Ripeti la password');
      if (again !== first) {
        if (!prompt.interactive) throw new Error('le due password non sono uguali');
        say('  ✗ le due password non sono uguali, riprova');
        continue;
      }
      password = first;
    }

    say('\nToken «fine-grained»: github.com → Settings → Developer settings → Fine-grained tokens,');
    say(`solo il repository ${owner}/${repo}, permessi «Contents: Read and write» e «Actions: Read».`);
    let token = fromEnv('ADMIN_TOKEN')?.trim() ?? null;
    for (let attempt = 1; ; attempt++) {
      if (token == null) token = (await prompt.askHidden('Incolla il token (nascosto, poi Invio)')).trim();
      const tokenProblem = checkToken(token);
      if (tokenProblem) throw new Error(tokenProblem);
      if (args.skipVerify) {
        say('Controllo del token saltato (--skip-verify).');
        break;
      }
      output.write('Controllo il token con GitHub… ');
      const result = await verifyToken({ owner, repo, branch, token, api: args.api, fetch });
      say(result.ok ? 'OK' : 'PROBLEMA');
      for (const n of result.notes) say(`  nota: ${n}`);
      if (result.ok) break;
      for (const p of result.problems) say(`  ✗ ${p}`);
      if (!prompt.interactive || fromEnv('ADMIN_TOKEN') || attempt >= 3) {
        throw new Error('controllo del token non riuscito (correggi, oppure riprova con --skip-verify)');
      }
      say('Riprova con un altro token (Ctrl-C per smettere).');
      token = null;
    }

    const exists = await access(args.out).then(() => true, () => false);
    if (exists && !args.force) {
      let answer = '';
      try {
        answer = await prompt.ask(`\n${path.relative(rootDir, args.out)} esiste già. Sovrascrivo? (s/N)`);
      } catch {
        answer = '';
      }
      if (!/^s(i|ì)?$/i.test(answer)) throw new Error('non ho scritto niente (usa --force per sovrascrivere)');
    }

    output.write('\nCifro (ci vuole un secondo)… ');
    const auth = encryptAuth({ owner, repo, branch, email, password, token });
    decryptAuth(auth, email, password); // self-check
    await mkdir(path.dirname(args.out), { recursive: true });
    await writeFile(args.out, `${JSON.stringify(auth, null, 2)}\n`);
    say('fatto.\n');

    const rel = path.relative(rootDir, args.out) || args.out;
    say(`Scritto: ${rel}  (${owner}/${repo}, ramo ${branch}; e-mail e password NON sono salvate)\n`);
    say('Prossimi passi:');
    say(`  1. Pubblica il file:  git add ${rel} && git commit -m "admin: configura accesso" && git push`);
    say('  2. Dopo la pubblicazione (circa 2 minuti) Tiziana entra da <sito>/admin/ con e-mail e password.');
    say('  3. Non scrivere mai la password in chat o per e-mail: dilla a voce. Per cambiarla rifai questa procedura.');
    say('  4. I token scadono: prima della scadenza creane uno nuovo e rifai questa procedura (o usa /admin/setup/).');
    say('  5. Se il token finisce in mani sbagliate: revocalo subito su GitHub e rifai la procedura.');
    return { out: args.out, auth };
  } finally {
    prompt.close();
  }
}

/** True when this file is run directly, false when imported by tests. */
function isMainModule() {
  try {
    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isMainModule()) {
  runSetup().catch((err) => {
    console.error(`\nConfigurazione interrotta: ${err.message}`);
    process.exitCode = 1;
  });
}
