// Readers of the CLIs' own local logs, and the "this machine" usage scope.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { readLocalUsage, parseClaude, parseCodex, parseGrok, IDLE_GAP_MS } = require('@craftorio/engine/domains/local/local-usage');
const usage = require('@craftorio/engine/domains/usage/usage');

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

// ---- per-session metrics (Analytics) --------------------------------------------------------

test('parseClaude: per-session metrics from prompts, tool_use blocks, tool results, interrupts and compactions', () => {
  const t1 = '2026-09-27T09:00:00Z'; // typed prompt
  const t2 = '2026-09-27T09:01:00Z'; // assistant turn 1 (streamed in two chunks, same message.id)
  const t3 = new Date(Date.parse(t2) + IDLE_GAP_MS + 5000).toISOString(); // > the idle gap: excluded from active time
  const t4 = new Date(Date.parse(t3) + 5000).toISOString();
  const t5 = new Date(Date.parse(t4) + 50000).toISOString(); // assistant turn 2
  const t6 = new Date(Date.parse(t5) + 5000).toISOString(); // isMeta: not a prompt
  const t7 = new Date(Date.parse(t6) + 5000).toISOString(); // toolUseResult: not a prompt
  const sessionId = 'metrics-claude-1';
  const text = jl(
    { type: 'system', subtype: 'compact_boundary', sessionId },
    { type: 'user', sessionId, timestamp: t1, cwd: 'C:\\proj', message: { content: 'Please add tests for the login flow' } },
    // streamed twice: the tool_use id "t-read" is deduplicated, "t-grep" is only in the second chunk
    { type: 'assistant', sessionId, timestamp: t2, message: { id: 'm1', model: 'claude-opus-5-5',
      usage: { input_tokens: 1000, output_tokens: 200, cache_read_input_tokens: 500, cache_creation_input_tokens: 100 },
      content: [{ type: 'tool_use', id: 't-read', name: 'Read', input: { file_path: 'src/readme-check.js' } }] } },
    { type: 'assistant', sessionId, timestamp: t2, message: { id: 'm1', model: 'claude-opus-5-5',
      content: [
        { type: 'tool_use', id: 't-read', name: 'Read', input: { file_path: 'src/readme-check.js' } },
        { type: 'tool_use', id: 't-grep', name: 'Grep', input: { pattern: 'TODO' } },
      ] } },
    { type: 'user', sessionId, timestamp: t3, message: { content: [
      { type: 'tool_result', is_error: true, content: "The user doesn't want to proceed with this tool use." },
      { type: 'tool_result', is_error: true, content: 'Command exited with status 1' },
    ] } },
    { type: 'user', sessionId, timestamp: t4, message: { content: '[Request interrupted by user for tool use]' } },
    { type: 'assistant', sessionId, timestamp: t5, message: { id: 'm2', model: 'claude-opus-5-5',
      usage: { input_tokens: 2000, output_tokens: 300, cache_read_input_tokens: 800, cache_creation_input_tokens: 50 },
      content: [
        { type: 'tool_use', id: 't-edit', name: 'Edit', input: { file_path: 'apps/desktop/host/auth.js', old_string: 'a\nb', new_string: 'a\nb\nc' } },
        { type: 'tool_use', id: 't-write', name: 'Write', input: { file_path: 'src/new-file.js', content: 'x\ny' } },
        { type: 'tool_use', id: 't-multi', name: 'MultiEdit', input: { file_path: 'src/multi.js', edits: [{ old_string: 'p', new_string: 'p\nq' }, { old_string: 'r\ns\nt', new_string: '' }] } },
        { type: 'tool_use', id: 't-bash', name: 'Bash', input: { command: 'npm test' } },
        { type: 'tool_use', id: 't-web', name: 'WebFetch', input: { url: 'https://example.com' } },
        { type: 'tool_use', id: 't-task', name: 'Task', input: { description: 'run subagent' } },
        { type: 'tool_use', id: 't-todo', name: 'TodoWrite', input: { todos: [] } },
      ] } },
    { type: 'user', sessionId, timestamp: t6, isMeta: true, message: { content: 'This should not count as a prompt.' } },
    { type: 'user', sessionId, timestamp: t7, toolUseResult: { ok: true }, message: { content: 'This also should not count.' } },
  );
  const { sessions } = parseClaude(text);
  assert.equal(sessions.length, 1);
  const s = sessions[0];
  assert.equal(s.userPrompts, 1); // the isMeta and toolUseResult lines are excluded
  assert.equal(s.firstPrompt, 'Please add tests for the login flow');
  assert.equal(s.assistantTurns, 2); // m1's two streamed chunks count as one turn
  assert.deepEqual(s.toolCalls, { read: 2, edit: 3, shell: 1, web: 1, agent: 1, other: 1 });
  assert.equal(s.failedToolCalls, 2);
  assert.equal(s.permissionDenials, 1);
  assert.equal(s.interrupts, 1);
  assert.equal(s.compactions, 1);
  assert.equal(s.peakContext, 2850); // max(1000+500+100, 2000+800+50)
  assert.deepEqual(s.files, ['apps/desktop/host/auth.js', 'src/new-file.js', 'src/multi.js']);
  assert.equal(s.linesAdded, 7); // Edit new_string(3) + Write content(2) + MultiEdit new_string(2)
  assert.equal(s.linesRemoved, 6); // Edit old_string(2) + MultiEdit old_string(1+3)
  assert.equal(s.durationMs, Date.parse(t7) - Date.parse(t1));
  assert.equal(s.activeMs, 60000 + 0 + 5000 + 50000 + 5000 + 5000); // the t2->t3 gap (over IDLE_GAP_MS) is excluded
  assert.equal(s.sidechain, false);
  assert.equal(s.cwd, 'C:\\proj');
});

