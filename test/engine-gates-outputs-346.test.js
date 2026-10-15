// #346: the rewrites the checker asked for in src/engine/run/gates.js (a gate with choices has no
// yes/no buttons) and src/engine/run/outputs.js (save_as as a string, a list or { path, content }).
// A WorkflowRun built and never started; requestApproval / saveOutput called the way a run calls them.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { WorkflowRun } = require('../src/engine/workflow');

const FIXTURE = `apiVersion: multiagent/v1
kind: Workflow
metadata: { name: fixture-gates-outputs-346 }
providers:
  claude: { type: claude-code, command: claude, args: ["-p"] }
agents:
  dev: { provider: claude, session: ephemeral }
steps:
  - id: develop
    agent: dev
    prompt: "Implement it."
`;

function newRun(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'engine-gates-outputs-346-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'wf.yaml');
  fs.writeFileSync(file, FIXTURE);
  const run = new WorkflowRun({ file, inputs: {}, mock: true, runsDir: path.join(dir, 'runs'), skillsDirs: [] });
  run.orchestrator = { id: 'orchestrator' };
  const events = [];
  run.on('event', (ev) => events.push(ev));
  return { run, events };
}

// Opens the gate, reads its approval.requested event, then answers it so nothing is left waiting.
async function openGate(run, events, step, answer) {
  const answered = run.requestApproval(step);
  const ev = events.find((e) => e.type === 'approval.requested');
  run.resolveApproval(ev.approval_id, answer);
  await answered;
  return ev;
}

test('#346 a gate with choices asks with its choices as answers and no Approve / Reject buttons', async (t) => {
  const { run, events } = newRun(t);
  const step = { id: 'pick', type: 'human_approval', raw: true, message: 'Which one?', choices: [{ id: 'ship', label: 'Ship it' }, { id: 'redo', label: 'Redo' }] };
  const ev = await openGate(run, events, step, 'ship');
  assert.deepEqual(ev.choices.map((c) => [c.id, c.label]), [['ship', 'Ship it'], ['redo', 'Redo']]);
  assert.equal('approve' in ev, false);
  assert.equal('reject' in ev, false);
  assert.equal(run.approvals.size, 0, 'answered with one of its choices');
});

test('#346 a yes/no gate still offers Approve and Reject, with their labels', async (t) => {
  const { run, events } = newRun(t);
  const ev = await openGate(run, events, { id: 'ok', type: 'human_approval', raw: true, message: 'Good?' }, true);
  assert.equal(ev.choices, null);
  assert.equal(ev.approve.label, 'Approve');
  assert.equal(ev.reject.label, 'Reject');
});

test('#346 a yes/no gate shows its own button labels', async (t) => {
  const { run, events } = newRun(t);
  const step = { id: 'ok', type: 'human_approval', message: 'Good?', approve_label: 'Merge', reject_label: 'Send back' };
  const ev = await openGate(run, events, step, false);
  assert.deepEqual([ev.approve.label, ev.reject.label], ['Merge', 'Send back']);
});

const saved = (run, events) => events.filter((e) => e.type === 'file.saved').map((e) => path.relative(run.runDir, e.path).split(path.sep).join('/'));
const readOut = (run, rel) => fs.readFileSync(path.join(run.runDir, ...rel.split('/')), 'utf8');

test('#346 save_as as one path writes the answer into the run folder', (t) => {
  const { run, events } = newRun(t);
  run.saveOutput({ id: 'develop', save_as: 'out/{{ agent }}.md' }, { ...run.ctx, agent: 'dev' }, 'the answer', null);
  assert.deepEqual(saved(run, events), ['out/dev.md']);
  assert.equal(readOut(run, 'out/dev.md'), 'the answer');
});

test('#346 save_as as a list writes every entry, a path or a { path, content } with the step output', (t) => {
  const { run, events } = newRun(t);
  const step = { id: 'develop', save_as: ['all.md', { path: 'doc.md', content: '{{ output.document }}' }, ''] };
  run.saveOutput(step, { ...run.ctx, agent: 'dev' }, 'full text', { document: 'only the document' });
  assert.deepEqual(saved(run, events), ['all.md', 'doc.md']);
  assert.equal(readOut(run, 'all.md'), 'full text');
  assert.equal(readOut(run, 'doc.md'), 'only the document');
});

test('#346 save_as as one { path, content } entry and no save_as at all', (t) => {
  const { run, events } = newRun(t);
  run.saveOutput({ id: 'develop', save_as: { path: 'one.md', content: 'v{{ output.n }}' } }, { ...run.ctx, agent: 'dev' }, 'ignored', { n: 2 });
  run.saveOutput({ id: 'develop' }, { ...run.ctx, agent: 'dev' }, 'nothing', null);
  assert.deepEqual(saved(run, events), ['one.md']);
  assert.equal(readOut(run, 'one.md'), 'v2');
});
