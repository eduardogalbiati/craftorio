// #117 acceptance tests (written before the code): texts of a Codex run's screens that stayed in English
// in the Português (Brasil) interface:
// - the merge_blocked gate: "Branch … could not be merged into the local …";
// - the gate's Continue line for a Codex session (a cache lifetime nobody measured): "resumes (cache
//   lifetime unknown)";
// - the Run screen's session panel: "Live terminal", "Open in CLI";
// - the run panel: the step "Test suite", the input chips "Mode" / "Approve before merge".
// Seams: the whole page (agent-chat-page-harness.js) in pt-BR: the gate card (#run-gates) of the engine's
// own record of the gate (as gate-no-pr-ptbr-110.test.js), gateNextTurnsHtml, renderDetail; the step names
// the engine records on workflow.started (displayName, as run-screen-ptbr-41.test.js) and
// WorkflowInputs.inputPills. English is checked as a guard where it must stay.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const I18n = require('@craftorio/shared/i18n');
const { displayName } = require('@craftorio/shared/display-name');
const WorkflowInputs = require('../workflow-inputs');
const { textOf } = require('./mini-dom');
const { loadPage, settle } = require('./agent-chat-page-harness');

const ROOT = path.join(__dirname, '..', '..', '..');
const flat = (s) => String(s ?? '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
const firstMatch = (re, text) => { const m = re.exec(text); return m === null ? '' : m[0]; };

test.afterEach(() => I18n.setLanguage('en'));

async function pageIn(lang) {
  const page = await loadPage();
  page.sandbox.__lang = lang;
  page.run('I18n.setLanguage(__lang)');
  return page;
}

// ---- the merge_blocked gate --------------------------------------------------------------------------

const FAILURE = 'error: Your local changes would be overwritten by merge FAIL-117';
const BLOCKED = { previous_step: 'merge', action_error: { message: FAILURE }, steps: { develop: { output: { branch: 'feature-117' }, visits: 1 } } };

function gateRecord(file, id, ctx) {
  const { loadWorkflow } = require('@craftorio/engine/engine/workflow');
  const { methods: gates } = require('@craftorio/engine/engine/run/gates');
  const step = loadWorkflow(path.join(ROOT, 'workflows', file)).steps.find((s) => s.id === id);
  assert.equal(!!step, true, `${file} has a ${id} gate`);
  const events = [];
  const run = {
    ...gates, pausing: false, nApproval: 0, inputs: {}, approvals: new Map(), orchestrator: {}, issues: [], localPreview: null,
    ctx: { inputs: { mode: 'local', base_branch: 'main' }, vars: {}, tests_plan: '', ...ctx },
    emitEvent: (type, payload) => events.push({ type, payload }), syncGateClock() {}, setStatus() {}, resolveApproval() {},
  };
  run.requestApproval(step).catch(() => {});
  const ev = events.find((e) => e.type === 'approval.requested');
  assert.equal(!!ev, true, 'the gate emits approval.requested');
  return JSON.parse(JSON.stringify(ev.payload));
}

async function mergeBlockedShown(lang) {
  I18n.setLanguage(lang);
  const record = gateRecord('feature.yaml', 'merge_blocked', BLOCKED);
  const page = await pageIn(lang);
  const fire = (ev) => { for (const fn of page.handlers.onEvent || []) fn({ run_id: 'r1', ...ev }); };
  fire({ seq: 1, ts: '2026-11-27T12:00:00.000Z', type: 'workflow.started', workflow: 'fixture', version: '1', mock: false, inputs: { mode: 'local' }, steps: [{ id: 'merge_blocked' }] });
  fire({ seq: 2, ts: '2026-11-27T12:00:01.000Z', type: 'approval.requested', ...record });
  await settle(20);
  page.run('state.runId = "r1"; renderRunGates()');
  await settle(5);
  const gate = page.$('#run-gates [data-testid="run-gate"]');
  assert.equal(gate === null, false, 'the Run screen draws the gate');
  return String(gate.textContent ?? '').replace(/\s+/g, ' ').trim();
}

test('#117 pt-BR: the merge_blocked gate does not say "could not be merged" in English, and keeps what git said', { timeout: 60000 }, async () => {
  const shown = await mergeBlockedShown('pt-BR');
  assert.equal(firstMatch(/could not be merged/i, shown), '', shown);
  assert.equal(shown.includes('FAIL-117'), true, shown);
});

test('#117 guard: in English the merge_blocked gate says the branch could not be merged', { timeout: 60000 }, async () => {
  assert.match(await mergeBlockedShown('en'), /could not be merged/);
});

// ---- the gate's Continue line for a Codex session ----------------------------------------------------

async function continueLine(lang) {
  const page = await pageIn(lang);
  page.sandbox.__session = {
    id: 's1', agent: 'developer', provider: 'codex', model: 'gpt-6-luna', mode: 'persistent', turns: 2, status: 'idle',
    last_turn_at: new Date(Date.now() - 60e3).toISOString(), context_tokens: 40000, closed_at: null,
  };
  return flat(page.run(`(() => {
    const v = { ...newRunView(), run: { id: 'r1', status: 'running', workflow: 'w', inputs: {} }, sessions: new Map([[__session.id, __session]]) };
    state.runs.set('r1', v);
    return gateNextTurnsHtml('r1', { approval_id: 'a1' });
  })()`));
}

test('#117 pt-BR: the gate\'s Continue line for a Codex session has no "resumes (cache lifetime unknown)"', { timeout: 60000 }, async () => {
  const line = await continueLine('pt-BR');
  assert.notEqual(line, '', 'the gate shows a Continue line');
  assert.equal(firstMatch(/cache lifetime unknown|\bresumes\b/i, line), '', line);
});

test('#117 guard: in English the gate\'s Continue line for a Codex session says its cache lifetime is unknown', { timeout: 60000 }, async () => {
  assert.match(await continueLine('en'), /cache lifetime unknown/);
});

// ---- the Run screen's session panel -----------------------------------------------------------------

async function sessionPanel(lang) {
  const page = await pageIn(lang);
  page.sandbox.__sessions = [
    { id: 'orchestrator', agent: 'orchestrator', provider: 'engine', model: 'engine', turns: 0, status: 'running', tokens: {}, cost_usd: 0 },
    { id: 's1', agent: 'developer', provider: 'codex', model: 'gpt-6-luna', step_id: 'develop', turns: 1, status: 'idle', mode: 'persistent', tokens: { input: 10, output: 5 }, cost_usd: 0, provider_session_id: 'thread-117' },
  ];
  page.run(`(() => {
    const v = { ...newRunView(), run: { id: 'r1', status: 'running', workflow: 'w', inputs: {} }, sessions: new Map(__sessions.map((s) => [s.id, { ...s, turnLog: new Map() }])) };
    state.view = 'run'; state.runs.set('r1', v); state.runId = 'r1'; state.selected = 's1';
    renderDetail();
  })()`);
  await settle(10);
  return textOf(page.$('#tab-detail .detail-actions')).replace(/\s+/g, ' ').trim();
}

test('#117 pt-BR: the Run screen\'s session panel has no "Live terminal" nor "Open in CLI"', { timeout: 60000 }, async () => {
  const shown = await sessionPanel('pt-BR');
  assert.equal(firstMatch(/Live terminal|Open in CLI/, shown), '', shown);
});

test('#117 guard: in English the Run screen\'s session panel offers "Live terminal" and "Open in CLI"', { timeout: 60000 }, async () => {
  const shown = await sessionPanel('en');
  assert.match(shown, /Live terminal/);
  assert.match(shown, /Open in CLI/);
});

// ---- the run panel: steps and input chips -----------------------------------------------------------

function load(file) {
  const { loadWorkflow } = require('@craftorio/engine/engine/workflow');
  const wf = loadWorkflow(path.join(ROOT, 'workflows', file));
  return { ...wf, name: wf.metadata?.name || file, description: wf.metadata?.description, file, origin: 'default' };
}

test('#117 pt-BR: the run panel does not name fix\'s suite step "Test suite" (a run started in English)', () => {
  const wf = load('fix.yaml');
  const names = require('@craftorio/engine/engine/run/setup').methods.displayNames.call({ wf });
  assert.equal(displayName('suite', names.steps), 'Test suite', 'the English name the run recorded');
  I18n.setLanguage('pt-BR');
  assert.notEqual(displayName('suite', names.steps), 'Test suite');
});

test('#117 pt-BR: a fix run\'s input chips do not read "Mode" nor "Approve before merge"', () => {
  const wf = load('fix.yaml');
  I18n.setLanguage('pt-BR');
  const text = flat(WorkflowInputs.inputPills(wf, { mode: 'local', approve_before_merge: true }, { defaults: true }));
  assert.equal(firstMatch(/\bMode\b|Approve before merge/, text), '', text);
});
