// #670: the Product Owner carries a spec's mockups into each screen task. Acceptance tests written
// before the code: the prompt of a plan turn and of an issue turn (packages/engine/domains/po/product-owner.js
// ask, the agent's turn stubbed at providers.runTurn) for a project whose spec `docs/work/<item>/` has
// mockups names them and states the rule: a screen task names and embeds its mockup ("matches
// `mock-1.jpg`: layout, icons, texts, controls, order"), the parts not done yet stay "visible and
// disabled, as in the mockup", and requirement numbers alone are not accepted. A spec without mockups
// carries no mockup block. The agent's folder is a small temporary project (never this one); the plan
// turn reads a saved conflict map, so no git work runs.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..', '..', '..');
const load = () => require('../../domains/po/product-owner');

function tmpDir(t, prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3 }));
  return dir;
}

function project(t, files) {
  const dir = tmpDir(t, 'mock-');
  for (const [rel, text] of Object.entries(files)) {
    fs.mkdirSync(path.join(dir, path.dirname(rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), text);
  }
  return dir;
}

function stubTurns(t) {
  const providers = require('../../engine/providers');
  const original = providers.runTurn;
  t.after(() => { providers.runTurn = original; });
  const prompts = [];
  providers.runTurn = async ({ prompt }) => { prompts.push(prompt); return { text: '```json\n{"summary":"ok","groups":[],"conflicts":[],"enrich":[]}\n```', costUsd: 0, usage: {} }; };
  return prompts;
}

const WITH_MOCKUPS = {
  'docs/work/home-screen/spec.md': '# Home screen\n\nR1 The home screen lists the projects.\nR2 The export button exports them.\n',
  'docs/work/home-screen/mock-1.jpg': Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
  'docs/work/home-screen/mock-2.html': '<main><h1>Projects</h1><button disabled>Export</button></main>',
};
const WITHOUT_MOCKUPS = { 'docs/work/home-screen/spec.md': '# Home screen\n\nR1 The home screen lists the projects.\n' };

const QUESTION = 'Write the issues for the spec docs/work/home-screen';

const PO_COMMON = {
  projectId: 'demo', question: QUESTION,
  data: { projectId: 'demo', issues: [{ number: 1, state: 'open', title: 'A', labels: [], body: 'x' }] },
  workflows: [{ file: 'software-development.yaml', name: 'x' }], skillsDirs: [path.join(ROOT, 'skills')],
  resolveCommand: () => 'claude', agent: { model: 'claude-opus-5-5', effort: 'high' }, mock: false, runs: [],
};

const SAVED_MAP = { source: 'git', runs: 1, runIds: ['c1'], files: [], lines: [], builtAt: '2026-10-01T00:00:00.000Z' };

async function promptOf(t, mode, files) {
  const prompts = stubTurns(t);
  const folder = project(t, files);
  const backlogDir = tmpDir(t, 'po-mock-backlog-');
  const runsDir = tmpDir(t, 'po-mock-runs-');
  fs.writeFileSync(path.join(backlogDir, 'demo.conflict-map.json'), JSON.stringify(SAVED_MAP));
  await load().ask({ ...PO_COMMON, folder, backlogDir, runsDir, mode });
  assert.equal(prompts.length, 1);
  return prompts[0];
}

for (const mode of ['plan', 'issue']) {
  test(`#670 ${mode} turn: the prompt names the spec's mockups`, async (t) => {
    const prompt = await promptOf(t, mode, WITH_MOCKUPS);
    assert.match(prompt, /mock-1\.jpg/);
    assert.match(prompt, /mock-2\.html/);
  });

  test(`#670 ${mode} turn: each screen task names and embeds its mockup and matches it: layout, icons, texts, controls, order`, async (t) => {
    const prompt = await promptOf(t, mode, WITH_MOCKUPS);
    assert.match(prompt, /matches `?[\w.-]+\.(jpg|png|html)`?: layout, icons, texts, controls, order/);
    assert.match(prompt, /embed/i);
  });

  test(`#670 ${mode} turn: the parts not done yet stay visible and disabled, as in the mockup`, async (t) => {
    const prompt = await promptOf(t, mode, WITH_MOCKUPS);
    assert.match(prompt, /visible and disabled, as in the mockup/);
  });

  test(`#670 ${mode} turn: requirement numbers alone are not accepted for a screen task`, async (t) => {
    const prompt = await promptOf(t, mode, WITH_MOCKUPS);
    assert.match(prompt, /requirement numbers alone/i);
  });

  test(`#670 ${mode} turn: a spec without mockups carries no mockup block (control)`, async (t) => {
    const prompt = await promptOf(t, mode, WITHOUT_MOCKUPS);
    assert.doesNotMatch(prompt, /visible and disabled/);
    assert.doesNotMatch(prompt, /layout, icons, texts, controls, order/);
  });
}
