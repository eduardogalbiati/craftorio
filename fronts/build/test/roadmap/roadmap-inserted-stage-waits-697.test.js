// #697 on the Roadmap screen (fronts/build/views/backlog/backlog-roadmap.js): a stage added before the
// running stage waits for it. Acceptance tests, written before the code.
//
// Assumed interface (the developer implements it):
// - Only one stage is current (`data-testid="roadmap-stage-current"` badge, `data-current="true"` on
//   its section): the running one. The inserted stage is neither current nor running.
// - The inserted stage (an unstarted stage before the running one) shows a marker
//   `data-testid="roadmap-stage-waits"` inside its section, whose text names the running stage's
//   number (e.g. en "Waits for stage 2"; i18n key `backlog_roadmap.waits_for_stage` with `{stage}`).
//   No marker when nothing runs, or on the stages after the running one.
const test = require('node:test');
const assert = require('node:assert/strict');
const H = require('../roadmap-status-helpers');

const SHOW_ALL = { showAll: true, since: 'total' };
const RUN_ID = '20261103-100000-insert01';

// stage 1: inserted (planned); stage 2: its item runs a turn; stage 3: planned
function insertedBeforeRunning() {
  const running = H.item('i1', 'running', 1, 'One', { runId: RUN_ID, run: H.run() });
  return H.roadmapOf([
    { id: 's-new', name: '', note: '', items: [H.item('i9', 'planned', 9, 'Nine')] },
    { id: 's1', name: '', note: '', items: [running] },
    { id: 's2', name: '', note: '', items: [H.item('i2', 'planned', 2, 'Two')] },
  ]);
}
const draw = (d) => H.loadRoadmap().R.html(d, () => {}, SHOW_ALL);
const sections = (html) => H.findAll(html, (e) => e.attrs['data-testid'] === 'roadmap-stage');
const waitsIn = (section) => H.findAll(section.outer, (e) => e.attrs['data-testid'] === 'roadmap-stage-waits');

test('#697 screen: only the running stage is marked current; the inserted stage is not', () => {
  const all = sections(draw(insertedBeforeRunning()));
  assert.equal(all.length, 3);
  const current = all.map((s) => H.findAll(s.outer, (e) => e.attrs['data-testid'] === 'roadmap-stage-current').length);
  assert.deepEqual(current, [0, 1, 0]);
  assert.deepEqual(all.map((s) => s.attrs['data-current'] === 'true'), [false, true, false]);
});

test('#697 screen: the inserted stage shows it waits for the running stage (its number)', () => {
  const [inserted] = sections(draw(insertedBeforeRunning()));
  const marks = waitsIn(inserted);
  assert.equal(marks.length, 1, 'one roadmap-stage-waits marker in the inserted stage');
  assert.match(H.visibleText(marks[0].inner), /\b2\b/);
});

test('#697 screen: no waits marker on the running stage, the stages after it, or when nothing runs', () => {
  const all = sections(draw(insertedBeforeRunning()));
  assert.deepEqual([waitsIn(all[1]).length, waitsIn(all[2]).length], [0, 0]);
  const idle = H.roadmapOf([
    { id: 's1', name: '', note: '', items: [H.item('i1', 'planned', 1, 'One')] },
    { id: 's2', name: '', note: '', items: [H.item('i2', 'planned', 2, 'Two')] },
  ]);
  assert.deepEqual(sections(draw(idle)).map((s) => waitsIn(s).length), [0, 0]);
});
