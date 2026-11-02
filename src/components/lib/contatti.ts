/**
 * Contact form rules (CONTRACTS 5.4) as pure functions: the Italian messages, field validation, the
 * Web3Forms JSON payload and the page URL without `?opera`. Used by ContactForm.astro (build time) and
 * contact-form.ts (browser).
 *
 * No DOM, no `astro:*` imports and only erasable TypeScript, so scripts/test/contatti.test.mjs imports
 * this file directly through Node's type stripping.
 */

export const WEB3FORMS_ENDPOINT = 'https://api.web3forms.com/submit';
/** `from_name` of every message, and the end of the subject. */
export const FROM_NAME = 'tiz-art.ch';
/** Subject without a chosen work (also the hidden field of the no-JS POST). */
export const SUBJECT = 'Nuovo messaggio da tiz-art.ch';
/** The message needs at least this many characters (spaces at the ends do not count). */
export const MIN_MESSAGE = 10;
/** maxlength of the fields. */
export const LIMITS = { name: 120, email: 200, message: 5000 } as const;

/** Every text the form shows or announces (Italian). Field errors fit one line at 320 px. */
export const MESSAGES = {
  nameMissing: 'Inserisci il tuo nome.',
  emailMissing: 'Inserisci la tua e-mail.',
  emailInvalid: 'Questa e-mail non sembra corretta.',
  messageMissing: 'Scrivi il tuo messaggio.',
  messageShort: `Scrivi almeno ${MIN_MESSAGE} caratteri.`,
  checkFields: 'Controlla i campi qui sopra.',
  sending: 'Invio in corso…',
  failureTitle: 'Il messaggio non è partito.',
  failure: 'Riprova tra qualche minuto: quello che hai scritto resta qui.',
  inactiveTitle: 'Il modulo non è ancora attivo.',
  inactive: 'Il messaggio non è partito: quello che hai scritto resta qui.',
  sent: 'Il tuo messaggio è arrivato. Ti rispondo presto.',
  operaRemoved: 'Opera tolta dal messaggio.',
} as const;

export type FieldName = 'name' | 'email' | 'message';

/** A work the message is about (from the data embedded in the contact page). */
export interface ChosenOpera {
  slug: string;
  titolo: string;
  /** Absolute URL of the work's page. */
  url: string;
}

/**
 * A plausible e-mail address: something@domain.tld, no spaces, one @, no empty labels. Deliberately
 * lenient (accented domains are fine): it catches typos such as a missing @ or ".ch", the rest is up
 * to Web3Forms.
 */
const EMAIL = /^[^\s@]+@[^\s@.]+(?:\.[^\s@.]+)+$/u;

export function isEmail(value: string): boolean {
  return EMAIL.test(value.trim());
}

/** Characters as people count them (an emoji is one), without the spaces at the ends. */
function length(value: string): number {
  return [...value.trim()].length;
}

/** The Italian error for a field value, or "" when it is valid. */
export function fieldError(name: FieldName, value: string): string {
  const text = value.trim();
  if (name === 'name') return text ? '' : MESSAGES.nameMissing;
  if (name === 'email') {
    if (!text) return MESSAGES.emailMissing;
    return isEmail(text) ? '' : MESSAGES.emailInvalid;
  }
  if (!text) return MESSAGES.messageMissing;
  return length(text) >= MIN_MESSAGE ? '' : MESSAGES.messageShort;
}

/** "Richiesta su «Sorellanza» — tiz-art.ch", or the plain subject without a work. */
export function subjectFor(opera: ChosenOpera | null): string {
  return opera ? `Richiesta su «${opera.titolo}» — ${FROM_NAME}` : SUBJECT;
}

/** The `opera` field: "Sorellanza — https://tiz-art.ch/opere/sorellanza/". */
export function operaLine(opera: ChosenOpera): string {
  return `${opera.titolo} — ${opera.url}`;
}

export interface Web3FormsPayload {
  access_key: string;
  subject: string;
  from_name: string;
  name: string;
  email: string;
  message: string;
  opera?: string;
}

/**
 * The JSON body sent to Web3Forms (CONTRACTS 5.4). Values are trimmed; `opera` only when a work is
 * chosen. The honeypot is never part of it (a filled honeypot sends nothing at all).
 */
export function buildPayload(input: {
  accessKey: string;
  name: string;
  email: string;
  message: string;
  opera: ChosenOpera | null;
}): Web3FormsPayload {
  const payload: Web3FormsPayload = {
    access_key: input.accessKey.trim(),
    subject: subjectFor(input.opera),
    from_name: FROM_NAME,
    name: input.name.trim(),
    email: input.email.trim(),
    message: input.message.trim(),
  };
  if (input.opera) payload.opera = operaLine(input.opera);
  return payload;
}

/** The same URL without the `opera` parameter (other parameters and the #hash stay). */
export function withoutOpera(href: string): string {
  const url = new URL(href);
  url.searchParams.delete('opera');
  return url.href;
}

/** True when the Web3Forms answer means "sent": HTTP 2xx and `{ "success": true }`. */
export function isSent(status: number, body: unknown): boolean {
  return status >= 200 && status < 300 && typeof body === 'object' && body !== null && (body as { success?: unknown }).success === true;
}
