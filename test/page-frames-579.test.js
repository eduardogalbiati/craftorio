// #579 (phase 3 review): the apps' pages share one frame. apps/web/renderer/index.html is the
// desktop page with the browser composition's generated lists; `docs --check` compares only what
// sits between the generated markers, so this test compares the rest: outside the markers the two
// pages are identical (a change to the header or to a static modal in one page is a change to both).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { appPages } = require('../scripts/source-tree');

const ROOT = path.join(__dirname, '..');
const MARKERS = /<!-- generated:(\w+) -->[\s\S]*?<!-- \/generated:\1 -->/g;
const frameOf = (file) => fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n').replace(MARKERS, '<!-- generated:$1 -->');

test('every app\'s page is the desktop page outside the generated lists', () => {
  const pages = appPages(ROOT).map((a) => path.join(ROOT, a.page, 'index.html')).filter((f) => fs.existsSync(f));
  assert.ok(pages.length >= 2, `two pages at least (${pages.length}): the desktop's and the browser's`);
  const desktop = frameOf(path.join(ROOT, 'apps', 'desktop', 'renderer', 'index.html'));
  assert.match(desktop, /<!-- generated:styles -->[\s\S]*<!-- generated:scripts -->/, 'the frame keeps both markers');
  for (const page of pages) {
    const frame = frameOf(page);
    const rel = path.relative(ROOT, page).split(path.sep).join('/');
    if (frame === desktop) continue;
    const a = desktop.split('\n'); const b = frame.split('\n');
    const at = a.findIndex((line, i) => line !== b[i]);
    assert.fail(`${rel} differs from apps/desktop/renderer/index.html outside the generated lists, first at line ${at + 1}:\n  desktop: ${a[at]}\n  ${rel}: ${b[at]}`);
  }
});
