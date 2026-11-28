// #128: a roadmap start the memory guard holds says why on the Roadmap. The engine's roadmapView gives
// `roadmap.memoryHold` (memoryProblem's text) while the roadmap runs; the light backlog:state
// (packages/engine/domains/backlog/backlog.js backlogState) carries it, the live reload (backlog-live.js
// mergeState) takes it onto the Backlog shown, and the header's activity band shows it as an amber line
// (data-testid="roadmap-memory-hold"), the engine's text as is. backlog-roadmap.js runs in its sandbox
// (test/roadmap-status-helpers.js loadRoadmap) with backlog-live.js beside it, as the app does.
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('vm');
const H = require('./roadmap-status-helpers');

const ALL = { showAll: true, since: 'total' };
const WHY = 'Waiting for memory: 0.8 GB free, under the floor of 1.6 GB (Settings › Execution › Memory guard); it starts when memory recovers';

function loaded() {
  const { R, sandbox } = H.loadRoadmap();
  vm.runInContext(H.read('views', 'backlog', 'backlog-live.js'), sandbox);
  return { R, sandbox };
}

// the Backlog shown: a running roadmap whose one item is planned
function shown(roadmap = {}) {
  return {
    roadmap: {
      state: 'running',
      updatedAt: '2026-11-28T14:06:00.000Z',
      stages: [{ id: 's1', name: '', note: '', items: [H.item('a', 'planned', 1, 'Issue 1')] }],
      ...roadmap,
    },
    issues: [{ number: 1, title: 'Issue 1', labels: [] }],
  };
}

// the light state of a live reload
function light(memoryHold) {
  return {
    projectId: 'p1',
    roadmap: {
      state: 'running', updatedAt: '2026-11-28T14:06:00.000Z', scope: null, pausedBy: null, error: null, memoryHold,
      stages: [{ id: 's1', pause: null, items: [{ id: 'a', status: 'planned', runId: null, runs: [], waiting: false }] }],
    },
    queue: null,
    refresh: null,
    baseCheck: null,
  };
}

const memoryLine = (html) => H.findEl(html, (e) => e.attrs['data-testid'] === 'roadmap-memory-hold');

test('#128 the light backlog:state carries the roadmap\'s memory reason, null when nothing waits', () => {
  const { backlogState } = require('@craftorio/engine/domains/backlog/backlog');
  const held = backlogState({ projectId: 'p1', ...shown({ memoryHold: WHY }) });
  const free = backlogState({ projectId: 'p1', ...shown() });
  assert.deepEqual([held.roadmap.memoryHold, free.roadmap.memoryHold], [WHY, null]);
});

test('#128 a live reload (mergeState) shows a wait that started, and drops one that ended', () => {
  const { R } = loaded();
  const started = R.mergeState(shown(), light(WHY));
  const ended = R.mergeState(shown({ memoryHold: WHY }), light(null));
  assert.deepEqual([started?.roadmap?.memoryHold ?? null, ended?.roadmap?.memoryHold ?? null], [WHY, null]);
});

test('#128 the Roadmap header shows the memory reason as an amber line of its activity band', () => {
  const { R } = loaded();
  const html = R.html(shown({ memoryHold: WHY }), () => {}, ALL);
  const line = memoryLine(html);
  assert.equal(line ? H.visibleText(line.inner) : null, WHY);
  assert.equal(/warn/.test(String(line.attrs.class || '')), true, `class: ${line.attrs.class}`);
  const act = H.findEl(html, (e) => e.attrs['data-testid'] === 'roadmap-activity');
  assert.equal(act ? !!memoryLine(act.outer) : null, true, 'inside the activity band');
});

test('#128 the header shows no memory line when nothing waits', () => {
  const { R } = loaded();
  const html = R.html(shown({ memoryHold: null }), () => {}, ALL);
  assert.equal(memoryLine(html) === null || memoryLine(html) === undefined, true);
});

test('#128 the memory reason is escaped (shown as text, never as markup)', () => {
  const { R } = loaded();
  const html = R.html(shown({ memoryHold: 'Waiting for memory <b>x</b>' }), () => {}, ALL);
  const line = memoryLine(html);
  assert.equal(line ? line.inner.includes('<b>') : null, false);
});
