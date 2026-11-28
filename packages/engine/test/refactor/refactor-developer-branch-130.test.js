// #130: refactor.yaml's developer works in the step `refactor` (no `develop` step), and its Remote / Fork + PR modes
// end through fragments/pr-pipeline.yaml. What reads "the developer's branch" must find refactor's:
// - the #116 commit check runs after a writing `refactor` step too (detached / uncommitted fails "did not commit",
//   a committed one records the worktree's real branch);
// - the PR monitor's fix round recreates a removed worktree on the refactor step's branch (pr-fix.js);
// - the pr-pipeline prompts of refactor.yaml (ci, its CI-failure delegate, pr_monitor's fix delegate) name the
//   refactor step's branch.
// Seams: mock runs of a small workflow in throwaway repositories (worktree-helpers.js, as develop-commit-116),
// the run's transition methods with a fake run (as run/pr-fix-811), the loaded workflow's templates rendered.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const yaml = require('js-yaml');
const { fixture, git, commit } = require('../worktree-helpers');
const { tempWorkflow } = require('../engine-helpers');
const { WorkflowRun, loadWorkflow } = require('../../engine/workflow');
const { render } = require('../../engine/run/templates');

const ROOT = path.join(__dirname, '..', '..', '..', '..');
const LIMIT = { timeout: 90000 };

// ---- #116 commit check on the `refactor` step -----------------------------------------------------------

const WORKFLOW = [
  'apiVersion: craftorio/v1',
  'kind: Workflow',
  'metadata:',
  '  name: fixture-refactor-130',
  'inputs:',
  '  repo_path: { type: string, required: true }',
  '  base_branch: { type: string, default: main }',
  'orchestrator:',
  '  worktree:',
  '    repo: "{{ inputs.repo_path }}"',
  '    base: "{{ inputs.base_branch }}"',
  'providers:',
  '  ai: { type: claude-code, command: claude }',
  'defaults:',
  '  working_dir: "{{ worktree_dir }}"',
  'agents:',
  '  developer: { provider: ai, model: m, session: ephemeral, capabilities: { tools: [read, edit, write, bash:git] } }',
  '  reviewer: { provider: ai, model: m, session: ephemeral, capabilities: { tools: [read, bash:git] } }',
  'steps:',
  '  - id: refactor',
  '    agent: developer',
  '    prompt: "Refactor the code in {{ worktree_dir }}."',
  '    output_schema: { type: object, required: [branch, committed, summary], properties: { branch: { type: string }, committed: { type: boolean }, summary: { type: string } } }',
  '  - id: review',
  '    agent: reviewer',
  '    prompt: "Review the change."',
  '',
].join('\n');

async function runRefactor(t, onRefactor = () => {}) {
  const f = fixture(t, 'canonical');
  const { file } = tempWorkflow(t, WORKFLOW);
  const run = new WorkflowRun({ file, inputs: { repo_path: f.repo }, mock: true, runsDir: path.join(f.tmp, 'runs'), worktreesDir: f.worktrees, skillsDirs: [] });
  const events = [];
  let dir = null;
  run.on('event', (ev) => {
    events.push(ev);
    if (ev.type === 'worktree.ready') dir = ev.work_dir || ev.dir;
    if (ev.type === 'session.message_sent' && String(ev.step_id).split(':')[0] === 'refactor') onRefactor(dir);
    if (ev.type === 'approval.requested') setImmediate(() => run.resolveApproval(ev.approval_id, false));
  });
  await run.start();
  const finished = events.find((e) => e.type === 'workflow.finished');
  const ran = (id) => events.some((e) => e.type === 'session.message_sent' && String(e.step_id).split(':')[0] === id);
  const said = JSON.stringify(events.filter((e) => e.type !== 'session.message_sent'));
  return { events, finished, ran, said };
}

