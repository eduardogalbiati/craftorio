// The run chat after the run screen redesign (2026-11-28, the owner's Claude Design proposal and decisions 1 and
// 3): every message on the left; the orchestrator's plain lines (transitions with their condition, /loop, a goal,
// the fail line the end repeats) fold into one closed line "Orchestrator · N events"; a run that did not succeed
// says so once, in its end note, whose Resume from step… is the accent button. Through the whole page
// (test/agent-chat-page-harness.js), as resumed-run-views-384.test.js opens a past run's chat.
const test = require('node:test');
const assert = require('node:assert/strict');
const { textOf } = require('@craftorio/ui-kit/test/mini-dom');
const { loadPage, settle } = require('@craftorio/ui-kit/test/agent-chat-page-harness');

const RUN = '20261128-100000-chat0001';
const ts = (s) => new Date(Date.parse('2026-11-28T10:00:00.000Z') + s * 1000).toISOString();
function events(status = 'failed') {
  return [
    { seq: 1, run_id: RUN, type: 'workflow.started', ts: ts(0), workflow: 'software-development', file: 'software-development.yaml', inputs: { task: 'Add a /health endpoint' }, mock: true },
    { seq: 2, run_id: RUN, type: 'step.started', ts: ts(1), step_id: 'develop', agent: 'developer' },
    { seq: 3, run_id: RUN, type: 'step.transition', ts: ts(2), from: 'develop', to: 'testid_check', when: "output.committed and inputs.e2e_tests != 'off'" },
    { seq: 4, run_id: RUN, type: 'step.transition', ts: ts(3), from: 'testid_check', to: 'secret_scan', when: 'true' },
    { seq: 5, run_id: RUN, type: 'workflow.finished', ts: ts(60), status, ...(status === 'failed' ? { error: 'secret_scan: gitleaks exited with code 2' } : {}), summary: { cost_usd: 0, duration_ms: 60000 } },
  ];
}
async function chat(status) {
  const page = await loadPage({ api: { runEvents: async () => events(status), listRuns: async () => ({ runs: [] }) } });
  page.sandbox.openRunChat({ runId: RUN, workflow: 'software-development', running: false });
  await settle(20);
  return page.$('#rc-messages');
}

test('the orchestrator\'s transition lines fold into one closed line: "Orchestrator · 2 events", the last one\'s text', async () => {
  const box = await chat('success');
  const groups = box.querySelectorAll('[data-testid="run-chat-events"]');
  assert.equal(groups.length, 1, 'the two lines in a row make one group');
  const g = groups[0];
  assert.equal(g.open, false, 'closed');
  assert.match(textOf(g.querySelector('summary')), /2 events/);
  assert.match(textOf(g.querySelector('summary')), /testid_check → secret_scan/);
  assert.equal(g.querySelectorAll('.rc-sys').length, 2, 'the lines are inside it, as they were');
});

test('a failed run says it once, in its end note, with Resume from step… as the accent button', async () => {
  const box = await chat('failed');
  const note = box.querySelector('[data-testid="run-chat-finished"]');
  assert.equal(note === null, false);
  assert.match(textOf(note), /gitleaks exited with code 2/);
  const resume = note.querySelector('[data-resume]');
  assert.match(resume.getAttribute('class'), /btn sm primary/);
});

test('a run that succeeded keeps Resume from step… as a quiet link', async () => {
  const box = await chat('success');
  assert.match(box.querySelector('[data-testid="run-chat-finished"] [data-resume]').getAttribute('class'), /link-btn/);
});
