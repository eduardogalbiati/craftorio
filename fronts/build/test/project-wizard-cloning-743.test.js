// #743: the repository step keeps one cloning state in place. Acceptance tests, written before the code, on
// the real page (packages/ui-kit/test/renderer-app-harness.js, through project-wizard-helpers.js).
// The contract assumed here:
// - after Next on the repository step (the engine answered, the clone running) there is no import card
//   (no data-testid / id / class "wizard-import-status", nor the "wizard-import" card): the step's action
//   button (data-testid="wizard-next") shows a spinner (an element with class "spinner") and reads
//   "Cloning <name>…" (the tests render in en); #wizard-repo and #wizard-name are readonly or disabled;
// - when onboarding:changed reports the clone done (status ready) the wizard goes straight to the analysis
//   step, and onboarding.import_cloned ("The clone is ready.") is never rendered;
// - a failed access check or clone shows its reason and Retry (data-act="retry", api.retryOnboarding) in
//   the step's body, without an import card.
// "At any point": every markup written into #project-wizard from the wizard's opening is recorded.
// Not unit-testable here: the panel keeping its size across the states (no layout in the fake DOM; E2E).
const test = require('node:test');
const assert = require('node:assert/strict');
const H = require('@craftorio/ui-kit/test/page-pieces');
const W = require('./project-wizard-helpers');

/** Whether some markup holds the old import card. */
const hasImportCard = (html) => !!H.findEl(String(html || ''), (e) => e.attrs['data-testid'] === 'wizard-import-status'
  || e.attrs.id === 'wizard-import-status' || W.classesOf(e).includes('wizard-import-status') || W.classesOf(e).includes('wizard-import'));

async function importedRecorded(state) {
  let writes = [];
  const app = await W.imported(state, { record: (a) => { writes = W.recordWizard(a); } });
  return { app, writes: () => writes };
}

const field = (app, id) => H.findEl(W.wizardMarkup(app), (e) => e.attrs.id === id);
const locked = (el) => !!el && ('readonly' in el.attrs || 'disabled' in el.attrs);

// ---- the clone running -----------------------------------------------------------------------------

test('#743 after Next on the repository step the clone runs without an import card', async () => {
  const { app, writes } = await importedRecorded(W.CLONING);
  assert.equal(W.currentStep(app), 'repository', 'still on the repository step while cloning');
  assert.equal(hasImportCard(W.wizardMarkup(app)), false, 'no wizard-import-status card now');
  assert.equal(writes().some(hasImportCard), false, 'no wizard-import-status card at any point');
});

test('#743 while cloning the step\'s action button shows a spinner and reads "Cloning <name>…"', async () => {
  const app = await W.imported(W.CLONING);
  const btn = W.byTestId(W.wizardMarkup(app), 'wizard-next');
  assert.ok(btn, 'the step\'s action button (data-testid="wizard-next")');
  assert.equal(W.hasSpinner(btn.inner), true, 'a spinner (class="spinner") in the button');
  assert.match(H.visibleText(btn.inner), /^Cloning New one(…|\.\.\.)$/, `the button reads "${H.visibleText(btn.inner)}"`);
});

test('#743 while cloning the repository and name fields are read-only', async () => {
  const app = await W.imported(W.CLONING);
  assert.equal(locked(field(app, 'wizard-repo')), true, '#wizard-repo readonly or disabled');
  assert.equal(locked(field(app, 'wizard-name')), true, '#wizard-name readonly or disabled');
});

// Decided with the change (3ef7f86c): Next is disabled only while the start call is in flight; a click on
// "Cloning <name>…" while the clone runs goes on to the analysis step, the clone still running there.
test('#743 a click on "Cloning <name>…" while the clone runs goes on to the analysis step, the clone still running', async () => {
  const app = await W.imported(W.CLONING);
  await W.press(app, 'wizard-next');
  assert.equal(W.currentStep(app), 'analysis', 'the analysis step after the click');
  const progress = W.byTestId(W.wizardMarkup(app), 'wizard-clone-progress');
  assert.ok(progress, 'the clone\'s progress in the footer (data-testid="wizard-clone-progress")');
  assert.equal(W.hasSpinner(progress.outer), true, 'the clone still running: a spinner');
  assert.equal(app.callsTo('startOnboarding').length, 1, 'the click does not start a second import');
});

// ---- the clone done ----------------------------------------------------------------------------------

test('#743 the clone done goes straight to the analysis step, and "The clone is ready." is never rendered', async () => {
  const { app, writes } = await importedRecorded(W.CLONING);
  await W.emit(app, W.READY);
  assert.equal(W.currentStep(app), 'analysis', 'the analysis step without another click');
  const cloned = writes().filter((html) => H.visibleText(html).includes('The clone is ready.'));
  assert.equal(cloned.length, 0, 'onboarding.import_cloned is never shown');
  assert.equal(writes().some(hasImportCard), false, 'no wizard-import-status card at any point');
});

// ---- the failures --------------------------------------------------------------------------------------

for (const [label, state] of [['no access', W.NO_ACCESS], ['a failed clone', W.CLONE_FAILED]]) {
  test(`#743 ${label}: the reason and a Retry in the step's body, without an import card`, async () => {
    const { app, writes } = await importedRecorded(state);
    const markup = W.wizardMarkup(app);
    assert.equal(hasImportCard(markup), false, 'no wizard-import-status card');
    assert.equal(writes().some(hasImportCard), false, 'no wizard-import-status card at any point');
    const body = H.findEl(markup, (e) => W.classesOf(e).includes('wizard-body'));
    assert.ok(body, 'the step\'s body (.wizard-body)');
    assert.equal(H.visibleText(body.inner).includes(state.reason), true, 'the reason in the body');
    const retry = H.findEl(body.outer, (e) => e.attrs['data-act'] === 'retry');
    assert.ok(retry, 'a Retry (data-act="retry") in the body');
    await W.clickRendered(app, retry, ['#project-wizard']);
    assert.equal(app.callsTo('retryOnboarding')[0]?.[0], W.PID);
  });
}

test('#743 a failure leaves no spinner nor "Cloning…" on the step\'s action button', async () => {
  const app = await W.imported(W.CLONE_FAILED);
  const btn = W.byTestId(W.wizardMarkup(app), 'wizard-next');
  if (!btn) return; // no action button on a failure is fine
  assert.equal(W.hasSpinner(btn.inner), false, 'no spinner once failed');
  assert.equal(/^Cloning\b/.test(H.visibleText(btn.inner)), false, `the button reads "${H.visibleText(btn.inner)}"`);
});
