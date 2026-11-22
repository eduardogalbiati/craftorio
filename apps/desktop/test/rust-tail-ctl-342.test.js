// Acceptance tests for #342 (the session tail and the control client as Rust binaries, so the packaged
// app needs no system Node): everything but the binaries' own behaviour (test/session/session-tail-342.test.js
// and test/ctl-342.test.js run those). Seams, loaded inside each test (they do not exist before the change):
// - packages/engine/domains/machine/native-bin.js: nativeBinaryPath(name, { isPackaged, resourcesPath, platform }) where a native
//   sidecar (craftorio-mcp, craftorio-tail, craftorio-ctl) lives: packaged resources/bin/<name>[.exe],
//   dev cargo's output under native/; never PATH. mcpBinaryPath (packages/engine/domains/supervisor/supervisor-bridge.js) agrees with it.
// - packages/engine/domains/machine/native-bin.js: tailCommand(isPackaged, resolveCommand, { binary }) → { command, args, env }, the
//   twin of mcpCommand: the binary when it exists (args []), else packages/engine/domains/session/session-tail.js under node (dev:
//   process.execPath; packaged: resolveCommand('node'), throwing /Node\.js on the PATH/ without it).
//   terminalSpec(runId, sessionId, 'live') (packages/engine/service/areas/sessions.js) starts tailCommand's command
//   with [...args, runDir, sessionId].
// - packages/engine/control/index.js: createControlChannel({ service, ctlPath }); its status carries `ctlPath` (main.js
//   passes nativeBinaryPath('craftorio-ctl', { isPackaged: app.isPackaged }); without it, the dev path).
//   Settings › Execution (renderControlChannel in packages/ui-kit/views/settings/settings.js) shows it.
// - apps/desktop/scripts/package.js: buildNative builds and stages the three binaries; app.asar unpacks only node-pty.
// - the files: native/ crates, THIRD_PARTY_NOTICES.md, the control-channel feature fragment,
//   docs/agents/environment.md, README.md.
// Nothing here builds, packages, launches the app or calls a model.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const { makeService } = require('@craftorio/engine/test/service/helpers');

const root = path.join(__dirname, '..', '..', '..');
const abs = (p) => path.join(root, p);
const exists = (p) => fs.existsSync(abs(p));
const read = (p) => fs.readFileSync(abs(p), 'utf8');
const nativeBin = () => require('@craftorio/engine/domains/machine/native-bin');
const exe = (name, platform = process.platform) => (platform === 'win32' ? `${name}.exe` : name);

const BINARIES = ['craftorio-ctl', 'craftorio-mcp', 'craftorio-tail'];

// A PATH that has everything (the binaries' names included): a binary must never come from it.
const pathWithEverything = (name) => ({ file: path.join(path.sep, 'on-path', name), shell: false });
// A PATH without node that records what was looked up.
function pathWithoutNode() {
  const asked = [];
  const resolve = (name) => { asked.push(name); return name === 'node' ? null : pathWithEverything(name); };
  return { resolve, asked };
}

// A fake resources/ folder with bin/<every binary>.
function fakeResources(t) {
  const res = fs.mkdtempSync(path.join(os.tmpdir(), 'res-342-'));
  t.after(() => fs.rmSync(res, { recursive: true, force: true }));
  fs.mkdirSync(path.join(res, 'bin'));
  for (const name of BINARIES) fs.writeFileSync(path.join(res, 'bin', exe(name)), '');
  return res;
}

function missingBinary(t, name) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bin-none-342-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return path.join(dir, exe(name));
}

// ---- where the binaries live ---------------------------------------------------------------------

