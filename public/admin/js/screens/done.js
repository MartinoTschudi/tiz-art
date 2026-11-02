/**
 * Success screen after a save: "Fatto! Sarà online tra circa 2 minuti".
 * "Vedi sul sito" turns on only when the publish of this save is finished: before that a new work
 * has no page yet (the site's 404) and an edited one still shows the old version.
 */
import { h, icon, stickyBar, siteButton } from '../ui.js';
import { PROFILE } from '../drafts.js';
import { deployLine } from './list.js';

/** Text and public page (slug | PROFILE | null) for a save result. */
function describe(result) {
  switch (result.action) {
    case 'delete':
      return { text: `«${result.titolo}» è stata eliminata. Sparirà dal sito tra circa 2 minuti.`, page: null };
    case 'profilo':
      return { text: 'Il profilo sarà aggiornato sul sito tra circa 2 minuti.', page: PROFILE };
    default:
      return result.opera.pubblicata
        ? { text: `«${result.opera.titolo}» sarà online tra circa 2 minuti.`, page: result.slug }
        : { text: `«${result.opera.titolo}» è salvata ma nascosta: non si vede sul sito.`, page: null };
  }
}

/**
 * @param {object} app  app API: state, home, newWork, sitePage
 * @param {object} result  what the store returned
 */
export function renderDone(app, result) {
  const { text, page } = describe(result);
  // After adding or editing a work the next step is often another one; otherwise back to the list.
  const nextWork = result.action === 'create' || result.action === 'update';
  const home = (className) => h('button', { type: 'button', class: `btn btn-block ${className}`, onClick: () => app.home() }, 'Torna alle opere');
  const status = h('div', { class: 'status-box done-status' });
  const link = h('div', { class: 'done-link' });

  function update() {
    status.replaceChildren(...[page ? deployLine(app.state.deploy) : null].filter(Boolean));
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
      h('p', { class: 'done-text' }, text),
      page ? status : null,
      page ? link : null,
      nextWork ? home('btn-ghost') : null,
    ),
    stickyBar(
      nextWork
        ? h('button', { type: 'button', class: 'btn btn-primary btn-block btn-xl', onClick: () => app.newWork() }, icon('plus'), 'Aggiungi un’altra opera')
        : home('btn-primary btn-xl'),
    ),
  );
  update();
  return { el, name: 'done', onDeploy: update };
}
