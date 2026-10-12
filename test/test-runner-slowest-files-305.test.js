// scripts/test.js (#305): a run ends with the five slowest test files and their wall time, so the
// suite's critical path shows in every `npm test` and in the run log (the human log in agent mode).
// Runs the script on fixture test files in a temp folder, one of them clearly slower than the rest.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.join(__dirname, '..');
const FAST = ['slowfx-alpha', 'slowfx-bravo', 'slowfx-charlie', 'slowfx-delta', 'slowfx-echo'];
const SLOW = 'slowfx-zulu';
const DURATION = /\d+(\.\d+)?\s*(ms|s)\b/;

// Six test files in a temp folder: five instant ones and one that waits 1.5 s.
function fixtures(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'slowest-files-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5 }));
  for (const name of FAST) fs.writeFileSync(path.join(dir, `${name}.test.js`), "const test = require('node:test');\ntest('instant', () => {});\n");
  fs.writeFileSync(path.join(dir, `${SLOW}.test.js`), "const test = require('node:test');\ntest('waits', () => new Promise((r) => setTimeout(r, 1500)));\n");
  return [...FAST, SLOW].map((n) => path.join(dir, `${n}.test.js`));
}

function runScript(files, env) {
  const childEnv = { ...process.env, MULTIAGENT_TEST_CONCURRENCY: '3', ...env };
  delete childEnv.NODE_TEST_CONTEXT;
  return spawnSync(process.execPath, ['scripts/test.js', ...files], { cwd: root, encoding: 'utf8', env: childEnv, timeout: 120000 });
}

// The report's slowest-files section: its heading line and the five lines after it.
function slowestSection(text) {
  const lines = text.split(/\r?\n/);
  const at = lines.findIndex((l) => /slowest/i.test(l));
  assert.ok(at >= 0, `a "slowest" line in the output:\n${text.slice(-1500)}`);
  return lines.slice(at, at + 6);
}

function assertSlowest(section) {
  const text = section.join('\n');
  const listed = [...FAST, SLOW].filter((n) => text.includes(n));
  assert.equal(listed.length, 5, `five of the six files are listed, got: ${listed.join(', ')}`);
  assert.ok(listed.includes(SLOW), 'the slow file is listed');
  const first = Math.min(...listed.map((n) => text.indexOf(n)));
  assert.equal(text.indexOf(SLOW), first, 'the slowest file comes first');
  for (const n of listed) {
    const line = section.find((l) => l.includes(n));
    assert.match(line, DURATION, `${n} is listed with its wall time`);
  }
}

test('npm test ends with the five slowest test files and their wall time, the slowest first', (t) => {
  const r = runScript(fixtures(t), { MULTIAGENT_AGENT_MODE: '0' });
  assert.equal(r.status, 0, r.stderr);
  assertSlowest(slowestSection(r.stdout));
});

test('in agent mode the slowest files go to the human log and stdout stays one JSON line', (t) => {
  const files = fixtures(t);
  const log = path.join(path.dirname(files[0]), 'human.log');
  const r = runScript(files, { MULTIAGENT_AGENT_MODE: '1', MULTIAGENT_TEST_HUMAN_LOG: log });
  const lines = r.stdout.trim().split(/\r?\n/);
  assert.equal(lines.length, 1, 'stdout is one JSON line only');
  assert.equal(JSON.parse(lines[0]).failed, 0);
  assertSlowest(slowestSection(fs.readFileSync(log, 'utf8')));
});
