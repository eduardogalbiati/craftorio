// #799: an outside session resumes a run as the owner set it up: runs:resume with `inputs` is refused
// on the control channel (GUARDS in packages/engine/control/index.js), before the channel runs.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { createControlChannel } = require('../control');
const { makeResumeService } = require('./service/helpers');

async function post(t, service, channel, arg) {
  const control = createControlChannel({ service });
  t.after(() => control.stop());
  service.api['settings:set']({ controlChannel: true });
  await control.update();
  const { url, token } = JSON.parse(fs.readFileSync(path.join(service.workspace().root, 'control', 'endpoint.json'), 'utf8'));
  const res = await fetch(`${url}/api/${channel}`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ arg }) });
  return { status: res.status, body: await res.json() };
}

test('#799 runs:resume with inputs is refused for outside sessions, whatever the input', async (t) => {
  const { service } = makeResumeService(t);
  const res = await post(t, service, 'runs:resume', { runId: 'any-run', inputs: { validation: 'auto' } });
  assert.equal(res.status, 403);
  assert.match(res.body.error, /runs:resume: inputs is refused/);
});

test('#799 runs:resume with no inputs passes the guard and gets the channel\'s own answer', async (t) => {
  const { service } = makeResumeService(t);
  const res = await post(t, service, 'runs:resume', { runId: 'no-such-run' });
  assert.notEqual(res.status, 403);
});
