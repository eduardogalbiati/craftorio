// #454 the Roadmap's cut line dialog gives feedback. Acceptance tests written before the code.
// - a cut line set from "Release here" shows the same toast with Undo as the other roadmap edits
//   ("Set the cut line 1.3.0"); a rename shows one too ("Renamed …");
// - a save refused because the roadmap changed elsewhere (#287: api.saveRoadmap answers the stored
//   roadmap with `conflict: { reason }`) keeps the dialog open with the typed name and the reason in
//   #cut-line-error; submitting again sends the reloaded roadmap's updatedAt as the base, closes the
//   dialog and shows the toast; Cancel then closes it with nothing saved and no error on the Backlog.
// The page is the real one (test/renderer-app-harness.js, as test/renderer-release-dialog-436.test.js
// does); window.showToast (app.js) is replaced by a recorder; the dialog's form is submitted as the
// page would (its onsubmit and its submit listeners). Enter in the name field is the browser's own
// form submit (the field sits in #cut-line-form with a type="submit" button): not modelled here.
const test = require('node:test');
const assert = require('node:assert/strict');
const H = require('@multiagent/front-build/test/roadmap-status-helpers');
const { loadApp } = require('./renderer-app-harness');

const T1 = '2026-10-21T10:00:00.000Z';
const T2 = '2026-10-21T10:05:00.000Z';
const REASON = 'Stage 1 was changed elsewhere. Nothing was saved.';
const VIEW = { showAll: true, since: 'total' };

const ref = (number) => ({ number, title: `Issue ${number}`, url: `https://github.com/o/r/issues/${number}` });
const item = (id, number) => ({ id, status: 'planned', workflow: 'software-development-local-hero.yaml', inputs: {}, issues: [ref(number)] });
const roadmapData = (updatedAt = T1, release = null) => ({
  roadmap: { state: 'planned', updatedAt, stages: [
    { id: 'st1', name: '', note: '', items: [item('i1', 330)], ...(release ? { release } : {}) },
    { id: 'st2', name: '', note: '', items: [item('i2', 331)] },
  ] },
  issues: [{ number: 330, title: 'Issue 330', labels: ['bug'] }, { number: 331, title: 'Issue 331', labels: ['bug'] }],
  epics: [],
});
const stageOf = (html, s) => H.findEl(html, (e) => e.attrs['data-testid'] === 'roadmap-stage' && e.attrs['data-stage'] === String(s));
const cutOf = (html) => H.findEl(html, (e) => e.attrs['data-testid'] === 'roadmap-cut-line');

// answers: one function per saveRoadmap call (the last one repeats)
async function boot(answers) {
  const saves = [];
  const toasts = [];
  const app = loadApp({
    api: {
      listReleases: async () => ({ projectId: 'p1', releases: [], next: null, line: null, run: null }),
      saveRoadmap: async (...args) => {
        saves.push(JSON.parse(JSON.stringify(args)));
        const answer = answers[Math.min(saves.length - 1, answers.length - 1)];
        return answer(...args);
      },
      undoRoadmap: async () => roadmapData(T2),
    },
  });
  await app.boot();
  app.sandbox.showToast = (title, detail, _runId, _gate, opts) => {
    toasts.push({ title: String(title), detail: String(detail || ''), action: opts?.action ? String(opts.action.label) : null });
  };
  const R = app.sandbox.window.BacklogRoadmap;
  assert.ok(R, 'BacklogRoadmap loaded');
  return { app, R, saves, toasts };
}

// stage 1's ⋮ menu → "Release here": the dialog opens; `done` is the click's promise (pending until it closes)
async function openReleaseHere(app, R, d, ctx) {
  await R.onClick(H.clickOn(stageOf(R.html(d, () => {}, VIEW), 0).outer, (e) => e.attrs['data-testid'] === 'roadmap-stage-menu'), ctx, d);
  const done = R.onClick(H.clickOn(stageOf(R.html(d, () => {}, VIEW), 0).outer, (e) => e.attrs['data-rm-release'] === 'add'), ctx, d);
  await app.settle(30);
  assert.equal(app.el('#cut-line-modal').classList.contains('hidden'), false, 'the cut line dialog is open');
  return { done };
}
const OPTS = { timeout: 20000 };

async function submit(app) {
  const form = app.el('#cut-line-form');
  const ev = { type: 'submit', target: form, currentTarget: form, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, stopPropagation() {} };
  await form.onsubmit?.(ev);
  for (const fn of form.listeners.submit || []) await fn(ev);
  await app.settle(30);
}

const savedOk = (_p, stages) => ({ roadmap: { state: 'planned', updatedAt: T2, stages }, issues: [], edit: { id: 'e1' } });
const refusedAnswer = () => ({ ...roadmapData(T2), conflict: { reason: REASON } });
const hidden = (app) => app.el('#cut-line-modal').classList.contains('hidden');

