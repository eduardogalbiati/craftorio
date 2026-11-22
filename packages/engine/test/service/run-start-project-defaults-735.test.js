// #735: run:start with a projectId fills the inputs the dialog didn't send with the project's run
// defaults before the workflow's own (a backend project's empty ui_folders never becomes the
// workflow's [src/renderer/]); a value the dialog sent wins over the project's.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { makeService } = require('./helpers');

const emptyConfig = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'gitcfg-735-start-')), 'config');
fs.writeFileSync(emptyConfig, '');
process.env.GIT_CONFIG_GLOBAL = emptyConfig;
process.env.GIT_CONFIG_NOSYSTEM = '1';
const git = (cwd, ...args) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd, stdio: ['ignore', 'pipe', 'pipe'] });

const FIXTURE = `apiVersion: craftorio/v1
kind: Workflow
metadata: { name: fixture-run-start-735 }
inputs:
  mode: { type: string, enum: [local, remote], default: local }
  ui_folders: { type: array, default: [src/renderer/] }
  steps_folders: { type: array, default: [features/steps] }
  test_command: { type: string, default: "" }
providers:
  claude:
    type: claude-code
    command: claude
    args: ["-p", "--output-format", "stream-json", "--verbose"]
agents:
  a: { provider: claude, session: ephemeral, timeout: 10m }
steps:
  - id: work
    agent: a
    prompt: "do the work"
`;

function rustFolder(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'run-start-735-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(dir, 'Cargo.toml'), '[package]\nname = "svc"\nversion = "0.1.0"\nedition = "2021"\n');
  fs.mkdirSync(path.join(dir, 'src'));
  fs.writeFileSync(path.join(dir, 'src', 'main.rs'), 'fn main() {}\n');
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'add', '.');
  git(dir, 'commit', '-q', '-m', 'init');
  return dir;
}

async function startedInputs(t, inputs) {
  const { service, api } = makeService(t);
  fs.writeFileSync(path.join(service.workspace().workflows, 'fixture-run-start-735.yaml'), FIXTURE);
  const p = await api['projects:create']({ name: 'Rusty', folder: rustFolder(t) });
  const finished = new Promise((resolve) => {
    service.events.on('run:event', (ev) => { if (ev.type === 'workflow.finished') resolve(ev); });
  });
  const { runDir } = await api['run:start']({ file: 'fixture-run-start-735.yaml', inputs, mock: true, projectId: p.id });
  await finished;
  const events = fs.readFileSync(path.join(runDir, 'events.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  return events.find((e) => e.type === 'workflow.started').inputs;
}

test('#735 run:start of a backend project without ui_folders runs with no UI folders and no step folders', async (t) => {
  const inputs = await startedInputs(t, {});
  assert.deepEqual([JSON.stringify(inputs.ui_folders), JSON.stringify(inputs.steps_folders)], ['[]', '[]']);
});

test('#735 run:start of a Rust project fills the test command from the project (cargo test)', async (t) => {
  const inputs = await startedInputs(t, { test_command: '' });
  assert.equal(inputs.test_command, 'cargo test');
});

test('#735 run:start keeps a value the dialog sent over the project\'s', async (t) => {
  const inputs = await startedInputs(t, { test_command: 'cargo nextest run', ui_folders: ['ui/'] });
  assert.deepEqual([inputs.test_command, JSON.stringify(inputs.ui_folders)], ['cargo nextest run', '["ui/"]']);
});
