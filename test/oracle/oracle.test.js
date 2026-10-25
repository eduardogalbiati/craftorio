// The Oracle (#122, src/domains/oracle/oracle.js): one persistent conversation per workspace, reached through the
// oracle:* channels (src/service/channels/oracle.js), the way the Dashboard drawer and every screen
// (#171) call it. Service-level tests drive it through a real service on a scratch workspace, the
// way test/supervisor-chat.test.js does for the app-wide Supervisor chat; a couple of unit-level
// tests call createOracle directly for what the channel's own simulation guard would hide
// (refuseReal outside MULTIAGENT_SIMULATION_ONLY).
// Live progress (#180): oracle:ask's turn is pushed on chat:progress and chat:cancel stops it;
// mockSteps' delays are scaled down (like the mock provider) so these tests stay fast.
process.env.MULTIAGENT_MOCK_DELAY_SCALE ??= '0.05';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createService } = require('../../src/service');
const { setupWorkspace } = require('../../src/domains/workspace/workspace');
const oracle = require('../../src/domains/oracle/oracle');

function makeService(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oracle-ws-'));
  process.env.MULTIAGENT_SIMULATION_ONLY = '1'; // tests never call real models
  const service = createService({ host: { trashItem: async () => {}, appVersion: '9.9.9', isPackaged: false } });
  t.after(() => service.shutdown());
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  service.setWorkspace(setupWorkspace(dir, { persist: false }));
  return { service, api: service.api, dir };
}

const oracleDir = (service) => service.workspace().oracle;
const usageFile = (service) => path.join(oracleDir(service), 'usage.jsonl');
const writeUsage = (service, lines) => {
  fs.mkdirSync(oracleDir(service), { recursive: true });
  fs.writeFileSync(usageFile(service), `${lines.map((l) => JSON.stringify(l)).join('\n')}\n`);
};

// ---- pure helpers -----------------------------------------------------------------------------

test('oracleSettings: fills in the defaults; an invalid or missing value falls back', () => {
  assert.deepEqual(oracle.oracleSettings({}), oracle.DEFAULTS);
  assert.deepEqual(oracle.oracleSettings({ oracle: { dailyBudgetUsd: 5 } }), { dailyBudgetUsd: 5, compactAtTokens: 150000 });
  assert.deepEqual(oracle.oracleSettings({ oracle: { dailyBudgetUsd: -1, compactAtTokens: 'nope' } }), oracle.DEFAULTS);
  assert.deepEqual(oracle.oracleSettings({ oracle: { dailyBudgetUsd: 0 } }), { dailyBudgetUsd: 0, compactAtTokens: 150000 }); // 0 = no cap, kept as 0
});

test('questionText: prefixes "[Screen] ..." only when the screen is non-empty', () => {
  assert.equal(oracle.questionText('Hello', 'Dashboard'), '[Screen] Dashboard\n\nHello');
  assert.equal(oracle.questionText('Hello', ''), 'Hello');
  assert.equal(oracle.questionText('Hello', '   '), 'Hello');
  assert.equal(oracle.questionText('Hello', null), 'Hello');
});

test('monthlyBlock: refuses only a blocking budget already at or past its USD or token limit', () => {
  assert.equal(oracle.monthlyBlock({ claude: { blockOnLimit: true, limitUsd: 10, usedUsd: 5 } }), '');
  assert.match(oracle.monthlyBlock({ claude: { name: 'Claude Code', blockOnLimit: true, limitUsd: 10, usedUsd: 10 } }), /Claude Code already reached its monthly budget/);
  assert.match(oracle.monthlyBlock({ claude: { blockOnLimit: true, limitTokens: 1000, usedTokens: 1000 } }), /already reached its monthly budget/);
  assert.equal(oracle.monthlyBlock({ claude: { blockOnLimit: false, limitUsd: 10, usedUsd: 50 } }), ''); // not blocking
  assert.equal(oracle.monthlyBlock(undefined), '');
});

