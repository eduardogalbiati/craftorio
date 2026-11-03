// #740: the deep link of Settings › Agents & CLIs (window.Settings.open(section, { highlight, onClose }),
// packages/ui-kit/views/settings/settings-clis.js) belongs to the visit it opened. Leaving Settings another
// way (the sidebar) ends that visit: coming back to Settings later marks no CLI, and its close button no
// longer calls the old onClose (the project wizard's, which would show the wizard again out of nowhere).
// Harness: packages/ui-kit/test/renderer-app-harness.js (the real page in a vm with a fake DOM).
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./renderer-app-harness');

const GH_MISSING = { id: 'gh', name: 'GitHub CLI', path: null, connected: false, installCommand: 'winget install --id GitHub.cli -e', signInCommand: 'gh auth login' };
const GIT = { id: 'git', name: 'Git', path: 'C:/bin/git.exe', version: 'git version 2.47.0', connected: true };

function page() {
  return loadApp({
    api: {
      platform: 'browser',
      getSettings: async () => ({ setupDone: true }),
      envDetails: async () => [GH_MISSING, GIT],
      cliSetupStart: async ({ id, action }) => ({ jobId: 'job-1', id, action, status: 'running', output: '' }),
    },
  });
}

// opened by the wizard with gh marked, then left through the sidebar, then Settings › Agents & CLIs again
async function staleVisit() {
  const app = page();
  await app.boot();
  let closed = 0;
  await app.sandbox.Settings.open('agents', { highlight: 'gh', onClose: () => { closed += 1; } });
  await app.settle(20);
  assert.match(String(app.el('#set-tools').innerHTML), /data-highlight/, 'the deep link marks gh first');
  app.run('showView("dashboard")');
  await app.settle(10);
  app.run('showView("settings"); showSettingsTab("agents");');
  await app.settle(20);
  return { app, closed: () => closed };
}

test('#740 Settings opened again from the sidebar after a deep link marks no CLI', async () => {
  const { app } = await staleVisit();
  assert.equal(app.state().view, 'settings');
  assert.doesNotMatch(String(app.el('#set-tools').innerHTML), /data-highlight/);
});

test('#740 the close button after leaving through the sidebar never calls the old deep link\'s onClose', async () => {
  const { app, closed } = await staleVisit();
  await app.click('#btn-settings-clis-close', { within: ['#view-settings'] });
  await app.settle(10);
  assert.equal(closed(), 0);
});
