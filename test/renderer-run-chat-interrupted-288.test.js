// #288: the chat of an interrupted run (status "running" in its events, not live in this app, no
// workflow.finished: the app closed) ends with a note "Interrupted at <step> (the app closed)" with
// the cost and time so far and a primary Resume; Resume opens Resume from step… with the stopped
// step preselected (the gate's step when it stopped at a gate). A gate left open by the
// interruption says so instead of "Waiting for an answer.", its choices are hidden or disabled with
// that reason, it offers Resume, and "Interact with Oracle" stays. A live run's gate and a finished
// run's end note are unchanged.
//
// Acceptance tests written before the code, through the whole page (test/agent-chat-page-harness.js):
// window.openRunChat({ runId, workflow, running }) with a fake api.runEvents, the markup read from
// #rc-messages; window.openResumeDialog replaced by a spy after the page loaded.
//
// Interface the developer provides:
// - the note: [data-testid="runchat-interrupted-note"], holding a primary
//   <button data-testid="runchat-resume">Resume</button>;
// - an open gate of an interrupted run: [data-testid="runchat-resume"] inside its .rc-gate card;
// - openResumeDialog(runId, { step }) — `step` preselects that step in #resume-step (over the
//   service's `suggested`); called with no options it behaves as today.
const test = require('node:test');
const assert = require('node:assert/strict');
const { textOf } = require('./mini-dom');
const { loadPage, settle } = require('./agent-chat-page-harness');

const RUN = 'r-288-int';
const T0 = Date.parse('2026-10-11T10:00:00.000Z');
const at = (s) => new Date(T0 + s * 1000).toISOString();
const CHOICES = [{ id: 'approve', label: 'Merge it' }, { id: 'changes', label: 'Ask for changes', feedback_required: true }];

// a run that did Plan and Develop ($1.25), then started Evidence; `gate`: then waited at approve_merge
function events({ gate = false, finished = null } = {}) {
  let seq = 0;
  const ev = (o) => ({ seq: ++seq, run_id: RUN, ...o });
  const list = [
    ev({ type: 'workflow.started', ts: at(0), workflow: 'software-development', file: 'software-development.yaml', inputs: { task: 'Fix the widget' }, mock: true }),
    ev({ type: 'session.opened', ts: at(1), session_id: 's1', session: { agent: 'developer', provider: 'mock', model: 'claude-opus-5-5' } }),
    ev({ type: 'step.started', ts: at(1), step_id: 'develop', agent: 'developer' }),
    ev({ type: 'session.message_sent', ts: at(2), session_id: 's1', turn: 1, step_id: 'develop' }),
    ev({ type: 'session.message_received', ts: at(600), session_id: 's1', turn: 1, step_id: 'develop', text: 'Done.', cost_usd: 1.25, duration_ms: 598000 }),
    ev({ type: 'step.finished', ts: at(600), step_id: 'develop' }),
    ev({ type: 'step.started', ts: at(601), step_id: gate ? 'approve_merge' : 'evidence', agent: gate ? 'human' : 'developer' }),
  ];
  if (gate) list.push(ev({ type: 'approval.requested', ts: at(750), approval_id: 'a1', step_id: 'approve_merge', message: 'Merge the change?', choices: CHOICES }));
  else list.push(ev({ type: 'log', ts: at(750), level: 'info', message: 'evidence: taking screenshots' }));
  if (finished) list.push(ev({ type: 'workflow.finished', ts: at(800), status: finished, error: finished === 'success' ? '' : 'Tests failed: 3 of 10', summary: { cost_usd: 1.25, duration_ms: 800000 } }));
  return list;
}

async function openChat({ gate = false, finished = null, running = false, api = {} } = {}) {
  const page = await loadPage({ api: { runEvents: async () => events({ gate, finished }), ...api } });
  const resumes = [];
  page.sandbox.__resumes = resumes;
  page.run('window.openResumeDialog = (...args) => { __resumes.push(JSON.stringify(args)); }');
  page.sandbox.openRunChat({ runId: RUN, workflow: 'software-development', running });
  await settle(20);
  const box = page.$('#rc-messages');
  assert.ok(box, 'the run chat is in the page');
  return { page, box, resumes: () => resumes.map((s) => JSON.parse(s)) };
}
const q = (root, sel) => root.querySelector(sel);
const gateCard = (box) => {
  const g = q(box, '.rc-gate');
  assert.ok(g, 'the gate card is drawn');
  return g;
};
const choiceButtons = (g) => g.querySelectorAll('button[data-choice]');

// ---- the interrupted note ---------------------------------------------------------------------

test('#288 an interrupted run\'s chat ends with "Interrupted at <step> (the app closed)", the cost and time so far, and a primary Resume', async () => {
  const { box } = await openChat();
  const note = q(box, '[data-testid="runchat-interrupted-note"]');
  assert.ok(note, 'the note [data-testid="runchat-interrupted-note"]');
  const text = textOf(note);
  assert.ok(text.includes('Interrupted at Evidence (the app closed)'), text);
  assert.ok(text.includes('$1.25'), `the cost so far: ${text}`);
  assert.match(text, /12m/, `the time so far (12m 30s): ${text}`);
  const resume = q(note, '[data-testid="runchat-resume"]');
  assert.ok(resume, 'a Resume button in the note');
  assert.equal(textOf(resume), 'Resume');
  assert.equal(resume.classList.contains('primary'), true, 'Resume is the primary button');
  assert.equal(box.lastElementChild === note || box.lastElementChild.contains(note), true, 'the note is the chat\'s last message');
});

