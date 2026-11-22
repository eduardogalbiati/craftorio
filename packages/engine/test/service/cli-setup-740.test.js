// #740 (acceptance tests, written before the code): installing or signing in a CLI (gh, glab, ...) runs on
// the ENGINE's machine from any client (the browser UI, the desktop app in remote mode), as a job whose
// output is streamed and which re-checks the CLI at the end.
//
// The contract these tests assume:
// - packages/engine/service/areas/cli-setup.js exports createCliSetup({ spawn, check, emit, platform }):
//     spawn(file, args, options) -> a ChildProcess-like object (child_process.spawn's signature: stdout /
//       stderr streams emitting 'data', 'exit' and 'close' with the exit code, kill()); the process boundary,
//       a fake here. The ctx wiring passes the real spawn and calls simulation.refuseReal before it, so an
//       injected spawn is never refused.
//     check(id) -> Promise<the CLI's row> (what env:details answers for that one CLI: { id, path, version,
//       connected, account, ... }); called once when the job's process has ended (the re-check).
//     emit(event, payload): every change of a job is pushed as emit('cli-setup:changed', job).
//     platform: the platform whose install commands apply (install-commands.js installCommands(platform)).
//   It returns { start({ id, action }), status({ jobId }) }:
//     start resolves at once (never waits for the process) with the job; action 'install' runs
//       installCommands(platform)[id], 'login' runs signInCommands()[id] (packages/engine/domains/machine/install-commands.js);
//       an unknown CLI id or action rejects with an Error (status 400, common.js clientError) naming it,
//       and nothing is spawned.
//     job = { jobId, id, action, status: 'running' | 'done' | 'failed' | 'manual', output (stdout and stderr
//       as one string, in order), tool (the re-check's row, once ended), deviceCode?, url?, command?, message? }
//     'done' on exit code 0, 'failed' otherwise (re-checked either way).
//     A sign-in that prints a device code and a URL (gh auth login: "! First copy your one-time code:
//       ABCD-1234", "Open this URL to continue in your web browser: https://github.com/login/device")
//       carries them as job.deviceCode and job.url while it runs, so the panel shows them.
//     A sign-in that cannot work headless (claude /login, an interactive TUI) is not spawned: start resolves
//       with status 'manual', command 'claude /login' and a message saying to run it on the server.
// - packages/engine/service/channels/cli-setup.js:
//     { channel: 'cli-setup:start', method: 'cliSetupStart', params: 'data' (or ['id', 'action']) }
//     { channel: 'cli-setup:status', method: 'cliSetupStatus', params: ['jobId'] }
//     { event: 'cli-setup:changed', method: 'onCliSetupChanged' }
//   behind the server's token like every channel (#479); the browser sees the job only through them.
//   (The channel sweep must skip cli-setup:start: it installs software on the machine.)
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { EventEmitter } = require('events');
const { PassThrough } = require('stream');

const loadArea = () => require('../../service/areas/cli-setup');

// ---- the process boundary: a fake spawn ----------------------------------------------------------------

function fakeSpawn() {
  const calls = [];
  const children = [];
  const spawn = (file, args, options) => {
    calls.push({ file: String(file), args: Array.isArray(args) ? args.map(String) : args == null ? [] : [String(args)], options });
    const child = new EventEmitter();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.stdin = new PassThrough();
    child.pid = 4242 + children.length;
    child.killed = false;
    child.kill = () => { child.killed = true; return true; };
    child.out = (text) => child.stdout.write(text);
    child.err = (text) => child.stderr.write(text);
    child.exit = (code) => {
      child.stdout.end();
      child.stderr.end();
      child.emit('exit', code, null);
      setImmediate(() => child.emit('close', code, null));
    };
    children.push(child);
    return child;
  };
  return { spawn, calls, children };
}

// the command line a spawn call ran, as one string (a shell's `-c <command>` or cmd.exe's `/s /c "<command>"`)
const commandLine = (call) => [call.file, ...call.args].join(' ');

const GH_ROW = { id: 'gh', name: 'GitHub CLI', path: 'C:/Program Files/GitHub CLI/gh.exe', version: 'gh version 2.60.0 (2024-10-01)', connected: false, auth: true };

function harness({ row = GH_ROW, platform = 'win32' } = {}) {
  const proc = fakeSpawn();
  const events = [];
  const checks = [];
  const check = async (id) => { checks.push(id); return JSON.parse(JSON.stringify(row)); };
  const emit = (event, payload) => events.push({ event, payload: JSON.parse(JSON.stringify(payload)) });
  const area = loadArea();
  assert.equal(typeof area.createCliSetup, 'function', 'cli-setup.js exports createCliSetup');
  const cliSetup = area.createCliSetup({ spawn: proc.spawn, check, emit, platform });
  return { cliSetup, proc, events, checks };
}

