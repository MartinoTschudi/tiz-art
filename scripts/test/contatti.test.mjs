// Tests for the contact form rules (src/components/lib/contatti.ts, CONTRACTS 5.4), imported directly
// through Node's type stripping. No network, no live src/content.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  FROM_NAME,
  MESSAGES,
  MIN_MESSAGE,
  SUBJECT,
  WEB3FORMS_ENDPOINT,
  buildPayload,
  fieldError,
  isEmail,
  isSent,
  operaLine,
  subjectFor,
  withoutOpera,
} from '../../src/components/lib/contatti.ts';

const SORELLANZA = { slug: 'sorellanza', titolo: 'Sorellanza', url: 'https://tiz-art.ch/opere/sorellanza/' };

describe('constants', () => {
  test('endpoint, sender and default subject', () => {
    assert.equal(WEB3FORMS_ENDPOINT, 'https://api.web3forms.com/submit');
    assert.equal(FROM_NAME, 'tiz-art.ch');
    assert.equal(SUBJECT, 'Nuovo messaggio da tiz-art.ch');
    assert.equal(MIN_MESSAGE, 10);
  });

  test('messages use Italian typography (no straight apostrophe, … not ...)', () => {
    for (const text of Object.values(MESSAGES)) {
      assert.doesNotMatch(text, /'/, text);
      assert.doesNotMatch(text, /\.\.\./, text);
    }
    assert.equal(MESSAGES.inactiveTitle, 'Il modulo non è ancora attivo.');
  });
});

describe('isEmail', () => {
  test('accepts ordinary addresses', () => {
    for (const ok of ['maria@example.ch', 'a.b+c@sub.example.co.uk', '  maria@example.ch  ', 'tiz@müller.ch', "o'brien@example.ie"]) {
      assert.equal(isEmail(ok), true, ok);
    }
  });

  test('rejects typos', () => {
    for (const bad of ['', 'maria', 'maria@', '@example.ch', 'maria@example', 'maria@example,ch', 'maria@@example.ch', 'ma ria@example.ch', 'maria@.ch', 'maria@example..ch', 'maria@example.ch.']) {
      assert.equal(isEmail(bad), false, bad);
    }
  });
});

describe('fieldError', () => {
  test('name is required (spaces only do not count)', () => {
    assert.equal(fieldError('name', ''), MESSAGES.nameMissing);
    assert.equal(fieldError('name', '   '), MESSAGES.nameMissing);
    assert.equal(fieldError('name', 'Maria'), '');
  });

  test('email: missing vs malformed', () => {
    assert.equal(fieldError('email', ' '), MESSAGES.emailMissing);
    assert.equal(fieldError('email', 'maria@example'), MESSAGES.emailInvalid);
    assert.equal(fieldError('email', 'maria@example.ch'), '');
  });

  test('message: required and at least 10 characters after trimming', () => {
    assert.equal(fieldError('message', ''), MESSAGES.messageMissing);
    assert.equal(fieldError('message', '   ciao   '), MESSAGES.messageShort);
    assert.equal(fieldError('message', '123456789'), MESSAGES.messageShort);
    assert.equal(fieldError('message', '1234567890'), '');
    assert.equal(fieldError('message', '  1234567890  '), '');
  });

  test('message length counts characters, not UTF-16 units', () => {
    assert.equal(fieldError('message', '🎨🎨🎨🎨🎨'), MESSAGES.messageShort); // 10 UTF-16 units, 5 characters
    assert.equal(fieldError('message', 'Bellissimo'), '');
  });
});

describe('subject and opera line', () => {
  test('subject names the work in « »', () => {
    assert.equal(subjectFor(null), 'Nuovo messaggio da tiz-art.ch');
    assert.equal(subjectFor(SORELLANZA), 'Richiesta su «Sorellanza» — tiz-art.ch');
    assert.equal(subjectFor({ ...SORELLANZA, titolo: '…e fuori piove' }), 'Richiesta su «…e fuori piove» — tiz-art.ch');
  });

  test('opera = title + URL', () => {
    assert.equal(operaLine(SORELLANZA), 'Sorellanza — https://tiz-art.ch/opere/sorellanza/');
  });
});

describe('buildPayload', () => {
  const base = { accessKey: ' key-123 ', name: '  Maria Rossi ', email: ' maria@example.ch ', message: '  Vorrei vedere il quadro dal vivo.  ' };

  test('without a work: exactly the CONTRACTS 5.4 keys, trimmed, no opera, no honeypot', () => {
    const payload = buildPayload({ ...base, opera: null });
    assert.deepEqual(payload, {
      access_key: 'key-123',
      subject: 'Nuovo messaggio da tiz-art.ch',
      from_name: 'tiz-art.ch',
      name: 'Maria Rossi',
      email: 'maria@example.ch',
      message: 'Vorrei vedere il quadro dal vivo.',
    });
    assert.equal('opera' in payload, false);
    assert.equal('botcheck' in payload, false);
    assert.equal('redirect' in payload, false);
  });

  test('with a work: subject with the title, opera = title + URL', () => {
    const payload = buildPayload({ ...base, opera: SORELLANZA });
    assert.equal(payload.subject, 'Richiesta su «Sorellanza» — tiz-art.ch');
    assert.equal(payload.opera, 'Sorellanza — https://tiz-art.ch/opere/sorellanza/');
    assert.deepEqual(Object.keys(payload), ['access_key', 'subject', 'from_name', 'name', 'email', 'message', 'opera']);
  });

  test('keeps line breaks inside the message', () => {
    assert.equal(buildPayload({ ...base, message: 'Riga uno\n\nRiga due', opera: null }).message, 'Riga uno\n\nRiga due');
  });
});

describe('withoutOpera', () => {
  test('drops only the opera parameter', () => {
    assert.equal(withoutOpera('https://tiz-art.ch/contatti/?opera=sorellanza'), 'https://tiz-art.ch/contatti/');
    assert.equal(
      withoutOpera('https://martinotschudi.github.io/tiz-art/contatti/?a=1&opera=estasi&b=2#modulo'),
      'https://martinotschudi.github.io/tiz-art/contatti/?a=1&b=2#modulo',
    );
    assert.equal(withoutOpera('https://tiz-art.ch/contatti/'), 'https://tiz-art.ch/contatti/');
  });
});

describe('isSent', () => {
  test('only 2xx with success: true', () => {
    assert.equal(isSent(200, { success: true, message: 'Email sent successfully!' }), true);
    assert.equal(isSent(200, { success: false }), false);
    assert.equal(isSent(200, { success: 'true' }), false);
    assert.equal(isSent(400, { success: true }), false);
    assert.equal(isSent(500, null), false);
    assert.equal(isSent(200, null), false);
  });
});
