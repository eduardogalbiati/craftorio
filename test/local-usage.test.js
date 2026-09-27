// Readers of the CLIs' own local logs, and the "this machine" usage scope.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { readLocalUsage, parseClaude, parseCodex, parseGrok } = require('../src/local-usage');
const usage = require('../src/usage');

const NOW = new Date('2026-09-27T12:00:00Z');
const jl = (...objs) => objs.map((o) => JSON.stringify(o)).join('\n') + '\n';

// Minimal files in the same shape the CLIs write (fields trimmed to what the readers use).
function fakeHome(t) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'home-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const claudeMsg = (id, session, input, output) => ({
    type: 'assistant', sessionId: session, requestId: `req-${id}`, timestamp: '2026-09-27T09:00:00Z',
    message: { id: `msg-${id}`, model: 'claude-opus-5-5', usage: { input_tokens: input, output_tokens: output, cache_read_input_tokens: 100, cache_creation_input_tokens: 10 } },
  });
  const cdir = path.join(home, '.claude', 'projects', 'C--proj');
  fs.mkdirSync(cdir, { recursive: true });
  // msg-1 is written twice while streaming: counted once
  fs.writeFileSync(path.join(cdir, 'a.jsonl'), jl({ type: 'user', message: { content: 'hi' } }, claudeMsg(1, 'orch-claude', 5, 50), claudeMsg(1, 'orch-claude', 5, 50), claudeMsg(2, 'interactive', 7, 70)) + 'not json\n');

  const xdir = path.join(home, '.codex', 'sessions', '2026', '09', '27');
  fs.mkdirSync(xdir, { recursive: true });
  const tokenCount = (ts, input, cached, output, used) => ({
    timestamp: ts, type: 'event_msg',
    payload: { type: 'token_count', info: { last_token_usage: { input_tokens: input, cached_input_tokens: cached, output_tokens: output, reasoning_output_tokens: 1 } },
      rate_limits: { plan_type: 'plus', primary: { used_percent: used, window_minutes: 300, resets_at: 1790000000 }, secondary: { used_percent: 12, window_minutes: 10080 }, credits: { has_credits: true, unlimited: false, balance: 42 } } },
  });
  fs.writeFileSync(path.join(xdir, 'rollout-2026-09-27T09-00-00-x.jsonl'), jl(
    { timestamp: '2026-09-27T09:00:00Z', type: 'session_meta', payload: { id: 'codex-thread' } },
    { timestamp: '2026-09-27T09:00:01Z', type: 'turn_context', payload: { model: 'gpt-6-luna' } },
    tokenCount('2026-09-27T09:00:05Z', 1000, 800, 20, 30),
    tokenCount('2026-09-27T09:00:09Z', 500, 400, 10, 35),
  ));

  const gdir = path.join(home, '.grok', 'sessions', 'C%3A%5Cproj', 'grok-session');
  fs.mkdirSync(gdir, { recursive: true });
  fs.writeFileSync(path.join(gdir, 'usage.json'), JSON.stringify({
    sessionId: 'grok-session', session: { primaryModelId: 'grok-4.7' },
    turns: [{ endedAt: '2026-09-02T10:00:00Z', inputTokens: 300, cachedReadTokens: 100, outputTokens: 20, reasoningTokens: 5, cacheCreationTokens: 0, costUsdTicks: 1e8 }],
  }));
  return home;
}

