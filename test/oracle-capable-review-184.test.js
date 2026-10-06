// #184 review round: run_analysis selection through the tool (since order, the cap of analysed runs,
// an invalid date, the short answer above the per-call budget), compaction on the cache re-read per
// answer (its message and its setting), the platform read tools for a project without a synced
// backlog (settings' platform and the project's repo), and the benchmark questions of 2026-10-01/02
// kept as fixtures (test/fixtures/oracle-benchmark) the skill and the tools must still answer.
// gh/glab are never started (ctx.execCli is the boundary); no model is called (mock / simulation).
process.env.MULTIAGENT_MOCK_DELAY_SCALE ??= '0.05';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { createService, BUNDLED_SKILLS_DIR } = require('../src/service');
const { setupWorkspace } = require('../src/workspace');
const oracle = require('../src/oracle');
const { oracleTools, callTool, DELEGATES } = require('../src/oracle-tools');

const ROOT = path.join(__dirname, '..');

// A service on a scratch workspace; the folder is removed after the service stops (hooks run in order).
function makeService(t) {
  process.env.MULTIAGENT_SIMULATION_ONLY = '1';
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oracle-184r-ws-'));
  const service = createService({ host: { trashItem: async () => {}, appVersion: '9.9.9', isPackaged: false } });
  t.after(() => service.shutdown());
  t.after(() => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));
  service.setWorkspace(setupWorkspace(dir, { persist: false }));
  return { service, api: service.api };
}

function makeCtx(t, { execCli } = {}) {
  const { service, api } = makeService(t);
  const ctx = {
    get ws() { return service.workspace(); },
    BUNDLED_SKILLS_DIR,
    runFolder: (runId) => {
      const runDir = path.join(service.workspace().runs, path.basename(String(runId || '')));
      if (!fs.existsSync(path.join(runDir, 'events.jsonl'))) throw new Error(`Run not found: ${runId}`);
      return runDir;
    },
    execCli,
  };
  return { ctx, service, api };
}

const call = (ctx, name, input) => callTool(oracleTools(ctx), name, input);

// ---- run_analysis through the tool ----------------------------------------------------------------

const DAY = 24 * 3600e3;
const BASE = Date.parse('2026-09-01T10:00:00.000Z');
const iso = (ms) => new Date(ms).toISOString();

// One finished run started at `startMs`, with one session per agent (agent i on step i, cost i).
function writeRun(runsDir, id, startMs, agents = 1) {
  const dir = path.join(runsDir, id);
  fs.mkdirSync(dir, { recursive: true });
  const events = [{ ts: iso(startMs), type: 'workflow.started', workflow: 'AI Development', mock: false, cost_accounting: 'per_turn' }];
  const sessions = [];
  let cost = 0;
  for (let i = 1; i <= agents; i += 1) {
    const sid = `${id}-s${i}`;
    const usage = { input: 1000 * i, output: 100 * i, cache_read: 5000 * i, cache_write: 0, reasoning: 0 };
    events.push({ ts: iso(startMs + i * 1000), type: 'session.opened', session_id: sid, session: { id: sid, agent: `agent${i}`, provider: 'claude', model: 'claude-opus-5-5', step_id: `step${i}` } });
    events.push({ ts: iso(startMs + i * 1000 + 500), type: 'session.message_received', session_id: sid, turn: 1, step_id: `step${i}`, text: 'done', usage, cost_usd: i });
    sessions.push({ id: sid, agent: `agent${i}`, provider: 'claude', step_id: `step${i}`, turns: 1, cost_usd: i, tokens: usage });
    cost += i;
  }
  events.push({ ts: iso(startMs + 60e3), type: 'workflow.finished', status: 'success' });
  fs.writeFileSync(path.join(dir, 'events.jsonl'), `${events.map((e, n) => JSON.stringify({ seq: n + 1, run_id: id, ...e })).join('\n')}\n`);
  fs.writeFileSync(path.join(dir, 'summary.json'), JSON.stringify({
    run_id: id, workflow: 'AI Development', status: 'success', mock: false, cost_accounting: 'per_turn',
    started_at: iso(startMs), finished_at: iso(startMs + 60e3), duration_ms: 60e3, cost_usd: cost, sessions,
  }));
}

