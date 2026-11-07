// Screenshot seed of the PRs / MRs screen (--view pulls, #812): the demo project's open pull requests, read through
// the engine's own run-pr.js listPulls and its grouping (only gh's answers are demo data, no gh call): Need you
// (#41 ready, #39 changes requested, #37 a conflict), Waiting (a two-PR stack #44 / #45, CI running, Merge on #44
// only; #42 waiting for someone's review) and Others (#2 from Dependabot, #192 with no run and a long title). The
// PRs a run opened get their run (a finished run whose pr step output names the PR: the "Open the run" link).
// --mode empty: no open pull request (the empty state). --mode error: the project cannot be read (gh's error).
// A phone: --size 390x844.

const { DEMO_REPO, writeEvents } = require('../helpers');

const pr = (number) => `${DEMO_REPO}/pull/${number}`;
const ok = (name) => ({ __typename: 'CheckRun', name, status: 'COMPLETED', conclusion: 'SUCCESS' });
const running = (name) => ({ __typename: 'CheckRun', name, status: 'IN_PROGRESS', conclusion: '' });
const review = (login, state) => ({ author: { login }, state });

// gh pr list --json's entries: [number, title, author, head, base, fields]
const DEMO_PULLS = [
  [41, 'Survive a renamed workspace folder', 'developer', 'fix/workspace-rename', 'main', { mergeable: 'MERGEABLE', mergeStateStatus: 'CLEAN', reviewDecision: 'APPROVED', latestReviews: [review('ana', 'APPROVED')], statusCheckRollup: [ok('unit'), ok('e2e')] }],
  [39, 'Export the run report as Markdown', 'developer', 'feat/run-report-md', 'main', { mergeable: 'MERGEABLE', mergeStateStatus: 'BLOCKED', reviewDecision: 'CHANGES_REQUESTED', latestReviews: [review('ana', 'CHANGES_REQUESTED')], statusCheckRollup: [ok('unit'), ok('e2e')] }],
  [37, 'Document the workflow YAML', 'developer', 'docs/workflow-yaml', 'main', { mergeable: 'CONFLICTING', mergeStateStatus: 'DIRTY', reviewDecision: '', latestReviews: [], statusCheckRollup: [ok('unit')] }],
  [44, 'Roadmap stages: the data model', 'developer', 'stack/roadmap-model', 'main', { mergeable: 'MERGEABLE', mergeStateStatus: 'UNSTABLE', reviewDecision: '', latestReviews: [], statusCheckRollup: [ok('unit'), running('e2e')] }],
  [45, 'Roadmap stages: the screen', 'developer', 'stack/roadmap-screen', 'stack/roadmap-model', { mergeable: 'MERGEABLE', mergeStateStatus: 'UNSTABLE', reviewDecision: '', latestReviews: [], statusCheckRollup: [running('unit')] }],
  [42, 'Keep the computer awake while a run works', 'developer', 'feat/keep-awake', 'main', { mergeable: 'MERGEABLE', mergeStateStatus: 'BLOCKED', reviewDecision: 'REVIEW_REQUIRED', latestReviews: [], statusCheckRollup: [ok('unit'), ok('e2e')] }],
  [2, 'Bump electron from 38.1.0 to 38.2.1', 'app/dependabot', 'dependabot/npm_and_yarn/electron-38.2.1', 'main', { mergeable: 'MERGEABLE', mergeStateStatus: 'CLEAN', reviewDecision: '', latestReviews: [], statusCheckRollup: [ok('unit'), ok('e2e')] }],
  [192, 'Try a second layout for the settings screen with the provider accounts grouped by machine and a search box', 'developer', 'spike/settings-layout', 'main', { mergeable: 'MERGEABLE', mergeStateStatus: 'BLOCKED', reviewDecision: 'REVIEW_REQUIRED', latestReviews: [], statusCheckRollup: [] }],
].map(([number, title, login, headRefName, baseRefName, rest]) => ({ number, title, url: pr(number), author: { login }, isDraft: false, headRefName, baseRefName, state: 'OPEN', ...rest }));
const WITH_RUN = [41, 39, 37, 44, 45, 42];

// a finished run whose pr step opened `number` (run-pr.js prOfEvents: the step's output pr_url)
function demoRun(ws, projectId, number, i) {
  const runId = `20260120-${String(100000 + i * 1500).padStart(6, '0')}-pull${String(number).padStart(4, '0')}`;
  const start = Date.parse('2026-01-20T10:00:00.000Z') + i * 15 * 6e4;
  const at = (m) => new Date(start + m * 6e4).toISOString();
  writeEvents(`${ws.runs}/${runId}`, runId, [
    { ts: at(0), type: 'workflow.started', workflow: 'software-development', file: 'software-development.yaml', project_id: projectId, mock: false, inputs: { task: DEMO_PULLS.find((p) => p.number === number).title } },
    { ts: at(1), type: 'step.started', step_id: 'pr', step_type: 'agent', agent: 'developer' },
    { ts: at(9), type: 'step.finished', step_id: 'pr', duration_ms: 8 * 6e4, output: { pr_url: pr(number), pr_number: number } },
    { ts: at(10), type: 'workflow.finished', status: 'success', summary: { cost_usd: 1.2, duration_ms: 10 * 6e4 } },
  ]);
}

// gh's answers: the list, and the repository's permissions (the account may merge, not bypass)
function demoReader(mode) {
  return async (_cli, args = []) => {
    if (args[0] === 'pr' && args[1] === 'list') {
      if (mode === 'error') throw new Error('HTTP 401: Bad credentials (https://api.github.com/graphql). Try authenticating with: gh auth login');
      return mode === 'empty' ? [] : DEMO_PULLS;
    }
    if (args[0] === 'api' && args.some((a) => /^repos\/[^/]+\/[^/]+$/.test(a))) return { permissions: { push: true, admin: false } };
    return {};
  };
}

function seed({ ws, project, src, args }) {
  let runPr;
  try { runPr = src('domains/run/run-pr'); } catch (e) { if (e.code === 'MODULE_NOT_FOUND') return; throw e; }
  if (typeof runPr.listPulls !== 'function') return; // an app before #812
  if (!args.mode) WITH_RUN.forEach((n, i) => demoRun(ws, project.id, n, i));
  // the service's area calls runPr.listPulls at each read: the demo reader stands in for gh (one wrapper at a time)
  const real = runPr.listPulls.real || runPr.listPulls;
  const demo = (list, opts = {}) => real(list, { ...opts, reader: demoReader(args.mode), hasCli: () => true });
  demo.real = real;
  runPr.listPulls = demo;
}

module.exports = {
  modes: ['empty', 'error'],
  seed,
};
