// #742: removing a project can delete its folder too. Acceptance tests, written before the code.
// Seam: the service channel projects:remove (the real service on a scratch workspace, real git repositories
// in temp folders; the system trash is the host's trashItem, faked here as a delete, so the tests only check
// that the folder is gone from its path).
//
// API assumed (implement these names):
// - projects:remove takes { id, deleteFolder, confirmed, confirmName } (and still takes a bare id: the record only).
//   - deleteFolder false / missing: the record goes, the folder stays.
//   - deleteFolder true, the folder a clone under <workspace>/repos/: deleted (or moved to the trash).
//   - a folder with uncommitted changes (git status --porcelain) or local commits ahead of its upstream: nothing
//     is removed; it resolves { needsConfirm: true, dirty: [<paths>], unpushed: [<commits>] }; the same call
//     with confirmed: true then deletes it.
//   - a project with a running run: refused (a rejection or a result) naming the run's id; nothing removed.
//   - a folder outside <workspace>/repos/: deleted only with confirmName equal to the project's name; without
//     it (or with another name) the folder stays and it resolves { needsName: true, ... }.
//   - removing one project never touches another one (its record, its folder).
//   - the project's data goes (its roadmap <workspace>/backlog/<id>.json, its architecture folder, its onboarding
//     state); the runs' history (<workspace>/runs/<runId>) stays.
// - projects.removeProject(dir, id, { deleteFolder, confirmed, confirmName, ... }) in
//   packages/engine/domains/project/projects.js may carry the folder part; these tests only use the channel.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { makeService, untilTrue } = require('./helpers');
const arch = require('../../domains/oracle/oracle-architecture');

// a workflow linked to a project through its repo_path, waiting at a gate (a run that keeps running)
const HOLD_WORKFLOW = `apiVersion: craftorio/v1
kind: Workflow
metadata:
  name: remove-hold
inputs:
  repo_path: { type: string, required: true }
agents:
  a: { provider: claude, model: m, session: ephemeral }
steps:
  - id: hold
    type: human_approval
    message: "Hold"
`;

function tmp(t, prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }));
  return dir;
}

// git with no config of this machine and a fixed identity
function gitIn(t) {
  const cfgDir = tmp(t, 'remove-742-gitcfg-');
  const cfg = path.join(cfgDir, 'config');
  fs.writeFileSync(cfg, '');
  const env = { ...Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^GIT_/i.test(k))), GIT_CONFIG_GLOBAL: cfg, GIT_CONFIG_NOSYSTEM: '1' };
  return (cwd, ...args) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'init.defaultBranch=main', '-c', 'core.autocrlf=false', ...args], { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim();
}

// a clean clone at `folder` of a bare upstream, one commit pushed (main tracks origin/main)
function cleanClone(t, folder) {
  const git = gitIn(t);
  const upstream = path.join(tmp(t, 'remove-742-upstream-'), 'origin.git');
  fs.mkdirSync(path.dirname(folder), { recursive: true });
  git(path.dirname(upstream), 'init', '-q', '--bare', upstream);
  git(path.dirname(folder), 'clone', '-q', upstream, folder);
  fs.writeFileSync(path.join(folder, 'README.md'), '# widgets\n');
  git(folder, 'add', '.');
  git(folder, 'commit', '-q', '-m', 'first');
  git(folder, 'push', '-q', '-u', 'origin', 'main');
  return { git: (...args) => git(folder, ...args), folder };
}

function service(t) {
  // the system trash: a delete here (the tests never depend on a real trash)
  const { service: svc, api } = makeService(t, { trashItem: async (p) => { fs.rmSync(p, { recursive: true, force: true }); } });
  return { svc, api, ws: svc.workspace() };
}

// a project whose folder is a clean clone under <workspace>/repos/<dir>
async function repoProject(t, api, ws, name = 'Widgets', dir = 'acme-widgets') {
  const repo = cleanClone(t, path.join(ws.repos, dir));
  const p = await api['projects:create']({ name, folder: repo.folder });
  return { ...repo, id: p.id, name };
}

const ids = async (api) => (await api['projects:list']()).map((p) => p.id);

// the error or the result of a call, as text (a refusal may be either)
async function outcome(fn) {
  try { return JSON.stringify(await fn()); } catch (e) { return String(e?.message || e); }
}

// ---- with and without the folder -------------------------------------------------------------------

test('#742 projects:remove (a bare id, the old form) removes the record and keeps the folder', async (t) => {
  const { api, ws } = service(t);
  const p = await repoProject(t, api, ws);
  await api['projects:remove'](p.id);
  assert.deepEqual(await ids(api), []);
  assert.equal(fs.existsSync(p.folder), true);
});

