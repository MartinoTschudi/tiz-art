/**
 * UI building blocks: element helper, icons, images with fallbacks, bottom sheets, toasts,
 * the blocking progress overlay and the bars. Text is always set with textContent / DOM nodes
 * (never innerHTML), so data from the repository cannot inject HTML.
 */

/* ---------- DOM ---------- */

/**
 * Creates an element. props: class, text, dataset, onClick/onInput/… (listeners), value/checked
 * (set as properties), any other key → attribute (true → empty attribute; null/false → skipped).
 */
export function h(tag, props, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props || {})) {
    if (value == null || value === false) continue;
    if (key === 'class') el.className = value;
    else if (key === 'text') el.textContent = value;
    else if (key === 'dataset') Object.assign(el.dataset, value);
    else if (key.startsWith('on') && typeof value === 'function') el.addEventListener(key.slice(2).toLowerCase(), value);
    else if (key === 'value' || key === 'checked') continue; // properties, set after the children
    else el.setAttribute(key, value === true ? '' : String(value));
  }
  append(el, children);
  if (props && props.value != null) el.value = props.value;
  if (props && props.checked) el.checked = true;
  return el;
}

/** Appends children, skipping null/false and flattening arrays. */
export function append(el, children) {
  for (const child of children.flat(Infinity)) {
    if (child == null || child === false) continue;
    el.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return el;
}

/* ---------- icons (inline SVG, stroke = currentColor) ---------- */

const ICONS = {
  camera: '<path d="M4 8.5h3.2L9 6h6l1.8 2.5H20v10.5H4z"/><circle cx="12" cy="13.5" r="3.4"/>',
  gallery: '<rect x="3.5" y="4.5" width="17" height="15" rx="2"/><circle cx="9" cy="10" r="1.8"/><path d="M20.5 16l-5-5-8.5 8.5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  close: '<path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/>',
  back: '<path d="M15 5l-7 7 7 7"/>',
  chevron: '<path d="M9 5l7 7-7 7"/>',
  up: '<path d="M12 19V5M5.5 11.5L12 5l6.5 6.5"/>',
  down: '<path d="M12 5v14M5.5 12.5L12 19l6.5-6.5"/>',
  reorder: '<path d="M8 4v16M4.5 7.5L8 4l3.5 3.5M16 20V4M12.5 16.5L16 20l3.5-3.5"/>',
  refresh: '<path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3M19.5 4.5v4.5H15"/>',
  logout: '<path d="M14 4.5h5v15h-5M10 8l-4 4 4 4M6 12h10"/>',
  external: '<path d="M13.5 4.5h6v6M19.5 4.5l-8.5 8.5M17.5 13.5v6h-13v-13h6"/>',
  star: '<path d="M12 4.5l2.3 4.7 5.2.8-3.8 3.6.9 5.1-4.6-2.4-4.6 2.4.9-5.1-3.8-3.6 5.2-.8z"/>',
  eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/>',
  eyeOff: '<path d="M4 4l16 16M10 6a9.6 9.6 0 0 1 2-.5c6 0 9.5 6.5 9.5 6.5a16 16 0 0 1-2.6 3.3M6.6 7.6A15.6 15.6 0 0 0 2.5 12S6 18.5 12 18.5a9 9 0 0 0 4.2-1"/>',
  trash: '<path d="M4.5 7h15M9.5 7V4.5h5V7M6.5 7l1 12.5h9l1-12.5M10 10.5v6M14 10.5v6"/>',
  user: '<circle cx="12" cy="8.5" r="3.8"/><path d="M4.5 20c.8-4 3.8-6.2 7.5-6.2s6.7 2.2 7.5 6.2"/>',
  frame: '<rect x="4" y="3.5" width="16" height="17" rx="1"/><rect x="7.5" y="7" width="9" height="10"/>',
  alert: '<path d="M12 4l9 16H3z"/><path d="M12 10v4.5M12 17.2v.3"/>',
};

export function icon(name, className = 'icon') {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('class', className);
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  svg.innerHTML = ICONS[name] || ''; // static markup defined above, never data
  return svg;
}

/* ---------- images ---------- */

/**
 * <div class="…"> with an <img> that tries `sources` in order (e.g. the site's thumbnail, then the
 * raw file on GitHub) and shows a quiet placeholder when none loads.
 */
export function picture(sources, { className = 'thumb', alt = '', eager = false } = {}) {
  const wrap = h('div', { class: `${className} is-loading` });
  const list = sources.filter(Boolean);
  const empty = () => {
    wrap.classList.remove('is-loading');
    wrap.classList.add('is-empty');
    wrap.replaceChildren(icon('frame'));
  };
  if (!list.length) {
    empty();
    return wrap;
  }
  let i = 0;
  const img = h('img', { alt, decoding: 'async', loading: eager ? 'eager' : 'lazy', draggable: 'false' });
  img.addEventListener('load', () => wrap.classList.remove('is-loading'));
  img.addEventListener('error', () => {
    i += 1;
    if (i < list.length) img.src = list[i];
    else empty();
  });
  img.src = list[0];
  wrap.append(img);
  return wrap;
}

/* ---------- bottom sheets (instead of confirm() / alert()) ---------- */

let sheetSeq = 0;

function openSheet({ title, text, buttons }) {
  return new Promise((resolve) => {
    const id = `sheet-title-${++sheetSeq}`;
    const previousFocus = document.activeElement;
    let closed = false;
    const close = (value) => {
      if (closed) return;
      closed = true;
      document.removeEventListener('keydown', onKey);
      overlay.classList.remove('is-open');
      setTimeout(() => overlay.remove(), 220);
      if (previousFocus && previousFocus.focus) previousFocus.focus({ preventScroll: true });
      resolve(value);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') close(false);
    };
    const buttonEls = buttons.map((b) =>
      h('button', { type: 'button', class: `btn btn-block ${b.className}`, onClick: () => close(b.value) }, b.icon ? icon(b.icon) : null, b.label),
    );
    const overlay = h(
      'div',
      { class: 'sheet-overlay', onClick: (e) => e.target === overlay && close(false) },
      h(
        'div',
        { class: 'sheet', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': id },
        h('div', { class: 'sheet-handle', 'aria-hidden': 'true' }),
        h('h2', { class: 'sheet-title', id }, title),
        text ? h('p', { class: 'sheet-text' }, text) : null,
        h('div', { class: 'sheet-actions' }, buttonEls),
      ),
    );
    document.body.append(overlay);
    document.addEventListener('keydown', onKey);
    requestAnimationFrame(() => overlay.classList.add('is-open'));
    buttonEls[0].focus({ preventScroll: true });
  });
}

/** In-page confirmation. Resolves true / false. */
export function confirmSheet({ title, text, confirmLabel, cancelLabel = 'Annulla', danger = false }) {
  return openSheet({
    title,
    text,
    buttons: [
      { label: confirmLabel, value: true, className: danger ? 'btn-danger' : 'btn-primary', icon: danger ? 'trash' : null },
      { label: cancelLabel, value: false, className: 'btn-secondary' },
    ],
  });
}

/**
 * Error message with "Riprova" and "Chiudi" (or only "Ho capito" when `canRetry` is false).
 * Resolves true when she chose "Riprova".
 */
export function errorSheet({ title = 'Qualcosa non ha funzionato', text, canRetry = true }) {
  const buttons = canRetry
    ? [
        { label: 'Riprova', value: true, className: 'btn-primary', icon: 'refresh' },
        { label: 'Chiudi', value: false, className: 'btn-secondary' },
      ]
    : [{ label: 'Ho capito', value: false, className: 'btn-primary' }];
  return openSheet({ title, text, buttons });
}

/* ---------- toast ---------- */

export function toast(message, { type = 'info', duration = 4000 } = {}) {
  let host = document.querySelector('.toasts');
  if (!host) {
    host = h('div', { class: 'toasts', role: 'status', 'aria-live': 'polite' });
    document.body.append(host);
  }
  const el = h('div', { class: `toast toast-${type}` }, message);
  host.append(el);
  requestAnimationFrame(() => el.classList.add('is-open'));
  setTimeout(() => {
    el.classList.remove('is-open');
    setTimeout(() => el.remove(), 250);
  }, duration);
}

/* ---------- blocking progress overlay ("Carico… 1/3") ---------- */

let progressEl = null;

export const progress = {
  /** @param {string} text  @param {number|null} [fraction] 0..1, null = indeterminate */
  show(text, fraction = null) {
    if (!progressEl) {
      progressEl = h(
        'div',
        { class: 'progress-overlay', role: 'alertdialog', 'aria-modal': 'true', 'aria-live': 'assertive', 'aria-label': 'Salvataggio in corso' },
        h(
          'div',
          { class: 'progress-box' },
          h('div', { class: 'spinner', 'aria-hidden': 'true' }),
          h('p', { class: 'progress-text' }),
          h('div', { class: 'progress-bar' }, h('span')),
          h('p', { class: 'progress-hint' }, 'Non chiudere questa pagina.'),
        ),
      );
      document.body.append(progressEl);
    }
    progressEl.querySelector('.progress-text').textContent = text;
    const bar = progressEl.querySelector('.progress-bar');
    bar.hidden = fraction == null;
    if (fraction != null) bar.firstChild.style.width = `${Math.round(Math.min(1, Math.max(0, fraction)) * 100)}%`;
  },
  hide() {
    if (progressEl) progressEl.remove();
    progressEl = null;
  },
};

/* ---------- bars ---------- */

/** Top bar: optional back button, title (+ small line above it), optional actions on the right. */
export function topbar({ title, subtitle, onBack, backLabel = 'Indietro', actions = [] }) {
  return h(
    'header',
    { class: 'topbar' },
    onBack ? h('button', { type: 'button', class: 'icon-btn', 'aria-label': backLabel, onClick: onBack }, icon('back')) : null,
    h(
      'div',
      { class: 'topbar-titles' },
      subtitle ? h('p', { class: 'topbar-sub' }, subtitle) : null,
      h('h1', { class: 'topbar-title' }, title),
    ),
    actions,
  );
}

/** Fixed bottom bar for the main action (reachable with the thumb). */
export function stickyBar(...children) {
  return h('div', { class: 'sticky-bar' }, h('div', { class: 'sticky-inner' }, children));
}

/** Runs `task` while `button` shows a busy label; restores it afterwards. */
export async function busy(button, label, task) {
  const original = [...button.childNodes];
  button.disabled = true;
  button.classList.add('is-busy');
  button.textContent = label;
  try {
    return await task();
  } finally {
    button.disabled = false;
    button.classList.remove('is-busy');
    button.replaceChildren(...original);
  }
}
