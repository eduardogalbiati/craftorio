// src/renderer/backlog-po.js: the Product Owner's drawer renders a proposed analysis (groups,
// conflicts, issues to enrich) and applies a group only on the owner's click (Assign, roadmap). It
// runs only inside the Electron renderer, so these tests check its source as a seam, the way
// test/renderer-backlog-assign.test.js checks backlog.js.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'backlog-po.js'), 'utf8');

test('groupHtml renders the workflow, size, warnings, the mode reason and the Assign/Add to roadmap buttons, never applying anything by itself', () => {
  const fn = /function groupHtml\(g, m, n\)[\s\S]*?\n  \}/.exec(src)[0];
  assert.match(fn, /<span class="mono">\$\{esc\(g\.workflow\)\}<\/span>/);
  assert.match(fn, /\$\{sizeText\(g\)\}/);
  assert.match(fn, /\$\{\(g\.warnings \|\| \[\]\)\.map\(\(w\) => `<div class="small warn-text">⚠ \$\{esc\(w\)\}<\/div>`\)\.join\(''\)\}/);
  assert.match(fn, /\$\{g\.modeReason \? `<div class="small"><span class="muted">mode:<\/span> \$\{esc\(g\.modeReason\)\}<\/div>` : ''\}/);
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

test('apply: Add all to the roadmap plans every group as a stage, ordered by its proposed stage number, each item carrying the group\'s reason and modeReason', () => {
  const fn = /async function apply\(act, el\)[\s\S]*?\n  \}/.exec(src)[0];
  assert.match(fn, /const stages = \[\.\.\.new Set\(answer\.groups\.map\(\(g\) => g\.stage\)\)\]\.sort\(\(a, b\) => a - b\)/);
  assert.match(fn, /items: answer\.groups\.filter\(\(g\) => g\.stage === s\)\.map\(\(g\) => \(\{ workflow: g\.workflow, issues: g\.issues, inputs: g\.inputs, mock: !!state\.simulationOnly, reason: g\.reason, modeReason: g\.modeReason \}\)\)/);
  assert.match(fn, /await api\.proposeRoadmap\(po\.projectId, \{ stages \}, false\);/);
});

test('ask: a question is refused while another is pending, and the simulated flag (devMode), the mode and any staged attachments are sent with it', () => {
  const fn = /async function ask\(question\)[\s\S]*?\n  \}/.exec(src)[0];
  assert.match(fn, /if \(!q \|\| po\.busy \|\| !po\.projectId\) return;/);
  assert.match(fn, /await api\.askProductOwner\(projectId, q, devMode\(\), mode, files\);/);
});

test('the conversation and the applied-group notes reset when the drawer switches to another project', () => {
  const fn = /async function open\(\)[\s\S]*?\n  \}/.exec(src)[0];
  assert.match(fn, /if \(po\.projectId !== projectId\) Object\.assign\(po, \{ projectId, messages: \[\], pending: null, error: null, notes: \{\} \}\);/);
});

// ---- registering an issue (#117): the draft shown in the chat is filed only on the owner's click ---

test('openDraftIndex uses the same rule as currentDraft in src/product-owner.js: a draft is open until a non-preview filing or a discard closes it', () => {
  const fn = /function openDraftIndex\(\)[\s\S]*?\n  \}/.exec(src)[0];
  assert.match(fn, /if \(\(m\.filed && !m\.filed\.preview\) \|\| m\.discarded\) return -1;/);
  assert.match(fn, /if \(m\.role === 'po' && m\.mode === 'issue' && \(m\.issue\?\.draft \|\| m\.issue\?\.existingIssue\)\) return i;/);
});

test('candidates lists the issues a draft could go into instead (the owner\'s own target, then close issues), deduplicated and capped at MAX_CANDIDATES', () => {
  const fn = /const candidates = \(x\) => [^\n]*/.exec(src)[0];
  assert.match(fn, /x\.existingIssue/);
  assert.match(fn, /\.filter\(\(d\) => d\.state !== 'closed'\)\.map\(\(d\) => d\.number\)/);
  assert.match(fn, /new Set\(\[/); // deduplicated
  assert.match(fn, /\.slice\(0, MAX_CANDIDATES\)/);
});

test('draftActions never files by itself: Create, Add to #n instead and Discard are buttons (data-po-act) the owner must click, each naming what it does', () => {
  const fn = /function draftActions\(x, m\)[\s\S]*?\n  \}/.exec(src)[0];
  assert.match(fn, /data-po-act="create"/);
  assert.match(fn, /data-po-act="append" data-n="\$\{n\}"/);
  assert.match(fn, /Add to #\$\{n\}\$\{x\.draft \? ' instead' : ''\}/);
  assert.match(fn, /data-po-act="discard"/);
  assert.match(fn, /data-po-act="revise"/);
  assert.doesNotMatch(fn, /api\.(fileProductOwnerDraft|discardProductOwnerDraft)/); // rendering never files or discards by itself
});

test('fileDraft (the owner\'s click): every "create" variant files action "create", not a new issue when appending or commenting; a real filing asks to confirm first', () => {
  const fn = /async function fileDraft\(act, el\)[\s\S]*?\n  \}/.exec(src)[0];
  assert.match(fn, /const action = act\.startsWith\('create'\) \? 'create' : act;/); // append/comment/discard/revise pass through unchanged
  assert.match(fn, /if \(!simulated\) \{[\s\S]*?if \(!await confirmDialog\(\.\.\.what\)\) return;/); // a real (non-simulated) filing is confirmed first
  assert.match(fn, /await api\.fileProductOwnerDraft\(po\.projectId, msg\.ts, action, n, simulated\);/);
});