test('readLocalUsage reads Claude, Codex and Grok logs, deduplicating Claude chunks', (t) => {
  const r = readLocalUsage({ home: fakeHome(t) });
  const by = (p) => r.records.filter((x) => x.provider === p);
  assert.equal(by('claude').length, 2);
  assert.deepEqual(by('claude')[0].tokens, { input: 5, output: 50, cache_read: 100, cache_write: 10, reasoning: 0 });
  assert.equal(by('codex').length, 2);
  assert.deepEqual(by('codex')[0], { provider: 'codex', sessionId: 'codex-thread', model: 'gpt-6-luna', ts: '2026-09-27T09:00:05Z', tokens: { input: 200, output: 20, cache_read: 800, cache_write: 0, reasoning: 1 }, costUsd: null });
  assert.equal(by('grok')[0].costUsd, 0.01);
  assert.equal(by('grok')[0].tokens.input, 200); // cached tokens split out
  assert.deepEqual(r.found, { claude: true, codex: true, grok: true });
  // the latest Codex rate limits become the plan
  assert.equal(r.plans.codex.planType, 'plus');
  assert.deepEqual(r.plans.codex.windows.map((w) => [w.label, w.usedPercent]), [['5-hour window', 35], ['7-day window', 12]]);
  assert.deepEqual(r.plans.codex.credits, { hasCredits: true, unlimited: false, balance: 42 });
});

test('readLocalUsage tolerates a missing home and broken files', (t) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'home-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  assert.deepEqual(readLocalUsage({ home }).found, { claude: false, codex: false, grok: false });
  fs.mkdirSync(path.join(home, '.grok', 'sessions', 'x', 'y'), { recursive: true });
  fs.writeFileSync(path.join(home, '.grok', 'sessions', 'x', 'y', 'usage.json'), '{broken');
  assert.equal(readLocalUsage({ home }).records.length, 0);
  assert.deepEqual(parseClaude('garbage\n').records, []);
  assert.deepEqual(parseCodex('').records, []);
  assert.throws(() => parseGrok('{broken')); // the caller (cached) turns this into no records
});

test('machine scope: all local usage, the orchestrator part matched by session id, costs combined', (t) => {
  const local = readLocalUsage({ home: fakeHome(t) });
  const runsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'runs-'));
  t.after(() => fs.rmSync(runsDir, { recursive: true, force: true }));
  fs.mkdirSync(path.join(runsDir, 'r1'));
  fs.writeFileSync(path.join(runsDir, 'r1', 'summary.json'), JSON.stringify({
    run_id: 'r1', workflow: 'wf', status: 'success', started_at: '2026-09-27T08:59:00Z',
    sessions: [{ provider: 'claude', model: 'claude-opus-5-5', provider_session_id: 'orch-claude', turns: 1, tokens: { input: 5, output: 50, cache_read: 100, cache_write: 10, reasoning: 0 }, cost_usd: 0.25 }],
  }));
  const settings = { prices: { 'gpt-6-luna': { input: 1, output: 10, cache_read: 0.1 } }, budgets: { claude: { monthlyTokens: 1000, countOutside: true } } };

  const orch = usage.computeUsage({ runsDir, settings, now: NOW });
  const machine = usage.computeUsage({ runsDir, settings, now: NOW, scope: 'machine', local });
  const c = machine.providers.find((p) => p.id === 'claude');
  assert.equal(orch.scope, 'orchestrator');
  assert.equal(machine.scope, 'machine');
  assert.equal(orch.providers[0].month.tokens.total, 165);
  assert.equal(c.month.tokens.total, 165 + 187); // orchestrator session + the interactive one
  assert.equal(c.orchestrator.tokens.total, 165);
  assert.equal(c.month.costUsd, 0.25); // reported by the run; the interactive session has no cost and no price
  assert.equal(c.month.unpricedTokens, 187);
  const x = machine.providers.find((p) => p.id === 'codex');
  assert.ok(Math.abs(x.month.costUsd - (300 * 1 + 30 * 10 + 1200 * 0.1) / 1e6) < 1e-12); // estimated from prices
  assert.equal(x.plan.planType, 'plus');
  assert.equal(machine.providers.find((p) => p.id === 'grok').today.tokens.total, 0); // 2 Sep: month only
  assert.equal(machine.totals.month.tokens.total, 352 + 1530 + 320);

  // a countOutside budget uses the machine totals; the others keep the orchestrator's
  const base = usage.budgetBaseline({ runsDir, settings, now: NOW, local });
  assert.equal(base.claude.usedTokens, 352);
  assert.equal(base.claude.countOutside, true);
  assert.equal(base.codex.usedTokens, 0);
});
