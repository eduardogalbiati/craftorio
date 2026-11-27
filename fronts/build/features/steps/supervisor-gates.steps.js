// Steps of fronts/build/features/supervisor-gates-124.feature (#124): the on-call Supervisor answers an
// escalation gate by itself only with the gate's recommended answer or one that neither merges nor
// pushes; otherwise the gate waits for the owner with the Supervisor's recommendation and reason; a gate
// it crossed shows on the Run screen and in the morning summary, in the interface language.
// Locators are roles and data-testid only (skills/ui-conventions). Reused: app.steps.js ("I open
// {string} in the sidebar", "I reload the app"), display-names.steps.js ("I search the runs for"),
// run.steps.js ("I view the run {string} from the list", "I open the chat of the run {string} from the
// list"), codex-run-screens.steps.js ("I switch the run to its details"), settings-language.steps.js,
// interface-language.steps.js ("the open screen shows none of these English texts:"),
// fronts/ai/features/steps/nightwatch.steps.js ("the Night watch ended {int} hours ago").
//
// Seeded events (the shapes the engine records for these runs; NEW fields marked):
// - The Supervisor held back (it would answer an answer that is neither the recommended one nor safe):
//     { type: 'supervisor.started', step_id: 'test_failed', kind: 'escalation', error: '' }
//     { type: 'supervisor.decision', step_id: 'test_failed', kind: 'escalation', action: 'escalate',
//       route: 'continue', explanation: <reason>,
//       held: 'unsafe' }                                   NEW: why it did not answer by itself
//     { type: 'approval.requested', step_id: 'test_failed', approval_id, message, choices: [continue, stop],
//       brief: { headline, body, recommendation: { answer: 'stop', reason, source: 'workflow', label }, options: [] },
//       supervisor: { answer: 'continue', label, reason, evidence: [..], answered: false } }   NEW `supervisor`
//   No owner answer, no summary.json; owner.json kept alive by another app (studio-pc): the run is
//   running elsewhere and its gate waits.
// - The Supervisor answered (the recommended answer, or retry / stop):
//     { type: 'supervisor.started', ... }
//     { type: 'supervisor.decision', step_id: 'test_failed', kind: 'escalation', action: 'route',
//       route: 'stop', explanation: <reason>, recommended: true,         NEW `recommended`
//       label, label_key }                                               NEW: the answer's label (gateAnswerLabel)
//     { type: 'step.finished', step_id: 'test_failed', output: { choice: 'stop', by: 'supervisor',
//       reason: <reason>, label, label_key } }                           NEW `reason`, `label`, `label_key`
//   then workflow.finished { status: 'failed' } (stop ends the run as failed; nothing merged).
//
// What the screens expose (NEW data-testids, the renderer's contract for these steps):
// - data-testid="gate-supervisor-recommendation": on a waiting gate's card (run-chat-gate in the run
//   chat, run-gate on the Run screen; packages/ui-kit/gate-panel.js gateCardHtml), the Supervisor's
//   recommendation: the answer's label and its reason (text or title), e.g. "Supervisor recommends:
//   Continue to the build anyway — <reason>".
// - data-testid="gate-supervisor-answer" with data-step="<step id>": on the Run screen's Details, a gate
//   the Supervisor answered: who (the word "Supervisor"), the answer's label, and the reason.
// - data-testid="morning-supervisor-gate" with data-step="<step id>" and data-run="<run id>": one line
//   of Home's morning summary per gate the Supervisor crossed during the night: "Supervisor", the
//   answer's label and the reason, in the interface language.

const fs = require('fs');
const path = require('path');
const { expect } = require('@playwright/test');
const { Given, Then } = require('../../../../features/steps/fixtures');
const { FEATURE } = require('../../../../features/support/workflows');
const { trailOf } = require('@craftorio/shared/run-progress-model');

