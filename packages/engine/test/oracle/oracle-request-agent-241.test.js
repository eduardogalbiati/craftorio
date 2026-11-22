// The Oracle routes, it never executes (#241, part 2 of #190; the inboxes are #240): its new tool
// request_agent hands a change to the agent that owns it, the Product Owner (the Backlog) or the
// Supervisor (workflows, skills and runs), and the request and its result live in that owner's
// conversation. The Oracle keeps its read tools; it has no direct write path left.
//
// The interface these tests define (tests-first):
// - require('../../domains/oracle/oracle-tools').oracleTools(ctx, hooks) lists a tool `request_agent` whose
//   inputSchema has properties to (enum ['po', 'supervisor']), kind, params, reason, and requires
//   at least `to` and `kind`. The service's oracle:tools listing names it too.
// - Service channel oracle:requestAgent { to, kind, params, reason, mock } → { ok, text, costUsd,
//   error? }: the function the request_agent tool runs (as oracle:delegate is delegate's), with
//   from 'oracle'. It hands the request to po:request (to 'po'; the project is params.projectId, the
//   way the Oracle's action params always carried it) or supervisor:request (to 'supervisor').
//   An unknown `to` is ok: false with an error and is recorded nowhere; a kind the target does not
//   own is refused by the target's inbox (#240): ok: false, nothing changes.
// - ASSUMPTION (no approval notion exists in the #240 inboxes today; modelled from the issue text and
//   from packages/engine/domains/oracle/oracle-actions.js's rule "never ... starting a real run or a paid call without the
//   click"): run.retry starts a run, so it needs the owner's click. A request of such a kind is a
//   pending card in the OWNER's chat: its request message is recorded there with a pending marker
//   (status 'proposed', or pending: true), no result message ("Done:" / "Failed:") until the owner
//   clicks Do it there, and no action card (kind 'action') in the Oracle's conversation.
// - Night watch (#172): under an active watch, a request whose night permission the owner allowed
//   (dispatch.restart: permission 'dispatch') is executed by the owner and logged in the night log
//   (<oracle dir>/night-log.jsonl, packages/engine/domains/night/night-watch.js readNightLog). A request that tries to answer a
//   human gate is refused (ok: false) and the gate stays open.
// - Its old write path is gone: an owner's kind proposed through the Oracle's own action cards
//   (oracle:propose + oracle:act) is either refused as an unknown action, or routed to the owner (the
//   owner's conversation holds a request from the Oracle); it never writes directly.
// Everything runs simulated (CRAFTORIO_SIMULATION_ONLY=1): no model, no gh, no real run.
process.env.CRAFTORIO_MOCK_DELAY_SCALE ??= '0.05';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const night = require('../../domains/night/night-watch');
const productOwner = require('../../domains/po/product-owner');
const { makeService, roadmapProject, untilTrue, ISSUE_WORKFLOW } = require('../service/helpers');

// The channel the request_agent tool runs, or a clear failure while it does not exist yet.
function requestAgent(api) {
  assert.equal(typeof api['oracle:requestAgent'], 'function', 'the oracle:requestAgent channel exists (the request_agent tool\'s function)');
  return api['oracle:requestAgent'];
}

// The Oracle's tools, loaded inside the test.
function oracleToolList() {
  const { oracleTools } = require('../../domains/oracle/oracle-tools');
  return oracleTools({});
}

async function poSetup(t, name) {
  const { service, api } = makeService(t);
  const ws = service.workspace();
  fs.writeFileSync(path.join(ws.workflows, 'fixture-issue.yaml'), ISSUE_WORKFLOW);
  const p = await roadmapProject(api, ws, t, [1, 2], name);
  return { service, api, ws, p };
}

const plannedNumbers = (roadmap) => (roadmap?.stages || []).flatMap((s) => (s.items || []).flatMap((x) => (Array.isArray(x.issues) && x.issues.length ? x.issues : [x]).map((i) => i.number)));
// The messages of the Oracle's requests of one kind in an owner's history, in order.
const fromOracle = (history, kind) => history.filter((m) => m.request && m.request.from === 'oracle' && m.request.kind === kind);
const isResult = (m) => m.role !== 'request' && /^(Done|Failed):/.test(String(m.text || ''));
const oracleDir = (ws) => ws.oracle || path.join(ws.root, 'oracle');

