// #69 (acceptance tests, written before the code): the first-run Setup has no Try it safely step and never turns
// the simulation mode on. Owner's decision, 2026-11-25.
// Layout rework of 2026-11-26 (the owner's decisions): the Agents step became two, "Connect your AIs" (agents: the
// AI CLIs) and "Version control" (versioning: Git, Gitleaks, the GitHub and GitLab CLIs), so the Setup has three
// steps; Next is disabled on AIs while no AI CLI is ready and on Version control while Git is not, where a link
// "Continue with simulations only" (setup-simulation-only) goes on anyway; Skip (and Esc, which is Skip) exists on
// First project only.
//
// The contract assumed here:
// - packages/ui-kit/setup.js draws the stepper items data-step="agents", "versioning" and "first-project", nothing
//   else; window.Setup.open(<a step that does not exist>) opens on AIs;
// - Finish, Skip and "Continue with simulations only" never turn settings.developerMode on, nor off for a workspace
//   that has it on;
// - the Start drawer says that a real run uses the CLI subscription: #start-real-note
//   (data-testid="start-real-note") in the page's Start drawer, its text set when the drawer opens; it has the class
//   `hidden` while the Simulation box is checked (developer mode on; start-real-note-69.test.js);
// - no setup.try.* key is left in the catalogs, nor named by the page's sources.
// Harness: renderer-app-harness.js (the real page in a vm with a fake DOM). appInfo answers simulationOnly: false
// here, as in the owner's app: simulation only (the automated checks) counts as developer mode.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { loadApp } = require('./renderer-app-harness');
const H = require('./page-pieces');
const { pageFiles } = require('../../../scripts/source-tree');

const ROOT = path.join(__dirname, '..', '..', '..');
const clone = (x) => JSON.parse(JSON.stringify(x));
const PROJECT = { id: 'p1', name: 'Shop', folder: 'C:/p/shop', exists: true };
const WORKFLOWS = [
  { file: 'analyze-project.yaml', name: 'analyze-project', description: 'Analyze a project', category: 'analysis', inputs: { project_dir: { type: 'path', label: 'Project' } } },
];
const TITLES = { agents: 'Connect your AIs', versioning: 'Connect version control', project: 'Add your first project' };
// what env:details answers: an AI CLI and Git ready, so Next is enabled on both CLI steps
const TOOLS = [
  { id: 'claude', name: 'Claude Code', path: 'C:/bin/claude.cmd', connected: true },
  { id: 'git', name: 'Git', path: 'C:/bin/git.exe', connected: true },
];

// The page on a workspace with these settings; setSettings merges the patch like the engine does
function page({ settings = { setupDone: false }, projects = [PROJECT], tools = TOOLS } = {}) {
  let saved = clone(settings);
  return loadApp({
    api: {
      appInfo: async () => ({ simulationOnly: false }),
      getSettings: async () => clone(saved),
      setSettings: async (patch) => { saved = { ...saved, ...clone(patch || {}) }; return clone(saved); },
      listWorkflows: async () => clone(WORKFLOWS),
      listProjects: async () => clone(projects),
      listPipelines: async () => [],
      envDetails: async () => clone(tools),
      machineProfile: async () => ({ line: '8 cores' }),
      startRun: async () => ({ runId: 'r1' }),
    },
  });
}

const setupOpen = (app) => !!app.run('!!(window.Setup && window.Setup.isOpen())');
const title = (app) => String(app.el('#setup-modal #setup-title').textContent);
const nextLabel = (app) => String(app.el('#setup-modal #btn-setup-next').textContent);
const patches = (app) => app.callsTo('setSettings').map(([p]) => clone(p || {}));
const turnedOn = (app) => patches(app).filter((p) => p.developerMode === true).length;
const devModeBody = (app) => !!app.sandbox.document.body.classList.contains('dev-mode');
const simulationBox = (app) => app.el('#mock-toggle').checked === true;

// the fake DOM clicks a disabled button too: a press of Next is one on an enabled Next
async function pressNext(app) {
  assert.equal(app.el('#setup-modal #btn-setup-next').disabled, false, 'Next is enabled');
  await app.click('#setup-modal #btn-setup-next');
  await app.settle(10);
}

async function booted(options) {
  const app = page(options);
  await app.boot();
  return app;
}

// Next until Finish closed the Setup, at most `max` presses
async function finish(app, max = 6) {
  for (let i = 0; i < max && setupOpen(app); i++) await pressNext(app);
  await app.settle(20);
  assert.equal(setupOpen(app), false, 'the Setup finished');
}

