// Tests for the film of the exhibition on "Chi sono" (src/components/lib/film.ts, imported directly
// through Node's type stripping), and a guard on the committed film itself: public/video/<file> must
// match the constants the page, the JSON-LD and the layout are built from, and stay deployable
// (CONTRACTS §5.6). Only box headers and the index (moov) are read, never the whole file. No live
// src/content is involved.
//
// The helpers are tested with literal inputs; whatever is derived from FILM or MOSTRA is checked by
// its form only, so that replacing the film (docs/SETUP.md §8) means new constants, not new tests.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { closeSync, existsSync, openSync, readSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { CHI_BOXES } from '../../src/components/lib/chi.ts';
import {
  FILM,
  FILM_BOXES,
  FILM_MAX_BYTES,
  FILM_PATH,
  FILM_RATIO,
  MOSTRA,
  durationLabel,
  filmSizes,
  isoDuration,
  megabytes,
} from '../../src/components/lib/film.ts';

const repoFile = (path) => fileURLToPath(new URL(`../../${path}`, import.meta.url));

describe('isoDuration', () => {
  test('397.5 s → PT6M38S (rounded to the second)', () => {
    assert.equal(isoDuration(397.5), 'PT6M38S');
  });

  test('the film has a duration for the JSON-LD', () => {
    assert.match(isoDuration(FILM.seconds), /^PT(?=\d)(\d+H)?(\d+M)?(\d+S)?$/);
    assert.notEqual(isoDuration(FILM.seconds), 'PT0S');
  });

  test('only the parts that are not zero', () => {
    assert.equal(isoDuration(45), 'PT45S');
    assert.equal(isoDuration(60), 'PT1M');
    assert.equal(isoDuration(3600), 'PT1H');
    assert.equal(isoDuration(3725), 'PT1H2M5S');
    assert.equal(isoDuration(59.6), 'PT1M');
  });

  test('nothing usable → PT0S', () => {
    for (const value of [0, -3, Number.NaN, Infinity]) assert.equal(isoDuration(value), 'PT0S');
  });
});

describe('durationLabel', () => {
  test('397.5 s: six and a half minutes', () => {
    assert.equal(durationLabel(397.5), '6 minuti e mezzo');
  });

  test('the film has a duration one can say', () => {
    assert.match(durationLabel(FILM.seconds), /^(1 minuto|\d+ minuti)( e mezzo)?$|^(1 secondo|[1-9]\d* secondi)$/);
  });

  test('to the half minute, singular and plural', () => {
    assert.equal(durationLabel(60), '1 minuto');
    assert.equal(durationLabel(74), '1 minuto');
    assert.equal(durationLabel(76), '1 minuto e mezzo');
    assert.equal(durationLabel(90), '1 minuto e mezzo');
    assert.equal(durationLabel(360), '6 minuti');
    assert.equal(durationLabel(719), '12 minuti');
    assert.equal(durationLabel(3900), '65 minuti');
  });

  test('seconds below one minute', () => {
    assert.equal(durationLabel(45), '45 secondi');
    assert.equal(durationLabel(1), '1 secondo');
    assert.equal(durationLabel(59.6), '1 minuto');
    assert.equal(durationLabel(Number.NaN), '0 secondi');
  });
});

describe('megabytes', () => {
  test('decimal megabytes with a no-break space', () => {
    assert.equal(megabytes(47_032_092), '47\u00a0MB');
    assert.equal(megabytes(1_499_999), '1\u00a0MB');
    assert.equal(megabytes(200), '1\u00a0MB');
    assert.equal(megabytes(Number.NaN), '0\u00a0MB');
  });

  test('the film has a size for the download link', () => {
    assert.match(megabytes(FILM.bytes), /^[1-9]\d*\u00a0MB$/);
  });
});

