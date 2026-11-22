// Acceptance tests for #317 (macOS and Linux builds next to the Windows one). Two kinds of checks:
// - apps/desktop/scripts/package.js through its exports: it runs the packager only when run directly
//   (`require.main === module`) and exports parseArgs(argv, host), executablePath(buildPath, platform)
//   and packagerOptions({ platform, arch, out }) (the @electron/packager options);
// - the repository's files (the release workflows, ci.yml, the icons, README, environment.md).
// Nothing here packages, launches the app or calls a model.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

const root = path.join(__dirname, '..', '..', '..');
const abs = (p) => path.join(root, p);
const read = (p) => fs.readFileSync(abs(p), 'utf8');
const flat = (s) => s.replace(/\s+/g, ' ');

// Requiring today's script would start a real packaging: load it only once it guards its main.
function load() {
  const src = read('apps/desktop/scripts/package.js');
  if (!/require\.main\s*===\s*module/.test(src)) {
    throw new Error('apps/desktop/scripts/package.js must run the packager only when run directly (require.main === module) and export its helpers');
  }
  return require('../scripts/package.js');
}

const PLATFORMS = ['win32', 'darwin', 'linux'];

// ---- npm run package: platform and arch arguments -----------------------------------------------

test('#317 parseArgs: no argument builds for the current machine into dist/', () => {
  const { parseArgs } = load();
  for (const host of [{ platform: 'win32', arch: 'x64' }, { platform: 'darwin', arch: 'arm64' }, { platform: 'linux', arch: 'x64' }]) {
    const o = parseArgs([], host);
    assert.equal(o.platform, host.platform);
    assert.equal(o.arch, host.arch);
    assert.equal(o.out, path.join(root, 'dist'));
  }
});

test('#317 parseArgs: --platform and --arch override the current machine (space or = form)', () => {
  const { parseArgs } = load();
  const host = { platform: 'win32', arch: 'x64' };
  const a = parseArgs(['--platform', 'darwin', '--arch', 'arm64'], host);
  assert.deepEqual([a.platform, a.arch], ['darwin', 'arm64']);
  const b = parseArgs(['--platform=linux', '--arch=x64'], host);
  assert.deepEqual([b.platform, b.arch], ['linux', 'x64']);
  const c = parseArgs(['--arch', 'arm64'], host);
  assert.deepEqual([c.platform, c.arch], ['win32', 'arm64'], 'only the arch given: the platform stays the machine\'s');
});

test('#317 parseArgs: the output folder is still the positional argument', () => {
  const { parseArgs } = load();
  const out = path.join(root, '.scratch', 'pkg-out');
  const o = parseArgs(['--platform', 'linux', out], { platform: 'win32', arch: 'x64' });
  assert.equal(o.out, path.resolve(out));
  assert.equal(o.platform, 'linux');
});

test('#317 parseArgs: an unknown platform or arch is refused with a message naming it', () => {
  const { parseArgs } = load();
  const host = { platform: 'win32', arch: 'x64' };
  assert.throws(() => parseArgs(['--platform', 'solaris'], host), /solaris/);
  assert.throws(() => parseArgs(['--arch', 'mips'], host), /mips/);
});

test('#317 parseArgs: an unknown option is refused, not taken as the output folder', () => {
  const { parseArgs } = load();
  assert.throws(() => parseArgs(['--plaform', 'linux'], { platform: 'win32', arch: 'x64' }), /--plaform/);
});

// ---- hardening targets the right executable per OS ----------------------------------------------

test('#317 executablePath: the .exe on Windows, the binary inside the .app on macOS, the ELF on Linux', () => {
  const { executablePath } = load();
  const build = path.join(root, 'dist', 'Craftorio-x');
  assert.equal(executablePath(build, 'win32'), path.join(build, 'Craftorio.exe'));
  assert.equal(executablePath(build, 'darwin'), path.join(build, 'Craftorio.app', 'Contents', 'MacOS', 'Craftorio'));
  assert.equal(executablePath(build, 'linux'), path.join(build, 'Craftorio'));
});

