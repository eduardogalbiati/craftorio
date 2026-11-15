// #568: trigger rules (validation, matching, input templating). Acceptance tests, written before the code.
//
// Seam (the interface these tests assume), packages/engine/domains/triggers/triggers.js (CommonJS, pure):
//   TRIGGER_KINDS: ['issue_labeled', 'pr_comment', 'ci_failed']
//   validateTriggers(rules, { workflows }) -> { triggers, problems }
//     rules: the manifest's raw `triggers:` value (a list, or null/undefined: none).
//     workflows: [string], the names of the project's own workflows (the manifest's).
//     triggers: the valid rules, normalised to { on, workflow, inputs, label?, mention?, branch? }
//       (inputs {} when not declared), in the given order.
//     problems: [string], one per refused rule, naming `triggers[<index>]` and what is wrong (the
//       unknown `on`, the missing label/mention, the unknown workflow name). A refused rule is left out.
//     Refused: not a mapping; `on` not in TRIGGER_KINDS; issue_labeled without `label`; pr_comment
//       without `mention`; `workflow` missing or not in `workflows`. `triggers` not a list -> one problem.
//   matchEvent(rule, event) -> boolean
//     issue_labeled: event.kind === 'issue_labeled' && event.label === rule.label
//     pr_comment:    event.kind === 'pr_comment' && event.body contains rule.mention
//     ci_failed:     event.kind === 'ci_failed' && (no rule.branch || event.branch === rule.branch)
//   renderTriggerInputs(inputs, event) -> a new object (inputs not mutated): every string value, at any
//     depth (lists and mappings), has its `{{ event.<path> }}` placeholders replaced by the event's value.
//     A string that is exactly one placeholder takes the value as is (a number stays a number); a
//     placeholder inside a longer string is replaced by its text; an unknown path renders ''.
const test = require('node:test');
const assert = require('node:assert/strict');

const load = () => require('../../domains/triggers/triggers');

const WORKFLOWS = { workflows: ['software-development', 'fix'] };

test('#568 the three trigger kinds are the known ones', () => {
  assert.deepEqual([...load().TRIGGER_KINDS].sort(), ['ci_failed', 'issue_labeled', 'pr_comment']);
});

test('#568 valid rules of the three kinds are accepted with no problem', () => {
  const { triggers, problems } = load().validateTriggers([
    { on: 'issue_labeled', label: 'ready', workflow: 'software-development', inputs: { issues: ['{{ event.issue.number }}'] } },
    { on: 'pr_comment', mention: '@orchestrator', workflow: 'fix' },
    { on: 'ci_failed', branch: 'main', workflow: 'fix' },
  ], WORKFLOWS);
  assert.deepEqual(triggers.map((t) => `${t.on}>${t.workflow}`), ['issue_labeled>software-development', 'pr_comment>fix', 'ci_failed>fix']);
  assert.deepEqual(problems, []);
});

test('#568 a rule without inputs gets empty inputs', () => {
  const { triggers } = load().validateTriggers([{ on: 'ci_failed', branch: 'main', workflow: 'fix' }], WORKFLOWS);
  assert.deepEqual(triggers[0].inputs, {});
});

test('#568 a rule naming a workflow outside the project is a problem naming it, and is ignored', () => {
  const { triggers, problems } = load().validateTriggers([
    { on: 'ci_failed', branch: 'main', workflow: 'deploy-prod' },
    { on: 'ci_failed', branch: 'main', workflow: 'fix' },
  ], WORKFLOWS);
  assert.deepEqual(triggers.map((t) => t.workflow), ['fix']);
  assert.equal(problems.length, 1);
  assert.match(problems[0], /triggers\[0\]/);
  assert.match(problems[0], /deploy-prod/);
});

test('#568 a rule with an unknown `on` is a problem naming it, and is ignored', () => {
  const { triggers, problems } = load().validateTriggers([{ on: 'issue_opened', workflow: 'fix' }], WORKFLOWS);
  assert.equal(triggers.length, 0);
  assert.equal(problems.length, 1);
  assert.match(problems[0], /issue_opened/);
});

test('#568 an issue_labeled rule without a label is a problem, and is ignored', () => {
  const { triggers, problems } = load().validateTriggers([{ on: 'issue_labeled', workflow: 'fix' }], WORKFLOWS);
  assert.deepEqual([triggers.length, problems.length], [0, 1]);
  assert.match(problems[0], /label/);
});

test('#568 a pr_comment rule without a mention is a problem, and is ignored', () => {
  const { triggers, problems } = load().validateTriggers([{ on: 'pr_comment', workflow: 'fix' }], WORKFLOWS);
  assert.deepEqual([triggers.length, problems.length], [0, 1]);
  assert.match(problems[0], /mention/);
});

