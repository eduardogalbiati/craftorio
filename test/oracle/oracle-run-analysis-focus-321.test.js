// #321: run_analysis answers where time, context and tool calls went, not only cost. Acceptance
// tests, written before the code, through the Oracle's run_analysis tool (callTool over oracleTools)
// and the analyzer delegate (oracle:delegate { to: 'analyzer' }). Fixture runs only (events.jsonl,
// summary.json, sessions/, logs/): no real run, no model.
//
// The answer each focus gives (the contract these tests read; JSON of { runs, total?, note? }):
// - no focus / focus 'cost': exactly today's answer ({ runs, total }, analyzeRun / totalOf).
// - 'time': per run { runId, status, steps: { <step>: { durationMs, visits, open, toolMs, modelMs } },
//   activeMs, waitingMs (summary.timing, null without it), slowestTools: [{ step, tool, target,
//   durationMs }] (at most 5, target cut to ~100 characters), gaps: [{ durationMs, endedBy }] (over
//   3 min with no event; endedBy = the type of the event that ended it), gates: { <gate>: { waits,
//   waitMs } }, ownerWaitMs }.
// - 'context' (input `agent`, default 'developer'): per run { runId, agent, turns: [{ step, turn,
//   requests, toolCalls, meanContext, peakContext, readTokens, readShareAbove: { '100K', '150K',
//   '200K' } (fractions 0..1) }], past200K: { turns, share }, main: { turn, curve: [...], growthByKind:
//   { <tool kind>: tokens } } }; total { turns, readTokens, topTurns: [{ runId, turn, readTokens }] }.
// - 'tools': per run { runId, agents: { <agent>: { calls, byTool, byBashKind, steps: { <step>: {
//   calls, byTool } }, rereadFiles: [{ file, reads }], searches: { grep, glob }, edits: [{ file,
//   edits, writes }], subagents, failed: { total, byCause }, testCommands: [{ command, durationMs }] } } }.
// - 'cache': per run { runId, turns, cold: { count, share, cacheWrite, costUsd, turns: [{ agent,
//   session, turn, gapMs, cacheWrite, costUsd }] } }; total { turns, cold: { count, ... } }.
// - 'tests': per run { runId, files: [{ file, durationMs, tests }] (slowest first), slowest: [{ test,
//   durationMs }], testStep: { e2e: { calls, durationMs }, unit: { calls, durationMs } }, note (when
//   the run has no suite logs) }; with two runIds, comparison: { tests: [{ test, beforeMs, afterMs }] }
//   for the tests both ran. Declared test names come from test/*.test.js of the run's checkout
//   (summary.worktree.dir, else inputs.project_path).
process.env.MULTIAGENT_MOCK_DELAY_SCALE ??= '0.05';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createService, BUNDLED_SKILLS_DIR } = require('../../src/service');
const { setupWorkspace } = require('../../src/domains/workspace/workspace');

const ROOT = path.join(__dirname, '..', '..');
const loadTools = () => require('../../src/domains/oracle/oracle-tools');
const near = (actual, expected, msg, eps = 1e-6) => assert.ok(Math.abs(Number(actual) - expected) < eps, `${msg}: expected ${expected}, got ${actual}`);
const FOCUSES = ['cost', 'time', 'context', 'tools', 'cache', 'tests'];

function scratchDir(t, prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));
  return dir;
}

// The tools' ctx on a fresh workspace (as test/oracle/oracle-capable-184.test.js wires it).
function makeCtx(t) {
  process.env.MULTIAGENT_SIMULATION_ONLY = '1';
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oracle-321-ws-'));
  const service = createService({ host: { trashItem: async () => {}, appVersion: '9.9.9', isPackaged: false } });
  t.after(() => service.shutdown());
  t.after(() => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));
  service.setWorkspace(setupWorkspace(dir, { persist: false }));
  const runFolder = (runId) => {
    const runDir = path.join(service.workspace().runs, path.basename(String(runId || '')));
    if (!fs.existsSync(path.join(runDir, 'events.jsonl'))) throw new Error(`Run not found: ${runId}`);
    return runDir;
  };
  const ctx = {
    get ws() { return service.workspace(); },
    BUNDLED_SKILLS_DIR,
    runFolder,
    workflowDirs: () => [service.workspace().workflows],
    execCli: async () => '[]',
  };
  return { ctx, api: service.api, runsDir: service.workspace().runs };
}

async function analysis(ctx, input) {
  const { callTool, oracleTools } = loadTools();
  const out = await callTool(oracleTools(ctx), 'run_analysis', input);
  assert.equal(out.isError, false, out.text);
  return { data: JSON.parse(out.text), text: out.text };
}
const runOf = (data, id) => {
  const r = (data.runs || []).find((x) => x.runId === id);
  assert.ok(r, `run ${id} is in the analysis (got: ${JSON.stringify(data).slice(0, 300)})`);
  return r;
};

// ---- fixture events ---------------------------------------------------------------------------

const MIN = 60e3;
const D = '2026-10-05';
const at = (m) => new Date(Date.parse(`${D}T10:00:00.000Z`) + m * MIN).toISOString();
const u = (input, output, cache_read, cache_write) => ({ input, output, cache_read, cache_write, reasoning: 0 });
const wfStarted = (m, mock = false) => ({ ts: at(m), type: 'workflow.started', workflow: 'AI Development', file: 'ai-development.yaml', mock, cost_accounting: 'per_turn' });
const wfFinished = (m) => ({ ts: at(m), type: 'workflow.finished', status: 'success' });
const started = (m, step, visit, agent, type = 'agent') => ({ ts: at(m), type: 'step.started', step_id: step, visit, step_type: type, agent });
const finished = (m, step, visit, output = {}) => ({ ts: at(m), type: 'step.finished', step_id: step, visit, output });
const opened = (m, sid, agent, step, provider = 'claude') => ({ ts: at(m), type: 'session.opened', session_id: sid, session: { id: sid, agent, provider, model: provider === 'claude' ? 'claude-opus-5-5' : 'gpt-5', step_id: step } });
const sent = (m, sid, n, step) => ({ ts: at(m), type: 'session.message_sent', session_id: sid, turn: n, step_id: step, prompt: 'go' });
const recv = (m, sid, n, step, cost = 0.1, usage = u(1000, 100, 0, 0)) => ({ ts: at(m), type: 'session.message_received', session_id: sid, turn: n, step_id: step, text: 'done', usage, cost_usd: cost });
const tc = (m, sid, n, id, name, input) => ({ ts: at(m), type: 'session.stream', session_id: sid, turn: n, item: { kind: 'tool_call', id, name, input } });
const tr = (m, sid, n, id, output = 'ok', isError = false) => ({ ts: at(m), type: 'session.stream', session_id: sid, turn: n, item: { kind: 'tool_result', id, output, is_error: isError } });
const cx = (m, sid, n, tokens) => ({ ts: at(m), type: 'session.stream', session_id: sid, turn: n, item: { kind: 'context', tokens } });
const summaryOf = (id, end, extra = {}) => ({
  run_id: id, workflow: 'AI Development', status: 'success', mock: false, cost_accounting: 'per_turn',
  started_at: at(0), finished_at: at(end), duration_ms: end * MIN, cost_usd: 1, tokens: u(0, 0, 0, 0), sessions: [], ...extra,
});

