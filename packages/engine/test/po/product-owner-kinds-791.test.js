// #791: the Product Owner classifies each issue and the recommendation carries that kind's workflow.
// Acceptance tests, written before the code.
// Seam: productOwner.normalizeAnswer(answer, opts) with the new option `workflowKinds`
// ({ feature: { name, inputs }, fix: { name, inputs } }, the project's, already resolved), ask with the
// model stubbed at providers.runTurn, and ANSWER_SCHEMA.
// - the model classifies inside a group: groups[].issue_kinds [{ issue, kind, reason }]; a group without it
//   is classified from the labels (`bug` fix, `refactor` refactor, else feature); the model's kind wins;
// - each group has `kind`, `kindReason` (one line), `workflow` <name>.yaml and inputs from that kind's entry,
//   under #785's rule (only what was chosen is saved); the owner's `workflow` (#235) still wins over the kind;
// - a mixed group is split into one group per kind; stages may hold groups of different kinds;
// - "the owner cannot join them": the two ways a recommendation can put issues together are its `suggested`
//   issues (a checkbox) and Economy's packing, so another kind's issue is in neither.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const productOwner = require('../../domains/po/product-owner');

const ROOT = path.join(__dirname, '..', '..', '..', '..');
const MODE = { enum: ['local', 'remote', 'fork'], default: 'local' };
const FEATURE = { file: 'feature.yaml', name: 'feature', inputs: { task: {}, mode: MODE, validation: { enum: ['auto', 'validated'], default: 'auto' } } };
const FIX = { file: 'fix.yaml', name: 'fix', inputs: { task: {}, mode: MODE } };
const HERO = { file: 'hero.yaml', name: 'hero', inputs: { task: {}, mode: MODE } };
const WORKFLOWS = [FEATURE, FIX, HERO];
const KINDS = { feature: { name: 'feature', inputs: {} }, fix: { name: 'fix', inputs: { mode: 'remote' } } };
const ECONOMY = 1;

const issue = (number, ...labels) => ({ number, state: 'open', title: `Issue ${number}`, labels: labels.map((name) => ({ name })), body: 'x'.repeat(200) });
const group = (issues, extra = {}) => ({ name: 'Run', issues, workflow: 'feature.yaml', reason: 'r', stage: 1, ...extra });
const plan = (groups, issues, opts = {}) => productOwner.normalizeAnswer({ summary: 'ok', groups, conflicts: [], enrich: [] }, { issues, history: [], workflows: WORKFLOWS, workflowKinds: KINDS, ...opts }).groups;
const runs = (groups) => groups.map((g) => `${g.kind}:${[...g.issues].sort((a, b) => a - b).join(',')}`).sort();

// ---- the kind -------------------------------------------------------------------------------------

test('#791 a `bug` label makes an issue a Fix', () => {
  assert.equal(plan([group([1])], [issue(1, 'bug')])[0].kind, 'fix');
});

test('#791 a `refactor` label makes an issue a Refactor', () => {
  assert.equal(plan([group([1])], [issue(1, 'refactor')])[0].kind, 'refactor');
});

test('#791 an issue with neither label is a Feature', () => {
  assert.equal(plan([group([1])], [issue(1, 'enhancement')])[0].kind, 'feature');
});

test('#791 the model\'s kind decides when a label is missing', () => {
  const kinds = [{ issue: 1, kind: 'fix', reason: 'It describes a crash.' }];
  assert.equal(plan([group([1], { issue_kinds: kinds })], [issue(1)])[0].kind, 'fix');
});

test('#791 the model\'s kind wins over a wrong label', () => {
  const kinds = [{ issue: 1, kind: 'feature', reason: 'It asks for a new screen.' }];
  assert.equal(plan([group([1], { issue_kinds: kinds })], [issue(1, 'bug')])[0].kind, 'feature');
});

test('#791 a kind that does not exist falls back to the labels', () => {
  const kinds = [{ issue: 1, kind: 'chore', reason: 'Housekeeping.' }];
  assert.equal(plan([group([1], { issue_kinds: kinds })], [issue(1, 'bug')])[0].kind, 'fix');
});

test('#791 a group keeps the model\'s one-line reason for its kind', () => {
  const kinds = [{ issue: 1, kind: 'fix', reason: 'It describes a crash.' }];
  assert.equal(plan([group([1], { issue_kinds: kinds })], [issue(1)])[0].kindReason, 'It describes a crash.');
});

test('#791 a kind read from a label still has a one-line reason', () => {
  const { kindReason } = plan([group([1])], [issue(1, 'bug')])[0];
  assert.deepEqual([typeof kindReason, String(kindReason).trim().length > 0, String(kindReason).includes('\n')], ['string', true, false]);
});

