// #643 (first-project onboarding, step 6; acceptance tests, written before the code): the first-run
// Setup loses its Workflows step and ends by opening the onboarding wizard (#641,
// window.ProjectWizard). Spec docs/work/first-project-onboarding/spec.md R1, plan.md "Setup in older
// workspaces".
//
// The contract assumed here:
// - packages/ui-kit/setup.js draws one stepper item per step (data-step="<id>") in its dialog markup;
// - reaching the Setup's last step (Next from Try it safely, or Finish on it) opens the wizard
//   (window.ProjectWizard.open(): #project-wizard shown on its 'start' step), never the old New
//   project dialog (#project-modal);
// - Finish and Skip save setupDone: true and never write settings.hiddenWorkflows: whatever the
//   workspace hides from Start stays, nothing is added;
// - app.js opens the Setup on boot only when settings.setupDone === false.
// Harness: packages/ui-kit/test/renderer-app-harness.js (the real page in a vm with a fake DOM).
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./renderer-app-harness');
const H = require('./page-pieces');

// what env:details answers: Claude Code and Git ready, Codex not installed
const TOOLS = [
  { id: 'claude', name: 'Claude Code', path: 'C:/bin/claude.cmd', connected: true },
  { id: 'codex', name: 'Codex CLI', path: null, connected: false },
  { id: 'git', name: 'Git', path: 'C:/bin/git.exe', connected: true },
];
// two bundled workflows: one ready, one that needs the missing Codex
const WORKFLOWS = [
  { file: 'ai-arena.yaml', name: 'AI Arena', origin: 'bundled', category: 'build', requirements: { clis: ['claude', 'codex', 'git'], forge: false } },
  { file: 'writer-reviewer.yaml', name: 'Writer Reviewer', origin: 'bundled', category: 'build', requirements: { clis: ['claude', 'git'], forge: false } },
];

// The page on a workspace with these settings; setSettings merges the patch like the engine does
function page({ settings = { setupDone: false }, projects = [] } = {}) {
  let saved = JSON.parse(JSON.stringify(settings));
  return loadApp({
    api: {
      getSettings: async () => JSON.parse(JSON.stringify(saved)),
      setSettings: async (patch) => { saved = { ...saved, ...JSON.parse(JSON.stringify(patch || {})) }; return JSON.parse(JSON.stringify(saved)); },
      listWorkflows: async () => JSON.parse(JSON.stringify(WORKFLOWS)),
      listProjects: async () => JSON.parse(JSON.stringify(projects)),
      envDetails: async () => JSON.parse(JSON.stringify(TOOLS)),
      machineProfile: async () => ({ line: '8 cores' }),
    },
  });
}

const setupOpen = (app) => app.run('!!(window.Setup && window.Setup.isOpen())');
const pressNext = (app) => app.click('#setup-modal #btn-setup-next');

/** True when the onboarding wizard (#641) is shown on a step. */
function wizardShown(app) {
  const el = app.created.find((e) => e.id === 'project-wizard');
  return !!el && el.hidden !== true && /data-step="start"[^>]*aria-current="step"|aria-current="step"[^>]*data-step="start"/.test(String(el.innerHTML || ''));
}

/** The settings patches the page saved, as plain objects. */
const patches = (app) => app.callsTo('setSettings').map(([p]) => JSON.parse(JSON.stringify(p || {})));

// Next until the Setup saved setupDone: true (Finish), at most `max` presses
async function nextToFinish(app, max = 6) {
  for (let i = 0; i < max; i++) {
    if (patches(app).some((p) => p.setupDone === true)) return;
    await pressNext(app);
    await app.settle(10);
  }
}

// ---- the dialog ------------------------------------------------------------------------------------

test('#643 the Setup\'s stepper draws three steps: agents, try-it-safely, first-project', () => {
  const app = page();
  const modals = String(app.defs.get('setup')?.modals || '');
  const steps = H.findAll(modals, (e) => e.attrs['data-step']).map((e) => e.attrs['data-step']);
  assert.deepEqual(steps, ['agents', 'try-it-safely', 'first-project']);
  assert.equal(/data-testid="setup-step-workflows"/.test(modals), false, 'no Workflows step');
});

