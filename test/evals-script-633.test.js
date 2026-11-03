// #633: scripts/evals.js, the evals of the bundled skills and workflows run in CI: they pass on the
// repository and report a broken skill or workflow of a scratch root.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { runEvals, skillEvals } = require('../scripts/evals');

test('#633 the bundled skills and workflows pass the evals', () => {
  assert.deepEqual(runEvals(), []);
});

test('#633 a skill whose name is not its folder, or without a description, fails', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'evals-633-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const skill = (name, text) => {
    fs.mkdirSync(path.join(root, 'skills', name), { recursive: true });
    fs.writeFileSync(path.join(root, 'skills', name, 'SKILL.md'), text);
  };
  skill('good', '---\nname: good\ndescription: Does a thing.\n---\n# Good\n');
  skill('renamed', '---\nname: other\ndescription: Does a thing.\n---\n');
  skill('bare', '---\nname: bare\n---\n');
  skill('none', '# No frontmatter\n');
  const { names, failures } = skillEvals(root);
  assert.deepEqual([...names].sort(), ['bare', 'good', 'none', 'renamed']);
  assert.equal(failures.length, 3, failures.join('\n'));
  assert.ok(failures.some((f) => f.includes('skills/renamed') && f.includes('not its folder')));
  assert.ok(failures.some((f) => f.includes('skills/bare') && f.includes('no description')));
  assert.ok(failures.some((f) => f.includes('skills/none') && f.includes('no frontmatter')));
});
