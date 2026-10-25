// src/domains/analytics/analytics.js: the date range default, the two computeAnalytics scopes and the small pure
// helpers the Analytics screen uses (complexity score/level, session intent).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { computeAnalytics, dateRange, complexityScore, complexityLevel, sessionIntent } = require('../../src/domains/analytics/analytics');

const NOW = new Date('2026-09-30T12:00:00Z');

function runsDir(t, runs) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'analytics-runs-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  runs.forEach((r, i) => {
    fs.mkdirSync(path.join(dir, `r${i}`));
    fs.writeFileSync(path.join(dir, `r${i}`, 'summary.json'), JSON.stringify({ run_id: `r${i}`, workflow: 'wf', status: 'success', sessions: [], ...r }));
  });
  return dir;
}
const tok = (input, output, cache_read = 0, cache_write = 0, reasoning = 0) => ({ input, output, cache_read, cache_write, reasoning });

// ---- dateRange -------------------------------------------------------------------------------

test('dateRange: defaults to the last 30 days ending today', () => {
  const r = dateRange({ now: NOW });
  assert.equal(r.to, '2026-09-30');
  assert.equal(r.from, '2026-09-01');
  assert.equal(r.days.length, 30);
  assert.equal(r.days[0], '2026-09-01');
  assert.equal(r.days[29], '2026-09-30');
});

test('dateRange: from after to is swapped', () => {
  const r = dateRange({ from: '2026-09-20', to: '2026-09-10', now: NOW });
  assert.deepEqual([r.from, r.to], ['2026-09-10', '2026-09-20']);
});

test('dateRange: invalid strings fall back to the default range', () => {
  const r = dateRange({ from: 'not-a-date', to: 'also-bad', now: NOW });
  assert.deepEqual([r.from, r.to], ['2026-09-01', '2026-09-30']);
});

test('dateRange: a range over 366 days is capped', () => {
  const r = dateRange({ from: '2020-01-01', to: '2026-09-30', now: NOW });
  assert.equal(r.to, '2026-09-30');
  assert.equal(r.days.length, 366);
  assert.equal(r.from, '2025-09-30'); // 2026-09-30 minus 365 days
});

// ---- computeAnalytics: orchestrator scope ----------------------------------------------------

