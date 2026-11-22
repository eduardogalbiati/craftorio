// #790, #791: the drawer's kinds behind the acceptance tests: a project with no map of its own swaps to what
// its manifest names (the record's `manifest`, projects:list), a workflow picked in the form leaves no kind
// inputs behind, an edit of a kind's input stays, and each issue's reason shows.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const productOwner = require('@craftorio/engine/domains/po/product-owner');
const { FEATURE, HINTS, RUN_DEFAULTS, plain, click, byTestId, settle, textOf, loadPage } = require('./backlog-po-785-harness');

const ROOT = path.join(__dirname, '..', '..', '..');
const fixDoc = yaml.load(fs.readFileSync(path.join(ROOT, 'workflows', 'fix.yaml'), 'utf8'));
const FIX = { file: 'fix.yaml', name: fixDoc.metadata.name, category: 'build', inputs: fixDoc.inputs };
const OTHER = { file: 'hero.yaml', name: 'hero', category: 'build', inputs: { task: { type: 'string' } } };
const ALL = [{ ...FEATURE, category: 'build' }, FIX, OTHER];
const KINDS = { feature: { name: 'feature', inputs: {} }, fix: { name: 'fix', inputs: { mode: 'remote' } } };
// the manifest's map and no `workflowKinds` on the record: a local folder, or a clone from before #791
const PROJECT = {
  id: 'demo', name: 'Demo project', folder: 'C:/work/demo', defaultWorkflow: 'feature',
  workflows: [{ name: 'feature', origin: 'bundled', category: 'build' }, { name: 'fix', origin: 'bundled', category: 'build' }, { name: 'hero', origin: 'workspace', category: 'build' }],
  manifest: { default: null, kinds: { fix: { name: 'fix', inputs: { mode: 'remote' } } } },
};

const issue = (number, ...labels) => ({ number, state: 'open', title: `Issue ${number}`, url: `https://example.test/${number}`, labels: labels.map((name) => ({ name })), body: 'x'.repeat(200) });
const ISSUES = [issue(7), issue(9), issue(8, 'bug')];

function conversation(groups) {
  const answer = productOwner.normalizeAnswer({ summary: 'The plan.', groups, conflicts: [], enrich: [] }, { issues: ISSUES, history: [], workflows: ALL, runDefaults: RUN_DEFAULTS, workflowKinds: KINDS });
  return plain([
    { role: 'user', text: 'Analyze the backlog', ts: '2026-11-05T10:00:00.000Z' },
    { role: 'po', text: answer.summary, ts: '2026-11-05T10:01:00.000Z', answer, costUsd: 0 },
  ]);
}

async function openDrawer(history, language = null) {
  const page = await loadPage({
    api: {
      listWorkflows: async () => plain(ALL),
      listProjects: async () => [plain(PROJECT)],
      productOwnerHistory: async () => plain(history),
      projectInputHints: async () => plain(HINTS),
      askProductOwner: () => new Promise(() => {}),
      proposeRoadmap: async () => ({ roadmap: { state: 'planned', stages: [] }, dropped: [] }),
    },
  });
  if (language) page.sandbox.I18n.setLanguage(language);
  page.run(`state.projects = ${JSON.stringify([PROJECT])}; window.CurrentProject.refresh(state.projects); window.CurrentProject.set('demo', { redraw: false });`);
  const added = [];
  const actions = page.sandbox.BacklogActions;
  actions.projectId = () => 'demo';
  actions.project = () => plain(PROJECT);
  actions.data = () => ({ projectId: 'demo', issues: plain(ISSUES) });
  actions.roadmapGroup = async (g) => { added.push(plain(g)); return []; };
  actions.showRoadmap = () => {};
  await page.sandbox.BacklogPO.open();
  await settle(30);
  return Object.assign(page, { added });
}

const card = (page) => page.document.querySelector('#po-log .po-group');
const inCard = (page, id) => byTestId(card(page), id);
const run = (issues, extra = {}) => ({ name: 'Run', issues, workflow: 'feature.yaml', reason: 'Same files.', stage: 1, ...extra });
const selectIn = (el) => (String(el?.tagName).toUpperCase() === 'SELECT' ? el : el?.querySelector('select'));
async function change(page, el, value) {
  el.value = value;
  el.dispatchEvent(new page.dom.classes.Event('change', { bubbles: true }));
  await settle(30);
}
const openForm = (page) => click(page, inCard(page, 'po-decisions-edit'), 'Edit');
const addToRoadmap = (page) => click(page, card(page).querySelector('[data-po-act="roadmap"]'), '"Add to roadmap"');

