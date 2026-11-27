// #319 (acceptance tests, written before the code): the CLIs each bundled workflow needs, for the
// first-run Setup's Workflows step and the Start panel.
//
// Contract (packages/engine/domains/workflow/workflow-requirements.js, new):
// - workflowRequirements(wf) -> { clis, forge }. `wf` is a parsed workflow as loadWorkflow
//   (packages/engine/engine/workflow.js) returns it. `clis` is the sorted array of the CLI ids among
//   'claude', 'codex', 'grok', 'git' the workflow needs: from its agents, orchestrator and steps
//   providers (the same logic as usage.preflight), plus 'git', which every bundled workflow needs.
//   `forge` is true when it also needs gh or glab (backlog sync, issues, pull requests).
//   workflowRequirements(wf, inputs): a provider templated from an input ("{{ inputs.x }}") resolves
//   to inputs[x] when given, else to that input's default.
// - missingRequirements(reqs, states) -> sorted array of the ids in reqs.clis whose state is not
//   'ready' (states maps a CLI id to 'ready' | 'signed-out' | 'missing' | 'checking'), plus the
//   string 'forge' when reqs.forge and neither gh nor glab is 'ready'.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { loadWorkflow } = require('../../engine/workflow');

const WORKFLOWS = path.join(__dirname, '..', '..', '..', '..', 'workflows');
const KNOWN = ['claude', 'codex', 'git', 'grok'];
const load = () => require('../../domains/workflow/workflow-requirements');
const bundled = () => fs.readdirSync(WORKFLOWS).filter((f) => f.endsWith('.yaml')).sort();
const reqsOf = (name) => load().workflowRequirements(loadWorkflow(path.join(WORKFLOWS, `${name}.yaml`)));

test('every bundled workflow needs git and only known CLI ids, sorted, with a boolean forge', () => {
  const files = bundled();
  assert.ok(files.length >= 10, 'the bundled workflows are found');
  for (const file of files) {
    const r = load().workflowRequirements(loadWorkflow(path.join(WORKFLOWS, file)));
    assert.ok(Array.isArray(r.clis), `${file}: clis is an array`);
    for (const id of r.clis) assert.ok(KNOWN.includes(id), `${file}: unknown CLI id ${id}`);
    assert.ok(r.clis.includes('git'), `${file}: needs git`);
    assert.deepEqual([...r.clis].sort(), r.clis, `${file}: clis sorted`);
    assert.equal(typeof r.forge, 'boolean', `${file}: forge is a boolean`);
  }
});

test('multi-model workflows need Codex: write-doc (ai-arena, #648), retrospective, feature with the multi-model review', () => {
  for (const name of ['write-doc', 'retrospective']) {
    assert.ok(reqsOf(name).clis.includes('codex'), `${name} needs codex`);
  }
  const wf = loadWorkflow(path.join(WORKFLOWS, 'feature.yaml'));
  assert.ok(load().workflowRequirements(wf, { review: 'multi_model' }).clis.includes('codex'), 'feature multi_model needs codex');
});

test('feature in local mode needs only Claude Code and Git, no forge', () => {
  const r = reqsOf('feature');
  assert.deepEqual(r.clis, ['claude', 'git']);
  assert.equal(r.forge, false);
});

test('feature and fix in remote mode need gh or glab (forge)', () => {
  for (const name of ['feature', 'fix']) {
    const wf = loadWorkflow(path.join(WORKFLOWS, `${name}.yaml`));
    assert.equal(load().workflowRequirements(wf, { mode: 'remote' }).forge, true, `${name}: forge`);
  }
});

test('local workflows need neither Codex, Grok nor a forge CLI: fix, release, test-backfill', () => {
  for (const name of ['fix', 'release', 'test-backfill']) {
    const r = reqsOf(name);
    assert.equal(r.clis.includes('codex'), false, `${name}: no codex`);
    assert.equal(r.clis.includes('grok'), false, `${name}: no grok`);
    assert.equal(r.forge, false, `${name}: no forge`);
  }
});

test('write-doc (writer-reviewer, #648) needs its default reviewer CLI, and runs on Claude only when the reviewer is switched to Claude', () => {
  const wf = loadWorkflow(path.join(WORKFLOWS, 'write-doc.yaml'));
  const { workflowRequirements } = load();
  assert.ok(workflowRequirements(wf).clis.includes('codex'), 'the reviewer defaults to Codex');
  assert.deepEqual(workflowRequirements(wf, { writer_provider: 'claude', reviewer_provider: 'claude' }).clis, ['claude', 'git']);
});