describe('the box of the film', () => {
  const [desktop, tablet, phone] = FILM_BOXES;

  test('one box per breakpoint of the portrait, with its indent and gutter', () => {
    assert.equal(FILM_BOXES.length, CHI_BOXES.length);
    FILM_BOXES.forEach((box, i) => {
      assert.equal(box.minWidth, CHI_BOXES[i].minWidth);
      assert.equal(box.indent, CHI_BOXES[i].indent);
      assert.equal(box.gutter, CHI_BOXES[i].gutter);
    });
  });

  test('340, 320 and 280 px wide; the height follows the ratio of the film as shown', () => {
    assert.deepEqual([desktop.w, tablet.w, phone.w], [340, 320, 280]);
    for (const box of FILM_BOXES) assert.equal(box.h, Math.round(box.w / FILM_RATIO));
  });

  test('the ratio is the picture without its black side bars', () => {
    assert.ok(Number.isInteger(FILM.bars) && FILM.bars >= 0 && FILM.bars <= FILM.width * 0.02, 'bars: a few pixels at most');
    assert.equal(FILM_RATIO, (FILM.width - 2 * FILM.bars) / FILM.height);
  });

  test('never wider than the portrait above it', () => {
    FILM_BOXES.forEach((box, i) => assert.ok(box.w <= CHI_BOXES[i].w));
  });

  test('the whole film fits a 375 × 667 phone between the browser bars (about 550 px)', () => {
    assert.ok(phone.w + phone.indent + 2 * phone.gutter <= 375);
    assert.ok(phone.h <= 550, `the phone box is ${phone.h} px high: a film of this ratio needs narrower FILM_BOXES (and the CSS of ChiFilm)`);
  });

  test('filmSizes: the box widths, shrinking with a narrow phone', () => {
    assert.equal(filmSizes(), '(min-width: 1024px) 340px, (min-width: 640px) 320px, (min-width: 360px) 280px, calc(100vw - 80px)');
  });
});

