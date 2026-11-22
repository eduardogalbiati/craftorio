// fronts/build/views/backlog/backlog-po-proposals.js: the Product Owner's "Split what is too big"
// (#124). It runs only inside the Electron renderer, so it is loaded whole into a vm sandbox, the way
// test/renderer-backlog-roadmap.test.js checks backlog-roadmap.js. These tests cover #195 (the
// workflow select next to Split + roadmap) and #609 (only the clicked split/epic action is busy).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
// a page file by its page-relative name, in whichever layer holds it (the UI kit, a front, the page folder)
const pageFileOf = (rel) => require('../../../scripts/source-tree').pageFile(path.join(__dirname, '..', '..', '..'), rel);
const vm = require('vm');
const { withI18n } = require('@craftorio/shared/test/i18n-sandbox.js');

const src = fs.readFileSync(pageFileOf('views/backlog/backlog-po-proposals.js'), 'utf8');
const defaultWorkflowSrc = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'packages', 'shared', 'default-workflow.js'), 'utf8');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

function loadProposals({ confirmDialog, devMode, splitProductOwnerIssue, proposeRoadmap, workflows, fileProductOwnerSpec } = {}) {
  const proposeCalls = [];
  const specCalls = [];
  const sandbox = {
    esc,
    state: { workflows: workflows || [], simulationOnly: false, settings: { defaultWorkflow: null } },
    errMsg: (e) => String(e?.message || e),
    devMode: devMode || (() => true), // simulated by default: no confirmation dialog needed
    confirmDialog: confirmDialog || (async () => true),
    api: {
      splitProductOwnerIssue: splitProductOwnerIssue || (async () => ({ messages: [], children: [] })),
      // #670: the spec's issues filed; each call recorded as plain strings
      fileProductOwnerSpec: async (projectId, at, simulated) => {
        specCalls.push({ projectId, at, simulated });
        return (fileProductOwnerSpec || (async () => ({ messages: [], issues: [] })))(projectId, at, simulated);
      },
      // proposal.stages is built inside the vm realm: Array.from (the outer realm's) copies each level
      // so the pushed value is plain outer-realm data assert.deepEqual can compare.
      proposeRoadmap: async (projectId, proposal) => {
        const stages = Array.from(proposal.stages, (st) => ({ name: st.name, items: Array.from(st.items, (i) => ({ workflow: i.workflow, issues: Array.from(i.issues) })) }));
        proposeCalls.push({ projectId, stages });
        return (proposeRoadmap || (() => ({ roadmap: { stages: [] } })))(proposal);
      },
    },
  };
  sandbox.window = sandbox;
  sandbox.window.BacklogActions = { data: () => ({ epics: [] }), showData: () => {}, showRoadmap: () => {} };
  vm.createContext(withI18n(sandbox));
  vm.runInContext(defaultWorkflowSrc, sandbox); // the real DefaultWorkflow module (#195)
  vm.runInContext(src, sandbox);
  return { BacklogPoProposals: sandbox.window.BacklogPoProposals, sandbox, proposeCalls, specCalls };
}

const WORKFLOWS = [
  { file: 'software-development.yaml', name: 'Software development', inputs: { task: { type: 'string' } } },
  { file: 'feature.yaml', name: 'Software development (local)', inputs: { task: { type: 'string' } } },
];

function split(issue, over = {}) {
  return { issue, title: `Issue ${issue}`, tasks: [{ n: 1, text: 't1' }, { n: 2, text: 't2' }], reasons: ['Too big.'], children: [
    { stage: 1, complexity: 2, title: 'Child A', tasks: [1], reason: '' },
    { stage: 2, complexity: 2, title: 'Child B', tasks: [2], reason: '' },
  ], ...over };
}
function makeCtx(messages) {
  return { messages, projectId: 'p1', busy: false, issueRef: (n) => `#${n}`, issueOf: () => null, render: () => {}, setMessages: () => {} };
}
const settle = () => new Promise((r) => setTimeout(r, 0));

test('splitsHtml: the workflow select next to Split + roadmap defaults to the default development workflow, marked "(default)"', () => {
  const { BacklogPoProposals } = loadProposals({ workflows: WORKFLOWS });
  const s = split(1);
  const msg = { ts: 't1', answer: { splits: [s] } };
  const html = BacklogPoProposals.splitsHtml(makeCtx([msg]), msg);
  assert.match(html, /<select class="po-wf" data-split-wf/);
  // unset: falls back to the local workflow (DefaultWorkflow.resolve with no setting)
  assert.match(html, /<option value="feature\.yaml" selected>Software development \(local\) \(default\)<\/option>/);
  assert.match(html, /<option value="software-development\.yaml">Software development<\/option>/);
  assert.match(html, /title="File the children, then plan them in the roadmap in this order \(feature\)"/);
});

