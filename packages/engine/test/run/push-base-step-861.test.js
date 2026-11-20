// #861: `type: push_base` (push_main in Local mode), the engine's push of the local base after the
// local merge. The step is run on a plain run state with a fake machine adapter (a system boundary:
// git and the user's repository), as test/release-rounds-internals-324-325.test.js does for
// release_version. Never fails the run; its output keeps pushed / summary; a push that cannot go
// leaves a warning in the run's chat: the reason, then each command on a line of its own.
const test = require('node:test');
const assert = require('node:assert/strict');
const { WorkflowRun } = require('../../engine/workflow');

const STEP = { id: 'push_main', type: 'push_base' };

function state({ pushBase, merged = true } = {}) {
  const events = [];
  const calls = [];
  const s = {
    mock: false,
    machine: { simulated: false, pushBase: async (a) => { calls.push(a); return pushBase(a); } },
    worktree: { repo: '/ws/repos/finance-app', base: 'main' },
    ctx: merged ? { local_merge: { branch: 'feat/x', base: 'main', commit: 'abc' } } : {},
    emitEvent: (type, data) => events.push({ type, ...data }),
  };
  return { s, events, calls };
}
const run = (s) => WorkflowRun.prototype.runPushBaseStep.call(s, STEP);
const logs = (events) => events.filter((e) => e.type === 'log' && e.step_id === 'push_main').map((e) => [e.level, e.message]);

test('#861 push_base: a fast-forward of the user\'s folder ends pushed, with the count and the target in the summary and an info line', async () => {
  const { s, events, calls } = state({ pushBase: async () => ({ pushed: true, how: 'fast-forward', target: '/Users/r/finance-app', commits: [{ sha: '1' }, { sha: '2' }], issues: [861] }) });
  const out = await run(s);
  assert.deepEqual(calls, [{ repo: '/ws/repos/finance-app', base: 'main' }]);
  assert.equal(out.pushed, true);
  assert.equal(out.summary, 'Fast-forwarded 2 commits of main to /Users/r/finance-app.');
  assert.equal(out.target, '/Users/r/finance-app');
  assert.deepEqual(logs(events).map(([l]) => l), ['info']);
  assert.deepEqual(s.ctx.local_push && [s.ctx.local_push.pushed, s.ctx.local_push.target], [true, '/Users/r/finance-app']);
});

test('#861 push_base: a normal push says Pushed (singular for one commit)', async () => {
  const { s } = state({ pushBase: async () => ({ pushed: true, how: 'push', target: 'https://github.com/o/r.git', commits: [{ sha: '1' }] }) });
  const out = await run(s);
  assert.equal(out.summary, 'Pushed 1 commit of main to https://github.com/o/r.git.');
});

test('#861 push_base: uncommitted changes there end not pushed; the summary has each command once; the chat gets the reason then one warning per command', async () => {
  const commands = ['git -C "/Users/r/finance-app" fetch "/ws/repos/finance-app" main', 'git -C "/Users/r/finance-app" merge --ff-only FETCH_HEAD'];
  const reason = '/Users/r/finance-app has uncommitted changes on main: commit or stash them first. Nothing changed in /Users/r/finance-app.';
  const { s, events } = state({ pushBase: async () => ({ pushed: false, how: 'fast-forward', target: '/Users/r/finance-app', reason, commands, commits: [{ sha: '1' }] }) });
  const out = await run(s);
  assert.equal(out.pushed, false);
  assert.ok(out.summary.startsWith(reason), out.summary);
  for (const c of commands) assert.equal(out.summary.split(c).length - 1, 1, `the summary has "${c}" once`);
  assert.deepEqual(out.commands, commands);
  const lines = logs(events);
  assert.equal(lines.length, 3);
  assert.ok(lines.every(([l]) => l === 'warn'));
  assert.ok(lines[0][1].startsWith(reason), lines[0][1]);
  assert.deepEqual(lines.slice(1).map(([, m]) => m), commands);
  assert.deepEqual([s.ctx.local_push.pushed, s.ctx.local_push.target, s.ctx.local_push.reason], [false, '/Users/r/finance-app', reason]);
});

test('#861 push_base: a push refused by a remote origin ends not pushed with the reason, as before', async () => {
  const { s, events } = state({ pushBase: async () => ({ pushed: false, rejected: true, how: 'push', target: 'https://github.com/o/r.git', reason: 'origin/main moved: the push was rejected.', commits: [{ sha: '1' }] }) });
  const out = await run(s);
  assert.equal(out.pushed, false);
  assert.equal(out.rejected, true);
  assert.match(out.summary, /origin\/main moved/);
  assert.deepEqual(logs(events).map(([l]) => l), ['warn']);
});

test('#861 push_base: an error from git never fails the run: not pushed, merged locally, the reason in the summary', async () => {
  const { s, events } = state({ pushBase: async () => { throw new Error('fatal: could not read from remote\nmore'); } });
  const out = await run(s);
  assert.equal(out.pushed, false);
  assert.match(out.summary, /Could not push main: fatal: could not read from remote/);
  assert.equal(out.summary.includes('more'), false, 'only the first line of the error');
  assert.deepEqual(logs(events).map(([l]) => l), ['warn']);
});

test('#861 push_base: no local merge (a simulated run, or nothing merged): nothing is pushed and git is not called', async () => {
  const { s, calls } = state({ merged: false, pushBase: async () => ({ pushed: true }) });
  const out = await run(s);
  assert.equal(out.pushed, false);
  assert.equal(typeof out.summary, 'string');
  assert.match(out.summary, /Nothing pushed/);
  assert.equal(calls.length, 0);
});
