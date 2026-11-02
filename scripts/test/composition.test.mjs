// Tests for the design's composition rules (src/components/lib/composition.ts), imported directly
// through Node's type stripping. The data below is a fixed copy of the 12 works of the design
// (display order, sizes, featured flags of the redesign brief), never the live src/content.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  AL,
  GUTTERS,
  LONG_TITLE,
  MT,
  PAINT_CYCLE,
  SWL,
  SWR,
  SWT,
  firstSentence,
  gutterAt,
  heroSlots,
  hungAt,
  isLongTitle,
  mottoParts,
  paintName,
  paintVar,
  pickQuote,
  pickSeries,
  realScaleSizes,
  splitLastWord,
  strokeAt,
} from '../../src/components/lib/composition.ts';

const SERIE = 'noi, DONNA.';
// [id, w, h, featured, testo (first sentence is what matters)]
const RAW = [
  ['il-risveglio-di-madre-natura', 100, 140, false, 'Come un albero al risveglio del sole, il corpo s’illumina ed è pronto ad accogliere il nuovo giorno in tutta la sua bellezza.'],
  ['liberi-di-volare', 100, 100, true, 'Oltre i pregiudizi razziali, o sessuali, oltre le idee politiche o religiose in un mondo che ha bisogno di PACE e RISPETTO.'],
  ['donna-sapiens', 100, 140, false, 'I colori della terra e del fuoco rendono quest’opera ancorata al primordiale con al centro la donna in tutta la sua energia vitale.'],
  ['gioventu', 100, 140, false, 'La gioventù bella e orgogliosa… e le ali la portano via…'],
  ['confidenze', 140, 100, false, 'Sull’erba, due amiche, due complici si raccontano confidenze di vita… Una gentile brezza le prende e le porta lontane.'],
  ['estasi', 60, 130, true, 'Ad ognuna il suo vissuto, ad ognuna il suo dolore, ad ognuna il suo orgoglio di sfoggiare il proprio essere come fosse un gioiello e goderne ogni attimo.'],
  ['guardami', 120, 120, true, ''],
  ['il-coraggio-di-guardare-oltre', 100, 100, false, ''],
  ['pagina-bianca', 120, 120, false, 'Lascio bianca questa pagina: prima o poi scriverò quel qualcosa che farà vibrare il mio cuore.'],
  ['e-fuori-piove', 150, 120, false, 'La pioggia ha qualcosa di magico; riesce a produrre effetti diversi sull’umore a seconda delle persone che la stanno guardando.'],
  ['istinto', 100, 100, false, 'Con l’istinto non c’è niente da imparare: sono tutte quelle azioni che avvengono naturalmente, senza il bisogno di pensarci.'],
  ['sorellanza', 120, 150, false, 'Sorellanza è una parola che nel suo cuore ne racchiude un’altra: alleanza. È un patto arcaico, che nasce dalle donne che per secoli, e da secoli, si sono sostenute.'],
];
const WORKS = RAW.map(([id, w, h, featured, testo]) => ({ id, w, h, ratio: w / h, featured, testo, collezione: SERIE, anno: 2023 }));
const ids = (list) => list.map((work) => work.id);
const work = (id, extra = {}) => ({ id, w: 100, h: 100, ratio: 1, featured: false, testo: '', collezione: '', anno: null, ...extra });

describe('paintName / paintVar', () => {
  test('an explicit colore wins', () => {
    assert.equal(paintName('blu', 0), 'blu');
    assert.equal(paintName('terracotta', 7), 'terracotta');
  });

  test('null, missing or unknown colore → the cycle by published index', () => {
    assert.deepEqual(PAINT_CYCLE, ['ocra', 'rosso', 'ottanio', 'terracotta', 'blu']);
    assert.deepEqual([0, 1, 2, 3, 4, 5, 11].map((i) => paintName(null, i)), ['ocra', 'rosso', 'ottanio', 'terracotta', 'blu', 'ocra', 'rosso']);
    assert.equal(paintName(undefined, 2), 'ottanio');
    assert.equal(paintName('verde', 1), 'rosso');
    assert.equal(paintName('', 3), 'terracotta');
  });

  test('a work not in the published list (-1) gets the first paint', () => {
    assert.equal(paintName(null, -1), 'ocra');
    assert.equal(paintName(null, Number.NaN), 'ocra');
  });

  test('CSS value', () => {
    assert.equal(paintVar('ottanio'), 'var(--tiz-ottanio)');
  });
});

