// #79: a Remote or Fork + PR run checks it can push its branch before its first turn and fails at once with the
// fix (packages/engine/engine/run/checkout.js methods.checkPush, run from setupWorktree). No network: origin is
// a github.com URL whose pushes git redirects (url.<local>.pushInsteadOf) to a local bare repository, or to a
// folder that does not exist (a refused push). The run object is the checkout's view of it, as in
// test/worktree-fork-738.test.js.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { commit, git, scratch } = require('../worktree-helpers');

const checkout = () => require('../../engine/run/checkout');

const ORIGIN = 'https://github.com/acme/widgets.git';

// a clone with one commit on main; its pushes to github.com/acme go to `pushTo` (a bare repository or nowhere)
function clone(t, { pushTo, origin = ORIGIN }) {
  const tmp = scratch(t, 'canonical');
  const work = path.join(tmp, 'work');
  fs.mkdirSync(work);
  git(work, 'init', '-q');
  commit(work, 'a.txt', 'a\n', 'init');
  git(work, 'remote', 'add', 'origin', origin);
  const target = pushTo === 'bare' ? path.join(tmp, 'remote.git') : path.join(tmp, 'missing.git');
  if (pushTo === 'bare') git(tmp, 'init', '-q', '--bare', target);
  git(work, 'config', `url.${target.replace(/\\/g, '/')}/.pushInsteadOf`, 'https://github.com/acme/widgets.git');
  return work;
}

function fakeRun(workDir, mode, { simulated = false } = {}) {
  const events = [];
  return {
    wf: { orchestrator: { worktree: { repo: workDir, base: 'main', remote: "{{ inputs.mode != 'local' }}", fork: "{{ inputs.mode == 'fork' }}" } } },
    ctx: { inputs: { mode } },
    worktree: { workDir },
    machine: { simulated },
    emitEvent: (type, data) => events.push({ type, data }),
    events,
  };
}

const logText = (run) => run.events.filter((e) => e.type === 'log').map((e) => String(e.data?.message || '')).join('\n');

test('#79 a Remote run that cannot push fails before its first turn, saying the run cannot push its branch', async (t) => {
  const run = fakeRun(clone(t, { pushTo: 'nowhere' }), 'remote');
  await assert.rejects(checkout().methods.checkPush.call(run), /cannot push its branch/);
});

test('#79 a Fork + PR run that cannot push fails before its first turn too', async (t) => {
  const run = fakeRun(clone(t, { pushTo: 'nowhere' }), 'fork');
  await assert.rejects(checkout().methods.checkPush.call(run), /cannot push its branch/);
});

test('#79 a Remote run that can push goes on and logs that it can push', async (t) => {
  const run = fakeRun(clone(t, { pushTo: 'bare' }), 'remote');
  await checkout().methods.checkPush.call(run);
  assert.match(logText(run), /can push/);
});

test('#79 the push check never pushes the branch: the remote has no branch afterwards', async (t) => {
  const work = clone(t, { pushTo: 'bare' });
  await checkout().methods.checkPush.call(fakeRun(work, 'remote'));
  const bare = path.join(path.dirname(work), 'remote.git');
  assert.equal(git(bare, 'for-each-ref', '--format=%(refname)'), '');
});

test('#79 a Local run is not checked: it never pushes', async (t) => {
  const run = fakeRun(clone(t, { pushTo: 'nowhere' }), 'local');
  await checkout().methods.checkPush.call(run);
});

test('#79 a simulated run is not checked', async (t) => {
  const run = fakeRun(clone(t, { pushTo: 'nowhere' }), 'remote', { simulated: true });
  await checkout().methods.checkPush.call(run);
});

test('#79 an origin that is a local path is not checked (no remote URL to push to)', async (t) => {
  const tmp = scratch(t, 'canonical');
  const work = path.join(tmp, 'work');
  fs.mkdirSync(work);
  git(work, 'init', '-q');
  commit(work, 'a.txt', 'a\n', 'init');
  git(work, 'remote', 'add', 'origin', path.join(tmp, 'missing.git'));
  await checkout().methods.checkPush.call(fakeRun(work, 'remote'));
});

test('#79 the failure never shows the credentials an origin URL holds', async (t) => {
  const origin = 'https://x-access-token:s3cr3t-T0KEN@github.com/acme/widgets.git';
  const work = clone(t, { pushTo: 'nowhere', origin });
  const run = fakeRun(work, 'remote');
  // the redirect matches the URL with its credentials too
  git(work, 'config', '--unset-all', `url.${path.join(path.dirname(work), 'missing.git').replace(/\\/g, '/')}/.pushInsteadOf`);
  git(work, 'config', `url.${path.join(path.dirname(work), 'missing.git').replace(/\\/g, '/')}/.pushInsteadOf`, origin);
  let message = '';
  await checkout().methods.checkPush.call(run).catch((e) => { message = String(e?.message || e); });
  assert.match(message, /cannot push its branch/);
  assert.doesNotMatch(message, /s3cr3t-T0KEN/);
  assert.doesNotMatch(logText(run), /s3cr3t-T0KEN/);
});
