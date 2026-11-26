// #41 acceptance, written before the code: the Product Owner drawer (fronts/build/views/backlog/backlog-po.js) in the
// pt-BR interface still showed English on a simulated draft: the answer's meta "Product Owner · <time> · simulated"
// and the draft's workflow picker chip "feature (default)". In English they stay as they are.
//
// The whole page (./backlog-po-785-harness.js) with the drawer opened on a conversation whose last answer is a draft
// recorded by the simulated Product Owner (model "simulated"). Assertions on the drawer's visible text.
const test = require('node:test');
const assert = require('node:assert/strict');
const { openDrawer, textOf } = require('./backlog-po-785-harness');

const DRAFT = { draft: { title: 'Exportar as notas em CSV', body: 'Como dono, quero exportar.', labels: [], related: [] }, duplicates: [] };
const HISTORY = [
  { role: 'user', mode: 'issue', ts: '2026-11-25T09:59:00.000Z', text: 'Exportar as notas em CSV' },
  { role: 'po', mode: 'issue', ts: '2026-11-25T10:00:00.000Z', text: 'Aqui está.', issue: DRAFT, model: 'simulated', costUsd: 0 },
];

async function drawerText(language) {
  const page = await openDrawer({ history: HISTORY, language });
  const drawer = page.$('#po-drawer');
  const options = drawer.querySelectorAll('select[data-po-wf] option').map((o) => textOf(o).trim());
  return { text: textOf(drawer), options };
}

test('#41 English unchanged: the simulated draft reads "simulated" in its meta and the picker shows "feature (default)"', { timeout: 30000 }, async () => {
  const { text, options } = await drawerText('en');
  assert.match(text, /· simulated\b/);
  assert.ok(options.some((o) => /\(default\)$/.test(o)), `options: ${options.join(' | ')}`);
});

test('#41 pt-BR: the simulated draft\'s meta does not say "simulated" and the picker does not say "(default)"', { timeout: 30000 }, async () => {
  const { text, options } = await drawerText('pt-BR');
  assert.ok(options.length > 0, 'the draft has a workflow picker');
  assert.deepEqual(options.filter((o) => /\(default\)/.test(o)), []);
  assert.doesNotMatch(text, /· simulated\b/);
});
