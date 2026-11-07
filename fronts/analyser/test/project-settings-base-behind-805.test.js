// #805: the project's decision for a roadmap whose local base is behind origin, in the project's settings
// (fronts/analyser/views/project/project-settings.js). Acceptance tests written before the code.
//
// Contract (the seam these tests assume): `#ps-base-behind` is a select with the options '' (the default: go on from
// the local base), 'continue' and 'update'; Save sends it in `patch.runDefaults.base_behind`; the saved value fills
// it again; empty sends none.
//
// Harness: packages/ui-kit/test/renderer-app-harness.js, as project-settings-741.test.js (an element's value is what
// the test sets, the markup is read as a string).
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('@multiagent/ui-kit/test/renderer-app-harness');

const project = (runDefaults) => ({ id: 'p1', name: 'Shop', description: '', repo: 'https://github.com/o/shop.git', folder: 'C:/p/shop', exists: true, isGit: true, runDefaults });

async function onSettings(runDefaults = {}) {
  const updates = [];
  const app = loadApp({
    storage: { 'multiagent.currentProject': 'p1' },
    api: {
      getSettings: async () => ({ setupDone: true }),
      listProjects: async () => [project(runDefaults)],
      updateProject: async (id, patch) => { updates.push(JSON.parse(JSON.stringify([id, patch]))); return { ...project(runDefaults), ...patch }; },
    },
  });
  await app.boot();
  app.run("showView('projects')");
  await app.settle(10);
  await app.click('[data-testid="project-card"]', { dataset: { act: 'edit', id: 'p1', testid: 'project-card' }, within: ['#projects-list'] });
  await app.settle(20);
  return { app, updates };
}

const settingsMarkup = (app) => String(app.el('#project-settings-box').innerHTML || '');
const select = (html) => /<select[^>]*id="ps-base-behind"[^>]*>([\s\S]*?)<\/select>/.exec(html)?.[1] ?? null;
const optionValues = (html) => [...String(select(html)).matchAll(/<option[^>]*value="([^"]*)"/g)].map((m) => m[1]);
// the choice shown: the option the markup selects, or the value the screen set on the control
const shownChoice = (app) => /<option[^>]*value="([^"]*)"[^>]*\bselected\b/.exec(String(select(settingsMarkup(app))))?.[1] || app.el('#ps-base-behind').value;

async function save(app, choice) {
  app.el('#ps-name').value = 'Shop';
  app.el('#ps-folder').value = 'C:/p/shop';
  app.el('#ps-base-behind').value = choice;
  await app.el('#ps-form').onsubmit({ preventDefault() {} });
  await app.settle(10);
}

test('#805 the settings offer what a roadmap does when its base is behind: the default, continue and update', async () => {
  const { app } = await onSettings();
  assert.deepEqual(optionValues(settingsMarkup(app)), ['', 'continue', 'update']);
});

test('#805 Save sends the choice in the run defaults, next to the base branch', async () => {
  const { app, updates } = await onSettings({ base_branch: 'develop' });
  await save(app, 'update');
  assert.equal(updates.length, 1);
  assert.equal(updates[0][1].runDefaults.base_behind, 'update');
});

test('#805 the saved choice fills the select again', async () => {
  const { app } = await onSettings({ base_behind: 'continue' });
  assert.equal(shownChoice(app), 'continue');
});

test('#805 the default choice sends none, also over a decision saved before', async () => {
  const { app, updates } = await onSettings({ base_behind: 'update' });
  await save(app, '');
  assert.equal(updates.length, 1);
  assert.equal(updates[0][1].runDefaults.base_behind ?? null, null);
});
