// Where the admin runs (public/admin/js/env.js): base paths for both hostings, and the local
// ?api= override that must be impossible on any other host.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { resolveEnv, GITHUB_API } from '../../public/admin/js/env.js';

const at = (href) => {
  const u = new URL(href);
  return resolveEnv({ origin: u.origin, hostname: u.hostname, pathname: u.pathname, search: u.search });
};

describe('admin environment', () => {
  test('GitHub Pages preview: base /tiz-art/', () => {
    const env = at('https://martinotschudi.github.io/tiz-art/admin/');
    assert.equal(env.siteBase, '/tiz-art/');
    assert.equal(env.adminBase, '/tiz-art/admin/');
    assert.equal(env.authFile, '/tiz-art/admin/auth.json');
    assert.equal(env.siteUrl('opere/sorellanza/'), 'https://martinotschudi.github.io/tiz-art/opere/sorellanza/');
    assert.equal(env.apiBase, GITHUB_API);
  });

  test('own domain: base /, also with index.html and from the setup page', () => {
    for (const href of ['https://tiz-art.ch/admin/', 'https://tiz-art.ch/admin/index.html#/opera/x', 'https://tiz-art.ch/admin/setup/']) {
      const env = at(href);
      assert.equal(env.siteBase, '/', href);
      assert.equal(env.adminBase, '/admin/', href);
    }
    assert.equal(at('https://martinotschudi.github.io/tiz-art/admin/setup/').adminBase, '/tiz-art/admin/');
  });

  test('raw files at an exact commit (public repository)', () => {
    const env = at('https://tiz-art.ch/admin/');
    assert.equal(
      env.rawUrl('MartinoTschudi', 'tiz-art', 'abc123', 'src/content/opere/e-fuori-piove/01.jpg'),
      'https://raw.githubusercontent.com/MartinoTschudi/tiz-art/abc123/src/content/opere/e-fuori-piove/01.jpg',
    );
  });

  test('?api= works only on localhost / 127.0.0.1 and only towards a local server', () => {
    const dev = at('http://localhost:4330/admin/index.html?api=http://localhost:8787');
    assert.equal(dev.dev, true);
    assert.equal(dev.apiBase, 'http://localhost:8787');
    assert.equal(dev.authFile, '/admin/auth.dev.json');
    assert.equal(dev.query, '?api=http%3A%2F%2Flocalhost%3A8787');
    assert.equal(dev.rawUrl('o', 'r', 'c1', 'src/a b.jpg'), 'http://localhost:8787/raw/c1/src/a%20b.jpg');
    assert.equal(at('http://127.0.0.1:4330/tiz-art/admin/?api=http://127.0.0.1:8787').apiBase, 'http://127.0.0.1:8787');

    for (const href of [
      'https://tiz-art.ch/admin/?api=http://localhost:8787', // real site: ignored
      'https://martinotschudi.github.io/tiz-art/admin/?api=https://evil.example', // ignored
      'http://localhost:4330/admin/?api=https://evil.example', // local page, foreign API: ignored
      'http://localhost:4330/admin/?api=javascript:alert(1)',
      'http://localhost.evil.example/admin/?api=http://localhost:8787',
    ]) {
      const env = at(href);
      assert.equal(env.dev, false, href);
      assert.equal(env.apiBase, GITHUB_API, href);
      assert.match(env.authFile, /\/auth\.json$/, href);
      assert.equal(env.query, '', href);
    }
  });
});
