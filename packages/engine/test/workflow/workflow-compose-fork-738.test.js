// #738: the ways-of-working profile's third mode, fork ("Fork + PR"), in the composed workflow set
// (packages/engine/domains/workflow/workflow-compose.js). Acceptance tests, written before the code.
//
// The interface these tests assume: composeWorkflowSet({ profile: { mode: 'fork', ... } }) keeps
// settings.mode 'fork'; its feature and fix workflows tag the mode, have no local merge (no push_main),
// open the PR through the CI pusher, and their worktree config says fork: true (checkout.js syncs the
// fork's default branch from upstream before each run).
const test = require('node:test');
const assert = require('node:assert/strict');
const yaml = require('js-yaml');

const load = () => require('../../domains/workflow/workflow-compose');

const FACTS = { languages: ['javascript'], skills: ['unit-test-writer-js'] };
const FORK = { mode: 'fork', ci: 'pr+release', tests: 'unit', release: 'per-merge', testCommand: 'npm test', checkCommand: null, languages: ['javascript'] };

const compose = (profile, answers = {}) => load().composeWorkflowSet({ profile, answers, facts: FACTS });
const docOf = (out, name) => yaml.load(out.workflows.find((w) => w.name === name).yaml);

test('#738 a fork profile composes in mode fork (also when the owner answers fork)', () => {
  assert.equal(compose(FORK).settings.mode, 'fork');
  assert.equal(compose({ ...FORK, mode: undefined }, { mode: 'fork' }).settings.mode, 'fork');
});

test('#738 the fork set\'s feature and fix: tagged fork, worktree fork: true, a PR and no push_main', () => {
  const out = compose(FORK);
  for (const name of ['feature', 'fix']) {
    const doc = docOf(out, name);
    const ids = doc.steps.map((s) => s.id);
    assert.equal(doc.metadata.tags.includes('fork'), true, `${name} tags: ${JSON.stringify(doc.metadata.tags)}`);
    assert.equal(doc.orchestrator.worktree.fork, true, `${name} worktree: ${JSON.stringify(doc.orchestrator.worktree)}`);
    assert.equal(ids.includes('push_main'), false, `${name} steps: ${JSON.stringify(ids)}`);
    assert.equal(ids.includes('ci'), true, `${name} waits for the PR's CI: ${JSON.stringify(ids)}`);
  }
});
