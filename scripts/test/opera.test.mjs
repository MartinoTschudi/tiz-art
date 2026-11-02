// Tests for the artwork page's layout rules (src/components/lib/opera.ts), imported directly through
// Node's type stripping. Pure numbers: no content is read.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { PAGE_MAX, STAGE, operaCounter, pagerThumbSizes, stageSizes, thumbSizes } from '../../src/components/lib/opera.ts';

/** The width the CSS gives the stage painting at a viewport width (the rule stageSizes encodes). */
function cssWidth(vw, ratio) {
  const layout = STAGE.find((l) => vw >= l.minWidth);
  const column = Math.min(vw, layout.minWidth >= 1024 ? PAGE_MAX : Infinity) - layout.off;
  return Math.min(layout.fitW * column, layout.fitH * layout.height * ratio);
}

/** Evaluates a `sizes` string at a viewport width, like a browser (first matching condition wins). */
function evalSizes(sizes, vw) {
  for (const entry of sizes.split(', ')) {
    const m = entry.match(/^\(min-width: (\d+)px\) (.+)$/);
    const [cond, value] = m ? [Number(m[1]), m[2]] : [0, entry];
    if (vw < cond) continue;
    const calc = value.match(/^calc\(([\d.]+)vw - (\d+)px\)$/);
    if (calc) return (Number(calc[1]) * vw) / 100 - Number(calc[2]);
    return Number(value.replace('px', ''));
  }
  throw new Error(`no entry matches ${vw}`);
}

describe('stageSizes', () => {
  test('Sorellanza (portrait) matches the example', () => {
    assert.equal(
      stageSizes(1574 / 2400),
      '(min-width: 1054px) 434px, (min-width: 1024px) calc(88vw - 493px), (min-width: 640px) 362px, (min-width: 329px) 289px, calc(100vw - 40px)',
    );
  });

  for (const [name, ratio] of [
    ['tall (Estasi)', 60 / 130],
    ['square', 1],
    ['portrait', 0.66],
    ['wide (…e fuori piove)', 1.25],
    ['very wide', 3],
  ]) {
    test(`${name}: within 1px of the CSS width at every viewport`, () => {
      const sizes = stageSizes(ratio);
      for (let vw = 280; vw <= 2000; vw += 7) {
        const expected = cssWidth(vw, ratio);
        const got = evalSizes(sizes, vw);
        assert.ok(Math.abs(got - expected) <= 1, `${name} at ${vw}px: sizes ${got}, css ${expected} (${sizes})`);
      }
    });
  }

  test('a wide work is limited by the page column above 1440 px', () => {
    const sizes = stageSizes(3);
    assert.match(sizes, /^\(min-width: 1440px\) 774px, \(min-width: 1024px\) calc\(88vw - 493px\)/);
  });

  test('a broken ratio falls back to square', () => {
    assert.equal(stageSizes(0), stageSizes(1));
    assert.equal(stageSizes(Number.NaN), stageSizes(1));
  });
});

describe('thumbnails', () => {
  test('fixed height, real proportions', () => {
    assert.equal(thumbSizes(0.5), '(min-width: 640px) 42px, 32px');
    assert.equal(pagerThumbSizes(1.25), '105px');
  });
});

describe('operaCounter', () => {
  test('two digits, total as is', () => {
    assert.deepEqual(operaCounter(0, 12), { nn: '01', total: '12', text: '01 / 12', spoken: 'Opera 1 di 12' });
    assert.equal(operaCounter(11, 12).text, '12 / 12');
    assert.equal(operaCounter(99, 120).text, '100 / 120');
    assert.equal(operaCounter(0, 1).text, '01 / 1');
  });
});
