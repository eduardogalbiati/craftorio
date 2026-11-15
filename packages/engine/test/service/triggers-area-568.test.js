// #568 the platform triggers' service area (packages/engine/service/areas/triggers.js) with a mocked ctx
// and a faked `gh` (issues.execCli, the system boundary): a rule naming a repository workflow not accepted
// at HEAD is refused and starts nothing; an issue event's run gets its issue (`issues:`), a PR comment's
// none; the run's meta.json gets `trigger`; the issue or PR is commented once, when the run reaches its
// first human gate or ends, never under MULTIAGENT_SIMULATION_ONLY=1.
// Seams: the area's triggersStatus and watchTriggers (driven by its timer, mocked), the files it writes.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const workspace = require('../../domains/workspace/workspace');
const issues = require('../../domains/backlog/issues');
const loadArea = () => require('../../service/areas/triggers');

const ID = 'acme-app';
const LABEL_RULE = { on: 'issue_labeled', label: 'ready', workflow: 'feature', inputs: { issues: ['{{ event.issue.number }}'] } };
const COMMENT_RULE = { on: 'pr_comment', mention: '@orchestrator', workflow: 'fix', inputs: {} };
const BUILTIN = { workflows: [{ name: 'feature' }, { name: 'fix' }], triggers: [LABEL_RULE, COMMENT_RULE], triggerErrors: [], refusedTriggers: [] };

const FUTURE = '2099-01-01T00:00:00Z';
const LABELED = { id: 9001, event: 'labeled', label: { name: 'ready' }, created_at: FUTURE, issue: { number: 42, html_url: 'https://github.com/acme/app/issues/42' } };
const MENTION = { id: 5001, body: 'hey @orchestrator, fix the lint', html_url: 'https://github.com/acme/app/pull/7#issuecomment-5001', issue_url: 'https://api.github.com/repos/acme/app/issues/7', created_at: FUTURE, user: { login: 'eduardo' } };

function simulationOnly(t, value) {
  const before = process.env.MULTIAGENT_SIMULATION_ONLY;
  if (value == null) delete process.env.MULTIAGENT_SIMULATION_ONLY; else process.env.MULTIAGENT_SIMULATION_ONLY = value;
  t.after(() => { if (before === undefined) delete process.env.MULTIAGENT_SIMULATION_ONLY; else process.env.MULTIAGENT_SIMULATION_ONLY = before; });
}

// a workspace with project acme-app (GitHub), its triggers on, a fake gh and a ctx recording the starts
function setup(t, { manifest = BUILTIN, items = [], issueEvents = [], comments = [], gate = null, sim = null, slot = null, budget = null } = {}) {
  simulationOnly(t, sim);
  t.mock.method(console, 'error', () => {});
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'triggers-area-568-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const ws = workspace.setupWorkspace(path.join(dir, 'ws'), { persist: false });
  fs.writeFileSync(path.join(ws.projects, `${ID}.json`), JSON.stringify({ name: ID, folder: path.join(dir, 'repo'), repo: 'https://github.com/acme/app' }));
  workspace.writeSettings(ws, { triggers: { enabled: { [ID]: true }, intervalMinutes: 2 } });

  const cli = [];
  t.mock.method(issues, 'execCli', async (name, args) => {
    cli.push([name, ...args]);
    if (args[0] !== 'api') return '';
    if (args[1].includes('/issues/events')) return JSON.stringify(issueEvents);
    if (args[1].includes('/issues/comments')) return JSON.stringify(comments);
    if (args[1].includes('/actions/runs')) return JSON.stringify({ total_count: 0, workflow_runs: [] });
    return '[]';
  });

  const runsRoot = path.join(dir, 'runs');
  const runFolder = (runId) => path.join(runsRoot, runId);
  const starts = [];
  const ctx = {
    ws,
    headManifest: () => ({ head: 'abc123', manifest }),
    repositoryWorkflows: () => ({ items }),
    budgetBlock: () => budget,
    slotProblem: () => slot,
    runFolder,
    startWorkflowRun: async (opts) => {
      starts.push(opts);
      const runId = `run-${starts.length}`;
      const runDir = runFolder(runId);
      fs.mkdirSync(runDir, { recursive: true });
      if (gate) fs.writeFileSync(path.join(runDir, 'events.jsonl'), `${JSON.stringify(gate)}\n`);
      return { runId, runDir };
    },
  };
  const area = loadArea()(ctx);
  t.after(() => area.stopTriggers());
  const reportsFile = path.join(ws.backlog, 'triggers', `${ID}.reports.json`);
  return { ws, area, cli, starts, runFolder, reportsFile };
}

