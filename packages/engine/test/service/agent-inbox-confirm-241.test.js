// #241 review fixes, service level: the kinds that publish or are hard to undo (PO: issue.file,
// issue.update; Supervisor: dispatch.restart, run.stop, skill.restore, workflow.restore,
// workflow.commit) wait for the owner's click when the Oracle's model sends them through
// request_agent (oracle:requestAgent) with the Night watch off; the roadmap and queue kinds still run
// at once; a direct po:request / supervisor:request runs at once. Under the Night watch, a fourth
// automatic action on one target waits (night log oracle.blocked, reason 'loop'). The owner's Do it /
// Dismiss / Undo go through po:requestAct and supervisor:requestAct.
// Everything runs simulated (MULTIAGENT_SIMULATION_ONLY=1): no model, no gh, no real run.
process.env.MULTIAGENT_MOCK_DELAY_SCALE ??= '0.05';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const night = require('../../domains/night/night-watch');
const { makeService, roadmapProject, untilTrue, ISSUE_WORKFLOW } = require('./helpers');

const BUNDLED = path.join(__dirname, '..', '..', '..', '..');
const ofRequest = (history, ref) => history.filter((m) => m.request && m.request.ref === ref);
const ofKind = (history, kind) => history.filter((m) => m.request && m.request.from === 'oracle' && m.request.kind === kind);
const isResult = (m) => m.role !== 'request' && /^(Done|Failed|Dismissed|Undone)/.test(String(m.text || ''));
const stagesOf = async (api, projectId) => (await api['roadmap:get']({ projectId }))?.stages || [];
const numbersIn = (item) => (item.issues || []).map((i) => (typeof i === 'object' ? i.number : i));
const watchUntil = () => new Date(Date.now() + 3600e3).toISOString();

async function poSetup(t, name) {
  const { service, api, trashed } = makeService(t);
  const ws = service.workspace();
  fs.writeFileSync(path.join(ws.workflows, 'fixture-issue.yaml'), ISSUE_WORKFLOW);
  const p = await roadmapProject(api, ws, t, [1, 2], name);
  return { service, api, ws, p, trashed };
}

// An edited workspace copy of a bundled workflow → { file, edited }.
function editWorkflow(ws, name = 'issue-tracker.yaml') {
  const file = path.join(ws.workflows, name);
  const edited = `${fs.readFileSync(path.join(BUNDLED, 'workflows', name), 'utf8')}\n# edited by the owner\n`;
  fs.writeFileSync(file, edited);
  return { file, edited };
}

// An edited workspace copy of a bundled skill → { file, edited }.
function editSkill(ws, id = 'oracle') {
  const dir = path.join(ws.skills, id);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'SKILL.md');
  const edited = `${fs.readFileSync(path.join(BUNDLED, 'skills', id, 'SKILL.md'), 'utf8')}\n<!-- edited by the owner -->\n`;
  fs.writeFileSync(file, edited);
  return { file, edited };
}

// A mock run of fixture-service waiting at its human gate → runId.
async function runAtGate(t, service, api) {
  const gate = new Promise((resolve) => {
    const onEv = (ev) => { if (ev.type === 'approval.requested') { service.events.off('run:event', onEv); resolve(ev); } };
    service.events.on('run:event', onEv);
  });
  const { runId } = await api['run:start']({ file: 'fixture-service.yaml', inputs: {}, mock: true });
  t.after(async () => {
    try { api['run:stop']({ runId }); } catch { /* already ended */ }
    await untilTrue(() => !api['runs:active']().some((r) => r.runId === runId));
  });
  await gate;
  return runId;
}

// ---- 1. by day, request_agent of a confirm kind is a pending card ---------------------------------

