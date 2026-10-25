// #374: the channel architecture:agents({ projectId }) (src/service/channels/architecture.js, method
// architectureAgents) reads the runs in progress of a project for its city and never starts one:
// → { projectId, runs: [{ id, colour, agents: [lastTouches entries], trail: [paths], dirty: [paths] }],
//     collisions: [{ path, runs }] } (packages/shared/city-agents.js does the reading). It declares
// schema.params and schema.result (#338) and refuses a missing, invalid or unknown projectId like
// architecture:city. A project with no run in progress → runs: [], collisions: [].
// The channel is created by the change: each test calls it through the service (tests first).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { makeService } = require('./helpers');

function tmp(t, prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3 }));
  return dir;
}

async function setup(t) {
  const { service, api } = makeService(t);
  const folder = tmp(t, 'agents374-');
  fs.writeFileSync(path.join(folder, 'a.js'), '// a\n');
  const project = await api['projects:create']({ name: 'agents', folder });
  return { service, api, projectId: project.id };
}

test('#374 architecture:agents is served with schema.params and schema.result', (t) => {
  const { service, api } = makeService(t);
  const entry = service.manifest.find((e) => e.channel === 'architecture:agents');
  assert.ok(entry, 'architecture:agents is in the manifest');
  assert.equal(entry.method, 'architectureAgents');
  assert.ok(entry.schema && entry.schema.params && entry.schema.result, 'it declares params and result');
  assert.equal(typeof api['architecture:agents'], 'function');
});

test('#374 architecture:agents: a project with no run in progress has no agent on its city', async (t) => {
  const { api, projectId } = await setup(t);
  assert.equal(typeof api['architecture:agents'], 'function', 'architecture:agents is a channel of the service');
  const out = await api['architecture:agents']({ projectId });
  assert.deepEqual(JSON.parse(JSON.stringify(out)), { projectId, runs: [], collisions: [] });
});

test('#374 architecture:agents never starts a run', async (t) => {
  const { api, projectId } = await setup(t);
  assert.equal(typeof api['architecture:agents'], 'function', 'architecture:agents is a channel of the service');
  const before = JSON.stringify(await api['runs:list']({}));
  await api['architecture:agents']({ projectId });
  await api['architecture:agents']({ projectId });
  assert.equal(JSON.stringify(await api['runs:list']({})), before);
});

test('#374 architecture:agents refuses a missing, invalid or unknown projectId', async (t) => {
  const { api } = makeService(t);
  assert.equal(typeof api['architecture:agents'], 'function', 'architecture:agents is a channel of the service');
  await assert.rejects(() => api['architecture:agents']({}));
  await assert.rejects(() => api['architecture:agents']({ projectId: 42 }));
  await assert.rejects(() => api['architecture:agents']({ projectId: 'no-such-project' }), /Unknown project/);
});
