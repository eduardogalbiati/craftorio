// #373: the project city is drawn with three / React Three Fiber like the run's 3D view, built by
// scripts/build-3d.js into a generated script (no CDN) that the Architecture tab loads on first use.
// The build gains a city entry (a source under apps/desktop/renderer/ whose path names the city) and its
// output, a generated/*city*.js script defining a window.*City* global; the run's bundle stays.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..', '..');
const load = () => require('../../../scripts/build-3d');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

// every string the build module exports (paths, lists of paths, objects of paths)
const exportedStrings = (mod) => JSON.stringify(Object.fromEntries(Object.entries(mod).filter(([, v]) => typeof v !== 'function')));

// the renderer's own scripts (no JSX sources, no bundled module code)
function rendererScripts(dir = path.join(ROOT, 'apps', 'desktop', 'renderer')) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) return rendererScripts(full);
    return e.name.endsWith('.js') ? [full] : [];
  });
}

test('#373 build-3d declares a city entry and a generated city script', () => {
  const text = exportedStrings(load()).replace(/\\\\/g, '/');
  assert.match(text, /apps\/desktop\/renderer\/[^"]*city[^"]*\.jsx?"/i, `a city entry among ${text}`);
  assert.match(text, /generated\/[^"/]*city[^"/]*\.js"/i, `a generated city script among ${text}`);
});

test('#373 the in-memory build also compiles the city into a classic script defining a window.*City* global', { timeout: 120000 }, async (t) => {
  const out = await load().build({ write: false });
  if (!out) { t.skip('esbuild is not installed'); return; }
  const text = JSON.stringify(out);
  // booleans only: the bundles are a megabyte each
  assert.equal(/window\.\w*City\w*\s*=/.test(text), true, 'the city bundle defines its global');
  assert.equal(/window\.Run3DScene\s*=/.test(text), true, 'the run\'s 3D bundle is still built');
  assert.equal(/\beval\(|new Function\(/.test(text), false, 'script-src \'self\' allows no eval');
});

test('#373 the renderer loads the city script from generated/ on first use, never from a CDN or at start', () => {
  const users = rendererScripts().filter((f) => /generated\/[\w-]*city[\w-]*\.js/i.test(fs.readFileSync(f, 'utf8')));
  assert.ok(users.length > 0, 'a renderer script names the generated city script');
  for (const f of users) {
    const src = fs.readFileSync(f, 'utf8');
    assert.match(src, /document\.createElement\('script'\)/, `${path.basename(f)} loads it with a script element`);
    assert.doesNotMatch(src, /https?:\/\/[^'"`\s]*(unpkg|jsdelivr|cdnjs|esm\.sh|skypack)/i, `${path.basename(f)} uses no CDN`);
  }
  assert.doesNotMatch(read('apps/desktop/renderer/index.html'), /generated\/[\w-]*city[\w-]*\.js/i, 'not loaded when the app starts');
});
