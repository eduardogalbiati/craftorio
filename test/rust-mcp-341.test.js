// Acceptance tests for #341 (phase 1 of the path to Rust: the supervisor's MCP server as a Rust
// binary, multiagent-mcp, so the packaged app stops depending on a system Node). Two kinds of checks:
// - src/supervisor-bridge.js through its exports: mcpBinaryPath({ isPackaged, resourcesPath, platform })
//   (where the binary of the current platform lives: never PATH) and
//   mcpCommand(isPackaged, resolveCommand, { binary }) (the binary when it exists, else the JS script);
// - the repository's files: the cargo workspace in native/, packaging, the CI and release workflows,
//   the docs. The MCP protocol itself (both servers, the same cases) is test/supervisor-mcp.test.js.
// Nothing here builds, packages, launches the app or calls a model.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const yaml = require('js-yaml');

const root = path.join(__dirname, '..');
const abs = (p) => path.join(root, p);
const exists = (p) => fs.existsSync(abs(p));
const read = (p) => fs.readFileSync(abs(p), 'utf8');
const bridge = () => require('../src/supervisor-bridge');

const SCRIPT_NAME = 'supervisor-mcp.js';

function tempBinary(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-bin-341-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, process.platform === 'win32' ? 'multiagent-mcp.exe' : 'multiagent-mcp');
  fs.writeFileSync(file, '');
  return file;
}

// A PATH that has everything, the binary's name included: the binary must still never come from it.
const pathWithEverything = (name) => ({ file: path.join(path.sep, 'on-path', name), shell: false });
const pathWithoutNode = (name) => (name === 'node' ? null : pathWithEverything(name));

// ---- where the binary lives ----------------------------------------------------------------------

test('#341 mcpBinaryPath: packaged, the binary is in resources/bin, with .exe on Windows only', () => {
  const { mcpBinaryPath } = bridge();
  assert.equal(typeof mcpBinaryPath, 'function', 'src/supervisor-bridge.js exports mcpBinaryPath');
  const res = path.join(path.sep, 'apps', 'Multiagent', 'resources');
  assert.equal(mcpBinaryPath({ isPackaged: true, resourcesPath: res, platform: 'win32' }), path.join(res, 'bin', 'multiagent-mcp.exe'));
  assert.equal(mcpBinaryPath({ isPackaged: true, resourcesPath: res, platform: 'darwin' }), path.join(res, 'bin', 'multiagent-mcp'));
  assert.equal(mcpBinaryPath({ isPackaged: true, resourcesPath: res, platform: 'linux' }), path.join(res, 'bin', 'multiagent-mcp'));
});

test('#341 mcpBinaryPath: in a dev checkout, the binary is the one cargo builds under native/', () => {
  const { mcpBinaryPath } = bridge();
  for (const platform of ['win32', 'darwin', 'linux']) {
    const p = mcpBinaryPath({ isPackaged: false, platform });
    assert.ok(path.isAbsolute(p), p);
    assert.ok(p.startsWith(path.join(root, 'native') + path.sep), `${p} is under native/`);
    assert.equal(path.basename(p), platform === 'win32' ? 'multiagent-mcp.exe' : 'multiagent-mcp');
  }
});

// ---- how claude starts the MCP server -------------------------------------------------------------

test('#341 mcpCommand: packaged with the binary present, it starts the binary and needs no Node on the PATH', (t) => {
  const { mcpCommand } = bridge();
  const binary = tempBinary(t);
  const cmd = mcpCommand(true, pathWithoutNode, { binary });
  assert.equal(cmd.command, binary);
  assert.deepEqual(cmd.args, []);
});

test('#341 mcpCommand: in a dev checkout with the binary built, it starts the binary', (t) => {
  const { mcpCommand } = bridge();
  const binary = tempBinary(t);
  const cmd = mcpCommand(false, pathWithEverything, { binary });
  assert.equal(cmd.command, binary);
  assert.deepEqual(cmd.args, []);
});

test('#341 mcpCommand: without the binary, it falls back to the JS script (dev: this Node; packaged: the system node)', (t) => {
  const { mcpCommand } = bridge();
  const missing = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-none-341-')), 'multiagent-mcp.exe');
  t.after(() => fs.rmSync(path.dirname(missing), { recursive: true, force: true }));

  const dev = mcpCommand(false, pathWithEverything, { binary: missing });
  assert.equal(dev.command, process.execPath);
  assert.equal(dev.args.length, 1);
  assert.equal(path.basename(dev.args[0]), SCRIPT_NAME);

  const packaged = mcpCommand(true, pathWithEverything, { binary: missing });
  assert.equal(packaged.command, pathWithEverything('node').file, 'the system node, never a multiagent-mcp found on the PATH');
  assert.equal(path.basename(packaged.args[0]), SCRIPT_NAME);
});

