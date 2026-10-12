// The conflict map (#150, src/conflict-map.js): the files and the single lines that many runs change,
// attributed per run from its commits (local merge range, PR merge commit, resumed run walked back to
// the first run's base), with a git fallback when no run has commits; saved per project in the backlog
// folder (conflictMapPath, loadConflictMap, updateConflictMap) and read as hot spots (hotSpots).
// The module is required inside each test so this file loads before it exists.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const load = () => require('../src/conflict-map');

// Isolated identity on every call: nothing depends on the machine's git config (as in repo-performance.test.js).
const git = (cwd, ...args) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'init.defaultBranch=main', '-c', 'core.autocrlf=false', ...args], { cwd, stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim();

// One commit writing every file of `files` ({ relative path: content }); returns its sha.
function commitFiles(cwd, files, msg = Object.keys(files).join(' ')) {
  for (const [file, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(cwd, file)), { recursive: true });
    fs.writeFileSync(path.join(cwd, file), text);
    git(cwd, 'add', file);
  }
  git(cwd, 'commit', '-q', '-m', msg);
  return git(cwd, 'rev-parse', 'HEAD');
}

function tmpDir(t, prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3 }));
  return dir;
}

function tmpRepo(t) {
  const dir = tmpDir(t, 'conflict-map-repo-');
  git(dir, 'init', '-q');
  return dir;
}

function writeEvents(t, events) {
  const dir = tmpDir(t, 'conflict-map-run-');
  fs.writeFileSync(path.join(dir, 'events.jsonl'), events.map((e) => JSON.stringify(e)).join('\n'));
  return dir;
}

const run = (runId, hour, extra) => ({
  runId, status: 'success', mock: false, pr: null, resumedFrom: null, localMerge: null,
  startedAt: `2026-10-01T${String(hour).padStart(2, '0')}:00:00Z`, finishedAt: `2026-10-01T${String(hour).padStart(2, '0')}:05:00Z`,
  ...extra,
});

const fileNames = (map) => map.files.map((f) => f.file).sort();
const fileOf = (map, name) => map.files.find((f) => f.file === name);

/**
 * Three runs, one after the other, each adds a name to the same one-line import of src/index.js
 * (line 1) and changes its own file; r1 also changes line 3 of src/index.js (a line only one run
 * changes). r2's events name src/index.js in a merge conflict.
 */
function threeRuns(t) {
  const repo = tmpRepo(t);
  const init = commitFiles(repo, {
    'src/index.js': "const { a } = require('./x');\n\nmodule.exports = a;\n",
    'README.md': 'demo\n',
  });
  const tip1 = commitFiles(repo, {
    'src/index.js': "const { a, b } = require('./x');\n\nmodule.exports = { a, b };\n",
    'src/one.js': 'one\n',
  });
  const tip2 = commitFiles(repo, {
    'src/index.js': "const { a, b, c } = require('./x');\n\nmodule.exports = { a, b };\n",
    'src/two.js': 'two\n',
  });
  const tip3 = commitFiles(repo, {
    'src/index.js': "const { a, b, c, d } = require('./x');\n\nmodule.exports = { a, b };\n",
    'src/three.js': 'three\n',
  });
  const runs = [
    run('r1', 8, { runDir: writeEvents(t, [{ type: 'worktree.ready', commit: init }]), localMerge: { commit: tip1 } }),
    run('r2', 9, {
      runDir: writeEvents(t, [
        { type: 'worktree.ready', commit: tip1 },
        { type: 'step.started', step_id: 'resolve_merge' },
        { type: 'log', message: 'CONFLICT (content): Merge conflict in src/index.js' },
      ]),
      localMerge: { commit: tip2 },
    }),
    run('r3', 10, { runDir: writeEvents(t, [{ type: 'worktree.ready', commit: tip2 }]), localMerge: { commit: tip3 } }),
  ];
  return { repo, runs };
}

// ---- attribution ----------------------------------------------------------------------------------

