// #739: OnboardingModel.displayNameFromUrl(url), the project's display name read from a repository URL
// (its last path part, without .git, a query or a trailing slash; dashes as spaces, each word
// capitalized). An unparseable or empty URL gives "". The clone folder's rule (repoNameFromUrl,
// owner-repo) is unchanged. The function is read inside each test: before the code exists each test fails
// on its own.
const test = require('node:test');
const assert = require('node:assert/strict');

const M = require('../onboarding-model');

function displayName(url) {
  assert.equal(typeof M.displayNameFromUrl, 'function', 'OnboardingModel.displayNameFromUrl is exported');
  return M.displayNameFromUrl(url);
}

test('#739 displayNameFromUrl: a GitLab https URL gives its repository name capitalized', () => {
  assert.equal(displayName('https://gitlab.com/eduardogalbiati/pharmaged'), 'Pharmaged');
});

test('#739 displayNameFromUrl: dashes become spaces, each word capitalized, .git dropped', () => {
  assert.equal(displayName('https://github.com/acme/ai-memory.git'), 'Ai Memory');
});

test('#739 displayNameFromUrl: an SSH URL (git@host:owner/repo.git)', () => {
  assert.equal(displayName('git@gitlab.com:owner/repo.git'), 'Repo');
});

test('#739 displayNameFromUrl: a trailing slash and a query are ignored', () => {
  assert.equal(displayName('https://github.com/acme/ai-memory/'), 'Ai Memory');
  assert.equal(displayName('https://github.com/acme/ai-memory?tab=readme'), 'Ai Memory');
});

test('#739 displayNameFromUrl: an empty, blank or missing URL gives ""', () => {
  assert.equal(displayName(''), '');
  assert.equal(displayName('   '), '');
  assert.equal(displayName(undefined), '');
  assert.equal(displayName(null), '');
});

test('#739 the clone folder keeps its owner-repo rule (repoNameFromUrl unchanged)', () => {
  assert.equal(M.repoNameFromUrl('https://github.com/acme/ai-memory.git'), 'acme-ai-memory');
  assert.equal(M.repoNameFromUrl('https://gitlab.com/eduardogalbiati/pharmaged'), 'eduardogalbiati-pharmaged');
});
