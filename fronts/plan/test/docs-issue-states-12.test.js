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
  const sandbox = { esc, t: (...a) => i18n.t(...a), DocModel, DocsPanels: { openLabel: (doc) => `Open ${doc}` }, Platforms: require('@craftorio/shared/platforms'), console };
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

test('#12 issueRef reads an issue URL, a GitLab subgroup path, and the epic after "epic"', () => {
  const DocModel = require('@craftorio/shared/doc-model');
  const url = DocModel.issueRef('https://github.com/o/r/issues/628');
  assert.deepEqual({ repo: url.repo, number: url.number, url: url.url }, { repo: 'o/r', number: 628, url: 'https://github.com/o/r/issues/628' });
  const gl = DocModel.issueRef('"#5 (phase of epic https://gitlab.com/group/sub/repo/-/issues/4)"');
  assert.equal(gl.number, 5);
  assert.deepEqual({ repo: gl.epic.repo, number: gl.epic.number }, { repo: 'group/sub/repo', number: 4 });
  assert.equal(DocModel.issueRef('none'), null);
});

test('#12 withIssueStates compares whole repository paths (GitLab subgroups) and reads a phase in its epic\'s repository', () => {
  const backlog = { repo: 'https://gitlab.com/group/sub/repo.git', issues: [{ number: 5, state: 'closed' }, { number: 4, state: 'closed' }] };
  assert.equal(withIssueStates([{ item: 'a', docs: [], issue: 'sub/repo#5' }], backlog)[0].issueState, undefined);
  assert.equal(withIssueStates([{ item: 'a', docs: [], issue: 'group/sub/repo#5' }], backlog)[0].issueState, 'closed');
  const [other] = withIssueStates([{ item: 'b', docs: [], issue: '#5 (phase 1 of epic other/repo#4)' }], backlog);
  assert.equal(other.issueState, undefined);
  assert.equal(other.epicState, undefined);
});

test('#12 a Done item (closed epic, phase state unknown) offers no Write the plan; the link opens the epic', () => {
  const L = loadDocsList();
  const it = specOnly('#629 (phase 1 of epic o/r#628)', { epicState: 'closed' });
  const html = String(L.itemsHtml([it], 'p1', { repo: 'https://github.com/me/proj.git' }));
  assert.match(html, /data-testid="docs-item-done"/);
  assert.doesNotMatch(html, /data-docs-write-plan/);
  assert.match(html, /href="https:\/\/github\.com\/o\/r\/issues\/628"/);
});

test('#12 a signed-off spec without plan whose issues are all closed offers no Write the plan, and is Done', () => {
  const L = loadDocsList();
  const html = String(L.itemsHtml([specOnly('#625', { issueState: 'closed' })], 'p1'));
  assert.doesNotMatch(html, /data-docs-write-plan/);
  assert.match(html, /data-testid="docs-item-done"/);
});

// the row's issue link (its <a>…</a>, '' without one) and its href ('' when the link has none)
const hrefOf = (link) => /^<a [^>]*href="([^"]*)"/.exec(link)?.[1] || '';
const linkHtml = (html) => /<a [^>]*data-testid="docs-item-issue-link"[^>]*>[\s\S]*?<\/a>/.exec(html)?.[0] || '';

test('#12 the issue link of a bare #N opens it in the project\'s repository (GitHub, GitLab)', () => {
  const L = loadDocsList();
  assert.equal(hrefOf(linkHtml(String(L.itemsHtml([specOnly('#625')], 'p1', { repo: 'https://github.com/me/proj.git' })))), 'https://github.com/me/proj/issues/625');
  assert.equal(hrefOf(linkHtml(String(L.itemsHtml([specOnly('#7')], 'p1', { repo: 'https://gitlab.com/group/sub/proj.git' })))), 'https://gitlab.com/group/sub/proj/-/issues/7');
});

test('#12 the issue link of an owner/repo#N on a GitLab project opens it on the project\'s host', () => {
  const L = loadDocsList();
  const html = String(L.itemsHtml([specOnly('group/other#9')], 'p1', { repo: 'https://gitlab.com/group/proj.git' }));
  assert.equal(hrefOf(linkHtml(html)), 'https://gitlab.com/group/other/-/issues/9');
});

test('#12 an issue given as a URL links to that URL', () => {
  const L = loadDocsList();
  const html = String(L.itemsHtml([specOnly('https://gitlab.com/g/r/-/issues/12')], 'p1', { repo: 'https://github.com/me/proj.git' }));
  assert.equal(hrefOf(linkHtml(html)), 'https://gitlab.com/g/r/-/issues/12');
});

test('#12 a bare #N in a project without a repository draws the link without href, and still no Create epic', () => {
  const L = loadDocsList();
  const html = String(L.itemsHtml([specOnly('#625')], 'p1', null));
  const link = linkHtml(html);
  assert.equal([link !== '', /#625/.test(link), hrefOf(link)].join('|'), 'true|true|');
  assert.doesNotMatch(html, /data-docs-issues/);
});

test('#12 issueRef reads the first issue of a range or a pair glued together ("#835–#837", "#628/#629")', () => {
  const DocModel = require('@craftorio/shared/doc-model');
  const range = DocModel.issueRef('"#625 (phases eduardogalbiati/multiagent-orchestrator#835–#837)"');
  assert.equal(range?.number, 625);
  assert.equal(DocModel.issueRef('#835–#837')?.number, 835);
  assert.equal(DocModel.issueRef('#628/#629')?.number, 628);
});

test('#12 "epic #628" alone names the epic once in the row\'s link', () => {
  const L = loadDocsList();
  const link = linkHtml(String(L.itemsHtml([specOnly('epic #628')], 'p1')));
  const text = link.replace(/<[^>]+>/g, '');
  assert.equal((text.match(/#628/g) || []).length, 1, `link text: ${text}`);
});

test('#12 an open issue keeps Write the plan; a closed phase of an open epic is not Done', () => {
  const L = loadDocsList();
  assert.match(String(L.itemsHtml([specOnly('#636', { issueState: 'open' })], 'p1')), /data-docs-write-plan/);
  const phase = specOnly('#629 (phase 1 of epic #628)', { issueState: 'closed', epicState: 'open' });
  assert.equal(L.isDone(phase), false);
  assert.match(String(L.itemsHtml([phase], 'p1')), /data-docs-write-plan/);
});