// events.jsonl, sessions/<id>.jsonl (the recorder's copy of each session's events) and summary.json
function writeRun(runsDir, id, events, summary) {
  const dir = path.join(runsDir, id);
  fs.mkdirSync(path.join(dir, 'sessions'), { recursive: true });
  const lines = events.map((e, i) => ({ seq: i + 1, run_id: id, ...e }));
  fs.writeFileSync(path.join(dir, 'events.jsonl'), `${lines.map((e) => JSON.stringify(e)).join('\n')}\n`);
  const bySession = new Map();
  for (const e of lines) if (e.session_id) bySession.set(e.session_id, [...(bySession.get(e.session_id) || []), e]);
  for (const [sid, list] of bySession) fs.writeFileSync(path.join(dir, 'sessions', `${sid}.jsonl`), `${list.map((e) => JSON.stringify(e)).join('\n')}\n`);
  if (summary) fs.writeFileSync(path.join(dir, 'summary.json'), JSON.stringify(summary, null, 2));
  return dir;
}

// Time run: develop (2 visits, 18 min, 8.5 min of tool calls), review (2 min); gaps over 3 min:
// 4→8 (a 4-minute tool call, ended by its result) and 15.5→20 (ended by the turn's answer).
const RUN_TIME = 'run-321-time';
const LONG = `node scripts/check.js ${'x'.repeat(300)}`;
const EVENTS_TIME = [
  wfStarted(0),
  started(0, 'develop', 1, 'developer'), opened(0, 'd1', 'developer', 'develop'), sent(0, 'd1', 1, 'develop'),
  tc(1, 'd1', 1, 'c1', 'Bash', { command: 'npm test -- test/a.test.js' }), tr(3, 'd1', 1, 'c1'),
  tc(3, 'd1', 1, 'c2', 'Read', { file_path: 'C:/w/src/a.js' }), tr(3, 'd1', 1, 'c2'),
  tc(4, 'd1', 1, 'c3', 'Bash', { command: LONG }), tr(8, 'd1', 1, 'c3'),
  recv(10, 'd1', 1, 'develop', 1), finished(10, 'develop', 1),
  started(10, 'review', 1, 'reviewer'), opened(10, 'r1', 'reviewer', 'review'), sent(10, 'r1', 1, 'review'),
  recv(12, 'r1', 1, 'review', 0.2), finished(12, 'review', 1, { verdict: 'changes_requested' }),
  started(12, 'develop', 2, 'developer'), sent(12, 'd1', 2, 'develop'),
  tc(13, 'd1', 2, 'c4', 'Bash', { command: 'git status' }), tr(14, 'd1', 2, 'c4'),
  tc(14, 'd1', 2, 'c5', 'Grep', { pattern: 'foo' }), tr(14.5, 'd1', 2, 'c5'),
  tc(14.5, 'd1', 2, 'c6', 'Glob', { pattern: 'src/**/*.js' }), tr(15, 'd1', 2, 'c6'),
  tc(15, 'd1', 2, 'c7', 'Edit', { file_path: 'C:/w/src/a.js' }), tr(15.5, 'd1', 2, 'c7'),
  recv(20, 'd1', 2, 'develop', 0.5), finished(20, 'develop', 2),
  wfFinished(20),
];
const SUMMARY_TIME = summaryOf(RUN_TIME, 20, {
  timing: { steps: {}, duration_ms: 20 * MIN, active_ms: 17 * MIN, waiting_ms: 3 * MIN, stalled_ms: 0, gates: { approve: { waits: 1, wait_ms: 5 * MIN } }, gate_wait_ms: 5 * MIN },
});

// A run still running (no summary.json): develop done (0→3), review open since 3, last event at 6.
const RUN_RUNNING = 'run-321-running';
const EVENTS_RUNNING = [
  wfStarted(0),
  started(0, 'develop', 1, 'developer'), opened(0, 'e1', 'developer', 'develop'), sent(0, 'e1', 1, 'develop'),
  tc(1, 'e1', 1, 'x1', 'Bash', { command: 'git log' }), tr(2, 'e1', 1, 'x1'),
  cx(2, 'e1', 1, 20000),
  recv(3, 'e1', 1, 'develop'), finished(3, 'develop', 1),
  started(3, 'review', 1, 'reviewer'), opened(3, 'e2', 'reviewer', 'review'), sent(3, 'e2', 1, 'review'),
  tc(5, 'e2', 1, 'x2', 'Read', { file_path: 'C:/w/src/a.js' }), tr(6, 'e2', 1, 'x2'),
];

// A mock run: the time run's events and summary, marked mock.
const RUN_MOCK = 'run-321-mock';
const EVENTS_MOCK = [wfStarted(0, true), ...EVENTS_TIME.slice(1)];
const SUMMARY_MOCK = { ...SUMMARY_TIME, run_id: RUN_MOCK, mock: true };

// ---- the tool and the default answer --------------------------------------------------------------

test('#321 run_analysis takes a focus, and its description names each one', () => {
  const { oracleTools } = loadTools();
  const tool = oracleTools({ ws: {}, BUNDLED_SKILLS_DIR, runFolder: () => '' }).find((x) => x.name === 'run_analysis');
  assert.ok(tool, 'the Oracle has run_analysis');
  const focus = tool.inputSchema?.properties?.focus;
  assert.ok(focus, 'run_analysis has a focus input');
  const said = `${tool.description} ${JSON.stringify(focus)}`;
  for (const f of FOCUSES) assert.match(said, new RegExp(`\\b${f}\\b`), `the tool names the ${f} focus`);
});

test('#321 run_analysis without focus answers exactly as before, and focus cost is the same answer', async (t) => {
  const { ctx, runsDir } = makeCtx(t);
  writeRun(runsDir, RUN_TIME, EVENTS_TIME, SUMMARY_TIME);
  const plain = await analysis(ctx, { runIds: [RUN_TIME] });
  assert.deepEqual(Object.keys(plain.data).sort(), ['runs', 'total']);
  const r = runOf(plain.data, RUN_TIME);
  for (const k of ['costUsd', 'tokens', 'byAgent', 'byStep', 'reviewRounds', 'timeouts', 'invalidOutputs', 'refusedCalls', 'mergeConflicts', 'toolTimeouts', 'testWriter', 'fullSuites']) {
    assert.ok(k in r, `the cost answer keeps ${k}`);
  }
  const cost = await analysis(ctx, { runIds: [RUN_TIME], focus: 'cost' });
  assert.equal(cost.text, plain.text);
});