// The modals a closed page hides: the fake DOM parses no markup, so their `hidden` class is given here
function closedLayers(app) {
  for (const sel of ['#usage-pop', '#budget-modal', '#confirm-modal']) app.el(sel).classList.add('hidden');
}

async function confirmSkip(app) {
  await app.settle(5);
  assert.equal(app.el('#confirm-modal').classList.contains('hidden'), false, 'Skip asks first');
  await app.click('#btn-confirm-yes');
  await app.settle(10);
}

// Skip exists on First project only: go there first
async function toFirstProject(app) {
  for (let i = 0; i < 3 && title(app) !== TITLES.project; i++) await pressNext(app);
  assert.equal(title(app), TITLES.project);
}

async function skip(app) {
  await toFirstProject(app);
  assert.equal(app.el('#setup-modal #btn-setup-skip').hidden, false, 'First project has a Skip');
  closedLayers(app);
  app.run('window.Setup.skip()'); // resolves once the confirm is answered
  await confirmSkip(app);
  assert.equal(setupOpen(app), false, 'the Setup was skipped');
}

// ---- three steps ------------------------------------------------------------------------------------

test('#69 the stepper draws three steps: agents, versioning, first-project', () => {
  const modals = String(page().defs.get('setup')?.modals || '');
  assert.deepEqual(H.findAll(modals, (e) => e.attrs['data-step']).map((e) => e.attrs['data-step']), ['agents', 'versioning', 'first-project']);
});

for (const [lang, names] of [['en', ['Connect your AIs', 'Version control', 'First project']], ['pt-BR', ['Conecte suas IAs', 'Versionamento', 'Primeiro projeto']]]) {
  test(`#69 the stepper's names in ${lang}: ${names.join(', ')}`, () => {
    const app = page();
    app.sandbox.I18n.setLanguage(lang);
    const modals = String(app.defs.get('setup')?.modals || '');
    const read = H.findAll(modals, (e) => e.attrs['data-step']).map((e) => H.visibleText(e.inner).replace(/^\s*\d+\s*/, '').trim());
    assert.deepEqual(read, names);
  });
}

test('#69 Next from AIs lands on Version control, and one more on First project, whose button reads Finish', async () => {
  const app = await booted();
  assert.equal(title(app), TITLES.agents);
  assert.equal(nextLabel(app), 'Next');
  await pressNext(app);
  assert.equal(title(app), TITLES.versioning);
  assert.equal(nextLabel(app), 'Next');
  await pressNext(app);
  assert.equal(title(app), TITLES.project);
  assert.equal(nextLabel(app), 'Finish');
});

test('#69 Back goes from First project to Version control, then to AIs, where it is disabled', async () => {
  const app = await booted();
  const back = app.el('#setup-modal #btn-setup-back');
  assert.equal(back.disabled, true, 'nothing before AIs');
  await pressNext(app);
  assert.equal(back.disabled, false, 'Version control has a Back');
  await pressNext(app);
  assert.equal(back.disabled, false, 'First project has a Back');
  await app.click('#setup-modal #btn-setup-back');
  await app.settle(10);
  assert.equal(title(app), TITLES.versioning);
  assert.equal(back.disabled, false);
  await app.click('#setup-modal #btn-setup-back');
  await app.settle(10);
  assert.equal(title(app), TITLES.agents);
  assert.equal(back.disabled, true);
});

test('#69 a third Next finishes: the Setup closes and setupDone is saved', async () => {
  const app = await booted();
  await pressNext(app);
  await pressNext(app);
  assert.equal(setupOpen(app), true, 'two Next: still open, on First project');
  assert.equal(patches(app).some((p) => p.setupDone === true), false);
  await pressNext(app);
  assert.equal(setupOpen(app), false);
  assert.equal(patches(app).some((p) => p.setupDone === true), true);
});

test('#69 Enter in the Setup is Next: AIs goes to Version control', async () => {
  const app = await booted();
  const modal = app.el('#setup-modal');
  for (const fn of modal.listeners.keydown || []) await fn({ key: 'Enter', target: app.el('#setup-lead'), preventDefault() {}, stopPropagation() {} });
  await app.settle(10);
  assert.equal(title(app), TITLES.versioning);
});

