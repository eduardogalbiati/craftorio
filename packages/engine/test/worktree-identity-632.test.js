// #632: identityArgs(repo, run) asks the given git runner (the onboarding's injected git) for user.email in the
// repository: none → a fallback identity for the commit (-c user.name / user.email), one → nothing added.
const test = require('node:test');
const assert = require('node:assert/strict');

const { identityArgs } = require('../engine/worktree');

test('#632 identityArgs adds nothing when the injected git knows user.email', async () => {
  const calls = [];
  const run = async (args, dir) => { calls.push({ args, dir }); return 'me@example.com'; };
  assert.deepEqual(await identityArgs('C:/ws/projects/field-notes', run), []);
  assert.deepEqual(calls, [{ args: ['config', 'user.email'], dir: 'C:/ws/projects/field-notes' }]);
});

for (const [label, answer] of [['null', null], ['an empty string', '']]) {
  test(`#632 identityArgs falls back to a fixed identity when the injected git answers ${label}`, async () => {
    const args = await identityArgs('C:/ws/projects/field-notes', async () => answer);
    assert.deepEqual(args, ['-c', 'user.name=Craftorio', '-c', 'user.email=orchestrator@localhost']);
  });
}