test('#130 a refactor step that leaves the worktree detached with its change uncommitted fails with "did not commit"', LIMIT, async (t) => {
  const r = await runRefactor(t, (d) => fs.writeFileSync(path.join(d, 'dirty-130.txt'), 'the change\n'));
  assert.equal(r.finished?.status, 'failed');
  assert.match(r.said, /did not commit/i);
  assert.equal(r.ran('review'), false, 'nothing after refactor runs');
});

test('#130 a refactor step that makes the branch but leaves files uncommitted fails and names what is uncommitted', LIMIT, async (t) => {
  const r = await runRefactor(t, (d) => {
    git(d, 'switch', '-q', '-c', 'refactor/half-130');
    commit(d, 'done-130.txt', 'committed\n');
    fs.writeFileSync(path.join(d, 'dirty-130.txt'), 'left out\n');
  });
  assert.equal(r.finished?.status, 'failed');
  assert.match(r.said, /did not commit/i);
  assert.match(r.said, /dirty-130\.txt|uncommitted/i);
  assert.equal(r.ran('review'), false);
});

test('#130 a refactor step that commits on a branch goes on, and its output carries the worktree\'s real branch', LIMIT, async (t) => {
  const r = await runRefactor(t, (d) => {
    git(d, 'switch', '-q', '-c', 'refactor/real-130');
    commit(d, 'done-130.txt', 'committed\n');
  });
  assert.equal(r.finished?.status, 'success', r.finished?.error);
  assert.equal(r.ran('review'), true);
  const done = r.events.filter((e) => e.type === 'step.finished' && String(e.step_id).split(':')[0] === 'refactor').at(-1);
  assert.equal(done?.output?.branch, 'refactor/real-130');
});

// ---- the PR monitor's fix round in a refactor run (pr-fix.js) ------------------------------------------

const PR = { url: 'https://github.com/acme/widgets/pull/13', number: 13 };
const REFACTOR_BRANCH = 'refactor/130-split-handler';
const REQUESTS = [{ id: 't1', kind: 'comment', author: 'alice', file: 'src/a.js', line: 3, url: `${PR.url}#discussion_r1`, body: 'Rename it.', trusted: true }];
const monitorStep = () => ({ ...(yaml.load(fs.readFileSync(path.join(ROOT, 'fragments', 'pr-pipeline.yaml'), 'utf8')).steps?.pr_monitor || {}), id: 'pr_monitor' });

// a refactor run waiting on its PR: only `steps.refactor` answered; the worktree knows its folder, not its branch
function fakeRefactorRun(worktreeDir) {
  const step = monitorStep();
  const sim = { head: 'h1', n: 0 };
  const seen = { events: [], agents: [], setups: [] };
  const output = { pr_url: PR.url, pr_number: PR.number, conflict: false, ci_status: 'success' };
  const transitions = require('../../engine/run/transitions');
  const run = {
    ...transitions.methods,
    runId: 'run-130',
    wf: { steps: [step], agents: { developer: {} } },
    ctx: { inputs: { mode: 'remote', base_branch: 'main' }, steps: { refactor: { output: { branch: REFACTOR_BRANCH, summary: 'split the handler' } }, ci: { output } }, vars: {}, worktree_dir: worktreeDir },
    worktree: { dir: worktreeDir, workDir: worktreeDir, repo: os.tmpdir() },
    inputs: {},
    probeStats: {},
    counters: {},
    loops: {},
    abort: new AbortController(),
    machine: { transitionFault: () => {}, simulated: false },
    orchestrator: {},
    setStatus: () => {},
    emitEvent: (type, data) => seen.events.push({ type, ...data }),
    probe: async () => ({
      state: 'open', detail: 'open', head: sim.head, ci: { status: 'passed', failed: [] }, review: { status: 'changes_requested', by: ['alice'] },
      conflicts: { status: 'none' }, comments: { unanswered: 1 }, result: { ready: false, blockers: ['changes requested'] }, requests: REQUESTS,
    }),
    sendToAgent: async (agent, prompt, opts = {}) => {
      seen.agents.push({ agent, prompt: String(prompt) });
      sim.head = `h${++sim.n + 1}`;
      run.emitEvent('session.message_received', { session_id: 's1', turn: seen.agents.length, step_id: opts.stepId || null, text: 'Renamed, pushed h2.', usage: { input_tokens: 1, output_tokens: 1 } });
      return { text: 'Renamed, pushed h2.', usage: { input_tokens: 1, output_tokens: 1 } };
    },
    requestApproval: async () => ({ answer: 'rejected' }),
    setupWorktree: async (opts) => {
      seen.setups.push(opts?.again?.branch ?? null);
      fs.mkdirSync(run.worktree.dir, { recursive: true });
    },
    runAction: async () => {},
    loopWait: async (s) => s.id,
    stepAttachments: () => [],
    stopWorktreeProcesses: async () => {},
    notePreexistingFailures: () => {},
    recordEvidence: () => {},
    recordStall: () => {},
    saveScenarios: () => {},
    logDecisions: () => {},
    recordDecisions: () => {},
  };
  return { run, step, seen };
}

