// #50: the rule checks in the project's settings (fronts/analyser/views/project/project-settings.js): the commands
// found in the folder are listed (the one not run because it rewrites files said), Save sends the run default
// check_command (the owner's command, `off` when unchecked, null when empty), and a project saved `off` opens
// unchecked. The Start panel's side is features/50-project-checks.feature.
// Harness: packages/ui-kit/test/renderer-app-harness.js (as project-settings-741.test.js).
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('@craftorio/ui-kit/test/renderer-app-harness');

const project = (runDefaults) => ({ id: 'p1', name: 'Shop', description: '', repo: '', folder: 'C:/p/shop', exists: true, isGit: true, runDefaults });
const FOUND = { check_command: '', check_commands: ['npm run typecheck'], check_rewrites: [{ name: 'npm run lint', why: '--fix' }] };

async function onSettings(runDefaults, hints = async () => ({ runDefaults: { ...FOUND, ...runDefaults } })) {
  const updates = [];
  const app = loadApp({
    storage: { 'craftorio.currentProject': 'p1' },
    api: {
      getSettings: async () => ({ setupDone: true }),
      listProjects: async () => [project(runDefaults)],
      projectInputHints: hints,
      updateProject: async (id, patch) => { updates.push(JSON.parse(JSON.stringify(patch))); return { ...project(runDefaults), ...patch }; },
    },
  });
  await app.boot();
  app.run("showView('projects')");
  await app.settle(10);
  await app.click('[data-testid="project-card"]', { dataset: { act: 'edit', id: 'p1', testid: 'project-card' }, within: ['#projects-list'] });
  await app.settle(20);
  return { app, updates };
}

async function saved(runDefaults, values) {
  const { app, updates } = await onSettings(runDefaults);
  Object.assign(app.el('#ps-name'), { value: 'Shop' });
  Object.assign(app.el('#ps-folder'), { value: 'C:/p/shop' });
  app.el('#ps-checks-on').checked = values.on;
  app.el('#ps-checks').value = values.command;
  await app.el('#ps-form').onsubmit({ preventDefault() {} });
  await app.settle(10);
  return updates[0].runDefaults.check_command;
}

test('#50 the settings list the commands found and the one that is not run', async () => {
  const { app } = await onSettings({});
  const html = String(app.el('#ps-checks-found').innerHTML);
  assert.match(html, /npm run typecheck/);
  assert.match(html, /npm run lint is not run: it rewrites files \(--fix\)/);
});

test('#50 a folder whose checks cannot be read says so', async () => {
  const { app } = await onSettings({}, async () => { throw new Error('no folder'); });
  assert.match(String(app.el('#ps-checks-found').textContent), /could not be read/);
});

test('#50 Save sends the owner\'s command, off when unchecked, null when empty', async () => {
  assert.equal(await saved({}, { on: true, command: 'npm run typecheck' }), 'npm run typecheck');
  assert.equal(await saved({}, { on: false, command: 'npm run typecheck' }), 'off');
  assert.equal(await saved({ check_command: 'make x' }, { on: true, command: '' }), null);
});

test('#50 a project saved off opens unchecked, its commands box off', async () => {
  const { app } = await onSettings({ check_command: 'off' });
  const html = String(app.el('#project-settings-box').innerHTML);
  assert.match(html, /id="ps-checks-on" data-testid="project-checks-on" \/>/);
  assert.match(html, /id="ps-checks" data-testid="project-checks" value="" disabled/);
});
