// Usage aggregation, budgets, preflight and the Grok stream parser.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const usage = require('../../domains/usage/usage');
const { installCommand } = require('../../domains/machine/install-commands');
const { parseGrok } = require('../../engine/providers');
const { WorkflowRun } = require('../../engine/workflow');

const NOW = new Date('2026-09-27T12:00:00Z');

function runsDir(t, runs) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'usage-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  runs.forEach((r, i) => {
    fs.mkdirSync(path.join(dir, `r${i}`));
    fs.writeFileSync(path.join(dir, `r${i}`, 'summary.json'), JSON.stringify({ run_id: `r${i}`, workflow: 'wf', status: 'success', ...r }));
  });
  return dir;
}
const session = (provider, model, input, output, cost) => ({ provider, model, turns: 1, tokens: { input, output, cache_read: 0, cache_write: 0, reasoning: 0 }, cost_usd: cost });

test('computeUsage aggregates month/today per provider, skips mock runs and estimates unreported cost', (t) => {
  const dir = runsDir(t, [
    { started_at: '2026-09-27T09:00:00Z', sessions: [session('claude', 'claude-opus-5-5', 1000, 500, 0.5), session('codex', 'gpt-6-luna', 2_000_000, 1_000_000, 0)] },
    { started_at: '2026-09-02T09:00:00Z', sessions: [session('grok', 'grok-4.7', 100, 50, 0.01)] },
    { started_at: '2026-08-30T09:00:00Z', sessions: [session('claude', 'claude-opus-5-5', 9999, 9999, 9)] }, // last month
    { started_at: '2026-09-27T10:00:00Z', mock: true, sessions: [session('claude', 'x', 5, 5, 5)] },
    { started_at: '2026-09-27T10:00:00Z', sessions: [{ provider: 'engine', model: 'engine', tokens: {}, cost_usd: 0 }] },
  ]);
  const settings = { prices: { 'gpt-6-luna': { input: 1, output: 4, cache_read: 0.1 } }, budgets: { claude: { monthlyUsd: 0.6 }, codex: { monthlyTokens: 10_000_000 } } };
  const u = usage.computeUsage({ runsDir: dir, settings, now: NOW, installed: { claude: true, codex: true, grok: false } });
  const by = Object.fromEntries(u.providers.map((p) => [p.id, p]));

  assert.equal(u.month, '2026-09');
  assert.equal(by.claude.month.tokens.total, 1500);
  assert.equal(by.claude.month.costUsd, 0.5);
  assert.equal(by.claude.status, 'warn'); // 0.5 of 0.6
  assert.equal(by.codex.month.costUsd, 6); // 2M * $1 + 1M * $4
  assert.equal(by.codex.usedPctTokens, 0.3);
  assert.equal(by.codex.status, 'ok');
  assert.equal(by.grok.month.runs, 1);
  assert.equal(by.grok.today.tokens.total, 0);
  assert.equal(by.grok.installed, false);
  assert.equal(u.totals.today.tokens.total, 1500 + 3_000_000);
  assert.deepEqual(u.runs.map((r) => r.runId), ['r0', 'r1', 'r2']); // newest first, mock and engine-only excluded
});

test('computeUsage counts unpriced tokens and includes the live run once', (t) => {
  const dir = runsDir(t, [{ started_at: '2026-09-27T09:00:00Z', sessions: [session('codex', 'gpt-6-luna', 100, 0, 0)] }]);
  const live = { run_id: 'r0', workflow: 'wf', started_at: '2026-09-27T09:00:00Z', sessions: [session('codex', 'gpt-6-luna', 300, 0, 0)] };
  const u = usage.computeUsage({ runsDir: dir, now: NOW, live });
  const codex = u.providers.find((p) => p.id === 'codex');
  assert.equal(codex.month.tokens.total, 300); // live replaces the stale summary of the same run
  assert.equal(codex.month.unpricedTokens, 300);
  assert.equal(u.live, true);
  assert.equal(u.runs[0].status, 'running');
});