test('#321 every focus answers a run still running (no summary.json) and a mock run without failing', async (t) => {
  const { ctx, runsDir } = makeCtx(t);
  writeRun(runsDir, RUN_RUNNING, EVENTS_RUNNING, null);
  writeRun(runsDir, RUN_MOCK, EVENTS_MOCK, SUMMARY_MOCK);
  for (const focus of FOCUSES) {
    const { data } = await analysis(ctx, { runIds: [RUN_RUNNING, RUN_MOCK], focus });
    assert.equal(data.runs.length, 2, `focus ${focus}: both runs answered`);
    runOf(data, RUN_RUNNING);
    runOf(data, RUN_MOCK);
  }
});

// ---- time -------------------------------------------------------------------------------------------

test('#321 time: minutes and visits per step, tool time vs model time, active vs waiting and owner time', async (t) => {
  const { ctx, runsDir } = makeCtx(t);
  writeRun(runsDir, RUN_TIME, EVENTS_TIME, SUMMARY_TIME);
  const r = runOf((await analysis(ctx, { runIds: [RUN_TIME], focus: 'time' })).data, RUN_TIME);
  assert.equal(r.steps.develop.visits, 2);
  assert.equal(r.steps.develop.durationMs, 18 * MIN);
  assert.equal(r.steps.develop.toolMs, 8.5 * MIN);
  assert.equal(r.steps.develop.modelMs, 9.5 * MIN);
  assert.equal(r.steps.develop.open, false);
  assert.equal(r.steps.review.visits, 1);
  assert.equal(r.steps.review.durationMs, 2 * MIN);
  assert.equal(r.steps.review.toolMs, 0);
  assert.equal(r.activeMs, 17 * MIN);
  assert.equal(r.waitingMs, 3 * MIN);
  assert.equal(r.ownerWaitMs, 5 * MIN);
  assert.equal(r.gates.approve.waits, 1);
  assert.equal(r.gates.approve.waitMs, 5 * MIN);
});

test('#321 time: the 5 slowest tool calls with their step and a cut command, and the gaps over 3 minutes with what ended them', async (t) => {
  const { ctx, runsDir } = makeCtx(t);
  writeRun(runsDir, RUN_TIME, EVENTS_TIME, SUMMARY_TIME);
  const r = runOf((await analysis(ctx, { runIds: [RUN_TIME], focus: 'time' })).data, RUN_TIME);
  assert.equal(r.slowestTools.length, 5, 'at most 5 of the 7 calls');
  const [first, second] = r.slowestTools;
  assert.equal(first.step, 'develop');
  assert.equal(first.tool, 'Bash');
  assert.equal(first.durationMs, 4 * MIN);
  assert.ok(first.target.startsWith('node scripts/check.js'), first.target);
  assert.ok(first.target.length <= 110, `the command is cut to ~100 characters (got ${first.target.length})`);
  assert.equal(second.durationMs, 2 * MIN);
  assert.match(second.target, /npm test/);

  assert.deepEqual(r.gaps.map((g) => g.durationMs), [4 * MIN, 4.5 * MIN]);
  assert.deepEqual(r.gaps.map((g) => g.endedBy), ['session.stream', 'session.message_received']);
});

test('#321 time: a run still running counts its open step until the last event and marks it open; no summary gives no timing', async (t) => {
  const { ctx, runsDir } = makeCtx(t);
  writeRun(runsDir, RUN_RUNNING, EVENTS_RUNNING, null);
  const r = runOf((await analysis(ctx, { runIds: [RUN_RUNNING], focus: 'time' })).data, RUN_RUNNING);
  assert.equal(r.status, 'running');
  assert.equal(r.steps.develop.durationMs, 3 * MIN);
  assert.equal(r.steps.develop.open, false);
  assert.equal(r.steps.review.durationMs, 3 * MIN, 'review counts from 3 to the last event at 6');
  assert.equal(r.steps.review.open, true);
  assert.equal(r.activeMs ?? null, null);
  assert.equal(r.waitingMs ?? null, null);
});

// ---- context ----------------------------------------------------------------------------------------

// Developer turn 1 (develop): contexts 50K, 50K (repeated: one request), 120K after a Read, 160K after a
// test command, 210K after a Grep, 210K (repeated) → 4 requests, 540K read. Turn 2: 30K, 40K → 70K.
// Reviewer: one request of 80K.
const RUN_CTX = 'run-321-context';
const EVENTS_CTX = [
  wfStarted(0),
  started(0, 'develop', 1, 'developer'), opened(0, 'd1', 'developer', 'develop'), sent(0, 'd1', 1, 'develop'),
  cx(0.1, 'd1', 1, 50000), cx(0.2, 'd1', 1, 50000),
  tc(0.3, 'd1', 1, 'k1', 'Read', { file_path: 'C:/w/src/a.js' }), tr(0.4, 'd1', 1, 'k1'),
  cx(0.5, 'd1', 1, 120000),
  tc(0.6, 'd1', 1, 'k2', 'Bash', { command: 'npm test -- test/a.test.js' }), tr(0.7, 'd1', 1, 'k2'),
  cx(0.8, 'd1', 1, 160000),
  tc(0.9, 'd1', 1, 'k3', 'Grep', { pattern: 'foo' }), tr(1.0, 'd1', 1, 'k3'),
  cx(1.1, 'd1', 1, 210000), cx(1.2, 'd1', 1, 210000),
  recv(1.3, 'd1', 1, 'develop', 2), finished(1.3, 'develop', 1),
  started(1.4, 'review', 1, 'reviewer'), opened(1.4, 'r1', 'reviewer', 'review'), sent(1.4, 'r1', 1, 'review'),
  cx(1.5, 'r1', 1, 80000),
  recv(1.6, 'r1', 1, 'review', 0.2), finished(1.6, 'review', 1, { verdict: 'changes_requested' }),
  started(1.7, 'develop', 2, 'developer'), sent(1.7, 'd1', 2, 'develop'),
  cx(1.8, 'd1', 2, 30000),
  tc(1.9, 'd1', 2, 'k4', 'Read', { file_path: 'C:/w/src/b.js' }), tr(2.0, 'd1', 2, 'k4'),
  cx(2.1, 'd1', 2, 40000),
  recv(2.2, 'd1', 2, 'develop', 0.3), finished(2.2, 'develop', 2),
  wfFinished(2.3),
];
// A second run: one developer turn of 41 requests (1K, 2K, … 41K: 861K read).
const RUN_CTX2 = 'run-321-context-2';
const EVENTS_CTX2 = [
  wfStarted(0),
  started(0, 'develop', 1, 'developer'), opened(0, 'f1', 'developer', 'develop'), sent(0, 'f1', 1, 'develop'),
  ...Array.from({ length: 41 }, (_, i) => cx(0.01 * (i + 1), 'f1', 1, 1000 * (i + 1))),
  recv(1, 'f1', 1, 'develop', 1), finished(1, 'develop', 1),
  wfFinished(1),
];
const shareOf = (shares, k) => {
  const v = shares[`${k}K`] ?? shares[`${k}k`] ?? shares[String(k * 1000)];
  assert.ok(v != null, `a read share above ${k}K (got ${JSON.stringify(shares)})`);
  return v > 1 ? v / 100 : v;
};

