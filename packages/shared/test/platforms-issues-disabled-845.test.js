// #845: each platform adapter tells a repository with Issues turned off (a setting) from a failed read,
// and gives the settings page where Issues are turned on again.
const test = require('node:test');
const assert = require('node:assert/strict');
const github = require('../platforms/github');
const gitlab = require('../platforms/gitlab');

test('GitHub: the gh "has disabled issues" message means Issues are turned off', () => {
  assert.equal(github.issuesDisabled("gh issue list failed: the 'eduardogalbiati/FreeMyTvWebOS' repository has disabled issues"), true);
});

test('GitHub: network and auth failures are not Issues turned off', () => {
  assert.equal(github.issuesDisabled('gh issue list failed: error connecting to api.github.com'), false);
  assert.equal(github.issuesDisabled('gh issue list failed: HTTP 401: Bad credentials'), false);
  assert.equal(github.issuesDisabled(''), false);
  assert.equal(github.issuesDisabled(undefined), false);
});

test('GitLab: the issues-feature-disabled message means Issues are turned off; a network failure does not', () => {
  assert.equal(gitlab.issuesDisabled('glab issue list failed: The issues feature is disabled for this project'), true);
  assert.equal(gitlab.issuesDisabled('glab issue list failed: dial tcp: lookup gitlab.com: no such host'), false);
  assert.equal(gitlab.issuesDisabled('glab issue list failed: 401 Unauthorized'), false);
});

test('settingsUrl points at the repository settings page of each platform', () => {
  assert.equal(github.settingsUrl({ host: 'github.com', path: 'o/r' }), 'https://github.com/o/r/settings');
  assert.equal(gitlab.settingsUrl({ host: 'gitlab.com', path: 'group/sub/r' }), 'https://gitlab.com/group/sub/r/edit');
});