test('buildConflictMap: a local merge run counts the files of its commits from worktree.ready to localMerge.commit, not the earlier ones', async (t) => {
  const { buildConflictMap } = load();
  const repo = tmpRepo(t);
  const init = commitFiles(repo, { 'init.txt': 'init\n' });
  commitFiles(repo, { 'a.txt': 'a\n' });
  const tip = commitFiles(repo, { 'b.txt': 'b\n' });
  const runs = [run('r1', 8, { runDir: writeEvents(t, [{ type: 'worktree.ready', commit: init }]), localMerge: { commit: tip } })];
  const map = await buildConflictMap({ runs, repo });
  assert.equal(map.source, 'runs');
  assert.deepEqual(fileNames(map), ['a.txt', 'b.txt']);
  assert.deepEqual(fileOf(map, 'a.txt').runIds, ['r1']);
});

test('buildConflictMap: a PR run counts the files of the PR merge commit found in git log by its number', async (t) => {
  const { buildConflictMap } = load();
  const repo = tmpRepo(t);
  commitFiles(repo, { 'init.txt': 'init\n' });
  git(repo, 'checkout', '-q', '-b', 'feature');
  commitFiles(repo, { 'pr-file.txt': 'from the PR\n' });
  git(repo, 'checkout', '-q', 'main');
  git(repo, 'merge', '-q', '--no-ff', '-m', 'Merge pull request #42 from feature', 'feature');
  const runs = [run('pr-run', 8, { runDir: null, pr: { number: 42 } })];
  const map = await buildConflictMap({ runs, repo });
  assert.equal(map.source, 'runs');
  assert.deepEqual(fileNames(map), ['pr-file.txt']);
  assert.deepEqual(fileOf(map, 'pr-file.txt').runIds, ['pr-run']);
});

test('buildConflictMap: a resumed run without its own base is walked back to the first run\'s base', async (t) => {
  const { buildConflictMap } = load();
  const repo = tmpRepo(t);
  const init = commitFiles(repo, { 'init.txt': 'init\n' });
  commitFiles(repo, { 'a.txt': 'a\n' }); // committed by the first run before it failed
  const tip = commitFiles(repo, { 'b.txt': 'b\n' });
  const runs = [
    run('first', 8, { status: 'failed', runDir: writeEvents(t, [{ type: 'worktree.ready', commit: init }]) }),
    run('resumed', 9, { resumedFrom: 'first', runDir: writeEvents(t, [{ type: 'step.started', step_id: 'develop' }]), localMerge: { commit: tip } }),
  ];
  const map = await buildConflictMap({ runs, repo });
  assert.deepEqual(fileNames(map), ['a.txt', 'b.txt']);
  assert.deepEqual(fileOf(map, 'a.txt').runIds, ['resumed']);
  assert.deepEqual(fileOf(map, 'b.txt').runIds, ['resumed']);
});

test('buildConflictMap: a simulated run (mock) is left out of the files and of the runs counted', async (t) => {
  const { buildConflictMap } = load();
  const repo = tmpRepo(t);
  const init = commitFiles(repo, { 'init.txt': 'init\n' });
  const tipReal = commitFiles(repo, { 'real.txt': 'real\n' });
  const tipMock = commitFiles(repo, { 'mock.txt': 'mock\n' });
  const runs = [
    run('real', 8, { runDir: writeEvents(t, [{ type: 'worktree.ready', commit: init }]), localMerge: { commit: tipReal } }),
    run('sim', 9, { mock: true, runDir: writeEvents(t, [{ type: 'worktree.ready', commit: tipReal }]), localMerge: { commit: tipMock } }),
  ];
  const map = await buildConflictMap({ runs, repo });
  assert.deepEqual(fileNames(map), ['real.txt']);
  assert.deepEqual(map.runIds, ['real']);
  assert.equal(map.runs, 1);
});