test('#341 mcpCommand: packaged, without the binary nor Node, it still says Node.js is needed (a multiagent-mcp on the PATH is not used)', (t) => {
  const { mcpCommand } = bridge();
  const missing = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-none-341-')), 'multiagent-mcp.exe');
  t.after(() => fs.rmSync(path.dirname(missing), { recursive: true, force: true }));
  assert.throws(() => mcpCommand(true, pathWithoutNode, { binary: missing }), /Node\.js on the PATH/);
});

// ---- the cargo workspace --------------------------------------------------------------------------

// The sections of a Cargo.toml as { header: body } (enough for these checks; no TOML library).
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

function mcpCrateDir() {
  if (!exists('native')) return null;
  for (const d of fs.readdirSync(abs('native'), { withFileTypes: true })) {
    const manifest = path.join('native', d.name, 'Cargo.toml');
    if (d.isDirectory() && exists(manifest) && /^\s*name\s*=\s*"multiagent-mcp"/m.test(read(manifest))) return path.join('native', d.name);
  }
  return null;
}

test('#341 native/Cargo.toml is a workspace (edition 2024, unsafe code forbidden) with the multiagent-mcp crate', () => {
  assert.ok(exists('native/Cargo.toml'), 'native/Cargo.toml exists');
  const s = tomlSections(read('native/Cargo.toml'));
  assert.ok('workspace' in s, '[workspace]');
  assert.match(s.workspace, /members\s*=/, 'workspace members');
  const crate = mcpCrateDir();
  assert.ok(crate, 'a crate under native/ named multiagent-mcp');
  const edition = /edition\s*=\s*"(\d+)"/.exec(s['workspace.package'] || '')?.[1] || /edition\s*=\s*"(\d+)"/.exec(read(path.join(crate, 'Cargo.toml')))?.[1];
  assert.equal(edition, '2024');
  assert.match(s['workspace.lints.rust'] || '', /unsafe_code\s*=\s*"forbid"/);
});

test('#341 the never-crash lints are denied in non-test code and the crate inherits them', () => {
  const lints = tomlSections(read('native/Cargo.toml'))['workspace.lints.clippy'] || '';
  for (const lint of ['unwrap_used', 'expect_used', 'panic', 'todo', 'unimplemented', 'unreachable']) {
    assert.match(lints, new RegExp(`^\\s*${lint}\\s*=\\s*(?:"(?:deny|forbid)"|\\{[^}]*level\\s*=\\s*"(?:deny|forbid)")`, 'm'), `clippy::${lint} denied`);
  }
  const crate = tomlSections(read(path.join(mcpCrateDir(), 'Cargo.toml')));
  assert.match(crate.lints || '', /workspace\s*=\s*true/, 'the crate has [lints] workspace = true');
});

test('#341 native/clippy.toml allows unwrap, expect and panic in tests', () => {
  assert.ok(exists('native/clippy.toml'), 'native/clippy.toml exists');
  const text = read('native/clippy.toml');
  for (const opt of ['allow-unwrap-in-tests', 'allow-expect-in-tests', 'allow-panic-in-tests']) {
    assert.match(text, new RegExp(`^\\s*${opt}\\s*=\\s*true`, 'm'), opt);
  }
});

test('#341 Cargo.lock is committed and the target folder is not', () => {
  assert.ok(exists('native/Cargo.lock'), 'native/Cargo.lock exists');
  const ignored = (p) => spawnSync('git', ['-C', root, 'check-ignore', '-q', '--no-index', p]).status === 0;
  assert.equal(ignored('native/Cargo.lock'), false, 'native/Cargo.lock is not gitignored');
  assert.equal(ignored('native/target/release/multiagent-mcp'), true, 'native/target/ is gitignored');
});

// The direct (non-dev) dependencies of the crate and the workspace.
function directDependencies() {
  const names = new Set();
  const add = (sections) => {
    for (const [h, body] of Object.entries(sections)) {
      const table = /^(?:workspace\.)?dependencies\.([A-Za-z0-9_-]+)$/.exec(h);
      if (table) { names.add(table[1]); continue; }
      if (h !== 'dependencies' && h !== 'workspace.dependencies') continue;
      for (const line of body.split('\n')) {
        const m = /^\s*([A-Za-z0-9_-]+)(?:\.[A-Za-z]+)?\s*=/.exec(line);
        if (m) names.add(m[1]);
      }
    }
  };
  add(tomlSections(read('native/Cargo.toml')));
  add(tomlSections(read(path.join(mcpCrateDir(), 'Cargo.toml'))));
  return [...names].sort();
}

