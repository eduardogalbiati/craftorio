// #124 acceptance tests (written before the code): the run-supervisor skill and the docs state which
// answers the supervisor on call may take alone at an escalation gate: only the gate's recommended
// answer, or one that merges and pushes nothing (stop, retry); any other answer opens the gate for the
// owner; "the failures are pre-existing" counts only when the engine itself confirmed them on the base
// (#211), never on another agent's report.
// Text checks, not prose: each file's relevant bullet or paragraph is matched with loose patterns.
// - skills/run-supervisor/SKILL.md: a bullet of its "On call" section;
// - docs/agents/engine/gates-and-run-end.md and docs/12-factor-agents/factor-07-contact-humans-with-tool-calls.md:
//   a paragraph or bullet citing #124 (as other doc tests find theirs, e.g. worktrees-doc-403.test.js).
// The engine behaviour is tested in packages/engine/test/supervisor/supervisor-safe-gate-124.test.js.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const read = (...p) => fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8');
// the bullets and paragraphs of a Markdown text (a bullet's wrapped lines stay together)
const blocks = (text) => text.split(/\r?\n\s*\r?\n|\r?\n(?=\s*- )/).map((b) => b.replace(/\s+/g, ' ').trim()).filter(Boolean);

const RECOMMENDED = /recommend(ed|s|ation)?\b/i;
const MERGE_PUSH = /\bmerges?\b[^.]*\bpush|\bpush(es)?\b[^.]*\bmerge/i;
const PREEXISTING = /pre-?existing/i;
const BASE_BY_ENGINE = /\bbase\b/i;
const NOT_A_REPORT = /\b(engine|confirm(ed|s)?|#211)\b/i;
const AGENT_CLAIM = /\b(agent|report|claim)/i;

function onCallSection() {
  const skill = read('skills', 'run-supervisor', 'SKILL.md');
  const m = /## On call[^\n]*\n([\s\S]*?)(?=\n## |$)/.exec(skill);
  assert.ok(m, 'the skill has its "On call" section');
  return m[1];
}

test('#124 run-supervisor skill: routing a gate alone is limited to the recommended answer or one that merges and pushes nothing', () => {
  const route = blocks(onCallSection()).filter((b) => /`route`|\balone\b|by yourself|yourself/i.test(b));
  assert.ok(route.length, 'the On call section says when you route a gate yourself');
  const rule = route.find((b) => RECOMMENDED.test(b) && MERGE_PUSH.test(b));
  assert.ok(rule, `one bullet names the recommended answer and answers that merge or push: ${route.join(' | ').slice(0, 600)}`);
  assert.match(rule, /\b(owner|person)\b|gate opens|open(s)? the gate/i, 'it says any other answer goes to the owner');
});

test('#124 run-supervisor skill: "pre-existing" failures count only when the engine confirmed them on the base, not another agent\'s report', () => {
  const pre = blocks(onCallSection()).find((b) => PREEXISTING.test(b));
  assert.ok(pre, 'the On call section speaks of pre-existing failures');
  assert.match(pre, BASE_BY_ENGINE);
  assert.match(pre, NOT_A_REPORT);
  assert.match(pre, AGENT_CLAIM, 'it says another agent\'s word is not enough');
});

for (const [name, file] of [
  ['docs/agents/engine/gates-and-run-end.md', ['docs', 'agents', 'engine', 'gates-and-run-end.md']],
  ['docs/12-factor-agents/factor-07-contact-humans-with-tool-calls.md', ['docs', '12-factor-agents', 'factor-07-contact-humans-with-tool-calls.md']],
]) {
  test(`#124 ${name} says which answers the supervisor on call may take alone`, () => {
    const cited = blocks(read(...file)).filter((b) => /#124\b/.test(b));
    assert.ok(cited.length, `a paragraph or bullet of ${name} cites #124`);
    const text = cited.join(' ');
    assert.match(text, /supervisor/i);
    assert.match(text, RECOMMENDED, 'the recommended answer');
    assert.match(text, /\bmerge|\bpush/i, 'answers that merge or push are the owner\'s');
    assert.match(text, PREEXISTING, 'pre-existing failures');
    assert.match(text, BASE_BY_ENGINE, 'confirmed on the base');
  });
}
