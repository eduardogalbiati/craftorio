// #860: the Oracle's "could not answer" message says why a Claude turn failed: the CLI's subtype, the
// result event's error details and the tail of its stderr (the tester only got
// "Claude returned an error: error_during_execution"). Questions and wake-ups share the path.
// Seam: createOracle's ask / wake with mock: false, its CLI (PROVIDERS.claude, the provider the Oracle
// uses) pointed at this node + test/fixtures/fake-claude-during-execution.js for the test and
// restored after (like refactor-priority-real-turn-728); the fake calls no model. runTurn refuses a
// real provider under MULTIAGENT_SIMULATION_ONLY, so the guard is lifted for each test and restored.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const oracle = require('../../domains/oracle/oracle');

const FAKE = path.join(__dirname, '..', 'fixtures', 'fake-claude-during-execution.js');
const ERR1 = 'API Error: 404 {"type":"error","error":{"type":"not_found_error","message":"model: claude-opus-5-5"}}';
const ERR2 = 'MCP server "oracle" failed to start';
const STDERR_LINE = 'fake-claude-860: the CLI stopped while running the turn';

function makeOracle(t, flags = []) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oracle-error-860-'));
  const { PROVIDERS } = require('../../domains/workflow/workflow-builder');
  const claude = PROVIDERS.claude;
  const saved = { command: claude.command, args: claude.args };
  claude.command = process.execPath;
  claude.args = [FAKE, ...flags];
  const sim = process.env.MULTIAGENT_SIMULATION_ONLY;
  delete process.env.MULTIAGENT_SIMULATION_ONLY;
  const o = oracle.createOracle({
    dir: () => dir,
    tools: () => [],
    bridge: { start: async () => ({ url: 'http://127.0.0.1:9', token: 'test-token-860' }) },
    mcpCommand: () => ({ command: process.execPath, args: ['-e', ''], env: {} }),
    skillsDirs: () => [],
    resolveCommand: () => true,
    refuseReal: () => {},
    agent: () => ({ model: 'claude-opus-5-5', effort: 'high' }),
    settings: () => ({ oracle: { dailyBudgetUsd: 5 } }),
  });
  t.after(() => {
    o.release();
    claude.command = saved.command;
    claude.args = saved.args;
    if (sim === undefined) delete process.env.MULTIAGENT_SIMULATION_ONLY; else process.env.MULTIAGENT_SIMULATION_ONLY = sim;
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5 });
  });
  return o;
}

const hasAll = (text, parts) => parts.filter((p) => !text.includes(p));

test('#860 Oracle ask: a Claude turn that fails during execution posts a system message with the subtype, the error details and the stderr line', { timeout: 60000 }, async (t) => {
  const o = makeOracle(t);
  const { message } = await o.ask({ question: 'What happened in my last run?', mock: false });
  assert.equal(message?.role, 'system');
  assert.equal(message?.error, true);
  const text = String(message?.text || '');
  assert.match(text, /^The Oracle could not answer: Claude returned an error: error_during_execution/);
  assert.deepEqual(hasAll(text, [ERR1, ERR2, STDERR_LINE]), [], `missing from: ${text}`);
});

test('#860 Oracle ask: with partial text the message keeps the details and "Written before the error"', { timeout: 60000 }, async (t) => {
  const o = makeOracle(t, ['--partial']);
  const { message } = await o.ask({ question: 'What happened in my last run?', mock: false, onItem: () => {} });
  assert.equal(message?.error, true);
  const text = String(message?.text || '');
  assert.deepEqual(hasAll(text, [ERR1, ERR2, STDERR_LINE, 'Written before the error', 'Partial answer before the failure.']), [], `missing from: ${text}`);
  assert.ok(text.indexOf(ERR1) < text.indexOf('Written before the error'), 'the reason comes before the partial text');
});

test('#860 Oracle wake-up: a failed wake-up turn posts the details too', { timeout: 60000 }, async (t) => {
  const o = makeOracle(t);
  const out = await o.wake({ lines: ['Run r-860 failed at step implement.'], runIds: ['r-860'], mock: false });
  assert.equal(!!out?.refused, false, JSON.stringify(out?.refused || null));
  const failed = o.history().filter((m) => m.role === 'system' && m.error && m.wake);
  assert.equal(failed.length, 1, 'one failed wake-up message');
  const text = String(failed[0].text || '');
  assert.match(text, /^The Oracle could not answer the wake-up: Claude returned an error: error_during_execution/);
  assert.deepEqual(hasAll(text, [ERR1, ERR2, STDERR_LINE]), [], `missing from: ${text}`);
});

test('#860 Oracle ask: a failed turn with no details keeps today\'s message', { timeout: 60000 }, async (t) => {
  const o = makeOracle(t, ['--no-details']);
  const { message } = await o.ask({ question: 'What happened in my last run?', mock: false });
  assert.equal(message?.error, true);
  assert.equal(String(message?.text || '').trim(), 'The Oracle could not answer: Claude returned an error: error_during_execution');
});