// Counts the Product Owner's model calls (productOwner.ask, which po:request's `plan` and po:ask use).
function countPoAsks(t) {
  const original = productOwner.ask;
  const calls = [];
  productOwner.ask = (...args) => { calls.push(args[0]); return original(...args); };
  t.after(() => { productOwner.ask = original; });
  return calls;
}

// A mock run of fixture-service waiting at its human gate → { runId, approvalId, events }.
async function runAtGate(t, service, api) {
  const events = [];
  service.events.on('run:event', (ev) => events.push(ev));
  const gate = new Promise((resolve) => {
    const onEv = (ev) => { if (ev.type === 'approval.requested') { service.events.off('run:event', onEv); resolve(ev); } };
    service.events.on('run:event', onEv);
  });
  const { runId } = await api['run:start']({ file: 'fixture-service.yaml', inputs: {}, mock: true });
  t.after(async () => {
    try { api['run:stop']({ runId }); } catch { /* already ended */ }
    await untilTrue(() => !api['runs:active']().some((r) => r.runId === runId));
  });
  const ev = await gate;
  return { runId, approvalId: ev.approval_id, events };
}

// ---- the tool -------------------------------------------------------------------------------------

test('the Oracle\'s tools include request_agent: to (po | supervisor), kind, params and reason', () => {
  const tool = oracleToolList().find((x) => x.name === 'request_agent');
  assert.ok(tool, 'request_agent is one of the Oracle\'s tools');
  assert.equal(typeof tool.description, 'string');
  const props = tool.inputSchema?.properties || {};
  assert.deepEqual([...(props.to?.enum || [])].sort(), ['po', 'supervisor']);
  for (const name of ['kind', 'params', 'reason']) assert.ok(props[name], `the schema accepts ${name}`);
  assert.ok(tool.inputSchema.required.includes('to'));
  assert.ok(tool.inputSchema.required.includes('kind'));
});

test('the service\'s oracle:tools listing names request_agent next to the Oracle\'s read tools', async (t) => {
  const { api } = makeService(t);
  const names = (await api['oracle:tools']()).map((x) => x.name);
  assert.ok(names.includes('request_agent'));
  for (const read of ['roadmap', 'backlog', 'run_events', 'repo_read', 'delegate']) assert.ok(names.includes(read), `the Oracle keeps ${read}`);
});

// ---- routing to the owner ---------------------------------------------------------------------------

test('request_agent roadmap.add to the PO updates the roadmap with no model call, and the PO\'s conversation holds the request and its result', async (t) => {
  const { api, p } = await poSetup(t, 'req241-add');
  const asks = countPoAsks(t);
  const out = await requestAgent(api)({ to: 'po', kind: 'roadmap.add', params: { projectId: p.id, issues: [1], workflow: 'fixture-issue.yaml' }, projectId: p.id, reason: 'ready to build', mock: true });

  assert.equal(out.ok, true, JSON.stringify(out));
  assert.equal(out.costUsd, 0);
  assert.equal(asks.length, 0, 'the Product Owner\'s model was not called');
  assert.ok(plannedNumbers(await api['roadmap:get']({ projectId: p.id })).includes(1), 'issue #1 is in the roadmap');

  const mine = fromOracle(await api['po:history']({ projectId: p.id }), 'roadmap.add');
  assert.equal(mine.length, 2, 'the request and its result');
  const [request, result] = mine;
  assert.equal(request.role, 'request');
  assert.match(request.text, /Request from the Oracle: roadmap\.add/);
  assert.match(request.text, /ready to build/);
  assert.match(result.text, /^Done:/);
  assert.equal(result.costUsd, 0);
  assert.equal('model' in result, false);

  const line = (await api['oracle:history']()).find((m) => m.kind === 'request' && m.to === 'product-owner');
  assert.ok(line, 'the Oracle\'s chat has the line linking to the PO\'s result');
});

test('request_agent run.retry to the Supervisor lands in the Supervisor\'s conversation, not the PO\'s', async (t) => {
  const { api, p } = await poSetup(t, 'req241-retry');
  await requestAgent(api)({ to: 'supervisor', kind: 'run.retry', params: { runId: 'no-such-run' }, reason: 'it failed on a flaky test', mock: true });

  const sup = fromOracle(await api['supervisor:chatHistory'](), 'run.retry');
  assert.ok(sup.length >= 1, 'the Supervisor\'s conversation holds the request');
  assert.equal(sup[0].role, 'request');
  assert.match(sup[0].text, /Request from the Oracle: run\.retry/);
  const po = (await api['po:history']({ projectId: p.id })).filter((m) => m.request);
  assert.equal(po.length, 0, 'the PO got nothing');
});

