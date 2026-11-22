// Findings button (#361), renderer model: where the button shows, its shortcut, and what a numbered
// pin resolves to (the element under it). Tests-first: the module does not exist yet.
//
// The interface these tests define:
// - apps/desktop/renderer/findings-model.js, a dual module like apps/desktop/renderer/default-workflow.js
//   (Browser: window.FindingsModel; Node: module.exports), with:
//   - SHORTCUT: 'Ctrl+Shift+F'; isShortcut(event) → boolean: true for a keydown with ctrlKey and
//     shiftKey and key 'F' or 'f'; false without Shift or without Ctrl.
//   - buttonVisible({ isPackaged, settings, screenshot }) → boolean: shown when the app runs from
//     source (isPackaged false) or when settings.findingsButton is true; never in a
//     scripts/screenshot.js capture (screenshot true) unless settings.findingsButton asks for it.
//   - resolvePin(target, { x, y, view, tab }) → the pin's element, plain data only:
//       { empty: false, x, y, testid, view, tab, ids, box }
//     target: the element under the pin (the caller finds it, e.g. document.elementFromPoint), or
//     null. testid: the data-testid of the target or of its nearest ancestor carrying one (null when
//     none). view, tab: the current view and tab given. ids: the ids the element carries, from the
//     data-run, data-step, data-stage, data-item, data-issue, data-session attributes on the target
//     or its ancestors (the nearest wins), only the keys found: { run?, step?, stage?, item?, issue?,
//     session? } (string values). box: the rounded getBoundingClientRect() of the element carrying
//     the testid (the target itself when none does): { x, y, width, height }.
//     A pin on empty space (target null, document.body or document.documentElement) says so:
//       { empty: true, x, y, view, tab } with no testid (null or absent) and no box.
// The module is required inside each test.
const test = require('node:test');
const assert = require('node:assert/strict');
const { createDom } = require('./mini-dom');

const load = () => require('@craftorio/shared/findings-model');

// A run screen: a run section, a step row with its stage, a Retry button carrying a session id.
function runScreen() {
  const { document } = createDom();
  document.body.innerHTML = `
    <section id="view-run" class="view" data-run="run-42">
      <div class="step" data-step="develop" data-stage="2">
        <button type="button" data-testid="step-retry" data-session="s-7"><span class="label">Retry</span></button>
        <p class="note">No id here</p>
      </div>
      <ul class="issues">
        <li data-run="run-99" data-item="it-3" data-issue="12"><a data-testid="issue-link">#12</a></li>
      </ul>
    </section>`;
  return document;
}

const rect = (x, y, width, height) => () => ({ x, y, left: x, top: y, width, height, right: x + width, bottom: y + height });
const plain = (v) => JSON.parse(JSON.stringify(v));

test('the shortcut is Ctrl+Shift+F, and only that combination opens the findings', () => {
  const m = load();
  assert.equal(m.SHORTCUT, 'Ctrl+Shift+F');
  assert.equal(m.isShortcut({ type: 'keydown', ctrlKey: true, shiftKey: true, key: 'F' }), true);
  assert.equal(m.isShortcut({ type: 'keydown', ctrlKey: true, shiftKey: true, key: 'f' }), true);
  assert.equal(m.isShortcut({ type: 'keydown', ctrlKey: true, shiftKey: false, key: 'f' }), false);
  assert.equal(m.isShortcut({ type: 'keydown', ctrlKey: false, shiftKey: true, key: 'F' }), false);
});

test('the button shows when the app runs from source, with the setting off', () => {
  assert.equal(load().buttonVisible({ isPackaged: false, settings: { findingsButton: false } }), true);
});

test('the button is hidden in a packaged build with the setting off', () => {
  assert.equal(load().buttonVisible({ isPackaged: true, settings: { findingsButton: false } }), false);
  assert.equal(load().buttonVisible({ isPackaged: true, settings: {} }), false);
});

