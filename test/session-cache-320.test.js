// #320: each agent session's prompt-cache state and what its next turn will re-read. Acceptance
// tests, written before the code.
//
// The seam: src/session-cache.js (one pure module, also loaded by the renderer and the Oracle)
//   cacheLifetimeMs(provider, { auth })  → the prompt cache's lifetime in ms: Claude 1 h on a
//     subscription (the default), 5 min with { auth: 'api_key' }; Codex and Grok null (unknown).
//   nextTurn(session, { now, lifetimeMs })  → null for a closed session, else { kind, ... }:
//     'fresh' (session: handoff, or idle past fresh_after_idle with a note), 'warm' (persistent,
//     last turn within the lifetime; `until` = the ms time the cache expires), 'cold' (persistent,
//     past the lifetime, no rotation; `since` = the ms time it expired, `tokens` = its context),
//     'new' (no turn yet, or ephemeral). lifetimeMs defaults to cacheLifetimeMs of the session's
//     provider (a simulated session: the provider it simulates).
// `session` is a session snapshot (WorkflowRun.snapshot, the `session` of session.* events), which
// now carries last_turn_at (ISO), context_tokens, mode, has_note and fresh_after_idle_ms, and a
// later event carries the snapshot after each turn. A recorded run (readRun) and sessionView give
// the same answer.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { WorkflowRun, loadWorkflow } = require('../src/engine/workflow');
const { Recorder } = require('../src/engine/recorder');

process.env.MULTIAGENT_MOCK_DELAY_SCALE = '0.05';
const load = () => require('../src/session-cache');
const FIXTURE = path.join(__dirname, 'fixtures', 'cache-state.yaml');
const MIN = 60e3;
const HOUR = 60 * MIN;
const NOW = Date.parse('2026-10-12T12:00:00Z');
const ago = (ms) => new Date(NOW - ms).toISOString();

// a persistent session of the reviewer, idle for `idle` ms
const persistent = (idle, extra = {}) => ({
  id: 's2', agent: 'reviewer', provider: 'claude', model: 'claude-sonnet-5', status: 'idle', closed_at: null,
  mode: 'persistent', turns: 3, last_turn_at: ago(idle), context_tokens: 140000, has_note: false, fresh_after_idle_ms: null,
  ...extra,
});

// ---- the cache lifetime ---------------------------------------------------------------------------

test('#320 cacheLifetimeMs: Claude 1 hour on a subscription, 5 minutes on an API key, Codex and Grok unknown', () => {
  const { cacheLifetimeMs } = load();
  assert.equal(cacheLifetimeMs('claude'), HOUR);
  assert.equal(cacheLifetimeMs('claude', { auth: 'api_key' }), 5 * MIN);
  assert.equal(cacheLifetimeMs('codex'), null);
  assert.equal(cacheLifetimeMs('grok'), null);
});

// ---- the next turn, one row of the issue's table per test -----------------------------------------

test('#320 nextTurn: a session: handoff agent starts fresh from its note', () => {
  const { nextTurn } = load();
  const s = persistent(3 * HOUR, { agent: 'developer', mode: 'handoff', has_note: true });
  assert.equal(nextTurn(s, { now: NOW, lifetimeMs: HOUR }).kind, 'fresh');
});

test('#320 nextTurn: a persistent session within the lifetime resumes warm until its last turn plus the lifetime', () => {
  const { nextTurn } = load();
  const t = nextTurn(persistent(18 * MIN), { now: NOW, lifetimeMs: HOUR });
  assert.equal(t.kind, 'warm');
  assert.equal(t.until, NOW + 42 * MIN, 'warm for 42 more minutes');
});

test('#320 nextTurn: a persistent session past the lifetime, with no rotation, resumes cold with its whole context', () => {
  const { nextTurn } = load();
  const t = nextTurn(persistent(3 * HOUR), { now: NOW, lifetimeMs: HOUR });
  assert.equal(t.kind, 'cold');
  assert.equal(t.since, NOW - 2 * HOUR, 'cold since its last turn plus the lifetime');
  assert.equal(t.tokens, 140000);
});