const settle = async (n = 10) => { for (let i = 0; i < n; i++) await new Promise((r) => setImmediate(r)); };
const changes = (events, jobId) => events.filter((e) => e.event === 'cli-setup:changed' && e.payload.jobId === jobId).map((e) => e.payload);
const lastChange = (events, jobId) => changes(events, jobId).at(-1) || null;

// waits (event-loop turns, no clock) until the job's last pushed state has one of these statuses
async function ended(events, jobId, max = 200) {
  for (let i = 0; i < max; i++) {
    const last = lastChange(events, jobId);
    if (last && ['done', 'failed'].includes(last.status)) return last;
    await new Promise((r) => setImmediate(r));
  }
  assert.fail(`job ${jobId} never ended: last state ${JSON.stringify(lastChange(events, jobId))}`);
}

// ---- the job --------------------------------------------------------------------------------------------

test('#740 install: runs the CLI\'s install command of the engine\'s platform and answers a running job at once', async () => {
  const { cliSetup, proc } = harness();
  const job = await cliSetup.start({ id: 'gh', action: 'install' });
  assert.equal(job.status, 'running');
  assert.equal(job.id, 'gh');
  assert.equal(job.action, 'install');
  assert.equal(typeof job.jobId, 'string');
  assert.notEqual(job.jobId, '');
  assert.equal(proc.calls.length, 1, 'one process started');
  assert.ok(commandLine(proc.calls[0]).includes('winget install --id GitHub.cli -e'), `the install command ran: ${commandLine(proc.calls[0])}`);
});

test('#740 install: the output is pushed while the process runs, in order, and the end carries the re-checked CLI', async () => {
  const { cliSetup, proc, events, checks } = harness({ row: { ...GH_ROW, connected: false } });
  const { jobId } = await cliSetup.start({ id: 'gh', action: 'install' });
  const child = proc.children[0];
  child.out('Found GitHub CLI [GitHub.cli] Version 2.60.0\n');
  await settle();
  const live = lastChange(events, jobId);
  assert.ok(live, 'a cli-setup:changed while the process runs');
  assert.equal(live.status, 'running');
  assert.ok(live.output.includes('Found GitHub CLI [GitHub.cli] Version 2.60.0'), 'the first line is pushed before the end');
  assert.deepEqual(checks, [], 'no re-check before the process ended');

  child.err('Downloading https://github.com/cli/cli/releases/download/v2.60.0/gh_2.60.0_windows_amd64.msi\n');
  child.out('Successfully installed\n');
  child.exit(0);
  const end = await ended(events, jobId);
  assert.equal(end.status, 'done');
  const a = end.output.indexOf('Found GitHub CLI');
  const b = end.output.indexOf('Downloading https://github.com/cli');
  const c = end.output.indexOf('Successfully installed');
  assert.ok(a >= 0 && b > a && c > b, `the output in the order it came: ${JSON.stringify(end.output)}`);
  assert.deepEqual(checks, ['gh'], 'the CLI is checked again once, at the end');
  assert.equal(end.tool.id, 'gh');
  assert.equal(end.tool.path, 'C:/Program Files/GitHub CLI/gh.exe');
  assert.equal(end.tool.version, 'gh version 2.60.0 (2024-10-01)');
  assert.equal(cliSetup.status({ jobId }).status, 'done', 'status() answers the same ended job');
});

test('#740 a command that fails ends the job as failed, still re-checked', async () => {
  const { cliSetup, proc, events, checks } = harness();
  const { jobId } = await cliSetup.start({ id: 'gh', action: 'install' });
  proc.children[0].err('No package found matching input criteria.\n');
  proc.children[0].exit(1);
  const end = await ended(events, jobId);
  assert.equal(end.status, 'failed');
  assert.ok(end.output.includes('No package found matching input criteria.'));
  assert.deepEqual(checks, ['gh']);
});

test('#740 an unknown CLI or action is refused (400, named) and nothing is spawned', async () => {
  const { cliSetup, proc } = harness();
  await assert.rejects(() => cliSetup.start({ id: 'nope-cli', action: 'install' }), (e) => {
    assert.match(e.message, /nope-cli/);
    assert.equal(e.status, 400);
    return true;
  });
  await assert.rejects(() => cliSetup.start({ id: 'gh', action: 'uninstall' }), (e) => {
    assert.match(e.message, /uninstall/);
    assert.equal(e.status, 400);
    return true;
  });
  assert.equal(proc.calls.length, 0);
});

