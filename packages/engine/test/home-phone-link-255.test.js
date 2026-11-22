// #255 Home's "What needs you" links a waiting gate to its phone page (#226): while Phone gates is on,
// runs:active gives each open gate its `phoneUrl` (the signed link of that gate); while it is off, no
// gate has one. Through the engine service (test/service/helpers.js) with a mock run at a gate.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { makeService, untilTrue } = require('./service/helpers');

const WORKFLOW = `apiVersion: craftorio/v1
kind: Workflow
metadata:
  name: fixture-home-phone
agents:
  a: { provider: claude, model: m, session: ephemeral }
steps:
  - id: work
    agent: a
    prompt: "do the work"
  - id: ship
    type: human_approval
    message: "Ship the change?"
`;

async function gatedRun(t) {
  const { service, api } = makeService(t);
  fs.writeFileSync(path.join(service.workspace().workflows, 'fixture-home-phone.yaml'), WORKFLOW);
  const { runId } = await api['run:start']({ file: 'fixture-home-phone.yaml', inputs: {}, mock: true });
  const gatesOf = () => api['runs:active']().find((r) => r.runId === runId)?.gates || [];
  await untilTrue(() => gatesOf().length === 1);
  return { api, runId, gatesOf };
}

test('runs:active gives a waiting gate no phone link while Phone gates is off (#255)', async (t) => {
  const { gatesOf } = await gatedRun(t);
  assert.equal('phoneUrl' in gatesOf()[0], false);
});

test('runs:active gives a waiting gate the link of its phone page while Phone gates is on (#226, #255)', async (t) => {
  const { api, runId, gatesOf } = await gatedRun(t);
  // (the page is stopped here, before makeService's cleanup removes the workspace)
  try {
    const state = await api['phonegates:configure']({ enabled: true });
    assert.equal(state.running, true);
    const [gate] = gatesOf();
    assert.equal(typeof gate.phoneUrl, 'string');
    const url = new URL(gate.phoneUrl);
    assert.equal(url.pathname, `/gates/${encodeURIComponent(runId)}/${encodeURIComponent(gate.approval_id)}`);
    assert.ok(url.searchParams.get('t'), 'the link is signed');
  } finally {
    await api['phonegates:configure']({ enabled: false });
  }
  assert.equal('phoneUrl' in gatesOf()[0], false, 'turned off: the link goes away');
});
