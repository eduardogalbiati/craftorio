// #469 (SEC-4): transition `action:` and `ship.build` are rendered with templates and run in a shell
// (exec), so agent output interpolated there unquoted is a command injection. The loader refuses
// unsafe interpolations (agent output that is not an integer of the output schema nor through a
// validating filter such as `github_repo` / `pr_url`), the bundled backlog-refresh action passes
// `inputs.project_path` safely, and `npm run check` flags an unsafe workflow action.
// #474 (SEC-9): nunjucks templates are unsandboxed: the loader refuses templates that reach
// `constructor`, `__proto__`, `require` or `process`; the same words in plain prose stay accepted.
// Seams: loadWorkflow (packages/engine/engine/run/load.js), runChecks/RULES
// (scripts/check.js). Every bundled workflow still loading is covered by
// test/workflow-rules-352.test.js ("every bundled workflow still loads without an error").
// The one-time import warning of #474 (non-bundled workflows/skills/seeds) has no unit seam yet: E2E.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { loadWorkflow } = require('../engine/run/load');

const root = path.join(__dirname, '..', '..', '..');

function tmpDir(t, prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

// What loadWorkflow says for a YAML text: null when it loads, else its error message
function errorOf(t, text) {
  const dir = tmpDir(t, 'tpl-safety-');
  const file = path.join(dir, 'wf.yaml');
  fs.writeFileSync(file, text);
  try { loadWorkflow(file); return null; } catch (e) { return e.message; }
}

// A small workflow: agent step x (plain text output), agent step ci (pr_url string, pr_number
// integer), a human gate whose approved transition carries `transition` (YAML lines, indented 8).
function workflow({ prompt = 'Build it.', message = 'Approve?', when = 'approved', transition = '' } = {}) {
  return `inputs:
  project_path:
    type: string
    default: ""
orchestrator:
  worktree:
    repo: "{{ inputs.project_path }}"
    base: main
agents:
  dev:
    provider: mock
steps:
  - id: x
    agent: dev
    prompt: ${JSON.stringify(prompt)}
    output_schema:
      type: object
      required: [text]
      properties:
        text: { type: string }
    transitions:
      - goto: ci
  - id: ci
    agent: dev
    prompt: Open the PR.
    output_schema:
      type: object
      required: [pr_url, pr_number]
      properties:
        pr_url:    { type: string }
        pr_number: { type: integer }
    transitions:
      - goto: gate
  - id: gate
    type: human_approval
    message: ${JSON.stringify(message)}
    transitions:
      - when: ${JSON.stringify(when)}
${transition}        goto: end
      - when: rejected
        goto: end
`;
}

// ---------------------------------------------------------------------------
// #469: unsafe interpolation in action / ship.build
// ---------------------------------------------------------------------------

test('#469 the test workflow shape loads as it is (baseline of the refusals below)', (t) => {
  assert.equal(errorOf(t, workflow()), null);
  assert.equal(errorOf(t, workflow({ transition: '        action: "git update-ref refs/x HEAD"\n' })), null);
  assert.equal(errorOf(t, workflow({ transition: '        ship: { tag: "v1", build: "npm run build" }\n' })), null);
});

test('#469 an action interpolating an agent step\'s plain text output is refused at load, naming action', (t) => {
  const err = errorOf(t, workflow({ transition: '        action: "echo {{ steps.x.output.text }}"\n' }));
  assert.notEqual(err, null, 'loadWorkflow must refuse the unsafe action');
  assert.match(err, /action/);
});

test('#469 a ship.build interpolating an agent step\'s plain text output is refused at load', (t) => {
  const err = errorOf(t, workflow({ transition: '        ship: { tag: "v1", build: "npm run build -- {{ steps.x.output.text }}" }\n' }));
  assert.notEqual(err, null, 'loadWorkflow must refuse the unsafe ship.build');
  assert.match(err, /build|ship/);
});

// release.tag is the rendered ship.tag: agent text put there must not reach the build's shell unquoted
test('#469 a ship.build reading release.tag is refused at load when ship.tag holds an agent step\'s plain text', (t) => {
  const err = errorOf(t, workflow({ transition: '        ship: { tag: "{{ steps.x.output.text }}", build: "echo {{ release.tag }}" }\n' }));
  assert.notEqual(err, null, 'agent text must not reach the build through release.tag');
});

test('#469 a ship.tag holding agent text still loads when the build does not read release', (t) => {
  assert.equal(errorOf(t, workflow({ transition: '        ship: { tag: "{{ steps.x.output.text }}", build: "npm run build" }\n' })), null);
});

test('#469 an action with an integer schema-typed output and the github_repo / pr_url filters still loads', (t) => {
  const action = 'gh pr merge {{ steps.ci.output.pr_number }} --repo {{ steps.ci.output.pr_url | github_repo }} --squash'
    + ' && node publish.js --pr-url {{ steps.ci.output.pr_url | pr_url }}';
  assert.equal(errorOf(t, workflow({ transition: `        action: ${JSON.stringify(action)}\n` })), null);
});

// backlog-refresh's apply actions pass inputs.project_path to a shell. Read from the loaded bundled
// workflow (YAML anchors resolved), every action that interpolates project_path.
function projectPathActions() {
  const wf = loadWorkflow(path.join(root, 'workflows', 'backlog-refresh.yaml'));
  return wf.steps.flatMap((s) => (s.transitions || []).map((tr) => tr.action))
    .filter((a) => a !== undefined && JSON.stringify(a).includes('inputs.project_path'));
}

test('#469 backlog-refresh no longer puts {{ inputs.project_path }} raw inside double quotes in an action', () => {
  const actions = projectPathActions();
  assert.ok(actions.length >= 1, 'backlog-refresh still has actions that pass the project path');
  const raw = actions.filter((a) => typeof a === 'string' && /"\{\{\s*inputs\.project_path\s*\}\}"/.test(a));
  assert.deepEqual(raw, []);
});

// `npm run check` flags an unsafe workflow action. Scratch roots with only workflows/<name>.yaml;
// typecheck skipped (it runs tsc: slow, and unrelated to a workflow file). The other rules may
// report the empty root: only lines naming the workflow file count.
async function checkFindings(t, name, yamlText) {
  const { RULES, runChecks } = require('../../../scripts/check.js');
  const dir = tmpDir(t, 'tpl-safety-check-');
  fs.mkdirSync(path.join(dir, 'workflows'));
  fs.writeFileSync(path.join(dir, 'workflows', name), yamlText);
  const rules = RULES.filter(([rule]) => rule !== 'typecheck');
  return (await runChecks(dir, rules)).filter((l) => l.includes(name));
}

test('#469 npm run check flags a workflow whose action interpolates agent output unsafely', async (t) => {
  const lines = await checkFindings(t, 'bad.yaml', workflow({ transition: '        action: "echo {{ steps.x.output.text }}"\n' }));
  assert.ok(lines.some((l) => /action/.test(l)), `a finding naming bad.yaml and action: ${JSON.stringify(lines)}`);
});

test('#469 npm run check has no finding for a workflow with a safe action', async (t) => {
  const action = 'gh pr merge {{ steps.ci.output.pr_number }} --repo {{ steps.ci.output.pr_url | github_repo }}';
  const lines = await checkFindings(t, 'good.yaml', workflow({ transition: `        action: ${JSON.stringify(action)}\n` }));
  assert.deepEqual(lines, []);
});

// ---------------------------------------------------------------------------
// #474: unsandboxed templates
// ---------------------------------------------------------------------------

const REFUSED = [
  ['a gate message calling the Function constructor', { message: "{{ ''.constructor.constructor('return process')() }}" }],
  ['a when: reaching constructor', { when: "approved and steps.x.output.text.constructor" }],
  ['a gate message reading __proto__', { message: '{{ steps.x.output.__proto__ }}' }],
  ['a prompt calling require', { prompt: "Read {{ require('fs') }}" }],
  ['a gate message reading process', { message: '{{ process.env.HOME }}' }],
  ['a {% set %} tag reaching constructor', { prompt: "{% set f = ''.constructor %}Build it." }],
];

for (const [name, parts] of REFUSED) {
  test(`#474 loadWorkflow refuses ${name}`, (t) => {
    assert.notEqual(errorOf(t, workflow(parts)), null, `refused: ${JSON.stringify(parts)}`);
  });
}

test('#474 constructor, __proto__, require and process in plain prose (outside {{ }} / {% %}) still load', (t) => {
  const prompt = 'Check the constructor of each class, avoid __proto__, do not require new packages, and stop any process you start.';
  assert.equal(errorOf(t, workflow({ prompt, message: 'The constructor and the process changed: approve?' })), null);
});
