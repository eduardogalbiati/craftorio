// #756: the developer self-reviews before handing over: the reuse pass and the issue's tasks.
// Acceptance tests written before the code. A new skill, skills/developer-self-review, is added to
// the developer agent of feature, refactor, release, test-backfill and the AI Development local hero:
// - the reuse pass: for every new function, constant, mapping table or rule of its diff, search the
//   repository and reuse; the summary carries the same "reuse pass" line the reviewer writes;
// - the issue's tasks one by one (Docs and Tests included), each with the file(s) of the diff that
//   answer it; a task with no file goes to `left_out` with its reason, never "done";
// - the reuse pass is written once under skills/ and reaches both the developer and the reviewer;
// - it costs a few hundred tokens at most (the develop prompt's 40K bound stays in
//   test/slow/develop-prompt-300.slow.test.js).
// Read from the bundled skills and workflow YAML, through the engine's skill loader.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { loadWorkflow } = require('../engine/workflow');
const { ROOT, SKILLS, flat, reusePassSections, expandSkills, skillsPrompt, reaches } = require('./reuse-pass-text');

const SKILL = 'developer-self-review';
const WORKFLOWS = [
  'workflows/feature.yaml',
  'workflows/refactor.yaml',
  'workflows/release.yaml',
  'workflows/test-backfill.yaml',
  '.multiagent/workflows/ai-development-local-hero.yaml',
];

const developerSkills = (file) => {
  const dev = loadWorkflow(path.join(ROOT, ...file.split('/'))).agents?.developer;
  assert.ok(dev, `${file} has a developer agent`);
  return (dev.skills || []).map((s) => (typeof s === 'string' ? s : s.name || s.id)).filter((n) => n && !n.includes('{{'));
};

// What the self-review skill puts in the developer's prompt (with what it pulls through `uses:`).
const selfReviewText = () => {
  assert.ok(fs.existsSync(path.join(SKILLS, SKILL, 'SKILL.md')), `skills/${SKILL}/SKILL.md exists`);
  return skillsPrompt([SKILL], 'developer');
};

for (const file of WORKFLOWS) {
  test(`#756 the developer of ${file} carries the ${SKILL} skill`, () => {
    assert.ok(developerSkills(file).includes(SKILL), `${file}: agents.developer.skills names ${SKILL} (has: ${developerSkills(file).join(', ')})`);
  });
}

test('#756 the self-review skill is a bundled skill with a name and a description', () => {
  assert.ok(fs.existsSync(path.join(SKILLS, SKILL, 'SKILL.md')), `skills/${SKILL}/SKILL.md exists`);
  const { resolveSkill } = require('../domains/agents/skills');
  const skill = resolveSkill([SKILLS], SKILL);
  assert.equal(skill.name, SKILL);
  assert.ok(String(skill.meta?.description || '').trim().length > 0, 'the skill has a description');
});

test('#756 the self-review runs before the developer hands over (its last message)', () => {
  assert.match(flat(selfReviewText()), /before (your|its|the) (last|final) message|before (you hand|handing) over/i);
});

test('#756 the reuse pass is written once under skills/', () => {
  assert.ok(fs.existsSync(path.join(SKILLS, SKILL, 'SKILL.md')), `skills/${SKILL}/SKILL.md exists`);
  const sections = reusePassSections();
  assert.equal(sections.length, 1, `one reuse pass section under skills/ (found: ${sections.map((s) => `${s.rel} "${s.heading}"`).join('; ') || 'none'})`);
});

test('#756 the one reuse pass text reaches both the developer (self-review) and the reviewer (code-review)', () => {
  const [section] = reusePassSections();
  assert.ok(section, 'a reuse pass section exists under skills/');
  assert.ok(reaches(selfReviewText(), section), `the developer's self-review carries or points to ${section.rel}`);
  assert.ok(reaches(skillsPrompt(['code-review'], 'reviewer'), section), `the reviewer's code-review carries or points to ${section.rel}`);
});

test('#756 the self-review reuse pass covers every new function, constant, mapping table or rule of the diff, and reuses what it finds', () => {
  const [section] = reusePassSections();
  const text = flat(`${selfReviewText()}\n${section ? section.body : ''}`);
  for (const word of [/function/i, /constant/i, /mapping table/i, /\brule\b/i, /search/i, /\breuse\b/i, /\bdiff\b/i]) {
    assert.match(text, word);
  }
});

test('#756 the developer\'s summary lists what the reuse pass searched and reused (the reviewer\'s "reuse pass" line)', () => {
  const own = flat(selfReviewText());
  assert.match(own, /summary[^.]*reuse pass|reuse pass[^.]*summary/i, 'the self-review asks for the reuse pass line in the summary');
  assert.match(own, /search(ed)?[^.]*reused|reused[^.]*search(ed)?/i, 'the line names what was searched and what was reused');
});

test('#756 the self-review lists each task of the issue, Docs and Tests included, with the file(s) of the diff that answer it', () => {
  const own = flat(selfReviewText());
  assert.match(own, /each task|every task|task (list|by task)|one by one/i);
  assert.match(own, /\bDocs\b/);
  assert.match(own, /\bTests\b/);
  assert.match(own, /file[^.]*diff|diff[^.]*file/i);
});

test('#756 a task with no file in the diff goes to left_out with its reason, never "done", and the summary never claims it', () => {
  const own = flat(selfReviewText());
  assert.match(own, /`?left_out`?/);
  assert.match(own, /left_out`?[^.]*reason|reason[^.]*`?left_out/i);
  assert.match(own, /never[^.]*(done|claim)/i);
  assert.match(own, /summary[^.]*(never|not)[^.]*claim|(never|not)[^.]*claim[^.]*summary/i);
});

test('#756 the self-review adds a few hundred tokens at most to the develop prompt', () => {
  selfReviewText();
  // only what the developer did not already load: the self-review and the skills it pulls in
  const before = new Set(expandSkills(developerSkills('workflows/feature.yaml').filter((n) => n !== SKILL)).map((s) => s.name));
  const { skillPrompt } = require('../domains/agents/skills');
  const added = expandSkills([SKILL]).filter((s) => !before.has(s.name)).map((s) => skillPrompt(s, 'developer')).join('\n');
  // ~4 characters a token: 3600 characters is about 900 tokens
  assert.ok(added.length <= 3600, `the self-review adds ${added.length} characters to the develop prompt (bound 3600)`);
});

test('#756 the developer does not receive the whole code-review skill', () => {
  for (const file of WORKFLOWS) {
    const names = expandSkills(developerSkills(file)).map((s) => s.name);
    assert.ok(!names.includes('code-review'), `${file}: the developer's skills do not bring code-review (got: ${names.join(', ')})`);
  }
});
