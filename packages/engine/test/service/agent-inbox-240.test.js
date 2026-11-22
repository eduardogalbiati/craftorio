// Agent inboxes (#240), service level: po:request and supervisor:request. The Oracle (or another
// sender) hands a request to the owner of the work; the request and its result are messages in that
// owner's conversation, and the Oracle's chat gets a short line linking to it.
//
// The interface these tests define (tests-first):
// - po:request { projectId, kind, params, reason, from, ref, mock } and supervisor:request
//   { kind, params, reason, from, ref, mock } resolve to { ok: boolean, text: string, costUsd: number,
//   error?: string }. They never throw for a refused or failed request: ok:false + error, and the
//   failure is recorded in the owner's history too.
// - PO kinds (productOwner.REQUEST_KINDS): issue.file, issue.update, plan, queue.assign, roadmap.add,
//   roadmap.move, roadmap.regroup, roadmap.skip. Supervisor kinds (supervisor-chat REQUEST_KINDS):
//   dispatch.restart, run.resume, run.retry, run.stop, skill.restore, workflow.commit, workflow.restore.
//   A kind outside the owner's list (unknown, or the other owner's) is refused: ok:false, error names
//   the kind, costUsd 0.
// - Mechanical kinds run the same code as the owner's buttons / the Oracle's PERFORM map, never call a
//   model and cost US$ 0. `plan` (PO only) is a judgment request: a normal question to the PO's model
//   (in simulation: the mock answer, model 'simulated').
// - History: (a) a request message whose `request` is { from, kind, ref } and whose text contains
//   "Request from the Oracle" (from === 'oracle'), the kind and the reason; then (b) a result message
//   with the same `request`, `costUsd` (0 for mechanical, and no `model` field), and a truthy `error`
//   when it failed. PO: the project's <backlogDir>/<projectId>.po.jsonl (po:history); Supervisor:
//   supervisor:chatHistory.
// - Oracle line: when from === 'oracle', oracle:history gets { kind: 'request', to: 'product-owner' |
//   'supervisor', ref: <the Oracle message id given>, ownerTs: <ts of the owner's result message> }.
// - Params assumed here: roadmap.add { issues: [numbers], workflow? }, roadmap.skip { itemId },
//   plan { question }, run.stop { runId }, dispatch.restart {}.
// Everything runs simulated (CRAFTORIO_SIMULATION_ONLY=1): no model, no gh, no real run.
process.env.CRAFTORIO_MOCK_DELAY_SCALE ??= '0.05';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { makeService, roadmapProject, ISSUE_WORKFLOW } = require('./helpers');

// The channel, or a clear failure while it does not exist yet (the file still loads).
function channel(api, name) {
  assert.equal(typeof api[name], 'function', `the ${name} channel exists`);
  return api[name];
}

// The messages of one request (by its ref), in order: the request first, the result last.
const ofRequest = (history, ref) => history.filter((m) => m.request && m.request.ref === ref);

async function poSetup(t, name) {
  const { service, api } = makeService(t);
  const ws = service.workspace();
  fs.writeFileSync(path.join(ws.workflows, 'fixture-issue.yaml'), ISSUE_WORKFLOW);
  const p = await roadmapProject(api, ws, t, [1, 2], name);
  return { service, api, p };
}

const plannedNumbers = (roadmap) => (roadmap?.stages || []).flatMap((s) => (s.items || []).flatMap((x) => (Array.isArray(x.issues) && x.issues.length ? x.issues : [x]).map((i) => i.number)));

test('po:request roadmap.add from the Oracle: mechanical (ok, US$ 0), the issue is planned, and po:history holds the request and its result (no model)', async (t) => {
  const { api, p } = await poSetup(t, 'inbox-add');
  const out = await channel(api, 'po:request')({ projectId: p.id, kind: 'roadmap.add', params: { issues: [1], workflow: 'fixture-issue.yaml' }, reason: 'ready to build', from: 'oracle', ref: 'oracle-msg-1', mock: true });
  assert.equal(out.ok, true);
  assert.equal(out.costUsd, 0);
  assert.equal(typeof out.text, 'string');

  assert.ok(plannedNumbers(await api['roadmap:get']({ projectId: p.id })).includes(1), 'issue #1 is in the roadmap');

  const mine = ofRequest(await api['po:history']({ projectId: p.id }), 'oracle-msg-1');
  assert.equal(mine.length, 2);
  const [request, result] = mine;
  assert.deepEqual(request.request, { from: 'oracle', kind: 'roadmap.add', ref: 'oracle-msg-1' });
  assert.match(request.text, /Request from the Oracle/);
  assert.match(request.text, /roadmap\.add/);
  assert.match(request.text, /ready to build/);
  assert.deepEqual(result.request, { from: 'oracle', kind: 'roadmap.add', ref: 'oracle-msg-1' });
  assert.equal(result.costUsd, 0);
  assert.equal('model' in result, false);
  assert.ok(!result.error);
});

