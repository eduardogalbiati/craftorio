// #42 acceptance, written before the code: an outside session (a terminal, another agent) imports a project, syncs
// its backlog, files a local issue, finds the client and watches a roadmap, through the control channel only.
//
// Seams: POST /api/<channel> and GET /api/channels of the control channel (packages/engine/control/index.js) over a
// simulated service, control/endpoint.json, control/calls.jsonl, `npm run serve` (packages/engine/bin/craftorio-engine.js)
// and the two clients run as programs (scripts/ctl.js, the Rust craftorio-ctl), the docs.
//
// Names this file assumes (the issue leaves them open):
// - endpoint.json's `client`: the command that calls the app as an argument list, the channel and its argument come
//   after it: [ctlPath] when that file exists, else ['node' (or Node's own path), '<checkout>/scripts/ctl.js'];
// - `<client> watch <projectId> [--stall <seconds>] [--max <seconds>] [--workspace <dir>]`: --stall is how long without a
//   run event, --max the maximum duration. The last line of stdout is `<reason>: <text>`, the reason one of stage, gate,
//   failed, paused, finished, stalled (exit 0) and timeout (--max passed, exit 4). A failed item is `failed`, also when
//   it paused the roadmap. It looks at the app at least every 2 seconds. Other exits as craftorio-ctl's: 1 a refused or failed call or a wrong use, 2 no endpoint.
// The Rust cases build craftorio-ctl as ctl-342.test.js does: skipped without cargo, never in CI.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile, execFileSync, spawn, spawnSync } = require('child_process');
const { resolveCommand } = require('../engine/providers');
const workspace = require('../domains/workspace/workspace');
const { ISSUE_WORKFLOW, gitRepo, makeService, roadmapProject, until, watchRuns } = require('./service/helpers');

const ROOT = path.join(__dirname, '..', '..', '..');
const CTL_JS = path.join(ROOT, 'scripts', 'ctl.js');
const WINDOWS = process.platform === 'win32';
const NEW_CHANNELS = ['backlog:create-issue', 'backlog:sync', 'projects:create'];
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const read = (...parts) => fs.readFileSync(path.join(ROOT, ...parts), 'utf8');

function tempDir(t, prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  t.after(() => { try { fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }); } catch { /* EBUSY: the OS cleans it */ } });
  return dir;
}

async function call(endpoint, channel, arg, token = endpoint.token) {
  const res = await fetch(`${endpoint.url}/api/${channel}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ arg }),
    signal: AbortSignal.timeout(60000),
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* not JSON */ }
  return { status: res.status, text, result: json?.result, error: String(json?.error || '') };
}

async function openChannel(t, service, options = {}) {
  const { createControlChannel } = require('../control');
  const control = createControlChannel({ service, ...options });
  t.after(() => control.stop());
  service.api['settings:set']({ controlChannel: true });
  await control.update();
  return JSON.parse(fs.readFileSync(path.join(service.workspace().root, 'control', 'endpoint.json'), 'utf8'));
}

function callsOf(root) {
  try {
    return fs.readFileSync(path.join(root, 'control', 'calls.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  } catch { return []; }
}

// a program run asynchronously (the endpoint may be served by this very process): { code, stdout, stderr }
function run(file, args, env = process.env) {
  return new Promise((resolve) => {
    execFile(file, args, { env, timeout: 90000, encoding: 'utf8', windowsHide: true }, (error, stdout, stderr) => {
      resolve({ code: error ? (typeof error.code === 'number' ? error.code : -1) : 0, stdout, stderr });
    });
  });
}

const localProject = async (t, endpoint, name) => call(endpoint, 'projects:create', { name, folder: tempDir(t, 'outside-42-') });

// a project whose folder is a git checkout with an `origin` (a local bare repository: nothing reaches the network)
function checkoutWithRemote(t) {
  const { dir } = gitRepo(t);
  const bare = tempDir(t, 'outside-42-origin-');
  execFileSync('git', ['clone', '-q', '--bare', dir, bare], { stdio: 'ignore' });
  execFileSync('git', ['-C', dir, 'remote', 'add', 'origin', bare], { stdio: 'ignore' });
  return { dir, refs: () => execFileSync('git', ['-C', bare, 'for-each-ref'], { encoding: 'utf8' }) };
}

// The gh and glab of this file: answer an empty list and append their arguments to a log. The login shell's PATH goes
// first once per process (engine/providers.js), so it merges before the fake folder is put in front.
let cliDir;
let realPath;
const cliLog = () => { try { return fs.readFileSync(path.join(cliDir, 'calls.log'), 'utf8').split('\n').map((l) => l.trim()).filter(Boolean); } catch { return []; } };
test.before(() => {
  const real = ['gh', 'glab'].map((c) => resolveCommand(c)?.file).filter((f) => WINDOWS && f && /\.exe$/i.test(f)).map((f) => path.dirname(f).toLowerCase());
  cliDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fake-cli-42-'));
  for (const cli of ['gh', 'glab']) {
    fs.writeFileSync(path.join(cliDir, cli), `#!/bin/sh\necho "${cli} $*" >> "${path.join(cliDir, 'calls.log')}"\necho "[]"\n`, { mode: 0o755 });
    fs.writeFileSync(path.join(cliDir, `${cli}.cmd`), `@echo ${cli} %*>>"${path.join(cliDir, 'calls.log')}"\r\n@echo []\r\n`);
  }
  realPath = process.env.PATH;
  const kept = realPath.split(path.delimiter).filter((d) => !real.includes(d.replace(/[\\/]+$/, '').toLowerCase()));
  process.env.PATH = [cliDir, ...kept].join(path.delimiter);
});
test.after(() => {
  process.env.PATH = realPath;
  fs.rmSync(cliDir, { recursive: true, force: true });
});

