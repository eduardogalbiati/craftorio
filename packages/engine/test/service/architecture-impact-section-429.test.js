// #429: architecture:impact({ projectId, record }) (packages/engine/service/channels/architecture.js) keeps the
// record's `withSection` (the issue had a `## Expected files` section) on the history entry, so the
// hit rate can be compared with the section against without it.
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
  const folder = tmp(t, 'impact429-');
  fs.writeFileSync(path.join(folder, 'a.js'), '// a\n');
  const project = await api['projects:create']({ name: 'impact', folder });
  const file = path.join(service.workspace().root, 'architecture', project.id, 'impact-history.json');
  return { api, projectId: project.id, file };
}

const plain = (x) => JSON.parse(JSON.stringify(x));

test('#429 architecture:impact keeps withSection on the recorded entry, true and false', async (t) => {
  const { api, projectId, file } = await setup(t);
  await api['architecture:impact']({ projectId, record: { issue: 429, hitRate: 0.5, run: 'run-1', withSection: true } });
  const out = plain(await api['architecture:impact']({ projectId, record: { issue: 12, hitRate: 1, run: 'run-2', withSection: false } }));
  assert.equal(out.error, null);
  assert.deepEqual(out.history['429'].map((h) => [h.run, h.withSection]), [['run-1', true]]);
  assert.deepEqual(out.history['12'].map((h) => [h.run, h.withSection]), [['run-2', false]]);
  const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(saved['429'][0].withSection, true);
  assert.equal(saved['12'][0].withSection, false);
});
