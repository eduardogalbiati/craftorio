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
