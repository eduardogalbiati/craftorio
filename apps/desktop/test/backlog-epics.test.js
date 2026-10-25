// apps/desktop/renderer/views/backlog/backlog-epics.js: the epic filter rule, its options with counts, a
// stale filter falling back, and an epic's progress. Pure functions, no DOM: backlog.js draws the
// select, badges and the Epics view around them (checked separately, as a seam, in
// test/renderer-backlog-filters.test.js).
const test = require('node:test');
const assert = require('node:assert/strict');
const backlogEpics = require('../renderer/views/backlog/backlog-epics');

test('matchesEpic: no filter shows every issue; "none" shows issues with no epic and leaves epics themselves out; an id shows only its members', () => {
  const member = { number: 1, epic: '#9' };
  const loose = { number: 2 };
  const epicItself = { number: 9, isEpic: true };
  assert.equal(backlogEpics.matchesEpic(member, ''), true);
  assert.equal(backlogEpics.matchesEpic(loose, ''), true);
  assert.equal(backlogEpics.matchesEpic(member, backlogEpics.NONE), false);
  assert.equal(backlogEpics.matchesEpic(loose, backlogEpics.NONE), true);
  assert.equal(backlogEpics.matchesEpic(epicItself, backlogEpics.NONE), false);
  assert.equal(backlogEpics.matchesEpic(member, '#9'), true);
  assert.equal(backlogEpics.matchesEpic(member, '#1'), false);
});

test('epicOptions: each epic counts only the issues already shown by the other filters, then "No epic"', () => {
  const epics = [{ id: '#9', title: 'Theme' }, { id: '#10', title: 'Other' }];
  const shown = [{ number: 1, epic: '#9' }, { number: 2, epic: '#9' }, { number: 3 }];
  const options = backlogEpics.epicOptions(epics, shown);
  assert.deepEqual(options, [
    { id: '#9', title: 'Theme', count: 2 },
    { id: '#10', title: 'Other', count: 0 },
    { id: backlogEpics.NONE, title: 'No epic', count: 1 },
  ]);
});

test('pruneEpic: a filter whose epic no longer exists after a sync falls back to showing every issue', () => {
  const epics = [{ id: '#9' }];
  assert.equal(backlogEpics.pruneEpic('#9', epics), '#9');
  assert.equal(backlogEpics.pruneEpic('#404', epics), '');
  assert.equal(backlogEpics.pruneEpic('', epics), '');
  assert.equal(backlogEpics.pruneEpic(backlogEpics.NONE, epics), backlogEpics.NONE);
});

test('epicProgress: counts members closed on the platform and done (or planned) in the roadmap', () => {
  const issues = [
    { number: 1, state: 'closed', roadmap: { status: 'done' } },
    { number: 2, state: 'open', roadmap: { status: 'planned' } },
    { number: 3, state: 'open' },
    { number: 4, state: 'open', roadmap: { status: 'skipped' } },
  ];
  const progress = backlogEpics.epicProgress({ members: [1, 2, 3, 4, 404] }, issues); // #404 not synced: dropped
  assert.deepEqual(progress, { open: 3, closed: 1, total: 4, roadmapDone: 1, inRoadmap: 2, done: 1 });
});
