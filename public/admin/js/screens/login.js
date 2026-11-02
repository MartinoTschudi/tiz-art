/**
 * Screens shown before login: "Accedi", "not configured yet" and a generic message with one
 * action (e.g. no connection → "Riprova").
 */
import { h, icon, busy } from '../ui.js';

/** Icon, a heading and an optional small line under it. */
function brand({ title = 'TIZ Admin', sub = '', heading = 'p' } = {}) {
  return h(
    'div',
    { class: 'login-brand' },
    h('img', { class: 'login-logo', src: './icons/icon-192.png', alt: '', width: '96', height: '96' }),
    h(heading, { class: 'login-wordmark' }, title),
    sub ? h('p', { class: 'login-sub' }, sub) : null,
  );
}

/**
 * E-mail + password. A real <form> with autocomplete="username" / "current-password", so the
 * phone's password manager (iCloud Keychain, Google) offers to save and fill it.
 * @param {object} app  app API (login)
 * @param {{message?: string, email?: string}} [opts]  email = last e-mail used on this device
 */
export function renderLogin(app, { message = '', email = '' } = {}) {
  const error = h('p', { class: 'field-error', id: 'login-error', role: 'alert', hidden: true });
  const emailInput = h('input', {
    id: 'email', name: 'email', type: 'email', class: 'input', required: true,
    autocomplete: 'username', inputmode: 'email', autocapitalize: 'off', autocorrect: 'off', spellcheck: 'false',
    enterkeyhint: 'next', value: email,
  });
  const pwInput = h('input', {
    id: 'password', name: 'password', type: 'password', class: 'input', required: true,
    autocomplete: 'current-password', autocapitalize: 'off', autocorrect: 'off', spellcheck: 'false', enterkeyhint: 'go',
  });
  const toggle = h('button', { type: 'button', class: 'pw-toggle', 'aria-label': 'Mostra la password', 'aria-controls': 'password' }, icon('eye'));
  toggle.addEventListener('click', () => {
    const show = pwInput.type === 'password';
    pwInput.type = show ? 'text' : 'password';
    toggle.replaceChildren(icon(show ? 'eyeOff' : 'eye'));
    toggle.setAttribute('aria-label', show ? 'Nascondi la password' : 'Mostra la password');
    pwInput.focus();
  });
  const submit = h('button', { type: 'submit', class: 'btn btn-primary btn-block' }, 'Entra');
  const form = h(
    'form',
    { class: 'card login-form', method: 'post', novalidate: true, 'aria-describedby': 'login-error' },
    h('div', { class: 'field-row' }, h('label', { for: 'email', class: 'label' }, 'E-mail'), emailInput),
    h('div', { class: 'field-row' }, h('label', { for: 'password', class: 'label' }, 'Password'), h('div', { class: 'pw-row' }, pwInput, toggle)),
    error,
    submit,
  );
  const showError = (text, field) => {
    error.textContent = text;
    error.hidden = false;
    if (field) field.focus();
  };
  // "Avanti" on the e-mail goes on to the password; it does not submit an empty password (no red error).
  emailInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.isComposing && !pwInput.value) {
      e.preventDefault();
      pwInput.focus();
    }
  });
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    error.hidden = true;
    if (!emailInput.value.trim()) return showError('Scrivi la tua e-mail.', emailInput);
    if (!pwInput.value) return showError('Scrivi la password.', pwInput);
    try {
      await busy(submit, 'Verifico…', () => app.login(emailInput.value, pwInput.value));
    } catch (err) {
      showError(err.message || 'Accesso non riuscito. Riprova.');
      if (err.code === 'BAD_CREDENTIALS') pwInput.select();
    }
  });
  const el = h(
    'main',
    { class: 'screen screen-login' },
    brand({ title: 'Ciao Tiziana!', sub: 'TIZ · Admin del sito', heading: 'h1' }),
    message ? h('p', { class: 'notice notice-warn', role: 'alert' }, message) : null,
    form,
  );
  setTimeout(() => (email ? pwInput : emailInput).focus(), 50);
  return { el, name: 'login' };
}

/**
 * auth.json is missing: the owner has to run the setup page once. The link to it is for Martino:
 * small, and in a new tab (inside the Home-Screen app the setup page would have no way back).
 */
export function renderNotConfigured(app, { setupUrl, problem = '' }) {
  const el = h(
    'main',
    { class: 'screen screen-login' },
    brand(),
    h(
      'div',
      { class: 'card' },
      h('h1', { class: 'card-title' }, 'L’admin non è ancora configurato'),
      h('p', {}, problem || 'L’accesso non è ancora pronto. Chiedi a Martino di completare la configurazione.'),
    ),
    h('button', { type: 'button', class: 'btn btn-primary btn-block', onClick: () => location.reload() }, icon('refresh'), 'Riprova'),
    h('p', { class: 'setup-link' },
      h('a', { href: setupUrl, target: '_blank', rel: 'noopener' }, 'Pagina di configurazione (per Martino)')),
  );
  return { el, name: 'not-configured' };
}

/** Full-screen message with one action (e.g. no connection → "Riprova"). */
export function renderMessage({ title, text, actionLabel = 'Riprova', onAction }) {
  const el = h(
    'main',
    { class: 'screen screen-login' },
    brand(),
    h('div', { class: 'card' }, h('h1', { class: 'card-title' }, title), text ? h('p', {}, text) : null),
    onAction ? h('button', { type: 'button', class: 'btn btn-primary btn-block', onClick: onAction }, icon('refresh'), actionLabel) : null,
  );
  return { el, name: 'message' };
}
