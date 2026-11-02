/**
 * TIZ Admin — entry point: session, routing, data loading, publish status.
 *
 * How it works (for whoever maintains it):
 *  - There is no server. The "database" is the GitHub repository of the website
 *    (src/content/opere/<slug>/ and src/content/profilo/). The admin reads and writes those files
 *    through the GitHub API with a fine-grained token (store.js, github.js).
 *  - Every save is one commit on the branch; the push starts .github/workflows/deploy.yml, which
 *    rebuilds and publishes the site in 1–3 minutes.
 *  - Login: e-mail + password open auth.json, where the token is encrypted (crypto.js). The
 *    session { owner, repo, branch, token } then stays in localStorage until "Esci".
 *  - Routes live in the #hash, so they work under any base path:
 *      #/ list · #/nuova new work · #/opera/<slug> edit · #/profilo · #/fatto success
 *  - Local development: see env.js (?api=… on localhost) and scripts/dev/admin-dev.mjs.
 */
import { resolveEnv } from './env.js';
import { decryptAuth, isAuthConfig, normalizeEmail } from './crypto.js';
import { isKeyError, KEY_INVALID_MESSAGE } from './github.js';
import { Store, browserCache } from './store.js';
import { loadDraft, saveDraft, clearDraft } from './drafts.js';
import { h, toast, topbar, progress, errorSheet } from './ui.js';
import { renderLogin, renderNotConfigured, renderMessage } from './screens/login.js';
import { renderList } from './screens/list.js';
import { renderForm, createDraft, draftFromStored, draftToStored, draftHasContent, releaseDraft } from './screens/form.js';
import { renderProfile } from './screens/profile.js';
import { renderDone } from './screens/done.js';

const SESSION_KEY = 'tiz-admin:session';
const EMAIL_KEY = 'tiz-admin:email'; // last e-mail used on this device (pre-filled on the login)

const env = resolveEnv(location);
const root = document.getElementById('app');

const state = {
  store: null, // Store once logged in
  authConfig: null, // parsed auth.json
  data: null, // { head, opere, profilo, problems }
  loading: null, // Promise while loading
  loadError: null,
  loadedAt: 0,
  deploy: null, // last publish status
  deployDisabled: false, // the key cannot read Actions → stop asking
  publishingSince: 0, // time of our last save
  lastResult: null, // what the success screen shows
  newDraft: null, // the "Nuova opera" being written
};

let currentView = null;
let deployTimer = null;
let draftTimer = null;

/* ---------- storage (private mode can make it throw) ---------- */