test('a request that needs the owner\'s click (run.retry) is a pending card in the Supervisor\'s chat, not in the Oracle\'s, and does not run', async (t) => {
  const { service, api } = makeService(t);
  const { runId } = await runAtGate(t, service, api);
  api['run:stop']({ runId });
  await untilTrue(() => !api['runs:active']().some((r) => r.runId === runId));
  const runDirs = () => fs.readdirSync(service.workspace().runs).length;
  const runsBefore = runDirs();

  const out = await requestAgent(api)({ to: 'supervisor', kind: 'run.retry', params: { runId }, reason: 'retry the stopped run', mock: true });
  assert.notEqual(out.ok, false, JSON.stringify(out));

  const mine = fromOracle(await api['supervisor:chatHistory'](), 'run.retry');
  assert.ok(mine.length >= 1, 'the card is in the Supervisor\'s chat');
  assert.ok(mine.some((m) => m.status === 'proposed' || m.pending === true), 'the card waits for the owner\'s click');
  assert.equal(mine.filter(isResult).length, 0, 'no result before the click');
  assert.equal(api['runs:active']().length, 0, 'no run started');
  assert.equal(runDirs(), runsBefore, 'no new run folder');

  const oracleCards = (await api['oracle:history']()).filter((m) => m.kind === 'action');
  assert.equal(oracleCards.length, 0, 'no action card in the Oracle\'s conversation');
});

test('a judgment request (plan) to the PO calls the PO\'s model exactly once', async (t) => {
  const { api, p } = await poSetup(t, 'req241-plan');
  const out = await requestAgent(api)({ to: 'po', kind: 'plan', params: { projectId: p.id, question: 'Re-plan issues 1 and 2' }, projectId: p.id, reason: 'the stages are stale', mock: true });
  assert.equal(out.ok, true, JSON.stringify(out));

  const mine = fromOracle(await api['po:history']({ projectId: p.id }), 'plan');
  assert.equal(mine[0].role, 'request');
  const answers = mine.filter((m) => m.role === 'po' && m.model);
  assert.equal(answers.length, 1, 'one model answer');
  assert.equal(answers[0].model, 'simulated');
});

// ---- refusals ---------------------------------------------------------------------------------------

test('request_agent to an unknown agent (oracle) is ok: false with an error and changes nothing', async (t) => {
  const { api, p } = await poSetup(t, 'req241-unknown-to');
  const roadmapBefore = JSON.stringify(await api['roadmap:get']({ projectId: p.id }));
  const out = await requestAgent(api)({ to: 'oracle', kind: 'roadmap.add', params: { projectId: p.id, issues: [1], workflow: 'fixture-issue.yaml' }, projectId: p.id, reason: 'r', mock: true });

  assert.equal(out.ok, false);
  assert.equal(typeof out.error, 'string');
  assert.ok(out.error.length > 0);
  assert.equal(JSON.stringify(await api['roadmap:get']({ projectId: p.id })), roadmapBefore, 'the roadmap is unchanged');
  assert.equal((await api['po:history']({ projectId: p.id })).filter((m) => m.request).length, 0);
  assert.equal((await api['supervisor:chatHistory']()).filter((m) => m.request).length, 0);
});

test('request_agent of a kind the target does not own (run.retry to the PO) is ok: false naming the kind, and changes nothing', async (t) => {
  const { api, p } = await poSetup(t, 'req241-wrong-owner');
  const roadmapBefore = JSON.stringify(await api['roadmap:get']({ projectId: p.id }));
  const out = await requestAgent(api)({ to: 'po', kind: 'run.retry', params: { projectId: p.id, runId: 'x' }, projectId: p.id, reason: 'r', mock: true });

  assert.equal(out.ok, false);
  assert.match(out.error, /run\.retry/);
  assert.equal(out.costUsd ?? 0, 0);
  assert.equal(JSON.stringify(await api['roadmap:get']({ projectId: p.id })), roadmapBefore, 'the roadmap is unchanged');
  assert.equal(api['runs:active']().length, 0, 'no run started');
  assert.equal(fromOracle(await api['supervisor:chatHistory'](), 'run.retry').length, 0, 'the Supervisor got nothing');
});

// ---- no direct write path left ---------------------------------------------------------------------

