// #110 acceptance, written before the code: the first-run Setup (packages/ui-kit/setup.js) in the pt-BR interface.
// - Grok Build's and the GitLab CLI's install hints read in English: the engine sends its prose (install-commands.js
//   installHint, on a platform without a one-line installer) and the card shows it as it came;
// - the note of what will not run lists the workflows by their raw ids ("retrospective, write-doc"), not by name;
// - the "Installing" panel (Settings › Agents & CLIs' console, cli-console) leaks from the step that started the
//   install to the next one: it must show only on its own step.
// Driven on the real page (renderer-app-harness.js); window.api answers what env:details and workflows:list answer.
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadApp, text } = require('./renderer-app-harness');

// what the engine sends for a missing CLI with no one-line installer on its platform (Linux: grok, glab)
function hintOf(id) {
  const { installHint } = require('@craftorio/engine/domains/machine/install-commands');
  return installHint(id, 'linux');
}

const READY = (id, name) => ({ id, name, path: `/usr/bin/${id}`, connected: true });
const MISSING = (id, name) => ({ id, name, path: null, connected: false, installCommand: null, installHint: hintOf(id) });
const TOOLS = () => [
  READY('claude', 'Claude Code'),
  { id: 'codex', name: 'Codex CLI', path: null, connected: false, installCommand: 'npm install -g @openai/codex', installHint: null },
  MISSING('grok', 'Grok Build'),
  READY('gh', 'GitHub CLI'),
  MISSING('glab', 'GitLab CLI'),
  READY('git', 'Git'),
  READY('gitleaks', 'gitleaks'),
];
// two bundled workflows as workflows:list names them (metadata.name), both needing the missing Codex
const WORKFLOWS = [
  { file: 'retrospective.yaml', name: 'retrospective', origin: 'bundled', category: 'monitor', requirements: { clis: ['claude', 'codex', 'git'], forge: false } },
  { file: 'write-doc.yaml', name: 'write-doc', origin: 'bundled', category: 'build', requirements: { clis: ['claude', 'codex', 'git'], forge: false } },
];

async function setupIn(lang, extraApi = {}) {
  let saved = { setupDone: true, language: { interface: lang } };
  const app = loadApp({
    api: {
      ...extraApi,
      getSettings: async () => JSON.parse(JSON.stringify(saved)),
      setSettings: async (patch) => { saved = { ...saved, ...JSON.parse(JSON.stringify(patch || {})) }; return JSON.parse(JSON.stringify(saved)); },
      listWorkflows: async () => JSON.parse(JSON.stringify(WORKFLOWS)),
      listProjects: async () => [],
      envDetails: async () => JSON.parse(JSON.stringify(TOOLS())),
      machineProfile: async () => ({ line: '8 cores' }),
    },
  });
  await app.boot();
  // a confirmation before running a command (app.js confirmDialog) is accepted
  app.run('confirmDialog = async () => true;');
  if (app.sandbox.I18n.getLanguage() !== lang) app.sandbox.I18n.setLanguage(lang);
  await app.run('window.Setup.open("agents")');
  await app.settle(20);
  assert.equal(app.run('window.Setup.isOpen()'), true, 'the Setup is open');
  return app;
}

const body = (app) => String(app.el('#setup-modal #setup-body').innerHTML || '');
const title = (app) => String(app.el('#setup-modal #setup-title').textContent || '');
const hasConsole = (app) => /data-testid="cli-console"/.test(body(app));

async function next(app) {
  assert.equal(app.el('#setup-modal #btn-setup-next').disabled, false, 'Next is enabled');
  await app.click('#setup-modal #btn-setup-next');
  await app.settle(10);
}
async function back(app) {
  await app.click('#setup-modal #btn-setup-back');
  await app.settle(10);
}

// ▶ Install on a CLI card without a one-line installer (its data-install-hint), as the card draws it
async function install(app, id) {
  await app.click(`#setup-install-${id}`, {
    dataset: { setupRun: '', installHint: hintOf(id), cliId: id, cliAction: 'install', testid: `setup-install-${id}` },
    within: ['#setup-modal #setup-body'],
  });
  await app.settle(10);
}

test('#110 Setup in pt-BR: Grok Build\'s install hint (AIs step) has no English', { timeout: 30000 }, async () => {
  const app = await setupIn('pt-BR');
  const shown = text(body(app));
  assert.equal(/data-testid="setup-cli-grok"/.test(body(app)), true, 'the Grok Build card is drawn');
  for (const english of ['install Grok Build', 'which must be on the PATH', 'it lands in']) {
    assert.equal(shown.includes(english), false, `"${english}" in: ${shown}`);
  }
});

test('#110 Setup in pt-BR: the GitLab CLI\'s install hint (Version control step) has no English', { timeout: 30000 }, async () => {
  const app = await setupIn('pt-BR');
  await next(app);
  assert.equal(/data-testid="setup-cli-glab"/.test(body(app)), true, 'the GitLab CLI card is drawn');
  const shown = text(body(app));
  for (const english of ['install the GitLab CLI', 'distribution\'s package manager', 'or from https://']) {
    assert.equal(shown.includes(english), false, `"${english}" in: ${shown}`);
  }
});

