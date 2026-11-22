// The Product Owner's refactor ranking on a REAL turn (#728): rankProject with `mock: false` runs one
// Claude Code turn (packages/engine/domains/refactor/refactor-priority.js runPriorityTurn → providers.runTurn).
// It crashed on every real turn with "onItem is not a function" because no `onItem` reached runTurn.
// The CLI is stubbed: PROVIDERS.claude (the provider the ranking uses) gets the absolute path of this
// node and test/fixtures/fake-claude-ranking.js as its command for the test, restored after; never a
// `claude` found on PATH (that would be the owner's real, paid CLI). CRAFTORIO_SIMULATION_ONLY is
// lifted for the test (providers.runTurn refuses a real provider under it) and restored after.
// Covers the three callers: the onboarding's analysis and the Refactor tab's Prioritize both call
// rankProject with the service's real options; the refactor-proposals workflow's prioritize step
// calls rankProposals (refactor-proposals-run.js), which ranks through rankProject.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { layout } = require('../../domains/workspace/workspace');

const PROJECT = 'proj-728';
const STUB = path.join(__dirname, '..', 'fixtures', 'fake-claude-ranking.js');
const loadPriority = () => require('../../domains/refactor/refactor-priority');
const loadProposals = () => require('../../domains/refactor/refactor-proposals');
const loadRun = () => require('../../domains/refactor/refactor-proposals-run');
const loadProviders = () => require('../../engine/providers');

// a temp workspace (refactor, architecture, backlog stores), a project folder and a skills folder
// holding the Product Owner's skill; the claude provider pointed at the stub; simulation lifted
function setup(t) {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'refactor-real-728-'));
  const stores = layout(ws);
  for (const dir of [stores.refactor, stores.architecture, stores.backlog]) fs.mkdirSync(dir, { recursive: true });
  const folder = path.join(ws, 'project');
  fs.mkdirSync(path.join(folder, 'src'), { recursive: true });
  const skillsDir = path.join(ws, 'skills');
  fs.mkdirSync(path.join(skillsDir, 'backlog-product-owner'), { recursive: true });
  fs.writeFileSync(path.join(skillsDir, 'backlog-product-owner', 'SKILL.md'), '---\nname: backlog-product-owner\ndescription: test skill\n---\n# Product Owner (test)\n');
  const marker = path.join(ws, 'stub.ran');

  const { PROVIDERS } = require('../../domains/workflow/workflow-builder');
  const claude = PROVIDERS.claude;
  const saved = { command: claude.command, args: claude.args };
  claude.command = process.execPath;
  claude.args = [STUB, marker];
  const sim = process.env.CRAFTORIO_SIMULATION_ONLY;
  delete process.env.CRAFTORIO_SIMULATION_ONLY;
  t.after(() => {
    claude.command = saved.command;
    claude.args = saved.args;
    if (sim === undefined) delete process.env.CRAFTORIO_SIMULATION_ONLY; else process.env.CRAFTORIO_SIMULATION_ONLY = sim;
    fs.rmSync(ws, { recursive: true, force: true, maxRetries: 5 });
  });

  const proposals = loadProposals();
  const add = (title, file) => proposals.addProposal(stores.refactor, PROJECT, { source: 'architecture', key: `k:${file}`, title, files: [{ path: file }], severity: 'high' });
  // the service's real options (packages/engine/fronts/analyser/channels/refactor.js realOptions), plus `extra`
  const realOptions = (extra = {}) => ({
    mock: false, backlogDir: stores.backlog, projectId: PROJECT, folder, agent: { model: 'sonnet', effort: 'default' },
    skillsDirs: [skillsDir], resolveCommand: () => true, budget: null, language: null, ...extra,
  });
  return { ws, stores, folder, marker, add, realOptions };
}

test('#728 rankProject (mock: false): a real turn without an onItem from the caller ends with the Product Owner\'s ranking saved, not "onItem is not a function"', async (t) => {
  const priority = loadPriority();
  const { stores, marker, add, realOptions } = setup(t);
  const a = add('Split engine', 'src/a.js');
  const b = add('Untangle service', 'src/b.js');

  const out = await priority.rankProject({ refactorRoot: stores.refactor, backlogDir: stores.backlog, projectId: PROJECT, model: null, mock: false, options: () => realOptions() });

  assert.equal(fs.existsSync(marker), true, 'the stub CLI ran');
  assert.deepEqual(out.ranking.map((r) => r.rank).sort((x, y) => x - y), [1, 2]);
  assert.deepEqual(out.ranking.map((r) => r.id).sort(), [a.id, b.id].sort());
  for (const r of out.ranking) assert.match(r.reason, /Fake Product Owner reason/, 'the turn\'s answer, not the simulated one');
  assert.equal(out.costUsd, 0.0123);
  const saved = JSON.stringify(loadProposals().readRanking(stores.refactor, PROJECT));
  assert.equal(saved.includes(a.id) && saved.includes(b.id), true, 'the ranking is saved as the Refactor tab reads it');
  assert.equal(saved.includes('Fake Product Owner reason'), true);
});

