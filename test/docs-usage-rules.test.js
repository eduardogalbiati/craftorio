// scripts/docs-usage.js (#574): the command rules and the path rule on their own.

const test = require('node:test');
const assert = require('node:assert/strict');
const { pushesToMain, relative, startsRealRun } = require('../scripts/docs-usage.js');

test('a push counts only when its target is main', () => {
  assert.equal(pushesToMain('git push origin main'), true);
  assert.equal(pushesToMain('git -C C:/x push origin HEAD:main'), true);
  assert.equal(pushesToMain('git add . && git push -u origin feature'), false);
  assert.equal(pushesToMain('git push origin main:feature'), false);
  assert.equal(pushesToMain('git log main'), false);
});

test('a run counts as real without --mock', () => {
  assert.equal(startsRealRun('node scripts/run.js --file x.yaml'), true);
  assert.equal(startsRealRun('npm run run -- --mock --task "x"'), false);
  assert.equal(startsRealRun('npm run test:engine'), false);
});

test('paths become relative to the worktree, a skill outside it by its suffix', () => {
  assert.equal(relative('c:\\W\\wt\\docs\\agents\\x.md', 'C:/w/wt'), 'docs/agents/x.md');
  assert.equal(relative('C:/ws/skills/a/SKILL.md', 'C:/w/wt'), 'skills/a/SKILL.md');
  assert.equal(relative('C:/elsewhere/f.js', 'C:/w/wt'), 'C:/elsewhere/f.js');
});