test('#69 Esc in the Setup is Skip, after its confirm (on First project, the only step with a Skip)', async () => {
  const app = await booted();
  await toFirstProject(app);
  closedLayers(app);
  const pressed = app.key('Escape'); // waits for the confirm's answer
  await confirmSkip(app);
  await pressed;
  assert.equal(setupOpen(app), false);
  assert.equal(patches(app).some((p) => p.setupDone === true), true);
});

for (const [name, presses] of [['AIs', 0], ['Version control', 1]]) {
  test(`#69 ${name} has no Skip: its button is hidden and Esc asks nothing and leaves the Setup open`, async () => {
    const app = await booted();
    for (let i = 0; i < presses; i++) await pressNext(app);
    assert.equal(app.el('#setup-modal #btn-setup-skip').hidden, true);
    closedLayers(app);
    await app.key('Escape');
    await app.settle(10);
    assert.equal(app.el('#confirm-modal').classList.contains('hidden'), true, 'no confirm');
    assert.equal(setupOpen(app), true);
    assert.equal(patches(app).some((p) => p.setupDone === true), false);
  });
}

// ---- Next waits for an AI CLI, then for Git ---------------------------------------------------------

const simulationLink = (app) => app.el('#setup-modal #btn-setup-simulation');

test('#69 with an AI CLI and Git ready, no step shows "Continue with simulations only"', async () => {
  const app = await booted();
  assert.equal(simulationLink(app).hidden, true);
  await pressNext(app);
  assert.equal(simulationLink(app).hidden, true);
});

test('#69 AIs without an AI CLI ready: Next is disabled and says why; "Continue with simulations only" goes on', async () => {
  const app = await booted({ tools: [{ id: 'claude', name: 'Claude Code', path: null, connected: false }, TOOLS[1]] });
  const next = app.el('#setup-modal #btn-setup-next');
  assert.equal(next.disabled, true);
  assert.equal(next.title, 'Connect at least one AI to go on');
  assert.equal(simulationLink(app).hidden, false);
  await app.click('#setup-modal #btn-setup-simulation');
  await app.settle(10);
  assert.equal(title(app), TITLES.versioning);
  assert.equal(next.disabled, false, 'Git is ready');
  assert.equal(next.title, '');
});

test('#69 Version control without Git: Next is disabled and says why; "Continue with simulations only" goes on', async () => {
  const app = await booted({ tools: [TOOLS[0]] });
  await pressNext(app);
  const next = app.el('#setup-modal #btn-setup-next');
  assert.equal(title(app), TITLES.versioning);
  assert.equal(next.disabled, true);
  assert.equal(next.title, 'Install Git to go on');
  assert.equal(simulationLink(app).hidden, false);
  await app.click('#setup-modal #btn-setup-simulation');
  await app.settle(10);
  assert.equal(title(app), TITLES.project);
  assert.equal(next.disabled, false);
});

test('#69 a first run with no CLI at all that goes on with "Continue with simulations only" leaves developerMode off', async () => {
  const app = await booted({ tools: [] });
  await app.click('#setup-modal #btn-setup-simulation');
  await app.settle(10);
  await app.click('#setup-modal #btn-setup-simulation');
  await app.settle(10);
  assert.equal(title(app), TITLES.project);
  await finish(app);
  assert.equal(turnedOn(app), 0, 'no settings write turns developerMode on');
  assert.equal(!!app.state().settings.developerMode, false);
});

for (const step of ['try-it-safely', 'workflows']) {
  test(`#69 the Setup opened on the step "${step}" of an older version opens on AIs`, async () => {
    const app = await booted({ settings: { setupDone: true } });
    await app.run(`window.Setup.open(${JSON.stringify(step)})`);
    await app.settle(10);
    assert.equal(setupOpen(app), true);
    assert.equal(title(app), TITLES.agents);
    assert.equal(app.el('#setup-modal #btn-setup-back').disabled, true);
  });
}

// ---- simulation off by default ----------------------------------------------------------------------

test('#69 a first run that ends with Finish leaves developerMode off', async () => {
  const app = await booted();
  await finish(app);
  assert.equal(turnedOn(app), 0, 'no settings write turns developerMode on');
  assert.equal(!!app.state().settings.developerMode, false);
});

test('#69 a first run that ends with Skip leaves developerMode off', async () => {
  const app = await booted();
  await skip(app);
  assert.equal(turnedOn(app), 0, 'no settings write turns developerMode on');
  assert.equal(!!app.state().settings.developerMode, false);
});

