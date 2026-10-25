// fronts/build/views/backlog/backlog.js (#217): the Backlog in page tabs, Board (List / Kanban) and
// Roadmap, with one epic filter shared by both. It runs only inside the Electron renderer, so these
// tests check its source as a seam, the way test/renderer-backlog-filters.test.js does. What the
// Roadmap tab shows for a filter is checked for real in test/renderer-backlog-roadmap-view.test.js.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
// a page file by its page-relative name, in whichever layer holds it (the UI kit, a front, the page folder)
const pageFileOf = (rel) => require('../../../scripts/source-tree').pageFile(path.join(__dirname, '..', '..', '..'), rel);
const en = require('@multiagent/shared/i18n/en.json');

const src = fs.readFileSync(pageFileOf('views/backlog/backlog.js'), 'utf8');

// #254: the Roadmap left the Backlog's tabs for a screen of its own (Code & Build › Roadmap)
test('the Backlog has page tabs Board and Epics; the Roadmap is no longer one of them', () => {
  assert.match(src, /role="tab"[^>]*>\s*\$\{t\('backlog\.board'\)\}\s*</);
  assert.equal(en['backlog.board'], 'Board');
  assert.match(src, /role="tab"[^>]*>\s*\$\{t\('backlog\.epics'\)\}\s*</);
  assert.equal(en['backlog.epics'], 'Epics');
  assert.match(src, /data-[a-z-]*tab="board"/);
  assert.doesNotMatch(src, /data-[a-z-]*tab="roadmap"/);
});

test('the Board tab has a List / Kanban switch', () => {
  assert.match(src, /data-[a-z-]*="list"[^>]*>\s*\$\{t\('backlog\.list'\)\}\s*</);
  assert.equal(en['backlog.list'], 'List');
  assert.match(src, /data-[a-z-]*="kanban"[^>]*>\s*\$\{t\('backlog\.kanban'\)\}\s*</);
  assert.equal(en['backlog.kanban'], 'Kanban');
});

test('the epic filter is no longer hidden on the Roadmap tab', () => {
  const fn = /function renderEpicFilter\([^)]*\) \{[\s\S]*?\n  \}/.exec(src)?.[0];
  assert.ok(fn, 'renderEpicFilter not found in backlog.js');
  assert.doesNotMatch(fn, /'roadmap'/);
});

test('the Roadmap tab gets the shared epic filter and its Show all choice', () => {
  const call = /BacklogRoadmap\.html\(([^\n]*)\)/.exec(src)?.[1] || '';
  assert.match(call, /\bepic\b/);
  assert.match(call, /showAll/);
});
