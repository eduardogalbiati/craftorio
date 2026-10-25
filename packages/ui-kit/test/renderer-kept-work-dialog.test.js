// packages/ui-kit/kept-work-dialog.js: the confirm modal's named-choice variant (#170), choiceDialog,
// and the kept-work question it serves, keptWorkDialog, through the whole page
// (test/agent-chat-page-harness.js). The #288 dialog (Details, direct Resume, the step link,
// Enter / Esc) is covered by test/renderer-kept-work-dialog-288.test.js.
const test = require('node:test');
const assert = require('node:assert/strict');
const { textOf } = require('./mini-dom');
const { loadPage, settle } = require('./agent-chat-page-harness');

const CHOICES = [
  { id: 'resume', label: 'Resume', line: 'Resume: goes on with the old commits.', primary: false },
  { id: 'scratch', label: 'Start over', line: 'Start over: a new run.', primary: true },
];

async function open(call) {
  const page = await loadPage({ api: { resumeRun: async () => ({ runId: 'r-new' }) } });
  page.sandbox.__resumeDialogs = [];
  page.run('window.openResumeDialog = (...args) => { __resumeDialogs.push(JSON.stringify(args)); }');
  page.sandbox.__answer = 'pending';
  page.run(`(${call}).then((id) => { __answer = id; })`);
  await settle();
  const modal = page.$('#confirm-modal');
  return { page, modal, answer: () => page.sandbox.__answer, resumeDialogs: () => page.sandbox.__resumeDialogs.map((s) => JSON.parse(s)) };
}
const choiceButtons = (modal) => modal.querySelectorAll('.modal-actions button[data-choice]');

test('confirmDialog: hides #confirm-details (a plain yes/no question has no choice lines)', async () => {
  const { page, answer } = await open('confirmDialog("Clear the roadmap", "Every stage is removed.", "Clear")');
  assert.equal(page.$('#confirm-details').classList.contains('hidden'), true);
  page.$('#btn-confirm-no').click();
  await settle();
  assert.equal(answer(), false);
});

test('choiceDialog: one button per choice (primary gets "btn primary", others "btn ghost"), the lines listed, the plain yes button hidden while open and everything restored after', async () => {
  const { page, modal, answer } = await open(`choiceDialog("Title", "Message", ${JSON.stringify(CHOICES)})`);
  assert.equal(textOf(page.$('#confirm-title')), 'Title');
  assert.equal(page.$('#btn-confirm-yes').classList.contains('hidden'), true);
  assert.equal(page.$('#confirm-details').classList.contains('hidden'), false);
  const buttons = choiceButtons(modal);
  assert.deepEqual(buttons.map((b) => [textOf(b), b.className]), [['Resume', 'btn ghost'], ['Start over', 'btn primary']]);
  buttons[1].click();
  await settle();
  assert.equal(answer(), 'scratch');
  assert.equal(page.$('#btn-confirm-yes').classList.contains('hidden'), false, 'restored after the dialog closes');
  assert.equal(choiceButtons(modal).length, 0, 'the choice buttons are removed once answered');
});

test('choiceDialog: a choice with no `line` is not listed, so #confirm-details stays hidden when none has one', async () => {
  const { page, modal } = await open('choiceDialog("T", "M", [{ id: "a", label: "A", primary: true }, { id: "b", label: "B" }])');
  assert.equal(page.$('#confirm-details').classList.contains('hidden'), true);
  assert.equal(modal.querySelector('details'), null, 'no Details without details');
  choiceButtons(modal)[0].click();
});

test('keptWorkDialog: Start over and Cancel never resume', async () => {
  for (const pick of ['scratch', null]) {
    const { page, modal, answer, resumeDialogs } = await open(`keptWorkDialog({ title: "T", message: "M", choices: ${JSON.stringify(CHOICES)}, runId: "r1", stoppedAt: "develop" })`);
    if (pick) choiceButtons(modal).find((b) => b.dataset.choice === pick).click();
    else page.$('#btn-confirm-no').click();
    await settle();
    assert.equal(answer(), pick);
    assert.deepEqual(resumeDialogs(), []);
    assert.equal(page.callsTo('resumeRun').length, 0);
  }
});

test('keptWorkDialog: a question without its stopped step opens Resume from step… on Resume', async () => {
  const { modal, answer, resumeDialogs } = await open(`keptWorkDialog({ title: "T", message: "M", choices: ${JSON.stringify(CHOICES)}, runId: "r1" })`);
  choiceButtons(modal).find((b) => b.dataset.choice === 'resume').click();
  await settle(20);
  assert.equal(answer(), 'resume');
  assert.deepEqual(resumeDialogs().map((a) => a[0]), ['r1']);
});
