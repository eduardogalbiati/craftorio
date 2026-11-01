// The code → tests map of an agent's checkout (#219, a step's `test_map: true`, writeTestMap of
// packages/engine/engine/run/test-requests.js), #705: a mock run builds it once per folder (its agents
// never change the checkout), a real run builds it again for each turn, so a turn sees the files
// committed since the last one. Seen from the map file written for the turn, on a fixture git project.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { WorkflowRun } = require('../engine/workflow');

const git = (cwd, ...args) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'init.defaultBranch=main', ...args], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const write = (dir, files) => {
  for (const [file, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
    fs.writeFileSync(path.join(dir, file), text);
  }
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'files');
};

const WORKFLOW = [
  'apiVersion: multiagent/v1',
  'kind: Workflow',
  'metadata:',
  '  name: fixture-test-map-705',
  'inputs:',
  '  repo_path:',
  '    type: string',
  '    required: true',
  'agents:',
  '  developer:',
  '    provider: claude',
  '    model: mock-model',
  '    working_dir: "{{ inputs.repo_path }}"',
  '    system_prompt: "You are the developer."',
  'steps:',
  '  - id: develop',
  '    agent: developer',
  '    test_map: true',
  '    prompt: "Implement the task."',
  '',
].join('\n');

// a project with src/a.js and its test, a run (mock or real) of a one-step workflow on it
function setup(t, mock) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-map-cache-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5 }));
  const repo = path.join(dir, 'repo');
  fs.mkdirSync(repo);
  git(repo, 'init', '-q');
  write(repo, { 'package.json': '{"name":"fx"}\n', 'src/a.js': 'exports.a = 1;\n', 'test/a.test.js': "require('../src/a');\n" });
  const file = path.join(dir, 'wf.yaml');
  fs.writeFileSync(file, WORKFLOW);
  const runsDir = path.join(dir, 'runs');
  const run = new WorkflowRun({ file, inputs: { repo_path: repo }, mock, runsDir, skillsDirs: [] });
  return { repo, run };
}

// two turns of the step, with src/b.js and its test committed between them → the two maps' text
function twoTurns(repo, run) {
  const first = fs.readFileSync(run.writeTestMap('developer'), 'utf8');
  write(repo, { 'src/b.js': 'exports.b = 1;\n', 'test/b.test.js': "require('../src/b');\n" });
  const second = fs.readFileSync(run.writeTestMap('developer'), 'utf8');
  return { first, second };
}

test('#705 a mock run writes the same code → tests map on every turn: the checkout is mapped once', (t) => {
  const { repo, run } = setup(t, true);
  const { first, second } = twoTurns(repo, run);
  assert.match(first, /src\/a\.js/);
  assert.doesNotMatch(first, /src\/b\.js/);
  assert.equal(second, first);
});

test('#705 a real run maps the checkout again on each turn: the second map has the file committed since the first', (t) => {
  const { repo, run } = setup(t, false);
  const { first, second } = twoTurns(repo, run);
  assert.doesNotMatch(first, /src\/b\.js/);
  assert.match(second, /src\/b\.js/);
  assert.match(second, /test\/b\.test\.js/);
});
