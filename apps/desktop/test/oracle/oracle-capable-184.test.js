// #184: the Oracle as capable as an outside Claude Code session. Acceptance tests, written before the
// code: its knowledge (the four skills it loads, kept in sync), the seeded memory and its Import, the
// run_analysis tool, the platform read tools (issues_search, issue_view, labels) through gh/glab, a
// check run on a scratch checkout of a branch (the `checker` delegate), its method rules, compaction
// that also counts the cache re-read per answer, and the docs.
// Everything the change creates (tools, exports, channels) is looked up inside each test, so this
// file loads before the code exists and each test fails on its own. gh is never started: the tools
// take an injected runner (ctx.execCli), the system boundary. No model is called (mock / simulation).
process.env.MULTIAGENT_MOCK_DELAY_SCALE ??= '0.05';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { createService, BUNDLED_SKILLS_DIR } = require('@multiagent/engine/service');
const { setupWorkspace } = require('@multiagent/engine/domains/workspace/workspace');

const ROOT = path.join(__dirname, '..', '..', '..', '..');
const loadTools = () => require('@multiagent/engine/domains/oracle/oracle-tools');
const loadOracle = () => require('@multiagent/engine/domains/oracle/oracle');
const loadActions = () => require('@multiagent/engine/domains/oracle/oracle-actions');
const KNOWLEDGE_SKILLS = ['backlog-product-owner', 'run-supervisor', 'issue-writing', 'context-economy'];
const near = (actual, expected, msg) => assert.ok(Math.abs(Number(actual) - expected) < 1e-6, `${msg}: expected ${expected}, got ${actual}`);

// A temporary folder removed after the test. Register it after the services that use it: a
// workspace removed before its service shuts down keeps the test process alive (after hooks run in
// the order they were registered).
function scratchDir(t, prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));
  return dir;
}

// A service on a workspace folder (a second call on the same folder = the app started again).
function startService(t, dir) {
  process.env.MULTIAGENT_SIMULATION_ONLY = '1'; // tests never call real models
  // #408: an empty CLI home, never the machine's transcripts
  const service = createService({ host: { trashItem: async () => {}, appVersion: '9.9.9', isPackaged: false, cliHome: path.join(dir, 'cli-home') } });
  let stopped = false;
  const stop = () => { if (!stopped) { stopped = true; service.shutdown(); } };
  t.after(stop);
  service.setWorkspace(setupWorkspace(dir, { persist: false }));
  return { service, api: service.api, stop };
}

function makeService(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oracle-184-ws-'));
  const made = startService(t, dir);
  t.after(() => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));
  return { ...made, dir };
}

// The tools' ctx, wired like test/oracle-tools.test.js (the service's own channels), plus the
// injected platform CLI runner: execCli(cli, args) → stdout (packages/engine/domains/backlog/backlog.js execCli's signature).
function makeCtx(t, { execCli } = {}) {
  const { service, api } = makeService(t);
  const runFolder = (runId) => {
    const runDir = path.join(service.workspace().runs, path.basename(String(runId || '')));
    if (!fs.existsSync(path.join(runDir, 'events.jsonl'))) throw new Error(`Run not found: ${runId}`);
    return runDir;
  };
  const ctx = {
    get ws() { return service.workspace(); },
    BUNDLED_SKILLS_DIR,
    listWorkflows: () => api['workflows:list'](),
    loadBuilderWorkflow: (file) => api['builder:load'](file),
    listAllRuns: () => api['runs:list'](),
    activeRuns: () => api['runs:active'](),
    usageSnapshot: (scope) => api['usage:get']({ scope }),
    analyticsSnapshot: (opts) => api['analytics:get'](opts),
    workflowDirs: () => [service.workspace().workflows],
    runFolder,
    roadmapView: (projectId) => api['roadmap:get']({ projectId }),
    withIssueRuns: (data) => api['backlog:get']({ projectId: data.projectId }),
    unpushedProjects: () => api['backlog:unpushed'](),
    execCli,
  };
  return { ctx, api, service };
}

// machine-independent git (docs/agents/testing.md): an empty global config, identity and defaults by -c
let emptyGitConfig = null;
const gitConfig = () => {
  if (!emptyGitConfig) {
    emptyGitConfig = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'oracle-184-gitcfg-')), 'config');
    fs.writeFileSync(emptyGitConfig, '');
  }
  return emptyGitConfig;
};
const git = (cwd, args) => execFileSync('git', ['-c', 'user.name=Test', '-c', 'user.email=t@e.st', '-c', 'core.autocrlf=false', '-c', 'init.defaultBranch=main', ...args], {
  cwd, encoding: 'utf8', env: { ...process.env, GIT_CONFIG_GLOBAL: gitConfig(), GIT_CONFIG_NOSYSTEM: '1' },
});

