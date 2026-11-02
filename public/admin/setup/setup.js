/**
 * Setup page (for Martino): e-mail + password for Tiziana and a GitHub token → encrypted
 * public/admin/auth.json committed to the repository. Also used to renew the token or change the
 * password (it simply replaces the file).
 */
import { resolveEnv } from '../js/env.js';
import { normalizeEmail } from '../js/crypto.js';
import { busy } from '../js/ui.js';
import { configure } from './configure.js';
import { isEmail, checkPassword, checkToken, suggestPasswordFor } from './rules.js';

const env = resolveEnv(location);
const form = document.getElementById('setup-form');
const status = document.getElementById('setup-status');
const error = document.getElementById('setup-error');
const submit = document.getElementById('setup-submit');
const value = (name) => form.elements[name].value;

document.getElementById('admin-link').href = `../index.html${env.query}`;
document.getElementById('back-link').href = `../index.html${env.query}`;

/* A generated passphrase, like the terminal setup offers: the strongest choice that is still easy to type. */
const suggested = document.getElementById('pw-suggested');
function newSuggestion() {
  suggested.textContent = suggestPasswordFor(value('email'));
}
document.getElementById('pw-new').addEventListener('click', newSuggestion);
document.getElementById('pw-use').addEventListener('click', () => {
  form.elements.password.value = suggested.textContent;
  form.elements.password2.value = suggested.textContent;
  status.textContent = 'Password proposta inserita due volte: annotala per Tiziana.';
});
newSuggestion();
document.getElementById('pw-suggest').hidden = false;

function fail(message, field) {
  error.textContent = message;
  error.hidden = false;
  status.textContent = '';
  if (field) form.elements[field].focus();
}

/** First problem of the form, as [message, field name], or null. */
function problem() {
  if (!isEmail(value('email'))) return ['Scrivi un’e-mail valida.', 'email'];
  const pw = checkPassword(value('password'), value('email'));
  if (pw) return [pw, 'password'];
  if (value('password') !== value('password2')) return ['Le due password non sono uguali.', 'password2'];
  const token = checkToken(value('token'));
  if (token) return [token, 'token'];
  if (!value('owner').trim() || !value('repo').trim() || !value('branch').trim()) {
    form.querySelector('details').open = true;
    return ['Compila proprietario, repository e ramo.', 'owner'];
  }
  return null;
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  error.hidden = true;
  const invalid = problem();
  if (invalid) return fail(...invalid);
  try {
    const { notes } = await busy(submit, 'Configuro…', () =>
      configure({
        owner: value('owner').trim(),
        repo: value('repo').trim(),
        branch: value('branch').trim(),
        token: value('token').trim(),
        email: normalizeEmail(value('email')),
        password: value('password'),
        apiBase: env.apiBase,
        onStep: (text) => {
          status.textContent = text;
        },
      }),
    );
    form.hidden = true;
    document.getElementById('setup-intro').hidden = true;
    const list = document.getElementById('setup-notes');
    list.replaceChildren(...notes.map((n) => Object.assign(document.createElement('li'), { textContent: n })));
    document.getElementById('setup-done').hidden = false;
    window.scrollTo(0, 0);
  } catch (err) {
    fail(err.message || 'Configurazione non riuscita. Riprova.');
  }
});
