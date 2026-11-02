// Tests for the Home / Opere text rules (src/components/lib/home.ts), imported directly through
// Node's type stripping. No live content is read.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
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

describe('hero', () => {
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

  test('sizes from 1024 to 1280 follow the wall: min(622, 52.53% of vw − 96) × the slot share', () => {
    const share = { large: 400 / 622, narrow: 150 / 622, small: 230 / 622 };
    for (const [slot, sizes] of Object.entries(HERO_SIZES)) {
      const [, a, b] = sizes.match(/\(min-width: 1024px\) calc\(([\d.]+)vw - ([\d.]+)px\)/);
      const fromSizes = (vw) => (Number(a) * vw) / 100 - Number(b);
      const rendered = (vw) => share[slot] * Math.min(622, 0.5253 * (vw - 96));
      for (const vw of [1024, 1152, 1279]) assert.ok(Math.abs(fromSizes(vw) - rendered(vw)) < 1.5, `${slot} at ${vw}px`);
    }
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