// ---- the three channels ----------------------------------------------------------------------------------------

test('#42 the list of allowed channels shows projects:create, backlog:sync and backlog:create-issue with their argument schemas', async (t) => {
  const { service } = makeService(t);
  const endpoint = await openChannel(t, service);
  const res = await fetch(`${endpoint.url}/api/channels`, { headers: { authorization: `Bearer ${endpoint.token}` } });
  const { channels } = await res.json();
  const schemaOf = (name) => JSON.stringify(channels.find((c) => c.channel === name)?.schema ?? null);
  assert.deepEqual(NEW_CHANNELS.filter((c) => channels.some((x) => x.channel === c)), NEW_CHANNELS);
  assert.match(schemaOf('backlog:sync'), /projectId/);
  assert.match(schemaOf('backlog:create-issue'), /projectId/);
  assert.match(schemaOf('backlog:create-issue'), /title/);
  assert.notEqual(schemaOf('projects:create'), 'null');
});

test('#42 projects:create imports a folder through the channel: the app lists the project', async (t) => {
  const { service, api } = makeService(t);
  const endpoint = await openChannel(t, service);
  const res = await localProject(t, endpoint, 'Field notes');
  assert.equal(res.status, 200, res.text);
  assert.equal(api['projects:list']().some((p) => p.id === res.result.id && p.name === 'Field notes'), true);
});

test('#42 projects:create imports an existing checkout through the channel with the repository of its origin', async (t) => {
  const { service, api } = makeService(t);
  const endpoint = await openChannel(t, service);
  const repo = checkoutWithRemote(t);
  const res = await call(endpoint, 'projects:create', { name: 'With origin', folder: repo.dir });
  assert.equal(res.status, 200, res.text);
  const listed = api['projects:list']().find((p) => p.id === res.result.id);
  assert.equal(typeof listed?.repo === 'string' && listed.repo.length > 0, true);
});

test('#42 backlog:create-issue files a local issue of a project with no remote, and backlog:sync answers that backlog', async (t) => {
  const { service, api } = makeService(t);
  const endpoint = await openChannel(t, service);
  const project = await localProject(t, endpoint, 'Local only');
  assert.equal(project.status, 200, project.text);
  const projectId = project.result.id;

  const created = await call(endpoint, 'backlog:create-issue', { projectId, title: 'Write the index', body: 'Two lines', labels: ['docs'] });
  assert.equal(created.status, 200, created.text);
  assert.deepEqual(api['backlog:get']({ projectId }).issues.map((i) => i.title), ['Write the index']);

  const synced = await call(endpoint, 'backlog:sync', { projectId });
  assert.equal(synced.status, 200, synced.text);
  assert.deepEqual(synced.result.issues.map((i) => i.title), ['Write the index']);
});

