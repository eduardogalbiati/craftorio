// #472 (SEC-7) through the service: what decides "install dependencies without running their scripts"
// for a run started with run:start. A repo_path given as a git URL with no project holding the setting
// is a repository the app cloned, not the user's checkout: the setting is on and the run says so in a
// notice; a project's own setting (saved through projects:update) decides otherwise. The clone
// itself (workspace.cloneRepo, network) is replaced by a folder of the test.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const workspace = require('../../domains/workspace/workspace');
const { makeService } = require('./helpers');

const WORKFLOW = [
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
].join('\n');

// A repository folder with an npm lockfile (its install is `npm ci`)
function repoDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'svc-472-repo-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5 }));
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'p' }));
  fs.writeFileSync(path.join(dir, 'package-lock.json'), '{}');
  return dir;
}

// Starts a mock run and resolves with its log messages once it has finished
async function runLogs(t, service, api, repoPath) {
  fs.writeFileSync(path.join(service.workspace().workflows, 'scripts-472.yaml'), WORKFLOW);
  const events = [];
  let resolveDone;
  const done = new Promise((r) => { resolveDone = r; });
  const onEv = (ev) => { events.push(ev); if (ev.type === 'workflow.finished') resolveDone(); };
  service.events.on('run:event', onEv);
  t.after(() => service.events.off('run:event', onEv));
  const { runId } = await api['run:start']({ file: 'scripts-472.yaml', inputs: { repo_path: repoPath }, mock: true });
  await done;
  return events.filter((e) => e.run_id === runId && e.type === 'log').map((e) => String(e.message || ''));
}

const installLine = (logs) => logs.find((m) => m.includes('npm ci')) || '';

test('#472 a run whose repo_path is a URL with no project installs with --ignore-scripts and says so', { timeout: 60000 }, async (t) => {
  const { service, api } = makeService(t);
  const cloned = repoDir(t);
  t.mock.method(workspace, 'cloneRepo', async () => ({ dir: cloned, cloned: true }));
  const logs = await runLogs(t, service, api, 'https://github.com/o/r.git');
  assert.equal(installLine(logs).includes('--ignore-scripts'), true, JSON.stringify(logs));
  assert.equal(logs.some((m) => /ignore-scripts/.test(m) && /cloned/i.test(m)), true, `a notice says why: ${JSON.stringify(logs)}`);
});

test('#472 a run on a project of the user\'s own installs with the scripts, without the notice', { timeout: 60000 }, async (t) => {
  const { service, api } = makeService(t);
  const repo = repoDir(t);
  await api['projects:create']({ name: 'mine', folder: repo });
  const logs = await runLogs(t, service, api, repo);
  assert.ok(installLine(logs), JSON.stringify(logs));
  assert.equal(logs.some((m) => m.includes('--ignore-scripts')), false, JSON.stringify(logs));
});

test('#472 a project with the setting saved through projects:update installs with --ignore-scripts', { timeout: 60000 }, async (t) => {
  const { service, api } = makeService(t);
  const repo = repoDir(t);
  const p = await api['projects:create']({ name: 'mine', folder: repo });
  await api['projects:update']({ id: p.id, patch: { ignoreInstallScripts: true } });
  const logs = await runLogs(t, service, api, repo);
  assert.equal(installLine(logs).includes('--ignore-scripts'), true, JSON.stringify(logs));
});