const flush = async () => { for (let i = 0; i < 50; i++) await new Promise((r) => setImmediate(r)); };

// one tick of the area's timer
async function tick(t, area, { first = true } = {}) {
  if (first) {
    t.mock.timers.enable({ apis: ['setInterval'] });
    area.watchTriggers();
  }
  t.mock.timers.tick(30000);
  await flush();
}

const comments = (cli) => cli.filter((c) => c[1] !== 'api');
const apiCalls = (cli) => cli.filter((c) => c[1] === 'api');

test('#568 a rule naming a repository workflow not accepted at HEAD is refused with its problem', (t) => {
  const manifest = { workflows: [{ name: 'feature' }, { name: 'deploy', file: '.multiagent/workflows/deploy.yaml' }], triggers: [LABEL_RULE, { on: 'ci_failed', branch: 'main', workflow: 'deploy', inputs: {} }], triggerErrors: [], refusedTriggers: [] };
  const { area } = setup(t, { manifest, items: [{ file: 'deploy.yaml', accepted: false }] });
  const s = area.triggersStatus({ projectId: ID });
  assert.deepEqual(s.rules.map((r) => r.workflow), ['feature']);
  assert.deepEqual(s.refused.map((r) => [r.on, r.branch, r.workflow]), [['ci_failed', 'main', 'deploy']]);
  assert.match(s.refused[0].problem, /not accepted/);
  assert.equal(s.problems.length, 1);
});

test('#568 a rule naming an accepted repository workflow is kept', (t) => {
  const manifest = { workflows: [{ name: 'deploy', file: '.multiagent/workflows/deploy.yaml' }], triggers: [{ on: 'ci_failed', branch: 'main', workflow: 'deploy', inputs: {} }], triggerErrors: [], refusedTriggers: [] };
  const { area } = setup(t, { manifest, items: [{ file: 'deploy.yaml', accepted: true }] });
  const s = area.triggersStatus({ projectId: ID });
  assert.deepEqual([s.rules.length, s.refused.length], [1, 0]);
});

test('#568 a project whose only rule is refused is never polled and starts nothing', async (t) => {
  const manifest = { workflows: [{ name: 'deploy', file: '.multiagent/workflows/deploy.yaml' }], triggers: [{ on: 'issue_labeled', label: 'ready', workflow: 'deploy', inputs: {} }], triggerErrors: [], refusedTriggers: [] };
  const { area, cli, starts } = setup(t, { manifest, items: [{ file: 'deploy.yaml', accepted: false }], issueEvents: [LABELED] });
  await tick(t, area);
  assert.equal(apiCalls(cli).length, 0);
  assert.equal(starts.length, 0);
});

test('#568 the status reports the owner\'s switch and the interval from Settings', (t) => {
  const { area } = setup(t);
  const s = area.triggersStatus({ projectId: ID });
  assert.deepEqual([s.enabled, s.intervalMs], [true, 120000]);
});

test('#568 an issue labelled starts its run with the issue recorded and the trigger in meta.json', async (t) => {
  const { area, starts, runFolder } = setup(t, { issueEvents: [LABELED] });
  await tick(t, area);
  assert.equal(starts.length, 1);
  assert.equal(starts[0].file, 'feature.yaml');
  assert.equal(starts[0].projectId, ID);
  assert.equal(starts[0].mock, false);
  assert.deepEqual(starts[0].issues.map((i) => [i.number, i.url]), [[42, 'https://github.com/acme/app/issues/42']]);
  const meta = JSON.parse(fs.readFileSync(path.join(runFolder('run-1'), 'meta.json'), 'utf8'));
  assert.deepEqual(meta.trigger, { kind: 'issue_labeled', id: 'gh:labeled:9001', url: 'https://github.com/acme/app/issues/42' });
});

