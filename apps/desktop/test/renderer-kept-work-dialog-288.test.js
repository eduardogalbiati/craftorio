// #288: the kept-work dialog redone. The service builds the question (title, message, details,
// choices, the stopped step: see test/service/kept-work-288.test.js); keptWorkDialog(kept)
// (apps/desktop/renderer/kept-work-dialog.js) draws it in the confirm modal: the title and message, the
// commit counts and file names in a Details disclosure, the buttons Cancel, Start over, Resume
// (the primary one as the service says, never Cancel), each choice's line and tooltip. Resume
// resumes the old run straight at its stopped step (api.resumeRun, no Resume from step… dialog);
// a "choose another step…" link opens Resume from step… for that run. Enter = the primary choice,
// Esc = Cancel.
//
// Acceptance tests written before the code, through the whole page (test/agent-chat-page-harness.js),
// calling the page global keptWorkDialog with a fixed question.
//
// Interface the developer provides (the kept question, as the service sends it):
//   { runId, stoppedAt, title, message, details: string[] (commit counts, file names),
//     choices: [{ id: 'scratch' | 'resume', label, line?, title?, primary }] }
// - Resume → api.resumeRun(runId, stoppedAt, …) (the existing resumeRun channel), then the new run
//   is shown; keptWorkDialog resolves 'resume'. #resume-modal is never opened by it.
// - [data-testid="kept-work-choose-step"]: the "choose another step…" link → openResumeDialog(runId).
// - Enter in the open dialog = its primary choice; Esc = Cancel (resolves null).
const test = require('node:test');
const assert = require('node:assert/strict');
const { textOf } = require('./mini-dom');
const { loadPage, settle } = require('./agent-chat-page-harness');

const KEPT = (primary = 'resume') => ({
  runId: 'r-old-282',
  stoppedAt: 'evidence',
  commits: 3,
  issues: [{ number: 282 }, { number: 284 }, { number: 285 }],
  title: '#282 + #284 + #285: a run stopped at Evidence',
  message: 'The app closed while it ran Evidence. Done: Plan, Develop. Left: Evidence, Review, Merge. Spent US$1.25 in 12m 30s. main moved 2 commits since: the run merges it at the end.',
  details: ['3 commits of its own on its branch', 'Files it changed: src/widget.js, test/widget.test.js'],
  recommended: primary,
  choices: [
    { id: 'scratch', label: 'Start over', line: 'Start over: a new run from today\'s main; spends about $1.25 again.', title: 'The old commits stay in their branch', primary: primary === 'scratch' },
    { id: 'resume', label: 'Resume', line: 'Resume: goes on at Evidence with the old commits.', primary: primary === 'resume' },
  ],
});

async function openKept({ kept = KEPT(), api = {} } = {}) {
  const page = await loadPage({ api: { resumeRun: async () => ({ runId: 'r-new' }), resumeOptions: async () => ({ runId: 'r-old-282', steps: [], sessions: [], handoffs: [] }), ...api } });
  page.sandbox.__resumeDialogs = [];
  page.run('window.openResumeDialog = (...args) => { __resumeDialogs.push(JSON.stringify(args)); }');
  page.sandbox.__answer = 'pending';
  page.sandbox.__kept = kept;
  page.run('keptWorkDialog(__kept).then((id) => { __answer = id; })');
  await settle();
  const modal = page.$('#confirm-modal');
  assert.ok(modal, 'the confirm modal is in the page');
  assert.equal(modal.classList.contains('hidden'), false, 'the dialog is open');
  return {
    page,
    modal,
    answer: () => page.sandbox.__answer,
    resumeDialogs: () => page.sandbox.__resumeDialogs.map((s) => JSON.parse(s)),
    resumeRuns: () => page.callsTo('resumeRun').map((args) => JSON.parse(JSON.stringify(args))),
  };
}
// the visible buttons of the dialog's action row, in order
const actionButtons = (modal) => modal.querySelectorAll('.modal-actions button').filter((b) => !b.classList.contains('hidden') && !b.hidden);
const buttonNamed = (modal, name) => actionButtons(modal).find((b) => textOf(b) === name);

test('#288 kept-work dialog: the title and message are the service\'s, the commit counts and file names sit in a Details disclosure', async () => {
  const { modal } = await openKept();
  assert.equal(textOf(modal.querySelector('#confirm-title')), '#282 + #284 + #285: a run stopped at Evidence');
  assert.ok(textOf(modal).includes('main moved 2 commits since: the run merges it at the end.'));
  const details = modal.querySelector('details');
  assert.ok(details, 'a <details> disclosure');
  assert.equal(details.hasAttribute('open'), false, 'closed by default');
  assert.ok(textOf(details).includes('src/widget.js'), textOf(details));
  assert.ok(textOf(details).includes('3 commits of its own'), textOf(details));
});

