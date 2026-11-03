// #633 (spec R9, D15): a project keeps the work model picked at onboarding. Acceptance tests, written
// before the code.
//
// The interface assumed here (packages/engine/domains/project/projects.js, required inside each test):
// - updateProject(dir, id, { workModel }) stores workModel when it is 'light', 'standard' or 'full'
//   (readProject(dir, id).workModel answers it);
// - any other value ('heavy', 42) is not stored: the previous value stays, or the field stays absent.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const load = () => require('../../domains/project/projects');

function tmpDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'projects-633-'));
  t.after(() => { try { fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }); } catch { /* a temp folder left behind */ } });
  return dir;
}

async function imported(t) {
  const dir = tmpDir(t);
  const p = await load().createProject(dir, { name: 'Shop', repo: 'https://github.com/acme/shop', folder: path.join(dir, 'shop') });
  return { dir, id: p.id };
}

for (const model of ['light', 'standard', 'full']) {
  test(`#633 updateProject keeps workModel ${model}`, async (t) => {
    const { dir, id } = await imported(t);
    load().updateProject(dir, id, { workModel: model });
    assert.equal(load().readProject(dir, id).workModel ?? null, model);
  });
}

test('#633 an unknown work model (heavy) is not stored over the previous one', async (t) => {
  const { dir, id } = await imported(t);
  load().updateProject(dir, id, { workModel: 'full' });
  load().updateProject(dir, id, { workModel: 'heavy' });
  assert.equal(load().readProject(dir, id).workModel ?? null, 'full');
});

test('#633 a work model that is no string (42) is not stored on a project without one', async (t) => {
  const { dir, id } = await imported(t);
  load().updateProject(dir, id, { workModel: 42 });
  assert.equal(load().readProject(dir, id).workModel ?? null, null);
});
