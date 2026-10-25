// #360 analysis seeds: the bundled seeds/<id>/seed.md files and src/domains/seed/seeds.js (schema, validation,
// seeding into the workspace, listing and reading).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { parseSkill } = require('../../src/domains/agents/skills');
const { validateSchema } = require('../../src/domains/workspace/json-schema');

const load = () => require('../../src/domains/seed/seeds');
const ROOT = path.join(__dirname, '..', '..');
const BUNDLED = path.join(ROOT, 'seeds');
const IDS = ['churn-complexity', 'dependency-map', 'pipeline-anatomy', 'quality-gate-report'];

function tmp(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'seeds-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

const VERIFY = /^#+\s*VERIFY\b/m;
// a "tell me" line after VERIFY, followed by at least one Markdown bullet
const reportBack = (body) => {
  const after = body.slice(body.search(VERIFY));
  return /tell me[^\n]*\n(\s*\n)*\s*- \S/i.test(after);
};

const sample = ({ meta = true, verify = true, tell = true, summary = true } = {}) => [
  ...(meta ? ['---', 'name: sample', ...(summary ? ['summary: Count the files of the project'] : []),
    'needs:', '  - git', 'produces:', '  - html', 'cost: one Oracle turn', '---', ''] : []),
  '# Sample', '', 'Count the files.', '',
  ...(verify ? ['## VERIFY', '', 'Re-count two folders by hand.', ''] : []),
  ...(tell ? ['When you are done, tell me:', '- the number of files', '- what you assumed', ''] : []),
].join('\n');

function writeSeed(dir, id, text) {
  fs.mkdirSync(path.join(dir, id), { recursive: true });
  fs.writeFileSync(path.join(dir, id, 'seed.md'), text);
}

test('#360 every bundled seed has valid front matter, a VERIFY section and a report-back list', () => {
  const { SEED_SCHEMA } = load();
  assert.equal(typeof SEED_SCHEMA, 'object');
  const ids = fs.readdirSync(BUNDLED).filter((d) => fs.existsSync(path.join(BUNDLED, d, 'seed.md')));
  for (const id of IDS) assert.ok(ids.includes(id), `bundled seed ${id}`);
  for (const id of ids) {
    const { meta, body } = parseSkill(fs.readFileSync(path.join(BUNDLED, id, 'seed.md'), 'utf8'));
    assert.deepEqual(validateSchema(meta, SEED_SCHEMA), [], `${id}: front matter`);
    assert.equal(meta.name, id, `${id}: name = folder`);
    assert.ok(VERIFY.test(body), `${id}: VERIFY section`);
    assert.ok(reportBack(body), `${id}: report-back list after VERIFY`);
  }
});

test('#360 validateSeed accepts a valid seed', () => {
  assert.deepEqual(load().validateSeed(sample()), []);
});

test('#360 validateSeed rejects a seed without a VERIFY section', () => {
  assert.ok(load().validateSeed(sample({ verify: false })).length > 0);
});

test('#360 validateSeed rejects a seed without a report-back list', () => {
  assert.ok(load().validateSeed(sample({ tell: false })).length > 0);
});

test('#360 validateSeed rejects a seed without a summary', () => {
  assert.ok(load().validateSeed(sample({ summary: false })).length > 0);
});

test('#360 seedSeeds copies the bundled seeds once and keeps an edited copy', (t) => {
  const { seedSeeds } = load();
  const src = tmp(t);
  const dest = path.join(tmp(t), 'seeds');
  writeSeed(src, 'sample', sample());
  assert.deepEqual(seedSeeds(src, dest), ['sample']);
  assert.ok(fs.existsSync(path.join(dest, 'sample', 'seed.md')));

  fs.writeFileSync(path.join(dest, 'sample', 'seed.md'), sample().replace('Count the files.', 'EDITED'));
  assert.deepEqual(seedSeeds(src, dest), []);
  assert.match(fs.readFileSync(path.join(dest, 'sample', 'seed.md'), 'utf8'), /EDITED/);
});

test('#360 listSeeds returns the seeds sorted by id with their summary and cost', (t) => {
  const dir = tmp(t);
  writeSeed(dir, 'zeta', sample().replace('name: sample', 'name: zeta'));
  writeSeed(dir, 'alpha', sample().replace('name: sample', 'name: alpha'));
  const list = load().listSeeds(dir);
  assert.deepEqual(list.map((s) => s.id), ['alpha', 'zeta']);
  assert.equal(list[0].summary, 'Count the files of the project');
  assert.equal(list[0].cost, 'one Oracle turn');
});

test('#360 readSeed returns null for an unknown id', (t) => {
  assert.equal(load().readSeed(tmp(t), 'nothing'), null);
});

test('#360 THIRD_PARTY_NOTICES.md credits ToolSeeds under MIT', () => {
  const text = fs.readFileSync(path.join(ROOT, 'THIRD_PARTY_NOTICES.md'), 'utf8');
  assert.match(text, /ToolSeeds/);
  const at = text.indexOf('ToolSeeds');
  assert.match(text.slice(at, at + 2000), /MIT/);
});
