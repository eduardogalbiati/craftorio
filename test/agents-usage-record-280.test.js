// #280 acceptance tests (written before the code): one usage record for the Oracle, the Product Owner
// and the Supervisor chat. Every real turn appends a line with
//   { ts, agent, projectId (PO only), provider, model, tokens: { input, output, cache_read, cache_write },
//     costUsd, sessionId, session: 'fresh' | 'resumed', startReason (fresh only) }
// startReason: first, compaction, model-change, idle, reset, cleared or one-shot.
// Files: <workspace>/oracle/usage.jsonl, <workspace>/backlog/product-owner.usage.jsonl and (new)
// <workspace>/supervisor/usage.jsonl.
// Seams: createOracle (src/domains/oracle/oracle.js), productOwner.ask (src/domains/po/product-owner.js) and createSupervisorChat
// (src/domains/supervisor/supervisor-chat.js), each driven on a real turn (mock: false) whose provider CLI is faked at its
// boundary: engine/providers' runTurn is replaced on its exports for the test (the modules require it
// when a turn starts), so no CLI starts and no model is called. Simulated turns record nothing (as the
// Product Owner's ledger already does), so the real-turn path is the one under test. Time is mocked
// (node:test's Date mock) for the Oracle's idle rule (55 min).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const oracle = require('../src/domains/oracle/oracle');
const productOwner = require('../src/domains/po/product-owner');
const { createSupervisorChat } = require('../src/domains/supervisor/supervisor-chat');

const SKILLS = path.join(__dirname, '..', 'skills');
const USAGE = { input: 120, output: 30, cache_read: 400, cache_write: 50 };

function tmpDir(t, prefix = 'agents-280-') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

// The provider CLI boundary: each turn answers with the next usage of `usages` (else USAGE), US$ 0.1,
// and the provider session it was asked to resume (else a new one: sess-<n>).
function fakeCli(t, usages = []) {
  const providers = require('../src/engine/providers');
  const real = providers.runTurn;
  const calls = [];
  providers.runTurn = async (opts) => {
    calls.push(opts);
    const usage = { ...(usages[calls.length - 1] || USAGE) };
    return { text: 'Fake answer: no model was called.', usage, costUsd: 0.1, providerSessionId: opts.providerSessionId || `sess-${calls.length}`, exitCode: 0 };
  };
  t.after(() => { providers.runTurn = real; });
  return calls;
}

const readLines = (file) => fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const tokensOf = (line) => ({ input: line.tokens?.input, output: line.tokens?.output, cache_read: line.tokens?.cache_read, cache_write: line.tokens?.cache_write });

function makeOracle(dir, model = { current: 'claude-opus-5-5' }) {
  return oracle.createOracle({
    dir: () => dir,
    tools: () => [],
    bridge: { start: async () => ({ url: 'http://127.0.0.1:1', token: 'test' }) },
    mcpCommand: () => ({ command: 'node', args: [], env: {} }),
    skillsDirs: () => [],
    resolveCommand: () => 'claude',
    refuseReal: () => {},
    agent: () => ({ model: model.current, effort: 'high' }),
    settings: () => ({}),
  });
}

function makeChat(dir) {
  return createSupervisorChat({
    dir: () => dir,
    tools: () => [],
    bridge: { start: async () => ({ url: 'http://127.0.0.1:1', token: 'test' }) },
    mcpCommand: () => ({ command: 'node', args: [], env: {} }),
    skillsDirs: () => [],
    resolveCommand: () => 'claude',
    refuseReal: () => {},
  });
}

// ---- the Oracle (oracle/usage.jsonl keeps its file, with the new fields) -------------------------

test('#280 Oracle: the first turn appends a record with agent, provider, model, the four token kinds, cost, session id, fresh and startReason "first"', async (t) => {
  const dir = tmpDir(t);
  fakeCli(t);
  const o = makeOracle(dir);
  t.after(() => o.release());
  await o.ask({ question: 'turn 1', mock: false });

  const lines = readLines(path.join(dir, 'usage.jsonl'));
  assert.equal(lines.length, 1);
  const [u] = lines;
  assert.ok(!Number.isNaN(Date.parse(u.ts)), 'ts is a date');
  assert.equal(u.agent, 'oracle');
  assert.equal(u.provider, 'claude');
  assert.equal(u.model, 'claude-opus-5-5');
  assert.deepEqual(tokensOf(u), USAGE);
  assert.equal(u.costUsd, 0.1);
  assert.equal(u.sessionId, 'sess-1');
  assert.equal(u.session, 'fresh');
  assert.equal(u.startReason, 'first');
});