test('#288 the note\'s Resume opens Resume from step… for the run with the stopped step preselected', async () => {
  const { box, resumes } = await openChat();
  q(box, '[data-testid="runchat-interrupted-note"] [data-testid="runchat-resume"]').click();
  await settle();
  const calls = resumes();
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], RUN);
  assert.equal(calls[0][1]?.step, 'evidence');
});

test('#288 stopped at a gate: Resume preselects the gate\'s step', async () => {
  const { box, resumes } = await openChat({ gate: true });
  q(box, '[data-testid="runchat-interrupted-note"] [data-testid="runchat-resume"]').click();
  await settle();
  const calls = resumes();
  assert.equal(calls.length, 1);
  assert.equal(calls[0][1]?.step, 'approve_merge');
});

test('#288 the interrupted run still offers "Resume from step…"', async () => {
  const { box } = await openChat();
  assert.ok(box.querySelectorAll('button').some((b) => textOf(b) === 'Resume from step…'), 'Resume from step… stays');
});

// ---- the gate of an interrupted run ---------------------------------------------------------------

test('#288 an interrupted run\'s open gate says it was waiting when the run was interrupted and that resuming brings it back, not "Waiting for an answer."', async () => {
  const { box } = await openChat({ gate: true });
  const text = textOf(gateCard(box));
  assert.equal(text.includes('Waiting for an answer.'), false, text);
  assert.match(text, /interrupted/i, text);
  assert.match(text, /resum/i, text);
});

test('#288 an interrupted run\'s gate choices are hidden, or disabled with the reason in their tooltip', async () => {
  const { box } = await openChat({ gate: true });
  for (const b of choiceButtons(gateCard(box))) {
    assert.equal(b.disabled, true, `${textOf(b)} is disabled`);
    assert.match(b.getAttribute('title') || '', /interrupted/i, `${textOf(b)} says why in its title`);
  }
});

test('#288 an interrupted run\'s gate card offers Resume (stopped at the gate\'s step) and keeps "Interact with Oracle"', async () => {
  const { box, resumes } = await openChat({ gate: true });
  const g = gateCard(box);
  assert.ok(q(g, '[data-testid="gate-oracle"]'), 'Interact with Oracle stays on the card');
  const resume = q(g, '[data-testid="runchat-resume"]');
  assert.ok(resume, 'a Resume on the gate card');
  resume.click();
  await settle();
  const calls = resumes();
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], RUN);
  assert.equal(calls[0][1]?.step, 'approve_merge');
});

// ---- unchanged: a live run, a finished run --------------------------------------------------------

test('#288 a live run\'s gate keeps its choices enabled and gets no interrupted note', async () => {
  const { box } = await openChat({ gate: true, running: true });
  const buttons = choiceButtons(gateCard(box));
  assert.equal(buttons.length, 2);
  assert.deepEqual(buttons.map((b) => b.disabled), [false, false]);
  assert.equal(q(box, '[data-testid="runchat-interrupted-note"]') === null, true);
  assert.equal(q(box, '[data-testid="runchat-resume"]') === null, true);
});

test('#288 a failed run keeps its end note with "Resume from step…" and gets no interrupted note', async () => {
  const { box } = await openChat({ finished: 'failed' });
  const end = q(box, '.duo-note [data-status="failed"]');
  assert.ok(end, 'the end note says Failed');
  assert.ok(box.querySelectorAll('button').some((b) => textOf(b) === 'Resume from step…'));
  assert.equal(q(box, '[data-testid="runchat-interrupted-note"]') === null, true);
});

// ---- Resume from step… with a preselected step -------------------------------------------------------

test('#288 openResumeDialog(runId, { step }) preselects that step over the suggested one', async () => {
  const options = {
    runId: RUN, workflow: 'Software development', file: 'software-development.yaml', status: 'interrupted', active: false, mock: true,
    steps: [
      { id: 'develop', type: 'agent', gate: false, visits: 1, blockedBy: null, confirm: null },
      { id: 'evidence', type: 'agent', gate: false, visits: 1, blockedBy: null, confirm: null },
      { id: 'approve_merge', type: 'human_approval', gate: true, visits: 0, blockedBy: null, confirm: null },
    ],
    stoppedAt: 'evidence', failedStep: null, suggested: 'develop', worktree: null, sessions: [], handoffs: [],
  };
  const page = await loadPage({ api: { resumeOptions: async () => options } });
  page.sandbox.openResumeDialog(RUN, { step: 'evidence' });
  await settle(20);
  const sel = page.$('#resume-step');
  assert.ok(sel, 'the step select is drawn');
  assert.equal(sel.value, 'evidence');
});