test('#341 every Rust dependency is named in THIRD_PARTY_NOTICES.md', () => {
  assert.ok(mcpCrateDir(), 'the multiagent-mcp crate exists');
  const notices = read('THIRD_PARTY_NOTICES.md');
  const missing = directDependencies().filter((d) => !new RegExp(`(^|[^\\w-])${d}([^\\w-]|$)`).test(notices));
  assert.deepEqual(missing, [], 'Rust dependencies missing from THIRD_PARTY_NOTICES.md');
});

// ---- packaging and release ------------------------------------------------------------------------

test('#341 scripts/package.js builds multiagent-mcp in release for each release target and puts it in resources/bin', () => {
  const src = read('scripts/package.js');
  for (const s of ['cargo', '--release', 'multiagent-mcp', 'bin']) assert.ok(src.includes(s), s);
  // the four release legs (scripts/release-assets.js): Windows x64, macOS arm64 and x64, Linux x64
  for (const triple of ['x86_64-pc-windows-msvc', 'aarch64-apple-darwin', 'x86_64-apple-darwin', 'x86_64-unknown-linux-gnu']) {
    assert.ok(src.includes(triple), `target ${triple}`);
  }
  // the JS fallback stays unpacked (a dev checkout without cargo, an older build)
  assert.match(src, /src\/supervisor-mcp\.js/);
});

const pkgScript = () => require('../scripts/package.js');
const PACK_LEGS = [['win32', 'x64'], ['darwin', 'arm64'], ['darwin', 'x64'], ['linux', 'x64']];

test('#341 packagerOptions: app.asar gets nothing from native/ (sources, Cargo files, cargo\'s target/)', () => {
  const { packagerOptions } = pkgScript();
  const out = path.join(root, '.scratch', 'pkg-out');
  for (const [platform, arch] of PACK_LEGS) {
    const { ignore } = packagerOptions({ platform, arch, out });
    const ignored = (p) => ignore.some((re) => re.test(p));
    for (const p of ['/native', '/native/Cargo.toml', '/native/Cargo.lock', '/native/target/release/multiagent-mcp.exe', '/native/multiagent-mcp/src/main.rs']) {
      assert.equal(ignored(p), true, `${platform}-${arch}: ${p} is kept in app.asar`);
    }
    for (const p of ['/src/supervisor-mcp.js', '/src/main.js', '/nativeish.js', '/src/native/x.js']) {
      assert.equal(ignored(p), false, `${platform}-${arch}: ${p} is dropped`);
    }
  }
});

test('#341 packagerOptions: the folder buildNative fills is an extra resource named bin, one per platform and arch', () => {
  const { packagerOptions, nativeBinDir } = pkgScript();
  const out = path.join(root, '.scratch', 'pkg-out');
  const dirs = new Set();
  for (const [platform, arch] of PACK_LEGS) {
    const extra = [].concat(packagerOptions({ platform, arch, out }).extraResource || []);
    const dir = nativeBinDir({ platform, arch, out });
    assert.ok(extra.includes(dir), `${platform}-${arch}: extraResource has ${dir}`);
    assert.equal(path.basename(dir), 'bin', 'packaged as resources/bin/');
    dirs.add(dir);
  }
  assert.equal(dirs.size, PACK_LEGS.length, 'each leg has its own folder');
});

// buildNative with a stubbed process runner (the boundary) and a fake cargo target folder.
function nativeBuild(t, { platform, arch, reply = () => ({ status: 0 }) }) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'native-341-'));
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
      const file = platform === 'win32' ? 'multiagent-mcp.exe' : 'multiagent-mcp';
      const dir = path.join(tmp, 'target', triple, 'release');
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, file), `binary for ${triple}`);
    }
    return reply(cmd, args);
  };
  return { out: path.join(tmp, 'out'), calls, run };
}

test('#341 buildNative: builds multiagent-mcp in release for the leg\'s target and copies it into the bin folder', (t) => {
  const { buildNative, nativeBinDir } = pkgScript();
  for (const [platform, arch, triple, file] of [
    ['win32', 'x64', 'x86_64-pc-windows-msvc', 'multiagent-mcp.exe'],
    ['linux', 'x64', 'x86_64-unknown-linux-gnu', 'multiagent-mcp'],
  ]) {
    const b = nativeBuild(t, { platform, arch });
    const dir = buildNative({ platform, arch, out: b.out }, b.run);
    assert.equal(dir, nativeBinDir({ platform, arch, out: b.out }));
    assert.deepEqual(fs.readdirSync(dir), [file]);
    assert.equal(fs.readFileSync(path.join(dir, file), 'utf8'), `binary for ${triple}`);
    const cargo = b.calls.find((c) => c[0] === 'cargo');
    for (const a of ['build', '--release', '--target', triple, 'multiagent-mcp']) assert.ok(cargo.includes(a), `${platform}: cargo ${a}`);
  }
});