test('totalTokens sums input, output, cache read and cache write; reasoning is already counted in output', () => {
  assert.equal(usage.totalTokens({ input: 202, output: 78524, cache_read: 14422800, cache_write: 209122, reasoning: 9000 }), 14710648);
  assert.equal(usage.totalTokens({}), 0);
  assert.equal(usage.totalTokens(), 0);
});

test('engine blocks a turn when the provider budget is exhausted and warns at 80%', () => {
  const run = new WorkflowRun({
    file: path.join(__dirname, '..', 'fixtures', 'fanout.yaml'), inputs: {}, mock: true, runsDir: os.tmpdir(),
    budget: { claude: { name: 'Claude Code', limitUsd: 1, usedUsd: 0.85, blockOnLimit: true }, codex: { limitTokens: 100, usedTokens: 150, blockOnLimit: false } },
  });
  const events = [];
  run.on('event', (e) => events.push(e));
  run.checkBudget('claude');
  assert.ok(events.some((e) => e.type === 'log' && /85% of its monthly budget/.test(e.message)));
  run.budget.claude.usedUsd = 1.2;
  assert.throws(() => run.checkBudget('claude'), /Monthly budget for Claude Code reached \(\$1\.20 of \$1\)/);
  assert.doesNotThrow(() => run.checkBudget('codex')); // over, but blockOnLimit is off
  assert.ok(events.some((e) => e.type === 'budget.exceeded' && e.provider === 'codex' && e.blocked === false));
  assert.doesNotThrow(() => run.checkBudget('grok')); // no budget
});

test('concurrent runs share the budgets: the engine counts the other runs, preflight adds their usage', () => {
  const peers = [];
  const run = new WorkflowRun({
    file: path.join(__dirname, '..', 'fixtures', 'fanout.yaml'), inputs: {}, mock: true, runsDir: os.tmpdir(),
    budget: { claude: { name: 'Claude Code', limitUsd: 1, usedUsd: 0.5, blockOnLimit: true } },
    peerSessions: () => peers,
  });
  assert.doesNotThrow(() => run.checkBudget('claude'));
  peers.push({ provider: 'claude', model: 'm', tokens: { input: 10 }, costUsd: 0.6 }, { provider: 'codex', model: 'm', tokens: {}, costUsd: 5 });
  assert.throws(() => run.checkBudget('claude'), /Monthly budget for Claude Code reached \(\$1\.10 of \$1\)/);

  const budget = { claude: { limitUsd: 1, usedUsd: 0.5, usedTokens: 5, blockOnLimit: true } };
  const merged = usage.withPeerUsage(budget, peers);
  assert.equal(merged.claude.usedUsd, 1.1);
  assert.equal(merged.claude.usedTokens, 15);
  assert.equal(budget.claude.usedUsd, 0.5); // the baseline is not changed
});

test('withPeerUsage (#369): a peer turn with no known price counts the CLI\'s figure toward the budget', () => {
  const budget = { claude: { limitUsd: 1, usedUsd: 0.5, usedTokens: 0, blockOnLimit: true } };
  const peers = [{ provider: 'claude', model: 'claude-unknown-9', tokens: { input: 10 }, costUsd: 0, cliOnlyUsd: 0.185 }];
  const merged = usage.withPeerUsage(budget, peers);
  assert.ok(Math.abs(merged.claude.usedUsd - 0.685) < 1e-9, `usedUsd ${merged.claude.usedUsd}`);
});

test('checkBudget (#369): a peer run\'s CLI-only figure (no price for its model) can reach the monthly budget', () => {
  const peers = [{ provider: 'claude', model: 'claude-unknown-9', tokens: { input: 10 }, costUsd: 0, cliOnlyUsd: 0.185 }];
  const run = new WorkflowRun({
    file: path.join(__dirname, '..', 'fixtures', 'fanout.yaml'), inputs: {}, mock: true, runsDir: os.tmpdir(),
    budget: { claude: { name: 'Claude Code', limitUsd: 0.6, usedUsd: 0.5, blockOnLimit: true } },
    peerSessions: () => peers,
  });
  assert.throws(() => run.checkBudget('claude'), /Monthly budget for Claude Code reached/);
});

