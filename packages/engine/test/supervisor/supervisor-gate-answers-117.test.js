// #117 acceptance tests (written before the code): at a merge_blocked gate (an escalation gate whose
// answers are "Retry the merge" / "Stop the run as failed"), the supervisor on call recommends only an
// answer the gate offers, never one it lacks nor a capability the app lacks (it recommended "Aprovar"
// with "free Git writing"). A recommendation whose answer is not among the gate's is dropped: the gate's
// card (its brief) and its message carry neither the answer nor its reason.
// Seams: a WorkflowRun whose agents and supervisor answers are scripted (as supervisor-on-call.test.js:
// sendToAgent replaced, the mock provider elsewhere), the gate's approval.requested event (message, brief,
// supervisor), and the supervisor's prompt for that gate.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { WorkflowRun } = require('../../engine/workflow');

process.env.CRAFTORIO_MOCK_DELAY_SCALE = process.env.CRAFTORIO_MOCK_DELAY_SCALE || '0.05';

const WF = `
apiVersion: craftorio/v1
kind: Workflow
metadata: { name: fixture-merge-blocked-117 }
orchestrator:
  supervisor: { enabled: true, on_call: true, max_interventions: 2, max_total: 10 }
agents:
  a: { provider: claude, model: m, session: ephemeral }
steps:
  - id: develop
    agent: a
    prompt: "develop"
    output_schema:
      type: object
      required: [status]
      properties: { status: { type: string, enum: [success, blocked] } }
    transitions:
      - { when: "output.status == 'success'", goto: end }
      - { when: "output.status == 'blocked'", goto: merge_blocked }
  - id: merge_blocked
    type: human_approval
    kind: escalation
    message: "Branch feature-117 could not be merged into the local main: the main checkout has uncommitted changes."
    choices:
      - { id: retry, label: "Retry the merge" }
      - { id: stop, label: "Stop the run as failed (branch kept to resume)" }
    transitions:
      - { when: "choice == 'retry'", goto: develop }
      - { when: "choice == 'stop'", goto: end, status: failed }
`;

const CAPABILITY = 'free Git writing';
const WRONG = {
  explanation: 'The merge is blocked by uncommitted changes in the main checkout.',
  action: 'escalate',
  recommend: 'approve',
  recommendation: `Approve: grant the agents ${CAPABILITY} so they can merge.`,
};

async function gateOf(t, decision) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'merge-blocked-117-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'wf.yaml');
  fs.writeFileSync(file, WF);
  const r = new WorkflowRun({ file, inputs: {}, mock: true, runsDir: path.join(dir, 'runs') });
  const prompts = [];
  const decisions = [decision];
  r.sendToAgent = async (agent, prompt) => {
    if (agent === 'supervisor') {
      prompts.push(prompt);
      return { text: '```json\n' + JSON.stringify(decisions.shift() || { explanation: 'give up', action: 'escalate' }) + '\n```' };
    }
    return { text: '```json\n' + JSON.stringify({ status: 'blocked' }) + '\n```' };
  };
  const events = [];
  r.on('event', (e) => {
    events.push(e);
    if (e.type === 'approval.requested') setImmediate(() => r.resolveApproval(e.approval_id, 'stop'));
  });
  await r.start();
  const gate = events.find((e) => e.type === 'approval.requested' && e.step_id === 'merge_blocked');
  assert.ok(gate, 'the merge_blocked gate opens');
  return { gate, prompts };
}

test('#117 merge_blocked: a supervisor recommendation of an answer the gate does not offer is dropped from the gate\'s card', { timeout: 60000 }, async (t) => {
  const { gate } = await gateOf(t, WRONG);
  const rec = gate.brief?.recommendation || null;
  assert.equal(rec === null || ['retry', 'stop'].includes(rec.answer), true, JSON.stringify(rec));
  assert.equal(JSON.stringify(rec ?? {}).includes(CAPABILITY), false, JSON.stringify(rec));
});

test('#117 merge_blocked: the gate\'s message does not carry a recommendation of an answer the gate does not offer', { timeout: 60000 }, async (t) => {
  const { gate } = await gateOf(t, WRONG);
  assert.equal(gate.message.includes(CAPABILITY), false, gate.message);
  assert.doesNotMatch(gate.message, /Recommendation[^\n]*\(approve\)/);
});

test('#117 merge_blocked: a recommendation of one of the gate\'s answers stays on its card', { timeout: 60000 }, async (t) => {
  const { gate } = await gateOf(t, { ...WRONG, recommend: 'retry', recommendation: 'Commit or stash the changes in the main checkout, then retry the merge.' });
  assert.equal(gate.brief?.recommendation?.answer, 'retry');
  assert.match(gate.brief?.recommendation?.reason || '', /stash/);
});

test('#117 merge_blocked: the supervisor\'s prompt names the gate\'s own answers with their labels, and no Approve', { timeout: 60000 }, async (t) => {
  const { prompts } = await gateOf(t, WRONG);
  assert.equal(prompts.length >= 1, true, 'the supervisor on call is asked');
  assert.match(prompts[0], /Retry the merge/);
  assert.match(prompts[0], /Stop the run as failed/);
  assert.doesNotMatch(prompts[0], /\bapprove\b/i);
});