test('spentOn: sums only today\'s (UTC) lines; malformed or other-day lines are ignored', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oracle-spent-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const now = new Date('2026-09-30T12:00:00Z');
  fs.writeFileSync(path.join(dir, 'usage.jsonl'), [
    JSON.stringify({ ts: '2026-09-30T01:00:00Z', costUsd: 2 }),
    JSON.stringify({ ts: '2026-09-30T23:00:00Z', costUsd: 3 }),
    JSON.stringify({ ts: '2026-09-29T23:00:00Z', costUsd: 100 }), // yesterday
    '{ not json',
  ].join('\n'));
  assert.equal(oracle.spentOn(dir, now), 5);
});

test('usageRuns: one entry per day, each day\'s lines as sessions', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oracle-usageruns-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(dir, 'usage.jsonl'), [
    JSON.stringify({ ts: '2026-09-30T01:00:00Z', model: 'claude-opus-5-5', costUsd: 2 }),
    JSON.stringify({ ts: '2026-09-30T02:00:00Z', model: 'claude-opus-5-5', costUsd: 3 }),
    JSON.stringify({ ts: '2026-09-29T01:00:00Z', model: 'claude-opus-5-5', costUsd: 1 }),
  ].join('\n'));
  const runs = oracle.usageRuns(dir);
  assert.equal(runs.length, 2);
  const day30 = runs.find((r) => r.run_id === 'oracle-2026-09-30');
  assert.equal(day30.sessions.length, 2);
  assert.equal(day30.workflow, 'Oracle');
});

// ---- the built-in agent and its skill (task 1) -------------------------------------------------

test('oracle:ask with mock answers from the simulated Oracle through the real read-only tools, costing 0', async (t) => {
  const { api } = makeService(t);
  const out = await api['oracle:ask']({ question: 'What is going on?', screen: 'Dashboard', mock: true });
  assert.equal(out.message.role, 'oracle');
  assert.equal(out.message.simulated, true);
  assert.equal(out.message.costUsd, 0);
  assert.match(out.message.text, /Simulated Oracle: no model was called/);
  assert.match(out.message.text, /Dashboard/);
});

test('oracle:ask without mock, under MULTIAGENT_SIMULATION_ONLY (set in the test env): answers from the mock too', async (t) => {
  const { api } = makeService(t);
  const out = await api['oracle:ask']({ question: 'How much did I spend?' });
  assert.equal(out.message.role, 'oracle');
  assert.equal(out.message.simulated, true);
});

test('oracle:ask throws on an empty question', async (t) => {
  const { api } = makeService(t);
  await assert.rejects(() => api['oracle:ask']({ question: '   ', mock: true }), /Type a message/);
});

test('oracle:ask: a second message sent before the first answers throws "still answering"', async (t) => {
  const { api } = makeService(t);
  const first = api['oracle:ask']({ question: 'first', mock: true });
  await assert.rejects(() => api['oracle:ask']({ question: 'second', mock: true }), /still answering/);
  await first;
});

// ---- #180: live progress (chat:progress, chat:cancel) -------------------------------------------

test('oracle:ask (mock): the turn streams chat:progress start/items/end for chat "oracle"', async (t) => {
  const { service, api } = makeService(t);
  const events = [];
  service.events.on('chat:progress', (ev) => events.push(ev));

  await api['oracle:ask']({ question: 'What is going on?', mock: true });

  assert.equal(events[0].phase, 'start');
  assert.equal(events[0].chat, 'oracle');
  assert.equal(events.at(-1).phase, 'end');
  assert.equal(events.at(-1).status, 'done');
  assert.ok(events.some((e) => e.phase === 'items' && e.items.some((it) => it.kind === 'tool_call')));
});

