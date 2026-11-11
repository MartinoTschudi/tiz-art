/**
 * «Raddrizza»: a full-screen step over the form. She puts a point on each corner of the canvas in
 * her photo; the admin shows the flat, front-facing picture made from it and she keeps it or moves
 * the points again. The photo changes only when she taps «Sì, va bene».
 *
 *   1. points   the whole photo with an outline and four round points. The admin proposes them when
 *               it recognises the canvas; otherwise they start on the corners of the photo and
 *               «Raddrizza» waits until she has moved one. A touch anywhere takes the nearest point
 *               and moves it by as much as the finger moves (so the finger need not cover the
 *               corner); a magnifier shows the exact spot. Arrow keys move a focused point.
 *   2. working  «Raddrizzo la foto…»
 *   3. result   the flat picture · «Sì, va bene» / «Sposta i punti»
 *
 * The step has its own history entry (ui.js stepEntry): the back gesture closes it like «Annulla»
 * and the form stays. The photo is kept clear of the screen's edges, where iOS starts that gesture.
 */
import { h, icon, toast, stepEntry } from '../ui.js';
import { openForStraighten } from '../images.js';
import { orderCorners, quadIsUsable, defaultQuad } from '../straighten.js';
import { straightenView, makeStraightened, useStraightened, rememberCorners } from '../photos.js';

const CORNER_NAMES = ['in alto a sinistra', 'in alto a destra', 'in basso a destra', 'in basso a sinistra'];
const SVG = 'http://www.w3.org/2000/svg';
/** Free space around the photo: a point on its edge stays reachable and away from the screen's edge. */
const STAGE_PAD = 30;
const LOUPE_SIZE = 124;
const LOUPE_ZOOM = 2.5;
/** A finger must travel this far (px) before a point moves: a tap does not displace it. */
const DRAG_START = 4;

const HINTS = {
  found: 'Ho messo i quattro punti sugli angoli del quadro: controllali. Se uno non è giusto, trascinalo sull’angolo.',
  notFound: 'Non ho trovato il quadro da solo. Trascina i quattro punti sugli angoli del quadro. Per la foto di un dettaglio non serve: tocca «Annulla».',
  remembered: 'Questi sono i punti dell’ultima volta. Spostali se serve.',
  bad: 'I punti si incrociano o sono troppo vicini: rimettine uno su ogni angolo. Se il quadro è preso molto di lato, rifai la foto più di fronte.',
  result: 'Va bene così? Guarda che il quadro si veda tutto e che lungo i bordi non resti del muro.',
  resultShape: 'Va bene così? Il quadro si deve vedere tutto, senza muro. Troppo largo o stretto? Tocca «Sì, va bene», scrivi le misure e raddrizza di nuovo.',
};

const clamp01 = (v) => Math.min(1, Math.max(0, v));

/** Resolves once the page has drawn (two frames), or shortly after when it is not being shown. */
function painted() {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, 150);
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        clearTimeout(timer);
        resolve();
      }),
    );
  });
}

/**
 * Opens the step for one photo.
 * @param {object} photo  a new, ready photo of photos.js
 * @param {{measures?: {larghezza: number, altezza: number}|null}} [opts]  the canvas' size in cm, if she wrote it
 * @returns {Promise<'kept'|'points'|null>}  'kept': the photo now holds the straightened picture ·
 *   'points': she only moved points (remembered with the photo) · null: nothing changed
 */
