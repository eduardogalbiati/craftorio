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
