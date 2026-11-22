// #732: the renderer's Projects list (state.projects, read by api.listProjects) follows the onboarding.
// The onboarding (packages/engine/service/areas/project-onboarding.js) creates the project and clones it
// in the background; until now nothing read the list again on onboarding:changed, so screens reading
// state.projects (the City's "Analyze this project") saw no project, or no folder. Now an
// onboarding:changed (the project created, the clone done) reads api.listProjects again and the new
// list, with the project's folder, lands in state.projects.
// On the real page (packages/ui-kit/test/renderer-app-harness.js), the event fired through every
// window.api.onOnboardingChanged listener as project-wizard-review-641.test.js does: whichever script
// subscribes (project-wizard.js, projects.js, app.js) is covered.
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('@craftorio/ui-kit/test/renderer-app-harness');

const PID = 'p-new';
const FOLDER = 'C:/ws/projects/p-new';
const jobs = (over = {}) => ({
  clone: { status: 'running' }, facts: { status: 'waiting' }, profile: { status: 'waiting' },
  projectMap: { status: 'waiting' }, ranking: { status: 'waiting' }, ...over,
});
const CLONING = { projectId: PID, status: 'cloning', jobs: jobs(), cli: null };
const READY = { projectId: PID, status: 'ready', jobs: jobs({ clone: { status: 'done' } }), cli: null };

const clone = (x) => JSON.parse(JSON.stringify(x));

// the service's list, changed by the test as the onboarding goes (what api.listProjects answers now)
function page(initial) {
  // service.next: a one-shot answer for the next read (a promise the test resolves when it wants)
  const service = { projects: initial, next: null };
  const app = loadApp({
    api: {
      listProjects: async () => {
        if (service.next) { const n = service.next; service.next = null; return clone(await n()); }
        return clone(service.projects);
      },
      onboardingStatus: async () => clone(CLONING),
      architectureEstimate: async () => null,
    },
  });
  return { app, service };
}

async function emit(app, state) {
  for (const fn of app.apiHandlers.onOnboardingChanged || []) fn(clone(state));
  await app.settle(10);
}

const cachedFolder = (app, id) => {
  const p = (app.state().projects || []).find((x) => x.id === id);
  return p ? String(p.folder ?? '') : null;
};

test('#732 the project the onboarding created lands in state.projects on onboarding:changed', async () => {
  const { app, service } = page([]);
  await app.boot();
  await app.settle(10);
  assert.ok((app.apiHandlers.onOnboardingChanged || []).length >= 1, 'the page listens to api.onOnboardingChanged');
  assert.equal(cachedFolder(app, PID), null, 'not in the cached list before the onboarding');
  service.projects = [{ id: PID, name: 'New one', repo: 'https://github.com/o/new', folder: FOLDER }];
  await emit(app, CLONING);
  assert.equal(cachedFolder(app, PID), FOLDER, 'state.projects has the new project with its folder');
});

test('#732 when the clone is done state.projects gets the project\'s folder', async () => {
  const { app, service } = page([{ id: PID, name: 'New one', repo: 'https://github.com/o/new', folder: null }]);
  await app.boot();
  await app.settle(10);
  assert.equal(cachedFolder(app, PID), '', 'cached without a folder while the clone runs');
  service.projects = [{ id: PID, name: 'New one', repo: 'https://github.com/o/new', folder: FOLDER }];
  await emit(app, READY);
  assert.equal(cachedFolder(app, PID), FOLDER, 'state.projects has the folder now');
});

test('#732 a late answer of an older read never replaces a newer list in state.projects', async () => {
  const { app, service } = page([]);
  await app.boot();
  await app.settle(10);
  const older = [{ id: PID, name: 'New one', repo: 'https://github.com/o/new', folder: null }];
  const newer = [{ id: PID, name: 'New one', repo: 'https://github.com/o/new', folder: FOLDER }];
  let answerOlder;
  service.next = () => new Promise((resolve) => { answerOlder = () => resolve(older); });
  await emit(app, CLONING); // the project created: its read is still pending
  assert.equal(typeof answerOlder, 'function', 'the first event read the list');
  service.next = async () => newer;
  await emit(app, READY); // the clone done: this read answers first
  assert.equal(cachedFolder(app, PID), FOLDER, 'the newer list is in state.projects');
  answerOlder();
  await app.settle(10);
  assert.equal(cachedFolder(app, PID), FOLDER, 'the older answer, arriving last, does not bring the list back');
});