test('#42 each call of the three channels is in control/calls.jsonl, a refused one too', async (t) => {
  const { service } = makeService(t);
  const endpoint = await openChannel(t, service);
  const project = await localProject(t, endpoint, 'Logged');
  const projectId = project.result?.id ?? 'logged';
  await call(endpoint, 'backlog:create-issue', { projectId, title: 'One' });
  await call(endpoint, 'backlog:sync', { projectId });
  await call(endpoint, 'backlog:sync', { projectId, confirmGate: 'review' });
  const logged = callsOf(service.workspace().root).map((c) => [c.channel, c.status]);
  assert.deepEqual(logged, [['projects:create', 200], ['backlog:create-issue', 200], ['backlog:sync', 200], ['backlog:sync', 403]]);
});

// ---- still closed ----------------------------------------------------------------------------------------------

test('#42 gates, settings, workflow acceptance and run:stop stay refused', async (t) => {
  const { service, api } = makeService(t);
  const endpoint = await openChannel(t, service);
  const closed = Object.keys(api).filter((c) => /^(approval|gate|phonegates):/.test(c)).concat('settings:set', 'workflows:accept', 'run:stop');
  assert.equal(closed.includes('approval:resolve'), true);
  const answered = [];
  for (const channel of closed) if ((await call(endpoint, channel, {})).status !== 403) answered.push(channel);
  assert.deepEqual(answered, []);
});

test('#42 confirmGate is refused on each of the three channels', async (t) => {
  const { service, api } = makeService(t);
  const endpoint = await openChannel(t, service);
  for (const channel of NEW_CHANNELS) {
    const res = await call(endpoint, channel, { name: 'x', projectId: 'x', title: 'x', confirmGate: 'review' });
    assert.equal(res.status, 403, channel);
    assert.match(res.error, /confirmGate is refused/, channel);
  }
  assert.equal(api['projects:list']().length, 0);
});

test('#42 backlog:create-issue of a project with a remote is refused: file it on the platform, then sync', async (t) => {
  const { service, api } = makeService(t);
  const endpoint = await openChannel(t, service);
  const p = await api['projects:create']({ name: 'Remote', folder: checkoutWithRemote(t).dir });
  const res = await call(endpoint, 'backlog:create-issue', { projectId: p.id, title: 'Must not stay local' });
  assert.equal(res.status >= 400 && res.status < 500, true, `status ${res.status}`);
  assert.match(res.error, /\bgh\b/);
  assert.match(res.error, /\bglab\b/);
  assert.match(res.error, /backlog:sync/);
  assert.equal((api['backlog:get']({ projectId: p.id })?.issues || []).length, 0, 'no local issue is left behind');
});

// ---- simulation ------------------------------------------------------------------------------------------------

const PLATFORM_WRITE = /^(gh|glab) (issue|pr|mr|label|release|repo|project) (create|edit|update|close|reopen|comment|note|merge|delete|ready|review|approve)\b|(-X|--method)[ =]?(POST|PUT|PATCH|DELETE)|\bmutation\b/i;

for (const platform of ['github', 'gitlab']) {
  test(`#42 simulation only: importing, syncing and filing through the channel write nothing to ${platform}, nor to the remote`, async (t) => {
    const { service } = makeService(t);
    const endpoint = await openChannel(t, service);
    const repo = checkoutWithRemote(t);
    const refs = repo.refs();
    const before = cliLog().length;

    const project = await call(endpoint, 'projects:create', { name: `Simulated ${platform}`, folder: repo.dir, platform, repo: `https://${platform}.com/o/field-notes` });
    assert.equal(project.status, 200, project.text);
    const projectId = project.result.id;
    const synced = await call(endpoint, 'backlog:sync', { projectId, platform });
    assert.equal(synced.status, 200, synced.text);
    await call(endpoint, 'backlog:create-issue', { projectId, title: 'Never sent' });
    await call(endpoint, 'backlog:sync', { projectId, platform });

    const used = cliLog().slice(before);
    assert.equal(used.length > 0, true, 'the sync read the issues through the platform CLI');
    assert.deepEqual(used.filter((l) => PLATFORM_WRITE.test(l)), []);
    assert.equal(repo.refs(), refs, 'nothing is pushed');
  });
}

