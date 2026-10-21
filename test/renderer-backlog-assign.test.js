// src/renderer/views/backlog/backlog.js: the Backlog "Assign a workflow" modal. It runs only
// inside the Electron renderer (document, window.api), so these tests check its source as a seam,
// the way test/agents.test.js checks robots.js and test/renderer-styles.test.js checks the
// stylesheets.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const en = require('../src/shared/i18n/en.json');

const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'views', 'backlog', 'backlog.js'), 'utf8');

test('openAssign: the Simulation checkbox defaults to unchecked, not to Developer mode', () => {
  assert.match(src, /#assign-mock['"]\)\.checked\s*=\s*!!state\.simulationOnly/);
  assert.doesNotMatch(src, /#assign-mock['"]\)\.checked\s*=\s*devMode\(\)/);
});

test('updateAssignNote: the real-run note drops the "one at a time" / ordering claim', () => {
  const note = /function updateAssignNote\(\)[\s\S]*?\n  \}/.exec(src)[0];
  assert.doesNotMatch(note, /one at a time/);
  assert.doesNotMatch(note, /starting now if nothing else is running/);
  // still switches the submit button text between Simulate and Start (#330: one plural catalog entry
  // per variant, picked by the number of runs)
  assert.match(note, /const runCount = \{ count: runs \};/);
  assert.match(note, /\$b\('#btn-assign-ok'\)\.textContent = t\(mock \? 'backlog\.assign_simulate_runs' : 'backlog\.assign_start_runs', runCount\);/);
  assert.deepEqual(en['backlog.assign_simulate_runs'], { one: 'Simulate {count} run', other: 'Simulate {count} runs' });
  assert.deepEqual(en['backlog.assign_start_runs'], { one: 'Start {count} run', other: 'Start {count} runs' });
});

test('#330 the Assign button reads "Simulate 1 run" / "Start 3 runs" in English and its Portuguese text in pt-BR', () => {
  const I18n = require('../src/shared/i18n.js');
  assert.equal(I18n.t('backlog.assign_simulate_runs', { count: 1 }, 'en'), 'Simulate 1 run');
  assert.equal(I18n.t('backlog.assign_start_runs', { count: 3 }, 'en'), 'Start 3 runs');
  assert.equal(I18n.t('backlog.assign_simulate_runs', { count: 1 }, 'pt-BR'), 'Simular 1 execução');
  assert.equal(I18n.t('backlog.assign_start_runs', { count: 3 }, 'pt-BR'), 'Iniciar 3 execuções');
});

test('status(): a run the supervisor sent back after a failed merge shows a "sent back" badge with its record', () => {
  const status = /function status\(i\)[\s\S]*?\n  \}/.exec(src)[0];
  assert.match(status, /const recovered = r\.recovery \? `<span class="badge bl-recovered"/);
  assert.match(status, /title="\$\{esc\(t\('backlog\.supervisor_recovery', \{ recovery: r\.recovery \}\)\)\}"/);
  assert.equal(en['backlog.supervisor_recovery'], 'Supervisor: {recovery}');
  assert.match(status, /\$\{t\('backlog\.sent_back_after_a_failed_merge'\)\}<\/span>` : ''/);
  assert.equal(en['backlog.sent_back_after_a_failed_merge'], 'sent back after a failed merge');
});

// ---- renderAssignInputs (#116): human labels/pills/switches via WorkflowInputs, not raw selects ---

test('renderAssignInputs: the workflow\'s inputs are drawn by WorkflowInputs (human labels, pills, switches), prefilled from the project\'s hints without overriding a remembered value', () => {
  const fn = /function renderAssignInputs\(\)[\s\S]*?\n  \}/.exec(src)[0];
  assert.match(fn, /const defs = Object\.fromEntries\(Object\.entries\(wf\?\.inputs \|\| \{\}\)\.filter\(\(\[k, def\]\) => !skipInput\(k, def \|\| \{\}\)\)\);/);
  assert.match(fn, /box\.innerHTML = WorkflowInputs\.formHtml\(defs, \{ values: saved, id: \(k\) => `ai-\$\{k\}`, attrs: \(k\) => `data-input="\$\{esc\(k\)\}"` \}\);/);
  assert.match(fn, /WorkflowInputs\.applyHints\(box, defs, bl\.projectId, \{ keep: Object\.keys\(saved\) \}\);/);
  // the "Settings" group is hidden when the workflow has no input left to show
  assert.match(fn, /\$b\('#assign-settings'\)\.classList\.toggle\('hidden', !Object\.keys\(defs\)\.length\);/);
});

test('renderAssignInputs: the workflow\'s "About" details only appear when its description is more than the leading one-line summary', () => {
  const fn = /function renderAssignInputs\(\)[\s\S]*?\n  \}/.exec(src)[0];
  assert.match(fn, /\$b\('#assign-wf-about'\)\.classList\.toggle\('hidden', !about \|\| firstSentence\(about\) === about\.trim\(\)\);/);
});

