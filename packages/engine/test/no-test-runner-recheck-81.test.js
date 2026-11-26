// #81 The "no test command" decision is checked again after each agent step, through a run: a step
// that adds a test runner (a package.json with a test script) routes like a project with a command,
// a step that removes it routes like one with none, and the run's log says when the decision changes.
//
// Seam: WorkflowRun.start on a fixture workflow (orchestrator.worktree on a temp folder, no worktreesDir:
// agents work in the folder), a real (non-simulated) machine whose provider is the mock one, and the
// agent turn answered by a stub of sendToAgent (the model boundary) that edits the folder as an agent
// would. Nothing is spawned and no model is called. The transitions read the context's
// `no_test_command`, as feature.yaml's code_review and fix.yaml's review routes do.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { WorkflowRun } = require('../engine/workflow');
const { real } = require('../engine/machine-actions');

const PACKAGE = '{"name":"p","scripts":{"test":"node --test"}}\n';

function tmp(t, prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5 }));
  return dir;
}

function fixture(dir) {
  const file = path.join(dir, 'wf.yaml');
  fs.writeFileSync(file, `
apiVersion: craftorio/v1
kind: Workflow
metadata: { name: fixture-no-test-command-81 }
inputs:
  repo: { type: string }
orchestrator:
  worktree: { repo: "{{ inputs.repo }}" }
agents:
  dev: { provider: claude, model: m, session: ephemeral }
steps:
  - id: develop
    agent: dev
    prompt: "change the project"
    output_schema: { type: object, required: [summary], properties: { summary: { type: string } } }
    transitions:
      - { when: "no_test_command", goto: skipped }
      - { when: "true", goto: tested }
  - id: skipped
    type: human_approval
    message: "skipped"
    transitions:
      - { when: approved, goto: end }
      - { when: rejected, goto: end }
  - id: tested
    type: human_approval
    message: "tested"
    transitions:
      - { when: approved, goto: end }
      - { when: rejected, goto: end }
`);
  return file;
}

// → { transitions: ['develop>tested'], logs: [messages] }; `agent(project)` is the develop step's edit
async function runWith(t, files, agent) {
  const project = tmp(t, 'no-runner-81-project-');
  for (const [rel, text] of Object.entries(files)) fs.writeFileSync(path.join(project, rel), text);
  const dir = tmp(t, 'no-runner-81-wf-');
  const machine = real();
  machine.provider = () => ({ type: 'mock' });
  const run = new WorkflowRun({ file: fixture(dir), inputs: { repo: project }, mock: false, runsDir: path.join(dir, 'runs'), skillsDirs: [], machine, memoryGuard: null });
  run.sendToAgent = async () => {
    agent(project);
    return { text: '```json\n{"summary":"done"}\n```' };
  };
  const transitions = [];
  const logs = [];
  run.on('event', (e) => {
    if (e.type === 'step.transition') transitions.push(`${e.from}>${e.to}`);
    if (e.type === 'log') logs.push(String(e.message));
    if (e.type === 'approval.requested') setImmediate(() => run.resolveApproval(e.approval_id, true));
  });
  await run.start();
  return { transitions, logs };
}

test('#81 run: a step that adds a test runner routes as a project with a test command, and the log says so', async (t) => {
  const { transitions, logs } = await runWith(t, { 'index.html': '<h1>hi</h1>\n' }, (p) => fs.writeFileSync(path.join(p, 'package.json'), PACKAGE));
  assert.equal(transitions.includes('develop>tested'), true, transitions.join(', '));
  assert.equal(logs.some((m) => /no test command/.test(m) && !/after step/.test(m)), true, 'the decision at the start is logged');
  assert.equal(logs.some((m) => /test command found after step develop/.test(m)), true, logs.join('\n'));
});

test('#81 run: a project with no test runner that a step leaves so routes as not tested', async (t) => {
  const { transitions, logs } = await runWith(t, { 'index.html': '<h1>hi</h1>\n' }, (p) => fs.writeFileSync(path.join(p, 'cardapio.html'), '<ul></ul>\n'));
  assert.equal(transitions.includes('develop>skipped'), true, transitions.join(', '));
  assert.equal(logs.some((m) => /after step develop/.test(m)), false, 'nothing changed: no new log');
});

test('#81 run: a step that removes the test runner routes as not tested, and the log names the step', async (t) => {
  const { transitions, logs } = await runWith(t, { 'package.json': PACKAGE }, (p) => fs.rmSync(path.join(p, 'package.json')));
  assert.equal(transitions.includes('develop>skipped'), true, transitions.join(', '));
  assert.equal(logs.some((m) => /no test command.*after step develop/.test(m)), true, logs.join('\n'));
});

test('#81 run: a project with a test command that a step keeps routes as tested, with no decision logged', async (t) => {
  const { transitions, logs } = await runWith(t, { 'package.json': PACKAGE }, (p) => fs.writeFileSync(path.join(p, 'index.html'), '<h1>hi</h1>\n'));
  assert.equal(transitions.includes('develop>tested'), true, transitions.join(', '));
  assert.equal(logs.some((m) => /no test command|test command found/.test(m)), false, logs.join('\n'));
});
