// #80 internals: the root UI folder ('./') and an empty UI folder list, read alike by the test id
// check (packages/engine/engine/test-ids.js) and the `ui_files` filter (engine/run/templates.js).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { missingTestIds, normFolder, stepFiles } = require('../engine/test-ids');
const { evalExpr, render } = require('../engine/run/templates');

function site(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'craftorio-80-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const write = (rel, text) => { fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true }); fs.writeFileSync(path.join(root, rel), text); };
  write('index.html', '<button data-testid="order">Order</button>');
  write('features/steps/app.steps.js', "page.getByTestId('order'); page.getByTestId('cart');");
  return root;
}

test('#80 normFolder: the root is empty, a folder has no ./ nor trailing slash', () => {
  assert.deepEqual(['./', '.', '', 'web/', './web\\pages/', 'index.html'].map(normFolder), ['', '', '', 'web', 'web/pages', 'index.html']);
});

test('#80 the root renderer folder leaves the step files out (their ids are not defined by them)', (t) => {
  const root = site(t);
  assert.deepEqual(stepFiles(root, { steps: ['features/steps'] }), ['features/steps/app.steps.js']);
  assert.deepEqual(missingTestIds(root, { steps: ['features/steps'], renderer: ['./'] }).map((m) => m.id), ['cart']);
});

test('#80 an empty renderer list is the whole repository, never src/renderer', (t) => {
  const root = site(t);
  assert.deepEqual(missingTestIds(root, { steps: ['features/steps'], renderer: [] }).map((m) => m.id), ['cart']);
});

test('#80 the root renderer skips specs, builds and tests: an id they cite is not defined by them', (t) => {
  const root = site(t);
  fs.mkdirSync(path.join(root, 'e2e'));
  fs.writeFileSync(path.join(root, 'e2e/menu.spec.ts'), "getByTestId('cart')");
  fs.mkdirSync(path.join(root, 'dist'));
  fs.writeFileSync(path.join(root, 'dist/bundle.js'), "getByTestId('cart')");
  for (const renderer of [[], ['./']]) {
    assert.deepEqual(missingTestIds(root, { steps: ['features/steps'], renderer }).map((m) => m.id), ['cart']);
  }
  // a named folder keeps reading all its files
  assert.deepEqual(missingTestIds(root, { steps: ['features/steps'], renderer: ['dist'] }).map((m) => m.id), ['order']);
});

// review 2: only the root's own build / test / docs folders are skipped; a nested folder with one of
// those names (a feature-sliced app's src/features/) is UI code and defines its ids
test('#80 the root renderer reads a nested folder named like a skipped one (src/features/)', (t) => {
  const root = site(t);
  fs.mkdirSync(path.join(root, 'src/features/cart'), { recursive: true });
  fs.writeFileSync(path.join(root, 'src/features/cart/cart.tsx'), '<div data-testid="cart"></div>');
  for (const renderer of [[], ['./']]) {
    assert.deepEqual(missingTestIds(root, { steps: ['features/steps'], renderer }).map((m) => m.id), []);
  }
});

test('#80 the missing_test_ids filter with no UI folders looks in the whole repository', (t) => {
  const root = site(t);
  const out = render('{{ dir | missing_test_ids(steps, ui) }}', { dir: root, steps: ['features/steps'], ui: [] });
  assert.match(out, /`cart`/);
  assert.doesNotMatch(out, /`order`/);
});

test('#80 the root UI folder holds pages and stylesheets, not a README or a package.json', () => {
  const ui = (files) => render("{{ files | ui_files(folders) | join(',') }}", { files, folders: ['./'] });
  assert.equal(ui(['index.html', 'css/style.css', 'README.md', 'package.json']), 'index.html,css/style.css');
  assert.equal(evalExpr('files | ui_files(folders) | length', { files: ['README.md'], folders: ['./'] }), false);
});