test('#342 nativeBinaryPath: packaged, every sidecar is in resources/bin, with .exe on Windows only', () => {
  const { nativeBinaryPath } = nativeBin();
  assert.equal(typeof nativeBinaryPath, 'function', 'packages/engine/domains/machine/native-bin.js exports nativeBinaryPath');
  const res = path.join(path.sep, 'apps', 'Multiagent', 'resources');
  for (const name of BINARIES) {
    for (const platform of ['win32', 'darwin', 'linux']) {
      assert.equal(nativeBinaryPath(name, { isPackaged: true, resourcesPath: res, platform }), path.join(res, 'bin', exe(name, platform)), `${name} ${platform}`);
    }
  }
});

test('#342 nativeBinaryPath: in a dev checkout, under native/; mcpBinaryPath gives the same file', () => {
  const { nativeBinaryPath } = nativeBin();
  const { mcpBinaryPath } = require('@craftorio/engine/domains/supervisor/supervisor-bridge');
  for (const name of BINARIES) {
    for (const platform of ['win32', 'linux']) {
      const p = nativeBinaryPath(name, { isPackaged: false, platform });
      assert.ok(path.isAbsolute(p), p);
      assert.ok(p.startsWith(path.join(root, 'native') + path.sep), `${p} is under native/`);
      assert.equal(path.basename(p), exe(name, platform));
    }
  }
  const res = path.join(path.sep, 'r');
  assert.equal(mcpBinaryPath({ isPackaged: true, resourcesPath: res, platform: 'win32' }), nativeBinaryPath('craftorio-mcp', { isPackaged: true, resourcesPath: res, platform: 'win32' }));
  assert.equal(mcpBinaryPath({ isPackaged: false, platform: 'linux' }), nativeBinaryPath('craftorio-mcp', { isPackaged: false, platform: 'linux' }));
});

// ---- how the external live terminal starts ------------------------------------------------------

test('#342 tailCommand: with the binary present (packaged or dev), it starts the binary and never looks up node', (t) => {
  const { tailCommand } = nativeBin();
  const res = fakeResources(t);
  const binary = path.join(res, 'bin', exe('craftorio-tail'));
  for (const isPackaged of [true, false]) {
    const lookup = pathWithoutNode();
    const cmd = tailCommand(isPackaged, lookup.resolve, { binary });
    assert.equal(cmd.command, binary, `isPackaged ${isPackaged}`);
    assert.deepEqual(cmd.args, []);
    assert.equal(lookup.asked.includes('node'), false, 'node is not looked up');
  }
});

test('#342 tailCommand: without the binary, the JS script (dev: this Node; packaged: the system node, else a Node.js error)', (t) => {
  const { tailCommand } = nativeBin();
  const missing = missingBinary(t, 'craftorio-tail');

  const dev = tailCommand(false, pathWithEverything, { binary: missing });
  assert.equal(dev.command, process.execPath);
  assert.equal(dev.args.length, 1);
  assert.equal(path.basename(dev.args[0]), 'session-tail.js');

  const packaged = tailCommand(true, pathWithEverything, { binary: missing });
  assert.equal(packaged.command, pathWithEverything('node').file, 'the system node, never a craftorio-tail found on the PATH');
  assert.equal(path.basename(packaged.args[0]), 'session-tail.js');

  assert.throws(() => tailCommand(true, pathWithoutNode().resolve, { binary: missing }), /Node\.js on the PATH/);
});

test('#342 terminalSpec live: starts tailCommand\'s command with the run folder and the session id', async (t) => {
  const { tailCommand } = nativeBin();
  const { service, api } = makeService(t);
  let sessionId = null;
  const gate = new Promise((resolve) => {
    service.events.on('run:event', (ev) => {
      if (ev.type === 'session.opened' && ev.session_id !== 'orchestrator') sessionId ||= ev.session_id;
      if (ev.type === 'approval.requested') resolve();
    });
  });
  const { runId } = await api['run:start']({ file: 'fixture-service.yaml', inputs: {}, mock: true });
  await gate;
  assert.ok(sessionId, 'the mock run opened a session');
  const runDir = service.runDir(runId);

  const spec = service.terminalSpec(runId, sessionId, 'live');
  const expected = tailCommand(false, () => { throw new Error('dev never looks node up'); });
  assert.equal(spec.file, expected.command);
  assert.deepEqual(spec.args, [...expected.args, runDir, sessionId]);
  assert.equal(path.resolve(spec.cwd), path.resolve(runDir));
  assert.equal(spec.env.FORCE_COLOR, '1');
});

