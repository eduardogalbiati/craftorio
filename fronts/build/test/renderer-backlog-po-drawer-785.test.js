// #785: the Product Owner's drawer before any answer: three translated suggestions and "+ opções", no
// Plan / Register toggle, no options block; a question carries no input and lets the PO decide.
// Acceptance tests written before the code. Harness: backlog-po-785-harness.js (the whole page).
// Contract the developer provides (chosen here):
// - each suggestion keeps data-testid="po-pill" (#po-chips); "+ opções" is [data-testid="po-suggestion-more"];
// - api.askProductOwner's 4th argument (`mode`) is 'auto' unless the owner is registering an issue
//   ('issue': the "Registrar uma issue" pill, as today, or a draft being revised); its 10th (`workflow`)
//   and 11th (`inputs`) carry nothing: the PO chooses them for each recommendation.
const test = require('node:test');
const assert = require('node:assert/strict');
const en = require('@craftorio/shared/i18n/en.json');
const ptBR = require('@craftorio/shared/i18n/pt-BR.json');
const { openDrawer, click, isHidden, send, textOf, settle } = require('./backlog-po-785-harness');

const MAIN = ['Analisar o backlog e propor runs', 'Montar um roadmap', 'Registrar uma issue'];
const OTHERS = ['O que não deve rodar junto?', 'Quais issues estão grandes ou pouco claras?', 'Quais issues são grandes demais para um run?', 'Organizar as issues abertas em épicos'];
const pills = (page) => Array.from(page.document.querySelectorAll('#po-chips [data-testid="po-pill"]')).filter((p) => !isHidden(p));
const pillTexts = (page) => pills(page).map(textOf);
const more = (page) => page.$('#po-chips [data-testid="po-suggestion-more"]');
const pill = (page, text) => pills(page).find((p) => textOf(p) === text) ?? null;
const inDrawer = (page, sel) => Array.from(page.document.querySelectorAll(`#po-drawer ${sel}`)).length;

// ---- suggestions ------------------------------------------------------------------------------------

test('#785 pt-BR: the drawer shows exactly the three translated suggestions', { timeout: 30000 }, async () => {
  assert.deepEqual(pillTexts(await openDrawer({ language: 'pt-BR' })), MAIN);
});

test('#785 pt-BR: a fourth pill reads "+ opções"', { timeout: 30000 }, async () => {
  assert.equal(textOf(more(await openDrawer({ language: 'pt-BR' }))), '+ opções');
});

test('#785 pt-BR: "+ opções" reveals the other four suggestions, translated', { timeout: 30000 }, async () => {
  const page = await openDrawer({ language: 'pt-BR' });
  await click(page, more(page), '"+ opções"');
  assert.deepEqual(pillTexts(page).sort(), [...MAIN, ...OTHERS].sort());
});

test('#785 English: the three suggestions in the interface\'s language', { timeout: 30000 }, async () => {
  assert.deepEqual(pillTexts(await openDrawer()), ['Analyze the backlog and propose runs', 'Build a roadmap', 'Register an issue']);
});

test('#785 pt-BR: a suggestion asks its own translated question', { timeout: 30000 }, async () => {
  const page = await openDrawer({ language: 'pt-BR' });
  await click(page, pill(page, 'Montar um roadmap'), 'the pill');
  assert.deepEqual(page.callsTo('askProductOwner').map((a) => a[1]), ['Montar um roadmap']);
});

test('#785 both catalogs carry every suggestion, the pt-BR text never in English', () => {
  const keys = [...MAIN, ...OTHERS, '+ opções'].map((text) => Object.keys(ptBR).find((k) => ptBR[k] === text) ?? null);
  assert.deepEqual(keys.filter((k) => k === null), [], 'each text is in pt-BR.json');
  assert.deepEqual(keys.filter((k) => !en[k] || en[k] === ptBR[k]), [], 'each key is in en.json, in English');
});

test('#785 both catalogs carry the sources of a value', () => {
  const keys = ['do projeto', 'do workflow', 'neste item'].map((text) => Object.keys(ptBR).find((k) => ptBR[k] === text) ?? null);
  assert.deepEqual(keys.filter((k) => k === null || !en[k] || en[k] === ptBR[k]), []);
});

// ---- no toggle ---------------------------------------------------------------------------------------

test('#785 the Plan / Register toggle is not rendered', { timeout: 30000 }, async () => {
  const page = await openDrawer();
  assert.deepEqual([page.$('#po-mode') === null, inDrawer(page, '[data-po-mode]')], [true, 0]);
});

test('#785 a typed question lets the PO decide the intent', { timeout: 30000 }, async () => {
  const page = await openDrawer();
  await send(page, 'O botão Salvar quebra');
  assert.equal(page.callsTo('askProductOwner')[0][3], 'auto');
});

test('#785 pt-BR: "Registrar uma issue" still registers: the message after it goes as an issue', { timeout: 30000 }, async () => {
  const page = await openDrawer({ language: 'pt-BR' });
  await click(page, pill(page, 'Registrar uma issue'), 'the pill');
  await send(page, 'O botão Salvar quebra');
  assert.equal(page.callsTo('askProductOwner')[0][3], 'issue');
});

test('#785 issues sent from the Backlog still go with the question', { timeout: 30000 }, async () => {
  const page = await openDrawer();
  await page.sandbox.BacklogPO.attach([7]);
  await settle(30);
  await send(page, 'Qual a melhor estratégia?');
  assert.deepEqual(Array.from(page.callsTo('askProductOwner')[0][5]), [7]);
});

// ---- no options before the answer ----------------------------------------------------------------------

test('#785 the "Planejar com" select is not rendered', { timeout: 30000 }, async () => {
  const page = await openDrawer({ language: 'pt-BR' });
  assert.deepEqual([inDrawer(page, '[data-testid="po-workflow"]'), textOf(page.$('#po-drawer')).includes('Planejar com')], [0, false]);
});

test('#785 no option control is rendered before the answer', { timeout: 30000 }, async () => {
  const page = await openDrawer();
  assert.equal(inDrawer(page, '[data-wi-input]'), 0);
});

test('#785 "Show more options" and the options\' minimize control are not rendered', { timeout: 30000 }, async () => {
  const page = await openDrawer();
  assert.deepEqual([inDrawer(page, '[data-testid="wf-more-toggle"]'), inDrawer(page, '[data-testid="po-wf-toggle"]'), inDrawer(page, '[data-testid="po-workflow-options"]')], [0, 0, 0]);
});

test('#785 a question pins no workflow: the PO chooses it for each recommendation', { timeout: 30000 }, async () => {
  const page = await openDrawer();
  await send(page, 'Analisar o backlog');
  assert.equal(page.callsTo('askProductOwner')[0][9] ?? null, null);
});

test('#785 a question sends no input', { timeout: 30000 }, async () => {
  const page = await openDrawer();
  await send(page, 'Analisar o backlog');
  assert.deepEqual(Object.keys(page.callsTo('askProductOwner')[0][10] ?? {}), []);
});
