// .github/workflows/deploy.yml builds only for a release (owner decision of 2026-10-31, replacing the
// "every push to main builds an rc" part of #489; docs/agents/decisions.md):
// - a pushed vX.Y.Z tag builds every OS and publishes the release vX.Y.Z, marked latest; an rc tag
//   (vX.Y.Z-rc.N) triggers nothing;
// - a push to main builds nothing;
// - a run by hand (workflow_dispatch) on main still publishes a PRERELEASE vX.Y.Z-rc.N, never latest;
// - nothing promotes an existing release any more (no `gh release edit`).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

const load = () => yaml.load(fs.readFileSync(path.join(__dirname, '..', '.github', 'workflows', 'deploy.yml'), 'utf8'));
const steps = (wf) => Object.entries(wf.jobs || {}).flatMap(([id, job]) => (job.steps || []).map((s) => ({ id, job, step: s, run: `${s.run || ''}\n${s.uses || ''}` })));

test('deploy.yml runs on a vX.Y.Z tag and by hand, never on a push to main nor on an rc tag', () => {
  const on = load().on || {};
  assert.equal(on.push?.branches, undefined, 'no push to a branch');
  const tags = [].concat(on.push?.tags || []);
  assert.ok(tags.some((t) => String(t).startsWith('v')), 'a v* tag');
  assert.ok(tags.includes('!v*-rc.*'), 'rc tags excluded');
  assert.equal('workflow_dispatch' in on, true);
  assert.equal('pull_request' in on || 'schedule' in on, false);
});

test('the build runs for the tag too: no job skips a tag push', () => {
  const wf = load();
  const build = Object.entries(wf.jobs).find(([, j]) => (j.steps || []).some((s) => /npm run package/.test(s.run || '')));
  assert.ok(build, 'a build job packages the app');
  assert.doesNotMatch(String(build[1].if || ''), /tags/, 'the build is not kept off the tag');
});

test('a tag publishes the release vX.Y.Z as latest; a run by hand publishes an rc prerelease, never latest', () => {
  const creates = steps(load()).filter((s) => /gh release create/.test(s.run));
  assert.equal(creates.length, 2, 'one step per kind of release');
  const stable = creates.find((s) => /ref_type == 'tag'/.test(String(s.step.if || '')));
  const rc = creates.find((s) => /ref_type != 'tag'/.test(String(s.step.if || '')));
  assert.ok(stable && rc, 'the steps split on the tag');
  assert.match(stable.run, /--latest(?!=false)/);
  assert.match(stable.run, /github\.ref_name/, 'the release is named after the tag');
  assert.doesNotMatch(stable.run, /--prerelease/);
  assert.match(rc.run, /--prerelease/);
  assert.match(rc.run, /-rc\./);
  assert.doesNotMatch(rc.run, /--latest/);
  assert.equal(stable.id, rc.id, 'both in the publish job (sums and signature first)');
});

test('nothing promotes an existing release any more', () => {
  assert.equal(steps(load()).some((s) => /gh release edit/.test(s.run)), false);
});
