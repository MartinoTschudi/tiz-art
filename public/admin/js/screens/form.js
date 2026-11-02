/**
 * "Nuova opera" / "Modifica opera": one scrolling form.
 *   Foto (1–8) · Titolo · Anno · Misure · Tecnica · Collezione · Testo · In evidenza · Visibile
 * plus, when editing, "Vedi sul sito" and "Elimina opera".
 *
 * The form state is a "draft" object. For a new work the app keeps it in memory and in IndexedDB
 * (drafts.js), so it survives going back, a reload or the phone closing the page.
 */
import { h, icon, topbar, stickyBar, confirmSheet, toast, progress } from '../ui.js';
import { MAX_IMMAGINI, LIMITS, parseOperaForm, formatNumber } from '../model.js';
import { existingPhoto, readyPhoto, newPhoto, releasePhoto, toSavePhoto, photosReady } from '../photos.js';
import { pickerButtons, photoMedia } from './photo-ui.js';

const FIELD_ORDER = ['foto', 'titolo', 'anno', 'larghezza', 'altezza', 'tecnica', 'collezione', 'testo'];

/** Form model for an existing work ({ slug, data }) or a new one (null). */
export function createDraft(opera) {
  const d = opera ? opera.data : null;
  return {
    slug: opera ? opera.slug : null,
    fields: {
      titolo: d ? d.titolo : '',
      anno: d ? (d.anno == null ? '' : String(d.anno)) : String(new Date().getFullYear()),
      larghezza: d && d.larghezza != null ? formatNumber(d.larghezza) : '',
      altezza: d && d.altezza != null ? formatNumber(d.altezza) : '',
      tecnica: d ? d.tecnica : '',
      collezione: d ? d.collezione : '',
      testo: d ? d.testo : '',
      inEvidenza: d ? d.inEvidenza : false,
      pubblicata: d ? d.pubblicata : true,
    },
    photos: d ? d.immagini.map(existingPhoto) : [],
    onPhotosChange: null,
  };
}

/** New-work draft restored from IndexedDB. */
export function draftFromStored(stored) {
  const draft = createDraft(null);
  Object.assign(draft.fields, stored.fields);
  draft.photos = (stored.photos || []).filter((p) => p && p.blob && p.preview).map(readyPhoto);
  return draft;
}

/** What is stored in IndexedDB for a new work (only photos already prepared). */
export function draftToStored(draft) {
  return {
    fields: { ...draft.fields },
    photos: draft.photos.filter((p) => p.kind === 'new' && p.status === 'ready').map((p) => p.result),
  };
}

/** True when a new-work draft contains something worth keeping. */
export function draftHasContent(draft) {
  if (!draft) return false;
  const f = draft.fields;
  return Boolean(
    draft.photos.length || f.titolo.trim() || f.larghezza.trim() || f.altezza.trim() || f.tecnica.trim() ||
      f.collezione.trim() || f.testo.trim(),
  );
}

/** Frees the memory of the photos of a draft that is thrown away. */
export function releaseDraft(draft) {
  if (!draft) return;
  draft.photos.forEach(releasePhoto);
  draft.photos = [];
  draft.onPhotosChange = null;
}