test('#742 projects:remove { id, deleteFolder: false } removes the record and keeps the folder', async (t) => {
  const { api, ws } = service(t);
  const p = await repoProject(t, api, ws);
  await api['projects:remove']({ id: p.id, deleteFolder: false });
  assert.deepEqual(await ids(api), []);
  assert.equal(fs.existsSync(p.folder), true);
});

test('#742 projects:remove { id, deleteFolder: true } deletes a clean clone under <workspace>/repos/ and the record', async (t) => {
  const { api, ws } = service(t);
  const p = await repoProject(t, api, ws);
  await api['projects:remove']({ id: p.id, deleteFolder: true });
  assert.deepEqual(await ids(api), []);
  assert.equal(fs.existsSync(p.folder), false);
});

// ---- uncommitted changes and unpushed commits ------------------------------------------------------

test('#742 a folder with uncommitted changes asks for a second confirmation, listing them, and nothing is removed', async (t) => {
  const { api, ws } = service(t);
  const p = await repoProject(t, api, ws);
  fs.writeFileSync(path.join(p.folder, 'notes.txt'), 'mine\n');
  const out = await api['projects:remove']({ id: p.id, deleteFolder: true });
  assert.equal(out?.needsConfirm, true);
  assert.equal((out?.dirty || []).some((d) => JSON.stringify(d).includes('notes.txt')), true, `dirty: ${JSON.stringify(out?.dirty)}`);
  assert.equal(fs.existsSync(path.join(p.folder, 'notes.txt')), true);
  assert.deepEqual(await ids(api), [p.id]);
});

test('#742 a folder with a local commit ahead of its upstream asks for a second confirmation, listing it, and nothing is removed', async (t) => {
  const { api, ws } = service(t);
  const p = await repoProject(t, api, ws);
  fs.writeFileSync(path.join(p.folder, 'work.txt'), 'local work\n');
  p.git('add', '.');
  p.git('commit', '-q', '-m', 'local work');
  const out = await api['projects:remove']({ id: p.id, deleteFolder: true });
  assert.equal(out?.needsConfirm, true);
  assert.equal(out?.unpushed?.length, 1, `unpushed: ${JSON.stringify(out?.unpushed)}`);
  assert.equal(fs.existsSync(p.folder), true);
  assert.deepEqual(await ids(api), [p.id]);
});

test('#742 confirmed: true deletes a folder with uncommitted changes', async (t) => {
  const { api, ws } = service(t);
  const p = await repoProject(t, api, ws);
  fs.writeFileSync(path.join(p.folder, 'notes.txt'), 'mine\n');
  await api['projects:remove']({ id: p.id, deleteFolder: true, confirmed: true });
  assert.equal(fs.existsSync(p.folder), false);
  assert.deepEqual(await ids(api), []);
});

// ---- a running run ---------------------------------------------------------------------------------

test('#742 a project with a running run is refused with the run\'s id; its record and folder stay', async (t) => {
  const { api, ws } = service(t);
  const p = await repoProject(t, api, ws);
  fs.writeFileSync(path.join(ws.workflows, 'remove-hold.yaml'), HOLD_WORKFLOW);
  const { runId } = await api['run:start']({ file: 'remove-hold.yaml', inputs: { repo_path: p.folder }, mock: true });
  t.after(async () => {
    try { api['run:stop']({ runId }); } catch { /* already ended */ }
    await untilTrue(() => !api['runs:active']().some((r) => r.runId === runId));
  });
  await untilTrue(() => api['runs:active']().some((r) => r.runId === runId && r.waiting > 0));
  assert.equal(api['runs:active']().find((r) => r.runId === runId)?.projectId, p.id, 'the run belongs to the project');
  const said = await outcome(() => api['projects:remove']({ id: p.id, deleteFolder: true, confirmed: true }));
  assert.equal(said.includes(runId), true, `the refusal names the run: ${said}`);
  assert.equal(fs.existsSync(p.folder), true);
  assert.deepEqual(await ids(api), [p.id]);
});

// ---- a folder outside repos/ -----------------------------------------------------------------------

test('#742 a folder outside <workspace>/repos/ is kept without confirmName: the answer asks for the name', async (t) => {
  const { api } = service(t);
  const repo = cleanClone(t, path.join(tmp(t, 'remove-742-outside-'), 'mine'));
  const p = await api['projects:create']({ name: 'Outside', folder: repo.folder });
  const out = await api['projects:remove']({ id: p.id, deleteFolder: true, confirmed: true });
  assert.equal(out?.needsName, true, `the answer: ${JSON.stringify(out)}`);
  assert.equal(fs.existsSync(repo.folder), true);
});