test('parseCodex: per-session metrics from function/custom tool calls, apply_patch diffs, aborts and compactions', () => {
  const base = Date.parse('2026-09-27T09:00:00Z');
  const at = (n) => new Date(base + n * 1000).toISOString();
  const text = jl(
    { timestamp: at(0), type: 'session_meta', payload: { id: 'codex-metrics-1', cwd: 'C:\\proj', source: 'exec' } },
    { timestamp: at(1), type: 'turn_context', payload: { model: 'gpt-6-luna' } },
    { timestamp: at(2), type: 'event_msg', payload: { type: 'user_message', message: '<environment_context>ignored</environment_context>' } },
    { timestamp: at(3), type: 'event_msg', payload: { type: 'user_message', message: 'Fix the failing login test' } },
    { timestamp: at(4), type: 'response_item', payload: { type: 'function_call', name: 'shell', arguments: JSON.stringify({ command: ['bash', '-lc', 'ls'] }) } },
    { timestamp: at(5), type: 'response_item', payload: { type: 'custom_tool_call', name: 'apply_patch', input: '*** Begin Patch\n*** Update File: src/login.js\n+added line\n-removed line\n*** End Patch' } },
    { timestamp: at(6), type: 'response_item', payload: { type: 'function_call', name: 'shell', arguments: JSON.stringify({ command: ['bash', '-lc', 'apply_patch <<PATCH\n*** Update File: src/other.js\n+x\n*** End Patch\nPATCH'] }) } },
    { timestamp: at(7), type: 'response_item', payload: { type: 'function_call_output', output: JSON.stringify({ metadata: { exit_code: 1 }, output: 'error: something failed' }) } },
    { timestamp: at(8), type: 'response_item', payload: { type: 'function_call_output', output: JSON.stringify({ metadata: { exit_code: 0 }, output: 'ok' }) } },
    { timestamp: at(9), type: 'event_msg', payload: { type: 'turn_aborted' } },
    { timestamp: at(10), type: 'compacted', payload: {} },
    { timestamp: at(11), type: 'event_msg', payload: { type: 'token_count', info: { last_token_usage: { input_tokens: 1500, cached_input_tokens: 200, output_tokens: 100, reasoning_output_tokens: 10 } } } },
    { timestamp: at(12), type: 'event_msg', payload: { type: 'token_count', info: { last_token_usage: { input_tokens: 900, cached_input_tokens: 100, output_tokens: 50, reasoning_output_tokens: 5 } } } },
  );
  const { sessions } = parseCodex(text);
  assert.equal(sessions.length, 1);
  const s = sessions[0];
  assert.equal(s.sessionId, 'codex-metrics-1');
  assert.equal(s.cwd, 'C:\\proj');
  assert.equal(s.headless, true);
  assert.equal(s.model, 'gpt-6-luna');
  assert.equal(s.userPrompts, 1); // the environment_context message is excluded
  assert.equal(s.firstPrompt, 'Fix the failing login test');
  assert.deepEqual(s.toolCalls, { read: 0, edit: 2, shell: 1, web: 0, agent: 0, other: 0 }); // apply_patch (custom_tool_call and inside a shell command) is edit
  assert.equal(s.failedToolCalls, 1); // only the exit_code: 1 output counts
  assert.equal(s.permissionDenials, null); // Codex does not record it
  assert.equal(s.interrupts, 1);
  assert.equal(s.compactions, 1);
  assert.equal(s.assistantTurns, 2);
  assert.equal(s.peakContext, 1500); // max(1500, 900)
  assert.deepEqual(s.files, ['src/login.js', 'src/other.js']);
  assert.equal(s.linesAdded, 2);
  assert.equal(s.linesRemoved, 1);
  assert.equal(s.sidechain, false);
});

