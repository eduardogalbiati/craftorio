// #526: the Product Owner's first Analyze does not wait for a conflict map built from git. With no saved
// map the turn calls the agent after a short, fixed wait and leaves the "## Conflict map" section out when
// the build is not ready; the build keeps running, saves <projectId>.conflict-map.json for the next
// Analyze, and two turns at once start one build. A saved map is read as before.
// The agent's folder is always a small temporary repository (never this one); its git processes go
// through git-process-stub.js, which holds them to stand for a build that hangs. The agent's turn is
// stubbed at providers.runTurn. The stub is installed before the modules under test load.
const gitStub = require('../project/git-process-stub');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..', '..', '..', '..');
const load = () => require('../../domains/po/product-owner');
// the longest the turn may wait for the map before it calls the agent ("a few seconds"), with margin
const TURN_LIMIT_MS = 20000;

const git = (cwd, ...args) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'init.defaultBranch=main', '-c', 'core.autocrlf=false', ...args], { cwd, stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim();

function tmpDir(t, prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3 }));
  return dir;
}

// A repository whose last commits all change a.txt: its map from git has a.txt as a hub file.
function hubRepo(t) {
  const dir = tmpDir(t, 'po-cm-repo-');
  git(dir, 'init', '-q');
  for (const [n, text] of [[1, '1\n'], [2, '2\n'], [3, '3\n']]) {
    fs.writeFileSync(path.join(dir, 'a.txt'), text);
    fs.writeFileSync(path.join(dir, `only-${n}.txt`), 'x\n');
    git(dir, 'add', '-A');
    git(dir, 'commit', '-q', '-m', `c${n}`);
  }
  return dir;
}

function stubTurns(t) {
  const providers = require('../../engine/providers');
  const original = providers.runTurn;
  t.after(() => { providers.runTurn = original; });
  const prompts = [];
  providers.runTurn = async ({ prompt }) => { prompts.push(prompt); return { text: '```json\n{"summary":"ok","groups":[],"conflicts":[],"enrich":[]}\n```', costUsd: 0, usage: {} }; };
  return prompts;
}

const PO_COMMON = {
  projectId: 'demo', question: 'Analyze the backlog', data: { projectId: 'demo', issues: [{ number: 1, state: 'open', title: 'A', labels: [], body: 'x' }] },
  workflows: [{ file: 'software-development.yaml', name: 'x' }], skillsDirs: [path.join(ROOT, 'skills')],
  resolveCommand: () => 'claude', agent: { model: 'claude-opus-5-5', effort: 'high' }, mock: false, runs: [],
};

const mapFile = (backlogDir) => path.join(backlogDir, 'demo.conflict-map.json');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Resolves with the promise's value, or { timedOut: true } after ms.
function within(promise, ms) {
  let timer;
  return Promise.race([promise.then((value) => ({ value })), new Promise((r) => { timer = setTimeout(() => r({ timedOut: true }), ms); })]).finally(() => clearTimeout(timer));
}

// Waits for the saved map (and for no git call left running in the folder), up to ms.
async function savedMap(backlogDir, ms = 30000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (fs.existsSync(mapFile(backlogDir))) {
      try { return JSON.parse(fs.readFileSync(mapFile(backlogDir), 'utf8')); } catch { /* being written */ }
    }
    await sleep(100);
  }
  return null;
}

test.afterEach(() => gitStub.reset());

test('#526 with no saved map and a build that hangs, the turn still calls the agent and leaves the conflict map out', async (t) => {
  const prompts = stubTurns(t);
  const folder = hubRepo(t);
  const backlogDir = tmpDir(t, 'po-cm-backlog-');
  gitStub.watch(folder);
  gitStub.close();
  const started = Date.now();
  const turn = load().ask({ ...PO_COMMON, folder, backlogDir });
  try {
    const result = await within(turn, TURN_LIMIT_MS);
    assert.equal(result.timedOut === true, false, `the turn waited more than ${TURN_LIMIT_MS} ms for the conflict map`);
    assert.ok(Date.now() - started < TURN_LIMIT_MS);
    assert.equal(prompts.length, 1);
    assert.equal(prompts[0].includes('## Conflict map'), false);
  } finally {
    gitStub.open();
    await turn.catch(() => {});
  }
});