test('#280 Oracle: a resumed turn records session "resumed" in the same session, with no start reason', async (t) => {
  const dir = tmpDir(t);
  fakeCli(t);
  const o = makeOracle(dir);
  t.after(() => o.release());
  await o.ask({ question: 'turn 1', mock: false });
  await o.ask({ question: 'turn 2', mock: false });

  const [, second] = readLines(path.join(dir, 'usage.jsonl'));
  assert.equal(second.agent, 'oracle');
  assert.equal(second.sessionId, 'sess-1');
  assert.equal(second.session, 'resumed');
  assert.ok(second.startReason == null, `a resumed turn has no start reason (got ${second.startReason})`);
});

test('#280 Oracle: the turn after the context passed compactAtTokens starts fresh with startReason "compaction"', async (t) => {
  const dir = tmpDir(t);
  // the first answer leaves a 160,000-token context (over the default 150,000)
  fakeCli(t, [{ input: 160000, output: 10, cache_read: 0, cache_write: 0 }]);
  const o = makeOracle(dir);
  t.after(() => o.release());
  await o.ask({ question: 'turn 1', mock: false });
  await o.ask({ question: 'turn 2', mock: false });

  const [, second] = readLines(path.join(dir, 'usage.jsonl'));
  assert.equal(second.session, 'fresh');
  assert.equal(second.startReason, 'compaction');
  assert.notEqual(second.sessionId, 'sess-1');
});

test('#280 Oracle: the turn after the Oracle\'s model changed starts fresh with startReason "model-change" and the new model', async (t) => {
  const dir = tmpDir(t);
  fakeCli(t);
  const model = { current: 'claude-opus-5-5' };
  const o = makeOracle(dir, model);
  t.after(() => o.release());
  await o.ask({ question: 'turn 1', mock: false });
  model.current = 'claude-sonnet-5';
  await o.ask({ question: 'turn 2', mock: false });

  const [, second] = readLines(path.join(dir, 'usage.jsonl'));
  assert.equal(second.session, 'fresh');
  assert.equal(second.startReason, 'model-change');
  assert.equal(second.model, 'claude-sonnet-5');
});

test('#280 Oracle: the idle restart (last turn over 55 min ago) is recorded: fresh with startReason "idle"', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-10-03T08:00:00Z') });
  const dir = tmpDir(t);
  fakeCli(t);
  const o = makeOracle(dir);
  t.after(() => o.release());
  await o.ask({ question: 'turn 1', mock: false });
  t.mock.timers.tick(60 * 60e3);
  await o.ask({ question: 'turn 2, an hour later', mock: false });

  const [first, second] = readLines(path.join(dir, 'usage.jsonl'));
  assert.equal(first.startReason, 'first');
  assert.equal(second.session, 'fresh');
  assert.equal(second.startReason, 'idle');
  assert.notEqual(second.sessionId, first.sessionId);
});

test('#280 Oracle: the turn after a manual reset (New session) starts fresh with startReason "reset"', async (t) => {
  const dir = tmpDir(t);
  fakeCli(t);
  const o = makeOracle(dir);
  t.after(() => o.release());
  await o.ask({ question: 'turn 1', mock: false });
  await o.reset();
  await o.ask({ question: 'turn 2', mock: false });

  const [, second] = readLines(path.join(dir, 'usage.jsonl'));
  assert.equal(second.session, 'fresh');
  assert.equal(second.startReason, 'reset');
});

// ---- the Product Owner (backlog/product-owner.usage.jsonl keeps its file) ------------------------

