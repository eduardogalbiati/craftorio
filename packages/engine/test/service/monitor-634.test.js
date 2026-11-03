// #634 (spec R12) Monitor: production errors become intents. The service channels the Errors screen
// uses. Acceptance tests, written before the code.
//
// Seams assumed (channels called as api['monitor:...'](args), awaited):
// - monitor:state { projectId } -> { groups: [{ fingerprint, title, status, message, where, count,
//   state: 'new'|'intent'|'fix-run', cardId?, runId? }], sources: [{ id, type, label, hasToken }],
//   automation: { diagnose, fix, dailyCap } } (default { diagnose: 'ask', fix: 'off', dailyCap: 5 }).
// - monitor:save-source { projectId, source: { type, ..., token? } } -> { ok, source }. The token goes to
//   the system keychain: its plaintext is in no file under the workspace, the user-data folder (the
//   host's userDataDir, a temp dir here) or the project folder, and monitor:state never returns it.
// - monitor:poll { projectId } -> { ok, groups }: polls every saved source now (a log-file source here,
//   a real temp JSON-lines file); events are deduplicated by id across polls.
// - monitor:diagnose { projectId, fingerprint } -> { ok, cardId }: an 'intent' card in the project's
//   Discovery Inbox (read back with domains/discovery/discovery.js readCard on the workspace's
//   discovery folder), its document naming the group, links.from.workflow 'monitor'. Once per group.
// - monitor:automation { projectId, diagnose, fix, dailyCap }: modes 'ask' | 'on' | 'off', cap >= 0.
//   diagnose 'on' diagnoses new groups at poll time, at most dailyCap a day.
// - monitor:propose-fix { projectId, fingerprint } -> { ok, runId }: starts the `fix` workflow (simulated
//   under MULTIAGENT_SIMULATION_ONLY); the run itself is pinned by test/slow/monitor-fix-gate-634.slow.test.js.
// No model is called (MULTIAGENT_SIMULATION_ONLY=1, set by makeService).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { makeService, gitRepo } = require('./helpers');

const discovery = () => require('../../domains/discovery/discovery');

const MSG = "TypeError: cannot read 'total' of undefined";
const checkout = (id) => JSON.stringify({ id, at: '2026-11-02T10:00:00Z', status: 500, method: 'POST', path: '/api/checkout', message: MSG, file: 'checkout.js', line: 412 });
const orders = (id) => JSON.stringify({ id, at: '2026-11-02T10:02:00Z', status: 500, method: 'GET', path: `/api/orders/${id.length}`, message: 'Order not found', file: 'orders.js', line: 88 });
const SIMULATED_500 = `${checkout('e1')}\n${checkout('e2')}\n{ this line is broken\n`;
const TOKEN = 'sntrys_monitor634_do_not_store_7f3a9c';

function tmpDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'monitor-634-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

// A service with a project (its folder a git repository) and a log file holding `log`.
async function setup(t, log = SIMULATED_500) {
  const userDataDir = tmpDir(t);
  const { service, api } = makeService(t, { userDataDir });
  const ws = service.workspace();
  const repo = gitRepo(t);
  const project = await api['projects:create']({ name: 'shop', folder: repo.dir });
  const logFile = path.join(tmpDir(t), 'api.log');
  fs.writeFileSync(logFile, log);
  return { service, api, ws, project, projectId: project.id, logFile, userDataDir, repo };
}

async function withLogSource(t, log) {
  const s = await setup(t, log);
  const saved = await s.api['monitor:save-source']({ projectId: s.projectId, source: { type: 'log-file', path: s.logFile, label: 'api logs' } });
  assert.equal(saved?.ok, true, `save-source: ${JSON.stringify(saved)}`);
  return s;
}

const stateOf = (s) => s.api['monitor:state']({ projectId: s.projectId });
const groupTitled = async (s, title) => (await stateOf(s)).groups.find((g) => g.title === title);
const intentsOf = (s) => {
  try { return discovery().listCards(s.ws.discovery, s.projectId, { column: 'inbox' }).filter((c) => c.type === 'intent'); } catch { return []; }
};

