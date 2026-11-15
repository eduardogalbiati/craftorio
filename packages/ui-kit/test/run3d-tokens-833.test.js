// #833: the 3D view's tokens card. Run3DModel keeps each finished turn's tokens by kind (from
// session.message_received's `usage`, the engine's normalized kinds: input, output, cache_read,
// cache_write, the same TOKEN_KINDS Analytics reads in packages/engine/domains/run/run-analysis.js):
// tokens(filter) -> { input, output, cache_read, cache_write, total, cacheShare } and
// usdPerMTokens(filter) -> cost / (total / 1e6), null before the first turn ends. `filter` is the
// one cost(filter) takes: a predicate over a finished turn ({ agent, step, ... }).
const test = require('node:test');
const assert = require('node:assert/strict');
const M = require('../run3d-model');

const T0 = Date.parse('2026-11-15T10:00:00.000Z');
const at = (s) => new Date(T0 + s * 1000).toISOString();
let seq = 0;
const ev = (s, type, fields = {}) => ({ seq: ++seq, ts: at(s), run_id: 'run-833', type, ...fields });

const STEPS = [
  { id: 'develop', type: 'agent', agent: 'developer' },
  { id: 'test', type: 'agent', agent: 'test_writer' },
];
function started() {
  seq = 0;
  return [
    ev(0, 'workflow.started', { workflow: 'feature', file: 'feature.yaml', inputs: { task: 'Tokens card' }, steps: STEPS }),
    ev(0, 'session.opened', { session_id: 'orc', session: { agent: 'orchestrator', provider: 'engine' } }),
    ev(1, 'session.opened', { session_id: 's-dev', session: { agent: 'developer', provider: 'claude', model: 'claude-opus-5-5' } }),
    ev(1, 'session.opened', { session_id: 's-test', session: { agent: 'test_writer', provider: 'codex', model: 'gpt-6' } }),
  ];
}
const turn = (s, session, step, fields) => [
  ev(s, 'session.message_sent', { session_id: session, step_id: step, turn: 1 }),
  ev(s + 5, 'session.message_received', { session_id: session, step_id: step, turn: 1, text: 'done', ...fields }),
];
const model = (events) => {
  const m = new M.Run3DModel({ mainGates: [] });
  m.applyAll(events);
  return m;
};
const close = (actual, expected, msg) => assert.ok(Math.abs(actual - expected) < 1e-9, `${msg}: ${actual} != ${expected}`);

// develop: 750,000 tokens for $1.50 ($2.00/M); test: 250,000 tokens for $1.13 ($4.52/M), its provider
// reports no cache creation. The run: 1,000,000 tokens for $2.63, 550,000 of them cache reads.
const TWO_TURNS = () => [
  ...started(),
  ev(2, 'step.started', { step_id: 'develop', visit: 1, step_type: 'agent' }),
  ...turn(3, 's-dev', 'develop', { cost_usd: 1.5, usage: { input: 200000, output: 100000, cache_read: 400000, cache_write: 50000 } }),
  ev(10, 'step.finished', { step_id: 'develop', visit: 1 }),
  ev(11, 'step.started', { step_id: 'test', visit: 1, step_type: 'agent' }),
  ...turn(12, 's-test', 'test', { cost_usd: 1.13, usage: { input: 50000, output: 50000, cache_read: 150000 } }),
];

test('tokens(): the four kinds summed across the turns, and their total', () => {
  const t = model(TWO_TURNS()).tokens();
  assert.equal(t.input, 250000);
  assert.equal(t.output, 150000);
  assert.equal(t.cache_read, 550000);
  assert.equal(t.cache_write, 50000);
  assert.equal(t.total, 1000000);
});

test('tokens(): cacheShare is the cache reads over the total', () => {
  close(model(TWO_TURNS()).tokens().cacheShare, 0.55, 'cacheShare');
});

test('usdPerMTokens(): the cost over the millions of tokens of the four kinds ($2.63 over 1,000,000 tokens is 2.63)', () => {
  close(model(TWO_TURNS()).usdPerMTokens(), 2.63, 'usdPerMTokens');
});

test('usdPerMTokens(): null before the first turn ends', () => {
  const m = model([
    ...started(),
    ev(2, 'step.started', { step_id: 'develop', visit: 1, step_type: 'agent' }),
    ev(3, 'session.message_sent', { session_id: 's-dev', step_id: 'develop', turn: 1 }),
  ]);
  assert.equal(m.usdPerMTokens(), null);
});

test('tokens(): a kind the provider does not report counts 0', () => {
  const m = model(TWO_TURNS());
  const t = m.tokens((x) => x.step === 'test');
  assert.equal(t.cache_write, 0, 'no cache_write in the test turn\'s usage');
  assert.equal(t.total, 250000);

  const bare = model([...started(), ...turn(3, 's-dev', 'develop', { cost_usd: 0.2 })]).tokens();
  assert.deepEqual([bare.input, bare.output, bare.cache_read, bare.cache_write, bare.total], [0, 0, 0, 0, 0], 'a turn with no usage at all');
});

test('tokens() and usdPerMTokens(): a filter keeps the same turns cost(filter) keeps (by step, by agent)', () => {
  const m = model(TWO_TURNS());
  const dev = m.tokens((x) => x.step === 'develop');
  assert.deepEqual(
    [dev.input, dev.output, dev.cache_read, dev.cache_write, dev.total],
    [200000, 100000, 400000, 50000, 750000],
  );
  close(dev.cacheShare, 400000 / 750000, 'develop cacheShare');
  close(m.usdPerMTokens((x) => x.step === 'develop'), 2, 'develop $/M');

  const tw = m.tokens((x) => x.agent === 'test_writer');
  assert.equal(tw.total, 250000);
  close(tw.cacheShare, 0.6, 'test_writer cacheShare');
  close(m.usdPerMTokens((x) => x.agent === 'test_writer'), 4.52, 'test_writer $/M');
  close(m.cost((x) => x.agent === 'test_writer'), 1.13, 'cost(filter) keeps the same turn');
});