test('computeAnalytics (orchestrator): ignores runs outside the range and mock runs, buckets by day/provider/project/model, enriches a session from local.sessions', (t) => {
  const dir = runsDir(t, [
    {
      started_at: '2026-09-10T09:00:00Z', status: 'success', project_id: 'proj-1', timing: { waiting_ms: 1000 },
      sessions: [
        { id: 's1', agent: 'developer', step_id: 'implement', provider: 'claude', model: 'claude-opus-5-5', provider_session_id: 'sess-a', turns: 3, tokens: tok(100, 200, 50, 10), cost_usd: 0.5, opened_at: '2026-09-10T09:00:00Z', closed_at: '2026-09-10T09:05:00Z' },
        { id: 's2', agent: 'supervisor', step_id: 'supervisor', provider: 'claude', model: 'claude-opus-5-5', provider_session_id: 'sess-sup', turns: 2, tokens: tok(20, 30), cost_usd: 0.1, opened_at: '2026-09-10T09:05:00Z', closed_at: '2026-09-10T09:06:00Z' },
      ],
    },
    {
      started_at: '2026-09-12T09:00:00Z', status: 'failed', project_id: null, timing: { waiting_ms: 500 },
      sessions: [{ id: 's3', agent: 'developer', step_id: 'implement', provider: 'codex', model: 'gpt-6-luna', provider_session_id: 'sess-b', turns: 5, tokens: tok(300, 100), cost_usd: null, opened_at: '2026-09-12T09:00:00Z', closed_at: '2026-09-12T09:10:00Z' }],
    },
    { // outside the range: from = 2026-09-01, so this one (before it) must be ignored
      started_at: '2026-08-15T09:00:00Z', status: 'success',
      sessions: [{ id: 's4', provider: 'claude', provider_session_id: 'sess-out', tokens: tok(9999, 9999) }],
    },
    { // mock runs are ignored entirely by readRuns
      started_at: '2026-09-11T09:00:00Z', mock: true, status: 'success',
      sessions: [{ id: 's5', provider: 'claude', provider_session_id: 'sess-mock', tokens: tok(9999, 9999) }],
    },
  ]);
  const local = {
    sessions: new Map([['claude:sess-a', {
      cwd: 'C:\\proj', model: 'claude-opus-5-5', headless: false, firstPrompt: 'Fix the login bug', firstTs: '2026-09-10T08:59:00Z', lastTs: '2026-09-10T09:04:00Z',
      durationMs: 300000, activeMs: 120000, userPrompts: 4, assistantTurns: 3, toolCalls: { read: 2, edit: 1, shell: 0, web: 0, agent: 0, other: 0 },
      failedToolCalls: 0, permissionDenials: 0, interrupts: 0, compactions: 0, peakContext: 5000, files: ['a.js', 'b.js'], linesAdded: 10, linesRemoved: 3,
    }]]),
    records: [], found: { claude: true, codex: false, grok: false },
  };
  const projects = [{ id: 'proj-1', name: 'Project One' }];
  const a = computeAnalytics({ runsDir: dir, local, projects, from: '2026-09-01', to: '2026-09-20', now: NOW });

  assert.equal(a.scope, 'orchestrator');
  assert.equal(a.totals.tokens.total, 360 + 50 + 400); // sess-a + sess-sup + sess-b; sess-out and sess-mock excluded
  assert.equal(Math.round(a.totals.costUsd * 100) / 100, 0.6); // 0.5 + 0.1; sess-b has no cost and no price
  assert.equal(a.totals.unpricedTokens, 400);

  const days = Object.fromEntries(a.byDay.map((d) => [d.day, d]));
  assert.equal(days['2026-09-10'].tokens, 410);
  assert.deepEqual(days['2026-09-10'].byProvider, { claude: 410 });
  assert.equal(days['2026-09-12'].tokens, 400);
  assert.deepEqual(days['2026-09-12'].byProvider, { codex: 400 });

  const byProvider = Object.fromEntries(a.byProvider.map((p) => [p.id, p]));
  assert.equal(byProvider.claude.tokens, 410);
  assert.equal(byProvider.claude.sessions, 2);
  assert.equal(byProvider.codex.tokens, 400);
  assert.equal(byProvider.grok.tokens, 0);

  const byModel = Object.fromEntries(a.byModel.map((m) => [m.model, m]));
  assert.equal(byModel['claude-opus-5-5'].tokens, 410);
  assert.equal(byModel['gpt-6-luna'].tokens, 400);

  const byProject = Object.fromEntries(a.byProject.map((p) => [p.name, p]));
  assert.equal(byProject['Project One'].tokens, 410);
  assert.equal(byProject['(no project)'].tokens, 400);

  assert.deepEqual(a.runs.byStatus, { success: 1, failed: 1 });
  assert.equal(a.runs.total, 2);
  assert.equal(a.runs.waitingMs, 1500);
  assert.equal(a.runs.supervisorTurns, 2);

  const sessA = a.sessions.find((s) => s.id === 'sess-a');
  assert.ok(sessA, 'the session enriched from local.sessions is present');
  assert.equal(sessA.userPrompts, 4);
  assert.equal(sessA.toolCallsTotal, 3);
  assert.equal(sessA.filesTouched, 2);
  assert.equal(sessA.title, 'Fix the login bug');
  assert.equal(sessA.activeMs, 120000);
});

// ---- computeAnalytics: machine scope ---------------------------------------------------------