test('chat:cancel(\'oracle\') stops an oracle:ask turn in flight: the answer is kept, marked stopped, and chat:progress ends "stopped"', async (t) => {
  const { service, api } = makeService(t);
  const events = [];
  service.events.on('chat:progress', (ev) => events.push(ev));

  // the turn's AbortController is wired synchronously, before the mock turn's first real wait
  // (src/domains/chat/chat-progress.js's mockSteps): cancelling right after the call races it early, not at the end
  const asking = api['oracle:ask']({ question: 'What is going on?', mock: true });
  assert.equal(await api['chat:cancel']({ chat: 'oracle', key: '' }), true);

  const out = await asking;
  assert.equal(out.message.role, 'oracle');
  assert.equal(out.message.stopped, true);
  assert.equal(events.at(-1).phase, 'end');
  assert.equal(events.at(-1).status, 'stopped');
});

// ---- persistence across restarts (task 2) -------------------------------------------------------

test('the conversation persists across a restart: the history and the provider session are kept', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oracle-restart-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  process.env.MULTIAGENT_SIMULATION_ONLY = '1';

  const service1 = createService({ host: { trashItem: async () => {}, appVersion: '9.9.9', isPackaged: false } });
  service1.setWorkspace(setupWorkspace(dir, { persist: false }));
  await service1.api['oracle:ask']({ question: 'Remember this', mock: true });
  const state1 = await service1.api['oracle:state']();
  assert.ok(state1.sessionId);
  service1.shutdown();

  const service2 = createService({ host: { trashItem: async () => {}, appVersion: '9.9.9', isPackaged: false } });
  service2.setWorkspace(setupWorkspace(dir, { persist: false }));
  const history = await service2.api['oracle:history']();
  assert.equal(history.length, 2);
  assert.equal(history[0].text, 'Remember this');

  await service2.api['oracle:ask']({ question: 'Still there?', mock: true });
  const state2 = await service2.api['oracle:state']();
  assert.equal(state2.sessionId, state1.sessionId); // the same provider session, resumed
  assert.equal((await service2.api['oracle:history']()).length, 4);
  service2.shutdown(); // both services are shut down before the t.after cleans up the directory
});

// ---- compaction (task 2) -------------------------------------------------------------------------