test('#321 context: the developer\'s turns by default: requests (repeated values once), tool calls, mean and peak, read and the share read above 100K / 150K / 200K', async (t) => {
  const { ctx, runsDir } = makeCtx(t);
  writeRun(runsDir, RUN_CTX, EVENTS_CTX, summaryOf(RUN_CTX, 2.3));
  const r = runOf((await analysis(ctx, { runIds: [RUN_CTX], focus: 'context' })).data, RUN_CTX);
  assert.equal(r.agent, 'developer');
  assert.equal(r.turns.length, 2, 'the developer\'s two turns, not the reviewer\'s');
  const [t1, t2] = [...r.turns].sort((a, b) => a.turn - b.turn);
  assert.equal(t1.requests, 4);
  assert.equal(t1.toolCalls, 3);
  assert.equal(t1.meanContext, 135000);
  assert.equal(t1.peakContext, 210000);
  assert.equal(t1.readTokens, 540000);
  near(shareOf(t1.readShareAbove, 100), 490 / 540, 'read above 100K', 1e-3);
  near(shareOf(t1.readShareAbove, 150), 370 / 540, 'read above 150K', 1e-3);
  near(shareOf(t1.readShareAbove, 200), 210 / 540, 'read above 200K', 1e-3);
  assert.equal(t2.requests, 2);
  assert.equal(t2.toolCalls, 1);
  assert.equal(t2.peakContext, 40000);
  assert.equal(t2.readTokens, 70000);
});

test('#321 context: the turns past 200K and their share of the step\'s read; the main turn\'s curve and growth by the preceding tool call\'s kind', async (t) => {
  const { ctx, runsDir } = makeCtx(t);
  writeRun(runsDir, RUN_CTX, EVENTS_CTX, summaryOf(RUN_CTX, 2.3));
  const r = runOf((await analysis(ctx, { runIds: [RUN_CTX], focus: 'context' })).data, RUN_CTX);
  assert.equal(r.past200K.turns, 1);
  near(r.past200K.share > 1 ? r.past200K.share / 100 : r.past200K.share, 540 / 610, 'share of the step\'s read past 200K', 1e-3);
  assert.equal(r.main.turn, 1);
  assert.ok(Array.isArray(r.main.curve) && r.main.curve.length >= 1 && r.main.curve.length <= 4, `a short curve (got ${JSON.stringify(r.main.curve)})`);
  const growth = Object.entries(r.main.growthByKind);
  const by = (re) => growth.find(([k]) => re.test(k))?.[1];
  assert.equal(by(/read/i), 70000, `growth after a Read (got ${JSON.stringify(r.main.growthByKind)})`);
  assert.equal(by(/grep|search/i), 50000, `growth after a Grep (got ${JSON.stringify(r.main.growthByKind)})`);
});

test('#321 context: any agent by name; over several runs the totals and the top turns, the curve sampled', async (t) => {
  const { ctx, runsDir } = makeCtx(t);
  writeRun(runsDir, RUN_CTX, EVENTS_CTX, summaryOf(RUN_CTX, 2.3));
  writeRun(runsDir, RUN_CTX2, EVENTS_CTX2, summaryOf(RUN_CTX2, 1));
  const rev = runOf((await analysis(ctx, { runIds: [RUN_CTX], focus: 'context', agent: 'reviewer' })).data, RUN_CTX);
  assert.equal(rev.agent, 'reviewer');
  assert.equal(rev.turns.length, 1);
  assert.equal(rev.turns[0].peakContext, 80000);

  const { data } = await analysis(ctx, { runIds: [RUN_CTX, RUN_CTX2], focus: 'context' });
  assert.equal(data.total.turns, 3);
  assert.equal(data.total.readTokens, 610000 + 861000);
  assert.equal(data.total.topTurns[0].runId, RUN_CTX2);
  assert.equal(data.total.topTurns[0].readTokens, 861000);
  const curve = runOf(data, RUN_CTX2).main.curve;
  assert.ok(curve.length >= 4 && curve.length <= 6, `41 requests give about every 10th one (got ${curve.length})`);
});

// ---- tools ------------------------------------------------------------------------------------------

