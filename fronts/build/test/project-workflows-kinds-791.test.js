// #791: the project page's Workflows block shows the Feature and Fix workflows and the owner can change
// them. Acceptance tests, written before the code, on the whole page (agent-chat-page-harness.js: a real
// mini DOM, so a change bubbles to whichever element listens), the project page opened with
// openProjectView.
// Contract: project-kind-workflow-feature, project-kind-workflow-fix: a select, or an element holding one,
// over the installed workflows; a change saves api.updateProject(id, { workflowKinds }).
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadPage, settle } = require('@craftorio/ui-kit/test/agent-chat-page-harness');

const task = { task: {} };
const INSTALLED = [
  { file: 'feature.yaml', name: 'feature', category: 'build', origin: 'bundled', inputs: task },
  { file: 'fix.yaml', name: 'fix', category: 'build', origin: 'bundled', inputs: task },
  { file: 'my-fix.yaml', name: 'my-fix', category: 'build', origin: 'custom', inputs: task },
];
const BASE = { id: 'p1', name: 'Project One', repo: 'https://github.com/o/one', folder: 'C:/work/one', exists: true, isGit: true };
const KINDS = { feature: { name: 'feature', inputs: {} }, fix: { name: 'fix', inputs: { mode: 'remote' } } };

const plain = (x) => JSON.parse(JSON.stringify(x));
const bare = (v) => String(v ?? '').replace(/\.ya?ml$/i, '');

async function overview(project, { manifest = null } = {}) {
  let record = { ...BASE, ...plain(project) };
  const page = await loadPage({
    api: {
      listProjects: async () => [plain(record)],
      listWorkflows: async () => plain(INSTALLED),
      projectManifest: async () => plain(manifest),
      updateProject: async (id, patch) => { record = { ...record, ...plain(patch) }; return plain(record); },
      listProjectRuns: async () => ({ runs: [], project: plain(record), local: null }),
      getBacklog: async () => ({ platform: 'github', syncedAt: '2026-10-01T00:00:00Z', issues: [], epics: [] }),
      getRepositoryPerformance: () => new Promise(() => {}),
      envDetails: async () => [],
    },
  });
  page.run('openProjectView("p1")');
  await settle(40);
  assert.equal(page.$('[data-testid="project-workflows-block"]') === null, false, 'the Workflows block is drawn');
  return page;
}

function control(page, kind) {
  const el = page.$(`[data-testid="project-kind-workflow-${kind}"]`);
  if (!el) return null;
  return String(el.tagName).toUpperCase() === 'SELECT' ? el : el.querySelector('select');
}

test('#791 the Workflows block shows the project\'s Feature workflow', { timeout: 30000 }, async () => {
  const page = await overview({ workflowKinds: { ...KINDS, feature: { name: 'my-fix', inputs: {} } } });
  assert.equal(bare(control(page, 'feature')?.value), 'my-fix');
});

test('#791 the Workflows block shows the project\'s Fix workflow', { timeout: 30000 }, async () => {
  const page = await overview({ workflowKinds: { ...KINDS, fix: { name: 'my-fix', inputs: {} } } });
  assert.equal(bare(control(page, 'fix')?.value), 'my-fix');
});

test('#791 a project with no map of its own shows the manifest\'s', { timeout: 30000 }, async () => {
  const page = await overview({}, { manifest: { workflows: [], kinds: { fix: { name: 'my-fix', inputs: {} } } } });
  assert.equal(bare(control(page, 'fix')?.value), 'my-fix');
});

test('#791 a project with no map and no manifest shows feature and fix', { timeout: 30000 }, async () => {
  const page = await overview({});
  assert.deepEqual([bare(control(page, 'feature')?.value), bare(control(page, 'fix')?.value)], ['feature', 'fix']);
});

test('#791 changing the Fix workflow saves it on the project', { timeout: 30000 }, async () => {
  const page = await overview({ workflowKinds: KINDS });
  const select = control(page, 'fix');
  assert.equal(select === null, false, 'the Fix workflow control');
  const option = Array.from(select.querySelectorAll('option')).find((o) => bare(o.getAttribute('value')) === 'my-fix');
  assert.equal(option === undefined, false, 'my-fix is offered');
  select.value = option.getAttribute('value');
  select.dispatchEvent(new page.dom.classes.Event('change', { bubbles: true }));
  await settle(30);
  const saved = page.callsTo('updateProject').map((args) => plain(args[1]).workflowKinds?.fix?.name).map(bare);
  assert.deepEqual(saved, ['my-fix']);
});
