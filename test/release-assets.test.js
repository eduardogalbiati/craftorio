// scripts/release-assets.js: the release file names per OS (the names deploy.yml uploads).
// Nothing here packages or launches the app.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const yaml = require('js-yaml');
const { assetNames } = require('../scripts/release-assets');

const root = path.join(__dirname, '..');

test('release assets: a zip on Windows and macOS, an AppImage and a tar.gz on Linux, named with the OS and arch', () => {
  assert.deepEqual(assetNames({ platform: 'win32', arch: 'x64' }), ['MultiagentOrchestrator-win32-x64.zip']);
  assert.deepEqual(assetNames({ platform: 'darwin', arch: 'arm64' }), ['MultiagentOrchestrator-darwin-arm64.zip']);
  assert.deepEqual(assetNames({ platform: 'linux', arch: 'x64' }), ['MultiagentOrchestrator-linux-x64.tar.gz', 'MultiagentOrchestrator-linux-x64.AppImage']);
});

test('release assets: every deploy.yml build uploads exactly the files the script writes', () => {
  const wf = yaml.load(fs.readFileSync(path.join(root, '.github/workflows/deploy.yml'), 'utf8'));
  for (const leg of wf.jobs.build.strategy.matrix.include) {
    const uploaded = leg.assets.trim().split('\n').sort();
    assert.deepEqual(uploaded, assetNames(leg).sort(), `${leg.platform} ${leg.arch}`);
  }
});

// #557: the publish job's SHA256SUMS step, run with bash (as on the runner: `bash -e`) on fake assets
const SHA_ABC = 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad';     // sha256("abc")
const SHA_EMPTY = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';   // sha256("")
function runSumsStep(t, files) {
  const wf = yaml.load(fs.readFileSync(path.join(root, '.github/workflows/deploy.yml'), 'utf8'));
  const step = wf.jobs.publish.steps.find((s) => /sha256sum/.test(s.run || ''));
  assert.ok(step, 'the publish job has a sha256sum step');
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'sums-557-'));
  const runnerTemp = fs.mkdtempSync(path.join(os.tmpdir(), 'runner-557-'));
  t.after(() => { fs.rmSync(work, { recursive: true, force: true }); fs.rmSync(runnerTemp, { recursive: true, force: true }); });
  fs.mkdirSync(path.join(work, 'assets'));
  for (const [name, body] of Object.entries(files)) fs.writeFileSync(path.join(work, 'assets', name), body);
  const r = spawnSync('bash', ['-e', '-c', step.run], { cwd: work, env: { ...process.env, RUNNER_TEMP: runnerTemp }, encoding: 'utf8' });
  if (r.error) { t.skip(`bash unavailable: ${r.error.code}`); return null; }
  const read = (p) => (fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null);
  const notes = fs.readdirSync(runnerTemp).map((f) => read(path.join(runnerTemp, f))).filter((s) => s !== null).join('\n');
  return { status: r.status, stderr: r.stderr, sums: read(path.join(work, 'assets', 'SHA256SUMS')), notes };
}

test('#557 release assets: SHA256SUMS has one "<hash>  <file name>" line per package and nothing else', (t) => {
  const out = runSumsStep(t, { 'MultiagentOrchestrator-win32-x64.zip': 'abc', 'MultiagentOrchestrator-linux-x64.tar.gz': '' });
  if (!out) return;
  assert.equal(out.status, 0, out.stderr);
  // "<hash>  <name>" on the Ubuntu runner; Git Bash on Windows writes binary mode "<hash> *<name>",
  // which `sha256sum -c` reads the same
  const lines = out.sums.trim().split('\n').map((l) => l.replace(/\r$/, '').replace(/^([0-9a-f]{64}) \*/, '$1  ')).sort();
  assert.deepEqual(lines, [
    `${SHA_ABC}  MultiagentOrchestrator-win32-x64.zip`,
    `${SHA_EMPTY}  MultiagentOrchestrator-linux-x64.tar.gz`,
  ]);
});

test('#557 release assets: the release notes list each package with its SHA-256', (t) => {
  const out = runSumsStep(t, { 'MultiagentOrchestrator-win32-x64.zip': 'abc', 'MultiagentOrchestrator-linux-x64.tar.gz': '' });
  if (!out) return;
  assert.equal(out.status, 0, out.stderr);
  const row = (name) => out.notes.split('\n').find((l) => l.includes(name)) || '';
  assert.equal(row('MultiagentOrchestrator-win32-x64.zip').includes(SHA_ABC), true, 'win32 zip row has its hash');
  assert.equal(row('MultiagentOrchestrator-linux-x64.tar.gz').includes(SHA_EMPTY), true, 'linux tar.gz row has its hash');
  assert.equal(row('SHA256SUMS  ').length, 0, 'SHA256SUMS itself is not listed as an asset');
});

test('#557 release assets: no package to sum fails the step, so nothing is published', (t) => {
  const out = runSumsStep(t, {});
  if (!out) return;
  assert.notEqual(out.status, 0);
});

