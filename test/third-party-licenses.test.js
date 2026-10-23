// #482: the third-party licenses the packaged app ships. scripts/third-party-licenses.js
// (npm run licenses) writes resources/THIRD_PARTY_LICENSES.txt from node_modules; these tests keep
// the committed file in step with the dependencies, check collect() on a fixture tree, and check
// that THIRD_PARTY_NOTICES.md names every Rust crate the native sidecars build with (cargo tree).

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const root = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
// line endings normalised: git may check the .txt out with CRLF on Windows
const lf = (s) => s.replace(/\r\n/g, '\n');
const LICENSES = 'resources/THIRD_PARTY_LICENSES.txt';
const load = () => require('../scripts/third-party-licenses.js');
const pkg = () => JSON.parse(read('package.json'));

test('#482 resources/THIRD_PARTY_LICENSES.txt is up to date with node_modules (run npm run licenses after a dependency change)', () => {
  const { collect, render, BUNDLED } = load();
  const expected = render(collect([...Object.keys(pkg().dependencies || {}), ...BUNDLED]));
  assert.ok(lf(read(LICENSES)) === lf(expected), `${LICENSES} is out of date: run npm run licenses`);
});

test('#482 THIRD_PARTY_LICENSES.txt has an entry for every production dependency and the bundled three and react', () => {
  const { BUNDLED } = load();
  const titles = new Set(lf(read(LICENSES)).split('\n').map((l) => l.split(' ')[0]));
  const names = [...Object.keys(pkg().dependencies || {}), ...BUNDLED];
  assert.ok(names.includes('three') && names.includes('react'), 'three and react are bundled');
  assert.deepEqual(names.filter((n) => !titles.has(n)), [], 'packages without an entry');
});

test('#482 THIRD_PARTY_LICENSES.txt gives dompurify its dual license', () => {
  const text = lf(read(LICENSES));
  const block = text.split(/^-{80}$/m).find((b) => /^\s*dompurify \d/.test(b));
  assert.ok(block, 'a dompurify entry');
  assert.match(block, /License: .*MPL-2\.0.*Apache-2\.0|License: .*Apache-2\.0.*MPL-2\.0/);
});

// a fixture node_modules tree in a temp folder
function fixture(t, packages) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'licenses-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  for (const [rel, { json, files = {} }] of Object.entries(packages)) {
    const p = path.join(dir, rel);
    fs.mkdirSync(p, { recursive: true });
    fs.writeFileSync(path.join(p, 'package.json'), JSON.stringify(json));
    for (const [f, body] of Object.entries(files)) fs.writeFileSync(path.join(p, f), body);
  }
  return dir;
}

test('#482 collect: follows dependencies (nested node_modules first), skips a missing optional one, sorts and reads the license files', (t) => {
  const { collect, render } = load();
  const base = fixture(t, {
    'node_modules/zeta': { json: { name: 'zeta', version: '2.0.0', license: 'MIT', dependencies: { alpha: '1' }, optionalDependencies: { 'not-installed': '1' } }, files: { LICENSE: 'zeta license text', 'README.md': 'not a license' } },
    'node_modules/zeta/node_modules/alpha': { json: { name: 'alpha', version: '1.0.0', license: { type: 'ISC' } }, files: { 'LICENSE.md': 'nested alpha license' } },
    'node_modules/alpha': { json: { name: 'alpha', version: '3.0.0', license: 'Apache-2.0' } },
  });
  const got = collect(['zeta', 'alpha'], base);
  assert.deepEqual(got.map((p) => `${p.name}@${p.version} ${p.license}`), ['alpha@1.0.0 ISC', 'alpha@3.0.0 Apache-2.0', 'zeta@2.0.0 MIT']);
  assert.equal(got.find((p) => p.name === 'zeta').text, 'zeta license text');
  assert.equal(got.find((p) => p.version === '1.0.0').text, 'nested alpha license');
  const out = render(got);
  assert.ok(out.includes('zeta 2.0.0\nLicense: MIT\n\nzeta license text'), 'an entry: name version, license, text');
  assert.ok(out.includes('alpha 3.0.0\nLicense: Apache-2.0\n\n(no license file'), 'a package without a license file says so');
});

test('#482 collect: a package without a license field is UNKNOWN, a missing root name is skipped', (t) => {
  const { collect } = load();
  const base = fixture(t, { 'node_modules/bare': { json: { name: 'bare', version: '0.1.0' } } });
  assert.deepEqual(collect(['bare', 'absent'], base).map((p) => `${p.name} ${p.license}`), ['bare UNKNOWN']);
});

// ---- Rust: every crate built into the sidecars on a release target ------------------------------

const TARGETS = ['x86_64-pc-windows-msvc', 'x86_64-apple-darwin', 'aarch64-apple-darwin', 'x86_64-unknown-linux-gnu', 'aarch64-unknown-linux-gnu'];

function cargoTree(target) {
  return execFileSync('cargo', ['tree', '--manifest-path', path.join(root, 'native', 'Cargo.toml'), '--workspace', '--offline',
    '-e', 'normal,no-proc-macro', '--prefix', 'none', '--format', '{p}', '--target', target], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

test('#482 THIRD_PARTY_NOTICES.md names every crate cargo tree builds into the native sidecars on each release target', (t) => {
  const crates = new Set();
  for (const target of TARGETS) {
    let out;
    try { out = cargoTree(target); } catch (e) {
      t.skip(`cargo tree unavailable (no cargo or no offline crate cache): ${String(e.stderr || e.message).split('\n')[0]}`);
      return;
    }
    for (const line of out.split('\n')) {
      const m = /^([A-Za-z0-9_-]+) v\S+( \(\*\))?$/.exec(line.trim());
      if (m) crates.add(m[1]); // workspace members have a "(path)" suffix and are skipped
    }
  }
  assert.ok(crates.has('serde_json'), 'cargo tree lists the dependencies');
  const notices = read('THIRD_PARTY_NOTICES.md');
  const missing = [...crates].sort().filter((c) => !new RegExp(`(^|[^\\w-])${c}([^\\w-]|$)`).test(notices));
  assert.deepEqual(missing, [], 'crates built into the sidecars but missing from THIRD_PARTY_NOTICES.md');
});