test('onInput [data-split-wf]: picking another workflow is kept for that split, and the "Split + roadmap" tooltip follows it', () => {
  const { BacklogPoProposals } = loadProposals({ workflows: WORKFLOWS });
  const s = split(2);
  const msg = { ts: 't2', answer: { splits: [s] } };
  const ctx = makeCtx([msg]);

  const box = { dataset: { split: '2' } };
  const msgBox = { dataset: { msg: '0' } };
  const select = { value: 'software-development.yaml', dataset: { splitWf: '' } };
  select.closest = (sel) => (sel === '[data-split]' ? box : sel === '[data-msg]' ? msgBox : null);

  const handled = BacklogPoProposals.onInput({ target: select, type: 'change' }, ctx);
  assert.equal(handled, true);

  const html = BacklogPoProposals.splitsHtml(ctx, msg);
  // local-hero is still the setting's default: the now-picked workflow carries no "(default)" suffix
  assert.match(html, /<option value="software-development\.yaml" selected>Software development<\/option>/);
  assert.match(html, /title="File the children, then plan them in the roadmap in this order \(software-development\)"/);
});

test('fileSplit (Split + roadmap): the roadmap stages use the split\'s picked workflow, falling back to the default when none was picked', async () => {
  const { BacklogPoProposals, proposeCalls } = loadProposals({
    workflows: WORKFLOWS,
    splitProductOwnerIssue: async () => ({ messages: [], children: [{ number: 11, stage: 1 }, { number: 12, stage: 2 }] }),
  });
  const s = split(3);
  const msg = { ts: 't3', answer: { splits: [s] } };
  const ctx = makeCtx([msg]);
  const splitBox = { dataset: { split: '3' } };
  const msgBox = { dataset: { msg: '0' } };
  const btn = { dataset: { splitAct: 'split-roadmap' } };
  btn.closest = (sel) => (sel === '[data-split-act], [data-split-parent], [data-split-merge], [data-epic-act]' ? btn : sel === '[data-split]' ? splitBox : sel === '[data-msg]' ? msgBox : null);

  const handled = await BacklogPoProposals.onClick({ target: btn }, ctx);
  assert.equal(handled, true);
  await settle(); // onClick fires fileSplit without awaiting it
  await settle();
  assert.equal(proposeCalls.length, 1);
  assert.deepEqual(proposeCalls[0].stages.flatMap((st) => st.items.map((i) => i.workflow)), ['feature.yaml', 'feature.yaml']);
});

// ---- #609: only the clicked split/epic action is busy while its request is in flight ----------------
// The rendered HTML is the seam: a control is read back as its attributes and inner HTML (strings only).

// A request the test resolves (or rejects) when it wants.
function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

// The part of the splits' HTML that belongs to split `issue` (up to the next split card).
function splitCard(html, issue) {
  const start = html.indexOf(`data-split="${issue}"`);
  assert.notEqual(start, -1, `split card #${issue} is rendered`);
  const next = html.indexOf('data-split="', start + 1);
  return html.slice(start, next === -1 ? html.length : next);
}
// The first control (button or select) of `html` whose opening tag carries `attr`.
function control(html, attr) {
  const re = /<(button|select)\b([^>]*)>([\s\S]*?)<\/\1>/g;
  for (let m = re.exec(html); m; m = re.exec(html)) {
    if (m[2].includes(attr)) return { attrs: m[2], inner: m[3] };
  }
  assert.fail(`no control with ${attr}`);
}
const isDisabled = (c) => /\sdisabled(\s|=|$)/.test(c.attrs);
// A visible busy state: aria-busy, or a busy/loading/spinner class on the button or on an element inside
// it. Not a "…" in the label: an idle label may end with one ("Edit…").
const BUSY_CLASS = /class="[^"]*\b(busy|loading|spinner|spinning|is-busy)\b/;
const isBusy = (c) => /aria-busy="true"/.test(c.attrs) || BUSY_CLASS.test(c.attrs) || BUSY_CLASS.test(c.inner);