test('submitAssign: assigning an issue the roadmap already plans asks first, and takes it out of the roadmap', () => {
  const fn = /async function submitAssign\(e\)[\s\S]*?\n  \}/.exec(src)[0];
  assert.match(fn, /const inRoadmap = planned\(numbers\);/);
  assert.match(fn, /if \(inRoadmap\.length && !await confirmDialog\(t\('backlog\.already_in_the_roadmap'\)/);
  assert.equal(en['backlog.already_in_the_roadmap'], 'Already in the roadmap');
  assert.match(fn, /t\(inRoadmap\.length > 1 \? 'backlog\.planned_in_roadmap_many' : 'backlog\.planned_in_roadmap_one'/);
  assert.match(en['backlog.planned_in_roadmap_many'], /takes them out of the roadmap and into the queue/);
  assert.match(en['backlog.planned_in_roadmap_one'], /takes it out of the roadmap and into the queue/);
});

// ---- The kept-work question (#170): assign and queue resume share the same two named choices ---

test('submitAssign: an ended run\'s kept work (assignWorkflow\'s `kept`) opens the kept-work dialog; "resume" also closes the Assign modal; only "scratch" assigns again, confirmed', () => {
  const fn = /async function submitAssign\(e\)[\s\S]*?\n  \}/.exec(src)[0];
  // then (#134): what happens with the run's result when it finishes, from the Assign dialog's chain picker;
  // a pipeline (#135) brings its own chain instead, so `then` is null and its file goes as `pipeline`
  assert.match(fn, /const then = pipe \? null : assignChain\(\)\.value\(\);/);
  assert.match(fn, /const pipeline = pipe\?\.file \|\| null;/);
  // #262: and the Agents section's choices (none for a pipeline)
  assert.match(fn, /const agentOverrides = pipe \? null : assignAgentOverrides\(\);/);
  assert.match(fn, /let data = await api\.assignWorkflow\(bl\.projectId, numbers, workflow, inputs, mock, grouped\(\), false, then, pipeline, agentOverrides\);/);
  assert.match(fn, /if \(data\?\.kept\) \{/);
  assert.match(fn, /const kept = await keptWorkDialog\(data\.kept\);/);
  assert.match(fn, /if \(kept === 'resume'\) closeModal\('#assign-modal'\);/);
  assert.match(fn, /if \(kept !== 'scratch'\) return;/);
  assert.match(fn, /data = await api\.assignWorkflow\(bl\.projectId, numbers, workflow, inputs, mock, grouped\(\), true, then, pipeline, agentOverrides\);/);
});

// ---- Assign a saved pipeline (#135): the dropdown lists it, its first workflow receives the issues ---

test('submitAssign: a pipeline picked in the dropdown runs its first stage\'s workflow, not the dialog\'s own "When it finishes"', () => {
  const fn = /async function submitAssign\(e\)[\s\S]*?\n  \}/.exec(src)[0];
  assert.match(fn, /const pipe = assignPipeline\(\);/);
  assert.match(fn, /const workflow = pipe \? pipe\.stages\[0\]\.workflow : choice;/);
});

test('assignPipeline: the selected pipeline, found by its `pipe:<file>` option value', () => {
  assert.match(src, /const PIPE = 'pipe:';/);
  assert.match(src, /const assignPipeline = \(\) => \(bl\.pipelines \|\| \[\]\)\.find\(\(p\) => PIPE \+ p\.file === \$b\('#assign-workflow'\)\.value\) \|\| null;/);
});

test('openAssign: only pipelines whose first workflow can receive the issues are listed, after the workflows in their own optgroup', () => {
  const fn = /async function openAssign\(prefill = null\)[\s\S]*?\n  \}/.exec(src)[0];
  assert.match(fn, /bl\.pipelines = pipes\.filter\(\(p\) => !p\.error && bl\.workflows\.some\(\(w\) => w\.file === p\.stages\[0\]\?\.workflow\)\);/);
  assert.match(fn, /<optgroup label="Workflows">\$\{options\}<\/optgroup><optgroup label="Pipelines">/);
});

test('renderAssignInputs: a pipeline sets its first stage\'s fixed inputs, shows its stages instead of "When it finishes", and disables "Plan it" (a roadmap stage runs one workflow)', () => {
  const fn = /function renderAssignInputs\(\)[\s\S]*?\n  \}/.exec(src)[0];
  assert.match(fn, /for \(const \[k, v\] of Object\.entries\(pipe\?\.stages\[0\]\.inputs \|\| \{\}\)\) if \(defs\[k\]\) WorkflowInputs\.set\(box, k, v\);/);
  assert.match(fn, /\$b\('#assign-chain'\)\.classList\.toggle\('hidden', !!pipe\);/);
  assert.match(fn, /toRoadmap\.disabled = !!pipe;/);
});

