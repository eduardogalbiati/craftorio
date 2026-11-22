// #741: the project's settings, the one place to edit a project (fronts/analyser/views/project/project-settings.js,
// on the project page's Overview, #project-settings-box). A Projects card's Edit opens the page with the section
// open; Save sends api.updateProject(id, patch) once with the fields the old New / Edit project dialog had
// (name, description, repository, folder, Local preview, "Install without scripts", "Prefer the repository's
// workflows") plus the base branch (the run default base_branch, #735); an empty name or folder is refused with
// a message and saves nothing.
// Harness: packages/ui-kit/test/renderer-app-harness.js (the real page in a vm with a fake DOM: an element's
// value is what the test sets, the markup is read as a string).
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('@craftorio/ui-kit/test/renderer-app-harness');

const PROJECT = {
  id: 'p1', name: 'Shop', description: 'The web shop', repo: 'https://github.com/o/shop.git', folder: 'C:/p/shop', exists: true, isGit: true,
  localPreview: { install: 'npm ci', command: 'npm start', url: 'http://localhost:5173' },
  runDefaults: { base_branch: 'develop' },
};

function page() {
  const updates = [];
  const app = loadApp({
    storage: { 'multiagent.currentProject': 'p1' },
    api: {
      getSettings: async () => ({ setupDone: true }),
      listProjects: async () => [JSON.parse(JSON.stringify(PROJECT))],
      updateProject: async (id, patch) => { updates.push(JSON.parse(JSON.stringify([id, patch]))); return { ...PROJECT, ...patch }; },
    },
  });
  return { app, updates };
}

const settingsMarkup = (app) => String(app.el('#project-settings-box').innerHTML || '');

async function onSettings() {
  const ctx = page();
  await ctx.app.boot();
  ctx.app.run("showView('projects')");
  await ctx.app.settle(10);
  await ctx.app.click('[data-testid="project-card"]', { dataset: { act: 'edit', id: 'p1', testid: 'project-card' }, within: ['#projects-list'] });
  await ctx.app.settle(20);
  return ctx;
}

// fills the form's fields as the owner would, then submits it
async function submit(app, values) {
  for (const [sel, v] of Object.entries(values)) {
    if (typeof v === 'boolean') app.el(sel).checked = v;
    else app.el(sel).value = v;
  }
  await app.el('#ps-form').onsubmit({ preventDefault() {} });
  await app.settle(10);
}

const FILLED = {
  '#ps-name': 'Shop 2', '#ps-description': 'The new shop', '#ps-repo': 'https://github.com/o/shop2.git', '#ps-folder': 'C:/p/shop2',
  '#ps-base': 'main', '#ps-lp-install': 'npm i', '#ps-lp-command': 'npm run dev', '#ps-lp-url': 'http://localhost:3000',
  '#ps-ignore-scripts': true, '#ps-prefer-repo-workflows': true,
};

test('#741 a card\'s Edit opens the project page with its settings section open', async () => {
  const { app } = await onSettings();
  assert.equal(app.state().view, 'project');
  const html = settingsMarkup(app);
  assert.match(html, /data-testid="project-settings"/);
  assert.match(html, /<details[^>]*data-testid="project-settings"[^>]* open/, 'the section is open');
});

test('#741 the settings show the project\'s name, description, repository, folder, base branch and Local preview', async () => {
  const { app } = await onSettings();
  const html = settingsMarkup(app);
  for (const v of ['Shop', 'The web shop', 'https://github.com/o/shop.git', 'C:/p/shop', 'develop', 'npm ci', 'npm start', 'http://localhost:5173']) {
    assert.equal(html.includes(`value="${v}"`), true, `the field holding "${v}"`);
  }
  for (const id of ['project-ignore-scripts', 'project-prefer-repository-workflows', 'project-settings-save', 'project-settings-cancel']) {
    assert.equal(html.includes(`data-testid="${id}"`), true, id);
  }
});

test('#741 Save sends one updateProject with every field of the settings', async () => {
  const { app, updates } = await onSettings();
  await submit(app, FILLED);
  assert.equal(updates.length, 1);
  const [id, patch] = updates[0];
  assert.equal(id, 'p1');
  assert.deepEqual(
    [patch.name, patch.description, patch.repo, patch.folder, patch.runDefaults?.base_branch],
    ['Shop 2', 'The new shop', 'https://github.com/o/shop2.git', 'C:/p/shop2', 'main'],
  );
  assert.deepEqual(
    [patch.localPreview?.install, patch.localPreview?.command, patch.localPreview?.url],
    ['npm i', 'npm run dev', 'http://localhost:3000'],
  );
  assert.deepEqual([patch.ignoreInstallScripts, patch.preferRepositoryWorkflows], [true, true]);
});

test('#741 an empty base branch saves as none (the repository\'s default branch)', async () => {
  const { app, updates } = await onSettings();
  await submit(app, { ...FILLED, '#ps-base': '  ' });
  assert.equal(updates.length, 1);
  assert.equal(updates[0][1].runDefaults.base_branch, null);
});

test('#741 an empty folder is refused with a message and nothing is saved', async () => {
  const { app, updates } = await onSettings();
  await submit(app, { ...FILLED, '#ps-folder': '   ' });
  assert.equal(updates.length, 0);
  assert.equal(app.el('#ps-error').textContent, 'Choose the project\'s folder.');
});

test('#741 an empty name is refused with a message and nothing is saved', async () => {
  const { app, updates } = await onSettings();
  await submit(app, { ...FILLED, '#ps-name': '' });
  assert.equal(updates.length, 0);
  assert.notEqual(app.el('#ps-error').textContent, '');
});