test('compaction: a turn past the threshold writes a handoff note on the next question, keeps the memory, and starts a new session carrying it', async (t) => {
  const { service, api } = makeService(t);
  await api['settings:set']({ oracle: { dailyBudgetUsd: 20, compactAtTokens: 100 } });
  await api['oracle:saveMemory']('The owner always wants UI changes validated.');

  const first = await api['oracle:ask']({ question: 'first question', mock: true, mockContextTokens: 150 });
  assert.equal(first.state.compactNext, true);
  assert.equal(first.state.contextTokens, 150);
  const sessionBefore = first.state.sessionId;

  const second = await api['oracle:ask']({ question: 'second question', mock: true });
  // a system message about the compaction was recorded; a turn is never cut (the question still answers)
  const history = await api['oracle:history']();
  const compactionNotice = history.find((m) => m.kind === 'compaction');
  assert.ok(compactionNotice, 'a system message records the compaction');
  assert.match(compactionNotice.text, /new session starts/);
  assert.equal(second.message.role, 'oracle');

  const handoffDir = path.join(oracleDir(service), 'handoffs');
  const handoffFiles = fs.readdirSync(handoffDir).filter((f) => f.endsWith('-compaction.md'));
  assert.equal(handoffFiles.length, 1);
  const handoffText = fs.readFileSync(path.join(handoffDir, handoffFiles[0]), 'utf8');
  assert.match(handoffText, /## Runs being watched/);

  // the new session is a different provider session, and its opening prompt (session.md) carries
  // the memory and the handoff note
  assert.notEqual(second.state.sessionId, sessionBefore);
  const sessionPrompt = fs.readFileSync(path.join(oracleDir(service), 'session.md'), 'utf8');
  assert.match(sessionPrompt, /The owner always wants UI changes validated\./);
  assert.match(sessionPrompt, /## Runs being watched/);
  assert.match(sessionPrompt, /second question/);
});

// ---- memory and reset (task 2) -------------------------------------------------------------------

test('oracle:saveMemory then oracle:memory round-trips the text; too long is refused', async (t) => {
  const { api } = makeService(t);
  const saved = await api['oracle:saveMemory']('Reply in Portuguese.');
  assert.equal(saved.text, 'Reply in Portuguese.');
  assert.equal((await api['oracle:memory']()).text, 'Reply in Portuguese.');
  // saveMemory throws synchronously (not an async function): wrap it so assert.rejects sees a rejection
  await assert.rejects(async () => api['oracle:saveMemory']('x'.repeat(20001)), /too long/);
});

test('oracle:reset writes a handoff note, keeps the memory, and the next question starts a fresh session', async (t) => {
  const { service, api } = makeService(t);
  await api['oracle:saveMemory']('Keep this across resets.');
  await api['oracle:ask']({ question: 'before reset', mock: true });
  const before = await api['oracle:state']();

  const { handoff } = await api['oracle:reset']({ mock: true });
  assert.ok(fs.existsSync(path.join(oracleDir(service), 'handoffs', handoff)));
  assert.equal((await api['oracle:memory']()).text, 'Keep this across resets.');

  const after = await api['oracle:state']();
  assert.equal(after.sessionId, null);
  assert.notEqual(after.sessionId, before.sessionId);

  await api['oracle:ask']({ question: 'after reset', mock: true });
  const sessionPrompt = fs.readFileSync(path.join(oracleDir(service), 'session.md'), 'utf8');
  assert.match(sessionPrompt, /Keep this across resets\./);
});

test('oracle:reset while a question is answering throws', async (t) => {
  const { api } = makeService(t);
  const asking = api['oracle:ask']({ question: 'first', mock: true });
  await assert.rejects(() => api['oracle:reset']({ mock: true }), /answering/);
  await asking;
});

// ---- budgets (task 4) -------------------------------------------------------------------------

test('a daily budget already reached refuses the question, naming the spend, the limit and when it resumes', async (t) => {
  const { service, api } = makeService(t);
  await api['settings:set']({ oracle: { dailyBudgetUsd: 1, compactAtTokens: 150000 } });
  writeUsage(service, [{ ts: new Date().toISOString(), costUsd: 1 }]);

  const out = await api['oracle:ask']({ question: 'Hi', mock: true });
  assert.equal(out.message, null);
  assert.equal(out.refused.reason, 'daily-budget');
  assert.equal(out.refused.spentUsd, 1);
  assert.equal(out.refused.limitUsd, 1);
  assert.match(out.refused.text, /Paused by budget/);
  // #244: a refused question is logged; no answer is posted for it
  const history = await api['oracle:history']();
  assert.ok(history.some((m) => m.text === 'Hi'));
  assert.ok(!history.some((m) => m.role === 'oracle'));
});

test('dailyBudgetUsd: 0 means no cap: the Oracle never pauses, whatever it already spent today', async (t) => {
  const { service, api } = makeService(t);
  await api['settings:set']({ oracle: { dailyBudgetUsd: 0, compactAtTokens: 150000 } });
  writeUsage(service, [{ ts: new Date().toISOString(), costUsd: 1000 }]);

  const state = await api['oracle:state']();
  assert.equal(state.paused, false);
  assert.equal(state.today.limitUsd, 0);
  const out = await api['oracle:ask']({ question: 'Hi', mock: true });
  assert.equal(out.message.role, 'oracle');
});

test('a blocking monthly Claude Code budget refuses the question, even with the daily budget untouched', async (t) => {
  const { service, api } = makeService(t);
  await api['settings:set']({ budgets: { claude: { monthlyUsd: 5, blockOnLimit: true } } });
  // the Oracle's own past spend this month counts toward the monthly budget (usage.withPeerUsage)
  writeUsage(service, [{ ts: new Date().toISOString(), costUsd: 6 }]);

  const out = await api['oracle:ask']({ question: 'Hi', mock: true });
  assert.equal(out.message, null);
  assert.equal(out.refused.reason, 'monthly-budget');
  assert.match(out.refused.text, /already reached its monthly budget/);
});

// ---- pasted screenshots (#171, task 4) -----------------------------------------------------------

const PNG_DATA_URL = 'data:image/png;base64,iVBORw0KGgo=';

test('oracle:ask with a pasted image: saved under <workspace>/oracle/attachments/, and oracle:attachment reads it back', async (t) => {
  const { service, api } = makeService(t);
  const out = await api['oracle:ask']({ question: 'What is this?', images: [{ dataUrl: PNG_DATA_URL }], mock: true });
  assert.match(out.message.text, /You pasted 1 image\(s\)/);

  const [userMsg] = await api['oracle:history']();
  assert.equal(userMsg.attachments.length, 1);
  const file = userMsg.attachments[0];
  assert.match(file, /\.png$/);
  assert.ok(fs.existsSync(path.join(oracleDir(service), 'attachments', file)));

  assert.equal(await api['oracle:attachment'](file), PNG_DATA_URL);
});

test('oracle:ask: an unknown attachment name (removed, or never sent) gives null, not an error', async (t) => {
  const { api } = makeService(t);
  assert.equal(await api['oracle:attachment']('does-not-exist.png'), null);
});

test('oracle:ask: more than 4 pasted images is refused, and nothing is saved', async (t) => {
  const { service, api } = makeService(t);
  const images = Array.from({ length: 5 }, () => ({ dataUrl: PNG_DATA_URL }));
  await assert.rejects(() => api['oracle:ask']({ question: 'many', images, mock: true }), /At most 4 images/);
  assert.equal((await api['oracle:history']()).length, 0); // refused before anything is posted
  assert.equal(fs.existsSync(path.join(oracleDir(service), 'attachments')), false);
});

test('oracle:ask: a pasted image over the 5 MB cap is refused, naming the cap', async (t) => {
  const { api } = makeService(t);
  const big = Buffer.from('A'.repeat(oracle.ATTACHMENT_LIMITS.maxBytes + 100)).toString('base64');
  await assert.rejects(() => api['oracle:ask']({ question: 'big', images: [{ dataUrl: `data:image/png;base64,${big}` }], mock: true }), /over 5 MB/);
});

test('oracle:ask: a pasted file of a type the model cannot read is refused, naming the allowed types', async (t) => {
  const { api } = makeService(t);
  await assert.rejects(() => api['oracle:ask']({ question: 'x', images: [{ dataUrl: 'data:application/pdf;base64,Zg==' }], mock: true }), /Only PNG, JPEG, GIF or WebP/);
});

// ---- the unread badge survives a reload (#171, task 2) --------------------------------------------

test('oracle:markRead: readAt persists across a restart', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oracle-read-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  process.env.MULTIAGENT_SIMULATION_ONLY = '1';

  const service1 = createService({ host: { trashItem: async () => {}, appVersion: '9.9.9', isPackaged: false } });
  service1.setWorkspace(setupWorkspace(dir, { persist: false }));
  await service1.api['oracle:ask']({ question: 'Hi', mock: true });
  const { ts } = (await service1.api['oracle:history']()).at(-1);
  const { readAt } = await service1.api['oracle:markRead']({ at: ts });
  assert.equal(readAt, ts);
  service1.shutdown();

  const service2 = createService({ host: { trashItem: async () => {}, appVersion: '9.9.9', isPackaged: false } });
  service2.setWorkspace(setupWorkspace(dir, { persist: false }));
  const state = await service2.api['oracle:state']();
  assert.equal(state.readAt, readAt);
  service2.shutdown();
});

test('oracle:markRead: an earlier "at" than what is already recorded is ignored (the badge never un-clears)', async (t) => {
  const { api } = makeService(t);
  const later = new Date().toISOString();
  await api['oracle:markRead']({ at: later });
  const earlier = new Date(Date.now() - 60000).toISOString();
  assert.equal((await api['oracle:markRead']({ at: earlier })).readAt, later);
});

// ---- simulation (task 5) -----------------------------------------------------------------------

test('createOracle: without mock, outside a mocked run, refuseReal is consulted before any CLI, bridge or MCP setup', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oracle-unit-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const o = oracle.createOracle({
    dir: () => dir,
    tools: () => { throw new Error('tools() should not be read'); },
    bridge: { start: async () => { throw new Error('bridge.start() should not be called'); } },
    mcpCommand: () => { throw new Error('mcpCommand() should not be called'); },
    skillsDirs: () => [],
    resolveCommand: () => { throw new Error('resolveCommand() should not be called'); },
    refuseReal: () => { throw new Error('Simulation only (MULTIAGENT_SIMULATION_ONLY=1): refusing to start the Oracle\'s CLI (claude).'); },
    agent: () => ({ model: 'claude-opus-5-5', effort: 'high' }),
    settings: () => ({}),
  });
  const { message } = await o.ask({ question: 'Start a real run', mock: false });
  assert.equal(message.role, 'system');
  assert.equal(message.error, true);
  assert.match(message.text, /Simulation only/);
});

