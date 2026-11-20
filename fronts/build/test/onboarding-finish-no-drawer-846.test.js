// #846: finishing the first project's onboarding (the review's Finish, data-testid="wizard-finish",
// fronts/build/views/projects/project-wizard.js) while its analysis still runs opens the project's page with no
// Start drawer (packages/ui-kit/start-drawer.js, #drawer.open): the analysis keeps running in the Imports tray, and a
// Start there would pay for a second one. Acceptance tests, written before the code, on the real page
// (packages/ui-kit/test/renderer-app-harness.js), driven as project-wizard-finish-workflows-729.test.js drives the
// wizard (import, clone, analysis, review, Finish).
//
// The first project's onboarding is the Setup's step 3, First project (packages/ui-kit/setup.js): reaching it on a
// workspace with no project opens the wizard over the Setup; after the wizard's Finish the Setup is still there on
// that step, whose button reads Finish (pt-BR "Concluir"), and its finish() opens the Start drawer (openDrawer({}),
// the header's project: the new one). With the onboarding's analysis still running that drawer must not open.
//
// The contract assumed here:
// - after Finish (the wizard's, then the Setup's): state.view 'project' on the new project, #drawer without the
//   class `open`, the onboarding not cancelled (no api.cancelOnboarding / api.stopRun / api.startRun);
// - the project page opened as Finish opens it (openProject(id, { nextSteps: true })) opens no drawer by itself;
// - with the onboarding's analysis of a project running (onboarding:changed, status 'analyzing'), Start on
//   analyze-project for that project in the drawer calls no api.startRun and says one already runs
//   (#start-error or #start-info, /já está em execução|already running|em andamento|in progress/i).
// Added after the fix: the refusal also while cloning, none once the analysis ended or with no onboarding, and the
// Setup's Finish without an onboarding still opens the drawer (the fix must not drop it for every Setup).
const test = require('node:test');
const assert = require('node:assert/strict');

const PID = 'p-846';
const REPO = 'https://github.com/o/first.git';
const NAME = 'First one';
const PROJECT = { id: PID, name: NAME, repo: REPO, folder: 'C:/ws/repos/o-first', exists: true };
const PROFILE = { mode: 'remote', ci: 'release', tests: 'unit+e2e' };
const jobs = (over = {}) => ({
  clone: { status: 'running' }, facts: { status: 'waiting' }, profile: { status: 'waiting' },
  projectMap: { status: 'waiting' }, ranking: { status: 'waiting' }, ...over,
});
const CLI_OK = { provider: 'github', status: 'ok' };
const CLONING = { projectId: PID, status: 'cloning', jobs: jobs(), cli: CLI_OK };
const READY = { projectId: PID, status: 'ready', jobs: jobs({ clone: { status: 'done' } }), cli: CLI_OK };
// the analysis still running: the project map (the analyze-project workflow) in progress
const ANALYZING = {
  projectId: PID, status: 'analyzing', profile: PROFILE, cli: CLI_OK,
  jobs: jobs({ clone: { status: 'done' }, facts: { status: 'done' }, profile: { status: 'done', profile: PROFILE }, projectMap: { status: 'running' } }),
};
const WORKFLOWS = [
  { file: 'analyze-project.yaml', name: 'analyze-project', description: 'Analyze a project', category: 'analysis', inputs: { project_dir: { type: 'path', label: 'Project' } } },
  { file: 'issue.yaml', name: 'issue', description: 'Issue', inputs: { task: { type: 'text', label: 'Task' } } },
];
const RUNNING = /já está em execução|já está em andamento|already running|in progress|em execução/i;

const clone = (x) => JSON.parse(JSON.stringify(x));

// loaded inside each test: the wizard and the page may change shape with the fix
function helpers() {
  return {
    H: require('@multiagent/ui-kit/test/page-pieces'),
    ...require('@multiagent/ui-kit/test/renderer-app-harness'),
    ...require('@multiagent/front-analyser/test/project-page-helpers'),
  };
}

