/**
 * "Nuova opera" / "Modifica opera": one scrolling form.
 *   Foto (1–8, each new one with «Raddrizza») · Titolo · Anno · Misure · Tecnica · Collezione · Colore della pennellata · Testo ·
 *   In evidenza · Visibile
 * plus, when editing, "Vedi sul sito" and "Elimina opera".
 *
 * The form state is a "draft" object. For a new work the app keeps it in memory and in IndexedDB
 * (drafts.js), so it survives going back, a reload or the phone closing the page. Unsaved changes
 * to an existing work are kept in IndexedDB too (app.persistEdit) and offered again when the work is
 * reopened: a back swipe, a reload or an expired key never throws them away.
 */
import { h, icon, topbar, stickyBar, confirmSheet, toast, progress, siteButton } from '../ui.js';
import { MAX_IMMAGINI, LIMITS, COLORI, parseOperaForm, parseMisura, formatNumber } from '../model.js';
import { workKey } from '../drafts.js';
import { existingPhoto, readyPhoto, newPhoto, releasePhoto, toSavePhoto, photosReady, canStraighten, isStraightened, restoreWhole } from '../photos.js';
import { pickerButtons, photoMedia } from './photo-ui.js';
import { straightenScreen } from './straighten-ui.js';

const FIELD_ORDER = ['foto', 'titolo', 'anno', 'larghezza', 'altezza', 'tecnica', 'collezione', 'colore', 'testo'];

/** Choices of «Colore della pennellata»: '' = Automatico (colore null), then COLORI. */
const COLORE_LABELS = { '': 'Automatico', ocra: 'Ocra', rosso: 'Rosso', terracotta: 'Terracotta', ottanio: 'Ottanio', blu: 'Blu' };

/** "Carico la foto 2 di 3…" while uploading, "Pubblico…" while committing (shared with profile.js). */
export function saveProgress(ev) {
  if (ev.phase === 'upload' && ev.total) {
    const text = ev.total === 1 ? 'Carico la foto…' : `Carico la foto ${Math.min(ev.done + 1, ev.total)} di ${ev.total}…`;
    progress.show(text, ev.done / ev.total);
  } else if (ev.phase === 'commit') progress.show('Pubblico…');
}

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
      colore: d && d.colore ? d.colore : '', // '' = Automatico
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

/**
 * Unsaved changes to an existing work, for IndexedDB: the fields, the photos in order (existing ones
 * as { ref }, new ones once prepared) and `base`, the version they started from.
 */
export function editToStored(draft, base) {
  return {
    base,
    fields: { ...draft.fields },
    photos: draft.photos
      .filter((p) => p.kind === 'existing' || p.status === 'ready')
      .map((p) => (p.kind === 'existing' ? { ref: p.ref } : p.result)),
  };
}

