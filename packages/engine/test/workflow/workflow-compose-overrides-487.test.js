// #487 (review round 2): packages/engine/domains/workflow/workflow-compose.js beyond the acceptance tests: the composed manifest
// merged into the repository's (same-name entries replaced in place, the other entries, version and
// requires kept), an unknown team asked and the team answer winning, the owner's overrides of the
// inferred profile (languages as a comma list, an empty answer keeping the inferred value) and the
// check command reaching the agents' prompts.
const test = require('node:test');
const assert = require('node:assert/strict');
const yaml = require('js-yaml');
const compose = require('../../domains/workflow/workflow-compose');

const SOLO = { team: 'solo', merge: 'local', release: 'milestone', testCommand: 'npm test', checkCommand: null, ci: 'github-actions', languages: ['javascript'] };

const byCategory = (out, category) => out.workflows.find((w) => w.category === category);
const prompts = (doc) => Object.values(doc.agents || {}).map((a) => `${a.system_prompt || ''}\n${a.prompt || ''}`).join('\n');
const skills = (doc) => Object.values(doc.agents || {}).flatMap((a) => a.skills || []);

test('#487 mergeManifest replaces the composed names in place and keeps the other entries, version and requires', () => {
  const existing = {
    version: 2,
    requires: '>=1.4.0',
    workflows: [
      { name: 'nightly', file: 'workflows/nightly.yaml', category: 'build', description: null },
      { name: 'dev', file: 'workflows/old-dev.yaml', category: 'solo' },
    ],
  };
  const out = compose.mergeManifest(existing, [
    { name: 'dev', file: 'workflows/dev.yaml', category: 'solo', description: 'composed' },
    { name: 'ship-it', file: 'workflows/ship-it.yaml', category: 'release', description: 'composed' },
  ]);
  assert.equal(out.version, 2);
  assert.equal(out.requires, '>=1.4.0');
  assert.deepEqual(out.workflows.map((w) => w.name), ['nightly', 'dev', 'ship-it']);
  assert.equal(out.workflows[1].file, 'workflows/dev.yaml');
  assert.equal(out.workflows[0].file, 'workflows/nightly.yaml');
  assert.equal('description' in out.workflows[0], false);
});

test('#487 mergeManifest without a manifest starts a version 1 one with no requires', () => {
  const out = compose.mergeManifest(null, [{ name: 'dev', file: 'workflows/dev.yaml', category: 'solo' }]);
  assert.equal(out.version, 1);
  assert.equal('requires' in out, false);
  assert.deepEqual(out.workflows.map((w) => w.name), ['dev']);
});

test('#487 composeWorkflowSet merges into the existing manifest it is given', () => {
  const existing = { version: 3, requires: '>=2.0.0', workflows: [{ name: 'nightly', file: 'workflows/nightly.yaml', category: 'build' }] };
  const out = compose.composeWorkflowSet({ profile: SOLO, answers: {}, existing });
  const doc = yaml.load(out.manifest.yaml);
  assert.equal(doc.version, 3);
  assert.equal(doc.requires, '>=2.0.0');
  assert.deepEqual(doc.workflows.map((w) => w.name), ['nightly', ...out.workflows.map((w) => w.name)]);
});

// #630: team left the ways of working; the mode (local | remote) took its question
test('#487 openQuestions asks local or remote when the profile does not know it, local by default', () => {
  const q = compose.openQuestions({ ...SOLO, merge: null }).find((x) => x.id === 'mode');
  assert.equal(q === undefined, false);
  assert.equal(q.default, 'local');
  assert.deepEqual(q.options.map((o) => o.value), ['local', 'remote']);
  assert.equal(compose.openQuestions(SOLO).some((x) => x.id === 'mode'), false);
});

test('#487 the mode answer wins over the profile', () => {
  const out = compose.composeWorkflowSet({ profile: SOLO, answers: { mode: 'remote' } });
  assert.equal(out.settings.mode, 'remote');
  assert.equal(byCategory(out, 'feature') === undefined, false);
});

test('#487 an unknown mode with no answer composes for local', () => {
  assert.equal(compose.composeWorkflowSet({ profile: { ...SOLO, merge: null }, answers: {} }).settings.mode, 'local');
});

test('#487 languages answered as a comma list replace the inferred ones in the prompts and skills', () => {
  const out = compose.composeWorkflowSet({ profile: SOLO, answers: { languages: 'js, rust' } });
  const dev = yaml.load(byCategory(out, 'feature').yaml);
  assert.equal(prompts(dev).includes('languages js, rust'), true);
  assert.equal(skills(dev).includes('unit-test-writer-rust'), true);
});

test('#487 an empty override keeps the inferred value', () => {
  const out = compose.composeWorkflowSet({ profile: { ...SOLO, testCommand: 'npm run test:unit' }, answers: { languages: '  ', testCommand: '', merge: null } });
  assert.equal(out.settings.testCommand, 'npm run test:unit');
  assert.equal(out.settings.mode, 'local');
  const dev = yaml.load(byCategory(out, 'feature').yaml);
  assert.equal(prompts(dev).includes('languages js'), true);
  assert.equal(skills(dev).includes('unit-test-writer-js'), true);
});

test('#487 the check command reaches the agents\' prompts; none leaves the checks sentence out', () => {
  const withCheck = compose.composeWorkflowSet({ profile: { ...SOLO, checkCommand: 'npm run lint' }, answers: {} });
  assert.equal(withCheck.settings.checkCommand, 'npm run lint');
  assert.equal(prompts(yaml.load(byCategory(withCheck, 'feature').yaml)).includes('`npm run lint`'), true);
  const answered = compose.composeWorkflowSet({ profile: SOLO, answers: { checkCommand: 'npx tsc --noEmit' } });
  assert.equal(prompts(yaml.load(byCategory(answered, 'feature').yaml)).includes('`npx tsc --noEmit`'), true);
  const none = compose.composeWorkflowSet({ profile: SOLO, answers: {} });
  assert.equal(prompts(yaml.load(byCategory(none, 'feature').yaml)).includes('its checks (lint, types)'), false);
});