// settings: the workspace's (setupDone false: a first run, the Setup opens at boot); the project is listed once
// the onboarding started it (a first run starts with none: the Setup's First project step opens the wizard)
function page(over = {}, { settings = { setupDone: true } } = {}) {
  const { loadApp } = helpers();
  let saved = clone(settings);
  let started = settings.setupDone !== false;
  return loadApp({
    api: {
      listProjects: async () => (started ? [clone(PROJECT)] : []),
      listWorkflows: async () => clone(WORKFLOWS),
      listPipelines: async () => [],
      getSettings: async () => clone(saved),
      setSettings: async (patch) => { saved = { ...saved, ...clone(patch || {}) }; return clone(saved); },
      envDetails: async () => [],
      machineProfile: async () => ({ line: '8 cores' }),
      startOnboarding: async () => { started = true; return clone(CLONING); },
      onboardingStatus: async () => clone(ANALYZING),
      analyzeOnboarding: async (id) => ({ ...clone(ANALYZING), projectId: id }),
      retryOnboarding: async (id) => ({ ...clone(CLONING), projectId: id }),
      finishOnboarding: async () => ({}),
      architectureEstimate: async () => ({ estimate: null }),
      architectureCity: async () => ({ state: 'none' }),
      listProjectRuns: async () => ({ runs: [], project: clone(PROJECT), total: 0 }),
      updateProject: async (id, patch) => ({ ...clone(PROJECT), ...JSON.parse(JSON.stringify(patch)) }),
      createDiscoveryCard: async () => ({}),
      startRun: async () => ({ runId: 'r-second' }),
      ...over,
    },
  });
}

function markupOf(app, id) {
  const { existing } = helpers();
  const parts = [];
  const seen = new Set([id]);
  const follow = (el, depth) => {
    const html = String(el?.innerHTML || '');
    parts.push(html || String(el?.textContent || ''));
    if (depth > 3) return;
    for (const m of html.matchAll(/\bid="([\w-]+)"/g)) {
      if (seen.has(m[1])) continue;
      seen.add(m[1]);
      const inner = existing(app, m[1]);
      if (inner && (inner.innerHTML || inner.textContent)) follow(inner, depth + 1);
    }
  };
  follow(existing(app, id), 0);
  return parts.join('\n');
}
const wizardMarkup = (app) => markupOf(app, 'project-wizard');
const byTestId = (app, id) => helpers().H.findEl(wizardMarkup(app), (e) => e.attrs['data-testid'] === id);

function currentStep(app) {
  const el = helpers().H.findEl(wizardMarkup(app), (e) => e.attrs['data-step'] && e.attrs['aria-current'] === 'step');
  return el ? String(el.attrs['data-step']) : null;
}

async function press(app, testid) {
  const el = byTestId(app, testid);
  assert.ok(el, `the wizard shows data-testid="${testid}"`);
  await helpers().clickRendered(app, el, ['#project-wizard']);
  await app.settle(10);
}

async function typeInto(app, sel, value) {
  const el = app.el(sel);
  el.value = value;
  el.tagName = 'INPUT';
  el.dataset.testid = sel.slice(1);
  const root = app.el('#project-wizard');
  for (const type of ['input', 'change', 'blur']) {
    for (const node of [el, root]) {
      const ev = { type, target: el, currentTarget: node, preventDefault() {}, stopPropagation() {} };
      if (node === el) await el[`on${type}`]?.(ev);
      for (const fn of node.listeners[type] || []) await fn(ev);
    }
  }
  await app.settle(5);
}

async function emit(app, state) {
  for (const fn of app.apiHandlers.onOnboardingChanged || []) fn(clone(state));
  await app.settle(10);
}

// The drawer's state as primitives: open (#drawer.open) and the workflow / project it is on
function drawer(app) {
  const el = app.el('#drawer');
  return {
    open: !!el.classList.contains('open'),
    workflow: String(app.el('#wf-select').value || ''),
    project: String(app.el('#project-select').value || ''),
  };
}

