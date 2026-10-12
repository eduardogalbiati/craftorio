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
