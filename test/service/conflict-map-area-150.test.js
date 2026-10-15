// #150: the conflict map rebuilt after a run merges (src/service/areas/conflict-map.js
// afterRunConflictMap): a real, successful run of a git project with a local merge or a PR writes
// <ws.backlog>/<projectId>.conflict-map.json; a simulated run, a failed run, a project that is not a git
// clone and a run without a merge leave it alone. savedConflictMap reads the saved map as it is.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const area = require('../../src/service/areas/conflict-map');

const git = (cwd, ...args) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'init.defaultBranch=main', '-c', 'core.autocrlf=false', ...args], { cwd, stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim();
function commit(cwd, file, text) {
  fs.writeFileSync(path.join(cwd, file), text);
  git(cwd, 'add', file);
  git(cwd, 'commit', '-q', '-m', file);
  return git(cwd, 'rev-parse', 'HEAD');
}

const FINISHED = { type: 'workflow.finished', status: 'success', ts: '2026-10-01T08:05:00.000Z' };

/**
 * A workspace with project p1 (a git clone, or a plain folder with `isGit: false`) and run r1 that
 * changed a.txt and b.txt between its worktree base and its local merge commit. `summary` overrides
 * the run's summary.json fields.
 */
function setup(t, { isGit = true, summary = {} } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cm-area150-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true, maxRetries: 3 }));
  const ws = { backlog: path.join(root, 'backlog'), runs: path.join(root, 'runs'), projects: path.join(root, 'projects') };
  for (const d of Object.values(ws)) fs.mkdirSync(d, { recursive: true });
  const repo = path.join(root, 'repo');
  fs.mkdirSync(repo);
  let base = null;
  let tip = null;
  if (isGit) {
    git(repo, 'init', '-q');
    base = commit(repo, 'init.txt', 'init\n');
    commit(repo, 'a.txt', 'a\n');
    tip = commit(repo, 'b.txt', 'b\n');
  }
  fs.writeFileSync(path.join(ws.projects, 'p1.json'), JSON.stringify({ name: 'demo', folder: repo }));
  const runDir = path.join(ws.runs, 'r1');
  fs.mkdirSync(runDir);
  fs.writeFileSync(path.join(runDir, 'events.jsonl'), [
    { type: 'workflow.started', ts: '2026-10-01T08:00:00.000Z', workflow: 'software-development', project_id: 'p1' },
    { type: 'worktree.ready', ts: '2026-10-01T08:00:01.000Z', commit: base },
  ].map((e) => JSON.stringify(e)).join('\n'));
  fs.writeFileSync(path.join(runDir, 'summary.json'), JSON.stringify({
    workflow: 'software-development', status: 'success', mock: false, project_id: 'p1',
    started_at: '2026-10-01T08:00:00.000Z', finished_at: '2026-10-01T08:05:00.000Z', sessions: [],
    local_merge: tip ? { branch: 'run/r1', base: 'main', commit: tip } : null,
    ...summary,
  }));
  const svc = area({ ws, active: new Map() });
  const mapFile = path.join(ws.backlog, 'p1.conflict-map.json');
  return { ws, svc, mapFile };
}

const runOf = (extra) => ({ runId: 'r1', projectId: 'p1', mock: false, ...extra });

test('afterRunConflictMap: a real run of a git project that merged locally saves the project\'s map with its files', async (t) => {
  const { svc, mapFile } = setup(t);
  await svc.afterRunConflictMap(runOf(), FINISHED);
  assert.equal(fs.existsSync(mapFile), true);
  const map = JSON.parse(fs.readFileSync(mapFile, 'utf8'));
  assert.deepEqual(map.files.map((f) => f.file).sort(), ['a.txt', 'b.txt']);
  assert.deepEqual(map.runIds, ['r1']);
});

test('afterRunConflictMap: a simulated run leaves the map alone', async (t) => {
  const { svc, mapFile } = setup(t, { summary: { mock: true } });
  await svc.afterRunConflictMap(runOf({ mock: true }), FINISHED);
  assert.equal(fs.existsSync(mapFile), false);
});

test('afterRunConflictMap: a failed run leaves the map alone', async (t) => {
  const { svc, mapFile } = setup(t, { summary: { status: 'failed' } });
  await svc.afterRunConflictMap(runOf(), { ...FINISHED, status: 'failed' });
  assert.equal(fs.existsSync(mapFile), false);
});

test('afterRunConflictMap: a project that is not a git clone leaves the map alone', async (t) => {
  const { svc, mapFile } = setup(t, { isGit: false });
  await svc.afterRunConflictMap(runOf(), FINISHED);
  assert.equal(fs.existsSync(mapFile), false);
});

test('afterRunConflictMap: a run that neither merged locally nor opened a PR leaves the map alone', async (t) => {
  const { svc, mapFile } = setup(t, { summary: { local_merge: null } });
  await svc.afterRunConflictMap(runOf(), FINISHED);
  assert.equal(fs.existsSync(mapFile), false);
});

test('savedConflictMap: the saved map as it is, null when there is none', (t) => {
  const { svc, mapFile } = setup(t);
  assert.equal(svc.savedConflictMap('p1'), null);
  const saved = { source: 'runs', runs: 1, runIds: ['x'], files: [{ file: 'sentinel.js', runs: 1, runIds: ['x'], lastRun: 'x', conflicts: 0 }], lines: [] };
  fs.writeFileSync(mapFile, JSON.stringify(saved));
  assert.deepEqual(svc.savedConflictMap('p1').files.map((f) => f.file), ['sentinel.js']);
});
