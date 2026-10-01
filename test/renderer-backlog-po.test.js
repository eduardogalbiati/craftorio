// src/renderer/views/backlog/backlog-po.js: the Product Owner's drawer renders a proposed
// analysis (groups, conflicts, issues to enrich) and applies a group only on the owner's click
// (Assign, roadmap). It runs only inside the Electron renderer, so these tests check its source as
// a seam, the way test/renderer-backlog-assign.test.js checks backlog.js.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'views', 'backlog', 'backlog-po.js'), 'utf8');

// A group's applied state (#140) is derived (groupState) from the Backlog's own data (each issue's
// roadmap place, queue entry and live run): pure enough to pull out of the source and run for real,
// the way test/renderer-run-view.test.js checks app.js's own pure helpers as a seam.
function loadAppliedState() {
  const liveRun = /const liveRun = [^\n]+;/.exec(src)[0];
  const inRoadmap = /const inRoadmap = [^\n]+;/.exec(src)[0];
  const groupStateFn = /function groupState\(g\) \{[\s\S]*?\n  \}/.exec(src)[0];
  const stagesLabel = /const stagesLabel = [^\n]+;/.exec(src)[0];
  const appliedBadgeFn = /function appliedBadge\(st, already\) \{[\s\S]*?\n  \}/.exec(src)[0];
  const appliedFn = /const applied = [^\n]+;/.exec(src)[0];
  const appliedTitleFn = /const appliedTitle = [^\n]+;/.exec(src)[0];
  for (const [name, code] of Object.entries({ liveRun, inRoadmap, groupStateFn, stagesLabel, appliedBadgeFn, appliedFn, appliedTitleFn })) {
    assert.ok(code, `${name} not found in backlog-po.js: the source moved`);
  }
  let issues = [];
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const sandbox = { esc, issueOf: (n) => issues.find((i) => i.number === n) };
  vm.createContext(sandbox);
  vm.runInContext(
    `${liveRun}\n${inRoadmap}\n${groupStateFn}\n${stagesLabel}\n${appliedBadgeFn}\n${appliedFn}\n${appliedTitleFn}\n`
    + 'this.helpers = { groupState, appliedBadge, applied, appliedTitle, stagesLabel };',
    sandbox,
  );
  return { helpers: sandbox.helpers, setIssues: (list) => { issues = list; } };
}

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

// ---- a group already applied (#140): derived from the Backlog's data, never remembered ----------

test('groupState: every issue planned, running or done in the roadmap (not skipped) is covered; its stages are deduplicated and sorted', () => {
  const { helpers, setIssues } = loadAppliedState();
  setIssues([{ number: 1, roadmap: { stage: 3, status: 'planned' } }, { number: 2, roadmap: { stage: 1, status: 'done' } }]);
  const st = helpers.groupState({ issues: [1, 2] });
  assert.equal(st.kind, 'roadmap');
  assert.deepEqual([...st.stages], [1, 3]); // st.stages is built with its own [...] inside the sandbox realm
  assert.deepEqual(st.covered, [1, 2]);
  assert.deepEqual(st.rest, []);
});

test('groupState: a skipped roadmap item does not count as "in the roadmap": the group is still to apply', () => {
  const { helpers, setIssues } = loadAppliedState();
  setIssues([{ number: 1, roadmap: { stage: 1, status: 'skipped' } }]);
  const st = helpers.groupState({ issues: [1] });
  assert.equal(st.kind, null);
  assert.deepEqual(st.covered, []);
});

test('groupState: some issues covered (roadmap, queued or a live run) and some not is "partly", listing what is covered and what is left', () => {
  const { helpers, setIssues } = loadAppliedState();
  setIssues([{ number: 1, roadmap: { stage: 2, status: 'planned' } }, { number: 2 }]);
  const st = helpers.groupState({ issues: [1, 2] });
  assert.equal(st.kind, 'partly');
  assert.deepEqual(st.covered, [1]);
  assert.deepEqual(st.rest, [2]);
});

test('groupState: a pending or running run makes the group "running", with its runId; an enrich run does not count as live', () => {
  const { helpers, setIssues } = loadAppliedState();
  setIssues([{ number: 1, runs: [{ runId: 'run-9', status: 'running', enrich: false }] }]);
  let st = helpers.groupState({ issues: [1] });
  assert.equal(st.kind, 'running');
  assert.equal(st.runId, 'run-9');

  setIssues([{ number: 2, runs: [{ runId: 'run-x', status: 'running', enrich: true }] }]);
  st = helpers.groupState({ issues: [2] });
  assert.equal(st.kind, null); // an enrich run is not an applied group's run
});

