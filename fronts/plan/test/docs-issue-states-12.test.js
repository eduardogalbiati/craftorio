// #12 internals: the issue states of the Docs items (packages/engine/fronts/plan/domains/docs.js
// withIssueStates, from the Backlog's synced issues) and what docs-list.js draws from them: no "Write the
// plan" once the item's issues are all closed, Done once its epic is closed.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { withIssueStates } = require('@craftorio/engine/fronts/plan/domains/docs');

const DOCS_LIST = path.join(__dirname, '..', 'views', 'docs', 'docs-list.js');
const BACKLOG = {
  repo: 'https://github.com/eduardogalbiati/multiagent-orchestrator.git',
  issues: [{ number: 628, state: 'CLOSED' }, { number: 629, state: 'closed' }, { number: 636, state: 'open' }],
};

function loadDocsList() {
  const i18n = require('@craftorio/shared/i18n');
  i18n.setLanguage?.('en');
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const DocModel = require('@craftorio/shared/doc-model');
  const sandbox = { esc, t: (...a) => i18n.t(...a), DocModel, DocsPanels: { openLabel: (doc) => `Open ${doc}` }, console };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(DOCS_LIST, 'utf8'), sandbox, { filename: DOCS_LIST });
  return sandbox.DocsList;
}

const specOnly = (issue, extra = {}) => ({ item: 'x', stage: 'design', issue, docs: [{ doc: 'intent', status: 'accepted' }, { doc: 'spec', status: 'signed off' }], ...extra });

test('#12 withIssueStates reads the issue and the epic states, lower case, from the synced issues', () => {
  const [it] = withIssueStates([{ item: 'a', docs: [], issue: '#629 (phase 1 of epic eduardogalbiati/multiagent-orchestrator#628)' }], BACKLOG);
  assert.equal(it.issueState, 'closed');
  assert.equal(it.epicState, 'closed');
});

test('#12 withIssueStates leaves unknown issues, other repositories and items without issue unchanged', () => {
  const items = [{ item: 'a', docs: [], issue: '#999' }, { item: 'b', docs: [], issue: 'other/repo#628' }, { item: 'c', docs: [] }];
  const out = withIssueStates(items, BACKLOG);
  assert.deepEqual(out, items);
  assert.equal(withIssueStates(items, null), items);
});

test('#12 a signed-off spec without plan whose issues are all closed offers no Write the plan, and is Done', () => {
  const L = loadDocsList();
  const html = String(L.itemsHtml([specOnly('#625', { issueState: 'closed' })], 'p1'));
  assert.doesNotMatch(html, /data-docs-write-plan/);
  assert.match(html, /data-testid="docs-item-done"/);
});

test('#12 an open issue keeps Write the plan; a closed phase of an open epic is not Done', () => {
  const L = loadDocsList();
  assert.match(String(L.itemsHtml([specOnly('#636', { issueState: 'open' })], 'p1')), /data-docs-write-plan/);
  const phase = specOnly('#629 (phase 1 of epic #628)', { issueState: 'closed', epicState: 'open' });
  assert.equal(L.isDone(phase), false);
  assert.match(String(L.itemsHtml([phase], 'p1')), /data-docs-write-plan/);
});
