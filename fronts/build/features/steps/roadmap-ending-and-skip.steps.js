// Steps of fronts/build/features/roadmap-run-ending-792.feature (the card says how a run ends) and
// roadmap-skip-next-804.feature (Skip says what starts next and can leave the roadmap paused). The
// reasons of the seeds are in the features' comments. Locators are roles and data-testid only
// (skills/ui-conventions).
//
// What the screens expose (the renderer's contract for these steps):
// - data-testid="roadmap-item-ending": on the card, data-ending = pr | local | fork, its text translated,
//   its title the explanation when the item ends differently from the project's default.
// - data-testid="roadmap-station" (exists): data-step = the station's name.
// - data-testid="roadmap-skip-dialog": what Skip asks when it would resume the roadmap and start work;
//   its text names the next stage or item; its buttons data-testid="roadmap-skip-go-on" and
//   data-testid="roadmap-skip-stay-paused". Not shown when nothing would start.

const fs = require('fs');
const path = require('path');
const { expect } = require('@playwright/test');
const { Given, When, Then } = require('../../../../features/steps/fixtures');
const workflows = require('../../../../features/support/workflows');

const LOAD_TIMEOUT = 30000;
const ENDINGS = { 'Abre um PR/MR': 'pr', 'Merge local': 'local', 'Fork + PR': 'fork' };
// the issue names the PR's station "Abrir PR" or "Pull request"; data-step may keep it untranslated
const STATIONS = {
  'Abrir PR': { step: /^(Abrir PR|Open PR|Pull request)$/i, text: /Abrir PR|Pull request/ },
  Merge: { step: /^Merge$/, text: /Merge/ },
};

const enginePath = (...p) => path.join(__dirname, '..', '..', '..', '..', 'packages', 'engine', ...p);
const roadmapItem = (page, title) => page.getByTestId('roadmap-item').filter({ hasText: title }).first();
const endingOf = (page, title) => roadmapItem(page, title).getByTestId('roadmap-item-ending');
const skipDialog = (page) => page.getByTestId('roadmap-skip-dialog');
const titleOf = (x) => x.issues?.[0]?.title || x.title || '';

// ---- the demo workspace, edited once the app is open (the app follows the files) ----------------

const roadmapFile = (e2e) => path.join(e2e.scratch, 'workspace', 'backlog', `${e2e.project.id}.roadmap.json`);
const readRoadmap = (e2e) => JSON.parse(fs.readFileSync(roadmapFile(e2e), 'utf8'));

function editRoadmap(e2e, fn) {
  const file = roadmapFile(e2e);
  const r = readRoadmap(e2e);
  fn(r);
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify({ ...r, updatedAt: new Date().toISOString() }, null, 2));
  fs.renameSync(tmp, file);
}

// an item built on a planned one of the demo, its issue made up: the runs are simulated
function seedItem(e2e, r, number, title, fields) {
  const model = r.stages.flatMap((s) => s.items).find((x) => x.status === 'planned' && !x.runId && !x.error);
  expect(model, 'a planned item in the demo roadmap').toBeTruthy();
  const base = JSON.parse(JSON.stringify(model));
  for (const k of ['issues', 'reason', 'modeReason', 'origin', 'cost']) delete base[k];
  return {
    ...base, id: `seed-item-${number}`, number, url: `${e2e.project.repo}/issues/${number}`, title, body: `A small change for the roadmap scenarios: ${title}.`, knownPullRequests: [],
    workflow: workflows.FEATURE.file, workflowName: workflows.FEATURE.name, mock: true, inputs: { ...workflows.LOCAL, ...workflows.VALIDATED }, status: 'planned', runId: null, runs: [], error: null,
    ...fields,
  };
}

// ---- #792: the card says how a run ends ---------------------------------------------------------