// ---- actions and the Night watch: one run each, never twice (#123) ------------------------------

function makeActingOracle(t, { perform, restore } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oracle-act-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return oracle.createOracle({
    dir: () => dir,
    tools: () => [],
    bridge: { start: async () => { throw new Error('not needed'); } },
    mcpCommand: () => { throw new Error('not needed'); },
    skillsDirs: () => [],
    resolveCommand: () => { throw new Error('not needed'); },
    refuseReal: () => { throw new Error('not needed'); },
    agent: () => ({ model: 'claude-opus-5-5', effort: 'high' }),
    settings: () => ({}),
    perform,
    restore,
  });
}

// a controllable `perform`: resolves only when the test calls `resolve`, and counts its calls
function deferredPerform() {
  let resolve;
  const calls = [];
  const fn = async (a, opts) => {
    calls.push({ a, opts });
    return new Promise((r) => { resolve = r; });
  };
  return { fn, calls, resolve: (out) => resolve(out) };
}

test('act: two clicks on the same card at once run it exactly once; the second rejects, and a third after it is done rejects too', async (t) => {
  const perform = deferredPerform();
  const o = makeActingOracle(t, { perform: perform.fn });
  const { id } = await o.propose({ kind: 'dispatch.restart', params: {}, requestedBy: 'owner' });

  const first = o.act(id);
  const second = o.act(id);
  await assert.rejects(second, /already running/);
  assert.equal(perform.calls.length, 1);

  perform.resolve({ text: 'Restarted.' });
  const out = await first;
  assert.equal(out.ok, true);
  assert.equal((await o.history()).find((m) => m.action?.id === id).action.status, 'done');

  await assert.rejects(() => o.act(id), /already done/);
  assert.equal(perform.calls.length, 1); // never performed twice
});

