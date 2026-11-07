// #805: the Start panel when a local run's base is behind origin (packages/ui-kit/start-drawer.js). Acceptance tests
// written before the code, on the real page (renderer-app-harness.js: a fake DOM, the markup read as a string).
//
// Contract (the seam these tests assume):
// - api.startRun answers { confirm, baseCheck }: the panel stays open, nothing is reported as started, #start-info
//   holds data-testid="start-base-notice" with the count, the base and origin ("16 commits behind origin/main"), and
//   the buttons data-testid="start-base-update" and data-testid="start-base-continue".
// - each button calls api.startRun again with the same payload plus baseChoice: 'update' | 'continue'.
// - diverged: same notice, its text says the base was not moved and names the Backlog; no start-base-update,
//   start-base-continue stays.
//
// The harness parses no markup: a button is reached by its data-testid selector, the click also walking #start-info and
// #drawer, so the panel may wire it directly (querySelector) or delegate from either.
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./renderer-app-harness');

const FILE = 'fixture.yaml';
const WORKFLOW = { file: FILE, name: 'Fixture', steps: [], inputs: { task: { type: 'string', required: true }, repo_path: { type: 'string', required: true } } };
const PROJECT = { id: 'p1', name: 'Shop', folder: 'C:/p/shop', exists: true };

const behind = () => ({
  confirm: 'main is 16 commits behind origin/main.',
  baseCheck: { base: 'main', state: 'behind', ahead: 0, behind: 16, canUpdate: true },
});
const diverged = () => ({
  confirm: 'main has diverged: it is 16 commits behind origin/main and was not moved. Resolve it, then see the Backlog.',
  baseCheck: { base: 'main', state: 'diverged', ahead: 1, behind: 16, canUpdate: false },
});

// The panel open on the fixture workflow and the project, Start clicked once and answered by `answer`; later
// starts begin a run
async function startAnswered(answer) {
  const answers = [answer];
  const app = loadApp({
    api: {
      getSettings: async () => ({ setupDone: true }),
      setSettings: async (s) => ({ setupDone: true, ...s }),
      listWorkflows: async () => [WORKFLOW],
      listProjects: async () => [PROJECT],
      startRun: async () => answers.shift() ?? { runId: 'r-805' },
    },
  });
  await app.boot();
  await app.run(`openDrawer({ workflow: '${FILE}', project: 'p1' })`);
  await app.settle(10);
  assert.equal(panelOpen(app), true, 'the panel opened');
  await app.click('#btn-start');
  await app.settle(10);
  assert.equal(app.callsTo('startRun').length, 1, 'Start reached api.startRun');
  return app;
}

const starts = (app) => JSON.parse(JSON.stringify(app.callsTo('startRun').map(([payload]) => payload)));
const panelOpen = (app) => app.el('#drawer').classList.contains('open');
const info = (app) => String(app.el('#start-info').innerHTML);
const hasTestId = (html, id) => html.includes(`data-testid="${id}"`);
const plainText = (html) => html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
const clickChoice = (app, id) => app.click(`[data-testid="${id}"]`, { dataset: { testid: id }, attrs: { 'data-testid': id }, within: ['#start-info', '#drawer'] });

test('#805 a start answered by a question keeps the panel open, reports nothing started and shows the notice with its count', async () => {
  const app = await startAnswered(behind());
  assert.equal(panelOpen(app), true);
  assert.equal(app.callsTo('setSettings').length, 0, 'lastWorkflow is only remembered for a run that started');
  assert.equal(hasTestId(info(app), 'start-base-notice'), true);
  assert.match(plainText(info(app)), /\b16 commits behind origin\/main/);
  assert.doesNotMatch(plainText(info(app)), /Started/);
});

for (const choice of ['update', 'continue']) {
  test(`#805 the notice's ${choice} button starts again with the same payload and the choice, and the panel closes`, async () => {
    const app = await startAnswered(behind());
    assert.equal(hasTestId(info(app), `start-base-${choice}`), true);
    await clickChoice(app, `start-base-${choice}`);
    const [first, second] = starts(app);
    assert.deepEqual(second, { ...first, baseChoice: choice });
    assert.equal(panelOpen(app), false);
  });
}

test('#805 a diverged base: the notice says it was not moved and names the Backlog, with Continue and no Update', async () => {
  const app = await startAnswered(diverged());
  assert.match(plainText(info(app)), /not (been )?moved/i);
  assert.match(plainText(info(app)), /Backlog/);
  assert.equal(hasTestId(info(app), 'start-base-update'), false);
  assert.equal(hasTestId(info(app), 'start-base-continue'), true);
});