// the project's default is its default workflow with the mode of its pick (the wizard's variant, as
// DefaultWorkflow reads it; project.runDefaults only fills a run's form): the record, then the app
// reloads, as the project's workflows do
Given("the demo project's default workflow ends in the {string} mode", async ({ e2e }, mode) => {
  const projects = require(enginePath('domains', 'project', 'projects'));
  const pick = (name) => ({ name, origin: 'bundled', category: 'build', variant: `${mode}-code` });
  projects.updateProject(path.join(e2e.scratch, 'workspace', 'projects'), e2e.project.id, { workflows: [pick(workflows.FEATURE.name), pick('fix')], defaultWorkflow: workflows.FEATURE.name });
  await e2e.window.reload();
  await e2e.window.waitForLoadState('domcontentloaded');
});

// the demo's stages replaced by one planned stage; the roadmap planned, so nothing starts
Given('the roadmap plans the item {string} on the workflow {string} in {string} mode', async ({ e2e }, title, name, mode) => {
  editRoadmap(e2e, (r) => {
    const item = seedItem(e2e, r, 3990, title, { workflow: workflows.fileOf(name), workflowName: name, inputs: { mode } });
    Object.assign(r, {
      state: 'planned', simulated: true, pausedBy: null, error: null, scope: null, budget: null, live: false,
      stages: [{ id: 'stage-ending', name: 'How runs end', note: '', items: [item] }],
    });
  });
});

Then('the roadmap item {string} shows the ending {string}', async ({ e2e }, title, label) => {
  expect(Object.keys(ENDINGS), `an ending labelled "${label}"`).toContain(label);
  const ending = endingOf(e2e.window, title);
  await expect(ending).toHaveAttribute('data-ending', ENDINGS[label], { timeout: LOAD_TIMEOUT });
  await expect(ending).toContainText(label);
});

Then('the ending of the roadmap item {string} explains how it differs from the default', async ({ e2e }, title) => {
  await expect(endingOf(e2e.window, title)).toHaveAttribute('title', /\S/, { timeout: LOAD_TIMEOUT });
});

Then('the last station of the roadmap item {string} is {string}', async ({ e2e }, title, name) => {
  expect(Object.keys(STATIONS), `a station named "${name}"`).toContain(name);
  const last = roadmapItem(e2e.window, title).getByTestId('roadmap-pipeline').getByTestId('roadmap-station').last();
  await expect(last).toHaveAttribute('data-step', STATIONS[name].step, { timeout: LOAD_TIMEOUT });
  await expect(last).toContainText(STATIONS[name].text);
});

// ---- #29: a code-first item runs the developer before the tests ---------------------------------
// The test order of feature.yaml (inputs.test_order) by its option label. The stations are read from
// data-step (the workflow's group names, untranslated), in the order the card draws them.

const TEST_ORDERS = { 'E2E first': 'e2e_first', 'Code first': 'code_first' };

// as the existing seed above, in Local mode (Automatic: no owner's gate), with the item's test order
Given('the roadmap plans the item {string} on the workflow {string} with the test order {string}', async ({ e2e }, title, name, label) => {
  expect(Object.keys(TEST_ORDERS), `a test order labelled "${label}"`).toContain(label);
  editRoadmap(e2e, (r) => {
    const item = seedItem(e2e, r, 3970, title, { workflow: workflows.fileOf(name), workflowName: name, inputs: { ...workflows.LOCAL, test_order: TEST_ORDERS[label] } });
    Object.assign(r, {
      state: 'planned', simulated: true, pausedBy: null, error: null, scope: null, budget: null, live: false,
      stages: [{ id: 'stage-test-order', name: 'Test order', note: '', items: [item] }],
    });
  });
});

// "Develop, Tests, Review, Validate, Merge": every station of the card, in this order
Then('the stations of the roadmap item {string} are {string}', async ({ e2e }, title, list) => {
  const expected = list.split(',').map((s) => s.trim()).filter(Boolean);
  const stations = roadmapItem(e2e.window, title).getByTestId('roadmap-pipeline').getByTestId('roadmap-station');
  await expect(stations.first()).toBeVisible({ timeout: LOAD_TIMEOUT });
  await expect.poll(() => stations.evaluateAll((els) => els.map((el) => el.getAttribute('data-step'))), { message: `the stations of "${title}"`, timeout: LOAD_TIMEOUT }).toEqual(expected);
});

