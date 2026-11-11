// «Raddrizza»: what a photo of the form keeps before and after (public/admin/js/photos.js).
// The pictures themselves are made in the browser (images.js needs a canvas); here only the state.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  existingPhoto,
  readyPhoto,
  releasePhoto,
  toSavePhoto,
  canStraighten,
  straightenView,
  useStraightened,
  rememberCorners,
  isStraightened,
  restoreWhole,
  hasColours,
  canSwitchColours,
  setColours,
} from '../../public/admin/js/photos.js';

const jpeg = (n) => new Blob([new Uint8Array([0xff, 0xd8, n, 0xff, 0xd9])], { type: 'image/jpeg' });
const prepared = (n, extra = {}) => ({ blob: jpeg(n), preview: jpeg(n + 100), width: 2400, height: 1800, id: 'abc123', focal35: 24, ...extra });
const CORNERS = [[0.07, 0.12], [0.93, 0.11], [0.92, 0.91], [0.09, 0.92]];
const MADE = { blob: jpeg(7), preview: jpeg(107), width: 2386, height: 1697, shape: 'photo', ratio: 1.406, colours: false };

describe('«Raddrizza»: the state of a photo', () => {
  test('only a new, ready photo can be straightened', () => {
    assert.equal(canStraighten(readyPhoto(prepared(1))), true);
    assert.equal(canStraighten(existingPhoto('./01.jpg')), false, 'already online');
    assert.equal(canStraighten({ kind: 'new', status: 'processing' }), false);
    assert.equal(canStraighten({ kind: 'new', status: 'error' }), false);
    const removed = readyPhoto(prepared(1));
    releasePhoto(removed);
    assert.equal(canStraighten(removed), false);
  });

  test('keeping the flat picture: new picture, same file name id, the whole photo and her points stay', () => {
    const photo = readyPhoto(prepared(1));
    const before = photo.result;
    const firstPreview = photo.previewUrl;
    assert.deepEqual(straightenView(photo), { blob: before.blob, corners: null });
    assert.equal(isStraightened(photo), false);

    useStraightened(photo, MADE, CORNERS);
    assert.equal(isStraightened(photo), true);
    assert.equal(photo.result.blob, MADE.blob);
    assert.equal(photo.result.preview, MADE.preview);
    assert.deepEqual([photo.result.width, photo.result.height], [2386, 1697]);
    assert.equal(photo.result.id, 'abc123', 'a repeated save still finds the work');
    assert.equal(photo.result.focal35, 24);
    assert.deepEqual(photo.result.whole, { blob: before.blob, preview: before.preview, width: 2400, height: 1800 });
    assert.deepEqual(photo.result.corners, CORNERS);
    assert.notEqual(photo.previewUrl, firstPreview, 'the tile shows the new picture');
    assert.equal(photo.result.straightened, true);
    assert.equal(photo.result.ratio, 1.406, 'kept, so the picture can be made again the same way');
    assert.equal(photo.result.colori, false);
    assert.equal('shape' in photo.result, false, 'nothing else rides along into the draft');
    // the store uploads the flat picture
    assert.equal(toSavePhoto(photo).upload.blob, MADE.blob);
    // the screen shows the whole photo again, with her points
    assert.deepEqual(straightenView(photo), { blob: before.blob, corners: CORNERS });
  });

  test('straightening again starts from the whole photo, not from the flat picture', () => {
    const photo = readyPhoto(prepared(1));
    const whole = photo.result.blob;
    useStraightened(photo, MADE, CORNERS);
    const again = { blob: jpeg(8), preview: jpeg(108), width: 2300, height: 1640, shape: 'measures', ratio: 1.4, colours: false };
    const moved = CORNERS.map(([x, y]) => [x + 0.01, y]);
    useStraightened(photo, again, moved);
    assert.equal(photo.result.blob, again.blob);
    assert.equal(photo.result.whole.blob, whole, 'still the photo as she took it');
    assert.deepEqual(photo.result.corners, moved);
  });

  test('«Togli il raddrizzamento» brings the whole photo back and keeps her points for another try', async () => {
    const photo = readyPhoto(prepared(1));
    const before = photo.result;
    useStraightened(photo, MADE, CORNERS);
    await restoreWhole(photo);
    assert.equal(photo.busy, null, 'not busy any more');
    assert.equal(isStraightened(photo), false);
    assert.equal(photo.result.blob, before.blob);
    assert.equal(photo.result.preview, before.preview);
    assert.deepEqual([photo.result.width, photo.result.height, photo.result.id, photo.result.focal35], [2400, 1800, 'abc123', 24]);
    assert.equal('whole' in photo.result, false, 'the picture is the whole photo itself');
    assert.deepEqual(straightenView(photo), { blob: before.blob, corners: CORNERS });
    await restoreWhole(photo); // nothing to restore: no harm
    assert.equal(photo.result.blob, before.blob);
  });

  test('«Colori più vivi»: a livelier photo keeps the plain one, switching off brings it back exactly', async () => {
    const plain = { blob: jpeg(3), preview: jpeg(103), width: 2400, height: 1800 };
    const photo = readyPhoto(prepared(4, { colori: true, whole: plain }));
    assert.equal(hasColours(photo), true);
    assert.equal(canSwitchColours(photo), true);
    assert.equal(isStraightened(photo), false, 'livelier is not straightened');
    assert.equal(straightenView(photo).blob, plain.blob, '«Raddrizza» starts from the plain photo');
    // straightened while livelier: the plain whole photo is what stays underneath
    useStraightened(photo, { ...MADE, colours: true }, CORNERS);
    assert.equal(photo.result.colori, true);
    assert.equal(photo.result.whole.blob, plain.blob);
    // an old draft (before the switch existed): a plain photo
    const old = readyPhoto({ blob: jpeg(5), preview: jpeg(105), width: 2400, height: 1800, id: 'old123' });
    assert.equal(hasColours(old), false);
    assert.equal(canSwitchColours(old), true);
    // switching off a livelier, unstraightened photo needs no new picture
    const lively = readyPhoto(prepared(6, { colori: true, whole: plain }));
    await setColours(lively, false);
    assert.equal(lively.result.blob, plain.blob);
    assert.equal(lively.result.colori, false);
    assert.equal(lively.result.id, 'abc123');
    await setColours(lively, false); // already off: no harm
    assert.equal(lively.result.blob, plain.blob);
  });

  test('points placed without straightening are remembered', () => {
    const photo = readyPhoto(prepared(1));
    rememberCorners(photo, CORNERS);
    assert.deepEqual(straightenView(photo).corners, CORNERS);
    assert.equal(isStraightened(photo), false);
    const online = existingPhoto('./01.jpg');
    rememberCorners(online, CORNERS); // ignored
    assert.equal('result' in online, false);
  });

  test('a draft restored after a reload is still straightened, with the whole photo and her points', () => {
    const photo = readyPhoto(prepared(1));
    useStraightened(photo, MADE, CORNERS);
    const stored = structuredClone({ ...photo.result, blob: null, preview: null, whole: { ...photo.result.whole, blob: null, preview: null } });
    // IndexedDB keeps the Blobs; structuredClone in Node does not, so put them back by hand
    const restored = readyPhoto({ ...stored, blob: photo.result.blob, preview: photo.result.preview, whole: { ...stored.whole, blob: photo.result.whole.blob, preview: photo.result.whole.preview } });
    assert.equal(isStraightened(restored), true);
    assert.deepEqual(straightenView(restored), { blob: photo.result.whole.blob, corners: CORNERS });
    assert.equal(restored.result.id, 'abc123');
  });

  test('a damaged draft (the whole photo lost): the picture stays, nothing to switch back to', () => {
    const photo = readyPhoto(prepared(1, { whole: { width: 2400, height: 1800 }, corners: CORNERS, straightened: true, colori: true }));
    assert.equal(isStraightened(photo), false);
    assert.equal(canSwitchColours(photo), false, 'the plain photo is gone');
    assert.equal(straightenView(photo).blob, photo.result.blob);
    assert.equal(straightenView(photo).corners, null, 'points placed on the lost whole photo are dropped with it');
    useStraightened(photo, MADE, CORNERS);
    assert.equal(isStraightened(photo), true);
  });

  test('a photo removed while its flat picture was being made is left alone', () => {
    const photo = readyPhoto(prepared(1));
    const before = photo.result;
    releasePhoto(photo);
    useStraightened(photo, MADE, CORNERS);
    assert.equal(photo.result, before);
    useStraightened(readyPhoto(prepared(2)), null, CORNERS); // no picture: no harm
  });
});
