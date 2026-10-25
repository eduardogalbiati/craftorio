// #303: the develop turn of ai-development-local-hero ends at green acceptance tests and a commit.
// No self-review pass over the diff (code_review is the review), no review sub-agent inside the turn,
// no `npm run screenshot` by the developer (developer_screenshots captures), and the developer's own
// internal tests go into the implementation commit. Read from the workflow YAML and the bundled skills.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { loadWorkflow } = require('../engine/workflow');

const ROOT = path.join(__dirname, '..', '..', '..');
const WORKFLOW = path.join(ROOT, 'workflows', 'ai-development-local-hero.yaml');
const skill = (name) => fs.readFileSync(path.join(ROOT, 'skills', name, 'SKILL.md'), 'utf8');
// one "## ..." section of a skill, up to the next "## " heading
const section = (text, heading) => {
  const start = text.indexOf(`## ${heading}`);
  assert.ok(start >= 0, `the skill has a "## ${heading}" section`);
  const next = text.indexOf('\n## ', start + 3);
  return text.slice(start, next < 0 ? undefined : next);
};
const flat = (s) => s.replace(/\s+/g, ' ');

test('develop turn (#303): the develop prompt asks for no self-review pass over the branch diff', () => {
  const develop = loadWorkflow(WORKFLOW).steps.find((s) => s.id === 'develop');
  const prompt = flat(develop.prompt);
  assert.doesNotMatch(prompt, /Self-review \(#179\)/i, 'the self-review paragraph is gone');
  assert.doesNotMatch(prompt, /git diff [^\s`]+\.\.\.HEAD/, 'no reading of the branch diff against its base');
  assert.doesNotMatch(prompt, /Fix what you find with a new commit/i, 'no fix commit after a self-review');
  assert.doesNotMatch(prompt, /as the reviewer will/i, 'the developer does not review like the reviewer');
});

test('develop turn (#303): the turn still ends with the focused run-tests block and a commit', () => {
  const develop = loadWorkflow(WORKFLOW).steps.find((s) => s.id === 'develop');
  assert.match(develop.prompt, /```run-tests/, 'the focused test run of the acceptance tests stays');
  assert.match(develop.prompt, /never the whole suite/i);
  for (const field of ['branch', 'summary', 'files_changed', 'test_notes', 'committed', 'left_out']) {
    assert.ok(develop.output_schema.required.includes(field), `${field} is still required`);
  }
});

test('develop turn (#303): self_review is no longer a required output of develop', () => {
  const develop = loadWorkflow(WORKFLOW).steps.find((s) => s.id === 'develop');
  assert.equal(develop.output_schema.required.includes('self_review'), false, 'self_review dropped or optional');
});

test('code_review (#303): the reviewer prompt no longer reads a developer self-review; every skill a step names exists', () => {
  const wf = loadWorkflow(WORKFLOW);
  const review = wf.steps.find((s) => s.id === 'code_review');
  assert.ok(review, 'the code_review step stays');
  assert.doesNotMatch(JSON.stringify(review), /self_review/, 'no steps.develop.output.self_review in code_review');
  const named = [...wf.steps, ...Object.values(wf.agents)].flatMap((x) => x.skills || []).filter((s) => typeof s === 'string' && !s.includes('{'));
  const missing = [...new Set(named)].filter((s) => !fs.existsSync(path.join(ROOT, 'skills', s, 'SKILL.md')));
  assert.deepEqual(missing, [], 'the workflow names no removed skill (self-review)');
});

test('develop turn (#303): the developer is told the reviewer is the next step and never starts a sub-agent to review its diff', () => {
  const wf = loadWorkflow(WORKFLOW);
  const text = flat(`${wf.agents.developer.system_prompt}\n${wf.steps.find((s) => s.id === 'develop').prompt}`);
  assert.match(text, /review(er)? is the next step|next step (is|reviews)|code_review step reviews/i, 'the developer texts say the review is the next step');
  assert.match(text, /(never|not)[^.]*sub-agent[^.]*review|sub-agent[^.]*(never|not)[^.]*review/i, 'no review sub-agent inside the develop turn');
});

test('context-economy (#303): an exploration sub-agent maps the code, it never reviews the branch diff', () => {
  const text = flat(skill('context-economy'));
  assert.match(text, /(never|not)[^.]*review[^.]*(diff|branch)|sub-agent[^.]*never[^.]*review/i, 'the skill says a sub-agent is never a reviewer of the diff');
  assert.match(text, /review(er)? is the next step|next step[^.]*review/i, 'the skill says the review is the next step');
});

test('develop turn (#303): the developer lists the screenshots but never runs npm run screenshot itself', () => {
  const develop = loadWorkflow(WORKFLOW).steps.find((s) => s.id === 'develop');
  // the branch of the prompt for screenshots on (all/changed): between "{% else %}" and its endif
  const prompt = develop.prompt;
  const on = prompt.slice(prompt.indexOf("{% if inputs.screenshots == 'off' %}"));
  const onBranch = flat(on.slice(on.indexOf('{% else %}'), on.indexOf('In `left_out`')));
  assert.match(onBranch, /In `screenshots`, list the same UI states/, 'the screenshots list stays');
  assert.match(onBranch, /(never|do not|don't) (run|start)[^.]*`?npm run screenshot/i, 'the developer never runs the capture itself');
  assert.match(onBranch, /engine captures/i, 'the engine captures');
});

test('ui-conventions (#303): the developer section makes the demo data cover the change and leaves the capture to the engine', () => {
  const dev = flat(section(skill('ui-conventions'), 'Developer: build, log, plan the capture'));
  assert.match(dev, /demo data cover/i, 'the demo data still cover the change (that is code)');
  assert.match(dev, /(never|do not|don't) (run|start)[^.]*`?npm run screenshot/i, 'the developer never runs npm run screenshot');
});

test('develop turn (#303): the developer\'s own internal tests go into the implementation commit, not a pass after it', () => {
  const wf = loadWorkflow(WORKFLOW);
  const text = flat(`${wf.agents.developer.system_prompt}\n${wf.steps.find((s) => s.id === 'develop').prompt}`);
  assert.match(text, /(own|internal) tests[^.]*(implementation commit|same commit|with the code)/i, 'own tests are written with the code, in the implementation commit');
  assert.doesNotMatch(text, /after (the|your) commit[^.]*(own|internal) tests/i, 'no internal-tests pass after the commit');
});
