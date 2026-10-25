// #353: simulation is an injected adapter, not `this.mock` branches in the engine. The machine
// actions (git, local merge, push/ship, PR reads (probes), the suite's and the actions' commands,
// opening a preview (screenshots)) and the provider choice have a real implementation and a
// simulated one, packages/engine/engine/machine-actions.js's real() and simulated({ sequences }), each with
// `simulated: true|false`. WorkflowRun takes it as its `machine` option (the same way it takes
// `probe` today), picks the one matching `mock` when none is given, exposes it as `run.machine`, and
// refuses a mismatch (a real run with the simulated adapter, or the reverse).
// Seams: the module's exports, WorkflowRun's constructor and `machine`, the events of a small mock
// run, the source files of packages/engine/engine/run/ (the branch count), docs/agents/testing.md.
// The events of a whole simulated run, before and after: test/slow/simulation-adapters-353.slow.test.js.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { WorkflowRun } = require('../engine/workflow');

process.env.MULTIAGENT_MOCK_DELAY_SCALE = process.env.MULTIAGENT_MOCK_DELAY_SCALE || '0.02';
const root = path.join(__dirname, '..', '..', '..');
const RUN_DIR = path.join(root, 'packages', 'engine', 'engine', 'run');
const FIXTURE = path.join(__dirname, 'fixtures', 'conditional-action.yaml');
// the module the change creates: loaded inside each test
const load = () => require('../engine/machine-actions');
const METHODS = ['git', 'mergeLocal', 'ship', 'runAction', 'probe', 'runSuite', 'captureScreenshots', 'provider'];

function tempDir(t, prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}
// a command that leaves a file behind when it really runs
const markerCommand = (dir) => `node -e "require('fs').writeFileSync(require('path').join(process.argv[1], 'ran.txt'), 'x')" "${dir}"`;
const ran = (dir) => fs.existsSync(path.join(dir, 'ran.txt'));

// ---- the adapters ---------------------------------------------------------------------------

test('#353 machine-actions exports a real and a simulated adapter with the same operations', () => {
  const { real, simulated } = load();
  const r = real();
  const s = simulated();
  assert.equal(r.simulated, false);
  assert.equal(s.simulated, true);
  for (const m of METHODS) {
    assert.equal(typeof r[m], 'function', `real().${m}`);
    assert.equal(typeof s[m], 'function', `simulated().${m}`);
  }
});

test('#353 the simulated action does not run its command and says it was skipped', async (t) => {
  const dir = tempDir(t, 'sim-353-action-');
  const r = await load().simulated().runAction(markerCommand(dir), { cwd: dir });
  assert.equal(r.skipped, true);
  assert.match(String(r.output), /\[mock\] action not executed/);
  assert.equal(ran(dir), false, 'the command was not run');
});

test('#353 the real action runs its command', async (t) => {
  const dir = tempDir(t, 'sim-353-action-real-');
  await load().real().runAction(markerCommand(dir), { cwd: dir });
  assert.equal(ran(dir), true);
});

test('#353 the simulated local merge and ship are skipped: nothing merged, pushed or tagged', async () => {
  const s = load().simulated();
  const merge = await s.mergeLocal({ dir: path.join(os.tmpdir(), 'no-such-worktree-353'), branch: 'feat', base: 'main' });
  assert.equal(merge.skipped, true);
  assert.match(String(merge.output), /\[mock\] local merge not executed/);
  const ship = await s.ship({ tag: 'v1.2.3', dir: path.join(os.tmpdir(), 'no-such-repo-353') });
  assert.equal(ship.skipped, true);
  assert.match(String(ship.output), /\[mock\] release not pushed, not tagged/);
});

test('#353 simulated git runs no git: it answers even for a folder that does not exist, where real git fails', async () => {
  const { real, simulated } = load();
  const missing = path.join(os.tmpdir(), `no-such-repo-353-${process.pid}`);
  await assert.doesNotReject(() => Promise.resolve(simulated().git(['rev-parse', 'HEAD'], missing)));
  await assert.rejects(() => Promise.resolve(real().git(['rev-parse', 'HEAD'], missing)));
});