test('buildConflictMap: a run that has not finished is not counted', async (t) => {
  const { buildConflictMap } = load();
  const repo = tmpRepo(t);
  const init = commitFiles(repo, { 'init.txt': 'init\n' });
  const tip1 = commitFiles(repo, { 'done.txt': 'done\n' });
  const tip2 = commitFiles(repo, { 'busy.txt': 'busy\n' });
  const runs = [
    run('done', 8, { runDir: writeEvents(t, [{ type: 'worktree.ready', commit: init }]), localMerge: { commit: tip1 } }),
    run('busy', 9, { status: 'running', finishedAt: null, runDir: writeEvents(t, [{ type: 'worktree.ready', commit: tip1 }]), localMerge: { commit: tip2 } }),
  ];
  const map = await buildConflictMap({ runs, repo });
  assert.deepEqual(map.runIds, ['done']);
  assert.deepEqual(fileNames(map), ['done.txt']);
});

// ---- counts per file and per line (three runs) ------------------------------------------------------

test('buildConflictMap: three runs are counted, their ids newest finished first', async (t) => {
  const { buildConflictMap } = load();
  const { repo, runs } = threeRuns(t);
  const map = await buildConflictMap({ runs, repo });
  assert.equal(map.source, 'runs');
  assert.equal(map.runs, 3);
  assert.deepEqual(map.runIds, ['r3', 'r2', 'r1']);
});

test('buildConflictMap: the file every run changed comes first with 3 runs; each run\'s own file has 1', async (t) => {
  const { buildConflictMap } = load();
  const { repo, runs } = threeRuns(t);
  const map = await buildConflictMap({ runs, repo });
  assert.equal(map.files[0].file, 'src/index.js');
  assert.equal(map.files[0].runs, 3);
  assert.deepEqual([...map.files[0].runIds].sort(), ['r1', 'r2', 'r3']);
  assert.deepEqual(fileNames(map), ['src/index.js', 'src/one.js', 'src/three.js', 'src/two.js']);
  assert.equal(fileOf(map, 'src/one.js').runs, 1);
  assert.deepEqual(fileOf(map, 'src/two.js').runIds, ['r2']);
});

test('buildConflictMap: lastRun is the newest finished run that changed the file', async (t) => {
  const { buildConflictMap } = load();
  const { repo, runs } = threeRuns(t);
  const map = await buildConflictMap({ runs, repo });
  assert.equal(fileOf(map, 'src/index.js').lastRun, 'r3');
  assert.equal(fileOf(map, 'src/one.js').lastRun, 'r1');
  assert.equal(fileOf(map, 'src/two.js').lastRun, 'r2');
});

test('buildConflictMap: a file named in a run\'s merge conflict has conflicts, a file never named has none', async (t) => {
  const { buildConflictMap } = load();
  const { repo, runs } = threeRuns(t);
  const map = await buildConflictMap({ runs, repo });
  assert.ok(fileOf(map, 'src/index.js').conflicts >= 1, 'src/index.js is named by r2\'s conflict');
  assert.equal(fileOf(map, 'src/two.js').conflicts, 0);
});

test('buildConflictMap: the import line all three runs changed is a hub line, with its line number and text at HEAD', async (t) => {
  const { buildConflictMap } = load();
  const { repo, runs } = threeRuns(t);
  const map = await buildConflictMap({ runs, repo });
  const hub = map.lines.find((l) => l.file === 'src/index.js' && l.line === 1);
  assert.ok(hub, 'src/index.js:1 is listed');
  assert.equal(hub.text, "const { a, b, c, d } = require('./x');");
  assert.equal(hub.runs, 3);
  assert.deepEqual([...hub.runIds].sort(), ['r1', 'r2', 'r3']);
});

test('buildConflictMap: a line only one run changed is not a hub line', async (t) => {
  const { buildConflictMap } = load();
  const { repo, runs } = threeRuns(t);
  const map = await buildConflictMap({ runs, repo });
  assert.deepEqual(map.lines.map((l) => `${l.file}:${l.line}`), ['src/index.js:1']);
});