// A click on a split's button (`act`) or an epic's (`epicAct`), through onClick like the drawer does.
function clickSplit(BacklogPoProposals, ctx, issue, act) {
  const splitBox = { dataset: { split: String(issue) } };
  const msgBox = { dataset: { msg: '0' } };
  const btn = { dataset: { splitAct: act } };
  btn.closest = (sel) => (sel.startsWith('[data-split-act]') ? btn : sel === '[data-split]' ? splitBox : sel === '[data-msg]' ? msgBox : null);
  return BacklogPoProposals.onClick({ target: btn }, ctx);
}
function clickEpic(BacklogPoProposals, ctx, key) {
  const msgBox = { dataset: { msg: '0' } };
  const btn = { dataset: { epicAct: key } };
  btn.closest = (sel) => (sel.startsWith('[data-split-act]') ? btn : sel === '[data-split]' ? null : sel === '[data-msg]' ? msgBox : null);
  return BacklogPoProposals.onClick({ target: btn }, ctx);
}

// Each issue's split request waits on its own deferred, so the test decides when each one returns.
function loadWithPendingSplits() {
  const pending = new Map();
  const loaded = loadProposals({
    workflows: WORKFLOWS,
    splitProductOwnerIssue: (projectId, ts, proposal) => {
      const d = deferred();
      pending.set(proposal.issue, d);
      return d.promise;
    },
  });
  return { ...loaded, pending };
}

const SPLIT_ACTS = ['data-split-act="split"', 'data-split-act="split-roadmap"', 'data-split-act="edit"', 'data-split-wf'];

test('#609 splits: while split A is filing, split B\'s Split, Split + roadmap, workflow and Edit stay enabled', async () => {
  const { BacklogPoProposals, pending } = loadWithPendingSplits();
  const msg = { ts: 't609a', answer: { splits: [split(21), split(22)] } };
  const ctx = makeCtx([msg]);

  clickSplit(BacklogPoProposals, ctx, 21, 'split');
  await settle();
  assert.equal(pending.has(21), true, 'split #21 was sent');

  const html = BacklogPoProposals.splitsHtml(ctx, msg);
  const other = splitCard(html, 22);
  for (const attr of SPLIT_ACTS) assert.equal(isDisabled(control(other, attr)), false, `#22 ${attr} stays enabled`);
  for (const attr of SPLIT_ACTS) assert.equal(isBusy(control(other, attr)), false, `#22 ${attr} shows no busy state`);
  pending.get(21).resolve({ messages: [], children: [] });
  await settle();
});

test('#609 splits: the clicked Split shows a busy state and is disabled, its own proposal\'s other controls are disabled without a busy state', async () => {
  const { BacklogPoProposals, pending } = loadWithPendingSplits();
  const msg = { ts: 't609b', answer: { splits: [split(31), split(32)] } };
  const ctx = makeCtx([msg]);

  clickSplit(BacklogPoProposals, ctx, 31, 'split');
  await settle();
  const own = splitCard(BacklogPoProposals.splitsHtml(ctx, msg), 31);
  const clicked = control(own, 'data-split-act="split"');
  assert.equal(isDisabled(clicked), true, 'the clicked Split is disabled');
  assert.equal(isBusy(clicked), true, 'the clicked Split shows a busy state');
  const roadmap = control(own, 'data-split-act="split-roadmap"');
  assert.equal(isDisabled(roadmap), true, 'Split + roadmap of the same proposal is disabled');
  assert.equal(isBusy(roadmap), false, 'Split + roadmap was not clicked: no busy state');
  assert.equal(isDisabled(control(own, 'data-split-act="edit"')), true, 'Edit of the same proposal is disabled');
  assert.equal(isDisabled(control(own, 'data-split-wf')), true, 'the workflow select of the same proposal is disabled');

  pending.get(31).resolve({ messages: [], children: [] });
  await settle();
  await settle();
  const after = splitCard(BacklogPoProposals.splitsHtml(ctx, msg), 31);
  const back = control(after, 'data-split-act="split"');
  assert.equal(isDisabled(back), false, 'Split is enabled again once its request returned');
  assert.equal(isBusy(back), false, 'the busy state is gone once its request returned');
});

