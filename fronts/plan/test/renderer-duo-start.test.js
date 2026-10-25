// fronts/plan/views/duo/duo.js: starting a Write & Review run (startRun). It runs only inside the
// Electron renderer (document, window.api), so this check reads its source as a seam, the way
// test/renderer-backlog-assign.test.js checks backlog.js.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
// a page file by its page-relative name, in whichever layer holds it (the UI kit, a front, the page folder)
const pageFileOf = (rel) => require('../../../scripts/source-tree').pageFile(path.join(__dirname, '..', '..', '..'), rel);

const src = fs.readFileSync(pageFileOf('views/duo/duo.js'), 'utf8');

test('startRun: an ended run\'s kept work for this issue (#112, #170) opens the kept-work dialog; only "scratch" starts again, confirmed', () => {
  const fn = /async function startRun\(\)[\s\S]*?\n  \}/.exec(src)[0];
  assert.match(fn, /let out = await api\.startRun\(payload\);/);
  assert.match(fn, /if \(out\?\.kept\) \{/);
  assert.match(fn, /if \(await keptWorkDialog\(out\.kept\) !== 'scratch'\) return;/);
  assert.match(fn, /out = await api\.startRun\(\{ \.\.\.payload, confirmed: true \}\);/);
  // the old wording (a dedicated "Earlier work on this issue" / "Start a new run" pair of dialogs) is gone
  assert.doesNotMatch(fn, /Earlier work on this issue/);
  assert.doesNotMatch(fn, /confirmDialog\('Start a new run'/);
});

// #181: Write & Review's gate choices sit side by side in one row too, through the shared
// .gate-choices class (run chat, Run screen and Write & Review all use it).
test('onApproval: the gate\'s choice buttons sit in one .row.gate-choices row, the first one primary', () => {
  const fn = /function onApproval\(ev\) \{[\s\S]*?\n  \}/.exec(src)[0];
  assert.match(fn, /<div class="row gate-choices">\$\{buttons\}<\/div>/, 'the buttons share one row, not one per line');
  assert.match(fn, /class="btn sm \$\{i === 0 \? 'primary' : ''\}"/, 'the first choice is the primary one');
});
