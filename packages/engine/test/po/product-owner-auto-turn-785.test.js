// #785: what a drawer question (mode 'auto', no workflow sent) keeps of two older rules: the Cost step
// follows the default workflow (#235), and a report the PO took as an issue stays in the issue's thread.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const productOwner = require('../../domains/po/product-owner');

const ROOT = path.join(__dirname, '..', '..', '..', '..');
const INPUTS = { task: { type: 'string' }, unit_tests: { enum: ['run_existing', 'off'], default: 'off' } };
const FEATURE = { file: 'feature.yaml', name: 'feature', inputs: INPUTS };
const CUSTOM = { file: 'custom-dev.yaml', name: 'custom-dev', inputs: INPUTS };
const ISSUES = [{ number: 1, state: 'open', title: 'Login page', labels: [{ name: 'complexity:2' }], body: 'x'.repeat(200) }];
const REPORT = 'O botão Salvar quebra com nome vazio';

function tmp(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'po-auto-785-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3 }));
  return dir;
}

// the model's turn stubbed at the system boundary: each turn gives the next of `answers`
function stubModel(t, ...answers) {
  const providers = require('../../engine/providers');
  const original = providers.runTurn;
  t.after(() => { providers.runTurn = original; });
  const prompts = [];
  providers.runTurn = async ({ prompt }) => {
    const answer = answers[Math.min(prompts.length, answers.length - 1)];
    prompts.push(prompt);
    return { text: `\`\`\`json\n${JSON.stringify(answer)}\n\`\`\``, costUsd: 0, usage: {} };
  };
  return prompts;
}
const options = (t, extra = {}) => ({
  backlogDir: tmp(t), runsDir: tmp(t), folder: tmp(t), projectId: 'demo', data: { projectId: 'demo', issues: ISSUES }, activeRuns: [], runs: [], workflows: [FEATURE, CUSTOM],
  skillsDirs: [path.join(ROOT, 'skills')], resolveCommand: () => 'claude', agent: { model: 'claude-opus-5-5', effort: 'high' }, mock: false, mode: 'auto', question: 'Analisar o backlog', ...extra,
});
const plan = { intent: 'plan', summary: 'The plan.', groups: [], conflicts: [], enrich: [] };
const asking = { intent: 'register', reply: 'Em qual tela?', questions: ['Em qual tela?'], duplicates: [], assumptions: [] };
const draft = { intent: 'register', reply: 'O rascunho.', questions: [], draft: { title: 'Salvar quebra', body: '## Tasks\n- [ ] Salvar', labels: [], related: [] }, duplicates: [], assumptions: [] };

test('#785 a drawer question on a tests-first default workflow has no Cost step', async (t) => {
  const prompts = stubModel(t, plan);
  const { message } = await productOwner.ask(options(t, { defaultWorkflow: 'feature.yaml' }));
  assert.equal(prompts[0].includes('## Cost'), false);
  assert.equal(message.answer.cost, undefined);
});

test('#785 a drawer question on a code-first default workflow keeps the Cost step', async (t) => {
  const prompts = stubModel(t, plan);
  const { message } = await productOwner.ask(options(t, { defaultWorkflow: 'custom-dev.yaml' }));
  assert.equal(prompts[0].includes('## Cost'), true);
  assert.equal(Number.isInteger(message.answer.cost), true);
});

test('#785 a report taken as an issue is tagged in the conversation', async (t) => {
  stubModel(t, asking);
  const { messages } = await productOwner.ask(options(t, { question: REPORT }));
  assert.deepEqual([messages[0].text, messages[0].mode, messages[0].thread], [REPORT, 'issue', messages[1].thread]);
});

test('#785 the next turn of a report taken as an issue still has the report', async (t) => {
  const prompts = stubModel(t, asking, draft);
  const opts = options(t, { question: REPORT });
  await productOwner.ask(opts);
  await productOwner.ask({ ...opts, question: 'Na tela de ajustes' });
  assert.equal(prompts[1].includes(REPORT), true);
});

test('#785 a report taken as an issue is written once in its thread', async (t) => {
  stubModel(t, asking);
  const opts = options(t, { question: REPORT });
  const { messages } = await productOwner.ask(opts);
  const lines = fs.readFileSync(path.join(opts.runsDir, messages[0].thread, 'conversation.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.deepEqual(lines.map((m) => m.role), ['user', 'po']);
});