// { to, kind, params(ctx), setup(ctx) → observe() → a value that stays the same while nothing ran }
const CONFIRM = [
  { to: 'po', kind: 'issue.file', params: ({ p }) => ({ projectId: p.id, title: 'Export as CSV', body: 'The run log as CSV.' }) },
  { to: 'po', kind: 'issue.update', params: ({ p }) => ({ projectId: p.id, number: 1, body: 'New text' }) },
  {
    to: 'supervisor', kind: 'workflow.commit',
    params: ({ p }) => ({ projectId: p.id, message: 'Fix the workflow', files: [{ path: 'workflows/fix.yaml', content: 'x: 1\n' }] }),
    observe: ({ p }) => () => fs.existsSync(path.join(p.folder, 'workflows', 'fix.yaml')),
  },
  {
    to: 'supervisor', kind: 'run.stop',
    setup: async (c) => { c.runId = await runAtGate(c.t, c.service, c.api); },
    params: ({ runId }) => ({ runId }),
    observe: ({ api, runId }) => () => api['runs:active']().some((r) => r.runId === runId),
  },
  {
    to: 'supervisor', kind: 'skill.restore',
    setup: (c) => { c.skill = editSkill(c.ws); },
    params: () => ({ id: 'oracle' }),
    observe: ({ skill, trashed }) => () => `${fs.readFileSync(skill.file, 'utf8')}|trashed:${trashed.length}`,
  },
  { to: 'supervisor', kind: 'dispatch.restart', params: () => ({}) },
];

for (const c of CONFIRM) {
  test(`by day, request_agent ${c.kind} to the ${c.to === 'po' ? 'Product Owner' : 'Supervisor'} comes back pending, a card waits in the owner's chat with no result, and nothing ran`, async (t) => {
    const ctx = { t, ...(await poSetup(t, `confirm-${c.kind.replace(/\W+/g, '-')}`)) };
    await c.setup?.(ctx);
    const observe = c.observe?.(ctx);
    const before = observe?.();

    const out = await ctx.api['oracle:requestAgent']({ to: c.to, kind: c.kind, params: c.params(ctx), projectId: ctx.p.id, reason: 'test', mock: true });

    assert.equal(out.ok, true, JSON.stringify(out));
    assert.equal(out.pending, true);
    assert.equal(out.error, undefined);
    assert.equal(out.costUsd, 0);
    const history = c.to === 'po' ? await ctx.api['po:history']({ projectId: ctx.p.id }) : await ctx.api['supervisor:chatHistory']();
    const mine = ofKind(history, c.kind);
    assert.equal(mine.length, 1, 'only the card, no result');
    assert.equal(mine[0].role, 'request');
    assert.equal(mine[0].pending, true);
    assert.equal(mine[0].status, 'proposed');
    assert.equal(mine.filter(isResult).length, 0);
    if (observe) assert.deepEqual(observe(), before, 'nothing changed');
  });
}

test('by day, request_agent roadmap.add runs at once: the issue is planned and its Done result is recorded', async (t) => {
  const { api, p } = await poSetup(t, 'confirm-now-add');
  const out = await api['oracle:requestAgent']({ to: 'po', kind: 'roadmap.add', params: { issues: [1], workflow: 'fixture-issue.yaml' }, projectId: p.id, reason: 'test', mock: true });
  assert.equal(out.ok, true, JSON.stringify(out));
  assert.equal(out.pending, undefined);
  assert.deepEqual((await stagesOf(api, p.id)).flatMap((s) => s.items).map(numbersIn), [[1]]);
  const mine = ofKind(await api['po:history']({ projectId: p.id }), 'roadmap.add');
  assert.equal(mine.length, 2);
  assert.equal(mine[0].pending, undefined);
  assert.match(mine[1].text, /^Done:/);
});

test('by day, request_agent roadmap.move runs at once: the item moves to the new stage', async (t) => {
  const { api, p } = await poSetup(t, 'confirm-now-move');
  assert.equal((await api['po:request']({ projectId: p.id, kind: 'roadmap.add', params: { issues: [1, 2], workflow: 'fixture-issue.yaml' }, from: 'owner', ref: 'add', mock: true })).ok, true);
  const item = (await stagesOf(api, p.id))[0].items.find((x) => numbersIn(x).includes(2));

  const out = await api['oracle:requestAgent']({ to: 'po', kind: 'roadmap.move', params: { itemId: item.id, stage: 2 }, projectId: p.id, reason: 'test', mock: true });
  assert.equal(out.ok, true, JSON.stringify(out));
  assert.equal(out.pending, undefined);
  assert.deepEqual((await stagesOf(api, p.id)).map((s) => s.items.map(numbersIn)), [[[1]], [[2]]]);
  assert.match(ofKind(await api['po:history']({ projectId: p.id }), 'roadmap.move')[1].text, /^Done:/);
});

