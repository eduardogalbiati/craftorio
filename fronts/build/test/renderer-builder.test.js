// fronts/build/views/workflows/builder.js runs only inside the Electron renderer (document,
// window.api), so this checks the agent-picker filter as a seam on the source, the way
// renderer-run-chat.test.js does.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
// a page file by its page-relative name, in whichever layer holds it (the UI kit, a front, the page folder)
const pageFileOf = (rel) => require('../../../scripts/source-tree').pageFile(path.join(__dirname, '..', '..', '..'), rel);

const src = fs.readFileSync(pageFileOf('views/workflows/builder.js'), 'utf8');

test('chooseAgent(): the picker excludes the workflows\' own (read-only) agents, only the user\'s own are offered', () => {
  const chooseAgent = /async function chooseAgent\(currentId\) \{[\s\S]*?\n  \}/.exec(src)[0];
  assert.ok(chooseAgent, 'chooseAgent not found in builder.js: the source moved');
  assert.match(chooseAgent, /!x\.system && !x\.workflow && !x\.error/);
});