test('#728 rankProject (mock: false): the caller\'s onItem receives the turn\'s items (the CLI started)', async (t) => {
  const priority = loadPriority();
  const { stores, add, realOptions } = setup(t);
  add('Split engine', 'src/a.js');
  const items = [];
  await priority.rankProject({ refactorRoot: stores.refactor, backlogDir: stores.backlog, projectId: PROJECT, model: null, mock: false, options: () => realOptions({ onItem: (it) => items.push(it?.kind) }) });
  assert.equal(items.length > 0, true, 'the caller\'s onItem was given to the turn');
  assert.equal(items.includes('spawn'), true, 'the turn reported the CLI it started');
});

test('#728 rankProject (mock: false): the caller\'s signal reaches the turn: an aborted signal cancels it before the CLI starts, nothing saved', async (t) => {
  const priority = loadPriority();
  const { stores, marker, add, realOptions } = setup(t);
  add('Split engine', 'src/a.js');
  const ctl = new AbortController();
  ctl.abort();
  await assert.rejects(
    priority.rankProject({ refactorRoot: stores.refactor, backlogDir: stores.backlog, projectId: PROJECT, model: null, mock: false, options: () => realOptions({ signal: ctl.signal }) }),
    (e) => { assert.match(String(e?.message), /Cancel/i); assert.doesNotMatch(String(e?.message), /onItem/); return true; },
  );
  assert.equal(fs.existsSync(marker), false, 'the CLI never started');
});

test('#728 refactor-proposals prioritize step (rankProposals, mock: false): a real turn ranks the run\'s proposals and keeps the first `limit`', async (t) => {
  const { rankProposals } = loadRun();
  const { ws, folder, marker, add, realOptions } = setup(t);
  const ids = [add('One', 'src/one.js'), add('Two', 'src/two.js'), add('Three', 'src/three.js')].map((p) => p.id);

  const r = await rankProposals({ folder, wsRoot: ws, projectId: PROJECT, ids, limit: 2, mock: false, options: realOptions() });

  assert.equal(fs.existsSync(marker), true, 'the stub CLI ran');
  assert.equal(r.simulated, false);
  assert.deepEqual(r.ranked.map((x) => x.rank), [1, 2, 3]);
  assert.deepEqual(r.ranked.map((x) => x.id).sort(), ids.slice().sort());
  for (const x of r.ranked) assert.match(x.reason, /Fake Product Owner reason/);
  assert.deepEqual(r.kept, r.ranked.slice(0, 2).map((x) => x.id));
  assert.equal(r.cost_usd, 0.0123);
});

test('#728 providers.runTurn: a CLI turn without onItem runs to its answer (a missing callback is a no-op)', async (t) => {
  const { runTurn } = loadProviders();
  const { render } = require('../../engine/run/templates');
  const { folder, marker } = setup(t);
  const provider = { type: 'claude-code', command: process.execPath, args: [STUB, marker] };
  const res = await runTurn({ provider, model: 'sonnet', prompt: 'Rank these:\n- id p-1: one\n- id p-2: two\n', cwd: folder, extraArgs: [], timeoutMs: 60e3, render, hint: { stepId: 'test-728', visit: 1, agent: 'product-owner' } });
  assert.equal(fs.existsSync(marker), true, 'the stub CLI ran');
  assert.match(String(res.text), /"id":"p-2","rank":1/);
  assert.equal(res.costUsd, 0.0123);
});

test('#728 providers.runTurn: a mock turn without onItem runs to its answer too', async (t) => {
  const { runTurn } = loadProviders();
  const scale = process.env.CRAFTORIO_MOCK_DELAY_SCALE;
  process.env.CRAFTORIO_MOCK_DELAY_SCALE = '0';
  t.after(() => { if (scale === undefined) delete process.env.CRAFTORIO_MOCK_DELAY_SCALE; else process.env.CRAFTORIO_MOCK_DELAY_SCALE = scale; });
  const res = await runTurn({ provider: { type: 'mock' }, model: 'simulated', prompt: 'hi', hint: {} });
  assert.equal(typeof res.text, 'string');
  assert.equal(res.text.length > 0, true);
});

test('#728 providers.runTurn: two fresh turns in a row whose CLI reports the same session id each cost their own total', async (t) => {
  const { runTurn } = loadProviders();
  const { render } = require('../../engine/run/templates');
  const { folder } = setup(t);
  // the stub repeats one session id and reports total_cost_usd 0.0123 each time; no session is resumed
  const provider = { type: 'claude-code', command: process.execPath, args: [STUB] };
  const turn = () => runTurn({ provider, model: 'sonnet', prompt: '- id p-1: one\n', cwd: folder, extraArgs: [], timeoutMs: 60e3, render, hint: { stepId: 'test-728', visit: 1 } });
  const first = await turn();
  const second = await turn();
  assert.equal(first.costUsd, 0.0123);
  assert.equal(second.costUsd, 0.0123, 'the second fresh turn is not charged as a delta of the first');
});