test('#320 nextTurn: idle past fresh_after_idle with a handoff note starts fresh from the note', () => {
  const { nextTurn } = load();
  const t = nextTurn(persistent(3 * HOUR, { has_note: true, fresh_after_idle_ms: 55 * MIN }), { now: NOW, lifetimeMs: HOUR });
  assert.equal(t.kind, 'fresh');
});

test('#320 nextTurn: the 55-minute boundary, warm just before fresh_after_idle, fresh just after', () => {
  const { nextTurn } = load();
  const opts = { now: NOW, lifetimeMs: HOUR };
  const at = (idle) => nextTurn(persistent(idle, { has_note: true, fresh_after_idle_ms: 55 * MIN }), opts).kind;
  assert.equal(at(55 * MIN - 1000), 'warm');
  assert.equal(at(55 * MIN + 1000), 'fresh');
});

test('#320 nextTurn: without a handoff note a persistent agent keeps resuming, warm then cold', () => {
  const { nextTurn } = load();
  const opts = { now: NOW, lifetimeMs: HOUR };
  const noNote = (idle) => nextTurn(persistent(idle, { has_note: false, fresh_after_idle_ms: 55 * MIN }), opts).kind;
  assert.equal(noNote(56 * MIN), 'warm', 'past fresh_after_idle but no note: no rotation, the cache is still warm');
  assert.equal(noNote(61 * MIN), 'cold');
});

test('#320 nextTurn: a 5-minute lifetime is never shown as warm for an hour', () => {
  const { nextTurn } = load();
  const opts = { now: NOW, lifetimeMs: 5 * MIN };
  assert.equal(nextTurn(persistent(4 * MIN), opts).kind, 'warm');
  assert.equal(nextTurn(persistent(4 * MIN), opts).until, NOW + MIN);
  // fresh_after_idle 55m is longer than this lifetime: no rotation yet, so the resume is cold
  assert.equal(nextTurn(persistent(10 * MIN, { has_note: true, fresh_after_idle_ms: 55 * MIN }), opts).kind, 'cold');
  assert.equal(nextTurn(persistent(10 * MIN), { now: NOW, lifetimeMs: load().cacheLifetimeMs('claude', { auth: 'api_key' }) }).kind, 'cold');
});

test('#320 nextTurn: no turn yet, or an ephemeral agent, is a new session', () => {
  const { nextTurn } = load();
  const opts = { now: NOW, lifetimeMs: HOUR };
  assert.equal(nextTurn(persistent(0, { turns: 0, last_turn_at: null, context_tokens: null }), opts).kind, 'new');
  assert.equal(nextTurn(persistent(3 * HOUR, { mode: 'ephemeral' }), opts).kind, 'new');
});

test('#320 nextTurn: a closed session has no state', () => {
  const { nextTurn } = load();
  const closed = persistent(18 * MIN, { status: 'success', closed_at: ago(18 * MIN) });
  assert.equal(nextTurn(closed, { now: NOW, lifetimeMs: HOUR }), null);
});

test('#320 nextTurn: a simulated session uses the lifetime of the provider it simulates', () => {
  const { nextTurn } = load();
  const sim = (idle) => persistent(idle, { provider: 'mock', simulates: 'claude' });
  assert.equal(nextTurn(sim(18 * MIN), { now: NOW }).kind, 'warm', 'Claude\'s hour, not unknown');
  assert.equal(nextTurn(sim(3 * HOUR), { now: NOW }).kind, 'cold');
});

// ---- the run's data: the snapshot at a gate, live and recorded ------------------------------------