// Developer (develop): Read a.js ×3, Bash git ×2 + a test (2 min) + cat (exit code 1), Grep, Glob,
// Edit a.js ×2 (one failed), Write b.js, one sub-agent: 13 calls, 2 failed. Reviewer: one Read.
const RUN_TOOLS = 'run-321-tools';
const A_JS = 'C:/w/src/a.js';
const EVENTS_TOOLS = [
  wfStarted(0),
  started(0, 'develop', 1, 'developer'), opened(0, 'd1', 'developer', 'develop'), sent(0, 'd1', 1, 'develop'),
  tc(0.1, 'd1', 1, 't1', 'Read', { file_path: A_JS }), tr(0.1, 'd1', 1, 't1'),
  tc(0.2, 'd1', 1, 't2', 'Read', { file_path: A_JS }), tr(0.2, 'd1', 1, 't2'),
  tc(0.3, 'd1', 1, 't3', 'Read', { file_path: A_JS }), tr(0.3, 'd1', 1, 't3'),
  tc(0.4, 'd1', 1, 't4', 'Bash', { command: 'git status' }), tr(0.4, 'd1', 1, 't4'),
  tc(0.5, 'd1', 1, 't5', 'Bash', { command: 'git diff --stat' }), tr(0.5, 'd1', 1, 't5'),
  tc(1, 'd1', 1, 't6', 'Bash', { command: 'npm test -- test/a.test.js' }), tr(3, 'd1', 1, 't6', 'ℹ pass 3'),
  tc(3.1, 'd1', 1, 't7', 'Bash', { command: 'cat src/b.js' }), tr(3.1, 'd1', 1, 't7', 'Exit code 1\ncat: src/b.js: No such file or directory', true),
  tc(3.2, 'd1', 1, 't8', 'Grep', { pattern: 'foo', path: 'C:/w/src' }), tr(3.2, 'd1', 1, 't8'),
  tc(3.3, 'd1', 1, 't9', 'Glob', { pattern: 'src/**/*.js' }), tr(3.3, 'd1', 1, 't9'),
  tc(3.4, 'd1', 1, 't10', 'Edit', { file_path: A_JS, old_string: 'a', new_string: 'b' }), tr(3.4, 'd1', 1, 't10', 'String to replace not found in file.', true),
  tc(3.5, 'd1', 1, 't11', 'Edit', { file_path: A_JS, old_string: 'x', new_string: 'y' }), tr(3.5, 'd1', 1, 't11'),
  tc(3.6, 'd1', 1, 't12', 'Write', { file_path: 'C:/w/src/b.js', content: 'b' }), tr(3.6, 'd1', 1, 't12'),
  tc(3.7, 'd1', 1, 't13', 'Agent', { description: 'map the change', prompt: 'Map it.' }), tr(4, 'd1', 1, 't13'),
  recv(4.1, 'd1', 1, 'develop', 1), finished(4.1, 'develop', 1),
  started(4.2, 'review', 1, 'reviewer'), opened(4.2, 'r1', 'reviewer', 'review'), sent(4.2, 'r1', 1, 'review'),
  tc(4.3, 'r1', 1, 'v1', 'Read', { file_path: A_JS }), tr(4.3, 'r1', 1, 'v1'),
  recv(4.4, 'r1', 1, 'review', 0.2), finished(4.4, 'review', 1, { verdict: 'approved' }),
  wfFinished(4.5),
];
const SUMMARY_TOOLS = summaryOf(RUN_TOOLS, 4.5, {
  sessions: [
    { id: 'd1', agent: 'developer', provider: 'claude', step_id: 'develop', turns: 1, cost_usd: 1, tokens: u(1000, 100, 0, 0) },
    { id: 'r1', agent: 'reviewer', provider: 'claude', step_id: 'review', turns: 1, cost_usd: 0.2, tokens: u(1000, 100, 0, 0) },
  ],
});

test('#321 tools: per agent and step, calls by tool and by Bash kind, re-read files, searches, edits, sub-agents', async (t) => {
  const { ctx, runsDir } = makeCtx(t);
  writeRun(runsDir, RUN_TOOLS, EVENTS_TOOLS, SUMMARY_TOOLS);
  const r = runOf((await analysis(ctx, { runIds: [RUN_TOOLS], focus: 'tools' })).data, RUN_TOOLS);
  const dev = r.agents.developer;
  assert.equal(dev.calls, 13);
  assert.deepEqual({ ...dev.byTool }, { Read: 3, Bash: 4, Grep: 1, Glob: 1, Edit: 2, Write: 1, Agent: 1 });
  assert.equal(dev.steps.develop.calls, 13);
  assert.equal(dev.byBashKind.git, 2);
  const kind = (re) => Object.entries(dev.byBashKind).find(([k]) => re.test(k))?.[1];
  assert.equal(kind(/test/i), 1, `one test command (got ${JSON.stringify(dev.byBashKind)})`);
  assert.equal(kind(/read/i), 1, `one read via Bash (got ${JSON.stringify(dev.byBashKind)})`);
  assert.ok(dev.rereadFiles[0].file.endsWith('src/a.js'), dev.rereadFiles[0].file);
  assert.equal(dev.rereadFiles[0].reads, 3);
  assert.equal(dev.searches.grep, 1);
  assert.equal(dev.searches.glob, 1);
  const editOf = (name) => dev.edits.find((e) => e.file.endsWith(name)) || {};
  assert.equal(editOf('src/a.js').edits, 2);
  assert.equal(editOf('src/b.js').writes, 1);
  assert.equal(dev.subagents, 1);
  assert.equal(r.agents.reviewer.calls, 1);
  assert.equal(r.agents.reviewer.steps.review.calls, 1);
});

test('#321 tools: failed calls by cause (an error, a non-zero exit code) and the test commands with their durations', async (t) => {
  const { ctx, runsDir } = makeCtx(t);
  writeRun(runsDir, RUN_TOOLS, EVENTS_TOOLS, SUMMARY_TOOLS);
  const dev = runOf((await analysis(ctx, { runIds: [RUN_TOOLS], focus: 'tools' })).data, RUN_TOOLS).agents.developer;
  assert.equal(dev.failed.total, 2, 'only the two results that failed, not every result');
  assert.match(JSON.stringify(dev.failed.byCause), /exit/i, 'a non-zero exit code is a cause of its own');
  assert.equal(dev.testCommands.length, 1);
  assert.match(dev.testCommands[0].command, /npm test -- test\/a\.test\.js/);
  assert.equal(dev.testCommands[0].durationMs, 2 * MIN);
  assert.equal(runOf((await analysis(ctx, { runIds: [RUN_TOOLS], focus: 'tools' })).data, RUN_TOOLS).agents.reviewer.failed.total, 0);
});

test('#321 the analyzer delegate counts as failed only the tool results that failed', async (t) => {
  const { api, runsDir } = makeCtx(t);
  writeRun(runsDir, RUN_TOOLS, EVENTS_TOOLS, SUMMARY_TOOLS);
  const out = await api['oracle:delegate']({ to: 'analyzer', question: 'How many tool calls failed?', runId: RUN_TOOLS, mock: true });
  assert.equal(out.error, false, out.text);
  assert.match(out.text, /14 tool calls/);
  assert.match(out.text, /\b2 failed\b/, `2 of the 14 results failed (got: ${out.text.split('\n')[0]})`);
});

// ---- cache ------------------------------------------------------------------------------------------

