// The control channel's Rust client multiagent-ctl (#342; scripts/ctl.js stays for dev checkouts),
// built here once with `cargo build --release -p multiagent-ctl` and run against a real control channel
// (src/control/index.js over a simulation service in a temp workspace, opened as
// test/control-channel-336.test.js does). Without cargo its cases are skipped with one line; CI (CI set)
// never skips them, and a failed build fails them with cargo's message.
//   multiagent-ctl <channel> [json-argument] [--workspace <dir>]   (else MULTIAGENT_WORKSPACE)
//   multiagent-ctl --list                                           (the allowlist with argument schemas)
// Exit codes: 0 the JSON result printed; 1 a refused or failed call (reason on stderr); 2 no
// <workspace>/control/endpoint.json (the switch is off); 3 the app's contract version differs.
// Assumed: the client first calls `GET /api/version` (Bearer token) and the app answers
// `{ "version": "<string>" }`; a stub endpoint on 127.0.0.1 answering `{ "version": "0-mismatch" }` must
// give exit 3 before any channel is called. --list runs here with the app's endpoint open (it may read
// the schemas from the app or carry them). The last test is JS-side and needs no cargo: the real
// control channel answers that version route.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { execFile, spawnSync } = require('child_process');
const { makeService } = require('./service/helpers');

const ROOT = path.join(__dirname, '..');
const NATIVE = path.join(ROOT, 'native');
const BINARY_NAME = process.platform === 'win32' ? 'multiagent-ctl.exe' : 'multiagent-ctl';
const BINARY = path.join(process.env.CARGO_TARGET_DIR || path.join(NATIVE, 'target'), 'release', BINARY_NAME);

const hasCargo = () => spawnSync('cargo', ['--version'], { stdio: 'ignore' }).status === 0;
const SKIP = !process.env.CI && !hasCargo() ? 'cargo is not installed: multiagent-ctl\'s cases are skipped (CI runs them)' : false;

let built = null;
function binary() {
  if (!built) {
    const r = spawnSync('cargo', ['build', '--release', '--manifest-path', path.join(NATIVE, 'Cargo.toml'), '-p', 'multiagent-ctl'], {
      encoding: 'utf8', timeout: 9 * 60 * 1000,
    });
    if (r.status !== 0) built = { error: `cargo build of multiagent-ctl failed: ${(r.stderr || r.error?.message || '').slice(-1500)}` };
    else if (!fs.existsSync(BINARY)) built = { error: `cargo built multiagent-ctl but ${BINARY} does not exist` };
    else built = { file: BINARY };
  }
  if (built.error) throw new Error(built.error);
  return built.file;
}

// Runs the client asynchronously (the endpoint is served by this very process): { code, stdout, stderr }.
function ctl(args, env) {
  const file = binary();
  return new Promise((resolve) => {
    execFile(file, args, { env, timeout: 30000, encoding: 'utf8' }, (error, stdout, stderr) => {
      resolve({ code: error ? (typeof error.code === 'number' ? error.code : -1) : 0, stdout, stderr });
    });
  });
}

const envFor = (ws) => ({ ...process.env, MULTIAGENT_WORKSPACE: ws });

async function openChannel(t, service) {
  const { createControlChannel } = require('../src/control');
  const control = createControlChannel({ service });
  t.after(() => control.stop());
  service.api['settings:set']({ controlChannel: true });
  await control.update();
  return JSON.parse(fs.readFileSync(path.join(service.workspace().root, 'control', 'endpoint.json'), 'utf8'));
}

const resultOf = (stdout) => {
  const printed = JSON.parse(stdout);
  return printed && typeof printed === 'object' && Object.hasOwn(printed, 'result') ? printed.result : printed;
};

test('#342 multiagent-ctl: an allowed channel exits 0 and prints its JSON result', { skip: SKIP }, async (t) => {
  const { service } = makeService(t);
  await openChannel(t, service);
  const r = await ctl(['settings:get'], envFor(service.workspace().root));
  assert.equal(r.code, 0, r.stderr);
  assert.equal(resultOf(r.stdout).controlChannel, true);
});

