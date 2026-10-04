// #281 The toast's action (Undo): showToast in src/renderer/app.js takes an optional action.
// Acceptance tests written before the code. The whole page is loaded by test/renderer-app-harness.js
// (app.js's real showToast and its #toast element); after boot the page's setTimeout / clearTimeout /
// setInterval / clearInterval are replaced by a fake clock the test advances.
//
// Interface the developer implements (app.js):
//   showToast(title, detail, runId = null, gate = null, { action } = {})
//     action: { label, run }  (run may return a promise)
//   - the toast holds <button type="button" data-toast-action>label</button>;
//   - a click on it (delegated from #toast's onclick / click listener through
//     e.target.closest('[data-toast-action]'), or the button's own onclick) calls action.run() once;
//     a second click does nothing; the toast's markup (#toast innerHTML) is then re-rendered with the
//     outcome: "Restored" when run() resolves, the error's message when it throws / rejects;
//   - a click elsewhere on the toast never runs the action;
//   - with an action the toast stays 10 s (7 s without); hovering it (mouseenter / pointerenter on
//     #toast) pauses the countdown, leaving it (mouseleave / pointerleave) restarts it (at most 10 s);
//   - × (.toast-close) dismisses it without running the action;
//   - #toast has aria-live="polite" (index.html or set by showToast).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { loadApp, text, RENDERER } = require('./renderer-app-harness');

function fakeClock(sandbox) {
  const clock = { now: 0, timers: [], seq: 0 };
  const add = (fn, ms, every) => { const id = ++clock.seq; clock.timers.push({ id, fn, at: clock.now + Math.max(0, Number(ms) || 0), every }); return id; };
  const clear = (id) => { clock.timers = clock.timers.filter((t) => t.id !== id); };
  sandbox.setTimeout = (fn, ms) => add(fn, ms, null);
  sandbox.setInterval = (fn, ms) => add(fn, ms, Math.max(1, Number(ms) || 1));
  sandbox.clearTimeout = clear;
  sandbox.clearInterval = clear;
  clock.advance = (ms) => {
    const end = clock.now + ms;
    for (;;) {
      const due = clock.timers.filter((t) => t.at <= end).sort((a, b) => a.at - b.at || a.id - b.id)[0];
      if (!due) break;
      clock.now = due.at;
      if (due.every) due.at += due.every; else clear(due.id);
      try { due.fn(); } catch { /* a timer's error is the page's */ }
    }
    clock.now = end;
  };
  return clock;
}

async function page() {
  const app = loadApp();
  await app.boot();
  const clock = fakeClock(app.sandbox);
  app.sandbox.__undo = { runs: 0 };
  return { app, clock, toast: () => app.el('#toast') };
}
const show = (app, run = '() => { window.__undo.runs += 1; }') => app.run(`showToast('Removed #279', 'Stage 2 is gone', null, null, { action: { label: 'Undo', run: ${run} } })`);
const hidden = (t) => t.classList.contains('hidden');
const clickAction = (app) => app.click('[data-toast-action]', { dataset: { toastAction: '' }, within: ['#toast'] });
async function hover(app, on) {
  const el = app.el('#toast');
  const types = on ? ['mouseenter', 'pointerenter', 'mouseover'] : ['mouseleave', 'pointerleave', 'mouseout'];
  for (const type of types) {
    const ev = { type, target: el, currentTarget: el, preventDefault() {}, stopPropagation() {} };
    await el[`on${type}`]?.(ev);
    for (const fn of el.listeners[type] || []) await fn(ev);
  }
  await app.settle();
}

test('#281 showToast with an action renders its button (data-toast-action) with the label', async () => {
  const { app, toast } = await page();
  show(app);
  const html = toast().innerHTML;
  const btn = /<button\b[^>]*\bdata-toast-action\b[^>]*>([\s\S]*?)<\/button>/.exec(html);
  assert.ok(btn, 'a <button data-toast-action> in the toast');
  assert.equal(text(btn[1]), 'Undo');
});

test('#281 the action runs once (a second click does nothing) and the toast then says "Restored"', async () => {
  const { app, toast } = await page();
  show(app);
  await clickAction(app);
  await clickAction(app);
  assert.equal(app.sandbox.__undo.runs, 1);
  assert.match(text(toast().innerHTML), /Restored/);
});

test('#281 an action that fails shows its error in the toast', async () => {
  const { app, toast } = await page();
  show(app, 'async () => { throw new Error("Issue #279 is planned in another item") }');
  await clickAction(app);
  await app.settle();
  assert.match(text(toast().innerHTML), /Issue #279 is planned in another item/);
  assert.doesNotMatch(text(toast().innerHTML), /Restored/);
});

test('#281 a click elsewhere on the toast does not run the action', async () => {
  const { app, toast } = await page();
  show(app);
  assert.match(toast().innerHTML, /data-toast-action/, 'the toast has the action button');
  await app.click('#toast');
  assert.equal(app.sandbox.__undo.runs, 0);
});

test('#281 with an action the toast stays 10 s; without one 7 s', async () => {
  const { app, clock, toast } = await page();
  show(app);
  clock.advance(9999);
  const at9999 = hidden(toast());
  clock.advance(1);
  const at10000 = hidden(toast());
  app.run("showToast('Saved', 'The roadmap was saved')");
  clock.advance(6999);
  const plain6999 = hidden(toast());
  clock.advance(1);
  assert.deepEqual([at9999, at10000, plain6999, hidden(toast())], [false, true, false, true]);
});

test('#281 hovering the toast pauses its countdown; leaving it restarts it', async () => {
  const { app, clock, toast } = await page();
  show(app);
  clock.advance(5000);
  await hover(app, true);
  clock.advance(30000);
  const whileHovered = hidden(toast());
  await hover(app, false);
  clock.advance(10000);
  assert.deepEqual([whileHovered, hidden(toast())], [false, true]);
});

test('#281 × dismisses the toast without running the action', async () => {
  const { app, toast } = await page();
  show(app);
  assert.match(toast().innerHTML, /data-toast-action/, 'the toast has the action button');
  app.el('.toast-close').className = 'toast-close';
  await app.click('.toast-close', { within: ['#toast'] });
  assert.deepEqual([hidden(toast()), app.sandbox.__undo.runs], [true, 0]);
});

test('#281 the toast is announced politely (aria-live="polite")', async () => {
  const { app, toast } = await page();
  show(app);
  const tag = /<div[^>]*\bid="toast"[^>]*>/.exec(fs.readFileSync(path.join(RENDERER, 'index.html'), 'utf8'))?.[0] || '';
  assert.equal(/aria-live="polite"/.test(tag) || toast().getAttribute('aria-live') === 'polite', true);
});
