// #97 (review round 2): a run records the orchestrator AI it took (workflow.started orchestrator_ai,
// orchestrator_applied) and a resumed, recovered or child run, and the supervisor, follow that record,
// never the current setting (packages/engine/engine/run/orchestrator-choice.js, supervisor.js
// resumeSpec / supervisorConfig, WorkflowRun.startChildRun); the loader's non-enumerable fields survive
// applyOrchestrator's clone; the E2E hook ids are empty outside simulation (engine/simulation.js).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.CRAFTORIO_MOCK_DELAY_SCALE = '0.02';

const { WorkflowRun, loadWorkflow } = require('../../engine/workflow');
const choice = require('../../engine/run/orchestrator-choice');
const supervisor = require('../../domains/supervisor/supervisor');
const simulation = require('../../engine/simulation');
const OrchestratorModels = require('@craftorio/shared/orchestrator-models');

const BUNDLED = path.join(__dirname, '..', '..', '..', '..', 'workflows');
const FIX = path.join(BUNDLED, 'fix.yaml');

const TWO_STEPS = `apiVersion: craftorio/v1
kind: Workflow
metadata: { name: fixture-orchestrator-97 }
agents:
  writer: { provider: claude, model: claude-opus-5-5, session: ephemeral, timeout: 10m }
steps:
  - id: write
    agent: writer
    prompt: "Write the document."
`;

const PARENT = `apiVersion: craftorio/v1
kind: Workflow
metadata: { name: fixture-parent-97 }
agents:
  writer: { provider: claude, model: claude-opus-5-5, session: ephemeral, timeout: 10m }
steps:
  - id: child
    type: workflow
    workflow: child.yaml
    inputs: {}
`;

function tmp(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'orch-97-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function writeRun(dir, started) {
  const runDir = path.join(dir, 'runs', '20261127-000000-orch97');
  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(path.join(runDir, 'events.jsonl'), `${JSON.stringify({ ts: '2026-11-27T00:00:00Z', type: 'workflow.started', workflow: 'fix', inputs: {}, mock: true, ...started })}\n`);
  return runDir;
}

async function runFile(file, dir, options = {}) {
  const run = new WorkflowRun({ file, inputs: {}, mock: true, runsDir: path.join(dir, 'runs'), skillsDirs: [], ...options });
  const events = [];
  const children = [];
  run.on('child', (child) => {
    children.push(child);
    child.on('event', (ev) => events.push(ev));
  });
  run.on('event', (ev) => events.push(ev));
  await run.start();
  return { run, events, children };
}

const startedOf = (events, runId) => events.find((e) => e.type === 'workflow.started' && (!runId || e.run_id === runId)) || {};
const finishedOf = (events, runId) => events.find((e) => e.type === 'workflow.finished' && (!runId || e.run_id === runId)) || {};

test('#97 workflow.started records orchestrator_ai and orchestrator_applied when the bundled workflow moved to Codex', async (t) => {
  const dir = tmp(t);
  const file = path.join(dir, 'wf.yaml');
  fs.writeFileSync(file, TWO_STEPS);
  const { run, events } = await runFile(file, dir, { orchestrator: 'codex', bundledWorkflow: true });
  assert.equal(finishedOf(events, run.runId).status, 'success', finishedOf(events, run.runId).error);
  const started = startedOf(events, run.runId);
  assert.equal(started.orchestrator_ai, 'codex');
  assert.equal(started.orchestrator_applied, true);
  assert.equal(started.agents?.writer?.provider, 'codex');
  assert.equal(started.agents?.writer?.model, 'gpt-6.2-sol');
});

test('#97 workflow.started records claude with no orchestrator_applied on Claude, or when nothing was chosen', async (t) => {
  const dir = tmp(t);
  const file = path.join(dir, 'wf.yaml');
  fs.writeFileSync(file, TWO_STEPS);
  for (const orchestrator of ['claude', undefined]) {
    const { run, events } = await runFile(file, dir, { orchestrator, bundledWorkflow: true });
    const started = startedOf(events, run.runId);
    assert.equal(started.orchestrator_ai, 'claude', String(orchestrator));
    assert.equal('orchestrator_applied' in started, false, String(orchestrator));
    assert.equal(started.agents?.writer?.provider, 'claude');
  }
});

test('#97 a custom workflow on Codex records codex as the run\'s AI but keeps its providers (no orchestrator_applied)', async (t) => {
  const dir = tmp(t);
  const file = path.join(dir, 'wf.yaml');
  fs.writeFileSync(file, TWO_STEPS);
  const { run, events } = await runFile(file, dir, { orchestrator: 'codex', bundledWorkflow: false });
  const started = startedOf(events, run.runId);
  assert.equal(started.orchestrator_ai, 'codex');
  assert.equal('orchestrator_applied' in started, false);
  assert.equal(started.agents?.writer?.provider, 'claude');
});

test('#97 a child run (default startChild) takes its parent\'s orchestrator AI', async (t) => {
  const dir = tmp(t);
  fs.writeFileSync(path.join(dir, 'parent.yaml'), PARENT);
  fs.writeFileSync(path.join(dir, 'child.yaml'), TWO_STEPS);
  const { run, events, children } = await runFile(path.join(dir, 'parent.yaml'), dir, { orchestrator: 'codex', bundledWorkflow: false });
  assert.equal(finishedOf(events, run.runId).status, 'success', finishedOf(events, run.runId).error);
  assert.equal(children.length, 1);
  assert.equal(children[0].orchestratorAI, 'codex');
  assert.equal(startedOf(events, children[0].runId).orchestrator_ai, 'codex');
});