test('#110 Setup in pt-BR: the note of what will not run names the workflows, never their raw ids', { timeout: 30000 }, async () => {
  const app = await setupIn('pt-BR');
  const note = /<p[^>]*data-testid="setup-missing-note"[^>]*>([\s\S]*?)<\/p>/.exec(body(app));
  assert.notEqual(note, null, 'the note of what will not run is drawn (Codex is missing)');
  const shown = text(note[1]);
  assert.equal(/\bretrospective\b/.test(shown), false, `the raw id "retrospective" in: ${shown}`);
  assert.equal(shown.includes('write-doc'), false, `the raw id "write-doc" in: ${shown}`);
});

test('#110 Setup: an install started on the AIs step shows its "Installing" panel there, not on Version control', { timeout: 30000 }, async () => {
  const app = await setupIn('pt-BR');
  await install(app, 'grok');
  assert.equal(hasConsole(app), true, 'the panel shows on the step that started the install');
  const before = title(app);
  await next(app);
  assert.notEqual(title(app), before, 'Next moved to Version control');
  assert.equal(hasConsole(app), false, 'the panel of the AIs step\'s install leaks into Version control');
});

test('#110 Setup: an install started on Version control does not show its "Installing" panel back on the AIs step', { timeout: 30000 }, async () => {
  const app = await setupIn('pt-BR');
  await next(app);
  await install(app, 'glab');
  assert.equal(hasConsole(app), true, 'the panel shows on the step that started the install');
  await back(app);
  assert.equal(hasConsole(app), false, 'the panel of the Version control step\'s install leaks into the AIs step');
});

// the manual console's install prose (<code> of the cli-console, data-status="manual")
function manualCode(app) {
  const html = body(app);
  const at = html.indexOf('data-testid="cli-console"');
  assert.notEqual(at, -1, 'the console is drawn');
  assert.match(html.slice(at, at + 300), /data-status="manual"/, 'the console is in its manual state');
  const code = /<code class="setup-cmd"[^>]*>([\s\S]*?)<\/code>/.exec(html.slice(at));
  assert.notEqual(code, null, 'the console shows what to install');
  return text(code[1]);
}

test('#110 Setup in pt-BR: Grok Build\'s manual console (AIs step) shows its install prose in Portuguese', { timeout: 30000 }, async () => {
  const app = await setupIn('pt-BR');
  await install(app, 'grok');
  const shown = manualCode(app);
  for (const english of ['install Grok Build', 'which must be on the PATH', 'it lands in']) {
    assert.equal(shown.includes(english), false, `"${english}" in: ${shown}`);
  }
  const pt = app.sandbox.I18n.t('setup.install_text.grok', null, 'pt-BR');
  assert.equal(shown, pt);
});

test('#110 Setup in pt-BR: the GitLab CLI\'s manual console (Version control step) shows its install prose in Portuguese', { timeout: 30000 }, async () => {
  const app = await setupIn('pt-BR');
  await next(app);
  await install(app, 'glab');
  const shown = manualCode(app);
  for (const english of ['install the GitLab CLI', 'distribution\'s package manager', 'or from https://']) {
    assert.equal(shown.includes(english), false, `"${english}" in: ${shown}`);
  }
  const pt = app.sandbox.I18n.t('setup.install_text.glab', null, 'pt-BR');
  assert.equal(shown, pt);
});

test('#110 Setup: an install started on the AIs step and updated after Next does not show its console on Version control', { timeout: 30000 }, async () => {
  // the browser UI: ▶ Install runs on the engine (cli-setup:start), its updates come on api.onCliSetupChanged
  const app = await setupIn('pt-BR', {
    platform: 'browser',
    cliSetupStart: async ({ id, action }) => ({ jobId: 'job-110', id, action, status: 'running', output: '' }),
  });
  const command = 'npm install -g @openai/codex';
  await app.click('#setup-install-codex', {
    dataset: { setupRun: command, cliId: 'codex', cliAction: 'install', testid: 'setup-install-codex' },
    within: ['#setup-modal #setup-body'],
  });
  await app.settle(10);
  assert.equal(app.callsTo('cliSetupStart').length, 1, 'the install runs on the engine');
  assert.equal(hasConsole(app), true, 'the console shows on the step that started the install');
  const before = title(app);
  await next(app);
  assert.notEqual(title(app), before, 'Next moved to Version control');
  assert.equal(hasConsole(app), false, 'no console on Version control after Next');
  const handlers = app.apiHandlers.onCliSetupChanged || [];
  assert.equal(handlers.length > 0, true, 'the job is followed (api.onCliSetupChanged)');
  for (const fn of handlers) fn({ jobId: 'job-110', id: 'codex', action: 'install', status: 'running', output: 'added 1 package\n' });
  await app.settle(10);
  assert.equal(hasConsole(app), false, 'the update of the AIs step\'s install moved its console onto Version control');
  await back(app);
  assert.equal(hasConsole(app), true, 'back on the AIs step, its install\'s console shows again');
  assert.equal(body(app).includes('added 1 package'), true, 'with the update');
});