// k1 (Claude, subscription: 1 h cache): turn 2 three minutes after turn 1 (warm), turn 3 two hours
// after turn 2 (cold: 435K written, $6.46). g1 (Codex: no known lifetime) resumed after ~3 h.
// e1 opened with no turn. 5 turns in all.
const RUN_CACHE = 'run-321-cache';
const EVENTS_CACHE = [
  wfStarted(0),
  started(0, 'develop', 1, 'developer'), opened(0, 'k1', 'developer', 'develop'),
  opened(0, 'g1', 'coder', 'build', 'codex'), opened(0, 'e1', 'reviewer', 'review'),
  sent(0, 'k1', 1, 'develop'), recv(2, 'k1', 1, 'develop', 0.5, u(1000, 100, 0, 50000)),
  sent(0, 'g1', 1, 'build'), recv(1, 'g1', 1, 'build', 0.1, u(1000, 100, 0, 0)),
  sent(5, 'k1', 2, 'develop'), recv(6, 'k1', 2, 'develop', 0.1, u(100, 100, 50000, 0)),
  sent(126, 'k1', 3, 'develop'), recv(128, 'k1', 3, 'develop', 6.46, u(100, 1000, 0, 435000)),
  sent(200, 'g1', 2, 'build'), recv(201, 'g1', 2, 'build', 0.1, u(1000, 100, 0, 0)),
  finished(201, 'develop', 1),
  wfFinished(201),
];
const SUMMARY_CACHE = summaryOf(RUN_CACHE, 201, {
  sessions: [
    { id: 'k1', agent: 'developer', provider: 'claude', step_id: 'develop', turns: 3, cost_usd: 7.06, tokens: u(1200, 1200, 50000, 485000) },
    { id: 'g1', agent: 'coder', provider: 'codex', step_id: 'build', turns: 2, cost_usd: 0.2, tokens: u(2000, 200, 0, 0) },
    { id: 'e1', agent: 'reviewer', provider: 'claude', step_id: 'review', turns: 0, cost_usd: 0, tokens: u(0, 0, 0, 0) },
  ],
});

test('#321 cache: the turns that resumed a Claude session past its cache lifetime, with the cache written, the cost and their share', async (t) => {
  const { ctx, runsDir } = makeCtx(t);
  writeRun(runsDir, RUN_CACHE, EVENTS_CACHE, SUMMARY_CACHE);
  const { data } = await analysis(ctx, { runIds: [RUN_CACHE], focus: 'cache' });
  const r = runOf(data, RUN_CACHE);
  assert.equal(r.turns, 5, 'every turn counts, the session without turns adds none');
  assert.equal(r.cold.count, 1, 'only the Claude resume after 2 h (Codex has no known lifetime)');
  const [cold] = r.cold.turns;
  assert.equal(cold.agent, 'developer');
  assert.equal(cold.turn, 3);
  assert.equal(cold.gapMs, 120 * MIN);
  assert.equal(cold.cacheWrite, 435000);
  near(cold.costUsd, 6.46, 'the cold turn\'s cost');
  assert.equal(r.cold.cacheWrite, 435000);
  near(r.cold.costUsd, 6.46, 'the run\'s cold cost');
  near(r.cold.share > 1 ? r.cold.share / 100 : r.cold.share, 0.2, 'one turn of five');
  assert.equal(data.total.turns, 5);
  assert.equal(data.total.cold.count, 1);
});

test('#321 cache: the lifetime is the app\'s cacheLifetimeMs, so a 2-hour resume of a Codex session is not called cold', async (t) => {
  const { cacheLifetimeMs } = require('../../src/domains/session/session-cache');
  assert.equal(cacheLifetimeMs('codex'), null, 'precondition: Codex has no known cache lifetime');
  const { ctx, runsDir } = makeCtx(t);
  writeRun(runsDir, RUN_CACHE, EVENTS_CACHE, SUMMARY_CACHE);
  const r = runOf((await analysis(ctx, { runIds: [RUN_CACHE], focus: 'cache' })).data, RUN_CACHE);
  assert.equal(r.cold.turns.some((x) => x.agent === 'coder' || x.session === 'g1'), false);
});

// ---- tests ------------------------------------------------------------------------------------------

const RUN_S1 = 'run-321-suite-1';
const RUN_S2 = 'run-321-suite-2';
const RUN_NOLOGS = 'run-321-no-logs';
const EVENTS_S1 = [
  wfStarted(0),
  started(0, 'tests', 1, 'test_writer'), opened(0, 'w1', 'test_writer', 'tests'), sent(0, 'w1', 1, 'tests'),
  tc(1, 'w1', 1, 'b1', 'Bash', { command: 'npx bddgen' }), tr(2, 'w1', 1, 'b1'),
  tc(2, 'w1', 1, 'b2', 'Bash', { command: 'npx playwright test --list --grep "@issue-1"' }), tr(3, 'w1', 1, 'b2'),
  tc(3, 'w1', 1, 'b3', 'Bash', { command: 'npm run screenshot -- --view backlog --out evidence' }), tr(5, 'w1', 1, 'b3'),
  tc(5, 'w1', 1, 'b4', 'Bash', { command: 'node --test test/a.test.js' }), tr(8, 'w1', 1, 'b4'),
  tc(8, 'w1', 1, 'b5', 'Bash', { command: 'git status' }), tr(8, 'w1', 1, 'b5'),
  recv(9, 'w1', 1, 'tests', 1), finished(9, 'tests', 1),
  wfFinished(9),
];
const simpleEvents = () => [wfStarted(0), started(0, 'develop', 1, 'developer'), finished(1, 'develop', 1), wfFinished(1)];

// a checkout with two test files: a.test.js declares "alpha one" and "alpha two", b.test.js "beta one"
function checkout(t) {
  const dir = scratchDir(t, 'oracle-321-repo-');
  fs.mkdirSync(path.join(dir, 'test'));
  fs.writeFileSync(path.join(dir, 'test', 'a.test.js'), "const test = require('node:test');\ntest('alpha one', () => {});\ntest('alpha two', () => {});\n");
  fs.writeFileSync(path.join(dir, 'test', 'b.test.js'), "const test = require('node:test');\ntest('beta one', () => {});\n");
  return dir;
}
function suiteRun(runsDir, id, events, repo, log) {
  const dir = writeRun(runsDir, id, events, summaryOf(id, 9, { inputs: { project_path: repo }, worktree: { dir: repo, work_dir: repo, repo, removed: false } }));
  if (log) {
    fs.mkdirSync(path.join(dir, 'logs'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'logs', 'tests-develop-1.log'), log);
  }
}
const LOG_S1 = '$ npm test\n✔ alpha one (1000ms)\n✔ alpha two (500ms)\n✖ beta one (3000ms)\nℹ pass 2\nℹ fail 1\n';
const LOG_S2 = '$ npm test\n✔ alpha one (3000ms)\n✔ beta one (3000ms)\n✔ gamma one (10ms)\nℹ pass 3\nℹ fail 0\n';

test('#321 tests: a run\'s suite log gives the time per test file (declared tests matched to the log) and the slowest tests', async (t) => {
  const { ctx, runsDir } = makeCtx(t);
  const repo = checkout(t);
  suiteRun(runsDir, RUN_S1, EVENTS_S1, repo, LOG_S1);
  const r = runOf((await analysis(ctx, { runIds: [RUN_S1], focus: 'tests' })).data, RUN_S1);
  assert.ok(r.files[0].file.endsWith('b.test.js'), `the slowest file first (got ${r.files[0].file})`);
  near(r.files[0].durationMs, 3000, 'b.test.js', 1);
  const a = r.files.find((f) => f.file.endsWith('a.test.js'));
  assert.ok(a, 'a.test.js is listed');
  near(a.durationMs, 1500, 'a.test.js', 1);
  assert.equal(a.tests, 2);
  assert.equal(r.slowest[0].test, 'beta one');
  near(r.slowest[0].durationMs, 3000, 'the slowest test', 1);
});

