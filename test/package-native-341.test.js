// scripts/package.js buildNative (#341): builds the cargo workspace for the release target and stages
// its binaries in the folder packaged as resources/bin/. cargo is faked: nothing is compiled here.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { buildNative, nativeBinDir, packagerOptions, RUST_TARGETS } = require('../scripts/package');

function scratch(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pkg-native-341-'));
  const saved = process.env.CARGO_TARGET_DIR;
  process.env.CARGO_TARGET_DIR = path.join(dir, 'target');
  t.after(() => {
    if (saved === undefined) delete process.env.CARGO_TARGET_DIR; else process.env.CARGO_TARGET_DIR = saved;
    fs.rmSync(dir, { recursive: true, force: true });
  });
  return dir;
}

test('#341 buildNative: adds the target, builds in release, locked, and stages the binary for resources/bin', (t) => {
  const dir = scratch(t);
  const opts = { platform: 'win32', arch: 'x64', out: path.join(dir, 'dist') };
  const calls = [];
  const run = (cmd, args) => {
    calls.push([cmd, ...args].join(' '));
    if (cmd === 'cargo') {
      const built = path.join(process.env.CARGO_TARGET_DIR, 'x86_64-pc-windows-msvc', 'release');
      fs.mkdirSync(built, { recursive: true });
      fs.writeFileSync(path.join(built, 'multiagent-mcp.exe'), 'bin');
    }
    return { status: 0 };
  };
  const staged = buildNative(opts, run);
  assert.equal(staged, nativeBinDir(opts));
  assert.equal(path.basename(staged), 'bin');
  assert.equal(fs.readFileSync(path.join(staged, 'multiagent-mcp.exe'), 'utf8'), 'bin');
  assert.equal(calls[0], 'rustup target add x86_64-pc-windows-msvc');
  assert.match(calls[1], /^cargo build --release --locked --manifest-path .*Cargo\.toml --target x86_64-pc-windows-msvc -p multiagent-mcp$/);
  assert.deepEqual(packagerOptions(opts).extraResource, [staged]);
});

test('#341 buildNative: without cargo, packaging stops and says the Rust toolchain is needed', (t) => {
  const dir = scratch(t);
  const run = (cmd) => (cmd === 'cargo' ? { status: null, error: new Error('spawnSync cargo ENOENT') } : { status: 0 });
  assert.throws(() => buildNative({ platform: 'linux', arch: 'x64', out: dir }, run), /cargo build .*ENOENT.*Rust toolchain/);
});

test('#341 RUST_TARGETS: a target for every platform and arch package.js accepts', () => {
  for (const platform of ['darwin', 'linux', 'win32']) {
    for (const arch of ['arm64', 'x64']) assert.ok(RUST_TARGETS[`${platform}-${arch}`], `${platform}-${arch}`);
  }
});