test('run_analysis since: the runs come oldest first, whatever their folder names', async (t) => {
  const { ctx, service } = makeCtx(t);
  const runs = service.workspace().runs;
  writeRun(runs, 'zz-oldest', BASE);
  writeRun(runs, 'aa-newest', BASE + 2 * DAY);
  writeRun(runs, 'mm-middle', BASE + DAY);
  writeRun(runs, 'before-since', BASE - 10 * DAY);
  const out = await call(ctx, 'run_analysis', { since: '2026-08-31T00:00:00.000Z' });
  assert.equal(out.isError, false, out.text);
  const data = JSON.parse(out.text);
  assert.deepEqual(data.runs.map((r) => r.runId), ['zz-oldest', 'mm-middle', 'aa-newest']);
  assert.equal(data.total.costUsd, 3);
});

test('run_analysis since: at most 30 runs are analysed, the newest ones', async (t) => {
  const { ctx, service } = makeCtx(t);
  const runs = service.workspace().runs;
  for (let i = 0; i < 32; i += 1) writeRun(runs, `run-${String(99 - i).padStart(2, '0')}`, BASE + i * DAY);
  const out = await call(ctx, 'run_analysis', { since: '2026-01-01T00:00:00.000Z' });
  assert.equal(out.isError, false, out.text);
  const ids = JSON.parse(out.text).runs.map((r) => r.runId);
  assert.equal(ids.length, 30);
  // the two oldest (run-99, run-98) are left out; the newest (run-68) is last
  assert.ok(!ids.includes('run-99') && !ids.includes('run-98'), ids.join(','));
  assert.equal(ids[0], 'run-97');
  assert.equal(ids.at(-1), 'run-68');
});

test('run_analysis: an invalid since date is an error that names it', async (t) => {
  const { ctx } = makeCtx(t);
  const out = await call(ctx, 'run_analysis', { since: 'last tuesday-ish' });
  assert.equal(out.isError, true);
  assert.match(out.text, /since.*last tuesday-ish/);
});

test('run_analysis: an answer over the per-call budget keeps only each run\'s costliest agents and steps, the total keeps them all', async (t) => {
  const { ctx, service } = makeCtx(t);
  const runs = service.workspace().runs;
  const ids = [];
  for (let i = 0; i < 30; i += 1) {
    const id = `big-${String(i).padStart(2, '0')}`;
    writeRun(runs, id, BASE + i * DAY, 12);
    ids.push(id);
  }
  const out = await call(ctx, 'run_analysis', { runIds: ids });
  assert.equal(out.isError, false, out.text);
  const data = JSON.parse(out.text);
  assert.match(data.note || '', /fewer runIds/, 'a note says to ask for fewer runs');
  assert.equal(data.runs.length, 30);
  for (const r of data.runs) {
    assert.equal(r.byAgent, undefined, 'no per-run byAgent in the short answer');
    assert.equal(r.byStep, undefined, 'no per-run byStep in the short answer');
    const top = Object.keys(r.topAgents);
    assert.ok(top.length <= 3, `at most 3 agents per run, got ${top.length}`);
    // the costliest first: agent12 (cost 12), agent11, agent10
    assert.deepEqual(top, ['agent12', 'agent11', 'agent10'].slice(0, top.length));
    assert.deepEqual(Object.keys(r.topSteps), ['step12', 'step11', 'step10'].slice(0, top.length));
    assert.equal(r.costUsd, 78);
  }
  assert.equal(Object.keys(data.total.byAgent).length, 12, 'the total has every agent');
  assert.equal(Object.keys(data.total.byStep).length, 12, 'the total has every step');
  assert.equal(data.total.costUsd, 30 * 78);
  assert.equal(data.total.byAgent.agent1.costUsd, 30);
});

