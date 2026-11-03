// #740: the CLI setup job of packages/engine/service/areas/cli-setup.js (createCliSetup), beyond the
// acceptance tests of cli-setup-740.test.js: which sign-ins run headless (only gh's device code; glab's
// web sign-in waits for a browser on the engine's machine, so it says what to run on the server), the
// time limit that stops a job left waiting, one job per CLI at a time, and the shell each platform runs the
// command in. The process is faked at its boundary (spawn); time with node:test's mock timers.
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('events');
const { PassThrough } = require('stream');

const { createCliSetup } = require('../../service/areas/cli-setup');

function fakeSpawn() {
  const calls = [];
  const children = [];
  const spawn = (file, args, options) => {
    calls.push({ file: String(file), args: (args || []).map(String), options: options || {} });
    const child = new EventEmitter();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.stdin = new PassThrough();
    child.killed = false;
    child.kill = () => { child.killed = true; return true; };
    children.push(child);
    return child;
  };
  return { spawn, calls, children };
}

function harness({ platform = 'win32' } = {}) {
  const proc = fakeSpawn();
  const events = [];
  const checks = [];
  const check = async (id) => { checks.push(id); return { id, path: null, connected: false }; };
  const emit = (event, payload) => events.push({ event, payload: JSON.parse(JSON.stringify(payload)) });
  const cliSetup = createCliSetup({ spawn: proc.spawn, check, emit, platform, cwd: () => '.' });
  return { cliSetup, proc, events, checks };
}

const settle = async (n = 20) => { for (let i = 0; i < n; i++) await new Promise((r) => setImmediate(r)); };
const lastChange = (events, jobId) => events.filter((e) => e.event === 'cli-setup:changed' && e.payload.jobId === jobId).map((e) => e.payload).at(-1) || null;

test('glab sign-in is not run headless: it answers manual with the command to run on the server', async () => {
  const { cliSetup, proc } = harness();
  const job = await cliSetup.start({ id: 'glab', action: 'login' });
  assert.equal(job.status, 'manual');
  assert.equal(job.command, 'glab auth login');
  assert.ok(job.message.includes('glab auth login'), `the message names the command: ${job.message}`);
  assert.equal(proc.calls.length, 0, 'nothing spawned');
});

test('a sign-in left waiting is stopped after its time limit (15 minutes): failed, killed and re-checked', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { cliSetup, proc, events, checks } = harness();
  const { jobId } = await cliSetup.start({ id: 'gh', action: 'login' });
  t.mock.timers.tick(14 * 60 * 1000);
  await settle();
  assert.equal(cliSetup.status({ jobId }).status, 'running', 'still running before the limit');
  t.mock.timers.tick(60 * 1000 + 1);
  await settle();
  const end = lastChange(events, jobId);
  assert.equal(end.status, 'failed');
  assert.ok(end.output.includes('took too long'), `the output says why: ${JSON.stringify(end.output)}`);
  assert.equal(proc.children[0].killed, true, 'the process is stopped');
  assert.deepEqual(checks, ['gh'], 're-checked once');
});

test('an install gets 30 minutes before it is stopped', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { cliSetup, events } = harness();
  const { jobId } = await cliSetup.start({ id: 'gh', action: 'install' });
  t.mock.timers.tick(29 * 60 * 1000);
  await settle();
  assert.equal(cliSetup.status({ jobId }).status, 'running');
  t.mock.timers.tick(60 * 1000 + 1);
  await settle();
  assert.equal(lastChange(events, jobId).status, 'failed');
});

test('a second start of the same CLI while its job runs answers that job and starts no other process', async () => {
  const { cliSetup, proc } = harness();
  const first = await cliSetup.start({ id: 'gh', action: 'install' });
  const second = await cliSetup.start({ id: 'gh', action: 'install' });
  assert.equal(second.jobId, first.jobId);
  assert.equal(second.status, 'running');
  assert.equal(proc.calls.length, 1, 'one process only');
});

test('once the job has ended, the same CLI can start a new one', async () => {
  const { cliSetup, proc, events } = harness();
  const first = await cliSetup.start({ id: 'gh', action: 'install' });
  proc.children[0].stdout.end();
  proc.children[0].stderr.end();
  proc.children[0].emit('close', 0, null);
  await settle();
  assert.equal(lastChange(events, first.jobId).status, 'done');
  const again = await cliSetup.start({ id: 'gh', action: 'install' });
  assert.notEqual(again.jobId, first.jobId);
  assert.equal(proc.calls.length, 2);
});

test('on Windows the command runs in cmd.exe /d /s /c, quoted verbatim, closing when it ends', async () => {
  const { cliSetup, proc } = harness({ platform: 'win32' });
  await cliSetup.start({ id: 'gh', action: 'install' });
  const call = proc.calls[0];
  assert.equal(call.file, 'cmd.exe');
  assert.deepEqual(call.args.slice(0, 3), ['/d', '/s', '/c']);
  assert.equal(call.args[3], '"winget install --id GitHub.cli -e"');
  assert.equal(call.options.windowsVerbatimArguments, true);
});

test('on POSIX the command runs in the SHELL of the environment with -c', async (t) => {
  const saved = process.env.SHELL;
  t.after(() => { if (saved === undefined) delete process.env.SHELL; else process.env.SHELL = saved; });
  process.env.SHELL = '/usr/bin/zsh';
  const { cliSetup, proc } = harness({ platform: 'linux' });
  await cliSetup.start({ id: 'gh', action: 'login' });
  const call = proc.calls[0];
  assert.equal(call.file, '/usr/bin/zsh');
  assert.equal(call.args[0], '-c');
  assert.ok(call.args[1].startsWith('gh auth login'), call.args[1]);
  assert.equal(call.options.windowsVerbatimArguments, undefined);
});

test('on POSIX without SHELL the command runs in /bin/sh -c', async (t) => {
  const saved = process.env.SHELL;
  t.after(() => { if (saved === undefined) delete process.env.SHELL; else process.env.SHELL = saved; });
  delete process.env.SHELL;
  const { cliSetup, proc } = harness({ platform: 'darwin' });
  await cliSetup.start({ id: 'gh', action: 'login' });
  assert.equal(proc.calls[0].file, '/bin/sh');
  assert.equal(proc.calls[0].args[0], '-c');
});