// the Feature variant of step 3 by its label (packages/shared/onboarding-model.js VARIANTS), recorded on
// the demo project as the wizard's Finish does; then the app reloads, as the project's workflows do
const FEATURE_VARIANTS = {
  'Local merge · code first': 'local-code',
  'Local merge · E2E first': 'local-e2e',
  'Remote · code first': 'remote-code',
  'Remote · E2E first': 'remote-e2e',
};

Given("the demo project's Feature workflow is {string}", async ({ e2e }, label) => {
  expect(Object.keys(FEATURE_VARIANTS), `a Feature variant labelled "${label}"`).toContain(label);
  const projects = require(enginePath('domains', 'project', 'projects'));
  const variant = FEATURE_VARIANTS[label];
  projects.updateProject(path.join(e2e.scratch, 'workspace', 'projects'), e2e.project.id, {
    workflows: [{ name: workflows.FEATURE.name, origin: 'bundled', category: 'build', variant }],
    defaultWorkflow: workflows.FEATURE.name,
  });
  await e2e.window.reload();
  await e2e.window.waitForLoadState('domcontentloaded');
});

// ---- #804: Skip says what starts next and can leave the roadmap paused --------------------------

const refused = (e2e, r, title) => seedItem(e2e, r, 3980, title, { error: 'The start was refused.' });

function pauseBy(r, item, stages) {
  Object.assign(r, {
    state: 'paused', simulated: true, pausedBy: item.id, error: `Could not start #${item.number}: ${item.error}`, scope: null, budget: null, live: false,
    stages: [{ id: 'stage-skip-1', name: 'Before the skip', note: '', items: [item] }, ...stages],
  });
}

Given('the roadmap is paused by the item {string}, before the stage {string} of the item {string}', async ({ e2e }, title, stageName, nextTitle) => {
  editRoadmap(e2e, (r) => {
    const next = seedItem(e2e, r, 3981, nextTitle, {});
    pauseBy(r, refused(e2e, r, title), [{ id: 'stage-skip-2', name: stageName, note: '', items: [next] }]);
  });
});

Given('the roadmap is paused by the item {string}, with nothing planned after it', async ({ e2e }, title) => {
  editRoadmap(e2e, (r) => pauseBy(r, refused(e2e, r, title), []));
});

Then('the skip dialog names {string}', async ({ e2e }, name) => {
  await expect(skipDialog(e2e.window)).toContainText(name, { timeout: LOAD_TIMEOUT });
});

Then('the skip dialog offers to go on or to stay paused', async ({ e2e }) => {
  const dialog = skipDialog(e2e.window);
  await expect(dialog.getByTestId('roadmap-skip-go-on')).toBeEnabled();
  await expect(dialog.getByTestId('roadmap-skip-stay-paused')).toBeEnabled();
});

When('I choose to stay paused in the skip dialog', async ({ e2e }) => {
  const dialog = skipDialog(e2e.window);
  await dialog.getByTestId('roadmap-skip-stay-paused').click();
  await expect(dialog).toBeHidden();
});

Then('the roadmap asked nothing before the skip', async ({ e2e }) => {
  await expect(skipDialog(e2e.window)).toBeHidden();
});

// the file behind the screen: a started item would hold its run there
Then('the roadmap file keeps the roadmap {string} with no run on the item {string}', async ({ e2e }, state, title) => {
  const r = readRoadmap(e2e);
  const item = r.stages.flatMap((s) => s.items).find((x) => titleOf(x) === title);
  expect(item, `a roadmap item "${title}"`).toBeTruthy();
  expect({ state: r.state, runId: item.runId }).toEqual({ state, runId: null });
});
