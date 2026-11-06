// The Roadmap's light refresh (#491) and the base check's card (#465): BacklogLive's mergeState
// (the light backlog:state merged into the Backlog shown, or null when only the full read can tell),
// readLight's key and mark, and baseCheckHtml keeping the terminal's inline message per check.
// backlog-live.js runs in a sandbox with the real RoadmapModel, the way the roadmap tests load it.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { withI18n } = require('@multiagent/shared/test/i18n-sandbox');

const read = (...p) => fs.readFileSync(path.join(__dirname, '..', '..', '..', ...p), 'utf8');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

function load({ termAction } = {}) {
  const sandbox = { esc, termButtons: () => '<button data-term="live">Live terminal</button>', termAction };
  sandbox.window = sandbox;
  vm.createContext(withI18n(sandbox));
  vm.runInContext(read('packages', 'shared', 'roadmap-model.js'), sandbox);
  vm.runInContext(read('fronts', 'build', 'views', 'backlog', 'backlog-live.js'), sandbox);
  return sandbox.window.BacklogLive;
}

// the Backlog shown: two stages, one item running on run-1 and one planned
function shown() {
  return {
    queue: { paused: false, items: [{ id: 'q1', title: 'Queued one', status: 'queued' }] },
    refresh: null,
    roadmap: {
      shape: 's1:a,b|s2:c',
      state: 'running',
      updatedAt: '2026-10-22T10:00:00.000Z',
      stages: [
        { id: 's1', items: [
          { id: 'a', title: 'Item A', body: 'long body A', status: 'running', runId: 'run-1', runs: ['run-1'] },
          { id: 'b', title: 'Item B', body: 'long body B', status: 'planned', runId: null },
        ] },
        { id: 's2', items: [{ id: 'c', title: 'Item C', body: 'long body C', status: 'planned', runId: null }] },
      ],
    },
  };
}

function light(edit = {}) {
  const items = {
    a: { id: 'a', status: 'running', runId: 'run-1', runs: ['run-1'], waiting: null },
    b: { id: 'b', status: 'planned', runId: null, runs: [], waiting: null },
    c: { id: 'c', status: 'planned', runId: null, runs: [], waiting: null },
    ...edit.items,
  };
  return {
    queue: edit.queue || { paused: false, items: [{ id: 'q1', status: 'queued' }] },
    refresh: null,
    roadmap: {
      shape: 's1:a,b|s2:c',
      state: 'running',
      updatedAt: '2026-10-22T10:00:00.000Z',
      ...edit.roadmap,
      stages: [
        { id: 's1', items: [items.a, items.b] },
        { id: 's2', items: [items.c] },
      ],
    },
  };
}

// #797: an item waiting for its PR's merge, on the screen and in the light state
const waitingOn = (data, pr) => {
  Object.assign(data.roadmap.stages[0].items[0], { status: 'waiting_merge', pr });
  return data;
};
const lightWaiting = (pr) => light({ items: { a: { id: 'a', status: 'waiting_merge', runId: 'run-1', runs: ['run-1'], ...(pr ? { pr } : {}) } } });

test('#797 mergeState: a new read of a waiting item\'s PR reaches the card without a full read', () => {
  const L = load();
  const merged = L.mergeState(waitingOn(shown(), { number: 7, state: 'open' }), lightWaiting({ number: 7, state: 'unknown', detail: 'could not read the PR' }));
  const x = merged.roadmap.stages[0].items[0];
  assert.deepEqual([x.status, x.pr.state, x.pr.detail, x.body], ['waiting_merge', 'unknown', 'could not read the PR', 'long body A']);
});

test('#797 mergeState: a light state with no PR keeps the one shown', () => {
  const L = load();
  const merged = L.mergeState(waitingOn(shown(), { number: 7, state: 'open' }), lightWaiting(null));
  assert.equal(merged.roadmap.stages[0].items[0].pr.state, 'open');
});

test('#797 mergeState: null when a run ends waiting for its merge (the full read brings its PR and costs)', () => {
  const L = load();
  assert.equal(L.mergeState(shown(), lightWaiting({ number: 7, state: 'open' })) === null, true);
});

test('mergeState: null when an item moved to another run (the full read brings its workflow)', () => {
  const L = load();
  const merged = L.mergeState(shown(), light({ items: { a: { id: 'a', status: 'running', runId: 'run-2', runs: ['run-1', 'run-2'] } } }));
  assert.equal(merged === null, true);
});