// An owner's kind through the Oracle's own action cards: { refused } (no such action any more),
// or what happened once the card was proposed (and clicked, when it waited for a click).
async function viaOracleActionPath(api, input) {
  let proposed;
  try {
    proposed = await api['oracle:propose']({ why: 'test', requestedBy: 'oracle', ...input });
  } catch (e) {
    return { refused: e.message || String(e) };
  }
  if (proposed?.id && proposed.status === 'proposed') {
    try {
      return { acted: await api['oracle:act']({ actionId: proposed.id, mock: true }) };
    } catch (e) {
      return { refused: e.message || String(e) };
    }
  }
  return { proposed };
}

const OLD_WRITES = [
  { owner: 'po', label: 'roadmap.item (skip)', input: (p) => ({ kind: 'roadmap.item', params: { projectId: p.id, itemId: 'no-such-item', action: 'skip' } }) },
  { owner: 'po', label: 'issue.file', input: (p) => ({ kind: 'issue.file', params: { projectId: p.id, title: 'A bug', body: 'Steps', duplicateSearch: 'none found' } }) },
  { owner: 'supervisor', label: 'dispatch.restart', input: () => ({ kind: 'dispatch.restart', params: {} }) },
  { owner: 'supervisor', label: 'run.stop', input: () => ({ kind: 'run.stop', params: { runId: 'no-such-run' } }) },
];

for (const w of OLD_WRITES) {
  test(`the Oracle has no direct write path: ${w.label} through its action cards is refused or routed to the ${w.owner === 'po' ? 'Product Owner' : 'Supervisor'}`, async (t) => {
    const { api, p } = await poSetup(t, `req241-old-${w.label.replace(/\W+/g, '-')}`);
    const out = await viaOracleActionPath(api, w.input(p));
    if (out.refused) {
      assert.match(out.refused, /Unknown action|request_agent/i, `refused because the action is gone, not for another reason: ${out.refused}`);
      return;
    }
    const history = w.owner === 'po' ? await api['po:history']({ projectId: p.id }) : await api['supervisor:chatHistory']();
    const routed = history.filter((m) => m.role === 'request' && m.request?.from === 'oracle');
    assert.ok(routed.length >= 1, `the ${w.owner}'s conversation holds the Oracle's request (it did not write directly): ${JSON.stringify(out.acted ? { ok: out.acted.ok, text: out.acted.text } : out.proposed)}`);
  });
}

// ---- Night watch -------------------------------------------------------------------------------------

test('under the Night watch, a request its permissions allow (dispatch.restart) is executed by the Supervisor and logged in the night log', async (t) => {
  const { service, api } = makeService(t);
  await api['nightwatch:permissions']({ allowed: ['dispatch'] });
  await api['oracle:nightWatch']({ on: true, until: new Date(Date.now() + 3600e3).toISOString(), from: 'test' });

  const out = await requestAgent(api)({ to: 'supervisor', kind: 'dispatch.restart', params: {}, reason: 'the queue looks stuck', mock: true });
  assert.equal(out.ok, true, JSON.stringify(out));
  const mine = fromOracle(await api['supervisor:chatHistory'](), 'dispatch.restart');
  assert.ok(mine.some((m) => /^Done:/.test(String(m.text || ''))), 'the Supervisor executed it');

  const log = night.readNightLog(oracleDir(service.workspace())).filter((e) => e.type !== 'oracle.watch');
  assert.ok(log.some((e) => JSON.stringify(e).includes('dispatch.restart')), `the night log records it: ${JSON.stringify(log)}`);
});

test('under the Night watch, a request that tries to answer a human gate is refused and the gate stays open', async (t) => {
  const { service, api } = makeService(t);
  const { runId, approvalId, events } = await runAtGate(t, service, api);
  await api['oracle:nightWatch']({ on: true, until: new Date(Date.now() + 3600e3).toISOString(), from: 'test' });

  for (const to of ['supervisor', 'po']) {
    const out = await requestAgent(api)({ to, kind: 'approval.resolve', params: { runId, id: approvalId, answer: 'approve' }, reason: 'the work looks done', mock: true });
    assert.equal(out.ok, false, `${to}: ${JSON.stringify(out)}`);
    assert.equal(typeof out.error, 'string');
  }
  assert.equal(events.filter((e) => e.type === 'approval.resolved' && e.run_id === runId).length, 0, 'the gate was not answered');
  assert.ok(api['runs:active']().some((r) => r.runId === runId), 'the run still waits at its gate');
});