test('run_analysis: a few small runs come back whole, without a note', async (t) => {
  const { ctx, service } = makeCtx(t);
  writeRun(service.workspace().runs, 'small-1', BASE, 2);
  const data = JSON.parse((await call(ctx, 'run_analysis', { runIds: ['small-1'] })).text);
  assert.equal(data.note, undefined);
  assert.deepEqual(Object.keys(data.runs[0].byAgent).sort(), ['agent1', 'agent2']);
});

// ---- compaction on the cache re-read per answer -----------------------------------------------------

function makeOracle(t, settings = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oracle-184r-o-'));
  const o = oracle.createOracle({
    dir: () => dir,
    tools: () => [],
    bridge: { start: async () => { throw new Error('not needed'); } },
    mcpCommand: () => { throw new Error('not needed'); },
    skillsDirs: () => [],
    resolveCommand: () => { throw new Error('not needed'); },
    refuseReal: () => { throw new Error('Simulation only: no real model in tests.'); },
    agent: () => ({ model: 'claude-opus-5-5', effort: 'high' }),
    settings: () => settings,
  });
  t.after(() => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));
  t.after(() => o.release && o.release());
  return { o, dir };
}

test('compaction: after an answer that re-read a lot of cache, the next question starts a new session and says why', async (t) => {
  const { o, dir } = makeOracle(t);
  // the state the previous answer left: a warm session whose last answer re-read 2M tokens of cache
  fs.writeFileSync(path.join(dir, 'state.json'), JSON.stringify({
    sessionId: 's-prev', model: 'claude-opus-5-5', contextTokens: 20000, cacheReadTokens: 2000000,
    compactNext: oracle.shouldCompact({ contextTokens: 20000, cacheReadTokens: 2000000 }, {}),
    lastTurnAt: new Date().toISOString(),
  }));
  await o.ask({ question: 'And the reviewer?', mock: true });
  const note = o.history().find((m) => m.kind === 'compaction');
  assert.ok(note, 'a compaction message is posted');
  assert.match(note.text, /re-read 2000000 tokens of cache/);
  assert.match(note.text, /handoff/);
});

test('compaction: the cache re-read threshold follows the compactAtCacheReadTokens setting', () => {
  const custom = { oracle: { compactAtTokens: 150000, compactAtCacheReadTokens: 500000 } };
  assert.equal(oracle.shouldCompact({ contextTokens: 10000, cacheReadTokens: 600000 }, custom), true);
  assert.equal(oracle.shouldCompact({ contextTokens: 10000, cacheReadTokens: 400000 }, custom), false);
  // the default (1M) does not compact at 600k; an invalid setting falls back to it
  assert.equal(oracle.shouldCompact({ contextTokens: 10000, cacheReadTokens: 600000 }, {}), false);
  assert.equal(oracle.shouldCompact({ contextTokens: 10000, cacheReadTokens: 600000 }, { oracle: { compactAtCacheReadTokens: -1 } }), false);
  assert.equal(oracle.shouldCompact({ contextTokens: 10000, cacheReadTokens: 1000000 }, {}), true);
});

// ---- platform read tools without a synced backlog ------------------------------------------------------

let emptyGitConfig = null;
const git = (cwd, args) => {
  if (!emptyGitConfig) {
    emptyGitConfig = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'oracle-184r-gitcfg-')), 'config');
    fs.writeFileSync(emptyGitConfig, '');
  }
  return execFileSync('git', ['-c', 'user.name=Test', '-c', 'user.email=t@e.st', '-c', 'init.defaultBranch=main', ...args], {
    cwd, encoding: 'utf8', env: { ...process.env, GIT_CONFIG_GLOBAL: emptyGitConfig, GIT_CONFIG_NOSYSTEM: '1' },
  });
};
function tmpRepo(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oracle-184r-repo-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));
  git(dir, ['init', '-q']);
  fs.writeFileSync(path.join(dir, 'README.md'), 'hello\n');
  git(dir, ['add', '.']);
  git(dir, ['commit', '-q', '-m', 'first commit']);
  return dir;
}
const recorder = () => {
  const calls = [];
  return { calls, execCli: async (cli, args) => { calls.push({ cli, args: [...args] }); return '[]'; } };
};

