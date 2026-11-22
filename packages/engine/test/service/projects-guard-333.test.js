// #333: the project channels take a project id that is a file name in the projects folder. A
// '../../../..' id is refused with a 400 naming the project id before packages/engine/domains/project/projects.js joins it into a
// path: projects:remove deletes with rmSync({ force }), so the sweep's sentinels cannot see a
// traversal whose target does not exist; this test puts a victim file where it would land.
// Seams: the service channels projects:remove and projects:update.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { setupWorkspace } = require('../../domains/workspace/workspace');
const { createService } = require('../../service');

// A workspace at base/ws (projects in base/ws/projects) and a victim.json at base, where
// '../../victim' + '.json' lands from the projects folder.
function nestedService(t) {
  process.env.CRAFTORIO_SIMULATION_ONLY = '1';
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'projects-333-'));
  const service = createService({ host: { trashItem: async () => {}, appVersion: '9.9.9', isPackaged: false } });
  // the service closes its index before the folder goes (hooks run in the order they are added)
  t.after(() => service.shutdown());
  t.after(() => fs.rmSync(base, { recursive: true, force: true, maxRetries: 5 }));
  service.setWorkspace(setupWorkspace(path.join(base, 'ws'), { persist: false }));
  const victim = path.join(base, 'victim.json');
  fs.writeFileSync(victim, '{"id":"victim","name":"do not touch"}\n');
  assert.equal(path.resolve(service.workspace().projects, '../../victim.json'), victim, 'the fixture puts the victim where the id lands');
  return { api: service.api, victim };
}

async function refusal(fn) {
  try { await fn(); } catch (e) { return { status: e.status, message: String(e.message) }; }
  return null;
}

test('#333 projects:remove refuses a project id that leaves the projects folder, with a 400 naming it, and deletes nothing', async (t) => {
  const { api, victim } = nestedService(t);
  for (const id of ['../../victim', '..\\..\\victim', path.join(path.dirname(victim), 'victim')]) {
    const r = await refusal(() => api['projects:remove'](id));
    assert.equal(r?.status, 400, `${id}: refused with a 400`);
    assert.match(r.message, /project id/, `${id}: the message names the project id`);
    assert.equal(fs.existsSync(victim), true, `${id}: the file outside the projects folder was deleted`);
  }
});

test('#333 projects:update refuses a project id that leaves the projects folder and leaves the file as it was', async (t) => {
  const { api, victim } = nestedService(t);
  const before = fs.readFileSync(victim, 'utf8');
  const r = await refusal(() => api['projects:update']({ id: '../../victim', patch: { name: 'changed' } }));
  assert.equal(r?.status, 400);
  assert.match(r.message, /project id/);
  assert.equal(fs.readFileSync(victim, 'utf8'), before);
});

test('#333 projects:remove still removes a project by its id', async (t) => {
  const { api } = nestedService(t);
  const created = await api['projects:create']({ name: 'Kept apart' });
  assert.equal((await api['projects:list']()).some((p) => p.id === created.id), true);
  await api['projects:remove'](created.id);
  assert.equal((await api['projects:list']()).some((p) => p.id === created.id), false);
});
