// #745: a project's platform comes from the project (its repository's host, a platform stored on it,
// a host naming it), never from a global setting.
const test = require('node:test');
const assert = require('node:assert/strict');
const { projectPlatform } = require('../platforms');

const idOf = (project) => projectPlatform(project)?.id ?? null;

test('#745 a github.com project is on GitHub', () => {
  assert.equal(idOf({ repo: 'https://github.com/o/r' }), 'github');
});

test('#745 a gitlab.com project is on GitLab (https and scp forms)', () => {
  assert.deepEqual([idOf({ repo: 'https://gitlab.com/eduardogalbiati/pharmaged' }), idOf({ repo: 'git@gitlab.com:g/sub/r.git' })], ['gitlab', 'gitlab']);
});

test('#745 a host naming GitLab (gitlab.empresa.com) is GitLab', () => {
  assert.equal(idOf({ repo: 'https://gitlab.empresa.com/g/r' }), 'gitlab');
});

test('#745 a self-hosted host uses the platform stored on the project', () => {
  assert.equal(idOf({ repo: 'https://git.company.com/team/r', platform: 'gitlab' }), 'gitlab');
});

test('#745 a self-hosted host without a stored platform is unknown', () => {
  assert.equal(idOf({ repo: 'https://git.company.com/team/r' }), null);
});

test('#745 a known host wins over a stored platform that contradicts it', () => {
  assert.equal(idOf({ repo: 'https://gitlab.com/g/r', platform: 'github' }), 'gitlab');
});

test('#745 a project without a repository and without a platform is unknown', () => {
  assert.deepEqual([idOf({}), idOf(null)], [null, null]);
});
