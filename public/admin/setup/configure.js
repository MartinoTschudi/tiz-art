/**
 * What the setup page does, without the DOM (so tests can run it against the mock API):
 *   1. check the token: GET /repos/{owner}/{repo} must say permissions.push = true, the branch must exist
 *   2. encrypt it with e-mail + password (crypto.js, same format as scripts/admin-setup.mjs)
 *   3. commit public/admin/auth.json to the branch WITH THAT SAME TOKEN
 */
import { encryptAuth, decryptAuth } from '../js/crypto.js';
import { GitHubClient } from '../js/github.js';

export const AUTH_PATH = 'public/admin/auth.json';
export const COMMIT_MESSAGE = 'admin: configura accesso';

/** Problem found while checking the token (message for Martino, in Italian). */
export class SetupError extends Error {
  constructor(message) {
    super(message);
    this.name = 'SetupError';
  }
}

/** GitHub error → what Martino should do. */
function explain(err, { owner, repo, branch }) {
  switch (err.kind) {
    case 'auth':
      return new SetupError('Il token non è valido o è scaduto: creane uno nuovo su GitHub.');
    case 'forbidden':
      return new SetupError('Il token non ha i permessi necessari: serve «Contents: Read and write» su questo repository.');
    case 'notfound':
      return new SetupError(`Non trovo ${owner}/${repo} (ramo «${branch}»), oppure il token non ha accesso a questo repository.`);
    default:
      return err;
  }
}

/**
 * @param {{owner: string, repo: string, branch: string, token: string, email: string, password: string,
 *          apiBase?: string, iterations?: number, fetchImpl?: Function, onStep?: (text: string) => void}} input
 * @returns {Promise<{commitSha: string, notes: string[]}>}
 */
export async function configure({ owner, repo, branch, token, email, password, apiBase, iterations, fetchImpl, onStep = () => {} }) {
  const gh = new GitHubClient({ owner, repo, branch, token, apiBase }, { fetchImpl });
  const notes = [];

  onStep('Controllo il token…');
  let info;
  try {
    info = await gh.getRepo();
    await gh.getHead(); // the branch exists (and the repository is not empty)
  } catch (err) {
    throw explain(err, { owner, repo, branch });
  }
  if (!info.permissions || info.permissions.push !== true) {
    throw new SetupError('Il token può solo leggere: serve il permesso «Contents: Read and write».');
  }
  try {
    await gh.latestRun('deploy.yml');
  } catch (err) {
    if (err.kind === 'forbidden') notes.push('Il token non può leggere GitHub Actions: l’admin non mostrerà lo stato della pubblicazione (aggiungi «Actions: Read-only»).');
    else if (err.kind === 'notfound') notes.push('Il flusso deploy.yml non esiste ancora: lo stato della pubblicazione apparirà quando ci sarà.');
    else throw err;
  }

  onStep('Cifro la chiave…');
  const auth = await encryptAuth({ token }, email, password, { owner, repo, branch, iterations });
  await decryptAuth(auth, email, password); // self-check before publishing anything

  onStep('Salvo l’accesso nel repository…');
  let result;
  try {
    result = await gh.commit({
      prepare: () => ({ message: COMMIT_MESSAGE, files: [{ path: AUTH_PATH, text: `${JSON.stringify(auth, null, 2)}\n` }] }),
    });
  } catch (err) {
    throw explain(err, { owner, repo, branch });
  }
  return { commitSha: result.commitSha, notes };
}
