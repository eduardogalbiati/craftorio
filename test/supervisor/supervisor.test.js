// The AI supervisor: in-run recovery decisions validated by the engine, and resuming runs.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { WorkflowRun } = require('../../src/engine/workflow');
const supervisor = require('../../src/domains/supervisor/supervisor');

process.env.MULTIAGENT_MOCK_DELAY_SCALE = '0.02';
process.env.MULTIAGENT_SIMULATION_ONLY = '1'; // tests never call real models
const SKILLS_DIR = path.join(__dirname, '..', '..', 'skills'); // the bundled run-supervisor skill

const WF = `
apiVersion: multiagent/v1
kind: Workflow
metadata: { name: fixture-supervisor }
orchestrator:
  provider: claude
  model: m
  supervisor: { enabled: true, max_interventions: 2 }
providers:
  claude: { type: claude-code, command: claude }
agents:
  a: { provider: claude, model: m, session: ephemeral }
steps:
  - id: check
    agent: a
    on_error: after
    prompt: "check"
    output_schema:
      type: object
      required: [verdict]
      properties: { verdict: { type: string, enum: [pass, issues] } }
  - id: after
    agent: a
    prompt: "after: {{ steps.check.output.verdict or steps.check.output.error }}"
`;

function makeRun(t, opts = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sup-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'wf.yaml');
  fs.writeFileSync(file, WF);
  return new WorkflowRun({ file, inputs: {}, mock: true, runsDir: path.join(dir, 'runs'), ...opts });
}

// Replaces the agents' answers: `check` answers with `checkText`, the supervisor with the given decisions in order.
function script(run, { checkText, decisions }) {
  const calls = { check: 0, supervisor: [] };
  run.sendToAgent = async (agent, prompt) => {
    if (agent === 'supervisor') {
      calls.supervisor.push(prompt);
      const d = decisions.shift() || { explanation: 'give up', action: 'fail' };
      return { text: '```json\n' + JSON.stringify(d) + '\n```' };
    }
    if (prompt.startsWith('check') || prompt.includes('\ncheck')) calls.check++;
    calls.lastPrompt = prompt;
    return { text: typeof checkText === 'function' ? checkText(prompt) : checkText };
  };
  return calls;
}

async function run(r) {
  const events = [];
  r.on('event', (e) => events.push(e));
  await r.start();
  return { events, finished: events.find((e) => e.type === 'workflow.finished') };
}

test('fix_output: an output rebuilt from the answer is accepted when it matches the schema', async (t) => {
  const r = makeRun(t);
  const calls = script(r, { checkText: 'The document is fine. (no json)', decisions: [{ explanation: 'The answer says fine', action: 'fix_output', output: { verdict: 'pass' } }] });
  const { events, finished } = await run(r);
  assert.equal(finished.status, 'success', finished.error);
  assert.deepEqual(finished.summary.steps.check.output, { verdict: 'pass' });
  assert.equal(calls.supervisor.length, 1);
  assert.match(calls.supervisor[0], /The document is fine/); // the agent's answer is in the supervisor's context
  assert.match(calls.supervisor[0], /goto: continue at one of these steps: check, after/);
  const d = events.find((e) => e.type === 'supervisor.decision');
  assert.equal(d.action, 'fix_output');
});

test('an invalid fixed output becomes a retry, and the instruction reaches the agent', async (t) => {
  const r = makeRun(t);
  // the agent only gets it right once it receives the supervisor's instruction
  const calls = script(r, {
    checkText: (prompt) => (prompt.includes('End with the json block.') ? '```json\n{"verdict":"issues"}\n```' : 'no json'),
    decisions: [{ explanation: 'bad', action: 'fix_output', output: { verdict: 'fail' }, instruction: 'End with the json block.' }],
  });
  const { events, finished } = await run(r);
  assert.equal(finished.status, 'success', finished.error);
  assert.deepEqual(finished.summary.steps.check.output, { verdict: 'issues' });
  assert.match(calls.lastPrompt, /after: issues/);
  const d = events.find((e) => e.type === 'supervisor.decision');
  assert.equal(d.action, 'retry');
  assert.match(d.note, /fixed output rejected/);
  assert.ok(events.filter((e) => e.type === 'step.started' && e.step_id === 'check').length === 2);
});