test('#742 a folder outside <workspace>/repos/ is kept when confirmName is not the project\'s name: the answer asks for the name', async (t) => {
  const { api } = service(t);
  const repo = cleanClone(t, path.join(tmp(t, 'remove-742-outside-'), 'mine'));
  const p = await api['projects:create']({ name: 'Outside', folder: repo.folder });
  const out = await api['projects:remove']({ id: p.id, deleteFolder: true, confirmed: true, confirmName: 'Other' });
  assert.equal(out?.needsName, true, `the answer: ${JSON.stringify(out)}`);
  assert.equal(fs.existsSync(repo.folder), true);
});

test('#742 a folder outside <workspace>/repos/ is deleted with confirmName equal to the project\'s name', async (t) => {
  const { api } = service(t);
  const repo = cleanClone(t, path.join(tmp(t, 'remove-742-outside-'), 'mine'));
  const p = await api['projects:create']({ name: 'Outside', folder: repo.folder });
  await api['projects:remove']({ id: p.id, deleteFolder: true, confirmName: 'Outside' });
  assert.equal(fs.existsSync(repo.folder), false);
  assert.deepEqual(await ids(api), []);
});

// ---- other projects and the project's data ---------------------------------------------------------

test('#742 removing a project with its folder leaves another project\'s record and folder', async (t) => {
  const { api, ws } = service(t);
  const gone = await repoProject(t, api, ws, 'Widgets', 'acme-widgets');
  const kept = await repoProject(t, api, ws, 'Gadgets', 'acme-gadgets');
  await api['projects:remove']({ id: gone.id, deleteFolder: true });
  assert.deepEqual(await ids(api), [kept.id]);
  assert.equal(fs.existsSync(path.join(kept.folder, 'README.md')), true);
  assert.equal(fs.existsSync(gone.folder), false);
});

test('#742 the removed project\'s roadmap and architecture data go; another project\'s stay', async (t) => {
  const { api, ws } = service(t);
  const gone = await repoProject(t, api, ws, 'Widgets', 'acme-widgets');
  const kept = await repoProject(t, api, ws, 'Gadgets', 'acme-gadgets');
  const archRoot = path.join(ws.root, 'architecture');
  fs.mkdirSync(ws.backlog, { recursive: true });
  for (const p of [gone, kept]) {
    fs.writeFileSync(path.join(ws.backlog, `${p.id}.json`), JSON.stringify({ projectId: p.id, platform: 'github', repo: 'https://github.com/o/r', issues: [] }));
    arch.writeSettings(archRoot, p.id, { exclude: ['dist'] });
  }
  await api['projects:remove']({ id: gone.id, deleteFolder: true });
  assert.deepEqual(
    [fs.existsSync(path.join(ws.backlog, `${gone.id}.json`)), arch.readSettings(archRoot, gone.id).exclude],
    [false, []],
  );
  assert.deepEqual(
    [fs.existsSync(path.join(ws.backlog, `${kept.id}.json`)), arch.readSettings(archRoot, kept.id).exclude],
    [true, ['dist']],
  );
});

test('#742 the removed project\'s onboarding state goes', async (t) => {
  const { api } = service(t);
  const s = await api['onboarding:create']({ name: 'Field Notes', starts: 'empty', remote: null, answers: { mode: 'local', ci: 'release', release: 'milestone' } });
  assert.equal((await api['onboarding:status']({ projectId: s.projectId })).projectId, s.projectId, 'the onboarding state is there before');
  // its folder is <workspace>/projects/field-notes, outside repos/: its name confirms the deletion
  await api['projects:remove']({ id: s.projectId, deleteFolder: true, confirmName: 'Field Notes' });
  const after = await outcome(() => api['onboarding:status']({ projectId: s.projectId }));
  assert.match(after, /No onboarding/);
});

test('#742 the runs\' history of a removed project stays', async (t) => {
  const { api, ws } = service(t);
  const p = await repoProject(t, api, ws);
  fs.writeFileSync(path.join(ws.workflows, 'remove-hold.yaml'), HOLD_WORKFLOW);
  const { runId } = await api['run:start']({ file: 'remove-hold.yaml', inputs: { repo_path: p.folder }, mock: true });
  await untilTrue(() => api['runs:active']().some((r) => r.runId === runId && r.waiting > 0));
  api['run:stop']({ runId });
  await untilTrue(() => !api['runs:active']().some((r) => r.runId === runId));
  assert.equal(fs.existsSync(path.join(ws.runs, runId)), true, 'the run has its folder before');
  await api['projects:remove']({ id: p.id, deleteFolder: true });
  assert.equal(fs.existsSync(p.folder), false, 'the project\'s folder went');
  assert.equal(fs.existsSync(path.join(ws.runs, runId)), true, 'the run\'s history stayed');
});
