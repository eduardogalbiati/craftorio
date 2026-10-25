// apps/desktop/renderer/views/backlog/backlog.js (#204): the Backlog screen follows its workspace files
// live. ownerBusy/liveReload/the backlog:changed listener are pulled out of the source and run for
// real in a vm sandbox (own `bl`, `reload`, `staleNotice`, `setInterval`/`clearInterval` stubs), the
// way test/renderer-run-view.test.js checks app.js's own pure helpers as a seam: the rest of the
// file (sync, filters, labels) is untouched and not loaded here.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
// a page file by its page-relative name, in whichever layer holds it (the UI kit, a front, the page folder)
const pageFileOf = (rel) => require('../../../scripts/source-tree').pageFile(path.join(__dirname, '..', '..', '..'), rel);
const vm = require('vm');

const src = fs.readFileSync(pageFileOf('views/backlog/backlog.js'), 'utf8');
const settle = () => new Promise((r) => setTimeout(r, 0));

function load({ view = 'backlog', hidden = false, mode = 'roadmap', projectId = 'p1', roadmapBusy = false, activeElement = null } = {}) {
  const ownerBusyFn = /const ownerBusy = \(\) => \{[\s\S]*?\n  \};/.exec(src)[0];
  const liveReloadFn = /async function liveReload\(\) \{[\s\S]*?\n  \}/.exec(src)[0];
  const onChangedCall = /api\.onBacklogChanged\?\.\(\(ev\) => \{[\s\S]*?\n  \}\);/.exec(src)[0];
  for (const [name, code] of Object.entries({ ownerBusyFn, liveReloadFn, onChangedCall })) {
    assert.ok(code, `${name} not found in backlog.js: the source moved`);
  }

  const calls = { reload: 0, staleNotice: 0, intervalsStarted: 0, intervalsCleared: [] };
  let intervalFn = null;
  const sandbox = {
    state: { view },
    document: { hidden, activeElement, querySelector: () => null },
    window: {},
    setInterval: (fn) => { calls.intervalsStarted += 1; intervalFn = fn; return 'handle-1'; },
    clearInterval: (h) => calls.intervalsCleared.push(h),
    api: {},
  };
  sandbox.window.BacklogRoadmap = { busy: () => roadmapBusy };
  sandbox.window.state = sandbox.state;
  sandbox.api.onBacklogChanged = (fn) => { sandbox.changedHandler = fn; };
  vm.createContext(sandbox);
  vm.runInContext(
    `let bl = { mode: ${JSON.stringify(mode)}, projectId: ${JSON.stringify(projectId)} };
     let watching = true;
     let pendingReload = null;
     const $b = () => null;
     const visible = () => state.view === 'backlog';
     async function reload() { reloadCalls += 1; }
     function staleNotice() { staleCalls += 1; }
     let reloadCalls = 0;
     let staleCalls = 0;
     // the data differs from what is shown (#214): stubbed here, its own tests are in renderer-backlog-refresh.test.js
     let changedResult = true;
     async function backlogChanged() { return changedResult; }
     ${ownerBusyFn}
     ${liveReloadFn}
     ${onChangedCall}
     this.helpers = { ownerBusy, liveReload, setBl: (v) => { bl = v; }, setChanged: (v) => { changedResult = v; }, getWatching: () => watching, getReloadCalls: () => reloadCalls, getStaleCalls: () => staleCalls };`,
    sandbox,
  );
  return { helpers: sandbox.helpers, sandbox, calls, fireInterval: () => intervalFn?.(), changed: (ev) => sandbox.changedHandler(ev) };
}

function typingInput({ modal = false } = {}) {
  const inViewBacklog = { id: 'view-backlog' };
  const modalEl = modal ? { closest: () => null } : null;
  const el = { tagName: 'INPUT' };
  el.closest = (sel) => {
    if (sel === '#view-backlog') return inViewBacklog;
    if (sel === '.modal') return modalEl;
    return null;
  };
  return el;
}

