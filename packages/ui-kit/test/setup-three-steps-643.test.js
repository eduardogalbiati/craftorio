// #643 (first-project onboarding, step 6; acceptance tests, written before the code): the first-run
// Setup loses its Workflows step and ends by opening the onboarding wizard (#641,
// window.ProjectWizard). Spec docs/work/first-project-onboarding/spec.md R1, plan.md "Setup in older
// workspaces".
//
// The contract assumed here:
// - #69 and the layout rework of 2026-11-26: the Setup has three steps, AIs (agents), Version control (versioning)
//   and First project (Try it safely is gone and the Agents step became two; their own tests:
//   setup-two-steps-69.test.js), so two Next from AIs reach the last one, with an AI CLI and Git ready (Next is
//   disabled without them);
// - packages/ui-kit/setup.js draws one stepper item per step (data-step="<id>") in its dialog markup;
// - reaching the Setup's last step (Next from Version control, or Finish on it) opens the wizard
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
function page({ settings = { setupDone: false }, projects = [], fronts } = {}) {
  let saved = JSON.parse(JSON.stringify(settings));
  return loadApp({
    fronts,
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
// the fake DOM clicks a disabled button too: a press of Next is one on an enabled Next
const pressNext = (app) => {
  assert.equal(app.el('#setup-modal #btn-setup-next').disabled, false, 'Next is enabled');
  return app.click('#setup-modal #btn-setup-next');
};
// AIs -> Version control, the step before the last
async function toVersioning(app) {
  await pressNext(app);
  await app.settle(10);
  assert.equal(app.el('#setup-modal #setup-title').textContent, 'Connect version control');
}

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

test('#643 #69 the Setup\'s stepper draws three steps: agents, versioning, first-project', () => {
  const app = page();
  const modals = String(app.defs.get('setup')?.modals || '');
  const steps = H.findAll(modals, (e) => e.attrs['data-step']).map((e) => e.attrs['data-step']);
  assert.deepEqual(steps, ['agents', 'versioning', 'first-project']);
  assert.equal(/data-testid="setup-step-workflows"/.test(modals), false, 'no Workflows step');
});

test('#643 Next from AIs, then from Version control, lands on the last step, First project', async () => {
  const app = page({ projects: [{ id: 'p1', name: 'Shop', folder: 'C:/p/shop' }] });
  await app.boot();
  assert.equal(setupOpen(app), true, 'a new workspace opens the Setup');
  await toVersioning(app);
  assert.equal(app.el('#setup-modal #btn-setup-next').textContent, 'Next');
  await pressNext(app); // Version control -> First project
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

// Review of #643: the Setup reaches the wizard through the build front's action openProjectWizard
// (fronts/build/views/projects/project-wizard.js), so a composition without that front has no New
// project button and reaching First project opens nothing, without an error.
test('#643 without the build front: no openProjectWizard action, no New project on First project, and reaching it throws nothing', async () => {
  const app = page({ projects: [], fronts: ['ai'] });
  await app.boot();
  assert.equal(setupOpen(app), true, 'a new workspace opens the Setup');
  assert.equal(app.run("window.Actions.has('openProjectWizard')"), false);
  await toVersioning(app);
  await pressNext(app); // Version control -> First project
  await app.settle(10);
  assert.equal(app.el('#setup-modal #setup-title').textContent, 'Add your first project');
  assert.equal(/data-testid="setup-new-project"/.test(String(app.el('#setup-modal #setup-body').innerHTML)), false, 'no New project button');
  assert.equal(wizardShown(app), false, 'no wizard');
  assert.deepEqual(app.errors.map((e) => String(e?.message || e)), []);
});

test('#643 with the build front: the openProjectWizard action exists and opens the wizard on its start step', async () => {
  const app = page({ settings: { setupDone: true } });
  await app.boot();
  assert.equal(app.run("window.Actions.has('openProjectWizard')"), true);
  app.run("window.Actions.call('openProjectWizard')");
  await app.settle(10);
  assert.equal(wizardShown(app), true);
});

test('#643 First project shows its New project button when the build front is there', async () => {
  const app = page({ projects: [{ id: 'p1', name: 'Shop', folder: 'C:/p/shop' }] });
  await app.boot();
  await toVersioning(app);
  await pressNext(app); // Version control -> First project
  assert.equal(/data-testid="setup-new-project"/.test(String(app.el('#setup-modal #setup-body').innerHTML)), true);
});

// The wizard has no callback: the Setup watches #project-wizard's hidden attribute (a MutationObserver,
// replaced here by a recording one: the fake DOM has no mutations) and reads the projects again.
test('#643 when the wizard opened by the Setup closes, First project reads the projects again and lists the new one', async () => {
  const projects = [];
  const app = page({ projects });
  await app.boot();
  app.run(`window.__observers = [];
    window.MutationObserver = class {
      constructor(fn) { this.fn = fn; this.on = false; window.__observers.push(this); }
      observe(target) { this.on = true; this.target = target; }
      disconnect() { this.on = false; }
      takeRecords() { return []; }
    };`);
  await toVersioning(app);
  assert.equal(wizardShown(app), false, 'no wizard before the last step');
  await pressNext(app); // Version control -> First project: the wizard opens
  await app.settle(10);
  assert.equal(wizardShown(app), true, 'the wizard opened');
  const reads = app.callsTo('listProjects').length;
  projects.push({ id: 'p9', name: 'Fresh Café', folder: 'C:/p/fresh' }); // what the wizard created
  app.run(`window.ProjectWizard.close();
    window.__observers.filter((o) => o.on && o.target && o.target.id === 'project-wizard')
      .forEach((o) => o.fn([{ type: 'attributes', attributeName: 'hidden', target: o.target }], o));`);
  await app.settle(20);
  assert.equal(app.callsTo('listProjects').length > reads, true, 'the projects were read again');
  assert.equal(String(app.el('#setup-modal #setup-body').innerHTML).includes('Fresh Café'), true, 'the new project is listed');
  assert.equal(setupOpen(app), true, 'the Setup is still open, on its last step');
});

// The wizard opened over the Setup keeps the focus: Next/Finish under it is not focused again.
test('#643 when the last step opens the wizard, the focus is not put back on the Setup\'s Next/Finish', async () => {
  const app = page({ projects: [] });
  await app.boot();
  await toVersioning(app);
  const next = app.el('#setup-modal #btn-setup-next');
  let focused = 0;
  next.focus = () => { focused += 1; };
  await pressNext(app); // Version control -> First project: the wizard opens
  await app.settle(10);
  assert.equal(wizardShown(app), true, 'the wizard opened');
  assert.equal(focused, 0, 'Next/Finish was not focused under the wizard');
});

test('#643 reaching First project with a project already there opens no wizard and focuses Finish', async () => {
  const app = page({ projects: [{ id: 'p1', name: 'Shop', folder: 'C:/p/shop' }] });
  await app.boot();
  await toVersioning(app);
  const next = app.el('#setup-modal #btn-setup-next');
  let focused = 0;
  next.focus = () => { focused += 1; };
  await pressNext(app); // Version control -> First project
  await app.settle(10);
  assert.equal(wizardShown(app), false, 'no wizard: the workspace has a project');
  assert.equal(focused, 1, 'Finish has the focus');
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