test('#321 tests: in the test step, the time and calls spent on E2E vs unit tests', async (t) => {
  const { ctx, runsDir } = makeCtx(t);
  suiteRun(runsDir, RUN_S1, EVENTS_S1, checkout(t), LOG_S1);
  const r = runOf((await analysis(ctx, { runIds: [RUN_S1], focus: 'tests' })).data, RUN_S1);
  assert.equal(r.testStep.e2e.calls, 3, 'bddgen, the playwright list and the screenshot');
  assert.equal(r.testStep.e2e.durationMs, 4 * MIN);
  assert.equal(r.testStep.unit.calls, 1);
  assert.equal(r.testStep.unit.durationMs, 3 * MIN);
});

test('#321 tests: with two runIds, the slowdown of the tests both ran', async (t) => {
  const { ctx, runsDir } = makeCtx(t);
  const repo = checkout(t);
  suiteRun(runsDir, RUN_S1, EVENTS_S1, repo, LOG_S1);
  suiteRun(runsDir, RUN_S2, simpleEvents(), repo, LOG_S2);
  const { data } = await analysis(ctx, { runIds: [RUN_S1, RUN_S2], focus: 'tests' });
  const tests = data.comparison.tests;
  const alpha = tests.find((x) => x.test === 'alpha one');
  assert.ok(alpha, 'alpha one ran in both');
  near(alpha.beforeMs, 1000, 'before', 1);
  near(alpha.afterMs, 3000, 'after', 1);
  assert.ok(tests.some((x) => x.test === 'beta one'), 'beta one ran in both');
  assert.equal(tests.some((x) => x.test === 'alpha two' || x.test === 'gamma one'), false, 'only the tests both ran');
});

test('#321 tests: a run without suite logs says so instead of failing', async (t) => {
  const { ctx, runsDir } = makeCtx(t);
  suiteRun(runsDir, RUN_NOLOGS, simpleEvents(), checkout(t), null);
  const r = runOf((await analysis(ctx, { runIds: [RUN_NOLOGS], focus: 'tests' })).data, RUN_NOLOGS);
  assert.equal((r.files || []).length, 0);
  assert.match(String(r.note || ''), /log/i);
});

// A run whose worktree is `worktree` (or none) and whose project checkout is `project`; the log is
// LOG_S1 unless given. The worktree declares "alpha one" in c.test.js, so the file named in the
// answer tells which checkout the names came from.
function otherCheckout(t) {
  const dir = scratchDir(t, 'oracle-321-wt-');
  fs.mkdirSync(path.join(dir, 'test'));
  fs.writeFileSync(path.join(dir, 'test', 'c.test.js'), "const test = require('node:test');\ntest('alpha one', () => {});\ntest('alpha two', () => {});\ntest('beta one', () => {});\n");
  return dir;
}
function fallbackRun(runsDir, id, { worktree, project, logs = { 'tests-develop-1.log': LOG_S1 } }) {
  const dir = writeRun(runsDir, id, simpleEvents(), summaryOf(id, 1, { inputs: { project_path: project }, worktree }));
  fs.mkdirSync(path.join(dir, 'logs'), { recursive: true });
  for (const [name, text] of Object.entries(logs)) fs.writeFileSync(path.join(dir, 'logs', name), text);
  return dir;
}
const fileNames = (r) => (r.files || []).map((f) => path.basename(f.file)).sort();

test('#321 tests: a removed worktree gives way to the project checkout, and the answer says the worktree is gone', async (t) => {
  const { ctx, runsDir } = makeCtx(t);
  const wt = otherCheckout(t);
  fallbackRun(runsDir, 'run-321-wt-removed', { worktree: { dir: wt, work_dir: wt, repo: wt, removed: true }, project: checkout(t) });
  const r = runOf((await analysis(ctx, { runIds: ['run-321-wt-removed'], focus: 'tests' })).data, 'run-321-wt-removed');
  assert.deepEqual(fileNames(r), ['a.test.js', 'b.test.js'], 'the names come from the project checkout, not the removed worktree');
  assert.match(String(r.note || ''), /worktree is gone/i);
});

test('#321 tests: a worktree folder that no longer exists gives way to the project checkout, with the note', async (t) => {
  const { ctx, runsDir } = makeCtx(t);
  const missing = path.join(scratchDir(t, 'oracle-321-gone-'), 'deleted-worktree');
  fallbackRun(runsDir, 'run-321-wt-missing', { worktree: { dir: missing, work_dir: missing, repo: missing, removed: false }, project: checkout(t) });
  const r = runOf((await analysis(ctx, { runIds: ['run-321-wt-missing'], focus: 'tests' })).data, 'run-321-wt-missing');
  assert.deepEqual(fileNames(r), ['a.test.js', 'b.test.js']);
  assert.match(String(r.note || ''), /worktree is gone/i);
});

test('#321 tests: a worktree still there is where the names come from, without the note', async (t) => {
  const { ctx, runsDir } = makeCtx(t);
  const wt = otherCheckout(t);
  fallbackRun(runsDir, 'run-321-wt-kept', { worktree: { dir: wt, work_dir: wt, repo: wt, removed: false }, project: checkout(t) });
  const r = runOf((await analysis(ctx, { runIds: ['run-321-wt-kept'], focus: 'tests' })).data, 'run-321-wt-kept');
  assert.deepEqual(fileNames(r), ['c.test.js']);
  assert.doesNotMatch(String(r.note || ''), /worktree is gone/i);
});

test('#321 tests: of several suite logs, only the newest is read', async (t) => {
  const { ctx, runsDir } = makeCtx(t);
  const dir = fallbackRun(runsDir, 'run-321-two-logs', {
    worktree: null, project: checkout(t),
    logs: { 'tests-develop-1.log': LOG_S2, 'tests-develop-2.log': LOG_S1 },
  });
  // the older log has the later name: the newest is chosen by time, not by name
  fs.utimesSync(path.join(dir, 'logs', 'tests-develop-2.log'), new Date('2026-10-05T10:00:00Z'), new Date('2026-10-05T10:00:00Z'));
  fs.utimesSync(path.join(dir, 'logs', 'tests-develop-1.log'), new Date('2026-10-05T11:00:00Z'), new Date('2026-10-05T11:00:00Z'));
  const r = runOf((await analysis(ctx, { runIds: ['run-321-two-logs'], focus: 'tests' })).data, 'run-321-two-logs');
  const a = r.files.find((f) => f.file.endsWith('a.test.js'));
  near(a.durationMs, 3000, 'a.test.js from the newest log (alpha one 3000ms), not both logs added up', 1);
  assert.equal(r.slowest.some((x) => x.test === 'alpha two'), false, 'nothing from the older log');
});