test('#740 gh sign-in: the one-time code and the device URL it prints show in the job while it waits', async () => {
  const { cliSetup, proc, events } = harness({ row: { ...GH_ROW, connected: true, account: 'octocat' } });
  const { jobId } = await cliSetup.start({ id: 'gh', action: 'login' });
  assert.equal(proc.calls.length, 1);
  assert.ok(commandLine(proc.calls[0]).includes('gh auth login'), `the sign-in command ran: ${commandLine(proc.calls[0])}`);
  // gh writes these on stderr
  proc.children[0].err('! First copy your one-time code: ABCD-1234\n');
  proc.children[0].err('Open this URL to continue in your web browser: https://github.com/login/device\n');
  await settle();
  const waiting = lastChange(events, jobId);
  assert.equal(waiting.status, 'running');
  assert.equal(waiting.deviceCode, 'ABCD-1234');
  assert.equal(waiting.url, 'https://github.com/login/device');
  proc.children[0].out('✓ Logged in as octocat\n');
  proc.children[0].exit(0);
  const end = await ended(events, jobId);
  assert.equal(end.status, 'done');
  assert.equal(end.tool.connected, true);
  assert.equal(end.tool.account, 'octocat');
});

test('#740 a sign-in that cannot work headless (claude /login) is not run: it says what to run on the server', async () => {
  const { cliSetup, proc } = harness();
  const job = await cliSetup.start({ id: 'claude', action: 'login' });
  assert.equal(job.status, 'manual');
  assert.equal(job.command, 'claude /login');
  assert.equal(typeof job.message, 'string');
  assert.ok(job.message.includes('claude /login'), `the message names the command: ${job.message}`);
  assert.equal(proc.calls.length, 0, 'nothing spawned');
});

// ---- the channels, behind the server's token (#479) -----------------------------------------------------

const TOKEN = 'test-token-740-0123456789abcdef';

async function server(t) {
  const { setupWorkspace } = require('../../domains/workspace/workspace');
  const { createService } = require('../../service');
  const { createServer } = require('../../server');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cli-setup-740-'));
  process.env.CRAFTORIO_SIMULATION_ONLY = '1';
  const service = createService({ host: { trashItem: async () => {}, appVersion: '1.2.3', isPackaged: false } });
  service.setWorkspace(setupWorkspace(dir, { persist: false }));
  const srv = createServer({ service, token: TOKEN });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const port = srv.address().port;
  t.after(async () => {
    service.shutdown();
    await new Promise((r) => srv.close(r));
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });
  return port;
}

function request(port, { method = 'GET', path: p = '/', headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, method, path: p, headers: { Host: `127.0.0.1:${port}`, ...headers } }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, text: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject);
    if (body !== undefined) req.write(body);
    req.end();
  });
}

test('#740 the engine offers cli-setup:start, cli-setup:status and the cli-setup:changed event; a client without the token is refused (401)', async (t) => {
  const port = await server(t);
  const auth = { Authorization: `Bearer ${TOKEN}` };
  const manifest = JSON.parse((await request(port, { path: '/api/manifest', headers: auth })).text);
  const entries = manifest.result.map((e) => [e.channel || null, e.event || null, e.method || null]);
  assert.ok(entries.some(([c, , m]) => c === 'cli-setup:start' && m === 'cliSetupStart'), 'cli-setup:start (cliSetupStart) in the manifest');
  assert.ok(entries.some(([c, , m]) => c === 'cli-setup:status' && m === 'cliSetupStatus'), 'cli-setup:status (cliSetupStatus) in the manifest');
  assert.ok(entries.some(([, ev, m]) => ev === 'cli-setup:changed' && m === 'onCliSetupChanged'), 'the cli-setup:changed event (onCliSetupChanged) in the manifest');

  const body = JSON.stringify({ arg: { id: 'gh', action: 'install' } });
  const json = { 'Content-Type': 'application/json' };
  const anonymous = await request(port, { method: 'POST', path: '/api/cli-setup:start', headers: json, body });
  assert.equal(anonymous.status, 401, 'no token: refused before anything runs');
  const wrong = await request(port, { method: 'POST', path: '/api/cli-setup:start', headers: { ...json, Authorization: 'Bearer not-the-token' }, body });
  assert.equal(wrong.status, 401, 'a wrong token: refused');
});

test('#740 cli-setup:start over HTTP with the token refuses an unknown CLI with a 400 that names it', async (t) => {
  const port = await server(t);
  const res = await request(port, {
    method: 'POST', path: '/api/cli-setup:start',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify({ arg: { id: 'nope-cli', action: 'install' } }),
  });
  assert.equal(res.status, 400);
  assert.ok(res.text.includes('nope-cli'), `the answer names the CLI: ${res.text}`);
});
