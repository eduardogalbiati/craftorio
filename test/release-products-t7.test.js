// T7: two products, versioned by Changesets. The app (the desktop app, its page, the UI kit and the
// fronts, one version) is tagged vX.Y.Z and the root package.json takes its version; the engine is
// tagged engine-vX.Y.Z and released by its own Linux-only workflow; only the product whose version the
// release commit changed is tagged.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { releaseTags } = require('../scripts/release-tags');
const { syncAppVersion } = require('../scripts/release-version-sync');

const ROOT = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

test('T7 only the product whose version the release commit changed is tagged, never twice', () => {
  assert.deepEqual(releaseTags({ app: '1.5.0', engine: '1.6.0' }, { before: { app: '1.5.0', engine: '1.5.0' } }), ['engine-v1.6.0']);
  assert.deepEqual(releaseTags({ app: '1.5.1', engine: '1.6.0' }, { before: { app: '1.5.0', engine: '1.6.0' } }), ['v1.5.1']);
  assert.deepEqual(releaseTags({ app: '1.6.0', engine: '1.7.0' }, { before: { app: '1.5.1', engine: '1.6.0' } }), ['v1.6.0', 'engine-v1.7.0']);
  assert.deepEqual(releaseTags({ app: '1.6.0', engine: '1.7.0' }, { before: { app: '1.5.1', engine: '1.6.0' }, existing: ['v1.6.0'] }), ['engine-v1.7.0']);
  assert.deepEqual(releaseTags({ app: '1.5.0', engine: '1.5.0' }, { before: { app: '1.5.0', engine: '1.5.0' } }), []);
});

test('T7 the root package.json takes the desktop app\'s version (the packaged app reports the root\'s)', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'release-sync-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.mkdirSync(path.join(dir, 'apps', 'desktop'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'craftorio', version: '1.5.0', private: true }));
  fs.writeFileSync(path.join(dir, 'apps', 'desktop', 'package.json'), JSON.stringify({ name: '@craftorio/desktop', version: '1.5.1' }));
  assert.equal(syncAppVersion(dir), '1.5.1');
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')).version, '1.5.1');
});

test('T7 Changesets: the app packages share one version, every package is versioned and none tagged by Changesets', () => {
  const config = JSON.parse(read('.changeset/config.json'));
  assert.deepEqual(config.fixed, [['@craftorio/desktop', '@craftorio/web', '@craftorio/ui-kit', '@craftorio/front-ai', '@craftorio/front-analyser', '@craftorio/front-build', '@craftorio/front-plan']]);
  assert.deepEqual(config.privatePackages, { version: true, tag: false });
  const app = config.fixed[0].map((n) => JSON.parse(read(`${n === '@craftorio/desktop' ? 'apps/desktop' : n === '@craftorio/web' ? 'apps/web' : n === '@craftorio/ui-kit' ? 'packages/ui-kit' : `fronts/${n.slice('@craftorio/front-'.length)}`}/package.json`)).version);
  assert.equal(new Set(app).size, 1, 'one app version');
  assert.equal(JSON.parse(read('package.json')).version, app[0], 'the root carries the app\'s version');
  const scripts = JSON.parse(read('package.json')).scripts;
  assert.match(scripts['release:version'], /changeset version && node scripts\/release-version-sync\.js/);
  assert.equal(scripts['release:tags'], 'node scripts/release-tags.js');
});

test('T7 an engine-vX.Y.Z tag runs the engine\'s release on Linux only; a vX.Y.Z tag still builds the installers', () => {
  const engine = read('.github/workflows/release-engine.yml');
  assert.match(engine, /tags: \['engine-v\*'\]/);
  assert.match(engine, /runs-on: ubuntu-latest/);
  assert.doesNotMatch(engine, /macos|windows/);
  assert.match(engine, /npm pack -w packages\/engine/);
  const deploy = read('.github/workflows/deploy.yml');
  assert.match(deploy, /tags: \['v\*', '!v\*-rc\.\*'\]/);
});
