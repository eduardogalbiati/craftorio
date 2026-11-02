// #724: the onboarding progress tray (#onboarding-tray) never covers the wizard. Acceptance tests, written
// before the code, on the real page (packages/ui-kit/test/renderer-app-harness.js, through
// project-wizard-helpers.js).
// The contract assumed here:
// - while the wizard is open, #onboarding-tray is hidden (its `hidden`, a hidden attribute or class)
//   whatever the imports' states; the wizard shows the progress itself: a circular loading is an element
//   with the class `spinner` (the app's existing one: backlog.css, wizard-workflows-spinner), in the
//   footer's wizard-clone-progress while the clone runs and in each running job row (li.wizard-job);
// - with the wizard closed, the tray lists the imports still running (a `spinner` in the tray-item) or
//   failed (the reason, data-act="retry" calling api.retryOnboarding); a finished one (engine status
//   `analyzed`) leaves the tray about 5 s later and shows the app's toast (#toast, packages/ui-kit/toast.js)
//   "<name> imported" with the action button (data-toast-action) "Open the project"; no item left: the
//   tray is hidden;
// - onboarding.analysis_running no longer names the tray (en: "tray", pt-BR: "bandeja").
// The clock: the sandbox's setTimeout / setInterval of 1 s or more are held and run by advance(ms)
// (as renderer-toast-action-281.test.js swaps sandbox.setTimeout); Date.now moves with it.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const H = require('@multiagent/ui-kit/test/page-pieces');
const W = require('./project-wizard-helpers');

const I18N = path.join(__dirname, '..', '..', '..', 'packages', 'shared', 'i18n');

// Holds the page's timers of 1 s or more (the shorter ones run as usual); advance(ms) runs the due ones
function virtualClock(app) {
  const sb = app.sandbox;
  const realSet = sb.setTimeout;
  const realClear = sb.clearTimeout;
  const held = [];
  let now = 0;
  let seq = 0;
  const hold = (fn, ms, args, every) => {
    const t = { virtual: true, id: (seq += 1), at: now + Number(ms || 0), fn, args, every };
    held.push(t);
    return t;
  };
  sb.setTimeout = (fn, ms, ...args) => (Number(ms) >= 1000 ? hold(fn, ms, args, 0) : realSet(fn, ms, ...args));
  sb.clearTimeout = (t) => {
    if (t && t.virtual) { const i = held.indexOf(t); if (i >= 0) held.splice(i, 1); return; }
    realClear(t);
  };
  sb.setInterval = (fn, ms, ...args) => hold(fn, Math.max(1000, Number(ms) || 0), args, Math.max(1000, Number(ms) || 0));
  sb.clearInterval = sb.clearTimeout;
  app.run('(() => { const real = Date.now; globalThis.__clockOffset = 0; Date.now = () => real() + globalThis.__clockOffset; })()');
  return async function advance(ms) {
    const end = now + ms;
    for (;;) {
      held.sort((a, b) => a.at - b.at);
      const due = held[0];
      if (!due || due.at > end) break;
      now = due.at;
      sb.__clockOffset = now;
      held.shift();
      if (due.every) { due.at = now + due.every; held.push(due); }
      try { due.fn(...due.args); } catch (e) { app.errors.push(e); }
      await app.settle(2);
    }
    now = end;
    sb.__clockOffset = now;
    await app.settle(10);
  };
}

const trayItem = (app, id = W.PID) => H.findEl(W.trayMarkup(app), (e) => e.attrs['data-testid'] === 'tray-item' && e.attrs['data-project'] === id);

async function closedWithClock(state = W.CLONING) {
  const app = await W.imported(state);
  const advance = virtualClock(app);
  W.wizard(app).close();
  await app.settle(10);
  return { app, advance };
}

// ---- the wizard open: the tray hidden ------------------------------------------------------------

