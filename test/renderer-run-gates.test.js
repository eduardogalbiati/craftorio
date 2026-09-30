// src/renderer/app.js: human gates answered inside their run, never in an app-wide modal (#38).
// It runs only inside the Electron renderer (document, window.api), so the pure/interaction
// helpers are pulled out of the source and evaluated in a sandbox, the way
// test/renderer-run-summary.test.js checks app.js as a seam.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'app.js'), 'utf8');
const html = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'index.html'), 'utf8');

test('no app-wide approval modal: the gate is answered inside its run, never in a dialog over the app', () => {
  assert.doesNotMatch(html, /id="approval-modal"/);
  assert.doesNotMatch(src, /function openApproval|function closeApproval|function resolveApproval|state\.approval\b/);
  // the Run screen has its own gate area instead
  assert.match(html, /id="run-gates"/);
  assert.match(src, /function renderRunGates\(\)/);
});

test('renderRunGates: the gate card names the run (workflow/project/issue via runLabel) and the step, and offers Approve/Reject or its choices', () => {
  const renderRunGates = /function renderRunGates\(\) \{[\s\S]*?\n\}/.exec(src)[0];
  assert.match(renderRunGates, /runLabel\(v\.run\)/);
  assert.match(renderRunGates, /step: \$\{g\.step_id\}/);
  assert.match(renderRunGates, /data-answer="false">Reject/);
  assert.match(renderRunGates, /data-answer="true">Approve/);
  assert.match(renderRunGates, /g\.choices\.map/, 'a gate with choices offers them instead of Approve/Reject');
  assert.match(renderRunGates, /run-gate-feedback/, 'the optional feedback field');
});

test('showToast: dismissable (a close button) and never blocks: a gate still waiting opens its run, it does not re-ask itself', () => {
  const showToast = /function showToast\([^)]*\) \{[\s\S]*?\n\}/.exec(src)[0];
  assert.match(showToast, /class="toast-close"/);
  assert.match(showToast, /if \(e\.target\.closest\('\.toast-close'\)\) return;/);
  assert.match(showToast, /openGateOf\(gate\.run_id\)/);
});

function loadHelpers() {
  const esc = /const esc = \(s\) => [^\n]+/.exec(src)[0];
  const pendingGates = /const pendingGates = [^\n]+/.exec(src)[0];
  const onRunGateClick = /function onRunGateClick\(e\) \{[\s\S]*?\n\}/.exec(src)[0];
  for (const [name, code] of Object.entries({ esc, pendingGates, onRunGateClick })) {
    assert.ok(code, `${name} not found in app.js: the source moved`);
  }
  const calls = [];
  const toasts = [];
  const sandbox = {
    state: { runs: new Map() },
    api: { resolveApproval: async (...args) => { calls.push(args); return {}; } },
    errMsg: (e) => String(e?.message || e),
    showToast: (...args) => toasts.push(args),
  };
  vm.createContext(sandbox);
  vm.runInContext(`${esc}\n${pendingGates}\n${onRunGateClick}\nthis.helpers = { pendingGates, onRunGateClick };`, sandbox);
  return { sandbox, calls, toasts, helpers: sandbox.helpers };
}

// A fake gate card: e.target.closest('button[data-answer], button[data-choice]') is the button
// itself (it matches directly); button.closest('.run-gate') climbs to the card, as in the DOM.
function fakeGate({ approval = 'a1', run = 'r1', feedback = '' } = {}) {
  const feedbackTextarea = feedback !== null ? { value: feedback } : null;
  const buttons = [];
  const card = {
    dataset: { approval, run },
    querySelectorAll: (sel) => (sel === 'button' ? buttons : []),
    querySelector: (sel) => (sel === '.run-gate-feedback' ? feedbackTextarea : null),
  };
  const addButton = (dataset) => {
    const btn = { dataset, disabled: false };
    btn.closest = (sel) => (sel.startsWith('button') ? btn : sel === '.run-gate' ? card : null);
    buttons.push(btn);
    return btn;
  };
  return { card, addButton };
}

test('pendingGates: every gate waiting across every run, flattened', () => {
  const { sandbox, helpers } = loadHelpers();
  sandbox.state.runs.set('r1', { approvals: new Map([['a1', { run_id: 'r1', approval_id: 'a1', step_id: 's1' }]]) });
  sandbox.state.runs.set('r2', { approvals: new Map([['a2', { run_id: 'r2', approval_id: 'a2', step_id: 's2' }], ['a3', { run_id: 'r2', approval_id: 'a3', step_id: 's3' }]]) });
  sandbox.state.runs.set('r3', { approvals: new Map() });
  // the vm context's own Array realm: compare a plain array built in this realm, not deepEqual on it
  assert.deepEqual(Array.from(helpers.pendingGates(), (g) => g.approval_id), ['a1', 'a2', 'a3']);
});

test('onRunGateClick: a binary answer resolves the gate with the run id and the feedback text, and disables its buttons', () => {
  const { helpers, calls } = loadHelpers();
  const { card, addButton } = fakeGate({ approval: 'a1', run: 'r1', feedback: 'looks good' });
  const reject = addButton({ answer: 'false' });
  const approve = addButton({ answer: 'true' });
  helpers.onRunGateClick({ target: approve });
  assert.deepEqual(calls, [['a1', true, 'looks good', 'r1']]);
  assert.equal(approve.disabled, true);
  assert.equal(reject.disabled, true);
});

test('onRunGateClick: a choice gate resolves with the choice id, even an empty-string one, never a boolean', () => {
  const { helpers, calls } = loadHelpers();
  const { addButton } = fakeGate({ approval: 'a2', run: 'r2', feedback: null });
  const choice = addButton({ choice: '' });
  helpers.onRunGateClick({ target: choice });
  assert.deepEqual(calls, [['a2', '', '', 'r2']]);
});

test('onRunGateClick: a click outside any gate button answers nothing', () => {
  const { helpers, calls } = loadHelpers();
  const somewhereElse = { closest: () => null };
  helpers.onRunGateClick({ target: somewhereElse });
  assert.deepEqual(calls, []);
});

test('onRunGateClick: a refused answer re-enables the buttons and tells the user, but never re-opens a blocking dialog', async () => {
  const { sandbox, helpers, toasts } = loadHelpers();
  sandbox.api.resolveApproval = async () => { throw new Error('offline'); };
  const { addButton } = fakeGate({ approval: 'a1', run: 'r1' });
  const approve = addButton({ answer: 'true' });
  helpers.onRunGateClick({ target: approve });
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(approve.disabled, false);
  assert.deepEqual(toasts[0].slice(0, 1), ['Could not answer the gate']);
});