test('platform tools: without a synced backlog, the settings\' platform (GitLab) and the project\'s repo are used', async (t) => {
  const cli = recorder();
  const { ctx, api } = makeCtx(t, { execCli: cli.execCli });
  await api['settings:set']({ backlogPlatform: 'gitlab' });
  const project = await api['projects:create']({ name: 'Widgets', folder: tmpRepo(t), repo: 'https://gitlab.com/acme/widgets' });
  for (const [name, input] of [['issues_search', { projectId: project.id, query: 'login' }], ['issue_view', { projectId: project.id, number: 7 }], ['labels', { projectId: project.id }]]) {
    const out = await call(ctx, name, input);
    assert.equal(out.isError, false, `${name}: ${out.text}`);
  }
  assert.equal(cli.calls.length, 3);
  for (const c of cli.calls) {
    assert.equal(c.cli, 'glab');
    assert.ok(c.args.includes('acme/widgets'), c.args.join(' '));
  }
  assert.ok(cli.calls[1].args.includes('7'));
});

test('platform tools: without a synced backlog or a platform setting, GitHub is the default', async (t) => {
  const cli = recorder();
  const { ctx, api } = makeCtx(t, { execCli: cli.execCli });
  const project = await api['projects:create']({ name: 'Widgets', folder: tmpRepo(t), repo: 'https://github.com/acme/widgets' });
  const out = await call(ctx, 'labels', { projectId: project.id });
  assert.equal(out.isError, false, out.text);
  assert.equal(cli.calls[0].cli, 'gh');
  assert.ok(cli.calls[0].args.includes('acme/widgets'), cli.calls[0].args.join(' '));
});

test('platform tools: a project without a repository, or an unknown project, is an error and nothing is called', async (t) => {
  const cli = recorder();
  const { ctx, api } = makeCtx(t, { execCli: cli.execCli });
  const project = await api['projects:create']({ name: 'No remote', folder: tmpRepo(t) });
  const noRepo = await call(ctx, 'issues_search', { projectId: project.id, query: 'x' });
  assert.equal(noRepo.isError, true);
  assert.match(noRepo.text, /repository/i);
  const unknown = await call(ctx, 'labels', { projectId: 'no-such-project' });
  assert.equal(unknown.isError, true);
  assert.match(unknown.text, /Unknown project/);
  assert.equal(cli.calls.length, 0);
});

// ---- the benchmark questions (2026-10-01/02) as regression fixtures for the skill ---------------------

const BENCH = path.join(__dirname, 'fixtures', 'oracle-benchmark');

test('benchmark: the three owner questions of 2026-10-01/02 are kept as fixtures', () => {
  const files = fs.readdirSync(BENCH).filter((f) => f.endsWith('.json'));
  assert.equal(files.length, 3, files.join(', '));
  for (const f of files) {
    const b = JSON.parse(fs.readFileSync(path.join(BENCH, f), 'utf8'));
    assert.ok(b.question && b.outsideSession?.evidence?.length, `${f}: a question and the outside session's evidence`);
  }
});

test('benchmark: the Oracle\'s skill and tools still cover what each benchmark question needs', () => {
  const skill = fs.readFileSync(path.join(ROOT, 'skills', 'oracle', 'SKILL.md'), 'utf8');
  const names = oracleTools({}).map((x) => x.name);
  for (const f of fs.readdirSync(BENCH).filter((x) => x.endsWith('.json'))) {
    const b = JSON.parse(fs.readFileSync(path.join(BENCH, f), 'utf8'));
    for (const tool of b.tools) assert.ok(names.includes(tool), `${f}: the Oracle has the ${tool} tool`);
    for (const d of b.delegates) assert.ok(DELEGATES.includes(d), `${f}: the Oracle can delegate to ${d}`);
    for (const rule of b.skillRules) assert.match(skill, new RegExp(rule, 'i'), `${f}: the oracle skill states "${rule}"`);
  }
});
