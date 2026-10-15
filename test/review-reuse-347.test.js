// #347: reviewer and developer look for an existing helper before adding a rule or mapping.
// skills/code-review gets a reuse pass before the verdict: for each new function, constant or
// mapping table of the diff, search the repository (name, mapped literal values, the rule it
// computes); a rule or table found elsewhere is a `major` finding naming both places and the one
// to keep (plain copied lines stay `minor`). The developer is told the same up front and names in
// its handoff what it reused. A review fixture (test/fixtures/review-reuse/) keeps the case of a
// second provider mapping table: its expected finding is `major` with both paths, and the skill
// states every rule the fixture needs. Read from the bundled skills and workflow YAML.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { loadWorkflow } = require('../src/engine/workflow');

const ROOT = path.join(__dirname, '..');
const FIXTURES = path.join(__dirname, 'fixtures', 'review-reuse');
const skill = (name) => fs.readFileSync(path.join(ROOT, 'skills', name, 'SKILL.md'), 'utf8');
const flat = (s) => s.replace(/\s+/g, ' ');
const fixtures = () => fs.readdirSync(FIXTURES).filter((f) => f.endsWith('.json')).map((f) => ({ f, b: JSON.parse(fs.readFileSync(path.join(FIXTURES, f), 'utf8')) }));

// The reuse pass of the code-review skill: the text from its heading to the next heading.
function reusePass() {
  const text = skill('code-review');
  const m = /^#{2,4} .*\breuse\b.*$/im.exec(text);
  assert.ok(m, 'skills/code-review/SKILL.md has a heading for the reuse pass');
  const rest = text.slice(m.index + m[0].length);
  const next = rest.search(/\n#{2,4} /);
  return { text, at: m.index, body: flat(next < 0 ? rest : rest.slice(0, next)) };
}

test('#347 the code-review skill has a reuse pass before the verdict', () => {
  const { text, at } = reusePass();
  const verdict = text.search(/^#{2,4} .*verdict/im);
  assert.ok(verdict > 0, 'the skill still has its verdict section');
  assert.ok(at < verdict, 'the reuse pass comes before the verdict');
});

test('#347 the reuse pass searches the repository for each new function, constant or mapping table by name, mapped values and rule', () => {
  const { body } = reusePass();
  assert.match(body, /function/i);
  assert.match(body, /constant/i);
  assert.match(body, /mapping table/i);
  assert.match(body, /search/i);
  assert.match(body, /\bname\b/i);
  assert.match(body, /literal values/i);
  assert.match(body, /\brule\b/i);
});

test('#347 a rule or table found elsewhere is major, naming both places, the one to keep and the helper to call; copied lines stay minor', () => {
  const { body } = reusePass();
  assert.match(body, /`?major`?/);
  assert.match(body, /both places/i);
  assert.match(body, /keep/i);
  assert.match(body, /which helper to call|where to move/i);
  assert.match(body, /copied lines[^.]*`?minor`?|`?minor`?[^.]*copied lines/i);
});

test('#347 the severity table no longer keeps every duplication minor: a duplicated rule or mapping is major', () => {
  const text = skill('code-review');
  const majorRow = text.split('\n').find((l) => l.startsWith('| `major`'));
  assert.ok(majorRow, 'the severity table has its major row');
  assert.match(majorRow, /rule|mapping/i, 'the major row names a duplicated rule or mapping');
});

test('#347 the reuse pass runs unattended: it records an assumption, never asks', () => {
  const { body } = reusePass();
  assert.doesNotMatch(body, /\bask (the )?(user|owner)\b/i);
  assert.match(fs.readFileSync(path.join(ROOT, 'skills', 'code-review', 'rules', 'smells.md'), 'utf8'), /already exists elsewhere/i, 'smells.md keeps its duplicated-code row');
});

test('#347 the review fixture of a second provider mapping table expects a major finding naming both paths', () => {
  const all = fixtures();
  const fx = all.find(({ b }) => /provider/i.test(b.title));
  assert.ok(fx, `a provider-table fixture in test/fixtures/review-reuse (found: ${all.map((x) => x.f).join(', ')})`);
  const { b } = fx;
  assert.match(b.diff, /^\+const \w+ = \{ 'claude-code': 'claude'/m, 'the diff adds a second provider mapping table');
  assert.equal(b.expectedFinding.severity, 'major');
  assert.deepEqual([...b.expectedFinding.paths].sort(), [b.existing.file, b.expectedFinding.file].sort());
  for (const p of b.expectedFinding.paths) assert.ok(b.expectedFinding.description.includes(p), `the finding names ${p}`);
  const existing = fs.readFileSync(path.join(ROOT, ...b.existing.file.split('/')), 'utf8');
  assert.ok(existing.includes(b.existing.evidence), `${b.existing.file} still holds the table the diff duplicates`);
});

test('#347 the code-review skill states every rule the review fixtures need', () => {
  const text = flat(skill('code-review'));
  for (const { f, b } of fixtures()) {
    for (const rule of b.skillRules) assert.match(text, new RegExp(rule, 'i'), `${f}: the code-review skill states "${rule}"`);
  }
});

test('#347 the reuse section of context-economy reaches the developer only, not the reviewer or the test writer', () => {
  const { resolveSkill, skillPrompt } = require('../src/skills');
  const ce = resolveSkill([path.join(ROOT, 'skills')], 'context-economy');
  const reuse = /name what you reused/i;
  assert.match(skillPrompt(ce, 'developer'), reuse);
  assert.doesNotMatch(skillPrompt(ce, 'reviewer'), reuse);
  assert.doesNotMatch(skillPrompt(ce, 'test_writer'), reuse);
});

// What the developer agent is told: its system prompt and the skills it loads.
function developerGuidance(file) {
  const dev = loadWorkflow(path.join(ROOT, 'workflows', file)).agents.developer;
  assert.ok(dev, `${file} has a developer agent`);
  const names = (dev.skills || []).map((s) => (typeof s === 'string' ? s : s.name || s.id)).filter((n) => n && !n.includes('{{'));
  const bodies = names.filter((n) => fs.existsSync(path.join(ROOT, 'skills', n, 'SKILL.md'))).map(skill);
  return flat([dev.system_prompt || '', ...bodies].join('\n'));
}

for (const file of ['software-development.yaml', 'software-development-local-hero.yaml', 'ai-development-local-hero.yaml']) {
  test(`#347 the developer of ${file} searches for an existing helper, constant or mapping before adding one, and names what it reused in its handoff`, () => {
    const text = developerGuidance(file);
    assert.match(text, /search[^.]*existing[^.]*(helper|constant|mapping)|existing (helper|constant|mapping)[^.]*before add/i);
    assert.match(text, /helper/i);
    assert.match(text, /mapping/i);
    assert.match(text, /handoff[^.]*reuse|reuse[^.]*handoff/i);
  });
}
