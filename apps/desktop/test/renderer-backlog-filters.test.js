// apps/desktop/renderer/views/backlog/backlog.js: the epic filter (#138, rule in backlog-epics.js, checked
// for real in test/backlog-epics.test.js) combines with the label filter and the search, and
// narrows both the list and the kanban through the same `isShown`. It runs only inside the
// Electron renderer, so these tests check its source as a seam, the way
// test/renderer-backlog-assign.test.js checks the same file.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
// a page file by its page-relative name, in whichever layer holds it (the UI kit, a front, the page folder)
const pageFileOf = (rel) => require('../../../scripts/source-tree').pageFile(path.join(__dirname, '..', '..', '..'), rel);
const en = require('@multiagent/shared/i18n/en.json');

const src = fs.readFileSync(pageFileOf('views/backlog/backlog.js'), 'utf8');

test('matches: an issue must pass both the label filter and the epic filter (AND), before the search', () => {
  const fn = /const matches = \(i\) => \{[\s\S]*?\n  \};/.exec(src)[0];
  assert.match(fn, /if \(!matchesLabels\(i, bl\.labels\) \|\| !matchesEpic\(i, bl\.epic\)\) return false;/);
});

test('renderList and renderKanban both filter their issues through the same isShown (matches + state), so the epic filter narrows either view', () => {
  assert.match(src, /const isShown = \(i\) => inState\(i\) && matches\(i\);/);
  const list = /function renderList\(issues\)[\s\S]*?\n  \}/.exec(src)[0];
  const kanban = /function renderKanban\(issues\)[\s\S]*?\n  \}/.exec(src)[0];
  assert.match(list, /issues\.filter\(isShown\)/);
  assert.match(kanban, /issues\.filter\(isShown\)/);
});

test('filtering() and the "No issues match" message both account for the epic filter, like labels and the search', () => {
  assert.match(src, /const filtering = \(\) => !!bl\.q \|\| bl\.labels\.length > 0 \|\| !!bl\.epic;/);
  const noMatch = /const noMatch = \(\) => `[\s\S]*?`;/.exec(src)[0];
  assert.match(noMatch, /bl\.epic \? t\('backlog\.epic_value'/);
  assert.match(en['backlog.epic_value'], /^Epic: /);
});

test('the epic select is hidden with no epics, and in the Epics view (it shows on the Board and the Roadmap, #217)', () => {
  const fn = /function renderEpicFilter\(issues\)[\s\S]*?\n  \}/.exec(src)[0];
  assert.match(fn, /sel\.classList\.toggle\('hidden', !epics\.length \|\| bl\.mode === 'epics'\);/);
});

test('a card\'s epic badge filters the list by that epic on click, toggling off when clicked again outside the Epics view', () => {
  const badge = /const epicBadge = \(i\) => \{[\s\S]*?\n  \};/.exec(src)[0];
  assert.match(badge, /data-epic-filter="\$\{esc\(e\.id\)\}"/);
  const filterEpic = /function filterEpic\(id\)[\s\S]*?\n  \}/.exec(src)[0];
  assert.match(filterEpic, /bl\.epic = bl\.epic === id && bl\.mode !== 'epics' \? '' : id;/);
});

test('switching projects or syncing again clears or prunes a stale epic filter (pruneEpic), never pointing at an epic that no longer exists', () => {
  assert.match(src, /bl\.epic = '';/); // reset when the project changes
  assert.match(src, /bl\.epic = pruneEpic\(bl\.epic, data\?\.epics\);/); // pruned after a sync
});