test('act: a Night watch auto action already running on the same id is rejected the same way', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oracle-act-night-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(dir, 'night-watch.json'), JSON.stringify({ on: true, until: new Date(Date.now() + 3600e3).toISOString(), startedAt: new Date().toISOString() }));
  fs.writeFileSync(path.join(dir, 'night-permissions.json'), JSON.stringify({ allowed: ['dispatch'], updatedAt: new Date().toISOString() }));
  const perform = deferredPerform();
  const o = oracle.createOracle({
    dir: () => dir, tools: () => [], bridge: { start: async () => { throw new Error('not needed'); } },
    mcpCommand: () => { throw new Error('not needed'); }, skillsDirs: () => [], resolveCommand: () => { throw new Error('not needed'); },
    refuseReal: () => { throw new Error('not needed'); }, agent: () => ({ model: 'claude-opus-5-5', effort: 'high' }), settings: () => ({}),
    perform: perform.fn,
  });

  // dispatch.restart is a Night watch repair (NIGHT_WATCH_KINDS): propose() runs it at once, and
  // awaits its result, so the id is only known once the card is posted (before that await resolves)
  const proposing = o.propose({ kind: 'dispatch.restart', params: {}, requestedBy: 'oracle' });
  const { id } = (await o.history())[0].action;
  assert.equal((await o.history())[0].action.status, 'running');

  await assert.rejects(() => o.act(id), /already running/);
  assert.equal(perform.calls.length, 1);

  perform.resolve({ text: 'Restarted.' });
  const proposed = await proposing;
  assert.equal(proposed.auto, true);
  assert.equal(proposed.status, 'done');
});

