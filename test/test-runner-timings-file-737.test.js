// scripts/test.js (#737): the per-file wall times are kept in a file a later run can compare with
// (the #305 slowest-files report only printed them). With CRAFTORIO_TEST_TIMINGS_FILE set, each run
// appends one JSON line: when it ran (`at`), the run's wall time (`wall_ms`) and every file it ran
// (`files`: { file, tier, ms }), the integration files (`*.slow.test.js`) in the `integration`
// tier and the others in `unit`. Runs the script on fixture test files in a temp folder.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.join(__dirname, '..');
const UNIT = 'timingsfx-unit';
const SLOW = 'timingsfx-wait';
const SLOW_WAIT_MS = 1500;

function fixtures(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'runner-timings-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5 }));
  fs.writeFileSync(path.join(dir, `${UNIT}.test.js`), "const test = require('node:test');\ntest('instant', () => {});\n");
  fs.writeFileSync(path.join(dir, `${SLOW}.slow.test.js`), `const test = require('node:test');\ntest('waits', () => new Promise((r) => setTimeout(r, ${SLOW_WAIT_MS})));\n`);
  return { dir, files: [path.join(dir, `${UNIT}.test.js`), path.join(dir, `${SLOW}.slow.test.js`)] };
}

function runScript(files, env) {
  const childEnv = { ...process.env, CRAFTORIO_TEST_CONCURRENCY: '2', CRAFTORIO_AGENT_MODE: '0', ...env };
  delete childEnv.NODE_TEST_CONTEXT;
  return spawnSync(process.execPath, ['scripts/test.js', ...files], { cwd: root, encoding: 'utf8', env: childEnv, timeout: 120000 });
}

const records = (file) => fs.readFileSync(file, 'utf8').split(/\r?\n/).filter((l) => l.trim()).map((l) => JSON.parse(l));
const entry = (record, name) => (record.files || []).find((f) => String(f.file).includes(name));

test('a run writes every file it ran, its tier and its wall time, to the timings file', (t) => {
  const { dir, files } = fixtures(t);
  const timings = path.join(dir, 'timings.jsonl');
  const r = runScript(files, { CRAFTORIO_TEST_TIMINGS_FILE: timings });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(fs.existsSync(timings), true, 'the timings file is written');
  const [record, ...rest] = records(timings);
  assert.equal(rest.length, 0, 'one line per run');
  assert.equal(Number.isNaN(Date.parse(record.at)), false, `\`at\` is a date: ${record.at}`);
  assert.equal(typeof record.wall_ms, 'number');
  const unit = entry(record, UNIT);
  const slow = entry(record, SLOW);
  assert.ok(unit, `the unit file is listed: ${JSON.stringify(record.files)}`);
  assert.ok(slow, `the integration file is listed: ${JSON.stringify(record.files)}`);
  assert.equal(unit.tier, 'unit');
  assert.equal(slow.tier, 'integration');
  assert.equal(typeof unit.ms, 'number');
  assert.ok(slow.ms >= SLOW_WAIT_MS - 50, `the integration file's time covers its ${SLOW_WAIT_MS} ms wait: ${slow.ms}`);
  assert.ok(record.wall_ms >= slow.ms - 50, `the run's wall time is at least its slowest file's: ${record.wall_ms} < ${slow.ms}`);
});

test('the timings file is kept over time: a second run appends its own line', (t) => {
  const { dir, files } = fixtures(t);
  const timings = path.join(dir, 'timings.jsonl');
  assert.equal(runScript(files, { CRAFTORIO_TEST_TIMINGS_FILE: timings }).status, 0);
  assert.equal(runScript([files[0]], { CRAFTORIO_TEST_TIMINGS_FILE: timings }).status, 0);
  const lines = records(timings);
  assert.equal(lines.length, 2, 'the first run\'s line is kept');
  assert.ok(entry(lines[0], SLOW), 'the first line still lists the integration file');
  assert.ok(entry(lines[1], UNIT), 'the second line lists the file the second run ran');
  assert.equal(entry(lines[1], SLOW), undefined, 'the second line lists only the files of its own run');
});

test('a failing run still writes its timings, and exits with 1', (t) => {
  const { dir, files } = fixtures(t);
  fs.writeFileSync(files[0], "const test = require('node:test');\nconst assert = require('node:assert/strict');\ntest('instant', () => assert.equal(1, 2));\n");
  const timings = path.join(dir, 'timings.jsonl');
  const r = runScript(files, { CRAFTORIO_TEST_TIMINGS_FILE: timings });
  assert.equal(r.status, 1);
  const [record] = records(timings);
  assert.ok(entry(record, UNIT) && entry(record, SLOW), `both files are listed: ${JSON.stringify(record.files)}`);
});

test('in agent mode stdout stays one JSON line when the timings file is written', (t) => {
  const { dir, files } = fixtures(t);
  const timings = path.join(dir, 'timings.jsonl');
  const r = runScript(files, { CRAFTORIO_AGENT_MODE: '1', CRAFTORIO_TEST_HUMAN_LOG: path.join(dir, 'human.log'), CRAFTORIO_TEST_TIMINGS_FILE: timings });
  const lines = r.stdout.trim().split(/\r?\n/);
  assert.equal(lines.length, 1, 'stdout is one JSON line only');
  assert.equal(JSON.parse(lines[0]).failed, 0);
  assert.equal(records(timings).length, 1);
});