// ---- git fallback -----------------------------------------------------------------------------------

test('buildConflictMap: with no runs, the map comes from the last commits of the branch, one commit counting as one run', async (t) => {
  const { buildConflictMap } = load();
  const repo = tmpRepo(t);
  commitFiles(repo, { 'a.txt': '1\n' });
  commitFiles(repo, { 'a.txt': '2\n' });
  commitFiles(repo, { 'a.txt': '3\n', 'b.txt': 'b\n' });
  const map = await buildConflictMap({ runs: [], repo });
  assert.equal(map.source, 'git');
  assert.equal(map.files[0].file, 'a.txt');
  assert.equal(map.files[0].runs, 3);
  assert.equal(fileOf(map, 'b.txt').runs, 1);
});

test('buildConflictMap: only simulated runs falls back to git too', async (t) => {
  const { buildConflictMap } = load();
  const repo = tmpRepo(t);
  const init = commitFiles(repo, { 'a.txt': '1\n' });
  const tip = commitFiles(repo, { 'a.txt': '2\n' });
  const runs = [run('sim', 8, { mock: true, runDir: writeEvents(t, [{ type: 'worktree.ready', commit: init }]), localMerge: { commit: tip } })];
  const map = await buildConflictMap({ runs, repo });
  assert.equal(map.source, 'git');
  assert.equal(fileOf(map, 'a.txt').runs, 2);
});

// ---- saved per project --------------------------------------------------------------------------------

test('conflictMapPath: <backlogDir>/<projectId>.conflict-map.json', () => {
  const { conflictMapPath } = load();
  assert.equal(conflictMapPath(path.join('ws', 'backlog'), 'demo'), path.join('ws', 'backlog', 'demo.conflict-map.json'));
});

test('loadConflictMap: no saved map → builds it, saves it to conflictMapPath and returns it', async (t) => {
  const { loadConflictMap } = load();
  const repo = tmpRepo(t);
  commitFiles(repo, { 'a.txt': '1\n' });
  const backlogDir = tmpDir(t, 'conflict-map-backlog-');
  const file = path.join(backlogDir, 'demo.conflict-map.json');
  const map = await loadConflictMap({ backlogDir, projectId: 'demo', runs: [], repo, store: null });
  assert.equal(map.source, 'git');
  assert.ok(fs.existsSync(file), 'the map is saved');
  const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(saved.source, 'git');
  assert.deepEqual(saved.files.map((f) => f.file), ['a.txt']);
});

test('loadConflictMap: a saved map is returned as saved, without a rebuild', async (t) => {
  const { loadConflictMap } = load();
  const repo = tmpRepo(t);
  commitFiles(repo, { 'a.txt': '1\n' });
  const backlogDir = tmpDir(t, 'conflict-map-backlog-');
  const sentinel = { source: 'runs', runs: 7, runIds: ['sentinel'], files: [{ file: 'sentinel.js', runs: 7, runIds: ['sentinel'], lastRun: 'sentinel', conflicts: 0 }], lines: [] };
  fs.writeFileSync(path.join(backlogDir, 'demo.conflict-map.json'), JSON.stringify(sentinel));
  const map = await loadConflictMap({ backlogDir, projectId: 'demo', runs: [], repo, store: null });
  assert.deepEqual(map, sentinel);
});

test('updateConflictMap: rebuilds and rewrites the saved map', async (t) => {
  const { updateConflictMap } = load();
  const repo = tmpRepo(t);
  commitFiles(repo, { 'a.txt': '1\n' });
  const backlogDir = tmpDir(t, 'conflict-map-backlog-');
  const file = path.join(backlogDir, 'demo.conflict-map.json');
  fs.writeFileSync(file, JSON.stringify({ source: 'runs', runs: 7, runIds: ['sentinel'], files: [], lines: [] }));
  const map = await updateConflictMap({ backlogDir, projectId: 'demo', runs: [], repo, store: null });
  assert.equal(map.source, 'git');
  const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(saved.source, 'git');
  assert.deepEqual(saved.files.map((f) => f.file), ['a.txt']);
});