function tmpRepo(t) {
  const dir = scratchDir(t, 'oracle-184-repo-');
  git(dir, ['init', '-q']);
  fs.writeFileSync(path.join(dir, 'README.md'), 'hello\n');
  git(dir, ['add', '.']);
  git(dir, ['commit', '-q', '-m', 'first commit']);
  return dir;
}

// a branch with one test file on it; the checkout goes back to main
function branchWithTest(dir, branch, file, body) {
  git(dir, ['checkout', '-q', '-b', branch]);
  fs.writeFileSync(path.join(dir, file), body);
  git(dir, ['add', file]);
  git(dir, ['commit', '-q', '-m', `add ${file}`]);
  git(dir, ['checkout', '-q', 'main']);
}

const toolNamed = (tools, name) => {
  const tool = tools.find((x) => x.name === name);
  assert.ok(tool, `the Oracle has a ${name} tool (has: ${tools.map((x) => x.name).join(', ')})`);
  return tool;
};
async function callNamed(ctx, name, input) {
  const { callTool, oracleTools } = loadTools();
  const tools = oracleTools(ctx);
  toolNamed(tools, name);
  return callTool(tools, name, input);
}

// ---- 1. knowledge: the four skills it loads, kept in sync ---------------------------------------

// Accepts both designs of the issue: by reference (the skill's body goes into the session's opening
// prompt, e.g. through the oracle skill's `uses:`) or a digest (the session names the skill, and a
// digest next to the oracle skill records a hash of the source skill's current content: editing the
// source without refreshing the digest fails here).
function digestHashes(id) {
  const dir = path.join(BUNDLED_SKILLS_DIR, id);
  const raw = fs.readFileSync(path.join(dir, 'SKILL.md'));
  const lf = Buffer.from(raw.toString('utf8').replace(/\r\n/g, '\n'));
  const hashes = [];
  for (const algo of ['sha256', 'sha1', 'md5']) for (const b of [raw, lf]) hashes.push(crypto.createHash(algo).update(b).digest('hex'));
  const kind = require('@multiagent/engine/domains/agents/skills').SKILL_KIND;
  if (typeof kind?.hash === 'function') hashes.push(kind.hash(BUNDLED_SKILLS_DIR, id));
  return hashes.map((h) => h.slice(0, 12));
}
function digestTexts() {
  const files = [];
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (e.isDirectory()) walk(path.join(d, e.name));
      else files.push(path.join(d, e.name));
    }
  };
  walk(path.join(BUNDLED_SKILLS_DIR, 'oracle'));
  const oracleDir = path.join(ROOT, 'packages', 'engine', 'domains', 'oracle');
  for (const f of fs.readdirSync(oracleDir)) if (/^oracle/.test(f) && /\.(js|json|md)$/.test(f)) files.push(path.join(oracleDir, f));
  return files.map((f) => fs.readFileSync(f, 'utf8')).join('\n');
}

test('knowledge: a new Oracle session loads backlog-product-owner, run-supervisor, issue-writing and context-economy (whole, or as a digest that matches the current skill)', async (t) => {
  const { service, api } = makeService(t);
  await api['oracle:ask']({ question: 'What do you know?', mock: true });
  const session = fs.readFileSync(path.join(service.workspace().oracle, 'session.md'), 'utf8').replace(/\r\n/g, '\n');
  const { resolveSkill } = require('@multiagent/engine/domains/agents/skills');
  const digests = digestTexts();
  for (const id of KNOWLEDGE_SKILLS) {
    const body = resolveSkill([BUNDLED_SKILLS_DIR], id).body.replace(/\r\n/g, '\n').trim();
    const whole = session.includes(body.slice(0, 400));
    const digested = session.includes(id) && digestHashes(id).some((h) => digests.includes(h));
    assert.ok(whole || digested, `${id}: the session neither holds the skill nor a digest whose recorded hash matches skills/${id}/SKILL.md (stale or missing digest)`);
  }
});

// ---- 2. the seeded memory, never edited behind the owner's back, and its Import -------------------

