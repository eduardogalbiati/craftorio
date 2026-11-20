// #860: a failed Claude turn says why. A `result` event with is_error (any subtype but
// error_max_turns) keeps the CLI's error details (its `errors` list) and the result text in the error,
// and a turn that fails with a provider error also carries the tail of the CLI's stderr (at most
// ~800 characters). error_max_turns keeps its #302 handling (not an error for the engine).
// Seams: the Claude adapter's parse (registry.byId('claude').parse, what the engine feeds each
// stream-json event to) and providers.runTurn on test/fixtures/fake-claude-during-execution.js (a
// local script, calls no model). runTurn refuses a real provider under MULTIAGENT_SIMULATION_ONLY,
// so each runTurn test lifts the guard and restores it after (like refactor-priority-real-turn-728).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const FAKE = path.join(__dirname, 'fixtures', 'fake-claude-during-execution.js');
const ERR1 = 'API Error: 404 {"type":"error","error":{"type":"not_found_error","message":"model: claude-opus-5-5"}}';
const ERR2 = 'MCP server "oracle" failed to start';
const STDERR_LINE = 'fake-claude-860: the CLI stopped while running the turn';
const TODAY = 'Claude returned an error: error_during_execution';

const loadParse = () => require('@multiagent/shared/providers').byId('claude').parse;
const loadProviders = () => require('../engine/providers');

// feeds one result event to the adapter; returns the accumulator
function parseResult(ev) {
  const parse = loadParse();
  const acc = { text: '', lastText: '', usage: null, costUsd: null, error: null };
  parse({ type: 'result', session_id: 's-860', total_cost_usd: 0, usage: { input_tokens: 1, output_tokens: 1 }, ...ev }, () => {}, acc);
  return acc;
}

// runs one turn on the fake CLI with `flags`; resolves with the error it fails with (or null)
async function failedTurn(t, flags = []) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-error-860-'));
  const sim = process.env.MULTIAGENT_SIMULATION_ONLY;
  delete process.env.MULTIAGENT_SIMULATION_ONLY;
  t.after(() => {
    if (sim === undefined) delete process.env.MULTIAGENT_SIMULATION_ONLY; else process.env.MULTIAGENT_SIMULATION_ONLY = sim;
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5 });
  });
  const { runTurn } = loadProviders();
  const { render } = require('../engine/run/templates');
  const provider = { type: 'claude-code', command: process.execPath, args: [FAKE, ...flags] };
  try {
    await runTurn({ provider, model: 'sonnet', prompt: 'Hello?', cwd: dir, extraArgs: [], timeoutMs: 60e3, render, hint: { stepId: 'test-860', visit: 1 } });
    return null;
  } catch (e) {
    return e;
  }
}

// --- the Claude adapter ----------------------------------------------------------------------------

test('#860 adapter: an error_during_execution result keeps its errors list after the subtype', () => {
  const acc = parseResult({ subtype: 'error_during_execution', is_error: true, result: '', errors: [ERR1, ERR2] });
  const msg = String(acc.error || '');
  assert.match(msg, /^Claude returned an error: error_during_execution/);
  assert.ok(msg.includes(ERR1), `the first error detail is in: ${msg}`);
  assert.ok(msg.includes(ERR2), `the second error detail is in: ${msg}`);
  assert.ok(msg.indexOf('error_during_execution') < msg.indexOf(ERR1), 'the details come after the subtype');
});

test('#860 adapter: an error result with both details and result text keeps both', () => {
  const acc = parseResult({ subtype: 'error_during_execution', is_error: true, result: 'Something broke', errors: [ERR2] });
  const msg = String(acc.error || '');
  assert.match(msg, /error_during_execution/);
  assert.ok(msg.includes(ERR2), `the error detail is in: ${msg}`);
  assert.ok(msg.includes('Something broke'), `the result text is in: ${msg}`);
});