test('#69 going on and back in the Setup writes no developerMode', async () => {
  const app = await booted();
  await pressNext(app);
  await app.click('#setup-modal #btn-setup-back');
  await app.settle(10);
  await pressNext(app);
  assert.equal(turnedOn(app), 0);
});

for (const setupDone of [false, true]) {
  const when = setupDone ? 'Run setup again' : 'a first run';
  for (const [name, end] of [['Finish', finish], ['Skip', skip]]) {
    test(`#69 a workspace with developerMode on keeps it after ${when} ends with ${name}`, async () => {
      const app = await booted({ settings: { setupDone, developerMode: true } });
      if (setupDone) await app.run('window.Setup.open()');
      await app.settle(10);
      assert.equal(setupOpen(app), true);
      await end(app);
      assert.equal(app.state().settings.developerMode, true);
    });
  }
}

// ---- Start ------------------------------------------------------------------------------------------

test('#69 after a first run\'s Finish, the Start drawer opens without its Simulation box', async () => {
  const app = await booted();
  await finish(app);
  assert.equal(app.el('#drawer').classList.contains('open'), true, 'the Start drawer opens');
  assert.equal(devModeBody(app), false, 'no dev-mode on the page: the .dev-only Simulation box is hidden');
  assert.equal(simulationBox(app), false, 'Simulation is not checked');
});

test('#69 after a first run\'s Finish, Start starts a real run', async () => {
  const app = await booted();
  await finish(app);
  await app.run(`openDrawer({ workflow: 'analyze-project.yaml', project: 'p1' })`);
  await app.settle(20);
  await app.click('#btn-start');
  await app.settle(20);
  assert.deepEqual(app.callsTo('startRun').map(([p]) => p?.mock), [false]);
});

test('#69 guard: developer mode turned on in Settings shows the Simulation box, checked', async () => {
  const app = await booted({ settings: { setupDone: true, developerMode: true } });
  await app.run(`openDrawer({ workflow: 'analyze-project.yaml', project: 'p1' })`);
  await app.settle(20);
  assert.equal(devModeBody(app), true);
  assert.equal(simulationBox(app), true);
});

async function startNote(settings, lang = 'en') {
  const app = await booted({ settings: { setupDone: true, ...settings, language: { interface: lang } } });
  if (app.sandbox.I18n.getLanguage() !== lang) app.sandbox.I18n.setLanguage(lang);
  await app.run(`openDrawer({ workflow: 'analyze-project.yaml', project: 'p1' })`);
  await app.settle(20);
  const el = app.el('#start-real-note');
  return { text: String(el.textContent || H.visibleText(String(el.innerHTML || ''))), hidden: el.classList.contains('hidden') };
}

test('#69 the Start drawer says that a real run uses the CLI subscription, before it starts', async () => {
  const note = await startNote({});
  assert.match(note.text, /subscription/i);
  assert.equal(note.hidden, false);
});

test('#69 the Start drawer says it in Português (Brasil)', async () => {
  const note = await startNote({}, 'pt-BR');
  assert.match(note.text, /assinatura/i);
  assert.equal(note.hidden, false);
});

test('#69 with developer mode on, the Start drawer hides the note about real runs', async () => {
  assert.equal((await startNote({ developerMode: true })).hidden, true);
});

for (const file of ['apps/desktop/renderer/index.html', 'apps/web/renderer/index.html']) {
  test(`#69 ${file}: the Start drawer has the note about real runs`, () => {
    const html = fs.readFileSync(path.join(ROOT, file), 'utf8');
    const el = H.findEl(html, (e) => e.attrs['data-testid'] === 'start-real-note');
    assert.equal(el?.attrs.id, 'start-real-note');
  });
}

// ---- texts ------------------------------------------------------------------------------------------

for (const lang of ['en', 'pt-BR']) {
  test(`#69 no setup.try.* text is left in ${lang}.json`, () => {
    const catalog = JSON.parse(fs.readFileSync(path.join(ROOT, 'packages', 'shared', 'i18n', `${lang}.json`), 'utf8'));
    assert.deepEqual(Object.keys(catalog).filter((k) => k.startsWith('setup.try.')), []);
  });
}

test('#69 no page source names a setup.try.* text', () => {
  const named = pageFiles(ROOT).map((f) => f.file).filter((f) => /setup\.try\./.test(fs.readFileSync(path.join(ROOT, f), 'utf8')));
  assert.deepEqual(named, []);
});
