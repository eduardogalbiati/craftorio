// scripts/test.js (#91): `npm run test:affected` runs the workspaces' `npm test` at the same time
// (Turborepo), each `scripts/test.js --workspace <dir>`, all with the suite step's one
// CRAFTORIO_TEST_HUMAN_LOG. They used to empty that log and write their reports under the same names,
// so a workspace lost its report ("the runner of N file(s) ended (exit code 0) without its report").
// Runs two workspaces' runners at once on fixture files (a unit file and a slow one each, so two groups
// and two reports per workspace), each test taking long enough for the runs to overlap.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const root = path.join(__dirname, '..');

function fixtures(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'runner-parallel-91-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5 }));
  const body = "const test = require('node:test');\ntest('waits, then passes', () => new Promise((r) => setTimeout(r, 1500)));\n";
  const files = {};
  for (const ws of ['a', 'b']) {
    files[ws] = [path.join(dir, `unit-${ws}-91.test.js`), path.join(dir, `slow-${ws}-91.slow.test.js`)];
    for (const f of files[ws]) fs.writeFileSync(f, body);
  }
  return { dir, files };
}

const runWorkspace = (workspace, files, env) => new Promise((resolve) => {
  const child = spawn(process.execPath, [path.join(root, 'scripts', 'test.js'), '--workspace', path.join(root, workspace), ...files], { cwd: path.join(root, workspace), env });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (d) => { stdout += d; });
  child.stderr.on('data', (d) => { stderr += d; });
  child.on('exit', (code) => resolve({ code, stdout, stderr }));
});

test('#91 two workspaces run at once with one human log each keep their own reports, and the shared log gets both', async (t) => {
  const { dir, files } = fixtures(t);
  const shared = path.join(dir, 'suite-2-full.human.log');
  const env = { ...process.env, CRAFTORIO_AGENT_MODE: '1', CRAFTORIO_TEST_HUMAN_LOG: shared, CRAFTORIO_TEST_CONCURRENCY: '2' };
  delete env.NODE_TEST_CONTEXT;
  delete env.CRAFTORIO_TEST_TIMEOUT_MS;
  const [a, b] = await Promise.all([runWorkspace('packages/shared', files.a, env), runWorkspace('apps/web', files.b, env)]);
  for (const [name, r] of [['packages/shared', a], ['apps/web', b]]) {
    const lines = r.stdout.trim().split(/\r?\n/);
    assert.equal(lines.length, 1, `${name}: stdout is one JSON line: ${r.stdout}\nstderr: ${r.stderr}`);
    const report = JSON.parse(lines[0]);
    assert.equal(r.code, 0, `${name} passes: ${JSON.stringify(report.failures)}`);
    assert.equal(report.passed, 2, `${name}: both its groups reported (${JSON.stringify(report)})`);
    assert.ok(!report.failures.some((f) => f.test === '(the test runner)'), `${name}: no runner without its report`);
    assert.notEqual(path.resolve(root, report.human_log), shared, `${name}: its own human log, not the shared one`);
    assert.ok(fs.existsSync(path.resolve(root, report.human_log)), `${name}: its human log exists`);
  }
  const log = fs.readFileSync(shared, 'utf8');
  assert.match(log, /== packages\/shared ==/, 'the shared log has packages/shared\'s copy');
  assert.match(log, /== apps\/web ==/, 'the shared log has apps/web\'s copy');
});

test('#91 a run with no --workspace keeps writing the human log it is given', async (t) => {
  const { dir, files } = fixtures(t);
  const log = path.join(dir, 'human.log');
  const env = { ...process.env, CRAFTORIO_AGENT_MODE: '1', CRAFTORIO_TEST_HUMAN_LOG: log, CRAFTORIO_TEST_CONCURRENCY: '2' };
  delete env.NODE_TEST_CONTEXT;
  delete env.CRAFTORIO_TEST_TIMEOUT_MS;
  const r = await new Promise((resolve) => {
    const child = spawn(process.execPath, [path.join(root, 'scripts', 'test.js'), files.a[0]], { cwd: root, env });
    let stdout = '';
    child.stdout.on('data', (d) => { stdout += d; });
    child.on('exit', (code) => resolve({ code, stdout }));
  });
  const report = JSON.parse(r.stdout.trim().split(/\r?\n/).pop());
  assert.equal(r.code, 0);
  assert.equal(path.resolve(root, report.human_log), log, 'the human log it was given');
  assert.match(fs.readFileSync(log, 'utf8'), /Unit tests/);
});
