// #737: a simulated run of the development workflow (feature.yaml, mock agents) starts few `git`
// processes: each one costs a process start, expensive on Windows, and the integration tier runs
// hundreds of runs. The change measured 33 per run before (HEAD read by a separate rev-parse in the
// test-file guard and in each suite round) and 24 after; the ceiling keeps that gain.
//
// The `git` processes are counted at the system boundary, as test-paths-git-calls-525 does:
// child_process is wrapped before any engine module loads (each test file runs in its own process).
const childProcess = require('child_process');

let calls = null; // the git command lines started while counting, or null when not counting
const isGit = (file) => /^git(\.exe)?$/i.test(require('path').basename(String(file || '')).trim());
const isGitLine = (cmd) => /^\s*"?git(\.exe)?"?(\s|$)/i.test(String(cmd || ''));
for (const name of ['execFile', 'execFileSync', 'spawn', 'spawnSync']) {
  const original = childProcess[name];
  childProcess[name] = function counted(file, args, ...rest) {
    if (calls && isGit(file)) calls.push(['git', ...(Array.isArray(args) ? args : [])].join(' '));
    return original.call(this, file, args, ...rest);
  };
}
for (const name of ['exec', 'execSync']) {
  const original = childProcess[name];
  childProcess[name] = function counted(cmd, ...rest) {
    if (calls && isGitLine(cmd)) calls.push(String(cmd));
    return original.call(this, cmd, ...rest);
  };
}

const test = require('node:test');
const assert = require('node:assert/strict');
const { runSoftwareDevelopment } = require('../engine-helpers');

process.env.MULTIAGENT_MOCK_DELAY_SCALE = '0.05';

const MAX_GIT_PROCESSES = 26;

test('#737 a simulated run of feature.yaml starts at most 26 git processes', { timeout: 120000 }, async () => {
  const started = [];
  calls = started;
  let result;
  try { result = await runSoftwareDevelopment({}); } finally { calls = null; }
  assert.equal(result.finished?.status, 'success', result.finished?.error);
  assert.ok(started.length <= MAX_GIT_PROCESSES, `${started.length} git processes in one simulated run (at most ${MAX_GIT_PROCESSES}):\n${started.join('\n')}`);
});