test('groupState: an issue only in the queue (no roadmap place, no live run) makes the group "queued", with no runId', () => {
  const { helpers, setIssues } = loadAppliedState();
  setIssues([{ number: 1, queued: true }]);
  const st = helpers.groupState({ issues: [1] });
  assert.equal(st.kind, 'queued');
  assert.equal(st.runId, null);
});

test('applied: true for roadmap, running and queued groups; false for a partly applied or a still-to-apply one', () => {
  const { helpers } = loadAppliedState();
  for (const kind of ['roadmap', 'running', 'queued']) assert.equal(helpers.applied({ kind }), true, kind);
  for (const kind of ['partly', null]) assert.equal(helpers.applied({ kind }), false, String(kind));
});

test('appliedBadge: "roadmap" links to the first stage, reading "In roadmap · Stage N" for this answer\'s own items, or "Already in the roadmap" otherwise', () => {
  const { helpers } = loadAppliedState();
  const st = { kind: 'roadmap', stages: [2, 3], covered: [1, 2], rest: [], runId: null };
  const own = helpers.appliedBadge(st, false);
  assert.match(own, /data-po-stage="2"/);
  assert.match(own, /In roadmap · Stages 2, 3/);
  const already = helpers.appliedBadge(st, true);
  assert.match(already, /Already in the roadmap/);
  assert.doesNotMatch(already, /In roadmap ·/);
});

test('appliedBadge: "running" with a runId links to that run; without one, or "queued", shows a plain Queued badge', () => {
  const { helpers } = loadAppliedState();
  assert.match(helpers.appliedBadge({ kind: 'running', runId: 'run-7' }, false), /data-po-run="run-7"/);
  assert.match(helpers.appliedBadge({ kind: 'running', runId: null }, false), />Queued</);
  assert.match(helpers.appliedBadge({ kind: 'queued', runId: null }, false), />Queued</);
});

