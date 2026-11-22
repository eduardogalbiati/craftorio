// #791: a recommendation shows its kind, the plan is summed up and grouped by kind, and the long select
// becomes a Feature | Fix | Outro control. Acceptance tests, written before the code, on the whole page
// (backlog-po-785-harness.js's pieces); a recommendation is built by the engine's own normalizeAnswer.
// Contract (test ids): po-kind-badge (data-kind, icon + the kind's name), po-kind-summary,
// po-kind-group-<kind>, po-kind-control, po-kind-choice-feature / -fix / -other (aria-pressed),
// po-kind-other-select. The project record (state.projects, BacklogActions.project, api.listProjects)
// holds workflowKinds: what the drawer swaps to.
// "The owner cannot join kinds": the recommendation's only way to add an issue to a run is its `suggested`
// checkboxes (data-po-extra); there is no merge action. "Add all" keeps one roadmap item per group.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const productOwner = require('@craftorio/engine/domains/po/product-owner');
const { FEATURE, HINTS, RUN_DEFAULTS, plain, click, isHidden, byTestId, settle, textOf, loadPage } = require('./backlog-po-785-harness');

const ROOT = path.join(__dirname, '..', '..', '..');
const fixDoc = yaml.load(fs.readFileSync(path.join(ROOT, 'workflows', 'fix.yaml'), 'utf8'));
const FIX = { file: 'fix.yaml', name: fixDoc.metadata.name, description: fixDoc.metadata.description, category: 'build', inputs: fixDoc.inputs };
const task = { task: { type: 'string' } };
const OWN = [{ ...FEATURE, category: 'build' }, FIX];
const ALL = [
  ...OWN,
  { file: 'write-doc.yaml', name: 'write-doc', category: 'plan', inputs: task },
  { file: 'unrelated.yaml', name: 'unrelated', category: 'build', inputs: task },
  { file: 'workflows/repo-flow.yaml', name: 'repo-flow', category: 'solo', origin: 'repository', projectId: 'demo', accepted: true, inputs: task },
  { file: 'release.yaml', name: 'release', category: 'build', inputs: {} },
  { file: 'broken.yaml', name: 'broken', category: 'build', inputs: task, error: 'Invalid YAML' },
];
const EVERY_TASK = ['feature.yaml', 'fix.yaml', 'unrelated.yaml', 'workflows/repo-flow.yaml', 'write-doc.yaml'];
const KINDS = { feature: { name: 'feature', inputs: {} }, fix: { name: 'fix', inputs: { mode: 'remote' } } };
const PROJECT = {
  id: 'demo', name: 'Demo project', folder: 'C:/work/demo', defaultWorkflow: 'feature', workflowKinds: KINDS,
  workflows: [{ name: 'feature', origin: 'bundled', category: 'build' }, { name: 'fix', origin: 'bundled', category: 'build' }],
};

const issue = (number, ...labels) => ({ number, state: 'open', title: `Issue ${number}`, url: `https://example.test/${number}`, labels: labels.map((name) => ({ name })), body: 'x'.repeat(200) });
const FEATURE_ISSUE = issue(7);
const BUG = issue(8, 'bug');
const FEATURE_TWO = issue(9);
const ISSUES = [FEATURE_ISSUE, BUG, FEATURE_TWO];
const run = (issues, extra = {}) => ({ name: `Run ${issues.join('+')}`, issues, workflow: 'feature.yaml', reason: 'Same files.', stage: 1, ...extra });

// A conversation whose answer recommends `groups`, kept and classified by the engine
function conversation(groups, issues = ISSUES) {
  const answer = productOwner.normalizeAnswer({ summary: 'The plan.', groups, conflicts: [], enrich: [] }, { issues, history: [], workflows: ALL.filter((w) => !w.error && w.inputs?.task), runDefaults: RUN_DEFAULTS, workflowKinds: KINDS });
  return plain([
    { role: 'user', text: 'Analyze the backlog', ts: '2026-11-05T10:00:00.000Z' },
    { role: 'po', text: answer.summary, ts: '2026-11-05T10:01:00.000Z', answer, costUsd: 0 },
  ]);
}

async function openDrawer(history, { language = null, issues = ISSUES } = {}) {
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
  actions.data = () => ({ projectId: 'demo', issues: plain(issues) });
  actions.roadmapGroup = async (g) => { added.push(plain(g)); return []; };
  actions.showRoadmap = () => {};
  await page.sandbox.BacklogPO.open();
  await settle(30);
  return Object.assign(page, { added });
}