const LOAD_TIMEOUT = 30000;
const MIN = 6e4;
const HOUR = 60 * MIN;
const GATE = 'test_failed';
const CHOICES = [
  { id: 'continue', label: 'Continue to the build anyway', label_key: 'engine.test_failed_continue' },
  { id: 'stop', label: 'Stop the run', label_key: 'engine.test_failed_stop' },
];
const WORKFLOW_REASON = 'the change is not tested green; look at the failures, then resume the run.';
const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const labelOf = (id) => {
  const c = CHOICES.find((x) => x.id === id);
  if (!c) throw new Error(`the test gate offers ${CHOICES.map((x) => x.id).join(', ')}, not "${id}"`);
  return c.label;
};

// the run red at the suite: develop, then the suite failed twice (in the change), then the gate
const SUITE_FAIL = {
  kind: 'suite', status: 'fail', round: 2, scope: 'full', command: 'npm test', log: 'logs/suite-2-full.log', exit_code: 1, duration_ms: 3 * MIN, passed: 410, failed: 1,
  failures: [{ test: 'health endpoint answers 200', file: 'test/health.test.js', class: 'in the change' }], preexisting: [],
  message: 'The suite failed in round 2 (`npm test`): 1 failure, in the change.',
};
function redSuite(at) {
  const session = { id: 's-develop', agent: 'developer', provider: 'claude', model: 'claude-opus-5-5' };
  return [
    { ts: at(1), type: 'step.started', step_id: 'develop', step_type: 'agent', agent: 'developer', visit: 1 },
    { ts: at(1), type: 'session.opened', session_id: session.id, session },
    { ts: at(20), type: 'session.message_received', session_id: session.id, step_id: 'develop', text: 'Done.', cost_usd: 0.1, duration_ms: 19 * MIN, session },
    { ts: at(20), type: 'step.finished', step_id: 'develop', duration_ms: 19 * MIN, output: { summary: 'Implemented the task.' } },
    { ts: at(21), type: 'step.started', step_id: 'suite', step_type: 'suite', visit: 1 },
    { ts: at(25), type: 'step.finished', step_id: 'suite', duration_ms: 4 * MIN, output: SUITE_FAIL },
    { ts: at(26), type: 'step.started', step_id: GATE, step_type: 'human_approval', visit: 1 },
    { ts: at(26), type: 'supervisor.started', step_id: GATE, kind: 'escalation', error: '' },
  ];
}

// A Feature run of the demo project: events.jsonl (and summary.json once `finished`), as the engine
// writes them. The run list reads the runs folder when the screen opens. `alive`: owner.json kept fresh
// by another app (the run waits there), until the scratch folder goes.
function writeFeatureRun(e2e, { suffix, start, mock, task, steps, finished = null, alive = false }) {
  const stamp = new Date(start).toISOString();
  const runId = `${stamp.slice(0, 10).replace(/-/g, '')}-${stamp.slice(11, 19).replace(/:/g, '')}-${suffix}`;
  const dir = path.join(e2e.scratch, 'workspace', 'runs', runId);
  const at = (m) => new Date(start + m * MIN).toISOString();
  const inner = steps(at);
  const end = Math.max(...inner.map((e) => (Date.parse(e.ts) - start) / MIN)) + 1;
  const stepList = [...new Map(inner.filter((e) => e.type === 'step.started').map((e) => [e.step_id, { id: e.step_id, type: e.step_type || 'agent', agent: e.agent }])).values()];
  const inputs = { task, mode: 'local' };
  const events = [
    { ts: at(0), type: 'workflow.started', workflow: FEATURE.name, file: FEATURE.file, project_id: e2e.project.id, mock, inputs, steps: stepList },
    ...inner,
    ...(finished ? [{ ts: at(end), type: 'workflow.finished', status: finished.status }] : []),
  ].map((e, i) => ({ seq: i + 1, run_id: runId, ...e }));
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'events.jsonl'), `${events.map((e) => JSON.stringify(e)).join('\n')}\n`);
  if (finished) {
    fs.writeFileSync(path.join(dir, 'summary.json'), JSON.stringify({
      run_id: runId, workflow: FEATURE.name, project_id: e2e.project.id, mock, inputs, status: finished.status,
      started_at: at(0), finished_at: at(end), duration_ms: end * MIN, sessions: [], progress: trailOf(events),
    }, null, 2));
  }
  if (alive) {
    const owner = { pid: 4242, host: 'studio-pc', role: 'run', started_at: at(0) };
    let timer = null;
    const beat = () => {
      try { fs.writeFileSync(path.join(dir, 'owner.json'), JSON.stringify({ ...owner, heartbeat_at: new Date().toISOString() })); } catch { clearInterval(timer); }
    };
    beat();
    timer = setInterval(beat, 5000);
    timer.unref?.();
  }
  e2e.supervisorRun = { runId, approvalId: `gate-${suffix}` };
  return runId;
}

