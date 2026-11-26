// #57 internals: the reason a UI change is not reviewed (packages/engine/engine/test-ids.js screenNotReviewed,
// uiFiles) and what an empty project is (projectFacts: kind null for a README and dotfiles only).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { screenNotReviewed, uiFiles } = require('../engine/test-ids');
const { projectFacts, runDefaultsWith } = require('../domains/project/project-run-defaults');

function folderWith(t, files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kind-new-57-int-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  for (const [rel, body] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), body);
  }
  return dir;
}

test('#57 uiFiles: by extension without UI folders, by folder with them', () => {
  assert.deepEqual(uiFiles(['src/App.jsx', 'README.md', 'index.html'], []), ['src/App.jsx', 'index.html']);
  assert.deepEqual(uiFiles(['web/a.js', 'src/App.jsx'], ['web/']), ['web/a.js']);
  assert.deepEqual(uiFiles(['css/site.css', 'package.json'], ['./']), ['css/site.css']);
});

test('#57 screenNotReviewed: empty without UI files, a reason with screenshots off, none when reviewed', () => {
  const ui = { files_changed: ['src/App.jsx'] };
  assert.equal(screenNotReviewed({ files_changed: ['main.go'] }, { screenshots: 'off', ui_folders: [] }), '');
  assert.match(screenNotReviewed(ui, { screenshots: 'off', ui_folders: [] }), /screenshots are off/);
  assert.equal(screenNotReviewed(ui, { screenshots: 'changed', ui_folders: [] }), '');
  assert.match(screenNotReviewed(ui, { screenshots: 'changed', ui_folders: [] }, false), /no screenshots/);
  assert.equal(screenNotReviewed(null, { screenshots: 'off' }), '');
});

test('#57 projectFacts: a README and dotfiles are an empty project (kind null); README + LICENSE stays docs', (t) => {
  assert.equal(projectFacts(folderWith(t, { 'readme.txt': 'x\n', '.gitignore': 'x\n' })).kind, null);
  assert.equal(projectFacts(folderWith(t, { 'README.md': 'x\n', LICENSE: 'MIT\n' })).kind, 'docs');
  const d = runDefaultsWith({ project: { folder: folderWith(t, { 'README.md': 'x\n' }) } });
  assert.deepEqual({ kind: d.kind, screenshots: d.screenshots, ui_folders: d.ui_folders, e2e_tests: d.e2e_tests }, { kind: null, screenshots: 'changed', ui_folders: [], e2e_tests: 'off' });
});