// The wizard on its review with the analysis still running (the project map in progress); opened by its own entry
// point, or already open (fromSetup: the Setup's First project step opened it)
async function reviewWhileAnalyzing(app, { opened = false } = {}) {
  if (!opened) {
    await app.boot();
    assert.equal(typeof app.sandbox.ProjectWizard?.open, 'function', 'window.ProjectWizard.open()');
    app.sandbox.ProjectWizard.open();
    await app.settle(10);
  }
  await press(app, 'wizard-source-import');
  await press(app, 'wizard-next');
  await typeInto(app, '#wizard-repo', REPO);
  await typeInto(app, '#wizard-name', NAME);
  await press(app, 'wizard-next');
  await emit(app, CLONING);
  await emit(app, READY);
  assert.equal(currentStep(app), 'analysis', 'the wizard is on the analysis step');
  await press(app, 'wizard-workflows-choice-analyze');
  await emit(app, ANALYZING);
  await press(app, 'wizard-next');
  assert.equal(currentStep(app), 'review', 'the review, the analysis still running');
  await app.settle(10);
  return app;
}

async function pressFinish(app) {
  await Promise.race([press(app, 'wizard-finish'), app.settle(60)]);
  await app.settle(40);
}

const setupOpen = (app) => !!app.run('!!(window.Setup && window.Setup.isOpen())');
const wizardOpen = (app) => {
  const el = app.created.find((e) => e.id === 'project-wizard');
  return !!el && el.hidden !== true;
};

// A first run: the Setup opens at boot, Next twice reaches First project, which opens the wizard (no project yet);
// the wizard then goes to its review with the analysis still running, and its Finish is pressed
async function onboardingFinishedFromSetup(over = {}) {
  const app = page(over, { settings: { setupDone: false } });
  await app.boot();
  assert.equal(setupOpen(app), true, 'a first run opens the Setup');
  for (let i = 0; i < 4 && !wizardOpen(app); i++) {
    await app.click('#setup-modal #btn-setup-next');
    await app.settle(10);
  }
  assert.equal(wizardOpen(app), true, 'the Setup\'s First project step opened the wizard');
  await reviewWhileAnalyzing(app, { opened: true });
  await pressFinish(app);
  assert.equal(wizardOpen(app), false, 'the wizard closed');
  return app;
}

// What the owner then sees: the Setup's Finish ("Concluir") on its First project step, if the Setup is still open
async function pressSetupFinish(app) {
  if (!setupOpen(app)) return;
  await app.click('#setup-modal #btn-setup-next');
  await app.settle(40);
}

test('#846 finishing the first project\'s onboarding (wizard Finish, then the Setup\'s Concluir) with the analysis running opens the project page with no Start drawer', { timeout: 30000 }, async () => {
  const app = await onboardingFinishedFromSetup();
  await pressSetupFinish(app);
  assert.equal(String(app.state().view), 'project', 'the project page is open');
  assert.equal(String(app.state().pv?.id), PID, 'on the new project');
  const d = drawer(app);
  assert.equal(d.open, false, `no Start drawer open after finishing the onboarding (it opened on "${d.workflow}" for "${d.project}")`);
});

test('#846 the wizard\'s Finish alone, with the analysis running, opens the project page with no Start drawer', { timeout: 30000 }, async () => {
  const app = page();
  await reviewWhileAnalyzing(app);
  await pressFinish(app);
  assert.equal(String(app.state().view), 'project', 'the project page is open');
  assert.equal(String(app.state().pv?.id), PID, 'on the new project');
  const d = drawer(app);
  assert.equal(d.open, false, `no Start drawer open after Finish (it opened on "${d.workflow}" for "${d.project}")`);
});

test('#846 finishing the onboarding leaves the running analysis alone (no cancel, no new run)', { timeout: 30000 }, async () => {
  const app = await onboardingFinishedFromSetup({ cancelOnboarding: async () => ({}), stopRun: async () => ({}) });
  await pressSetupFinish(app);
  assert.equal(app.callsTo('cancelOnboarding').length, 0, 'api.cancelOnboarding not called');
  assert.equal(app.callsTo('stopRun').length, 0, 'api.stopRun not called');
  assert.equal(app.callsTo('startRun').length, 0, 'api.startRun not called');
});

