// #105 acceptance, written before the code: a folder on this computer imported with the new-project wizard (its
// file:// URL, step 1's folder card) keeps its real remote. Seam: the whole service in a simulation
// (onboarding:start / onboarding:status, test/project/local-import-105-fixture.js), the project's saved record
// (projects.js readProject) and git in the clone. Observable state only.
// - L1, a folder whose origin is on GitHub: the project's repository is that GitHub repository (provider github,
//   acme/widget), never the folder's file:// URL; a run's push still goes back to the folder (#79).
// - L2, a folder with no remote: the project has no repository (no file:// one), so it gets the local backlog.
// - Step 3's defaults (OnboardingModel.suggestWorkflows over the profile the wizard reads: the onboarding's
//   profile, else the profile job's): Remote PR for a GitHub remote, local for a folder with no remote.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { fileURLToPath } = require('url');
const Platforms = require('@craftorio/shared/platforms');
const OnboardingModel = require('@craftorio/shared/onboarding-model');
const { GITHUB, importFolder, personFolder, run } = require('./local-import-105-fixture');

const samePath = (a, b) => fs.realpathSync.native(a) === fs.realpathSync.native(b);
// a git remote URL or path as a folder on this computer
const folderOf = (url) => (/^file:/i.test(url) ? fileURLToPath(url) : url);
// step 3's suggested feature workflow, as profileOf() / workflowChoices() in project-wizard-workflows.js read it
const featureDefault = (state) => {
  const profile = state.profile || state.jobs?.profile?.profile || null;
  return OnboardingModel.suggestWorkflows(profile).suggestions.find((s) => s.id === 'feature').value;
};

test('#105 L1 a folder with a GitHub remote: the project records that remote (github, acme/widget), not a file:// URL', { timeout: 60000 }, async (t) => {
  const { project } = await importFolder(t, personFolder(t, { remote: GITHUB }));
  assert.doesNotMatch(String(project.repo), /^file:/i, `the project's repository: ${project.repo}`);
  assert.equal(Platforms.platformOfRepoUrl(project.repo)?.id, 'github', `the project's provider, from ${project.repo}`);
  assert.equal(Platforms.parseRepoUrl(project.repo)?.path, 'acme/widget', `owner/name, from ${project.repo}`);
});

test('#105 L1 a folder with a GitHub remote: a run\'s push still goes back to the folder, not to GitHub', { timeout: 60000 }, async (t) => {
  const folder = personFolder(t, { remote: GITHUB });
  const { project } = await importFolder(t, folder);
  assert.equal(samePath(project.folder, folder), false, 'the project works in its own clone, not in the person\'s folder');
  const origin = run(project.folder, ['remote', 'get-url', 'origin']);
  assert.equal(samePath(folderOf(origin), folder), true, `the clone's origin is the folder: ${origin}`);
  run(project.folder, ['checkout', '-q', '-b', 'craftorio/run-105']);
  fs.writeFileSync(path.join(project.folder, 'run.txt'), 'run\n');
  run(project.folder, ['add', 'run.txt']);
  run(project.folder, ['commit', '-q', '--no-verify', '-m', 'A run\'s commit']);
  run(project.folder, ['push', '-q', 'origin', 'HEAD:refs/heads/craftorio/run-105']);
  assert.equal(run(folder, ['rev-parse', 'refs/heads/craftorio/run-105']), run(project.folder, ['rev-parse', 'HEAD']), 'the run\'s branch is in the folder');
});

test('#105 L2 a folder with no remote: the project has no repository (no file:// URL), so no platform is asked', { timeout: 60000 }, async (t) => {
  const { project } = await importFolder(t, personFolder(t));
  assert.doesNotMatch(String(project.repo ?? ''), /^file:/i, `the project's repository: ${project.repo}`);
  assert.equal(Platforms.platformOfRepoUrl(project.repo ?? ''), null, 'no provider');
});

test('#105 step 3 defaults: a folder with a GitHub remote suggests Remote PR', { timeout: 90000 }, async (t) => {
  const { state } = await importFolder(t, personFolder(t, { remote: GITHUB }), { profile: true });
  assert.match(featureDefault(state), /^remote-/, `the feature workflow's default: ${featureDefault(state)}`);
});

test('#105 step 3 defaults: a folder with no remote suggests local (no pull request), whatever its merges look like', { timeout: 90000 }, async (t) => {
  const { state } = await importFolder(t, personFolder(t), { profile: true });
  assert.match(featureDefault(state), /^local-/, `the feature workflow's default: ${featureDefault(state)}`);
});