describe('hung by eye', () => {
  test('cycles of the design', () => {
    assert.deepEqual(MT, [0, 140, 60, 200, 20, 110, 40, 170]);
    assert.deepEqual(AL, ['flex-start', 'flex-end', 'center', 'flex-end', 'flex-start']);
    assert.deepEqual(SWL, ['-36px', '30%', '-24px', '25%']);
    assert.deepEqual(SWT, ['40px', '-30px', '25%', '10px']);
    assert.deepEqual(SWR, ['-5deg', '4deg', '-3deg', '7deg']);
  });

  test('strokes only on even indexes, placement mod 4', () => {
    assert.deepEqual(hungAt(0), { mt: 0, align: 'flex-start', stroke: { left: '-36px', top: '40px', rotate: '-5deg' } });
    assert.equal(hungAt(1).stroke, null);
    assert.deepEqual(hungAt(2).stroke, { left: '-24px', top: '25%', rotate: '-3deg' });
    assert.deepEqual(hungAt(9), { mt: 140, align: 'flex-start', stroke: null });
    assert.deepEqual(hungAt(10), { mt: 60, align: 'flex-start', stroke: strokeAt(2) });
    assert.deepEqual(strokeAt(-1), strokeAt(3));
  });

  test('sizes follow the real-scale width per breakpoint', () => {
    assert.equal(realScaleSizes(100), '(min-width: 1024px) 230px, (min-width: 640px) 200px, (min-width: 260px) 220px, calc(100vw - 40px)');
    assert.equal(realScaleSizes(150), '(min-width: 1024px) 345px, (min-width: 640px) 300px, (min-width: 370px) 330px, calc(100vw - 40px)');
    assert.equal(realScaleSizes(60), '(min-width: 1024px) 138px, (min-width: 640px) 120px, (min-width: 172px) 132px, calc(100vw - 40px)');
  });

  test('missing cm → 100 cm', () => {
    assert.equal(realScaleSizes(null), realScaleSizes(100));
    assert.equal(realScaleSizes(undefined), realScaleSizes(100));
    assert.equal(realScaleSizes(0), realScaleSizes(100));
  });

  test('huge canvases are capped by the viewport and the page width', () => {
    assert.equal(
      realScaleSizes(500),
      '(min-width: 1246px) 1150px, (min-width: 1024px) calc(100vw - 96px), (min-width: 640px) calc(100vw - 64px), calc(100vw - 40px)',
    );
    assert.equal(
      realScaleSizes(1000),
      '(min-width: 1440px) 1344px, (min-width: 1024px) calc(100vw - 96px), (min-width: 640px) calc(100vw - 64px), calc(100vw - 40px)',
    );
  });
});

describe('mottoParts', () => {
  test('the design example', () => {
    assert.deepEqual(mottoParts('Dialogo tra testa e cuore.'), { lines: ['Dialogo tra', 'testa e', 'cuore'], lastWord: 'cuore' });
  });

  test('trailing . and ! are dropped, other punctuation kept', () => {
    assert.deepEqual(mottoParts('Dipingo con il cuore!'), { lines: ['Dipingo', 'con il', 'cuore'], lastWord: 'cuore' });
    assert.equal(mottoParts('Perché no?').lastWord, 'no?');
    assert.equal(mottoParts('Colore…').lastWord, 'Colore…');
  });

  test('empty → no lines (the caller shows the name instead)', () => {
    assert.deepEqual(mottoParts(''), { lines: [], lastWord: '' });
    assert.deepEqual(mottoParts('   .  '), { lines: [], lastWord: '' });
  });

  test('one and two words', () => {
    assert.deepEqual(mottoParts('Cuore.'), { lines: ['Cuore'], lastWord: 'Cuore' });
    assert.deepEqual(mottoParts('Testa e'), { lines: ['Testa', 'e'], lastWord: 'e' });
  });

  test('three words → three lines', () => {
    assert.deepEqual(mottoParts('Colore puro, gesto.'), { lines: ['Colore', 'puro,', 'gesto'], lastWord: 'gesto' });
  });

  test('balanced by characters; ties and near-ties make the first line longer', () => {
    // tie: "uno" | "due tre" (3/7) and "uno due" | "tre" (7/3) → first longer
    assert.deepEqual(mottoParts('uno due tre quattro').lines, ['uno due', 'tre', 'quattro']);
    // near-tie: 5/6 (−1) is the best balance, 7/4 (+3) is within 2 of it → first longer wins
    assert.deepEqual(mottoParts('Rosso e blu, sempre.').lines, ['Rosso e', 'blu,', 'sempre']);
    // 10/12 (−2) against 14/8 (+6): not a near-tie → the better balance stays
    assert.deepEqual(mottoParts('aaaa bbbbb ccc dddddddd fine').lines, ['aaaa bbbbb', 'ccc dddddddd', 'fine']);
    // 6/11 (−5) against 13/4 (+9) → the better balance stays
    assert.deepEqual(mottoParts('Il mio colore e il cuore.').lines, ['Il mio', 'colore e il', 'cuore']);
    // 7/6 (+1) is already first-longer
    assert.deepEqual(mottoParts('Dipingo con il cuore!').lines, ['Dipingo', 'con il', 'cuore']);
  });

  test('whitespace is collapsed, a long motto still gives three lines', () => {
    const long = 'Dipingo   volti e corpi di donna\ncon la spatola, a strati spessi, finché il quadro diventa quasi una scultura.';
    const { lines, lastWord } = mottoParts(long);
    assert.equal(lines.length, 3);
    assert.equal(lastWord, 'scultura');
    assert.equal(lines.join(' '), long.replace(/\s+/g, ' ').replace(/\.$/, ''));
  });
});

