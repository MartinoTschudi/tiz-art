#!/usr/bin/env node
/**
 * Generates the "TIZ Admin" home-screen icons in public/admin/icons/ (run once; the PNGs are
 * committed):  node scripts/dev/admin-icons.mjs
 *
 *   apple-touch-icon.png   180 × 180  iPhone "Aggiungi alla schermata Home" (opaque, iOS rounds it)
 *   icon-192.png / icon-512.png        Android / manifest, purpose "any"
 *   icon-maskable-512.png              manifest, purpose "maskable" (letters inside the safe circle)
 *
 * The letters are drawn as paths (no font needed), so the result is the same on every machine.
 */
import sharp from 'sharp';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'public', 'admin', 'icons');

const BACKGROUND = '#a8432a'; // the admin's terracotta accent
const LETTERS = '#fbf6ee';
const BRUSH = '#f0b84d';

/** 512 × 512 artwork; `scale` shrinks the mark around the centre (maskable safe zone). */
function svg(scale) {
  const t = (512 * (1 - scale)) / 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <rect width="512" height="512" fill="${BACKGROUND}"/>
  <g transform="translate(${t} ${t}) scale(${scale})">
    <g fill="${LETTERS}">
      <path d="M96 168h124v38h-43v138h-38V206H96z"/>
      <rect x="238" y="168" width="38" height="176"/>
      <path d="M294 168h122v34l-78 104h78v38H294v-34l78-104h-78z"/>
    </g>
    <path d="M110 384c74-17 178-21 292-7" fill="none" stroke="${BRUSH}" stroke-width="16" stroke-linecap="round"/>
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
