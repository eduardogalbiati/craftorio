// #110 acceptance, written before the code: the Product Owner's plan in a pt-BR workspace says "Planned for
// Speed-leaning (2/5)": the step's English name (packages/shared/po-calibration.js; its pt-BR name is the catalog's
// po.calibration_2). Seam: product-owner.js ask, a simulated plan (mock: no model is called), the interface and the
// agents in pt-BR, the saved calibration 2 (the default); what the conversation records is what the drawer shows.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const I18n = require('@craftorio/shared/i18n');

const ISSUES = [
  { number: 1, state: 'open', title: 'A', labels: [{ name: 'complexity:2' }, { name: 'area:engine' }], body: 'x'.repeat(200) },
  { number: 2, state: 'open', title: 'B', labels: [{ name: 'complexity:5' }], body: 'y'.repeat(200) },
];

test.afterEach(() => I18n.setLanguage('en'));

test('#110 Product Owner in pt-BR: a plan never names its calibration "Speed-leaning"', async (t) => {
  const productOwner = require('@craftorio/engine/domains/po/product-owner');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'po-110-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  I18n.setLanguage('pt-BR');
  const out = await productOwner.ask({
    backlogDir: dir,
    projectId: 'demo',
    question: 'Planeje o backlog',
    data: { projectId: 'demo', issues: ISSUES },
    activeRuns: [],
    runs: [],
    workflows: [{ file: 'feature.yaml', name: 'feature' }],
    folder: null,
    agent: { model: 'claude-opus-5-5', effort: 'high', calibration: 2 },
    skillsDirs: [],
    resolveCommand: () => 'claude',
    budget: {},
    mock: true,
    language: { interface: 'pt-BR', agents: 'interface', issues: 'pt-BR' },
  });
  assert.equal(out.message.error === true, false, String(out.message.text));
  assert.equal(out.message.calibration, 2, 'planned with the saved step 2');
  const shown = JSON.stringify({ text: out.message.text, answer: out.message.answer });
  assert.equal(shown.includes('Speed-leaning'), false, shown.slice(0, 400));
});
