/**
 * Contact form behaviour (markup: ContactForm.astro; rules and texts: lib/contatti.ts; CONTRACTS 5.4).
 *
 * - Validation in Italian: on "Invia" every field is checked, the error shows under its field
 *   (aria-describedby, aria-invalid), focus goes to the first wrong one, and from then on the errors
 *   follow the typing. The input is never cleared on an error.
 * - Sending: JSON POST to Web3Forms. The button is aria-disabled meanwhile (not `disabled`, so it
 *   keeps focus) and a second click does nothing; the status line says "Invio in corso…".
 * - Success: "Grazie!" replaces the form, focus moves to its heading and the live region announces
 *   the line under it. "Scrivi ancora" brings back the empty form (the chosen work stays, as in the
 *   design) with focus in the first field.
 * - The chosen work: the inline script in ContactForm.astro has already drawn the chip for `?opera=`
 *   (data-slug); here it fills the hidden `opera` field and the subject, and its × removes it: the
 *   field is cleared and disabled, the subject goes back to the default, `?opera` leaves the URL
 *   (history.replaceState), focus moves to the first field.
 * - Empty access key: after validation, the note "Il modulo non è ancora attivo" (nothing is sent).
 * - Honeypot ticked: pretend it worked, send nothing.
 */
import {
  MESSAGES,
  buildPayload,
  fieldError,
  isSent,
  operaLine,
  subjectFor,
  withoutOpera,
  type ChosenOpera,
  type FieldName,
} from './lib/contatti';

/** A request that has not answered after this long counts as failed. */
const TIMEOUT_MS = 20_000;

type Control = HTMLInputElement | HTMLTextAreaElement;
type Tone = 'busy' | 'error' | 'failure' | 'inactive';

interface Field {
  name: FieldName;
  control: Control;
  error: HTMLElement;
}

/** The work whose chip the inline script showed, from the JSON embedded in the page. */
function readChosen(form: HTMLFormElement, chip: HTMLElement | null): ChosenOpera | null {
  const slug = chip && !chip.hidden ? chip.dataset.slug : undefined;
  if (!slug) return null;
  try {
    const works = JSON.parse(form.querySelector('[data-contact-opere]')?.textContent ?? '[]') as ChosenOpera[];
    const work = works.find((candidate) => candidate.slug === slug);
    return work ? { slug: work.slug, titolo: work.titolo, url: work.url } : null;
  } catch {
    return null;
  }
}