const cards = (page) => Array.from(page.document.querySelectorAll('#po-log .po-group'));
const issuesOf = (card) => textOf(card.querySelector('.po-issues'));
const cardOf = (page, n) => cards(page).find((c) => issuesOf(c).includes(`#${n}`)) ?? null;
const inCard = (page, n, id) => { const c = cardOf(page, n); return c ? byTestId(c, id) : null; };
const pressed = (page, n, choice) => inCard(page, n, `po-kind-choice-${choice}`)?.getAttribute('aria-pressed') ?? null;
const choose = (page, n, choice) => click(page, inCard(page, n, `po-kind-choice-${choice}`), `the ${choice} choice`);
const addToRoadmap = (page, n) => click(page, cardOf(page, n)?.querySelector('[data-po-act="roadmap"]') ?? null, '"Add to roadmap"');
const addAll = (page) => click(page, page.$('#po-log [data-po-act="roadmap-all"]'), '"Add all to the roadmap"');
const sent = (page) => page.added.map((g) => ({ workflow: g.workflow, inputs: g.inputs }));
const selectIn = (el) => { if (!el) return null; return String(el.tagName).toUpperCase() === 'SELECT' ? el : el.querySelector('select'); };
const otherSelect = (page, n) => selectIn(inCard(page, n, 'po-kind-other-select'));
const optionsOf = (select) => Array.from(select?.querySelectorAll('option') || []).map((o) => String(o.getAttribute('value'))).sort();
async function change(page, select, value) {
  assert.equal(select === null, false, 'the select is rendered');
  select.value = value;
  select.dispatchEvent(new page.dom.classes.Event('change', { bubbles: true }));
  await settle(30);
}

// ---- the badge --------------------------------------------------------------------------------------

test('#791 a recommendation shows its kind\'s badge', { timeout: 30000 }, async () => {
  const page = await openDrawer(conversation([run([8])]));
  assert.equal(inCard(page, 8, 'po-kind-badge')?.getAttribute('data-kind') ?? null, 'fix');
});

test('#791 the badge names the kind in words, never by colour alone', { timeout: 30000 }, async () => {
  const page = await openDrawer(conversation([run([8])]));
  assert.equal(textOf(inCard(page, 8, 'po-kind-badge')).includes('Fix'), true);
});

test('#791 the badge has an icon', { timeout: 30000 }, async () => {
  const page = await openDrawer(conversation([run([8])]));
  const badge = inCard(page, 8, 'po-kind-badge');
  assert.equal(!!(badge?.querySelector('svg') || badge?.querySelector('[aria-hidden="true"]')), true);
});

test('#791 a Refactor has its own badge', { timeout: 30000 }, async () => {
  const page = await openDrawer(conversation([run([3])], [issue(3, 'refactor')]), { issues: [issue(3, 'refactor')] });
  assert.equal(inCard(page, 3, 'po-kind-badge')?.getAttribute('data-kind') ?? null, 'refactor');
});

test('#791 a recommendation shows why it is of that kind', { timeout: 30000 }, async () => {
  const kinds = [{ issue: 8, kind: 'fix', reason: 'It describes a crash on save.' }];
  const page = await openDrawer(conversation([run([8], { issue_kinds: kinds })]));
  assert.equal(textOf(cardOf(page, 8)).includes('It describes a crash on save.'), true);
});

// ---- the plan by kind ---------------------------------------------------------------------------------

test('#791 the plan sums up its runs by kind', { timeout: 30000 }, async () => {
  const issues = [issue(1), issue(2), issue(3), issue(4, 'bug'), issue(5, 'bug')];
  const page = await openDrawer(conversation(issues.map((i) => run([i.number])), issues), { issues });
  assert.equal(textOf(page.$('#po-log [data-testid="po-kind-summary"]')).includes('3 Features · 2 Fixes'), true);
});

test('#791 the summary reads one of a kind in the singular', { timeout: 30000 }, async () => {
  const page = await openDrawer(conversation([run([7]), run([8])]));
  assert.equal(textOf(page.$('#po-log [data-testid="po-kind-summary"]')).includes('1 Feature · 1 Fix'), true);
});

test('#791 the plan groups its recommendations by kind', { timeout: 30000 }, async () => {
  const page = await openDrawer(conversation([run([7]), run([8]), run([9])]));
  const inGroup = (kind) => Array.from(page.$(`#po-log [data-testid="po-kind-group-${kind}"]`)?.querySelectorAll('.po-group') || []).map(issuesOf).sort();
  assert.deepEqual([inGroup('feature'), inGroup('fix')], [['#7', '#9'], ['#8']]);
});

