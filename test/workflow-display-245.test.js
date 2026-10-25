// #245 "Readable names everywhere": the workflow side. Acceptance tests written before the code.
//
// - The workflow loader (src/engine/workflow.js loadWorkflow) accepts an optional `display` on each
//   agent (`agents.<key>.display`) and each step (`steps[].display`): a string of at most 40
//   characters (40 accepted, 41 refused); anything else (a number, a list, an object) is refused.
// - The run's `workflow.started` event carries the names of its agents and steps, so a past run keeps
//   its own version's names. THE SHAPE (chosen here, the developer follows it):
//
//       event.display = {
//         agents: { <agent key>: '<name>' },   // every agent of the run
//         steps:  { <step id>:   '<name>' },   // every step of the workflow
//       }
//
//   each name being the YAML's `display` when set, else displayName(<id>) from
//   src/renderer/display-name.js ("verify_change" → "Verify change").
// - src/domains/run/runs.js readRun gives the renderer those names: `stepNames` (step id → name, from
//   display.steps) and `agentNames` (agent key → name: display.agents, the Agents menu's own names
//   from `agent_names` winning over them).
// - The bundled workflows (workflows/*.yaml) name their key steps: red_check "Red check (tests fail
//   first)", the Run suite (E2E) step of ai-development-local-hero (`e2e`) "Run suite (E2E)", verify_change
//   "Final verification"; every `display` they carry is a string of at most 40 characters.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const yaml = require('js-yaml');
const { WorkflowRun, loadWorkflow } = require('../src/engine/workflow');
const { displayName } = require('@multiagent/shared/display-name.js');
const runs = require('../src/domains/run/runs');

const WORKFLOWS = path.join(__dirname, '..', 'workflows');
const bundled = () => fs.readdirSync(WORKFLOWS).filter((f) => /\.ya?ml$/i.test(f)).sort();

function tmpDir(t, prefix = 'wf-display-') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

// A small two-step workflow; `agentDisplay` / `stepDisplay`: YAML values put verbatim after `display:`
// (undefined: no display line at all).
function workflowYaml({ agentDisplay, stepDisplay } = {}) {
  return [
    'apiVersion: multiagent/v1',
    'kind: Workflow',
    'metadata:',
    '  name: fixture-display-245',
    'agents:',
    '  lead_dev:',
    '    provider: claude',
    '    model: mock-model',
    '    session: ephemeral',
    ...(agentDisplay !== undefined ? [`    display: ${agentDisplay}`] : []),
    '  qa_engineer:',
    '    provider: claude',
    '    model: mock-model',
    '    session: ephemeral',
    'steps:',
    '  - id: acceptance_tests',
    '    agent: qa_engineer',
    ...(stepDisplay !== undefined ? [`    display: ${stepDisplay}`] : []),
    '    prompt: "Write the tests."',
    '  - id: verify_change',
    '    agent: lead_dev',
    '    prompt: "Verify the change."',
    '',
  ].join('\n');
}

function writeWorkflow(t, opts) {
  const file = path.join(tmpDir(t), 'display.yaml');
  fs.writeFileSync(file, workflowYaml(opts));
  return file;
}

const q = (s) => JSON.stringify(s); // a YAML double-quoted string

// ---- the loader ------------------------------------------------------------------------------

test('#245 loader: an agent and a step with a display string load, and the display is kept on the loaded workflow', (t) => {
  const file = writeWorkflow(t, { agentDisplay: q('Lead developer'), stepDisplay: q('Tests written first') });
  const wf = loadWorkflow(file);
  assert.equal(wf.agents.lead_dev.display, 'Lead developer');
  assert.equal(wf.steps.find((s) => s.id === 'acceptance_tests').display, 'Tests written first');
});

test('#245 loader: a display of exactly 40 characters is accepted (agent and step)', (t) => {
  const forty = 'A'.repeat(40);
  assert.doesNotThrow(() => loadWorkflow(writeWorkflow(t, { agentDisplay: q(forty) })));
  assert.doesNotThrow(() => loadWorkflow(writeWorkflow(t, { stepDisplay: q(forty) })));
});

test('#245 loader: an agent display of 41 characters is refused, naming the agent and display', (t) => {
  assert.throws(() => loadWorkflow(writeWorkflow(t, { agentDisplay: q('A'.repeat(41)) })), (e) => /lead_dev/.test(e.message) && /display/i.test(e.message));
});

test('#245 loader: a step display of 41 characters is refused, naming the step and display', (t) => {
  assert.throws(() => loadWorkflow(writeWorkflow(t, { stepDisplay: q('B'.repeat(41)) })), (e) => /acceptance_tests/.test(e.message) && /display/i.test(e.message));
});

test('#245 loader: a display that is not a string (number, list, object, boolean) is refused, on an agent and on a step', (t) => {
  for (const bad of ['42', '[a, b]', '{ name: x }', 'true']) {
    assert.throws(() => loadWorkflow(writeWorkflow(t, { agentDisplay: bad })), /display/i, `agent display: ${bad}`);
    assert.throws(() => loadWorkflow(writeWorkflow(t, { stepDisplay: bad })), /display/i, `step display: ${bad}`);
  }
});

