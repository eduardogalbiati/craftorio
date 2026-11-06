// #790: on upgrade, a project with no default of its own takes the old settings.defaultWorkflow, once,
// unless its repository's manifest declares a default. Acceptance tests, written before the code.
// Seam: opening a workspace, as the app does (setupWorkspace, then service.setWorkspace, where #446's
// one-time move of the leftover queues runs too), on a folder an older version left: settings.json and
// projects/<id>.json written by hand. Whichever of the two runs the migration, these hold.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createService } = require('../../service');
const workspace = require('../../domains/workspace/workspace');

const bare = (v) => String(v ?? '').replace(/\.ya?ml$/i, '');
const MANIFEST = 'version: 1\ndefault: hero\nworkflows:\n  - name: hero\n    category: solo\n';

// A workspace of an older version. open() opens it as a new start of the app; everything is shut and
// removed at the end of the test, the services first.
function oldWorkspace(t, { setting = 'legacy-flow.yaml' } = {}) {
  process.env.MULTIAGENT_SIMULATION_ONLY = '1';
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'migration-790-'));
  const cliHome = fs.mkdtempSync(path.join(os.tmpdir(), 'migration-790-home-'));
  const folders = [];
  let service = null;
  t.after(() => {
    service?.shutdown();
    for (const d of [dir, cliHome, ...folders]) fs.rmSync(d, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });
  fs.mkdirSync(path.join(dir, 'projects'));
  fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify({ setupDone: true, defaultWorkflow: setting }));
  const file = (id) => path.join(dir, 'projects', `${id}.json`);
  return {
    addProject(id, { manifest = null, ...fields } = {}) {
      const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'migration-790-project-'));
      folders.push(folder);
      if (manifest) {
        fs.mkdirSync(path.join(folder, '.multiagent'));
        fs.writeFileSync(path.join(folder, '.multiagent', 'project.yaml'), manifest);
      }
      fs.writeFileSync(file(id), JSON.stringify({ name: id, description: '', folder, repo: null, status: 'ready', createdAt: '2026-10-01T00:00:00.000Z', ...fields }));
    },
    defaultOf: (id) => bare(JSON.parse(fs.readFileSync(file(id), 'utf8')).defaultWorkflow),
    open() {
      service?.shutdown();
      service = createService({ host: { trashItem: async () => {}, appVersion: '9.9.9', isPackaged: false, cliHome } });
      service.setWorkspace(workspace.setupWorkspace(dir, { persist: false }));
      return service.api;
    },
  };
}

test('#790 a project with no default takes the setting\'s value', (t) => {
  const ws = oldWorkspace(t);
  ws.addProject('plain');
  ws.open();
  assert.equal(ws.defaultOf('plain'), 'legacy-flow');
});

test('#790 a project that has a default keeps it', (t) => {
  const ws = oldWorkspace(t);
  ws.addProject('own', { defaultWorkflow: 'mine' });
  ws.open();
  assert.equal(ws.defaultOf('own'), 'mine');
});

test('#790 a project whose manifest declares a default does not take the setting\'s', (t) => {
  const ws = oldWorkspace(t);
  ws.addProject('declared', { manifest: MANIFEST });
  ws.open();
  assert.equal(ws.defaultOf('declared'), '');
});

test('#790 an empty setting gives no project a default', (t) => {
  const ws = oldWorkspace(t, { setting: '' });
  ws.addProject('plain');
  ws.open();
  assert.equal(ws.defaultOf('plain'), '');
});

test('#790 a default cleared after the migration does not come back at the next start', async (t) => {
  const ws = oldWorkspace(t);
  ws.addProject('plain');
  const api = ws.open();
  await api['projects:update']({ id: 'plain', patch: { defaultWorkflow: null } });
  ws.open();
  assert.equal(ws.defaultOf('plain'), '');
});

test('#790 a project added after the migration does not take the setting\'s value at the next start', (t) => {
  const ws = oldWorkspace(t);
  ws.open();
  ws.addProject('later');
  ws.open();
  assert.equal(ws.defaultOf('later'), '');
});

test('#790 defaultWorkflow is no longer a setting', () => {
  assert.equal('defaultWorkflow' in workspace.DEFAULT_SETTINGS, false);
});