test('#280 Product Owner: a real question appends a record with agent, projectId, the four token kinds, the CLI session id, fresh and startReason "one-shot"', async (t) => {
  const dir = tmpDir(t);
  const folder = tmpDir(t, 'agents-280-project-');
  fakeCli(t);
  await productOwner.ask({
    backlogDir: dir,
    projectId: 'demo',
    runsDir: path.join(dir, 'runs'),
    question: 'What should we do next?',
    data: { projectId: 'demo', issues: [{ number: 1, state: 'open', title: 'A', labels: [], body: 'x' }] },
    activeRuns: [],
    runs: [],
    workflows: [{ file: 'software-development.yaml', name: 'Software development' }],
    folder,
    agent: { model: 'claude-opus-5-5', effort: 'high' },
    skillsDirs: [SKILLS],
    resolveCommand: () => 'claude',
    mock: false,
  });

  const lines = readLines(path.join(dir, 'product-owner.usage.jsonl'));
  assert.equal(lines.length, 1);
  const [u] = lines;
  assert.equal(u.agent, 'product-owner');
  assert.equal(u.projectId, 'demo');
  assert.equal(u.provider, 'claude');
  assert.equal(u.model, 'claude-opus-5-5');
  assert.deepEqual(tokensOf(u), USAGE);
  assert.equal(u.costUsd, 0.1);
  assert.equal(u.sessionId, 'sess-1');
  assert.equal(u.session, 'fresh');
  assert.equal(u.startReason, 'one-shot');
});

// ---- the Supervisor chat (new: supervisor/usage.jsonl) ------------------------------------------

test('#280 Supervisor chat: the first turn writes supervisor/usage.jsonl with agent "supervisor", tokens, cost, session id, fresh and startReason "first"', async (t) => {
  const dir = tmpDir(t);
  fakeCli(t);
  const chat = makeChat(dir);
  await chat.ask({ question: 'How are my runs?', screen: 'Workflows', mock: false });

  const file = path.join(dir, 'usage.jsonl');
  assert.ok(fs.existsSync(file), 'supervisor/usage.jsonl exists');
  const lines = readLines(file);
  assert.equal(lines.length, 1);
  const [u] = lines;
  assert.ok(!Number.isNaN(Date.parse(u.ts)), 'ts is a date');
  assert.equal(u.agent, 'supervisor');
  assert.equal(u.provider, 'claude');
  assert.equal(u.model, 'claude-opus-5-5');
  assert.deepEqual(tokensOf(u), USAGE);
  assert.equal(u.costUsd, 0.1);
  assert.equal(u.sessionId, 'sess-1');
  assert.equal(u.session, 'fresh');
  assert.equal(u.startReason, 'first');
});

test('#280 Supervisor chat: a turn with the same model resumes: session "resumed", same session id, no start reason', async (t) => {
  const dir = tmpDir(t);
  fakeCli(t);
  const chat = makeChat(dir);
  await chat.ask({ question: 'turn 1', mock: false });
  await chat.ask({ question: 'turn 2', mock: false });

  const [, second] = readLines(path.join(dir, 'usage.jsonl'));
  assert.equal(second.sessionId, 'sess-1');
  assert.equal(second.session, 'resumed');
  assert.ok(second.startReason == null, `a resumed turn has no start reason (got ${second.startReason})`);
});

test('#280 Supervisor chat: a turn with another model starts fresh with startReason "model-change"', async (t) => {
  const dir = tmpDir(t);
  fakeCli(t);
  const chat = makeChat(dir);
  await chat.ask({ question: 'turn 1', mock: false });
  await chat.ask({ question: 'turn 2', model: 'claude-sonnet-5', mock: false });

  const [, second] = readLines(path.join(dir, 'usage.jsonl'));
  assert.equal(second.session, 'fresh');
  assert.equal(second.startReason, 'model-change');
  assert.equal(second.model, 'claude-sonnet-5');
});

test('#280 Supervisor chat: after Clear the next turn starts fresh with startReason "cleared", and Clear keeps the usage records', async (t) => {
  const dir = tmpDir(t);
  fakeCli(t);
  const chat = makeChat(dir);
  await chat.ask({ question: 'turn 1', mock: false });
  chat.clear();
  await chat.ask({ question: 'turn 2', mock: false });

  const lines = readLines(path.join(dir, 'usage.jsonl'));
  assert.equal(lines.length, 2, 'the first turn\'s record survives Clear');
  assert.equal(lines[1].session, 'fresh');
  assert.equal(lines[1].startReason, 'cleared');
});