test('#791 without the project\'s kinds a group is still classified, on the workflow it had', () => {
  const g = plan([group([1])], [issue(1, 'bug')], { workflowKinds: undefined })[0];
  assert.deepEqual([g.kind, g.workflow], ['fix', 'feature.yaml']);
});

// ---- the workflow that follows from it -------------------------------------------------------------

test('#791 a Fix carries the project\'s fix workflow and its inputs', () => {
  const g = plan([group([1])], [issue(1, 'bug')])[0];
  assert.deepEqual([g.workflow, { ...g.inputs }], ['fix.yaml', { mode: 'remote' }]);
});

test('#791 a Feature carries the project\'s feature workflow and its inputs', () => {
  const workflowKinds = { ...KINDS, feature: { name: 'hero', inputs: { mode: 'remote' } } };
  const g = plan([group([1])], [issue(1)], { workflowKinds })[0];
  assert.deepEqual([g.workflow, { ...g.inputs }], ['hero.yaml', { mode: 'remote' }]);
});

test('#791 a Refactor carries the project\'s feature workflow', () => {
  const workflowKinds = { ...KINDS, feature: { name: 'hero', inputs: {} } };
  assert.equal(plan([group([1])], [issue(1, 'refactor')], { workflowKinds })[0].workflow, 'hero.yaml');
});

test('#791 the kind\'s workflow wins over the one the model named', () => {
  assert.equal(plan([group([1], { workflow: 'hero.yaml' })], [issue(1, 'bug')])[0].workflow, 'fix.yaml');
});

test('#791 what the model chose for a group stays next to the kind\'s inputs', () => {
  const g = plan([group([1], { inputs: { validation: 'validated' } })], [issue(1)], { workflowKinds: { ...KINDS, feature: { name: 'feature', inputs: { mode: 'remote' } } } })[0];
  assert.deepEqual({ ...g.inputs }, { validation: 'validated', mode: 'remote' });
});

test('#791 the owner\'s workflow wins over the kind', () => {
  const g = plan([group([1])], [issue(1, 'bug')], { workflow: 'hero.yaml' })[0];
  assert.deepEqual([g.kind, g.workflow], ['fix', 'hero.yaml']);
});

// ---- #785: only what was chosen is saved -------------------------------------------------------------

test('#791 a kind\'s input equal to the project\'s run default is not saved', () => {
  assert.deepEqual({ ...plan([group([1])], [issue(1, 'bug')], { runDefaults: { mode: 'remote' } })[0].inputs }, {});
});

test('#791 a kind\'s input that differs from the project\'s run default is saved', () => {
  assert.deepEqual({ ...plan([group([1])], [issue(1, 'bug')], { runDefaults: { mode: 'fork' } })[0].inputs }, { mode: 'remote' });
});

test('#791 a kind\'s input equal to the workflow\'s default is not saved', () => {
  const workflowKinds = { ...KINDS, fix: { name: 'fix', inputs: { mode: 'local' } } };
  assert.deepEqual({ ...plan([group([1])], [issue(1, 'bug')], { workflowKinds })[0].inputs }, {});
});

// ---- one kind per run --------------------------------------------------------------------------------

test('#791 a mixed group is split into one group per kind', () => {
  const groups = plan([group([1, 2, 3])], [issue(1, 'bug'), issue(2), issue(3, 'bug')]);
  assert.deepEqual(runs(groups), ['feature:2', 'fix:1,3']);
});

test('#791 three kinds in a group give three groups, each issue in exactly one', () => {
  const groups = plan([group([1, 2, 3])], [issue(1, 'bug'), issue(2), issue(3, 'refactor')]);
  assert.deepEqual(runs(groups), ['feature:2', 'fix:1', 'refactor:3']);
});

test('#791 a group mixed by the model\'s own kinds is split too', () => {
  const kinds = [{ issue: 1, kind: 'fix', reason: 'A crash.' }, { issue: 2, kind: 'feature', reason: 'A new screen.' }];
  assert.deepEqual(runs(plan([group([1, 2], { issue_kinds: kinds })], [issue(1), issue(2)])), ['feature:2', 'fix:1']);
});

test('#791 each part of a split carries its own kind\'s workflow', () => {
  const groups = plan([group([1, 2])], [issue(1, 'bug'), issue(2)]);
  assert.deepEqual(groups.map((g) => `${g.kind}:${g.workflow}`).sort(), ['feature:feature.yaml', 'fix:fix.yaml']);
});

