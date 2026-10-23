// #485: the Workflows screen's repository section and the four categories
// (src/renderer/views/workflows/workflows.js). Acceptance tests, written before the code, through the
// whole page (test/agent-chat-page-harness.js, like test/renderer-workflows-supervisor-fab-409.test.js).
//
// Seams (what these tests assume):
//   - api.listWorkflows(...) returns, next to the workspace workflows, repository entries
//     { file, name, category, origin: 'repository', projectId, commit, accepted } (the fake returns
//     them whatever the arguments, so the screen may ask per project or once).
//   - Definitions tab: each repository workflow has a card [data-testid="repository-workflow"] inside
//     its category section [data-testid="workflow-category"][data-category="<category>"], showing the badge text
//     "repository @ <the commit's first 7 characters>", a Clone button [data-testid="workflow-clone"],
//     an Open in builder button [data-testid="workflow-open-builder"] (read-only), and, when not
//     accepted, an Accept button [data-testid="workflow-accept"] that calls
//     api.acceptWorkflow({ projectId, file, commit }) (channel workflows:accept).
//   - The four categories (intake, solo, team, release) are sections with a one-line explanation:
//     Intake: issues; Solo: one person, local merge into the local main; Team: pull requests, CI and CD;
//     Release.
const test = require('node:test');
const assert = require('node:assert/strict');
const { textOf } = require('./mini-dom');
const { loadPage, settle } = require('./agent-chat-page-harness');

const SHA = 'abc1234def5678901234567890abcdef12345678';
const ACCEPTED_SHA = '9876543fedcba9876543210fedcba9876543210f';
const base = { description: '', tags: [], inputs: {}, outputs: {}, agents: {}, providers: {}, groups: [], warnings: [], steps: [{ id: 'work', type: 'agent', agent: 'a', skills: [], next: [], transitions: [] }] };
const WORKFLOWS = [
  { ...base, file: 'backlog-refresh.yaml', name: 'backlog-refresh', category: 'intake', origin: 'default' },
  { ...base, file: 'software-development-local-hero.yaml', name: 'software-development-local-hero', category: 'solo', origin: 'default' },
  { ...base, file: 'software-development.yaml', name: 'software-development', category: 'team', origin: 'default' },
  { ...base, file: 'release.yaml', name: 'release', category: 'release', origin: 'default' },
  { ...base, file: 'workflows/repo-flow.yaml', name: 'repo-flow', category: 'solo', origin: 'repository', projectId: 'p1', commit: SHA, accepted: false },
  { ...base, file: 'workflows/kept-flow.yaml', name: 'kept-flow', category: 'team', origin: 'repository', projectId: 'p1', commit: ACCEPTED_SHA, accepted: true },
];
const PROJECTS = [{ id: 'p1', name: 'demo', folder: 'C:/demo' }];

async function definitions(extra = {}) {
  const page = await loadPage({ api: { listWorkflows: async () => WORKFLOWS, listProjects: async () => PROJECTS, listPipelines: async () => [], ...extra } });
  page.run('showWorkflowsTab(\'definitions\'); showView(\'workflows\')');
  await settle(30);
  return page;
}
const norm = (s) => String(s).replace(/\s+/g, ' ').trim();
const cards = (page) => page.document.querySelectorAll('#view-workflows [data-testid="repository-workflow"]');
const cardOf = (page, name) => cards(page).find((c) => textOf(c).includes(name)) || null;

test('#485 the Definitions tab renders the listed workspace workflows (guards the harness, passes before the change)', async () => {
  const page = await definitions();
  const text = norm(textOf(page.$('#workflows-list')));
  for (const name of ['backlog-refresh', 'software-development-local-hero', 'release']) assert.equal(text.includes(name), true, name);
});

test('#485 each repository workflow has a repository card in its category section', async () => {
  const page = await definitions();
  const names = cards(page).map((c) => norm(textOf(c)));
  assert.equal(names.filter((t) => t.includes('repo-flow')).length >= 1, true, 'repo-flow has a card');
  assert.equal(names.filter((t) => t.includes('kept-flow')).length >= 1, true, 'kept-flow has a card');
  assert.equal(names.some((t) => t.includes('software-development-local-hero')), false, 'workspace workflows have no repository card');
  const inSection = (category, name) => page.document.querySelectorAll(`#view-workflows [data-testid="workflow-category"][data-category="${category}"] [data-testid="repository-workflow"]`)
    .some((c) => textOf(c).includes(name));
  assert.equal(inSection('solo', 'repo-flow'), true, 'repo-flow in the solo section');
  assert.equal(inSection('team', 'kept-flow'), true, 'kept-flow in the team section');
});