// the events of a gate the Supervisor answered with `answer` (recommended or safe), the run then stopped
const answeredGate = (at, answer, reason) => [
  ...redSuite(at),
  // the answer's label as the engine records it (gates.js gateAnswerLabel): the workflow's text + its catalog key
  { ts: at(27), type: 'supervisor.decision', step_id: GATE, kind: 'escalation', action: 'route', route: answer, explanation: reason, recommended: answer === 'stop', label: labelOf(answer), label_key: `engine.test_failed_${answer}` },
  { ts: at(27), type: 'step.finished', step_id: GATE, duration_ms: MIN, output: { choice: answer, feedback: '', by: 'supervisor', reason, label: labelOf(answer), label_key: `engine.test_failed_${answer}` } },
];

Given('the demo project has a Feature run {string} waiting at its test gate, where the Supervisor would answer {string} against the recommended {string} because {string}', async ({ e2e }, suffix, wanted, recommended, reason) => {
  writeFeatureRun(e2e, {
    suffix, start: Date.now() - 40 * MIN, mock: true, alive: true, task: `A run whose gate waits for the owner (${suffix})`,
    steps: (at) => [
      ...redSuite(at),
      { ts: at(27), type: 'supervisor.decision', step_id: GATE, kind: 'escalation', action: 'escalate', route: wanted, explanation: reason, held: 'unsafe' },
      {
        ts: at(27), type: 'approval.requested', step_id: GATE, approval_id: `gate-${suffix}`,
        message: 'The project\'s test suite still fails after 2 round(s):\n- health endpoint answers 200 (test/health.test.js)',
        choices: CHOICES,
        brief: {
          headline: 'The test suite still fails after 2 round(s): 1 failing test(s) of this run.', body: '',
          recommendation: { answer: recommended, reason: WORKFLOW_REASON, source: 'workflow', label: labelOf(recommended) }, options: [],
        },
        supervisor: { answer: wanted, label: labelOf(wanted), reason, evidence: ['logs/suite-2-full.log: 1 failure, test/health.test.js'], answered: false },
      },
    ],
  });
});

Given('the demo project has a finished Feature run {string} whose test gate the Supervisor answered with the recommended {string} because {string}', async ({ e2e }, suffix, answer, reason) => {
  labelOf(answer);
  writeFeatureRun(e2e, {
    suffix, start: Date.now() - 2 * 864e5, mock: true, finished: { status: 'failed' }, task: `A run whose gate the Supervisor answered (${suffix})`,
    steps: (at) => answeredGate(at, answer, reason),
  });
});

// a real run (mock: false) inside the watch of "the Night watch ended 2 hours ago" (8 hours long)
Given('the demo project has a real Feature run {string} from last night whose test gate the Supervisor answered with the recommended {string} because {string}', async ({ e2e }, suffix, answer, reason) => {
  labelOf(answer);
  writeFeatureRun(e2e, {
    suffix, start: Date.now() - 5 * HOUR, mock: false, finished: { status: 'failed' }, task: `A night run whose gate the Supervisor answered (${suffix})`,
    steps: (at) => answeredGate(at, answer, reason),
  });
});

