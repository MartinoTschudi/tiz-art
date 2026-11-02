#!/usr/bin/env node
/**
 * Renders the public site's PNG icons from public/favicon.svg (run after changing the SVG, e.g. in a
 * redesign; the PNGs are committed):  node scripts/dev/site-icons.mjs [--out <folder>]
 *
 *   favicon-32.png         32 × 32   browsers that do not use the SVG favicon
 *   apple-touch-icon.png   180 × 180 iPhone "Aggiungi alla schermata Home" (opaque: iOS rounds it)
 *
 * The apple-touch-icon background is the fill of the SVG's <rect>, so it follows the new colours.
 * --out writes the PNGs somewhere else (to compare them before replacing the committed ones).
 */
import sharp from 'sharp';
import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PUBLIC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'public');

/** `--out <folder>` or public/. */
function outDir(argv) {
  const i = argv.indexOf('--out');
  if (i === -1) return PUBLIC;
  if (!argv[i + 1]) throw new Error('--out needs a folder');
  return path.resolve(argv[i + 1]);
}

async function main() {
  const out = outDir(process.argv.slice(2));
  const svg = await readFile(path.join(PUBLIC, 'favicon.svg'));
  const background = /<rect\b[^>]*\bfill="(#[0-9a-fA-F]{3,8})"/.exec(svg.toString('utf8'))?.[1];
  if (!background) throw new Error('public/favicon.svg: no <rect fill="#…"> to use as the background of apple-touch-icon.png');
  await mkdir(out, { recursive: true });
  await sharp(svg, { density: 300 }).resize(32, 32).png().toFile(path.join(out, 'favicon-32.png'));
  await sharp(svg, { density: 600 }).resize(180, 180).flatten({ background }).png().toFile(path.join(out, 'apple-touch-icon.png'));
  console.log(`favicon-32.png and apple-touch-icon.png written to ${out} (background ${background})`);
}

main().catch((err) => {
  console.error(`site-icons: ${err.message}`);
  process.exitCode = 1;
});
