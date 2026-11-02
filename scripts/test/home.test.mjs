// Tests for the Home / Opere text rules (src/components/lib/home.ts), imported directly through
// Node's type stripping. No live content is read.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  HERO_PAINTS,
  HERO_SIZES,
  HOME_INTRO,
  QUOTE_SIZES,
  allWorksLabel,
  firstName,
  heroNote,
  longestLine,
  opereCountNote,
  quoteAttribution,
} from '../../src/components/lib/home.ts';
import { PAINTS } from '../../src/components/lib/composition.ts';

describe('hero', () => {
  test('the slot colours of frame 1b, all valid paints', () => {
    assert.deepEqual(HERO_PAINTS, { large: 'rosso', narrow: 'ottanio', small: 'ocra' });
    for (const paint of Object.values(HERO_PAINTS)) assert.ok(PAINTS.includes(paint));
  });

  test('note: "{titolo}, {anno}", the title alone without a year', () => {
    assert.equal(heroNote('Guardami!', 2023), 'Guardami!, 2023');
    assert.equal(heroNote('…e fuori piove', null), '…e fuori piove');
    assert.equal(heroNote('Estasi', undefined), 'Estasi');
  });

  test('longest motto line in characters, at least 8', () => {
    assert.equal(longestLine(['Dialogo tra', 'testa e', 'cuore']), 11);
    assert.equal(longestLine(['Amore']), 8);
    assert.equal(longestLine([]), 8);
    // Characters, not UTF-16 code units.
    assert.equal(longestLine(['àèìòùàèìòù']), 10);
  });

  test('sizes: the reference widths at 1280, the phone width, no min()', () => {
    assert.match(HERO_SIZES.large, /^\(min-width: 1280px\) 400px, /);
    assert.match(HERO_SIZES.large, /\(min-width: 370px\) 290px, calc\(100vw - 80px\)$/);
    assert.match(HERO_SIZES.narrow, /^\(min-width: 1280px\) 150px, /);
    assert.match(HERO_SIZES.small, /^\(min-width: 1280px\) 230px, /);
    assert.match(QUOTE_SIZES, /^\(min-width: 1024px\) 340px, /);
    for (const sizes of [...Object.values(HERO_SIZES), QUOTE_SIZES]) assert.doesNotMatch(sizes, /min\(|max\(/);
  });

  test('the wall formula meets the reference at 1024 and 1280', () => {
    // large = 400/622 × min(622, 0.5253 × (vw − 96)) between 1024 and 1280: calc(33.78vw − 32px)
    const large = (vw) => 0.3378 * vw - 32;
    assert.ok(Math.abs(large(1280) - 400) < 1.5);
    assert.ok(Math.abs(large(1024) - (400 / 622) * 0.5253 * (1024 - 96)) < 1.5);
  });

  test('the intro is Italian copy with its typography', () => {
    assert.match(HOME_INTRO, /^Volti e corpi di donna/);
    assert.doesNotMatch(HOME_INTRO, /'/);
  });
});

describe('series and quote', () => {
  test('"Tutte le {n} opere"', () => {
    assert.equal(allWorksLabel(12), 'Tutte le 12 opere');
    assert.equal(allWorksLabel(60), 'Tutte le 60 opere');
    assert.equal(allWorksLabel(1), 'Vedi l’opera');
  });

  test('first name of the artist', () => {
    assert.equal(firstName('Tiziana Tschudi Belloli'), 'Tiziana');
    assert.equal(firstName('  Tiziana  '), 'Tiziana');
  });

  test('attribution with and without the size', () => {
    assert.equal(quoteAttribution('Tiziana', 'Sorellanza', '120 × 150 cm'), '— Tiziana, su «Sorellanza», 120 × 150 cm');
    assert.equal(quoteAttribution('Tiziana', '…e fuori piove', null), '— Tiziana, su «…e fuori piove»');
  });
});

describe('Opere note', () => {
  test('"{n} tele, appese come nello studio", phone "{n} tele"', () => {
    assert.deepEqual(opereCountNote(12), { short: '12 tele', rest: ', appese come nello studio' });
    assert.deepEqual(opereCountNote(3), { short: '3 tele', rest: ', appese come nello studio' });
  });

  test('one work: "1 tela, appesa come nello studio"', () => {
    assert.deepEqual(opereCountNote(1), { short: '1 tela', rest: ', appesa come nello studio' });
  });
});
