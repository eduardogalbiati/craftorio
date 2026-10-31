// #641: platformOfRepoUrl, the provider of a repository URL read from its host (the wizard and the
// engine's onboarding share it), never from a word anywhere in the URL.
const test = require('node:test');
const assert = require('node:assert/strict');
const Platforms = require('../platforms');

test('#641 platformOfRepoUrl reads the host: https, ssh and scp forms', () => {
  assert.equal(Platforms.platformOfRepoUrl('https://github.com/o/r.git').id, 'github');
  assert.equal(Platforms.platformOfRepoUrl('git@gitlab.com:group/sub/r.git').id, 'gitlab');
  assert.equal(Platforms.platformOfRepoUrl('ssh://git@github.com/o/r').id, 'github');
});

test('#641 platformOfRepoUrl: a repository named after the other platform keeps its host', () => {
  assert.equal(Platforms.platformOfRepoUrl('https://github.com/acme/gitlab-runner-config').id, 'github');
});

test('#641 platformOfRepoUrl: another host, no path or no URL is null', () => {
  assert.equal(Platforms.platformOfRepoUrl('https://git.example.com/o/r.git'), null);
  assert.equal(Platforms.platformOfRepoUrl('https://github.com/'), null);
  assert.equal(Platforms.platformOfRepoUrl(''), null);
});