test('queue resume (data-pause="off"): an ended run\'s kept work opens the kept-work dialog; only "scratch" resumes the queue again, confirmed', () => {
  // the panel's toggle and the queue alert's Resume (#422) share setQueuePaused
  const panel = /\$b\('#bl-queue'\)\.onclick = async \(e\) => \{[\s\S]*?\n    \};/.exec(src)[0];
  assert.match(panel, /if \(b\) await setQueuePaused\(b, b\.dataset\.pause === 'on'\);/);
  const fn = /async function setQueuePaused\(button, on\) \{[\s\S]*?\n  \}/.exec(src)[0];
  assert.match(fn, /let out = await api\.pauseQueue\(bl\.projectId, on\);/);
  assert.match(fn, /if \(out\?\.kept && await keptWorkDialog\(out\.kept\) === 'scratch'\) out = await api\.pauseQueue\(bl\.projectId, false, true\);/);
});

test('openAssign: a prefill from the Product Owner picks its workflow, groups its issues into one run, and fills its inputs', () => {
  const fn = /async function openAssign\(prefill = null\)[\s\S]*?\n  \}/.exec(src)[0];
  // the proposed workflow wins over the last-used one when it exists among the project's workflows;
  // nothing remembered falls back to the default development workflow (#195)
  assert.match(fn, /sel\.value = \[prefill\?\.workflow, load\(WORKFLOW_KEY\), DefaultWorkflow\.current\(\)\.file, files\[0\]\]\.find\(\(f\) => f && files\.includes\(f\)\);/);
  // a multi-issue group is assigned as one run, not as separate runs
  assert.match(fn, /document\.querySelector\(`input\[name="assign-group"\]\[value="\$\{prefill\?\.group \? 'group' : 'separate'\}"\]`\)\.checked = true;/);
  // each proposed input value is written into its field, through the shared WorkflowInputs renderer
  assert.match(fn, /for \(const \[k, v\] of Object\.entries\(prefill\?\.inputs \|\| \{\}\)\) WorkflowInputs\.set\(\$b\('#assign-inputs'\), k, v\);/);
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

test('roadmapGroup: a proposed group (its Product Owner answer\'s origin, #140, and its cost, #205) is forwarded to BacklogRoadmap.addStage as a new stage', () => {
  const fn = /async function roadmapGroup\(\{ issues, workflow, inputs, reason, modeReason, origin, cost \}\)[\s\S]*?\n  \}/.exec(src)[0];
  assert.match(fn, /const skipped = issues\.filter\(\(n\) => !list\.some\(\(i\) => i\.number === n\)\);/);
  assert.match(fn, /if \(!list\.length\) return skipped;/);
  assert.match(fn, /await window\.BacklogRoadmap\.addStage\(roadmapCtx\(\), bl\.data, \{\s*issues: list, workflow, workflowName: wf\?\.name \|\| workflow, inputs: inputs \|\| \{\}, mock: !!state\.simulationOnly, group: list\.length > 1, reason, modeReason, origin, cost,/);
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
  assert.match(fn, /\$b\('#btn-bl-assign'\)\.textContent = t\('backlog\.assign_workflow_n', \{ n \}\);/);
  assert.equal(en['backlog.assign_workflow_n'], 'Assign workflow… ({n})');
  assert.match(fn, /\$b\('#btn-bl-send-po'\)\.classList\.toggle\('hidden', !n\);/);
  assert.match(fn, /\$b\('#btn-bl-send-po'\)\.dataset\.n = String\(n\);/);
  assert.match(fn, /\$b\('#btn-bl-send-po'\)\.textContent = t\('backlog\.send_to_product_owner_n', \{ n \}\);/);
  assert.equal(en['backlog.send_to_product_owner_n'], 'Send to Product Owner ({n})');
  assert.match(fn, /window\.BacklogPO\?\.syncSendButton\(\);/); // backlog-po.js keeps it disabled while busy
});

test('checkbox: the same bl.selected drives the selection checkbox in both the list row (issueRow) and the kanban card, so a selection made in one view is the other\'s too', () => {
  assert.equal((src.match(/\$\{checkbox\(i\)\}/g) || []).length, 2);
});

test('#btn-bl-send-po opens the Product Owner drawer with the shown selection attached, keeping the Backlog\'s own selection (unlike #btn-bl-clear, which clears it)', () => {
  assert.match(src, /\$b\('#btn-bl-send-po'\)\.onclick = \(\) => window\.BacklogPO\.attach\(shownSelected\(\)\);/);
  assert.match(src, /\$b\('#btn-bl-clear'\)\.onclick = \(\) => \{ bl\.selected\.clear\(\); render\(\); \};/);
});