test('#791 the parts of a split stay in the group\'s stage, side by side', () => {
  const groups = plan([group([1, 2], { stage: 2 })], [issue(1, 'bug'), issue(2)]);
  assert.deepEqual(groups.map((g) => g.stage), [2, 2]);
});

test('#791 each part of a split is sized by its own issues', () => {
  const groups = plan([group([1, 2])], [issue(1, 'bug', 'complexity:2'), issue(2, 'complexity:3')]);
  assert.deepEqual(groups.map((g) => `${g.kind}:${g.complexity}`).sort(), ['feature:3', 'fix:2']);
});

test('#791 every part of a split keeps inputsChosen (#785)', () => {
  const groups = plan([group([1, 2])], [issue(1, 'bug'), issue(2)]);
  assert.deepEqual(groups.map((g) => g.inputsChosen), [true, true]);
});

test('#791 a mixed group is split even on the workflow the owner chose', () => {
  const groups = plan([group([1, 2])], [issue(1, 'bug'), issue(2)], { workflow: 'hero.yaml' });
  assert.deepEqual([runs(groups), [...new Set(groups.map((g) => g.workflow))]], [['feature:2', 'fix:1'], ['hero.yaml']]);
});

// ---- nothing joins two kinds afterwards ---------------------------------------------------------------

test('#791 Economy never packs a Feature and a Refactor into one run, though they share a workflow', () => {
  const groups = plan([group([1], { files: ['a.js'] }), group([2], { files: ['a.js'] })], [issue(1, 'complexity:1'), issue(2, 'refactor', 'complexity:1')], { cost: ECONOMY });
  assert.deepEqual(runs(groups.filter((g) => !g.testBatch)), ['feature:1', 'refactor:2']);
});

test('#791 Economy still packs two Features of one area', () => {
  const groups = plan([group([1], { files: ['a.js'] }), group([2], { files: ['a.js'] })], [issue(1, 'complexity:1'), issue(2, 'complexity:1')], { cost: ECONOMY });
  assert.deepEqual(runs(groups.filter((g) => !g.testBatch)), ['feature:1,2']);
});

test('#791 an issue of another kind is never suggested to join a group', () => {
  const g = plan([group([1], { suggested: [{ issue: 2, reason: 'Same files.' }, { issue: 3, reason: 'Same files.' }] })], [issue(1), issue(2, 'bug'), issue(3)])[0];
  assert.deepEqual(g.suggested.map((s) => s.issue), [3]);
});

// ---- the model's side -----------------------------------------------------------------------------------

test('#791 the answer schema lets a group classify each issue', () => {
  const items = productOwner.ANSWER_SCHEMA.properties.groups.items.properties.issue_kinds?.items;
  assert.deepEqual([...(items?.required || [])].sort(), ['issue', 'kind', 'reason']);
});

function tmp(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'po-791-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3 }));
  return dir;
}

// a real turn, the model stubbed at the system boundary
async function askModel(t, answer) {
  const providers = require('../../engine/providers');
  const original = providers.runTurn;
  t.after(() => { providers.runTurn = original; });
  const turns = [];
  providers.runTurn = async ({ prompt }) => { turns.push(prompt); return { text: `\`\`\`json\n${JSON.stringify(answer)}\n\`\`\``, costUsd: 0, usage: {} }; };
  const out = await productOwner.ask({
    backlogDir: tmp(t), runsDir: tmp(t), folder: tmp(t), projectId: 'demo', question: 'Analyze the backlog', mode: 'plan',
    data: { projectId: 'demo', issues: [issue(1, 'bug')] }, activeRuns: [], runs: [], workflows: WORKFLOWS, workflowKinds: KINDS,
    skillsDirs: [path.join(ROOT, 'skills')], resolveCommand: () => 'claude', agent: { model: 'claude-opus-5-5', effort: 'high' }, mock: false,
  });
  return { prompt: turns[0], groups: out.message.answer.groups };
}
const ANSWER = { summary: 'The plan.', groups: [group([1])], conflicts: [], enrich: [] };

test('#791 a real turn asks the model to classify each issue', async (t) => {
  assert.equal((await askModel(t, ANSWER)).prompt.includes('issue_kinds'), true);
});

test('#791 a real turn tells the model the project\'s workflow of each kind', async (t) => {
  const { prompt } = await askModel(t, ANSWER);
  assert.match(prompt, /\bfix\b[^\n]*fix\.yaml/i);
});

test('#791 ask hands the project\'s kinds to the answer', async (t) => {
  const { groups } = await askModel(t, ANSWER);
  assert.deepEqual([groups[0].kind, groups[0].workflow], ['fix', 'fix.yaml']);
});