test('dismiss: a card being performed cannot be dismissed', async (t) => {
  const perform = deferredPerform();
  const o = makeActingOracle(t, { perform: perform.fn });
  const { id } = await o.propose({ kind: 'dispatch.restart', params: {}, requestedBy: 'owner' });

  const acting = o.act(id);
  assert.throws(() => o.dismiss(id), /already running/);

  perform.resolve({ text: 'Restarted.' });
  await acting;
});

// #187: a renderer call built with the manifest's old positional params reached act/dismiss/undo as
// an object ({ actionId, mock }), String()'d into "[object Object]" and failing with the misleading
// "This action is not in the conversation." The id is validated instead: a non-string throws a clear
// error, and a missing id (null/undefined/'') still gets the original message (never a caller bug
// and "not in the conversation" at once).
test('act/dismiss/undo: a non-string id (an object, an array, a number) throws "Expected an action id", not "not in the conversation"', async (t) => {
  const o = makeActingOracle(t, {
    perform: async () => ({ text: 'done', backup: { undo: { type: 'file' } } }),
    restore: async () => ({ text: 'restored' }),
  });
  const { id } = await o.propose({ kind: 'dispatch.restart', params: {}, requestedBy: 'owner' });

  for (const [bad, got] of [[{ actionId: id }, 'an object'], [[id], 'an array'], [42, 'a number']]) {
    await assert.rejects(() => o.act(bad), new RegExp(`Expected an action id, got ${got}\\.`));
    assert.throws(() => o.dismiss(bad), new RegExp(`Expected an action id, got ${got}\\.`));
    await assert.rejects(() => o.undo(bad), new RegExp(`Expected an action id, got ${got}\\.`));
  }

  // a missing id is still just "not in the conversation" / "cannot be undone": not a caller-bug message
  await assert.rejects(() => o.act(undefined), /This action is not in the conversation\./);
  assert.throws(() => o.dismiss(null), /This action is not in the conversation\./);
  assert.throws(() => o.dismiss(''), /This action is not in the conversation\./);
  await assert.rejects(() => o.undo(undefined), /This action cannot be undone\./);

  // the real id (a string) still works end-to-end: act performs it, undo puts its backup back
  const acted = await o.act(id);
  assert.equal(acted.ok, true);
  assert.equal((await o.history()).find((m) => m.action?.id === id).action.status, 'done');
  await o.undo(id);
  assert.equal((await o.history()).find((m) => m.action?.id === id).action.status, 'undone');
});

// ---- one process answers (#112, open question default) -------------------------------------------