const seededRun = (e2e) => {
  expect(e2e.supervisorRun, 'a run was seeded in this scenario').toBeTruthy();
  return e2e.supervisorRun;
};
// the waiting gate's card in the visible run chat
const chatGate = (e2e) => e2e.window.locator(`[data-testid="run-chat-gate"][data-gate="${seededRun(e2e).approvalId}"]`).filter({ visible: true }).first();
// what an element says: its text and its title (a reason may be a tooltip)
const wordsOf = async (locator) => `${await locator.innerText()} ${(await locator.getAttribute('title')) || ''}`.replace(/\s+/g, ' ');

Then('the run\'s test gate waits for an answer', async ({ e2e }) => {
  const gate = chatGate(e2e);
  await expect(gate).toBeVisible({ timeout: LOAD_TIMEOUT });
  // both answers are still offered, none taken
  await expect(gate.getByTestId('run-gate-choice')).toHaveCount(CHOICES.length);
  await expect(e2e.window.getByTestId('runchat-gate-answered').filter({ visible: true })).toHaveCount(0);
});

Then('the run\'s test gate shows the Supervisor\'s recommendation {string} with the reason {string}', async ({ e2e }, label, reason) => {
  const rec = chatGate(e2e).getByTestId('gate-supervisor-recommendation');
  await expect(rec).toBeVisible({ timeout: LOAD_TIMEOUT });
  await expect(rec).toContainText(/supervisor/i);
  await expect(rec).toContainText(label);
  await expect.poll(() => wordsOf(rec), { timeout: LOAD_TIMEOUT }).toMatch(new RegExp(escRe(reason)));
});

Then('the run\'s test gate was not answered by the Supervisor', async ({ e2e }) => {
  await expect(chatGate(e2e)).toBeVisible({ timeout: LOAD_TIMEOUT });
  await expect(e2e.window.getByTestId('gate-supervisor-answer').filter({ visible: true })).toHaveCount(0);
  await expect(e2e.window.getByTestId('runchat-gate-answered').filter({ visible: true })).toHaveCount(0);
});

// ---- the Run screen's Details -------------------------------------------------------------------
const runScreenAnswer = (e2e) => e2e.window.locator(`[data-testid="gate-supervisor-answer"][data-step="${GATE}"]`).filter({ visible: true }).first();

Then('the Run screen shows the test gate answered by the Supervisor with {string}', async ({ e2e }, label) => {
  const answer = runScreenAnswer(e2e);
  await expect(answer).toBeVisible({ timeout: LOAD_TIMEOUT });
  await expect(answer).toContainText(/supervisor/i);
  await expect(answer).toContainText(label);
});

Then('the Supervisor\'s answer to the test gate on the Run screen gives the reason {string}', async ({ e2e }, reason) => {
  const answer = runScreenAnswer(e2e);
  await expect(answer).toBeVisible({ timeout: LOAD_TIMEOUT });
  await expect.poll(() => wordsOf(answer), { timeout: LOAD_TIMEOUT }).toMatch(new RegExp(escRe(reason)));
});

// ---- Home's morning summary ---------------------------------------------------------------------
const morningLine = (e2e) => e2e.window.locator(`[data-testid="morning-supervisor-gate"][data-step="${GATE}"][data-run="${seededRun(e2e).runId}"]`).filter({ visible: true }).first();

Then('the morning summary lists the test gate answered by the Supervisor with {string}', async ({ e2e }, label) => {
  const line = morningLine(e2e);
  await expect(line).toBeVisible({ timeout: LOAD_TIMEOUT });
  await expect(line).toContainText(/supervisor/i);
  await expect(line).toContainText(label);
});

Then('the Supervisor\'s answer in the morning summary gives the reason {string}', async ({ e2e }, reason) => {
  const line = morningLine(e2e);
  await expect(line).toBeVisible({ timeout: LOAD_TIMEOUT });
  await expect.poll(() => wordsOf(line), { timeout: LOAD_TIMEOUT }).toMatch(new RegExp(escRe(reason)));
});