test('#454 a cut line set from "Release here" shows a toast with Undo: "Set the cut line 1.3.0"', OPTS, async () => {
  const { app, R, saves, toasts } = await boot([savedOk]);
  const { ctx } = H.makeCtx();
  const d = roadmapData();
  const { done } = await openReleaseHere(app, R, d, ctx);
  app.el('#cut-line-name').value = '1.3.0';
  await submit(app);
  await done;
  assert.equal(saves.length, 1, 'the cut line was saved');
  assert.equal(saves[0][1][0].release?.name, '1.3.0');
  assert.equal(hidden(app), true, 'the dialog closed');
  const toast = toasts.find((x) => /cut line/i.test(x.title) && x.title.includes('1.3.0'));
  assert.ok(toast, `a toast "Set the cut line 1.3.0": ${JSON.stringify(toasts)}`);
  assert.match(String(toast.action), /undo/i, 'with Undo');
});

test('#454 renaming a cut line shows a toast too ("Renamed …")', OPTS, async () => {
  const { app, R, saves, toasts } = await boot([savedOk]);
  const { ctx } = H.makeCtx();
  const d = roadmapData(T1, { name: '1.2.0' });
  const cut = cutOf(R.html(d, () => {}, VIEW));
  assert.ok(cut, 'the cut line is drawn (fixture check)');
  const done = R.onClick(H.clickOn(cut.outer, (e) => e.attrs['data-rm-release'] === 'edit'), ctx, d);
  await app.settle(30);
  assert.equal(hidden(app), false, 'the dialog is open');
  app.el('#cut-line-name').value = '1.2.1';
  await submit(app);
  await done;
  assert.equal(saves.length, 1);
  assert.ok(toasts.some((x) => /renamed/i.test(x.title) && x.title.includes('1.2.1')), `a toast "Renamed … 1.2.1": ${JSON.stringify(toasts)}`);
});

test('#454 a refused cut line keeps the dialog open with the typed name and the reason in #cut-line-error', OPTS, async () => {
  const { app, R, saves } = await boot([refusedAnswer]);
  const { ctx } = H.makeCtx();
  const d = roadmapData();
  await openReleaseHere(app, R, d, ctx);
  app.el('#cut-line-name').value = '1.3.0';
  await submit(app);
  assert.equal(saves.length, 1, 'the save was sent');
  assert.equal(hidden(app), false, 'the dialog is still (or again) visible');
  assert.equal(String(app.el('#cut-line-name').value), '1.3.0', 'the typed name is kept');
  assert.ok(String(app.el('#cut-line-error').textContent).includes(REASON), `the reason in #cut-line-error: "${app.el('#cut-line-error').textContent}"`);
});

test('#454 after a refused cut line, submitting again sends the reloaded roadmap\'s updatedAt, closes the dialog and shows the toast', OPTS, async () => {
  const { app, R, saves, toasts } = await boot([refusedAnswer, savedOk]);
  const { ctx } = H.makeCtx();
  const d = roadmapData();
  const { done } = await openReleaseHere(app, R, d, ctx);
  app.el('#cut-line-name').value = '1.3.0';
  await submit(app);
  assert.equal(hidden(app), false, 'the refused save left the dialog open');
  await submit(app);
  await done;
  assert.equal(saves.length, 2, 'the second submit saved again');
  assert.equal(saves[0][3], T1, 'the first save was based on what the screen read');
  assert.equal(saves[1][3], T2, 'the second on the reloaded roadmap');
  assert.equal(saves[1][1][0].release?.name, '1.3.0');
  assert.equal(hidden(app), true, 'the dialog closed');
  assert.ok(toasts.some((x) => /cut line/i.test(x.title) && x.title.includes('1.3.0')), `a toast: ${JSON.stringify(toasts)}`);
});

test('#454 after a refused cut line whose stage was removed elsewhere, submitting again saves nothing and says so', OPTS, async () => {
  const gone = () => {
    const stored = roadmapData(T2);
    stored.roadmap.stages = stored.roadmap.stages.filter((s) => s.id !== 'st1');
    return { ...stored, conflict: { reason: REASON } };
  };
  const { app, R, saves } = await boot([gone, savedOk]);
  const { ctx } = H.makeCtx();
  await openReleaseHere(app, R, roadmapData(), ctx);
  app.el('#cut-line-name').value = '1.3.0';
  await submit(app);
  assert.equal(hidden(app), false, 'the refused save left the dialog open');
  await submit(app);
  assert.equal(saves.length, 1, 'nothing saved on a stage that is gone');
  assert.equal(hidden(app), false, 'the dialog stays open');
  assert.equal(String(app.el('#cut-line-name').value), '1.3.0', 'the typed name is kept');
  assert.match(String(app.el('#cut-line-error').textContent), /removed elsewhere/i);
});

test('#454 Cancel after a refused cut line closes the dialog with nothing more saved and no error left on the Backlog', OPTS, async () => {
  const { app, R, saves } = await boot([refusedAnswer]);
  const { ctx, calls } = H.makeCtx();
  const d = roadmapData();
  const { done } = await openReleaseHere(app, R, d, ctx);
  app.el('#cut-line-name').value = '1.3.0';
  await submit(app);
  assert.equal(hidden(app), false, 'the refused save left the dialog open');
  await app.click('#btn-cut-line-cancel');
  await done;
  assert.equal(hidden(app), true, 'Cancel closed the dialog');
  assert.equal(saves.length, 1, 'nothing more was saved');
  const last = calls.errors.length ? calls.errors[calls.errors.length - 1] : null;
  assert.ok(!last || !String(last).includes(REASON), `no conflict left on the Backlog's error line: ${JSON.stringify(calls.errors.map(String))}`);
});
