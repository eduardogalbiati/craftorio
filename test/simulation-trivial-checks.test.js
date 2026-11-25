// Simulated runs on this repository use a trivial rule check and no secret scan
// (packages/engine/test/helpers/sim-inputs.js). A mock run with `repo_path: root` and no check_command
// runs the repository's real `npm run check` (about 9 s) after every simulated developer commit: one
// file took 50 s alone and over 200 s under coverage in the whole suite before it used the helper.
// The guard: in every test file and test helper, an inputs object naming `repo_path: root` (or ROOT)
// goes through simInputs(...) or names its own check_command. ALLOWED lists the files that only build
// a run to read its inputs (no step runs), with the reason.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const REPO = path.join(__dirname, '..');

// file → why it may name repo_path: root without the helper
const ALLOWED = {
  'apps/desktop/test/testid-check-588.test.js': 'builds runs only to read their resolved inputs; no step runs',
};

// a JS file under a test folder (not a fixture)
const testCode = (f) => /(^|\/)test\/.*\.js$/.test(f) && !/(^|\/)(fixtures|node_modules)\//.test(f);

// the `{ ... }` literal opened at `open`, or null when unclosed
function literalAt(text, open) {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === '{') depth++;
    else if (text[i] === '}' && !--depth) return text.slice(open, i + 1);
  }
  return null;
}

// the inputs literals of `text` that name the repository and neither use simInputs nor set check_command
function offenders(text) {
  const out = [];
  for (const m of text.matchAll(/\binputs\s*:\s*(simInputs\s*\(\s*)?\{/g)) {
    const obj = literalAt(text, m.index + m[0].length - 1);
    if (!obj || !/\brepo_path\s*:\s*(root|ROOT)\b/.test(obj)) continue;
    if (m[1] || /\bcheck_command\s*:/.test(obj)) continue;
    out.push(text.slice(0, m.index).split('\n').length);
  }
  return out;
}

test('a simulated run on this repository goes through simInputs or names its own check_command', () => {
  const files = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], { cwd: REPO, encoding: 'utf8' })
    .split('\n').map((f) => f.trim()).filter(testCode);
  assert.ok(files.length > 100, 'the repository\'s test files are listed');
  const found = [];
  for (const f of files) {
    if (ALLOWED[f] || f === 'test/simulation-trivial-checks.test.js') continue;
    let text;
    try { text = fs.readFileSync(path.join(REPO, f), 'utf8'); } catch { continue; }
    for (const line of offenders(text)) found.push(`${f}:${line}`);
  }
  assert.deepEqual(found, [], 'wrap these inputs in simInputs (packages/engine/test/helpers/sim-inputs.js), or list the file in ALLOWED with the reason');
});

test('the guard sees an unwrapped run on the repository and accepts the wrapped one or an own check_command', () => {
  assert.deepEqual(offenders("new WorkflowRun({ file, inputs: { task: 't', repo_path: root }, mock: true })"), [1]);
  assert.deepEqual(offenders("new WorkflowRun({ file,\n  inputs: { task: 't',\n    repo_path: ROOT, ...inputs } })"), [2]);
  assert.deepEqual(offenders("new WorkflowRun({ file, inputs: simInputs({ task: 't', repo_path: root }) })"), []);
  assert.deepEqual(offenders("new WorkflowRun({ file, inputs: { repo_path: root, check_command: 'npm run check' } })"), []);
  assert.deepEqual(offenders("new WorkflowRun({ file, inputs: { repo_path: repoFromTemplate(t) } })"), []);
});

test('simInputs: the trivial check and no scan, the caller\'s inputs winning', () => {
  const { simInputs, TRIVIAL_CHECKS } = require('../packages/engine/test/helpers/sim-inputs');
  assert.deepEqual(TRIVIAL_CHECKS, { check_command: 'node --version', secret_scan: 'off' });
  assert.deepEqual(simInputs({ repo_path: 'r' }), { check_command: 'node --version', secret_scan: 'off', repo_path: 'r' });
  assert.equal(simInputs({ check_command: 'npm run check' }).check_command, 'npm run check');
  assert.equal(simInputs({ secret_scan: 'on' }).secret_scan, 'on');
});