test('#342 packaged with its binaries, no spawn spec resolves node from the PATH (MCP server, live terminal, control client)', (t) => {
  const { nativeBinaryPath, tailCommand } = nativeBin();
  const { mcpCommand } = require('@craftorio/engine/domains/supervisor/supervisor-bridge');
  const res = fakeResources(t);
  const at = (name) => nativeBinaryPath(name, { isPackaged: true, resourcesPath: res });
  const lookup = pathWithoutNode();

  assert.equal(mcpCommand(true, lookup.resolve, { binary: at('craftorio-mcp') }).command, at('craftorio-mcp'));
  assert.equal(tailCommand(true, lookup.resolve, { binary: at('craftorio-tail') }).command, at('craftorio-tail'));
  assert.equal(lookup.asked.includes('node'), false, 'node is never looked up');
  for (const name of BINARIES) assert.equal(path.dirname(at(name)), path.join(res, 'bin'), name);
});

// ---- the control client's path in Settings ------------------------------------------------------

test('#342 control channel status: carries the craftorio-ctl path it is given, the dev path by default', async (t) => {
  const { createControlChannel } = require('@craftorio/engine/control');
  const { nativeBinaryPath } = nativeBin();
  const { service } = makeService(t);
  const given = path.join(path.sep, 'apps', 'Multiagent', 'resources', 'bin', exe('craftorio-ctl'));
  const control = createControlChannel({ service, ctlPath: given });
  t.after(() => control.stop());
  service.api['settings:set']({ controlChannel: true });
  const on = await control.update();
  assert.equal(on.enabled, true);
  assert.equal(on.ctlPath, given);

  const byDefault = createControlChannel({ service });
  t.after(() => byDefault.stop());
  assert.equal(byDefault.status().ctlPath, nativeBinaryPath('craftorio-ctl', { isPackaged: false }));
});

