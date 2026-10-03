// scripts/run.js (node scripts/run.js --mock ...): the terminal entry point agents themselves use
// for their own checks. #120: given the run scratch workspace an agent's environment carries
// (MULTIAGENT_WORKSPACE), it must write there, never fall back to the owner's registered workspace.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

function tmp(t, prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3 }));
  return dir;
}

test('a mock run honors MULTIAGENT_WORKSPACE (an agent\'s own run scratch workspace, set by the engine) and writes its run there, never under the registered workspace', (t) => {
  const scratch = tmp(t, 'run-script-scratch-');
  const repo = tmp(t, 'run-script-repo-');
  const out = execFileSync(process.execPath, [
    path.join(__dirname, '..', 'scripts', 'run.js'),
    '--mock', '--auto-approve',
    '--file', path.join(__dirname, 'fixtures', 'run-script.yaml'),
    '--repo', repo,
  ], {
    env: { ...process.env, MULTIAGENT_SIMULATION_ONLY: '1', MULTIAGENT_WORKSPACE: scratch },
    encoding: 'utf8',
  });
  assert.match(out, /■ success/);

  const runs = fs.readdirSync(path.join(scratch, 'runs'));
  assert.equal(runs.length, 1, 'the run was written under the scratch workspace it was given');
  const summary = JSON.parse(fs.readFileSync(path.join(scratch, 'runs', runs[0], 'summary.json'), 'utf8'));
  assert.equal(summary.status, 'success');
});