// ---- find the client -------------------------------------------------------------------------------------------

const isNode = (file) => /^node(\.exe)?$/i.test(path.basename(String(file)));

test('#42 endpoint.json names the installed app\'s craftorio-ctl as an argument list, its path with spaces whole', async (t) => {
  const dir = path.join(tempDir(t, 'outside-42-app-'), 'Program Files', 'Craftorio');
  fs.mkdirSync(dir, { recursive: true });
  const ctlPath = path.join(dir, WINDOWS ? 'craftorio-ctl.exe' : 'craftorio-ctl');
  fs.writeFileSync(ctlPath, `#!/bin/sh\nexec "${process.execPath}" "${CTL_JS}" "$@"\n`, { mode: 0o755 });
  const { service } = makeService(t);
  const endpoint = await openChannel(t, service, { ctlPath });
  assert.deepEqual(endpoint.client, [ctlPath]);
  if (WINDOWS) return; // a script is no .exe there: only the argument list is checked
  const out = await run(endpoint.client[0], [...endpoint.client.slice(1), 'settings:get', '--workspace', service.workspace().root]);
  assert.equal(out.code, 0, out.stderr);
  assert.equal(JSON.parse(out.stdout).controlChannel, true);
});

test('#42 endpoint.json of a source checkout without Rust names node and scripts/ctl.js, and that command calls the app of a workspace whose path has spaces', async (t) => {
  const { service } = makeService(t);
  const root = path.join(tempDir(t, 'outside-42-ws-'), 'my own workspace');
  fs.mkdirSync(root);
  service.setWorkspace(workspace.setupWorkspace(root, { persist: false }));
  const endpoint = await openChannel(t, service, { ctlPath: path.join(root, 'not-built', 'craftorio-ctl') });
  assert.equal(Array.isArray(endpoint.client), true, 'client is an argument list');
  assert.equal(endpoint.client.length, 2);
  assert.equal(isNode(endpoint.client[0]), true, endpoint.client[0]);
  assert.equal(path.resolve(endpoint.client[1]), CTL_JS);
  assert.equal(path.isAbsolute(endpoint.client[1]), true);
  const out = await run(endpoint.client[0], [...endpoint.client.slice(1), 'settings:get', '--workspace', root]);
  assert.equal(out.code, 0, out.stderr);
  assert.equal(JSON.parse(out.stdout).controlChannel, true);
});

// ---- the server ------------------------------------------------------------------------------------------------

const SERVER_TOKEN = 'outside-42-full-control-0123456789';

