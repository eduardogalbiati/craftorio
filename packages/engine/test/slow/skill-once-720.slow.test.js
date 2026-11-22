// #720: a skill both an agent and the step of its first turn name is loaded once in that turn's
// prompt (feature.yaml's test writer named its language skills twice); an agent-only skill still
// goes in the system part. Mock run of test/fixtures/skill-once-720.yaml.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { WorkflowRun } = require('../../engine/workflow');

process.env.CRAFTORIO_MOCK_DELAY_SCALE = process.env.CRAFTORIO_MOCK_DELAY_SCALE || '0.02';
const count = (prompt, name) => String(prompt || '').split(`<skill name="${name}"`).length - 1;

test('#720 a skill named by both the agent and the step is loaded once; an agent-only skill still loads', { timeout: 30000 }, async (t) => {
  const runsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'runs-'));
  t.after(() => fs.rmSync(runsDir, { recursive: true, force: true }));
  const run = new WorkflowRun({
    file: path.join(__dirname, '..', 'fixtures', 'skill-once-720.yaml'),
    inputs: {},
    mock: true,
    runsDir,
    skillsDirs: [path.join(__dirname, '..', 'fixtures', 'skills')],
  });
  const events = [];
  run.on('event', (ev) => events.push(ev));
  await run.start();
  const finished = events.find((e) => e.type === 'workflow.finished');
  assert.equal(finished.status, 'success', finished.error);

  const first = (step) => (events.find((e) => e.type === 'session.message_sent' && e.step_id === step) || {}).prompt || '';
  assert.equal(count(first('write'), 'demo'), 1, 'agent and step both name demo: once');
  assert.match(first('write'), /<system>\nYou are the writer\.\n<\/system>/, 'the system part keeps the system prompt');
  assert.equal(count(first('other'), 'demo'), 1, 'agent-only skill: once');
  assert.match(first('other'), /<system>\nYou are the other\.\n\n<skill name="demo"/);
});
