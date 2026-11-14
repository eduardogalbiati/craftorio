// Shared helpers of the acceptance tests for #266, #267, #268 and #272 (readable statuses, the
// Roadmap's run chip, its "+n done" chip, its date filter / Planned | All switch / pages, and the
// card's live timer). Not a test file itself (no `.test.js`). The generic pieces (the sandboxes'
// clock, the status pill and run list loaded for real, the HTML reader and its fake click targets) are
// the UI kit's, packages/ui-kit/test/page-pieces.js (#579: no kit test depends on a front); this file
// adds the Roadmap's and the Backlog's: backlog-roadmap.js in its sandbox, the kanban card's run
// chip, the roadmap's owner context and its markup pieces, and re-exports the kit's for the build
// front's tests.
const assert = require('node:assert/strict');
const vm = require('vm');
const { withI18n } = require('@multiagent/shared/test/i18n-sandbox.js');
const pieces = require('@multiagent/ui-kit/test/page-pieces');

const { read, exists, esc, displayName, agentLabel, NOW, installClock, evalStatusPill, loadRunList, findEl, findAll } = pieces;

/**
 * backlog-roadmap.js in its sandbox → { R: window.BacklogRoadmap, sandbox, setNow }.
 * `runTitle`: the app's run title (run-meta.js's window.runTitle) for the run chip.
 */
function loadRoadmap({ listWorkflows, now = NOW, runTitle } = {}) {
  const rl = loadRunList({ now });
  const store = new Map();
  const sandbox = {
    console,
    esc,
    state: { runs: new Map(), runMeta: new Map() },
    errMsg: (e) => String(e?.message || e),
    devMode: () => false,
    confirmDialog: async () => true,
    keptWorkDialog: async () => null,
    choiceDialog: async () => null,
    fmtDur: (ms) => (ms == null ? 'unknown' : `${Math.round(ms / 1000)}s`),
    robotAvatar: (...a) => rl.robotAvatar(...a),
    displayName,
    agentLabel,
    PERSON_SVG: rl.PERSON,
    ENGINE_SVG: rl.ENGINE,
    progressChip: (...a) => rl.progressChip(...a),
    ChainModel: { chainBadgesHtml: () => '' },
    scheduleRender: () => {},
    markdownHtml: (s) => esc(s),
    localStorage: { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) },
    document: { querySelector: () => null, querySelectorAll: () => [] },
    api: {
      listWorkflows: listWorkflows || (async () => []),
      saveRoadmap: async (projectId, stages) => ({ roadmap: { state: 'planned', stages } }),
      startRoadmap: async () => ({ roadmap: { state: 'running', stages: [] } }),
      roadmapItem: async () => ({ roadmap: { state: 'planned', stages: [] } }),
      setRoadmapLive: async () => ({ roadmap: { state: 'running', stages: [] } }),
    },
  };
  sandbox.setTimeout = setTimeout;
  sandbox.clearTimeout = clearTimeout;
  sandbox.setInterval = () => 0;
  sandbox.clearInterval = () => {};
  sandbox.window = sandbox;
  sandbox.window.showRun = () => {};
  if (runTitle) sandbox.runTitle = runTitle;
  vm.createContext(withI18n(sandbox));
  const setNow = installClock(sandbox, now);
  // the run-list sandbox's clock follows too (its chips may read the time)
  const both = (ms) => { setNow(ms); rl.setNow(ms); };
  evalStatusPill(sandbox);
  vm.runInContext(read('..', '..', '..', 'packages', 'shared', 'run-progress-model.js'), sandbox);
  vm.runInContext(read('..', '..', '..', 'packages', 'shared', 'default-workflow.js'), sandbox);
  vm.runInContext(read('..', '..', '..', 'packages', 'shared', 'roadmap-model.js'), sandbox); // the real RoadmapModel (#349)
  vm.runInContext(read('..', '..', '..', 'packages', 'shared', 'run-inputs.js'), sandbox); // the real rule of a run's inputs (#792: the card's ending)
  vm.runInContext(read('workflow-inputs.js'), sandbox);
  if (exists('estimates.js')) vm.runInContext(read('estimates.js'), sandbox);
  vm.runInContext(read('menu.js'), sandbox, { filename: 'menu.js' }); // the shared menu (#748)
  vm.runInContext(read('views', 'backlog', 'backlog-roadmap-base.js'), sandbox); // the base question's notice (#805)
  vm.runInContext(read('..', '..', '..', 'packages', 'shared', 'pr-card.js'), sandbox); // the PR monitor's lines (#809)
  vm.runInContext(read('views', 'backlog', 'backlog-roadmap-pr-card.js'), sandbox); // the PR monitor's card (#809)
  vm.runInContext(read('views', 'backlog', 'backlog-roadmap-test-stage.js'), sandbox); // Start Test (#702)
  vm.runInContext(read('views', 'backlog', 'backlog-roadmap.js'), sandbox);
  return { R: sandbox.window.BacklogRoadmap, sandbox, setNow: both };
}