test('by day, request_agent roadmap.skip runs at once: the item is skipped', async (t) => {
  const { api, p } = await poSetup(t, 'confirm-now-skip');
  assert.equal((await api['po:request']({ projectId: p.id, kind: 'roadmap.add', params: { issues: [1], workflow: 'fixture-issue.yaml' }, from: 'owner', ref: 'add', mock: true })).ok, true);
  const item = (await stagesOf(api, p.id))[0].items[0];

  const out = await api['oracle:requestAgent']({ to: 'po', kind: 'roadmap.skip', params: { itemId: item.id }, projectId: p.id, reason: 'test', mock: true });
  assert.equal(out.ok, true, JSON.stringify(out));
  assert.equal(out.pending, undefined);
  assert.equal((await stagesOf(api, p.id))[0].items[0].status, 'skipped');
  assert.match(ofKind(await api['po:history']({ projectId: p.id }), 'roadmap.skip')[1].text, /^Done:/);
});

test('by day, request_agent queue.assign runs at once: its Done result is recorded', async (t) => {
  const { api, p } = await poSetup(t, 'confirm-now-queue');
  const out = await api['oracle:requestAgent']({ to: 'po', kind: 'queue.assign', params: { issues: [1], workflow: 'fixture-issue.yaml' }, projectId: p.id, reason: 'test', mock: true });
  assert.equal(out.ok, true, JSON.stringify(out));
  assert.equal(out.pending, undefined);
  const mine = ofKind(await api['po:history']({ projectId: p.id }), 'queue.assign');
  assert.equal(mine.length, 2);
  assert.equal(mine[1].text, 'Done: #1 queued on fixture-issue.yaml.');
});

// ---- 2. a direct request (not the Oracle's model) runs at once ------------------------------------

test('a direct po:request issue.update runs at once (simulation preview recorded as Done), not pending', async (t) => {
  const { api, p } = await poSetup(t, 'confirm-direct-update');
  const out = await api['po:request']({ projectId: p.id, kind: 'issue.update', params: { number: 1, body: 'New text' }, reason: 'stale', from: 'oracle', ref: 'direct-update', mock: true });
  assert.equal(out.ok, true, JSON.stringify(out));
  assert.equal(out.pending, undefined);
  const mine = ofRequest(await api['po:history']({ projectId: p.id }), 'direct-update');
  assert.equal(mine.length, 2);
  assert.equal(mine[0].pending, undefined);
  assert.match(mine[1].text, /^Done: Simulation only: nothing was changed/);
});

test('a direct po:request issue.file runs at once (simulation preview recorded as Done), not pending', async (t) => {
  const { api, p } = await poSetup(t, 'confirm-direct-file');
  const out = await api['po:request']({ projectId: p.id, kind: 'issue.file', params: { title: 'A bug', body: 'Steps' }, reason: 'found it', from: 'oracle', ref: 'direct-file', mock: true });
  assert.equal(out.ok, true, JSON.stringify(out));
  assert.equal(out.pending, undefined);
  const mine = ofRequest(await api['po:history']({ projectId: p.id }), 'direct-file');
  assert.equal(mine.length, 2);
  assert.match(mine[1].text, /^Done: Simulation only: nothing was changed/);
});

test('a direct supervisor:request dispatch.restart runs at once, not pending', async (t) => {
  const { api } = makeService(t);
  const out = await api['supervisor:request']({ kind: 'dispatch.restart', params: {}, reason: 'stuck', from: 'oracle', ref: 'direct-dispatch', mock: true });
  assert.equal(out.ok, true, JSON.stringify(out));
  assert.equal(out.pending, undefined);
  const mine = ofRequest(await api['supervisor:chatHistory'](), 'direct-dispatch');
  assert.equal(mine.length, 2);
  assert.equal(mine[0].pending, undefined);
  assert.equal(mine[1].text, 'Done: The roadmaps and queues were dispatched: the next planned items start when they can.');
});

