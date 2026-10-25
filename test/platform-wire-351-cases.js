// #351 helper (no test() at load): every GitHub / GitLab operation the app runs, called through its
// public function with an injected exec/reader that records the CLI calls and answers with recorded
// CLI outputs. test/platform-wire-351.test.js compares what each case gives ({ calls, result }) with
// test/fixtures/platform-wire-351.json, recorded before the platform adapters existed.

const GH = 'https://github.com/o/r';
const GHE = 'https://ghe.example.com/o/r';
const GL = 'https://gitlab.com/g/sub/p';
const GLS = 'https://git.example.com/g/p';

// recorded CLI outputs
const GH_ISSUE = {
  number: 12, title: 'Fix the login', state: 'OPEN', labels: [{ name: 'bug', color: 'd73a4a' }],
  url: 'https://github.com/o/r/issues/12', author: { login: 'ana' }, assignees: [{ login: 'bo' }],
  body: '- [x] one\n- [ ] two', createdAt: '2026-01-02T00:00:00Z', updatedAt: '2026-01-03T00:00:00Z',
};
const GH_EPIC = { ...GH_ISSUE, number: 5, title: 'The epic', labels: [{ name: 'epic', color: '3e4b9e' }], url: 'https://github.com/o/r/issues/5', body: '' };
const GL_ISSUE = {
  iid: 7, title: 'Fix the export', state: 'opened', labels: ['bug', 'epic::export'], web_url: 'https://gitlab.com/g/sub/p/-/issues/7',
  author: { username: 'ana' }, assignees: [{ username: 'bo' }], description: '- [ ] one', created_at: '2026-01-02T00:00:00Z',
  updated_at: '2026-01-03T00:00:00Z', epic: { iid: 3, title: 'Group epic', group_id: 44, web_url: 'https://gitlab.com/groups/g/-/epics/3' },
};
const GL_EPIC_ISSUE = { ...GL_ISSUE, iid: 9, title: 'Export', labels: ['epic', 'epic::export'], web_url: 'https://gitlab.com/g/sub/p/-/issues/9', epic: null };
const GH_PRS = [
  { number: 40, title: 'Fix the login (#12)', url: 'https://github.com/o/r/pull/40', isDraft: false, body: 'Closes #13', closingIssuesReferences: [{ number: 12 }] },
  { number: 41, title: 'WIP', url: 'https://github.com/o/r/pull/41', isDraft: true, body: '' },
];
const GL_MRS = [
  { iid: 8, title: 'Fix the export', web_url: 'https://gitlab.com/g/sub/p/-/merge_requests/8', draft: false, description: 'Closes #7' },
  { iid: 10, title: 'Draft: more', web_url: 'https://gitlab.com/g/sub/p/-/merge_requests/10', work_in_progress: true, description: '' },
];
const GH_PR_VIEW = { state: 'OPEN', isDraft: false, mergeable: 'MERGEABLE', mergeStateStatus: 'CLEAN', statusCheckRollup: [{ status: 'COMPLETED', conclusion: 'SUCCESS', name: 'ci' }] };
const GL_MR_VIEW = { state: 'opened', draft: false, detailed_merge_status: 'mergeable', has_conflicts: false, head_pipeline: { status: 'success' } };

// exec(cli, args) that records [cli, ...args] and answers with the first route whose key is in the joined call
function recorder(routes = []) {
  const calls = [];
  const exec = async (cli, args) => {
    calls.push([cli, ...args]);
    const line = [cli, ...args].join(' ');
    const hit = routes.find(([key]) => line.includes(key));
    if (!hit) return '';
    if (hit[1] instanceof Error) throw hit[1];
    return typeof hit[1] === 'string' ? hit[1] : JSON.stringify(hit[1]);
  };
  return { calls, exec };
}

// a new epic's body file is named after the time it was made
const timeless = (v) => JSON.parse(JSON.stringify(v ?? null).replace(/\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z/g, '<time>'));
const sorted = (set) => [...set].sort((a, b) => a - b);

