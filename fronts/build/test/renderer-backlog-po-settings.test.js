// fronts/build/views/backlog/backlog-po-settings.js (#189): the Product Owner drawer's settings
// panel (the calibration chip, Model/Effort, saving). It runs only inside the Electron renderer, so
// these tests check its source as a seam (extracted and run in a sandbox), the way
// test/renderer-backlog-po.test.js checks backlog-po.js.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
// a page file by its page-relative name, in whichever layer holds it (the UI kit, a front, the page folder)
const pageFileOf = (rel) => require('../../../scripts/source-tree').pageFile(path.join(__dirname, '..', '..', '..'), rel);
const vm = require('vm');
const PoCalibration = require('@multiagent/shared/po-calibration');
const { withI18n } = require('@multiagent/shared/test/i18n-sandbox');

const src = fs.readFileSync(pageFileOf('views/backlog/backlog-po-settings.js'), 'utf8');

function fakeEl() {
  const classes = new Set();
  return {
    innerHTML: '', value: '', disabled: false, title: '', textContent: '',
    classList: { toggle: (c, on) => { if (on) classes.add(c); else classes.delete(c); }, contains: (c) => classes.has(c) },
  };
}
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function loadRenderChip() {
  const stLit = /const st = \{[\s\S]*?\};/.exec(src)[0];
  const agentFn = /const agent = \(\) => [^\n]+;/.exec(src)[0];
  const savedFn = /const saved = \(\) => [^\n]+;/.exec(src)[0];
  const savedCostFn = /const savedCost = \(\) => [^\n]+;/.exec(src)[0];
  const renderChipFn = /function renderChip\([^)]*\) \{[\s\S]*?\n  \}/.exec(src)[0];
  const renderCostChipFn = /function renderCostChip\([^)]*\) \{[\s\S]*?\n  \}/.exec(src)[0];
  for (const [name, code] of Object.entries({ stLit, agentFn, savedFn, savedCostFn, renderChipFn, renderCostChipFn })) assert.ok(code, `${name} not found in backlog-po-settings.js: the source moved`);
  const elements = {};
  const $s = (sel) => elements[sel] || (elements[sel] = fakeEl());
  const sandbox = withI18n({ PoCalibration, esc, $s, window: {} });
  vm.createContext(sandbox);
  vm.runInContext(`${stLit}\n${agentFn}\n${savedFn}\n${savedCostFn}\n${renderChipFn}\n${renderCostChipFn}\nthis.renderChip = renderChip; this.st = st;`, sandbox);
  return { renderChip: sandbox.renderChip, st: sandbox.st, window: sandbox.window, chipEl: () => elements['#po-calib-chip'] };
}

test('renderChip marks the saved step with a check and the current one as selected, hides in issue mode and disables while busy', () => {
  const { renderChip, window, chipEl } = loadRenderChip();
  window.productOwnerAgent = { calibration: 2 };
  renderChip({ busy: false, issueMode: false });
  const chip = chipEl();
  assert.match(chip.innerHTML, /<option value="2" selected>✓ Speed-leaning<\/option>/);
  assert.equal(chip.classList.contains('override'), false);
  assert.equal(chip.classList.contains('hidden'), false);
  assert.equal(chip.disabled, false);
});

test('renderChip marks an override (not the saved step) with the override class and no check, and hides in issue mode', () => {
  const { renderChip, st, window, chipEl } = loadRenderChip();
  window.productOwnerAgent = { calibration: 2 };
  st.override = 5;
  renderChip({ busy: true, issueMode: true });
  const chip = chipEl();
  assert.match(chip.innerHTML, /<option value="5" selected>Quality<\/option>/); // not the saved step: no check mark
  assert.doesNotMatch(chip.innerHTML, /✓ Quality/);
  assert.equal(chip.classList.contains('override'), true);
  assert.equal(chip.classList.contains('hidden'), true);
  assert.equal(chip.disabled, true);
});

test('renderChip resets a stale override that already equals the saved step (e.g. the owner picked the saved step back)', () => {
  const { renderChip, st, window } = loadRenderChip();
  window.productOwnerAgent = { calibration: 3 };
  st.override = 3;
  renderChip({});
  assert.equal(st.override, null);
});

