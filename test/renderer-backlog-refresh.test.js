// src/renderer/views/backlog/backlog.js (#214): no automatic refresh of the Backlog screen re-renders
// under the owner. The run-event throttle, ownerBusy, liveReload, reload, backlogChanged and
// staleNotice are pulled out of the source and run for real in a vm sandbox with a fake clock
// (setTimeout fires when the test advances it) and a fake DOM (the Edit form and its notice).
// setData is a minimal copy of its one job here (the shown data's key); the rest of the screen is
// not loaded.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'views', 'backlog', 'backlog.js'), 'utf8');
const settle = () => new Promise((r) => setTimeout(r, 0));
const pick = (re) => {
  const m = re.exec(src);
  assert.ok(m, `${re} not found in backlog.js: the source moved`);
  return m[0];
};

// A fake Backlog: `editing` is the owner's open Edit form (BacklogRoadmap.busy()), `data` what getBacklog returns.
function load({ mode = 'roadmap', data = { issues: [{ number: 1, status: 'todo' }] } } = {}) {
  const clock = { now: 1000000 };
  const timers = [];
  const intervals = [];
  const fetches = [];
  const state = { data, editing: false, closed: 0 };
  const notice = { prepends: 0, el: null };
  const button = { handler: null };
  const form = {
    querySelector: (sel) => (notice.el && sel === '[data-bl-stale]' ? notice.el : sel === 'button' && notice.el ? button : null),
    prepend: (el) => { notice.prepends += 1; notice.el = el; },
  };
  const sandbox = {
    state: { view: 'backlog' },
    document: { hidden: false, activeElement: null, createElement: () => ({ dataset: {}, querySelector: () => ({ addEventListener: (ev, fn) => { button.handler = fn; } }) }) },
    window: {},
    Date: { now: () => clock.now },
    setTimeout: (fn, ms) => { const t = { fn, at: clock.now + ms }; timers.push(t); return t; },
    clearTimeout: (t) => { const i = timers.indexOf(t); if (i >= 0) timers.splice(i, 1); },
    setInterval: (fn) => { intervals.push(fn); return intervals.length; },
    clearInterval: () => {},
    api: {
      onEvent: (fn) => { sandbox.eventHandler = fn; },
      onBacklogChanged: () => {},
      getBacklog: async () => { fetches.push(clock.now); return state.data; },
    },
  };
  sandbox.window.BacklogRoadmap = { busy: () => state.editing, closeEdit: () => { state.editing = false; state.closed += 1; } };
  sandbox.window.state = sandbox.state;
  vm.createContext(sandbox);
  vm.runInContext(
    `let bl = { mode: ${JSON.stringify(mode)}, projectId: 'p1', data: null, syncing: false, seq: 0, selected: new Set() };
     let watching = true;
     let pendingReload = null;
     let shownData = '';
     const $b = (sel) => (sel === '#view-backlog .rm-form' && window.BacklogRoadmap.busy() ? FORM : null);
     const visible = () => state.view === 'backlog';
     const dataKey = (id, data) => \`\${id}:\${JSON.stringify(data ?? null)}\`;
     function render() { renders += 1; }
     function setData(data) { bl.data = data; shownData = dataKey(bl.projectId, data); }
     ${pick(/async function reload\(\) \{[\s\S]*?\n  \}/)}
     ${pick(/async function backlogChanged\(\) \{[\s\S]*?\n  \}/)}
     ${pick(/function staleNotice\(\) \{[\s\S]*?\n  \}/)}
     ${pick(/const ownerBusy = \(\) => \{[\s\S]*?\n  \};/)}
     ${pick(/async function liveReload\(\) \{[\s\S]*?\n  \}/)}
     ${pick(/const RUN_THROTTLE_MS[\s\S]*?api\.onEvent\(\(ev\) => \{[\s\S]*?\n  \}\);/)}
     this.helpers = { setData, reload, liveReload, getShown: () => shownData };`,
    Object.assign(sandbox, { FORM: form, renders: 0 }),
  );
  const run = (ev) => sandbox.eventHandler(ev);
  const advance = async (ms) => {
    const target = clock.now + ms;
    for (;;) {
      const due = timers.filter((t) => t.at <= target).sort((a, b) => a.at - b.at)[0];
      if (!due) break;
      timers.splice(timers.indexOf(due), 1);
      clock.now = due.at;
      due.fn();
      await settle();
    }
    clock.now = target;
    await settle();
  };
  return {
    h: sandbox.helpers,
    state,
    notice,
    fetches,
    renders: () => sandbox.renders,
    run,
    advance,
    clickReload: () => button.handler(),
    intervals,
    clock,
    setData: (d) => sandbox.helpers.setData(d),
    reloadNow: async () => sandbox.helpers.reload(),
    liveReload: async () => sandbox.helpers.liveReload(),
  };
}

