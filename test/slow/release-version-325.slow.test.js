// Release version (#325) in a release run: before the `unit` step, workflows/release.yaml writes the
// release's version into the project's package.json (src/domains/releases/releases.js); a mock run writes and commits
// nothing and its event says what it would set. The Ship gate and the review's "Before you ship"
// name the version change (e.g. "package.json 0.3.0 → 1.2.0"). A name that is not a semver, or a
// project without package.json, never stops the run: it goes on to `unit` and the ship gate.
// Observed through a mock WorkflowRun's events and the repository's files and commits, harness as in
// test/slow/release-summary-290.slow.test.js.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { WorkflowRun, loadWorkflow } = require('../../src/engine/workflow');
process.env.MULTIAGENT_MOCK_DELAY_SCALE = '0.02';

const WORKFLOW = path.join(__dirname, '..', '..', 'workflows', 'release.yaml');

const git = (cwd, ...args) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'init.defaultBranch=main', '-c', 'core.autocrlf=false', ...args], { cwd, stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim();

const PKG = '{\n  "name": "x",\n  "version": "0.3.0",\n  "scripts": { "test": "node --test" }\n}\n';

function makeRepo(t, files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'release-ver-repo-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5 }));
  git(dir, 'init', '-q');
  for (const [name, text] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), text);
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'base');
  return dir;
}

// #378: v1.9.0 on the base commit, v1.10.0 on a second one (HEAD): the semver order is not the text order
function tagRepo(repo) {
  git(repo, 'tag', 'v1.9.0');
  fs.writeFileSync(path.join(repo, 'later.txt'), 'later\n');
  git(repo, 'add', '-A');
  git(repo, 'commit', '-q', '-m', 'later');
  git(repo, 'tag', 'v1.10.0');
}

async function runRelease(t, { files = { 'package.json': PKG }, inputs: extra = {}, mockSequences = { suite: { unit: ['pass'], e2e: ['pass'] } }, setup = null } = {}) {
  const wf = loadWorkflow(WORKFLOW);
  const repo = makeRepo(t, files);
  if (setup) setup(repo);
  const runsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'release-ver-runs-'));
  t.after(() => fs.rmSync(runsDir, { recursive: true, force: true, maxRetries: 5 }));
  const inputs = {};
  for (const [k, def] of Object.entries(wf.inputs || {})) {
    if (def?.default !== undefined && def?.default !== '') continue;
    inputs[k] = /path|dir|repo|folder/i.test(k) ? repo : 'Release v1.0';
  }
  const run = new WorkflowRun({ file: WORKFLOW, inputs: { task: 'Release', repo_path: repo, project_path: repo, ...inputs, ...extra }, mock: true, runsDir, mockSequences });
  const events = [];
  run.on('event', (ev) => {
    events.push(ev);
    if (ev.type === 'approval.requested') {
      const answer = ev.step_id === 'ship' ? 'hold' : ev.choices?.[0]?.id ?? true;
      setImmediate(() => run.resolveApproval(ev.approval_id, answer, 'user', ''));
    }
  });
  await run.start();
  const started = events.filter((e) => e.type === 'step.started').map((e) => e.step_id);
  const shipGate = events.find((e) => e.type === 'approval.requested' && e.step_id === 'ship');
  const prompts = (stepId) => events.filter((e) => e.type === 'session.message_sent' && e.step_id === stepId).map((e) => String(e.prompt || ''));
  return { repo, events, started, shipGate, prompts };
}

// the version step's output (#378: its previous_version is release.yaml's `previous_version` output)
const versionOutput = (events) => events.filter((e) => e.type === 'step.finished' && e.step_id === 'version').map((e) => e.output).pop() || {};

test('release (mock): previous_version is the tag before the release in semver order, before Ship tags it (#378)', { timeout: 120000 }, async (t) => {
  const { events } = await runRelease(t, { inputs: { version: '1.11.0' }, setup: tagRepo });
  assert.equal(versionOutput(events).previous_version, 'v1.10.0');
});

test('release (mock): a release name that is not a semver gets the newest tag reachable from HEAD as previous_version (#378)', { timeout: 120000 }, async (t) => {
  const { events } = await runRelease(t, { inputs: { version: 'spring-cleanup' }, setup: tagRepo });
  assert.equal(versionOutput(events).previous_version, 'v1.10.0');
});

