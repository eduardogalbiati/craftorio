// #615: a running item's cost meter updates live. The card's cost meter (backlog-roadmap.js costMeter)
// reads `x.actualUsd`, the sum of its runs' costUsd + childrenCostUsd that the full Backlog read
// computes (packages/engine/domains/usage/cost-estimate.js actualCost, through withEstimates). The
// Roadmap's live reloads (#491) read only the light backlog:state (packages/engine/domains/backlog/backlog.js
// backlogState) and merge it into the Backlog shown (backlog-live.js mergeState, re-exported as
// BacklogRoadmap.mergeState) without a full refetch: the progress and the timer follow, the cost did not.
// Acceptance tests written before the code.
//
// Interface assumed (this test's choice): the light state's item of a live run (running / parked)
// carries `actualUsd` (its runs' real cost so far, as the full read computes it); mergeState takes it
// onto the item shown, and the stage's `actualUsd` follows (the sum of its items' `actualUsd`). A
// finished item keeps the final cost the full read gave it. backlog-roadmap.js runs in its sandbox
// (test/roadmap-status-helpers.js loadRoadmap) with backlog-live.js loaded beside it, as the app does.
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('vm');
const H = require('./roadmap-status-helpers');

const ALL = { showAll: true, since: 'total' };
const ESTIMATE = { usd: 5, minutes: 60, runs: 12, complexity: 2, estimated: false, basis: 'Median of the last 12 successful runs', timeBasis: 'From 12 past runs' };

function loaded() {
  const { R, sandbox } = H.loadRoadmap();
  vm.runInContext(H.read('views', 'backlog', 'backlog-live.js'), sandbox);
  return { R, sandbox };
}

// the Backlog shown: one stage, item a running on run-1 ($1.00 so far), item b done ($1.00, final)
function shown() {
  return {
    roadmap: {
      state: 'running',
      updatedAt: '2026-10-26T10:00:00.000Z',
      stages: [{
        id: 's1', name: '', note: '', estimate: { usd: 10, minutes: 60, runs: 12 }, actualUsd: 2,
        items: [
          H.item('a', 'running', 1, 'Issue 1', { runId: 'run-1', runs: ['run-1'], estimate: ESTIMATE, actualUsd: 1, run: H.run({ status: 'running', startedAt: H.iso(H.NOW - 10 * H.MIN) }) }),
          H.item('b', 'done', 2, 'Issue 2', { runId: 'run-0', runs: ['run-0'], estimate: ESTIMATE, actualUsd: 1, run: H.run({ status: 'success', startedAt: H.iso(H.NOW - 2 * H.HOUR), finishedAt: H.iso(H.NOW - H.HOUR) }) }),
        ],
      }],
    },
    issues: [],
  };
}

// the light state a live reload reads after run-1 finished more sessions: $2.50 so far
function light() {
  return {
    projectId: 'p1',
    roadmap: {
      state: 'running', updatedAt: '2026-10-26T10:00:00.000Z', scope: null, pausedBy: null, error: null,
      stages: [{
        id: 's1', pause: null,
        items: [
          { id: 'a', status: 'running', runId: 'run-1', runs: ['run-1'], waiting: false, actualUsd: 2.5, run: { status: 'running', progress: [] } },
          { id: 'b', status: 'done', runId: 'run-0', runs: ['run-0'], waiting: false },
        ],
      }],
    },
    queue: null,
    refresh: null,
    baseCheck: null,
  };
}

const meterText = (html, id) => H.visibleText(H.findEl(H.itemEl(html, id).outer, (e) => e.attrs['data-testid'] === 'roadmap-meter-cost').inner);

test('#615 the light backlog:state carries a running item\'s cost so far (actualUsd)', () => {
  const { backlogState } = require('@multiagent/engine/domains/backlog/backlog');
  const data = shown();
  const state = backlogState({ projectId: 'p1', ...data, roadmap: { ...data.roadmap, stages: [{ ...data.roadmap.stages[0], items: [{ ...data.roadmap.stages[0].items[0], actualUsd: 2.5 }] }] } });
  assert.equal(state.roadmap.stages[0].items[0].actualUsd, 2.5);
});

test('#615 a live reload (mergeState) takes the running item\'s new cost without a full read', () => {
  const { R } = loaded();
  const merged = R.mergeState(shown(), light());
  assert.equal(merged === null, false, 'the light state merges');
  assert.equal(merged.roadmap.stages[0].items[0].actualUsd, 2.5);
});

test('#615 the stage total follows the running item\'s new cost (its items\' actualUsd summed)', () => {
  const { R } = loaded();
  const merged = R.mergeState(shown(), light());
  assert.equal(merged.roadmap.stages[0].actualUsd, 3.5);
});

test('#615 after a live reload the running item\'s cost meter shows the new cost', () => {
  const { R } = loaded();
  const html = R.html(R.mergeState(shown(), light()), () => {}, ALL);
  assert.match(meterText(html, 'a'), /\$2\.50/);
});

test('#615 a finished item keeps its final cost through a live reload', () => {
  const { R } = loaded();
  const html = R.html(R.mergeState(shown(), light()), () => {}, ALL);
  assert.match(meterText(html, 'b'), /\$1\.00/);
});