test('#317 package.js: on macOS the ad-hoc signature is reset after the fuses flip', () => {
  const src = read('apps/desktop/scripts/package.js');
  assert.match(src, /resetAdHocDarwinSignature/);
  assert.ok(src.indexOf('resetAdHocDarwinSignature') > src.indexOf('flipFuses'), 'the reset comes with the fuses, after flipFuses');
});

// #480 (SEC-15): the cookies of the remote engine's session (its token) are encrypted on disk
test('#480 package.js: the fuses turn cookie encryption on', () => {
  const src = read('apps/desktop/scripts/package.js');
  assert.match(src, /\[FuseV1Options\.EnableCookieEncryption\]:\s*true/);
});

// ---- packager options per OS ---------------------------------------------------------------------

test('#317 packagerOptions: the target platform and arch, and the same ignore and unpack lists on every OS', () => {
  const { packagerOptions } = load();
  const opts = PLATFORMS.map((platform) => packagerOptions({ platform, arch: 'x64', out: path.join(root, 'dist') }));
  opts.forEach((o, i) => {
    assert.equal(o.platform, PLATFORMS[i]);
    assert.equal(o.arch, 'x64');
    assert.equal(o.name, 'Craftorio');
    assert.ok(Array.isArray(o.ignore) && o.ignore.length > 0, `${PLATFORMS[i]}: an ignore list`);
  });
  const ignores = opts.map((o) => o.ignore.map(String));
  assert.deepEqual(ignores[1], ignores[0], 'darwin ignore = win32 ignore');
  assert.deepEqual(ignores[2], ignores[0], 'linux ignore = win32 ignore');
  const unpacks = opts.map((o) => JSON.stringify(o.asar));
  assert.equal(unpacks[1], unpacks[0], 'darwin asar = win32 asar');
  assert.equal(unpacks[2], unpacks[0], 'linux asar = win32 asar');
  assert.match(unpacks[0], /node-pty/, 'node-pty stays unpacked from the asar');
});

test('#482 packagerOptions: the afterCopy hook puts THIRD_PARTY_LICENSES.txt in the package\'s resources folder, and resources/ stays out of app.asar', async (t) => {
  const { packagerOptions } = load();
  const os = require('os');
  for (const platform of PLATFORMS) {
    const o = packagerOptions({ platform, arch: 'x64', out: path.join(root, 'dist') });
    assert.ok(Array.isArray(o.afterCopy) && o.afterCopy.length > 0, `${platform}: an afterCopy hook`);
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pkg-482-'));
    t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
    const buildPath = path.join(tmp, 'resources', 'app');
    fs.mkdirSync(buildPath, { recursive: true });
    for (const hook of o.afterCopy) await hook({ buildPath, electronVersion: '0.0.0', platform, arch: 'x64' });
    const copied = path.join(tmp, 'resources', 'THIRD_PARTY_LICENSES.txt');
    assert.ok(fs.existsSync(copied), `${platform}: resources/THIRD_PARTY_LICENSES.txt next to app/`);
    assert.equal(fs.readFileSync(copied, 'utf8'), read('resources/THIRD_PARTY_LICENSES.txt'), `${platform}: the committed file`);
    assert.equal(fs.existsSync(path.join(buildPath, 'THIRD_PARTY_LICENSES.txt')), false, `${platform}: not inside app/`);
    const ignored = (file) => o.ignore.some((re) => (re instanceof RegExp ? re.test(file) : String(re) === file));
    assert.equal(ignored('/resources/THIRD_PARTY_LICENSES.txt'), true, `${platform}: /resources ignored by app.asar`);
  }
});