test('#353 the simulated PR read follows the run\'s probe sequence, then the default one, and a baseline reads nothing', async () => {
  const { simulated } = load();
  const s = simulated({ sequences: { probes: { wait: ['pending', 'merged'] } } });
  const states = [];
  for (let i = 0; i < 3; i++) states.push((await s.probe({ probe: 'pr_merged', stepId: 'wait' })).state);
  assert.deepEqual(states, ['pending', 'merged', 'merged']);
  assert.match((await simulated().probe({ probe: 'pr_checks', stepId: 'ci' })).detail, /^\(simulated\) pr_checks: pending$/);
  const defaults = simulated();
  const seq = [];
  for (let i = 0; i < 4; i++) seq.push((await defaults.probe({ probe: 'pr_checks', stepId: 'ci' })).state);
  assert.deepEqual(seq, ['pending', 'failed', 'pending', 'passed']);
  assert.deepEqual(await simulated().probe({ probe: 'pr_checks', stepId: 'ci', baseline: true }), {});
});

test('#353 the simulated suite runs no command and reports the result it is given', async (t) => {
  const dir = tempDir(t, 'sim-353-suite-');
  const runDir = tempDir(t, 'sim-353-suite-run-');
  const s = load().simulated();
  const pass = await s.runSuite({ command: markerCommand(dir), cwd: dir, runDir, round: 1, mockResult: 'pass' });
  const fail = await s.runSuite({ command: markerCommand(dir), cwd: dir, runDir, round: 2, mockResult: 'fail' });
  assert.equal(pass.status, 'pass');
  assert.equal(fail.status, 'fail');
  assert.equal(ran(dir), false, 'the suite\'s command was not run');
});

test('#353 the simulated preview captures nothing', async (t) => {
  const runDir = tempDir(t, 'sim-353-shots-');
  const out = await load().simulated().captureScreenshots({ entries: [{ name: 'home', view: 'home' }], cwd: root, runDir, folder: 'build', round: 1 });
  assert.equal(out.taken, 0);
  assert.match(String(out.reason), /simulated run/);
});

test('#353 the provider choice: the simulated adapter gives every agent the mock provider, the real one the workflow\'s', () => {
  const { real, simulated } = load();
  const providers = { claude: { type: 'claude-code' }, codex: { type: 'codex-cli' } };
  assert.equal(simulated().provider({ provider: 'claude' }, providers).type, 'mock');
  assert.equal(simulated().provider({ provider: 'codex' }, providers).type, 'mock');
  assert.equal(real().provider({ provider: 'codex' }, providers).type, 'codex-cli');
});

test('#353 simulated action_errors fail the first n transitions of that step only, with a merge or an action message', () => {
  const s = load().simulated({ sequences: { action_errors: { deploy: 2, land: 1 } } });
  assert.throws(() => s.transitionFault({ stepId: 'deploy', action: 'npm run deploy' }), /^Error: \(simulated\) action failed: npm run deploy$/);
  assert.throws(() => s.transitionFault({ stepId: 'deploy', action: 'npm run deploy' }), /action failed: npm run deploy/);
  assert.doesNotThrow(() => s.transitionFault({ stepId: 'deploy', action: 'npm run deploy' }));
  assert.throws(() => s.transitionFault({ stepId: 'land', merge: true }), /\(simulated\) local merge: the branch conflicts with the local base/);
  assert.doesNotThrow(() => s.transitionFault({ stepId: 'land', merge: true }));
  assert.doesNotThrow(() => s.transitionFault({ stepId: 'other', action: 'x' }));
  assert.doesNotThrow(() => load().simulated().transitionFault({ stepId: 'deploy', action: 'x' }));
  assert.doesNotThrow(() => load().real().transitionFault({ stepId: 'deploy', action: 'x' }));
});