describe('splitLastWord', () => {
  test('word in rosso + closing punctuation', () => {
    assert.deepEqual(splitLastWord('Sorellanza ne racchiude un’altra: alleanza.'), {
      before: 'Sorellanza ne racchiude un’altra: ',
      word: 'alleanza',
      after: '.',
    });
    assert.deepEqual(splitLastWord('Dialogo tra testa e cuore.'), { before: 'Dialogo tra testa e ', word: 'cuore', after: '.' });
    assert.deepEqual(splitLastWord('Gioventù…»'), { before: '', word: 'Gioventù', after: '…»' });
    assert.deepEqual(splitLastWord('— !'), { before: '— !', word: '', after: '' });
  });

  test('a closing number is the last word, not the word before it', () => {
    assert.deepEqual(splitLastWord('Esposta a Bellinzona nel 2023.'), { before: 'Esposta a Bellinzona nel ', word: '2023', after: '.' });
    assert.equal(pickQuote([work('a', { testo: 'L’ho dipinta a Lostallo nel 2023. Poi altro.' })])?.keyWord, '2023');
  });
});

describe('heroSlots', () => {
  test('our data: guardami large, estasi narrow, liberi-di-volare small (frame 1b)', () => {
    const slots = heroSlots(WORKS);
    assert.equal(slots.large.id, 'guardami');
    assert.equal(slots.narrow.id, 'estasi');
    assert.equal(slots.small.id, 'liberi-di-volare');
    assert.deepEqual(ids(slots.picked), ['liberi-di-volare', 'estasi', 'guardami']);
  });

  test('more than 3 featured → the first 3 in display order', () => {
    const list = WORKS.map((w) => ({ ...w, featured: true }));
    assert.deepEqual(ids(heroSlots(list).picked), ['il-risveglio-di-madre-natura', 'liberi-di-volare', 'donna-sapiens']);
  });

  test('0 featured → the first 3 published works', () => {
    const list = WORKS.map((w) => ({ ...w, featured: false }));
    const slots = heroSlots(list);
    assert.deepEqual(ids(slots.picked), ['il-risveglio-di-madre-natura', 'liberi-di-volare', 'donna-sapiens']);
    assert.equal(slots.large.id, 'liberi-di-volare');
    // risveglio and donna-sapiens have the same ratio: display order decides
    assert.equal(slots.narrow.id, 'il-risveglio-di-madre-natura');
    assert.equal(slots.small.id, 'donna-sapiens');
  });

  test('1 or 2 featured → filled with the first other works', () => {
    const one = WORKS.map((w) => ({ ...w, featured: w.id === 'sorellanza' }));
    assert.deepEqual(ids(heroSlots(one).picked), ['sorellanza', 'il-risveglio-di-madre-natura', 'liberi-di-volare']);
    const two = WORKS.map((w) => ({ ...w, featured: ['estasi', 'istinto'].includes(w.id) }));
    const slots = heroSlots(two);
    assert.deepEqual(ids(slots.picked), ['estasi', 'istinto', 'il-risveglio-di-madre-natura']);
    assert.equal(slots.large.id, 'istinto');
    assert.equal(slots.narrow.id, 'estasi');
    assert.equal(slots.small.id, 'il-risveglio-di-madre-natura');
  });

  test('only 1 or 2 works published → only the slots used', () => {
    const single = heroSlots([work('a', { featured: true })]);
    assert.equal(single.large.id, 'a');
    assert.equal(single.narrow, undefined);
    assert.equal(single.small, undefined);
    const pair = heroSlots([work('wide', { w: 150, h: 100, ratio: 1.5 }), work('tall', { w: 60, h: 130, ratio: 60 / 130 })]);
    assert.equal(pair.large.id, 'wide'); // |1.5 − 1| = 0.5 < |0.46 − 1| = 0.54
    assert.equal(pair.narrow.id, 'tall');
    assert.equal(pair.small, undefined);
    assert.deepEqual(heroSlots([]), { picked: [] });
  });

  test('ties on squareness → larger canvas, then display order', () => {
    const slots = heroSlots([work('small-sq', { w: 80, h: 80 }), work('big-sq', { w: 150, h: 150 }), work('same-sq', { w: 80, h: 80 })]);
    assert.equal(slots.large.id, 'big-sq');
    assert.equal(slots.narrow.id, 'small-sq');
    assert.equal(slots.small.id, 'same-sq');
  });

  test('missing cm: ratio from the photo, area 0 loses ties', () => {
    const slots = heroSlots([work('no-cm', { w: null, h: null, ratio: 1 }), work('cm', { w: 50, h: 50, ratio: 1 }), work('photo-tall', { w: null, h: null, ratio: 0.5 })]);
    assert.equal(slots.large.id, 'cm');
    assert.equal(slots.narrow.id, 'photo-tall');
    assert.equal(slots.small.id, 'no-cm');
  });
});

