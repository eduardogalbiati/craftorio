// #739: displayNameFromUrl gives "" until the URL names an owner and a repository after its scheme and
// host (a URL being typed, a host alone), so the wizard's name never shows "Https" or "Github.com";
// the list's short form owner/repo still gives the repository's name.
const test = require('node:test');
const assert = require('node:assert/strict');

const M = require('../onboarding-model');

test('#739 displayNameFromUrl: a URL being typed gives "" until it names owner and repo', () => {
  for (const partial of ['https', 'https:', 'https://', 'https://github.com', 'https://github.com/', 'https://github.com/acme', 'git@gitlab.com:', 'git@gitlab.com:owner']) {
    assert.equal(M.displayNameFromUrl(partial), '', partial);
  }
  assert.equal(M.displayNameFromUrl('https://github.com/acme/pharmaged'), 'Pharmaged');
});

test('#739 displayNameFromUrl: the list short form and an ssh:// URL', () => {
  assert.equal(M.displayNameFromUrl('acme/ai-memory'), 'Ai Memory');
  assert.equal(M.displayNameFromUrl('ssh://git@gitlab.com/group/sub/my_repo.git'), 'My Repo');
});

// GitLab namespaces may hold a dot; the list pick hands the short form owner/repo
test('#739 displayNameFromUrl: the list short form with an owner holding a dot (GitLab group "my.company")', () => {
  assert.equal(M.displayNameFromUrl('my.company/repo'), 'Repo');
  assert.equal(M.displayNameFromUrl('my.company/ai-memory'), 'Ai Memory');
});

test('#739 displayNameFromUrl: an https URL with an owner holding a dot', () => {
  assert.equal(M.displayNameFromUrl('https://gitlab.com/my.company/repo'), 'Repo');
  assert.equal(M.displayNameFromUrl('https://gitlab.com/my.company/ai-memory.git'), 'Ai Memory');
});
