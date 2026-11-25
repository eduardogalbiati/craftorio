// #70 acceptance, written before the code: the gates a run stops at when its checks fail, `test_failed` of
// workflows/feature.yaml and `verify_failed` of workflows/fix.yaml, in the pt-BR interface: their message,
// summary, recommendation, buttons and help read in English.
//
// What is read is what the person sees: the engine's own record of the gate (gates.js requestApproval on the
// real workflow file, with a minimal run around it) handed to the whole page as its approval.requested event,
// and the Run screen's gate card (#run-gates). The engine (its I18n in pt-BR when the gate opens) or the page
// (its own I18n in pt-BR) may translate: both are set. What a step reported (a reason, a test's name, a claim)
// is not translated and must stay in the gate.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const I18n = require('@craftorio/shared/i18n');
const { loadPage, settle } = require('./agent-chat-page-harness');

const ROOT = path.join(__dirname, '..', '..', '..');
test.afterEach(() => I18n.setLanguage('en'));

function gateRecord(file, id, ctx) {
  const { loadWorkflow } = require('@craftorio/engine/engine/workflow');
  const { methods: gates } = require('@craftorio/engine/engine/run/gates');
  const step = loadWorkflow(path.join(ROOT, 'workflows', file)).steps.find((s) => s.id === id);
  assert.equal(!!step, true, `${file} has a ${id} gate`);
  const events = [];
  const run = {
    ...gates, pausing: false, nApproval: 0, inputs: {}, approvals: new Map(), orchestrator: {}, issues: [], localPreview: null,
    ctx: { inputs: { mode: 'remote', base_branch: 'main' }, vars: {}, tests_plan: '', ...ctx },
    emitEvent: (type, payload) => events.push({ type, payload }), syncGateClock() {}, setStatus() {}, resolveApproval() {},
  };
  run.requestApproval(step).catch(() => {});
  const ev = events.find((e) => e.type === 'approval.requested');
  assert.equal(!!ev, true, 'the gate emits approval.requested');
  return JSON.parse(JSON.stringify(ev.payload));
}

// the gate as the Run screen draws it
async function drawn(language, file, id, ctx) {
  I18n.setLanguage(language);
  const record = gateRecord(file, id, ctx);
  const page = await loadPage();
  page.sandbox.I18n.setLanguage(language);
  const fire = (ev) => { for (const fn of page.handlers.onEvent || []) fn({ run_id: 'r1', ...ev }); };
  fire({ seq: 1, ts: '2026-11-25T10:00:00.000Z', type: 'workflow.started', workflow: 'fixture', version: '1', mock: false, inputs: {}, steps: [{ id }] });
  fire({ seq: 2, ts: '2026-11-25T10:00:01.000Z', type: 'approval.requested', ...record });
  await settle(20);
  page.run('state.runId = "r1"; renderRunGates()');
  await settle(5);
  const gate = page.$('#run-gates [data-testid="run-gate"]');
  assert.equal(gate === null, false, 'the Run screen draws the gate');
  const text = (el) => String(el?.textContent ?? '').replace(/\s+/g, ' ').trim();
  return {
    text: text(gate),
    message: text(gate.querySelector('[data-testid="run-gate-message"]')),
    headline: text(gate.querySelector('.gate-card-what')),
    recommended: gate.getAttribute('data-recommend'),
    recommendation: text(gate.querySelector('.gate-card-rec')),
    buttons: gate.querySelectorAll('[data-testid="run-gate-choice"]').map(text),
    choices: gate.querySelectorAll('[data-choice]').map((b) => b.getAttribute('data-choice')),
    help: gate.querySelectorAll('.gate-card-buttons li').map(text),
  };
}

// ---- feature: test_failed -----------------------------------------------------------------------------