// `npm run serve` on a scratch workspace whose path has a space, simulation only, no account (serve-479.test.js's way)
async function serve(t, { settings = null } = {}) {
  const dir = tempDir(t, 'outside-42-serve-');
  const home = path.join(dir, 'home');
  const root = path.join(dir, 'serve workspace');
  fs.mkdirSync(home);
  fs.mkdirSync(root);
  if (settings) workspace.writeSettings(workspace.setupWorkspace(root, { persist: false }), settings);
  const env = {
    ...process.env, CRAFTORIO_SIMULATION_ONLY: '1', CRAFTORIO_AUTH: 'off', CRAFTORIO_SERVER_TOKEN: SERVER_TOKEN,
    CRAFTORIO_USER_DATA: path.join(home, 'user-data'), HOME: home, USERPROFILE: home, APPDATA: path.join(home, 'AppData'),
  };
  delete env.CRAFTORIO_WORKSPACE;
  delete env.NODE_TEST_CONTEXT;
  const child = spawn(process.execPath, [path.join(__dirname, '..', 'bin', 'craftorio-engine.js'), '--port', '0', '--workspace', root], { env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  let text = '';
  child.stdout.on('data', (c) => { text += c; });
  child.stderr.on('data', (c) => { text += c; });
  const exited = new Promise((resolve) => child.once('exit', resolve));
  t.after(async () => { if (child.exitCode === null && child.signalCode === null) child.kill(); await exited; });
  for (let i = 0; i < 600 && child.exitCode === null && !/Open: http/.test(text); i++) await pause(100);
  const port = /Open: http:\/\/[^\s/]+:(\d+)\//.exec(text)?.[1];
  assert.ok(port, `the server starts: ${text}`);
  const file = path.join(root, 'control', 'endpoint.json');
  return { child, exited, root, file, server: { url: `http://127.0.0.1:${port}`, token: SERVER_TOKEN } };
}

async function fileIs(file, there) {
  for (let i = 0; i < 100 && fs.existsSync(file) !== there; i++) await pause(100);
  return fs.existsSync(file) === there;
}

async function endpointOf(s) {
  assert.equal(await fileIs(s.file, true), true, 'npm run serve writes control/endpoint.json');
  return JSON.parse(fs.readFileSync(s.file, 'utf8'));
}

test('#42 npm run serve opens the channel on the loopback with its own token and the same allowlist, never the server\'s token', async (t) => {
  const s = await serve(t);
  const endpoint = await endpointOf(s);
  assert.equal(new URL(endpoint.url).hostname, '127.0.0.1');
  assert.notEqual(new URL(endpoint.url).port, new URL(s.server.url).port, 'its own port');
  assert.match(endpoint.token, /^[0-9a-f]{64}$/);
  const folder = path.join(s.root, 'control');
  const leaked = fs.readdirSync(folder).filter((f) => fs.readFileSync(path.join(folder, f), 'utf8').includes(SERVER_TOKEN));
  assert.deepEqual(leaked, [], 'the full-control token is in no file of control/');

  assert.equal((await call(endpoint, 'settings:get', {})).status, 200);
  assert.equal((await call(endpoint, 'approval:resolve', {})).status, 403);
  assert.equal((await call(endpoint, 'settings:get', {}, SERVER_TOKEN)).status, 401, 'the server token does not open this channel');
  assert.equal((await call(s.server, 'settings:get', {}, endpoint.token)).status, 401, 'nor this one the server');
});

test('#42 the client npm run serve names calls the server', async (t) => {
  const s = await serve(t);
  const endpoint = await endpointOf(s);
  assert.equal(Array.isArray(endpoint.client), true, 'client is an argument list');
  const out = await run(endpoint.client[0], [...endpoint.client.slice(1), 'settings:get', '--workspace', s.root]);
  assert.equal(out.code, 0, out.stderr);
  assert.equal(JSON.parse(out.stdout).controlChannel, true);
});

// Windows ends a child at once on kill(): there is no stop to observe
test('#42 npm run serve removes the endpoint file when it stops', { skip: WINDOWS && 'no SIGTERM on Windows' }, async (t) => {
  const s = await serve(t);
  await endpointOf(s);
  s.child.kill('SIGTERM');
  await s.exited;
  assert.equal(fs.existsSync(s.file), false);
});

test('#42 npm run serve with the setting off opens no channel; turned on while it runs, it does, and off again closes it', async (t) => {
  const s = await serve(t, { settings: { controlChannel: false } });
  await pause(1500);
  assert.equal(fs.existsSync(s.file), false);
  assert.equal((await call(s.server, 'settings:set', { controlChannel: true })).status, 200);
  await endpointOf(s);
  await call(s.server, 'settings:set', { controlChannel: false });
  assert.equal(await fileIs(s.file, false), true, 'off: the file is removed');
});

// ---- watch: the same cases for both clients ----------------------------------------------------------------------

const BINARY_NAME = WINDOWS ? 'craftorio-ctl.exe' : 'craftorio-ctl';
const BINARY = path.join(process.env.CARGO_TARGET_DIR || path.join(ROOT, 'native', 'target'), 'release', BINARY_NAME);
const hasCargo = () => spawnSync('cargo', ['--version'], { stdio: 'ignore' }).status === 0;
const SKIP_RUST = !process.env.CI && !hasCargo() ? 'cargo is not installed: craftorio-ctl\'s cases are skipped (CI runs them)' : false;

let built = null;
function rustBinary() {
  if (!built) {
    const r = spawnSync('cargo', ['build', '--release', '--manifest-path', path.join(ROOT, 'native', 'Cargo.toml'), '-p', 'craftorio-ctl'], { encoding: 'utf8', timeout: 9 * 60 * 1000 });
    built = r.status === 0 && fs.existsSync(BINARY) ? { file: BINARY } : { error: `cargo build of craftorio-ctl failed: ${(r.stderr || r.error?.message || '').slice(-1500)}` };
  }
  if (built.error) throw new Error(built.error);
  return built.file;
}

const CLIENTS = [
  { name: 'scripts/ctl.js', skip: false, command: () => [process.execPath, CTL_JS] },
  { name: 'craftorio-ctl', skip: SKIP_RUST, command: () => [rustBinary()] },
];

const NO_GATE = ISSUE_WORKFLOW.replace(/ {2}- id: review[\s\S]*$/, '');
const SLOW = '1000'; // a simulated turn that stays silent for minutes
const STAGE_CHANGE = '4'; // the first stage lasts several seconds
const FAST = '0.05';

function delayScale(t, value) {
  const before = process.env.CRAFTORIO_MOCK_DELAY_SCALE;
  process.env.CRAFTORIO_MOCK_DELAY_SCALE = value;
  t.after(() => { if (before === undefined) delete process.env.CRAFTORIO_MOCK_DELAY_SCALE; else process.env.CRAFTORIO_MOCK_DELAY_SCALE = before; });
}

// a started simulated roadmap, one issue per stage, and the channel open: { api, root, projectId, runId(), gates }
async function startedRoadmap(t, { scale, stages = 1, workflow = NO_GATE }) {
  delayScale(t, scale);
  const { service, api } = makeService(t);
  const ws = service.workspace();
  fs.writeFileSync(path.join(ws.workflows, 'fixture-issue.yaml'), workflow);
  const numbers = Array.from({ length: stages }, (_, i) => i + 1);
  const p = await roadmapProject(api, ws, t, numbers, 'outside-42');
  const { gates } = watchRuns(service);
  await api['roadmap:save']({ projectId: p.id, stages: numbers.map((number) => ({ items: [{ workflow: 'fixture-issue.yaml', number, mock: true }] })) });
  await openChannel(t, service);
  await api['roadmap:start']({ projectId: p.id, simulated: true });
  const get = () => api['roadmap:get']({ projectId: p.id });
  await until(() => !!get().stages[0].items[0].runId);
  return { api, get, gates, root: ws.root, projectId: p.id, runId: get().stages[0].items[0].runId };
}

function watch(client, r, args = ['--stall', '600', '--max', '60']) {
  const [file, ...first] = client.command();
  const env = { ...process.env };
  delete env.CRAFTORIO_WORKSPACE;
  return run(file, [...first, 'watch', r.projectId, ...args, '--workspace', r.root], env);
}

// starts a watch and waits until it read the app (or ended), so what comes next happens while it watches: { done }
async function watching(client, r) {
  const before = callsOf(r.root).length;
  let ended = false;
  const done = watch(client, r).finally(() => { ended = true; });
  for (let i = 0; i < 100 && !ended && callsOf(r.root).length === before; i++) await pause(50);
  await pause(1000);
  return { done };
}

const reasonLine = (out) => out.stdout.trim().split('\n').at(-1) || '';
function returned(out, reason, code = 0) {
  const said = `exit ${out.code}, stdout: ${out.stdout}, stderr: ${out.stderr}`;
  assert.match(reasonLine(out), new RegExp(`^${reason}: \\S`), said);
  assert.equal(out.code, code, said);
}

for (const client of CLIENTS) {
  const it = (name, fn) => test(`#42 ${client.name} watch: ${name}`, { skip: client.skip }, async (t) => {
    client.command(); // built before the case's clock starts
    await fn(t);
  });

  it('returns on a waiting gate, naming its step', async (t) => {
    const r = await startedRoadmap(t, { scale: FAST, workflow: ISSUE_WORKFLOW });
    await until(() => r.gates.has(r.runId));
    const out = await watch(client, r);
    returned(out, 'gate');
    assert.match(reasonLine(out), /review/);
  });

  it('returns when the current stage changes', async (t) => {
    const r = await startedRoadmap(t, { scale: STAGE_CHANGE, stages: 2 });
    const { done } = await watching(client, r);
    const out = await done;
    returned(out, 'stage');
    assert.equal(r.get().stages[0].items[0].status, 'done');
  });

  it('returns on a failed item, naming its issue', async (t) => {
    const r = await startedRoadmap(t, { scale: SLOW });
    const { done } = await watching(client, r);
    r.api['run:stop']({ runId: r.runId });
    const out = await done;
    returned(out, 'failed');
    assert.match(reasonLine(out), /#1\b/);
  });

  it('returns when the roadmap is paused', async (t) => {
    const r = await startedRoadmap(t, { scale: SLOW });
    const { done } = await watching(client, r);
    await r.api['roadmap:pause']({ projectId: r.projectId });
    returned(await done, 'paused');
  });

  it('returns when the roadmap is finished', async (t) => {
    const r = await startedRoadmap(t, { scale: FAST });
    await until(() => r.get().state === 'done');
    returned(await watch(client, r), 'finished');
  });

  it('returns when no run event came for the given time', async (t) => {
    const r = await startedRoadmap(t, { scale: SLOW });
    returned(await watch(client, r, ['--stall', '3', '--max', '60']), 'stalled');
  });

  it('stops at its maximum duration, having only read', async (t) => {
    const r = await startedRoadmap(t, { scale: SLOW });
    const updatedAt = r.get().updatedAt;
    returned(await watch(client, r, ['--stall', '600', '--max', '3']), 'timeout', 4);
    const channels = [...new Set(callsOf(r.root).map((c) => c.channel))];
    assert.equal(channels.length > 0, true, 'it read the app through the channel');
    const reads = ['backlog:get', 'gates:interrupted', 'notifications:list', 'projects:list', 'roadmap:get', 'roadmap:versions', 'runs:active', 'runs:events', 'runs:list', 'settings:get'];
    assert.deepEqual(channels.filter((c) => !reads.includes(c)), [], 'only reading channels');
    assert.equal(r.get().updatedAt, updatedAt, 'the roadmap is untouched');
    assert.equal(r.get().state, 'running');
  });

  it('exits 1 for a project id the app does not have, and 2 with no endpoint', async (t) => {
    const { service } = makeService(t);
    const r = { root: service.workspace().root, projectId: 'no-such-project' };
    const closed = await watch(client, r, ['--max', '3']);
    assert.equal(closed.code, 2, closed.stderr);
    assert.match(closed.stderr, /endpoint/i);
    await openChannel(t, service);
    const unknown = await watch(client, r, ['--max', '3']);
    assert.equal(unknown.code, 1, `${unknown.stdout}${unknown.stderr}`);
    assert.match(unknown.stderr, /no-such-project/);
    assert.doesNotMatch(unknown.stderr, /not valid JSON/);
  });
}

// ---- docs --------------------------------------------------------------------------------------------------------

test('#42 docs: the control channel\'s page says what outside sessions can do now', () => {
  const doc = read('docs', 'features', 'control-channel.md');
  for (const word of [...NEW_CHANNELS, '`client`', 'npm run serve', 'craftorio-ctl watch']) assert.equal(doc.includes(word), true, word);
});

test('#42 docs: the running page says npm run serve opens the control channel', () => {
  const doc = read('docs', 'readme', '010-running.md');
  assert.match(doc, /control\/endpoint\.json/);
});

for (const file of [['SECURITY.md'], ['docs', 'readme', '036-security-model.md']]) {
  test(`#42 docs: ${file.at(-1)} says a run's agents can read the token and so call the three channels`, () => {
    const text = read(...file).replace(/\s+/g, ' ');
    for (const channel of NEW_CHANNELS) assert.equal(text.includes(channel), true, channel);
    assert.match(text, /agents[^.]*can (still )?read/i);
  });
}
