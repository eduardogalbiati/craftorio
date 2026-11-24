// stopServerTree (#853, processes.js): stops only the server under a root pid, never the root, and
// spares the root's direct children with protectChildren (a .cmd shim whose child is the CLI).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { byNewest, listProcesses, stopServerTree } = require('../engine/processes');

const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// a parent (the "CLI") that starts `node server.js next dev` and prints its pid
async function start(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sst-853-'));
  fs.writeFileSync(path.join(dir, 'server.js'), 'setInterval(() => {}, 1000);\n');
  fs.writeFileSync(path.join(dir, 'cli.js'), `const { spawn } = require('child_process');
const c = spawn(process.execPath, [process.argv[2], 'next', 'dev'], { stdio: 'ignore' });
process.stdout.write('server ' + c.pid + '\\n');
setInterval(() => {}, 1000);
`);
  const cli = spawn(process.execPath, [path.join(dir, 'cli.js'), path.join(dir, 'server.js')], { stdio: ['ignore', 'pipe', 'ignore'] });
  let out = '';
  cli.stdout.on('data', (b) => { out += b; });
  for (let i = 0; i < 250 && !/server \d+/.test(out); i++) await sleep(20);
  const server = Number(/server (\d+)/.exec(out)[1]);
  t.after(() => {
    for (const pid of [server, cli.pid]) if (alive(pid)) try { process.kill(pid, 'SIGKILL'); } catch { /* gone */ }
    fs.rmSync(dir, { recursive: true, force: true });
  });
  return { cli: cli.pid, server };
}

test('stops the matching descendant and leaves the root alone', { skip: process.platform === 'win32' }, async (t) => {
  const { cli, server } = await start(t);
  const res = await stopServerTree(cli, 'next dev');
  assert.equal(res.listed, true);
  assert.deepEqual(res.stopped.map((p) => p.pid), [server]);
  await sleep(100);
  assert.equal(alive(server), false);
  assert.equal(alive(cli), true);
});

test('protectChildren spares the root\'s direct children; nothing matching stops nothing', { skip: process.platform === 'win32' }, async (t) => {
  const { cli, server } = await start(t);
  assert.deepEqual((await stopServerTree(cli, 'next dev', { protectChildren: true })).stopped, []);
  assert.deepEqual((await stopServerTree(cli, 'cargo watch')).stopped, []);
  assert.equal(alive(server), true);
});

test('byNewest: the start time decides, whatever the pids; the pid only when a start is unknown or the same', () => {
  const first = (list) => [...list].sort(byNewest)[0].pid;
  assert.equal(first([{ pid: 9000, started: 10 }, { pid: 12, started: 20 }]), 12);
  assert.equal(first([{ pid: 12, started: 20 }, { pid: 9000, started: 10 }]), 12);
  assert.equal(first([{ pid: 12, started: 20 }, { pid: 13, started: 20 }]), 13);
  assert.equal(first([{ pid: 12, started: 20 }, { pid: 13, started: null }]), 13);
  assert.equal(first([{ pid: 12 }, { pid: 13 }]), 13);
});

test('listProcesses: a child started later has a later start', { skip: process.platform === 'darwin' && 'no start time on macOS' }, async (t) => {
  const { cli, server } = await start(t);
  const procs = await listProcesses();
  const of = (pid) => procs.find((p) => p.pid === pid);
  assert.ok(of(cli).started > 0 && of(server).started >= of(cli).started, JSON.stringify([of(cli), of(server)]));
});
