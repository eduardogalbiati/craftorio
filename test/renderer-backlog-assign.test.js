// src/renderer/backlog.js: the Backlog "Assign a workflow" modal. It runs only inside the
// Electron renderer (document, window.api), so these tests check its source as a seam, the way
// test/agents.test.js checks robots.js and test/renderer-styles.test.js checks the stylesheets.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'backlog.js'), 'utf8');

test('openAssign: the Simulation checkbox defaults to unchecked, not to Developer mode', () => {
  assert.match(src, /#assign-mock['"]\)\.checked\s*=\s*!!state\.simulationOnly/);
  assert.doesNotMatch(src, /#assign-mock['"]\)\.checked\s*=\s*devMode\(\)/);
});

test('updateAssignNote: the real-run note drops the "one at a time" / ordering claim', () => {
  const note = /function updateAssignNote\(\)[\s\S]*?\n  \}/.exec(src)[0];
  assert.doesNotMatch(note, /one at a time/);
  assert.doesNotMatch(note, /starting now if nothing else is running/);
  // still switches the submit button text between Simulate and Start
  assert.match(note, /\$b\('#btn-assign-ok'\)\.textContent = `\$\{mock \? 'Simulate' : 'Start'\}/);
});

test('status(): a run the supervisor sent back after a failed merge shows a "sent back" badge with its record', () => {
  const status = /function status\(i\)[\s\S]*?\n  \}/.exec(src)[0];
  assert.match(status, /const recovered = r\.recovery \? `<span class="badge bl-recovered"/);
  assert.match(status, /title="\$\{esc\(`Supervisor: \$\{r\.recovery\}`\)\}"/);
  assert.match(status, /sent back after a failed merge<\/span>` : ''/);
});