test('#485 a repository card shows "repository @ <short sha>", Clone and Open in builder', async () => {
  const page = await definitions();
  const card = cardOf(page, 'repo-flow');
  assert.equal(card !== null, true, 'repo-flow card');
  assert.match(norm(textOf(card)), /repository @ abc1234\b/);
  assert.equal(card.querySelector('[data-testid="workflow-clone"]') !== null, true, 'Clone');
  assert.equal(card.querySelector('[data-testid="workflow-open-builder"]') !== null, true, 'Open in builder');
  const kept = cardOf(page, 'kept-flow');
  assert.match(norm(textOf(kept)), /repository @ 9876543\b/);
});

test('#485 Accept is offered on an unaccepted repository workflow only, and records project, file and commit', async () => {
  const accepted = [];
  const page = await definitions({ acceptWorkflow: async (arg) => { accepted.push(JSON.stringify(arg)); return true; } });
  const kept = cardOf(page, 'kept-flow');
  assert.equal(kept !== null, true, 'kept-flow card');
  assert.equal(kept.querySelector('[data-testid="workflow-accept"]') === null, true, 'no Accept on an accepted one');
  const card = cardOf(page, 'repo-flow');
  assert.equal(card !== null, true, 'repo-flow card');
  const btn = card.querySelector('[data-testid="workflow-accept"]');
  assert.equal(btn !== null, true, 'Accept');
  btn.click();
  await settle(20);
  assert.equal(accepted.length, 1);
  assert.equal(accepted[0].includes('"p1"'), true, 'the project');
  assert.equal(accepted[0].includes('workflows/repo-flow.yaml'), true, 'the file');
  assert.equal(accepted[0].includes(SHA), true, 'the commit');
});

// The screen asks each project with a folder for its repository workflows alone (repositoryOnly): the
// repository's own, plus { name, category, origin: 'manifest' } per workflow its manifest names.
function perProject(repositoryItems) {
  return async (opts) => (opts && opts.repositoryOnly ? repositoryItems : WORKFLOWS.filter((w) => w.origin !== 'repository'));
}
const workspaceCardIn = (page, category, name) => page.document
  .querySelectorAll(`#view-workflows [data-testid="workflow-category"][data-category="${category}"] [data-testid="workflow-card"]`)
  .some((c) => textOf(c).includes(name));

test('#485 a workspace workflow the manifest names goes to the manifest\'s category section', async () => {
  const listWorkflows = perProject([{ name: 'backlog-refresh', category: 'team', origin: 'manifest', projectId: 'p1' }]);
  const page = await definitions({ listWorkflows });
  assert.equal(workspaceCardIn(page, 'team', 'backlog-refresh'), true, 'backlog-refresh in the team section');
  assert.equal(workspaceCardIn(page, 'intake', 'backlog-refresh'), false, 'no longer in its own intake section');
  assert.equal(workspaceCardIn(page, 'release', 'release'), true, 'a workflow the manifest does not name keeps its category');
});

test('#485 a repository workflow changed since its accepted commit shows the diff and that commit', async () => {
  const changed = { ...WORKFLOWS[4], acceptedCommit: ACCEPTED_SHA, diff: '-  prompt: old work\n+  prompt: new work' };
  const kept = { ...WORKFLOWS[5], acceptedCommit: ACCEPTED_SHA, diff: '+  prompt: never shown' };
  const page = await definitions({ listWorkflows: perProject([changed, kept]) });
  const card = cardOf(page, 'repo-flow');
  assert.equal(card !== null, true, 'repo-flow card');
  const text = norm(textOf(card));
  assert.equal(text.includes('+ prompt: new work'), true, text);
  assert.equal(text.includes('9876543'), true, 'the accepted commit, short');
  const keptCard = cardOf(page, 'kept-flow');
  assert.equal(keptCard !== null, true, 'kept-flow card');
  assert.equal(norm(textOf(keptCard)).includes('never shown'), false, 'an accepted workflow shows no diff');
});

test('#485 the four categories are sections with a one-line explanation each', async () => {
  const page = await definitions();
  const text = norm(textOf(page.$('#view-workflows')));
  for (const name of ['Intake', 'Solo', 'Team', 'Release']) assert.equal(text.includes(name), true, `${name} section`);
  assert.match(text, /issues/i, 'Intake: issues');
  assert.match(text, /one person/i, 'Solo: one person');
  assert.match(text, /local main/i, 'Solo: merges into the local main');
  assert.match(text, /pull requests/i, 'Team: pull requests');
  assert.match(text, /\bCI\b/, 'Team: CI');
  assert.match(text, /\bCD\b/, 'Team: CD');
});
