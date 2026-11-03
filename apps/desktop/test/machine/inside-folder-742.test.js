// #742: insideFolder, the one "path inside a root" rule (domains/machine/platform-paths.js), shared by
// cli-trust's isInside (the root counts) and projects.ownedFolder (strict: the root itself does not count).
const test = require('node:test');
const assert = require('node:assert/strict');
const { insideFolder } = require('../../../../packages/engine/domains/machine/platform-paths');

test('#742 insideFolder: a child is inside, the root counts unless strict, an escape never', () => {
  assert.equal(insideFolder('/ws/repos/a', '/ws/repos', { platform: 'linux' }), true);
  assert.equal(insideFolder('/ws/repos', '/ws/repos', { platform: 'linux' }), true);
  assert.equal(insideFolder('/ws/repos', '/ws/repos/', { strict: true, platform: 'linux' }), false);
  assert.equal(insideFolder('/ws/repos/../other', '/ws/repos', { platform: 'linux' }), false);
  assert.equal(insideFolder('/ws/repos-old/a', '/ws/repos', { platform: 'linux' }), false);
});

test('#742 insideFolder follows the platform\'s case rule', () => {
  assert.equal(insideFolder('C:\\WS\\Repos\\a', 'c:\\ws\\repos', { strict: true, platform: 'win32' }), true);
  assert.equal(insideFolder('/WS/Repos/a', '/ws/repos', { platform: 'linux' }), false);
});
