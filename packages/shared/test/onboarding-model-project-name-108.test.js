// #108: a new project's name in the wizard's step 2 ("Create new project"), the pure rules of
// packages/shared/onboarding-model.js. Acceptance tests, written before the code.
//
// The contract assumed here (the developer implements exactly this, exported by the model):
// - newProjectFolderName(name, taken) → string: the folder (and id) a new project named `name` gets under
//   <workspace>/projects/: slugify(name), or its first free sibling `<slug>-2`, `<slug>-3`… when `taken` (an array
//   of the existing projects' ids, the engine's createProject rule in packages/engine/domains/project/projects.js)
//   holds it. `taken` missing or empty: the slug.
// - nameRequired(state) → 'onboarding.name_required' (the i18n key of the line under the name) while the
//   repository step of a new project (source 'new') has an empty or blank name; null otherwise.
// slugify is the existing rule ("Lista de Tarefas!" → lista-de-tarefas).
const test = require('node:test');
const assert = require('node:assert/strict');

const M = () => require('../onboarding-model');
const folderName = (name, taken) => {
  assert.equal(typeof M().newProjectFolderName, 'function', 'OnboardingModel.newProjectFolderName(name, taken)');
  return M().newProjectFolderName(name, taken);
};
const required = (state) => {
  assert.equal(typeof M().nameRequired, 'function', 'OnboardingModel.nameRequired(state)');
  return M().nameRequired(state);
};
const step2 = (name) => ({ ...M().initialState(), source: 'new', step: 'repository', name });

test('#108 newProjectFolderName: a free name gets its slug', () => {
  assert.equal(folderName('Lista Tarefas', []), 'lista-tarefas');
  assert.equal(folderName('Lista Tarefas'), 'lista-tarefas');
});

test('#108 newProjectFolderName: a repeated name gets <slug>-2', () => {
  assert.equal(folderName('Lista Tarefas', ['lista-tarefas']), 'lista-tarefas-2');
  assert.equal(folderName('lista tarefas', ['other', 'lista-tarefas']), 'lista-tarefas-2');
});

test('#108 newProjectFolderName: the first free sibling when -2 is taken too', () => {
  assert.equal(folderName('Lista Tarefas', ['lista-tarefas', 'lista-tarefas-2']), 'lista-tarefas-3');
  assert.equal(folderName('Lista Tarefas', ['lista-tarefas', 'lista-tarefas-3']), 'lista-tarefas-2');
});

test('#108 newProjectFolderName: the slug, not the name typed ("Lista de Tarefas!" → lista-de-tarefas)', () => {
  assert.equal(folderName('Lista de Tarefas!', []), 'lista-de-tarefas');
  assert.equal(folderName('Lista de Tarefas!', ['lista-de-tarefas']), 'lista-de-tarefas-2');
});

test('#108 nameRequired: an empty or blank name of a new project is required (onboarding.name_required)', () => {
  assert.equal(required(step2('')), 'onboarding.name_required');
  assert.equal(required(step2('   ')), 'onboarding.name_required');
});

test('#108 nameRequired: a typed name needs nothing', () => {
  assert.equal(required(step2('Lista Tarefas')), null);
});

test('#108 canGoNext stays false while the name is required', () => {
  assert.equal(M().canGoNext(step2('')), false);
  assert.equal(M().canGoNext(step2('Lista Tarefas')), true);
});
