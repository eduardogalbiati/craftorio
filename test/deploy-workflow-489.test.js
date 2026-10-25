// #489 .github/workflows/deploy.yml as "rc + stable": acceptance tests written before the change.
// - a push to main builds and publishes a PRERELEASE vX.Y.Z-rc.N (`gh release create ... --prerelease`,
//   never `--latest`);
// - a vX.Y.Z tag promotes: a job that edits the release of the same commit (`gh release edit ...
//   --latest`, renamed to the tag), with no build (it does not need the build job, packages nothing,
//   uploads nothing); the build job does not run on a tag;
// - workflow_dispatch is kept.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

const load = () => yaml.load(fs.readFileSync(path.join(__dirname, '..', '.github', 'workflows', 'deploy.yml'), 'utf8'));
const jobs = (wf) => Object.entries(wf.jobs || {}).map(([id, job]) => ({ id, job, script: (job.steps || []).map((s) => `${s.run || ''}\n${s.uses || ''}`).join('\n') }));
const needsOf = (job) => [].concat(job.needs || []);

test('#489 deploy.yml runs on a push to main, on a v* tag and by hand', () => {
  const on = load().on || {};
  assert.equal([].concat(on.push?.branches || []).includes('main'), true);
  assert.equal([].concat(on.push?.tags || []).some((t) => String(t).startsWith('v')), true);
  assert.equal('workflow_dispatch' in on, true);
});

test('#489 the push to main publishes a prerelease vX.Y.Z-rc.N, never marked latest', () => {
  const creates = jobs(load()).filter((j) => /gh release create/.test(j.script));
  assert.equal(creates.length > 0, true, 'a job creates the release');
  for (const j of creates) {
    assert.equal(j.script.includes('--prerelease'), true, `${j.id}: --prerelease`);
    assert.equal(j.script.includes('-rc.'), true, `${j.id}: an -rc. tag`);
    assert.equal(/--latest(?!=false)/.test(j.script), false, `${j.id}: never --latest`);
  }
});

test('#489 a v* tag promotes the existing release (gh release edit --latest) without a rebuild', () => {
  const all = jobs(load());
  const promote = all.filter((j) => /gh release edit/.test(j.script));
  assert.equal(promote.length, 1, 'one job edits the release');
  const p = promote[0];
  assert.equal(p.script.includes('--latest'), true, 'marked latest');
  assert.equal(p.script.includes('--prerelease=false'), true, 'no longer a prerelease');
  const builds = all.filter((j) => /npm run package|release-assets\.js|upload-artifact/.test(j.script)).map((j) => j.id);
  assert.equal(builds.length > 0, true, 'a build job exists');
  assert.equal(builds.includes(p.id), false, 'the promotion packages nothing');
  assert.equal(needsOf(p.job).some((n) => builds.includes(n)), false, 'the promotion does not wait for a build');
  for (const id of builds) {
    const cond = String(all.find((j) => j.id === id).job.if || '');
    assert.match(cond, /tag|refs\/heads/, `${id}: its if keeps it off the tag push`);
  }
});
