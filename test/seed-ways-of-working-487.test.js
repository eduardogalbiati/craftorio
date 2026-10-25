// #487: the ways-of-working analysis seed (seeds/ways-of-working/seed.md), read by src/seeds.js and
// run by src/domains/oracle/oracle-seeds.js like the other bundled seeds. Acceptance tests, written before the seed.
//
// Spec (what these tests assume):
//   seeds/ways-of-working/seed.md: valid seed front matter (src/seeds.js SEED_SCHEMA, name =
//   folder, produces json), a VERIFY section with a "tell me" list (validateSeed), read-only like
//   every seed (says so in its body), and its body documents the JSON model it answers with:
//   { profile: { team: solo|team, merge: local|pr, release: milestone|per-merge|train|rc-stable,
//     testCommand, ci, languages }, evidence: { <field>: numbers and commits } }.
//   oracle-seeds exposes no validator of a seed's model, so the documented keys are checked in the text.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const seeds = () => require('../src/seeds');
const ID = 'ways-of-working';
const FILE = path.join(__dirname, '..', 'seeds', ID, 'seed.md');
const text = () => fs.readFileSync(FILE, 'utf8');
const body = () => seeds().readSeed(seeds().BUNDLED_SEEDS_DIR, ID).body;

test('#487 seeds/ways-of-working/seed.md is a valid seed', () => {
  assert.equal(fs.existsSync(FILE), true, 'the seed file exists');
  assert.deepEqual(seeds().validateSeed(text()), []);
});

test('#487 the bundled seeds list ways-of-working, producing json', () => {
  const row = seeds().listSeeds(seeds().BUNDLED_SEEDS_DIR).find((s) => s.id === ID);
  assert.equal(row && row.name, ID);
  assert.equal(row.produces.includes('json'), true);
});

test('#487 the ways-of-working seed says it is read-only', () => {
  assert.match(body(), /read-only/i);
});

test('#487 the seed documents its JSON model: profile and evidence with every field and value', () => {
  const b = body();
  for (const word of ['profile', 'evidence', 'team', 'solo', 'merge', 'local', 'pr', 'release', 'milestone', 'per-merge', 'train', 'rc-stable', 'testCommand', 'ci', 'languages']) {
    assert.equal(new RegExp(`(^|[^\\w-])${word}([^\\w-]|$)`).test(b), true, `documents ${word}`);
  }
});

test('#487 the Oracle prompt of the seed carries its body and the read-only rules', () => {
  const { seedPrompt } = require('../src/domains/oracle/oracle-seeds');
  const seed = seeds().readSeed(seeds().BUNDLED_SEEDS_DIR, ID);
  const prompt = seedPrompt({ project: { id: 'p1', name: 'demo', folder: '/tmp/demo' }, seed });
  assert.equal(prompt.includes(String(seed.body).trim()), true);
  assert.equal(prompt.includes('Work read-only'), true);
});
