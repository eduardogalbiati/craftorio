// #300: skillPrompt keeps a role_sections section only for the agent it is addressed to, and a
// skill's `reads` lists the other skills' folders without injecting their text.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { resolveSkill, skillPrompt } = require('../domains/agents/skills');

function skillsDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'role-sections-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const write = (id, text) => {
    fs.mkdirSync(path.join(dir, id), { recursive: true });
    fs.writeFileSync(path.join(dir, id, 'SKILL.md'), text);
  };
  write('shared', '---\nname: shared\nrole_sections: [test_writer, developer]\n---\n# Shared\n\nIntro.\n\n## Common: for all\n\nAll.\n\n## Test writer: map first\n\nTW only.\n\n### Detail\n\nTW detail.\n\n## 2. Developer: build\n\nDev only.\n\n## Fix turns: findings\n\nAll again.\n');
  write('pair', '---\nname: pair\nrole_sections: [developer, evidence, ui_reviewer]\n---\n# Pair\n\n## Developer: plan\n\nDev only.\n\n## Evidence and UI reviewer: review\n\nReview pair.\n\n## Common: for all\n\nAll.\n');
  write('plain','---\nname: plain\n---\n## Test writer: kept\n\nNo role_sections.\n');
  write('rules-owner', '---\nname: rules-owner\n---\nRules.\n');
  write('reader', '---\nname: reader\nreads: [rules-owner, missing]\n---\nChecklist.\n');
  return dir;
}

test('skillPrompt (#300): a role section reaches only its agent; without a reader every section stays', (t) => {
  const dir = skillsDir(t);
  const shared = resolveSkill([dir], 'shared');
  const dev = skillPrompt(shared, 'developer');
  assert.match(dev, /Dev only/);
  assert.doesNotMatch(dev, /TW only|TW detail/, 'the test writer section and its subsections are dropped');
  assert.match(dev, /All\.[\s\S]*All again/, 'sections addressed to nobody stay');
  const writer = skillPrompt(shared, 'test_writer');
  assert.match(writer, /TW only[\s\S]*TW detail/);
  assert.doesNotMatch(writer, /Dev only/);
  assert.doesNotMatch(skillPrompt(shared, 'reviewer'), /TW only|Dev only/);
  assert.match(skillPrompt(shared), /TW only[\s\S]*Dev only/, 'no reader: the whole skill');
  assert.deepEqual([shared].map(skillPrompt), [skillPrompt(shared)], '.map(skillPrompt) passes an index, not a reader');
  assert.match(skillPrompt(resolveSkill([dir], 'plain'), 'developer'), /No role_sections/, 'without role_sections the heading is plain text');
});

test('skillPrompt (#387): an "A and B:" section reaches both agents and nobody else', (t) => {
  const pair = resolveSkill([skillsDir(t)], 'pair');
  for (const reader of ['evidence', 'ui_reviewer']) {
    const text = skillPrompt(pair, reader);
    assert.match(text, /Review pair/, reader);
    assert.doesNotMatch(text, /Dev only/, reader);
    assert.match(text, /All\./, reader);
  }
  const dev = skillPrompt(pair, 'developer');
  assert.match(dev, /Dev only/);
  assert.doesNotMatch(dev, /Review pair/);
  assert.doesNotMatch(skillPrompt(pair, 'reviewer'), /Review pair|Dev only/);
});

test('ui-conventions (#387): the evidence agent keeps its review section; the developer gets the plan, not the review', () => {
  const ui = resolveSkill([path.join(__dirname, '..', '..', '..', 'skills')], 'ui-conventions');
  const evidence = skillPrompt(ui, 'evidence');
  assert.match(evidence, /## Evidence/);
  assert.doesNotMatch(evidence, /plan before the markup/i);
  const dev = skillPrompt(ui, 'developer');
  assert.match(dev, /plan before the markup/i);
  assert.doesNotMatch(dev, /^## Evidence/m);
});

test('skillPrompt (#300): `reads` lists the folders of the skills it points to, not their text', (t) => {
  const dir = skillsDir(t);
  const reader = resolveSkill([dir], 'reader');
  assert.deepEqual(reader.reads, [{ name: 'rules-owner', path: path.join(dir, 'rules-owner') }], 'a missing skill is left out');
  const block = skillPrompt(reader, 'developer');
  assert.ok(block.includes(`- rules-owner: ${path.join(dir, 'rules-owner')}`));
  assert.doesNotMatch(block, /Rules\./);
});