test('memory: the first start creates oracle/memory.md with the owner\'s standing decisions', (t) => {
  const { service, api } = makeService(t);
  api['oracle:state']();
  const file = path.join(service.workspace().oracle, 'memory.md');
  assert.ok(fs.existsSync(file), 'memory.md exists after the first start');
  const text = api['oracle:memory']().text;
  assert.equal(fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n'), text.replace(/\r\n/g, '\n'));
  const decisions = {
    'answer in the owner\'s language (Portuguese)': /Portuguese|owner's language/i,
    'everything in the product in English': /English/,
    'UI issues carry UI criteria': /\bUI\b[^\n]*criteri/i,
    'only the test writer writes tests': /test writer/i,
    'one app per workspace': /one app[^\n]*workspace/i,
    'edited workspace copies freeze': /edited[^\n]*(freez|frozen)|(freez|frozen)[^\n]*edited/i,
    'real runs cost money': /real runs?[^\n]*(cost|money)/i,
  };
  for (const [what, re] of Object.entries(decisions)) assert.match(text, re, `the seeded memory says: ${what}`);
});

test('memory: a later start never rewrites the memory the owner saved, even an emptied one', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oracle-184-ws-'));
  const started = [];
  const start = () => { const s = startService(t, dir); started.push(s); return s; };
  try {
    const first = start();
    first.api['oracle:state']();
    first.api['oracle:saveMemory']('- My own rule: ship small PRs.\n');
    first.stop();

    const second = start();
    second.api['oracle:state']();
    assert.equal(second.api['oracle:memory']().text, '- My own rule: ship small PRs.\n');
    second.api['oracle:saveMemory']('');
    second.stop();

    const third = start();
    third.api['oracle:state']();
    assert.equal(third.api['oracle:memory']().text, '', 'an emptied memory stays empty');
  } finally {
    for (const s of started) s.stop();
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

test('memory Import: entries pasted from a Claude Code memory index join the memory; the owner\'s entries stay', async (t) => {
  const { api } = makeService(t);
  api['oracle:saveMemory']('- My own rule: ship small PRs.\n');
  const pasted = [
    '# Memory index',
    '- [PRs only](feedback_prs.md) - never commit to main; open a branch and a PR',
    '- [Costs](feedback_costs.md) - keep real-model calls minimal',
  ].join('\n');
  assert.equal(typeof api['oracle:importMemory'], 'function', 'the oracle:importMemory channel exists');
  const out = await api['oracle:importMemory']({ text: pasted });
  const text = typeof out === 'string' ? out : out?.text;
  assert.equal(typeof text, 'string', 'Import answers with the memory text');
  assert.match(text, /My own rule: ship small PRs/);
  assert.match(text, /never commit to main/);
  assert.match(text, /keep real-model calls minimal/);
  assert.doesNotMatch(text, /\]\(feedback_[a-z]+\.md\)/, 'the index\'s links to memory files are not decisions');
});

test('memory drawer: the Memory panel has an Import action that calls importOracleMemory', () => {
  const src = fs.readFileSync(path.join(ROOT, 'apps', 'desktop', 'renderer', 'views', 'oracle', 'oracle.js'), 'utf8');
  assert.match(src, /importOracleMemory/);
  // #330: the button's text comes from the catalog
  assert.match(src, />\s*\$\{t\('oracle\.import'\)\}/);
  const en = JSON.parse(fs.readFileSync(path.join(ROOT, 'packages', 'shared', 'i18n', 'en.json'), 'utf8'));
  assert.equal(en['oracle.import'], 'Import');
});

// ---- 3. run_analysis ---------------------------------------------------------------------------

const MIN = 60e3;
const at = (day, m) => new Date(Date.parse(`${day}T10:00:00.000Z`) + m * MIN).toISOString();
const u = (input, output, cache_read, cache_write) => ({ input, output, cache_read, cache_write, reasoning: 0 });
const opened = (ts, id, agent, step) => ({ ts, type: 'session.opened', session_id: id, session: { id, agent, provider: 'claude', model: 'claude-opus-5-5', step_id: step } });
const turn = (ts, sid, n, step, cost, usage) => ({ ts, type: 'session.message_received', session_id: sid, turn: n, step_id: step, text: 'done', usage, cost_usd: cost });
const call = (ts, sid, id, command) => ({ ts, type: 'session.stream', session_id: sid, turn: 1, item: { kind: 'tool_call', id, name: 'Bash', input: { command } } });
const result = (ts, sid, id, output, isError = false) => ({ ts, type: 'session.stream', session_id: sid, turn: 1, item: { kind: 'tool_result', id, output, is_error: isError } });
const started = (ts, step, visit, agent, type = 'agent') => ({ ts, type: 'step.started', step_id: step, visit, step_type: type, agent });
const finished = (ts, step, visit, output = {}) => ({ ts, type: 'step.finished', step_id: step, visit, output });

// Run A (2026-10-02): test writer (2 turns), developer (2 visits; 2 refused calls, a whole suite
// started by the agent for 2 min, a command cut by the tool's timeout), reviewer (2 rounds, one
// attempt timed out, one invalid output), the orchestrator's full suite (4 min), a merge conflict.
// Cost: test_writer 1, developer 4, reviewer 1 = 6.
const RUN_A = 'run-184-a';
const D = '2026-10-02';
const EVENTS_A = [
  { ts: at(D, 0), type: 'workflow.started', workflow: 'AI Development', file: 'ai-development.yaml', mock: false, cost_accounting: 'per_turn' },
  started(at(D, 0), 'tests', 1, 'test_writer'),
  opened(at(D, 0), 's1', 'test_writer', 'tests'),
  turn(at(D, 2), 's1', 1, 'tests', 0.5, u(1000, 500, 8000, 0)),
  turn(at(D, 4), 's1', 2, 'tests', 0.5, u(1000, 500, 30000, 0)),
  finished(at(D, 4), 'tests', 1),
  started(at(D, 5), 'develop', 1, 'developer'),
  opened(at(D, 5), 's2', 'developer', 'develop'),
  call(at(D, 5), 's2', 'd0', 'gh pr view'),
  result(at(D, 5), 's2', 'd0', 'This command requires approval', true),
  call(at(D, 5), 's2', 'd1', 'cmd /c gh pr view'),
  result(at(D, 5), 's2', 'd1', 'This command requires approval', true),
  { ts: at(D, 5), type: 'log', level: 'warn', kind: 'permission_denials', step_id: 'develop', agent: 'developer', denials: 2, message: '[developer] 2 tool calls refused by its allowlist in one turn of develop' },
  call(at(D, 6), 's2', 'c1', 'npm test'),
  { ts: at(D, 6), type: 'log', level: 'warn', kind: 'full_suite_by_agent', step_id: 'develop', agent: 'developer', command: 'npm test', message: '[developer] started the whole test suite in develop (`npm test`)' },
  result(at(D, 8), 's2', 'c1', 'ℹ pass 120'),
  call(at(D, 9), 's2', 'c2', 'node --test test/slow.test.js'),
  { ts: at(D, 11), type: 'log', level: 'warn', kind: 'tool_timeout', step_id: 'develop', agent: 'developer', command: 'node --test test/slow.test.js', timeout_ms: null, message: '[developer] a command was cut by the tool\'s default timeout' },
  result(at(D, 11), 's2', 'c2', 'Command timed out after 2m 0.0s', true),
  turn(at(D, 15), 's2', 1, 'develop', 3, u(200000, 20000, 700000, 80000)),
  finished(at(D, 15), 'develop', 1),
  started(at(D, 15), 'review', 1, 'reviewer'),
  opened(at(D, 15), 's3', 'reviewer', 'review'),
  { ts: at(D, 45), type: 'session.attempt_stopped', session_id: 's3', turn: 1, step_id: 'review', attempt: 1, error: 'Timed out after 1800s', cost_usd: 0, cost_not_recorded: true },
  turn(at(D, 47), 's3', 1, 'review', 0.25, u(10000, 1000, 20000, 0)),
  { ts: at(D, 47), type: 'log', level: 'warn', kind: 'invalid_output', step_id: 'review', message: 'Invalid output in review: must have required property \'verdict\'' },
  turn(at(D, 48), 's3', 2, 'review', 0.25, u(10000, 1000, 20000, 0)),
  finished(at(D, 48), 'review', 1, { verdict: 'changes_requested' }),
  started(at(D, 48), 'develop', 2, 'developer'),
  turn(at(D, 53), 's2', 2, 'develop', 1, u(50000, 10000, 400000, 40000)),
  finished(at(D, 53), 'develop', 2),
  started(at(D, 53), 'review', 2, 'reviewer'),
  turn(at(D, 55), 's3', 3, 'review', 0.5, u(10000, 1000, 20000, 0)),
  finished(at(D, 55), 'review', 2, { verdict: 'approved' }),
  started(at(D, 55), 'suite', 1, '', 'suite'),
  finished(at(D, 59), 'suite', 1, { kind: 'suite', status: 'pass', round: 1, scope: 'full', duration_ms: 4 * MIN, failures: [], preexisting: [] }),
  { ts: at(D, 60), type: 'step.probe', step_id: 'merge', probe: 'pr_mergeable', state: 'conflict', detail: 'the PR conflicts with its base (CI will not start)' },
  { ts: at(D, 61), type: 'workflow.finished', status: 'success' },
];
const SUMMARY_A = {
  run_id: RUN_A, workflow: 'AI Development', status: 'success', mock: false, cost_accounting: 'per_turn',
  started_at: at(D, 0), finished_at: at(D, 61), duration_ms: 61 * MIN, cost_usd: 6,
  tokens: u(282000, 34000, 1198000, 120000), tool_timeouts: 1,
  steps: { tests: { visits: 1 }, develop: { visits: 2 }, review: { visits: 2 }, suite: { visits: 1 } },
  context: { agents: { test_writer: { mode: 'resume', turns: 2, per_turn: [{ step: 'tests', visit: 1, start: 20000, peak: 40000 }, { step: 'tests', visit: 1, start: 40000, peak: 60000 }] } } },
  sessions: [
    { id: 's1', agent: 'test_writer', provider: 'claude', step_id: 'tests', turns: 2, cost_usd: 1, tokens: u(2000, 1000, 38000, 0) },
    { id: 's2', agent: 'developer', provider: 'claude', step_id: 'develop', turns: 2, cost_usd: 4, tokens: u(250000, 30000, 1100000, 120000) },
    { id: 's3', agent: 'reviewer', provider: 'claude', step_id: 'review', turns: 3, cost_usd: 1, tokens: u(30000, 3000, 60000, 0) },
  ],
};

// Run B (2026-09-01): developer 2, reviewer 0.5 (one round). Nothing went wrong.
const RUN_B = 'run-184-b';
const DB = '2026-09-01';
const EVENTS_B = [
  { ts: at(DB, 0), type: 'workflow.started', workflow: 'AI Development', file: 'ai-development.yaml', mock: false, cost_accounting: 'per_turn' },
  started(at(DB, 0), 'develop', 1, 'developer'),
  opened(at(DB, 0), 'b1', 'developer', 'develop'),
  turn(at(DB, 10), 'b1', 1, 'develop', 2, u(100000, 5000, 0, 0)),
  finished(at(DB, 10), 'develop', 1),
  started(at(DB, 10), 'review', 1, 'reviewer'),
  opened(at(DB, 10), 'b2', 'reviewer', 'review'),
  turn(at(DB, 12), 'b2', 1, 'review', 0.5, u(10000, 1000, 0, 0)),
  finished(at(DB, 12), 'review', 1, { verdict: 'approved' }),
  { ts: at(DB, 12), type: 'workflow.finished', status: 'success' },
];
const SUMMARY_B = {
  run_id: RUN_B, workflow: 'AI Development', status: 'success', mock: false, cost_accounting: 'per_turn',
  started_at: at(DB, 0), finished_at: at(DB, 12), duration_ms: 12 * MIN, cost_usd: 2.5, tokens: u(110000, 6000, 0, 0),
  steps: { develop: { visits: 1 }, review: { visits: 1 } },
  sessions: [
    { id: 'b1', agent: 'developer', provider: 'claude', step_id: 'develop', turns: 1, cost_usd: 2, tokens: u(100000, 5000, 0, 0) },
    { id: 'b2', agent: 'reviewer', provider: 'claude', step_id: 'review', turns: 1, cost_usd: 0.5, tokens: u(10000, 1000, 0, 0) },
  ],
};

function writeRun(runsDir, id, events, summary) {
  const dir = path.join(runsDir, id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'events.jsonl'), `${events.map((e, i) => JSON.stringify({ seq: i + 1, run_id: id, ...e })).join('\n')}\n`);
  fs.writeFileSync(path.join(dir, 'summary.json'), JSON.stringify(summary, null, 2));
}
function ctxWithRuns(t) {
  const made = makeCtx(t);
  writeRun(made.service.workspace().runs, RUN_A, EVENTS_A, SUMMARY_A);
  writeRun(made.service.workspace().runs, RUN_B, EVENTS_B, SUMMARY_B);
  return made;
}
const analysis = async (ctx, input) => {
  const out = await callNamed(ctx, 'run_analysis', input);
  assert.equal(out.isError, false, out.text);
  return JSON.parse(out.text);
};
const runOf = (data, id) => {
  const r = data.runs.find((x) => x.runId === id);
  assert.ok(r, `run ${id} is in the analysis`);
  return r;
};

test('run_analysis: cost and tokens of one run by agent and by step', async (t) => {
  const { ctx } = ctxWithRuns(t);
  const a = runOf(await analysis(ctx, { runIds: [RUN_A] }), RUN_A);
  near(a.costUsd, 6, 'the run\'s cost');
  near(a.byAgent.test_writer.costUsd, 1, 'test_writer');
  near(a.byAgent.developer.costUsd, 4, 'developer');
  near(a.byAgent.reviewer.costUsd, 1, 'reviewer');
  near(a.byStep.tests.costUsd, 1, 'step tests');
  near(a.byStep.develop.costUsd, 4, 'step develop');
  near(a.byStep.review.costUsd, 1, 'step review');
  assert.equal(a.byAgent.developer.tokens.input, 250000);
  assert.equal(a.byAgent.developer.tokens.cache_read, 1100000);
  assert.equal(a.byStep.review.tokens.output, 3000);
  assert.equal(a.tokens.input, 282000);
});

test('run_analysis: review rounds, timeouts, invalid outputs, refused calls, merge conflicts and commands cut by a tool timeout', async (t) => {
  const { ctx } = ctxWithRuns(t);
  const a = runOf(await analysis(ctx, { runIds: [RUN_A] }), RUN_A);
  assert.equal(a.reviewRounds, 2);
  assert.equal(a.timeouts, 1);
  assert.equal(a.invalidOutputs, 1);
  assert.equal(a.refusedCalls, 2);
  assert.equal(a.mergeConflicts, 1);
  assert.equal(a.toolTimeouts, 1);
});

test('run_analysis: the test writer\'s turns, peak context and cache re-read; whole-suite starts with their durations', async (t) => {
  const { ctx } = ctxWithRuns(t);
  const a = runOf(await analysis(ctx, { runIds: [RUN_A] }), RUN_A);
  assert.equal(a.testWriter.turns, 2);
  assert.equal(a.testWriter.peakContextTokens, 60000);
  assert.equal(a.testWriter.cacheReadTokens, 38000);
  // the orchestrator's full suite (4 min) and the one the developer started itself (2 min)
  assert.equal(a.fullSuites.length, 2);
  assert.deepEqual(a.fullSuites.map((s) => s.durationMs).sort((x, y) => x - y), [2 * MIN, 4 * MIN]);
  assert.ok(a.fullSuites.some((s) => s.by === 'developer'), 'the agent-started suite names its agent');
});

test('run_analysis: several runs add up in a total; since keeps only the runs started from that date', async (t) => {
  const { ctx } = ctxWithRuns(t);
  const both = await analysis(ctx, { runIds: [RUN_A, RUN_B] });
  assert.equal(both.runs.length, 2);
  near(both.total.costUsd, 8.5, 'the total cost');
  near(both.total.byAgent.developer.costUsd, 6, 'the developer across runs');
  assert.equal(both.total.reviewRounds, 3);
  assert.equal(both.total.refusedCalls, 2);
  assert.equal(both.total.toolTimeouts, 1);
  assert.equal(both.total.tokens.input, 392000);

  const recent = await analysis(ctx, { since: '2026-10-01T00:00:00.000Z' });
  assert.deepEqual(recent.runs.map((r) => r.runId), [RUN_A]);
  near(recent.total.costUsd, 6, 'the total since 2026-10-01');
});

// ---- 4. platform read tools through gh/glab -------------------------------------------------------

const WRITE_VERBS = ['create', 'edit', 'close', 'reopen', 'delete', 'comment', 'lock', 'unlock', 'transfer', 'pin', 'unpin', 'develop', 'merge'];
const fakeGh = () => {
  const calls = [];
  const execCli = async (cli, args) => {
    calls.push({ cli, args: [...args] });
    if (args.includes('label')) return JSON.stringify([{ name: 'bug' }, { name: 'area:engine' }, { name: 'complexity:2' }]);
    if (args.includes('view')) return JSON.stringify({ number: 12, title: 'Login fails on Windows', state: 'OPEN', body: 'Steps to reproduce: sign in.', labels: [{ name: 'bug' }, { name: 'area:engine' }] });
    return JSON.stringify([{ number: 12, title: 'Login fails on Windows', state: 'OPEN', labels: [{ name: 'bug' }] }]);
  };
  return { calls, execCli };
};
async function platformProject(t, api, service) {
  const folder = tmpRepo(t);
  const project = await api['projects:create']({ name: 'Widgets', folder, repo: 'https://github.com/acme/widgets' });
  // a synced backlog of the project (its platform and repository)
  fs.writeFileSync(path.join(service.workspace().backlog, `${project.id}.json`), JSON.stringify({ projectId: project.id, platform: 'github', repo: 'https://github.com/acme/widgets', issues: [] }));
  return project;
}
const assertReadOnly = (calls) => {
  assert.ok(calls.length > 0, 'the platform CLI was called');
  for (const { cli, args } of calls) {
    assert.equal(cli, 'gh');
    const bad = args.filter((a) => WRITE_VERBS.includes(a) || /^(POST|PATCH|PUT|DELETE)$/i.test(a) || /^(-X|--method)(=|$)/.test(a));
    assert.deepEqual(bad, [], `gh ${args.join(' ')} only reads`);
    assert.ok(args.join(' ').includes('acme/widgets'), `gh ${args.join(' ')} targets the project's repository`);
  }
};

test('issues_search, issue_view and labels: read the project\'s issues and labels through gh, read-only', async (t) => {
  const gh = fakeGh();
  const { ctx, api, service } = makeCtx(t, { execCli: gh.execCli });
  const project = await platformProject(t, api, service);

  const found = await callNamed(ctx, 'issues_search', { projectId: project.id, query: 'login windows', state: 'open' });
  assert.equal(found.isError, false, found.text);
  assert.match(found.text, /Login fails on Windows/);
  assert.match(gh.calls.at(-1).args.join(' '), /login windows/);
  assert.match(gh.calls.at(-1).args.join(' '), /open/);

  const one = await callNamed(ctx, 'issue_view', { projectId: project.id, number: 12 });
  assert.equal(one.isError, false, one.text);
  assert.match(one.text, /Steps to reproduce/);
  assert.ok(gh.calls.at(-1).args.includes('12'), 'issue_view asks for issue 12');

  const labels = await callNamed(ctx, 'labels', { projectId: project.id });
  assert.equal(labels.isError, false, labels.text);
  assert.match(labels.text, /area:engine/);
  assert.match(labels.text, /complexity:2/);

  assertReadOnly(gh.calls);
});

test('issue cards: an issue.file card says whether a duplicate was searched', () => {
  const { actionCard } = loadActions();
  const base = { projectId: 'p1', title: 'Login fails on Windows', body: 'Problem first.', labels: ['bug', 'area:engine', 'complexity:2'] };
  const searched = JSON.stringify(actionCard({ kind: 'issue.file', params: { ...base, duplicateSearch: 'searched "login windows": #12 is related, not a duplicate' }, why: 'w', requestedBy: 'owner' }));
  assert.match(searched, /login windows/);
  assert.match(searched, /duplicate/i);
  const unsearched = JSON.stringify(actionCard({ kind: 'issue.file', params: base, why: 'w', requestedBy: 'owner' }));
  assert.match(unsearched, /(no|without)[^."]*duplicate[^."]*search|duplicates?[^."]*not (been )?searched/i);
});

// ---- 5. verify by running: a check on a scratch checkout of a branch ------------------------------

const ENV_CHECK = `const test = require('node:test');
const assert = require('node:assert');
test('check runs in simulation only', () => assert.equal(process.env.MULTIAGENT_SIMULATION_ONLY, '1'));
`;
const FAILING = `const test = require('node:test');
const assert = require('node:assert');
test('check sees the bug', () => assert.equal(1 + 1, 3));
`;

async function checkOn(t, file, body) {
  const { api } = makeService(t);
  const folder = tmpRepo(t);
  branchWithTest(folder, 'feature', file, body);
  const project = await api['projects:create']({ name: 'Check project', folder });
  // MULTIAGENT_SIMULATION_ONLY stays set (never lifted in a test); mock: true keeps the delegation simulated
  const out = await api['oracle:delegate']({ to: 'checker', question: `Does ${file} pass on feature?`, projectId: project.id, branch: 'feature', command: `node --test ${file}`, mock: true });
  return { out, folder };
}

test('check: the checker runs a test file on a scratch checkout of the branch, with MULTIAGENT_SIMULATION_ONLY=1, and returns the result with its evidence', async (t) => {
  assert.ok(loadTools().DELEGATES.includes('checker'), 'checker is one of the Oracle\'s delegates');
  const { out, folder } = await checkOn(t, 'check.test.js', ENV_CHECK);
  assert.equal(out.error, false, out.text);
  assert.match(out.text, /check runs in simulation only/);
  assert.match(out.text, /pass/i);
  assert.doesNotMatch(out.text, /\bfail(ed)? [1-9]|✖/);
  // the project's own checkout is untouched: still on main, clean, no extra worktree left
  assert.equal(git(folder, ['rev-parse', '--abbrev-ref', 'HEAD']).trim(), 'main');
  assert.equal(git(folder, ['status', '--porcelain']).trim(), '');
  assert.equal(fs.existsSync(path.join(folder, 'check.test.js')), false);
  assert.equal(git(folder, ['worktree', 'list']).trim().split('\n').length, 1);
});

test('check: a failing test on the branch comes back as a failure with the failing test named', async (t) => {
  const { out } = await checkOn(t, 'bug.test.js', FAILING);
  assert.match(out.text, /fail/i);
  assert.match(out.text, /check sees the bug/);
});

test('check: a check that costs money or takes long is an action card (check.run) naming the branch and the command', () => {
  const { ACTION_KINDS, actionCard } = loadActions();
  assert.ok(ACTION_KINDS.includes('check.run'), `check.run is an action kind (has: ${ACTION_KINDS.join(', ')})`);
  const card = actionCard({ kind: 'check.run', params: { projectId: 'p1', branch: 'feature', command: 'npm test' }, why: 'verify the claim', requestedBy: 'oracle' });
  const text = JSON.stringify(card);
  assert.match(text, /feature/);
  assert.match(text, /npm test/);
});

// ---- 6 / 7. its method, small context and compaction ---------------------------------------------

test('skill: the oracle skill states the method (whole branch, primary sources, hypotheses marked, explicit corrections, heavy reading delegated, issue labels and duplicates)', () => {
  const skill = fs.readFileSync(path.join(BUNDLED_SKILLS_DIR, 'oracle', 'SKILL.md'), 'utf8');
  assert.match(skill, /base\.\.\.(<?branch>?|head)/i, 'judges a change on base...branch');
  assert.match(skill, /every commit|all (the )?commits|whole branch/i);
  assert.match(skill, /primary source/i);
  assert.match(skill, /file:line/i);
  assert.match(skill, /(mark|label|flag)[^.\n]*hypothes|hypothes[^.\n]*(mark|label|flag)/i);
  assert.match(skill, /correct[^.\n]*explicit|explicit[^.\n]*correct/i);
  assert.match(skill, /heavy reading[^.\n]*(delegate|sub-?agent)|(delegate|sub-?agent)[^.\n]*heavy reading/i);
  assert.match(skill, /area:/);
  assert.match(skill, /complexity:/);
  assert.match(skill, /duplicate/i);
});

test('compaction: 150k tokens of context still compacts; a large cache re-read per answer compacts below it', () => {
  const o = loadOracle();
  assert.equal(o.DEFAULTS.compactAtTokens, 150000);
  assert.equal(typeof o.shouldCompact, 'function', 'packages/engine/domains/oracle/oracle.js exports shouldCompact');
  const settings = {};
  assert.equal(o.shouldCompact({ contextTokens: 150000, cacheReadTokens: 0 }, settings), true);
  assert.equal(o.shouldCompact({ contextTokens: 60000, cacheReadTokens: 60000 }, settings), false);
  // 60k of context re-read by ~80 model calls in one answer
  assert.equal(o.shouldCompact({ contextTokens: 60000, cacheReadTokens: 5000000 }, settings), true);
});

// ---- 9. docs ---------------------------------------------------------------------------------------

test('docs: the README says what the Oracle knows and can do; capabilities.md lists its new tools', () => {
  const readme = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8');
  const start = readme.indexOf('### The Oracle');
  assert.ok(start >= 0, 'the README has a "The Oracle" section');
  const next = readme.slice(start + 1).search(/\n#{2,3} /);
  const oracleSection = next < 0 ? readme.slice(start) : readme.slice(start, start + 1 + next);
  for (const id of KNOWLEDGE_SKILLS) assert.ok(oracleSection.includes(id), `the README's Oracle section names ${id}`);
  assert.match(oracleSection, /run_analysis/);
  assert.match(oracleSection, /issues_search/);
  // the capabilities list lives in scripts/doc-rules.js, shared with `npm run check` (#404)
  const { checkOracleCapabilities, ORACLE_TOOLS } = require('../../../../scripts/doc-rules');
  assert.deepEqual([...ORACLE_TOOLS].sort(), ['checker', 'issue_view', 'issues_search', 'labels', 'run_analysis']);
  assert.deepEqual(checkOracleCapabilities(ROOT).map((p) => p.message), []);
});