// renderControlChannel pulled out of settings.js into a vm sandbox, as test/renderer-settings.test.js does.
function renderedControlChannel(state) {
  const src = read('packages/ui-kit/views/settings/settings.js');
  const els = new Map();
  const makeEl = () => ({ innerHTML: '', textContent: '', title: '', className: '', value: '', classList: { toggle() {}, add() {}, remove() {}, contains: () => false } });
  const $ = (sel) => { if (!els.has(sel)) els.set(sel, makeEl()); return els.get(sel); };
  const sandbox = {
    $, esc: (s) => String(s ?? ''), errMsg: (e) => String(e?.message || e),
    t: require('@craftorio/ui-kit/test/settings-source-329').t, // #329: the row's texts come from the catalog
    document: { querySelector: () => ({ disabled: false }) },
    api: { platform: 'win32', controlChannelState: async () => state },
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  const available = /const controlChannelAvailable = [^\n]*\n/.exec(src);
  const render = /function renderControlChannel\(s, failure\) \{[\s\S]*?\n\}/.exec(src);
  assert.ok(available && render, 'the control channel renderer not found in settings.js: the source moved');
  vm.runInContext(`${available[0]}${render[0]}\nrenderControlChannel(${JSON.stringify(state)});`, sandbox);
  return [...els.values()].map((e) => `${e.textContent}\n${e.innerHTML}\n${e.title}`).join('\n');
}

test('#342 Settings › Execution: the control channel row shows the craftorio-ctl path to copy', () => {
  const ctlPath = 'C:\\Apps\\Multiagent\\resources\\bin\\craftorio-ctl.exe';
  const shown = renderedControlChannel({ enabled: true, port: 51234, file: 'C:/ws/control/endpoint.json', error: null, ctlPath });
  assert.equal(shown.includes(ctlPath), true, 'the path is shown');
});

// ---- packaging ------------------------------------------------------------------------------------

const pkgScript = () => require('../scripts/package.js');
const PACK_LEGS = [['win32', 'x64'], ['darwin', 'arm64'], ['darwin', 'x64'], ['linux', 'x64']];

test('#342 packagerOptions: app.asar unpacks node-pty only (session-tail.js and supervisor-mcp.js stay packed)', () => {
  const { packagerOptions } = pkgScript();
  const out = path.join(root, '.scratch', 'pkg-out');
  for (const [platform, arch] of PACK_LEGS) {
    const unpack = JSON.stringify(packagerOptions({ platform, arch, out }).asar);
    assert.match(unpack, /node-pty/, `${platform}-${arch}: node-pty stays unpacked`);
    assert.doesNotMatch(unpack, /session-tail/, `${platform}-${arch}`);
    assert.doesNotMatch(unpack, /supervisor-mcp/, `${platform}-${arch}`);
  }
});

// buildNative with a stubbed process runner (the boundary): the fake cargo writes every binary.
function nativeBuild(t, platform) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'native-342-'));
  const before = process.env.CARGO_TARGET_DIR;
  process.env.CARGO_TARGET_DIR = path.join(tmp, 'target');
  t.after(() => {
    if (before === undefined) delete process.env.CARGO_TARGET_DIR; else process.env.CARGO_TARGET_DIR = before;
    fs.rmSync(tmp, { recursive: true, force: true });
  });
  const calls = [];
  const run = (cmd, args) => {
    calls.push([cmd, ...args]);
    if (cmd === 'cargo' && args.includes('build')) {
      const triple = args[args.indexOf('--target') + 1];
      const dir = path.join(tmp, 'target', triple, 'release');
      fs.mkdirSync(dir, { recursive: true });
      for (const name of BINARIES) fs.writeFileSync(path.join(dir, exe(name, platform)), `${name} for ${triple}`);
    }
    return { status: 0 };
  };
  return { out: path.join(tmp, 'out'), calls, run };
}

test('#342 buildNative: builds craftorio-mcp, craftorio-tail and craftorio-ctl and stages all three in the bin folder', (t) => {
  const { buildNative } = pkgScript();
  for (const [platform, arch, triple] of [['win32', 'x64', 'x86_64-pc-windows-msvc'], ['linux', 'x64', 'x86_64-unknown-linux-gnu']]) {
    const b = nativeBuild(t, platform);
    const dir = buildNative({ platform, arch, out: b.out }, b.run);
    assert.deepEqual(fs.readdirSync(dir).sort(), BINARIES.map((n) => exe(n, platform)).sort(), platform);
    for (const name of BINARIES) assert.equal(fs.readFileSync(path.join(dir, exe(name, platform)), 'utf8'), `${name} for ${triple}`);
    const packages = b.calls.filter((c) => c[0] === 'cargo').flatMap((c) => c.flatMap((a, i) => (c[i - 1] === '-p' ? [a] : [])));
    assert.deepEqual(packages.sort(), [...BINARIES].sort(), `${platform}: cargo -p for each binary`);
  }
});

// ---- the cargo crates ----------------------------------------------------------------------------

function tomlSections(text) {
  const out = { '': '' };
  let cur = '';
  for (const line of text.split(/\r?\n/)) {
    const h = /^\s*\[([^\]]+)\]\s*(#.*)?$/.exec(line);
    if (h) { cur = h[1].trim(); out[cur] = out[cur] || ''; continue; }
    out[cur] += `${line}\n`;
  }
  return out;
}

