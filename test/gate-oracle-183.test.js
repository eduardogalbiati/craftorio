// #183: every human gate has an "Interact with Oracle" button (the Oracle's avatar + its label,
// next to the choices) that opens the Oracle's chat already about that gate.
//
// Assumed contract (the change creates it; these tests load it inside each test):
// NEW module src/renderer/gate-oracle.js, UMD like occupancy-chip.js / paste-image.js
// (Node: module.exports; browser: window.GateOracle), self-contained (no app.js globals needed
// at require time; Robots is optional):
//   STARTERS: string[]                       the four suggested questions, in this order
//   gateContext({ run, gate, output }) -> { chip, context }
//       run:    { run_id, project_id, workflow, version, issues: [{ number, url, title }], branch, base }
//       gate:   the gate record ({ approval_id, run_id, step_id, message, choices, feedback, ... })
//       output: the developer's step output ({ summary, files_changed, test_notes, evidence_plan, left_out, ... })
//       chip:   "Run <run id> · #<issue> · <step> · branch <branch>"
//       context: what the question to the Oracle carries (object or text; checked through
//                JSON.stringify): every field above, never a diff pasted whole (the Oracle reads
//                the diff with its tools)
//   gateOracleButtonHtml(gate, { busy = false } = {}) -> HTML of
//       <button type="button" data-testid="gate-oracle" ...><span class="oracle-avatar ...">…</span>Interact with Oracle</button>
//       busy (the Oracle answering another question): label "Oracle is answering…"
//   fillGateFeedback(cardEl, text) -> true when filled
//       "Use this text": sets the gate card's feedback <textarea> value; never answers the gate
//       (no api.resolveApproval, no click on a choice).
// The three gate surfaces (Run screen: views/run/run.js renderRunGates; run chat:
// views/runchat/runchat.js gateHtml; Write & Review: views/duo/duo.js onApproval) render that
// button in the gate card, after the choices row's start. They are evaluated in a vm sandbox with
// the real gate-panel.js and gate-oracle.js loaded, the way test/renderer-run-gates.test.js does.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const renderer = path.join(__dirname, '..', 'src', 'renderer');
const moduleFile = path.join(renderer, 'gate-oracle.js');
const read = (...p) => fs.readFileSync(path.join(...p), 'utf8');
const appSrc = read(renderer, 'app.js');
const gateSrc = read(renderer, 'gate-panel.js');
const runSrc = read(renderer, 'views', 'run', 'run.js');
const runchatSrc = read(renderer, 'views', 'runchat', 'runchat.js');
const duoSrc = read(renderer, 'views', 'duo', 'duo.js');

const load = () => require(moduleFile);
const plain = (v) => JSON.parse(JSON.stringify(v));

const RUN_ID = '20261002-105416-a6668cf0';
const RUN = {
  run_id: RUN_ID,
  project_id: 'multiagent-orchestrator',
  workflow: 'software-development-local-hero.yaml',
  version: '0.2.0',
  issues: [{ number: 143, url: 'https://github.com/o/r/issues/143', title: 'E2E/BDD scenarios' }],
  branch: 'feat/143-e2e-scenarios',
  base: 'main',
};
const CHOICES = [{ id: 'approve', label: 'Looks right' }, { id: 'changes', label: 'Ask for changes', feedback_required: true }];
const GATE = {
  approval_id: 'a1',
  run_id: RUN_ID,
  step_id: 'developer_check',
  message: 'Check the change before the code review.',
  choices: CHOICES,
  feedback: { label: 'Instructions (optional)', placeholder: 'What to change' },
};
const DIFF = 'diff --git a/src/engine/scenarios.js b/src/engine/scenarios.js\n+const PASTED_DIFF_LINE = 1;';
const OUTPUT = {
  summary: 'Added the scenarios step to the workflow.',
  files_changed: ['src/engine/scenarios.js'],
  test_notes: 'Unit tests for the scenario parser.',
  evidence_plan: 'Screenshot of the gate with the scenarios.',
  left_out: 'No visual baseline yet.',
  diff: DIFF,
};
const contextText = () => JSON.stringify(load().gateContext({ run: RUN, gate: GATE, output: OUTPUT }).context);

// ---- the context chip and the question's context --------------------------------------------

test('#183 gateContext: the chip names the run, the issue, the step and the branch', () => {
  const { chip } = load().gateContext({ run: RUN, gate: GATE, output: OUTPUT });
  assert.equal(chip, 'Run 20261002-105416-a6668cf0 · #143 · developer_check · branch feat/143-e2e-scenarios');
});

