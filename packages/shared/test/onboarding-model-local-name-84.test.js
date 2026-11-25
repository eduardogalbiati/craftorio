// #84 OnboardingModel.repoNameFromUrl (the clone folder's name, shared with the wizard's step 2): a local
// path or file:// URL names the folder after the repository alone ("eslint-js", not "repos-eslint-js");
// GitHub/GitLab URLs keep owner-name. Acceptance tests written before the code.
const test = require('node:test');
const assert = require('node:assert/strict');

const name = (url) => require('../onboarding-model').repoNameFromUrl(url);

test('#84 repoNameFromUrl: a POSIX local path gives the repository name alone', () => {
  assert.equal(name('/home/x/repos/eslint-js'), 'eslint-js');
  assert.equal(name('/home/x/repos/eslint-js/'), 'eslint-js');
});

test('#84 repoNameFromUrl: a Windows local path gives the repository name alone', () => {
  assert.equal(name('C:\\x\\repos\\eslint-js'), 'eslint-js');
  assert.equal(name('C:/x/repos/eslint-js'), 'eslint-js');
});

test('#84 repoNameFromUrl: a file:// URL gives the repository name alone', () => {
  assert.equal(name('file:///home/x/repos/eslint-js'), 'eslint-js');
  assert.equal(name('file:///home/x/repos/eslint-js.git'), 'eslint-js');
});

test('#84 repoNameFromUrl: GitHub and GitLab URLs keep owner-name', () => {
  assert.equal(name('https://github.com/acme/tool.git'), 'acme-tool');
  assert.equal(name('git@gitlab.com:grp/tool.git'), 'grp-tool');
});