const REASON = 'cargo: command not found REASON-1';
const suite = (over) => ({ kind: 'suite', status: 'fail', reason: null, message: 'SUITE-MESSAGE', passed: null, failures: [], preexisting: [], ...over });
const red = suite({ failures: [{ test: 'mantém a ordem', file: 'test/ordem.test.js', error: 'ERRO-1' }] });
const CASES = {
  blocked: { previous_step: 'suite', steps: { suite: { output: suite({ status: 'blocked', reason: REASON }), visits: 1 } } },
  not_run: { previous_step: 'suite', steps: { suite: { output: suite({ status: 'not_run', reason: 'NONE' }), visits: 1 } } },
  failing: { previous_step: 'suite', steps: { suite: { output: red, visits: 3 } } },
  healer: { previous_step: 'heal', steps: { heal: { output: { summary: 'HEAL-SUMMARY' }, visits: 2 }, e2e: { output: red, visits: 1 } } },
  'e2e blocked': { previous_step: 'e2e', steps: { e2e: { output: suite({ status: 'blocked', reason: REASON }), visits: 1 } } },
  'e2e red': { previous_step: 'e2e', steps: { heal: { visits: 2 }, e2e: { output: red, visits: 3 } } },
  'test step': { previous_step: 'test', steps: { test: { output: { failure_report: 'FAILURE-REPORT' }, visits: 3 } } },
};
const FACTS = {
  blocked: [REASON, 'test_command'],
  not_run: ['no_tests'],
  failing: ['3', 'mantém a ordem', 'test/ordem.test.js', 'SUITE-MESSAGE'],
  healer: ['HEAL-SUMMARY', 'mantém a ordem'],
  'e2e blocked': [REASON],
  'e2e red': ['2', 'mantém a ordem'],
  'test step': ['3', 'FAILURE-REPORT'],
};
const ENGLISH_TEST = /could not run|suite was not run|has no tests|nothing was tested|still fail|failing test\(s\)|round\(s\)|rounds of fixes|red scenario|E2E healer|The healer:|are not green|Set the workflow|when the project's|asks you before|only the owner answers|then resume|look at the failures|not tested green|not tested:|Continue to the build|Stop the run|Ends the run|nothing is merged|the verification run|is reported as|ends as failed|its branch keeps/i;

for (const [name, ctx] of Object.entries(CASES)) {
  test(`#70 pt-BR feature test_failed (${name}): the gate has no English and keeps its facts`, { timeout: 30000 }, async () => {
    const gate = await drawn('pt-BR', 'feature.yaml', 'test_failed', ctx);
    const match = ENGLISH_TEST.exec(gate.text);
    assert.equal(match === null ? '' : match[0], '', gate.text);
    assert.deepEqual(FACTS[name].filter((f) => !gate.text.includes(f)), []);
    assert.notEqual(gate.headline, '');
    assert.notEqual(gate.message, '');
    assert.deepEqual(gate.choices.slice(0, 2), ['continue', 'stop']);
    assert.equal(gate.help.length, 2, 'a help line per choice');
    // the recommendation still names the answer the engine compares
    assert.equal(gate.recommended, name === 'not_run' ? null : 'stop');
  });
}

test('#70 pt-BR feature test_failed: the help of "continue" tells no tests apart from not green', { timeout: 30000 }, async () => {
  const noTests = await drawn('pt-BR', 'feature.yaml', 'test_failed', CASES.not_run);
  const failing = await drawn('pt-BR', 'feature.yaml', 'test_failed', CASES.failing);
  assert.notEqual(noTests.help[0], failing.help[0]);
  assert.equal(ENGLISH_TEST.test(`${noTests.help[0]} ${failing.help[0]}`), false);
});