describe('the exhibition', () => {
  test('title, place, dates and its sentence: all there, in Italian typography', () => {
    assert.deepEqual(Object.keys(MOSTRA), ['titolo', 'luogo', 'date', 'tributo']);
    for (const text of Object.values(MOSTRA)) {
      assert.ok(text.length > 0 && text === text.trim(), JSON.stringify(text));
      // ’ « » – … instead of ' " - ... (AGENTS.md, "Text").
      assert.doesNotMatch(text, /['"]| - |\.\.\./, text);
    }
    // The page wraps the sentence in « »: it must not bring its own.
    assert.doesNotMatch(MOSTRA.tributo, /[«»]/);
  });
});

// ── The committed file ─────────────────────────────────────────────────────────────────────────────

/** The top-level boxes of an ISO base media file: [{ type, start, size }], reading only their headers. */
function topLevelBoxes(fd, fileSize) {
  const boxes = [];
  const header = Buffer.alloc(16);
  let offset = 0;
  while (offset < fileSize) {
    const read = readSync(fd, header, 0, 16, offset);
    assert.ok(read >= 8, `truncated box header at byte ${offset}`);
    let size = header.readUInt32BE(0);
    const type = header.toString('latin1', 4, 8);
    if (size === 1) size = Number(header.readBigUInt64BE(8)); // 64-bit size after the type
    else if (size === 0) size = fileSize - offset; // "to the end of the file"
    assert.ok(size >= 8 && offset + size <= fileSize, `box ${type} at byte ${offset} has an impossible size`);
    boxes.push({ type, start: offset, size });
    offset += size;
  }
  return boxes;
}

/** The child boxes inside buf[start, end): [{ type, body, end }] (body = first byte after the header). */
function childBoxes(buf, start, end) {
  const boxes = [];
  let offset = start;
  while (offset + 8 <= end) {
    const size = buf.readUInt32BE(offset);
    if (size < 8 || offset + size > end) break;
    boxes.push({ type: buf.toString('latin1', offset + 4, offset + 8), body: offset + 8, end: offset + size });
    offset += size;
  }
  return boxes;
}

const child = (buf, parent, type) => childBoxes(buf, parent.body, parent.end).find((box) => box.type === type);

describe(`the committed film (public/${FILM_PATH})`, () => {
  const file = repoFile(`public/${FILM_PATH}`);

  test('is in public/video/ and is an .mp4', () => {
    assert.match(FILM_PATH, /^video\/[a-z0-9][a-z0-9-]*\.mp4$/);
    assert.equal(FILM.type, 'video/mp4');
    assert.ok(existsSync(file), `${file} is missing (docs/SETUP.md §8)`);
  });

  test('has the size of FILM.bytes, at most 50 MB (GitHub warns above, refuses 100 MB)', () => {
    assert.equal(statSync(file).size, FILM.bytes, 'update FILM.bytes in src/components/lib/film.ts');
    assert.equal(FILM_MAX_BYTES, 50_000_000);
    assert.ok(FILM.bytes <= FILM_MAX_BYTES, 'encode the film smaller (docs/SETUP.md §8)');
  });

  test('is an MP4 with the index in front (faststart) and the picture size and running time of FILM', () => {
    const fileSize = statSync(file).size;
    const fd = openSync(file, 'r');
    try {
      const boxes = topLevelBoxes(fd, fileSize);
      const types = boxes.map(({ type }) => type);
      assert.equal(types[0], 'ftyp', 'an MP4 starts with an ftyp box');
      assert.ok(types.includes('moov') && types.includes('mdat'), `boxes found: ${types.join(' ')}`);
      // moov before mdat: the browser can start playing before the whole file has arrived.
      assert.ok(types.indexOf('moov') < types.indexOf('mdat'), 'not faststart: encode with -movflags +faststart');

      const { start, size } = boxes.find(({ type }) => type === 'moov');
      assert.ok(size < 4_000_000, 'unexpectedly large index');
      const moov = Buffer.alloc(size);
      readSync(fd, moov, 0, size, start);
      const root = { body: 8, end: size };

      // Running time: mvhd (version 0: 32-bit fields, version 1: 64-bit).
      const mvhd = child(moov, root, 'mvhd');
      const v1 = moov[mvhd.body] === 1;
      const timescale = moov.readUInt32BE(mvhd.body + (v1 ? 20 : 12));
      const duration = v1 ? Number(moov.readBigUInt64BE(mvhd.body + 24)) : moov.readUInt32BE(mvhd.body + 16);
      assert.ok(Math.abs(duration / timescale - FILM.seconds) < 0.5, `running time ${duration / timescale} s, FILM.seconds ${FILM.seconds}`);

      // Picture size and codec: the sample entry of the video track (H.264 = avc1).
      const tracks = childBoxes(moov, root.body, root.end).filter(({ type }) => type === 'trak');
      const entries = tracks.map((trak) => {
        const mdia = child(moov, trak, 'mdia');
        const handler = moov.toString('latin1', child(moov, mdia, 'hdlr').body + 8, child(moov, mdia, 'hdlr').body + 12);
        const stsd = child(moov, child(moov, child(moov, mdia, 'minf'), 'stbl'), 'stsd');
        const entry = stsd.body + 8; // after version/flags and the entry count
        return { handler, codec: moov.toString('latin1', entry + 4, entry + 8), entry };
      });
      const video = entries.find(({ handler }) => handler === 'vide');
      const audio = entries.find(({ handler }) => handler === 'soun');
      assert.equal(video?.codec, 'avc1', 'the video track must be H.264');
      assert.equal(audio?.codec, 'mp4a', 'the audio track must be AAC');
      assert.equal(moov.readUInt16BE(video.entry + 32), FILM.width);
      assert.equal(moov.readUInt16BE(video.entry + 34), FILM.height);
    } finally {
      closeSync(fd);
    }
  });

  test('the poster frame is committed next to the site code, as a JPEG', () => {
    const poster = repoFile(`src/assets/video/${FILM.file.replace(/\.mp4$/, '.jpg')}`);
    assert.ok(existsSync(poster), `${poster} is missing`);
    const fd = openSync(poster, 'r');
    try {
      const magic = Buffer.alloc(3);
      readSync(fd, magic, 0, 3, 0);
      assert.deepEqual([...magic], [0xff, 0xd8, 0xff]);
    } finally {
      closeSync(fd);
    }
  });
});
