/**
 * Rules for the admin's e-mail and password, shared by the setup page (setup.js) and the
 * terminal setup (scripts/admin-setup.mjs), so both accept exactly the same values.
 */
import { normalizeEmail } from '../js/crypto.js';

export const MIN_PASSWORD_LENGTH = 12;

/** Very small sanity check (the login only compares, it never sends e-mails). */
export function isEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizeEmail(email));
}

/** Basic password policy. Returns a problem (Italian) or null. */
export function checkPassword(password, email = '') {
  const pw = String(password ?? '');
  if (pw.length < MIN_PASSWORD_LENGTH) return `La password deve avere almeno ${MIN_PASSWORD_LENGTH} caratteri.`;
  if (/^(.)\1+$/.test(pw)) return 'La password è un solo carattere ripetuto.';
  if (/^(password|passwort|12345|qwert|tiziana|tiz-art)/i.test(pw)) return 'La password è troppo facile da indovinare.';
  const local = normalizeEmail(email).split('@')[0];
  if (local.length >= 4 && pw.toLowerCase().includes(local)) return 'Non usare l’e-mail (o una sua parte) nella password.';
  return null;
}

/** A GitHub token is one word: no spaces, no line breaks (a frequent copy-paste mistake). */
export function checkToken(token) {
  const t = String(token ?? '').trim();
  if (!t) return 'Incolla il token di GitHub.';
  if (/\s/.test(t)) return 'Il token contiene spazi: copialo di nuovo da GitHub.';
  return null;
}