test('#70 pt-BR feature test_failed: the reason "no test command" the issue quotes reads in Portuguese, naming test_command', { timeout: 30000 }, async (t) => {
  // the reason comes from the engine's own suite step (a git folder with a test file and no command), its
  // interface language already pt-BR: it may be translated there or when the gate opens
  const { suiteWithoutCommand } = require('@craftorio/engine/engine/suite-no-command');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-70-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.mkdirSync(path.join(dir, 'test'));
  fs.writeFileSync(path.join(dir, 'test', 'a.test.js'), '');
  execFileSync('git', ['init', '-q'], { cwd: dir });
  execFileSync('git', ['add', '.'], { cwd: dir });
  I18n.setLanguage('pt-BR');
  const { status, reason } = await suiteWithoutCommand(dir);
  assert.equal(status, 'blocked');
  const gate = await drawn('pt-BR', 'feature.yaml', 'test_failed', { previous_step: 'suite', steps: { suite: { output: suite({ status: 'blocked', reason }), visits: 1 } } });
  assert.equal(/no test command|set the workflow's|the project has test files/i.test(gate.text), false, gate.text);
  assert.equal(gate.text.includes('test_command'), true, gate.text);
});

test('#70 English unchanged: feature test_failed, blocked', { timeout: 30000 }, async () => {
  const gate = await drawn('en', 'feature.yaml', 'test_failed', CASES.blocked);
  assert.equal(gate.headline, `The project's test suite could not run: ${REASON}`);
  assert.equal(gate.message.startsWith(`The project's test suite could not run: ${REASON} Set the workflow's \`test_command\` input (e.g. npm test) when the project's files do not give it.`), true, gate.message);
  assert.equal(gate.recommendation.includes('set the workflow\'s test_command input, then resume the run.'), true, gate.recommendation);
  assert.deepEqual(gate.buttons.slice(0, 2), ['Continue to the build anyway', 'Stop the run']);
  assert.deepEqual(gate.help, [
    'Continue to the build anyway: The build and the verification run; the change is reported as not tested green.',
    'Stop the run: Ends the run as failed; nothing is merged and its branch keeps the work to resume it.',
  ]);
});

test('#70 English unchanged: feature test_failed, no tests and a red suite', { timeout: 30000 }, async () => {
  const noTests = await drawn('en', 'feature.yaml', 'test_failed', CASES.not_run);
  assert.equal(noTests.headline, 'The suite was not run: the project has no tests.');
  assert.equal(noTests.help[0], 'Continue to the build anyway: The build and the verification run; the change is reported as not tested: the project has no tests.');
  const failing = await drawn('en', 'feature.yaml', 'test_failed', CASES.failing);
  assert.equal(failing.headline, 'The test suite still fails after 3 round(s): 1 failing test(s) of this run.');
});

// ---- fix: verify_failed -------------------------------------------------------------------------------

const verify = { output: { claim: 'CLAIM-1', evidence: 'EVIDENCE-1' }, visits: 3 };
const FIX = {
  blocked: { previous_step: 'suite', steps: { suite: { output: suite({ status: 'blocked', reason: REASON }), visits: 1 } } },
  not_run: { previous_step: 'suite', steps: { suite: { output: suite({ status: 'not_run', reason: 'NONE' }), visits: 1 } } },
  'not verified': { previous_step: 'verify_change', steps: { verify_change: verify, suite: { output: suite({ status: 'pass' }), visits: 1 }, e2e: { output: { message: 'E2E-MESSAGE' } } } },
};
const FIX_FACTS = {
  blocked: [REASON, 'SUITE-MESSAGE'],
  not_run: ['no_tests'],
  'not verified': ['CLAIM-1', 'EVIDENCE-1', 'SUITE-MESSAGE', 'E2E-MESSAGE'],
};
const ENGLISH_VERIFY = /\bApprove\b|\bReject\b|could not run|is not tested|has no tests|nothing was tested|asks you before|does not pass|rounds of fixes|Claim:|Observed:|Tests:|let it land|go on to|goes on to|to stop the run|its branch keeps|only the owner answers|fix what kept|then resume/i;

for (const [name, ctx] of Object.entries(FIX)) {
  test(`#70 pt-BR fix verify_failed (${name}): the gate has no English and keeps its facts`, { timeout: 30000 }, async () => {
    const gate = await drawn('pt-BR', 'fix.yaml', 'verify_failed', ctx);
    const match = ENGLISH_VERIFY.exec(gate.text);
    assert.equal(match === null ? '' : match[0], '', gate.text);
    assert.deepEqual(FIX_FACTS[name].filter((f) => !gate.text.includes(f)), []);
    assert.equal(gate.buttons.length >= 2, true);
    assert.equal(gate.recommended, name === 'blocked' ? 'reject' : null);
  });
}

test('#70 English unchanged: both gates keep the same facts and recommended answer', { timeout: 60000 }, async () => {
  const lost = [];
  const check = async (file, id, cases, facts, answers) => {
    for (const [name, ctx] of Object.entries(cases)) {
      const gate = await drawn('en', file, id, ctx);
      lost.push(...facts[name].filter((f) => !gate.text.includes(f)).map((f) => `${id} ${name}: ${f}`));
      if (gate.recommended !== answers(name)) lost.push(`${id} ${name}: recommends ${gate.recommended}`);
    }
  };
  await check('feature.yaml', 'test_failed', CASES, FACTS, (name) => (name === 'not_run' ? null : 'stop'));
  await check('fix.yaml', 'verify_failed', FIX, FIX_FACTS, (name) => (name === 'blocked' ? 'reject' : null));
  assert.deepEqual(lost, []);
});

test('#70 English unchanged: fix verify_failed, its message and buttons', { timeout: 30000 }, async () => {
  const gate = await drawn('en', 'fix.yaml', 'verify_failed', FIX['not verified']);
  assert.equal(gate.message.startsWith('The change still does not pass its checks after the rounds of fixes.'), true, gate.message);
  assert.equal(gate.message.endsWith('Approve to let it land anyway; reject to stop the run as failed (its branch keeps the work).'), true, gate.message);
  assert.deepEqual([...gate.buttons.slice(0, 2)].sort(), ['Approve', 'Reject']);
  const blocked = await drawn('en', 'fix.yaml', 'verify_failed', FIX.blocked);
  assert.equal(blocked.message.startsWith(`The project's test suite could not run, so the change is not tested: ${REASON}`), true, blocked.message);
});