test('#724 while the wizard is open the tray is hidden whatever the import does (cloning, failed, analyzing, analyzed)', async () => {
  const app = await W.imported(W.CLONING);
  const seen = {};
  for (const [name, state] of [['cloning', W.CLONING], ['failed', W.CLONE_FAILED], ['analyzing', W.ANALYZING], ['analyzed', W.ANALYZED]]) {
    await W.emit(app, state);
    seen[name] = W.isHidden(app, 'onboarding-tray');
  }
  assert.deepEqual(seen, { cloning: true, failed: true, analyzing: true, analyzed: true }, 'the tray hidden while the wizard is open');
});

test('#724 the tray comes back when the wizard closes with an import still running, and hides again when the wizard opens', async () => {
  const app = await W.imported(W.CLONING);
  W.wizard(app).close();
  await app.settle(10);
  assert.equal(W.isHidden(app, 'onboarding-tray'), false, 'the tray shows once the wizard is closed');
  W.wizard(app).open();
  await app.settle(10);
  assert.equal(W.isHidden(app, 'onboarding-tray'), true, 'the tray hidden again under the open wizard');
});

// ---- inside the wizard: the progress in place ------------------------------------------------------

test('#724 the wizard footer\'s clone progress shows a spinner and the project\'s name while the clone runs, none once it is done', async () => {
  const app = await W.atAnalysis();
  await W.emit(app, W.CLONING); // the clone running again (a retry) while on the analysis step
  const running = W.byTestId(W.wizardMarkup(app), 'wizard-clone-progress');
  assert.ok(running, 'data-testid="wizard-clone-progress"');
  assert.equal(W.hasSpinner(running.outer), true, 'a spinner (class="spinner") while the clone runs');
  assert.equal(H.visibleText(running.inner).includes(W.NAME), true, `the name in "${H.visibleText(running.inner)}"`);
  await W.emit(app, W.READY);
  const done = W.byTestId(W.wizardMarkup(app), 'wizard-clone-progress');
  assert.ok(done, 'data-testid="wizard-clone-progress" once cloned');
  assert.equal(W.hasSpinner(done.outer), false, 'no spinner once the clone is done');
});

test('#724 on the analysis step a running job\'s row shows a spinner; done and waiting rows do not', async () => {
  const app = await W.atAnalysis();
  await W.emit(app, W.ANALYZING); // facts running, the clone done, the rest waiting
  const rows = H.findAll(W.wizardMarkup(app), (e) => e.name === 'li' && W.classesOf(e).includes('wizard-job'));
  assert.equal(rows.length >= 2, true, 'the job rows (li.wizard-job)');
  const spinning = rows.filter((r) => W.hasSpinner(r.inner)).map((r) => H.visibleText(r.inner));
  assert.equal(spinning.length, 1, `one row with a spinner (only facts runs): ${JSON.stringify(spinning)}`);
  assert.match(spinning[0], /Facts/, 'the spinner is on the Facts row');
});

test('#724 a failure inside the wizard shows its reason and a Retry that calls api.retryOnboarding(projectId)', async () => {
  const app = await W.atAnalysis();
  await W.emit(app, W.CLONE_FAILED);
  const markup = W.wizardMarkup(app);
  assert.equal(H.visibleText(markup).includes(W.CLONE_FAILED.reason), true, 'the reason in the wizard');
  const retry = H.findEl(markup, (e) => e.attrs['data-act'] === 'retry');
  assert.ok(retry, 'a Retry (data-act="retry") in the wizard');
  await W.clickRendered(app, retry, ['#project-wizard']);
  assert.equal(app.callsTo('retryOnboarding')[0]?.[0], W.PID);
});

// ---- the wizard closed: the tray ---------------------------------------------------------------

test('#724 with the wizard closed the tray lists an import still cloning with a spinner and its name', async () => {
  const { app } = await closedWithClock(W.CLONING);
  await W.emit(app, W.CLONING);
  assert.equal(W.isHidden(app, 'onboarding-tray'), false, 'the tray shows');
  const item = trayItem(app);
  assert.ok(item, 'the import\'s tray-item');
  assert.equal(item.attrs['data-status'], 'cloning');
  assert.equal(H.visibleText(item.inner).includes(W.NAME), true, 'its name');
  assert.equal(W.hasSpinner(item.inner), true, 'a spinner (class="spinner") while it runs');
});

