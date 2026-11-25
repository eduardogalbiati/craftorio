// #39: the Start drawer's git_platform field: hidden only for the issue workflow on a project with no repository, shown
// again when the project or the workflow changes, and never shown where the workflow's own `show_if` hides it.
// Seam: the whole page (agent-chat-page-harness): openDrawer, the project and workflow selects, and what is hidden.
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadPage, settle } = require('./agent-chat-page-harness');

const platform = (extra = {}) => ({ type: 'string', enum: ['gh', 'gl'], default: 'gh', label: 'Platform', options: { gh: 'GitHub', gl: 'GitLab' }, ...extra });
const workflow = (name, inputs) => ({ file: `${name}.yaml`, name, steps: [], agents: {}, inputs: { request: { label: 'Request', type: 'string', default: '' }, project_path: { label: 'Project folder', type: 'string', required: true }, ...inputs } });
const WORKFLOWS = [
  workflow('issue', { git_platform: platform() }),
  // as the bundled feature.yaml: the platform belongs to the remote modes
  workflow('feature', { mode: { type: 'string', enum: ['local', 'remote'], default: 'local', label: 'Mode' }, git_platform: platform({ show_if: "mode != 'local'" }) }),
  workflow('triage', { git_platform: platform() }),
];
const PROJECTS = [
  { id: 'local', name: 'lista', folder: 'C:/ws/lista', exists: true, repo: null },
  { id: 'remote', name: 'site', folder: 'C:/ws/site', exists: true, repo: 'https://github.com/o/site' },
];

async function drawer({ workflow: file, project }) {
  const page = await loadPage({
    api: {
      listProjects: async () => JSON.parse(JSON.stringify(PROJECTS)),
      listPipelines: async () => [],
      listWorkflows: async () => JSON.parse(JSON.stringify(WORKFLOWS)),
    },
  });
  page.run(`openDrawer(${JSON.stringify({ workflow: file, project })})`);
  await settle(30);
  return page;
}
async function choose(page, select, value) {
  page.$(select).value = value;
  page.$(select).onchange();
  await settle(30);
}
// hidden itself (the attribute or the class), or inside something hidden, up to the drawer
function platformShown(page) {
  const top = page.$('#drawer');
  let el = page.$('#drawer [data-wi-input="git_platform"]');
  assert.equal(el === null, false, 'the form has a git_platform field');
  for (; el && el !== top; el = el.parentElement) if (el.hidden || el.classList.contains('hidden')) return false;
  return true;
}

test('#39 changing the project of an issue run shows the platform again with a repository, and hides it without one', async () => {
  const page = await drawer({ workflow: 'issue.yaml', project: 'local' });
  const seen = [platformShown(page)];
  await choose(page, '#project-select', 'remote');
  seen.push(platformShown(page));
  await choose(page, '#project-select', 'local');
  seen.push(platformShown(page));
  assert.deepEqual(seen, [false, true, false]);
});

test('#39 with no project chosen the issue workflow keeps its platform field', async () => {
  const page = await drawer({ workflow: 'issue.yaml', project: 'local' });
  await choose(page, '#project-select', '');
  assert.equal(platformShown(page), true);
});

test('#39 another workflow on a project with no repository keeps its platform field', async () => {
  const page = await drawer({ workflow: 'issue.yaml', project: 'local' });
  await choose(page, '#wf-select', 'triage.yaml');
  assert.equal(platformShown(page), true);
  await choose(page, '#wf-select', 'issue.yaml');
  assert.equal(platformShown(page), false);
});

for (const project of ['local', 'remote']) {
  test(`#39 a platform the workflow's show_if hides stays hidden (feature in local mode, ${project} project)`, async () => {
    const page = await drawer({ workflow: 'feature.yaml', project });
    assert.equal(platformShown(page), false);
  });
}
