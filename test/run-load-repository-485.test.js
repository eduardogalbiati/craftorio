// #485: loading a repository workflow (src/engine/run/load.js): refused when not accepted, and its
// capabilities capped. Acceptance tests, written before the code.
//
// Spec (the interface these tests assume):
//   const { loadRepositoryWorkflow } = require('../src/engine/run/load');
//   loadRepositoryWorkflow(file, { accepted, policy }) -> the workflow, as loadWorkflow(file) returns it
//     file: the workflow's path in the run's base checkout (<checkout>/.multiagent/workflows/x.yaml)
//     accepted: whether the owner accepted this file at this commit; false -> throws an error that
//       says it is not accepted and names the workflow (metadata.name or the file's name).
//     policy: the workspace's tool policy, { tools: [...] } (the capabilities' tool vocabulary:
//       read, edit, write, bash, bash:<command>).
//     Caps, each a thrown error with its reason:
//       - no `ship:` anywhere (the error says ship);
//       - no `action:` that would run outside the run's worktree: a workflow with an action and no
//         orchestrator.worktree is refused (the error says action and worktree);
//       - an agent's (or a step's) tools within policy.tools: a tool beyond it is refused, the error
//         names the tool and the policy.
//   Everything loadWorkflow checks still applies.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { loadWorkflow } = require('../src/engine/run/load');
const { tempDir } = require('./repo-workflow-fixtures-485');

const load = () => require('../src/engine/run/load');
const POLICY = { tools: ['read', 'edit', 'write', 'bash:git', 'bash:npm'] };

const HEAD = (name) => `apiVersion: multiagent/v1
kind: Workflow
metadata:
  name: ${name}
inputs:
  repo_path: { type: string, required: true }
`;
const WORKTREE = `orchestrator:
  worktree:
    repo: "{{ inputs.repo_path }}"
    base: main
    remote: false
`;
const agents = (tools) => `agents:
  a: { provider: claude, model: m, session: ephemeral, capabilities: { tools: [${tools}] } }
`;

const FIXTURES = {
  plain: HEAD('repo-flow') + WORKTREE + agents('read, bash:git') + `steps:
  - id: work
    agent: a
    prompt: "do the work"
`,
  ship: HEAD('ship-flow') + WORKTREE + agents('read') + `steps:
  - id: work
    agent: a
    prompt: "do the work"
  - id: decide
    type: human_approval
    message: "Ship it?"
    choices:
      - { id: ship, label: Ship }
      - { id: hold, label: Hold }
    transitions:
      - when: "choice == 'ship'"
        ship: { tag: "v1" }
        goto: end
      - when: "choice == 'hold'"
        goto: end
`,
  actionNoWorktree: HEAD('action-flow') + agents('read') + `steps:
  - id: work
    agent: a
    prompt: "do the work"
    transitions:
      - action: "git status"
        goto: end
`,
  actionInWorktree: HEAD('action-wt-flow') + WORKTREE + agents('read') + `steps:
  - id: work
    agent: a
    prompt: "do the work"
    transitions:
      - action: "git status"
        goto: end
`,
  anyCommand: HEAD('bash-flow') + WORKTREE + agents('read, bash') + `steps:
  - id: work
    agent: a
    prompt: "do the work"
`,
  stepTools: HEAD('step-tools-flow') + WORKTREE + agents('read') + `steps:
  - id: work
    agent: a
    prompt: "do the work"
    capabilities: { tools: [read, "bash:curl"] }
`,
};

function write(t) {
  const dir = path.join(tempDir(t, 'repo-load-485-'), '.multiagent', 'workflows');
  fs.mkdirSync(dir, { recursive: true });
  const files = {};
  const names = { plain: 'repo-flow', ship: 'ship-flow', actionNoWorktree: 'action-flow', actionInWorktree: 'action-wt-flow', anyCommand: 'bash-flow', stepTools: 'step-tools-flow' };
  for (const [k, text] of Object.entries(FIXTURES)) {
    files[k] = path.join(dir, `${names[k]}.yaml`);
    fs.writeFileSync(files[k], text);
  }
  return files;
}

test('#485 the fixtures are valid workflows for the engine (guards the fixtures, passes before the change)', (t) => {
  const files = write(t);
  for (const [k, file] of Object.entries(files)) assert.doesNotThrow(() => loadWorkflow(file), k);
});