test('#724 with the wizard closed an analysis running shows a spinner in its tray-item', async () => {
  const { app } = await closedWithClock(W.CLONING);
  await W.emit(app, W.ANALYZING);
  const item = trayItem(app);
  assert.ok(item, 'the import\'s tray-item');
  assert.equal(W.hasSpinner(item.inner), true, 'a spinner while analyzing');
});

test('#724 with the wizard closed a failed import stays in the tray with its reason and a Retry calling api.retryOnboarding', async () => {
  const { app, advance } = await closedWithClock(W.CLONING);
  await W.emit(app, W.CLONE_FAILED);
  await advance(10000);
  assert.equal(W.isHidden(app, 'onboarding-tray'), false, 'the tray shows');
  const item = trayItem(app);
  assert.ok(item, 'the failed import stays (no 5 s removal for a failure)');
  assert.equal(H.visibleText(item.inner).includes(W.CLONE_FAILED.reason), true, 'the reason in words');
  assert.equal(W.hasSpinner(item.inner), false, 'no spinner on a failure');
  const retry = H.findEl(item.outer, (e) => e.attrs['data-act'] === 'retry');
  assert.ok(retry, 'a Retry (data-act="retry")');
  await W.clickRendered(app, retry, ['#onboarding-tray']);
  assert.equal(app.callsTo('retryOnboarding')[0]?.[0], W.PID);
});

test('#724 with the wizard closed a finished import leaves the tray about 5 s later, then the tray is hidden', async () => {
  const { app, advance } = await closedWithClock(W.CLONING);
  await W.emit(app, W.ANALYZED);
  assert.ok(trayItem(app), 'the finished import is still listed right after it finishes');
  await advance(6000);
  assert.equal(trayItem(app) === null, true, 'the finished import left the tray');
  assert.equal(W.isHidden(app, 'onboarding-tray'), true, 'no item left: the tray is hidden');
});

test('#724 a finished import (wizard closed) shows the toast "<name> imported" with the action "Open the project"', async () => {
  const { app, advance } = await closedWithClock(W.CLONING);
  await W.emit(app, W.ANALYZED);
  await advance(6000);
  const toast = app.el('#toast');
  const html = String(toast.innerHTML || '');
  assert.equal(toast.classList.contains('hidden'), false, 'the toast is shown');
  assert.equal(H.visibleText(html).includes(`${W.NAME} imported`), true, `the toast says "${W.NAME} imported": "${H.visibleText(html)}"`);
  const action = H.findEl(html, (e) => 'data-toast-action' in e.attrs);
  assert.ok(action, 'the toast\'s action button (data-toast-action)');
  assert.equal(H.visibleText(action.inner), 'Open the project');
});

test('#724 the tray with one import finished and one still cloning keeps only the running one after 5 s', async () => {
  const { app, advance } = await closedWithClock(W.CLONING);
  const OTHER = { ...W.CLONING, projectId: 'p-other' };
  await W.emit(app, OTHER);
  await W.emit(app, W.ANALYZED);
  await advance(6000);
  assert.equal(trayItem(app) === null, true, 'the finished import left');
  assert.ok(trayItem(app, 'p-other'), 'the one still cloning stays');
  assert.equal(W.isHidden(app, 'onboarding-tray'), false, 'the tray still shows');
});

// ---- the words -----------------------------------------------------------------------------------

test('#724 onboarding.analysis_running no longer mentions the tray (en "tray", pt-BR "bandeja")', () => {
  const en = JSON.parse(fs.readFileSync(path.join(I18N, 'en.json'), 'utf8'))['onboarding.analysis_running'];
  const pt = JSON.parse(fs.readFileSync(path.join(I18N, 'pt-BR.json'), 'utf8'))['onboarding.analysis_running'];
  assert.equal(typeof en, 'string', 'en has onboarding.analysis_running');
  assert.equal(typeof pt, 'string', 'pt-BR has onboarding.analysis_running');
  assert.equal(/tray/i.test(en), false, `en: "${en}"`);
  assert.equal(/bandeja/i.test(pt), false, `pt-BR: "${pt}"`);
});
