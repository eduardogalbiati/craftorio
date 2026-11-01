// scripts/site.js: the public page's build copies the reader, the items' markdown and images and the
// changelog, lists the items in docs/work/index.json, and leaves out what a static host must not serve.
// Seam: buildSite on a planted repository in a temporary folder.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { buildSite, kindOf, workItems } = require('../scripts/site');

function plant() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'site-build-'));
  const put = (rel, text = 'x') => { fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true }); fs.writeFileSync(path.join(root, rel), text); };
  put('site/index.html', '<!doctype html>');
  put('site/assets/reader.js', '// reader');
  put('site/item.html', '<link rel="stylesheet" href="assets/reader.css"><script src="assets/reader.js"></script><script src="https://cdnjs.example/x.js"></script>');
  put('site/assets/reader.css', 'body{}');
  put('docs/work/README.md', '---\ntitle: T\n---\n');
  put('docs/work/onboarding/intent.md', '# Intent');
  put('docs/work/onboarding/intent.pt-BR.md', '# Intent');
  put('docs/work/onboarding/images/mock-1.jpg');
  put('docs/work/onboarding/notes.html', '<script>alert(1)</script>');
  put('docs/work/later/spec.md', '# Spec');
  put('docs/work/no-stage/notes.md', 'not an item');
  put('docs/work/open-source/milestone.md', '---\nkind: milestone\n---\n');
  put('CHANGELOG.md', '# Changelog');
  put('apps/desktop/assets/icon-source.svg', '<svg xmlns="http://www.w3.org/2000/svg"></svg>');
  put('apps/desktop/assets/icon.png', 'png');
  return root;
}

test('an item is a folder of docs/work/ with a stage file or a milestone.md', () => {
  const root = plant();
  assert.deepEqual(workItems(root), ['later', 'onboarding', 'open-source']);
  assert.deepEqual(workItems(path.join(root, 'nowhere')), []);
  assert.equal(kindOf(root, 'onboarding'), 'item');
  assert.equal(kindOf(root, 'open-source'), 'milestone');
});

test('the site holds the reader, the markdown, the images, the changelog and the item list', () => {
  const root = plant();
  const out = path.join(root, 'build', 'site');
  fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(path.join(out, 'stale.txt'), 'from an earlier build');
  const { items, files } = buildSite(root, out);
  assert.deepEqual(items, ['later', 'onboarding', 'open-source']);
  for (const f of ['index.html', 'assets/reader.js', 'assets/icon.svg', 'assets/icon.png', 'docs/work/README.md', 'docs/work/onboarding/intent.pt-BR.md', 'docs/work/onboarding/images/mock-1.jpg', 'CHANGELOG.md', 'docs/work/index.json']) {
    assert.ok(files.includes(f), f);
    assert.ok(fs.existsSync(path.join(out, f)), f);
  }
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(out, 'docs/work/index.json'), 'utf8')), [
    { name: 'later', kind: 'item' }, { name: 'onboarding', kind: 'item' }, { name: 'open-source', kind: 'milestone' },
  ]);
  assert.ok(fs.existsSync(path.join(out, '.nojekyll')));
  // a page or a script under docs/work/ is never published, and the folder starts empty
  assert.ok(!fs.existsSync(path.join(out, 'docs/work/onboarding/notes.html')));
  assert.ok(!fs.existsSync(path.join(out, 'stale.txt')));
  assert.ok(!fs.existsSync(path.join(out, 'CHANGELOG.pt-BR.md')));
});

test('the pages name their own scripts and stylesheets with a version of the content (a cached old reader never meets new data)', () => {
  const root = plant();
  const out = path.join(root, 'build', 'site');
  buildSite(root, out);
  const html = fs.readFileSync(path.join(out, 'item.html'), 'utf8');
  const js = html.match(/src="assets\/reader\.js\?v=([0-9a-f]{10})"/);
  assert.ok(js, html);
  assert.match(html, /href="assets\/reader\.css\?v=[0-9a-f]{10}"/);
  assert.match(html, /src="https:\/\/cdnjs\.example\/x\.js"/, 'an outside script keeps its address');
  // a changed reader gets a new version
  fs.writeFileSync(path.join(root, 'site/assets/reader.js'), '// reader, changed');
  buildSite(root, out);
  assert.notEqual(fs.readFileSync(path.join(out, 'item.html'), 'utf8').match(/reader\.js\?v=([0-9a-f]{10})/)[1], js[1]);
});
