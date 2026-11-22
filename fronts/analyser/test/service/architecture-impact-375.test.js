// #375: the channel architecture:impact({ projectId, record? }) (fronts/analyser/engine/channels/architecture.js,
// method architectureImpact) gives the city impact preview what it reads without a model call: the
// project's city plan and the hit rates kept per issue, in <workspace>/architecture/<project id>/
// impact-history.json → { plan, history: { [issue]: [{ hitRate, ts, run }] }, error }. `record`
// ({ issue, hitRate, run }) keeps one entry per run; an unreadable history is reported and never
// overwritten.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { makeService } = require('@craftorio/engine/test/service/helpers');

function tmp(t, prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3 }));
  return dir;
}

async function setup(t) {
  const { service, api } = makeService(t);
  const folder = tmp(t, 'impact375-');
  fs.writeFileSync(path.join(folder, 'a.js'), '// a\n');
  const project = await api['projects:create']({ name: 'impact', folder });
  const file = path.join(service.workspace().root, 'architecture', project.id, 'impact-history.json');
  return { service, api, projectId: project.id, file };
}

const plain = (x) => JSON.parse(JSON.stringify(x));

test('#375 architecture:impact is served with schema.params and schema.result', (t) => {
  const { service, api } = makeService(t);
  const entry = service.manifest.find((e) => e.channel === 'architecture:impact');
  assert.ok(entry, 'architecture:impact is in the manifest');
  assert.equal(entry.method, 'architectureImpact');
  assert.ok(entry.schema && entry.schema.params && entry.schema.result, 'it declares params and result');
  assert.equal(typeof api['architecture:impact'], 'function');
});

test('#375 architecture:impact without a history file: no plan, an empty history, no error, nothing written', async (t) => {
  const { api, projectId, file } = await setup(t);
  const out = plain(await api['architecture:impact']({ projectId }));
  assert.deepEqual(out, { plan: null, history: {}, error: null });
  assert.equal(fs.existsSync(file), false);
});

test('#375 architecture:impact record keeps the hit rate per issue, one entry per run', async (t) => {
  const { api, projectId, file } = await setup(t);
  const first = plain(await api['architecture:impact']({ projectId, record: { issue: 375, hitRate: 0.5, run: 'run-1' } }));
  assert.equal(first.error, null);
  assert.deepEqual(first.history['375'].map((h) => [h.run, h.hitRate]), [['run-1', 0.5]]);
  assert.match(first.history['375'][0].ts, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(fs.existsSync(file), true);
  assert.deepEqual(Object.keys(JSON.parse(fs.readFileSync(file, 'utf8'))), ['375']);

  // the same run again replaces its entry; another run and another issue are added
  await api['architecture:impact']({ projectId, record: { issue: 375, hitRate: 0.75, run: 'run-1' } });
  await api['architecture:impact']({ projectId, record: { issue: 375, hitRate: 1, run: 'run-2' } });
  await api['architecture:impact']({ projectId, record: { issue: 12, hitRate: 0, run: 'run-3' } });
  const read = plain(await api['architecture:impact']({ projectId }));
  assert.deepEqual(read.history['375'].map((h) => [h.run, h.hitRate]), [['run-1', 0.75], ['run-2', 1]]);
  assert.deepEqual(read.history['12'].map((h) => [h.run, h.hitRate]), [['run-3', 0]]);
});

test('#375 architecture:impact with a corrupt history: an error naming the file, an empty history, the file left untouched', async (t) => {
  const { api, projectId, file } = await setup(t);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, '{"375": [{"hitRate": 0.5, "ts"');
  t.mock.method(console, 'error', () => {});
  const out = plain(await api['architecture:impact']({ projectId }));
  assert.deepEqual(out.history, {});
  assert.match(String(out.error), /impact-history\.json/);
  const recorded = plain(await api['architecture:impact']({ projectId, record: { issue: 375, hitRate: 1, run: 'run-9' } }));
  assert.deepEqual(recorded.history, {});
  assert.match(String(recorded.error), /impact-history\.json/);
  assert.equal(fs.readFileSync(file, 'utf8'), '{"375": [{"hitRate": 0.5, "ts"');
});

test('#375 architecture:impact refuses a missing, invalid or unknown project, and an invalid record', async (t) => {
  const { api, projectId } = await setup(t);
  // a schema refusal may throw before any promise: each call runs inside an async function
  const call = (arg) => async () => api['architecture:impact'](arg);
  await assert.rejects(call({}), /projectId/);
  await assert.rejects(call({ projectId: 42 }), /projectId/);
  await assert.rejects(call({ projectId: 'no-such-project' }), /Unknown project/);
  await assert.rejects(call({ projectId, record: { issue: 375, hitRate: 2, run: 'run-1' } }), /hitRate/);
  await assert.rejects(call({ projectId, record: { issue: 375, hitRate: 0.5 } }), /run/);
});