test('the supervisor stops after max_interventions and on_error takes over', async (t) => {
  const r = makeRun(t);
  const calls = script(r, { checkText: 'never json', decisions: [{ explanation: 'x', action: 'retry', instruction: 'try again' }, { explanation: 'y', action: 'retry', instruction: 'again' }, { explanation: 'z', action: 'retry' }] });
  const { events, finished } = await run(r);
  assert.equal(finished.status, 'success', finished.error);
  assert.equal(calls.supervisor.length, 2); // max_interventions: 2
  assert.match(finished.summary.steps.check.output.error, /failed validation/);
  assert.match(calls.supervisor[1], /previous interventions on this step\n1\. retry: x/);
  assert.ok(events.some((e) => e.type === 'log' && /no more interventions/.test(e.message)));
});

test('goto outside the allowed steps is refused and becomes a question to the human', async (t) => {
  const r = makeRun(t);
  script(r, { checkText: 'no json', decisions: [{ explanation: 'skip it', action: 'goto', goto: 'end' }] });
  r.on('event', (e) => {
    if (e.type === 'approval.requested') {
      assert.match(e.message, /supervisor needs you\.\n\nskip it/);
      setImmediate(() => r.resolveApproval(e.approval_id, 'stop'));
    }
  });
  const { events, finished } = await run(r);
  const d = events.find((e) => e.type === 'supervisor.decision');
  assert.equal(d.action, 'ask_human');
  assert.equal(finished.status, 'success'); // 'stop' → on_error: after
  assert.match(finished.summary.steps.check.output.error, /failed validation/);
});

test('resume: starts at the given step with the previous outputs, conversations and an instruction', async (t) => {
  const r = makeRun(t, { mock: false, resume: { runId: 'old', fromStep: 'after', steps: { check: { output: { verdict: 'pass' }, visits: 1 } }, sessions: { a: 'provider-session-1' }, instruction: 'Be brief.' } });
  const calls = script(r, { checkText: 'ok', decisions: [] });
  const { events, finished } = await run(r);
  assert.equal(finished.status, 'success', finished.error);
  assert.deepEqual(events.find((e) => e.type === 'workflow.started').resumed_from, { run_id: 'old', step: 'after' });
  assert.deepEqual(events.filter((e) => e.type === 'step.started').map((e) => e.step_id), ['after']);
  assert.match(calls.lastPrompt, /after: pass/);
  assert.match(calls.lastPrompt, /Note from the run supervisor[^\n]*\nBe brief\./);
  assert.throws(() => makeRun(t, { resume: { fromStep: 'nope' } }), /does not exist/);
});

test('resumeSpec and runReport read a run folder', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'run-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const ev = (o) => JSON.stringify({ ts: '2026-09-27T10:00:00Z', ...o });
  fs.writeFileSync(path.join(dir, 'events.jsonl'), [
    ev({ type: 'workflow.started', workflow: 'wf', file: 'wf.yaml', inputs: { task: 'x' }, project_id: 'p' }),
    ev({ type: 'session.opened', session_id: 's1', session: { agent: 'a', provider: 'claude', provider_session_id: null } }),
    ev({ type: 'step.started', step_id: 'check', visit: 1 }),
    ev({ type: 'session.message_received', session_id: 's1', step_id: 'check', text: 'the real analysis', session: { agent: 'a', provider: 'claude', provider_session_id: 'ps-1' } }),
    ev({ type: 'step.finished', step_id: 'check', visit: 1, output: { verdict: 'pass' } }),
    ev({ type: 'step.started', step_id: 'after', visit: 1 }),
    ev({ type: 'workflow.finished', status: 'failed', error: 'boom' }),
  ].join('\n') + '\n');
  const spec = supervisor.resumeSpec(dir, 'after');
  assert.deepEqual(spec.steps, { check: { output: { verdict: 'pass' }, visits: 1 } });
  assert.deepEqual(spec.sessions, { a: 'ps-1' });
  assert.equal(spec.projectId, 'p');
  assert.equal(spec.issues, null);
  const report = supervisor.runReport(dir, { workflowsDir: dir });
  assert.match(report, /Status: failed\nError: boom/);
  assert.match(report, /▶ check \(visit 1\)/);
});