/**
 * The kanban / list card's run chip (backlog.js `const runLink = (r) => …`, #266): the arrow is
 * pulled out of the source (up to the next statement at the same indent) and run in a sandbox with
 * esc, displayName, window.runTitle and the StatusPill module, the way test/renderer-backlog-live.test.js
 * runs backlog.js's helpers.
 */
function loadRunLink({ runTitle = (r) => r.title || 'workflow' } = {}) {
  const src = read('views', 'backlog', 'backlog.js');
  const m = /\n([ \t]*)const runLink = [\s\S]*?(?=\n\1(?:\/\/|const |let |function |async function ))/.exec(src);
  assert.ok(m, 'runLink not found in backlog.js: the source moved');
  const sandbox = { esc, displayName, runTitle, console };
  sandbox.window = sandbox;
  vm.createContext(withI18n(sandbox));
  evalStatusPill(sandbox);
  vm.runInContext(`${m[0]}\nthis.runLink = runLink;`, sandbox);
  return sandbox.runLink;
}

/** The roadmap's owner context (backlog.js's ctx) with what it was asked to do. */
function makeCtx() {
  const calls = { render: 0, showAll: [], since: [], errors: [], data: [] };
  const ctx = {
    projectId: 'p1',
    setData: (d) => calls.data.push(d),
    render: () => { calls.render += 1; },
    setError: (e) => calls.errors.push(e),
    setShowAll: (v) => calls.showAll.push(v),
    setSince: (v) => calls.since.push(v),
  };
  return { ctx, calls };
}

// ---- roadmap markup pieces ---------------------------------------------------------------------
/** The parsed element of item `id` (its .rm-item box). */
function itemEl(html, id) {
  const el = findEl(html, (e) => e.attrs['data-item'] === id && e.attrs['data-testid'] === 'roadmap-item');
  assert.ok(el, `item ${id} is not rendered`);
  return el;
}
const itemShown = (html, id) => !!findEl(html, (e) => e.attrs['data-item'] === id && e.attrs['data-testid'] === 'roadmap-item');
/** The <section> of the stage numbered `n` (1-based, as shown: "Stage n"), or null. */
function stageEl(html, n) {
  return findAll(html, (e) => e.attrs['data-testid'] === 'roadmap-stage')
    .find((e) => new RegExp(`>\\s*Stage ${n}\\s*<`).test(e.inner)) || null;
}
const stageCount = (html) => findAll(html, (e) => e.attrs['data-testid'] === 'roadmap-stage').length;

const ref = (number, title) => ({ number, title, url: `https://github.com/o/r/issues/${number}` });
/** A roadmap item; `extra` overrides (run, runId, origin, estimate, error…). */
const item = (id, status, number, title, extra = {}) => ({ id, status, workflow: 'software-development-local-hero.yaml', workflowName: 'Software development, local hero', inputs: {}, issues: [ref(number, title)], ...extra });
/** A run as the service attaches it to an item (packages/engine/service/areas/roadmap.js runView). */
const run = (extra = {}) => ({ status: 'running', mock: false, startedAt: null, finishedAt: null, waiting: false, gate: null, progress: [], groups: [], agentNames: null, stepNames: null, workflow: 'software-development-local-hero.yaml', error: null, stepTimes: {}, history: 0, ...extra });
const roadmapOf = (stages, extra = {}) => ({ roadmap: { state: 'running', stages, ...extra }, issues: [] });

module.exports = {
  ...pieces,
  loadRoadmap, loadRunLink, makeCtx,
  itemEl, itemShown, stageEl, stageCount, ref, item, run, roadmapOf,
};