test('#342 multiagent-ctl: a JSON argument is sent as { arg }', { skip: SKIP }, async (t) => {
  const { service, api } = makeService(t);
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'ctl-project-342-'));
  t.after(() => fs.rmSync(folder, { recursive: true, force: true }));
  const p = await api['projects:create']({ name: 'demo', folder });
  await openChannel(t, service);
  const r = await ctl(['roadmap:get', JSON.stringify({ projectId: p.id })], envFor(service.workspace().root));
  assert.equal(r.code, 0, r.stderr);
  const roadmap = resultOf(r.stdout);
  assert.equal(roadmap !== null && typeof roadmap === 'object', true, 'the project\'s roadmap');
});

test('#342 multiagent-ctl: a channel outside the allowlist exits 1 with the reason on stderr', { skip: SKIP }, async (t) => {
  const { service } = makeService(t);
  await openChannel(t, service);
  const r = await ctl(['approval:resolve', '{"runId":"r","id":"g","answer":true}'], envFor(service.workspace().root));
  assert.equal(r.code, 1);
  assert.match(r.stderr, /approval:resolve/);
});

test('#342 multiagent-ctl: no endpoint.json (the switch is off) exits 2 naming the endpoint', { skip: SKIP }, async (t) => {
  const { service } = makeService(t);
  const r = await ctl(['settings:get'], envFor(service.workspace().root));
  assert.equal(r.code, 2);
  assert.match(r.stderr, /endpoint/i);
});

test('#342 multiagent-ctl: another contract version (GET /api/version) exits 3 before calling the channel', { skip: SKIP }, async (t) => {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'ctl-ws-342-'));
  t.after(() => fs.rmSync(ws, { recursive: true, force: true }));
  const posts = [];
  const server = http.createServer((req, res) => {
    req.resume();
    if (req.method === 'GET' && req.url === '/api/version') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ version: '0-mismatch' }));
      return;
    }
    posts.push(`${req.method} ${req.url}`);
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ result: 'should not be called' }));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  fs.mkdirSync(path.join(ws, 'control'));
  fs.writeFileSync(path.join(ws, 'control', 'endpoint.json'), JSON.stringify({ url: `http://127.0.0.1:${server.address().port}`, token: 't'.repeat(64) }));

  const r = await ctl(['settings:get'], envFor(ws));
  assert.equal(r.code, 3, r.stderr);
  assert.match(r.stderr, /version/i);
  assert.deepEqual(posts, [], 'no channel was called');
});

test('#342 multiagent-ctl --list: exits 0 and prints every allowlisted channel with its argument schema', { skip: SKIP }, async (t) => {
  const { CHANNELS } = require('../src/control/allowlist');
  const { service } = makeService(t);
  await openChannel(t, service);
  const r = await ctl(['--list'], envFor(service.workspace().root));
  assert.equal(r.code, 0, r.stderr);
  const missing = Array.from(CHANNELS).filter((c) => !r.stdout.includes(c));
  assert.deepEqual(missing, []);
  assert.match(r.stdout, /projectId/, 'roadmap:get\'s argument schema');
});

test('#342 multiagent-ctl: --workspace <dir> instead of MULTIAGENT_WORKSPACE', { skip: SKIP }, async (t) => {
  const { service } = makeService(t);
  await openChannel(t, service);
  const env = { ...process.env };
  delete env.MULTIAGENT_WORKSPACE;
  const r = await ctl(['settings:get', '--workspace', service.workspace().root], env);
  assert.equal(r.code, 0, r.stderr);
  assert.equal(resultOf(r.stdout).controlChannel, true);
});

// ---- JS side: the route the client checks first ----------------------------------------------------

test('#342 the control channel answers GET /api/version (with the token) with { version: string }', async (t) => {
  const { service } = makeService(t);
  const endpoint = await openChannel(t, service);
  const res = await new Promise((resolve, reject) => {
    const req = http.request(`${endpoint.url}/api/version`, { method: 'GET', headers: { authorization: `Bearer ${endpoint.token}` } }, (r) => {
      let data = '';
      r.on('data', (c) => { data += c; });
      r.on('end', () => resolve({ status: r.statusCode, text: data }));
    });
    req.on('error', reject);
    req.setTimeout(10000, () => req.destroy(new Error('timeout')));
    req.end();
  });
  assert.equal(res.status, 200, res.text);
  const body = JSON.parse(res.text);
  assert.equal(typeof body.version, 'string');
  assert.ok(body.version.length > 0);
});