test('resumeSpec: cliTotals keeps the last running total of each Claude CLI session (#233)', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'run-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const ev = (o) => JSON.stringify({ ts: '2026-09-27T10:00:00Z', ...o });
  const snap = (agent, cli, total) => ({ agent, provider: 'claude', provider_session_id: cli, ...(total != null ? { cli_total_cost_usd: total } : {}) });
  fs.writeFileSync(path.join(dir, 'events.jsonl'), [
    ev({ type: 'workflow.started', workflow: 'wf', file: 'wf.yaml', inputs: { task: 'x' } }),
    ev({ type: 'step.started', step_id: 'check', visit: 1 }),
    ev({ type: 'session.message_received', session_id: 's1', step_id: 'check', cost_usd: 3.21, session: snap('a', 'ps-1', 3.21) }),
    ev({ type: 'session.message_received', session_id: 's1', step_id: 'check', cost_usd: 0.35, session: snap('a', 'ps-1', 3.56) }),
    ev({ type: 'session.message_received', session_id: 's2', step_id: 'check', cost_usd: 1, session: snap('b', 'ps-2', null) }),
    ev({ type: 'step.finished', step_id: 'check', visit: 1, output: { verdict: 'pass' } }),
    ev({ type: 'step.started', step_id: 'after', visit: 1 }),
    ev({ type: 'workflow.finished', status: 'failed', error: 'boom' }),
  ].join('\n') + '\n');
  const spec = supervisor.resumeSpec(dir, 'after');
  assert.deepEqual(spec.cliTotals, { 'ps-1': 3.56 }, 'the last total of ps-1; ps-2 recorded none (a run before the fix)');
  assert.deepEqual(spec.sessions, { a: 'ps-1', b: 'ps-2' });
});

test('resumeSpec (#175) collects a `type: workflow` step\'s child runs, by run id, the latest status for each', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'run-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const ev = (o) => JSON.stringify({ ts: '2026-09-27T10:00:00Z', ...o });
  fs.writeFileSync(path.join(dir, 'events.jsonl'), [
    ev({ type: 'workflow.started', workflow: 'wf', file: 'wf.yaml', inputs: {} }),
    ev({ type: 'workflow.child_started', step_id: 'children', child_run_id: 'c0', index: 0, label: 'a', workflow: 'child.yaml' }),
    ev({ type: 'workflow.child_started', step_id: 'children', child_run_id: 'c1', index: 1, label: 'b', workflow: 'child.yaml' }),
    ev({ type: 'workflow.child_finished', step_id: 'children', child_run_id: 'c0', status: 'success' }),
    ev({ type: 'workflow.child_finished', step_id: 'children', child_run_id: 'c1', status: 'cancelled' }),
    ev({ type: 'workflow.finished', status: 'cancelled' }),
  ].join('\n') + '\n');
  const spec = supervisor.resumeSpec(dir, 'children');
  assert.deepEqual(spec.childRuns, [
    { run_id: 'c0', step_id: 'children', index: 0, label: 'a', status: 'success' },
    { run_id: 'c1', step_id: 'children', index: 1, label: 'b', status: 'cancelled' },
  ]);
});

test('resumeSpec carries the issues over; a run recorded with one `issue` resumes with a list of one', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'run-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const ref = (n) => ({ number: n, url: `https://github.com/o/r/issues/${n}`, title: `T${n}` });
  const started = (o) => fs.writeFileSync(path.join(dir, 'events.jsonl'), `${JSON.stringify({ type: 'workflow.started', file: 'wf.yaml', inputs: {}, ...o })}\n`);
  started({ issues: [ref(53), ref(65)] });
  assert.deepEqual(supervisor.resumeSpec(dir, 'x').issues, [ref(53), ref(65)]);
  started({ issue: ref(7) });
  assert.deepEqual(supervisor.resumeSpec(dir, 'x').issues, [ref(7)]);
});