test('issue (issue-tracker, #648) and backlog-refresh need gh or glab (forge)', () => {
  for (const name of ['issue', 'backlog-refresh']) {
    assert.equal(reqsOf(name).forge, true, `${name}: forge`);
  }
});

test('missingRequirements: everything ready -> nothing missing', () => {
  const { missingRequirements } = load();
  assert.deepEqual(missingRequirements({ clis: ['claude', 'codex', 'git'], forge: true }, { claude: 'ready', codex: 'ready', git: 'ready', gh: 'ready', glab: 'ready' }), []);
});

test('missingRequirements: a missing Codex is reported', () => {
  const { missingRequirements } = load();
  assert.deepEqual(missingRequirements({ clis: ['claude', 'codex', 'git'], forge: false }, { claude: 'ready', codex: 'missing', git: 'ready' }), ['codex']);
});

test('missingRequirements: forge is met by gh alone (glab missing)', () => {
  const { missingRequirements } = load();
  assert.deepEqual(missingRequirements({ clis: ['claude', 'git'], forge: true }, { claude: 'ready', git: 'ready', gh: 'ready', glab: 'missing' }), []);
});

test('missingRequirements: forge with neither gh nor glab ready reports forge', () => {
  const { missingRequirements } = load();
  const out = missingRequirements({ clis: ['claude', 'git'], forge: true }, { claude: 'ready', git: 'ready', gh: 'missing', glab: 'signed-out' });
  assert.ok(out.includes('forge'));
  assert.equal(out.includes('claude'), false);
});

test('missingRequirements: signed-out counts as missing, and the result is sorted', () => {
  const { missingRequirements } = load();
  assert.deepEqual(missingRequirements({ clis: ['claude', 'codex', 'git'], forge: false }, { claude: 'signed-out', codex: 'missing', git: 'ready' }), ['claude', 'codex']);
});

// #97 (acceptance, written before the code): a bundled workflow's requirements follow the orchestrator AI chosen in
// the Setup. Contract assumed: workflowRequirements(wf, inputs, { orchestrator }) reads a bundled default workflow as
// it runs with that orchestrator (orchestrator-models.js applyOrchestrator): 'codex' moves its Claude agents to
// Codex, and the multi-model second reviewer to a provider other than the orchestrator's (Claude Code).
test('#97 with Codex as orchestrator, fix needs Codex and Git, not Claude Code', () => {
  const wf = loadWorkflow(path.join(WORKFLOWS, 'fix.yaml'));
  assert.deepEqual(load().workflowRequirements(wf, {}, { orchestrator: 'codex' }).clis, ['codex', 'git']);
});

test('#97 with Claude Code as orchestrator, or none given, fix needs Claude Code and Git as today', () => {
  const wf = loadWorkflow(path.join(WORKFLOWS, 'fix.yaml'));
  assert.deepEqual(load().workflowRequirements(wf, {}, { orchestrator: 'claude' }).clis, ['claude', 'git']);
  assert.deepEqual(load().workflowRequirements(wf, {}).clis, ['claude', 'git']);
});

test('#97 with Codex as orchestrator, feature needs Codex alone, and Claude Code too with the Multi-model review', () => {
  const wf = loadWorkflow(path.join(WORKFLOWS, 'feature.yaml'));
  const { workflowRequirements } = load();
  assert.deepEqual(workflowRequirements(wf, {}, { orchestrator: 'codex' }).clis, ['codex', 'git']);
  assert.deepEqual(workflowRequirements(wf, { review: 'multi_model' }, { orchestrator: 'codex' }).clis, ['claude', 'codex', 'git']);
});

test('#97 with Codex as orchestrator, a Multi-model feature without Claude Code keeps the "Missing … CLI" label', () => {
  const wf = loadWorkflow(path.join(WORKFLOWS, 'feature.yaml'));
  const { workflowRequirements, missingRequirements } = load();
  const { missingLabel } = require('@craftorio/shared/setup-model');
  const reqs = workflowRequirements(wf, { review: 'multi_model' }, { orchestrator: 'codex' });
  const missing = missingRequirements(reqs, { codex: 'ready', git: 'ready', claude: 'missing' });
  assert.deepEqual(missing, ['claude']);
  assert.equal(missingLabel(missing), 'Missing Claude Code');
});