test('#643 Next from Try it safely lands on the last step, First project', async () => {
  const app = page({ projects: [{ id: 'p1', name: 'Shop', folder: 'C:/p/shop' }] });
  await app.boot();
  assert.equal(setupOpen(app), true, 'a new workspace opens the Setup');
  await pressNext(app); // Agents -> Try it safely
  await pressNext(app); // Try it safely -> the next step
  assert.equal(app.el('#setup-modal #setup-title').textContent, 'Add your first project');
  assert.equal(app.el('#setup-modal #btn-setup-next').textContent, 'Finish');
});

// Guards the harness (passes today): the wizard opened by its own entry point is seen as shown.
test('#643 harness: window.ProjectWizard.open() is seen as the wizard shown on its start step', async () => {
  const app = page({ settings: { setupDone: true } });
  await app.boot();
  assert.equal(wizardShown(app), false, 'no wizard before');
  app.run('window.ProjectWizard.open()');
  await app.settle(10);
  assert.equal(wizardShown(app), true);
});

test('#643 the Setup\'s last step opens the onboarding wizard, not the old New project dialog', async () => {
  const app = page({ projects: [] });
  await app.boot();
  assert.equal(setupOpen(app), true, 'a new workspace opens the Setup');
  app.el('#project-modal-title').textContent = '';
  for (let i = 0; i < 4 && !wizardShown(app); i++) {
    await pressNext(app);
    await app.settle(10);
  }
  assert.equal(wizardShown(app), true, 'the wizard (#project-wizard) is shown on its start step');
  assert.equal(app.el('#project-modal-title').textContent, '', 'the old New project dialog was not opened');
});

// ---- the settings: hiddenWorkflows and setupDone ---------------------------------------------------

test('#643 Finish saves setupDone true and never writes hiddenWorkflows', async () => {
  const app = page({ settings: { setupDone: false, hiddenWorkflows: ['writer-reviewer', 'custom-x'] }, projects: [{ id: 'p1', name: 'Shop', folder: 'C:/p/shop' }] });
  await app.boot();
  await nextToFinish(app);
  const all = patches(app);
  assert.equal(all.some((p) => p.setupDone === true), true, 'Finish saved setupDone: true');
  assert.deepEqual(all.filter((p) => 'hiddenWorkflows' in p).map((p) => p.hiddenWorkflows), [], 'no settings write carries hiddenWorkflows');
});

test('#643 Finish keeps the workspace\'s hiddenWorkflows as they were: none cleared, none added', async () => {
  const app = page({ settings: { setupDone: false, hiddenWorkflows: ['writer-reviewer', 'custom-x'] }, projects: [{ id: 'p1', name: 'Shop', folder: 'C:/p/shop' }] });
  await app.boot();
  await nextToFinish(app);
  assert.equal(app.state().settings.setupDone, true);
  assert.deepEqual(app.state().settings.hiddenWorkflows, ['writer-reviewer', 'custom-x']);
});

test('#643 an existing setupDone (true) never opens the Setup on boot; false does', async () => {
  const done = page({ settings: { setupDone: true, hiddenWorkflows: ['ai-arena'] } });
  await done.boot();
  assert.equal(setupOpen(done), false, 'setupDone true: no Setup');
  assert.deepEqual(patches(done).filter((p) => 'setupDone' in p || 'hiddenWorkflows' in p), [], 'nothing about setup is written');
  const fresh = page({ settings: { setupDone: false } });
  await fresh.boot();
  assert.equal(setupOpen(fresh), true, 'setupDone false: the Setup opens');
});

test('#643 a workspace whose settings say nothing about setupDone (an upgraded one) does not open the Setup', async () => {
  const app = page({ settings: { developerMode: false } });
  await app.boot();
  assert.equal(setupOpen(app), false);
});
