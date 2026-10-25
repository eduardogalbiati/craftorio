// #320 internals of packages/engine/domains/session/session-cache.js the acceptance tests do not reach: the camelCase shape,
// the gate line's agents, old snapshots, the texts, the cache tier and the cache-write price.
const test = require('node:test');
const assert = require('node:assert/strict');
const sc = require('../../domains/session/session-cache');

const MIN = 60e3;
const HOUR = 60 * MIN;
const NOW = Date.parse('2026-10-12T12:00:00Z');
const ago = (ms) => new Date(NOW - ms).toISOString();

test('#320 currentTurn reads sessionView\'s camelCase and recomputes against the clock', () => {
  const view = { agent: 'reviewer', provider: 'claude', mode: 'persistent', turns: 2, lastTurnAt: ago(18 * MIN), contextTokens: 70000, hasNote: false, nextTurn: { kind: 'warm' } };
  assert.equal(sc.currentTurn(view, NOW).kind, 'warm');
  assert.equal(sc.currentTurn(view, NOW + HOUR).kind, 'cold', 'the cache expired since the view was built');
  assert.equal(sc.currentTurn({ ...view, nextTurn: null }, NOW), null, 'a null next turn is a closed session');
});

test('#320 currentTurn keeps the estimate it came with for a fresh turn, and prices a cold one', () => {
  const s = { agent: 'developer', mode: 'handoff', has_note: true, turns: 1, last_turn_at: ago(HOUR), next_turn: { kind: 'fresh', tokens: 20000 } };
  assert.equal(sc.currentTurn(s, NOW).tokens, 20000);
  const cold = { agent: 'builder', provider: 'claude', mode: 'persistent', turns: 1, last_turn_at: ago(3 * HOUR), context_tokens: 140000, cold_resume_usd: 0.7 };
  assert.equal(sc.currentTurn(cold, NOW).cost_usd, 0.7);
});

test('#320 a snapshot from before #320 (turns, no last turn) has no state; the orchestrator neither', () => {
  assert.equal(sc.nextTurn({ agent: 'reviewer', provider: 'claude', mode: 'persistent', turns: 3 }, { now: NOW }), null);
  assert.equal(sc.nextTurn({ agent: 'orchestrator', provider: 'engine', turns: 0 }, { now: NOW }), null);
});

test('#320 an unknown lifetime (Codex) resumes without a warm or cold guess', () => {
  const t = sc.nextTurn({ agent: 'reviewer', provider: 'codex', mode: 'persistent', turns: 1, last_turn_at: ago(10 * MIN), context_tokens: 50000 }, { now: NOW });
  assert.equal(t.kind, 'resume');
  assert.match(sc.turnText(t, NOW), /^resumes · ~50K tokens · cache lifetime unknown$/);
});

test('#320 agentNextTurns: the latest session per agent, a closed handoff session with its note is fresh', () => {
  const turns = sc.agentNextTurns([
    { id: 's1', agent: 'reviewer', provider: 'claude', mode: 'persistent', turns: 1, last_turn_at: ago(3 * HOUR), closed_at: ago(2 * HOUR) },
    { id: 's3', agent: 'reviewer', provider: 'claude', mode: 'persistent', turns: 1, last_turn_at: ago(10 * MIN), context_tokens: 60000 },
    { id: 's2', agent: 'developer', mode: 'handoff', has_note: true, turns: 1, last_turn_at: ago(HOUR), closed_at: ago(HOUR), start_context_tokens: 21000 },
    { id: 's4', agent: 'builder', mode: 'persistent', turns: 1, last_turn_at: ago(HOUR), closed_at: ago(HOUR) },
    { id: 'orchestrator', agent: 'orchestrator' },
  ], NOW);
  assert.deepEqual(turns.map((x) => [x.agent, x.turn.kind]), [['reviewer', 'warm'], ['developer', 'fresh']]);
  assert.equal(turns[1].turn.tokens, 21000);
  assert.equal(sc.continueText(turns), 'Continue: every agent starts fresh or warm · reviewer resumes warm ~60K · developer fresh from note ~21K');
  assert.equal(sc.continueText([]), 'Continue: no agent session to resume');
});

test('#320 the texts lead with the state; a closed session reads a dash', () => {
  assert.equal(sc.turnText({ kind: 'warm', until: NOW + 42 * MIN - 500 }, NOW), 'warm · 42 min left');
  assert.equal(sc.turnText({ kind: 'warm', until: NOW + 10 }, NOW), 'warm · 1 min left');
  assert.match(sc.turnText({ kind: 'cold', since: NOW - HOUR, tokens: 337000, cost_usd: 3.37 }, NOW), /^cold since \d{2}:\d{2} · ~337K tokens ≈ \$3\.37$/);
  assert.equal(sc.turnText({ kind: 'new' }), 'new session');
  assert.equal(sc.turnText(null), '—');
  assert.match(sc.turnTitle({ kind: 'warm' }), /estimate/);
  assert.equal(sc.gateTurnText({ kind: 'cold', tokens: 140000, cost_usd: 0.7 }), 'resumes cold ~140K ≈ $0.70');
});

test('#320 the cache tier Claude\'s usage reports wins over the auth\'s default', () => {
  assert.equal(sc.cacheTier({ cache_creation: { ephemeral_1h_input_tokens: 10, ephemeral_5m_input_tokens: 0 } }), '1h');
  assert.equal(sc.cacheTier({ cache_creation: { ephemeral_1h_input_tokens: 0, ephemeral_5m_input_tokens: 9 } }), '5m');
  assert.equal(sc.cacheTier({ input_tokens: 3 }), null);
  assert.equal(sc.cacheLifetimeMs('claude', { auth: 'api_key', tier: '1h' }), HOUR);
  assert.equal(sc.cacheLifetimeMs('codex', { tier: '1h' }), null, 'no lifetime for a provider nobody measured');
});

test('#320 cacheWriteUsd: the price\'s cache_write, else Claude\'s multiplier of the input price per lifetime', () => {
  assert.equal(sc.cacheWriteUsd(1e6, { input: 3, cache_write: 4 }, HOUR), 4);
  assert.equal(sc.cacheWriteUsd(1e6, { input: 3 }, HOUR), 6);
  assert.equal(sc.cacheWriteUsd(1e6, { input: 4 }, 5 * MIN), 5);
  assert.equal(sc.cacheWriteUsd(1e6, undefined, HOUR), null);
  assert.equal(sc.cacheWriteUsd(0, { input: 3 }, HOUR), null);
});
