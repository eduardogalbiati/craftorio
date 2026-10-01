// src/renderer/backlog-po.js: the Product Owner's drawer renders a proposed analysis (groups,
// conflicts, issues to enrich) and applies a group only on the owner's click (Assign, roadmap). It
// runs only inside the Electron renderer, so these tests check its source as a seam, the way
// test/renderer-backlog-assign.test.js checks backlog.js.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'backlog-po.js'), 'utf8');

test('groupHtml renders the workflow, size, warnings and the Assign/Add to roadmap buttons, never applying anything by itself', () => {
  const fn = /function groupHtml\(g, m, n\)[\s\S]*?\n  \}/.exec(src)[0];
  assert.match(fn, /<span class="mono">\$\{esc\(g\.workflow\)\}<\/span>/);
  assert.match(fn, /\$\{sizeText\(g\)\}/);
  assert.match(fn, /\$\{\(g\.warnings \|\| \[\]\)\.map\(\(w\) => `<div class="small warn-text">⚠ \$\{esc\(w\)\}<\/div>`\)\.join\(''\)\}/);
  assert.match(fn, /data-po-act="assign"/);
  assert.match(fn, /data-po-act="roadmap"/);
  assert.doesNotMatch(fn, /api\.(startRun|assignIssues)/); // rendering never starts a run or assigns by itself
});

test('sizeText marks the estimate as an estimate and warns when some complexities were guessed', () => {
  const fn = /const sizeText = \(g\) => \{[\s\S]*?\n  \};/.exec(src)[0];
  assert.match(fn, /\(estimate from \$\{esc\(g\.estimate\.basis\)\}\)/);
  assert.match(fn, /no past run to estimate from/);
  assert.match(fn, /\(some guessed\)/);
});

test('answerHtml shows proposed runs, pairs not to run in parallel, and issues to enrich with a link to #103', () => {
  const fn = /function answerHtml\(a, m\)[\s\S]*?\n  \}/.exec(src)[0];
  assert.match(fn, /Proposed runs/);
  assert.match(fn, /Do not run in parallel/);
  assert.match(fn, /Enrich first/);
  assert.match(fn, /href="\$\{esc\(e\.link\)\}"/); // e.link: the #103 enrich-an-issue link, computed in src\/product-owner.js
  assert.match(fn, /data-po-act="roadmap-all"/);
});

test('apply: Assign and Add to roadmap act on one proposed group through window.BacklogActions, only when the owner clicks', () => {
  const fn = /async function apply\(act, el\)[\s\S]*?\n  \}/.exec(src)[0];
  assert.match(fn, /const answer = po\.messages\[m\]\?\.answer;/);
  assert.match(fn, /if \(act === 'assign'\) \{\s*const skipped = await actions\(\)\.assignGroup\(g\);/);
  assert.match(fn, /const skipped = await actions\(\)\.roadmapGroup\(g\);/);
  assert.match(fn, /None of these issues is To do any more\./); // every issue in the group was skipped
});

test('apply: Add all to the roadmap plans every group as a stage, ordered by its proposed stage number', () => {
  const fn = /async function apply\(act, el\)[\s\S]*?\n  \}/.exec(src)[0];
  assert.match(fn, /const stages = \[\.\.\.new Set\(answer\.groups\.map\(\(g\) => g\.stage\)\)\]\.sort\(\(a, b\) => a - b\)/);
  assert.match(fn, /await api\.proposeRoadmap\(po\.projectId, \{ stages \}, false\);/);
});

test('ask: a question is refused while another is pending, and the simulated flag (devMode) is sent with it', () => {
  const fn = /async function ask\(question\)[\s\S]*?\n  \}/.exec(src)[0];
  assert.match(fn, /if \(!q \|\| po\.busy \|\| !po\.projectId\) return;/);
  assert.match(fn, /await api\.askProductOwner\(projectId, q, devMode\(\)\);/);
});

test('the conversation and the applied-group notes reset when the drawer switches to another project', () => {
  const fn = /async function open\(\)[\s\S]*?\n  \}/.exec(src)[0];
  assert.match(fn, /if \(po\.projectId !== projectId\) Object\.assign\(po, \{ projectId, messages: \[\], pending: null, error: null, notes: \{\} \}\);/);
});