test('#288 kept-work dialog: the buttons are Cancel, Start over, Resume in that order; Resume is primary, Cancel never', async () => {
  const { modal } = await openKept();
  assert.deepEqual(actionButtons(modal).map((b) => textOf(b)), ['Cancel', 'Start over', 'Resume']);
  assert.equal(buttonNamed(modal, 'Resume').classList.contains('primary'), true);
  assert.equal(buttonNamed(modal, 'Cancel').classList.contains('primary'), false);
  assert.equal(buttonNamed(modal, 'Start over').classList.contains('primary'), false);
});

test('#288 kept-work dialog: Start over says what it spends again, its tooltip says the old commits stay in their branch', async () => {
  const { modal } = await openKept();
  assert.ok(textOf(modal).includes('spends about $1.25 again'), textOf(modal));
  assert.equal(buttonNamed(modal, 'Start over').getAttribute('title'), 'The old commits stay in their branch');
});

test('#288 kept-work dialog: Start over primary when the service says so (the run ended before any commit), Cancel still not', async () => {
  const { modal } = await openKept({ kept: KEPT('scratch') });
  assert.equal(buttonNamed(modal, 'Start over').classList.contains('primary'), true);
  assert.equal(buttonNamed(modal, 'Resume').classList.contains('primary'), false);
  assert.equal(buttonNamed(modal, 'Cancel').classList.contains('primary'), false);
});

test('#288 kept-work dialog: Resume resumes the old run at its stopped step at once, without the Resume from step… dialog', async () => {
  const { page, modal, answer, resumeDialogs, resumeRuns } = await openKept();
  buttonNamed(modal, 'Resume').click();
  await settle(20);
  assert.equal(answer(), 'resume');
  const calls = resumeRuns();
  assert.equal(calls.length, 1, 'api.resumeRun called once');
  assert.equal(calls[0][0], 'r-old-282');
  assert.equal(calls[0][1], 'evidence');
  assert.deepEqual(resumeDialogs(), [], 'no Resume from step… dialog');
  assert.equal(page.$('#resume-modal').classList.contains('hidden'), true);
  assert.equal(modal.classList.contains('hidden'), true, 'the dialog closed');
});

test('#288 kept-work dialog: Resume with a decided human gate before the stopped step opens Resume from step… on that step with the reason, without resuming', async () => {
  const blocked = { runId: 'r-old-282', steps: [
    { id: 'develop', type: 'agent', gate: false, visits: 1, blockedBy: null, confirm: null },
    { id: 'evidence', type: 'agent', gate: false, visits: 1, blockedBy: 'approve_plan', confirm: null },
  ], sessions: [], handoffs: [] };
  const { modal, answer, resumeDialogs, resumeRuns } = await openKept({ api: { resumeOptions: async () => blocked } });
  buttonNamed(modal, 'Resume').click();
  await settle(20);
  assert.equal(answer(), 'resume');
  assert.equal(resumeRuns().length, 0, 'api.resumeRun is not called');
  const calls = resumeDialogs();
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], 'r-old-282');
  assert.equal(calls[0][1]?.step, 'evidence');
  assert.match(calls[0][1]?.note || '', /human gate/, 'a one-line reason');
});

test('#288 kept-work dialog: "choose another step…" opens Resume from step… for the old run, without resuming', async () => {
  const { modal, resumeDialogs, resumeRuns } = await openKept();
  const link = modal.querySelector('[data-testid="kept-work-choose-step"]');
  assert.ok(link, 'a [data-testid="kept-work-choose-step"] link');
  assert.match(textOf(link), /choose another step/i);
  link.click();
  await settle(20);
  const calls = resumeDialogs();
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], 'r-old-282');
  assert.equal(resumeRuns().length, 0);
});

test('#288 kept-work dialog: Enter answers the primary choice', async () => {
  const { page, modal, answer, resumeRuns } = await openKept();
  page.dom.keydown(modal.querySelector('#confirm-title'), 'Enter');
  await settle(20);
  assert.equal(answer(), 'resume');
  assert.equal(resumeRuns().length, 1);
});

test('#288 kept-work dialog: Enter with Start over primary answers "scratch"', async () => {
  const { page, modal, answer, resumeRuns } = await openKept({ kept: KEPT('scratch') });
  page.dom.keydown(modal.querySelector('#confirm-title'), 'Enter');
  await settle(20);
  assert.equal(answer(), 'scratch');
  assert.equal(resumeRuns().length, 0);
});

test('#288 kept-work dialog: Esc is Cancel: resolves null, closes, resumes nothing', async () => {
  const { page, modal, answer, resumeRuns, resumeDialogs } = await openKept();
  page.dom.keydown(modal.querySelector('#confirm-title'), 'Escape');
  await settle(20);
  assert.equal(answer(), null);
  assert.equal(modal.classList.contains('hidden'), true);
  assert.equal(resumeRuns().length, 0);
  assert.deepEqual(resumeDialogs(), []);
});
