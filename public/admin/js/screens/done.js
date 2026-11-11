/**
 * Success screen after a save: "Fatto! «…» è salvata" and the publish status line under it.
 * "Vedi sul sito" turns on only when the publish of this save is finished: before that a new work
 * has no page yet (the site's 404) and an edited one still shows the old version.
 */
import { h, icon, stickyBar, siteButton } from '../ui.js';
import { PROFILE } from '../drafts.js';
import { deployLine } from './list.js';

/**
 * Text and public page (slug | PROFILE | null) for a save result. `live`: the status line under the
 * text says when it is online, so the text does not say it again.
 */
function describe(result, live) {
  switch (result.action) {
    case 'delete':
      return { text: `«${result.titolo}» è stata eliminata. Sparirà dal sito tra circa 2 minuti.`, page: null };
    case 'profilo':
      return { text: live ? 'Il profilo è salvato.' : 'Il profilo sarà aggiornato sul sito tra circa 2 minuti.', page: PROFILE };
    default:
      return result.opera.pubblicata
        ? { text: live ? `«${result.opera.titolo}» è salvata.` : `«${result.opera.titolo}» sarà online tra circa 2 minuti.`, page: result.slug }
        : { text: `«${result.opera.titolo}» è salvata ma nascosta: non si vede sul sito.`, page: null };
  }
}

/**
 * @param {object} app  app API: state, home, newWork, sitePage
 * @param {object} result  what the store returned
 */
export function renderDone(app, result) {
  const { page } = describe(result, false);
  const textEl = h('p', { class: 'done-text' });
  // After a new work the next step is often another one; after an edit, back to the list.
  const isCreate = result.action === 'create';
  const home = (className) => h('button', { type: 'button', class: `btn btn-block ${className}`, onClick: () => app.home() }, 'Torna alle opere');
  const another = (className) =>
    h('button', { type: 'button', class: `btn btn-block ${className}`, onClick: () => app.newWork() }, icon('plus'), 'Aggiungi un’altra opera');
  const status = h('div', { class: 'status-box done-status' });
  const link = h('div', { class: 'done-link' });

  function update() {
    const line = page ? deployLine(app.state.deploy) : null;
    // the short text only while the status line says when it will be online
    textEl.textContent = describe(result, Boolean(line)).text;
    status.replaceChildren(...[line].filter(Boolean));
    if (page) link.replaceChildren(siteButton(app.sitePage(page), 'btn btn-secondary btn-block'));
  }

  const el = h(
    'div',
    { class: 'screen' },
    h(
      'main',
      { class: 'content done' },
      h('div', { class: 'done-check', 'aria-hidden': 'true' }, icon('check')),
      h('h1', { class: 'done-title' }, 'Fatto!'),
      textEl,
      page ? status : null,
      page ? link : null,
      isCreate ? home('btn-ghost') : result.action === 'update' ? another('btn-ghost') : null,
    ),
    stickyBar(isCreate ? another('btn-primary btn-xl') : home('btn-primary btn-xl')),
  );
  update();
  return { el, name: 'done', onDeploy: update };
}