test('mergeState: null when an item left a live status (running to done: its PR and costs come with the full read)', () => {
  const L = load();
  const merged = L.mergeState(shown(), light({ items: { a: { id: 'a', status: 'done', runId: 'run-1', runs: ['run-1'] } } }));
  assert.equal(merged === null, true);
});

test('mergeState: null when the stages were edited (another shape)', () => {
  const L = load();
  const merged = L.mergeState(shown(), light({ roadmap: { shape: 's1:a,b|s2:c,d' } }));
  assert.equal(merged === null, true);
});

test('mergeState: merges a run change, keeping the bodies the screen holds; a light queue is not merged (#446)', () => {
  const L = load();
  const base = shown();
  const queueBefore = JSON.stringify(base.queue ?? null);
  const merged = L.mergeState(base, light({
    items: { a: { id: 'a', status: 'running', runId: 'run-1', runs: ['run-1'], waiting: 'memory', run: { step: 'suite' } } },
    queue: { paused: true, items: [{ id: 'q1', status: 'starting' }] },
  }));
  assert.equal(merged === null, false);
  const a = merged.roadmap.stages[0].items[0];
  assert.equal(a.waiting, 'memory');
  assert.equal(a.run.step, 'suite');
  assert.equal(a.body, 'long body A');
  assert.equal(a.title, 'Item A');
  assert.equal(JSON.stringify(merged.queue ?? null), queueBefore, 'the light queue does not change what the screen holds');
});

test('mergeState: merges an item going from planned to running on the run it already had', () => {
  const L = load();
  const base = shown();
  base.roadmap.stages[0].items[1].runId = 'run-9';
  const merged = L.mergeState(base, light({ items: { b: { id: 'b', status: 'running', runId: 'run-9', runs: ['run-9'] } } }));
  assert.equal(merged === null, false);
  assert.equal(merged.roadmap.stages[0].items[1].status, 'running');
});

test('readLight: the key ignores the elapsed timers, the mark changes only with the shape or updatedAt', async () => {
  const L = load();
  const answers = [];
  const api = { getBacklogState: async () => answers.shift() };
  const withElapsed = (elapsed, roadmap) => {
    const l = light({ roadmap });
    l.roadmap.stages[0].items[0].elapsed = elapsed;
    return l;
  };
  answers.push(withElapsed(1000), withElapsed(5000), withElapsed(5000, { updatedAt: '2026-10-22T10:05:00.000Z' }),
    withElapsed(5000, { shape: 's1:a,b,c' }));
  const first = await L.readLight(api, 'p1');
  const timers = await L.readLight(api, 'p1');
  const edited = await L.readLight(api, 'p1');
  const reshaped = await L.readLight(api, 'p1');
  assert.equal(first.key, timers.key);
  assert.equal(first.mark, timers.mark);
  assert.notEqual(edited.mark, first.mark);
  assert.notEqual(reshaped.mark, edited.mark);
});

test('readLight: a failed read gives no light state and no mark', async () => {
  const L = load();
  const r = await L.readLight({ getBacklogState: async () => { throw new Error('offline'); } }, 'p1');
  assert.equal(r.light === null, true);
  assert.equal(r.mark === null, true);
});

test('baseCheckHtml keeps the terminal\'s inline message across redraws of the same check and drops it for a new one', async () => {
  const L = load({ termAction: async () => ({ text: 'Opened in the dock', error: false }) });
  const check = { status: 'running', commit: 'abcdef1234567890', startedAt: '2026-10-22T10:00:00.000Z' };
  const clock = () => '10:00';
  const line = { dataset: { check: `${check.commit}:${check.startedAt}` }, textContent: '', classList: { toggle() {} } };
  const target = { closest: () => ({ querySelector: () => line }) };
  await L.baseCheckTerm({ ctx: { projectId: 'p1' }, target }, {});
  assert.match(L.baseCheckHtml(check, clock), /Opened in the dock/);
  assert.match(L.baseCheckHtml({ ...check, status: 'green' }, clock), /Opened in the dock/);
  assert.doesNotMatch(L.baseCheckHtml({ ...check, startedAt: '2026-10-22T11:00:00.000Z' }, clock), /Opened in the dock/);
  assert.doesNotMatch(L.baseCheckHtml({ ...check, commit: '1111111122222222' }, clock), /Opened in the dock/);
});