test('#245 loader: a workflow without any display still loads (display is optional)', (t) => {
  const wf = loadWorkflow(writeWorkflow(t));
  assert.equal(wf.steps.length, 2);
});

// ---- workflow.started --------------------------------------------------------------------------

async function startedEvent(t, file) {
  const runsDir = tmpDir(t, 'runs-');
  const run = new WorkflowRun({ file, inputs: {}, mock: true, runsDir, skillsDirs: [] });
  const events = [];
  run.on('event', (ev) => {
    events.push(ev);
    if (ev.type === 'approval.requested') setImmediate(() => run.resolveApproval(ev.approval_id, true));
  });
  await run.start();
  const started = events.find((e) => e.type === 'workflow.started');
  assert.ok(started, 'the run emitted workflow.started');
  return started;
}

test('#245 workflow.started carries display.agents and display.steps: the YAML display when set, else displayName(id)', async (t) => {
  const file = writeWorkflow(t, { agentDisplay: q('Lead developer'), stepDisplay: q('Tests written first') });
  const ev = await startedEvent(t, file);
  assert.ok(ev.display && typeof ev.display === 'object', 'workflow.started has a `display` object');
  assert.deepEqual({ ...ev.display.agents }, { lead_dev: 'Lead developer', qa_engineer: displayName('qa_engineer') });
  assert.deepEqual({ ...ev.display.steps }, { acceptance_tests: 'Tests written first', verify_change: displayName('verify_change') });
});

test('#245 workflow.started without any display in the YAML: every agent and step is named by displayName(id)', async (t) => {
  const ev = await startedEvent(t, writeWorkflow(t));
  assert.equal(ev.display?.steps?.acceptance_tests, 'Acceptance tests');
  assert.equal(ev.display?.steps?.verify_change, 'Verify change');
  assert.equal(ev.display?.agents?.qa_engineer, 'QA engineer');
  assert.equal(ev.display?.agents?.lead_dev, 'Lead dev');
});

// ---- a past run's names, as the renderer reads them (src/domains/run/runs.js readRun) ------------------------

test('#245 readRun: a run recorded with workflow.started display gives stepNames and agentNames (the Agents menu names winning)', (t) => {
  const root = tmpDir(t, 'runs-read-');
  fs.mkdirSync(path.join(root, 'r1'));
  const started = {
    ts: '2026-10-04T10:00:00Z', type: 'workflow.started', workflow: 'w', file: 'w.yaml', inputs: {}, mock: true,
    agent_names: { reviewer: 'Grumpy QA' },
    display: {
      agents: { lead_dev: 'Lead developer', reviewer: 'Reviewer' },
      steps: { acceptance_tests: 'Tests written first', red_check: 'Red check (tests fail first)' },
    },
  };
  fs.writeFileSync(path.join(root, 'r1', 'events.jsonl'), `${JSON.stringify(started)}\n`);
  const r = runs.readRun(root, 'r1');
  assert.deepEqual({ ...r.stepNames }, { acceptance_tests: 'Tests written first', red_check: 'Red check (tests fail first)' });
  assert.equal(r.agentNames?.lead_dev, 'Lead developer');
  assert.equal(r.agentNames?.reviewer, 'Grumpy QA');
});

// ---- the bundled workflows -------------------------------------------------------------------

const stepOf = (file, id) => loadWorkflow(path.join(WORKFLOWS, file)).steps.find((s) => s.id === id);

test('#245 bundled workflows: every red_check step is displayed "Red check (TDD)"', () => {
  const found = bundled().filter((f) => stepOf(f, 'red_check'));
  assert.ok(found.length >= 1, 'at least one bundled workflow has a red_check step');
  for (const f of found) assert.equal(stepOf(f, 'red_check').display, 'Red check (TDD)', f);
});

test('#245 bundled workflows: ai-development-local-hero\'s Run suite (E2E) step (e2e) is displayed "Run suite (E2E)"', () => {
  assert.equal(stepOf('ai-development-local-hero.yaml', 'e2e')?.display, 'Run suite (E2E)');
});

test('#245 bundled workflows: every verify_change step is displayed "Final verification"', () => {
  const found = bundled().filter((f) => stepOf(f, 'verify_change'));
  assert.ok(found.length >= 3, 'software-development, its local-hero variant and ai-development-local-hero have verify_change');
  for (const f of found) assert.equal(stepOf(f, 'verify_change').display, 'Final verification', f);
});

test('#245 bundled workflows: every display (agents and steps) is a non-empty string of at most 40 characters', () => {
  for (const f of bundled()) {
    const wf = yaml.load(fs.readFileSync(path.join(WORKFLOWS, f), 'utf8'));
    const named = [
      ...Object.entries(wf.agents || {}).map(([k, a]) => [`${f} agent ${k}`, a?.display]),
      ...(wf.steps || []).map((s) => [`${f} step ${s.id}`, s.display]),
    ].filter(([, d]) => d !== undefined);
    for (const [where, d] of named) {
      assert.equal(typeof d, 'string', `${where}: display is a string`);
      assert.ok(d.trim().length > 0 && d.length <= 40, `${where}: "${d}" is 1 to 40 characters`);
    }
  }
});