// ---- hotSpots (plain maps, no git) ---------------------------------------------------------------------

// n run ids, newest first: r<n> … r1
const ids = (n) => Array.from({ length: n }, (_, i) => `r${n - i}`);
const mapOf = (runIds, files = [], lines = []) => ({
  source: 'runs', runs: runIds.length, runIds,
  files: files.map(([file, runs]) => ({ file, runs: runs.length, runIds: runs, lastRun: runs[0], conflicts: 0 })),
  lines: lines.map(([file, line, runs]) => ({ file, line, text: 'x', runs: runs.length, runIds: runs })),
});

test('hotSpots: a file changed by 11 of the last 20 runs is hot', () => {
  const { hotSpots } = load();
  const all = ids(20);
  const spots = hotSpots(mapOf(all, [['src/hot.js', all.slice(0, 11)]]));
  assert.equal(spots.length, 1);
  assert.deepEqual({ kind: spots[0].kind, file: spots[0].file, runs: spots[0].runs, of: spots[0].of }, { kind: 'file', file: 'src/hot.js', runs: 11, of: 20 });
});

test('hotSpots: a file changed by exactly half (10 of 20) is not hot', () => {
  const { hotSpots } = load();
  const all = ids(20);
  assert.deepEqual(hotSpots(mapOf(all, [['src/half.js', all.slice(0, 10)]])), []);
});

test('hotSpots: only the newest 20 runs count; changes by older runs do not make a file hot', () => {
  const { hotSpots } = load();
  const all = ids(25); // r25 … r1; the window is r25 … r6
  const oldAndNew = [...all.slice(0, 6), ...all.slice(20)]; // 6 in the window, 5 older: 11 in all
  const spots = hotSpots(mapOf(all, [['src/new.js', all.slice(0, 11)], ['src/old.js', oldAndNew]]));
  assert.deepEqual(spots.map((s) => [s.file, s.runs, s.of]), [['src/new.js', 11, 20]]);
});

test('hotSpots: with fewer runs than the window, "of" is the number of runs', () => {
  const { hotSpots } = load();
  const all = ids(4);
  const spots = hotSpots(mapOf(all, [['src/a.js', all.slice(0, 3)]]));
  assert.deepEqual(spots.map((s) => [s.file, s.runs, s.of]), [['src/a.js', 3, 4]]);
});

test('hotSpots: a hot file comes with a fix to apply', () => {
  const { hotSpots } = load();
  const all = ids(20);
  const [spot] = hotSpots(mapOf(all, [['src/hot.js', all.slice(0, 15)]]));
  assert.equal(typeof spot.fix, 'string');
  assert.ok(spot.fix.trim().length > 0);
});

test('hotSpots: a hot line comes with its line number and a fix of one item per line, sorted', () => {
  const { hotSpots } = load();
  const all = ids(20);
  const spots = hotSpots(mapOf(all, [], [['src/index.js', 3, all.slice(0, 12)]]));
  const line = spots.find((s) => s.kind === 'line');
  assert.ok(line, 'the line is hot');
  assert.deepEqual([line.file, line.line, line.runs, line.of], ['src/index.js', 3, 12, 20]);
  assert.match(line.fix, /one .*per line/i);
  assert.match(line.fix, /sort/i);
});

test('hotSpots: a custom window and threshold are honoured', () => {
  const { hotSpots } = load();
  const all = ids(10); // window 5: r10 … r6
  const spots = hotSpots(mapOf(all, [['src/a.js', all.slice(0, 2)], ['src/b.js', all.slice(0, 1)]]), { window: 5, threshold: 0.3 });
  assert.deepEqual(spots.map((s) => [s.file, s.runs, s.of]), [['src/a.js', 2, 5]]);
});