test('#130 PR monitor fix round in a refactor run: a removed worktree is recreated on the refactor step\'s branch, and the developer is told that branch', async () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'pr-fix-130-'));
  try {
    const f = fakeRefactorRun(path.join(base, 'removed'));
    const st = {};
    await f.run.pollPrMonitor(f.step, st);
    await f.run.prFixFromApp({ prompt: 'Rename it.', ids: ['t1'], note: '', by: 'owner' });
    for (let i = 0; i < 4 && f.seen.agents.length === 0; i++) await f.run.pollPrMonitor(f.step, st);
    const p = f.seen.agents[0]?.prompt || '';
    assert.deepEqual(f.seen.setups, [REFACTOR_BRANCH], 'the worktree is recreated on the refactor branch');
    assert.equal(p.includes(`\`${REFACTOR_BRANCH}\``), true, p);
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});

// ---- refactor.yaml's pr-pipeline prompts name the refactor branch ---------------------------------------

const ctxFor = (mode) => ({
  inputs: { mode, base_branch: 'main', issue: '', parent_pr: '', parent_branch: '', depends_on: '', git_platform: 'github' },
  steps: { refactor: { output: { branch: REFACTOR_BRANCH, summary: 'Split the click handler' } } },
  vars: {},
  output: { pr_number: 13, failure_log: 'test x failed', url: PR.url, fix_prompt: 'Rename it.', detail: '' },
});

for (const mode of ['remote', 'fork']) {
  test(`#130 refactor.yaml (${mode}): the ci step's goal and prompt name the refactor step's branch and summary`, () => {
    const ci = loadWorkflow(path.join(ROOT, 'workflows', 'refactor.yaml')).steps.find((s) => s.id === 'ci');
    assert.equal(!!ci, true, 'refactor.yaml has the ci step');
    const prompt = render(ci.prompt, ctxFor(mode));
    const goal = render(ci.goal?.description || '', ctxFor(mode));
    assert.equal(goal.includes(REFACTOR_BRANCH), true, goal);
    assert.equal(prompt.includes(`\`${REFACTOR_BRANCH}\``), true, prompt);
    assert.equal(prompt.includes('Split the click handler'), true, 'the PR summary is the refactor step\'s');
    assert.equal(prompt.includes('``'), false, 'no empty branch');
  });
}

test('#130 refactor.yaml: the CI-failure delegate and the PR monitor\'s fix delegate name the refactor step\'s branch', () => {
  const wf = loadWorkflow(path.join(ROOT, 'workflows', 'refactor.yaml'));
  const delegates = ['ci', 'pr_monitor'].map((id) => (wf.steps.find((s) => s.id === id)?.transitions || []).find((t) => t.delegate?.agent === 'developer'));
  const texts = delegates.map((d) => render(d?.delegate?.prompt || '', ctxFor('remote')));
  assert.deepEqual(texts.map((x) => x.includes(`\`${REFACTOR_BRANCH}\``)), [true, true], texts.join('\n---\n'));
});
