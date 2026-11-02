// Smoke tests for the files of public/admin/: modules parse and import, relative imports exist,
// the exact CSP of CONTRACTS.md 7.1, manifest + icons, no HTML injection, no shop concepts.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import sharp from 'sharp';

const ADMIN = fileURLToPath(new URL('../../public/admin/', import.meta.url));
const CSP =
  "default-src 'self'; img-src 'self' blob: data: https://raw.githubusercontent.com http://localhost:8787 http://127.0.0.1:8787; " +
  "connect-src 'self' https://api.github.com https://raw.githubusercontent.com http://localhost:8787 http://127.0.0.1:8787; " +
  "style-src 'self'; script-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

const files = walk(ADMIN).filter((f) => !/auth(\.dev)?\.json$/.test(f));
const jsFiles = files.filter((f) => f.endsWith('.js'));
const ENTRY_POINTS = ['app.js', 'setup.js']; // they boot the page, so they need a DOM

describe('admin files', () => {
  test('every module is valid JavaScript and every relative import exists', () => {
    assert.ok(jsFiles.length >= 15);
    for (const file of jsFiles) {
      execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });
      for (const [, spec] of readFileSync(file, 'utf8').matchAll(/\bfrom\s+'(\.{1,2}\/[^']+)'/g)) {
        assert.ok(existsSync(path.resolve(path.dirname(file), spec)), `${path.relative(ADMIN, file)} imports missing ${spec}`);
      }
    }
  });

  test('every module except the entry points imports in Node (no DOM needed at load time)', async () => {
    for (const file of jsFiles.filter((f) => !ENTRY_POINTS.includes(path.basename(f)))) {
      const mod = await import(pathToFileURL(file).href);
      assert.ok(Object.keys(mod).length > 0, `${path.relative(ADMIN, file)} exports something`);
    }
  });

  test('both pages: exact CSP, noindex, module script, no inline script or style', () => {
    for (const page of ['index.html', 'setup/index.html']) {
      const html = readFileSync(path.join(ADMIN, page), 'utf8');
      assert.equal(/http-equiv="Content-Security-Policy" content="([^"]+)"/.exec(html)[1], CSP, page);
      assert.match(html, /<meta name="robots" content="noindex/);
      assert.match(html, /<script type="module" src="\.\/(js\/app|setup)\.js"><\/script>/);
      assert.equal((html.match(/<script/g) || []).length, 1, `${page}: one external script only`);
      assert.doesNotMatch(html, /<style|style="/, `${page}: style-src 'self' forbids inline styles`);
      assert.match(html, /<html lang="it">/);
    }
  });

  test('relative URLs only, so the admin works under /admin/ and /tiz-art/admin/', () => {
    for (const file of files.filter((f) => /\.(html|js|css|webmanifest)$/.test(f))) {
      const text = readFileSync(file, 'utf8');
      assert.doesNotMatch(text, /(?:href|src)="\/(?!\/)/, `${path.relative(ADMIN, file)}: absolute path`);
      assert.doesNotMatch(text, /fetch\(\s*['"`]\//, `${path.relative(ADMIN, file)}: absolute fetch`);
    }
  });

  test('manifest "TIZ Admin" with the icons in the right sizes; apple-touch-icon is opaque', async () => {
    const manifest = JSON.parse(readFileSync(path.join(ADMIN, 'manifest.webmanifest'), 'utf8'));
    assert.equal(manifest.name, 'TIZ Admin');
    assert.equal(manifest.start_url, './');
    assert.equal(manifest.display, 'standalone');
    assert.ok(manifest.icons.some((i) => i.purpose === 'maskable'));
    for (const icon of manifest.icons) {
      const meta = await sharp(path.join(ADMIN, icon.src)).metadata();
      assert.equal(`${meta.width}x${meta.height}`, icon.sizes, icon.src);
    }
    const apple = await sharp(path.join(ADMIN, 'icons/apple-touch-icon.png')).metadata();
    assert.equal(apple.width, 180);
    assert.equal(apple.hasAlpha, false);
    assert.match(readFileSync(path.join(ADMIN, 'index.html'), 'utf8'), /apple-mobile-web-app-title" content="TIZ Admin"/);
  });

  test('no HTML injection: innerHTML only for the static icon set', () => {
    for (const file of jsFiles) {
      const uses = readFileSync(file, 'utf8').match(/\.innerHTML\s*=/g) || [];
      if (path.basename(file) === 'ui.js') assert.equal(uses.length, 1);
      else assert.equal(uses.length, 0, path.relative(ADMIN, file));
      assert.doesNotMatch(readFileSync(file, 'utf8'), /insertAdjacentHTML|outerHTML\s*=|document\.write/, file);
    }
  });

  test('pure portfolio: no prices, sales or payments anywhere in the admin', () => {
    for (const file of files.filter((f) => /\.(html|js|css|webmanifest)$/.test(f))) {
      assert.doesNotMatch(readFileSync(file, 'utf8'), /prezzo|price|venduta|vendita|CHF|pagamento|checkout|zahls|csv/i, path.relative(ADMIN, file));
    }
  });

  test('inputs are at least 16 px (no zoom on iPhone), base text at least 17 px', () => {
    const css = readFileSync(path.join(ADMIN, 'admin.css'), 'utf8');
    assert.match(css, /body \{[^}]*font: 17px/);
    assert.match(css, /\.input \{[^}]*font-size: 17px/);
  });
});
