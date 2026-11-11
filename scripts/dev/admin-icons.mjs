#!/usr/bin/env node
/**
 * Generates the "TIZ Admin" home-screen icons in public/admin/icons/ (run after changing her
 * signature, src/assets/firma.svg, or the colours below; the PNGs are committed):
 *   node scripts/dev/admin-icons.mjs [--out <folder>]
 *
 *   apple-touch-icon.png   180 × 180  iPhone "Aggiungi alla schermata Home" (opaque, iOS rounds it)
 *   icon-192.png / icon-512.png        Android / manifest, purpose "any"
 *   icon-maskable-512.png              manifest, purpose "maskable" (the signature inside the safe circle)
 *
 * The mark is her signature (the site's logo: the shapes of src/assets/firma.svg, painted with
 * currentColor there) in cream on the admin's terracotta, over an ocra brushstroke. No font is
 * needed, so the result is the same on every machine. --out writes the PNGs somewhere else (to
 * compare them before replacing the committed ones).
 */
import sharp from 'sharp';
import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const outFlag = process.argv.indexOf('--out');
if (outFlag !== -1 && !process.argv[outFlag + 1]) throw new Error('--out needs a folder');
const OUT = outFlag === -1 ? path.join(ROOT, 'public', 'admin', 'icons') : path.resolve(process.argv[outFlag + 1]);

const BACKGROUND = '#a8432a'; // the admin's terracotta accent
const SIGNATURE = '#fbf6ee';
const BRUSH = '#f0b84d';

/** Her signature fitted into the 512 artwork: this wide, its top edge at this y. */
const WIDTH = 400;
const TOP = 106;

const firma = await readFile(path.join(ROOT, 'src', 'assets', 'firma.svg'), 'utf8');
const viewBox = /<svg\b[^>]*\bviewBox="0 0 ([\d.]+) ([\d.]+)"/.exec(firma);
const shapes = /<svg\b[^>]*>([\s\S]*)<\/svg>/.exec(firma)?.[1].trim();
if (!viewBox || !shapes?.includes('currentColor')) {
  throw new Error('src/assets/firma.svg: expected <svg viewBox="0 0 W H"> with shapes painted with currentColor');
}
const k = WIDTH / Number(viewBox[1]);

/** 512 × 512 artwork; `scale` shrinks the mark around the centre (maskable safe zone). */
function svg(scale) {
  const t = (512 * (1 - scale)) / 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <rect width="512" height="512" fill="${BACKGROUND}"/>
  <g transform="translate(${t} ${t}) scale(${scale})">
    <g transform="translate(${(512 - WIDTH) / 2} ${TOP}) scale(${k})">${shapes.replaceAll('currentColor', SIGNATURE)}</g>
    <path d="M84 398c90-18 212-22 344-7" fill="none" stroke="${BRUSH}" stroke-width="16" stroke-linecap="round"/>
  </g>
</svg>`;
}

const ICONS = [
  { file: 'apple-touch-icon.png', size: 180, scale: 0.86 },
  { file: 'icon-192.png', size: 192, scale: 0.86 },
  { file: 'icon-512.png', size: 512, scale: 0.86 },
  { file: 'icon-maskable-512.png', size: 512, scale: 0.7 },
];

await mkdir(OUT, { recursive: true });
for (const { file, size, scale } of ICONS) {
  await sharp(Buffer.from(svg(scale)), { density: 72 * (size / 512) * 4 })
    .resize(size, size)
    .flatten({ background: BACKGROUND })
    .png({ compressionLevel: 9 })
    .toFile(path.join(OUT, file));
  console.log(`${file}  ${size}×${size}`);
}
