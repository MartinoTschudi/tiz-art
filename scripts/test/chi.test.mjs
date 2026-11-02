// Tests for the "Chi sono" picture rules (src/components/lib/chi.ts), imported directly through Node's
// type stripping. Fixed sample ratios only, never the live src/content.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { CHI_BOXES, PORTRAIT_RATIO, chiSizes, coverFactor, fitWidth } from '../../src/components/lib/chi.ts';

const [desktop, tablet, phone] = CHI_BOXES;

describe('fitWidth', () => {
  test('the 4:5 portrait fills the box of every breakpoint', () => {
    assert.equal(fitWidth(desktop, PORTRAIT_RATIO), 400);
    assert.equal(fitWidth(tablet, PORTRAIT_RATIO), 360);
    assert.equal(fitWidth(phone, PORTRAIT_RATIO), 280);
  });

  test('a tall painting is limited by the box height, a wide one by its width', () => {
    // «Estasi» 60 × 130 cm, «…e fuori piove» 150 × 120 cm.
    assert.equal(fitWidth(desktop, 60 / 130), 231);
    assert.equal(fitWidth(phone, 60 / 130), 162);
    assert.equal(fitWidth(desktop, 150 / 120), 400);
    assert.equal(fitWidth(desktop, 1), 400);
  });

  test('a broken ratio counts as square', () => {
    assert.equal(fitWidth(desktop, 0), 400);
    assert.equal(fitWidth(desktop, Number.NaN), 400);
  });
});

describe('coverFactor', () => {
  test('a photo as tall as the box or taller is drawn at the box width', () => {
    assert.equal(coverFactor(PORTRAIT_RATIO, PORTRAIT_RATIO), 1);
    assert.equal(coverFactor(PORTRAIT_RATIO, 3 / 4), 1);
  });

  test('a wider photo is scaled to the box height', () => {
    assert.equal(coverFactor(PORTRAIT_RATIO, 1), 1.25);
  });
});

describe('chiSizes', () => {
  test('portrait 4:5 (frames 1h / 1i)', () => {
    assert.equal(
      chiSizes(PORTRAIT_RATIO, { cover: true }),
      '(min-width: 1024px) 400px, (min-width: 640px) 360px, (min-width: 360px) 280px, calc(100vw - 80px)',
    );
  });

  test('a square portrait photo needs a wider image to cover the 4:5 box', () => {
    assert.equal(
      chiSizes(1, { cover: true }),
      '(min-width: 1024px) 500px, (min-width: 640px) 450px, (min-width: 360px) 350px, calc((100vw - 80px) * 1.25)',
    );
  });

  test('paintings are fitted at their own ratio', () => {
    assert.equal(chiSizes(1), '(min-width: 1024px) 400px, (min-width: 640px) 360px, (min-width: 360px) 280px, calc(100vw - 80px)');
    assert.equal(chiSizes(60 / 130), '(min-width: 1024px) 231px, (min-width: 640px) 208px, (min-width: 242px) 162px, calc(100vw - 80px)');
  });

  test('every entry but the last has a media condition', () => {
    for (const ratio of [0.3, 0.8, 1, 1.25, 3]) {
      const parts = chiSizes(ratio).split(', ');
      assert.ok(parts.slice(0, -1).every((part) => part.startsWith('(min-width: ')), parts.join(' | '));
      assert.ok(!parts.at(-1).startsWith('('));
    }
  });
});