// ---- the control --------------------------------------------------------------------------------------

test('#791 the control offers Feature, Fix and Other', { timeout: 30000 }, async () => {
  const page = await openDrawer(conversation([run([7])]));
  assert.deepEqual(['feature', 'fix', 'other'].map((c) => textOf(inCard(page, 7, `po-kind-choice-${c}`))), ['Feature', 'Fix', 'Other']);
});

test('#791 pt-BR: Other reads Outro', { timeout: 30000 }, async () => {
  const page = await openDrawer(conversation([run([7])]), { language: 'pt-BR' });
  assert.equal(textOf(inCard(page, 7, 'po-kind-choice-other')), 'Outro');
});

test('#791 the control marks the recommendation\'s kind', { timeout: 30000 }, async () => {
  const page = await openDrawer(conversation([run([8])]));
  assert.deepEqual(['feature', 'fix', 'other'].map((c) => pressed(page, 8, c)), ['false', 'true', 'false']);
});

test('#791 Feature to Fix swaps the workflow and its inputs', { timeout: 30000 }, async () => {
  const page = await openDrawer(conversation([run([7])]));
  await choose(page, 7, 'fix');
  await addToRoadmap(page, 7);
  assert.deepEqual(sent(page), [{ workflow: 'fix.yaml', inputs: { mode: 'remote' } }]);
});

test('#791 Fix to Feature swaps them back', { timeout: 30000 }, async () => {
  const page = await openDrawer(conversation([run([8])]));
  await choose(page, 8, 'feature');
  await addToRoadmap(page, 8);
  assert.deepEqual(sent(page), [{ workflow: 'feature.yaml', inputs: {} }]);
});

test('#791 the swap shows on the card: its badge, its pressed choice and its workflow', { timeout: 30000 }, async () => {
  const page = await openDrawer(conversation([run([7])]));
  await choose(page, 7, 'fix');
  const shown = [inCard(page, 7, 'po-kind-badge')?.getAttribute('data-kind') ?? null, pressed(page, 7, 'fix'), textOf(inCard(page, 7, 'po-decision-workflow')).includes('Fix')];
  assert.deepEqual(shown, ['fix', 'true', true]);
});

test('#791 a swap moves the plan\'s summary and its groups, in the whole drawer', { timeout: 30000 }, async () => {
  const page = await openDrawer(conversation([run([7]), run([8]), run([9])]));
  await choose(page, 7, 'fix');
  const inGroup = (kind) => Array.from(page.$(`#po-log [data-testid="po-kind-group-${kind}"]`)?.querySelectorAll('.po-group') || []).map(issuesOf).sort();
  assert.equal(textOf(page.$('#po-log [data-testid="po-kind-summary"]')).includes('1 Feature · 2 Fixes'), true);
  assert.deepEqual([inGroup('feature'), inGroup('fix')], [['#9'], ['#7', '#8']]);
});

test('#791 "Add all to the roadmap" sends the swap too', { timeout: 30000 }, async () => {
  const page = await openDrawer(conversation([run([7])]));
  await choose(page, 7, 'fix');
  await addAll(page);
  const item = plain(page.callsTo('proposeRoadmap')[0]?.[1] ?? {}).stages?.[0]?.items?.[0] ?? {};
  assert.deepEqual([item.workflow, item.inputs], ['fix.yaml', { mode: 'remote' }]);
});

// ---- Other ----------------------------------------------------------------------------------------------

test('#791 the select of every workflow waits behind Other', { timeout: 30000 }, async () => {
  const page = await openDrawer(conversation([run([7])]));
  assert.deepEqual([byTestId(cardOf(page, 7), 'po-kind-control') === null, isHidden(inCard(page, 7, 'po-kind-other-select'))], [false, true]);
});

test('#791 Other lists every workflow that takes a task, repository ones included', { timeout: 30000 }, async () => {
  const page = await openDrawer(conversation([run([7])]));
  await choose(page, 7, 'other');
  assert.deepEqual(optionsOf(otherSelect(page, 7)), EVERY_TASK);
});

test('#791 a workflow chosen in Other goes to the roadmap on that item', { timeout: 30000 }, async () => {
  const page = await openDrawer(conversation([run([7])]));
  await choose(page, 7, 'other');
  await change(page, otherSelect(page, 7), 'workflows/repo-flow.yaml');
  await addToRoadmap(page, 7);
  assert.deepEqual(page.added.map((g) => g.workflow), ['workflows/repo-flow.yaml']);
});