test('#568 a rule without a workflow is a problem, and is ignored', () => {
  const { triggers, problems } = load().validateTriggers([{ on: 'ci_failed', branch: 'main' }], WORKFLOWS);
  assert.deepEqual([triggers.length, problems.length], [0, 1]);
});

test('#568 no triggers at all is no rule and no problem', () => {
  const { triggers, problems } = load().validateTriggers(undefined, WORKFLOWS);
  assert.deepEqual([triggers, problems], [[], []]);
});

test('#568 triggers that are not a list are one problem and no rule', () => {
  const { triggers, problems } = load().validateTriggers({ on: 'ci_failed', workflow: 'fix' }, WORKFLOWS);
  assert.deepEqual([triggers.length, problems.length], [0, 1]);
});

test('#568 an issue_labeled rule matches an event with its label', () => {
  const rule = { on: 'issue_labeled', label: 'ready', workflow: 'fix', inputs: {} };
  assert.equal(load().matchEvent(rule, { kind: 'issue_labeled', id: 'e1', url: 'u', label: 'ready', issue: { number: 42 } }), true);
});

test('#568 an issue_labeled rule does not match another label', () => {
  const rule = { on: 'issue_labeled', label: 'ready', workflow: 'fix', inputs: {} };
  assert.equal(load().matchEvent(rule, { kind: 'issue_labeled', id: 'e1', url: 'u', label: 'bug', issue: { number: 42 } }), false);
});

test('#568 a pr_comment rule matches a comment containing the mention', () => {
  const rule = { on: 'pr_comment', mention: '@orchestrator', workflow: 'fix', inputs: {} };
  assert.equal(load().matchEvent(rule, { kind: 'pr_comment', id: 'c1', url: 'u', body: 'please @orchestrator fix the lint', pr: { number: 7 } }), true);
});

test('#568 a pr_comment rule does not match a comment without the mention', () => {
  const rule = { on: 'pr_comment', mention: '@orchestrator', workflow: 'fix', inputs: {} };
  assert.equal(load().matchEvent(rule, { kind: 'pr_comment', id: 'c1', url: 'u', body: 'looks good to me', pr: { number: 7 } }), false);
});

test('#568 a ci_failed rule on main matches a failure on main', () => {
  const rule = { on: 'ci_failed', branch: 'main', workflow: 'fix', inputs: {} };
  assert.equal(load().matchEvent(rule, { kind: 'ci_failed', id: 'r1', url: 'u', branch: 'main' }), true);
});

test('#568 a ci_failed rule on main does not match a failure on another branch', () => {
  const rule = { on: 'ci_failed', branch: 'main', workflow: 'fix', inputs: {} };
  assert.equal(load().matchEvent(rule, { kind: 'ci_failed', id: 'r1', url: 'u', branch: 'feature/x' }), false);
});

test('#568 a rule never matches an event of another kind', () => {
  const rule = { on: 'ci_failed', branch: 'main', workflow: 'fix', inputs: {} };
  assert.equal(load().matchEvent(rule, { kind: 'issue_labeled', id: 'e1', url: 'u', label: 'ready', branch: 'main' }), false);
});

test('#568 `{{ event.issue.number }}` alone in a string renders to the event\'s number', () => {
  const out = load().renderTriggerInputs({ issues: ['{{ event.issue.number }}'] }, { kind: 'issue_labeled', issue: { number: 42 } });
  assert.equal(out.issues[0], 42);
});

test('#568 a placeholder inside a longer string renders as text', () => {
  const out = load().renderTriggerInputs({ task: 'Fix CI on {{ event.branch }} ({{event.url}})' }, { kind: 'ci_failed', branch: 'main', url: 'https://x/run/1' });
  assert.equal(out.task, 'Fix CI on main (https://x/run/1)');
});

test('#568 a placeholder with an unknown path renders empty', () => {
  const out = load().renderTriggerInputs({ task: 'see {{ event.nope.deep }}!' }, { kind: 'ci_failed' });
  assert.equal(out.task, 'see !');
});

test('#568 values that are not placeholders are kept and the rule\'s inputs are not changed', () => {
  const inputs = { mode: 'remote', depth: 2, issues: ['{{ event.issue.number }}'] };
  const out = load().renderTriggerInputs(inputs, { issue: { number: 5 } });
  assert.deepEqual([out.mode, out.depth, out.issues[0]], ['remote', 2, 5]);
  assert.equal(inputs.issues[0], '{{ event.issue.number }}');
});