test('release (mock): a repository without tags has an empty previous_version (#378)', { timeout: 120000 }, async (t) => {
  const { events } = await runRelease(t, { inputs: { version: '1.2.0' } });
  assert.equal(versionOutput(events).previous_version, '');
});

// the events before the first `unit` step that are not a gate or a prompt
const beforeUnit = (events) => {
  const at = events.findIndex((e) => e.type === 'step.started' && e.step_id === 'unit');
  return events.slice(0, at < 0 ? events.length : at).filter((e) => e.type !== 'approval.requested' && e.type !== 'session.message_sent');
};

test('release (mock): before unit, an event says package.json would go from 0.3.0 to 1.2.0; nothing is written or committed (#325)', { timeout: 120000 }, async (t) => {
  const { repo, events, started, shipGate } = await runRelease(t, { inputs: { version: '1.2.0' } });
  const head = git(repo, 'rev-parse', 'HEAD');
  const said = beforeUnit(events).map((e) => JSON.stringify(e)).filter((s) => /package\.json/.test(s) && /0\.3\.0/.test(s) && /1\.2\.0/.test(s));
  assert.ok(said.length > 0, `an event before unit says what the version would become (steps: ${started.join(', ')})`);
  assert.equal(fs.readFileSync(path.join(repo, 'package.json'), 'utf8'), PKG, 'package.json is untouched in a mock run');
  assert.equal(git(repo, 'rev-list', '--count', '--all'), '1', 'no commit anywhere in the repository');
  assert.equal(git(repo, 'rev-parse', 'HEAD'), head);
  assert.ok(started.includes('unit'), 'the run goes on to unit');
  assert.ok(shipGate, 'the run reaches the ship gate');
});

test('release (mock): the Ship gate names the version change as part of what ships (#325)', { timeout: 120000 }, async (t) => {
  const { shipGate, started } = await runRelease(t, { inputs: { version: '1.2.0' } });
  assert.ok(shipGate, `the ship gate opened (steps: ${started.join(', ')})`);
  const message = String(shipGate.message || '');
  assert.ok(message.split('\n').some((l) => /package\.json/.test(l) && /0\.3\.0/.test(l) && /1\.2\.0/.test(l)), `a line of the Ship message names package.json 0.3.0 → 1.2.0:\n${message}`);
});

test('release (mock): the review prompt names the version change, not a mismatch to report (#325)', { timeout: 120000 }, async (t) => {
  const { prompts, started } = await runRelease(t, { inputs: { version: '1.2.0' }, mockSequences: { suite: { unit: ['fail', 'pass'], e2e: ['pass'] } } });
  const prompt = prompts('review').join('\n');
  assert.ok(prompt, `review ran (steps: ${started.join(', ')})`);
  assert.ok(prompt.split('\n').some((l) => /package\.json/.test(l) && /0\.3\.0/.test(l) && /1\.2\.0/.test(l)), 'a line of the review prompt names package.json 0.3.0 → 1.2.0');
});

test('release (mock): an empty version input (release-<run id>) writes nothing, says why, and the run goes on (#325)', { timeout: 120000 }, async (t) => {
  const { repo, events, started, shipGate } = await runRelease(t, { inputs: { version: '' } });
  const said = beforeUnit(events).map((e) => JSON.stringify(e)).filter((s) => /package\.json|version/i.test(s) && /release-\d/.test(s));
  assert.ok(said.length > 0, `an event before unit says the release name is not a version (steps: ${started.join(', ')})`);
  assert.equal(fs.readFileSync(path.join(repo, 'package.json'), 'utf8'), PKG);
  assert.ok(started.includes('unit'));
  assert.ok(shipGate, 'the run reaches the ship gate');
});

test('release (mock): a project without package.json goes on to unit and the ship gate (#325)', { timeout: 120000 }, async (t) => {
  const { started, shipGate } = await runRelease(t, { files: { 'pyproject.toml': '[project]\nname = "x"\nversion = "0.3.0"\n' }, inputs: { version: '1.2.0', unit_command: 'pytest' } });
  assert.ok(started.includes('unit'), `the run reached unit (steps: ${started.join(', ')})`);
  assert.ok(shipGate, 'the run reaches the ship gate');
});
