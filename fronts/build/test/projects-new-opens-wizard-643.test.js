// #643 (first-project onboarding, step 6; acceptance tests, written before the code): Projects ›
// New project opens the onboarding wizard (#641, window.ProjectWizard) instead of the old New / Edit
// project dialog; Edit still opens that dialog with the project's fields. Spec
// docs/work/first-project-onboarding/spec.md R1 ("The old dialog stays for Edit project only").
//
// The contract assumed here:
// - the header's New project (#btn-new-project) and the empty state's (#empty-new-project, drawn when
//   there is no project) open the wizard: #project-wizard shown on its 'start' step
//   (window.ProjectWizard.open()), and #project-modal's title is not set;
// - (#741: the card's Edit opens the project's settings; the old dialog is gone.)
// Harness: packages/ui-kit/test/renderer-app-harness.js (the real page in a vm with a fake DOM).
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('@multiagent/ui-kit/test/renderer-app-harness');

const PROJECT = {
  id: 'p1', name: 'Shop', description: 'The web shop', repo: 'https://github.com/o/shop.git', folder: 'C:/p/shop', exists: true, isGit: true,
  localPreview: { install: 'npm ci', command: 'npm start', url: 'http://localhost:5173' },
};

function page({ projects = [] } = {}) {
  return loadApp({
    api: {
      getSettings: async () => ({ setupDone: true }),
      listProjects: async () => JSON.parse(JSON.stringify(projects)),
    },
  });
}

/** True when the onboarding wizard (#641) is shown on its start step. */
function wizardShown(app) {
  const el = app.created.find((e) => e.id === 'project-wizard');
  return !!el && el.hidden !== true && /data-step="start"[^>]*aria-current="step"|aria-current="step"[^>]*data-step="start"/.test(String(el.innerHTML || ''));
}

async function onProjects(opts) {
  const app = page(opts);
  await app.boot();
  app.run("showView('projects')");
  await app.settle(10);
  app.el('#project-modal-title').textContent = '';
  return app;
}

// Guards the harness (passes today): the wizard opened by its own entry point is seen as shown.
test('#643 harness: window.ProjectWizard.open() is seen as the wizard shown on its start step', async () => {
  const app = await onProjects();
  assert.equal(wizardShown(app), false, 'no wizard before');
  app.run('window.ProjectWizard.open()');
  await app.settle(10);
  assert.equal(wizardShown(app), true);
});

test('#643 Projects › New project (header button) opens the wizard, not the old dialog', async () => {
  const app = await onProjects({ projects: [PROJECT] });
  await app.click('#btn-new-project');
  await app.settle(10);
  assert.equal(wizardShown(app), true, 'the wizard (#project-wizard) is shown on its start step');
  assert.equal(app.el('#project-modal-title').textContent, '', 'the old New project dialog was not opened');
});

test('#643 Projects with no project: the empty state\'s New project opens the wizard, not the old dialog', async () => {
  const app = await onProjects({ projects: [] });
  assert.match(String(app.el('#projects-list').innerHTML), /id="empty-new-project"/, 'the empty state is drawn');
  await app.click('#empty-new-project');
  await app.settle(10);
  assert.equal(wizardShown(app), true, 'the wizard (#project-wizard) is shown on its start step');
  assert.equal(app.el('#project-modal-title').textContent, '', 'the old New project dialog was not opened');
});

// #741: a card's Edit no longer opens the old dialog (gone); it opens the project's settings. Covered by
// fronts/build/test/projects-resume-741.test.js.
