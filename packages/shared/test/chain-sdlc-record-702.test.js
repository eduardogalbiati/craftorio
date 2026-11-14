// #702: a Code & Build run whose issue names a work item's plan (`docs/work/<item>/plan.md`) chains
// sdlc-record by default; a failed or stopped run starts nothing, a run with no item chains nothing.
// The interface these tests assume, in packages/shared/chain-model.js (the service,
// packages/engine/service/areas/chain.js, applies it to a finished run without a `then` of its own):
// - defaultThen({ status, task, issues }) → a `then` ({ action: 'workflow', workflow: 'sdlc-record.yaml',
//   map: { run: '@run', evidence: 'evidence', merged_commit, pr_url, ... }, inputs: { item } }) or null.
//   `task`: the run's task text (its issues' bodies); `issues`: [{ number, title, body }]. The plan's
//   path is given in both here, so either source satisfies the tests.
const test = require('node:test');
const assert = require('node:assert/strict');

const load = () => require('@multiagent/shared/chain-model');

const BODY = 'Step two of the plan.\n\nPlan: `docs/work/write-doc/plan.md`, step 2.\n';
const run = (status, body = BODY) => ({ status, task: `Add the editor\n\n${body}`, issues: [{ number: 12, title: 'Add the editor', body }] });
const fileOf = (w) => String(w || '').split(/[\\/]/).pop();

test('#702 defaultThen: a successful run whose issue names docs/work/<item>/plan.md chains sdlc-record for that item', () => {
  const { defaultThen } = load();
  assert.equal(typeof defaultThen, 'function', 'chain-model exports defaultThen');
  const then = defaultThen(run('success'));
  assert.deepEqual(
    [then?.action, fileOf(then?.workflow), then?.inputs?.item],
    ['workflow', 'sdlc-record.yaml', 'write-doc'],
  );
});

test('#702 defaultThen: sdlc-record gets the run itself and its evidence output', () => {
  const { defaultThen, RUN_SOURCE } = load();
  assert.equal(typeof defaultThen, 'function', 'chain-model exports defaultThen');
  const then = defaultThen(run('success'));
  assert.deepEqual([then?.map?.run, then?.map?.evidence], [RUN_SOURCE, 'evidence']);
});

test('#702 defaultThen: a failed, stopped or cancelled run starts nothing', () => {
  const { defaultThen } = load();
  assert.equal(typeof defaultThen, 'function', 'chain-model exports defaultThen');
  for (const status of ['failed', 'stopped', 'cancelled']) assert.equal(defaultThen(run(status)), null, status);
});

test('#702 defaultThen: a run whose issue names no work item\'s plan chains nothing', () => {
  const { defaultThen } = load();
  assert.equal(typeof defaultThen, 'function', 'chain-model exports defaultThen');
  assert.equal(defaultThen(run('success', 'Fix the button.\n')), null, 'no docs/work path');
  assert.equal(defaultThen(run('success', 'See `docs/work/write-doc/spec.md`.\n')), null, 'a spec, not a plan');
});
