// #308 through the engine: a provider turn's whole-turn `usage`, its main conversation's `usage_main`,
// its `subagents` and `model_calls` reach session.message_received, the session's tokens in the run
// summary, Analytics › Run (runFigures) and the run report (supervisor.runReport); a turn without
// them (Codex, Grok, a run recorded before #308) records none of the new fields.
// Seam: WorkflowRun with providers.runTurn replaced by a fake turn (the real CLIs are refused in
// simulation and the mock provider never reports sub-agents). workflow.js binds runTurn when it
// loads, so it is required again after the stub and dropped from the cache afterwards.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const providers = require('../src/engine/providers');
const { runFigures } = require('../src/domains/run/run-analysis');
const { runReport } = require('../src/domains/supervisor/supervisor');

const WORKFLOW = path.resolve(__dirname, '../src/engine/workflow.js');
const tokens = (input, output, cacheRead, cacheWrite) => ({ input, output, cache_read: cacheRead, cache_write: cacheWrite, reasoning: 0 });

// two turns of agent "developer": the first started sub-agents, the second did not
const TURNS = [
  {
    text: 'mapped and changed', costUsd: 2, providerSessionId: 'p-308', exitCode: 0,
    usage: tokens(40, 500, 4000, 300), usage_main: tokens(30, 400, 3000, 200),
    subagents: { calls: 2, usage: tokens(10, 100, 1000, 100) }, model_calls: 5,
  },
  {
    text: 'done', costUsd: 1, providerSessionId: 'p-308', exitCode: 0,
    usage: tokens(5, 50, 500, 0), usage_main: tokens(5, 50, 500, 0), model_calls: 1,
  },
];

const YAML = `apiVersion: multiagent/v1
kind: Workflow
metadata: { name: subagent-tokens-308 }
agents:
  developer:
    provider: claude
    model: mock-model
    session: persistent
steps:
  - id: develop
    agent: developer
    prompt: "change it"
  - id: polish
    agent: developer
    prompt: "polish it"
`;

async function runWith(t, turns) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-308-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'wf.yaml');
  fs.writeFileSync(file, YAML);
  const original = providers.runTurn;
  let i = 0;
  providers.runTurn = async () => ({ ...structuredClone(turns[Math.min(i++, turns.length - 1)]) });
  delete require.cache[WORKFLOW];
  t.after(() => { providers.runTurn = original; delete require.cache[WORKFLOW]; });
  const { WorkflowRun } = require(WORKFLOW);
  const run = new WorkflowRun({ file, inputs: {}, mock: true, runsDir: path.join(dir, 'runs') });
  const events = [];
  run.on('event', (ev) => events.push(ev));
  await run.start();
  const finished = events.find((e) => e.type === 'workflow.finished');
  assert.equal(finished.status, 'success', finished.error);
  return { run, events, finished, received: events.filter((e) => e.type === 'session.message_received') };
}

test('session.message_received carries the turn\'s whole usage, its usage_main, subagents and model_calls', { timeout: 60000 }, async (t) => {
  const { received } = await runWith(t, TURNS);
  assert.equal(received.length, 2);
  const [first] = received;
  assert.deepEqual(first.usage, tokens(40, 500, 4000, 300));
  assert.deepEqual(first.usage_main, tokens(30, 400, 3000, 200));
  assert.equal(first.subagents.calls, 2);
  assert.deepEqual(first.subagents.usage, tokens(10, 100, 1000, 100));
  assert.equal(first.model_calls, 5);
});

test('a turn that started no sub-agents records no subagents field on its message_received', { timeout: 60000 }, async (t) => {
  const { received } = await runWith(t, TURNS);
  assert.equal('subagents' in received[1], false);
  assert.deepEqual(received[1].usage_main, tokens(5, 50, 500, 0));
});

test('a turn without the new figures (Codex, Grok) records none of usage_main, subagents, model_calls', { timeout: 60000 }, async (t) => {
  const { received } = await runWith(t, [{ text: 'done', costUsd: 0.5, providerSessionId: 'c-308', exitCode: 0, usage: { input: 400, output: 200, cache_read: 600, cache_write: 0, reasoning: 50 } }]);
  assert.ok(received.length >= 1);
  for (const ev of received) assert.deepEqual(['usage_main', 'subagents', 'model_calls'].filter((k) => k in ev), []);
});

test('the run summary\'s session tokens and Analytics › Run count whole turns and the sub-agents\' share', { timeout: 60000 }, async (t) => {
  const { events, finished } = await runWith(t, TURNS);
  const session = finished.summary.sessions.find((s) => s.agent === 'developer');
  assert.deepEqual({ input: session.tokens.input, output: session.tokens.output, cache_read: session.tokens.cache_read, cache_write: session.tokens.cache_write },
    { input: 45, output: 550, cache_read: 4500, cache_write: 300 });
  const dev = runFigures({ summary: finished.summary, events }).agents.find((a) => a.agent === 'developer');
  assert.equal(dev.totalTokens, 5395);
  // 10 + 100 + 1000 + 100
  assert.deepEqual(dev.subagents, { calls: 2, tokens: 1210 });
});

// the engine emits its events; the app's run store writes them to events.jsonl, which runReport reads
function reportOf(t, events) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'run-308-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(dir, 'events.jsonl'), `${events.map((e) => JSON.stringify(e)).join('\n')}\n`);
  return runReport(dir, { workflowsDir: dir });
}

test('the run report lists each agent\'s turns and whole-turn tokens, with the sub-agents\' share when its turns started some', { timeout: 60000 }, async (t) => {
  const { events } = await runWith(t, TURNS);
  const line = reportOf(t, events).split('\n').find((l) => /developer/.test(l) && /tokens/.test(l));
  assert.ok(line, 'a per-agent tokens line');
  assert.match(line, /2 turns, 5395 tokens/);
  assert.match(line, /of which sub-agents: 2 calls, 1210 tokens/);
});

test('the run report\'s line of an agent without sub-agents has its turns and tokens and no sub-agents', { timeout: 60000 }, async (t) => {
  const { events } = await runWith(t, [TURNS[1]]);
  const line = reportOf(t, events).split('\n').find((l) => /developer/.test(l) && /tokens/.test(l));
  assert.ok(line, 'a per-agent tokens line');
  assert.match(line, /2 turns, 1110 tokens/);
  assert.doesNotMatch(line, /sub-agents/);
});