test('#609 splits: Split + roadmap clicked shows the busy state on Split + roadmap, not on Split', async () => {
  const { BacklogPoProposals, pending } = loadWithPendingSplits();
  const msg = { ts: 't609c', answer: { splits: [split(41)] } };
  const ctx = makeCtx([msg]);

  clickSplit(BacklogPoProposals, ctx, 41, 'split-roadmap');
  await settle();
  const own = splitCard(BacklogPoProposals.splitsHtml(ctx, msg), 41);
  assert.equal(isBusy(control(own, 'data-split-act="split-roadmap"')), true);
  assert.equal(isDisabled(control(own, 'data-split-act="split-roadmap"')), true);
  assert.equal(isBusy(control(own, 'data-split-act="split"')), false);
  pending.get(41).resolve({ messages: [], children: [] });
  await settle();
});

test('#609 splits: filing B while A is pending, B returning first leaves A busy; each keeps its own note', async () => {
  const { BacklogPoProposals, pending } = loadWithPendingSplits();
  const msg = { ts: 't609d', answer: { splits: [split(51), split(52)] } };
  const ctx = makeCtx([msg]);

  clickSplit(BacklogPoProposals, ctx, 51, 'split');
  await settle();
  clickSplit(BacklogPoProposals, ctx, 52, 'split');
  await settle();
  assert.equal(pending.has(52), true, 'split #52 was sent while #51 was still pending');

  pending.get(52).resolve({ messages: [], children: [], syncError: 'sync-52-down' });
  await settle();
  await settle();
  let html = BacklogPoProposals.splitsHtml(ctx, msg);
  const a = control(splitCard(html, 51), 'data-split-act="split"');
  assert.equal(isDisabled(a), true, '#51 is still filing: its Split stays disabled');
  assert.equal(isBusy(a), true, '#51 is still filing: its Split stays busy');
  assert.equal(isDisabled(control(splitCard(html, 52), 'data-split-act="split"')), false, '#52 returned: its Split is enabled');
  assert.match(splitCard(html, 52), /sync-52-down/);
  assert.doesNotMatch(splitCard(html, 51), /sync-52-down/);

  pending.get(51).reject(new Error('boom-51'));
  await settle();
  await settle();
  html = BacklogPoProposals.splitsHtml(ctx, msg);
  assert.match(splitCard(html, 51), /boom-51/);
  assert.doesNotMatch(splitCard(html, 52), /boom-51/);
  assert.match(splitCard(html, 52), /sync-52-down/, '#51\'s failure leaves #52\'s note');
  assert.equal(isDisabled(control(splitCard(html, 51), 'data-split-act="split"')), false, '#51 is enabled again after its failure');
});

function epicsMsg(ts) {
  return { ts, answer: { epics: {
    place: [{ epic: 'E1', epicTitle: 'Epic one', issue: 61 }],
    create: [{ title: 'New A', goal: 'g', issues: [62] }, { title: 'New B', goal: 'g', issues: [63] }],
  } } };
}
function loadWithPendingEpics() {
  const pending = new Map();
  const loaded = loadProposals();
  loaded.sandbox.api.applyProductOwnerEpic = (projectId, ts, key) => {
    const d = deferred();
    pending.set(key, d);
    return d.promise;
  };
  return { ...loaded, pending };
}

test('#609 epics: while Create epic A is in flight, Create epic B and Place in epic stay enabled; only A shows a busy state', async () => {
  const { BacklogPoProposals, pending } = loadWithPendingEpics();
  const msg = epicsMsg('t609e');
  const ctx = makeCtx([msg]);

  clickEpic(BacklogPoProposals, ctx, 'create:0');
  await settle();
  assert.equal(pending.has('create:0'), true, 'create:0 was sent');
  const html = BacklogPoProposals.epicsHtml(ctx, msg);
  const a = control(html, 'data-epic-act="create:0"');
  assert.equal(isDisabled(a), true, 'the clicked Create epic is disabled');
  assert.equal(isBusy(a), true, 'the clicked Create epic shows a busy state');
  for (const key of ['create:1', 'place:E1']) {
    const c = control(html, `data-epic-act="${key}"`);
    assert.equal(isDisabled(c), false, `${key} stays enabled`);
    assert.equal(isBusy(c), false, `${key} shows no busy state`);
  }

  pending.get('create:0').resolve({ messages: [] });
  await settle();
  await settle();
  const after = control(BacklogPoProposals.epicsHtml(ctx, msg), 'data-epic-act="create:0"');
  assert.equal(isDisabled(after), false, 'enabled again once its request returned');
  assert.equal(isBusy(after), false, 'no busy state once its request returned');
});