test('computeAnalytics (machine): buckets records by their own timestamp, resolves the project via projectOf or the cwd folder, shares a run\'s cost by tokens, and leaves unrecorded metrics null', (t) => {
  const dir = runsDir(t, [
    { started_at: '2026-09-10T09:00:00Z', sessions: [{ id: 's1', provider: 'claude', provider_session_id: 'sess-a', tokens: tok(100, 200), cost_usd: 1.0 }] },
  ]);
  const local = {
    sessions: new Map([
      ['claude:sess-a', { cwd: 'C:\\Users\\me\\projects\\demo', model: 'claude-opus-5-5', toolCalls: { read: 1, edit: 0, shell: 0, web: 0, agent: 0, other: 0 } }],
      ['grok:sess-g', { cwd: 'C:\\Users\\me\\other-project', model: 'grok-5', toolCalls: null }],
    ]),
    records: [
      { provider: 'claude', sessionId: 'sess-a', model: 'claude-opus-5-5', ts: '2026-09-10T09:00:00Z', tokens: tok(50, 100), costUsd: null }, // no own cost: shares the run's cost by token share
      { provider: 'codex', sessionId: 'sess-c', model: 'gpt-6-luna', ts: '2026-09-11T09:00:00Z', tokens: tok(40, 60), costUsd: 0.2 },
      { provider: 'grok', sessionId: 'sess-g', model: 'grok-5', ts: '2026-09-12T09:00:00Z', tokens: tok(10, 5), costUsd: 0.05 },
    ],
    found: { claude: true, codex: true, grok: true },
  };
  const projectOf = (cwd) => (cwd === 'C:\\Users\\me\\projects\\demo' ? { id: 'proj-x', name: 'Demo' } : null);
  const a = computeAnalytics({ runsDir: dir, local, projects: [], projectOf, scope: 'machine', from: '2026-09-01', to: '2026-09-20', now: NOW });

  assert.equal(a.scope, 'machine');
  const byDay = Object.fromEntries(a.byDay.map((d) => [d.day, d]));
  assert.equal(byDay['2026-09-10'].tokens, 150);
  assert.equal(byDay['2026-09-11'].tokens, 100);
  assert.equal(byDay['2026-09-12'].tokens, 15);

  const byProject = Object.fromEntries(a.byProject.map((p) => [p.name, p]));
  assert.equal(byProject['Demo'].tokens, 150); // matched through projectOf
  assert.equal(byProject['other-project'].tokens, 15); // no projectOf match: falls back to the cwd folder name

  const sessA = a.sessions.find((s) => s.id === 'sess-a');
  assert.equal(Math.round(sessA.costUsd * 1000) / 1000, 0.5); // 1.0 * (150 tokens / 300 run tokens)

  // codex and grok records never carry permission denials, and this test gives none to the claude
  // session either: the aggregate must be null, not 0, to tell "unrecorded" from "recorded zero"
  assert.equal(a.metrics.permissionDenials, null);
});

// ---- complexityScore / complexityLevel --------------------------------------------------------

test('complexityScore: 0 when every metric is 0, 100 at or beyond every cap, null when every metric is null', () => {
  assert.equal(complexityScore({ turns: 0, toolCalls: 0, files: 0, tokens: 0, activeMinutes: 0 }), 0);
  assert.equal(complexityScore({ turns: 200, toolCalls: 300, files: 50, tokens: 2e7, activeMinutes: 240 }), 100);
  assert.equal(complexityScore({ turns: 1e6, toolCalls: 1e6, files: 1e6, tokens: 1e12, activeMinutes: 1e6 }), 100);
  assert.equal(complexityScore({ turns: null, toolCalls: null, files: null, tokens: null, activeMinutes: null }), null);
  // a single known metric at its cap still averages to 100 (the missing ones are left out, not 0)
  assert.equal(complexityScore({ turns: 200, toolCalls: null, files: null, tokens: null, activeMinutes: null }), 100);
});

test('complexityLevel: low below 34, medium below 67, high at or above 67, null for a null score', () => {
  assert.equal(complexityLevel(null), null);
  assert.equal(complexityLevel(0), 'low');
  assert.equal(complexityLevel(33), 'low');
  assert.equal(complexityLevel(34), 'medium');
  assert.equal(complexityLevel(66), 'medium');
  assert.equal(complexityLevel(67), 'high');
});

// ---- sessionIntent ------------------------------------------------------------------------------

test('sessionIntent: guessed from prompt keywords', () => {
  assert.equal(sessionIntent('There is a bug causing a crash on startup', {}, null), 'debugging');
  assert.equal(sessionIntent('Update the README with new setup instructions', {}, null), 'docs');
  assert.equal(sessionIntent('Please review this pull request', {}, null), 'review');
});

test('sessionIntent: guessed from the tool mix when the prompt gives no hint', () => {
  assert.equal(sessionIntent('', { edit: 3, read: 0, web: 0 }, null), 'coding');
  assert.equal(sessionIntent('', { edit: 0, read: 2, web: 1 }, null), 'research');
  assert.equal(sessionIntent('', { edit: 0, read: 0, web: 0 }, null), 'other');
});

test('sessionIntent: guessed from the agent name when there is no prompt (a run session with no transcript)', () => {
  assert.equal(sessionIntent(null, null, 'Code Reviewer'), 'review');
  assert.equal(sessionIntent(null, null, 'Debugger'), 'debugging');
  assert.equal(sessionIntent(null, null, 'Docs Writer'), 'docs');
  assert.equal(sessionIntent(null, null, 'Researcher'), 'research');
  assert.equal(sessionIntent(null, null, 'Developer'), 'coding');
});