test('skippedGate: the last human gate before fromStep that the previous run decided, or null', () => {
  const wf = { steps: [{ id: 'plan' }, { id: 'approve', type: 'human_approval' }, { id: 'work' }, { id: 'approve2', type: 'human_approval' }, { id: 'ship' }] };
  assert.equal(supervisor.skippedGate(wf, 'plan', {}), null, 'nothing before the first step');
  assert.equal(supervisor.skippedGate(wf, 'work', {}), null, 'the gate before it was never decided');
  assert.equal(supervisor.skippedGate(wf, 'work', { approve: { output: {}, visits: 1 } }), 'approve');
  assert.equal(supervisor.skippedGate(wf, 'approve', { approve: { output: {}, visits: 1 } }), null, 'the gate itself: only earlier gates count, and there are none');
  assert.equal(supervisor.skippedGate(wf, 'ship', { approve: { visits: 1 }, approve2: { visits: 1 } }), 'approve2', 'the latest decided gate before it');
  assert.equal(supervisor.skippedGate(wf, 'nope', {}), null, 'not a step of this workflow');
});

test('withoutGateDecisions drops only the human_approval steps\' outputs', () => {
  const wf = { steps: [{ id: 'plan' }, { id: 'approve', type: 'human_approval' }, { id: 'work' }] };
  const steps = { plan: { output: { x: 1 }, visits: 1 }, approve: { output: { approved: true }, visits: 1 }, work: { output: { y: 2 }, visits: 1 } };
  assert.deepEqual(supervisor.withoutGateDecisions(wf, steps), { plan: steps.plan, work: steps.work });
  assert.deepEqual(supervisor.withoutGateDecisions(wf, {}), {});
});

test('actionSchema: goto is limited to the transition\'s own recovery steps', () => {
  const schema = supervisor.actionSchema(['resolve_conflict']);
  assert.deepEqual(schema.properties.goto.enum, ['resolve_conflict']);
  assert.deepEqual(schema.properties.action.enum, ['goto', 'escalate']);
  assert.deepEqual(schema.required, ['explanation', 'action']);
});

test('actionErrorPrompt: gives the error, the engine\'s PR/MR check, the recovery options and the failure gate', () => {
  const wf = { metadata: { name: 'software-development', description: 'Ships a change.' } };
  const step = { id: 'approve_merge' };
  const check = { state: 'conflict', detail: 'the PR now conflicts with main' };
  const prompt = supervisor.actionErrorPrompt({
    wf, step, error: 'not mergeable: conflict', check, recover: ['resolve_conflict'], gate: 'merge_failed', events: [], handoffs: [],
  });
  assert.match(prompt, /workflow "software-development"/);
  assert.match(prompt, /step "approve_merge"/);
  assert.match(prompt, /## Error\nnot mergeable: conflict/);
  assert.match(prompt, /## PR\/MR state checked by the engine\nconflict: the PR now conflicts with main/);
  assert.match(prompt, /go back to one of resolve_conflict/);
  assert.match(prompt, /stops at the gate "merge_failed"/);
});

test('analyzeSessions: mock writes a report on the range and returns it, with model "simulated"', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sup-reports-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const result = await supervisor.analyzeSessions({
    report: '# Sessions from 2026-09-01 to 2026-09-30 (orchestrator runs)\nTotal: 1,000 tokens, $0.50, 3 sessions.',
    from: '2026-09-01', to: '2026-09-30', scope: 'orchestrator', reportsDir: dir, skillsDirs: [SKILLS_DIR], mock: true,
  });
  assert.equal(result.model, 'simulated');
  assert.deepEqual(Object.keys(result.report).sort(), ['complexity', 'patterns', 'suggestions', 'summary', 'uses'].sort());
  assert.match(result.markdown, /# Sessions report: 2026-09-01 to 2026-09-30/);
  assert.match(result.reportPath, /sessions-.*\.md$/);
  assert.equal(fs.readFileSync(result.reportPath, 'utf8'), result.markdown);
});

test('analyzeSessions: without mock, under simulation-only, it rejects', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sup-reports-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  await assert.rejects(supervisor.analyzeSessions({
    report: 'x', from: '2026-09-01', to: '2026-09-30', scope: 'orchestrator', reportsDir: dir, skillsDirs: [SKILLS_DIR],
    resolveCommand: () => true, mock: false,
  }), /Simulation only/);
});