describe('firstSentence', () => {
  test('up to the first . ! ? before whitespace or the end', () => {
    assert.equal(firstSentence(WORKS[11].testo), 'Sorellanza è una parola che nel suo cuore ne racchiude un’altra: alleanza.');
    assert.equal(firstSentence('Che forza! Poi il resto.'), 'Che forza!');
    assert.equal(firstSentence('Davvero?! Sì.'), 'Davvero?!');
    assert.equal(firstSentence('Una sola frase senza punto'), 'Una sola frase senza punto');
    assert.equal(firstSentence(''), '');
  });

  test('a dot inside a number or a word does not end it', () => {
    assert.equal(firstSentence('Misura 1.5 m circa. Fine.'), 'Misura 1.5 m circa.');
  });

  test('closing quotes stay with the sentence', () => {
    assert.equal(firstSentence('Lei disse «Basta.» Poi tacque.'), 'Lei disse «Basta.»');
    assert.equal(firstSentence('Mi disse «Sì.»'), 'Mi disse «Sì.»');
  });

  test('a quoted exclamation inside the sentence does not end it', () => {
    assert.equal(firstSentence('«Guardami!» mi dice la tela ogni mattina. Poi tace.'), '«Guardami!» mi dice la tela ogni mattina.');
    assert.equal(firstSentence('Il titolo (provvisorio!) è rimasto. Fine.'), 'Il titolo (provvisorio!) è rimasto.');
  });

  test('an ellipsis ends only before an uppercase letter or at the end', () => {
    assert.equal(firstSentence(WORKS[3].testo), 'La gioventù bella e orgogliosa… e le ali la portano via…');
    assert.equal(firstSentence(WORKS[4].testo), 'Sull’erba, due amiche, due complici si raccontano confidenze di vita…');
    assert.equal(firstSentence('Aspetto... e poi... Niente.'), 'Aspetto... e poi...');
    assert.equal(firstSentence('Silenzio… «Ascolta» disse.'), 'Silenzio…');
  });

  test('whitespace is collapsed', () => {
    assert.equal(firstSentence('  Primo\n\nparagrafo.\n\nSecondo.'), 'Primo paragrafo.');
  });
});

describe('pickQuote', () => {
  const heroIds = ['liberi-di-volare', 'estasi', 'guardami'];

  test('our data: Sorellanza, key word «alleanza»', () => {
    assert.deepEqual(pickQuote(WORKS, heroIds), {
      id: 'sorellanza',
      sentence: 'Sorellanza è una parola che nel suo cuore ne racchiude un’altra: alleanza.',
      before: 'Sorellanza è una parola che nel suo cuore ne racchiude un’altra: ',
      keyWord: 'alleanza',
      after: '.',
    });
  });

  test('goes backwards, skipping hero works and sentences outside 20–140 characters', () => {
    const list = [work('a', { testo: 'Una frase giusta per la citazione.' }), work('b', { testo: 'Troppo corta.' }), work('c', { testo: `${'parola '.repeat(25)}fine.` }), work('hero', { testo: 'Questa sarebbe perfetta, ma è nella hero.' })];
    assert.equal(pickQuote(list, ['hero']).id, 'a');
    assert.equal(pickQuote(list).id, 'hero');
  });

  test('length limits are inclusive', () => {
    const twenty = 'Diciannove lettere.'.padStart(20, 'X');
    assert.equal([...twenty].length, 20);
    assert.equal(pickQuote([work('a', { testo: twenty })])?.id, 'a');
    assert.equal(pickQuote([work('a', { testo: twenty.slice(1) })]), null);
  });

  test('no candidate → null', () => {
    assert.equal(pickQuote([]), null);
    assert.equal(pickQuote([work('a'), work('b', { testo: 'Corta.' })]), null);
    assert.equal(pickQuote(WORKS, ids(WORKS)), null);
  });
});