test('#846 the project page opened as the onboarding\'s Finish opens it does not open the Start drawer by itself', { timeout: 30000 }, async () => {
  const app = page();
  await app.boot();
  await emit(app, ANALYZING);
  app.sandbox.Actions.call('openProject', PID, { nextSteps: true });
  await app.settle(60);
  assert.equal(String(app.state().view), 'project', 'the project page is open');
  const d = drawer(app);
  assert.equal(d.open, false, `no Start drawer open on the page (it opened on "${d.workflow}" for "${d.project}")`);
});

test('#846 with the onboarding\'s analysis running, Start on analyze-project for that project says one already runs and starts nothing', { timeout: 30000 }, async () => {
  const app = page();
  await app.boot();
  await emit(app, ANALYZING);
  await app.run(`openDrawer({ workflow: 'analyze-project.yaml', project: ${JSON.stringify(PID)} })`);
  await app.settle(20);
  assert.equal(drawer(app).open, true, 'the drawer is open');
  assert.equal(drawer(app).workflow, 'analyze-project.yaml', 'on analyze-project');
  assert.equal(drawer(app).project, PID, 'for the project being analysed');
  await app.click('#btn-start');
  await app.settle(20);
  assert.equal(app.callsTo('startRun').length, 0, 'no second analysis started (api.startRun not called)');
  const said = `${String(app.el('#start-error').textContent || '')} ${String(app.el('#start-info').textContent || '')} ${String(app.el('#start-info').innerHTML || '')}`;
  assert.match(said, RUNNING, `the drawer says the analysis already runs: "${said.trim()}"`);
});

// Start on analyze-project for PID once the onboarding is in `state` (null: no onboarding event at all)
async function startAnalysisAfter(state) {
  const app = page();
  await app.boot();
  if (state) await emit(app, state);
  await app.run(`openDrawer({ workflow: 'analyze-project.yaml', project: ${JSON.stringify(PID)} })`);
  await app.settle(20);
  assert.equal(drawer(app).workflow, 'analyze-project.yaml', 'on analyze-project');
  assert.equal(drawer(app).project, PID, 'for the project');
  await app.click('#btn-start');
  await app.settle(20);
  return app;
}

test('#846 while the onboarding still clones the project, Start on analyze-project for it is refused too', { timeout: 30000 }, async () => {
  const app = await startAnalysisAfter(CLONING);
  assert.equal(app.callsTo('startRun').length, 0, 'no analysis started while cloning (api.startRun not called)');
  assert.match(String(app.el('#start-error').textContent || ''), RUNNING, 'the drawer says one already runs');
});

test('#846 once the onboarding\'s analysis has ended, Start on analyze-project for that project starts it', { timeout: 30000 }, async () => {
  const analyzed = { ...clone(ANALYZING), status: 'analyzed', jobs: jobs({ clone: { status: 'done' }, facts: { status: 'done' }, profile: { status: 'done' }, projectMap: { status: 'done' } }) };
  const app = await startAnalysisAfter(analyzed);
  assert.doesNotMatch(String(app.el('#start-error').textContent || ''), RUNNING, 'no "already running" refusal');
  assert.equal(app.callsTo('startRun').length, 1, 'the analysis starts (api.startRun called once)');
});

test('#846 with no onboarding of the project, Start on analyze-project starts it', { timeout: 30000 }, async () => {
  const app = await startAnalysisAfter(null);
  assert.doesNotMatch(String(app.el('#start-error').textContent || ''), RUNNING, 'no "already running" refusal');
  assert.equal(app.callsTo('startRun').length, 1, 'the analysis starts (api.startRun called once)');
});

test('#846 the Setup\'s Finish without an onboarding (a project already there) still opens the Start drawer', { timeout: 30000 }, async () => {
  const app = page({ listProjects: async () => [clone(PROJECT)] }, { settings: { setupDone: false } });
  await app.boot();
  assert.equal(setupOpen(app), true, 'a first run opens the Setup');
  for (let i = 0; i < 5 && setupOpen(app); i++) {
    await app.click('#setup-modal #btn-setup-next');
    await app.settle(20);
  }
  assert.equal(wizardOpen(app), false, 'no onboarding wizard opened (a project exists)');
  assert.equal(setupOpen(app), false, 'the Setup finished');
  assert.equal(drawer(app).open, true, 'the Start drawer opens after the Setup, as before #846');
});
