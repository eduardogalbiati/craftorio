// #738 `wait.parent` (packages/engine/engine/run/transitions.js pollStep / pollParent): a split
// implementation's PR step waits for its parent PR/MR without the agent, then calls the agent once to
// rebase and open its PR/MR. The developer's own tests, on the engine's methods with a fake run.
const test = require('node:test');
const assert = require('node:assert/strict');

const { methods } = require('../engine/run/transitions');

function fakeRun(states) {
  const probes = [];
  const events = [];
  const run = {
    ...methods,
    ctx: { inputs: { parent_pr: 'https://github.com/acme/widgets/pull/7' }, worktree_dir: '' },
    probeStats: {},
    abort: new AbortController(),
    emitEvent: (type, data) => events.push({ type, ...data }),
    probe: async ({ probe, target }) => { probes.push({ probe, target }); return states.shift(); },
    loopWait: async (step) => step.id,
  };
  return { run, probes, events };
}

const step = { id: 'ci', wait: { parent: '{{inputs.parent_pr}}', probe: 'pr_checks', target: '{{output.pr_url}}' } };
const turn = () => ({ output: { pr_url: '' }, iteration: 1 });

test('#738 parent still open: polls again without the agent and restarts the /loop clock', async () => {
  const { run, probes, events } = fakeRun([{ state: 'pending', detail: 'checks running' }]);
  const st = { ...turn(), loopStartedAt: 1 };
  const next = await run.pollStep(step, st, Date.now());
  assert.equal(next, 'ci', 'the step polls again');
  assert.deepEqual(probes, [{ probe: 'pr_checks', target: 'https://github.com/acme/widgets/pull/7' }]);
  assert.ok(st.loopStartedAt > 1, 'the wait for the parent is not counted in max_duration');
  assert.equal(st.parentMerged, undefined);
  const ev = events.find((e) => e.type === 'step.probe');
  assert.equal(ev.probe, 'parent');
  assert.equal(ev.action, 'poll');
  assert.equal(run.probeStats.ci.polls, 1);
});

test('#738 parent merged: the agent is called once with the rebase news, then the own probe runs', async () => {
  const { run, probes } = fakeRun([{ state: 'merged', detail: 'merged' }, { state: 'pending', detail: 'checks running' }]);
  const st = turn();
  assert.equal(await run.pollStep(step, st, Date.now()), null, 'the agent turn runs');
  assert.equal(st.parentMerged, true);
  assert.match(st.probeNews.detail, /merged: rebase the branch/);
  st.output = { pr_url: 'https://github.com/acme/widgets/pull/9' };
  await run.pollStep(step, st, Date.now());
  assert.deepEqual(probes[1], { probe: 'pr_checks', target: 'https://github.com/acme/widgets/pull/9' }, 'the parent is not asked again');
});

test('#738 parent closed without merge: the agent is called and the parent stays unmerged', async () => {
  const { run } = fakeRun([{ state: 'closed', detail: 'closed' }]);
  const st = turn();
  assert.equal(await run.pollStep(step, st, Date.now()), null);
  assert.equal(st.parentMerged, undefined);
  assert.match(st.probeNews.detail, /closed/);
});

test('#738 no parent (an independent item): the step goes straight to its own probe', async () => {
  const { run, probes } = fakeRun([{ state: 'pending', detail: 'x' }]);
  run.ctx.inputs.parent_pr = '';
  const st = { output: { pr_url: 'https://github.com/acme/widgets/pull/9' }, iteration: 1 };
  await run.pollStep(step, st, Date.now());
  assert.deepEqual(probes, [{ probe: 'pr_checks', target: 'https://github.com/acme/widgets/pull/9' }]);
});