const backlog = () => require('../src/domains/backlog/backlog');
const epics = () => require('../src/domains/backlog/epics');
const oracle = () => require('../src/domains/oracle/oracle-platform');
const runPr = () => require('../src/domains/run/run-pr');
const probes = () => require('../src/engine/probes');
const archive = () => require('@multiagent/shared/backlog-archive');

async function withExec(routes, fn) {
  const r = recorder(routes);
  let result;
  try { result = await fn(r.exec); } catch (e) { result = { error: e.message }; }
  return timeless({ calls: r.calls, result });
}
const pure = (fn) => { let result; try { result = fn(); } catch (e) { result = { error: e.message }; } return timeless({ calls: [], result }); };

const CASES = {
  // ---- issues: list and view, parsed
  'github: list issues': () => withExec([['issue list', [GH_ISSUE]]], (exec) => backlog().fetchIssues({ platform: 'github', repo: GH, exec })),
  'github: list issues (self-hosted)': () => withExec([['issue list', []]], (exec) => backlog().fetchIssues({ platform: 'github', repo: GHE, exec })),
  'gitlab: list issues': () => withExec([['issue list', [GL_ISSUE]]], (exec) => backlog().fetchIssues({ platform: 'gitlab', repo: GL, exec })),
  'gitlab: list issues (self-hosted)': () => withExec([['issue list', []]], (exec) => backlog().fetchIssues({ platform: 'gitlab', repo: GLS, exec })),
  'github: list issues of a GitLab repository': () => withExec([], (exec) => backlog().fetchIssues({ platform: 'github', repo: GL, exec })),
  'github: view an issue': () => withExec([['issue view', GH_ISSUE]], (exec) => backlog().fetchIssue({ platform: 'github', repo: GH, number: 12, exec })),
  'gitlab: view an issue': () => withExec([['issue view', GL_ISSUE]], (exec) => backlog().fetchIssue({ platform: 'gitlab', repo: GL, number: 7, exec })),
  'github: cli target': () => pure(() => [backlog().cliTarget('github', GH), backlog().cliTarget('github', GHE)]),
  'gitlab: cli target': () => pure(() => [backlog().cliTarget('gitlab', GL), backlog().cliTarget('gitlab', GLS)]),

  // ---- issues: create, save, close, reopen, label
  'github: create an issue': () => pure(() => backlog().issueCreateCommand({ platform: 'github', repo: GH, title: 'New one', labels: ['a', 'b'], file: 'body.md', text: 'The body' })),
  'gitlab: create an issue': () => pure(() => backlog().issueCreateCommand({ platform: 'gitlab', repo: GL, title: 'New one', labels: ['a', 'b'], file: 'body.md', text: 'The body' })),
  'github: replace an issue body': () => pure(() => backlog().issueSaveCommand({ platform: 'github', repo: GH, number: 12, mode: 'replace', file: 'doc.md', text: 'The doc' })),
  'github: comment on an issue': () => pure(() => backlog().issueSaveCommand({ platform: 'github', repo: GH, number: 12, mode: 'comment', file: 'doc.md', text: 'The doc' })),
  'gitlab: replace an issue body': () => pure(() => backlog().issueSaveCommand({ platform: 'gitlab', repo: GL, number: 7, mode: 'replace', file: 'doc.md', text: 'The doc' })),
  'gitlab: comment on an issue': () => pure(() => backlog().issueSaveCommand({ platform: 'gitlab', repo: GL, number: 7, mode: 'comment', file: 'doc.md', text: 'The doc' })),
  'github: close an issue': () => pure(() => backlog().issueCloseCommand({ platform: 'github', repo: GH, number: 12 })),
  'gitlab: close an issue': () => pure(() => backlog().issueCloseCommand({ platform: 'gitlab', repo: GL, number: 7 })),
  'github: archive an issue (close, label)': () => withExec([['label list', [{ name: 'bug' }]]], (exec) => backlog().archiveIssues({ platform: 'github', repo: GH, numbers: [12], exec })),
  'gitlab: archive an issue (close, label)': () => withExec([], (exec) => backlog().archiveIssues({ platform: 'gitlab', repo: GL, numbers: [7], exec })),
  'github: archive undone when labelling fails (reopen)': () => withExec([['label list', [{ name: 'archived' }]], ['--add-label', new Error('label refused')]], (exec) => backlog().archiveIssues({ platform: 'github', repo: GH, numbers: [12], exec })),
  'github: restore an issue (reopen, unlabel)': () => withExec([], (exec) => backlog().restoreIssues({ platform: 'github', repo: GH, numbers: [12], exec })),
  'gitlab: restore an issue (reopen, unlabel)': () => withExec([], (exec) => backlog().restoreIssues({ platform: 'gitlab', repo: GL, numbers: [7], exec })),
  'github: archive confirmation': () => pure(() => archive().archiveConfirmText([12, 13], 'github')),
  'gitlab: archive confirmation': () => pure(() => archive().archiveConfirmText([7], 'gitlab')),

  // ---- labels
  'github: read labels': () => withExec([['label list', [{ name: 'bug' }, { name: 'epic' }]]], (exec) => backlog().repoLabels({ platform: 'github', repo: GH, exec })),
  'gitlab: read labels': () => withExec([], (exec) => backlog().repoLabels({ platform: 'gitlab', repo: GL, exec })),

  // ---- pull / merge requests
  'github: list open pull requests': () => withExec([['pr list', GH_PRS]], (exec) => backlog().fetchOpenPullRequests({ platform: 'github', repo: GH, exec })),
  'github: list open pull requests (old gh)': () => withExec([['closingIssuesReferences', new Error('Unknown JSON field: "closingIssuesReferences"')], ['pr list', GH_PRS.map(({ closingIssuesReferences, ...p }) => p)]], (exec) => backlog().fetchOpenPullRequests({ platform: 'github', repo: GHE, exec })),
  'gitlab: list open merge requests': () => withExec([['mr list', GL_MRS]], (exec) => backlog().fetchOpenPullRequests({ platform: 'gitlab', repo: GL, exec })),
  'gitlab: list open merge requests (self-hosted)': () => withExec([['mr list', []]], (exec) => backlog().fetchOpenPullRequests({ platform: 'gitlab', repo: GLS, exec })),
  'github: view a pull request': () => withExec([['pr view', GH_PR_VIEW]], (reader) => runPr().fetchPrState({ url: 'https://github.com/o/r/pull/40' }, { reader: async (c, a) => JSON.parse(await reader(c, a)) })),
  'gitlab: view a merge request': () => withExec([['mr view', GL_MR_VIEW]], (reader) => runPr().fetchPrState({ url: 'https://gitlab.com/g/sub/p/-/merge_requests/8' }, { reader: async (c, a) => JSON.parse(await reader(c, a)) })),
  'github: parse request and run URLs': () => pure(() => ['https://github.com/o/r/pull/40', 'https://ghe.example.com/o/r/actions/runs/99/job/1', 'https://github.com/o/r/issues/3'].map((u) => probes().parseTarget(u))),
  'gitlab: parse request and pipeline URLs': () => pure(() => ['https://gitlab.com/g/sub/p/-/merge_requests/8', 'https://git.example.com:8443/g/p/-/pipelines/5?x=1'].map((u) => probes().parseTarget(u))),

  // ---- epics and sub-issues
  'github: typed epics': () => withExec([['issues?state=all', '5 9\n']], async (exec) => sorted(await epics().typedEpics({ platform: 'github', repo: GH, exec }))),
  'github: typed epics (self-hosted)': () => withExec([['issues?state=all', '']], async (exec) => sorted(await epics().typedEpics({ platform: 'github', repo: GHE, exec }))),
  'github: read epics (sub-issues)': () => withExec([
    ['issues?state=all', ''],
    ['sub_issues', [{ number: 12, repository_url: 'https://api.github.com/repos/o/r' }, { number: 99, repository_url: 'https://api.github.com/repos/x/y' }]],
  ], (exec) => epics().readEpics({ platform: 'github', repo: GH, issues: [{ number: 5, title: 'The epic', url: GH_EPIC.url, state: 'open', labels: [{ name: 'epic' }] }, { number: 12, title: 'Fix', url: GH_ISSUE.url, state: 'open', labels: [] }], exec })),
  'gitlab: read epics (group epics and labels)': () => withExec([], async (exec) => {
    const issues = (await backlog().fetchIssues({ platform: 'gitlab', repo: GL, exec: async () => JSON.stringify([GL_ISSUE, GL_EPIC_ISSUE]) }));
    return epics().readEpics({ platform: 'gitlab', repo: GL, issues, exec });
  }),
  'github: new epic with members (preview)': () => withExec([], (exec) => epics().applyEpic({ platform: 'github', repo: GHE, epic: { title: 'Speed', goal: 'Faster' }, issues: [12, 13], preview: true, exec })),
  'github: new epic with members': () => withExec([
    ['label list', [{ name: 'bug' }]],
    ['issue create', 'https://github.com/o/r/issues/77\n'],
    ['repos/o/r/issues/12 ', '1012'],
  ], (exec) => epics().applyEpic({ platform: 'github', repo: GH, epic: { title: 'Speed', goal: 'Faster' }, issues: [12], exec })),
  'gitlab: new label epic with members (preview)': () => withExec([], (exec) => epics().applyEpic({ platform: 'gitlab', repo: GL, epic: { title: 'Speed', goal: 'Faster' }, issues: [7], preview: true, exec })),
  'gitlab: new group epic with members': () => withExec([
    ['groups/44/epics', { iid: 4, web_url: 'https://gitlab.com/groups/g/-/epics/4' }],
    ['projects/', { id: 7007 }],
  ], (exec) => epics().applyEpic({ platform: 'gitlab', repo: GLS, epic: { title: 'Speed' }, issues: [7], epics: [{ id: '&3', kind: 'group', groupId: 44, iid: 3, title: 'Group epic' }], exec })),
  'gitlab: existing label epic, new member': () => withExec([], (exec) => epics().applyEpic({ platform: 'gitlab', repo: GL, epic: { id: '#9' }, issues: [7], epics: [{ id: '#9', number: 9, kind: 'label', slug: 'export', title: 'Export' }], exec })),

  // ---- the Oracle's read tools
  'github: search issues': () => pure(() => [oracle().searchCommand({ platform: 'github', target: 'o/r', query: 'login', state: 'all' }), oracle().searchCommand({ platform: 'github', target: 'o/r' })]),
  'gitlab: search issues': () => pure(() => [oracle().searchCommand({ platform: 'gitlab', target: 'g/sub/p', query: 'export', state: 'closed' }), oracle().searchCommand({ platform: 'gitlab', target: 'g/sub/p' })]),
  'github: oracle view an issue': () => pure(() => oracle().viewCommand({ platform: 'github', target: 'o/r', number: 12 })),
  'gitlab: oracle view an issue': () => pure(() => oracle().viewCommand({ platform: 'gitlab', target: 'g/sub/p', number: 7 })),
  'github: oracle labels': () => pure(() => oracle().labelsCommand({ platform: 'github', target: 'o/r' })),
  'gitlab: oracle labels': () => pure(() => oracle().labelsCommand({ platform: 'gitlab', target: 'g/sub/p' })),
  'github: oracle parses search, view and labels': () => pure(() => [oracle().searchResult(JSON.stringify([GH_ISSUE])), oracle().viewResult(JSON.stringify({ ...GH_ISSUE, comments: [{}, {}] })), oracle().labelsResult(JSON.stringify([{ name: 'bug', description: 'A bug' }, { name: 'epic' }]))]),
  'gitlab: oracle parses search, view and labels': () => pure(() => [oracle().searchResult(JSON.stringify([GL_ISSUE])), oracle().viewResult(JSON.stringify(GL_ISSUE)), oracle().labelsResult(JSON.stringify([{ name: 'bug', description: '' }]))]),
};

async function recordAll() {
  const out = {};
  for (const [name, run] of Object.entries(CASES)) out[name] = await run();
  return out;
}

module.exports = { CASES, recordAll };
