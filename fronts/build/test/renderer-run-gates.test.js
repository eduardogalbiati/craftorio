// packages/ui-kit/app.js: human gates answered inside their run, never in an app-wide modal (#38).
// renderRunGates/onRunGateClick live in views/run/run.js, what a gate offers in gate-panel.js
// (#154); app.js keeps pendingGates, showToast and the rest of the gate state. It runs only
// inside the Electron renderer (document, window.api), so the pure/interaction helpers are pulled
// out of the source and evaluated in a sandbox, the way test/renderer-run-summary.test.js checks
// app.js as a seam.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
// a page file by its page-relative name, in whichever layer holds it (the UI kit, a front, the page folder)
const pageFileOf = (rel) => require('../../../scripts/source-tree').pageFile(path.join(__dirname, '..', '..', '..'), rel);
const vm = require('vm');
const { withI18n } = require('@multiagent/shared/test/i18n-sandbox.js');

const src = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'packages', 'ui-kit', 'app.js'), 'utf8');
const gateSrc = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'packages', 'ui-kit', 'gate-panel.js'), 'utf8');
const runSrc = fs.readFileSync(pageFileOf('views/run/run.js'), 'utf8');
const html = fs.readFileSync(pageFileOf('index.html'), 'utf8');

test('no app-wide approval modal: the gate is answered inside its run, never in a dialog over the app', () => {
  assert.doesNotMatch(html, /id="approval-modal"/);
  assert.doesNotMatch(src, /function openApproval|function closeApproval|function resolveApproval|state\.approval\b/);
  // the Run screen has its own gate area instead (views/run/run.js's markup, #154)
  assert.match(runSrc, /id="run-gates"/);
  assert.match(runSrc, /function renderRunGates\(\)/);
});

test('renderRunGates: the gate card names the run (workflow/project/issue via runLabel) and the step, and offers Approve/Reject or its choices', () => {
  const renderRunGates = /function renderRunGates\(\) \{[\s\S]*?\n\}/.exec(runSrc)[0];
  assert.match(renderRunGates, /runLabel\(v\.run\)/);
  assert.match(renderRunGates, /step: \$\{g\.step_id\}/);
  assert.match(renderRunGates, /data-answer="false">\$\{esc\(g\.reject\?\.label \|\| t\('run\.reject'\)\)\}/, 'the Reject button takes its label from the gate (#213), "Reject" by default');
  assert.match(renderRunGates, /data-answer="true">\$\{esc\(g\.approve\?\.label \|\| t\('common\.approve'\)\)\}/, 'the Approve button takes its label from the gate (#213), "Approve" by default');
  const en = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', '..', 'packages', 'shared', 'i18n', 'en.json'), 'utf8'));
  assert.equal(en['run.reject'], 'Reject');
  assert.equal(en['common.approve'], 'Approve');
  assert.match(renderRunGates, /gateChoices\(g\)\.map/, 'a gate with choices offers them (plus save_to_issue, #125) instead of Approve/Reject');
  assert.match(renderRunGates, /run-gate-feedback/, 'the optional feedback field');
});

// #181: the Run screen's gate choices sit side by side in one row (shared .gate-choices with the
// run chat and Write & Review), not stacked one under the other.
test('renderRunGates: the choice buttons sit in one .row.gate-choices.run-gate-actions row, the first one primary', () => {
  const renderRunGates = /function renderRunGates\(\) \{[\s\S]*?\n\}/.exec(runSrc)[0];
  assert.match(renderRunGates, /<div class="row gate-choices run-gate-actions">\$\{buttons\}<\/div>/, 'the buttons share one row, not one per line');
  assert.match(renderRunGates, /class="btn sm \$\{i === 0 \? 'primary' : 'ghost'\}"/, 'the first choice is the primary one, the rest are ghost');
  assert.match(renderRunGates, /c\.feedback_required \? ' data-needs-text="1"' : ''/, 'feedback_required still marks the choice as needing text');
});

test('showToast: dismissable (a close button) and never blocks: a gate still waiting opens its run, it does not re-ask itself', () => {
  const showToast = /function showToast\([^)]*\) \{[\s\S]*?\n\}/.exec(src)[0];
  assert.match(showToast, /class="toast-close"/);
  assert.match(showToast, /if \(e\.target\.closest\('\.toast-close'\)\) return;/);
  assert.match(showToast, /openGateOf\(gate\.run_id\)/);
});

// run.js answers after PasteImage.settle resolves: one turn of the event loop later
const tick = () => new Promise((r) => setTimeout(r, 0));

