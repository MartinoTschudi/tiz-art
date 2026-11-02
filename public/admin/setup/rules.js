/**
 * Rules for the admin's e-mail, password and token, shared by the setup page (setup.js) and the
 * terminal setup (scripts/admin-setup.mjs), so both accept exactly the same values.
 *
 * Why the password rules matter: auth.json is public, and every old version stays in the public git
 * history. Anyone can try passwords against it offline, forever, at thousands of guesses per second
 * (the e-mail is mixed into the key, but it is no secret). So a guessable password — her name, an
 * artwork title plus a year, one word plus digits — is refused, and a random passphrase is offered.
 */
import { normalizeEmail } from '../js/crypto.js';

export const MIN_PASSWORD_LENGTH = 12;
/** Without 3 separate words, a password must be at least this long and mostly random characters. */
export const LONG_PASSWORD_LENGTH = 16;

/** Parts that make a password easy to guess wherever they appear (compared without case and accents). */
const GUESSABLE = ['password', 'passwort', 'qwert', 'azert', '12345', 'tiziana', 'tschudi', 'belloli', 'tizart', 'tiz-art'];

/** Lower case, accents removed: "Tiziàna" → "tiziana". */
const fold = (text) => String(text).normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

/** Very small sanity check (the login only compares, it never sends e-mails). */
export function isEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizeEmail(email));
}

/** Password policy. Returns a problem (Italian) or null. */
export function checkPassword(password, email = '') {
  const pw = String(password ?? '');
  if (pw.length < MIN_PASSWORD_LENGTH) return `La password deve avere almeno ${MIN_PASSWORD_LENGTH} caratteri.`;
  if (/^(.)\1+$/su.test(pw)) return 'La password è un solo carattere ripetuto.';
  if (/^(.+?)\1+$/su.test(pw)) return 'La password ripete sempre la stessa parte: è troppo facile da indovinare.';
  const plain = fold(pw);
  const local = fold(normalizeEmail(email).split('@')[0]);
  const emailParts = [local, ...local.split(/[._+-]+/)].filter((part) => part.length >= 4);
  if (emailParts.some((part) => plain.includes(part))) return 'Non usare l’e-mail (o una sua parte) nella password.';
  if (GUESSABLE.some((word) => plain.includes(word))) {
    return 'La password è troppo facile da indovinare: niente nomi, «tiz-art», «password» o «12345».';
  }
  // "Sorellanza2023", "Contemporaneamente!", "Sorellanza2023Estasi": one or two words (+ digits or
  // signs) fall quickly to a dictionary built from the site. Accepted: 3 different words, or a long
  // random string (16+ characters, mostly not words, with at least 3 kinds of characters).
  const runs = plain.match(/\p{L}{3,}/gu) || [];
  const kinds = [/\p{Ll}/u, /\p{Lu}/u, /\d/, /[^\p{L}\d]/u].filter((re) => re.test(pw)).length;
  const random = pw.length >= LONG_PASSWORD_LENGTH && runs.join('').length * 2 < pw.length && kinds >= 3;
  if (new Set(runs).size < 3 && !random) {
    return 'Usa almeno tre parole diverse, separate da un trattino o da uno spazio (per esempio come la password proposta).';
  }
  return null;
}

/**
 * A passphrase of `words` pronounceable made-up words, e.g. "toravi-memuso-bilena-carepo"
 * (each word ≈ 18 bits, ≈ 73 bits in all): strong and easy to type on a phone.
 * crypto.getRandomValues works in the browser and in Node; rejection sampling keeps every letter
 * equally likely.
 */
export function suggestPassphrase(words = 4) {
  const pick = (alphabet) => {
    const limit = 256 - (256 % alphabet.length);
    for (;;) {
      const [byte] = globalThis.crypto.getRandomValues(new Uint8Array(1));
      if (byte < limit) return alphabet[byte % alphabet.length];
    }
  };
  const syllable = () => pick('bcdfglmnprstvz') + pick('aeiou');
  return Array.from({ length: words }, () => syllable() + syllable() + syllable()).join('-');
}

/** A passphrase that also passes checkPassword for this e-mail (it could contain a part of it). */
export function suggestPasswordFor(email = '') {
  let p = suggestPassphrase();
  for (let i = 0; i < 20 && checkPassword(p, email); i++) p = suggestPassphrase();
  return p;
}

/**
 * A GitHub token is one word: no spaces, no line breaks (a frequent copy-paste mistake). Only a
 * fine-grained token limited to this repository belongs in the public auth.json: a classic or OAuth
 * token (ghp_, gho_, ghu_, ghs_, ghr_) would open every repository of the account if it ever leaked.
 */
export function checkToken(token) {
  const t = String(token ?? '').trim();
  if (!t) return 'Incolla il token di GitHub.';
  if (/\s/.test(t)) return 'Il token contiene spazi: copialo di nuovo da GitHub.';
  if (/^gh[pousr]_/.test(t)) {
    return 'Serve un token «fine-grained» (inizia con github_pat_) solo per questo repository, non un token classico.';
  }
  return null;
}
