/**
 * Contact form behaviour (markup: ContactForm.astro, rules: CONTRACTS 5.4).
 * Validates in Italian, pre-selects the artwork from `?opera=<slug>`, sends JSON to Web3Forms with
 * fetch and reports the result in place (button disabled while sending, no layout shift).
 */

const TEXT = {
  name: 'Inserisci il tuo nome.',
  emailMissing: 'Inserisci il tuo indirizzo e-mail.',
  emailInvalid: 'Questo indirizzo e-mail non sembra corretto.',
  message: 'Scrivi un messaggio di almeno 10 caratteri.',
  checkFields: 'Controlla i campi evidenziati.',
  sending: 'Invio in corso…',
  success: 'Grazie! Il messaggio è stato inviato: ti risponderò al più presto.',
  failure: 'Non è stato possibile inviare il messaggio. Riprova tra qualche minuto.',
  inactive: 'Il modulo non è ancora attivo.',
} as const;

const MIN_MESSAGE = 10;
const SITE_NAME = 'tiz-art.ch';

type FieldName = 'name' | 'email' | 'message';
type Control = HTMLInputElement | HTMLTextAreaElement;

/** Italian error for a field, or "" when it is valid. */
function errorFor(name: FieldName, control: Control): string {
  const value = control.value.trim();
  if (name === 'name') return value ? '' : TEXT.name;
  if (name === 'email') {
    if (!value) return TEXT.emailMissing;
    return control.validity.typeMismatch ? TEXT.emailInvalid : '';
  }
  return value.length >= MIN_MESSAGE ? '' : TEXT.message;
}

function setupForm(form: HTMLFormElement) {
  const active = form.dataset.active === 'true';
  const submit = form.querySelector<HTMLButtonElement>('[data-submit]')!;
  const submitLabel = submit.textContent ?? '';
  const status = form.querySelector<HTMLElement>('[data-status]')!;
  const select = form.querySelector<HTMLSelectElement>('select[name="opera"]');
  const fields = (['name', 'email', 'message'] as const).map((name) => ({
    name,
    control: form.elements.namedItem(name) as Control,
    error: form.querySelector<HTMLElement>(`[data-error-for="${name}"]`)!,
  }));
  let attempted = false;

  form.noValidate = true; // our Italian messages replace the browser's

  const showStatus = (message: string, tone?: 'success' | 'error') => {
    status.textContent = message;
    if (tone) status.dataset.tone = tone;
    else delete status.dataset.tone;
  };

  const validate = (field: (typeof fields)[number]) => {
    const message = errorFor(field.name, field.control);
    field.error.textContent = message;
    field.control.setAttribute('aria-invalid', String(Boolean(message)));
    return !message;
  };

  // After the first attempt, errors update while typing.
  for (const field of fields) {
    field.control.addEventListener('input', () => attempted && validate(field));
  }

  const refreshOpera = select ? setupOperaSelect(form, select) : () => {};

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    attempted = true;
    const invalid = fields.filter((field) => !validate(field));
    if (invalid.length > 0) {
      showStatus(TEXT.checkFields, 'error');
      invalid[0].control.focus();
      return;
    }
    if (!active) return showStatus(TEXT.inactive, 'error');

    const data = new FormData(form);
    const chosen = select?.selectedOptions[0]?.value ? select.selectedOptions[0] : null;

    // Honeypot ticked: pretend it worked, send nothing.
    if (data.get('botcheck')) {
      form.reset();
      refreshOpera();
      return showStatus(TEXT.success, 'success');
    }

    const payload = {
      access_key: data.get('access_key'),
      subject: chosen ? `Richiesta su «${chosen.dataset.title}» — ${SITE_NAME}` : data.get('subject'),
      from_name: SITE_NAME,
      name: String(data.get('name')).trim(),
      email: String(data.get('email')).trim(),
      message: String(data.get('message')).trim(),
      ...(chosen ? { opera: `${chosen.dataset.title} — ${chosen.dataset.url}` } : {}),
    };

    submit.disabled = true;
    submit.textContent = TEXT.sending;
    showStatus('');
    try {
      const response = await fetch(form.action, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(payload),
      });
      const result = (await response.json().catch(() => null)) as { success?: boolean } | null;
      if (!response.ok || !result?.success) throw new Error(`Web3Forms: HTTP ${response.status}`);
      form.reset();
      refreshOpera();
      attempted = false;
      showStatus(TEXT.success, 'success');
    } catch {
      showStatus(TEXT.failure, 'error');
    } finally {
      submit.disabled = false;
      submit.textContent = submitLabel;
    }
  });
}

/**
 * Pre-selects `?opera=<slug>` and shows the chosen work's thumbnail under the select.
 * Returns the function that redraws the preview (needed after form.reset()).
 */
function setupOperaSelect(form: HTMLFormElement, select: HTMLSelectElement): () => void {
  const preview = form.querySelector<HTMLElement>('[data-opera-preview]')!;
  const image = preview.querySelector<HTMLImageElement>('[data-opera-image]')!;
  const title = preview.querySelector<HTMLElement>('[data-opera-title]')!;
  const meta = preview.querySelector<HTMLElement>('[data-opera-meta]')!;

  const update = () => {
    const option = select.selectedOptions[0];
    if (!option?.value) {
      preview.hidden = true;
      return;
    }
    image.src = option.dataset.thumb ?? '';
    title.textContent = option.dataset.title ?? '';
    meta.textContent = option.dataset.meta ?? '';
    preview.hidden = false;
  };

  const requested = new URLSearchParams(location.search).get('opera');
  if (requested && [...select.options].some((option) => option.value === requested)) select.value = requested;

  select.addEventListener('change', update);
  update();
  return update;
}

export function initContactForms() {
  document.querySelectorAll<HTMLFormElement>('form[data-contact-form]').forEach(setupForm);
}