test('#609 epics: applying B while A is pending, B returning first leaves A busy; each keeps its own note', async () => {
  const { BacklogPoProposals, pending } = loadWithPendingEpics();
  const msg = epicsMsg('t609f');
  const ctx = makeCtx([msg]);

  clickEpic(BacklogPoProposals, ctx, 'create:0');
  await settle();
  clickEpic(BacklogPoProposals, ctx, 'create:1');
  await settle();
  assert.equal(pending.has('create:1'), true, 'create:1 was sent while create:0 was still pending');

  pending.get('create:1').reject(new Error('boom-b'));
  await settle();
  await settle();
  let html = BacklogPoProposals.epicsHtml(ctx, msg);
  const a = control(html, 'data-epic-act="create:0"');
  assert.equal(isDisabled(a), true, 'create:0 is still in flight: disabled');
  assert.equal(isBusy(a), true, 'create:0 is still in flight: busy');
  assert.equal(isDisabled(control(html, 'data-epic-act="create:1"')), false);
  assert.equal((html.match(/boom-b/g) || []).length, 1, 'the failure note is shown once, for create:1');

  pending.get('create:0').resolve({ messages: [] });
  await settle();
  await settle();
  html = BacklogPoProposals.epicsHtml(ctx, msg);
  assert.equal(isDisabled(control(html, 'data-epic-act="create:0"')), false);
  assert.equal((html.match(/boom-b/g) || []).length, 1, 'create:0 returning leaves create:1\'s note');
});

test('#609 a split in flight leaves the epics\' buttons enabled', async () => {
  const { BacklogPoProposals, pending } = loadWithPendingSplits();
  const msg = { ts: 't609g', answer: { splits: [split(71)], epics: epicsMsg('x').answer.epics } };
  const ctx = makeCtx([msg]);

  clickSplit(BacklogPoProposals, ctx, 71, 'split');
  await settle();
  const html = BacklogPoProposals.epicsHtml(ctx, msg);
  for (const key of ['create:0', 'create:1', 'place:E1']) assert.equal(isDisabled(control(html, `data-epic-act="${key}"`)), false, `${key} stays enabled`);
  pending.get(71).resolve({ messages: [], children: [] });
  await settle();
});

test('#609 the clicked button keeps its label while busy, and each epic proposal is a po-epic-card', async () => {
  const { BacklogPoProposals, pending } = loadWithPendingEpics();
  const msg = epicsMsg('t609i');
  const ctx = makeCtx([msg]);

  clickEpic(BacklogPoProposals, ctx, 'create:0');
  await settle();
  const html = BacklogPoProposals.epicsHtml(ctx, msg);
  const text = (c) => c.inner.replace(/<[^>]*>/g, '').trim();
  assert.equal(text(control(html, 'data-epic-act="create:0"')), 'Create epic', 'the busy button still reads "Create epic"');
  assert.equal((html.match(/data-testid="po-epic-card"/g) || []).length, 3, 'one card per Place in epic group and per new epic');
  pending.get('create:0').resolve({ messages: [] });
  await settle();
});

test('#609 the Product Owner answering (ctx.busy) still disables every split and epic button', () => {
  const { BacklogPoProposals } = loadProposals({ workflows: WORKFLOWS });
  const msg = { ts: 't609h', answer: { splits: [split(81), split(82)], epics: epicsMsg('x').answer.epics } };
  const ctx = { ...makeCtx([msg]), busy: true };

  const splits = BacklogPoProposals.splitsHtml(ctx, msg);
  for (const issue of [81, 82]) for (const attr of SPLIT_ACTS) assert.equal(isDisabled(control(splitCard(splits, issue), attr)), true, `#${issue} ${attr} disabled`);
  const epics = BacklogPoProposals.epicsHtml(ctx, msg);
  for (const key of ['create:0', 'create:1', 'place:E1']) assert.equal(isDisabled(control(epics, `data-epic-act="${key}"`)), true, `${key} disabled`);
});

// ---- #670: the issues from a spec and their mockup coverage ------------------------------------------