test('the button shows in a packaged build when Settings › General › Findings button is on', () => {
  assert.equal(load().buttonVisible({ isPackaged: true, settings: { findingsButton: true } }), true);
});

test('the button never shows in a scripts/screenshot.js capture unless the setting asks for it', () => {
  const m = load();
  assert.equal(m.buttonVisible({ isPackaged: false, settings: { findingsButton: false }, screenshot: true }), false);
  assert.equal(m.buttonVisible({ isPackaged: false, settings: { findingsButton: true }, screenshot: true }), true);
});

test('a pin on a button resolves to its data-testid, the current view and tab, and the ids it carries', () => {
  const document = runScreen();
  const button = document.querySelector('[data-testid="step-retry"]');
  const pin = plain(load().resolvePin(button, { x: 40, y: 30, view: 'run', tab: 'steps' }));
  assert.equal(pin.empty, false);
  assert.equal(pin.testid, 'step-retry');
  assert.equal(pin.view, 'run');
  assert.equal(pin.tab, 'steps');
  assert.equal(pin.x, 40);
  assert.equal(pin.y, 30);
  assert.deepEqual(pin.ids, { run: 'run-42', step: 'develop', stage: '2', session: 's-7' });
});

test('a pin on a child without a testid resolves to the nearest ancestor carrying one', () => {
  const document = runScreen();
  const label = document.querySelector('.label');
  const pin = plain(load().resolvePin(label, { x: 41, y: 31, view: 'run', tab: 'steps' }));
  assert.equal(pin.empty, false);
  assert.equal(pin.testid, 'step-retry');
  assert.deepEqual(pin.ids, { run: 'run-42', step: 'develop', stage: '2', session: 's-7' });
});

test('the nearest data-* id wins, and item and issue ids are carried too', () => {
  const document = runScreen();
  const link = document.querySelector('[data-testid="issue-link"]');
  const pin = plain(load().resolvePin(link, { x: 5, y: 300, view: 'run', tab: 'issues' }));
  assert.equal(pin.testid, 'issue-link');
  assert.deepEqual(pin.ids, { run: 'run-99', item: 'it-3', issue: '12' });
});

test('an element without a testid still resolves its ids, with a null testid', () => {
  const document = runScreen();
  const note = document.querySelector('.note');
  const pin = plain(load().resolvePin(note, { x: 8, y: 60, view: 'run', tab: 'steps' }));
  assert.equal(pin.empty, false);
  assert.equal(pin.testid ?? null, null);
  assert.deepEqual(pin.ids, { run: 'run-42', step: 'develop', stage: '2' });
});

test('the pin\'s box is the rounded bounding box of the element carrying the testid', () => {
  const document = runScreen();
  const button = document.querySelector('[data-testid="step-retry"]');
  button.getBoundingClientRect = rect(10.4, 20.6, 99.5, 30.2);
  const label = document.querySelector('.label');
  label.getBoundingClientRect = rect(12, 22, 40, 16);
  const pin = plain(load().resolvePin(label, { x: 20, y: 25, view: 'run', tab: 'steps' }));
  assert.deepEqual(pin.box, { x: 10, y: 21, width: 100, height: 30 });
});

test('a pin on empty space (no element) says so: empty, no testid, no box', () => {
  const pin = plain(load().resolvePin(null, { x: 900, y: 700, view: 'run', tab: 'steps' }));
  assert.equal(pin.empty, true);
  assert.equal(pin.x, 900);
  assert.equal(pin.y, 700);
  assert.equal(pin.testid ?? null, null);
  assert.equal(pin.box ?? null, null);
  assert.equal(pin.view, 'run');
});

test('a pin on the page body is empty space too', () => {
  const document = runScreen();
  const pin = plain(load().resolvePin(document.body, { x: 1, y: 1, view: 'dashboard', tab: null }));
  assert.equal(pin.empty, true);
  assert.equal(pin.testid ?? null, null);
});