function setup(root: HTMLElement) {
  const form = root.querySelector<HTMLFormElement>('form[data-contact-form]');
  const success = root.querySelector<HTMLElement>('[data-contact-success]');
  const submit = form?.querySelector<HTMLButtonElement>('[data-submit]');
  const status = form?.querySelector<HTMLElement>('[data-status]');
  const live = root.querySelector<HTMLElement>('[data-contact-live]');
  if (!form || !success || !submit || !status || !live) return;

  const statusTitle = status.querySelector<HTMLElement>('[data-status-title]')!;
  const statusText = status.querySelector<HTMLElement>('[data-status-text]')!;
  const heading = success.querySelector<HTMLElement>('[data-grazie-title]')!;
  const again = success.querySelector<HTMLButtonElement>('[data-contact-again]')!;
  const chip = form.querySelector<HTMLElement>('[data-opera-chip]');
  const operaField = form.elements.namedItem('opera') as HTMLInputElement;
  const subjectField = form.elements.namedItem('subject') as HTMLInputElement;
  const active = form.dataset.active === 'true';
  const fields: Field[] = (['name', 'email', 'message'] as const).map((name) => ({
    name,
    control: form.elements.namedItem(name) as Control,
    error: form.querySelector<HTMLElement>(`[data-error-for="${name}"]`)!,
  }));

  let chosen = readChosen(form, chip);
  let attempted = false;
  let sending = false;

  // Our Italian messages replace the browser's; the button is usable (it is off without JS only
  // while the form is not active); the no-JS notice is not needed.
  form.noValidate = true;
  submit.disabled = false;
  submit.removeAttribute('aria-describedby');
  form.querySelector('[data-contact-offline]')?.remove();

  const choose = (work: ChosenOpera | null) => {
    chosen = work;
    operaField.value = work ? operaLine(work) : '';
    operaField.disabled = !work;
    subjectField.value = subjectFor(work);
  };
  choose(chosen);

  const announce = (text: string) => {
    live.textContent = '';
    // A moment later, so it is read after the focus change, not swallowed by it.
    window.setTimeout(() => (live.textContent = text), 150);
  };

  const showStatus = (tone?: Tone, text = '', title = '') => {
    if (tone) status.dataset.tone = tone;
    else delete status.dataset.tone;
    statusTitle.textContent = title;
    statusText.textContent = text;
    // The slot is below the privacy note: on a phone it may be under the fold after "Invia". (An
    // error summary needs no scrolling: focus goes to the first wrong field.)
    if (tone === 'inactive' || tone === 'failure') status.scrollIntoView({ block: 'nearest' });
  };

  const validate = (field: Field) => {
    const message = fieldError(field.name, field.control.value);
    field.error.textContent = message;
    if (message) field.control.setAttribute('aria-invalid', 'true');
    else field.control.removeAttribute('aria-invalid');
    return !message;
  };

  const clearErrors = () => {
    attempted = false;
    for (const field of fields) {
      field.error.textContent = '';
      field.control.removeAttribute('aria-invalid');
    }
  };

  // After the first attempt, the errors follow the typing (and the summary goes once all is right).
  for (const field of fields) {
    field.control.addEventListener('input', () => {
      if (!attempted) return;
      validate(field);
      if (status.dataset.tone === 'error' && fields.every(({ control, name }) => !fieldError(name, control.value))) showStatus();
    });
  }

  if (chip) {
    chip.querySelector('[data-opera-clear]')?.addEventListener('click', () => {
      choose(null);
      chip.hidden = true;
      history.replaceState(history.state, '', withoutOpera(location.href));
      fields[0].control.focus();
      announce(MESSAGES.operaRemoved);
    });
  }

  const setSending = (on: boolean) => {
    sending = on;
    if (on) submit.setAttribute('aria-disabled', 'true');
    else submit.removeAttribute('aria-disabled');
  };

  const showSuccess = () => {
    form.reset(); // empties the fields; the hidden opera / subject keep the chosen work
    choose(chosen);
    clearErrors();
    showStatus();
    form.hidden = true;
    success.hidden = false;
    heading.focus();
    announce(MESSAGES.sent);
  };

  again.addEventListener('click', () => {
    success.hidden = true;
    form.hidden = false;
    live.textContent = '';
    fields[0].control.focus();
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (sending) return;

    attempted = true;
    const invalid = fields.filter((field) => !validate(field));
    if (invalid.length > 0) {
      showStatus('error', MESSAGES.checkFields);
      invalid[0].control.focus();
      return;
    }
    if (!active) {
      showStatus('inactive', MESSAGES.inactive, MESSAGES.inactiveTitle);
      return;
    }

    const data = new FormData(form);
    if (data.get('botcheck')) {
      showSuccess();
      return;
    }

    const payload = buildPayload({
      accessKey: String(data.get('access_key') ?? ''),
      name: String(data.get('name') ?? ''),
      email: String(data.get('email') ?? ''),
      message: String(data.get('message') ?? ''),
      opera: chosen,
    });

    setSending(true);
    showStatus('busy', MESSAGES.sending);
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const response = await fetch(form.action, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      const body: unknown = await response.json().catch(() => null);
      if (!isSent(response.status, body)) throw new Error(`Web3Forms: HTTP ${response.status}`);
      showSuccess();
    } catch {
      showStatus('failure', MESSAGES.failure, MESSAGES.failureTitle);
    } finally {
      window.clearTimeout(timer);
      setSending(false);
    }
  });
}

export function initContactForms() {
  document.querySelectorAll<HTMLElement>('[data-contact]').forEach(setup);
}
