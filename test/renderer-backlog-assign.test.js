// src/renderer/views/backlog/backlog.js: the Backlog "Assign a workflow" modal. It runs only
// inside the Electron renderer (document, window.api), so these tests check its source as a seam,
// the way test/agents.test.js checks robots.js and test/renderer-styles.test.js checks the
// stylesheets.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'views', 'backlog', 'backlog.js'), 'utf8');

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

test('submitAssign: assigning an issue the roadmap already plans asks first, and takes it out of the roadmap', () => {
  const fn = /async function submitAssign\(e\)[\s\S]*?\n  \}/.exec(src)[0];
  assert.match(fn, /const inRoadmap = planned\(numbers\);/);
  assert.match(fn, /if \(inRoadmap\.length && !await confirmDialog\('Already in the roadmap'/);
  assert.match(fn, /takes \$\{inRoadmap\.length > 1 \? 'them' : 'it'\} out of the roadmap and into the queue/);
});

test('openAssign: a prefill from the Product Owner picks its workflow, groups its issues into one run, and fills its inputs', () => {
  const fn = /async function openAssign\(prefill = null\)[\s\S]*?\n  \}/.exec(src)[0];
  // the proposed workflow wins over the last-used one when it exists among the project's workflows
  assert.match(fn, /sel\.value = \[prefill\?\.workflow, load\(WORKFLOW_KEY\), 'software-development\.yaml', files\[0\]\]\.find\(\(f\) => f && files\.includes\(f\)\);/);
  // a multi-issue group is assigned as one run, not as separate runs
  assert.match(fn, /document\.querySelector\(`input\[name="assign-group"\]\[value="\$\{prefill\?\.group \? 'group' : 'separate'\}"\]`\)\.checked = true;/);
  // each proposed input value is written into its field
  assert.match(fn, /for \(const \[k, v\] of Object\.entries\(prefill\?\.inputs \|\| \{\}\)\) \{/);
  assert.match(fn, /if \(el && v != null\) el\.value = String\(v\);/);
});

test('assignGroup: a proposed group selects its To do issues, clears filters that would hide one, and opens Assign prefilled as one run', () => {
  const fn = /async function assignGroup\(\{ issues, workflow, inputs \}\)[\s\S]*?\n  \}/.exec(src)[0];
  assert.match(fn, /const numbers = issues\.filter\(\(n\) => todo\.some\(\(i\) => i\.number === n\)\);/);
  assert.match(fn, /const skipped = issues\.filter\(\(n\) => !numbers\.includes\(n\)\);/);
  assert.match(fn, /if \(!numbers\.length\) return skipped;/); // none still To do: nothing to open, nothing left unmentioned
  assert.match(fn, /bl\.selected\.clear\(\);/);
  assert.match(fn, /await openAssign\(\{ workflow, inputs, group: numbers\.length > 1 \}\);/);
  assert.match(fn, /return skipped;/);
});

test('roadmapGroup: a proposed group (and its Product Owner answer\'s origin, #140) is forwarded to BacklogRoadmap.addStage as a new stage', () => {
  const fn = /async function roadmapGroup\(\{ issues, workflow, inputs, reason, modeReason, origin \}\)[\s\S]*?\n  \}/.exec(src)[0];
  assert.match(fn, /const skipped = issues\.filter\(\(n\) => !list\.some\(\(i\) => i\.number === n\)\);/);
  assert.match(fn, /if \(!list\.length\) return skipped;/);
  assert.match(fn, /await window\.BacklogRoadmap\.addStage\(roadmapCtx\(\), bl\.data, \{\s*issues: list, workflow, workflowName: wf\?\.name \|\| workflow, inputs: inputs \|\| \{\}, mock: !!state\.simulationOnly, group: list\.length > 1, reason, modeReason, origin,/);
  assert.match(fn, /return skipped;/);
});

test('openStage (the Product Owner drawer\'s badge, #140): switches to the Roadmap and scrolls to, then flashes, that stage\'s section', () => {
  const fn = /function openStage\(n\)[\s\S]*?\n  \}/.exec(src)[0];
  assert.match(fn, /showRoadmap\(\);/);
  assert.match(fn, /document\.querySelector\(`#bl-list \.rm-stage\[data-stage="\$\{Number\(n\) - 1\}"\]`\)/);
  assert.match(fn, /el\.scrollIntoView\(\{ block: 'start', behavior: 'smooth' \}\);/);
  assert.match(fn, /el\.classList\.add\('flash'\);/);
});

// ---- Send to Product Owner (#169): next to Assign workflow…, with the same selection ---------------

test('render: Assign workflow… and Send to Product Owner (n) toggle together from the same shown selection, in list and kanban alike (one shared toolbar)', () => {
  const fn = /function render\(\)[\s\S]*?\n  \}/.exec(src)[0];
  assert.match(fn, /const n = shownSelected\(\)\.length;/);
  assert.match(fn, /\$b\('#btn-bl-assign'\)\.classList\.toggle\('hidden', !n\);/);
  assert.match(fn, /\$b\('#btn-bl-assign'\)\.textContent = `Assign workflow… \(\$\{n\}\)`;/);
  assert.match(fn, /\$b\('#btn-bl-send-po'\)\.classList\.toggle\('hidden', !n\);/);
  assert.match(fn, /\$b\('#btn-bl-send-po'\)\.dataset\.n = String\(n\);/);
  assert.match(fn, /\$b\('#btn-bl-send-po'\)\.textContent = `Send to Product Owner \(\$\{n\}\)`;/);
  assert.match(fn, /window\.BacklogPO\?\.syncSendButton\(\);/); // backlog-po.js keeps it disabled while busy
});

test('checkbox: the same bl.selected drives the selection checkbox in both the list row (issueRow) and the kanban card, so a selection made in one view is the other\'s too', () => {
  assert.equal((src.match(/\$\{checkbox\(i\)\}/g) || []).length, 2);
});

test('#btn-bl-send-po opens the Product Owner drawer with the shown selection attached, keeping the Backlog\'s own selection (unlike #btn-bl-clear, which clears it)', () => {
  assert.match(src, /\$b\('#btn-bl-send-po'\)\.onclick = \(\) => window\.BacklogPO\.attach\(shownSelected\(\)\);/);
  assert.match(src, /\$b\('#btn-bl-clear'\)\.onclick = \(\) => \{ bl\.selected\.clear\(\); render\(\); \};/);
});