test('#568 a PR comment starts its run with no issue recorded', async (t) => {
  const { area, starts } = setup(t, { comments: [MENTION] });
  await tick(t, area);
  assert.equal(starts.length, 1);
  assert.equal(starts[0].file, 'fix.yaml');
  assert.equal(Array.isArray(starts[0].issues) && starts[0].issues.length > 0, false);
});

test('#568 a busy slot holds the event: no run now, nothing reported', async (t) => {
  const { area, starts, cli } = setup(t, { issueEvents: [LABELED], slot: 'all slots busy' });
  await tick(t, area);
  assert.equal(starts.length, 0);
  assert.equal(comments(cli).length, 0);
});

test('#568 the day\'s budget cap holds a real start', async (t) => {
  const { area, starts } = setup(t, { issueEvents: [LABELED], budget: 'daily budget reached' });
  await tick(t, area);
  assert.equal(starts.length, 0);
});

test('#568 the issue is commented once, with the run id and the human gate it reached', async (t) => {
  const gate = { type: 'approval.requested', step_id: 'human_approval', approval_id: 'a1' };
  const { area, cli, reportsFile } = setup(t, { issueEvents: [LABELED], gate });
  await tick(t, area);
  await tick(t, area, { first: false });
  const sent = comments(cli);
  assert.equal(sent.length, 1);
  assert.deepEqual(sent[0].slice(0, 6), ['gh', 'issue', 'comment', '42', '--repo', 'acme/app']);
  const body = fs.readFileSync(sent[0][sent[0].indexOf('--body-file') + 1], 'utf8');
  assert.match(body, /run-1/);
  assert.match(body, /human_approval/);
  assert.deepEqual(JSON.parse(fs.readFileSync(reportsFile, 'utf8')), []);
});

test('#568 the PR is commented through gh pr comment when the run ends', async (t) => {
  const gate = { type: 'workflow.finished', status: 'done' };
  const { area, cli } = setup(t, { comments: [MENTION], gate });
  await tick(t, area);
  const sent = comments(cli);
  assert.equal(sent.length, 1);
  assert.deepEqual(sent[0].slice(0, 6), ['gh', 'pr', 'comment', '7', '--repo', 'acme/app']);
});

test('#568 a run still going keeps its report pending, sent once it reaches a gate', async (t) => {
  const { area, cli, runFolder, reportsFile } = setup(t, { issueEvents: [LABELED] });
  await tick(t, area);
  assert.equal(comments(cli).length, 0);
  const pending = JSON.parse(fs.readFileSync(reportsFile, 'utf8'));
  assert.deepEqual(pending.map((r) => [r.runId, r.kind, r.number]), [['run-1', 'issue_labeled', 42]]);
  fs.writeFileSync(path.join(runFolder('run-1'), 'events.jsonl'), `${JSON.stringify({ type: 'approval.requested', step_id: 'human_approval' })}\n`);
  await tick(t, area, { first: false });
  await tick(t, area, { first: false });
  assert.equal(comments(cli).length, 1);
});

test('#568 under simulation-only the platform is never read nor written and pending reports are dropped', async (t) => {
  const { area, cli, starts, reportsFile, runFolder } = setup(t, { issueEvents: [LABELED], sim: '1' });
  fs.mkdirSync(path.dirname(reportsFile), { recursive: true });
  fs.writeFileSync(reportsFile, JSON.stringify([{ runId: 'run-old', workflow: 'feature', kind: 'issue_labeled', number: 42 }]));
  fs.mkdirSync(runFolder('run-old'), { recursive: true });
  fs.writeFileSync(path.join(runFolder('run-old'), 'events.jsonl'), `${JSON.stringify({ type: 'approval.requested', step_id: 'human_approval' })}\n`);
  await tick(t, area);
  assert.equal(cli.length, 0);
  assert.equal(starts.length, 0);
  assert.deepEqual(JSON.parse(fs.readFileSync(reportsFile, 'utf8')), []);
});
