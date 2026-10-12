// The Oracle's run_analysis focuses (#321): what the outside session's time-study, dev-agg, dev-ctx,
// dev-tools, cold-resumes, file-sums and suite-compare scripts answered, moved into the app next to
// the cost answer (src/oracle-run-analysis.js, focus `cost`, the default). Per run, from its files:
// - time: minutes and visits per step (an open step counts until the last event), tool time vs model
//   time, the slowest tool calls, gaps over 3 min with no event, active/waiting and the gates' owner time;
// - context: one agent's turns (default the developer): requests (a repeated context value is one
//   request), mean and peak context, the read above 100K/150K/200K, the main turn's curve and its
//   growth by the preceding tool call's kind;
// - tools: per agent and step, calls by tool and by Bash kind, re-read files, searches, edits,
//   sub-agents, failed calls by cause, the test commands and their durations;
// - cache: the turns that resumed a session past its prompt cache's lifetime (src/session-cache.js);
// - tests: the suite logs' time per test file and slowest tests, two runs compared, and the test
//   step's time on E2E vs unit tests.
// Pure, no model: the caller reads summary.json, events.jsonl, the suite logs and the test files.

const { runCosts } = require('./run-costs');
const { cacheLifetimeMs, cacheTier } = require('./session-cache');

// focus names run_analysis takes (cost is src/oracle-run-analysis.js)
const FOCUSES = [
  'cache',
  'context',
  'cost',
  'tests',
  'time',
  'tools',
];
const MIN = 60e3;
const GAP_MS = 3 * MIN;
const SLOWEST = 5;
const TOP = 10;
const TARGET_CHARS = 100;
const CONTEXT_STEPS = [100e3, 150e3, 200e3];
const CURVE_EVERY = 10;
const TEST_WRITER = /test_?writer/i;
const E2E = /\bbddgen\b|playwright|cucumber|screenshot|\.feature\b|\be2e\b/i;
const UNIT = /\bnode --test\b|\bnpm (run )?test\b|\bjest\b|\bvitest\b|\bmocha\b|\bpytest\b|\bgo test\b|\bdotnet test\b|\b(mvn|gradle)\b.*\btest\b/i;
const REFUSED_TEXT = /requires approval|not allowed|permission denied by|was refused/i;
// a Bash command's kind, the first that matches (else 'other')
const BASH_KINDS = [
  ['git', /^\s*git\b/],
  ['test', { test: (c) => E2E.test(c) || UNIT.test(c) }],
  ['read via Bash', /^\s*(cat|head|tail|less|more|type|wc|sed -n|Get-Content)\b/i],
  ['search via Bash', /^\s*(grep|rg|find|ls|dir|tree|Select-String|Get-ChildItem)\b/i],
  ['node script', /^\s*node\b/],
  ['file ops', /^\s*(mkdir|rm|rmdir|cp|mv|touch|del|copy|move|ren)\b/i],
];
// a node:test line of a suite log: "✔ name (12.3ms)"
const LOG_LINE = /^\s*([✔✖])\s+(.*?)\s+\((\d+(?:\.\d+)?)ms\)\s*(?:#.*)?$/;
const DECLARED = /\b(?:test|it)(?:\.(?:only|skip|todo))?\s*\(\s*(['"`])((?:\\.|(?!\1)[^\\])*)\1/g;

const ms = (t) => Date.parse(t || '');
const round = (n, d = 6) => +Number(n || 0).toFixed(d);
const share = (part, whole) => (whole > 0 ? round(part / whole, 4) : 0);
const cut = (s, n = TARGET_CHARS) => (s.length > n ? `${s.slice(0, n)}…` : s);
const inc = (map, key, n = 1) => { map[key] = (map[key] || 0) + n; };
const topBy = (list, key, n) => [...list].sort((a, b) => b[key] - a[key]).slice(0, n);
const statusOf = (summary) => summary?.status || 'running';
const filePath = (p) => String(p || '').replace(/\\/g, '/');
const commandOf = (input) => (Array.isArray(input?.command) ? input.command.join(' ') : typeof input?.command === 'string' ? input.command : '');
const outputText = (o) => (o == null ? '' : typeof o === 'string' ? o : JSON.stringify(o));

/** A Bash command's kind: git, test, read via Bash, search via Bash, node script, file ops, other. */
const bashKind = (command) => (BASH_KINDS.find(([, re]) => re.test(command)) || ['other'])[0];

/** A tool call's kind (the growth of the context after it): its Bash kind, or read, search, edit, sub-agent, the tool. */
function toolKind(name, input) {
  const command = commandOf(input);
  if (command) return bashKind(command);
  if (name === 'Read') return 'read';
  if (['Grep', 'Glob'].includes(name)) return 'search';
  if (['Edit', 'MultiEdit', 'NotebookEdit', 'Write'].includes(name)) return 'edit';
  if (['Agent', 'Task'].includes(name)) return 'sub-agent';
  return String(name || '?');
}

/** Why a tool result failed ('exit code', 'refused', 'timeout', 'error'), null when it did not. */
function failureOf(item = {}) {
  const out = outputText(item.output);
  const code = /^\s*Exit code (-?\d+)/i.exec(out)?.[1] ?? item.exit_code;
  if (code != null && Number(code) !== 0) return 'exit code';
  if (!item.is_error) return null;
  if (REFUSED_TEXT.test(out)) return 'refused';
  if (/timed? ?out/i.test(out)) return 'timeout';
  return 'error';
}

// Follows the sessions through the events: session id → { agent, provider, step, lifetimeMs } (the
// step updated by each turn's message). Call it on every event, in order.
function sessionTracker(summary) {
  const known = new Map((summary?.sessions || []).map((s) => [s.id, s]));
  const where = new Map();
  return (e) => {
    if (!e.session_id) return null;
    if (e.type === 'session.opened' || !where.has(e.session_id)) {
      const s = e.session || known.get(e.session_id) || {};
      where.set(e.session_id, { agent: s.agent || e.agent || '?', provider: s.simulates || s.provider || null, step: s.step_id || e.step_id || null, lifetimeMs: s.cache_lifetime_ms });
    }
    const s = where.get(e.session_id);
    if (e.type === 'session.message_sent' && e.step_id) s.step = e.step_id;
    return s;
  };
}

// ---- time --------------------------------------------------------------------------------------

function timeOf({ runId, summary, events }) {
  const steps = {};
  const openAt = new Map(); // step → when its visit started
  const calls = new Map(); // tool call id → { t, step, tool, target }
  const tools = [];
  const gaps = [];
  const at = sessionTracker(summary);
  const stepOf = (id) => steps[id] || (steps[id] = { durationMs: 0, visits: 0, open: false, toolMs: 0, modelMs: 0 });
  let first = null; let last = null;
  for (const e of events) {
    const t = ms(e.ts);
    if (!Number.isFinite(t)) continue;
    if (last != null && t - last > GAP_MS) gaps.push({ from: new Date(last).toISOString(), durationMs: t - last, endedBy: e.type, ...(e.item?.kind ? { item: e.item.kind } : {}) });
    first ??= t;
    last = Math.max(last ?? t, t);
    const s = at(e);
    if (e.type === 'step.started') {
      stepOf(e.step_id).visits += 1;
      openAt.set(e.step_id, t);
    } else if ((e.type === 'step.finished' || e.type === 'step.failed') && openAt.has(e.step_id)) {
      stepOf(e.step_id).durationMs += t - openAt.get(e.step_id);
      openAt.delete(e.step_id);
    } else if (e.type === 'session.stream' && e.item?.kind === 'tool_call' && e.item.id) {
      const input = e.item.input || {};
      const target = commandOf(input) || input.file_path || input.path || input.pattern || input.description || '';
      calls.set(e.item.id, { t, step: s?.step || e.step_id || '?', tool: e.item.name || '?', target: cut(String(target)) });
    } else if (e.type === 'session.stream' && e.item?.kind === 'tool_result' && calls.has(e.item.id)) {
      const c = calls.get(e.item.id);
      calls.delete(e.item.id);
      tools.push({ step: c.step, tool: c.tool, target: c.target, durationMs: t - c.t });
      stepOf(c.step).toolMs += t - c.t;
    }
  }
  // a step still open counts until the last event
  for (const [id, t] of openAt) Object.assign(stepOf(id), { durationMs: stepOf(id).durationMs + last - t, open: true });
  for (const st of Object.values(steps)) st.modelMs = Math.max(0, st.durationMs - st.toolMs);
  const timing = summary?.timing || null;
  const gates = Object.fromEntries(Object.entries(timing?.gates || {}).map(([g, x]) => [g, { waits: Number(x.waits) || 0, waitMs: Number(x.wait_ms) || 0 }]));
  return {
    runId,
    status: statusOf(summary),
    durationMs: summary?.duration_ms ?? (first != null ? last - first : null),
    activeMs: timing?.active_ms ?? null,
    waitingMs: timing?.waiting_ms ?? null,
    ownerWaitMs: timing ? (timing.gate_wait_ms ?? Object.values(gates).reduce((n, g) => n + g.waitMs, 0)) : null,
    gates,
    steps,
    slowestTools: topBy(tools, 'durationMs', SLOWEST),
    gaps,
  };
}

function timeTotal(runs) {
  const steps = {};
  for (const r of runs) {
    for (const [id, st] of Object.entries(r.steps)) {
      const t = steps[id] || (steps[id] = { durationMs: 0, visits: 0, toolMs: 0, modelMs: 0 });
      for (const k of Object.keys(t)) t[k] += st[k];
    }
  }
  const sum = (f) => runs.reduce((n, r) => n + (f(r) || 0), 0);
  return {
    runs: runs.length,
    durationMs: sum((r) => r.durationMs),
    ownerWaitMs: sum((r) => r.ownerWaitMs),
    gaps: sum((r) => r.gaps.length),
    gapMs: sum((r) => r.gaps.reduce((n, g) => n + g.durationMs, 0)),
    steps: Object.fromEntries(Object.entries(steps).sort((a, b) => b[1].durationMs - a[1].durationMs).slice(0, TOP)),
  };
}

function timeBrief(r, top) {
  const list = Object.values(r.steps);
  return {
    ...r,
    steps: Object.fromEntries(Object.entries(r.steps).sort((a, b) => b[1].durationMs - a[1].durationMs).slice(0, top)),
    stepCount: list.length,
    toolMs: list.reduce((n, s) => n + s.toolMs, 0),
    modelMs: list.reduce((n, s) => n + s.modelMs, 0),
    slowestTools: r.slowestTools.slice(0, top),
    gaps: topBy(r.gaps, 'durationMs', top),
    gapCount: r.gaps.length,
    gapMs: r.gaps.reduce((n, g) => n + g.durationMs, 0),
  };
}

// ---- context -----------------------------------------------------------------------------------

function contextOf({ runId, summary, events }, { agent = 'developer' } = {}) {
  const at = sessionTracker(summary);
  const turns = new Map(); // session#turn → { step, session, turn, values: [{ tokens, after }], toolCalls, lastKind }
  const current = new Map(); // session id → its turn
  const turnOf = (sid, n, step) => {
    const key = `${sid}#${n}`;
    if (!turns.has(key)) turns.set(key, { step: step || '?', session: sid, turn: n, values: [], toolCalls: 0, lastKind: null });
    return turns.get(key);
  };
  for (const e of events) {
    const s = at(e);
    if (!s || s.agent !== agent) continue;
    if (e.type === 'session.message_sent') current.set(e.session_id, e.turn ?? (current.get(e.session_id) || 0) + 1);
    if (e.type !== 'session.stream') continue;
    const it = e.item || {};
    const T = turnOf(e.session_id, e.turn ?? current.get(e.session_id) ?? 1, s.step);
    if (it.kind === 'tool_call') {
      T.toolCalls += 1;
      T.lastKind = toolKind(it.name, it.input);
    } else if (it.kind === 'context') {
      const tokens = Number(it.tokens) || 0;
      // Claude Code repeats a request's usage on each content block: the same value is one request
      if (T.values.length && T.values.at(-1).tokens === tokens) continue;
      T.values.push({ tokens, after: T.lastKind });
      T.lastKind = null;
    }
  }
  const list = [...turns.values()].filter((T) => T.values.length).map((T) => {
    const read = T.values.reduce((n, v) => n + v.tokens, 0);
    return {
      step: T.step,
      session: T.session,
      turn: T.turn,
      requests: T.values.length,
      toolCalls: T.toolCalls,
      meanContext: Math.round(read / T.values.length),
      peakContext: Math.max(...T.values.map((v) => v.tokens)),
      readTokens: read,
      readShareAbove: Object.fromEntries(CONTEXT_STEPS.map((k) => [`${k / 1e3}K`, share(T.values.filter((v) => v.tokens > k).reduce((n, v) => n + v.tokens, 0), read)])),
      values: T.values,
    };
  });
  const read = list.reduce((n, T) => n + T.readTokens, 0);
  const past = list.filter((T) => T.peakContext > 200e3);
  const mainTurn = topBy(list, 'readTokens', 1)[0];
  let main = null;
  if (mainTurn) {
    const growthByKind = {};
    mainTurn.values.forEach((v, i) => {
      const growth = i ? v.tokens - mainTurn.values[i - 1].tokens : 0;
      if (growth > 0) inc(growthByKind, v.after || 'no tool', growth);
    });
    main = {
      step: mainTurn.step,
      session: mainTurn.session,
      turn: mainTurn.turn,
      curve: mainTurn.values.map((v, i) => ({ request: i + 1, tokens: v.tokens })).filter((x, i, all) => i % CURVE_EVERY === 0 || i === all.length - 1),
      growthByKind,
    };
  }
  return {
    runId,
    status: statusOf(summary),
    agent,
    turns: list.map(({ values, ...T }) => T),
    past200K: { turns: past.length, share: share(past.reduce((n, T) => n + T.readTokens, 0), read) },
    main,
    ...(list.length ? {} : { note: `No context recorded for ${agent}'s turns in this run (no turn, or a provider that reports no per-request context).` }),
  };
}

function contextTotal(runs) {
  const all = runs.flatMap((r) => r.turns.map((T) => ({ runId: r.runId, ...T })));
  const read = all.reduce((n, T) => n + T.readTokens, 0);
  const past = all.filter((T) => T.peakContext > 200e3);
  return {
    runs: runs.length,
    turns: all.length,
    requests: all.reduce((n, T) => n + T.requests, 0),
    readTokens: read,
    past200K: { turns: past.length, share: share(past.reduce((n, T) => n + T.readTokens, 0), read) },
    topTurns: topBy(all, 'readTokens', SLOWEST).map((T) => ({ runId: T.runId, step: T.step, turn: T.turn, requests: T.requests, peakContext: T.peakContext, readTokens: T.readTokens })),
  };
}

function contextBrief(r, top) {
  return {
    ...r,
    turns: topBy(r.turns, 'readTokens', top),
    turnCount: r.turns.length,
    main: r.main && (top ? r.main : { step: r.main.step, turn: r.main.turn, growthByKind: r.main.growthByKind }),
  };
}

// ---- tools -------------------------------------------------------------------------------------

function toolsOf({ runId, summary, events }) {
  const at = sessionTracker(summary);
  const agents = {};
  const calls = new Map(); // tool call id → { t, agent, step, command, kind }
  const agentOf = (name) => agents[name] || (agents[name] = {
    calls: 0, byTool: {}, byBashKind: {}, steps: {}, reads: {}, searches: { grep: 0, glob: 0 }, edits: {}, subagents: 0, failed: { total: 0, byCause: {} }, testCommands: [],
  });
  for (const e of events) {
    const s = at(e);
    if (!s || e.type !== 'session.stream') continue;
    const it = e.item || {};
    const a = agentOf(s.agent);
    if (it.kind === 'tool_call') {
      const name = it.name || '?';
      const input = it.input || {};
      const step = s.step || e.step_id || '?';
      const st = a.steps[step] || (a.steps[step] = { calls: 0, byTool: {} });
      a.calls += 1;
      st.calls += 1;
      inc(a.byTool, name);
      inc(st.byTool, name);
      const command = commandOf(input);
      const kind = command ? bashKind(command) : null;
      if (kind) inc(a.byBashKind, kind);
      const file = filePath(input.file_path || input.notebook_path);
      if (name === 'Read' && file) inc(a.reads, file);
      if (name === 'Grep') a.searches.grep += 1;
      if (name === 'Glob') a.searches.glob += 1;
      if (['Edit', 'MultiEdit', 'NotebookEdit', 'Write'].includes(name) && file) {
        const ed = a.edits[file] || (a.edits[file] = { file, edits: 0, writes: 0 });
        if (name === 'Write') ed.writes += 1;
        else ed.edits += 1;
      }
      if (['Agent', 'Task'].includes(name)) a.subagents += 1;
      if (it.id) calls.set(it.id, { t: ms(e.ts), step, command, kind });
    } else if (it.kind === 'tool_result') {
      const cause = failureOf(it);
      if (cause) {
        a.failed.total += 1;
        inc(a.failed.byCause, cause);
      }
      const c = calls.get(it.id);
      if (c?.kind === 'test') a.testCommands.push({ step: c.step, command: cut(c.command), durationMs: ms(e.ts) - c.t, ...(cause ? { failed: cause } : {}) });
    }
  }
  for (const a of Object.values(agents)) {
    a.rereadFiles = Object.entries(a.reads).filter(([, n]) => n > 1).map(([file, reads]) => ({ file, reads })).sort((x, y) => y.reads - x.reads).slice(0, TOP);
    a.edits = Object.values(a.edits).sort((x, y) => (y.edits + y.writes) - (x.edits + x.writes)).slice(0, TOP);
    delete a.reads;
  }
  return { runId, status: statusOf(summary), agents };
}

function toolsTotal(runs) {
  const agents = {};
  for (const r of runs) {
    for (const [name, a] of Object.entries(r.agents)) {
      const t = agents[name] || (agents[name] = { calls: 0, byTool: {}, byBashKind: {}, subagents: 0, failed: 0 });
      t.calls += a.calls;
      t.subagents += a.subagents;
      t.failed += a.failed.total;
      for (const [k, n] of Object.entries(a.byTool)) inc(t.byTool, k, n);
      for (const [k, n] of Object.entries(a.byBashKind)) inc(t.byBashKind, k, n);
    }
  }
  return { runs: runs.length, agents };
}

function toolsBrief(r, top) {
  const agents = Object.fromEntries(Object.entries(r.agents).map(([name, a]) => [name, {
    ...a,
    steps: Object.fromEntries(Object.entries(a.steps).map(([step, st]) => [step, top ? st : { calls: st.calls }])),
    rereadFiles: a.rereadFiles.slice(0, top),
    edits: a.edits.slice(0, top),
    testCommands: topBy(a.testCommands, 'durationMs', top),
  }]));
  return { ...r, agents };
}

// ---- cache -------------------------------------------------------------------------------------

function cacheOf({ runId, summary, events }) {
  const costs = runCosts(events, summary);
  const at = sessionTracker(summary);
  const sentAt = new Map(); // session id → its latest turn's message
  const ended = new Map(); // session id → { t, usage } of its previous turn
  const cold = [];
  let turns = 0;
  for (const e of events) {
    const s = at(e);
    if (e.type === 'session.message_sent') sentAt.set(e.session_id, ms(e.ts));
    if (!s || e.type !== 'session.message_received') continue;
    turns += 1;
    const prev = ended.get(e.session_id);
    ended.set(e.session_id, { t: ms(e.ts), usage: e.usage });
    if (!prev) continue;
    const lifetime = s.lifetimeMs ?? cacheLifetimeMs(s.provider, { tier: cacheTier(prev.usage) });
    const gap = (sentAt.get(e.session_id) ?? ms(e.ts)) - prev.t;
    if (lifetime == null || !(gap > lifetime)) continue;
    cold.push({ agent: s.agent, session: e.session_id, step: s.step, turn: e.turn ?? null, gapMs: gap, cacheWrite: Number(e.usage?.cache_write) || 0, costUsd: round(costs.turnCost(e)) });
  }
  return { runId, status: statusOf(summary), turns, cold: coldOf(cold, turns) };
}

const coldOf = (list, turns) => ({
  count: list.length,
  share: share(list.length, turns),
  cacheWrite: list.reduce((n, x) => n + x.cacheWrite, 0),
  costUsd: round(list.reduce((n, x) => n + x.costUsd, 0)),
  turns: list,
});

function cacheTotal(runs) {
  const turns = runs.reduce((n, r) => n + r.turns, 0);
  const cold = coldOf(runs.flatMap((r) => r.cold.turns.map((x) => ({ runId: r.runId, ...x }))), turns);
  return { runs: runs.length, turns, cold: { ...cold, turns: topBy(cold.turns, 'costUsd', TOP) } };
}

const cacheBrief = (r, top) => ({ ...r, cold: { ...r.cold, turns: topBy(r.cold.turns, 'costUsd', top) } });

// ---- tests -------------------------------------------------------------------------------------

/** A node:test log's tests: name → duration (ms), the last line of a name wins. */
function suiteTimes(text) {
  const times = new Map();
  for (const line of String(text || '').split(/\r?\n/)) {
    const m = LOG_LINE.exec(line);
    if (m) times.set(m[2], Number(m[3]));
  }
  return times;
}

/** The test names a test file declares (test(...) / it(...) with a literal name). */
function declaredTests(source) {
  return [...String(source || '').matchAll(DECLARED)].map((m) => m[2].replace(/\\(.)/g, '$1')).filter((n) => !n.includes('${'));
}

// suite times of the runs, for the comparison of two runs (kept out of the answer)
const TIMES = new WeakMap();

// logs: [{ name, text }] oldest first (the latest one is read); testFiles: { <file>: <source> }
function testsOf({ runId, summary, events, logs = [], testFiles = {} }) {
  const at = sessionTracker(summary);
  const testStep = { e2e: { calls: 0, durationMs: 0 }, unit: { calls: 0, durationMs: 0 } };
  const calls = new Map();
  for (const e of events) {
    const s = at(e);
    if (!s || e.type !== 'session.stream' || !(TEST_WRITER.test(s.agent) || /test/i.test(s.step || ''))) continue;
    const it = e.item || {};
    if (it.kind === 'tool_call') {
      const command = commandOf(it.input);
      const kind = E2E.test(command) ? 'e2e' : UNIT.test(command) ? 'unit' : null;
      if (kind) calls.set(it.id, { kind, t: ms(e.ts) });
    } else if (it.kind === 'tool_result' && calls.has(it.id)) {
      const c = calls.get(it.id);
      testStep[c.kind].calls += 1;
      testStep[c.kind].durationMs += ms(e.ts) - c.t;
    }
  }
  const out = { runId, status: statusOf(summary), log: null, files: [], slowest: [], testStep };
  const log = logs.at(-1);
  if (!log) return { ...out, note: 'No suite log (logs/tests-*.log) in this run: no suite ran, or its log was not kept.' };
  const fileOf = new Map();
  for (const [file, source] of Object.entries(testFiles)) for (const name of declaredTests(source)) if (!fileOf.has(name)) fileOf.set(name, file);
  const times = suiteTimes(log.text);
  const files = {};
  let unmatched = 0;
  for (const [name, d] of times) {
    const file = fileOf.get(name);
    if (!file) { unmatched += 1; continue; }
    const f = files[file] || (files[file] = { file, durationMs: 0, tests: 0 });
    f.durationMs = round(f.durationMs + d, 3);
    f.tests += 1;
  }
  const result = {
    ...out,
    log: log.name,
    files: topBy(Object.values(files), 'durationMs', Infinity),
    slowest: topBy([...times].map(([test, durationMs]) => ({ test, file: fileOf.get(test) || null, durationMs })), 'durationMs', TOP),
    unmatchedTests: unmatched,
    ...(Object.keys(testFiles).length ? {} : { note: 'The run\'s checkout has no test/*.test.js left: the tests are not matched to their files.' }),
  };
  TIMES.set(result, { times, fileOf });
  return result;
}

/** The tests two runs both ran: before (the first run) and after, the most slowed down first. */
function compareTests(before, after) {
  const a = TIMES.get(before);
  const b = TIMES.get(after);
  if (!a || !b) return { before: before.runId, after: after.runId, tests: [], note: 'One of the two runs has no suite log.' };
  const tests = [...a.times].filter(([name]) => b.times.has(name))
    .map(([test, beforeMs]) => ({ test, file: b.fileOf.get(test) || a.fileOf.get(test) || null, beforeMs, afterMs: b.times.get(test), deltaMs: round(b.times.get(test) - beforeMs, 3) }));
  return {
    before: before.runId,
    after: after.runId,
    shared: tests.length,
    beforeMs: round(tests.reduce((n, x) => n + x.beforeMs, 0), 3),
    afterMs: round(tests.reduce((n, x) => n + x.afterMs, 0), 3),
    tests: topBy(tests, 'deltaMs', TOP * 2),
  };
}

function testsTotal(runs) {
  const step = (k) => ({ calls: runs.reduce((n, r) => n + r.testStep[k].calls, 0), durationMs: runs.reduce((n, r) => n + r.testStep[k].durationMs, 0) });
  return { runs: runs.length, withLogs: runs.filter((r) => r.log).length, testStep: { e2e: step('e2e'), unit: step('unit') } };
}

const testsBrief = (r, top) => ({ ...r, files: r.files.slice(0, top), fileCount: r.files.length, slowest: r.slowest.slice(0, top) });

// ---- the answer --------------------------------------------------------------------------------

const FOCUS = {
  cache: { run: cacheOf, total: cacheTotal, brief: cacheBrief },
  context: { run: contextOf, total: contextTotal, brief: contextBrief },
  tests: { run: testsOf, total: testsTotal, brief: testsBrief },
  time: { run: timeOf, total: timeTotal, brief: timeBrief },
  tools: { run: toolsOf, total: toolsTotal, brief: toolsBrief },
};

/**
 * run_analysis's answer for a focus other than cost: { runs, total, comparison? }. items: per run
 * { runId, summary (null: still running), events, logs?, testFiles? (the tests focus) }; options:
 * { agent } (the context focus).
 */
function focusAnswer(focus, items, options = {}) {
  const f = FOCUS[focus];
  if (!f) throw new Error(`Unknown focus ${focus}: one of ${FOCUSES.join(', ')}.`);
  const runs = items.map((item) => f.run({ events: [], ...item }, options));
  const answer = { runs, total: f.total(runs) };
  if (focus === 'tests' && runs.length === 2) answer.comparison = compareTests(runs[0], runs[1]);
  return answer;
}

/** The answer with each run's lists cut to their `top` largest entries (a short answer for many runs). */
function focusBrief(focus, answer, top) {
  const out = { ...answer, runs: answer.runs.map((r) => FOCUS[focus].brief(r, top)) };
  if (out.comparison) out.comparison = { ...out.comparison, tests: out.comparison.tests.slice(0, Math.max(top * 3, 5)) };
  return out;
}

module.exports = {
  bashKind,
  declaredTests,
  failureOf,
  focusAnswer,
  focusBrief,
  FOCUSES,
  suiteTimes,
};
