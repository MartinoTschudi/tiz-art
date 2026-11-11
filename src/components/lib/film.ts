/**
 * The film of the 2023 exhibition «noi, DONNA.», shown on "Chi sono" under the bio (CONTRACTS §5.6):
 * the facts of the committed file, the exhibition's own words and the layout numbers of its box.
 * Pure (no `astro:*` imports, erasable TypeScript only), tested in scripts/test/film.test.mjs through
 * Node's type stripping; that test also checks the committed file against these constants.
 *
 * The film is site copy, not admin data: it is not in `sito.json` or a content collection (their
 * schemas are shared with the admin and the validator, CONTRACTS §4). Replacing it = docs/SETUP.md §8.
 */
import { CHI_BOXES, chiSizes, type ChiBox } from './chi.ts';

/**
 * The web version of the film, `public/video/<file>`: served as it is (the build never re-encodes
 * it), MP4 with H.264 + AAC and the index in front (faststart), so every browser plays it and can
 * start before the whole file has arrived. Update all of these when the file is replaced.
 */
export const FILM = {
  file: 'noi-donna-2023.mp4',
  type: 'video/mp4',
  /** Pixel size of the picture (portrait). */
  width: 720,
  height: 1270,
  /**
   * Black bars burnt into the picture on its left and right edge, in pixels of `width` each (0 = none;
   * rounded up, they are 3 to 4 px in this film). The box is that much narrower than the picture and
   * the film fills it (`object-fit: cover` in ChiFilm), so the bars never show beside the tela.
   */
  bars: 4,
  /** Running time in seconds. */
  seconds: 397.5,
  /** Size of the file in bytes. */
  bytes: 47_032_092,
  /** The day it went online (schema.org `uploadDate`). */
  uploadDate: '2026-11-11',
} as const;

/** Path of the film below the base path: `withBase(FILM_PATH)`. Never write it with a leading "/". */
export const FILM_PATH = `video/${FILM.file}`;

/**
 * Upper limit for the committed file: GitHub warns on a push above 50 MB (and refuses 100 MB), and
 * every visitor who plays the film to the end downloads all of it.
 */
export const FILM_MAX_BYTES = 50_000_000;

/** Width / height of the film as it is shown: the picture without its black bars. */
export const FILM_RATIO = (FILM.width - 2 * FILM.bars) / FILM.height;

/** The exhibition, as on the film's own title card (the title is the series name of the works). */
export const MOSTRA = {
  titolo: 'noi, DONNA.',
  luogo: 'Atelier Attila, Bellinzona',
  date: '22 aprile – 7 maggio 2023',
  tributo:
    'Un tributo alla femminilità, alla forza e alla bellezza che ogni donna porta dentro di sé, esaltandone la dolcezza e il coraggio.',
} as const;

/** Seconds → ISO 8601 duration for schema.org, rounded to the second: 397.5 → "PT6M38S". */
export function isoDuration(seconds: number): string {
  const total = Math.round(validSeconds(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return `PT${h ? `${h}H` : ''}${m ? `${m}M` : ''}${s || (!h && !m) ? `${s}S` : ''}`;
}

/**
 * Seconds → how long the film is, as one would say it: to the half minute ("6 minuti e mezzo",
 * "1 minuto", "12 minuti"), in seconds below one minute ("45 secondi").
 */
export function durationLabel(seconds: number): string {
  const total = validSeconds(seconds);
  const whole = Math.round(total);
  if (whole < 60) return whole === 1 ? '1 secondo' : `${whole} secondi`;
  const halves = Math.round(total / 30);
  const minutes = Math.floor(halves / 2);
  const text = minutes === 1 ? '1 minuto' : `${minutes} minuti`;
  return halves % 2 === 1 ? `${text} e mezzo` : text;
}

/** Bytes → "47 MB" (decimal megabytes with a no-break space, at least 1), for the download link. */
export function megabytes(bytes: number): string {
  const mb = Number.isFinite(bytes) && bytes > 0 ? Math.max(1, Math.round(bytes / 1_000_000)) : 0;
  return `${mb}\u00a0MB`;
}

/**
 * The film's box per breakpoint: as wide as given here, as tall as FILM_RATIO makes it (for this
 * film 340 × 606, 320 × 571, 280 × 499), with the indent and gutter of the portrait above it, so
 * both hang on the same line. The widths are chosen so that the whole film fits a normal screen
 * without scrolling (a 375 × 667 phone shows about 550 px between the browser's bars). Keep them in
 * step with the CSS of src/components/chi/ChiFilm.astro (checked by scripts/test/design-sync.test.mjs).
 */
const filmBox = (chi: ChiBox, w: number): ChiBox => ({ ...chi, w, h: Math.round(w / FILM_RATIO) });

export const FILM_BOXES: readonly ChiBox[] = [filmBox(CHI_BOXES[0], 340), filmBox(CHI_BOXES[1], 320), filmBox(CHI_BOXES[2], 280)];

/**
 * `sizes` of the poster, which fills the film's box:
 * "(min-width: 1024px) 340px, (min-width: 640px) 320px, (min-width: 360px) 280px, calc(100vw - 80px)".
 * On short screens the CSS makes the box smaller still (down to its floor of 200 px, so that the
 * film stays whole where the screen allows it); `sizes` is then a little too large, never too small.
 */
export function filmSizes(): string {
  return chiSizes(FILM_RATIO, { boxes: FILM_BOXES });
}

function validSeconds(seconds: number): number {
  return Number.isFinite(seconds) && seconds > 0 ? seconds : 0;
}
