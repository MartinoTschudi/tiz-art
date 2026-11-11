/**
 * "Le mie opere": publish status, the list of works (tap = edit; a hidden work greyed out; which
 * works are really in the home composition), "Cambia l’ordine" mode with up/down buttons (saved as
 * one commit; «Annulla» asks when something moved), links to the profile, reload and "Esci".
 */
import { h, icon, picture, topbar, stickyBar, confirmSheet } from '../ui.js';
import { formatMisure } from '../model.js';

/** "Online ✓" / "Pubblicazione in corso…" / "Problema…" line, or nothing when unknown. */
export function deployLine(status) {
  if (!status || !status.state) return null;
  const texts = {
    online: 'Online ✓',
    running: 'Pubblicazione in corso… (1–3 minuti)',
    error: 'Problema nell’ultima pubblicazione',
  };
  return h(
    'p',
    { class: `deploy deploy-${status.state}`, role: 'status' },
    h('span', { class: 'deploy-dot', 'aria-hidden': 'true' }),
    h('span', {}, texts[status.state]),
    status.state === 'error' && status.url
      ? h('a', { class: 'deploy-link', href: status.url, target: '_blank', rel: 'noopener noreferrer' }, 'Dettagli')
      : null,
  );
}

/** "2023 · 100 × 140 cm" */
function metaLine(data) {
  return [data.anno, formatMisure(data.larghezza, data.altezza)].filter(Boolean).join(' · ');
}

/**
 * The 3 works of the big composition at the top of the home page, exactly as the site picks them
 * (src/components/lib/composition.ts heroSlots): the first 3 published works marked «In evidenza»,
 * in the order of the list; with fewer than 3, the first other published works fill the places.
 */
export function homeSlugs(opere) {
  const published = opere.filter((o) => o.data.pubblicata);
  const featured = published.filter((o) => o.data.inEvidenza).slice(0, 3);
  return new Set([...featured, ...published.filter((o) => !featured.includes(o))].slice(0, 3).map((o) => o.slug));
}

function badges(data, inHome) {
  return [
    data.inEvidenza
      ? inHome
        ? h('span', { class: 'badge badge-star' }, icon('star'), 'In evidenza')
        : h('span', { class: 'badge badge-hidden' }, icon('star'), 'In evidenza, non in home')
      : null,
    data.pubblicata ? null : h('span', { class: 'badge badge-hidden' }, icon('eyeOff'), 'Nascosta'),
  ];
}

function countLine(opere) {
  const hidden = opere.filter((o) => !o.data.pubblicata).length;
  const total = `${opere.length} ${opere.length === 1 ? 'opera' : 'opere'}`;
  return hidden ? `${total} · ${hidden} ${hidden === 1 ? 'nascosta' : 'nascoste'}` : total;
}

/**
 * @param {object} app  app API: state, store, go, reload, logout, saveOrder
 */
