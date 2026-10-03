// src/renderer/views/backlog/backlog.js (#217): the Backlog in page tabs, Board (List / Kanban) and
// Roadmap, with one epic filter shared by both. It runs only inside the Electron renderer, so these
// tests check its source as a seam, the way test/renderer-backlog-filters.test.js does. What the
// Roadmap tab shows for a filter is checked for real in test/renderer-backlog-roadmap-view.test.js.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'views', 'backlog', 'backlog.js'), 'utf8');

test('the Backlog has page tabs Board and Roadmap', () => {
  assert.match(src, /role="tab"[^>]*>\s*Board\s*</);
  assert.match(src, /role="tab"[^>]*>\s*Roadmap\s*</);
  assert.match(src, /data-[a-z-]*tab="board"/);
  assert.match(src, /data-[a-z-]*tab="roadmap"/);
});

test('the Board tab has a List / Kanban switch', () => {
  assert.match(src, /data-[a-z-]*="list"[^>]*>\s*List\s*</);
  assert.match(src, /data-[a-z-]*="kanban"[^>]*>\s*Kanban\s*</);
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
