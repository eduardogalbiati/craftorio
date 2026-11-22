// packages/engine/service/channels/nightwatch.js: the owner's Night watch checklist (#239). The channel is called
// the way window.api calls it (apps/desktop/host/preload.js, apps/web/renderer/api-http.js): the method's positional
// arguments become the channel's one argument through the manifest's `params`, so these tests hold
// whatever shape `params` takes. Save with a list keeps exactly that list; anything that is not a
// list is refused and the saved file is left as it was (#239: Save cleared every permission).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const night = require('@craftorio/engine/domains/night/night-watch');
const { makeService } = require('@craftorio/engine/test/service/helpers');

// The same mapping as apps/desktop/host/preload.js payload(): positional arguments -> the channel's argument.
function payload(params, args) {
  if (!params) return undefined;
  if (typeof params === 'string') return args[0];
  const out = {};
  params.forEach((name, i) => {
    if (name.startsWith('...')) Object.assign(out, args[i]);
    else out[name] = args[i];
  });
  return out;
}

// window.api over the service: { [method]: async (...args) => result }
function windowApi(service) {
  const api = {};
  for (const e of service.manifest) {
    if (e.channel && e.method && service.api[e.channel]) api[e.method] = async (...args) => service.api[e.channel](payload(e.params, args));
  }
  return api;
}

function setup(t) {
  const { service } = makeService(t);
  const ws = service.workspace();
  const dir = ws.oracle || path.join(ws.root, 'oracle');
  return { api: windowApi(service), dir, file: path.join(dir, 'night-permissions.json') };
}

test('saveNightWatchPermissions(list): the file lists exactly those ids in catalog order, and nightwatch:state returns them', async (t) => {
  const { api, file } = setup(t);
  const out = await api.saveNightWatchPermissions(['regroup', 'skip', 'retry']);
  const want = night.PERMISSIONS.map((p) => p.id).filter((id) => ['regroup', 'skip', 'retry'].includes(id));
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')).allowed, want);
  assert.deepEqual([...out.permissions.allowed], want);
  const state = await api.nightWatchState();
  assert.deepEqual([...state.permissions.allowed], want);
  assert.equal(state.permissions.defaults, false);
});

test('saveNightWatchPermissions({ allowed: [...] }): an object instead of a list is refused and the saved file is unchanged', async (t) => {
  const { api, dir, file } = setup(t);
  night.savePermissions(dir, ['skip', 'refresh']);
  const before = fs.readFileSync(file);
  await assert.rejects(api.saveNightWatchPermissions({ allowed: ['retry', 'skip'] }));
  assert.deepEqual(fs.readFileSync(file), before);
  assert.deepEqual([...(await api.nightWatchState()).permissions.allowed], ['skip', 'refresh']);
});

test('saveNightWatchPermissions([]): an explicit empty list is saved (nothing allowed)', async (t) => {
  const { api, file } = setup(t);
  await api.saveNightWatchPermissions([]);
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')).allowed, []);
  assert.deepEqual([...(await api.nightWatchState()).permissions.allowed], []);
});

test('saveNightWatchPermissions: a never-allowed or unknown id is refused and nothing is written', async (t) => {
  const { api, file } = setup(t);
  await assert.rejects(api.saveNightWatchPermissions(['retry', 'answer-gate']), /never allowed/);
  await assert.rejects(api.saveNightWatchPermissions(['retry', 'format-disk']), /Unknown permission: format-disk/);
  assert.equal(fs.existsSync(file), false);
});