// A mock run of the fixture that stops at its gate: returns the latest snapshot per agent seen at
// the gate, and the run read back from disk (readRun) at that moment.
async function atGate(t, file = FIXTURE) {
  const runsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cache-state-'));
  t.after(() => fs.rmSync(runsDir, { recursive: true, force: true, maxRetries: 5 }));
  const run = new WorkflowRun({ file, inputs: {}, mock: true, runsDir, mockSequences: { verdict: ['approved'] } });
  const rec = new Recorder(run.runDir);
  const events = [];
  let seen = null;
  run.on('event', (ev) => {
    rec.write(ev);
    events.push(ev);
    if (ev.type === 'approval.requested') {
      const latest = {};
      for (const e of events) if (e.session && typeof e.session === 'object' && e.session.agent) latest[e.session.agent] = e.session;
      const { readRun } = require('../src/runs');
      const recorded = readRun(runsDir, path.basename(run.runDir));
      seen = { latest, recorded, events: events.slice() };
      setImmediate(() => run.resolveApproval(ev.approval_id, true, 'user'));
    }
  });
  await run.start();
  assert.ok(seen, 'the run reached its gate');
  return seen;
}

test('#320 the session snapshot carries the cache state: last turn, context, mode, note, fresh_after_idle', { timeout: 60000 }, async (t) => {
  const before = Date.now();
  const { latest } = await atGate(t);
  const rev = latest.reviewer;
  assert.ok(rev, 'a snapshot of the reviewer\'s session');
  assert.equal(rev.mode, 'persistent');
  assert.equal(latest.developer?.mode, 'handoff');
  assert.ok(Number.isFinite(Date.parse(rev.last_turn_at)), `last_turn_at is a time (${rev.last_turn_at})`);
  assert.ok(Date.parse(rev.last_turn_at) >= before - 1000, 'the end of its last turn, in this run');
  assert.ok(rev.context_tokens > 0, 'its context at the last request');
  assert.equal(rev.has_note, true, 'the reviewer wrote a handoff note');
  assert.equal(rev.fresh_after_idle_ms, 30 * MIN);
  assert.equal(latest.developer.has_note, true);
  const { nextTurn } = load();
  const now = Date.parse(rev.last_turn_at);
  assert.equal(nextTurn(rev, { now: now + 10 * MIN, lifetimeMs: HOUR }).kind, 'warm');
  assert.equal(nextTurn(rev, { now: now + 45 * MIN, lifetimeMs: HOUR }).kind, 'fresh', 'past its fresh_after_idle, with a note');
});

test('#320 a recorded run rebuilt from its events gives the same cache state as the live run', { timeout: 60000 }, async (t) => {
  const { latest, recorded } = await atGate(t);
  assert.ok(recorded, 'readRun reads the run waiting at its gate');
  const rev = recorded.sessions.find((s) => s.agent === 'reviewer');
  assert.ok(rev, 'the recorded run has the reviewer\'s session');
  assert.equal(rev.last_turn_at, latest.reviewer.last_turn_at);
  assert.equal(rev.context_tokens, latest.reviewer.context_tokens);
  assert.equal(rev.has_note, true);
  const { nextTurn } = load();
  const now = Date.parse(rev.last_turn_at) + 20 * MIN;
  assert.equal(nextTurn(rev, { now, lifetimeMs: HOUR }).kind, nextTurn(latest.reviewer, { now, lifetimeMs: HOUR }).kind);

  // the shape the screens get (sessionView) carries the same state
  const { sessionView } = require('../src/service/common');
  const view = sessionView(rev, false);
  assert.equal(view.lastTurnAt, rev.last_turn_at);
  assert.equal(view.contextTokens, rev.context_tokens);
  assert.equal(view.hasNote, true);
  assert.equal(view.nextTurn?.kind, 'warm', 'just after the gate opened, the reviewer resumes warm');
});

