#!/usr/bin/env node
/**
 * Builds the public site's icons from her signature, src/assets/firma.svg (run after changing that
 * drawing or the colours --tiz-lino / --tiz-rosso; the three files are committed):
 *   node scripts/dev/site-icons.mjs [--out <folder>]
 *
 *   favicon.svg            the signature in rosso on a rounded lino tile (64 × 64)
 *   favicon-32.png         32 × 32   browsers that do not use the SVG favicon
 *   apple-touch-icon.png   180 × 180 iPhone "Aggiungi alla schermata Home" (opaque: iOS rounds it)
 *
 * The colours are read from src/styles/tokens.css, the drawing from src/assets/firma.svg, so the
 * icons cannot drift from the site (scripts/test/design-sync.test.mjs compares the committed
 * favicon.svg with what this script would write).
 * --out writes the files somewhere else (to compare them before replacing the committed ones).
 */
import sharp from 'sharp';
import { realpathSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const PUBLIC = path.join(ROOT, 'public');

/** Side of the favicon's tile, its corner radius and the margin left and right of the signature. */
const TILE = 64;
const RADIUS = 12;
const MARGIN = 4;

/** `--name: #hex;` in tokens.css. */
function token(css, name) {
  const value = new RegExp(`${name}:\\s*(#[0-9a-fA-F]{3,8})\\s*;`).exec(css)?.[1];
  if (!value) throw new Error(`src/styles/tokens.css: ${name} is not a hex colour`);
  return value;
}

/** A number with at most three decimals, without trailing zeros. */
const num = (n) => String(Math.round(n * 1000) / 1000);

/**
 * The text of favicon.svg: the signature (the shapes of firma.svg, painted with currentColor there)
 * fitted to the tile's width and centred, in `rosso` on `lino`.
 */
export function faviconSvg(firma, { lino, rosso }) {
  const viewBox = /<svg\b[^>]*\bviewBox="0 0 ([\d.]+) ([\d.]+)"/.exec(firma);
  const shapes = /<svg\b[^>]*>([\s\S]*)<\/svg>/.exec(firma)?.[1].trim();
  if (!viewBox || !shapes?.includes('currentColor')) throw new Error('src/assets/firma.svg: expected <svg viewBox="0 0 W H"> with shapes painted with currentColor');
  const [width, height] = [Number(viewBox[1]), Number(viewBox[2])];
  const scale = Math.min((TILE - 2 * MARGIN) / width, (TILE - 2 * MARGIN) / height);
  const x = (TILE - width * scale) / 2;
  const y = (TILE - height * scale) / 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${TILE} ${TILE}">
  <!-- Written by scripts/dev/site-icons.mjs from src/assets/firma.svg (her signature) and the colours
       lino / rosso of src/styles/tokens.css. Do not edit by hand. -->
  <rect width="${TILE}" height="${TILE}" rx="${RADIUS}" fill="${lino}"/>
  <g transform="translate(${num(x)} ${num(y)}) scale(${num(scale)})">
    ${shapes.replaceAll('currentColor', rosso).replace(/\n\s*/g, '\n    ')}
  </g>
</svg>
`;
}

/** favicon.svg as this script writes it from the files in the repository. */
export async function currentFaviconSvg() {
  const [firma, tokens] = await Promise.all([
    readFile(path.join(ROOT, 'src', 'assets', 'firma.svg'), 'utf8'),
    readFile(path.join(ROOT, 'src', 'styles', 'tokens.css'), 'utf8'),
  ]);
  const colours = { lino: token(tokens, '--tiz-lino'), rosso: token(tokens, '--tiz-rosso') };
  return { svg: faviconSvg(firma, colours), ...colours };
}

/** `--out <folder>` or public/. */
function outDir(argv) {
  const i = argv.indexOf('--out');
  if (i === -1) return PUBLIC;
  if (!argv[i + 1]) throw new Error('--out needs a folder');
  return path.resolve(argv[i + 1]);
}

async function main() {
  const out = outDir(process.argv.slice(2));
  const { svg, lino } = await currentFaviconSvg();
  const source = Buffer.from(svg);
  await mkdir(out, { recursive: true });
  await writeFile(path.join(out, 'favicon.svg'), svg);
  await sharp(source, { density: 300 }).resize(32, 32).png().toFile(path.join(out, 'favicon-32.png'));
  await sharp(source, { density: 600 }).resize(180, 180).flatten({ background: lino }).png().toFile(path.join(out, 'apple-touch-icon.png'));
  console.log(`favicon.svg, favicon-32.png and apple-touch-icon.png written to ${out} (background ${lino})`);
}

// Only when run as a script (design-sync.test.mjs imports the functions above).
if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(`site-icons: ${err.message}`);
    process.exitCode = 1;
  });
}
