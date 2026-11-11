/**
 * Photo widgets shared by the artwork form and the profile: the "Scatta foto" / "Dalla galleria"
 * buttons and the picture of one photo in its current state.
 */
import { h, icon, picture } from '../ui.js';

let pickerSeq = 0;

/**
 * Two big buttons backed by hidden file inputs.
 * iPhone: "Scatta foto" opens the camera (capture), "Dalla galleria" the photo library; Safari
 * hands over HEIC photos as JPEG. Returns { el, setDisabled(bool) }.
 */
export function pickerButtons({ multiple = false, onFiles, cameraLabel = 'Scatta foto', galleryLabel = 'Dalla galleria' }) {
  const n = ++pickerSeq;
  const camInput = h('input', { type: 'file', accept: 'image/*', capture: 'environment', id: `cam-${n}`, class: 'sr-only', tabindex: '-1' });
  const galInput = h('input', { type: 'file', accept: 'image/*', multiple, id: `gal-${n}`, class: 'sr-only', tabindex: '-1' });
  const camBtn = h('label', { for: `cam-${n}`, class: 'btn btn-photo', role: 'button', tabindex: '0', dataset: { picker: 'camera' } },
    icon('camera'), h('span', {}, cameraLabel));
  const galBtn = h('label', { for: `gal-${n}`, class: 'btn btn-photo', role: 'button', tabindex: '0', dataset: { picker: 'gallery' } },
    icon('gallery'), h('span', {}, galleryLabel));
  for (const btn of [camBtn, galBtn]) {
    btn.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        btn.click();
      }
    });
  }
  for (const input of [camInput, galInput]) {
    input.addEventListener('change', () => {
      const files = Array.from(input.files || []);
      input.value = ''; // the same photo can be chosen again
      if (files.length) onFiles(files);
    });
  }
  return {
    el: h('div', { class: 'photo-buttons' }, camBtn, galBtn, camInput, galInput),
    setDisabled(disabled) {
      for (const btn of [camBtn, galBtn]) btn.classList.toggle('is-disabled', disabled);
      camInput.disabled = disabled;
      galInput.disabled = disabled;
    },
  };
}

/**
 * The picture of a photo: online (`sources`), prepared on the phone, being prepared, or failed.
 */
export function photoMedia(photo, sources, alt) {
  if (photo.kind === 'existing') return picture(sources, { className: 'tile-img', alt });
  if (photo.status === 'ready') {
    return h(
      'div',
      { class: `tile-img${photo.busy ? ' is-busy' : ''}` },
      h('img', { src: photo.previewUrl, alt }),
      photo.busy ? h('div', { class: 'tile-busy', role: 'status' }, h('div', { class: 'spinner spinner-sm', 'aria-hidden': 'true' }), h('span', {}, 'Preparo…')) : null,
    );
  }
  if (photo.status === 'error') {
    return h('div', { class: 'tile-img tile-error', role: 'alert' }, icon('alert'), h('span', {}, photo.error));
  }
  return h('div', { class: 'tile-img tile-processing' }, h('div', { class: 'spinner spinner-sm', 'aria-hidden': 'true' }), h('span', {}, 'Preparo…'));
}