// ---- the 40 KB limit --------------------------------------------------------------------------------

// 30 runs of 10 steps, each step with a 4.5-minute tool call on a long command and two gaps.
function busyRun(runsDir, id) {
  const events = [wfStarted(0), opened(0, 's', 'developer', 'step-0')];
  for (let k = 0; k < 10; k++) {
    const step = `step-with-a-rather-long-name-number-${k}`;
    events.push(started(10 * k, step, 1, 'developer'), sent(10 * k, 's', k + 1, step),
      tc(10 * k + 0.5, 's', k + 1, `c${k}`, 'Bash', { command: `node scripts/a-long-script-name-${k}.js --with --many --options ${'y'.repeat(150)}` }),
      tr(10 * k + 5, 's', k + 1, `c${k}`), recv(10 * k + 6, 's', k + 1, step), finished(10 * k + 6, step, 1));
  }
  events.push(wfFinished(100));
  writeRun(runsDir, id, events, summaryOf(id, 100));
}

test('#321 a focus over many runs stays within 40 KB, shortened per run, with a note on how to get the details', async (t) => {
  const { ctx, runsDir } = makeCtx(t);
  const ids = Array.from({ length: 30 }, (_, i) => `run-321-busy-${String(i).padStart(2, '0')}`);
  for (const id of ids) busyRun(runsDir, id);
  const { data, text } = await analysis(ctx, { runIds: ids, focus: 'time' });
  assert.ok(Buffer.byteLength(text) <= 40 * 1024, `within 40 KB (got ${Buffer.byteLength(text)} bytes)`);
  assert.equal(data.runs.length, 30, 'every run is still answered, shortened');
  assert.match(String(data.note || ''), /runIds|fewer|one run/i);
});

// ---- regressions (#335) -----------------------------------------------------------------------------
// focus 'regressions': each regressed step (src/domains/run/step-regressions.js over the workspace's real runs) with
// its workflow, step, class (model), baseline vs recent cost and minutes and the run ids behind both.

const REG_WF = 'software-development.yaml';
// A real successful run of REG_WF on `day` (September 2026): one `test` step of `minutes`, costing `cost`.
function regressionRun(runsDir, id, day, { cost = 3, minutes = 10 } = {}) {
  const t0 = Date.parse('2026-09-01T10:00:00.000Z') + (day - 1) * 86400000;
  const iso = (m) => new Date(t0 + m * MIN).toISOString();
  const events = [
    { ts: iso(0), type: 'workflow.started', workflow: 'Software Development', file: REG_WF, mock: false, cost_accounting: 'per_turn' },
    { ts: iso(minutes), type: 'workflow.finished', status: 'success' },
  ];
  writeRun(runsDir, id, events, {
    run_id: id, workflow: 'Software Development', status: 'success', mock: false, cost_accounting: 'per_turn', turn_cost: 'max_result',
    started_at: iso(0), finished_at: iso(minutes), duration_ms: minutes * MIN, cost_usd: cost, tokens: u(0, 0, 0, 0),
    progress: [{ step: 'test', type: 'agent', durationMs: minutes * MIN }],
    sessions: [{ id: `s-${id}`, agent: 'test_writer', provider: 'claude', model: 'claude-opus-5-5', effort: 'high', step_id: 'test', turns: 1, cost_usd: cost, tokens: u(1000, 100, 0, 0) }],
  });
}
// 6 baseline runs (cost 3, 10 min) and 3 recent ones with `recent` options
function regressionHistory(runsDir, recent = {}) {
  for (let i = 1; i <= 6; i++) regressionRun(runsDir, `run-335-base-${i}`, i);
  for (let i = 1; i <= 3; i++) regressionRun(runsDir, `run-335-recent-${i}`, 6 + i, recent);
}

test('#335 FOCUSES has regressions, and the list stays sorted', () => {
  const { FOCUSES: list } = require('../../src/domains/oracle/oracle-run-focus');
  assert.equal(list.includes('regressions'), true);
  assert.deepEqual([...list], [...list].sort());
});

test('#335 run_analysis names the regressions focus in its description and schema', () => {
  const { oracleTools } = loadTools();
  const tool = oracleTools({ ws: {}, BUNDLED_SKILLS_DIR, runFolder: () => '' }).find((x) => x.name === 'run_analysis');
  assert.match(tool.description, /\bregressions\b/);
  assert.equal(tool.inputSchema.properties.focus.enum.includes('regressions'), true);
});

test('#335 regressions: a regressed step is listed with its workflow, step, model, baseline vs recent and the run ids', async (t) => {
  const { ctx, runsDir } = makeCtx(t);
  regressionHistory(runsDir, { cost: 4.5, minutes: 15 });
  const { text } = await analysis(ctx, { focus: 'regressions' });
  assert.match(text, /software-development\.yaml/);
  assert.match(text, /"test"/);
  assert.match(text, /claude-opus-5-5/);
  assert.match(text, /run-335-base-1|run-335-base-6/, 'a baseline run id');
  assert.match(text, /run-335-recent-3/, 'a recent run id');
  assert.match(text, /\b1\.5\b/, 'the recent cost per point');
  assert.match(text, /\b15\b/, 'the recent minutes');
});

test('#335 regressions: a workspace without regressions lists no regressed step', async (t) => {
  const { ctx, runsDir } = makeCtx(t);
  regressionHistory(runsDir);
  const { text } = await analysis(ctx, { focus: 'regressions' });
  assert.doesNotMatch(text, /run-335-recent-/, 'no regressed step, so no recent run ids');
  assert.doesNotMatch(text, /claude-opus-5-5/, 'no regressed class');
});

// ---- docs and skill ---------------------------------------------------------------------------------

test('#321 the Oracle skill and the docs list the run_analysis focuses', () => {
  const docs = ['skills/oracle/SKILL.md', 'README.md', 'docs/features/oracle-knowledge.md', 'docs/agents/capabilities.md'];
  for (const rel of docs) {
    const src = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    assert.match(src, /run_analysis/, `${rel} names run_analysis`);
    for (const f of ['time', 'context', 'tools', 'cache', 'tests']) assert.match(src, new RegExp(`\`${f}\``), `${rel} lists the ${f} focus`);
  }
  const skill = fs.readFileSync(path.join(ROOT, 'skills', 'oracle', 'SKILL.md'), 'utf8');
  assert.match(skill, /cold/i, 'the skill says which focus answers "was that resume cold"');
  assert.match(skill, /test file/i, 'the skill says which focus answers "which test file sets the suite\'s time"');
});