test('#353 the real local merge refuses a run without a git worktree', async () => {
  await assert.rejects(() => load().real().mergeLocal({ repo: root, dir: null, base: 'main' }), /merge: local needs the run's git worktree/);
});

test('#353 the real ship guard runs the check, the simulated one never does', () => {
  const { real, simulated } = load();
  let calls = 0;
  const check = () => { calls++; throw new Error('not approved by the owner'); };
  assert.throws(() => real().guardShip(check), /not approved by the owner/);
  assert.equal(calls, 1);
  assert.doesNotThrow(() => simulated().guardShip(check));
  assert.equal(calls, 1, 'the simulated guard did not call the check');
});

test('#353 the real affected tests add the earlier failures that still exist, sorted', (t) => {
  const repo = tempDir(t, 'sim-353-affected-');
  const sh = (...args) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd: repo, stdio: 'ignore', windowsHide: true });
  const write = (f, s) => { fs.mkdirSync(path.dirname(path.join(repo, f)), { recursive: true }); fs.writeFileSync(path.join(repo, f), s); };
  write('src/a.js', 'module.exports = 1;\n');
  write('src/b.js', 'module.exports = 2;\n');
  write('test/a.test.js', "require('../src/a');\n");
  write('test/0-old.test.js', "require('../src/b');\n");
  sh('init', '-q', '-b', 'main');
  sh('add', '-A');
  sh('commit', '-q', '-m', 'base');
  write('src/a.js', 'module.exports = 3;\n');
  const sel = load().real().affectedTests({ root: repo, base: 'main', failed: ['test/gone.test.js', 'test/a.test.js', 'test/0-old.test.js'] });
  assert.equal(sel.mode, 'affected');
  assert.deepEqual(sel.files, ['test/0-old.test.js', 'test/a.test.js']);
  assert.equal(sel.reasons['test/0-old.test.js'], 'failed in an earlier round');
  assert.equal(sel.reasons['test/a.test.js'], 'imports src/a.js');
});

test('#353 the real affected tests are the whole suite without a worktree or a base', () => {
  const sel = load().real().affectedTests({ root: null, base: 'main', failed: ['test/a.test.js'] });
  assert.equal(sel.mode, 'all');
  assert.deepEqual(sel.files, []);
});

// ---- injection at run creation --------------------------------------------------------------

test('#353 an injected simulated adapter keeps its own sequences: the run\'s mockSequences do not reach it', (t) => {
  const { simulated } = load();
  const runsDir = tempDir(t, 'sim-353-runs-');
  const mockSequences = { action_errors: { gate: 1 } };
  const own = new WorkflowRun({ file: FIXTURE, inputs: {}, mock: true, runsDir, skillsDirs: [], mockSequences, machine: simulated() });
  assert.doesNotThrow(() => own.machine.transitionFault({ stepId: 'gate', action: 'x' }));
  const dflt = new WorkflowRun({ file: FIXTURE, inputs: {}, mock: true, runsDir, skillsDirs: [], mockSequences });
  assert.throws(() => dflt.machine.transitionFault({ stepId: 'gate', action: 'x' }), /\(simulated\) action failed: x/);
});

test('#353 a run gets the adapter matching mock when none is given', (t) => {
  const runsDir = tempDir(t, 'sim-353-runs-');
  assert.equal(new WorkflowRun({ file: FIXTURE, inputs: {}, mock: true, runsDir, skillsDirs: [] }).machine?.simulated, true);
  assert.equal(new WorkflowRun({ file: FIXTURE, inputs: {}, mock: false, runsDir, skillsDirs: [] }).machine?.simulated, false);
});

test('#353 a real run never takes the simulated adapter, and a simulated run never takes the real one', (t) => {
  const { real, simulated } = load();
  const runsDir = tempDir(t, 'sim-353-runs-');
  assert.throws(() => new WorkflowRun({ file: FIXTURE, inputs: {}, mock: false, runsDir, skillsDirs: [], machine: simulated() }), /simulat/i);
  assert.throws(() => new WorkflowRun({ file: FIXTURE, inputs: {}, mock: true, runsDir, skillsDirs: [], machine: real() }), /simulat|real/i);
});