function loadHelpers() {
  const esc =/const esc = \(s\) => [^\n]+/.exec(src)[0];
  const pendingGates = /const pendingGates = [^\n]+/.exec(src)[0];
  const onRunGateClick = /function onRunGateClick\(e\) \{[\s\S]*?\n\}/.exec(runSrc)[0];
  for (const [name, code] of Object.entries({ esc, pendingGates })) {
    assert.ok(code, `${name} not found in app.js: the source moved`);
  }
  assert.ok(onRunGateClick, 'onRunGateClick not found in views/run/run.js: the source moved');
  const calls = [];
  const toasts = [];
  const sandbox = {
    state: { runs: new Map() },
    api: { resolveApproval: async (...args) => { calls.push(args); return {}; } },
    errMsg: (e) => String(e?.message || e),
    showToast: (...args) => toasts.push(args),
    // run.js settles the pasted images of the answer (packages/ui-kit/paste-image.js)
    PasteImage: { settle: async () => {}, attachments: () => [] },
    // an accepted answer redraws the gates, the badge and the menu at once (#603)
    scheduleRender: () => {},
  };
  vm.createContext(withI18n(sandbox));
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

test('onRunGateClick: a binary answer resolves the gate with the run id and the feedback text, and disables its buttons', async () => {
  const { helpers, calls } = loadHelpers();
  const { card, addButton } = fakeGate({ approval: 'a1', run: 'r1', feedback: 'looks good' });
  const reject = addButton({ answer: 'false' });
  const approve = addButton({ answer: 'true' });
  helpers.onRunGateClick({ target: approve });
  await tick();
  assert.deepEqual(calls, [['a1', true, 'looks good', 'r1']]);
  assert.equal(approve.disabled, true);
  assert.equal(reject.disabled, true);
});

test('onRunGateClick: a choice gate resolves with the choice id, even an empty-string one, never a boolean', async () => {
  const { helpers, calls } = loadHelpers();
  const { addButton } = fakeGate({ approval: 'a2', run: 'r2', feedback: null });
  const choice = addButton({ choice: '' });
  helpers.onRunGateClick({ target: choice });
  await tick();
  assert.deepEqual(calls, [['a2', '', '', 'r2']]);
});

test('onRunGateClick: "Accept and save to issue #n" (#125) passes its save_to_issue intent as a 5th argument; a plain choice passes none', async () => {
  const { helpers, calls } = loadHelpers();
  const { addButton } = fakeGate({ approval: 'a1', run: 'r1', feedback: null });
  const saveChoice = addButton({ choice: 'accept', intent: 'save_to_issue' });
  helpers.onRunGateClick({ target: saveChoice });
  await tick();
  assert.deepEqual(calls, [['a1', 'accept', '', 'r1', 'save_to_issue']]);

  const { helpers: helpers2, calls: calls2 } = loadHelpers();
  const { addButton: addButton2 } = fakeGate({ approval: 'a2', run: 'r2', feedback: null });
  const plain = addButton2({ choice: 'accept' });
  helpers2.onRunGateClick({ target: plain });
  await tick();
  assert.deepEqual(calls2, [['a2', 'accept', '', 'r2']], 'no intent: no 5th argument at all');
});

test('onRunGateClick: a click outside any gate button answers nothing', () => {
  const { helpers, calls } = loadHelpers();
  const somewhereElse = { closest: () => null };
  helpers.onRunGateClick({ target: somewhereElse });
  assert.deepEqual(calls, []);
});

function loadGateToolsHtml() {
  const esc = /const esc = \(s\) => [^\n]+/.exec(src)[0];
  const gateToolsHtml = /function gateToolsHtml\(g, \{ disabled = false, runId = g\.run_id \|\| g\.runId \|\| '' \} = \{\}\) \{[\s\S]*?\n\}/.exec(gateSrc)[0];
  const runAppLabel = /const runAppLabel = [^\n]+/.exec(gateSrc)[0];
  for (const [name, code] of Object.entries({ gateToolsHtml, runAppLabel })) {
    assert.ok(code, `${name} not found in gate-panel.js: the source moved`);
  }
  const sandbox = {};
  vm.createContext(withI18n(sandbox));
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
  const gateTriesChange = /const gateTriesChange = [^\n]+/.exec(gateSrc)[0];
  const gateSideHtml = /function gateSideHtml\(g, runId = g\.run_id\) \{[\s\S]*?\n\}/.exec(gateSrc)[0];
  const lastOutput = /function lastOutput\(runId, match\) \{[\s\S]*?\n\}/.exec(gateSrc)[0];
  // gateBriefHtml calls gateScenariosHtml (#143): both must be in the sandbox, with its own deps.
  const scenarioPill = /const SCENARIO_PILL = [^\n]+/.exec(gateSrc)[0];
  // pending (#199): written and checked by the run, run at release by the E2E release workflow
  const scenarioLabel = /const scenarioLabel = [^\n]+/.exec(gateSrc)[0];
  const openScenarios = /const openScenarios = new Set\(\);[^\n]*/.exec(gateSrc)[0];
  const gateScenariosHtml = /function gateScenariosHtml\(runId, g = \{\}\) \{[\s\S]*?\n\}/.exec(gateSrc)[0];
  const gateBriefHtml = /function gateBriefHtml\(runId, g, fullHtml\) \{[\s\S]*?\n\}/.exec(gateSrc)[0];
  for (const [name, code] of Object.entries({ gateTriesChange, gateSideHtml, lastOutput, scenarioPill, scenarioLabel, openScenarios, gateScenariosHtml, gateBriefHtml })) {
    assert.ok(code, `${name} not found in gate-panel.js: the source moved`);
  }
  const sandbox = { state: { runs: new Map() }, window: {} };
  vm.createContext(withI18n(sandbox));
  vm.runInContext(
    `${esc}\n${gateTriesChange}\n${gateSideHtml}\n${lastOutput}\n${scenarioPill}\n${scenarioLabel}\n${openScenarios}\n${gateScenariosHtml}\n${gateBriefHtml}\n`
    + 'this.helpers = { gateTriesChange, gateSideHtml, gateScenariosHtml, gateBriefHtml };',
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

// ---- gateScenariosHtml (#143): the test writer's E2E scenarios for the Dev/QA -----------------

test('gateScenariosHtml: \'\' with no scenarios output and no mention of E2E scenarios in the gate message', () => {
  const { gateScenariosHtml, sandbox } = loadGateBrief();
  sandbox.state.runs.set('r1', { events: [] });
  assert.equal(gateScenariosHtml('r1', { approval_id: 'a1', message: 'Approve the merge?' }), '');
});

test('gateScenariosHtml: a "None yet" placeholder when the gate message already mentions E2E scenarios but none ran yet', () => {
  const { gateScenariosHtml, sandbox } = loadGateBrief();
  sandbox.state.runs.set('r1', { events: [] });
  const html = gateScenariosHtml('r1', { approval_id: 'a1', message: 'E2E scenarios: none yet.' });
  assert.match(html, /<b>E2E scenarios<\/b>/);
  assert.match(html, /None yet: the test writer writes them after the code review \(they run at release\)\./);
});

test('gateScenariosHtml: an output with an empty scenarios list says "No scenario for this change.", with the note shown', () => {
  const { gateScenariosHtml, sandbox } = loadGateBrief();
  sandbox.state.runs.set('r1', { events: [{ type: 'step.finished', output: { scenarios: [], e2e_note: 'Engine-only change' } }] });
  const html = gateScenariosHtml('r1', { approval_id: 'a1' });
  assert.match(html, /No scenario for this change\./);
  assert.match(html, /gate-scenarios-note" title="Engine-only change">Engine-only change/);
});

test('gateScenariosHtml: mixed statuses render the counts, one row per scenario, and the reason of a failed/skipped one', () => {
  const { gateScenariosHtml, sandbox } = loadGateBrief();
  sandbox.state.runs.set('r1', {
    events: [{
      type: 'step.finished',
      output: {
        scenarios: [
          { name: 'Filter the runs', status: 'passed', steps: ['Given a dashboard'] },
          { name: 'Empty filter result', status: 'failed', reason: 'no message shown' },
          { name: 'Restart keeps the filter', status: 'skipped', reason: 'no headless browser' },
        ],
      },
    }],
  });
  const html = gateScenariosHtml('r1', { approval_id: 'a1' });
  assert.match(html, /<span class="pill pill-success">1 passed<\/span> <span class="pill pill-failed">1 failed<\/span> <span class="pill pill-cancelled">1 skipped<\/span>/);
  assert.match(html, /class="gate-scenario st-passed"[^]*?Filter the runs/);
  assert.match(html, /class="gate-scenario st-failed"[^]*?Empty filter result[^]*?no message shown/);
  assert.match(html, /class="gate-scenario st-skipped"[^]*?Restart keeps the filter[^]*?no headless browser/);
  assert.match(html, /<b>Given<\/b> a dashboard/, 'a Given/When/Then step splits its keyword');
});

test('gateScenariosHtml: an unknown status renders as skipped (pill and text), never breaking the layout', () => {
  const { gateScenariosHtml, sandbox } = loadGateBrief();
  sandbox.state.runs.set('r1', { events: [{ type: 'step.finished', output: { scenarios: [{ name: 'A', status: 'blocked' }] } }] });
  const html = gateScenariosHtml('r1', { approval_id: 'a1' });
  assert.match(html, /class="gate-scenario st-skipped"/);
  assert.match(html, /<span class="pill pill-cancelled">skipped<\/span>/);
});

test('gateScenariosHtml: a pending scenario (#199, written by the run, run at release) gets its own pill and label, both on the count and the row', () => {
  const { gateScenariosHtml, sandbox } = loadGateBrief();
  sandbox.state.runs.set('r1', { events: [{ type: 'step.finished', output: { scenarios: [{ name: 'Open the dashboard', status: 'pending' }] } }] });
  const html = gateScenariosHtml('r1', { approval_id: 'a1' });
  assert.match(html, /<span class="pill pill-idle">1 written, run at release<\/span>/);
  assert.match(html, /class="gate-scenario st-pending"[^]*?<span class="pill pill-idle">written, run at release<\/span>[^]*?Open the dashboard/);
});

test('gateScenariosHtml: a relative screenshot resolves against the run folder; an already-absolute one is kept as-is', () => {
  const { gateScenariosHtml, sandbox } = loadGateBrief();
  sandbox.state.runs.set('r1', {
    events: [
      { type: 'workflow.started', run_dir: 'C:\\runs\\r1' },
      {
        type: 'step.finished',
        output: {
          scenarios: [
            { name: 'A', status: 'passed', screenshots: ['evidence/test/round-1/shot.png'] },
            { name: 'B', status: 'passed', screenshots: ['C:\\other\\abs.png'] },
          ],
        },
      },
    ],
  });
  const html = gateScenariosHtml('r1', { approval_id: 'a1' });
  assert.match(html, /data-gate-shot="C:\\runs\\r1\/evidence\/test\/round-1\/shot\.png"/);
  assert.match(html, /data-gate-shot="C:\\other\\abs\.png"/);
});

function loadPaintGateApps() {
  const paintGateApps = /function paintGateApps\(\) \{[\s\S]*?\n\}/.exec(gateSrc)[0];
  assert.ok(paintGateApps, 'paintGateApps not found in gate-panel.js: the source moved');
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
  vm.createContext(withI18n(sandbox));
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

// ---- mountGateSides (#108/#115): the gate side's Artifacts panel, and what "Changed files" shows ---

// A fake <aside data-gate-side> element: querySelectorAll('[data-gate-side]') finds it, classList
// tracks whether ArtifactsPanel already mounted it ('ap').
function fakeSide({ approval = 'a1', run = 'r1', diff = '1' } = {}) {
  const classes = new Set();
  return { dataset: { gateSide: approval, run, diff }, classList: { add: (c) => classes.add(c), contains: (c) => classes.has(c) } };
}

// extras.changes is built inside the sandbox (a different object realm): compare plain data, not identity
const plain = (v) => JSON.parse(JSON.stringify(v));

function loadMountGateSides() {
  const lastOutput = /function lastOutput\(runId, match\) \{[\s\S]*?\n\}/.exec(gateSrc)[0];
  const lastCapture = /function lastCapture\(runId\) \{[\s\S]*?\n\}/.exec(gateSrc)[0];
  const mountGateSides = /function mountGateSides\(root\) \{[\s\S]*?\n\}/.exec(gateSrc)[0];
  for (const [name, code] of Object.entries({ lastOutput, lastCapture, mountGateSides })) {
    assert.ok(code, `${name} not found in gate-panel.js: the source moved`);
  }
  const mounted = []; // every ArtifactsPanel.mount({ el, opts }) call
  const artifactsPanel = {
    mount: (el, opts) => {
      const panel = { extras: opts.extras, setExtras(x) { this.extras = x; } };
      mounted.push({ el, opts, panel });
      return panel;
    },
  };
  const diffViewerCalls = [];
  const sandbox = {
    state: { runs: new Map() },
    api: { gateChanges: async () => { throw new Error('gate:changes must not be called for a simulated run'); } },
    openTerminal: () => Promise.resolve(),
    showToast: () => {},
    errMsg: (e) => String(e?.message || e),
    // mountGateSides checks window.ArtifactsPanel, but calls the bare global ArtifactsPanel.mount
    ArtifactsPanel: artifactsPanel,
    window: { ArtifactsPanel: artifactsPanel },
    DiffViewer: { open: (opts) => diffViewerCalls.push(opts) },
  };
  vm.createContext(withI18n(sandbox));
  // mountGateSides also calls mountGateScenarios(root) first (#143); these tests are about the
  // Artifacts panel, not the E2E scenarios block, so a no-op stub keeps them focused.
  vm.runInContext(
    `const mountGateScenarios = () => {};\n${lastOutput}\n${lastCapture}\n${mountGateSides}\nthis.mountGateSides = mountGateSides;`,
    sandbox,
  );
  return { mountGateSides: sandbox.mountGateSides, sandbox, mounted, diffViewerCalls, gateChangesCalls: () => mounted };
}

test('mountGateSides: a simulated run (run.mock) never calls gate:changes, even with changed files reported', async () => {
  const { mountGateSides, sandbox, mounted } = loadMountGateSides();
  sandbox.state.runs.set('r1', {
    run: { mock: true },
    events: [{ type: 'step.finished', output: { files_changed: [{ file: 'src/a.js' }, 'src/b.js'] } }],
  });
  const root = { querySelectorAll: () => [fakeSide({ run: 'r1' })] };
  mountGateSides(root);
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(mounted.length, 1);
  assert.deepEqual(plain(mounted[0].panel.extras.changes), [{ file: 'src/a.js', added: null, deleted: null }, { file: 'src/b.js', added: null, deleted: null }]);
  assert.equal(mounted[0].panel.extras.changesReported, 'simulated');
});

test('mountGateSides: a simulated run with no reported files still shows the "simulated" badge with an empty list, never the folder\'s git diff', async () => {
  const { mountGateSides, sandbox, mounted } = loadMountGateSides();
  sandbox.state.runs.set('r1', { run: { mock: true }, events: [{ type: 'step.finished', output: {} }] });
  const root = { querySelectorAll: () => [fakeSide({ run: 'r1' })] };
  mountGateSides(root);
  await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual(plain(mounted[0].panel.extras.changes), []);
  assert.equal(mounted[0].panel.extras.changesReported, 'simulated');
});

test('mountGateSides: a real run still calls gate:changes for the side panel\'s "Changed files"', async () => {
  const { mountGateSides, sandbox, mounted } = loadMountGateSides();
  sandbox.state.runs.set('r1', { run: { mock: false }, events: [] });
  sandbox.api.gateChanges = async () => [{ file: 'src/a.js', added: 2, deleted: 0 }];
  const root = { querySelectorAll: () => [fakeSide({ run: 'r1' })] };
  mountGateSides(root);
  await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual(plain(mounted[0].panel.extras.changes), [{ file: 'src/a.js', added: 2, deleted: 0 }]);
  assert.equal('changesReported' in mounted[0].panel.extras, false, 'a real git diff: not marked as reported');
});

test('mountGateSides: a real run whose diff fails falls back to the developer\'s reported files when there are any, labelled "reported" (not "simulated")', async () => {
  const { mountGateSides, sandbox, mounted } = loadMountGateSides();
  sandbox.state.runs.set('r1', {
    run: { mock: false },
    events: [{ type: 'step.finished', output: { files_changed: [{ file: 'src/a.js' }] } }],
  });
  sandbox.api.gateChanges = async () => { throw new Error('not a git repository'); };
  const root = { querySelectorAll: () => [fakeSide({ run: 'r1' })] };
  mountGateSides(root);
  await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual(plain(mounted[0].panel.extras.changes), [{ file: 'src/a.js', added: null, deleted: null }]);
  assert.equal(mounted[0].panel.extras.changesReported, 'reported');
});

test('mountGateSides: a real run whose diff fails with nothing reported shows the error instead of silently hiding it', async () => {
  const { mountGateSides, sandbox, mounted } = loadMountGateSides();
  sandbox.state.runs.set('r1', { run: { mock: false }, events: [] });
  sandbox.api.gateChanges = async () => { throw new Error('the run\'s folder is not a git repository'); };
  const root = { querySelectorAll: () => [fakeSide({ run: 'r1' })] };
  mountGateSides(root);
  await new Promise((r) => setTimeout(r, 0));
  assert.match(mounted[0].panel.extras.changes, /Could not list them:.*not a git repository/);
});

test('mountGateSides: extras.onChange (the Changed files entries) opens the diff viewer at that file, not a terminal (#118)', async () => {
  const { mountGateSides, sandbox, mounted, diffViewerCalls } = loadMountGateSides();
  sandbox.state.runs.set('r1', { run: { mock: false }, events: [] });
  sandbox.api.gateChanges = async () => [{ file: 'src/a.js', added: 2, deleted: 0 }];
  const root = { querySelectorAll: () => [fakeSide({ run: 'r1', approval: 'a1' })] };
  mountGateSides(root);
  await new Promise((r) => setTimeout(r, 0));

  mounted[0].panel.extras.onChange('src/a.js');
  assert.deepEqual(plain(diffViewerCalls), [{ runId: 'r1', approvalId: 'a1', file: 'src/a.js' }]);
});

// ---- lastCapture (#144): extras.capture, the screenshots step's output right before the gate ----

test('mountGateSides: extras.capture is the last type: screenshots step\'s output, skipping the gates\' own answers', async () => {
  const { mountGateSides, sandbox, mounted } = loadMountGateSides();
  sandbox.state.runs.set('r1', {
    run: { mock: true },
    events: [
      { type: 'step.finished', output: { kind: 'screenshots', folder: 'developer', round: 1, taken: 1, errors: [], reason: null } },
      { type: 'step.finished', output: { approved: true } }, // a gate's own answer, never mistaken for a capture
    ],
  });
  const root = { querySelectorAll: () => [fakeSide({ run: 'r1' })] };
  mountGateSides(root);
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(mounted[0].panel.extras.capture.folder, 'developer');
  assert.equal(mounted[0].panel.extras.capture.round, 1);
});

test('mountGateSides: extras.capture is null when nothing before the gate was a screenshots step', async () => {
  const { mountGateSides, sandbox, mounted } = loadMountGateSides();
  sandbox.state.runs.set('r1', { run: { mock: true }, events: [{ type: 'step.finished', output: { summary: 'done' } }] });
  const root = { querySelectorAll: () => [fakeSide({ run: 'r1' })] };
  mountGateSides(root);
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(mounted[0].panel.extras.capture, null);
});

// ---- mountGateScenarios (#143): toggling a scenario, loading its screenshots -------------------

// A fake <details data-scenario-key> element: ontoggle is assigned by mountGateScenarios, fired by
// the test the way a real click on <summary> would (flip .open, then call it).
function fakeScenarioDetails(key) {
  const d = { dataset: { scenarioKey: key }, open: false };
  d.toggle = (open) => { d.open = open; d.ontoggle(); };
  return d;
}

// A fake <img data-gate-shot> inside a .gate-scenario-shots box: closest/getAttribute/after as
// mountGateScenarios uses them; src/hidden are plain properties.
function fakeScenarioImg(file) {
  const box = { querySelectorAll: () => [img], onclick: null, onkeydown: null };
  const img = {
    dataset: { gateShot: file }, alt: file, hidden: false, src: '',
    getAttribute: (a) => (a === 'src' ? (img.src || null) : null),
    closest: (sel) => (sel === '.gate-scenario-shots' ? box : null),
    nextElementSibling: null,
    after(el) { img.nextElementSibling = el; },
  };
  return img;
}

function loadMountGateScenarios() {
  const openScenarios = /const openScenarios = new Set\(\);[^\n]*/.exec(gateSrc)[0];
  const scenarioShots = /const scenarioShots = new Map\(\); \/\/[^\n]*/.exec(gateSrc)[0];
  const mountGateScenarios = /function mountGateScenarios\(root\) \{[\s\S]*?\n\}/.exec(gateSrc)[0];
  for (const [name, code] of Object.entries({ openScenarios, scenarioShots, mountGateScenarios })) {
    assert.ok(code, `${name} not found in gate-panel.js: the source moved`);
  }
  const readArtifactCalls = [];
  const sandbox = {
    api: {
      readArtifact: async (file) => {
        readArtifactCalls.push(file);
        if (file === 'missing.png') throw new Error('ENOENT');
        return { image: `data:image/png;base64,${file}` };
      },
    },
    window: {},
    document: { createElement: () => ({ classList: { add() {} }, textContent: '', title: '' }) },
  };
  vm.createContext(withI18n(sandbox));
  vm.runInContext(
    `${openScenarios}\n${scenarioShots}\n${mountGateScenarios}\n`
    + 'this.mountGateScenarios = mountGateScenarios; this.openScenarios = openScenarios; this.scenarioShots = scenarioShots;',
    sandbox,
  );
  return { mountGateScenarios: sandbox.mountGateScenarios, openScenarios: sandbox.openScenarios, scenarioShots: sandbox.scenarioShots, readArtifactCalls };
}

test('mountGateScenarios: opening and closing a scenario tracks it in openScenarios, kept across re-renders', () => {
  const { mountGateScenarios, openScenarios } = loadMountGateScenarios();
  const details = fakeScenarioDetails('r1\nfeature.feature\nA');
  const root = { querySelectorAll: (sel) => (sel === 'details[data-scenario-key]' ? [details] : []) };
  mountGateScenarios(root);
  details.toggle(true);
  assert.ok(openScenarios.has('r1\nfeature.feature\nA'));
  details.toggle(false);
  assert.ok(!openScenarios.has('r1\nfeature.feature\nA'));
});

test('mountGateScenarios: reads a screenshot once via artifacts:read and sets the image src, caching it', async () => {
  const { mountGateScenarios, readArtifactCalls } = loadMountGateScenarios();
  const img = fakeScenarioImg('evidence/test/round-1/shot.png');
  const root = { querySelectorAll: (sel) => (sel === 'img[data-gate-shot]' ? [img] : []) };
  mountGateScenarios(root);
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(img.src, 'data:image/png;base64,evidence/test/round-1/shot.png');
  assert.equal(img.hidden, false);
  assert.deepEqual(readArtifactCalls, ['evidence/test/round-1/shot.png']);

  // a second mount of the same root does not read it again: the Map cached it
  mountGateScenarios(root);
  await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual(readArtifactCalls, ['evidence/test/round-1/shot.png']);
});

test('mountGateScenarios: a screenshot that cannot be read stays hidden, with a "Screenshot not found" line instead', async () => {
  const { mountGateScenarios } = loadMountGateScenarios();
  const img = fakeScenarioImg('missing.png');
  const root = { querySelectorAll: (sel) => (sel === 'img[data-gate-shot]' ? [img] : []) };
  mountGateScenarios(root);
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(img.hidden, true);
  assert.match(img.nextElementSibling.textContent, /Screenshot not found: missing\.png/);
});

// ---- Run App's one-click confirmation and Edit fields (#115) --------------------------------

function loadRunAppHtml() {
  const esc = /const esc = \(s\) => [^\n]+/.exec(src)[0];
  const runAppCommandHtml = /const runAppCommandHtml = [^\n]+/.exec(gateSrc)[0];
  const runAppConfirmHtml = /function runAppConfirmHtml\(info, cfg\) \{[\s\S]*?\n\}/.exec(gateSrc)[0];
  const runAppInstallHtml = /function runAppInstallHtml\(info\) \{[\s\S]*?\n\}/.exec(gateSrc)[0];
  const runAppSetupHtml = /function runAppSetupHtml\(info, cfg = \{\}\) \{[\s\S]*?\n\}/.exec(gateSrc)[0];
  for (const [name, code] of Object.entries({ esc, runAppCommandHtml, runAppConfirmHtml, runAppInstallHtml, runAppSetupHtml })) {
    assert.ok(code, `${name} not found in app.js or gate-panel.js: the source moved`);
  }
  const sandbox = {};
  vm.createContext(withI18n(sandbox));
  vm.runInContext(
    `${esc}\n${runAppCommandHtml}\n${runAppConfirmHtml}\n${runAppInstallHtml}\n${runAppSetupHtml}\n`
    + 'this.helpers = { runAppCommandHtml, runAppConfirmHtml, runAppInstallHtml, runAppSetupHtml };',
    sandbox,
  );
  return sandbox.helpers;
}

test('runAppCommandHtml: install + command, with the folder when a monorepo app sets cwd', () => {
  const { runAppCommandHtml } = loadRunAppHtml();
  assert.equal(runAppCommandHtml({ command: 'npm start' }), '<code>npm start</code>');
  assert.equal(runAppCommandHtml({ install: 'npm ci', command: 'npm start' }), '<code>npm ci</code> + <code>npm start</code>');
  assert.equal(runAppCommandHtml({ command: 'npm start', cwd: 'apps/web' }), '<code>npm start</code> in <code>apps/web</code>');
});

test('runAppConfirmHtml: the one-click confirmation names the command and its source, with Run/Edit/Cancel, never the three-field form', () => {
  const { runAppConfirmHtml } = loadRunAppHtml();
  const info = { config: { command: 'npm start' }, from: 'package.json (scripts.start)', confirmed: false };
  const html = runAppConfirmHtml(info, { command: 'npm start' });
  assert.match(html, /Run with <code>npm start<\/code>/);
  assert.match(html, /from package\.json \(scripts\.start\)/);
  assert.match(html, /data-gate-tool="app-run">Run</);
  assert.match(html, /data-gate-tool="app-edit">Edit</);
  assert.match(html, /data-gate-tool="app-cancel">Cancel</);
  assert.doesNotMatch(html, /data-setup="command"/, 'the confirmation never shows the fields');
});

test('runAppConfirmHtml: a declared command that changed since it was confirmed warns about it', () => {
  const { runAppConfirmHtml } = loadRunAppHtml();
  const html = runAppConfirmHtml({ changed: true, config: { command: 'npm run dev' }, from: '.multiagent/local-preview.yaml' }, { command: 'npm run dev' });
  assert.match(html, /changed since you confirmed it/);
});

test('runAppConfirmHtml: a detected command (no project config yet) says it will be saved as the project\'s Local preview', () => {
  const { runAppConfirmHtml } = loadRunAppHtml();
  const html = runAppConfirmHtml({ config: null, project: { id: 'p1', name: 'demo' } }, { command: 'npm start', from: 'package.json (scripts.start)' });
  assert.match(html, /Saved as the Local preview of <b>demo<\/b>/);
});

test('runAppConfirmHtml: several monorepo apps offer a picker, pre-selecting the one already chosen', () => {
  const { runAppConfirmHtml } = loadRunAppHtml();
  const apps = [{ cwd: 'apps/api', command: 'node api.js' }, { cwd: 'apps/web', command: 'npm start' }];
  const html = runAppConfirmHtml({ config: null, suggestion: { apps } }, { command: 'npm start', cwd: 'apps/web' });
  assert.match(html, /<select data-setup-app>/);
  assert.match(html, /<option value="1" selected>apps\/web<\/option>/);
});

test('runAppSetupHtml (#111): Edit\'s fields are labelled above the controls, with a repo-file checkbox and Save/Cancel', () => {
  const { runAppSetupHtml } = loadRunAppHtml();
  const html = runAppSetupHtml({ project: { id: 'p1', name: 'demo' }, install: { state: 'none' } }, { command: 'npm start', from: 'package.json (scripts.start)' });
  assert.match(html, /<label class="small">Install[\s\S]*<input data-setup="install"/);
  assert.match(html, /<label class="small">Command[\s\S]*<input data-setup="command" value="npm start"/);
  assert.match(html, /Also write it to <code>\.multiagent\/local-preview\.yaml<\/code>/);
  assert.match(html, /data-gate-tool="app-save">Save as this project's Run App and start</);
});

test('runAppSetupHtml: a run without a project runs once, with no repo-file checkbox and a plain Run label', () => {
  const { runAppSetupHtml } = loadRunAppHtml();
  const html = runAppSetupHtml({ project: null, install: { state: 'none' } }, { command: 'git --version' });
  assert.doesNotMatch(html, /data-setup-repo/);
  assert.match(html, /data-gate-tool="app-save">Run</);
  assert.match(html, /This run has no project: it runs this time only\./);
});

// ---- #119: Save says what it does, and the install field shows whether it will run ---------------

test('runAppSetupHtml: "Saving" says what happens to the project, not the muted old "Saved as the Local preview" wording', () => {
  const { runAppSetupHtml } = loadRunAppHtml();
  const html = runAppSetupHtml({ project: { id: 'p1', name: 'demo' }, install: { state: 'none' } }, {});
  assert.match(html, /Saving makes it the Run App of <b>demo<\/b> \(Projects › Local preview\)/);
});

test('runAppInstallHtml: \'\' when there is no install step (hidden in the renderer); a badge and reason otherwise', () => {
  const { runAppInstallHtml } = loadRunAppHtml();
  assert.equal(runAppInstallHtml({ install: { state: 'none', text: 'No install step.' } }), '');
  assert.equal(runAppInstallHtml({ install: null }), '');

  const skipped = runAppInstallHtml({ install: { state: 'skipped', text: 'Install skipped: dependencies already installed.' } });
  assert.match(skipped, /install skipped/);
  assert.doesNotMatch(skipped, /class="badge warn"/, 'skipped is not a warning badge');
  assert.match(skipped, /dependencies already installed/);

  const willRun = runAppInstallHtml({ install: { state: 'will-run', text: 'Install will run: node_modules missing.' } });
  assert.match(willRun, /class="badge warn">install will run/);
  assert.match(willRun, /node_modules missing/);
});

test('runAppSetupHtml: the Install field shows runAppInstallHtml\'s badge as its hint', () => {
  const { runAppSetupHtml } = loadRunAppHtml();
  const html = runAppSetupHtml({ project: null, install: { state: 'will-run', text: 'Install will run: node_modules missing.' } }, { install: 'npm ci' });
  assert.match(html, /<label class="small">Install[\s\S]*<span class="hint">[\s\S]*install will run[\s\S]*<\/span>/);
});

test('runAppConfirmHtml: shows the install line only when the config has an install command', () => {
  const { runAppConfirmHtml } = loadRunAppHtml();
  const withInstall = runAppConfirmHtml({ config: { command: 'npm start' }, install: { state: 'will-run', text: 'Install will run: node_modules missing.' } }, { install: 'npm ci', command: 'npm start' });
  assert.match(withInstall, /install will run/);

  const withoutInstall = runAppConfirmHtml({ config: { command: 'npm start' }, install: { state: 'none', text: 'No install step.' } }, { command: 'npm start' });
  assert.doesNotMatch(withoutInstall, /install will run|install skipped/);
});

test('runAppConfirmHtml: a detected command with no project config yet offers "Save as this project\'s Run App and start"', () => {
  const { runAppConfirmHtml } = loadRunAppHtml();
  const html = runAppConfirmHtml({ config: null, project: { id: 'p1', name: 'demo' } }, { command: 'npm start', from: 'package.json (scripts.start)' });
  assert.match(html, /data-gate-tool="app-run">Save as this project's Run App and start</);
});

// ---- #125: "Accept and save to issue #n" on the decide/out_of_rounds gate ----------------------

function loadGateChoices() {
  const gateChoices = /function gateChoices\(gate\) \{[\s\S]*?\n\}/.exec(gateSrc)[0];
  assert.ok(gateChoices, 'gateChoices not found in gate-panel.js: the source moved');
  const sandbox = {};
  vm.createContext(withI18n(sandbox));
  vm.runInContext(`${gateChoices}\nthis.gateChoices = gateChoices;`, sandbox);
  return sandbox.gateChoices;
}

test('gateChoices: a run with an issue and save_to_issue adds "Accept and save to issue #n" right after the choice it answers', () => {
  const gateChoices = loadGateChoices();
  const gate = {
    choices: [{ id: 'accept', label: 'Accept the document' }, { id: 'revise', label: 'Send it back to the writer' }, { id: 'stop', label: 'Stop without accepting' }],
    save_to_issue: { choice: 'accept', issue: { number: 42 } },
  };
  const choices = plain(gateChoices(gate));
  assert.deepEqual(choices.map((c) => c.id), ['accept', 'accept', 'revise', 'stop']);
  assert.equal(choices[1].intent, 'save_to_issue');
  assert.equal(choices[1].label, 'Accept and save to issue #42');
  assert.match(choices[1].title, /nothing is sent before you confirm/);
});

test('gateChoices: a run without an issue (no save_to_issue, or save_to_issue with no matching choice) shows the choices unchanged', () => {
  const gateChoices = loadGateChoices();
  const choices = [{ id: 'accept', label: 'Accept' }, { id: 'stop', label: 'Stop' }];
  assert.deepEqual(plain(gateChoices({ choices })), choices);
  assert.deepEqual(plain(gateChoices({ choices, save_to_issue: { choice: 'accept', issue: null } })), choices, 'save_to_issue without an issue: no extra choice');
  assert.deepEqual(plain(gateChoices({ choices, save_to_issue: { choice: 'nope', issue: { number: 1 } } })), choices, 'save_to_issue points at a choice the gate does not have');
});

test('gateChoices: a binary gate (no choices) falls back to Approve/Reject, untouched by save_to_issue', () => {
  const gateChoices = loadGateChoices();
  assert.deepEqual(plain(gateChoices({})), [{ id: true, label: 'Approve' }, { id: false, label: 'Reject' }]);
});

test('gateChoices: out_of_rounds offers the same save-to-issue choice when it allows accepting', () => {
  const gateChoices = loadGateChoices();
  const gate = {
    choices: [{ id: 'accept', label: 'Accept the last draft as it is' }, { id: 'more', label: 'One more round' }, { id: 'stop', label: 'Stop without a document' }],
    save_to_issue: { choice: 'accept', issue: { number: 7 } },
  };
  const choices = gateChoices(gate);
  assert.equal(choices.find((c) => c.intent === 'save_to_issue')?.label, 'Accept and save to issue #7');
});

// ---- #443: a gate card's text stays inside the card in a narrow column ---------------------------
// The card's markup (gateCardHtml, gateBriefHtml, the Run screen's .run-gate-message) is cascaded with
// style.css by test/css-layout.js (no browser): a line of prose wraps (long words too) instead of being
// cut at the card's edge; a line that ends in "…" keeps its whole text in a title.
const { parseHtml, styleSheet, layoutOf, elements, textOf } = require('@multiagent/ui-kit/test/css-layout.js');
const NARROW = 260;
const LONG_WORD = 'fronts/build/views/run/suite_card_overflow_guard_with_a_very_long_name.js';

function loadGateCard() {
  const esc = /const esc = \(s\) => [^\n]+/.exec(src)[0];
  const gateCardHtml = /function gateCardHtml\(runId, g, fullHtml\) \{[\s\S]*?\n\}/.exec(gateSrc)[0];
  assert.ok(gateCardHtml, 'gateCardHtml not found in gate-panel.js: the source moved');
  const sandbox = {
    window: {},
    gateNextTurnsHtml: () => '', gateBriefHtml: () => '', gateTriesChange: () => false, gateScenariosHtml: () => '',
    markdownHtml: (md) => `<ul>${String(md).split('\n').map((l) => `<li>${l.replace(/^- /, '')}</li>`).join('')}</ul>`,
  };
  vm.createContext(withI18n(sandbox));
  vm.runInContext(`${esc}\n${gateCardHtml}\nthis.gateCardHtml = gateCardHtml;`, sandbox);
  return sandbox.gateCardHtml;
}

// every <li> of `root` either wraps or ends in "…" with its whole text in a title
function cutWithoutTitle(root, L) {
  return elements(root).filter((e) => e.tag === 'li')
    .filter((li) => L.computed(li).wrap === 'nowrap' && li.attrs.title !== textOf(li).trim())
    .map((li) => `"${textOf(li).trim().slice(0, 60)}"`);
}

test('#443 gate card: the status lines (gateCardHtml) wrap in a 260px column, none is cut at the edge', () => {
  const gateCardHtml = loadGateCard();
  const card = String(gateCardHtml('r1', { brief: { headline: 'A revisão pede uma decisão sua antes da mesclagem', body: `- #443 não concluído: ${LONG_WORD} ainda corta o texto\n- #437 concluído: as pills ficam em uma linha em todas as telas` } }, '<pre>full</pre>'));
  assert.match(card, /gate-card-status/, 'no status block in the gate card');
  const root = parseHtml(`<div class="run-gate" data-testid="run-gate" style="width: ${NARROW}px">${card}</div>`);
  const L = layoutOf(styleSheet(['style.css']));
  const found = L.overflows(elements(root)[0], NARROW);
  assert.deepEqual(found, [], `wider than their box:\n${found.join('\n')}`);
  assert.deepEqual(cutWithoutTitle(root, L), [], 'a status line ends in "…" without its whole text in a title');
});

test('#443 gate brief: one line per issue (gateBriefHtml) wraps in a 260px column, none is cut at the edge', () => {
  const { gateBriefHtml, sandbox } = loadGateBrief();
  sandbox.state.runs.set('r1', { events: [{ type: 'step.finished', output: { summary: 'Implementei as duas issues.', issues: [
    { issue: 'https://github.com/o/r/issues/443', done: true, summary: `O card da suíte cabe na coluna e ${LONG_WORD} termina em reticências.` },
    { issue: 'https://github.com/o/r/issues/437', done: false, summary: 'As pills de status ficam em uma linha em todas as telas do aplicativo.' },
  ] } }] });
  const brief = String(gateBriefHtml('r1', { approval_id: 'a1', run_app: true, work_dir: '/wt' }, '<pre>full</pre>'));
  assert.match(brief, /gate-issues/, 'no issue list in the gate brief');
  const root = parseHtml(`<div class="run-gate" data-testid="run-gate" style="width: ${NARROW}px">${brief}</div>`);
  const L = layoutOf(styleSheet(['style.css']));
  const found = L.overflows(elements(root)[0], NARROW);
  assert.deepEqual(found, [], `wider than their box:\n${found.join('\n')}`);
  assert.deepEqual(cutWithoutTitle(root, L), [], 'an issue line ends in "…" without its whole text in a title');
});

test('#443 gate message: a long unbreakable token in the Run screen\'s gate message wraps instead of being cut', () => {
  assert.match(runSrc, /<pre class="run-gate-message" data-testid="run-gate-message">/, 'the gate message markup moved');
  const root = parseHtml(`<div class="run-gate" style="width: ${NARROW}px"><pre class="run-gate-message" data-testid="run-gate-message">Aprovar a mesclagem de ${LONG_WORD}?</pre></div>`);
  const found = layoutOf(styleSheet(['style.css'])).overflows(elements(root)[0], NARROW);
  assert.deepEqual(found, [], `wider than their box:\n${found.join('\n')}`);
});
