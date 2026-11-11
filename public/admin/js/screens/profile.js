/**
 * "Profilo": portrait (add / replace / remove), motto and biography. Saving = one commit.
 * Unsaved changes are kept in IndexedDB (app.persistEdit) and offered again when she comes back.
 */
import { h, icon, topbar, stickyBar, confirmSheet, toast, progress, siteButton, autoGrow } from '../ui.js';
import { LIMITS, cleanLine, cleanText } from '../model.js';
import { PROFILE } from '../drafts.js';
import { existingPhoto, readyPhoto, newPhoto, releasePhoto, toSavePhoto, photosReady } from '../photos.js';
import { pickerButtons, photoMedia } from './photo-ui.js';
import { saveProgress } from './form.js';

/** Portrait of a stored profile draft: null (none) | { ref } (already online) | prepared photo. */
function storedPortrait(p) {
  if (!p) return null;
  if (p.ref) return existingPhoto(p.ref);
  return p.blob && p.preview ? readyPhoto(p) : null;
}

/**
 * @param {object} app  app API: state, store, back, onSaved, handleError, persistEdit, discardEdit, sitePage
 * @param {{stored?: object|null}} [opts]  unsaved changes kept in IndexedDB for this profile version
 */
export function renderProfile(app, { stored = null } = {}) {
  const saved = app.state.data.profilo || { motto: '', bio: '', ritratto: null };
  const base = saved.aggiornatoIl || null; // the version this screen started from
  const draft = stored
    ? { motto: stored.fields.motto || '', bio: stored.fields.bio || '', ritratto: storedPortrait(stored.ritratto) }
    : { motto: saved.motto || '', bio: saved.bio || '', ritratto: saved.ritratto ? existingPhoto(saved.ritratto) : null };
  let closed = false; // saved or thrown away: nothing left to keep

  /** What IndexedDB keeps of the unsaved changes (a portrait still being prepared counts as unchanged). */
  function toStored() {
    const p = draft.ritratto;
    let ritratto = null;
    if (p && p.kind === 'existing') ritratto = { ref: p.ref };
    else if (p && p.status === 'ready') ritratto = p.result;
    else if (p) ritratto = saved.ritratto ? { ref: saved.ritratto } : null;
    return { base, fields: { motto: draft.motto, bio: draft.bio }, ritratto };
  }
  const changed = () => app.persistEdit(PROFILE, () => (!closed && isDirty() ? toStored() : null));

  /* ---------- portrait ---------- */

  const portraitBox = h('div', { class: 'portrait-box' });
  const portraitError = h('p', { class: 'field-error', role: 'alert', hidden: true });
  const picker = pickerButtons({
    onFiles: ([file]) => {
      if (draft.ritratto) releasePhoto(draft.ritratto);
      draft.ritratto = newPhoto(file, () => {
        renderPortrait();
        changed();
      });
      portraitError.hidden = true;
      renderPortrait();
    },
  });

  async function removePortrait() {
    const ok = await confirmSheet({
      title: 'Togliere il ritratto?',
      text: 'Sul sito cambia solo quando tocchi «Salva».',
      confirmLabel: 'Togli il ritratto',
      cancelLabel: 'No, tienilo',
      danger: true,
    });
    if (!ok) return;
    if (draft.ritratto) releasePhoto(draft.ritratto);
    draft.ritratto = null;
    renderPortrait();
    changed();
  }

  function renderPortrait() {
    const p = draft.ritratto;
    portraitBox.replaceChildren(
      p
        ? h(
            'div',
            { class: 'photo-tile portrait-tile' },
            photoMedia(p, p.kind === 'existing' ? app.store.portraitSources(p.ref) : [], 'Il tuo ritratto'),
            h('button', { type: 'button', class: 'tile-remove', 'aria-label': 'Togli il ritratto', onClick: removePortrait }, icon('close')),
          )
        : h('p', { class: 'hint' }, 'Nessun ritratto: la pagina «Chi sono» mostra solo il testo.'),
    );
  }

  /* ---------- texts ---------- */

  const motto = h('input', { id: 'in-motto', class: 'input', maxlength: String(LIMITS.motto), value: draft.motto, autocapitalize: 'sentences' });
  motto.addEventListener('input', () => {
    draft.motto = motto.value;
    changed();
  });
  motto.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.isComposing) {
      e.preventDefault();
      bio.focus();
    }
  });
  const bio = h('textarea', { id: 'in-bio', class: 'input', rows: '12', maxlength: String(LIMITS.bio), value: draft.bio });
  autoGrow(bio);
  // shown only near the limit (the box stops typing there anyway)
  const bioCount = h('p', { class: 'char-count' });
  const updateCount = () => {
    const left = LIMITS.bio - draft.bio.length;
    bioCount.hidden = left > LIMITS.bio / 10;
    bioCount.textContent = left > 1 ? `Ancora ${left} caratteri` : left === 1 ? 'Ancora 1 carattere' : 'Hai raggiunto il massimo.';
  };
  bio.addEventListener('input', () => {
    draft.bio = bio.value;
    updateCount();
    changed();
  });
  updateCount();

  /* ---------- save ---------- */

  const values = () => ({ motto: cleanLine(draft.motto), bio: cleanText(draft.bio) });

  function isDirty() {
    const v = values();
    const portraitChanged = draft.ritratto ? draft.ritratto.kind === 'new' || draft.ritratto.ref !== saved.ritratto : saved.ritratto != null;
    return v.motto !== (saved.motto || '') || v.bio !== (saved.bio || '') || portraitChanged;
  }

  async function runSave() {
    try {
      const photos = draft.ritratto ? [draft.ritratto] : [];
      const ok = await photosReady(photos, () => progress.show('Preparo la foto…'));
      if (!ok) {
        progress.hide();
        portraitError.textContent = 'Questa foto non si può usare: scegline un’altra.';
        portraitError.hidden = false;
        return;
      }
      const result = await app.store.saveProfilo(
        { ...values(), ritratto: draft.ritratto ? toSavePhoto(draft.ritratto) : null, base },
        saveProgress,
      );
      progress.hide();
      closed = true;
      app.onSaved(result);
    } catch (err) {
      progress.hide();
      app.handleError(err, runSave);
    }
  }

  async function save() {
    if (!isDirty()) return toast('Nessuna modifica da salvare.');
    await runSave();
  }

  /** The in-app back arrow. (A back swipe skips this: the changes are then kept, see `leaving`.) */
  async function goBack() {
    if (isDirty()) {
      const leave = await confirmSheet({
        title: 'Uscire senza salvare?',
        text: 'Le modifiche al profilo andranno perse.',
        confirmLabel: 'Esci senza salvare',
        cancelLabel: 'Continua a modificare',
      });
      if (!leave) return;
      closed = true;
      app.discardEdit(PROFILE, { reopen: false });
    }
    app.back();
  }

  async function undoChanges() {
    const ok = await confirmSheet({
      title: 'Annullare le modifiche?',
      text: 'Torni alla versione salvata del profilo.',
      confirmLabel: 'Sì, annulla le modifiche',
      cancelLabel: 'No, tienile',
    });
    if (!ok) return;
    closed = true;
    app.discardEdit(PROFILE);
  }

  const leaving = () => (!closed && isDirty() ? 'Modifiche non salvate conservate: le ritrovi in «Profilo».' : null);

  // "Vedi sul sito" waits until a save of the profile from this phone is online.
  const siteLink = h('div', { class: 'site-link-box' });
  const renderSiteLink = () => siteLink.replaceChildren(siteButton(app.sitePage(PROFILE), 'btn btn-ghost btn-small site-link'));
  renderSiteLink();

  const el = h(
    'div',
    { class: 'screen' },
    topbar({ title: 'Profilo', subtitle: 'Pagina «Chi sono»', onBack: goBack, backLabel: 'Torna alle opere' }),
    h(
      'main',
      { class: 'content form' },
      stored
        ? h('div', { class: 'notice notice-row' },
            h('p', {}, 'Hai modifiche non ancora salvate.'),
            h('button', { type: 'button', class: 'btn btn-secondary btn-small', onClick: undoChanges }, 'Annulla modifiche'))
        : null,
      siteLink,
      h(
        'section',
        { class: 'field' },
        h('h2', { class: 'label' }, 'Ritratto ', h('small', {}, '(facoltativo)')),
        h('p', { class: 'hint' }, 'Una tua foto, oppure una foto mentre dipingi. Qui la vedi tagliata come sul sito, in verticale.'),
        portraitBox,
        picker.el,
        portraitError,
      ),
      h(
        'section',
        { class: 'field' },
        h('label', { class: 'label', for: 'in-motto' }, 'Motto ', h('small', {}, '(facoltativo)')),
        h('p', { class: 'hint' }, 'È il grande titolo scritto a mano in cima alla pagina iniziale. Più è breve, più è grande.'),
        motto,
      ),
      h(
        'section',
        { class: 'field' },
        h('label', { class: 'label', for: 'in-bio' }, 'Biografia', h('small', {}, ' (facoltativo)')),
        h('p', { class: 'hint' }, 'Per un nuovo paragrafo lascia una riga vuota.'),
        bio,
        bioCount,
      ),
    ),
    stickyBar(h('button', { type: 'button', class: 'btn btn-primary btn-block btn-xl', onClick: save }, icon('check'), 'Salva')),
  );
  renderPortrait();
  return { el, name: 'profile', isDirty, leaving, onDeploy: renderSiteLink };
}