test('#791 Fix on a project without a map of its own takes the manifest\'s inputs', { timeout: 30000 }, async () => {
  const page = await openDrawer(conversation([run([7])]));
  await click(page, inCard(page, 'po-kind-choice-fix'), 'Fix');
  await addToRoadmap(page);
  assert.deepEqual([page.added[0].workflow, page.added[0].inputs.mode], ['fix.yaml', 'remote']);
});

test('#791 a workflow picked in the form leaves the kind\'s inputs behind', { timeout: 30000 }, async () => {
  const page = await openDrawer(conversation([run([7])]));
  await click(page, inCard(page, 'po-kind-choice-fix'), 'Fix');
  await openForm(page);
  await change(page, selectIn(inCard(page, 'po-decisions-workflow')), 'hero.yaml');
  await addToRoadmap(page);
  assert.deepEqual([page.added[0].workflow, page.added[0].inputs.mode], ['hero.yaml', undefined]);
});

test('#791 a workflow picked in the form presses Outro', { timeout: 30000 }, async () => {
  const page = await openDrawer(conversation([run([7])]));
  await click(page, inCard(page, 'po-kind-choice-fix'), 'Fix');
  await openForm(page);
  await change(page, selectIn(inCard(page, 'po-decisions-workflow')), 'hero.yaml');
  assert.equal(inCard(page, 'po-kind-choice-other').getAttribute('aria-pressed'), 'true');
});

test('#791 back to the PO\'s workflow in the form: its own kind and workflow again', { timeout: 30000 }, async () => {
  const page = await openDrawer(conversation([run([7])]));
  await click(page, inCard(page, 'po-kind-choice-fix'), 'Fix');
  await openForm(page);
  await change(page, selectIn(inCard(page, 'po-decisions-workflow')), 'feature.yaml');
  await addToRoadmap(page);
  assert.equal(inCard(page, 'po-kind-badge').getAttribute('data-kind'), 'feature');
  assert.deepEqual([page.added[0].workflow, page.added[0].inputs.mode], ['feature.yaml', undefined]);
});

test('#791 a kind\'s input changed in the form stays changed', { timeout: 30000 }, async () => {
  const page = await openDrawer(conversation([run([7])]));
  await click(page, inCard(page, 'po-kind-choice-fix'), 'Fix');
  await openForm(page);
  const mode = card(page).querySelector('[data-wi-input="mode"]');
  mode.value = 'local';
  mode.dispatchEvent(new page.dom.classes.Event('change', { bubbles: true }));
  await settle(30);
  await addToRoadmap(page);
  assert.notEqual(page.added[0].inputs.mode, 'remote');
});

test('#791 a card shows each issue\'s reason when they differ', { timeout: 30000 }, async () => {
  const issue_kinds = [{ issue: 7, kind: 'feature', reason: 'A new screen.' }, { issue: 9, kind: 'feature', reason: 'A new filter.' }];
  const page = await openDrawer(conversation([run([7, 9], { issue_kinds })]));
  const text = textOf(inCard(page, 'po-kind-reason'));
  assert.deepEqual([text.includes('#7 A new screen.'), text.includes('#9 A new filter.')], [true, true]);
});

test('#791 a card shows one line when the issues\' reasons are the same', { timeout: 30000 }, async () => {
  const page = await openDrawer(conversation([run([7, 9])]));
  assert.equal(textOf(inCard(page, 'po-kind-reason')).includes('#7'), false);
});

test('#791 a reason of the code follows the app\'s language', { timeout: 30000 }, async () => {
  const page = await openDrawer(conversation([run([8], { workflow: 'fix.yaml' })]), 'pt-BR');
  assert.equal(textOf(inCard(page, 'po-kind-reason')).includes('comportamento atual está errado'), true);
});

test('#791 an answer recorded with only `kindReason` still shows it', { timeout: 30000 }, async () => {
  const history = conversation([run([7])]);
  delete history[1].answer.groups[0].kindReasons;
  history[1].answer.groups[0].kindReason = 'From before.';
  const page = await openDrawer(history);
  assert.equal(textOf(inCard(page, 'po-kind-reason')).includes('From before.'), true);
});