export function straightenScreen(photo, { measures = null } = {}) {
  return new Promise((resolve) => {
    const view = straightenView(photo);
    const appRoot = document.getElementById('app');
    let opened = null; // { canvas, width, height, guess, release } from openForStraighten
    let corners = null; // four [x, y] as fractions of the photo's sides, in handle order
    let startHint = HINTS.notFound;
    let moved = false; // she moved a point in this session
    let needsMove = false; // no proposal: «Raddrizza» waits for her
    let resultUrl = null;
    let closed = false;
    let drag = null;

    /* ---------- elements ---------- */

    const title = h('h2', { class: 'straighten-title', id: 'straighten-title', tabindex: '-1' }, 'Raddrizza la foto');
    const hint = h('p', { class: 'straighten-hint', id: 'straighten-hint', role: 'status' });
    const keys = h('p', { class: 'sr-only', id: 'straighten-keys' }, 'Trascina il punto sull’angolo del quadro. Con la tastiera: le frecce lo spostano di poco, Maiuscole più frecce di più.');
    const stage = h('div', { class: 'straighten-stage' });
    const box = h('div', { class: 'straighten-box', hidden: true });
    const outline = document.createElementNS(SVG, 'svg');
    outline.setAttribute('class', 'straighten-outline');
    outline.setAttribute('viewBox', '0 0 100 100');
    outline.setAttribute('preserveAspectRatio', 'none');
    outline.setAttribute('aria-hidden', 'true');
    const shape = document.createElementNS(SVG, 'polygon');
    outline.append(shape);
    const handles = CORNER_NAMES.map((name, index) => {
      const handle = h('button', { type: 'button', class: 'straighten-handle', 'aria-label': `Angolo ${name}`, 'aria-describedby': 'straighten-keys', dataset: { corner: String(index) } }, h('span', { 'aria-hidden': 'true' }));
      handle.addEventListener('keydown', (e) => nudge(e, index));
      return handle;
    });
    const loupe = h('canvas', { class: 'straighten-loupe', width: String(LOUPE_SIZE * 2), height: String(LOUPE_SIZE * 2), 'aria-hidden': 'true', hidden: true });
    const resultImg = h('img', { class: 'straighten-result', alt: 'Il quadro raddrizzato', draggable: 'false', hidden: true });
    const workingText = h('p', { role: 'status' }, 'Apro la foto…');
    const working = h('div', { class: 'straighten-working' }, h('div', { class: 'spinner', 'aria-hidden': 'true' }), workingText);
    const actions = h('div', { class: 'straighten-actions' });
    const overlay = h(
      'div',
      { class: 'straighten', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'straighten-title' },
      h('header', { class: 'straighten-top' }, title, hint, keys),
      stage,
      h('footer', { class: 'straighten-bottom' }, actions),
    );
    stage.append(box, loupe, resultImg, working);
    stage.addEventListener('pointerdown', startDrag);

    const button = (label, className, onClick, iconName) =>
      h('button', { type: 'button', class: `btn ${className}`, onClick }, iconName ? icon(iconName) : null, label);

    /* ---------- closing ---------- */

    /** @param {'kept'|null} outcome  @param {boolean} byBack  closed by the back gesture: its history entry is already gone */
    function close(outcome, byBack = false) {
      if (closed) return;
      closed = true;
      endDrag();
      window.removeEventListener('resize', layout);
      window.removeEventListener('hashchange', onLeave);
      document.removeEventListener('keydown', onKey);
      document.documentElement.classList.remove('is-straightening');
      if (appRoot) appRoot.inert = false;
      // the points she placed are kept with the photo, also when she does not straighten now
      let result = outcome;
      if (!result && moved && corners && opened && usable()) {
        rememberCorners(photo, ordered().map(([x, y]) => [x / opened.width, y / opened.height]));
        result = 'points';
      }
      if (opened) opened.release();
      if (resultUrl) URL.revokeObjectURL(resultUrl);
      overlay.remove();
      if (!byBack) leaveEntry();
      resolve(result);
    }
    const onLeave = () => close(null, true); // the form itself is being left
    function onKey(e) {
      if (e.key === 'Escape') close(null);
    }

    /* ---------- step 1: the points ---------- */

    /** Fits the photo into the stage and puts outline and points on it. */
    function layout() {
      if (!opened || closed || box.hidden) return; // only the points screen has something to fit
      draw(); // first the hint: its height decides how much room the photo has
      const availW = stage.clientWidth - 2 * STAGE_PAD;
      const availH = stage.clientHeight - 2 * STAGE_PAD;
      if (availW <= 0 || availH <= 0) return;
      const scale = Math.min(availW / opened.width, availH / opened.height);
      const w = Math.round(opened.width * scale);
      const hgt = Math.round(opened.height * scale);
      box.style.width = `${w}px`;
      box.style.height = `${hgt}px`;
      box.style.left = `${Math.round((stage.clientWidth - w) / 2)}px`;
      box.style.top = `${Math.round((stage.clientHeight - hgt) / 2)}px`;
    }

    /** The points in the order top-left … bottom-left as she sees them, in photo pixels. */
    function ordered() {
      return orderCorners(corners.map(([x, y]) => [x * opened.width, y * opened.height]));
    }
    const usable = () => quadIsUsable(ordered(), opened.width, opened.height);

    function draw() {
      shape.setAttribute('points', orderCorners(corners).map(([x, y]) => `${(x * 100).toFixed(3)},${(y * 100).toFixed(3)}`).join(' '));
      corners.forEach(([x, y], i) => {
        handles[i].style.left = `${(x * 100).toFixed(3)}%`;
        handles[i].style.top = `${(y * 100).toFixed(3)}%`;
      });
      const ok = usable();
      outline.classList.toggle('is-bad', !ok);
      const use = actions.querySelector('[data-use]');
      if (use) use.disabled = !ok || (needsMove && !moved);
      const text = ok ? startHint : HINTS.bad;
      if (hint.textContent !== text) hint.textContent = text;
    }

    function setCorner(index, x, y) {
      corners[index] = [clamp01(x), clamp01(y)];
      moved = true;
      draw();
    }

    /** A touch on the stage takes the nearest point (or the one touched). */
    function startDrag(e) {
      if (drag || !corners || box.hidden || (e.button != null && e.button > 0)) return;
      const rect = box.getBoundingClientRect();
      const touched = e.target instanceof Element ? e.target.closest('.straighten-handle') : null;
      let index = touched ? Number(touched.dataset.corner) : -1;
      if (index < 0) {
        let nearest = Infinity;
        corners.forEach(([x, y], i) => {
          const d = Math.hypot(rect.left + x * rect.width - e.clientX, rect.top + y * rect.height - e.clientY);
          if (d < nearest) {
            nearest = d;
            index = i;
          }
        });
      }
      e.preventDefault();
      try {
        stage.setPointerCapture(e.pointerId); // the point follows the finger also outside the stage
      } catch {
        /* the window listeners below are enough */
      }
      window.addEventListener('pointermove', moveDrag);
      window.addEventListener('pointerup', endDrag);
      window.addEventListener('pointercancel', endDrag);
      handles[index].focus({ preventScroll: true });
      handles[index].classList.add('is-held');
      // the point keeps its distance from the finger: it moves by as much as the finger does
      drag = { index, id: e.pointerId, x0: e.clientX, y0: e.clientY, from: [...corners[index]], moving: false };
      showLoupe(index);
    }

    function moveDrag(e) {
      if (!drag || e.pointerId !== drag.id) return;
      e.preventDefault();
      const dx = e.clientX - drag.x0;
      const dy = e.clientY - drag.y0;
      if (!drag.moving && Math.hypot(dx, dy) < DRAG_START) return;
      drag.moving = true;
      const rect = box.getBoundingClientRect();
      setCorner(drag.index, drag.from[0] + dx / rect.width, drag.from[1] + dy / rect.height);
      showLoupe(drag.index);
    }

    /** Also on "pointercancel" (the system took the touch): the point stays where it got to. */
    function endDrag(e) {
      if (!drag || (e && e.pointerId !== drag.id)) return;
      window.removeEventListener('pointermove', moveDrag);
      window.removeEventListener('pointerup', endDrag);
      window.removeEventListener('pointercancel', endDrag);
      handles[drag.index].classList.remove('is-held');
      drag = null;
      loupe.hidden = true;
    }

    /** Arrow keys move the focused point (a bigger step with Shift). */
    function nudge(e, index) {
      if (!corners) return;
      const step = (e.shiftKey ? 10 : 1) / Math.max(opened.canvas.width, opened.canvas.height);
      const move = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
      if (!move) return;
      e.preventDefault();
      setCorner(index, corners[index][0] + move[0], corners[index][1] + move[1]);
    }

    /** The magnifier: the photo around the held point, enlarged, with the outline and a cross on the exact spot. */
    function showLoupe(index) {
      const ctx = loupe.getContext('2d');
      if (!ctx) return;
      const size = loupe.width;
      const [x, y] = corners[index];
      const shown = box.getBoundingClientRect();
      const perScreen = opened.canvas.width / shown.width; // canvas pixels per screen pixel of the photo
      const span = (LOUPE_SIZE / LOUPE_ZOOM) * perScreen; // canvas pixels across the loupe
      const cx = x * opened.canvas.width;
      const cy = y * opened.canvas.height;
      ctx.fillStyle = '#1d1a17';
      ctx.fillRect(0, 0, size, size);
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(opened.canvas, cx - span / 2, cy - span / 2, span, span, 0, 0, size, size);
      const k = size / span;
      const at = ([px, py]) => [(px * opened.canvas.width - cx) * k + size / 2, (py * opened.canvas.height - cy) * k + size / 2];
      ctx.lineWidth = 3;
      ctx.strokeStyle = '#ffffff';
      ctx.beginPath();
      orderCorners(corners).forEach((c, i) => (i ? ctx.lineTo(...at(c)) : ctx.moveTo(...at(c))));
      ctx.closePath();
      ctx.stroke();
      ctx.lineWidth = 2;
      ctx.strokeStyle = '#a8432a';
      ctx.beginPath();
      ctx.moveTo(size / 2 - 22, size / 2);
      ctx.lineTo(size / 2 + 22, size / 2);
      ctx.moveTo(size / 2, size / 2 - 22);
      ctx.lineTo(size / 2, size / 2 + 22);
      ctx.stroke();
      // away from the finger: at the top on the other side, or at the bottom while a top point is held
      loupe.classList.toggle('is-right', x < 0.5);
      loupe.classList.toggle('is-low', shown.top + y * shown.height - stage.getBoundingClientRect().top < LOUPE_SIZE + 60);
      loupe.hidden = false;
    }

    function showPoints() {
      resultImg.hidden = true;
      working.hidden = true;
      box.hidden = false;
      actions.replaceChildren(
        button('Annulla', 'btn-dark', () => close(null)),
        h('button', { type: 'button', class: 'btn btn-primary', dataset: { use: '' }, onClick: straighten }, icon('check'), 'Raddrizza'),
      );
      layout();
    }

    /* ---------- steps 2 and 3 ---------- */

    function showWorking(text) {
      box.hidden = true;
      resultImg.hidden = true;
      working.hidden = false;
      workingText.textContent = text;
      hint.textContent = '';
      actions.replaceChildren();
    }

    async function straighten() {
      if (!usable() || (needsMove && !moved)) return;
      const chosen = ordered().map(([x, y]) => [x / opened.width, y / opened.height]);
      showWorking('Raddrizzo la foto…');
      await painted(); // the spinner is on the screen before the phone gets busy
      let made;
      try {
        made = await makeStraightened(photo, chosen, measures);
      } catch (err) {
        if (closed) return;
        toast(`${err.message || 'Non è stato possibile raddrizzare la foto.'} La foto è rimasta com’era.`, { type: 'error', duration: 7000 });
        return showPoints();
      }
      if (closed) return;
      if (!made) return close(null);
      if (resultUrl) URL.revokeObjectURL(resultUrl);
      resultUrl = URL.createObjectURL(made.blob);
      resultImg.src = resultUrl;
      working.hidden = true;
      resultImg.hidden = false;
      hint.textContent = made.shape === 'photo' && !measures ? HINTS.resultShape : HINTS.result;
      actions.replaceChildren(
        button('Sposta i punti', 'btn-dark', showPoints),
        button('Sì, va bene', 'btn-primary', () => {
          useStraightened(photo, made, chosen);
          close('kept');
        }, 'check'),
      );
      title.focus({ preventScroll: true });
    }

    /* ---------- open ---------- */

    document.body.append(overlay);
    document.documentElement.classList.add('is-straightening');
    if (appRoot) appRoot.inert = true; // the form under the step cannot be reached
    const leaveEntry = stepEntry(() => close(null, true));
    window.addEventListener('resize', layout);
    window.addEventListener('hashchange', onLeave);
    document.addEventListener('keydown', onKey);
    actions.replaceChildren(button('Annulla', 'btn-dark', () => close(null)));
    title.focus({ preventScroll: true });

    openForStraighten(view.blob).then(
      (result) => {
        if (closed) return result.release();
        opened = result;
        opened.canvas.setAttribute('class', 'straighten-photo');
        opened.canvas.setAttribute('role', 'img');
        opened.canvas.setAttribute('aria-label', 'La tua foto');
        box.append(opened.canvas, outline, ...handles);
        if (view.corners) {
          corners = view.corners;
          startHint = HINTS.remembered;
        } else if (result.guess) {
          corners = result.guess;
          startHint = HINTS.found;
        } else {
          corners = defaultQuad(1, 1); // the whole photo: nothing is cut until she moves a point
          needsMove = true;
        }
        corners = corners.map(([x, y]) => [clamp01(x), clamp01(y)]);
        showPoints();
      },
      (err) => {
        if (closed) return;
        toast(err.message || 'Non riesco a leggere questa foto.', { type: 'error', duration: 6000 });
        close(null);
      },
    );
  });
}
