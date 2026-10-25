// #327 acceptance test (written before the code): a whole simulated software-development run with the
// AI agents in Português (Brasil). Every step's output still parses (no invalid output, no step that
// ends in error) and every agent prompt carries the pt-BR [Language] line once.
process.env.MULTIAGENT_MOCK_DELAY_SCALE = '0.05';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { WorkflowRun } = require('../../engine/workflow');

const root = path.join(__dirname, '..', '..', '..', '..');
const load = () => require('@multiagent/shared/language');
const PT = { agents: 'pt-BR', issues: 'en' };

test('#327 software-development with agents in pt-BR: every step output parses and every prompt has the pt-BR line', { timeout: 120000 }, async (t) => {
  const runsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'language-run-'));
  t.after(() => fs.rmSync(runsDir, { recursive: true, force: true }));
  const run = new WorkflowRun({
    file: path.join(root, 'workflows', 'software-development.yaml'),
    inputs: { task: 'Engine test', repo_path: root }, mock: true, runsDir, language: () => PT,
  });
  const events = [];
  run.on('event', (ev) => {
    events.push(ev);
    if (ev.type === 'approval.requested') setImmediate(() => run.resolveApproval(ev.approval_id, ev.choices ? ev.choices[0].id : true, 'user'));
  });
  await run.start();
  const finished = events.find((e) => e.type === 'workflow.finished');
  assert.equal(finished.status, 'success', finished.error);
  assert.deepEqual(events.filter((e) => e.type === 'log' && e.kind === 'invalid_output').map((e) => e.message), []);
  assert.deepEqual(events.filter((e) => e.type === 'step.finished' && e.error).map((e) => e.step_id), []);
  const line = load().languageLine({ language: PT });
  const sent = events.filter((e) => e.type === 'session.message_sent' && !/^Write only your ```handoff block/.test(e.prompt || ''));
  assert.ok(sent.length > 3);
  for (const e of sent) assert.equal(e.prompt.split(line).length - 1, 1, `step ${e.step_id}: the pt-BR line once`);
});