test('#320 a persistent agent past its max_context starts its next turn fresh from its note: the gate says so, not warm', { timeout: 60000 }, async (t) => {
  // the fixture's reviewer with a max_context any turn exceeds: its next turn rotates (context_rotation)
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cache-rotate-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5 }));
  const file = path.join(dir, 'cache-rotate.yaml');
  const yaml = fs.readFileSync(FIXTURE, 'utf8').replace(/\r\n/g, '\n').replace('    fresh_after_idle: 30m\n', '    max_context: 1\n');
  assert.ok(/max_context: 1\n/.test(yaml), 'the fixture variant sets max_context');
  fs.writeFileSync(file, yaml);
  const { latest, events } = await atGate(t, file);
  assert.ok(events.some((e) => e.type === 'log' && e.kind === 'context_rotation' && e.agent === 'reviewer'), 'the reviewer\'s context passed its max_context');
  const rev = latest.reviewer;
  assert.equal(rev.has_note, true, 'the rotation saved the reviewer\'s handoff note');
  assert.equal(rev.next_turn?.kind, 'fresh', `the snapshot's next turn is ${JSON.stringify(rev.next_turn)}`);
  const { agentNextTurns } = load();
  const entry = agentNextTurns(Object.values(latest), Date.parse(rev.last_turn_at) + 5 * MIN).find((x) => x.agent === 'reviewer');
  assert.equal(entry?.turn.kind, 'fresh', 'the gate\'s Continue line says the reviewer starts fresh from its note');
});

test('#320 a real (non-simulated) Claude session with ANTHROPIC_API_KEY set: 5-minute lifetime; a cache tier the usage reports wins', () => {
  const { cacheLifetimeMs, cacheTier, nextTurn } = load();
  assert.equal(cacheLifetimeMs('claude', { auth: 'api_key', tier: cacheTier({ cache_creation: { ephemeral_1h_input_tokens: 10, ephemeral_5m_input_tokens: 0 } }) }), HOUR);
  assert.equal(cacheLifetimeMs('claude', { auth: 'subscription', tier: cacheTier({ cache_creation: { ephemeral_5m_input_tokens: 10 } }) }), 5 * MIN);
  // the snapshot's own lifetime is used when no lifetime is given
  const s = persistent(6 * MIN, { cache_lifetime_ms: 5 * MIN });
  assert.equal(nextTurn(s, { now: NOW }).kind, 'cold');
  assert.equal(nextTurn(persistent(4 * MIN, { cache_lifetime_ms: 5 * MIN }), { now: NOW }).kind, 'warm');
});

test('#320 Grok and Codex sessions resume with an unknown lifetime, never warm or cold', () => {
  const { nextTurn, turnText, gateTurnText } = load();
  for (const provider of ['grok', 'codex']) {
    const t = nextTurn(persistent(3 * HOUR, { provider, model: 'm' }), { now: NOW });
    assert.equal(t.kind, 'resume', provider);
    assert.equal(turnText(t, NOW), 'resumes · ~140K tokens · cache lifetime unknown');
    assert.equal(gateTurnText(t), 'resumes ~140K (cache lifetime unknown)');
  }
});

// ---- cold resumes become fresh by default ---------------------------------------------------------

const duration = (v) => {
  const m = /^(\d+(?:\.\d+)?)\s*(ms|s|m|h)$/.exec(String(v).trim());
  return m ? Number(m[1]) * { ms: 1, s: 1e3, m: MIN, h: HOUR }[m[2]] : NaN;
};

test('#320 every bundled workflow with a persistent agent sets fresh_after_idle in its defaults, within the Claude cache\'s hour', () => {
  const dir = path.join(__dirname, '..', 'workflows');
  const checked = [];
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.yaml')).sort()) {
    const wf = loadWorkflow(path.join(dir, f));
    const defaults = wf.defaults || {};
    const isPersistent = (a) => ({ ...defaults, ...a }.session || 'persistent') === 'persistent';
    if (!Object.values(wf.agents || {}).some(isPersistent)) continue;
    checked.push(f);
    const ms = duration(defaults.fresh_after_idle);
    assert.ok(ms > 0 && ms < HOUR, `${f}: defaults.fresh_after_idle is under the cache's hour (got ${defaults.fresh_after_idle})`);
  }
  assert.ok(checked.includes('ai-development-local-hero.yaml') && checked.includes('software-development.yaml'), `the bundled workflows with persistent agents were checked (${checked.join(', ')})`);
  const hero = loadWorkflow(path.join(dir, 'ai-development-local-hero.yaml'));
  assert.equal(hero.defaults.fresh_after_idle, '55m', 'the cache lifetime minus a margin, for Claude on a subscription');
});
