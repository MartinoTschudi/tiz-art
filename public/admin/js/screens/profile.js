/**
 * "Profilo": portrait (add / replace / remove), motto and biography. Saving = one commit.
 */
import { h, icon, topbar, stickyBar, confirmSheet, toast, progress } from '../ui.js';
import { LIMITS, cleanLine, cleanText } from '../model.js';
import { existingPhoto, newPhoto, releasePhoto, toSavePhoto, photosReady } from '../photos.js';
import { pickerButtons, photoMedia } from './photo-ui.js';

/**
 * @param {object} app  app API: state, store, back, onSaved, handleError
 */
export function renderProfile(app) {
  const saved = app.state.data.profilo || { motto: '', bio: '', ritratto: null };
  const draft = {
    motto: saved.motto || '',
    bio: saved.bio || '',
    ritratto: saved.ritratto ? existingPhoto(saved.ritratto) : null,
  };

  /* ---------- portrait ---------- */

  const portraitBox = h('div', { class: 'portrait-box' });
  const portraitError = h('p', { class: 'field-error', role: 'alert', hidden: true });
  const picker = pickerButtons({
    onFiles: ([file]) => {
      if (draft.ritratto) releasePhoto(draft.ritratto);
      draft.ritratto = newPhoto(file, renderPortrait);
      portraitError.hidden = true;
      renderPortrait();
    },
  });

  function removePortrait() {
    if (draft.ritratto) releasePhoto(draft.ritratto);
    draft.ritratto = null;
    renderPortrait();
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
  });
  const bio = h('textarea', { id: 'in-bio', class: 'input', rows: '12', maxlength: String(LIMITS.bio), value: draft.bio });
  const bioCount = h('p', { class: 'char-count', 'aria-live': 'polite' });
  const updateCount = () => {
    bioCount.textContent = `${draft.bio.length}/${LIMITS.bio}`;
  };
  bio.addEventListener('input', () => {
    draft.bio = bio.value;
    updateCount();
  });
  updateCount();

  /* ---------- save ---------- */

  const values = () => ({ motto: cleanLine(draft.motto), bio: cleanText(draft.bio) });

  function isDirty() {
    const v = values();
    const portraitChanged = draft.ritratto ? draft.ritratto.kind === 'new' || draft.ritratto.ref !== saved.ritratto : saved.ritratto != null;
    return v.motto !== (saved.motto || '') || v.bio !== (saved.bio || '') || portraitChanged;
  }

  function onProgress(ev) {
    if (ev.phase === 'upload' && ev.total) progress.show('Carico la foto…', ev.done / ev.total);
    else if (ev.phase === 'commit') progress.show('Pubblico…');
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
        { ...values(), ritratto: draft.ritratto ? toSavePhoto(draft.ritratto) : null },
        onProgress,
      );
      progress.hide();
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

  async function goBack() {
    if (isDirty()) {
      const leave = await confirmSheet({
        title: 'Uscire senza salvare?',
        text: 'Le modifiche al profilo andranno perse.',
        confirmLabel: 'Esci senza salvare',
        cancelLabel: 'Continua a modificare',
      });
      if (!leave) return;
    }
    app.back();
  }

  const el = h(
    'div',
    { class: 'screen' },
    topbar({ title: 'Profilo', subtitle: 'Pagina «Chi sono»', onBack: goBack, backLabel: 'Torna alle opere' }),
    h(
      'main',
      { class: 'content form' },
      h('a', { class: 'btn btn-ghost btn-small site-link', href: app.env.siteUrl('chi-sono/'), target: '_blank', rel: 'noopener' },
        icon('external'), 'Vedi sul sito'),
      h(
        'section',
        { class: 'field' },
        h('h2', { class: 'label' }, 'Ritratto ', h('small', {}, '(facoltativo)')),
        h('p', { class: 'hint' }, 'Una tua foto, oppure una foto mentre dipingi.'),
        portraitBox,
        picker.el,
        portraitError,
      ),
      h(
        'section',
        { class: 'field' },
        h('label', { class: 'label', for: 'in-motto' }, 'Motto ', h('small', {}, '(facoltativo)')),
        h('p', { class: 'hint' }, 'Una frase breve che appare sotto il tuo nome.'),
        motto,
      ),
      h(
        'section',
        { class: 'field' },
        h('label', { class: 'label', for: 'in-bio' }, 'Biografia'),
        h('p', { class: 'hint' }, 'Per un nuovo paragrafo lascia una riga vuota.'),
        bio,
        bioCount,
      ),
    ),
    stickyBar(h('button', { type: 'button', class: 'btn btn-primary btn-block btn-xl', onClick: save }, icon('check'), 'Salva')),
  );
  renderPortrait();
  return { el, name: 'profile', isDirty };
}