test('parseGrok: cwd, headless and firstPrompt come from summary.json next to usage.json; missing summary.json does not throw', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'grok-session-'));
  try {
    const usagePath = path.join(dir, 'usage.json');
    const text = JSON.stringify({
      sessionId: 'grok-metrics-1', session: { primaryModelId: 'grok-5' },
      turns: [{ startedAt: '2026-09-27T09:00:00Z', endedAt: '2026-09-27T09:05:00Z', inputTokens: 100, cachedReadTokens: 0, outputTokens: 20, reasoningTokens: 0, cacheCreationTokens: 0, costUsdTicks: 1e9 }],
    });
    fs.writeFileSync(usagePath, text);
    fs.writeFileSync(path.join(dir, 'summary.json'), JSON.stringify({ info: { cwd: 'C:\\proj\\grok' }, session_kind: 'headless', session_summary: 'Investigate flaky CI' }));
    const { sessions } = parseGrok(text, usagePath);
    assert.equal(sessions.length, 1);
    const s = sessions[0];
    assert.equal(s.cwd, 'C:\\proj\\grok');
    assert.equal(s.headless, true);
    assert.equal(s.firstPrompt, 'Investigate flaky CI');
    assert.equal(s.toolCalls, null);
    assert.equal(s.userPrompts, null);
    assert.equal(s.files, null);
    assert.equal(s.assistantTurns, 1);
    assert.equal(s.peakContext, 100);

    // no summary.json next to this one: cwd/headless/firstPrompt stay unset, nothing throws
    const dir2 = fs.mkdtempSync(path.join(os.tmpdir(), 'grok-session2-'));
    try {
      const usagePath2 = path.join(dir2, 'usage.json');
      fs.writeFileSync(usagePath2, text);
      const { sessions: sessions2 } = parseGrok(text, usagePath2);
      assert.equal(sessions2[0].cwd, null);
      assert.equal(sessions2[0].headless, false);
      assert.equal(sessions2[0].firstPrompt, null);
    } finally { fs.rmSync(dir2, { recursive: true, force: true }); }
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('readLocalUsage: two Claude files with the same session id are merged; a sidechain file adds no active time but its tool calls are added', (t) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'home-sidechain-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const cdir = path.join(home, '.claude', 'projects', 'C--proj');
  fs.mkdirSync(cdir, { recursive: true });
  const sessionId = 'shared-session';
  const main = jl(
    { type: 'user', sessionId, timestamp: '2026-09-27T09:00:00Z', message: { content: 'Please check the login flow' } },
    { type: 'assistant', sessionId, timestamp: '2026-09-27T09:01:00Z', message: { id: 'main-m1', model: 'claude-opus-5-5',
      content: [{ type: 'tool_use', id: 'main-t1', name: 'Read', input: { file_path: 'src/login.js' } }] } },
  );
  // a subagent transcript for the same conversation: every line isSidechain
  const sub = jl(
    { type: 'user', sessionId, isSidechain: true, timestamp: '2026-09-27T10:00:00Z', message: { content: 'Investigate the auth failure' } },
    { type: 'assistant', sessionId, isSidechain: true, timestamp: '2026-09-27T10:05:00Z', message: { id: 'sub-m1', model: 'claude-opus-5-5',
      content: [{ type: 'tool_use', id: 'sub-t1', name: 'Bash', input: { command: 'npm test' } }] } },
  );
  fs.writeFileSync(path.join(cdir, 'a-main.jsonl'), main);
  fs.writeFileSync(path.join(cdir, 'b-sub.jsonl'), sub);
  const { sessions } = readLocalUsage({ home });
  const s = sessions.get('claude:shared-session');
  assert.ok(s);
  assert.equal(s.sidechain, false);
  assert.equal(s.userPrompts, 2); // the subagent's own prompt is added
  assert.equal(s.assistantTurns, 2);
  assert.deepEqual(s.toolCalls, { read: 1, edit: 0, shell: 1, web: 0, agent: 0, other: 0 }); // the subagent's Bash call is added
  assert.equal(s.firstPrompt, 'Please check the login flow'); // the subagent's prompt never becomes firstPrompt
  assert.equal(s.activeMs, 60000); // only the main file's 1-minute gap; the subagent's own time is not added
});
