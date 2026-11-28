// The gate card after the run screen redesign (2026-11-28, the owner's Claude Design proposal, decision 2:
// "the request field only after"): each answer is a card with what it does under its label; the request
// field an answer needs ("Ask for changes", feedback_required) stays closed until that answer is clicked,
// then shows with Cancel and "Send: <answer>", which carries that answer's hooks; an optional field shows
// from the start; the field's label and placeholder read in the interface language (label_key /
// placeholder_key, passed through by the engine). Read on the real workflow (developer_check of
// workflows/feature.yaml), the engine's own record of the gate, and the whole page's Run screen, as
// gate-failed-ptbr-70.test.js does.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const I18n = require('@craftorio/shared/i18n');
const { loadPage, settle } = require('./agent-chat-page-harness');

const ROOT = path.join(__dirname, '..', '..', '..');
test.afterEach(() => I18n.setLanguage('en'));

function gateRecord(id, mutate = (s) => s) {
  const { loadWorkflow } = require('@craftorio/engine/engine/workflow');
  const { methods: gates } = require('@craftorio/engine/engine/run/gates');
  const step = mutate(structuredClone(loadWorkflow(path.join(ROOT, 'workflows', 'feature.yaml')).steps.find((s) => s.id === id)));
  const events = [];
  const run = {
    ...gates, pausing: false, nApproval: 0, inputs: {}, approvals: new Map(), orchestrator: {}, issues: [], localPreview: null,
    ctx: { inputs: { mode: 'remote', base_branch: 'main' }, vars: {}, tests_plan: '', steps: { develop: { output: { summary: 'Did it.', files_changed: [] } } } },
    emitEvent: (type, payload) => events.push({ type, payload }), syncGateClock() {}, setStatus() {}, resolveApproval() {},
  };
  run.requestApproval(step).catch(() => {});
  return JSON.parse(JSON.stringify(events.find((e) => e.type === 'approval.requested').payload));
}

async function drawnGate(language, record) {
  I18n.setLanguage(language);
  const page = await loadPage();
  page.sandbox.I18n.setLanguage(language);
  const fire = (ev) => { for (const fn of page.handlers.onEvent || []) fn({ run_id: 'r1', ...ev }); };
  fire({ seq: 1, ts: '2026-11-28T10:00:00.000Z', type: 'workflow.started', workflow: 'fixture', version: '1', mock: false, inputs: {}, steps: [{ id: record.step_id }] });
  fire({ seq: 2, ts: '2026-11-28T10:00:01.000Z', type: 'approval.requested', ...record });
  await settle(20);
  page.run('state.runId = "r1"; renderRunGates()');
  await settle(5);
  const gate = page.$('#run-gates [data-testid="run-gate"]');
  assert.equal(gate === null, false, 'the Run screen draws the gate');
  return { page, gate };
}
const text = (el) => String(el?.textContent ?? '').replace(/\s+/g, ' ').trim();

test('engine: a gate\'s feedback passes its label_key and placeholder_key on to the screens (developer_check)', () => {
  const g = gateRecord('developer_check');
  assert.equal(g.feedback.label_key, 'engine.developer_check_feedback');
  assert.equal(g.feedback.placeholder_key, 'engine.developer_check_feedback_placeholder');
  assert.equal(g.choices.find((c) => c.id === 'approve').label_key, 'engine.developer_check_approve');
});

test('developer_check: each answer is a card, its label over what it does (the old help list under the buttons is gone)', async () => {
  const { gate } = await drawnGate('en', gateRecord('developer_check'));
  const cards = gate.querySelectorAll('[data-testid="run-gate-choice"]');
  assert.deepEqual(cards.map((b) => text(b.querySelector('.gate-choice-label'))), ['Approve: go on to the code review', 'Ask for changes: back to the developer', 'Stop the run (branch kept to resume)']);
  assert.equal(cards.every((b) => !!b.querySelector('.gate-choice-help')), true, 'every card says what it does');
  assert.equal(gate.querySelector('.gate-card-buttons'), null);
  assert.equal(cards[0].classList.contains('primary'), true, 'the first answer is the accent one');
  // its accessible name is the label alone, the help its description (a screen reader, a step finding it by name)
  assert.equal(cards[0].getAttribute('aria-label'), 'Approve: go on to the code review');
  const help = cards[0].querySelector('.gate-choice-help');
  assert.equal(cards[0].getAttribute('aria-describedby'), help.getAttribute('id'));
});

test('developer_check in pt-BR: the answers and the request field read in Portuguese', async () => {
  const { gate } = await drawnGate('pt-BR', gateRecord('developer_check'));
  const labels = gate.querySelectorAll('.gate-choice-label').map(text);
  assert.deepEqual(labels, ['Aprovar: seguir para a revisão de código', 'Pedir mudanças: volta ao desenvolvedor', 'Parar a execução (o branch fica para retomar)']);
  assert.equal(text(gate.querySelector('[data-gate-feedback] .duo-ask-label')), 'Seu pedido de mudança para o desenvolvedor');
  assert.equal(gate.querySelector('[data-gate-feedback] textarea').getAttribute('placeholder'), 'O que mudar, ponto a ponto');
});

test('developer_check: the request field stays closed until "Ask for changes" is clicked, then shows with Cancel and Send', async () => {
  const { page, gate } = await drawnGate('en', gateRecord('developer_check'));
  const box = gate.querySelector('[data-gate-feedback]');
  assert.equal(box.classList.contains('hidden'), true, 'closed at first');
  gate.querySelector('[data-choice="changes"]').click();
  await settle(5);
  assert.equal(box.classList.contains('hidden'), false, 'the click opened it');
  assert.deepEqual(page.callsTo('resolveApproval'), [], 'nothing was answered yet');
  const send = box.querySelector('[data-gate-feedback-send]');
  assert.equal(text(send), 'Send: Ask for changes: back to the developer');
  assert.equal(send.getAttribute('data-choice'), 'changes', 'Send carries the answer it sends');
  assert.equal(send.getAttribute('data-needs-text'), '1', 'and still needs the text');
  assert.equal(send.getAttribute('data-testid'), 'gate-feedback-send', 'never counted as another choice');
  box.querySelector('[data-gate-feedback-cancel]').click();
  await settle(5);
  assert.equal(box.classList.contains('hidden'), true, 'Cancel closes it again');
});

test('developer_check: Send with a text answers the gate with "changes" and that text', async () => {
  const { page, gate } = await drawnGate('en', gateRecord('developer_check'));
  gate.querySelector('[data-choice="changes"]').click();
  await settle(5);
  gate.querySelector('[data-gate-feedback] textarea').value = 'Move the button to the right';
  gate.querySelector('[data-gate-feedback-send]').click();
  await settle(20);
  const calls = page.callsTo('resolveApproval');
  assert.equal(calls.length, 1);
  assert.equal(calls[0][1], 'changes');
  assert.equal(calls[0][2], 'Move the button to the right');
});

test('a gate whose text is optional (no answer needs it) shows its field from the start', async () => {
  const record = gateRecord('developer_check', (s) => ({ ...s, choices: s.choices.map(({ feedback_required, ...c }) => c) }));
  const { gate } = await drawnGate('en', record);
  assert.equal(gate.querySelector('[data-gate-feedback]'), null, 'no closed box');
  assert.equal(gate.querySelector('textarea.run-gate-feedback') === null, false, 'the field shows');
});
