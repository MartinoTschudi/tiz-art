// Guards on the GitHub Actions workflows (CONTRACTS §8). image-cache.yml only reads the Astro image
// cache that deploy.yml saves, so GitHub does not delete it after 7 quiet days. It keeps the entry
// alive only while both compute the same key prefix, wire it the same way, cache the same path and
// run on the same runner (the cache version depends on path and OS): any difference makes every
// restore miss without an error, which nobody would notice until the next slow Deploy. The files are
// read as text (no YAML dependency); comment lines are ignored.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const workflow = (name) => {
  const text = readFileSync(new URL(`../../.github/workflows/${name}`, import.meta.url), 'utf8');
  return { name, lines: text.split('\n').filter((line) => !/^\s*#/.test(line)) };
};
const deploy = workflow('deploy.yml');
const keepAlive = workflow('image-cache.yml');

/** All lines matching `re`, trimmed and without a trailing comment. */
const linesOf = (wf, re) => wf.lines.filter((line) => re.test(line)).map((line) => line.replace(/\s+#.*$/, '').trim());

/** The single line matching `re`; fails when there is none or more than one. */
function onlyLine(wf, re) {
  const found = linesOf(wf, re);
  assert.equal(found.length, 1, `${wf.name}: expected exactly one line matching ${re}, found ${found.length}`);
  return found[0];
}

const PREFIX = /echo "prefix=astro-images-/;
const CACHE_PATH = /^\s*path: node_modules\/\.astro\//;
const PREFIX_REF = '${{ steps.image-prefix.outputs.prefix }}';

describe('image cache: image-cache.yml restores exactly what deploy.yml saves', () => {
  test('the same cache key prefix (same version, same files hashed)', () => {
    assert.equal(onlyLine(keepAlive, PREFIX), onlyLine(deploy, PREFIX));
  });

  test('both use that prefix: step id image-prefix, restore-keys = prefix, key starts with it', () => {
    for (const wf of [deploy, keepAlive]) {
      assert.equal(onlyLine(wf, /^\s*id: image-prefix\s*$/), 'id: image-prefix');
      assert.equal(onlyLine(wf, /^\s*restore-keys:/), `restore-keys: ${PREFIX_REF}`);
    }
    for (const key of linesOf(keepAlive, /^\s*key:/)) assert.ok(key.startsWith(`key: ${PREFIX_REF}`), `image-cache.yml: ${key}`);
    // deploy.yml saves under the pruned set's id, which itself starts with the prefix (Prune image cache).
    assert.ok(deploy.lines.some((line) => line.includes('set_id="${PREFIX}')), 'deploy.yml: the saved key no longer starts with PREFIX');
  });

  test('the same single-line cache path everywhere, and the same runner', () => {
    const deployPaths = linesOf(deploy, CACHE_PATH);
    assert.equal(deployPaths.length, 2, 'deploy.yml: expected the cache path on restore and save');
    assert.equal(new Set(deployPaths).size, 1, `deploy.yml: restore and save use different paths: ${deployPaths}`);
    assert.equal(onlyLine(keepAlive, CACHE_PATH), deployPaths[0]);
    for (const wf of [deploy, keepAlive]) {
      assert.ok(!wf.lines.some((line) => /enableCrossOsArchive/.test(line)), `${wf.name}: enableCrossOsArchive changes the cache version`);
    }
    const runners = new Set([...linesOf(deploy, /^\s*runs-on:/), ...linesOf(keepAlive, /^\s*runs-on:/)]);
    assert.deepEqual([...runners], ['runs-on: ubuntu-latest']);
  });

  test('every file deploy.yml hashes is checked out by image-cache.yml', () => {
    const hashed = [...onlyLine(deploy, PREFIX).matchAll(/'([^']+)'/g)].map((m) => m[1]);
    assert.ok(hashed.length > 0, 'deploy.yml: hashFiles() lists no files');
    const checkedOut = new Set(keepAlive.lines.map((line) => line.trim()));
    for (const file of hashed) assert.ok(checkedOut.has(`/${file}`), `image-cache.yml: sparse-checkout lacks /${file}`);
  });

  test('it only restores and only reads: no save, no publish, no write permission', () => {
    const text = keepAlive.lines.join('\n');
    assert.match(text, /uses: actions\/cache\/restore@/);
    assert.doesNotMatch(text, /actions\/cache\/save@|uses: actions\/cache@/);
    assert.doesNotMatch(text, /deploy-pages|upload-pages-artifact|npm (ci|run build)/);
    assert.equal(onlyLine(keepAlive, /^permissions:/), 'permissions: {}');
    assert.deepEqual(linesOf(keepAlive, /^\s+[a-z-]+: (read|write|none)\s*(#.*)?$/), ['contents: read']);
    assert.doesNotMatch(text, /write-all|: write\b/);
  });

  test('scheduled every day or nearly: at most 2 days between two runs (GitHub deletes after 7, and may drop a run)', () => {
    assert.ok(keepAlive.lines.some((line) => /^\s+schedule:\s*$/.test(line)), 'image-cache.yml: no schedule trigger');
    const crons = linesOf(keepAlive, /^\s*-\s*cron:/).map((line) => /cron:\s*['"]([^'"]+)['"]/.exec(line)?.[1]);
    assert.ok(crons.length > 0 && crons.every(Boolean), 'image-cache.yml: no readable cron line');
    const days = new Set();
    for (const cron of crons) {
      const [, , dom, month, dow] = cron.split(/\s+/);
      assert.equal(`${dom} ${month}`, '* *', `cron "${cron}": only weekday schedules are checked`);
      for (const part of dow.split(',')) {
        if (part === '*') [0, 1, 2, 3, 4, 5, 6].forEach((d) => days.add(d));
        else {
          const [from, to = from] = part.split('-').map(Number);
          for (let d = from; d <= to; d++) days.add(d % 7);
        }
      }
    }
    const sorted = [...days].sort((a, b) => a - b);
    const gaps = sorted.map((day, i) => (i + 1 < sorted.length ? sorted[i + 1] : sorted[0] + 7) - day);
    assert.ok(Math.max(...gaps) <= 2, `longest gap ${Math.max(...gaps)} days`);
  });
});
