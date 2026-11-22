// #740 (acceptance tests, written before the code): the New project wizard's Open Setup (the gh / glab
// warning, data-act="setup", fronts/build/views/projects/project-wizard.js) no longer opens the first-run
// Setup's modal: it opens Settings › Agents & CLIs with the missing CLI highlighted, and when that section is
// closed the wizard comes back on the step it was on and checks the CLI again.
//
// The contract assumed here (shared with packages/ui-kit/test/renderer-settings-clis-740.test.js):
// - window.Settings.open('agents', { highlight, onClose }) (settings.js) shows the Settings screen on Agents &
//   CLIs; the rows (setup.js's, data-testid="setup-cli-<id>") are in data-testid="settings-clis", the row of
//   `highlight` carries data-highlight; its close button data-testid="settings-clis-close" calls onClose;
// - the wizard calls it with highlight 'gh' for GitHub ('glab' for GitLab) and an onClose that shows the
//   wizard again (#project-wizard not hidden) on the same step and checks the CLI again
//   (api.onboardingAccounts() called again);
// - window.Setup.open() is never called by Open Setup.
// Harness: the real page (packages/ui-kit/test/renderer-app-harness.js) as project-wizard-helpers.js drives it.
const test = require('node:test');
const assert = require('node:assert/strict');
const H = require('@craftorio/ui-kit/test/page-pieces');
const { loadApp } = require('@craftorio/ui-kit/test/renderer-app-harness');
const { clickRendered, existing, pageMarkup } = require('@craftorio/front-analyser/test/project-page-helpers');
const {
  CLONING, NAME, REPO, byTestId, clone, currentStep, emit, isHidden, press, toRepository, typeInto, wizard, wizardMarkup,
} = require('./project-wizard-helpers');

const CLI_MISSING = { ...CLONING, cli: { provider: 'github', status: 'missing', reason: 'The GitHub CLI (gh) is not installed' } };
const TOOLS = [
  { id: 'gh', name: 'GitHub CLI', path: null, connected: false, installCommand: 'winget install --id GitHub.cli -e', signInCommand: 'gh auth login' },
  { id: 'git', name: 'Git', path: 'C:/bin/git.exe', version: 'git version 2.47.0', connected: true },
];

// the wizard's page (project-wizard-helpers.js page()) with env:details answering TOOLS, in the browser UI
function page() {
  return loadApp({
    api: {
      platform: 'browser',
      getSettings: async () => ({ setupDone: true }),
      listProjects: async () => [],
      startOnboarding: async () => clone(CLI_MISSING),
      onboardingStatus: async () => clone(CLI_MISSING),
      onboardingAccounts: async () => [{ provider: 'github', cli: 'gh', installed: false, signedIn: false }],
      onboardingRepos: async () => [],
      retryOnboarding: async (id) => ({ ...clone(CLI_MISSING), projectId: id }),
      architectureEstimate: async () => null,
      envDetails: async () => clone(TOOLS),
      cliSetupStart: async () => ({ jobId: 'job-1', status: 'running', output: '' }),
    },
  });
}

// the import started with gh missing: the wizard shows its warning with Open Setup
async function withWarning() {
  const app = page();
  await app.boot();
  wizard(app).open();
  await app.settle(10);
  await toRepository(app);
  await typeInto(app, '#wizard-repo', REPO);
  await typeInto(app, '#wizard-name', NAME);
  await press(app, 'wizard-next');
  await emit(app, CLI_MISSING);
  const warn = byTestId(wizardMarkup(app), 'wizard-cli-warning');
  assert.ok(warn, 'the gh warning (data-testid="wizard-cli-warning")');
  const setup = H.findEl(warn.outer, (e) => e.attrs['data-act'] === 'setup');
  assert.ok(setup, 'Open Setup (data-act="setup")');
  return { app, setup };
}

// the markup of the Settings section's rows (data-testid="settings-clis"), with what was written into ids on or inside it
function clisRegion(app) {
  const parts = [];
  const seen = new Set();
  const follow = (html, depth) => {
    parts.push(html);
    if (depth > 3) return;
    for (const m of String(html).matchAll(/\bid="([\w-]+)"/g)) {
      if (seen.has(m[1])) continue;
      seen.add(m[1]);
      const el = existing(app, m[1]);
      if (el?.innerHTML) follow(String(el.innerHTML), depth + 1);
    }
  };
  const direct = app.elements.get('[data-testid="settings-clis"]');
  if (direct?.innerHTML) follow(String(direct.innerHTML), 0);
  for (const el of H.findAll(pageMarkup(app), (e) => e.attrs['data-testid'] === 'settings-clis')) follow(el.outer, 0);
  return parts.join('\n');
}

test('#740 Open Setup opens Settings › Agents & CLIs with gh highlighted, not the first-run Setup', async () => {
  const { app, setup } = await withWarning();
  await clickRendered(app, setup, ['#project-wizard']);
  await app.settle(20);
  assert.equal(app.sandbox.Setup.isOpen(), false, 'the first-run Setup stays closed');
  assert.equal(app.state().view, 'settings', 'the Settings screen');
  const row = byTestId(clisRegion(app), 'setup-cli-gh');
  assert.ok(row, 'gh\'s row in Settings › Agents & CLIs');
  assert.equal('data-highlight' in row.attrs, true, 'gh\'s row is highlighted');
});

test('#740 closing the section brings the wizard back on its step and checks the CLI again', async () => {
  const { app, setup } = await withWarning();
  const step = currentStep(app);
  assert.notEqual(step, null, 'the wizard is on a step');
  await clickRendered(app, setup, ['#project-wizard']);
  await app.settle(20);
  const checksBefore = app.callsTo('onboardingAccounts').length;
  const close = byTestId(pageMarkup(app), 'settings-clis-close');
  assert.ok(close, 'the section\'s close button (data-testid="settings-clis-close")');
  await clickRendered(app, close);
  await app.settle(20);
  assert.equal(isHidden(app, 'project-wizard'), false, 'the wizard is shown again');
  assert.equal(currentStep(app), step, 'on the step it was on');
  assert.ok(app.callsTo('onboardingAccounts').length > checksBefore, 'gh / glab checked again (api.onboardingAccounts)');
});
