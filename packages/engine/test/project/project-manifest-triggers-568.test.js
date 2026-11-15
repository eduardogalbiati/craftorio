// #568: the manifest's `triggers:` list (.multiagent/project.yaml). Acceptance tests, written before the code.
//
// Seam (the interface these tests assume):
//   const { parseManifest } = require('../../domains/project/project-manifest');
//   parseManifest(text) -> { ...as today, triggers, triggerErrors }
//     triggers: the valid rules, each { on, workflow, inputs, label?, mention?, branch? } (inputs {} when
//       not declared), validated by packages/engine/domains/triggers/triggers.js validateTriggers against
//       the names of the manifest's own `workflows` (a trigger never names another workflow).
//     triggerErrors: [string], one per refused rule (unknown `on`, issue_labeled without a label,
//       pr_comment without a mention, a workflow not in the manifest); that rule is left out of `triggers`.
//     A refused trigger does NOT void the manifest: workflows, default and kinds stay as without it,
//       and `errors` is unchanged. A manifest voided by its own errors has no triggers either.
//     No `triggers:` key -> triggers: [], triggerErrors: [].
const test = require('node:test');
const assert = require('node:assert/strict');

const load = () => require('../../domains/project/project-manifest');

const WORKFLOWS = `version: 1
workflows:
  - name: software-development
    category: team
  - name: fix
    category: solo
`;

test('#568 a manifest without triggers reads an empty triggers list and no trigger error', () => {
  const out = load().parseManifest(WORKFLOWS);
  assert.deepEqual([out.triggers, out.triggerErrors], [[], []]);
});

test('#568 a manifest\'s three trigger kinds are read, in order, with no error', () => {
  const out = load().parseManifest(`${WORKFLOWS}triggers:
  - on: issue_labeled
    label: ready
    workflow: software-development
    inputs:
      issues: ["{{ event.issue.number }}"]
  - on: pr_comment
    mention: "@orchestrator"
    workflow: fix
  - on: ci_failed
    branch: main
    workflow: fix
`);
  assert.deepEqual(out.triggers.map((t) => t.on), ['issue_labeled', 'pr_comment', 'ci_failed']);
  assert.deepEqual(out.triggers.map((t) => t.workflow), ['software-development', 'fix', 'fix']);
  assert.equal(out.triggers[0].label, 'ready');
  assert.equal(out.triggers[0].inputs.issues[0], '{{ event.issue.number }}');
  assert.equal(out.triggers[1].mention, '@orchestrator');
  assert.equal(out.triggers[2].branch, 'main');
  assert.deepEqual([out.errors, out.triggerErrors], [[], []]);
});

test('#568 a trigger naming a workflow outside the manifest is a trigger error naming it, and is ignored', () => {
  const out = load().parseManifest(`${WORKFLOWS}triggers:
  - on: issue_labeled
    label: ready
    workflow: release-everything
  - on: ci_failed
    branch: main
    workflow: fix
`);
  assert.deepEqual(out.triggers.map((t) => t.workflow), ['fix']);
  assert.equal(out.triggerErrors.length, 1);
  assert.match(out.triggerErrors[0], /release-everything/);
});

test('#568 a refused trigger leaves the manifest\'s workflows and errors as without it', () => {
  const out = load().parseManifest(`${WORKFLOWS}triggers:
  - on: issue_opened
    workflow: fix
`);
  assert.deepEqual(out.workflows.map((w) => w.name), ['software-development', 'fix']);
  assert.deepEqual(out.errors, []);
  assert.equal(out.triggers.length, 0);
  assert.equal(out.triggerErrors.length, 1);
});

test('#568 an issue_labeled trigger without a label is a trigger error and is ignored', () => {
  const out = load().parseManifest(`${WORKFLOWS}triggers:
  - on: issue_labeled
    workflow: fix
`);
  assert.deepEqual([out.triggers.length, out.triggerErrors.length], [0, 1]);
});

test('#568 a manifest voided by its own errors declares no triggers', () => {
  const out = load().parseManifest(`version: 1
workflows:
  - category: solo
triggers:
  - on: ci_failed
    branch: main
    workflow: fix
`);
  assert.ok(out.errors.length > 0);
  assert.equal(out.triggers.length, 0);
});
