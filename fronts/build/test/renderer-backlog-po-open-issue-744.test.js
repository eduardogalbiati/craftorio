// #744 acceptance, written before the code: the Product Owner's side of the Next steps card's "Open the PO"
// (fronts/build/views/backlog/backlog-po.js). The project page calls Actions.call('openPoIssue', projectId)
// (packages/ui-kit/actions.js); the Build front registers that action and it opens the PO's drawer
// (#po-drawer) in issue mode (Register an issue: the attach button shown, the plan pills #po-chips
// hidden) on that project's conversation (api.productOwnerHistory(projectId)).
// The whole page is loaded by packages/ui-kit/test/agent-chat-page-harness.js.
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadPage, settle } = require('@craftorio/ui-kit/test/agent-chat-page-harness');

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
  // #785: no Plan / Register toggle; issue mode shows the attach button and hides the plan pills
  assert.equal(page.$('#btn-po-attach').classList.contains('hidden'), false, 'attachments are offered');
  assert.equal(page.$('#po-chips').classList.contains('hidden'), true, 'the plan pills are hidden');
});

// ---- the step marked done: an issue filed after "Open the PO" is saved for the Next steps card ----------
// project.js reads localStorage multiagent.nextStepsPoIssue = { <projectId>: { issue, url } }.
const MARK_KEY = 'multiagent.nextStepsPoIssue';
const DRAFT = [{ role: 'po', mode: 'issue', ts: 1, text: 'Here is the draft.', issue: { draft: { title: 'Export the city', body: 'As an owner…', labels: [], related: [] } } }];
const FILED = { number: 42, url: 'https://github.com/o/demo/issues/42' };

function filingApi() {
  return {
    listProjects: async () => JSON.parse(JSON.stringify(PROJECTS)),
    productOwnerHistory: async () => JSON.parse(JSON.stringify(DRAFT)),
    fileProductOwnerDraft: async () => ({ messages: [], filed: { ...FILED } }),
  };
}

async function createTheDraft(page) {
  const create = page.$('#po-drawer [data-po-act="create"]');
  assert.equal(create !== null, true, 'the draft\'s Create button is shown');
  create.dispatchEvent(new page.dom.classes.MouseEvent('click', { bubbles: true, cancelable: true }));
  await settle(30);
  assert.equal(page.callsTo('fileProductOwnerDraft').length, 1, 'the draft was filed');
}

test('#744 an issue filed after "Open the PO" is saved as the Next steps step\'s issue for that project', { timeout: 30000 }, async () => {
  const page = await loadPage({ api: filingApi() });
  await page.sandbox.Actions.call('openPoIssue', 'p1');
  await settle(20);
  await createTheDraft(page);
  const saved = JSON.parse(page.sandbox.localStorage.getItem(MARK_KEY) || '{}');
  assert.deepEqual(JSON.parse(JSON.stringify(saved)), { p1: { issue: 42, url: FILED.url } });
});

test('#744 an issue filed from the Product Owner opened elsewhere (not from Next steps) marks no step', { timeout: 30000 }, async () => {
  const page = await loadPage({ api: filingApi() });
  const actions = page.sandbox.BacklogActions;
  actions.projectId = () => 'p1';
  actions.project = () => JSON.parse(JSON.stringify(PROJECTS[0]));
  await page.sandbox.BacklogPO.open();
  await settle(20);
  page.sandbox.BacklogPO.setMode?.('issue');
  await settle(5);
  await createTheDraft(page);
  assert.equal(page.sandbox.localStorage.getItem(MARK_KEY), null);
});