function storageGet(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function storageSet(key, value) {
  try {
    localStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

function storageRemove(key) {
  try {
    localStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}

/** The saved session, only if it belongs to the same API (a dev session never reaches GitHub). */
function readSession() {
  try {
    const s = JSON.parse(storageGet(SESSION_KEY) || 'null');
    return s && s.owner && s.repo && s.token && s.apiBase === env.apiBase ? s : null;
  } catch {
    return null;
  }
}

/* ---------- views ---------- */

function mount(view, { keepScroll = false } = {}) {
  currentView = view;
  root.replaceChildren(view.el);
  if (!keepScroll) window.scrollTo(0, 0);
}

function loadingView(text = 'Un momento…') {
  return {
    el: h('main', { class: 'screen' }, h('div', { class: 'loading loading-full' }, h('div', { class: 'spinner' }), h('p', {}, text))),
    name: 'loading',
  };
}

function errorView(title, text, actionLabel, onAction) {
  return {
    el: h(
      'div',
      { class: 'screen' },
      topbar({ title, onBack: back, backLabel: 'Torna alle opere' }),
      h('main', { class: 'content' },
        h('div', { class: 'card notice-error' }, h('p', {}, text),
          h('button', { type: 'button', class: 'btn btn-secondary btn-block', onClick: onAction }, actionLabel))),
    ),
    name: 'error',
  };
}

/* ---------- history: is there an admin page to go back to? ---------- */

let navIndex = 0;
let replacing = false;

function trackHistory() {
  const st = history.state;
  if (st && typeof st.tizIndex === 'number') navIndex = st.tizIndex;
  else {
    if (!replacing) navIndex += 1;
    history.replaceState({ tizIndex: navIndex }, '');
  }
  replacing = false;
}

function replaceHash(hash) {
  if (location.hash === hash) return route(); // same hash: no hashchange event
  replacing = true;
  location.replace(hash);
}

function back() {
  if (navIndex > 0) history.back();
  else replaceHash('#/');
}

function currentRoute() {
  const parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  return { page: parts[0] || '', arg: parts[1] ? decodeURIComponent(parts[1]) : '' };
}

/* ---------- routing ---------- */

/** Renders once the data is loaded (spinner or error meanwhile). */
function withData(render) {
  if (state.data) return render();
  if (state.loadError && !state.loading) {
    return mount(errorView('Le mie opere', state.loadError.message, 'Riprova', () => loadData().then(route)));
  }
  mount(loadingView('Carico le opere…'));
  const hash = location.hash;
  loadData().then(() => {
    if (location.hash === hash && state.store) route();
  });
}

async function showNewWork() {
  let restored = false;
  if (!state.newDraft) {
    const stored = await loadDraft();
    if (currentRoute().page !== 'nuova' || state.newDraft) return route();
    state.newDraft = stored ? draftFromStored(stored) : createDraft(null);
    restored = Boolean(stored);
  } else {
    restored = draftHasContent(state.newDraft);
  }
  mount(renderForm(app, { opera: null, draft: state.newDraft, restored }));
}

let lastRoutedHash = null;

function route() {
  if (!state.store) return; // the login screens are not routed
  lastRoutedHash = location.hash;
  const { page, arg } = currentRoute();
  if (page === 'fatto') {
    return state.lastResult ? mount(renderDone(app, state.lastResult)) : replaceHash('#/');
  }
  if (page === 'nuova') return withData(showNewWork);
  if (page === 'opera' && arg) {
    return withData(() => {
      const opera = state.data.opere.find((o) => o.slug === arg);
      if (!opera) {
        return mount(errorView('Opera non trovata', 'Quest’opera non c’è più: forse è stata eliminata.', 'Torna alle opere', () => replaceHash('#/')));
      }
      mount(renderForm(app, { opera, draft: createDraft(opera) }));
    });
  }
  if (page === 'profilo') return withData(() => mount(renderProfile(app)));
  mount(renderList(app));
  if (!state.data && !state.loading) loadData();
}

/* ---------- data ---------- */

/** Loads the works and the profile from GitHub. Safe to call repeatedly. */
function loadData({ manual = false } = {}) {
  if (state.loading) return state.loading;
  const store = state.store;
  if (!store) return Promise.resolve();
  state.loadError = null;
  state.loading = store
    .load()
    .then(
      (data) => {
        if (store !== state.store) return;
        state.data = data;
        state.loadedAt = Date.now();
        if (manual) toast('Opere aggiornate.');
      },
      (err) => {
        if (store !== state.store) return;
        if (isKeyError(err)) return expire();
        state.loadError = err;
        if (state.data) toast(`Aggiornamento non riuscito: ${err.message}`, { type: 'error' });
      },
    )
    .finally(() => {
      state.loading = null;
      if (store === state.store && currentView && currentView.update) currentView.update();
    });
  if (currentView && currentView.update) currentView.update();
  return state.loading;
}

/** Loads again after a save; a load already running may have read the branch before the commit. */
function reloadAfterSave() {
  return state.loading ? state.loading.then(() => loadData()) : loadData();
}

/* ---------- publish status (GitHub Actions) ---------- */

async function pollDeploy() {
  clearTimeout(deployTimer);
  const store = state.store;
  if (!store || state.deployDisabled) return;
  let status = null;
  try {
    status = await store.deployStatus();
  } catch (err) {
    if (store !== state.store) return;
    if (err.kind === 'auth') return expire();
    // 403/404: the key may not read Actions, or the workflow does not exist yet → hide quietly.
    if (err.kind === 'forbidden' || err.kind === 'notfound') state.deployDisabled = true;
  }
  if (store !== state.store) return;

  // Right after a save GitHub needs a few seconds to create the new run: until it shows up the
  // latest run is the previous one, so keep showing "in corso".
  if (state.publishingSince && status) {
    const created = Date.parse(status.createdAt || '') || 0;
    const waited = Date.now() - state.publishingSince;
    if (created < state.publishingSince - 30000 && waited < 90000) status = { ...status, state: 'running' };
    else if (status.state !== 'running') state.publishingSince = 0;
  }
  state.deploy = status;
  if (currentView && currentView.onDeploy) currentView.onDeploy(status);
  if (document.visibilityState === 'visible' && !state.deployDisabled) {
    deployTimer = setTimeout(pollDeploy, status && status.state === 'running' ? 8000 : 60000);
  }
}

function markPublishing() {
  if (state.deployDisabled) return; // the key cannot read Actions: no status line at all
  state.publishingSince = Date.now();
  state.deploy = { ...(state.deploy || {}), state: 'running' };
  clearTimeout(deployTimer);
  deployTimer = setTimeout(pollDeploy, 5000);
}

/* ---------- saving (called by the screens) ---------- */

function onSaved(result) {
  if (result.action === 'create') {
    // The photos stay referenced by the store's previews: do not revoke them here.
    if (state.newDraft) state.newDraft.onPhotosChange = null;
    state.newDraft = null;
    clearTimeout(draftTimer);
    clearDraft();
  }
  state.lastResult = result;
  markPublishing();
  reloadAfterSave();
  replaceHash('#/fatto'); // "back" will not return to the submitted form
}

/** Error of a save: the key is gone → login; otherwise explain and offer "Riprova". */
async function handleError(err, retry) {
  if (isKeyError(err)) return expire();
  const again = await errorSheet({
    title: 'Non è stato possibile salvare',
    text: err.message || 'Errore sconosciuto.',
    canRetry: Boolean(retry) && err.kind !== 'store',
  });
  if (again) await retry();
}

/** "Salva l’ordine" of the list. Resolves true when saved. */
async function saveOrder(slugs) {
  for (;;) {
    try {
      progress.show('Salvo l’ordine…');
      await state.store.reorder(slugs);
      progress.hide();
      toast('Ordine salvato: sarà online tra circa 2\u00a0minuti.');
      markPublishing();
      await reloadAfterSave();
      return true;
    } catch (err) {
      progress.hide();
      if (isKeyError(err)) {
        expire();
        return false;
      }
      const again = await errorSheet({ title: 'Ordine non salvato', text: err.message, canRetry: err.kind !== 'store' });
      if (!again) return false;
    }
  }
}

/** Keeps the new-work draft in IndexedDB (debounced). */
function persistDraft() {
  clearTimeout(draftTimer);
  draftTimer = setTimeout(() => {
    const draft = state.newDraft;
    if (!draft) return;
    if (draftHasContent(draft)) saveDraft(draftToStored(draft));
    else clearDraft();
  }, 500);
}

function discardDraft() {
  clearTimeout(draftTimer);
  releaseDraft(state.newDraft);
  state.newDraft = createDraft(null);
  clearDraft();
  mount(renderForm(app, { opera: null, draft: state.newDraft }));
}

/* ---------- login / logout ---------- */

async function fetchAuthConfig() {
  let res;
  try {
    res = await fetch(env.authFile, { cache: 'no-store' });
  } catch {
    throw new Error('Connessione assente: controlla la rete e riprova.');
  }
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Non riesco a leggere la configurazione (errore ${res.status}). Riprova tra poco.`);
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    // a dev server may answer a missing file with an HTML page and status 200
    return text.trim().startsWith('<') ? null : { invalid: true };
  }
  return isAuthConfig(json) ? json : { invalid: true };
}

async function showLogin(message = '') {
  mount(loadingView());
  let config;
  try {
    config = await fetchAuthConfig();
  } catch (err) {
    return mount(renderMessage({ title: 'Connessione assente', text: err.message, onAction: () => showLogin(message) }));
  }
  const setupUrl = `${env.adminBase}setup/index.html${env.query}`;
  if (!config || config.invalid) {
    state.authConfig = null;
    return mount(renderNotConfigured(app, {
      setupUrl,
      problem: config ? 'Il file di accesso è danneggiato. Chiedi a Martino di rifare la configurazione.' : '',
    }));
  }
  state.authConfig = config;
  mount(renderLogin(app, { message, email: storageGet(EMAIL_KEY) || '' }));
}

/**
 * Chrome (Android) shows "Salvare la password?" reliably only when asked through the Credential
 * Management API; Safari (iPhone) offers it by itself after the form submit.
 */
function offerToSavePassword(email, password) {
  try {
    if (typeof window.PasswordCredential !== 'function' || !navigator.credentials) return;
    navigator.credentials.store(new window.PasswordCredential({ id: email, password, name: 'TIZ Admin' })).catch(() => {});
  } catch {
    /* not supported */
  }
}

async function login(email, password) {
  if (!state.authConfig) throw new Error('Configurazione mancante: ricarica la pagina.');
  // Throws "E-mail o password non corretti" for any wrong e-mail or password.
  const opened = await decryptAuth(state.authConfig, email, password);
  const session = { owner: opened.owner, repo: opened.repo, branch: opened.branch, token: opened.token, apiBase: env.apiBase };
  const store = new Store(session, env);
  try {
    await store.verify();
  } catch (err) {
    // The password was right but GitHub refuses the key: only Martino can fix it.
    throw new Error(isKeyError(err) || err.kind === 'notfound' ? KEY_INVALID_MESSAGE : err.message);
  }
  if (!storageSet(SESSION_KEY, JSON.stringify(session))) {
    toast('Questo browser non può ricordare l’accesso: dovrai rifarlo alla prossima apertura.');
  }
  storageSet(EMAIL_KEY, normalizeEmail(email));
  offerToSavePassword(email.trim(), password);
  start(store);
}

function start(store) {
  state.store = store;
  state.deployDisabled = false;
  route();
  if (!state.data) loadData();
  pollDeploy();
}

function resetState() {
  clearTimeout(deployTimer);
  if (state.store) state.store.dispose();
  Object.assign(state, {
    store: null, data: null, loading: null, loadError: null, deploy: null, publishingSince: 0, lastResult: null,
  });
}

/** The key does not work any more: back to the login with the explanation. The draft is kept. */
function expire() {
  storageRemove(SESSION_KEY);
  resetState();
  progress.hide();
  showLogin(KEY_INVALID_MESSAGE);
}

/** "Esci": forgets the session, the cache and the unsaved new work on this device. */
function logout() {
  storageRemove(SESSION_KEY);
  browserCache.clear();
  clearTimeout(draftTimer);
  releaseDraft(state.newDraft);
  state.newDraft = null;
  clearDraft();
  resetState();
  history.replaceState({ tizIndex: 0 }, '', location.pathname + location.search);
  navIndex = 0;
  showLogin();
}

/** API passed to the screens. */
const app = {
  env,
  state,
  get store() {
    return state.store;
  },
  login,
  logout,
  reload: (opts) => loadData(opts),
  back,
  home: () => replaceHash('#/'),
  newWork: () => replaceHash('#/nuova'),
  onSaved,
  handleError,
  saveOrder,
  persistDraft,
  discardDraft,
};

/* ---------- boot ---------- */

function boot() {
  // Never run inside a frame of another site (it could trick taps on "Elimina").
  // GitHub Pages cannot send X-Frame-Options, so the page checks it itself.
  if (window.top !== window.self) {
    root.textContent = 'Apri l’admin direttamente, non dentro un’altra pagina.';
    return;
  }
  if (!history.state || typeof history.state.tizIndex !== 'number') history.replaceState({ tizIndex: 0 }, '');
  navIndex = history.state.tizIndex;

  window.addEventListener('hashchange', () => {
    trackHistory();
    route();
  });
  // Back/forward between two entries with the same #hash fires no "hashchange": route anyway.
  window.addEventListener('popstate', () => {
    if (location.hash === lastRoutedHash) {
      trackHistory();
      route();
    }
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible' || !state.store) return;
    if (Date.now() - state.loadedAt > 60000 && currentView && currentView.name === 'list') loadData();
    pollDeploy();
  });
  window.addEventListener('beforeunload', (e) => {
    if (currentView && currentView.isDirty && currentView.isDirty()) {
      e.preventDefault();
      e.returnValue = '';
    }
  });

  const session = readSession();
  if (session) start(new Store(session, env));
  else showLogin();
}

boot();