test('#317 packagerOptions (macOS): a bundle id and the microphone usage description for voice input', () => {
  const { packagerOptions } = load();
  for (const arch of ['arm64', 'x64']) {
    const o = packagerOptions({ platform: 'darwin', arch, out: path.join(root, 'dist') });
    assert.equal(typeof o.appBundleId, 'string');
    assert.match(o.appBundleId, /^[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$/, 'a reverse-DNS bundle id');
    assert.ok(o.extendInfo && typeof o.extendInfo === 'object', 'extendInfo (Info.plist entries)');
    assert.match(String(o.extendInfo.NSMicrophoneUsageDescription), /^Voice input transcribes what you say into the task field\.?$/);
  }
});

// The packager adds the OS's extension when `icon` has none.
function iconFile(icon, ext) {
  assert.equal(typeof icon, 'string', 'an icon path');
  return path.extname(icon) ? icon : `${icon}${ext}`;
}

test('#317 packagerOptions: an icon per OS that exists in the repository (.ico, .icns, .png)', () => {
  const { packagerOptions } = load();
  for (const [platform, ext] of [['win32', '.ico'], ['darwin', '.icns'], ['linux', '.png']]) {
    const file = iconFile(packagerOptions({ platform, arch: 'x64', out: path.join(root, 'dist') }).icon, ext);
    assert.equal(path.extname(file), ext, `${platform}: ${file}`);
    const full = path.resolve(root, file);
    assert.ok(fs.existsSync(full), `${platform}: ${full} exists`);
    assert.ok(fs.statSync(full).size > 0, `${platform}: ${full} is not empty`);
  }
});

// ---- release workflows -----------------------------------------------------------------------------

// Every runner a workflow's jobs use (runs-on, with matrix values expanded).
function runners(file) {
  const wf = yaml.load(read(file));
  const out = new Set();
  const strings = (v) => (typeof v === 'string' ? [v] : Array.isArray(v) ? v.flatMap(strings) : v && typeof v === 'object' ? Object.values(v).flatMap(strings) : []);
  for (const job of Object.values(wf.jobs || {})) {
    for (const r of strings(job['runs-on'])) {
      if (r.includes('matrix.')) strings(job.strategy && job.strategy.matrix).forEach((s) => out.add(s));
      else out.add(r);
    }
  }
  return out;
}

test('#317 deploy.yml: release jobs run on windows-latest, macos-latest and ubuntu-latest', () => {
  const r = runners('.github/workflows/deploy.yml');
  for (const os of ['windows-latest', 'macos-latest', 'ubuntu-latest']) assert.ok(r.has(os), `${os} in ${[...r].join(', ')}`);
});

test('#317 deploy.yml: the assets carry the OS and architecture (Windows zip, macOS dmg/zip, Linux AppImage and tar.gz)', () => {
  const text = read('.github/workflows/deploy.yml');
  assert.match(text, /win32|windows/i);
  assert.match(text, /darwin|mac/i);
  assert.match(text, /linux/i);
  assert.match(text, /arm64|universal/, 'a macOS arm64 (or universal) build');
  assert.match(text, /x64/);
  assert.match(text, /\.AppImage/);
  assert.match(text, /\.tar\.gz/);
  assert.match(text, /\.dmg|darwin[^\n]*\.zip|mac[^\n]*\.zip/i);
});

test('#317 deploy.yml: the test skip on a CI-tested merge (ci/tested status) still works', () => {
  const text = read('.github/workflows/deploy.yml');
  assert.match(text, /scripts\/ci-plan\.js tested/);
  assert.match(text, /steps\.plan\.outputs\.tested != 'true'/);
});

test('#317 deploy.yml: each release job smoke-tests the packaged app in simulation (xvfb-run on Linux)', () => {
  const text = read('.github/workflows/deploy.yml');
  assert.match(text, /xvfb-run/);
  assert.match(text, /smoke/i);
  const wf = yaml.load(text);
  const steps = Object.values(wf.jobs).flatMap((j) => j.steps || []);
  const smoke = steps.filter((s) => /smoke/i.test(`${s.name || ''} ${s.run || ''}`));
  assert.ok(smoke.length > 0, 'a smoke step');
  const env = (s) => JSON.stringify({ ...(s.env || {}) }) + JSON.stringify(Object.values(wf.jobs).map((j) => j.env || {})) + JSON.stringify(wf.env || {});
  assert.ok(smoke.every((s) => /MULTIAGENT_SIMULATION_ONLY/.test(env(s) + (s.run || ''))), 'the smoke runs with MULTIAGENT_SIMULATION_ONLY');
  assert.ok(smoke.every((s) => !s['continue-on-error']), 'a smoke failure stops the release');
});

test('#317 preview.yml: an input chooses the OS, Windows by default, macOS and Linux available', () => {
  const text = read('.github/workflows/preview.yml');
  const wf = yaml.load(text);
  const inputs = ((wf.on || wf[true] || {}).workflow_dispatch || {}).inputs || {};
  const osInput = Object.entries(inputs).find(([, v]) => /win/i.test(String(v && v.default)));
  assert.ok(osInput, `an input defaulting to Windows among ${Object.keys(inputs).join(', ')}`);
  assert.ok(inputs.pr_number, 'pr_number input kept');
  const r = runners('.github/workflows/preview.yml');
  for (const os of ['macos-latest', 'ubuntu-latest']) assert.ok(r.has(os) || text.includes(os), `${os} reachable from preview.yml`);
});

// ---- UI tests on Linux in CI --------------------------------------------------------------------------

test('#317 ci.yml: the UI screenshot test and the E2E smoke also run on Ubuntu under xvfb-run', () => {
  const ci = yaml.load(read('.github/workflows/ci.yml'));
  const steps = Object.values(ci.jobs).flatMap((j) => j.steps || []);
  for (const [what, re] of [['screenshot test', /test\/screenshot\.test\.js/], ['E2E smoke', /test:e2e/]]) {
    const own = steps.filter((s) => re.test(s.run || ''));
    assert.ok(own.length > 0, `${what}: a step`);
    const linux = own.filter((s) => !/runner\.os == 'Windows'/.test(String(s.if || '')) && /xvfb-run/.test(s.run || ''));
    assert.ok(linux.length > 0, `${what}: a step that runs on Linux under xvfb-run`);
  }
});

// ---- docs ----------------------------------------------------------------------------------------------

function readmeSection(match) {
  const parts = read('README.md').split(/^(?=## )/m);
  return parts.find((p) => match.test(p.split('\n')[0])) || null;
}

test('#317 README: an Install section per OS with the macOS Gatekeeper step and chmod +x for the AppImage', () => {
  const s = readmeSection(/^## Install/);
  assert.ok(s, 'README has a "## Install" section');
  const text = flat(s);
  for (const os of ['Windows', 'macOS', 'Linux']) assert.ok(text.includes(os), os);
  assert.match(text, /Open Anyway/i);
  assert.ok(text.includes('xattr -dr com.apple.quarantine'), 'xattr step');
  assert.ok(text.includes('chmod +x'), 'chmod +x');
  assert.match(text, /AppImage/);
});

test('#317 README: says how to replace the placeholder icon', () => {
  const says = /replac\w*[^.]{0,120}icon|icon[^.]{0,120}replac/i.test(flat(read('README.md')));
  assert.ok(says, 'README explains how to replace the icon');
});

test('#317 environment.md: documents packaging per OS and the release jobs', () => {
  const text = flat(read('docs/agents/environment.md'));
  assert.ok(text.includes('--platform'), 'npm run package --platform');
  assert.ok(text.includes('deploy.yml'), 'the release workflow');
  assert.match(text, /macos-latest/);
  assert.match(text, /ubuntu-latest/);
  assert.match(text, /AppImage/);
});