test('computeUsage providers (#147): claude/codex carry the play button\'s install command and note; Grok keeps its prose hint', (t) => {
  const dir = runsDir(t, []);
  const u = usage.computeUsage({ runsDir: dir, now: NOW });
  const by = Object.fromEntries(u.providers.map((p) => [p.id, p]));
  assert.equal(by.claude.installCommand, installCommand('claude'));
  assert.equal(by.claude.installNote, 'then run `claude` once to log in');
  assert.equal(by.claude.installHint, `${installCommand('claude')}   (then run \`claude\` once to log in)`);
  assert.equal(by.codex.installCommand, installCommand('codex'));
  assert.equal(by.codex.installHint, `${installCommand('codex')}   (then \`codex login\`)`);
  assert.equal(by.grok.installCommand, null);
  assert.equal(by.grok.installHint, 'install Grok Build from x.ai (then `grok login`)');
});

test('preflight reports missing CLIs and exhausted budgets', () => {
  const wf = { agents: { a: { provider: 'claude' }, b: { provider: 'grok' } }, providers: { claude: { type: 'claude-code', command: 'claude' }, grok: { type: 'grok-cli', command: 'grok' } } };
  const resolve = (cmd) => (cmd === 'claude' ? { file: 'claude.exe' } : null);
  const problems = usage.preflight(wf, { claude: { blockOnLimit: true, limitTokens: 10, usedTokens: 10 } }, resolve);
  assert.equal(problems.length, 2);
  assert.match(problems.join('\n'), /Grok Build is not installed/);
  assert.match(problems.join('\n'), /Claude Code already reached its monthly budget/);
  assert.deepEqual(usage.preflight(wf, {}, () => ({ file: 'x' })), []);
});

test('parseGrok turns a real grok streaming-json capture into items, final text, usage and cost', () => {
  const items = [];
  const acc = {};
  for (const line of fs.readFileSync(path.join(__dirname, '..', 'fixtures', 'grok-stream.ndjson'), 'utf8').trim().split('\n')) {
    parseGrok(JSON.parse(line), (i) => items.push(i), acc);
  }
  parseGrok.flush((i) => items.push(i), acc);
  assert.deepEqual(items.map((i) => i.kind).filter((k) => k !== 'context'), ['thinking', 'text', 'tool_call', 'tool_result', 'thinking', 'text', 'session', 'usage']);
  // each model request's context window (input + cached), from the per-call usage events
  assert.deepEqual(items.filter((i) => i.kind === 'context').map((i) => i.tokens), [15043 + 1792, 83 + 16896]);
  assert.equal(items.find((i) => i.kind === 'tool_call').name, 'list_dir');
  assert.equal(acc.text, '6'); // only the text after the last tool call
  assert.equal(acc.costUsd, 0.040184);
  assert.match(acc.providerSessionId, /^[0-9a-f-]{36}$/);
  assert.deepEqual(acc.usage, { input: 15126, output: 98, cache_read: 18688, cache_write: 0, reasoning: 54 });
});

test('preflight refuses missing or empty folder inputs', (t) => {
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'empty-'));
  t.after(() => fs.rmSync(empty, { recursive: true, force: true }));
  const wf = { inputs: { project_path: {}, task: {} }, agents: {}, providers: {} };
  assert.match(usage.preflight(wf, {}, () => null, { project_path: empty, task: 'x' }).join(), /is empty/);
  assert.match(usage.preflight(wf, {}, () => null, { project_path: path.join(empty, 'nope') }).join(), /does not exist/);
  assert.deepEqual(usage.preflight(wf, {}, () => null, { project_path: __dirname }), []);
});
