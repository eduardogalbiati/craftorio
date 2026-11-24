// #56: the Agents screen's editor of the Product Owner (fronts/ai/views/agents/agents.js) says which
// model registers an issue, and offers the current models. Acceptance tests written before the code,
// through the whole page (packages/ui-kit/test/agent-chat-page-harness.js).
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadPage, settle } = require('@craftorio/ui-kit/test/agent-chat-page-harness');

const PRODUCT_OWNER = {
  id: 'product-owner', name: 'Product Owner', system: true, description: '', prompt: '', skills: [],
  model: 'claude-fable-5-1', effort: 'high',
  appearance: { body: '#7C5CFF', shell: '#F4F4F6', visor: '#15161A', glow: '#C9B8FF', eyes: 'dots', emblem: 'none' },
};

async function openEditor() {
  const page = await loadPage({ api: { listAgents: async () => [PRODUCT_OWNER], listSkills: async () => [] } });
  page.sandbox.showView('agents');
  await settle(20);
  page.document.querySelectorAll('#agents-list .agent-card').find((c) => c.dataset.id === PRODUCT_OWNER.id).click();
  await settle();
  return page;
}

test('#56 the Product Owner\'s editor says issues are registered on Sonnet 5.5', async () => {
  const page = await openEditor();
  assert.match(String(page.$('#ag-model-hint').textContent), /claude-sonnet-5-5\b/);
});

test('#56 the Product Owner\'s editor offers the current Claude models and keeps the saved one', async () => {
  const page = await openEditor();
  const offered = [...String(page.$('#ag-model-list').innerHTML).matchAll(/value="([^"]*)"/g)].map((m) => m[1]);
  assert.deepEqual(['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-fable-5-2', 'claude-haiku-5-5'].filter((m) => !offered.includes(m)), []);
  assert.equal(String(page.$('#ag-model').value), 'claude-fable-5-1');
});