test('#557 release assets: the publish job only runs on main, the ref the documented cosign identity names', () => {
  const wf = yaml.load(fs.readFileSync(path.join(root, '.github/workflows/deploy.yml'), 'utf8'));
  assert.match(String(wf.jobs.publish.if || ''), /github\.ref\s*==\s*'refs\/heads\/main'/);
  const doc = fs.readFileSync(path.join(root, 'docs', 'readme', '020-install.md'), 'utf8');
  assert.equal(doc.includes('.github/workflows/deploy.yml@refs/heads/main'), true, 'the docs expect deploy.yml@refs/heads/main');
});

// preview.yml's targets job keeps its own list of builds (inline JSON in a shell variable).
function previewTargets() {
  const wf = yaml.load(fs.readFileSync(path.join(root, '.github/workflows/preview.yml'), 'utf8'));
  const run = wf.jobs.targets.steps.map((s) => s.run || '').join('\n');
  const m = run.match(/ALL='(\[[\s\S]*?\])'/);
  assert.ok(m, 'preview.yml targets job has an ALL=\'[...]\' list');
  return { wf, all: JSON.parse(m[1]) };
}

test('release assets: preview.yml builds the same targets as deploy.yml (os, platform, arch, assets)', () => {
  const deploy = yaml.load(fs.readFileSync(path.join(root, '.github/workflows/deploy.yml'), 'utf8'));
  const key = (t) => [t.os, t.platform, t.arch, t.assets.trim().split('\n').sort().join(',')].join(' ');
  const { all } = previewTargets();
  assert.deepEqual(all.map(key).sort(), deploy.jobs.build.strategy.matrix.include.map(key).sort());
});

test('release assets: every preview os choice but "all" picks at least one target, Windows by default', () => {
  const { wf, all } = previewTargets();
  const input = wf.on.workflow_dispatch.inputs.os;
  assert.equal(input.default, 'windows');
  const families = new Set(all.map((t) => t.family));
  for (const choice of input.options.filter((o) => o !== 'all')) assert.ok(families.has(choice), choice);
  assert.deepEqual([...families].sort(), ['linux', 'macos', 'windows']);
});

// ---- #476 (SEC-11): the AppImage without Chromium's sandbox says so --------------------------------
// CONTRACT (acceptance tests written before the code): scripts/release-assets.js also exports
//   APP_RUN, the text of the AppImage's AppRun (a POSIX sh script). Its `--no-sandbox` branch (the
//   `if … then … fi` checking apparmor_restrict_unprivileged_userns / unprivileged_userns_clone)
//   writes a warning naming the sandbox to stderr (`>&2`) and starts the app with the environment
//   variable MULTIAGENT_NO_SANDBOX=1 (the app's signal to show the warning once, Settings › About or a
//   toast); the normal start (after `fi`) sets neither.
const appRun = () => {
  const { APP_RUN } = require('../scripts/release-assets');
  assert.equal(typeof APP_RUN, 'string', 'scripts/release-assets.js exports APP_RUN (#476)');
  return APP_RUN;
};
// the --no-sandbox branch (then … fi) and the normal start (after fi)
const appRunParts = () => {
  const text = appRun();
  const m = /\bthen\n([\s\S]*?)\nfi\n([\s\S]*)$/.exec(text);
  assert.ok(m, `AppRun has an if … then … fi branch: ${text}`);
  assert.match(m[1], /--no-sandbox/, 'the branch is the --no-sandbox one');
  return { fallback: m[1], normal: m[2] };
};

test('#476 AppRun: without the sandbox it writes a warning naming the sandbox to stderr', () => {
  const { fallback } = appRunParts();
  const warning = fallback.split('\n').find((line) => />&2/.test(line));
  assert.ok(warning, `a line of the --no-sandbox branch writes to stderr: ${fallback}`);
  assert.match(warning, /sandbox/i);
});

test('#476 AppRun: without the sandbox it starts the app with MULTIAGENT_NO_SANDBOX=1, the normal start without it', () => {
  const { fallback, normal } = appRunParts();
  assert.match(fallback, /MULTIAGENT_NO_SANDBOX=1/);
  assert.doesNotMatch(normal, /MULTIAGENT_NO_SANDBOX/);
});

test('#476 README Install (Linux) documents the sysctl that keeps the sandbox on', () => {
  const readme = fs.readFileSync(path.join(root, 'README.md'), 'utf8');
  const install = readme.slice(readme.indexOf('\n## Install'), readme.indexOf('\n## Account and privacy'));
  assert.ok(install.includes('kernel.apparmor_restrict_unprivileged_userns=0'), 'the Install section names the sysctl');
});

test('#476 the sandbox decision is recorded in docs/agents/decisions.md', () => {
  const decisions = fs.readFileSync(path.join(root, 'docs', 'agents', 'decisions.md'), 'utf8');
  assert.ok(decisions.includes('#476'), 'decisions.md has an entry for #476');
});
