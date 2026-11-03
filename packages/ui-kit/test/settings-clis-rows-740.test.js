// #740 (the developer's own tests, next to the acceptance tests of renderer-settings-clis-740.test.js):
// Settings › Agents & CLIs (packages/ui-kit/views/settings/settings-clis.js) with the Setup's rows
// (setup.js window.SetupRows): a CLI without an install command shows its prose hint and no button, a sign-in
// the engine cannot run headless shows what to run on the server, and a failed check says why.
// Harness: packages/ui-kit/test/renderer-app-harness.js (the real page in a vm with a fake DOM).
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./renderer-app-harness');

const GROK = { id: 'grok', name: 'Grok Build', path: null, connected: false, installCommand: null, installHint: 'install Grok Build from x.ai' };
const CLAUDE_OUT = { id: 'claude', name: 'Claude Code', path: '/usr/bin/claude', version: '2.1.0', connected: false, auth: true, signInCommand: 'claude /login' };

function page(api = {}) {
  return loadApp({
    api: {
      platform: 'browser',
      getSettings: async () => ({ setupDone: true }),
      envDetails: async () => [GROK, CLAUDE_OUT],
      cliSetupStart: async ({ id, action }) => ({ jobId: 'job-m', id, action, status: 'manual', output: '', command: 'claude /login' }),
      ...api,
    },
  });
}

async function openClis(app) {
  await app.boot();
  app.run('confirmDialog = async () => true;');
  await app.sandbox.Settings.open('agents');
  await app.settle(20);
}

test('#740 a CLI with only a prose install hint shows it, with no Install button', async () => {
  const app = page();
  await openClis(app);
  const rows = String(app.el('#set-tools').innerHTML);
  assert.match(rows, /data-testid="setup-cli-grok"/);
  assert.match(rows, /install Grok Build from x\.ai/);
  assert.doesNotMatch(rows, /data-testid="setup-install-grok"/);
});

test('#740 a sign-in that needs a terminal: the console says what to run on the server', async () => {
  const app = page();
  await openClis(app);
  await app.sandbox.SettingsClis.run('claude', 'login');
  await app.settle(10);
  const panel = String(app.el('#set-cli-console').innerHTML);
  assert.match(panel, /data-testid="cli-console"/);
  assert.match(panel, /data-state="ended"/);
  assert.match(panel, /data-status="manual"/);
  assert.match(panel, /claude \/login/);
  assert.equal(app.callsTo('termOpen').length, 0, 'no terminal of the page');
});

test('#740 a check that fails says why instead of the rows', async () => {
  const app = page({ envDetails: async () => { throw new Error('engine unreachable'); } });
  await openClis(app);
  assert.match(String(app.el('#set-tools').innerHTML), /engine unreachable/);
});
