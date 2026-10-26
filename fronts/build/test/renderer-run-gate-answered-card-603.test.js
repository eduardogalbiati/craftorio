// #603: the Run screen keeps a gate answered from this window as an "Answered" card until the
// approval.resolved push confirms it. That push is exactly what a dead channel loses, so the card
// must not outlive the gate: when the run ends (workflow.finished), or when the refetch after a
// reconnect (loadActiveRuns, onReconnect) no longer lists the gate, the card goes.
//
// Driven through the page's own seam, as renderer-run-gate-answer-603.test.js does: the whole page
// loaded by packages/ui-kit/test/renderer-app-harness.js, run events handed to window.api.onEvent,
// the click handed to onRunGateClick with a fake card, the Run screen's gates read from #run-gates.
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadApp, text } = require('@multiagent/ui-kit/test/renderer-app-harness');

const ts = (s) => `2026-10-25T10:00:${String(s).padStart(2, '0')}.000Z`;
const fire = (page, ev) => { for (const fn of page.apiHandlers.onEvent || []) fn(ev); };

async function openPage(api) {
  const page = loadApp({ api: { listActiveRuns: async () => [], resolveApproval: async () => true, ...api } });
  await page.boot();
  return page;
}

async function runAtGate(page) {
  fire(page, { seq: 1, run_id: 'r1', ts: ts(0), type: 'workflow.started', workflow: 'fixture', version: '1', mock: true, inputs: {}, steps: [{ id: 'work' }, { id: 'review' }] });
  fire(page, { seq: 2, run_id: 'r1', ts: ts(1), type: 'approval.requested', approval_id: 'g1', step_id: 'review', message: 'Merge?' });
  await page.settle(20);
}

// a fake gate card of g1 with its Approve button (renderRunGates' markup is not needed to click it)
function clickApprove(page) {
  const card = {
    dataset: { approval: 'g1', run: 'r1' },
    querySelector: () => null,
    querySelectorAll: (sel) => (sel === 'button' ? [approve] : []),
  };
  const approve = { dataset: { answer: 'true' }, disabled: false, textContent: 'Approve' };
  approve.closest = (sel) => (String(sel).startsWith('button') ? approve : String(sel).includes('.run-gate') ? card : null);
  page.run('onRunGateClick')({ target: approve });
  return page.settle(20);
}

// the Run screen's gate cards of run r1, as text
function runGatesText(page) {
  page.run('(() => { state.runId = "r1"; renderRunGates(); })()');
  return text(page.el('#run-gates').innerHTML);
}

test('#603 the answered card shows on the Run screen right after the answer', async () => {
  const page = await openPage();
  await runAtGate(page);
  await clickApprove(page);
  assert.match(runGatesText(page), /Answered/i);
});

test('#603 the answered card goes when the run ends, even with its approval.resolved push lost', async () => {
  const page = await openPage();
  await runAtGate(page);
  await clickApprove(page);
  // approval.resolved never arrives; the run's end does
  fire(page, { seq: 4, run_id: 'r1', ts: ts(3), type: 'workflow.finished', status: 'completed' });
  await page.settle(20);
  assert.doesNotMatch(runGatesText(page), /Answered/i, 'the "Answered" card outlives the run');
});

test('#603 the answered card goes when the refetch after a reconnect no longer lists the gate', async () => {
  let gates = [{ approval_id: 'g1', step_id: 'review', message: 'Merge?' }];
  const page = await openPage({ listActiveRuns: async () => [{ runId: 'r1', workflow: 'fixture', gates }] });
  await runAtGate(page);
  await clickApprove(page);
  // the pushes were lost; the window reconnects and refetches: the engine lists the run without g1
  gates = [];
  for (const fn of page.apiHandlers.onReconnect || []) fn();
  await page.settle(20);
  assert.doesNotMatch(runGatesText(page), /Answered/i, 'the "Answered" card stays after the refetch');
});
