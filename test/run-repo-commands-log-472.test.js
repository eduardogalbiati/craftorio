// #472 (SEC-7) acceptance tests, written before the code: at its start, a run says in its log which
// commands it will run from the repository, so the owner sees the repo's code it is about to execute.
//
// Interface the developer implements (assumptions, documented here):
//   - Once the run knows its checkout (after setupWorktree; in a simulated run, the repository folder
//     `worktree_dir` points to) and before its first step starts, the run emits one
//     `log` event (level info) whose message names the repository commands it will run:
//       * the dependency install of the lockfile (`npm ci` for package-lock.json; with
//         `--ignore-scripts` when the project's setting is on),
//       * `npm run check` when package.json has a `check` script (src/engine/check-step.js checkCommand),
//       * the detected test command (src/engine/suite-step.js detectTestCommand(worktree_dir)).
//     The wording is free; these tests only look for those command strings in one log message.
//   - The project's setting reaches the run as the WorkflowRun constructor option
//     `ignoreInstallScripts` (boolean, default false), the service passing the project's
//     `ignoreInstallScripts` (see test/deps-cache-ignore-scripts-472.test.js); the run hands it to
//     depsCache.ensureDeps as `ignoreScripts`.
// Seam: a mock run of a one-step inline workflow with orchestrator.worktree and no worktreesDir (no
// git worktree, nothing installed or run), about a second, as test/protect-files.test.js runs one.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { WorkflowRun } = require('../src/engine/workflow');

process.env.MULTIAGENT_MOCK_DELAY_SCALE = '0.05';

function tmpDir(t, prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5 }));
  return dir;
}

// A repository with an npm lockfile, a `check` script and no npm `test` script, plus a go.mod: its
// detected test command is `go test ./...` (detectTestCommand), not `npm test`.
function makeRepo(t) {
  const dir = tmpDir(t, 'repo-cmds-472-repo-');
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'p', scripts: { check: 'node ok.js' } }));
  fs.writeFileSync(path.join(dir, 'package-lock.json'), '{}');
  fs.writeFileSync(path.join(dir, 'go.mod'), 'module example.com/p\n');
  return dir;
}

async function mockRun(t, opts = {}) {
  const repo = makeRepo(t);
  const dir = tmpDir(t, 'repo-cmds-472-wf-');
  const file = path.join(dir, 'wf.yaml');
  fs.writeFileSync(file, [
    'inputs:',
    '  repo_path: { type: string, required: true }',
    'orchestrator:',
    '  worktree: { repo: "{{ inputs.repo_path }}", base: main, remote: false }',
    'providers:',
    '  claude: { type: claude-code, command: claude }',
    'defaults:',
    '  working_dir: "{{ inputs.repo_path }}"',
    'agents:',
    '  developer: { provider: claude, model: m, session: ephemeral }',
    'steps:',
    '  - id: develop',
    '    agent: developer',
    '    prompt: "Implement the feature."',
    '    transitions:',
    '      - { when: "true", goto: end }',
    '',
  ].join('\n'));
  const run = new WorkflowRun({ file, inputs: { repo_path: repo }, mock: true, runsDir: path.join(dir, 'runs'), skillsDirs: [], ...opts });
  const events = [];
  run.on('event', (ev) => events.push(ev));
  await run.start();
  return events;
}

// The log messages emitted before the first step started
function startLogs(events) {
  const first = events.findIndex((e) => e.type === 'step.started');
  const before = first === -1 ? events : events.slice(0, first);
  return before.filter((e) => e.type === 'log').map((e) => String(e.message || ''));
}

test('#472 a run\'s start log names npm ci, npm run check and the detected test command in one message', { timeout: 60000 }, async (t) => {
  const events = await mockRun(t);
  const logs = startLogs(events);
  const line = logs.find((m) => m.includes('npm ci'));
  assert.ok(line, `a start log names npm ci: ${JSON.stringify(logs)}`);
  assert.equal(line.includes('npm run check'), true, `it names npm run check: ${line}`);
  assert.equal(line.includes('go test ./...'), true, `it names the detected test command: ${line}`);
});

test('#472 with ignoreInstallScripts the start log names the install as npm ci with --ignore-scripts', { timeout: 60000 }, async (t) => {
  const events = await mockRun(t, { ignoreInstallScripts: true });
  const logs = startLogs(events);
  const line = logs.find((m) => m.includes('npm ci'));
  assert.ok(line, `a start log names npm ci: ${JSON.stringify(logs)}`);
  assert.equal(line.includes('--ignore-scripts'), true, `the install is named with --ignore-scripts: ${line}`);
});

test('#472 by default the start log names npm ci without --ignore-scripts', { timeout: 60000 }, async (t) => {
  const events = await mockRun(t);
  const logs = startLogs(events);
  const line = logs.find((m) => m.includes('npm ci'));
  assert.ok(line, `a start log names npm ci: ${JSON.stringify(logs)}`);
  assert.equal(line.includes('--ignore-scripts'), false, line);
});
