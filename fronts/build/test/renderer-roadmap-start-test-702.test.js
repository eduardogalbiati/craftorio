// #702 on the Roadmap (fronts/build/views/backlog/backlog-roadmap.js): a built work item (its plan's
// Progress N of N, plan.md `status: built`) offers "Start Test" (the sdlc-test workflow); no other item
// does. backlog-roadmap.js evaluated in a vm sandbox (test/roadmap-status-helpers.js loadRoadmap, as
// renderer-roadmap-pr-card-809.test.js).
// The interface these tests assume:
// - The service's item carries its work item: `sdlc: { item: '<folder under docs/work/>', status: '<plan.md status>' }`
//   (absent when its issues name no work item).
// - The button: `data-testid="roadmap-item-start-test"` inside the item, its visible text "Start Test".
const test = require('node:test');
const assert = require('node:assert/strict');
const H = require('./roadmap-status-helpers');

const view = { showAll: true, since: 'total' };
const runTitle = (r) => (r && (r.title || r.runId)) || 'workflow';
const doneItem = (id, extra = {}) => H.item(id, 'done', 12, 'Add the editor', {
  runId: `run-${id}`, runs: [`run-${id}`], origin: H.iso(H.NOW - 2 * H.HOUR), error: null,
  run: H.run({ status: 'success', startedAt: H.iso(H.NOW - 60 * H.MIN), finishedAt: H.iso(H.NOW - 30 * H.MIN) }),
  ...extra,
});
function render(items) {
  const { R } = H.loadRoadmap({ runTitle });
  return R.html(H.roadmapOf([{ id: 'st1', name: '', note: '', items }]), () => {}, view);
}
const startTest = (html, id) => H.findEl(H.itemEl(html, id).outer, (e) => e.attrs['data-testid'] === 'roadmap-item-start-test');

test('#702 roadmap: a built item offers "Start Test"', () => {
  const btn = startTest(render([doneItem('a', { sdlc: { item: 'write-doc', status: 'built' } })]), 'a');
  assert.deepEqual([btn !== null, btn ? /Start Test/i.test(H.visibleText(btn.inner)) : false], [true, true]);
});

test('#702 roadmap: "Start Test" is offered only on built items', () => {
  const html = render([
    doneItem('b', { sdlc: { item: 'write-doc', status: 'built' } }),
    doneItem('c', { sdlc: { item: 'write-doc', status: 'accepted' } }),
    doneItem('d'),
  ]);
  assert.deepEqual(['b', 'c', 'd'].map((id) => startTest(html, id) !== null), [true, false, false]);
});