test('#97 runOrchestrator: a recovered run keeps its recorded AI, a run from before #97 counts as claude', () => {
  const recorded = (ai) => ({ events: [{ type: 'workflow.started', ...(ai ? { orchestrator_ai: ai } : {}) }] });
  assert.equal(choice.runOrchestrator({ orchestrator: 'claude', recover: recorded('codex') }), 'codex');
  assert.equal(choice.runOrchestrator({ orchestrator: 'codex', recover: recorded('claude') }), 'claude');
  assert.equal(choice.runOrchestrator({ orchestrator: 'codex', recover: recorded(null) }), 'claude');
  assert.equal(choice.runOrchestrator({ orchestrator: 'codex', recover: { events: [] } }), 'claude');
});

test('#97 runOrchestrator: a resumed run keeps resume.orchestrator over the setting; none recorded counts as claude', () => {
  assert.equal(choice.runOrchestrator({ orchestrator: 'claude', resume: { orchestrator: 'codex' } }), 'codex');
  assert.equal(choice.runOrchestrator({ orchestrator: 'codex', resume: { orchestrator: undefined } }), 'claude');
  assert.equal(choice.runOrchestrator({ orchestrator: 'codex' }), 'codex');
});

test('#97 a resumed fix recorded on Codex runs its agents on Codex although the setting is now Claude', () => {
  const written = loadWorkflow(FIX);
  const { wf, onOrchestrator, orchestrator } = choice.orchestratedWorkflow(written, {}, { orchestrator: 'claude', bundledWorkflow: true, resume: { orchestrator: 'codex' } });
  assert.equal(orchestrator, 'codex');
  assert.equal(onOrchestrator, true);
  assert.equal(wf.orchestrator.provider, 'codex');
  assert.equal(wf.orchestrator.model, 'gpt-6.1-terra');
  assert.deepEqual([...new Set(Object.values(wf.agents).map((a) => a.provider))], ['codex']);
  // and the other way round: a run recorded before #97 stays on Claude with Codex chosen now
  const old = choice.orchestratedWorkflow(written, {}, { orchestrator: 'codex', bundledWorkflow: true, resume: {} });
  assert.equal(old.onOrchestrator, false);
  assert.equal(old.wf.orchestrator.provider, 'claude');
});

test('#97 resumeSpec returns the orchestrator AI the run recorded (undefined for a run from before #97)', (t) => {
  const dir = tmp(t);
  assert.equal(supervisor.resumeSpec(writeRun(dir, { file: 'fix.yaml', orchestrator_ai: 'codex', orchestrator_applied: true }), 'plan').orchestrator, 'codex');
  const dir2 = tmp(t);
  const before = supervisor.resumeSpec(writeRun(dir2, { file: 'fix.yaml' }), 'plan');
  assert.equal(before.orchestrator, undefined);
  assert.equal(choice.runOrchestrator({ orchestrator: 'codex', resume: { orchestrator: before.orchestrator } }), 'claude');
});

test('#97 supervisorConfig of a run that moved to Codex asks the Codex supervisor on the mapped model', (t) => {
  const dir = tmp(t);
  const cfg = supervisor.supervisorConfig(writeRun(dir, { file: 'fix.yaml', orchestrator_ai: 'codex', orchestrator_applied: true }), BUNDLED);
  assert.equal(cfg.providerName, 'codex');
  assert.equal(cfg.model, 'gpt-6.1-terra');
  assert.equal(cfg.provider?.type, 'codex-cli');
});

test('#97 supervisorConfig of a run that stayed on Claude (or recorded codex without moving) keeps the workflow\'s supervisor', (t) => {
  for (const started of [{ file: 'fix.yaml', orchestrator_ai: 'claude' }, { file: 'fix.yaml' }, { file: 'fix.yaml', orchestrator_ai: 'codex' }]) {
    const cfg = supervisor.supervisorConfig(writeRun(tmp(t), started), BUNDLED);
    assert.equal(cfg.providerName, 'claude', JSON.stringify(started));
    assert.equal(cfg.model, 'claude-sonnet-5-5', JSON.stringify(started));
  }
});

test('#97 applyOrchestrator keeps the loader\'s non-enumerable fields (name, warnings) in its clone', () => {
  const loaded = loadWorkflow(FIX);
  const moved = OrchestratorModels.applyOrchestrator(loaded, 'codex', { bundled: true });
  assert.notEqual(moved === loaded, true);
  for (const key of ['name', 'warnings']) {
    const desc = Object.getOwnPropertyDescriptor(moved, key);
    assert.equal(!!desc, true, key);
    assert.equal(desc.enumerable, false, key);
    assert.equal(JSON.stringify(moved[key]), JSON.stringify(loaded[key]), key);
  }
  assert.equal(moved.name, 'fix');
  assert.equal(Object.keys(moved).includes('name'), false);
});

test('#97 the E2E hooks readyIds, signedOutIds and missingIds list ids only in simulation', () => {
  const env = { CRAFTORIO_E2E_CLI_READY: 'codex, grok', CRAFTORIO_E2E_CLI_SIGNED_OUT: 'claude', CRAFTORIO_E2E_CLI_MISSING: 'gitleaks' };
  const on = { ...env, CRAFTORIO_SIMULATION_ONLY: '1' };
  assert.deepEqual(simulation.readyIds(on), ['codex', 'grok']);
  assert.deepEqual(simulation.signedOutIds(on), ['claude']);
  assert.deepEqual(simulation.missingIds(on), ['gitleaks']);
  for (const off of [env, { ...env, CRAFTORIO_SIMULATION_ONLY: '0' }]) {
    assert.deepEqual(simulation.readyIds(off), []);
    assert.deepEqual(simulation.signedOutIds(off), []);
    assert.deepEqual(simulation.missingIds(off), []);
  }
  assert.deepEqual(simulation.readyIds({ CRAFTORIO_SIMULATION_ONLY: '1' }), []);
});
