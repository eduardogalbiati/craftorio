// #319 (acceptance tests, written before the code): the CLIs each bundled workflow needs, for the
// first-run Setup's Workflows step and the Start panel.
//
// Contract (src/workflow-requirements.js, new):
// - workflowRequirements(wf) -> { clis, forge }. `wf` is a parsed workflow as loadWorkflow
//   (src/engine/workflow.js) returns it. `clis` is the sorted array of the CLI ids among
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
const { loadWorkflow } = require('../src/engine/workflow');

const WORKFLOWS = path.join(__dirname, '..', 'workflows');
const KNOWN = ['claude', 'codex', 'git', 'grok'];
const load = () => require('../src/workflow-requirements');
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

test('multi-model workflows need Codex: ai-arena, multi-model-review, run-retrospective', () => {
  for (const name of ['ai-arena', 'multi-model-review', 'run-retrospective']) {
    assert.ok(reqsOf(name).clis.includes('codex'), `${name} needs codex`);
  }
});

test('ai-development-local-hero needs only Claude Code and Git, no forge', () => {
  const r = reqsOf('ai-development-local-hero');
  assert.deepEqual(r.clis, ['claude', 'git']);
  assert.equal(r.forge, false);
});

test('local workflows need neither Codex, Grok nor a forge CLI: software-development-local-hero, e2e-release, test-batch', () => {
  for (const name of ['software-development-local-hero', 'e2e-release', 'test-batch']) {
    const r = reqsOf(name);
    assert.equal(r.clis.includes('codex'), false, `${name}: no codex`);
    assert.equal(r.clis.includes('grok'), false, `${name}: no grok`);
    assert.equal(r.forge, false, `${name}: no forge`);
  }
});

test('writer-reviewer needs its default reviewer CLI, and runs on Claude only when the reviewer is switched to Claude', () => {
  const wf = loadWorkflow(path.join(WORKFLOWS, 'writer-reviewer.yaml'));
  const { workflowRequirements } = load();
  assert.ok(workflowRequirements(wf).clis.includes('codex'), 'the reviewer defaults to Codex');
  assert.deepEqual(workflowRequirements(wf, { writer_provider: 'claude', reviewer_provider: 'claude' }).clis, ['claude', 'git']);
});

test('issue-tracker, backlog-refresh and software-development need gh or glab (forge)', () => {
  for (const name of ['issue-tracker', 'backlog-refresh', 'software-development']) {
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