// every file under `dir` whose text holds `needle`
function filesHolding(dir, needle) {
  const found = [];
  const walk = (d) => {
    let entries = [];
    try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.isFile()) { try { if (fs.readFileSync(p).includes(needle)) found.push(p); } catch { /* unreadable */ } }
    }
  };
  walk(dir);
  return found;
}

// ---- state, sources, tokens ----------------------------------------------------------------------

test('#634 monitor:state of a project with nothing set up: no groups, no sources, automation Ask me / Off / 5', async (t) => {
  const s = await setup(t);
  const state = await stateOf(s);
  assert.deepEqual(state.groups, []);
  assert.deepEqual(state.sources, []);
  assert.deepEqual(state.automation, { diagnose: 'ask', fix: 'off', dailyCap: 5 });
});

test('#634 a Sentry source saved with a token: listed with hasToken, the token in no file of the workspace, user data or project, nor in monitor:state', async (t) => {
  const s = await setup(t);
  const saved = await s.api['monitor:save-source']({ projectId: s.projectId, source: { type: 'sentry', org: 'acme', project: 'shop', label: 'Sentry', token: TOKEN } });
  assert.equal(saved?.ok, true, `save-source: ${JSON.stringify(saved)}`);
  assert.equal(JSON.stringify(saved).includes(TOKEN), false, 'save-source returned the token');
  const state = await stateOf(s);
  assert.deepEqual(state.sources.map((x) => [x.type, x.label, x.hasToken]), [['sentry', 'Sentry', true]]);
  assert.equal(JSON.stringify(state).includes(TOKEN), false, 'monitor:state returned the token');
  const leaks = [s.ws.root, s.userDataDir, s.repo.dir].flatMap((d) => filesHolding(d, TOKEN));
  assert.deepEqual(leaks, []);
});

// ---- poll -------------------------------------------------------------------------------------------

test('#634 monitor:poll reads the log file: the simulated 500 is one group of 2, the malformed line skipped', async (t) => {
  const s = await withLogSource(t);
  const res = await s.api['monitor:poll']({ projectId: s.projectId });
  assert.equal(res?.ok, true, JSON.stringify(res));
  const g = await groupTitled(s, 'POST /api/checkout');
  assert.ok(g, `groups: ${JSON.stringify((await stateOf(s)).groups.map((x) => x.title))}`);
  assert.deepEqual([g.status, g.message, g.where, g.count, g.state], [500, MSG, 'checkout.js:412', 2, 'new']);
});

test('#634 polling the same file twice does not double the count', async (t) => {
  const s = await withLogSource(t);
  await s.api['monitor:poll']({ projectId: s.projectId });
  await s.api['monitor:poll']({ projectId: s.projectId });
  assert.equal((await groupTitled(s, 'POST /api/checkout'))?.count, 2);
});

// ---- diagnose ---------------------------------------------------------------------------------------

test('#634 monitor:diagnose files an intent card in the Inbox whose document is the diagnosis, from the monitor', async (t) => {
  const s = await withLogSource(t);
  await s.api['monitor:poll']({ projectId: s.projectId });
  const g = await groupTitled(s, 'POST /api/checkout');
  const res = await s.api['monitor:diagnose']({ projectId: s.projectId, fingerprint: g.fingerprint });
  assert.equal(res?.ok, true, JSON.stringify(res));
  const card = discovery().readCard(s.ws.discovery, s.projectId, res.cardId);
  assert.equal(card.type, 'intent');
  assert.equal(card.column, 'inbox');
  assert.equal(card.links?.from?.workflow, 'monitor');
  assert.ok(card.document.includes('POST /api/checkout'), card.document);
  assert.ok(card.document.includes(MSG), card.document);
  assert.ok(card.document.includes('checkout.js:412'), card.document);
});