function crateDir(name) {
  for (const d of fs.readdirSync(abs('native'), { withFileTypes: true })) {
    const manifest = path.join('native', d.name, 'Cargo.toml');
    if (d.isDirectory() && exists(manifest) && new RegExp(`^\\s*name\\s*=\\s*"${name}"`, 'm').test(read(manifest))) return path.join('native', d.name);
  }
  return null;
}

test('#342 native/ has the craftorio-tail and craftorio-ctl crates, workspace members inheriting the lints', () => {
  const members = tomlSections(read('native/Cargo.toml')).workspace || '';
  for (const name of ['craftorio-tail', 'craftorio-ctl']) {
    const dir = crateDir(name);
    assert.ok(dir, `a crate under native/ named ${name}`);
    assert.ok(members.includes(`"${path.basename(dir)}"`), `${name} is a workspace member`);
    assert.match(tomlSections(read(path.join(dir, 'Cargo.toml'))).lints || '', /workspace\s*=\s*true/, `${name}: [lints] workspace = true`);
  }
});

function directDependencies(dir) {
  const names = new Set();
  for (const [h, body] of Object.entries(tomlSections(read(path.join(dir, 'Cargo.toml'))))) {
    const table = /^dependencies\.([A-Za-z0-9_-]+)$/.exec(h);
    if (table) { names.add(table[1]); continue; }
    if (h !== 'dependencies') continue;
    for (const line of body.split('\n')) {
      const m = /^\s*([A-Za-z0-9_-]+)(?:\.[A-Za-z]+)?\s*=/.exec(line);
      if (m) names.add(m[1]);
    }
  }
  return [...names].sort();
}

test('#342 THIRD_PARTY_NOTICES.md names each direct dependency of craftorio-tail and craftorio-ctl on a row naming the crate', () => {
  const rows = read('THIRD_PARTY_NOTICES.md').split('\n').filter((l) => l.startsWith('|'));
  for (const name of ['craftorio-tail', 'craftorio-ctl']) {
    const dir = crateDir(name);
    assert.ok(dir, `the ${name} crate exists`);
    const missing = directDependencies(dir).filter((dep) => !rows.some((r) => r.startsWith(`| ${dep} |`) && r.includes(name)));
    assert.deepEqual(missing, [], `${name}: dependencies missing from THIRD_PARTY_NOTICES.md`);
  }
});

// ---- docs ----------------------------------------------------------------------------------------

function controlFragment() {
  const dir = abs('docs/features');
  return fs.readdirSync(dir).filter((f) => f.endsWith('.md'))
    .map((f) => fs.readFileSync(path.join(dir, f), 'utf8'))
    .find((text) => text.includes('control/endpoint.json'));
}

test('#342 docs: the control channel fragment calls craftorio-ctl, never `node scripts/ctl.js`', () => {
  const doc = controlFragment();
  assert.ok(doc, 'a docs/features fragment documents control/endpoint.json');
  assert.match(doc, /craftorio-ctl\b/);
  assert.equal(doc.includes('node scripts/ctl.js'), false, 'no node from the PATH in the documented client');
  assert.match(doc, /craftorio-ctl --list/);
});

test('#342 docs: environment.md says Node is needed for development only and names the two new binaries', () => {
  const env = read('docs/agents/environment.md');
  const sentences = env.replace(/\s+/g, ' ').split(/(?<=[.!?])\s/);
  assert.equal(sentences.some((s) => /\bNode\b/.test(s) && /development only/i.test(s)), true, 'a sentence says Node is for development only');
  for (const s of ['craftorio-tail', 'craftorio-ctl']) assert.ok(env.includes(s), s);
});

test('#342 README: the requirements say the packaged app needs no Node', () => {
  const sentences = read('README.md').replace(/\s+/g, ' ').split(/(?<=[.!?])\s/);
  const says = sentences.some((s) => /packaged app/i.test(s) && /\bNode\b/.test(s) && /\b(no|without|not|never)\b/i.test(s));
  assert.equal(says, true, 'a README sentence says the packaged app does not need Node');
});