test('a question from another live app process is refused, naming its pid and host', async (t) => {
  const { service, api } = makeService(t);
  fs.mkdirSync(oracleDir(service), { recursive: true });
  fs.writeFileSync(path.join(oracleDir(service), 'owner.json'), JSON.stringify({
    pid: 999999, host: 'another-machine', started_at: new Date().toISOString(), heartbeat_at: new Date().toISOString(),
  }));
  await assert.rejects(() => api['oracle:ask']({ question: 'Hi', mock: true }), /answers in another app process \(pid 999999 on another-machine/);
});

// ---- the renderer calls these channels with one object, through the real manifest (#187) --------
// Before the fix, every oracle channel with input declared positional params (e.g.
// params: ['actionId', 'mock']), so the client-side payload() builder (src/host/preload.js,
// src/renderer/api-http.js), given the renderer's single object (api.oracleAct({ actionId, mock })),
// wrapped it again into { actionId: { actionId, mock }, mock: undefined }: act() then saw an object,
// String()'d into "[object Object]", and "This action is not in the conversation." `service.api`
// alone (used elsewhere in this file) calls the channel's fn directly and never exercises that
// wrapping; building window.api from the real manifest the way src/host/preload.js does (stubbing
// 'electron' only) and dispatching into the real service is what actually re-creates the bug's path.
function loadPreloadApi(manifest, dispatch) {
  const electronPath = require.resolve('electron');
  const preloadPath = require.resolve('../../src/host/preload.js');
  let exposed = null;
  require.cache[electronPath] = {
    id: electronPath, filename: electronPath, loaded: true,
    exports: {
      contextBridge: { exposeInMainWorld: (_name, api) => { exposed = api; } },
      ipcRenderer: { sendSync: (channel) => (channel === 'api:manifest' ? manifest : undefined), invoke: (channel, arg) => dispatch(channel, arg) },
    },
  };
  delete require.cache[preloadPath];
  try { require(preloadPath); } finally { delete require.cache[preloadPath]; delete require.cache[electronPath]; }
  return exposed;
}

test('manifest: every oracle:* channel that takes input declares a single object (params: "opts"), never positional params that would re-wrap the renderer\'s object literal (#187)', (t) => {
  const { service } = makeService(t);
  const oracleEntries = service.manifest.filter((e) => (e.channel || '').startsWith('oracle:') && e.params);
  assert.ok(oracleEntries.length > 5, 'expected several oracle:* channels with params');
  for (const e of oracleEntries) assert.equal(typeof e.params, 'string', `${e.channel} declares params ${JSON.stringify(e.params)}, expected a single 'opts'-style string`);
});

test('the renderer\'s oracleAct/oracleDismiss/oracleUndo/setOracleNightWatch/muteOracleRun calls reach the service correctly, through the real manifest + preload payload (#187)', async (t) => {
  const { service } = makeService(t);
  const dispatch = (channel, arg) => {
    if (service.api[channel]) return service.api[channel](arg);
    if (service.notifications[channel]) return service.notifications[channel](arg);
    throw new Error(`no such channel: ${channel}`);
  };
  const api = loadPreloadApi(service.manifest, dispatch);
  const propose = async (why) => (await api.oracleProposeAction({ kind: 'dispatch.restart', params: {}, why, requestedBy: 'owner' })).id;

  // "Do it" (mock: true, the way the drawer calls it in developer mode): used to throw "not in the
  // conversation" because the service received { actionId: { actionId, mock }, mock: undefined }.
  const id1 = await propose('Do it, through the manifest');
  const acted = await api.oracleAct({ actionId: id1, mock: true });
  assert.equal(acted.ok, true);

  // Dismiss
  const id2 = await propose('Dismiss, through the manifest');
  await api.oracleDismiss({ actionId: id2 });
  const history = await api.oracleHistory();
  assert.equal(history.find((m) => m.action?.id === id2).action.status, 'dismissed');

  // Undo rejects a card that cannot be undone with the real error, not "not in the conversation"
  await assert.rejects(() => api.oracleUndo({ actionId: id1 }), /This action cannot be undone\./);

  // The Night watch switch and mute (#172, nightwatch.js): broken by the same positional-params bug
  const nw = await api.setOracleNightWatch({ on: false });
  assert.equal(nw.nightWatch.on, false);
  const wake = await api.muteOracleRun({ runId: 'run-1', on: true });
  assert.ok(wake.muted.includes('run-1'));
});