test('#860 adapter: another error subtype keeps its details too', () => {
  const acc = parseResult({ subtype: 'error_max_budget_usd', is_error: true, result: '', errors: ['Budget of US$ 1 reached'] });
  const msg = String(acc.error || '');
  assert.match(msg, /error_max_budget_usd/);
  assert.ok(msg.includes('Budget of US$ 1 reached'), `the error detail is in: ${msg}`);
});

test('#860 adapter: an error result with no details and no text gives today\'s message', () => {
  const acc = parseResult({ subtype: 'error_during_execution', is_error: true, result: '' });
  assert.equal(String(acc.error || '').trim(), TODAY);
});

test('#860 adapter: an error result with an empty errors list gives today\'s message', () => {
  const acc = parseResult({ subtype: 'error_during_execution', is_error: true, result: '', errors: [] });
  assert.equal(String(acc.error || '').trim(), TODAY);
});

test('#860 adapter: an error result with only result text gives today\'s message with the text', () => {
  const acc = parseResult({ subtype: 'error_during_execution', is_error: true, result: 'Something broke' });
  assert.equal(String(acc.error || '').trim(), `${TODAY} Something broke`);
});

test('#860 adapter: error_max_turns stays a cut, not an error (#302), even with an errors list', () => {
  const acc = parseResult({ subtype: 'error_max_turns', is_error: true, num_turns: 4, result: '', errors: ['Reached maximum number of turns (4)'] });
  assert.equal(acc.error, null);
  assert.equal(acc.cut?.requests, 4);
});

// --- a turn through providers.runTurn --------------------------------------------------------------

test('#860 runTurn: a turn that ends with error_during_execution fails with the subtype, the error details and the stderr line', { timeout: 60000 }, async (t) => {
  const err = await failedTurn(t);
  assert.ok(err, 'the turn fails');
  const msg = String(err.message);
  assert.match(msg, /Claude returned an error: error_during_execution/);
  assert.ok(msg.includes(ERR1), `the first error detail is in: ${msg}`);
  assert.ok(msg.includes(ERR2), `the second error detail is in: ${msg}`);
  assert.ok(msg.includes(STDERR_LINE), `the stderr line is in: ${msg}`);
});

test('#860 runTurn: only the tail of a long stderr is added (at most about 800 characters)', { timeout: 60000 }, async (t) => {
  const err = await failedTurn(t, ['--long-stderr']);
  assert.ok(err, 'the turn fails');
  const msg = String(err.message);
  assert.ok(msg.includes(STDERR_LINE), `the end of stderr is in the message (length ${msg.length})`);
  assert.equal(msg.includes('HEAD-OF-STDERR-860'), false, 'the start of a 5,000-character stderr is cut');
  const tail = msg.slice(msg.indexOf(ERR2) + ERR2.length);
  assert.ok(tail.length <= 1000, `the stderr part is about 800 characters at most, got ${tail.length}`);
});

test('#860 runTurn: a turn with no details and no stderr fails with today\'s message', { timeout: 60000 }, async (t) => {
  const err = await failedTurn(t, ['--no-details']);
  assert.ok(err, 'the turn fails');
  assert.equal(String(err.message).trim(), TODAY);
});

test('#860 runTurn: a stderr of only whitespace adds nothing to the message', { timeout: 60000 }, async (t) => {
  const err = await failedTurn(t, ['--no-details', '--blank-stderr']);
  assert.ok(err, 'the turn fails');
  assert.equal(String(err.message).trim(), TODAY);
});

test('#860 runTurn: the message adds nothing from the engine\'s environment', { timeout: 60000 }, async (t) => {
  const key = 'MULTIAGENT_TEST_SECRET_860';
  process.env[key] = 'sk-secret-value-860';
  t.after(() => { delete process.env[key]; });
  const err = await failedTurn(t);
  assert.ok(err, 'the turn fails');
  assert.equal(String(err.message).includes('sk-secret-value-860'), false);
});