test('#485 loadRepositoryWorkflow: an accepted workflow within the caps loads like loadWorkflow', (t) => {
  const { loadRepositoryWorkflow } = load();
  const files = write(t);
  const wf = loadRepositoryWorkflow(files.plain, { accepted: true, policy: POLICY });
  assert.equal(wf.metadata.name, 'repo-flow');
  assert.deepEqual(wf.steps.map((s) => s.id), ['work']);
  assert.equal(loadRepositoryWorkflow(files.actionInWorktree, { accepted: true, policy: POLICY }).metadata.name, 'action-wt-flow', 'an action in the run\'s worktree is allowed');
});

test('#485 loadRepositoryWorkflow: an unaccepted workflow is refused, the error naming it', (t) => {
  const { loadRepositoryWorkflow } = load();
  const files = write(t);
  assert.throws(() => loadRepositoryWorkflow(files.plain, { accepted: false, policy: POLICY }), (e) => /not accepted/i.test(e.message) && /repo-flow/.test(e.message));
});

test('#485 loadRepositoryWorkflow: ship is refused, with the reason', (t) => {
  const { loadRepositoryWorkflow } = load();
  const files = write(t);
  assert.throws(() => loadRepositoryWorkflow(files.ship, { accepted: true, policy: POLICY }), (e) => /ship/i.test(e.message) && /repositor/i.test(e.message));
});

test('#485 loadRepositoryWorkflow: an action that would run outside the worktree is refused, with the reason', (t) => {
  const { loadRepositoryWorkflow } = load();
  const files = write(t);
  assert.throws(() => loadRepositoryWorkflow(files.actionNoWorktree, { accepted: true, policy: POLICY }), (e) => /action/i.test(e.message) && /worktree/i.test(e.message));
});

test('#485 loadRepositoryWorkflow: tools beyond the workspace policy are refused, naming the tool', (t) => {
  const { loadRepositoryWorkflow } = load();
  const files = write(t);
  assert.throws(() => loadRepositoryWorkflow(files.anyCommand, { accepted: true, policy: POLICY }), (e) => /\bbash\b/.test(e.message) && /polic/i.test(e.message));
  assert.throws(() => loadRepositoryWorkflow(files.stepTools, { accepted: true, policy: POLICY }), (e) => /bash:curl/.test(e.message) && /polic/i.test(e.message));
});

// Without a policy in the settings, the default policy is the tools the bundled workflows give their
// agents: read, edit, write and their bash:<command>s, never `bash` (any command).
test('#485 the default tool policy holds read, edit, write and the bundled workflows\' bash commands, never bash alone', () => {
  const { repositoryToolPolicy } = load();
  const policy = Array.from(repositoryToolPolicy());
  for (const tool of ['read', 'edit', 'write', 'bash:git', 'bash:npm']) assert.equal(policy.includes(tool), true, tool);
  assert.equal(policy.includes('bash'), false, 'bash (any command) is never in the default policy');
  assert.equal(policy.includes('bash:curl'), false, 'a command no bundled workflow uses');
  assert.equal(policy.every((t) => ['read', 'edit', 'write'].includes(t) || t.startsWith('bash:')), true, policy.join(', '));
  // current behaviour, until the owner decides otherwise: the bundled flows' GitHub / GitLab CLIs are in
  assert.equal(policy.includes('bash:gh'), true, 'bash:gh');
  assert.equal(policy.includes('bash:glab'), true, 'bash:glab');
});

test('#485 without a policy, the default policy applies: a bundled-like workflow loads, bash alone is refused', (t) => {
  const { loadRepositoryWorkflow } = load();
  const files = write(t);
  assert.equal(loadRepositoryWorkflow(files.plain, { accepted: true }).metadata.name, 'repo-flow');
  assert.throws(() => loadRepositoryWorkflow(files.anyCommand, { accepted: true }), (e) => /\bbash\b/.test(e.message) && /polic/i.test(e.message));
});

test('#485 this repository\'s own ai-development-local-hero copy loads once accepted, under the default policy', () => {
  const { loadRepositoryWorkflow } = load();
  const file = path.join(__dirname, '..', '.multiagent', 'workflows', 'ai-development-local-hero.yaml');
  const wf = loadRepositoryWorkflow(file, { accepted: true });
  assert.equal(wf.metadata.name, 'ai-development-local-hero');
  assert.throws(() => loadRepositoryWorkflow(file, { accepted: false }), (e) => /not accepted/i.test(e.message) && /ai-development-local-hero/.test(e.message));
});