describe('pickSeries', () => {
  test('our data: the series of the first hero work, without hero and quote works', () => {
    const series = pickSeries(WORKS, ['liberi-di-volare', 'estasi', 'guardami', 'sorellanza']);
    assert.equal(series.name, SERIE);
    assert.equal(series.year, 2023);
    assert.deepEqual(ids(series.works), ['il-risveglio-di-madre-natura', 'donna-sapiens', 'gioventu', 'confidenze', 'il-coraggio-di-guardare-oltre']);
  });

  test('first hero work without a series → the most common series (ties → first met)', () => {
    const list = [work('hero'), work('a', { collezione: 'Mari' }), work('b', { collezione: 'Volti', anno: 2021 }), work('c', { collezione: 'Volti', anno: 2024 }), work('d', { collezione: 'Mari' }), work('e', { collezione: 'Volti', anno: null })];
    const series = pickSeries(list, ['hero']);
    assert.equal(series.name, 'Volti');
    assert.equal(series.year, 2024);
    assert.deepEqual(ids(series.works), ['b', 'c', 'e']);
    const tie = pickSeries([work('a', { collezione: 'Mari' }), work('b', { collezione: 'Volti' })], []);
    assert.equal(tie.name, 'Mari');
  });

  test('seriesOf picks the anchor explicitly', () => {
    const list = [work('a', { collezione: 'Mari' }), work('b', { collezione: 'Volti' }), work('c', { collezione: 'Volti' })];
    assert.equal(pickSeries(list, ['c'], 'a').name, 'Mari');
  });

  test('year is null when no work of the series has one', () => {
    assert.equal(pickSeries([work('a', { collezione: 'Mari' })]).year, null);
  });

  test('at most 5 works', () => {
    const list = Array.from({ length: 9 }, (_, i) => work(`w${i}`, { collezione: 'Mari' }));
    assert.deepEqual(ids(pickSeries(list, ['w0']).works), ['w1', 'w2', 'w3', 'w4', 'w5']);
  });

  test('no series at all → name null and the first 5 works not excluded', () => {
    const list = Array.from({ length: 8 }, (_, i) => work(`w${i}`));
    assert.deepEqual(pickSeries(list, ['w1', 'w3']), { name: null, year: null, works: list.filter((w) => !['w1', 'w3'].includes(w.id)).slice(0, 5) });
  });

  test('every work of the series excluded → falls back like no series', () => {
    const list = [work('hero', { collezione: 'Mari' }), work('a'), work('b')];
    assert.deepEqual(pickSeries(list, ['hero']), { name: null, year: null, works: [list[1], list[2]] });
    assert.deepEqual(pickSeries([], []), { name: null, year: null, works: [] });
  });
});

describe('page frame', () => {
  test('gutter per breakpoint (20 / 32 / 48, the 1280 and 390 frames)', () => {
    assert.deepEqual(GUTTERS.map(({ gutter }) => gutter), [48, 32, 20]);
    assert.equal(gutterAt(320), 20);
    assert.equal(gutterAt(639), 20);
    assert.equal(gutterAt(640), 32);
    assert.equal(gutterAt(1023), 32);
    assert.equal(gutterAt(1024), 48);
    assert.equal(gutterAt(2000), 48);
  });
});

describe('long titles', () => {
  test('over 40 characters (whitespace collapsed, accents count once)', () => {
    assert.equal(LONG_TITLE, 40);
    assert.equal(isLongTitle('Il coraggio di guardare oltre'), false);
    assert.equal(isLongTitle('à'.repeat(40)), false);
    assert.equal(isLongTitle('à'.repeat(41)), true);
    assert.equal(isLongTitle(`${'a'.repeat(20)}    ${'b'.repeat(19)}`), false);
    assert.equal(isLongTitle('Il lungo dialogo silenzioso tra la testa che pensa troppo'), true);
  });
});
