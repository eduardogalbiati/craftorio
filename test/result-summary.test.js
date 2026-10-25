// #225 When a run ends, the engine writes `result.md` in the run folder (what was done per issue,
// commits, test counts, screenshots, links), and the Artifacts list leads with it.
//
// Seam chosen: a real (mock, simulation-only) run of a minimal workflow with one human gate, no
// agent turn (src/engine/workflow.js WorkflowRun, as in test/engine-helpers.js), then
// src/domains/run/runs.js runArtifacts(runDir) (existing). Interfaces relied on:
//   - <run_dir>/result.md exists once `workflow.finished` was emitted, markdown starting with "# ";
//   - runArtifacts(runDir)[0] is result.md with category 'result' (#225 categories).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { WorkflowRun } = require('../src/engine/workflow');
const runs = require('../src/domains/run/runs');

const WORKFLOW = `apiVersion: multiagent/v1
kind: Workflow
metadata:
  name: fixture-result-summary
agents:
  unused: { provider: claude, model: mock-model }
steps:
  - id: gate
    type: human_approval
    message: "Done?"
    transitions:
      - when: "approved"
        goto: end
      - when: "rejected"
        goto: end
`;

async function finishedRun(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'result-summary-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'result-summary.yaml');
  fs.writeFileSync(file, WORKFLOW);
  const runsDir = path.join(dir, 'runs');
  fs.mkdirSync(runsDir);
  const run = new WorkflowRun({ file, inputs: {}, mock: true, runsDir, skillsDirs: [] });
  const events = [];
  run.on('event', (ev) => {
    events.push(ev);
    if (ev.type === 'approval.requested') setImmediate(() => run.resolveApproval(ev.approval_id, true));
  });
  await run.start();
  assert.ok(events.some((e) => e.type === 'workflow.finished'), 'the run finished');
  return run.runDir;
}

test('a finished run has a result.md summary in its run folder', async (t) => {
  const runDir = await finishedRun(t);
  const file = path.join(runDir, 'result.md');
  assert.ok(fs.existsSync(file), 'result.md was written');
  assert.match(fs.readFileSync(file, 'utf8'), /^# /);
});

test('runArtifacts lists a finished run\'s result.md first, with category result', async (t) => {
  const runDir = await finishedRun(t);
  const [first] = runs.runArtifacts(runDir);
  assert.equal(first.name, 'result.md');
  assert.equal(first.category, 'result');
});