test('#183 gateContext: the context carries the run id, project, issues, step, workflow and version, branch and base', () => {
  const text = contextText();
  for (const v of [RUN_ID, 'multiagent-orchestrator', '143', 'https://github.com/o/r/issues/143', 'developer_check', 'software-development-local-hero.yaml', '0.2.0', 'feat/143-e2e-scenarios', '"main"']) {
    assert.ok(text.includes(v), `the context has ${v}`);
  }
});

test('#183 gateContext: the context carries the gate\'s message and its choices', () => {
  const text = contextText();
  for (const v of ['Check the change before the code review.', 'Looks right', 'Ask for changes']) {
    assert.ok(text.includes(v), `the context has ${v}`);
  }
});

test('#183 gateContext: the context carries the developer\'s summary, files_changed, test_notes, evidence_plan and left_out', () => {
  const text = contextText();
  for (const v of ['Added the scenarios step to the workflow.', 'src/engine/scenarios.js', 'Unit tests for the scenario parser.', 'Screenshot of the gate with the scenarios.', 'No visual baseline yet.']) {
    assert.ok(text.includes(v), `the context has ${v}`);
  }
});

test('#183 gateContext: the diff is never pasted into the context (the Oracle reads it with its tools)', () => {
  const text = contextText();
  assert.ok(!text.includes('PASTED_DIFF_LINE'), 'no diff line in the context');
  assert.ok(!text.includes('diff --git'), 'no diff header in the context');
});

// ---- suggested questions --------------------------------------------------------------------

test('#183 STARTERS: the four suggested questions, in order', () => {
  assert.deepEqual(plain(load().STARTERS), [
    'What was implemented, in plain words?',
    'Does it cover every task of the issue?',
    'What could break?',
    'Should I approve or ask for changes?',
  ]);
});

// ---- the button -------------------------------------------------------------------------------

test('#183 gateOracleButtonHtml: a button "Interact with Oracle" (data-testid="gate-oracle") with the Oracle\'s avatar', () => {
  const html = load().gateOracleButtonHtml(GATE);
  assert.match(html, /<button[^>]*data-testid="gate-oracle"/);
  assert.match(html, /class="oracle-avatar[^"]*"/, 'the Oracle\'s avatar, as on its drawer button');
  assert.match(html, /Interact with Oracle/);
});

test('#183 gateOracleButtonHtml: while the Oracle answers another question the label says "Oracle is answering…"', () => {
  const html = load().gateOracleButtonHtml(GATE, { busy: true });
  assert.match(html, /data-testid="gate-oracle"/);
  assert.match(html, /Oracle is answering…/);
  assert.doesNotMatch(html, /Interact with Oracle/);
});

// ---- "Use this text" ------------------------------------------------------------------------

test('#183 fillGateFeedback: "Use this text" fills the gate\'s feedback box and never answers the gate', () => {
  const { fillGateFeedback } = load();
  const answered = [];
  const clicked = [];
  const textarea = { tagName: 'TEXTAREA', value: '', disabled: false, focus() {}, dispatchEvent() { return true; } };
  const choice = { tagName: 'BUTTON', dataset: { choice: 'changes' }, click: () => clicked.push('changes') };
  const card = {
    dataset: { approval: 'a1', run: RUN_ID, gate: 'a1' },
    querySelector: (sel) => (/textarea|feedback|duo-ask-text/.test(sel) ? textarea : /button/.test(sel) ? choice : null),
    querySelectorAll: (sel) => (/textarea|feedback|duo-ask-text/.test(sel) ? [textarea] : /button/.test(sel) ? [choice] : []),
  };
  const before = { api: globalThis.api, window: globalThis.window };
  const api = { resolveApproval: async (...args) => { answered.push(args); return {}; } };
  globalThis.api = api;
  globalThis.window = { api };
  try {
    const filled = fillGateFeedback(card, 'Wire the step into software-development-local-hero.yaml too.');
    assert.equal(filled, true);
    assert.equal(textarea.value, 'Wire the step into software-development-local-hero.yaml too.');
    assert.deepEqual(answered, [], 'the gate is not answered');
    assert.deepEqual(clicked, [], 'no choice is clicked');
  } finally {
    globalThis.api = before.api;
    globalThis.window = before.window;
    if (before.api === undefined) delete globalThis.api;
    if (before.window === undefined) delete globalThis.window;
  }
});