// ---- 3. Night watch: the loop cap -----------------------------------------------------------------

test('under the Night watch, after 3 automatic actions on one target the next request on it waits and the night log gains oracle.blocked (loop); another target still runs', async (t) => {
  const { service, api } = makeService(t);
  const ws = service.workspace();
  await api['nightwatch:permissions']({ allowed: ['dispatch', 'restore'] });
  await api['oracle:nightWatch']({ on: true, until: watchUntil(), from: 'test' });
  const send = (kind, params) => api['oracle:requestAgent']({ to: 'supervisor', kind, params, reason: 'night', mock: true });

  for (let i = 0; i < 3; i++) {
    const out = await send('dispatch.restart', {});
    assert.equal(out.ok, true, JSON.stringify(out));
    assert.equal(out.pending, undefined, `action ${i + 1} ran alone`);
  }
  const autoOnAll = () => night.readNightLog(ws.oracle).filter((e) => e.type === 'oracle.action' && e.auto && e.target === 'all');
  assert.equal(autoOnAll().length, 3);

  const fourth = await send('dispatch.restart', {});
  assert.equal(fourth.ok, true, JSON.stringify(fourth));
  assert.equal(fourth.pending, true);
  assert.equal(autoOnAll().length, 3, 'no fourth automatic action');
  const blocked = night.readNightLog(ws.oracle).filter((e) => e.type === 'oracle.blocked');
  assert.equal(blocked.length, 1);
  assert.equal(blocked[0].reason, 'loop');
  assert.equal(blocked[0].kind, 'dispatch.restart');
  assert.equal(blocked[0].target, 'all');

  const { file } = editWorkflow(ws);
  const other = await send('workflow.restore', { file: 'issue-tracker.yaml' });
  assert.equal(other.ok, true, JSON.stringify(other));
  assert.equal(other.pending, undefined);
  assert.equal(fs.readFileSync(file, 'utf8'), fs.readFileSync(path.join(BUNDLED, 'workflows', 'issue-tracker.yaml'), 'utf8'));
});

// ---- 4. the owner's Do it / Dismiss / Undo through the service ------------------------------------

test('po:requestAct do on a pending issue.file card runs it and records the Done result', async (t) => {
  const { api, p } = await poSetup(t, 'act-po-do');
  await api['oracle:requestAgent']({ to: 'po', kind: 'issue.file', params: { title: 'A bug', body: 'Steps' }, projectId: p.id, reason: 'found it', mock: true });
  const card = ofKind(await api['po:history']({ projectId: p.id }), 'issue.file')[0];

  const out = await api['po:requestAct']({ projectId: p.id, ref: card.request.ref, action: 'do', mock: true });
  assert.equal(out.ok, true, JSON.stringify(out));
  assert.match(out.text, /^Done: Simulation only: nothing was changed/);
  const mine = ofRequest(await api['po:history']({ projectId: p.id }), card.request.ref);
  assert.equal(mine.length, 2);
  assert.match(mine[1].text, /^Done: Simulation only/);
  assert.equal(ofRequest(out.messages, card.request.ref).length, 2, 'the answer carries the conversation');
});

test('po:requestAct dismiss on a pending issue.update card records that nothing was done', async (t) => {
  const { api, p } = await poSetup(t, 'act-po-dismiss');
  await api['oracle:requestAgent']({ to: 'po', kind: 'issue.update', params: { number: 1, body: 'New' }, projectId: p.id, reason: 'stale', mock: true });
  const card = ofKind(await api['po:history']({ projectId: p.id }), 'issue.update')[0];

  const out = await api['po:requestAct']({ projectId: p.id, ref: card.request.ref, action: 'dismiss', mock: true });
  assert.equal(out.ok, true, JSON.stringify(out));
  const mine = ofRequest(await api['po:history']({ projectId: p.id }), card.request.ref);
  assert.equal(mine.length, 2);
  assert.equal(mine[1].dismissed, true);
  assert.equal(mine[1].text, 'Dismissed by the owner: nothing was done.');
  assert.equal(mine.filter((m) => /^Done:/.test(m.text)).length, 0);
});