function loadSave({ saveAgent } = {}) {
  const stLit = /const st = \{[\s\S]*?\};/.exec(src)[0];
  const agentFn = /const agent = \(\) => [^\n]+;/.exec(src)[0];
  const savedFn = /const saved = \(\) => [^\n]+;/.exec(src)[0];
  const savedCostFn = /const savedCost = \(\) => [^\n]+;/.exec(src)[0];
  const renderEffortFn = /function renderEffort\([^)]*\) \{[\s\S]*?\n  \}/.exec(src)[0];
  const statusFn = /function status\([^)]*\) \{[\s\S]*?\n  \}/.exec(src)[0];
  const saveFn = /async function save\(patch\) \{[\s\S]*?\n  \}/.exec(src)[0];
  const productOwnerConst = /const PRODUCT_OWNER = '[^']+';/.exec(src)[0];
  for (const [name, code] of Object.entries({ stLit, agentFn, savedFn, savedCostFn, renderEffortFn, statusFn, saveFn, productOwnerConst })) {
    assert.ok(code, `${name} not found in backlog-po-settings.js: the source moved`);
  }
  const elements = {};
  const $s = (sel) => elements[sel] || (elements[sel] = fakeEl());
  const calls = [];
  const events = [];
  const defaultSaveAgent = async (id, data) => { calls.push({ id, data }); return { appearance: data.appearance, model: data.model, effort: data.effort, calibration: data.calibration }; };
  const sandbox = withI18n({
    PoCalibration,
    $s,
    window: { productOwnerAgent: { appearance: { body: '#000000' }, model: 'claude-opus-5-5', effort: 'high', calibration: 2, cost: 1 }, ChatModels: { EFFORTS: ['low', 'medium', 'high', 'xhigh'] } },
    api: { saveAgent: saveAgent ? (...a) => { calls.push({ id: a[0], data: a[1] }); return saveAgent(...a); } : defaultSaveAgent },
    errMsg: (e) => e.message,
    document: { dispatchEvent: (ev) => events.push(ev) },
    CustomEvent: class CustomEvent { constructor(type) { this.type = type; } },
  });
  vm.createContext(sandbox);
  vm.runInContext(`${productOwnerConst}\n${stLit}\n${agentFn}\n${savedFn}\n${savedCostFn}\n${renderEffortFn}\n${statusFn}\n${saveFn}\nthis.save = save;`, sandbox);
  return { save: sandbox.save, window: sandbox.window, calls, events, statusEl: () => elements['#po-set-status'] };
}

test('save sends the whole agent (appearance, model, effort) plus the saved calibration merged with the patch, applies the result locally, and announces the calibration it saved', async () => {
  const { save, window, calls, events, statusEl } = loadSave();
  await save({ calibration: 5 });
  assert.equal(calls[0].id, 'product-owner');
  // calls[0].data is built inside the vm sandbox: compare its fields, not the whole object (a cross-realm
  // nested object never deep-equals a Node-realm literal of the same shape)
  assert.equal(calls[0].data.appearance.body, '#000000');
  assert.equal(calls[0].data.model, 'claude-opus-5-5');
  assert.equal(calls[0].data.effort, 'high');
  assert.equal(calls[0].data.calibration, 5);
  assert.equal(calls[0].data.cost, 1); // the saved cost rides along with the calibration patch (#205)
  assert.equal(window.productOwnerAgent.calibration, 5); // applied locally from the save's own result
  assert.match(statusEl().textContent, /Saved\. Applies to the next answer \(Quality \(5\/5\)\)\./);
  assert.equal(events.length, 1);
  assert.equal(events[0].type, 'po:settings'); // the header's chip and model line follow the saved setting
});

test('save of the model only still carries the current calibration (unchanged), and the status names no step', async () => {
  const { save, calls, statusEl } = loadSave();
  await save({ model: 'claude-sonnet-5-5' });
  assert.equal(calls[0].data.model, 'claude-sonnet-5-5');
  assert.equal(calls[0].data.calibration, 2); // unchanged: the patch did not touch it
  assert.equal(calls[0].data.cost, 1); // unchanged too (#205)
  assert.equal(statusEl().textContent, 'Saved. Applies to the next answer.');
});

test('save reports the error and raises po:settings anyway (so the chip still re-renders) when api.saveAgent fails', async () => {
  const { save, events, statusEl } = loadSave({ saveAgent: async () => { throw new Error('network down'); } });
  await save({ calibration: 5 });
  assert.equal(statusEl().textContent, 'network down');
  assert.equal(statusEl().classList.contains('error'), true);
  assert.equal(events.length, 1);
});
