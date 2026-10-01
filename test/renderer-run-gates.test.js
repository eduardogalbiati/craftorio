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

function loadGateToolsHtml() {
  const esc = /const esc = \(s\) => [^\n]+/.exec(src)[0];
  const gateToolsHtml = /function gateToolsHtml\(g, \{ disabled = false, runId = g\.run_id \|\| g\.runId \|\| '' \} = \{\}\) \{[\s\S]*?\n\}/.exec(src)[0];
  const runAppLabel = /const runAppLabel = [^\n]+/.exec(src)[0];
  for (const [name, code] of Object.entries({ gateToolsHtml, runAppLabel })) {
    assert.ok(code, `${name} not found in app.js: the source moved`);
  }
  const sandbox = {};
  vm.createContext(sandbox);
  vm.runInContext(`${esc}\n${runAppLabel}\n${gateToolsHtml}\nthis.gateToolsHtml = gateToolsHtml;`, sandbox);
  return sandbox.gateToolsHtml;
}

test('gateToolsHtml: Show the diff only with a diff_base and a work dir; Run App with local_preview or run_app; neither without either', () => {
  const gateToolsHtml = loadGateToolsHtml();
  assert.equal(gateToolsHtml({ approval_id: 'a1' }), '', 'nothing to offer: no row at all');

  const diffOnly = gateToolsHtml({ approval_id: 'a1', work_dir: '/wt', diff_base: 'origin/main' });
  assert.match(diffOnly, /data-gate-tool="diff"/);
  assert.doesNotMatch(diffOnly, /data-gate-tool="preview"/);
  assert.match(diffOnly, /data-gate-tool="folder"/, 'a work dir also offers Open the worktree / Terminal there');

  // no diff_base: no Show the diff button, even with a work dir
  const noDiffBase = gateToolsHtml({ approval_id: 'a1', work_dir: '/wt' });
  assert.doesNotMatch(noDiffBase, /data-gate-tool="diff"/);

  const previewOnly = gateToolsHtml({ approval_id: 'a1', local_preview: { command: 'npm start' }, work_dir: '/wt' });
  assert.match(previewOnly, /data-gate-tool="preview"/);
  assert.match(previewOnly, /data-gate-tool="stop"/);
  assert.match(previewOnly, /Run App: npm start/, 'the button\'s label says what it will run');

  // run_app without a config (#108): Run App is still offered, its label has no command yet
  const runAppOnly = gateToolsHtml({ approval_id: 'a1', run_app: true, work_dir: '/wt' });
  assert.match(runAppOnly, /data-gate-tool="preview"/);
  assert.match(runAppOnly, /Run App…/);

  // the run chat's own event shape (camelCase) works the same way
  const camel = gateToolsHtml({ approvalId: 'a1', workDir: '/wt', diffBase: 'origin/main', localPreview: { command: 'npm start' } });
  assert.match(camel, /data-gate-tool="diff"/);
  assert.match(camel, /data-gate-tool="preview"/);
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

// ---- #108: the gate's summary/brief, the side panel marker and the app's painted state -----------

function loadGateBrief() {
  const esc = /const esc = \(s\) => [^\n]+/.exec(src)[0];
  const gateTriesChange = /const gateTriesChange = [^\n]+/.exec(src)[0];
  const gateSideHtml = /function gateSideHtml\(g, runId = g\.run_id\) \{[\s\S]*?\n\}/.exec(src)[0];
  const lastOutput = /function lastOutput\(runId, match\) \{[\s\S]*?\n\}/.exec(src)[0];
  const gateBriefHtml = /function gateBriefHtml\(runId, g, fullHtml\) \{[\s\S]*?\n\}/.exec(src)[0];
  for (const [name, code] of Object.entries({ gateTriesChange, gateSideHtml, lastOutput, gateBriefHtml })) {
    assert.ok(code, `${name} not found in app.js: the source moved`);
  }
  const sandbox = { state: { runs: new Map() } };
  vm.createContext(sandbox);
  vm.runInContext(
    `${esc}\n${gateTriesChange}\n${gateSideHtml}\n${lastOutput}\n${gateBriefHtml}\n`
    + 'this.helpers = { gateTriesChange, gateSideHtml, gateBriefHtml };',
    sandbox,
  );
  return { ...sandbox.helpers, sandbox };
}

test('gateSideHtml: only for a gate that tries the change (run_app/local_preview and a work dir), empty otherwise', () => {
  const { gateSideHtml } = loadGateBrief();
  assert.equal(gateSideHtml({ approval_id: 'a1' }), '', 'no work dir, no local_preview/run_app: no side panel');
  assert.equal(gateSideHtml({ approval_id: 'a1', run_app: true }), '', 'run_app without a work dir does not try the change');
  const side = gateSideHtml({ approval_id: 'a1', run_app: true, work_dir: '/wt' }, 'r1');
  assert.match(side, /data-gate-side="a1"/);
  assert.match(side, /data-run="r1"/);
  assert.match(side, /data-diff=""/, 'no diff_base: nothing to mark');
  assert.match(gateSideHtml({ approval_id: 'a1', local_preview: { command: 'npm start' }, work_dir: '/wt', diff_base: 'origin/main' }), /data-diff="1"/);
});

test('gateBriefHtml: \'\' without run_app/local_preview, or without a developer output to summarise', () => {
  const { gateBriefHtml, sandbox } = loadGateBrief();
  assert.equal(gateBriefHtml('r1', { approval_id: 'a1' }, '<pre>full</pre>'), '', 'not a gate that tries the change');
  sandbox.state.runs.set('r1', { events: [] });
  assert.equal(gateBriefHtml('r1', { approval_id: 'a1', run_app: true, work_dir: '/wt' }, '<pre>full</pre>'), '', 'no developer output recorded yet');
});

test('gateBriefHtml: one line per issue (done/not done, the issue number from its URL, one sentence), the full message expandable', () => {
  const { gateBriefHtml, sandbox } = loadGateBrief();
  sandbox.state.runs.set('r1', {
    events: [{
      type: 'step.finished',
      output: {
        summary: 'Implemented both issues. Ready for review.',
        issues: [
          { issue: 'https://github.com/o/r/issues/108', done: true, summary: 'Two-column gate shipped. Extra detail.' },
          { issue: 'https://github.com/o/r/issues/109', done: false, summary: 'Artifacts tab still missing.' },
        ],
      },
    }],
  });
  const brief = gateBriefHtml('r1', { approval_id: 'a1', run_app: true, work_dir: '/wt' }, '<pre>full message</pre>');
  assert.match(brief, /<p>Implemented both issues\.<\/p>/, 'only the summary\'s first sentence');
  assert.match(brief, /class="ok"[^]*?✔ done[^]*?#108[^]*?Two-column gate shipped\./);
  assert.match(brief, /class="not"[^]*?✖ not done[^]*?#109[^]*?Artifacts tab still missing\./);
  assert.match(brief, /<summary class="small">Full message<\/summary><pre>full message<\/pre>/);
});

function loadPaintGateApps() {
  const paintGateApps = /function paintGateApps\(\) \{[\s\S]*?\n\}/.exec(src)[0];
  assert.ok(paintGateApps, 'paintGateApps not found in app.js: the source moved');
  const boxes = [];
  const fakeBox = (dataset, parts) => {
    const box = {
      dataset,
      querySelector: (sel) => parts[sel] || null,
    };
    boxes.push(box);
    return box;
  };
  const stopBtn = { classList: { hidden: false, toggle(_cls, h) { this.hidden = h; } } };
  const termBtn = { classList: { hidden: false, toggle(_cls, h) { this.hidden = h; } } };
  const stateEl = { className: '', textContent: '', title: '' };
  const errEl = { textContent: '', classList: { hidden: false, toggle(_cls, h) { this.hidden = h; } } };
  const box = fakeBox({ run: 'r1', approval: 'a1' }, {
    '[data-gate-app-state]': stateEl,
    '[data-gate-tool="stop"]': stopBtn,
    '[data-gate-tool="app-term"]': termBtn,
    '[data-gate-app-url]': null,
    '[data-gate-app-error]': errEl,
  });
  const sandbox = {
    document: { querySelectorAll: (sel) => (sel === '.gate-tools[data-run]' ? boxes : []) },
    state: { runs: new Map([['r1', { preview: null }]]) },
    dock: { tabs: [] },
  };
  vm.createContext(sandbox);
  vm.runInContext(`${paintGateApps}\nthis.paintGateApps = paintGateApps;`, sandbox);
  return { paintGateApps: sandbox.paintGateApps, sandbox, stopBtn, termBtn, stateEl, errEl };
}

test('paintGateApps: shows the running/stopped/failed state, Stop only while running, and the app\'s error when it failed', () => {
  const { paintGateApps, sandbox, stopBtn, stateEl, errEl } = loadPaintGateApps();
  paintGateApps();
  assert.equal(stateEl.textContent, '', 'nothing started yet');
  assert.equal(stopBtn.classList.hidden, true);

  sandbox.state.runs.get('r1').preview = { status: 'running', approval: 'a1', command: 'npm start' };
  paintGateApps();
  assert.equal(stateEl.textContent, '● running');
  assert.equal(stopBtn.classList.hidden, false);
  assert.equal(errEl.classList.hidden, true);

  sandbox.state.runs.get('r1').preview = { status: 'failed', approval: 'a1', error: 'port 3000 is already in use' };
  paintGateApps();
  assert.equal(stateEl.textContent, '● failed');
  assert.equal(stopBtn.classList.hidden, true);
  assert.equal(errEl.textContent, 'port 3000 is already in use');
  assert.equal(errEl.classList.hidden, false);
});