test('#791 a workflow chosen in Other survives a redraw, with Other pressed', { timeout: 30000 }, async () => {
  const page = await openDrawer(conversation([run([7])]));
  await choose(page, 7, 'other');
  await change(page, otherSelect(page, 7), 'unrelated.yaml');
  page.document.dispatchEvent(new page.dom.classes.Event('backlog:data'));
  await settle(30);
  assert.deepEqual([otherSelect(page, 7)?.value ?? null, pressed(page, 7, 'other')], ['unrelated.yaml', 'true']);
});

// ---- only the project's workflows by default --------------------------------------------------------------

test('#791 a recommendation\'s form offers only the project\'s workflows', { timeout: 30000 }, async () => {
  const page = await openDrawer(conversation([run([7])]));
  await click(page, inCard(page, 7, 'po-decisions-edit'), '"Editar"');
  assert.deepEqual(optionsOf(selectIn(inCard(page, 7, 'po-decisions-workflow'))), ['feature.yaml', 'fix.yaml']);
});

test('#791 a draft\'s workflow select offers only the project\'s workflows', { timeout: 30000 }, async () => {
  const draft = { role: 'po', mode: 'issue', text: 'Here is the draft.', ts: '2026-11-05T10:01:00.000Z', costUsd: 0, issue: { reply: 'Here is the draft.', questions: [], draft: { title: 'Save fails', body: 'It fails.', labels: [], related: [] }, duplicates: [] } };
  const page = await openDrawer([{ role: 'user', text: 'Register it', ts: '2026-11-05T10:00:00.000Z', mode: 'issue' }, draft]);
  assert.deepEqual(optionsOf(page.$('#po-log [data-po-wf]')), ['feature.yaml', 'fix.yaml']);
});

test('#791 a split\'s workflow select offers only the project\'s workflows', { timeout: 30000 }, async () => {
  const children = [{ title: 'One', tasks: [1], complexity: 1, stage: 1 }, { title: 'Two', tasks: [2], complexity: 1, stage: 1 }];
  const splits = [{ issue: 7, title: 'Issue 7', reasons: ['Too big.'], parent: 'umbrella', tasks: [{ n: 1, text: 'One' }, { n: 2, text: 'Two' }], children }];
  const answer = { summary: 'Split it.', groups: [], conflicts: [], enrich: [], splits };
  const page = await openDrawer([{ role: 'po', text: 'Split it.', ts: '2026-11-05T10:01:00.000Z', answer, costUsd: 0 }]);
  assert.deepEqual(optionsOf(page.$('#po-log [data-split-wf]')), ['feature.yaml', 'fix.yaml']);
});

// ---- two kinds never join ---------------------------------------------------------------------------------

test('#791 a recommendation offers no checkbox to join an issue of another kind', { timeout: 30000 }, async () => {
  const page = await openDrawer(conversation([run([7], { suggested: [{ issue: 8, reason: 'Same files.' }, { issue: 9, reason: 'Same files.' }] })]));
  const extras = Array.from(cardOf(page, 7).querySelectorAll('[data-po-extra]')).map((el) => el.getAttribute('data-po-extra'));
  assert.deepEqual(extras, ['9']);
});

test('#791 "Add all to the roadmap" keeps a mixed group\'s kinds in separate items', { timeout: 30000 }, async () => {
  const page = await openDrawer(conversation([run([7, 8])]));
  await addAll(page);
  const items = plain(page.callsTo('proposeRoadmap')[0]?.[1] ?? {}).stages?.flatMap((s) => s.items) ?? [];
  assert.deepEqual(items.map((i) => (i.issues || []).map((x) => Number(x?.number ?? x)).join('+')).sort(), ['7', '8']);
});

// ---- the catalogs ------------------------------------------------------------------------------------------

const catalog = (lang) => JSON.parse(fs.readFileSync(path.join(ROOT, 'packages', 'shared', 'i18n', `${lang}.json`), 'utf8'));
const KEYS = ['po.kind.feature', 'po.kind.fix', 'po.kind.refactor', 'po.kind.other'];

test('#791 en.json names the kinds', () => {
  assert.deepEqual(KEYS.filter((k) => !catalog('en')[k]), []);
});

test('#791 pt-BR.json names the kinds', () => {
  assert.deepEqual(KEYS.filter((k) => !catalog('pt-BR')[k]), []);
});

test('#791 Other is "Other" in English and "Outro" in Portuguese', () => {
  assert.deepEqual([catalog('en')['po.kind.other'], catalog('pt-BR')['po.kind.other']], ['Other', 'Outro']);
});