const A = { issues: [{ number: 1, status: 'todo' }] };
const B = { issues: [{ number: 1, status: 'running' }] };

test('Edit form open: 10 run events in 3 s re-render nothing and add exactly one stale notice (the data changed)', async () => {
  const t = load();
  t.setData(A);
  t.state.editing = true;
  t.state.data = B;
  for (let i = 0; i < 10; i++) {
    t.run({ type: 'step.started', step_id: 'develop' });
    await t.advance(300);
  }
  assert.equal(t.renders(), 0, 'the form was not re-rendered under the owner');
  assert.equal(t.notice.prepends, 1, 'one stale notice');
  assert.equal(t.notice.el.dataset.blStale, '');
});

test('Edit form open: the stale notice stays when more run events come, and no render replaces the form', async () => {
  const t = load();
  t.setData(A);
  t.state.editing = true;
  t.state.data = B;
  t.run({ type: 'step.finished' });
  await t.advance(3000);
  t.run({ type: 'workflow.finished' });
  await t.advance(5000);
  for (const fn of t.intervals) await fn();
  await settle();
  assert.equal(t.notice.prepends, 1);
  assert.equal(t.renders(), 0);
});

test('Edit form open and the data did not change: run events add no notice and render nothing', async () => {
  const t = load();
  t.setData(A);
  t.state.editing = true;
  for (let i = 0; i < 5; i++) {
    t.run({ type: 'step.started' });
    await t.advance(500);
  }
  assert.equal(t.notice.prepends, 0);
  assert.equal(t.renders(), 0);
});

test('no form open: status events refresh the screen at most once per 2 s', async () => {
  const t = load();
  t.setData(A);
  t.state.data = B;
  const start = t.clock.now;
  for (let i = 0; i < 10; i++) {
    t.run({ type: 'step.started' });
    await t.advance(300);
  }
  // 10 events in 3 s: a refresh at the first one, the next one 2 s later; the events between wait
  assert.deepEqual(t.fetches.map((x) => x - start), [0, 2000]);
  assert.equal(t.renders(), 1, 'the changed data is rendered once');
});

test('no form open: session messages (session.message_received) refresh nothing', async () => {
  const t = load();
  t.setData(A);
  for (let i = 0; i < 10; i++) {
    t.run({ type: 'session.message_received', text: 'working' });
    await t.advance(300);
  }
  assert.deepEqual(t.fetches, []);
  assert.equal(t.renders(), 0);
});

test('reload with the same data as shown renders nothing; changed data renders once', async () => {
  const t = load();
  t.setData(A);
  t.state.data = A;
  await t.reloadNow();
  assert.equal(t.renders(), 0);
  t.state.data = B;
  await t.reloadNow();
  assert.equal(t.renders(), 1);
  await t.reloadNow();
  assert.equal(t.renders(), 1, 'the second read is the same data again');
});

test('the notice\'s Reload closes the form and renders the data even when it is the one already shown', async () => {
  const t = load();
  t.setData(A);
  t.state.editing = true;
  t.state.data = B;
  await t.liveReload();
  assert.equal(t.notice.prepends, 1);
  assert.equal(t.renders(), 0);
  t.state.editing = false;
  t.clickReload();
  await settle();
  await settle();
  assert.equal(t.state.closed, 1, 'the form was closed');
  assert.equal(t.renders(), 1, 'Reload forces a render');
});