/** Sorted distinct non-empty values of a field over all works (for the suggestions). */
function suggestions(opere, key) {
  return [...new Set(opere.map((o) => (o.data[key] || '').trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'it'));
}

/**
 * @param {object} app   app API: state, store, back, onSaved, handleError, persistDraft, discardDraft, rerender
 * @param {{opera: {slug: string, data: object}|null, draft: object, restored?: boolean}} opts
 */
export function renderForm(app, { opera, draft, restored = false }) {
  const isNew = !opera;
  const opere = app.state.data.opere;
  const errorEls = {};
  const sections = {};

  /* ---------- helpers ---------- */

  const changed = () => {
    if (isNew) app.persistDraft();
  };

  function showError(name, message) {
    const el = errorEls[name];
    if (!el) return;
    el.textContent = message || '';
    el.hidden = !message;
    sections[name].classList.toggle('has-error', Boolean(message));
  }

  function errorEl(name) {
    errorEls[name] = h('p', { class: 'field-error', id: `err-${name}`, role: 'alert', hidden: true });
    return errorEls[name];
  }

  /** <section> for one field: label, optional hint, control (+ `after`, e.g. a counter), error line. */
  function field(name, label, control, { hint = '', optional = false, after = null } = {}) {
    control.setAttribute('aria-describedby', `err-${name}${hint ? ` hint-${name}` : ''}`);
    sections[name] = h(
      'section',
      { class: 'field', id: `field-${name}` },
      h('label', { class: 'label', for: control.id }, label, optional ? h('small', {}, ' (facoltativo)') : null),
      hint ? h('p', { class: 'hint', id: `hint-${name}` }, hint) : null,
      control,
      after,
      errorEl(name),
    );
    return sections[name];
  }

  function textInput(name, attrs = {}) {
    const input = h('input', { id: `in-${name}`, name, class: 'input', value: draft.fields[name], ...attrs });
    input.addEventListener('input', () => {
      draft.fields[name] = input.value;
      showError(name, '');
      changed();
    });
    return input;
  }

  /* ---------- photos ---------- */

  const photoGrid = h('div', { class: 'photo-grid' });
  const photoCount = h('span', { class: 'field-count' });
  const picker = pickerButtons({ multiple: true, onFiles: addFiles });

  function addFiles(files) {
    const room = MAX_IMMAGINI - draft.photos.length;
    if (room <= 0) return toast(`Puoi aggiungere al massimo ${MAX_IMMAGINI} foto.`);
    if (files.length > room) toast(`Al massimo ${MAX_IMMAGINI} foto: ho aggiunto solo le prime ${room}.`);
    for (const file of files.slice(0, room)) {
      draft.photos.push(newPhoto(file, () => draft.onPhotosChange && draft.onPhotosChange()));
    }
    showError('foto', '');
    renderPhotos();
  }

  function removePhoto(photo) {
    releasePhoto(photo);
    draft.photos = draft.photos.filter((p) => p !== photo);
    renderPhotos();
    changed();
  }

  function makeCover(photo) {
    draft.photos = [photo, ...draft.photos.filter((p) => p !== photo)];
    renderPhotos();
    changed();
  }

  function photoTile(photo, index) {
    const n = index + 1;
    const sources = photo.kind === 'existing' ? app.store.operaImageSources(draft.slug, photo.ref) : [];
    return h(
      'div',
      { class: `photo-tile${index === 0 ? ' is-cover' : ''}`, dataset: { key: photo.key } },
      photoMedia(photo, sources, `Foto ${n}`),
      h('button', { type: 'button', class: 'tile-remove', 'aria-label': `Togli la foto ${n}`, onClick: () => removePhoto(photo) }, icon('close')),
      index === 0
        ? h('span', { class: 'tile-badge' }, icon('star'), 'Copertina')
        : h('button', { type: 'button', class: 'tile-cover', 'aria-label': `Usa la foto ${n} come copertina`, onClick: () => makeCover(photo) }, 'Copertina'),
    );
  }

  function renderPhotos() {
    photoGrid.replaceChildren(...draft.photos.map(photoTile));
    photoGrid.hidden = draft.photos.length === 0;
    photoCount.textContent = `${draft.photos.length}/${MAX_IMMAGINI}`;
    picker.setDisabled(draft.photos.length >= MAX_IMMAGINI);
  }
  draft.onPhotosChange = () => {
    renderPhotos();
    changed();
  };

  sections.foto = h(
    'section',
    { class: 'field', id: 'field-foto' },
    h('h2', { class: 'label' }, 'Foto ', photoCount),
    h('p', { class: 'hint' }, 'Da 1 a 8 foto. La prima è la copertina: con «Copertina» scegli un’altra foto.'),
    picker.el,
    photoGrid,
    errorEl('foto'),
  );

  /* ---------- fields ---------- */

  const titolo = textInput('titolo', { maxlength: String(LIMITS.titolo), autocapitalize: 'sentences', enterkeyhint: 'next', required: true });
  const anno = textInput('anno', { inputmode: 'numeric', pattern: '[0-9]*', maxlength: '4', autocomplete: 'off', enterkeyhint: 'next' });
  const larghezza = textInput('larghezza', { inputmode: 'decimal', autocomplete: 'off', enterkeyhint: 'next', placeholder: 'es. 100' });
  const altezza = textInput('altezza', { inputmode: 'decimal', autocomplete: 'off', enterkeyhint: 'next', placeholder: 'es. 140' });
  const tecnica = textInput('tecnica', { list: 'list-tecnica', maxlength: String(LIMITS.tecnica), autocapitalize: 'sentences', placeholder: 'es. Acrilico su tela' });
  const collezione = textInput('collezione', { list: 'list-collezione', maxlength: String(LIMITS.collezione), placeholder: 'es. noi, DONNA.' });
  const testo = h('textarea', { id: 'in-testo', name: 'testo', class: 'input', rows: '7', maxlength: String(LIMITS.testo), value: draft.fields.testo });
  const testoCount = h('p', { class: 'char-count', 'aria-live': 'polite' });
  const updateCount = () => {
    testoCount.textContent = `${draft.fields.testo.length}/${LIMITS.testo}`;
  };
  testo.addEventListener('input', () => {
    draft.fields.testo = testo.value;
    showError('testo', '');
    updateCount();
    changed();
  });
  updateCount();

  const datalist = (id, values) => h('datalist', { id }, values.map((v) => h('option', { value: v })));

  function toggle(name, label, hint) {
    const input = h('input', { type: 'checkbox', role: 'switch', class: 'switch', id: `in-${name}`, checked: draft.fields[name] });
    input.addEventListener('change', () => {
      draft.fields[name] = input.checked;
      changed();
    });
    return h(
      'label',
      { class: 'switch-row', for: `in-${name}` },
      h('span', { class: 'switch-text' }, h('span', { class: 'switch-label' }, label), h('span', { class: 'hint' }, hint)),
      input,
    );
  }

  const misure = h(
    'section',
    { class: 'field' },
    h('h2', { class: 'label' }, 'Misure in cm ', h('small', {}, '(facoltative)')),
    h('p', { class: 'hint' }, 'Larghezza × altezza, per esempio 100 e 140. Si vedono sul sito solo se ci sono tutte e due.'),
    h(
      'div',
      { class: 'two-cols' },
      field('larghezza', 'Larghezza', larghezza),
      field('altezza', 'Altezza', altezza),
    ),
  );

  /* ---------- validation & change detection ---------- */

  function validate() {
    const { fields, errors } = parseOperaForm(draft.fields);
    if (!draft.photos.length) errors.foto = 'Aggiungi almeno una foto.';
    else if (draft.photos.some((p) => p.status === 'error')) errors.foto = 'Una foto non si può usare: toglila con ×.';
    for (const name of FIELD_ORDER) showError(name, errors[name] || '');
    const first = FIELD_ORDER.find((n) => errors[n]);
    if (first) {
      sections[first].scrollIntoView({ behavior: 'smooth', block: 'center' });
      const input = sections[first].querySelector('input:not([type=file]), textarea');
      if (input) input.focus({ preventScroll: true });
      return null;
    }
    return fields;
  }

  function isDirty() {
    if (isNew) return false; // a new work is kept as a draft
    const { fields } = parseOperaForm(draft.fields);
    if (!fields) return true;
    const d = opera.data;
    const changedField = Object.keys(fields).some((k) => fields[k] !== d[k]);
    const refs = draft.photos.map((p) => (p.kind === 'existing' ? p.ref : p.key));
    return changedField || refs.join('|') !== d.immagini.join('|');
  }

  /* ---------- save / delete ---------- */

  function onProgress(ev) {
    if (ev.phase === 'upload' && ev.total) progress.show(`Carico le foto… ${ev.done}/${ev.total}`, ev.done / ev.total);
    else if (ev.phase === 'commit') progress.show('Pubblico…');
  }

  async function runSave(fields) {
    try {
      const ok = await photosReady(draft.photos, (done, total) => progress.show(`Preparo le foto… ${done}/${total}`, done / total));
      if (!ok) {
        progress.hide();
        validate();
        return;
      }
      progress.show('Carico…');
      const result = await app.store.saveOpera({ slug: draft.slug, fields, photos: draft.photos.map(toSavePhoto) }, onProgress);
      progress.hide();
      app.onSaved(result);
    } catch (err) {
      progress.hide();
      app.handleError(err, () => runSave(fields));
    }
  }

  async function save() {
    const fields = validate();
    if (!fields) return;
    if (!isNew && !isDirty()) return toast('Nessuna modifica da salvare.');
    await runSave(fields);
  }

  async function runDelete() {
    try {
      progress.show('Elimino…');
      const result = await app.store.deleteOpera(opera.slug, () => {});
      progress.hide();
      app.onSaved(result);
    } catch (err) {
      progress.hide();
      app.handleError(err, runDelete);
    }
  }

  async function remove() {
    const ok = await confirmSheet({
      title: `Eliminare «${opera.data.titolo}»?`,
      text: 'L’opera e le sue foto spariranno dal sito e non si potranno recuperare. Se vuoi solo nasconderla per un po’, togli invece «Visibile sul sito».',
      confirmLabel: 'Elimina per sempre',
      danger: true,
    });
    if (ok) await runDelete();
  }

  async function goBack() {
    if (isDirty()) {
      const leave = await confirmSheet({
        title: 'Uscire senza salvare?',
        text: 'Le modifiche a quest’opera andranno perse.',
        confirmLabel: 'Esci senza salvare',
        cancelLabel: 'Continua a modificare',
        danger: false,
      });
      if (!leave) return;
    } else if (isNew && draftHasContent(draft)) {
      toast('Bozza conservata: la ritrovi in «Nuova opera».');
    }
    app.back();
  }

  async function restart() {
    const ok = await confirmSheet({
      title: 'Ricominciare da capo?',
      text: 'Le foto e i testi dell’opera non salvata verranno cancellati.',
      confirmLabel: 'Sì, ricomincia',
    });
    if (ok) app.discardDraft();
  }

  /* ---------- layout ---------- */

  const siteLink =
    !isNew && opera.data.pubblicata
      ? h('a', { class: 'btn btn-ghost btn-small site-link', href: app.env.siteUrl(`opere/${opera.slug}/`), target: '_blank', rel: 'noopener' },
          icon('external'), 'Vedi sul sito')
      : null;

  const el = h(
    'div',
    { class: 'screen' },
    topbar({
      title: isNew ? 'Nuova opera' : opera.data.titolo,
      subtitle: isNew ? 'Le mie opere' : 'Modifica opera',
      onBack: goBack,
      backLabel: 'Torna alle opere',
    }),
    h(
      'main',
      { class: 'content form' },
      restored && draftHasContent(draft)
        ? h('div', { class: 'notice notice-row' },
            h('p', {}, 'Stai continuando un’opera non salvata.'),
            h('button', { type: 'button', class: 'btn btn-secondary btn-small', onClick: restart }, 'Ricomincia'))
        : null,
      siteLink,
      sections.foto,
      field('titolo', h('span', {}, 'Titolo ', h('span', { class: 'required', 'aria-hidden': 'true' }, '*')), titolo),
      field('anno', 'Anno', anno, { optional: true }),
      misure,
      field('tecnica', 'Tecnica', tecnica, { optional: true, hint: 'Scrivi o scegli tra quelle già usate.' }),
      datalist('list-tecnica', suggestions(opere, 'tecnica')),
      field('collezione', 'Collezione', collezione, { optional: true, hint: 'Il nome della serie. Scrivi o scegli tra quelle già usate.' }),
      datalist('list-collezione', suggestions(opere, 'collezione')),
      field('testo', 'Testo', testo, { optional: true, hint: 'Per andare a capo con un nuovo paragrafo lascia una riga vuota.', after: testoCount }),
      h(
        'section',
        { class: 'field toggles' },
        toggle('inEvidenza', 'In evidenza in home', 'Appare nella selezione della pagina iniziale.'),
        toggle('pubblicata', 'Visibile sul sito', 'Se lo togli, l’opera resta salvata qui ma non si vede sul sito.'),
      ),
      isNew
        ? null
        : h('section', { class: 'field danger-zone' },
            h('button', { type: 'button', class: 'btn btn-danger-outline btn-block', onClick: remove }, icon('trash'), 'Elimina opera')),
    ),
    stickyBar(h('button', { type: 'button', class: 'btn btn-primary btn-block btn-xl', onClick: save }, icon('check'), 'Salva')),
  );
  renderPhotos();

  return { el, name: 'form', isDirty };
}
