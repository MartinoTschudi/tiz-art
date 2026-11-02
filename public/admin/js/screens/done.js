/** Success screen after a save: "Fatto! Sarà online tra circa 2 minuti". */
import { h, icon, stickyBar } from '../ui.js';

/** Text and public page for a save result. */
function describe(result, env) {
  switch (result.action) {
    case 'delete':
      return { text: `«${result.titolo}» è stata eliminata. Sparirà dal sito tra circa 2\u00a0minuti.`, url: null };
    case 'profilo':
      return { text: 'Il profilo sarà aggiornato sul sito tra circa 2\u00a0minuti.', url: env.siteUrl('chi-sono/') };
    default:
      return result.opera.pubblicata
        ? { text: `«${result.opera.titolo}» sarà online tra circa 2\u00a0minuti.`, url: env.siteUrl(`opere/${result.slug}/`) }
        : { text: `«${result.opera.titolo}» è salvata ma nascosta: non si vede sul sito.`, url: null };
  }
}

/**
 * @param {object} app  app API: env, home, newWork
 * @param {object} result  what the store returned
 */
export function renderDone(app, result) {
  const { text, url } = describe(result, app.env);
  // After adding or editing a work the next step is often another one; otherwise back to the list.
  const nextWork = result.action === 'create' || result.action === 'update';
  const home = (className) => h('button', { type: 'button', class: `btn btn-block ${className}`, onClick: () => app.home() }, 'Torna alle opere');
  const el = h(
    'div',
    { class: 'screen' },
    h(
      'main',
      { class: 'content done' },
      h('div', { class: 'done-check', 'aria-hidden': 'true' }, icon('check')),
      h('h1', { class: 'done-title' }, 'Fatto!'),
      h('p', { class: 'done-text' }, text),
      url
        ? h('a', { class: 'btn btn-secondary btn-block', href: url, target: '_blank', rel: 'noopener' }, icon('external'), 'Vedi sul sito')
        : null,
      nextWork ? home('btn-ghost') : null,
    ),
    stickyBar(
      nextWork
        ? h('button', { type: 'button', class: 'btn btn-primary btn-block btn-xl', onClick: () => app.newWork() }, icon('plus'), 'Aggiungi un’altra opera')
        : home('btn-primary btn-xl'),
    ),
  );
  return { el, name: 'done' };
}
