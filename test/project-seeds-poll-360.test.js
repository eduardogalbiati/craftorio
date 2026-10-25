// #360 review: the Seeds section (src/renderer/views/project/project-seeds.js) while a seed runs. The
// poll that reads the list again for the Oracle's progress only updates the status badges and Run
// buttons: a half-typed tool command and an open result frame stay as they are; the full render at the
// end of the run keeps the typed command. An opened result page renders in standards mode: its srcdoc
// starts with one doctype (the page's own is dropped) followed by the no-network CSP.
// A mini DOM with a fake window.api (literal rows) and a fake setTimeout fired by hand (the poll's timer).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { withI18n } = require('@multiagent/shared/test/i18n-sandbox');
const { createDom } = require('./mini-dom');

const ROOT = path.join(__dirname, '..');

const ROWS = [
  { id: 'churn-complexity', name: 'churn-complexity', summary: 'Churn against complexity.', cost: 'one Oracle turn', lastRun: null, tool: null, commitsSince: null },
  { id: 'dependency-map', name: 'dependency-map', summary: 'The dependency map.', cost: 'one Oracle turn', lastRun: { date: '2026-10-01T10-00-00-000Z', costUsd: 0.12, source: 'oracle' }, tool: null, commitsSince: 0 },
];

function deferred() {
  let resolve;
  const promise = new Promise((r) => { resolve = r; });
  return { promise, resolve };
}

function loadWindow({ runSeed, page = '<html><body><h1>Dependency map</h1></body></html>' }) {
  const timers = [];
  const api = {
    listSeeds: async () => ROWS.map((r) => ({ ...r })),
    seedEstimate: async () => ({ costUsd: 0.1, free: false }),
    runSeed: async () => runSeed(),
    seedHistory: async () => [],
    seedResult: async () => ({ html: page, model: {} }),
    makeSeedTool: async () => ({ preview: true, url: null, title: 't', body: 'b' }),
    setSeedTool: async () => ({ tool: null }),
    onEvent: () => () => {},
  };
  const sandbox = {
    console, queueMicrotask, Promise,
    // the poll's timer: kept, fired by the test
    setTimeout: (fn) => { timers.push(fn); return timers.length; },
    clearTimeout: () => {},
    getComputedStyle: () => ({ getPropertyValue: () => '' }),
    localStorage: { getItem: () => null, setItem: () => {} }, sessionStorage: { getItem: () => null, setItem: () => {} },
    confirm: () => true,
    api, state: { projects: [{ id: 'p1', name: 'fixture', folder: 'C:/fixture' }], simulationOnly: true },
    esc: (s) => String(s ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`),
    errMsg: (e) => String(e?.message || e), fmtNum: (n) => String(n), fmtUsd: (n) => `US$ ${n}`, showToast: () => {},
  };
  const dom = createDom({ window: sandbox });
  Object.assign(sandbox, { window: sandbox, document: dom.document }, dom.classes);
  withI18n(sandbox);
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'views', 'project', 'project-seeds.js'), 'utf8'), sandbox, { filename: 'project-seeds.js' });
  const PS = sandbox.ProjectSeeds;
  dom.document.addEventListener('click', (e) => PS.onClick(e));
  const box = dom.document.createElement('div');
  dom.document.body.appendChild(box);
  const click = (el) => el.dispatchEvent(new dom.classes.MouseEvent('click', { bubbles: true, cancelable: true }));
  return { PS, box, click, timers };
}

const settle = async () => { for (let i = 0; i < 10; i++) await new Promise((r) => setImmediate(r)); };
const q = (box, id) => box.querySelector(`[data-testid="${id}"]`);
const text = (el) => String(el?.textContent ?? '').replace(/\s+/g, ' ').trim();
const toolInput = (box, id) => box.querySelector(`[data-seed-tool-input="${id}"]`);

async function shown(opts) {
  const w = loadWindow(opts);
  await w.PS.show('p1', w.box);
  await settle();
  return w;
}

test('#360 a poll while a seed runs keeps a half-typed tool command and the open result frame', async () => {
  const pending = deferred();
  const w = await shown({ runSeed: () => pending.promise });
  w.click(q(w.box, 'seed-open-dependency-map'));
  await settle();
  w.click(q(w.box, 'seed-tool-edit-churn-complexity'));
  await settle();
  toolInput(w.box, 'churn-complexity').value = 'node tools/chu';
  w.click(q(w.box, 'seed-run-churn-complexity'));
  await settle();
  assert.match(text(q(w.box, 'seed-status-churn-complexity')), /Running/);
  const frame = q(w.box, 'seed-frame');
  const input = toolInput(w.box, 'churn-complexity');
  assert.equal(frame === null, false, 'the result frame is open');
  assert.equal(input === null, false, 'the tool form is open');
  const srcdoc = frame.getAttribute('srcdoc');
  assert.equal(w.timers.length > 0, true, 'a poll is scheduled while the seed runs');

  w.timers.shift()();
  await settle();
  assert.equal(q(w.box, 'seed-frame') === frame, true, 'the same frame element after the poll');
  assert.equal(q(w.box, 'seed-frame').getAttribute('srcdoc'), srcdoc, 'the frame\'s srcdoc is not set again');
  assert.equal(toolInput(w.box, 'churn-complexity') === input, true, 'the same input element after the poll');
  assert.equal(toolInput(w.box, 'churn-complexity').value, 'node tools/chu');
  assert.match(text(q(w.box, 'seed-status-churn-complexity')), /Running/);

  pending.resolve({ date: '2026-10-15T10-00-00-000Z', source: 'oracle', costUsd: 0.1, simulated: true });
  await settle();
  assert.doesNotMatch(text(q(w.box, 'seed-status-churn-complexity')), /Running/);
  assert.equal(toolInput(w.box, 'churn-complexity')?.value, 'node tools/chu', 'the full render at the end of the run keeps the typed command');
});

test('#360 an opened result renders in standards mode: one doctype, first, then the no-network CSP', async () => {
  const w = await shown({ runSeed: async () => ({}), page: '<!DOCTYPE html>\n<html><body><h1>Map</h1></body></html>' });
  w.click(q(w.box, 'seed-open-dependency-map'));
  await settle();
  const srcdoc = String(q(w.box, 'seed-frame')?.getAttribute('srcdoc') || '');
  assert.match(srcdoc, /^<!doctype html>/i);
  assert.equal((srcdoc.match(/<!doctype/gi) || []).length, 1, 'the page\'s own doctype is dropped');
  assert.equal(srcdoc.indexOf('Content-Security-Policy') < srcdoc.indexOf('<h1>'), true, 'the CSP comes before the page');
  assert.match(srcdoc, /<h1>Map<\/h1>/);
});
