// #374: the Run screen's "Replay on the map" (apps/desktop/renderer/views/run/run.js, renderRunSummary): offered
// for a run of a project that is not running any more, and it plays that run over the project's
// city (ProjectCityAgents.replay(projectId, runId)). renderRunSummary runs only in the renderer, so it
// is pulled out of the source and run in a sandbox with its collaborators stubbed, the way
// test/renderer-run-summary.test.js checks run.js's helpers.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { withI18n } = require('@multiagent/shared/test/i18n-sandbox');

const runSrc = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'views', 'run', 'run.js'), 'utf8');

// renders the summary of run `run` → { ids: the button ids drawn, click(id), replays: the replay calls }
function renderSummary(run, { cityAgents = true } = {}) {
  const fn = /function renderRunSummary\(\) \{[\s\S]*?\n\}/.exec(runSrc);
  assert.ok(fn, 'renderRunSummary not found in views/run/run.js: the source moved');
  const replays = [];
  const buttons = new Map();
  const box = {
    _html: null,
    set innerHTML(html) { // stands for both #run-summary and the tab row's #run-actions (#410)
      for (const [, id] of html.matchAll(/id="([^"]+)"/g)) buttons.set(id, { id, onclick: null });
    },
    querySelector: () => null,
    querySelectorAll: () => [],
  };
  const window = cityAgents ? { ProjectCityAgents: { replay: (projectId, runId) => replays.push(`${projectId} ${runId}`) } } : {};
  const sandbox = {
    window,
    ProjectCityAgents: window.ProjectCityAgents,
    document: { activeElement: {} }, // the title is not being edited

    state: { run, workflows: [] },
    $: (sel) => (sel === '#run-summary' || sel === '#run-actions' ? box : buttons.get(sel.replace(/^#/, '')) || null),
    esc: (s) => String(s ?? ''),
    askPrStates: () => {},
    askScratch: () => {},
    askResumed: () => {}, // #384: the run that resumed this one (none here)
    resumedOfRun: new Map(),
    StatusPill: { resumedLink: () => '' },
    WorkflowInputs: { inputPills: () => '' },
    issuesOfRun: () => [],
    runTitleHtml: (r) => String(r.title || r.id),
    prBadge: () => '',
    testedPillHtml: () => '', // #396: the "Not tested green" pill (none here)
    selectedView: () => ({ past: false, events: [] }),
    fmtDur: (ms) => `${ms} ms`,
    testsPlanHtml: () => '',
    suiteCardsHtml: () => '',
    scratchHtml: () => '',
    inputValueCell: (v) => `<dd>${v}</dd>`,
    inputImagesHtml: () => '',
    canResume: () => false,
    hasChanges: () => false,
    WATCH_TITLE: 'Watch',
    mountInputImages: () => {},
    openSupervisorForCurrent: () => {},
  };
  withI18n(sandbox);
  vm.createContext(sandbox);
  vm.runInContext(`${fn[0]}\nrenderRunSummary();`, sandbox);
  return {
    ids: [...buttons.keys()],
    click: (id) => buttons.get(id).onclick(),
    replays,
  };
}

const RUN = { id: '20261013-090000-aaaa0004', workflow: 'software-development', projectId: 'p1', project: 'billing-service', inputs: {} };

test('#374 the Run screen offers "Replay on the map" for a finished run of a project, and it plays that run on the project\'s city', () => {
  for (const status of ['success', 'failed', 'cancelled']) {
    const view = renderSummary({ ...RUN, status });
    assert.equal(view.ids.includes('btn-run-replay-map'), true, `offered for a ${status} run`);
    view.click('btn-run-replay-map');
    assert.deepEqual(view.replays, ['p1 20261013-090000-aaaa0004']);
  }
});

test('#374 no "Replay on the map" for a run still running (its agents are live on the city) or a run without a project', () => {
  assert.equal(renderSummary({ ...RUN, status: 'running' }).ids.includes('btn-run-replay-map'), false);
  assert.equal(renderSummary({ ...RUN, projectId: null, status: 'success' }).ids.includes('btn-run-replay-map'), false);
});

test('#374 no "Replay on the map" when the city\'s agents overlay is not loaded', () => {
  assert.equal(renderSummary({ ...RUN, status: 'success' }, { cityAgents: false }).ids.includes('btn-run-replay-map'), false);
});
