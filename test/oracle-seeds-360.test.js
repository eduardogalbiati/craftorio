// #360 src/oracle-seeds.js: running an analysis seed through one Oracle turn (faked here) or a
// recorded tool, saving result.html + model.json per run, and listing/reading the runs.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const load = () => require('../src/oracle-seeds');

function tmp(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oseeds-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

const SEED_BODY = '# Sample\n\nCount the files of SEED-BODY-MARKER.\n\n## VERIFY\n\nRe-count.\n\nTell me:\n- the count\n';
const SEED = {
  id: 'sample',
  meta: { name: 'sample', summary: 'Count the files', needs: ['git'], produces: ['html'], cost: 'one Oracle turn' },
  body: SEED_BODY,
};

// a fake { oneTurn, budgetRefusal } of src/oracle.js: records each turn's arguments, answers `text`
function fakeOracle(text, { refusal = null } = {}) {
  const turns = [];
  return {
    turns,
    budgetRefusal: () => refusal,
    oneTurn: async (args) => { turns.push(args); return { text, costUsd: 0.12, tokens: { input: 1000, output: 200 } }; },
  };
}

const answer = (payload) => `Here it is:\n\`\`\`json\n${JSON.stringify(payload)}\n\`\`\`\n`;
const GOOD = answer({ html: '<h1>Files: 3</h1>', model: { files: 3 } });

function setup(t) {
  const ws = tmp(t);
  const root = path.join(ws, 'architecture');
  const folder = path.join(ws, 'repo');
  fs.mkdirSync(folder, { recursive: true });
  return { root, project: { id: 'p1', folder } };
}

const seedDir = (root) => path.join(root, 'p1', 'seeds', 'sample');
const savedRuns = (root) => (fs.existsSync(seedDir(root)) ? fs.readdirSync(seedDir(root)) : []);

test('#360 an Oracle run saves result.html and model.json and returns its source and cost', async (t) => {
  const { root, project } = setup(t);
  const out = await load().runSeed({ root, project, seed: SEED, oracle: fakeOracle(GOOD), mock: false });
  assert.equal(out.source, 'oracle');
  assert.equal(out.costUsd, 0.12);
  const dir = path.join(seedDir(root), out.date);
  assert.equal(path.resolve(out.dir), path.resolve(dir));
  assert.match(fs.readFileSync(path.join(dir, 'result.html'), 'utf8'), /Files: 3/);
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'model.json'), 'utf8')).files, 3);
});

test('#360 the prompt of the Oracle turn contains the seed body', async (t) => {
  const { root, project } = setup(t);
  const oracle = fakeOracle(GOOD);
  await load().runSeed({ root, project, seed: SEED, oracle, mock: false });
  assert.equal(oracle.turns.length, 1);
  assert.ok(String(oracle.turns[0].prompt).includes('Count the files of SEED-BODY-MARKER.'));
});

test('#360 listSeedRuns is empty before a run and lists the run after it', async (t) => {
  const { root, project } = setup(t);
  const { runSeed, listSeedRuns } = load();
  assert.deepEqual(listSeedRuns(root, 'p1', 'sample'), []);
  const out = await runSeed({ root, project, seed: SEED, oracle: fakeOracle(GOOD), mock: false });
  const runs = listSeedRuns(root, 'p1', 'sample');
  assert.equal(runs.length, 1);
  assert.equal(runs[0].date, out.date);
  assert.equal(runs[0].source, 'oracle');
  assert.equal(runs[0].costUsd, 0.12);
});

test('#360 readSeedRun returns the saved html and model', async (t) => {
  const { root, project } = setup(t);
  const { runSeed, readSeedRun } = load();
  const out = await runSeed({ root, project, seed: SEED, oracle: fakeOracle(GOOD), mock: false });
  const run = readSeedRun(root, 'p1', 'sample', out.date);
  assert.match(run.html, /Files: 3/);
  assert.equal(run.model.files, 3);
});

test('#360 a run over the Oracle budget is refused without a turn and saves nothing', async (t) => {
  const { root, project } = setup(t);
  const oracle = fakeOracle(GOOD, { refusal: { reason: 'daily-budget', spentUsd: 20, limitUsd: 20 } });
  const out = await load().runSeed({ root, project, seed: SEED, oracle, mock: false });
  assert.equal(out.refused.reason, 'daily-budget');
  assert.equal(oracle.turns.length, 0);
  assert.equal(savedRuns(root).length, 0);
});

test('#360 an answer without a json block saves nothing', async (t) => {
  const { root, project } = setup(t);
  const { runSeed, listSeedRuns } = load();
  let out = null;
  try { out = await runSeed({ root, project, seed: SEED, oracle: fakeOracle('No json here, sorry.'), mock: false }); } catch { out = { error: 'rejected' }; }
  assert.ok(out && out.error, 'rejected or { error }');
  assert.deepEqual(listSeedRuns(root, 'p1', 'sample'), []);
  assert.equal(savedRuns(root).length, 0);
});

test('#360 a recorded tool runs instead of the Oracle, for free, and its JSON is the model', async (t) => {
  const { root, project } = setup(t);
  const oracle = fakeOracle(GOOD);
  const calls = [];
  const exec = async (command, opts) => { calls.push({ command, cwd: opts && opts.cwd }); return '{"files":7}\n'; };
  const out = await load().runSeed({ root, project, seed: SEED, oracle, mock: false, exec, tool: { command: 'node tools/count.js' } });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].command, 'node tools/count.js');
  assert.equal(calls[0].cwd, project.folder);
  assert.equal(oracle.turns.length, 0);
  assert.equal(out.source, 'tool');
  assert.equal(out.costUsd, 0);
  const dir = path.join(seedDir(root), out.date);
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'model.json'), 'utf8')).files, 7);
  assert.ok(fs.existsSync(path.join(dir, 'result.html')));
});

test('#360 a GitHub token in the answer never reaches the saved files', async (t) => {
  const { root, project } = setup(t);
  const token = 'ghp_' + 'a'.repeat(36);
  const text = answer({ html: `<p>token ${token}</p>`, model: { files: 3, note: `token ${token}` } });
  const out = await load().runSeed({ root, project, seed: SEED, oracle: fakeOracle(text), mock: false });
  const dir = path.join(seedDir(root), out.date);
  assert.equal(fs.readFileSync(path.join(dir, 'result.html'), 'utf8').includes(token), false);
  assert.equal(fs.readFileSync(path.join(dir, 'model.json'), 'utf8').includes(token), false);
});

test('#360 mock: true saves a simulated result without an Oracle', async (t) => {
  const { root, project } = setup(t);
  const out = await load().runSeed({ root, project, seed: SEED, mock: true });
  assert.equal(out.simulated, true);
  const dir = path.join(seedDir(root), out.date);
  assert.ok(fs.existsSync(path.join(dir, 'result.html')));
  assert.ok(fs.existsSync(path.join(dir, 'model.json')));
});