// ---------------------------------------------------------------------------
// ownerBusy
// ---------------------------------------------------------------------------

test('ownerBusy: false with nothing focused and the Roadmap not busy', () => {
  const { helpers } = load({ roadmapBusy: false });
  assert.equal(helpers.ownerBusy(), false);
});

test('ownerBusy: true while typing in an input/textarea/select inside the Backlog screen', () => {
  const { helpers } = load({ activeElement: typingInput() });
  assert.equal(helpers.ownerBusy(), true);
});

test('ownerBusy: typing inside a modal over the Backlog screen does not count (the modal has its own focus trap)', () => {
  const { helpers } = load({ activeElement: typingInput({ modal: true }) });
  assert.equal(helpers.ownerBusy(), false);
});

test('ownerBusy: true when the Roadmap tab itself is busy (editing/dragging/note editing), only in roadmap mode', () => {
  const inRoadmap = load({ mode: 'roadmap', roadmapBusy: true });
  assert.equal(inRoadmap.helpers.ownerBusy(), true);
  const inKanban = load({ mode: 'kanban', roadmapBusy: true });
  assert.equal(inKanban.helpers.ownerBusy(), false, 'BacklogRoadmap.busy() only matters in roadmap mode');
});

// ---------------------------------------------------------------------------
// liveReload
// ---------------------------------------------------------------------------

test('liveReload: does nothing when the Backlog screen is not visible or the tab is hidden', async () => {
  const notVisible = load({ view: 'run' });
  await notVisible.helpers.liveReload();
  assert.equal(notVisible.helpers.getReloadCalls(), 0);

  const hiddenTab = load({ hidden: true });
  await hiddenTab.helpers.liveReload();
  assert.equal(hiddenTab.helpers.getReloadCalls(), 0);
});

test('liveReload: reloads right away when the owner is not busy', async () => {
  const { helpers } = load();
  await helpers.liveReload();
  assert.equal(helpers.getReloadCalls(), 1);
  assert.equal(helpers.getStaleCalls(), 0);
});

test('liveReload: while the owner is busy it shows the stale notice and retries instead of reloading; it reloads once they are done', async () => {
  const { helpers, calls, sandbox, fireInterval } = load({ activeElement: typingInput() });
  await helpers.liveReload();
  assert.equal(helpers.getReloadCalls(), 0, 'never reloads under the owner');
  assert.equal(helpers.getStaleCalls(), 1);
  assert.equal(calls.intervalsStarted, 1);

  // still busy: the retry tick does nothing yet
  fireInterval();
  await settle();
  assert.equal(helpers.getReloadCalls(), 0);
  assert.equal(calls.intervalsCleared.length, 0);

  // the owner is done (focus left the field): the next retry tick clears the interval and reloads
  sandbox.document.activeElement = null;
  fireInterval();
  await settle();
  assert.equal(helpers.getReloadCalls(), 1);
  assert.deepEqual(calls.intervalsCleared, ['handle-1']);
});

// ---------------------------------------------------------------------------
// the backlog:changed listener
// ---------------------------------------------------------------------------

test('backlog:changed: watching:false just flips the fallback-poll flag, no reload', () => {
  const { helpers, changed } = load();
  changed({ watching: false });
  assert.equal(helpers.getWatching(), false);
  assert.equal(helpers.getReloadCalls(), 0);
});

test('backlog:changed: a change for another project sets watching back to true but never reloads', async () => {
  const { helpers, changed } = load({ projectId: 'p1' });
  changed({ projectId: 'p2', file: 'roadmap', watching: true });
  await settle();
  assert.equal(helpers.getWatching(), true);
  assert.equal(helpers.getReloadCalls(), 0);
});

test('backlog:changed: a change for the open project reloads', async () => {
  const { helpers, changed } = load({ projectId: 'p1' });
  changed({ projectId: 'p1', file: 'roadmap', watching: true });
  await settle();
  assert.equal(helpers.getReloadCalls(), 1);
});
