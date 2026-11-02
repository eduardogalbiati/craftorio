// #744 acceptance, written before the code: the Product Owner's side of the Next steps card's "Open the PO"
// (fronts/build/views/backlog/backlog-po.js). The project page calls Actions.call('openPoIssue', projectId)
// (packages/ui-kit/actions.js); the Build front registers that action and it opens the PO's drawer
// (#po-drawer) in issue mode (Register an issue: #po-mode's data-po-mode="issue" active, the plan pills
// #po-chips hidden) on that project's conversation (api.productOwnerHistory(projectId)).
// The whole page is loaded by packages/ui-kit/test/agent-chat-page-harness.js.
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadPage, settle } = require('@multiagent/ui-kit/test/agent-chat-page-harness');

const PROJECTS = [
  { id: 'p1', name: 'Demo', folder: 'C:/ws/repos/demo', exists: true },
  { id: 'p2', name: 'Other', folder: 'C:/ws/repos/other', exists: true },
];

async function openedFromNextSteps() {
  const page = await loadPage({ api: { listProjects: async () => JSON.parse(JSON.stringify(PROJECTS)), productOwnerHistory: async () => [] } });
  assert.equal(page.sandbox.Actions.has('openPoIssue'), true, 'the Build front registers the openPoIssue action');
  await page.sandbox.Actions.call('openPoIssue', 'p1');
  await settle(20);
  return page;
}

test('#744 openPoIssue opens the Product Owner\'s drawer', { timeout: 30000 }, async () => {
  const page = await openedFromNextSteps();
  assert.equal(page.$('#po-drawer').classList.contains('open'), true);
});

test('#744 openPoIssue opens the conversation of the given project', { timeout: 30000 }, async () => {
  const page = await openedFromNextSteps();
  assert.deepEqual(page.callsTo('productOwnerHistory').map((args) => String(args[0])).at(-1), 'p1');
});

test('#744 openPoIssue opens the drawer in issue mode (Register an issue)', { timeout: 30000 }, async () => {
  const page = await openedFromNextSteps();
  const issue = page.$('#po-mode [data-po-mode="issue"]');
  assert.equal(issue ? issue.classList.contains('active') : 'no #po-mode issue button', true);
  assert.equal(page.$('#po-chips').classList.contains('hidden'), true, 'the plan pills are hidden');
});