export function renderList(app) {
  const { state } = app;
  let ordering = null; // slugs in the new order while "Cambia l’ordine" is active
  let movedSlug = null;

  const statusBox = h('div', { class: 'status-box' });
  const live = h('p', { class: 'sr-only', role: 'status' }); // tells VoiceOver where a moved work went
  const main = h('main', { class: 'content' });
  const bar = h('div');

  const thumb = (o) =>
    picture(app.store.operaImageSources(o.slug, o.data.immagini && o.data.immagini[0]), { className: 'thumb row-thumb' });

  function row(o, inHome) {
    const d = o.data;
    return h(
      'a',
      { class: `opera-row${d.pubblicata ? '' : ' is-hidden'}`, href: `#/opera/${encodeURIComponent(o.slug)}` },
      thumb(o),
      h(
        'span',
        { class: 'row-body' },
        h('span', { class: 'row-title' }, d.titolo || o.slug),
        metaLine(d) ? h('span', { class: 'row-meta' }, metaLine(d)) : null,
        h('span', { class: 'row-badges' }, badges(d, inHome)),
      ),
      icon('chevron', 'icon row-chevron'),
    );
  }

  const rowOf = (slug) => main.querySelector(`[data-slug="${CSS.escape(slug)}"]`);

  function move(index, delta) {
    const target = index + delta;
    if (target < 0 || target >= ordering.length) return;
    movedSlug = ordering[index];
    const before = rowOf(movedSlug);
    const oldTop = before ? before.getBoundingClientRect().top : null;
    [ordering[index], ordering[target]] = [ordering[target], ordering[index]];
    renderMain();
    const title = (state.data.opere.find((o) => o.slug === movedSlug) || { data: {} }).data.titolo || '';
    live.textContent = `«${title}» ora è al posto ${target + 1} di ${ordering.length}.`;
    // Keep the moved work (and its arrows) under the finger: the page scrolls by the row it moved,
    // so tapping ↑ again moves it on instead of moving the neighbour back.
    const moved = rowOf(movedSlug);
    if (!moved) return;
    if (oldTop !== null) window.scrollBy(0, moved.getBoundingClientRect().top - oldTop);
    else moved.scrollIntoView({ block: 'nearest' });
    const again = moved.querySelector(delta < 0 ? '.move-up' : '.move-down');
    (again && !again.disabled ? again : moved.querySelector('.move-btn:not(:disabled)'))?.focus({ preventScroll: true });
  }

  function orderRow(o, index, total, inHome) {
    const flags = h(
      'span',
      { class: 'row-flags' },
      inHome ? [icon('star', 'icon row-star is-star'), h('span', { class: 'sr-only' }, ' in home')] : null,
      o.data.pubblicata ? null : [icon('eyeOff', 'icon row-star'), h('span', { class: 'sr-only' }, ' nascosta')],
    );
    return h(
      'div',
      { class: `opera-row is-ordering${o.slug === movedSlug ? ' is-moved' : ''}`, dataset: { slug: o.slug } },
      h('span', { class: 'row-pos', 'aria-hidden': 'true' }, String(index + 1)),
      thumb(o),
      h('span', { class: 'row-body' }, h('span', { class: 'row-title' }, o.data.titolo || o.slug, inHome || !o.data.pubblicata ? flags : null)),
      h(
        'span',
        { class: 'move-btns' },
        h('button', {
          type: 'button', class: 'icon-btn move-btn move-up', disabled: index === 0,
          'aria-label': `Sposta «${o.data.titolo}» più in alto`, onClick: () => move(index, -1),
        }, icon('up')),
        h('button', {
          type: 'button', class: 'icon-btn move-btn move-down', disabled: index === total - 1,
          'aria-label': `Sposta «${o.data.titolo}» più in basso`, onClick: () => move(index, 1),
        }, icon('down')),
      ),
    );
  }

  function renderStatus() {
    statusBox.replaceChildren(...[deployLine(state.deploy)].filter(Boolean));
  }

  function renderMain() {
    // ↻ turns while the works are read again (a tap gives an answer at once)
    refreshBtn.classList.toggle('is-spinning', Boolean(state.loading));
    refreshBtn.setAttribute('aria-busy', String(Boolean(state.loading)));
    const data = state.data;
    if (!data) {
      main.replaceChildren(
        state.loadError
          ? h(
              'div',
              { class: 'card notice-error' },
              h('p', {}, state.loadError.message || 'Non riesco a caricare le opere.'),
              h('button', { type: 'button', class: 'btn btn-secondary btn-block', onClick: () => app.reload() }, icon('refresh'), 'Riprova'),
            )
          : h('div', { class: 'loading' }, h('div', { class: 'spinner' }), h('p', {}, 'Carico le opere…')),
      );
      renderBar();
      return;
    }
    const opere = data.opere;
    const bySlug = new Map(opere.map((o) => [o.slug, o]));
    const children = [statusBox];
    if (state.loadError && !state.loading) {
      // The reload failed: what is shown may not be the latest (a toast alone is easy to miss).
      children.push(
        h('div', { class: 'notice notice-warn notice-row', role: 'alert' },
          h('p', {}, 'Lista non aggiornata: controlla la connessione.'),
          h('button', { type: 'button', class: 'btn btn-secondary btn-small', onClick: () => app.reload({ manual: true }) }, icon('refresh'), 'Riprova')),
      );
    }
    if (data.problems.length) {
      children.push(
        h('div', { class: 'notice notice-warn', role: 'alert' },
          h('p', {}, 'Attenzione, alcuni dati hanno un problema. Avvisa Martino:'),
          h('ul', {}, data.problems.map((p) => h('li', {}, p)))),
      );
    }
    if (ordering) {
      const list = ordering.map((s) => bySlug.get(s)).filter(Boolean);
      const home = homeSlugs(list);
      children.push(
        h('p', { class: 'hint order-hint' }, 'Usa le frecce per spostare le opere. Sul sito appaiono in quest’ordine; la ★ segna le opere in home. Alla fine tocca «Salva l’ordine».'),
        h('div', { class: 'rows' }, list.map((o, i) => orderRow(o, i, list.length, home.has(o.slug)))),
      );
    } else {
      children.push(
        h(
          'div',
          { class: 'list-tools' },
          h('p', { class: 'list-count' }, countLine(opere)),
          h('a', { class: 'btn btn-secondary btn-small', href: '#/profilo' }, icon('user'), 'Profilo'),
          opere.length > 1
            ? h('button', { type: 'button', class: 'btn btn-secondary btn-small', onClick: startOrdering }, icon('reorder'), 'Cambia l’ordine')
            : null,
        ),
        opere.length
          ? h('div', { class: 'rows' }, opere.map((o) => row(o, homeSlugs(opere).has(o.slug))))
          : h('p', { class: 'empty' }, 'Ancora nessuna opera. Tocca «Nuova opera» per aggiungere la prima.'),
      );
    }
    main.replaceChildren(...children);
    renderStatus();
    renderBar();
  }

  function renderBar() {
    if (ordering) {
      bar.replaceChildren(
        stickyBar(
          h('div', { class: 'bar-row' },
            h('button', { type: 'button', class: 'btn btn-secondary', onClick: cancelOrdering }, 'Annulla'),
            h('button', { type: 'button', class: 'btn btn-primary', onClick: saveOrdering }, icon('check'), 'Salva l’ordine')),
        ),
      );
    } else {
      bar.replaceChildren(
        stickyBar(h('a', { class: 'btn btn-primary btn-block btn-xl', href: '#/nuova' }, icon('plus'), 'Nuova opera')),
      );
    }
  }

  function startOrdering() {
    ordering = state.data.opere.map((o) => o.slug);
    movedSlug = null;
    renderMain();
    window.scrollTo(0, 0);
  }

  function stopOrdering() {
    ordering = null;
    movedSlug = null;
    renderMain();
  }

  /** «Annulla» in «Cambia l’ordine»: asks first when works were moved. */
  async function cancelOrdering() {
    if (orderChanged()) {
      const ok = await confirmSheet({
        title: 'Annullare il nuovo ordine?',
        text: 'Gli spostamenti che hai fatto non vengono salvati.',
        confirmLabel: 'Sì, annulla',
        cancelLabel: 'No, continua',
      });
      if (!ok) return;
    }
    stopOrdering();
  }

  const orderChanged = () => Boolean(ordering) && ordering.join('/') !== state.data.opere.map((o) => o.slug).join('/');

  async function saveOrdering() {
    if (!orderChanged()) return stopOrdering();
    if (await app.saveOrder(ordering)) stopOrdering();
  }

  async function logout() {
    const ok = await confirmSheet({
      title: 'Vuoi uscire?',
      text: 'Per rientrare ti serviranno e-mail e password. Le modifiche non ancora salvate vengono cancellate da questo telefono.',
      confirmLabel: 'Esci',
    });
    if (ok) app.logout();
  }

  const refreshBtn = h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Ricarica le opere', onClick: () => app.reload({ manual: true }) }, icon('refresh'));
  const el = h(
    'div',
    { class: 'screen' },
    topbar({
      title: 'Le mie opere',
      subtitle: 'TIZ · Admin',
      actions: [
        refreshBtn,
        h('button', { type: 'button', class: 'icon-btn icon-btn-label', 'aria-label': 'Esci', onClick: logout }, icon('logout'), h('span', {}, 'Esci')),
      ],
    }),
    main,
    bar,
    live,
  );
  renderMain();

  return {
    el,
    name: 'list',
    update: renderMain,
    onDeploy: renderStatus,
    isDirty: orderChanged,
  };
}
