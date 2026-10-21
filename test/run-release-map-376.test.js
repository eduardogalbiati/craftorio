// #376: the release run's page offers "Show on the map" (src/renderer/views/run/run.js,
// renderRunSummary) for a shipped run of workflows/release.yaml, and it opens the release on the
// project's city with the tag Ship recorded (the release that lists this run: tagName turns
// "Sprint 12: beta" into Sprint-12-beta), the run's version otherwise; a Releases read that fails
// still opens the city. renderRunSummary runs only in the renderer, so it is pulled out of the source
// and run in a sandbox with its collaborators stubbed, as test/run-replay-map-374.test.js does.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { withI18n } = require('./i18n-sandbox');

const runSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'views', 'run', 'run.js'), 'utf8');

// renders the summary of run `run` → { ids, click(id) → its promise, shown: the showRelease calls }
function renderSummary(run, { releases = async () => ({ releases: [] }), cityRelease = true } = {}) {
  const fn = /function renderRunSummary\(\) \{[\s\S]*?\n\}/.exec(runSrc);
  assert.ok(fn, 'renderRunSummary not found in views/run/run.js: the source moved');
  const shown = [];
  const buttons = new Map();
  const box = {
    set innerHTML(html) { // stands for both #run-summary and the tab row's #run-actions (#410)
      for (const [, id] of html.matchAll(/id="([^"]+)"/g)) buttons.set(id, { id, onclick: null });
    },
    querySelector: () => null,
    querySelectorAll: () => [],
  };
  const ProjectCityRelease = { showRelease: (projectId, req) => shown.push(JSON.parse(JSON.stringify({ projectId, req }))) };
  const window = cityRelease ? { ProjectCityRelease } : {};
  const sandbox = {
    window,
    ProjectCityRelease: window.ProjectCityRelease,
    api: { listReleases: releases },
    document: { activeElement: {} },
    state: { run, workflows: [] },
    $: (sel) => (sel === '#run-summary' || sel === '#run-actions' ? box : buttons.get(sel.replace(/^#/, '')) || null),
    esc: (s) => String(s ?? ''),
    askPrStates: () => {},
    askScratch: () => {},
    askResumed: () => {},
    resumedOfRun: new Map(),
    StatusPill: { resumedLink: () => '' },
    WorkflowInputs: { inputPills: () => '' },
    issuesOfRun: () => [],
    runTitleHtml: (r) => String(r.title || r.id),
    prBadge: () => '',
    testedPillHtml: () => '',
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
  return { ids: [...buttons.keys()], click: (id) => buttons.get(id).onclick(), shown };
}

const RUN = {
  id: '20261015-100000-rel1', workflow: 'release', file: 'workflows/release.yaml', projectId: 'p1', project: 'shop',
  status: 'success', inputs: { version: 'Sprint 12: beta' },
};

test('#376 a shipped release run offers "Show on the map", which opens the tag Ship recorded for the release listing this run', async () => {
  const view = renderSummary(RUN, {
    releases: async () => ({ releases: [
      { version: '1.0.0', tag: '1.0.0', runs: ['other-run'] },
      { version: 'Sprint 12: beta', tag: 'Sprint-12-beta', runs: [RUN.id] },
    ] }),
  });
  assert.equal(view.ids.includes('btn-run-release-map'), true);
  await view.click('btn-run-release-map');
  assert.deepEqual(view.shown, [{ projectId: 'p1', req: { to: 'Sprint-12-beta' } }]);
});

test('#376 "Show on the map" on a release run no release lists falls back to the run\'s version', async () => {
  const view = renderSummary(RUN, { releases: async () => ({ releases: [{ version: '1.0.0', tag: '1.0.0', runs: ['other-run'] }] }) });
  await view.click('btn-run-release-map');
  assert.deepEqual(view.shown, [{ projectId: 'p1', req: { to: 'Sprint 12: beta' } }]);
});

test('#376 "Show on the map" still opens the city when the Releases cannot be read', async () => {
  const view = renderSummary(RUN, { releases: async () => { throw new Error('releases.json is corrupt'); } });
  await view.click('btn-run-release-map');
  assert.deepEqual(view.shown, [{ projectId: 'p1', req: { to: 'Sprint 12: beta' } }]);
});

test('#376 no "Show on the map" for a release run that did not ship, a run of another workflow, or without the release overlay', () => {
  for (const status of ['running', 'failed', 'cancelled']) {
    assert.equal(renderSummary({ ...RUN, status }).ids.includes('btn-run-release-map'), false, `${status} run`);
  }
  assert.equal(renderSummary({ ...RUN, workflow: 'software-development', file: 'workflows/software-development.yaml' }).ids.includes('btn-run-release-map'), false);
  assert.equal(renderSummary({ ...RUN, inputs: {} }).ids.includes('btn-run-release-map'), false);
  assert.equal(renderSummary(RUN, { cityRelease: false }).ids.includes('btn-run-release-map'), false);
});
