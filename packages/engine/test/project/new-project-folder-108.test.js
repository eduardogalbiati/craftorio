// #108: the folder the wizard shows for a new project is the one the engine makes. Acceptance test, written before
// the code: packages/engine/domains/project/projects.js createProject (fresh, as the onboarding's create() calls it)
// with a repeated name makes <workspace>/projects/<slug>-2, and the model's newProjectFolderName(name, taken)
// (packages/shared/onboarding-model.js, contract in packages/shared/test/onboarding-model-project-name-108.test.js),
// given the existing projects' ids, names that same folder. A temp workspace, no git, no network.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const projects = require('../../domains/project/projects');

function tmp(t) {
  const dir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'new-folder-108-')));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }));
  return dir;
}

for (const name of ['Lista Tarefas', 'Lista de Tarefas!']) {
  test(`#108 a repeated name ("${name}"): the model names the folder createProject makes`, async (t) => {
    const { newProjectFolderName } = require('@craftorio/shared/onboarding-model');
    assert.equal(typeof newProjectFolderName, 'function', 'OnboardingModel.newProjectFolderName(name, taken)');
    const dir = path.join(tmp(t), 'projects');
    const first = await projects.createProject(dir, { name }, { fresh: true });
    const shown = newProjectFolderName(name, projects.listProjects(dir).map((p) => p.id));
    const second = await projects.createProject(dir, { name }, { fresh: true });
    assert.equal(path.basename(second.folder), shown, `the folder made: ${second.folder}`);
    assert.notEqual(path.basename(second.folder), path.basename(first.folder), 'not the first project\'s folder');
  });
}