/** Draft of an existing work with the changes kept in IndexedDB (see editToStored). */
export function editFromStored(opera, stored) {
  const draft = createDraft(opera);
  Object.assign(draft.fields, stored.fields);
  draft.photos = (stored.photos || [])
    .map((p) => (p && p.ref ? existingPhoto(p.ref) : p && p.blob && p.preview ? readyPhoto(p) : null))
    .filter(Boolean);
  return draft;
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
 * @param {object} app   app API: state, store, back, onSaved, handleError, persistDraft, persistEdit,
 *                       discardDraft, discardEdit, sitePage
 * @param {{opera: {slug: string, data: object}|null, draft: object, restored?: boolean}} opts
 *   restored: the draft comes from IndexedDB (new work, or unsaved changes to this work)
 */
export function renderForm(app, { opera, draft, restored = false }) {
  const isNew = !opera;
  const opere = app.state.data.opere;
  const base = isNew ? null : opera.data.aggiornataIl; // the version this form started from
  const errorEls = {};
  const sections = {};
  let closed = false; // saved, deleted or thrown away: nothing left to keep

  /* ---------- helpers ---------- */

  const changed = () => {
    if (isNew) app.persistDraft();
    else app.persistEdit(workKey(opera.slug), () => (!closed && isDirty() ? editToStored(draft, base) : null));
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

  /** The keyboard's "Avanti" / Invio key moves to the next field (the form is not a <form>). */
  function nextOnEnter(input, name) {
    input.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' || e.isComposing) return;
      e.preventDefault();
      const next = FIELD_ORDER.slice(FIELD_ORDER.indexOf(name) + 1).map((n) => document.getElementById(`in-${n}`)).find(Boolean);
      if (next) next.focus();
      else input.blur();
    });
  }

  function textInput(name, attrs = {}) {
    const input = h('input', { id: `in-${name}`, name, class: 'input', value: draft.fields[name], enterkeyhint: 'next', ...attrs });
    input.addEventListener('input', () => {
      draft.fields[name] = input.value;
      showError(name, '');
      changed();
    });
    nextOnEnter(input, name);
    return input;
  }

  /* ---------- photos ---------- */

  const photoGrid = h('div', { class: 'photo-grid' });
  const photoCount = h('span', { class: 'field-count' });
  const straightenHint = h('p', { class: 'hint photo-hint', hidden: true }, 'Si vede il muro, o il quadro è un po’ storto? Tocca «Raddrizza» sulla foto del quadro intero. Per le foto dei dettagli non serve.');
  const onlineHint = h('p', { class: 'hint photo-hint', hidden: true }, 'Per raddrizzare una foto già online: aggiungila di nuovo, raddrizzala e togli la vecchia con ×.');
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

  /** The canvas' size in cm when she has written both measurements (they help «Raddrizza» get the shape right). */
  function measures() {
    const larghezza = parseMisura(draft.fields.larghezza);
    const altezza = parseMisura(draft.fields.altezza);
    return !larghezza.error && !altezza.error && larghezza.value && altezza.value ? { larghezza: larghezza.value, altezza: altezza.value } : null;
  }

  /** Focus goes back to the photo's own button (the tiles are rebuilt on every change). */
  function focusTile(photo) {
    const tile = [...photoGrid.children].find((el) => el.dataset.key === photo.key);
    const target = tile && tile.querySelector('.tile-straighten');
    if (target) target.focus({ preventScroll: true });
  }

  /** «Raddrizza»: she marks the corners of the canvas and keeps the flat picture, or leaves the photo as it was. */
  async function straighten(photo) {
    const outcome = await straightenScreen(photo, { measures: measures() });
    if (outcome) {
      renderPhotos();
      changed();
      if (outcome === 'kept') toast('Foto raddrizzata.');
    }
    focusTile(photo);
  }

  function wholePhoto(photo) {
    restoreWhole(photo);
    renderPhotos();
    changed();
    toast('La foto è tornata com’era.');
    focusTile(photo);
  }

  function photoTile(photo, index) {
    const n = index + 1;
    const sources = photo.kind === 'existing' ? app.store.operaImageSources(draft.slug, photo.ref) : [];
    return h(
      'div',
      { class: `photo-tile${index === 0 ? ' is-cover' : ''}`, dataset: { key: photo.key } },
      h(
        'div',
        { class: 'tile-frame' }, // the picture with the buttons that sit on it
        photoMedia(photo, sources, `Foto ${n}`),
        h('button', { type: 'button', class: 'tile-remove', 'aria-label': `Togli la foto ${n}`, onClick: () => removePhoto(photo) }, icon('close')),
        // The current cover reads "★ Copertina"; on the others the action is a verb, so not every photo says "Copertina".
        index === 0
          ? h('span', { class: 'tile-badge' }, icon('star'), 'Copertina')
          : h('button', { type: 'button', class: 'tile-cover', 'aria-label': `Usa la foto ${n} come copertina`, onClick: () => makeCover(photo) }, 'Fai copertina'),
      ),
      canStraighten(photo)
        ? h(
            'div',
            { class: 'tile-tools' },
            h('button', { type: 'button', class: 'tile-straighten', 'aria-label': `Raddrizza la foto ${n}`, onClick: () => straighten(photo) }, icon('straighten'), 'Raddrizza'),
            isStraightened(photo)
              ? h('button', { type: 'button', class: 'tile-whole', 'aria-label': `Torna alla foto ${n} originale`, onClick: () => wholePhoto(photo) }, 'Torna alla foto originale')
              : null,
          )
        : null,
    );
  }

  function renderPhotos() {
    photoGrid.replaceChildren(...draft.photos.map(photoTile));
    photoGrid.hidden = draft.photos.length === 0;
    straightenHint.hidden = !draft.photos.some(canStraighten);
    onlineHint.hidden = !draft.photos.some((p) => p.kind === 'existing');
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
    h('p', { class: 'hint' }, 'Da 1 a 8 foto. La prima è la copertina (★): con «Fai copertina» scegli un’altra foto.'),
    picker.el,
    photoGrid,
    straightenHint,
    onlineHint,
    errorEl('foto'),
  );

  /* ---------- fields ---------- */

  const titolo = textInput('titolo', { maxlength: String(LIMITS.titolo), autocapitalize: 'sentences', required: true });
  const anno = textInput('anno', { inputmode: 'numeric', pattern: '[0-9]*', maxlength: '4', autocomplete: 'off' });
  const larghezza = textInput('larghezza', { inputmode: 'decimal', autocomplete: 'off', placeholder: 'es. 100' });
  const altezza = textInput('altezza', { inputmode: 'decimal', autocomplete: 'off', placeholder: 'es. 140' });
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

  /** «Colore della pennellata»: six radio buttons drawn as big swatches with their names. */
  function colorePicker() {
    // Anything but a known colour (e.g. null from an old draft) shows, and saves, as Automatico.
    const current = COLORI.includes(draft.fields.colore) ? draft.fields.colore : '';
    draft.fields.colore = current;
    const options = ['', ...COLORI].map((value) => {
      const id = `in-colore-${value || 'auto'}`;
      const input = h('input', { type: 'radio', name: 'colore', id, value, class: 'swatch-input', checked: value === current });
      input.addEventListener('change', () => {
        if (!input.checked) return;
        draft.fields.colore = value;
        showError('colore', '');
        changed();
      });
      return h(
        'label',
        { class: 'swatch', for: id },
        input,
        h(
          'span',
          { class: 'swatch-face' },
          h('span', { class: `swatch-chip swatch-${value || 'auto'}`, 'aria-hidden': 'true' }, icon('check', 'icon swatch-check')),
          h('span', { class: 'swatch-name' }, COLORE_LABELS[value]),
        ),
      );
    });
    sections.colore = h(
      'fieldset',
      { class: 'field swatch-field', id: 'field-colore', 'aria-describedby': 'hint-colore err-colore' },
      h('legend', { class: 'label' }, 'Colore della pennellata'),
      h('p', { class: 'hint', id: 'hint-colore' }, 'È il colore della pennellata dietro al quadro, sul sito. Se non sai, lascia «Automatico».'),
      h('div', { class: 'swatches' }, options),
      errorEl('colore'),
    );
    return sections.colore;
  }

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

  async function runSave(fields) {
    try {
      const ok = await photosReady(draft.photos, (done, total) => progress.show(`Preparo le foto… ${done}/${total}`, done / total));
      if (!ok) {
        progress.hide();
        validate();
        return;
      }
      progress.show('Carico…');
      const result = await app.store.saveOpera({ slug: draft.slug, fields, photos: draft.photos.map(toSavePhoto), base }, saveProgress);
      progress.hide();
      closed = true;
      app.onSaved(result);
    } catch (err) {
      progress.hide();
      app.handleError(err, () => runSave(fields));
    }
  }

  async function save() {
    const fields = validate();
    if (!fields) return;
    // An `outdated` file (e.g. saved before «Colore» existed) is rewritten even without a change.
    if (!isNew && !isDirty() && !opera.outdated) return toast('Nessuna modifica da salvare.');
    await runSave(fields);
  }

  async function runDelete() {
    try {
      progress.show('Elimino…');
      const result = await app.store.deleteOpera(opera.slug, () => {});
      progress.hide();
      closed = true;
      app.onSaved(result);
    } catch (err) {
      progress.hide();
      app.handleError(err, runDelete);
    }
  }

  async function remove() {
    const ok = await confirmSheet({
      title: `Eliminare «${opera.data.titolo}»?`,
      text: 'L’opera e le sue foto spariranno dal sito. Se vuoi solo nasconderla per un po’, togli invece «Visibile sul sito». Se hai caricato per errore una foto privata, avvisa subito Martino.',
      confirmLabel: 'Elimina per sempre',
      danger: true,
    });
    if (ok) await runDelete();
  }

  /** The in-app back arrow. (A back swipe skips this: the changes are then kept, see `leaving`.) */
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
      closed = true;
      app.discardEdit(workKey(opera.slug), { reopen: false });
    }
    app.back();
  }

  async function restart() {
    const ok = await confirmSheet({
      title: 'Ricominciare da capo?',
      text: 'Le foto e i testi dell’opera non salvata verranno cancellati.',
      confirmLabel: 'Sì, ricomincia',
    });
    if (!ok) return;
    closed = true;
    app.discardDraft();
  }

  async function undoChanges() {
    const ok = await confirmSheet({
      title: 'Annullare le modifiche?',
      text: 'Torni alla versione salvata di quest’opera.',
      confirmLabel: 'Sì, annulla le modifiche',
      cancelLabel: 'No, tienile',
    });
    if (!ok) return;
    closed = true;
    app.discardEdit(workKey(opera.slug));
  }

  /** Shown by the app when this screen is left without saving (also by a back swipe). */
  function leaving() {
    if (closed) return null;
    if (isNew) return draftHasContent(draft) ? 'Bozza conservata: la ritrovi in «Nuova opera».' : null;
    return isDirty() ? 'Modifiche non salvate conservate: le ritrovi riaprendo l’opera.' : null;
  }

  /* ---------- layout ---------- */

  // "Vedi sul sito" waits until a save of this work from this phone is online.
  const siteLink = !isNew && opera.data.pubblicata ? h('div', { class: 'site-link-box' }) : null;
  function renderSiteLink() {
    if (siteLink) siteLink.replaceChildren(siteButton(app.sitePage(opera.slug), 'btn btn-ghost btn-small site-link'));
  }
  renderSiteLink();

  let notice = null;
  if (restored && isNew && draftHasContent(draft)) {
    notice = h('div', { class: 'notice notice-row' },
      h('p', {}, 'Stai continuando un’opera non salvata.'),
      h('button', { type: 'button', class: 'btn btn-secondary btn-small', onClick: restart }, 'Ricomincia'));
  } else if (restored && !isNew) {
    notice = h('div', { class: 'notice notice-row' },
      h('p', {}, 'Hai modifiche non ancora salvate.'),
      h('button', { type: 'button', class: 'btn btn-secondary btn-small', onClick: undoChanges }, 'Annulla modifiche'));
  }

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
      notice,
      siteLink,
      sections.foto,
      field('titolo', h('span', {}, 'Titolo ', h('span', { class: 'required', 'aria-hidden': 'true' }, '*')), titolo),
      field('anno', 'Anno', anno, { optional: true }),
      misure,
      field('tecnica', 'Tecnica', tecnica, { optional: true, hint: 'Scrivi o scegli tra quelle già usate.' }),
      datalist('list-tecnica', suggestions(opere, 'tecnica')),
      field('collezione', 'Collezione', collezione, { optional: true, hint: 'Il nome della serie. Scrivi o scegli tra quelle già usate.' }),
      datalist('list-collezione', suggestions(opere, 'collezione')),
      colorePicker(),
      field('testo', 'Testo', testo, { optional: true, hint: 'Per andare a capo con un nuovo paragrafo lascia una riga vuota.', after: testoCount }),
      h(
        'section',
        { class: 'field toggles' },
        toggle('inEvidenza', 'In evidenza in home', 'Le prime 3 opere in evidenza (nell’ordine della lista) formano la composizione grande in cima alla pagina iniziale.'),
        toggle('pubblicata', 'Visibile sul sito', 'Se lo togli, l’opera non compare nelle pagine del sito. Non è però segreta: non caricare foto o testi privati.'),
      ),
      isNew
        ? null
        : h('section', { class: 'field danger-zone' },
            h('button', { type: 'button', class: 'btn btn-danger-outline btn-block', onClick: remove }, icon('trash'), 'Elimina opera')),
    ),
    stickyBar(h('button', { type: 'button', class: 'btn btn-primary btn-block btn-xl', onClick: save }, icon('check'), 'Salva')),
  );
  renderPhotos();

  return { el, name: 'form', isDirty, leaving, onDeploy: renderSiteLink };
}