test('supervisor:requestAct dismiss on a pending run.stop card leaves the run going', async (t) => {
  const { service, api } = makeService(t);
  const runId = await runAtGate(t, service, api);
  await api['oracle:requestAgent']({ to: 'supervisor', kind: 'run.stop', params: { runId }, reason: 'loops', mock: true });
  const card = ofKind(await api['supervisor:chatHistory'](), 'run.stop')[0];

  const out = await api['supervisor:requestAct']({ ref: card.request.ref, action: 'dismiss', mock: true });
  assert.equal(out.ok, true, JSON.stringify(out));
  assert.equal(out.text, 'Dismissed by the owner: nothing was done.');
  assert.ok(api['runs:active']().some((r) => r.runId === runId), 'the run still goes');
  const mine = ofRequest(await api['supervisor:chatHistory'](), card.request.ref);
  assert.equal(mine.filter((m) => /^Done:/.test(m.text)).length, 0);
});

test('supervisor:requestAct do on a pending run.stop card stops the run', async (t) => {
  const { service, api } = makeService(t);
  const runId = await runAtGate(t, service, api);
  await api['oracle:requestAgent']({ to: 'supervisor', kind: 'run.stop', params: { runId }, reason: 'loops', mock: true });
  const card = ofKind(await api['supervisor:chatHistory'](), 'run.stop')[0];

  const out = await api['supervisor:requestAct']({ ref: card.request.ref, action: 'do', mock: true });
  assert.equal(out.ok, true, JSON.stringify(out));
  assert.equal(out.text, `Done: Run ${runId} was stopped.`);
  await untilTrue(() => !api['runs:active']().some((r) => r.runId === runId));
});

test('supervisor:requestAct do on a pending workflow.restore card restores it, and undo puts the edited copy back', async (t) => {
  const { service, api } = makeService(t);
  const { file, edited } = editWorkflow(service.workspace());
  await api['oracle:requestAgent']({ to: 'supervisor', kind: 'workflow.restore', params: { file: 'issue-tracker.yaml' }, reason: 'broken edit', mock: true });
  const card = ofKind(await api['supervisor:chatHistory'](), 'workflow.restore')[0];
  assert.equal(fs.readFileSync(file, 'utf8'), edited, 'nothing before the click');

  const done = await api['supervisor:requestAct']({ ref: card.request.ref, action: 'do', mock: true });
  assert.equal(done.ok, true, JSON.stringify(done));
  assert.equal(fs.readFileSync(file, 'utf8'), fs.readFileSync(path.join(BUNDLED, 'workflows', 'issue-tracker.yaml'), 'utf8'));

  const undone = await api['supervisor:requestAct']({ ref: card.request.ref, action: 'undo', mock: true });
  assert.equal(undone.ok, true, JSON.stringify(undone));
  assert.equal(undone.text, 'Undone: issue-tracker.yaml is back to the edited copy.');
  assert.equal(fs.readFileSync(file, 'utf8'), edited);
});

test('supervisor:requestAct undo after a skill.restore puts the edited skill back', async (t) => {
  const { service, api } = makeService(t);
  const { file, edited } = editSkill(service.workspace());
  const out = await api['supervisor:request']({ kind: 'skill.restore', params: { id: 'oracle' }, reason: 'broken edit', from: 'oracle', ref: 'skill-undo', mock: true });
  assert.equal(out.ok, true, JSON.stringify(out));
  assert.equal(fs.readFileSync(file, 'utf8'), fs.readFileSync(path.join(BUNDLED, 'skills', 'oracle', 'SKILL.md'), 'utf8'));

  const undone = await api['supervisor:requestAct']({ ref: 'skill-undo', action: 'undo', mock: true });
  assert.equal(undone.ok, true, JSON.stringify(undone));
  assert.equal(undone.text, 'Undone: oracle is back to the edited copy.');
  assert.equal(fs.readFileSync(file, 'utf8'), edited);
});