test('#353 the injected adapter runs the run\'s machine actions', async (t) => {
  const { simulated } = load();
  const runsDir = tempDir(t, 'sim-353-runs-');
  const machine = simulated();
  const commands = [];
  const runAction = machine.runAction.bind(machine);
  machine.runAction = (cmd, opts) => { commands.push(cmd); return runAction(cmd, opts); };
  const run = new WorkflowRun({ file: FIXTURE, inputs: { cleanup: true }, mock: true, runsDir, skillsDirs: [], machine });
  assert.equal(run.machine === machine, true, 'run.machine is the adapter passed in');
  const events = [];
  run.on('event', (ev) => {
    events.push(ev);
    if (ev.type === 'approval.requested') setImmediate(() => run.resolveApproval(ev.approval_id, true));
  });
  await run.start();
  assert.equal(commands.length, 1, 'the action went through the injected adapter');
  assert.match(commands[0], /publish\.js" --cleanup/);
  const executed = events.filter((e) => e.type === 'action.executed');
  assert.deepEqual(executed.map((e) => [e.skipped, e.output]), [[true, '[mock] action not executed']]);
});

// ---- the safety rule ------------------------------------------------------------------------

test('#353 with simulation only, a real run is still refused before any CLI starts', async (t) => {
  const before = process.env.MULTIAGENT_SIMULATION_ONLY;
  process.env.MULTIAGENT_SIMULATION_ONLY = '1';
  t.after(() => { if (before === undefined) delete process.env.MULTIAGENT_SIMULATION_ONLY; else process.env.MULTIAGENT_SIMULATION_ONLY = before; });
  const dir = tempDir(t, 'sim-353-wf-');
  const file = path.join(dir, 'wf.yaml');
  fs.writeFileSync(file, [
    'apiVersion: multiagent/v1', 'kind: Workflow', 'metadata: { name: real-353 }',
    // a command that does not exist: even a broken guard could not reach a real model
    'providers:', '  claude: { type: claude-code, command: claude-not-installed-353, args: ["-p"] }',
    'agents:', '  a: { provider: claude, model: m, session: ephemeral }',
    'steps:', '  - id: work', '    agent: a', '    prompt: "do it"', '',
  ].join('\n'));
  const run = new WorkflowRun({ file, inputs: {}, mock: false, runsDir: tempDir(t, 'sim-353-runs-'), skillsDirs: [] });
  const events = [];
  run.on('event', (ev) => events.push(ev));
  await run.start().catch(() => {});
  assert.match(JSON.stringify(events),/Simulation only \(MULTIAGENT_SIMULATION_ONLY=1\): refusing to start the claude-code provider/);
  assert.equal(events.some((e) => e.type === 'step.completed' && e.step_id === 'work' && e.status === 'success'), false);
});

// ---- the branches go ------------------------------------------------------------------------

// The only places in packages/engine/engine/run/ that may still read `this.mock`: where the run records whether
// it is simulated. This list may only shrink.
const ALLOWED = {};

test('#353 no this.mock checks remain in packages/engine/engine/run/ outside the allowed places', () => {
  const files = fs.readdirSync(RUN_DIR).filter((f) => f.endsWith('.js')).sort();
  assert.ok(files.length > 0);
  const found = {};
  for (const f of files) {
    const n = [...fs.readFileSync(path.join(RUN_DIR, f), 'utf8').matchAll(/this\.mock\b(?![\w$])/g)].length;
    if (n) found[f] = n;
  }
  const over = Object.entries(found).filter(([f, n]) => n > (ALLOWED[f] || 0)).map(([f, n]) => `${f}: ${n} (allowed ${ALLOWED[f] || 0})`);
  assert.deepEqual(over, [], 'this.mock checks in packages/engine/engine/run/');
});

// ---- docs -----------------------------------------------------------------------------------

test('#353 docs/agents/testing.md documents the simulated machine actions', () => {
  const doc = fs.readFileSync(path.join(root, 'docs', 'agents', 'testing.md'), 'utf8');
  assert.match(doc, /packages\/engine\/engine\/machine-actions\.js/);
  assert.match(doc, /simulated machine actions/i);
});