test('#634 after diagnose the group shows state intent with its card', async (t) => {
  const s = await withLogSource(t);
  await s.api['monitor:poll']({ projectId: s.projectId });
  const g = await groupTitled(s, 'POST /api/checkout');
  const { cardId } = await s.api['monitor:diagnose']({ projectId: s.projectId, fingerprint: g.fingerprint });
  const after = await groupTitled(s, 'POST /api/checkout');
  assert.deepEqual([after.state, after.cardId], ['intent', cardId]);
});

test('#634 diagnosing the same group twice files no second card', async (t) => {
  const s = await withLogSource(t);
  await s.api['monitor:poll']({ projectId: s.projectId });
  const g = await groupTitled(s, 'POST /api/checkout');
  await s.api['monitor:diagnose']({ projectId: s.projectId, fingerprint: g.fingerprint });
  await s.api['monitor:diagnose']({ projectId: s.projectId, fingerprint: g.fingerprint });
  assert.equal(intentsOf(s).length, 1);
});

// ---- automation ------------------------------------------------------------------------------------

test('#634 monitor:automation refuses an unknown mode and a negative cap, saving nothing', async (t) => {
  const s = await setup(t);
  for (const bad of [{ diagnose: 'sometimes', fix: 'off', dailyCap: 5 }, { diagnose: 'on', fix: 'off', dailyCap: -1 }]) {
    let res;
    try { res = await s.api['monitor:automation']({ projectId: s.projectId, ...bad }); } catch { res = { ok: false }; }
    assert.equal(res?.ok, false, `accepted ${JSON.stringify(bad)}`);
  }
  assert.deepEqual((await stateOf(s)).automation, { diagnose: 'ask', fix: 'off', dailyCap: 5 });
});

test('#634 monitor:automation saves the modes and the cap', async (t) => {
  const s = await setup(t);
  await s.api['monitor:automation']({ projectId: s.projectId, diagnose: 'on', fix: 'ask', dailyCap: 3 });
  assert.deepEqual((await stateOf(s)).automation, { diagnose: 'on', fix: 'ask', dailyCap: 3 });
});

const TWO_GROUPS = `${checkout('e1')}\n${orders('o1')}\n`;

test('#634 diagnose On with a daily cap of 1: a poll bringing two new groups files exactly one intent card', async (t) => {
  const s = await withLogSource(t, TWO_GROUPS);
  await s.api['monitor:automation']({ projectId: s.projectId, diagnose: 'on', fix: 'off', dailyCap: 1 });
  await s.api['monitor:poll']({ projectId: s.projectId });
  assert.equal(intentsOf(s).length, 1);
  assert.deepEqual((await stateOf(s)).groups.map((g) => g.state).sort(), ['intent', 'new']);
});

test('#634 diagnose Ask me (the default): a poll files no card and the groups stay new', async (t) => {
  const s = await withLogSource(t, TWO_GROUPS);
  await s.api['monitor:poll']({ projectId: s.projectId });
  assert.equal(intentsOf(s).length, 0);
  assert.deepEqual((await stateOf(s)).groups.map((g) => g.state), ['new', 'new']);
});

test('#634 diagnose Off: a poll files no card', async (t) => {
  const s = await withLogSource(t, TWO_GROUPS);
  await s.api['monitor:automation']({ projectId: s.projectId, diagnose: 'off', fix: 'off', dailyCap: 5 });
  await s.api['monitor:poll']({ projectId: s.projectId });
  assert.equal(intentsOf(s).length, 0);
});

// ---- propose fix -------------------------------------------------------------------------------------

test('#634 monitor:propose-fix starts a run and the group shows state fix-run with it', async (t) => {
  const s = await withLogSource(t);
  await s.api['monitor:poll']({ projectId: s.projectId });
  const g = await groupTitled(s, 'POST /api/checkout');
  await s.api['monitor:diagnose']({ projectId: s.projectId, fingerprint: g.fingerprint });
  const res = await s.api['monitor:propose-fix']({ projectId: s.projectId, fingerprint: g.fingerprint });
  assert.equal(res?.ok, true, JSON.stringify(res));
  assert.equal(typeof res.runId, 'string');
  const after = await groupTitled(s, 'POST /api/checkout');
  assert.deepEqual([after.state, after.runId], ['fix-run', res.runId]);
});