// ---- the button on every gate surface ---------------------------------------------------------

// A sandbox with app.js's esc, the real gate-panel.js and (once it exists) gate-oracle.js; window
// is the sandbox itself, so window.X and a bare X both resolve.
function gateSandbox(extra = {}) {
  const esc = /const esc = \(s\) => [^\n]+/.exec(appSrc)?.[0];
  assert.ok(esc, 'esc not found in app.js: the source moved');
  const sandbox = {
    state: { runs: new Map([[RUN_ID, { run: { ...RUN, mock: true }, events: [{ type: 'step.finished', output: OUTPUT }] }]]) },
    document: { querySelector: () => null, querySelectorAll: () => [], getElementById: () => null },
    Robots: { svg: () => '<svg></svg>' },
    api: {},
    ...extra,
  };
  sandbox.window = sandbox;
  sandbox.self = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(esc, sandbox);
  vm.runInContext(gateSrc, sandbox);
  if (fs.existsSync(moduleFile)) vm.runInContext(fs.readFileSync(moduleFile, 'utf8'), sandbox);
  return sandbox;
}

function assertOracleNextToChoices(html, choiceRe) {
  assert.match(html, /data-testid="gate-oracle"/, 'the gate card has the Interact with Oracle button');
  assert.match(html, /Interact with Oracle/);
  assert.ok((html.match(choiceRe) || []).length >= 2, 'the choice buttons are still there');
  assert.ok(html.indexOf('data-testid="gate-oracle"') > html.indexOf('gate-choices'), 'the button sits with the choices, after their row starts');
}

test('#183 Run screen (renderRunGates): the gate card has the Interact with Oracle button next to its choices', () => {
  const fn = /function renderRunGates\(\) \{[\s\S]*?\n\}/.exec(runSrc)?.[0];
  assert.ok(fn, 'renderRunGates not found in views/run/run.js: the source moved');
  const box = { classList: { toggle() {} }, dataset: {}, innerHTML: '', querySelectorAll: () => [] };
  const sandbox = gateSandbox({
    $: (sel) => (sel === '#run-gates' ? box : null),
    selectedView: () => ({ approvals: new Map([['a1', GATE]]), run: { ...RUN, id: RUN_ID } }),
    runLabel: () => 'software-development-local-hero · #143',
  });
  vm.runInContext(`${fn}\nrenderRunGates();`, sandbox);
  assertOracleNextToChoices(box.innerHTML, /data-testid="run-gate-choice"/g);
});

test('#183 run chat (gateHtml): the gate card has the Interact with Oracle button next to its choices', () => {
  const fn = /\n {2}function gateHtml\(it\) \{[\s\S]*?\n {2}\}/.exec(runchatSrc)?.[0];
  assert.ok(fn, 'gateHtml not found in views/runchat/runchat.js: the source moved');
  const sandbox = gateSandbox({ chat: { live: true, runId: RUN_ID } });
  vm.runInContext(
    'const md = (t) => `<pre>${esc(t)}</pre>`; const clock = () => "10:00";'
    + 'const stepTag = (s) => `<span class="rc-step">${esc(s)}</span>`;'
    + `${fn}\nthis.gateHtml = gateHtml;`,
    sandbox,
  );
  const html = sandbox.gateHtml({
    id: 'g1', kind: 'gate', approvalId: 'a1', stepId: 'developer_check', ts: Date.now(),
    message: GATE.message, choices: CHOICES, feedback: GATE.feedback,
  });
  assertOracleNextToChoices(html, /data-choice="/g);
});

test('#183 Write & Review (onApproval): the gate card has the Interact with Oracle button next to its choices', () => {
  const fn = /\n {2}function onApproval\(ev\) \{[\s\S]*?\n {2}\}/.exec(duoSrc)?.[0];
  assert.ok(fn, 'onApproval not found in views/duo/duo.js: the source moved');
  const posted = [];
  const sandbox = gateSandbox({
    chat: { live: false },
    setTyping: () => {},
    setCast: () => {},
    message: (_who, body) => posted.push(body),
    $d: () => ({ textContent: '' }),
  });
  vm.runInContext(`${fn}\nthis.onApproval = onApproval;`, sandbox);
  sandbox.onApproval({ ...GATE, type: 'approval.requested', ts: new Date().toISOString() });
  assert.equal(posted.length, 1, 'the gate is posted to the chat');
  assertOracleNextToChoices(posted[0], /data-choice="/g);
});