test('po:request roadmap.skip on a missing item: ok false with an error, recorded in po:history at US$ 0', async (t) => {
  const { api, p } = await poSetup(t, 'inbox-skip');
  const out = await channel(api, 'po:request')({ projectId: p.id, kind: 'roadmap.skip', params: { itemId: 'no-such-item' }, reason: 'not needed', from: 'oracle', ref: 'oracle-msg-2', mock: true });
  assert.equal(out.ok, false);
  assert.equal(typeof out.error, 'string');
  assert.ok(out.error.length > 0);
  assert.equal(out.costUsd, 0);

  const mine = ofRequest(await api['po:history']({ projectId: p.id }), 'oracle-msg-2');
  assert.equal(mine.length, 2);
  const result = mine.at(-1);
  assert.equal(result.request.kind, 'roadmap.skip');
  assert.ok(result.error);
  assert.equal(result.costUsd, 0);
});

test('po:request plan is a judgment request: it goes to the PO\'s model path (simulated) and its answer carries request.kind plan and a model', async (t) => {
  const { api, p } = await poSetup(t, 'inbox-plan');
  const out = await channel(api, 'po:request')({ projectId: p.id, kind: 'plan', params: { question: 'Re-plan issues 1 and 2' }, reason: 'the stages are stale', from: 'oracle', ref: 'oracle-msg-3', mock: true });
  assert.equal(out.ok, true);

  const mine = ofRequest(await api['po:history']({ projectId: p.id }), 'oracle-msg-3');
  assert.ok(mine.length >= 2);
  assert.equal(mine[0].request.kind, 'plan');
  assert.match(mine[0].text, /Request from the Oracle/);
  const answer = mine.at(-1);
  assert.equal(answer.role, 'po');
  assert.equal(answer.request.kind, 'plan');
  assert.equal(answer.model, 'simulated');
});

test('supervisor:request dispatch.restart from the Oracle: ok, US$ 0, and supervisor:chatHistory holds the request and its result (no model)', async (t) => {
  const { api } = makeService(t);
  const out = await channel(api, 'supervisor:request')({ kind: 'dispatch.restart', params: {}, reason: 'the queue looks stuck', from: 'oracle', ref: 'oracle-msg-4', mock: true });
  assert.equal(out.ok, true);
  assert.equal(out.costUsd, 0);

  const mine = ofRequest(await api['supervisor:chatHistory'](), 'oracle-msg-4');
  assert.equal(mine.length, 2);
  const [request, result] = mine;
  assert.deepEqual(request.request, { from: 'oracle', kind: 'dispatch.restart', ref: 'oracle-msg-4' });
  assert.match(request.text, /Request from the Oracle/);
  assert.match(request.text, /dispatch\.restart/);
  assert.match(request.text, /the queue looks stuck/);
  assert.deepEqual(result.request, { from: 'oracle', kind: 'dispatch.restart', ref: 'oracle-msg-4' });
  assert.equal(result.costUsd, 0);
  assert.equal('model' in result, false);
  assert.ok(!result.error);
});

test('supervisor:request run.stop on a run that is not in progress: ok false with an error, recorded in supervisor:chatHistory', async (t) => {
  const { api } = makeService(t);
  const out = await channel(api, 'supervisor:request')({ kind: 'run.stop', params: { runId: 'no-such-run' }, reason: 'it loops', from: 'oracle', ref: 'oracle-msg-5', mock: true });
  assert.equal(out.ok, false);
  assert.equal(typeof out.error, 'string');
  assert.equal(out.costUsd, 0);

  const mine = ofRequest(await api['supervisor:chatHistory'](), 'oracle-msg-5');
  assert.equal(mine.length, 2);
  const result = mine.at(-1);
  assert.equal(result.request.kind, 'run.stop');
  assert.ok(result.error);
  assert.equal(result.costUsd, 0);
});

test('a kind of the other owner is refused: run.stop on po:request and roadmap.add on supervisor:request give ok false, the kind in the error, US$ 0', async (t) => {
  const { api, p } = await poSetup(t, 'inbox-wrong-owner');
  const po = await channel(api, 'po:request')({ projectId: p.id, kind: 'run.stop', params: { runId: 'x' }, reason: 'r', from: 'oracle', ref: 'oracle-msg-6', mock: true });
  assert.equal(po.ok, false);
  assert.match(po.error, /run\.stop/);
  assert.equal(po.costUsd, 0);

  const sup = await channel(api, 'supervisor:request')({ kind: 'roadmap.add', params: { issues: [1] }, reason: 'r', from: 'oracle', ref: 'oracle-msg-7', mock: true });
  assert.equal(sup.ok, false);
  assert.match(sup.error, /roadmap\.add/);
  assert.equal(sup.costUsd, 0);
});

test('a request from the Oracle leaves a line in oracle:history: kind request, to product-owner, the Oracle\'s ref and the ts of the owner\'s result message', async (t) => {
  const { api, p } = await poSetup(t, 'inbox-oracle-line');
  const out = await channel(api, 'po:request')({ projectId: p.id, kind: 'roadmap.add', params: { issues: [1], workflow: 'fixture-issue.yaml' }, reason: 'ready to build', from: 'oracle', ref: 'oracle-msg-1', mock: true });
  assert.equal(out.ok, true);
  const result = ofRequest(await api['po:history']({ projectId: p.id }), 'oracle-msg-1').at(-1);
  assert.ok(result?.ts);

  const line = (await api['oracle:history']()).find((m) => m.kind === 'request' && m.ref === 'oracle-msg-1');
  assert.ok(line, 'the Oracle\'s chat has the request line');
  assert.equal(line.to, 'product-owner');
  assert.equal(line.ownerTs, result.ts);
});
