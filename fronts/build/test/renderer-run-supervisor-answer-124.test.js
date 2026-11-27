// #124 in the window's run-event reducer (app.js): a gate the supervisor on call answered alone is kept on
// the step (s.supervisor, the gate's step.finished output) so the Run screen's step card says who answered,
// with which answer and why; per visit: a later visit answered by the owner, or one that opens the gate for
// the owner, no longer shows the supervisor's earlier answer. Driven through the page's own seam (the whole
// page from renderer-app-harness.js, events handed to window.api.onEvent), as renderer-run-events-433 does.
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('@craftorio/ui-kit/test/renderer-app-harness');

const ts = (s) => `2026-09-30T10:00:${String(s).padStart(2, '0')}.000Z`;

async function openPage() {
  const page = loadApp({ api: { listActiveRuns: async () => [] } });
  await page.boot();
  return page;
}
const fire = (page, ev) => { for (const fn of page.apiHandlers.onEvent || []) fn(ev); };
const supervisorOf = (page, step) => JSON.parse(page.run(`JSON.stringify(state.runs.get('r1').steps.get(${JSON.stringify(step)}).supervisor ?? null)`));
const cardLine = (page, step) => String(page.run(`supervisorAnswerHtml(state.runs.get('r1').steps.get(${JSON.stringify(step)}))`));

const REASON = 'The same test failed in both rounds';
const BY_SUPERVISOR = { choice: 'stop', feedback: '', by: 'supervisor', reason: REASON, label: 'Stop the run', label_key: 'engine.test_failed_stop' };

function start(page) {
  fire(page, { seq: 1, run_id: 'r1', ts: ts(0), type: 'workflow.started', workflow: 'feature', version: '1', mock: true, inputs: { task: 'Fix' }, steps: [{ id: 'suite' }, { id: 'test_failed' }] });
  fire(page, { seq: 2, run_id: 'r1', ts: ts(1), type: 'step.started', step_id: 'test_failed', visit: 1 });
}

test('#124 reducer: a gate the supervisor answered keeps its answer, label and reason on the step', async () => {
  const page = await openPage();
  start(page);
  fire(page, { seq: 3, run_id: 'r1', ts: ts(2), type: 'step.finished', step_id: 'test_failed', output: BY_SUPERVISOR });
  const sup = supervisorOf(page, 'test_failed');
  assert.equal(sup?.by, 'supervisor');
  assert.equal(sup?.choice, 'stop');
  assert.equal(sup?.reason, REASON);
  const html = cardLine(page, 'test_failed');
  assert.match(html, /data-testid="gate-supervisor-answer"/);
  assert.equal(html.includes('Stop the run') && html.includes(REASON), true);
});

test('#124 reducer: a gate the owner answered has no supervisor answer', async () => {
  const page = await openPage();
  start(page);
  fire(page, { seq: 3, run_id: 'r1', ts: ts(2), type: 'step.finished', step_id: 'test_failed', output: { choice: 'continue', feedback: '' } });
  assert.equal(supervisorOf(page, 'test_failed'), null);
  assert.equal(cardLine(page, 'test_failed'), '');
});

test('#124 reducer: a later visit answered by the owner drops the earlier supervisor answer', async () => {
  const page = await openPage();
  start(page);
  fire(page, { seq: 3, run_id: 'r1', ts: ts(2), type: 'step.finished', step_id: 'test_failed', output: BY_SUPERVISOR });
  fire(page, { seq: 4, run_id: 'r1', ts: ts(3), type: 'step.started', step_id: 'test_failed', visit: 2 });
  fire(page, { seq: 5, run_id: 'r1', ts: ts(4), type: 'step.finished', step_id: 'test_failed', output: { choice: 'stop', feedback: '' } });
  assert.equal(supervisorOf(page, 'test_failed'), null);
});

test("#124 reducer: a new visit whose gate opens for the owner no longer shows the supervisor's earlier answer", async () => {
  const page = await openPage();
  start(page);
  fire(page, { seq: 3, run_id: 'r1', ts: ts(2), type: 'step.finished', step_id: 'test_failed', output: BY_SUPERVISOR });
  fire(page, { seq: 4, run_id: 'r1', ts: ts(3), type: 'step.started', step_id: 'test_failed', visit: 2 });
  fire(page, { seq: 5, run_id: 'r1', ts: ts(4), type: 'approval.requested', approval_id: 'g2', step_id: 'test_failed', message: 'The tests failed', choices: [{ id: 'continue', label: 'Continue' }, { id: 'stop', label: 'Stop' }] });
  assert.equal(cardLine(page, 'test_failed'), '', 'the waiting gate is not shown as answered by the supervisor');
});
