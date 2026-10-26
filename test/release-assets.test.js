// scripts/release-assets.js: the release file names per OS (the names deploy.yml uploads).
// Nothing here packages or launches the app.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
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

test('#557 release assets: the publish job writes SHA256SUMS and its signature into assets/, published with the packages', () => {
  const wf = yaml.load(fs.readFileSync(path.join(root, '.github/workflows/deploy.yml'), 'utf8'));
  const steps = wf.jobs.publish.steps;
  const at = (re) => steps.findIndex((s) => re.test(s.run || ''));
  const sums = steps[at(/sha256sum/)].run;
  assert.match(sums, /cd assets\n/, 'the sums name the files without the assets/ prefix');
  assert.match(sums, /\nmv [^\n]* SHA256SUMS\n/, 'written outside assets/ first: SHA256SUMS never sums itself');
  assert.match(steps[at(/cosign sign-blob/)].run, /--bundle assets\/SHA256SUMS\.sigstore\.json assets\/SHA256SUMS$/);
  assert.ok(at(/gh release create "\$RC" assets\/\*/) > at(/cosign sign-blob/), 'assets/* (packages, sums, signature) published after the signature');
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
