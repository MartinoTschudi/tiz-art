// «Le mie opere» shows which works are really in the home composition: list.js homeSlugs must pick
// the same works as the site (src/components/lib/composition.ts heroSlots, imported through Node's
// type stripping). The works below are made up for the test, never the live src/content.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { homeSlugs } from '../../public/admin/js/screens/list.js';
import { heroSlots } from '../../src/components/lib/composition.ts';

/** A work as the admin holds it ({ slug, data }), in list order. */
const work = (slug, { pubblicata = true, inEvidenza = false } = {}) => ({ slug, data: { titolo: slug, pubblicata, inEvidenza } });

/** The works the site puts in the hero (featured first, then the fill). */
function siteHero(opere) {
  const published = opere.filter((o) => o.data.pubblicata).map((o) => ({ id: o.slug, featured: o.data.inEvidenza, w: 100, h: 100, ratio: 1 }));
  return new Set(heroSlots(published).picked.map((w) => w.id));
}

describe('which works are in the home composition', () => {
  const cases = {
    'four featured: only the first three': [work('a', { inEvidenza: true }), work('b'), work('c', { inEvidenza: true }), work('d', { inEvidenza: true }), work('e', { inEvidenza: true })],
    'a hidden featured work does not count': [work('a', { inEvidenza: true, pubblicata: false }), work('b', { inEvidenza: true }), work('c', { inEvidenza: true }), work('d', { inEvidenza: true })],
    'fewer than three featured': [work('a'), work('b', { inEvidenza: true }), work('c')],
    'none featured': [work('a'), work('b')],
  };
  for (const [name, opere] of Object.entries(cases)) {
    test(name, () => {
      assert.deepEqual([...homeSlugs(opere)].sort(), [...siteHero(opere)].sort());
    });
  }

  test('the fourth featured work is not in the home; with fewer than 3, the first others fill in', () => {
    const home = homeSlugs(cases['four featured: only the first three']);
    assert.deepEqual([...home], ['a', 'c', 'd']);
    assert.equal(home.has('e'), false);
    assert.deepEqual([...homeSlugs(cases['fewer than three featured'])], ['b', 'a', 'c']);
    assert.deepEqual([...homeSlugs(cases['a hidden featured work does not count'])], ['b', 'c', 'd']);
  });
});
