// #110 acceptance, written before the code: the gate a Remote run stops at when it could not open its PR/MR
// (`ci_failed` of fragments/pr-pipeline.yaml, as workflows/feature.yaml composes it, with no pr_url: "CI failed: no PR
// was opened: …") reads in English in the pt-BR interface.
// As gate-failed-ptbr-70.test.js: the engine's own record of the gate (gates.js requestApproval on the real workflow,
// the engine's I18n in pt-BR) handed to the whole page as its approval.requested event, and the Run screen's gate card
// (#run-gates), the page in pt-BR too. What git said (the step's failure_log) is not translated and stays.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const I18n = require('@craftorio/shared/i18n');
const { loadPage, settle } = require('./agent-chat-page-harness');

const ROOT = path.join(__dirname, '..', '..', '..');
const FAILURE = 'remote: HTTP Basic: Access denied FAIL-110';
const NO_PR = { previous_step: 'ci', steps: { ci: { output: { ci_status: 'failed', pr_url: '', failure_log: FAILURE }, visits: 1 } } };

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

async function drawn(language, ctx = NO_PR) {
  I18n.setLanguage(language);
  const record = gateRecord('feature.yaml', 'ci_failed', ctx);
  const page = await loadPage();
  page.sandbox.I18n.setLanguage(language);
  const fire = (ev) => { for (const fn of page.handlers.onEvent || []) fn({ run_id: 'r1', ...ev }); };
  fire({ seq: 1, ts: '2026-11-27T10:00:00.000Z', type: 'workflow.started', workflow: 'fixture', version: '1', mock: false, inputs: { mode: 'remote' }, steps: [{ id: 'ci_failed' }] });
  fire({ seq: 2, ts: '2026-11-27T10:00:01.000Z', type: 'approval.requested', ...record });
  await settle(20);
  page.run('state.runId = "r1"; renderRunGates()');
  await settle(5);
  const gate = page.$('#run-gates [data-testid="run-gate"]');
  assert.equal(gate === null, false, 'the Run screen draws the gate');
  return String(gate.textContent ?? '').replace(/\s+/g, ' ').trim();
}

test.afterEach(() => I18n.setLanguage('en'));

const ENGLISH = /no PR was opened|Approve to try again|after fixing what stopped it|reject to stop|stop the run as failed|keeps the work/i;

test('#110 pt-BR: the gate of a Remote run that could not open its PR has no English and keeps what git said', { timeout: 30000 }, async () => {
  const shown = await drawn('pt-BR');
  const match = ENGLISH.exec(shown);
  assert.equal(match === null ? '' : match[0], '', shown);
  assert.equal(shown.includes('FAIL-110'), true, shown);
});

test('#110 guard: in English the gate says no PR was opened, with git\'s reason', { timeout: 30000 }, async () => {
  const shown = await drawn('en');
  assert.match(shown, /no PR was opened/);
  assert.equal(shown.includes('FAIL-110'), true, shown);
});

// CI (or git) said nothing: an empty failure_log, with and without the PR/MR
const PR_URL = 'https://github.com/o/r/pull/110';
const emptyLog = (prUrl) => ({ previous_step: 'ci', steps: { ci: { output: { ci_status: 'failed', pr_url: prUrl, failure_log: '' }, visits: 1 } } });
const NOT_REPORTED = /\(none reported\)|\(no reason reported\)/;

test('#110 pt-BR: the ci_failed gate with an empty failure log and no PR has no "(no reason reported)"', { timeout: 30000 }, async () => {
  const shown = await drawn('pt-BR', emptyLog(''));
  const match = NOT_REPORTED.exec(shown) || ENGLISH.exec(shown);
  assert.equal(match === null ? '' : match[0], '', shown);
  assert.equal(shown.includes('nenhum PR foi aberto'), true, shown);
});

test('#110 pt-BR: the ci_failed gate with an empty failure log and a PR has no "(none reported)"', { timeout: 30000 }, async () => {
  const shown = await drawn('pt-BR', emptyLog(PR_URL));
  const match = NOT_REPORTED.exec(shown) || /did not pass|Last error|Approve to check CI again/.exec(shown);
  assert.equal(match === null ? '' : match[0], '', shown);
  assert.equal(shown.includes('Último erro'), true, shown);
  assert.equal(shown.includes(PR_URL), true, shown);
});
