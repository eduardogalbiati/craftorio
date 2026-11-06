// #791: what the review found on the screens: the project's Fix select offers a workflow only the repository
// declares, without changing the cards and the Add dialog; the plan's summary and groups follow the owner's
// kind; Feature / Fix over an old workflow name keep a file of the list and the alias's inputs.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const DefaultWorkflow = require('@multiagent/shared/default-workflow');
const { loadPage, settle } = require('@multiagent/ui-kit/test/agent-chat-page-harness');

const task = { task: {} };
const INSTALLED = [
  { file: 'feature.yaml', name: 'feature', category: 'build', origin: 'default', inputs: task },
  { file: 'fix.yaml', name: 'fix', category: 'build', origin: 'default', inputs: task },
  { file: 'shared.yaml', name: 'shared', category: 'build', origin: 'custom', inputs: task },
];
const REPOSITORY = [
  { file: 'project.yaml', name: '.multiagent/project.yaml', origin: 'repository', error: 'a problem' },
  { name: 'feature', category: 'solo', origin: 'manifest' },
  { file: 'hero.yaml', name: 'hero', category: 'solo', origin: 'repository', inputs: task },
  { file: 'shared.yaml', name: 'shared', category: 'solo', origin: 'repository', inputs: task },
];
const RECORD = { id: 'p1', name: 'Project One', repo: 'https://github.com/o/one', folder: 'C:/work/one', exists: true, isGit: true, workflows: [{ name: 'feature', origin: 'workspace' }] };
const plain = (x) => JSON.parse(JSON.stringify(x));

async function overview({ repository = async () => plain(REPOSITORY) } = {}) {
  const asked = [];
  const page = await loadPage({
    api: {
      listProjects: async () => [plain(RECORD)],
      listWorkflows: async (args) => { asked.push(args ?? null); return args?.repositoryOnly ? repository() : plain(INSTALLED); },
      projectManifest: async () => null,
      updateProject: async (id, patch) => ({ ...plain(RECORD), ...plain(patch) }),
      listProjectRuns: async () => ({ runs: [], project: plain(RECORD), local: null }),
      getBacklog: async () => ({ platform: 'github', syncedAt: '2026-10-01T00:00:00Z', issues: [], epics: [] }),
      getRepositoryPerformance: () => new Promise(() => {}),
      envDetails: async () => [],
    },
  });
  page.run('openProjectView("p1")');
  await settle(40);
  return { page, asked };
}
const fixOptions = (page) => Array.from(page.$('[data-testid="project-kind-workflow-fix"]').querySelectorAll('option')).map((o) => o.getAttribute('value'));

test('#791 the Fix select offers a workflow only the repository declares, a file both have once', { timeout: 30000 }, async () => {
  const { page, asked } = await overview();
  assert.deepEqual(fixOptions(page).sort(), ['feature.yaml', 'fix.yaml', 'hero.yaml', 'shared.yaml']);
  assert.equal(asked.some((a) => a?.projectId === 'p1' && a.repositoryOnly === true), true);
});

test('#791 a repository that cannot be read leaves the workspace\'s workflows in the select', { timeout: 30000 }, async () => {
  const { page } = await overview({ repository: async () => { throw new Error('no'); } });
  assert.deepEqual(fixOptions(page).sort(), ['feature.yaml', 'fix.yaml', 'shared.yaml']);
});

test('#791 the Add dialog stays the workspace\'s, in the workspace\'s categories', { timeout: 30000 }, async () => {
  const { page } = await overview();
  page.$('[data-testid="pj-wf-add"]').click();
  await settle(40);
  const options = Array.from(page.document.querySelectorAll('[data-testid="pj-wf-add-option"]')).map((o) => o.getAttribute('data-workflow-id'));
  assert.deepEqual(options.sort(), ['fix', 'shared']);
  assert.deepEqual(Array.from(page.document.querySelectorAll('.pj-wf-group')).map((g) => g.getAttribute('data-category')), ['build']);
});

test('#791 opening the Add dialog reads the repository again: a workflow declared since reaches the Fix select', { timeout: 30000 }, async () => {
  const declared = plain(REPOSITORY);
  const { page } = await overview({ repository: async () => plain(declared) });
  assert.equal(fixOptions(page).includes('late.yaml'), false);
  declared.push({ file: 'late.yaml', name: 'late', category: 'solo', origin: 'repository', inputs: task });
  page.$('[data-testid="pj-wf-add"]').click();
  await settle(40);
  assert.equal(fixOptions(page).includes('late.yaml'), true);
  const options = Array.from(page.document.querySelectorAll('[data-testid="pj-wf-add-option"]')).map((o) => o.getAttribute('data-workflow-id'));
  assert.equal(options.includes('late'), false, 'the dialog stays the workspace\'s');
});

// backlog-po-kinds.js alone: the markup and the edit, no drawer
function kinds() {
  const window = { Select: { markup: () => '' } };
  const file = path.join(__dirname, '..', 'views', 'backlog', 'backlog-po-kinds.js');
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), { window, DefaultWorkflow, esc: String, t: (k, a) => (a ? `${k}:${a.count}` : k) });
  return window.BacklogPoKinds;
}

test('#791 the summary and the groups follow the kind the owner chose', () => {
  const k = kinds();
  const groups = [{ kind: 'feature' }, { kind: 'feature' }];
  const edits = { 1: { kind: 'fix' } };
  const html = k.planHtml(groups, (g, n) => `[card ${n}]`, (g, n) => k.shown(g, edits[n]));
  assert.match(html, /po\.kind\.count_feature:1 · po\.kind\.count_fix:1/);
  assert.match(html, /po-kind-group-feature">\[card 0\]/);
  assert.match(html, /po-kind-group-fix">\[card 1\]/);
});

test('#791 without the owner\'s choices the plan goes by the PO\'s kinds', () => {
  assert.match(kinds().planHtml([{ kind: 'fix' }], () => 'x'), /po\.kind\.count_fix:1/);
});

test('#791 Feature on a project whose default is an old name: a file of the list, with the alias\'s mode', () => {
  const edit = { values: {} };
  kinds().choose(edit, { kind: 'fix', workflow: 'fix.yaml' }, 'feature', { project: { defaultWorkflow: 'ai-development-local-hero' }, workflows: INSTALLED });
  assert.deepEqual([edit.workflow, plain(edit.kindInputs)], ['feature.yaml', { mode: 'local' }]);
});