test('#341 buildNative: macOS signs the binary ad hoc when packaged on a Mac, never elsewhere', (t) => {
  const { buildNative } = pkgScript();
  const b = nativeBuild(t, { platform: 'darwin', arch: 'arm64' });
  const dir = buildNative({ platform: 'darwin', arch: 'arm64', out: b.out }, b.run);
  const sign = b.calls.filter((c) => c[0] === 'codesign');
  if (process.platform === 'darwin') {
    assert.equal(sign.length, 1);
    assert.ok(sign[0].includes('-') && sign[0].includes(path.join(dir, 'multiagent-mcp')), JSON.stringify(sign));
  } else {
    assert.equal(sign.length, 0, 'no codesign off macOS');
  }
  const linux = nativeBuild(t, { platform: 'linux', arch: 'x64' });
  buildNative({ platform: 'linux', arch: 'x64', out: linux.out }, linux.run);
  assert.equal(linux.calls.some((c) => c[0] === 'codesign'), false, 'Linux is never signed');
});

test('#341 buildNative: a command that cannot start names the Rust toolchain; a failing build gives its exit status only', (t) => {
  const { buildNative } = pkgScript();
  const missing = nativeBuild(t, { platform: 'linux', arch: 'x64', reply: () => ({ error: new Error('spawn rustup ENOENT'), status: null }) });
  assert.throws(() => buildNative({ platform: 'linux', arch: 'x64', out: missing.out }, missing.run), (e) => {
    assert.match(e.message, /ENOENT/);
    assert.match(e.message, /Rust toolchain/);
    return true;
  });
  const failing = nativeBuild(t, { platform: 'linux', arch: 'x64', reply: (cmd) => ({ status: cmd === 'cargo' ? 101 : 0 }) });
  assert.throws(() => buildNative({ platform: 'linux', arch: 'x64', out: failing.out }, failing.run), (e) => {
    assert.match(e.message, /^cargo build\b/);
    assert.match(e.message, /exit status 101/);
    assert.doesNotMatch(e.message, /Rust toolchain/);
    return true;
  });
});

const jobsOf = (file) => Object.entries(yaml.load(read(file)).jobs).map(([name, j]) => ({ name, steps: j.steps || [] }));
const isRustSetup = (s) => /rust-toolchain|rustup/.test(`${s.uses || ''} ${s.run || ''}`);

test('#341 the release workflows install Rust before packaging', () => {
  for (const file of ['.github/workflows/deploy.yml', '.github/workflows/preview.yml']) {
    const jobs = jobsOf(file).filter((j) => j.steps.some((s) => /npm run package/.test(s.run || '')));
    assert.ok(jobs.length > 0, `${file} packages the app`);
    for (const j of jobs) {
      const pkg = j.steps.findIndex((s) => /npm run package/.test(s.run || ''));
      const rust = j.steps.findIndex(isRustSetup);
      assert.ok(rust >= 0 && rust < pkg, `${file} job ${j.name}: a Rust toolchain step before npm run package`);
    }
  }
});

test('#341 CI: the test job installs stable Rust (cached) and runs fmt, clippy -D warnings and cargo test before npm test', () => {
  const jobs = jobsOf('.github/workflows/ci.yml').filter((j) => j.steps.some((s) => /^npm test\b/.test((s.run || '').trim())));
  assert.equal(jobs.length, 1, 'one CI job runs npm test');
  const { steps } = jobs[0];
  const at = (pred) => steps.findIndex(pred);
  const npmTest = at((s) => /^npm test\b/.test((s.run || '').trim()));
  const runs = (re) => at((s) => re.test(s.run || ''));
  const checks = {
    toolchain: at((s) => isRustSetup(s) && /stable/.test(JSON.stringify(s))),
    cache: at((s) => /rust-cache|actions\/cache/.test(s.uses || '')),
    fmt: runs(/cargo fmt\b[^\n]*--check/),
    clippy: runs(/cargo clippy\b[^\n]*-D warnings/),
    test: runs(/cargo test\b/),
  };
  for (const [name, i] of Object.entries(checks)) assert.ok(i >= 0 && i < npmTest, `${name}: a step before npm test (index ${i}, npm test ${npmTest})`);
  for (const name of ['fmt', 'clippy', 'test']) {
    assert.equal(steps[checks[name]].if, undefined, `cargo ${name} runs on every OS of the matrix (no if:)`);
  }
});

// ---- docs ----------------------------------------------------------------------------------------

test('#341 docs: environment.md describes the Rust toolchain and CONTRIBUTING.md says cargo is optional for JS-only changes', () => {
  const env = read('docs/agents/environment.md');
  for (const s of ['rustup', 'cargo', 'MSVC', 'native/']) assert.ok(env.includes(s), `environment.md: ${s}`);
  const contributing = read('CONTRIBUTING.md');
  assert.ok(contributing.includes('cargo'), 'CONTRIBUTING.md mentions cargo');
  assert.match(contributing, /optional/i);
});
