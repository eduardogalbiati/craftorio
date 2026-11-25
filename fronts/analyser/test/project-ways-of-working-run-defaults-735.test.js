// #735: the Ways of working drawer (fronts/analyser/views/project/project-ways-of-working.js) saves the
// edited profile as the project's run defaults and kind (projects:update), so the run dialog, the
// roadmap and the CLI start from it. Mini DOM and a fake window.api, as project-ways-of-working-487.test.js.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { withI18n } = require('@craftorio/shared/test/i18n-sandbox');
const { createDom } = require('@craftorio/ui-kit/test/mini-dom');
const OnboardingModel = require('@craftorio/shared/onboarding-model');

const pageFileOf = (rel) => require('../../../scripts/source-tree').pageFile(path.join(__dirname, '..', '..', '..'), rel);
const FILE = pageFileOf('views/project/project-ways-of-working.js');

const INTERVIEW = {
  profile: { team: 'solo', merge: 'local', mode: 'local', tests: 'unit+e2e', release: null, testCommand: 'cargo test', checkCommand: null, e2eCommand: 'npm run test:e2e', ci: 'none', languages: ['rust'] },
  evidence: {},
  questions: [],
};

// `page`: the globals of the page under the drawer (#75), none in the drawer's own tests
function loadDrawer({ page = {}, failUpdate = false } = {}) {
  const updates = [];
  const api = {
    seedEstimate: async () => ({ costUsd: 0.1, free: false }),
    workflowInterview: async () => JSON.parse(JSON.stringify(INTERVIEW)),
    workflowCompose: async () => ({ workflows: [], manifest: { path: '.multiagent/project.yaml', yaml: '' } }),
    updateProject: async (id, patch) => {
      updates.push({ id, patch: JSON.parse(JSON.stringify(patch)) });
      if (failUpdate) throw new Error('disk full');
      return patch;
    },
    projectInputHints: async () => ({ runDefaults: { base_branch: 'main', ui_folders: [], screenshots: 'off' } }),
  };
  const sandbox = {
    console, setTimeout, clearTimeout, queueMicrotask, Promise,
    api, OnboardingModel,
    esc: (s) => String(s ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`),
    errMsg: (e) => String(e?.message || e), showToast: () => {},
    ...page,
  };
  const dom = createDom({ window: sandbox });
  Object.assign(sandbox, { window: sandbox, document: dom.document }, dom.classes);
  withI18n(sandbox);
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(FILE, 'utf8'), sandbox, { filename: 'project-ways-of-working.js' });
  const doc = dom.document;
  const q = (sel) => doc.querySelector(sel);
  const fire = (el, type, Cls = dom.classes.Event) => el.dispatchEvent(new Cls(type, { bubbles: true, cancelable: true }));
  const click = (el) => fire(el, 'click', dom.classes.MouseEvent);
  return { WOW: sandbox.ProjectWaysOfWorking, updates, q, fire, click };
}

const settle = async () => { for (let i = 0; i < 10; i++) await new Promise((r) => setImmediate(r)); };

async function editing(project = { id: 'p1', name: 'svc' }, opts = {}) {
  const w = loadDrawer(opts);
  await w.WOW.open(project);
  await settle();
  w.click(w.q('[data-testid="ways-of-working-analyze"]'));
  await settle();
  w.click(w.q('[data-testid="ways-of-working-edit-profile"]'));
  await settle();
  return w;
}

async function save(w) {
  w.fire(w.q('[data-testid="ways-of-working-profile-edit"]'), 'submit');
  await settle();
  assert.ok(w.updates.length > 0, 'saving the profile updates the project (projects:update)');
  return w.updates.at(-1);
}

test('#735 saving a unit-only profile writes E2E off and no E2E command to the project\'s run defaults', async () => {
  const w = await editing();
  w.q('[data-wow-profile-field="tests"]').value = 'unit';
  w.q('[data-wow-profile-field="mode"]').value = 'remote';
  const { id, patch } = await save(w);
  const d = patch.runDefaults;
  assert.deepEqual([id, d.e2e_tests, d.e2e_command, d.mode, d.test_command], ['p1', 'off', null, 'remote', 'cargo test']);
});

test('#735 going back to unit + E2E clears the saved E2E switch (null: what the engine derives)', async () => {
  const w = await editing({ id: 'p2', name: 'svc', runDefaults: { e2e_tests: 'off', e2e_command: null } });
  w.q('[data-wow-profile-field="tests"]').value = 'unit+e2e';
  const { patch } = await save(w);
  assert.deepEqual([patch.runDefaults.e2e_tests, patch.runDefaults.e2e_command], [null, 'npm run test:e2e']);
});

test('#735 the Run defaults fields are saved (UI folders as a list), and a cleared one is saved as null', async () => {
  const w = await editing({ id: 'p3', name: 'svc', runDefaults: { screenshots: 'all' } });
  w.q('[data-wow-run-default="base_branch"]').value = 'develop';
  w.q('[data-wow-run-default="ui_folders"]').value = 'web/, admin/src/';
  w.q('[data-wow-run-default="screenshots"]').value = '';
  const { patch } = await save(w);
  const d = patch.runDefaults;
  assert.deepEqual([d.base_branch, JSON.stringify(d.ui_folders), d.screenshots], ['develop', '["web/","admin/src/"]', null]);
});

test('#735 the kind picked in the profile is saved on the project', async () => {
  const w = await editing({ id: 'p4', name: 'svc' });
  w.q('[data-wow-profile-field="kind"]').value = 'backend';
  const { patch } = await save(w);
  assert.equal(patch.kind, 'backend');
});

// ---- #75: the page under the drawer follows the saved kind ------------------------------------------

// the project page's globals, with projects p1 and p2, the page of `open` and the view `view`; kinds[]: the kind the
// page had at each drawing
function pageUnder({ open = 'p1', view = 'project' } = {}) {
  const records = ['p1', 'p2'].map((id) => ({ id, name: id, kind: 'backend', exists: true }));
  const kinds = [];
  const state = { view, projects: records, pv: { id: open, project: records.find((p) => p.id === open) } };
  return { state, kinds, page: { state, renderProjectView: () => { kinds.push(state.pv.project.kind); } } };
}

async function pickFrontend(opts) {
  const w = await editing({ id: 'p1', name: 'p1', kind: 'backend' }, opts);
  w.q('[data-wow-profile-field="kind"]').value = 'frontend';
  await save(w);
}

const kindsOf = (state) => state.projects.map((p) => `${p.id} ${p.kind}`).join(', ');

test('#75 the kind saved in the drawer reaches the open page, drawn again, and the projects list', async () => {
  const { state, kinds, page } = pageUnder();
  await pickFrontend({ page });
  assert.equal(kinds.at(-1), 'frontend', 'drawn with the saved kind');
  assert.equal(`${state.pv.project.name} ${state.pv.project.exists}`, 'p1 true', 'the record\'s other fields stay');
  assert.equal(kindsOf(state), 'p1 frontend, p2 backend');
});

test('#75 the kind saved in the drawer while another project\'s page is open leaves that page as it is', async () => {
  const { state, kinds, page } = pageUnder({ open: 'p2' });
  await pickFrontend({ page });
  assert.equal(state.pv.project.kind, 'backend', 'p2\'s own kind');
  assert.equal(kinds.length, 0, 'not drawn again');
  assert.equal(kindsOf(state), 'p1 frontend, p2 backend');
});

test('#75 the kind saved while another view is on screen is on the page\'s record, with nothing drawn over the view', async () => {
  const { state, kinds, page } = pageUnder({ view: 'inbox' });
  await pickFrontend({ page });
  assert.equal(state.pv.project.kind, 'frontend');
  assert.equal(kinds.length, 0);
});

test('#75 a kind that could not be saved changes nothing on the page', async () => {
  const { state, kinds, page } = pageUnder();
  await pickFrontend({ page, failUpdate: true });
  assert.equal(state.pv.project.kind, 'backend');
  assert.equal(kinds.length, 0);
  assert.equal(kindsOf(state), 'p1 backend, p2 backend');
});
