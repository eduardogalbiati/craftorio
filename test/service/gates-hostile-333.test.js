// #333: hostile input never crosses a human gate (hard rule: automation never crosses a
// human_approval). approval:resolve with hostile values leaves the gate open; runs:resume with a
// hostile confirmGate never resumes past a gate on the previous run's decision.
// Seams: the service channels (approval:resolve, runs:resume, runs:active) and the run events.
const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('os');
const path = require('path');
const { makeResumeService, untilTrue } = require('./helpers');

const MB = 'x'.repeat(1024 * 1024);
const outsideAbs = path.join(os.tmpdir(), 'outside-333');
const proto = () => JSON.parse('{"__proto__": {"polluted": "yes"}}');
// The hostile values of the sweep: missing, null, wrong types, empty, a path out, an absolute path
// outside the workspace, a 1 MB string and an object with a __proto__ key.
const HOSTILE = {
  missing: undefined,
  null: null,
  number: 42,
  array: ['approve'],
  object: { id: 'approve', answer: true },
  'empty string': '',
  'parent path': '../../outside',
  'absolute path': outsideAbs,
  '1 MB string': MB,
  '__proto__ object': proto(),
};

// Calls a channel and swallows its refusal (a refusal is fine: only the gate's state matters here).
async function call(fn) {
  try { await fn(); } catch { /* refused */ }
}

// Starts fixture-resume.yaml in mock mode and resolves when it waits at its gate (left open).
function startToGate(service, api) {
  return new Promise((resolve, reject) => {
    const onEv = (ev) => {
      if (ev.type === 'approval.requested') { service.events.off('run:event', onEv); resolve(ev); }
    };
    service.events.on('run:event', onEv);
    api['run:start']({ file: 'fixture-resume.yaml', inputs: {}, mock: true }).catch(reject);
  });
}

// Runs fixture-resume.yaml to its end, answering its gate with `answer`.
function runToGateDecision(service, api, answer) {
  const finished = new Promise((resolve) => {
    const onEvent = (ev) => {
      if (ev.type === 'approval.requested') setImmediate(() => api['approval:resolve']({ id: ev.approval_id, answer }));
      if (ev.type === 'workflow.finished') { service.events.off('run:event', onEvent); resolve(ev); }
    };
    service.events.on('run:event', onEvent);
  });
  return api['run:start']({ file: 'fixture-resume.yaml', inputs: {}, mock: true }).then(async (started) => ({ ...started, end: await finished }));
}

test('#333 approval:resolve with hostile input never resolves a gate', async (t) => {
  const { service, api } = makeResumeService(t);
  const resolved = [];
  service.events.on('run:event', (ev) => { if (ev.type === 'approval.resolved') resolved.push(ev.approval_id); });
  const gate = await startToGate(service, api);
  const runId = gate.run_id;
  const approvalId = gate.approval_id;
  const stillOpen = () => api['runs:active']().some((r) => r.runId === runId && (r.gates || []).some((g) => g.approval_id === approvalId));
  assert.equal(stillOpen(), true, 'the fixture waits at its gate');

  const tries = [];
  // each parameter hostile on its own, the others missing
  for (const param of ['id', 'answer', 'feedback', 'runId', 'intent', 'images']) {
    for (const [label, value] of Object.entries(HOSTILE)) tries.push([`${param} ${label}`, { [param]: value }]);
  }
  // the right gate, a hostile answer (with and without the run id)
  for (const [label, value] of Object.entries(HOSTILE)) {
    tries.push([`right gate, answer ${label}`, { runId, id: approvalId, answer: value }]);
    tries.push([`right gate id only, answer ${label}`, { id: approvalId, answer: value }]);
  }
  // an approval for the right gate id under a hostile run id
  for (const [label, value] of Object.entries(HOSTILE)) {
    if (value === undefined) continue; // no run id: the only run waiting on that id, a legitimate call
    tries.push([`runId ${label}, approve`, { runId: value, id: approvalId, answer: true }]);
  }
  // a hostile whole argument
  for (const [label, value] of Object.entries(HOSTILE)) tries.push([`whole argument ${label}`, value]);

  for (const [label, arg] of tries) {
    await call(() => api['approval:resolve'](arg));
    assert.equal(stillOpen(), true, `${label}: the gate was resolved`);
  }
  await new Promise((r) => setTimeout(r, 200));
  assert.equal(stillOpen(), true, 'the gate is still open after the hostile calls');
  assert.deepEqual(resolved, [], 'no approval.resolved event');
  assert.equal({}.polluted, undefined, 'no prototype pollution');

  // the owner's real answer still works
  api['approval:resolve']({ runId, id: approvalId, answer: true });
  await untilTrue(() => !api['runs:active']().some((r) => r.runId === runId));
  assert.deepEqual(resolved, [approvalId]);
});

test('#333 runs:resume with a hostile confirmGate never resumes past a gate', async (t) => {
  const { service, api } = makeResumeService(t);
  const approved = await runToGateDecision(service, api, true);
  assert.equal(approved.end.status, 'success');
  const started = [];
  service.events.on('run:event', (ev) => { if (ev.type === 'workflow.started') started.push(ev.run_id); });

  for (const [label, value] of Object.entries(HOSTILE)) {
    let refused = false;
    try { await api['runs:resume']({ runId: approved.runId, step: 'work', confirmGate: value, mock: true }); } catch (e) {
      refused = e instanceof Error;
    }
    assert.equal(refused, true, `confirmGate ${label}: the resume past the gate "approve" was not refused`);
  }
  await new Promise((r) => setTimeout(r, 200));
  assert.deepEqual(started, [], 'no resumed run started');
  assert.deepEqual(api['runs:active']().map((r) => r.runId), []);
  assert.equal({}.polluted, undefined, 'no prototype pollution');
});