test('#526 a build started by a turn keeps running after the turn and saves the map, so the next Analyze shows it', async (t) => {
  const prompts = stubTurns(t);
  const folder = hubRepo(t);
  const backlogDir = tmpDir(t, 'po-cm-backlog-');
  gitStub.watch(folder);
  gitStub.close();
  const turn = load().ask({ ...PO_COMMON, folder, backlogDir });
  let first;
  try {
    first = await within(turn, TURN_LIMIT_MS);
  } finally {
    gitStub.open();
  }
  assert.equal(first.timedOut === true, false, 'the first turn waited for the build');
  assert.equal(prompts[0].includes('## Conflict map'), false);
  const map = await savedMap(backlogDir);
  assert.equal(map === null, false, 'the build started by the turn did not save demo.conflict-map.json');
  assert.equal(map.source, 'git');
  assert.equal(map.files[0].file, 'a.txt');
  assert.equal(map.files[0].runs, 3);

  await load().ask({ ...PO_COMMON, folder, backlogDir });
  assert.equal(prompts.length, 2);
  assert.equal(prompts[1].includes('## Conflict map'), true);
  assert.match(prompts[1], /- a\.txt: 3 commits/);
});

// The git processes one whole build of hubRepo starts (measured, so the test does not depend on how
// fromGit reads git).
async function oneBuildCalls(t) {
  stubTurns(t);
  const folder = hubRepo(t);
  const backlogDir = tmpDir(t, 'po-cm-backlog-');
  gitStub.watch(folder);
  await load().ask({ ...PO_COMMON, folder, backlogDir });
  assert.equal((await savedMap(backlogDir)) === null, false);
  await sleep(500);
  return gitStub.calls(folder).length;
}

test('#526 two turns at once on a project with no saved map start one build of its map', async (t) => {
  const single = await oneBuildCalls(t);
  assert.ok(single > 0);

  stubTurns(t);
  const folder = hubRepo(t);
  const backlogDir = tmpDir(t, 'po-cm-backlog-');
  gitStub.watch(folder);
  gitStub.close();
  const turns = [load().ask({ ...PO_COMMON, folder, backlogDir }), load().ask({ ...PO_COMMON, folder, backlogDir })];
  // let both turns reach the map before the held git calls run (or give up on a turn that waits for it)
  await within(Promise.all(turns), TURN_LIMIT_MS);
  gitStub.open();
  await Promise.all(turns.map((p) => p.catch(() => {})));
  const map = await savedMap(backlogDir);
  assert.equal(map === null, false);
  await sleep(500);
  assert.equal(gitStub.calls(folder).length, single, 'two concurrent turns started more git work than one build');
});

test('#526 a saved map is read as before: the turn shows it without rebuilding it from the repository', async (t) => {
  const prompts = stubTurns(t);
  const folder = hubRepo(t);
  const backlogDir = tmpDir(t, 'po-cm-backlog-');
  const saved = {
    source: 'git', runs: 5, runIds: ['c1', 'c2', 'c3', 'c4', 'c5'],
    files: [{ file: 'src/registry.js', runs: 4, runIds: ['c1', 'c2', 'c3', 'c4'], lastRun: 'c1', conflicts: 0 }],
    lines: [], builtAt: '2026-10-01T00:00:00.000Z',
  };
  fs.writeFileSync(mapFile(backlogDir), JSON.stringify(saved));
  gitStub.watch(folder);
  await load().ask({ ...PO_COMMON, folder, backlogDir });
  assert.equal(prompts.length, 1);
  assert.equal(prompts[0].includes('## Conflict map'), true);
  assert.match(prompts[0], /- src\/registry\.js: 4 commits of 5/);
  assert.equal(/- a\.txt: \d+ commits/.test(prompts[0]), false);
  await sleep(300);
  assert.deepEqual(JSON.parse(fs.readFileSync(mapFile(backlogDir), 'utf8')), saved);
});
