// #40: the onboarding screenshot seed's `--review awaiting` option seeds a repository whose own default
// workflow awaits acceptance, so steps 3 and 4 show wizard-default-awaiting-acceptance in the captures.
// That holds only when the manifest names a repository file for that default (`file: workflows/<x>.yaml`,
// the file it ships under .multiagent/workflows/): an entry without a file is a bundled/workspace name,
// never a repository workflow, so nothing awaits acceptance. Plain Node only: no Electron window, git only.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const loadSeed = () => require(path.join(ROOT, 'scripts', 'screenshot', 'views', 'onboarding.js'));
const loadManifest = () => require(path.join(ROOT, 'packages', 'engine', 'domains', 'project', 'project-manifest.js'));

function seeded(t, opts) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'onboarding-40-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const folder = path.join(dir, 'billing-api');
  loadSeed().sampleRepository(folder, opts);
  return folder;
}

test('#40 --review awaiting: the seeded manifest is valid and declares the repository workflow team-feature its default', (t) => {
  const manifest = loadManifest().readManifest(seeded(t, { awaiting: true }));
  assert.deepEqual(manifest.errors, []);
  assert.equal(manifest.default, 'team-feature');
});

test('#40 --review awaiting: the default is a repository workflow, its manifest entry names the file it ships', (t) => {
  const folder = seeded(t, { awaiting: true });
  const manifest = loadManifest().readManifest(folder);
  const entry = (manifest.workflows || []).find((w) => w.name === 'team-feature');
  assert.equal(entry ? entry.file : 'no team-feature entry', 'workflows/team-feature.yaml');
  assert.equal(fs.existsSync(path.join(folder, '.multiagent', 'workflows', 'team-feature.yaml')), true);
});

test('#40 without --review awaiting the seeded repository keeps the bundled feature default and no repository file', (t) => {
  const manifest = loadManifest().readManifest(seeded(t, {}));
  assert.deepEqual(manifest.errors, []);
  assert.equal(manifest.default, 'feature');
  assert.equal((manifest.workflows || []).some((w) => w.file), false);
});