test('appliedBadge: "partly" names what is covered and what is left, "in the roadmap" when a stage is known, else "assigned"', () => {
  const { helpers } = loadAppliedState();
  const inRoadmap = helpers.appliedBadge({ kind: 'partly', stages: [1], covered: [1], rest: [2, 3] }, false);
  assert.match(inRoadmap, /Partly in the roadmap \(#1\)/);
  assert.match(inRoadmap, /title="#1 already in the roadmap; #2, #3 not yet"/);
  const assigned = helpers.appliedBadge({ kind: 'partly', stages: [], covered: [4], rest: [5] }, false);
  assert.match(assigned, /Partly assigned \(#4\)/);
});

test('appliedTitle: names the stage for a group already in the roadmap, else whether it is running or queued', () => {
  const { helpers } = loadAppliedState();
  assert.equal(helpers.appliedTitle({ kind: 'roadmap', stages: [4] }), 'Already in the roadmap, stage 4');
  assert.equal(helpers.appliedTitle({ kind: 'running' }), 'Already assigned: its run is in progress');
  assert.equal(helpers.appliedTitle({ kind: 'queued' }), 'Already assigned: it is in the queue');
});

test('groupHtml: an applied group is shown dimmed with its badge, Assign and Add to roadmap disabled and titled with why; a partly applied one offers "Add the rest" instead', () => {
  const fn = /function groupHtml\(g, m, n\)[\s\S]*?\n  \}/.exec(src)[0];
  assert.match(fn, /const st = groupState\(g\);/);
  assert.match(fn, /const done = applied\(st\);/);
  assert.match(fn, /<div class="po-group\$\{done \? ' applied' : ''\}"/);
  assert.match(fn, /const off = done \? ` disabled title="\$\{esc\(appliedTitle\(st\)\)\}"` : '';/);
  assert.match(fn, /<button class="btn sm primary" type="button" data-po-act="assign"\$\{off \|\| ' title="Open the assign dialog with these issues as one run"'\}>Assign…<\/button>/);
  assert.match(fn, /st\.kind === 'partly'/);
  assert.match(fn, /Add the rest<\/button>/);
  assert.match(fn, /\$\{appliedBadge\(st, already\)\}/);
});

test('groupHtml: "Already in the roadmap" (vs "In roadmap · Stage N") depends on the roadmap item\'s origin matching this answer\'s own timestamp, not on a transient note (#140 follow-up)', () => {
  const fn = /function groupHtml\(g, m, n\)[\s\S]*?\n  \}/.exec(src)[0];
  assert.match(fn, /const from = po\.messages\[m\]\?\.ts;/);
  assert.match(fn, /const already = st\.kind === 'roadmap' && g\.issues\.every\(\(x\) => issueOf\(x\)\?\.roadmap\?\.origin !== from\);/);
  // never derived from po.notes: it would reset on a reopen/restart, where notes are empty
  assert.doesNotMatch(fn, /po\.notes\[`\$\{m\}:all`\]\?\.dropped/);
});

test('answerHtml: "Add all to the roadmap" is disabled once every proposed group is already applied', () => {
  const fn = /function answerHtml\(a, m\)[\s\S]*?\n  \}/.exec(src)[0];
  assert.match(fn, /const allDone = a\.groups\.every\(\(g\) => applied\(groupState\(g\)\)\);/);
  assert.match(fn, /data-po-act="roadmap-all" data-msg="\$\{m\}" title="\$\{allTitle\}"\$\{allDone \? ' disabled' : ''\}/);
});

test('the drawer re-renders (keeping its scroll position) when the Backlog\'s roadmap, queue or runs change, so an applied group\'s state never needs remembering', () => {
  assert.match(src, /document\.addEventListener\('backlog:data', \(\) => \{/);
  const listener = /document\.addEventListener\('backlog:data', \(\) => \{[\s\S]*?\n  \}\);/.exec(src)[0];
  assert.match(listener, /if \(!po\.open\) return;/);
  assert.match(listener, /const top = log\.scrollTop;/);
  assert.match(listener, /render\(\);/);
  assert.match(listener, /log\.scrollTop = top;/);
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

test('apply: Add all to the roadmap plans every group as a stage, ordered by its proposed stage number, each item carrying the group\'s reason, modeReason and the answer\'s origin (#140)', () => {
  const fn = /async function apply\(act, el\)[\s\S]*?\n  \}/.exec(src)[0];
  assert.match(fn, /const origin = po\.messages\[m\]\.ts;/);
  assert.match(fn, /const stages = \[\.\.\.new Set\(answer\.groups\.map\(\(g\) => g\.stage\)\)\]\.sort\(\(a, b\) => a - b\)/);
  assert.match(fn, /items: answer\.groups\.filter\(\(g\) => g\.stage === s\)\.map\(\(g\) => \(\{ workflow: g\.workflow, issues: g\.issues, inputs: g\.inputs, mock: !!state\.simulationOnly, reason: g\.reason, modeReason: g\.modeReason, origin \}\)\)/);
  assert.match(fn, /await api\.proposeRoadmap\(po\.projectId, \{ stages \}, false\);/);
});

test('apply: a group already applied is never applied again; a partly applied one sends only the issues not yet covered, both carrying the answer\'s origin (#140)', () => {
  const fn = /async function apply\(act, el\)[\s\S]*?\n  \}/.exec(src)[0];
  assert.match(fn, /const st = groupState\(answer\.groups\[n\]\);/);
  assert.match(fn, /if \(applied\(st\)\) return;/);
  assert.match(fn, /const g = \{ \.\.\.answer\.groups\[n\], \.\.\.\(st\.kind === 'partly' \? \{ issues: st\.rest \} : \{\}\), origin \};/);
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
  // #138: a draft that names its epic (x.draft.epic) joins it on Create only, and only while "Place in epic" is checked
  assert.match(fn, /await api\.fileProductOwnerDraft\(po\.projectId, msg\.ts, action, n, simulated, action === 'create' && !!x\.draft\?\.epic && placeEpic\(m\)\);/);
});

// ---- a drafted issue may join its epic (#138) --------------------------------------------------------

test('placeEpic: "Place in epic" defaults to the project\'s Auto-place option, until the owner toggles it for this message', () => {
  const fn = /const placeEpic = \(m\) => [^\n]+/.exec(src)[0];
  assert.match(fn, /m in po\.placeEpic \? po\.placeEpic\[m\] : !!actions\(\)\?\.data\(\)\?\.autoEpic/);
});

test('the "Place in epic" checkbox only shows next to the open draft, and toggling it records the owner\'s choice for that message, filing nothing by itself', () => {
  assert.match(src, /data-po-epic\$\{placeEpic\(m\) \? ' checked' : ''\}/);
  assert.match(src, /m === openDraftIndex\(\) \? `<label class="check small"[^`]*data-po-epic/);
  const click = /\$p\('#po-log'\)\.onclick = \(e\) => \{[\s\S]*?\n  \};/.exec(src)[0];
  assert.match(click, /const epic = e\.target\.closest\('\[data-po-epic\]'\);/);
  assert.match(click, /if \(epic\) \{ po\.placeEpic\[Number\(epic\.closest\('\[data-msg\]'\)\.dataset\.msg\)\] = epic\.checked; return; \}/);
});