function specMsg(ts, coverage) {
  return { ts, role: 'po', answer: { spec: { item: 'home-screen', issues: [{ title: 'Phase 1', body: 'matches `mock-1.jpg`' }, { title: 'Phase 2', body: 'matches `mock-2.jpg`' }], coverage } } };
}
const COVERED = { ok: true, covered: [{ mockup: 'mock-1.jpg', issue: 'Phase 1' }, { mockup: 'mock-2.jpg', issue: 'Phase 2' }], missing: [], later: ['mock-5.jpg'], errors: [] };
const UNCOVERED = { ok: false, covered: [{ mockup: 'mock-1.jpg', issue: 'Phase 1' }], missing: ['mock-4.jpg'], later: [], errors: ['mock-4.jpg has no issue'] };
const count = (html, testid) => (html.match(new RegExp(`data-testid="${testid}"`, 'g')) || []).length;
function clickSpec(BacklogPoProposals, ctx) {
  const msgBox = { dataset: { msg: '0' } };
  const btn = { dataset: { specAct: 'roadmap' } };
  btn.closest = (sel) => (sel === '[data-spec-act]' ? btn : sel === '[data-msg]' ? msgBox : null);
  return BacklogPoProposals.onClick({ target: btn }, ctx);
}

test('#670 specHtml: one coverage row per covered mockup, the later phases\' mockups, and the roadmap button enabled', () => {
  const { BacklogPoProposals } = loadProposals({ workflows: WORKFLOWS });
  const msg = specMsg('t670a', COVERED);
  const html = BacklogPoProposals.specHtml(makeCtx([msg]), msg);
  assert.equal(count(html, 'po-spec-proposal'), 1);
  assert.equal(count(html, 'po-mockup-coverage'), 1);
  assert.equal(count(html, 'po-mockup-coverage-row'), 2);
  assert.equal(count(html, 'po-mockup-missing'), 0);
  assert.equal(count(html, 'po-mockup-later'), 1);
  assert.match(html, /mock-1\.jpg[\s\S]*Phase 1/);
  assert.match(html, /mock-5\.jpg/);
  assert.equal(isDisabled(control(html, 'data-spec-act="roadmap"')), false);
});

test('#670 specHtml: a mockup in scope with no issue shows "mock-4.jpg has no issue" and disables the roadmap button', () => {
  const { BacklogPoProposals } = loadProposals({ workflows: WORKFLOWS });
  const msg = specMsg('t670b', UNCOVERED);
  const html = BacklogPoProposals.specHtml(makeCtx([msg]), msg);
  assert.equal(count(html, 'po-mockup-missing'), 1);
  assert.match(html, /mock-4\.jpg has no issue/);
  assert.equal(isDisabled(control(html, 'data-spec-act="roadmap"')), true);
});

test('#670 specHtml: an answer without issues from a spec draws nothing', () => {
  const { BacklogPoProposals } = loadProposals({ workflows: WORKFLOWS });
  const msg = { ts: 't670c', answer: { text: 'hi' } };
  assert.equal(BacklogPoProposals.specHtml(makeCtx([msg]), msg), '');
});

test('#670 the roadmap button files the spec\'s issues, then plans one roadmap stage per filed issue, in order', async () => {
  const { BacklogPoProposals, proposeCalls, specCalls } = loadProposals({
    workflows: WORKFLOWS,
    fileProductOwnerSpec: async () => ({ messages: [], issues: [{ title: 'Phase 1', number: 21 }, { title: 'Phase 2', number: 22 }] }),
  });
  const msg = specMsg('t670d', COVERED);
  const handled = await clickSpec(BacklogPoProposals, makeCtx([msg]));
  assert.equal(handled, true);
  await settle();
  await settle();
  assert.deepEqual(specCalls.map((c) => [c.projectId, c.at]), [['p1', 't670d']]);
  assert.equal(proposeCalls.length, 1);
  assert.deepEqual(proposeCalls[0].stages.map((st) => [st.name, st.items.map((i) => i.issues[0])]), [['Phase 1', [21]], ['Phase 2', [22]]]);
  assert.deepEqual(proposeCalls[0].stages.map((st) => st.items[0].workflow), ['feature.yaml', 'feature.yaml']);
});

test('#670 with a mockup in scope uncovered, a click files nothing and plans nothing', async () => {
  const { BacklogPoProposals, proposeCalls, specCalls } = loadProposals({ workflows: WORKFLOWS });
  const msg = specMsg('t670e', UNCOVERED);
  await clickSpec(BacklogPoProposals, makeCtx([msg]));
  await settle();
  await settle();
  assert.equal(specCalls.length, 0);
  assert.equal(proposeCalls.length, 0);
});
