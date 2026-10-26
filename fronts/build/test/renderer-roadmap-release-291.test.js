// #291: the Roadmap shows each release: a release block "Release <version>" (not a stage) right
// after its cut line's stage, or, for a release started from the Releases screen (no cut line),
// after the last stage with a run in that release; its state (checking, waiting for you at Ship,
// shipped, on hold, failed), the stations Unit tests, E2E scenarios, Fix, Ship and "Open run".
// A dashed version line follows it (shipped: version, date, issues, runs, cost, tag and short
// commit, a link to the Releases screen; not shipped: version and state), replacing the cut-line row
// once that release run started. A Releases filter (All, Next release (not shipped), then the
// releases newest first) narrows the roadmap to the stages and items with runs in a release.
//
// Acceptance tests written before the code: backlog-roadmap.js in its sandbox
// (test/roadmap-status-helpers.js), BacklogRoadmap.html(data, rerender, view) read as markup.
//
// Interface the developer provides (the names are this test's choice; backlog.js fills them):
// - data.releases: { releases: [{ version, status: 'checking' | 'waiting' | 'shipped' | 'held' |
//   'failed', runId (the release run), mock, runs: [run ids in the release], date, tag, commit,
//   issues, cost }] } (the history of packages/engine/domains/releases/releases.js plus the release runs not shipped yet), or
//   { error } when the history could not be read. A stage's cut line names its release
//   (`stage.release.name` = the version; `stage.release.runId` once its release run started).
// - view.release: '' (All) | 'next' (Next release, not shipped) | a version.
// - test ids: roadmap-release-block (aria-label "Release <version>, <state>"), roadmap-release-line,
//   roadmap-release-filter (the <select>), roadmap-release-card (a station of the block; not asserted
//   here), roadmap-cut-line (unchanged for a release not started).
const test = require('node:test');
const assert = require('node:assert/strict');
const H = require('./roadmap-status-helpers');

const ALL = { showAll: true, since: 'total' };
const COMMIT = 'abc1234def567890abc1234def567890abc12345';
const done = (id, n, runId, extra = {}) => H.item(id, 'done', n, `Issue ${n}`, { runId, runs: [runId], ...extra });

// 4 stages; 1.0.0 shipped (cut line after stage 2), 1.1.0 waiting at Ship (started from the
// Releases screen: no cut line; its runs end in stage 3), a cut line 1.2.0 after stage 4 not started,
// 0.9.0 shipped with no stage in the roadmap. The history lists them oldest first. The cut lines are
// release entries of the list (#555), not a field of the stage before them.
function fixture({ releases } = {}) {
  return {
    roadmap: {
      state: 'paused',
      stages: [
        { id: 'st1', name: 'Login', note: '', items: [done('i1', 1, 'r1'), done('i2', 2, 'r2')] },
        { id: 'st2', name: 'Profile', note: '', items: [done('i3', 3, 'r3'), done('i4', 4, 'r4')] },
        { kind: 'release', id: 'rel-entry-100', name: '1.0.0', status: 'shipped', runId: 'rel-100' },
        { id: 'st3', name: 'Payments', note: '', items: [done('i5', 5, 'r5'), H.item('i6', 'planned', 6, 'Issue 6')] },
        { id: 'st4', name: 'Reports', note: '', items: [H.item('i7', 'planned', 7, 'Issue 7')] },
        { kind: 'release', id: 'rel-entry-120', name: '1.2.0' },
      ],
    },
    issues: [1, 2, 3, 4, 5, 6, 7].map((n) => ({ number: n, title: `Issue ${n}`, labels: [], epic: n === 1 ? 'E1' : 'E2' })),
    epics: [{ id: 'E1', title: 'Accounts' }, { id: 'E2', title: 'Money' }],
    releases: releases === undefined ? {
      releases: [
        { version: '0.9.0', status: 'shipped', runId: 'rel-090', tag: 'v0.9.0', date: '2026-09-20T12:00:00Z', commit: '0909090909090909090909090909090909090909', issues: [{ number: 90 }], runs: ['r0'], cost: 1 },
        { version: '1.0.0', status: 'shipped', runId: 'rel-100', tag: 'v1.0.0', date: '2026-10-05T12:00:00Z', commit: COMMIT, issues: [{ number: 1 }, { number: 2 }, { number: 3 }], runs: ['r1', 'r2', 'r3', 'r8', 'r9'], cost: 4.5 },
        { version: '1.1.0', status: 'waiting', runId: 'rel-110', mock: true, runs: ['r4', 'r5'] },
      ],
    } : releases,
  };
}

const byTestId = (html, id) => H.findAll(html, (e) => e.attrs['data-testid'] === id);
const blockOf = (html, version) => byTestId(html, 'roadmap-release-block').find((e) => H.visibleText(e.inner).includes(`Release ${version}`)) || null;
const lineOf = (html, version) => byTestId(html, 'roadmap-release-line').find((e) => H.visibleText(e.inner).includes(version)) || null;
// The stage shown as "Stage <s + 1>" (release entries do not count in the stage numbers, #555).
const stageAt = (html, s) => H.stageEl(html, s + 1);
const must = (el, what) => { assert.ok(el, what); return el; };
const allText = (el) => `${H.visibleText(el.outer)} ${el.attrs.title || ''} ${el.attrs['aria-label'] || ''}`;

// ---- the block: where it sits, what it says -----------------------------------------------------

test('#291 a release block "Release <version>" sits right after its cut line\'s stage', () => {
  const html = H.loadRoadmap().R.html(fixture(), () => {}, ALL);
  const block = must(blockOf(html, '1.0.0'), 'a roadmap-release-block "Release 1.0.0"');
  assert.ok(block.start > must(stageAt(html, 1), 'stage 2').start, 'after stage 2');
  assert.ok(block.start < must(stageAt(html, 2), 'stage 3').start, 'before stage 3');
});

test('#291 a release started from the Releases screen (no cut line) sits after the last stage with a run in it', () => {
  const html = H.loadRoadmap().R.html(fixture(), () => {}, ALL);
  const block = must(blockOf(html, '1.1.0'), 'a roadmap-release-block "Release 1.1.0"');
  assert.ok(block.start > must(stageAt(html, 2), 'stage 3').start, 'after stage 3 (its last run, r5)');
  assert.ok(block.start < must(stageAt(html, 3), 'stage 4').start, 'before stage 4');
});

test('#291 the block shows its state, the stations Unit tests, E2E scenarios, Fix, Ship and "Open run"', () => {
  const html = H.loadRoadmap().R.html(fixture(), () => {}, ALL);
  const text = H.visibleText(must(blockOf(html, '1.1.0'), 'the 1.1.0 block').inner);
  for (const s of ['Waiting for you', 'Unit tests', 'E2E scenarios', 'Fix', 'Ship', 'Open run']) assert.ok(text.includes(s), `${s}: ${text}`);
  assert.ok(H.visibleText(blockOf(html, '1.0.0').inner).includes('Shipped'), 'the shipped release says Shipped');
});

test('#291 the block\'s state follows its release run: checking, on hold, failed', () => {
  const R = H.loadRoadmap().R;
  for (const [status, label] of [['checking', /checking/i], ['held', /on hold/i], ['failed', /failed/i]]) {
    const d = fixture();
    d.releases.releases[2].status = status;
    const block = must(blockOf(R.html(d, () => {}, ALL), '1.1.0'), `the 1.1.0 block (${status})`);
    assert.match(H.visibleText(block.inner), label, status);
  }
});

test('#291 the block\'s accessible name says "Release <version>" and its state', () => {
  const html = H.loadRoadmap().R.html(fixture(), () => {}, ALL);
  const name = must(blockOf(html, '1.1.0'), 'the 1.1.0 block').attrs['aria-label'] || '';
  assert.ok(name.includes('Release 1.1.0'), name);
  assert.ok(name.includes('Waiting for you'), name);
});

test('#291 a simulated release run is marked Simulated', () => {
  const html = H.loadRoadmap().R.html(fixture(), () => {}, ALL);
  assert.ok(H.visibleText(blockOf(html, '1.1.0').inner).includes('Simulated'));
  assert.equal(H.visibleText(blockOf(html, '1.0.0').inner).includes('Simulated'), false);
});

// ---- not a stage ------------------------------------------------------------------------------------

test('#291 the block is not a stage: stage numbers unchanged, no stage controls, not a drop target', () => {
  const html = H.loadRoadmap().R.html(fixture(), () => {}, ALL);
  assert.equal(H.stageCount(html), 4);
  for (const n of [1, 2, 3, 4]) assert.ok(H.stageEl(html, n), `Stage ${n} keeps its number`);
  for (const v of ['1.0.0', '1.1.0']) {
    const block = blockOf(html, v);
    for (const attr of ['data-drop-stage', 'data-stage', 'draggable', 'data-drag-item']) assert.equal(attr in block.attrs, false, `${v}: no ${attr}`);
    assert.equal(H.findEl(block.inner, (e) => 'data-rm-stage-menu' in e.attrs || 'data-drop-stage' in e.attrs || 'data-rm-move' in e.attrs || 'data-rm-release' in e.attrs), null, `${v}: no stage menu, move, rename or remove`);
    const labels = H.findAll(block.inner, (e) => e.name === 'button').map((b) => H.visibleText(b.inner));
    for (const l of ['Rename', 'Remove', 'Disable', 'Enable']) assert.equal(labels.includes(l), false, `${v}: no ${l}`);
  }
});

// ---- the version line --------------------------------------------------------------------------------

test('#291 a shipped release\'s version line follows its block: version, date, issues, runs, cost, tag, short commit, a link to Releases', () => {
  const html = H.loadRoadmap().R.html(fixture(), () => {}, ALL);
  const line = must(lineOf(html, '1.0.0'), 'a roadmap-release-line for 1.0.0');
  assert.ok(line.start >= blockOf(html, '1.0.0').end, 'after the block');
  assert.ok(line.start < stageAt(html, 2).start, 'before stage 3');
  const text = H.visibleText(line.inner);
  for (const s of ['1.0.0', 'Oct 5', '3 issues', '5 runs', '$4.50', 'v1.0.0', 'abc1234']) assert.ok(text.includes(s), `${s}: ${text}`);
  const link = H.findEl(line.inner, (e) => (e.name === 'a' || e.name === 'button') && /Releases/.test(H.visibleText(e.inner)));
  assert.ok(link, 'a link to the Releases screen');
});

test('#291 a release not shipped yet: its line says the version and the state', () => {
  const html = H.loadRoadmap().R.html(fixture(), () => {}, ALL);
  const text = H.visibleText(must(lineOf(html, '1.1.0'), 'a roadmap-release-line for 1.1.0').inner);
  assert.ok(text.includes('1.1.0'), text);
  assert.ok(text.includes('Waiting for you'), text);
});

test('#291 #555 a planned release\'s dashed line keeps Rename and Remove; a shipped one cannot be renamed', () => {
  const html = H.loadRoadmap().R.html(fixture(), () => {}, ALL);
  const cuts = byTestId(html, 'roadmap-cut-line');
  const buttons = (el) => H.findAll(el.inner, (e) => e.name === 'button').map((b) => H.visibleText(b.inner));
  const planned = must(cuts.find((e) => allText(e).includes('1.2.0')), 'the dashed line of 1.2.0');
  const labels = buttons(planned);
  assert.ok(labels.includes('Rename') && labels.includes('Remove'), labels.join(', '));
  const shipped = cuts.find((e) => allText(e).includes('1.0.0'));
  assert.equal(shipped ? buttons(shipped).includes('Rename') : false, false, 'no Rename on the shipped 1.0.0 line');
});

// ---- the Releases filter --------------------------------------------------------------------------------

test('#291 the Releases filter lists All, Next release (not shipped), then the releases newest first', () => {
  const html = H.loadRoadmap().R.html(fixture(), () => {}, ALL);
  const select = must(byTestId(html, 'roadmap-release-filter')[0], 'a roadmap-release-filter');
  const options = H.findAll(select.outer, (e) => e.name === 'option').map((o) => H.visibleText(o.inner));
  assert.deepEqual(options, ['All', 'Next release (not shipped)', '1.0.0 · Oct 5', '0.9.0 · Sep 20']);
});

test('#291 no releases: no Releases filter', () => {
  const html = H.loadRoadmap().R.html(fixture({ releases: { releases: [] } }), () => {}, ALL);
  assert.equal(byTestId(html, 'roadmap-release-filter').length, 0);
  assert.equal(byTestId(html, 'roadmap-release-block').length, 0);
});

test('#291 an unreadable release history: the Roadmap still works and the filter says the releases could not be read', () => {
  const html = H.loadRoadmap().R.html(fixture({ releases: { error: 'Unexpected token } in JSON' } }), () => {}, ALL);
  assert.equal(H.stageCount(html), 4, 'the stages are drawn');
  const filter = must(byTestId(html, 'roadmap-release-filter')[0], 'the filter is there to say so');
  assert.match(allText(filter), /releases could not be read/i);
});

test('#291 a release chosen: only its stages, only its items (Planned does not hide them), with the real stage numbers', () => {
  const html = H.loadRoadmap().R.html(fixture(), () => {}, { showAll: false, since: 'total', release: '1.0.0' });
  assert.equal(H.stageCount(html), 2);
  assert.ok(H.stageEl(html, 1) && H.stageEl(html, 2), 'stages 1 and 2');
  for (const id of ['i1', 'i2', 'i3']) assert.equal(H.itemShown(html, id), true, `${id} (a run of 1.0.0) is shown`);
  for (const id of ['i4', 'i5', 'i6', 'i7']) assert.equal(H.itemShown(html, id), false, `${id} is not in 1.0.0`);
});

test('#291 a release chosen: the head counts "N stages · M runs; K runs of this release are not in the roadmap"', () => {
  const html = H.loadRoadmap().R.html(fixture(), () => {}, { showAll: true, since: 'total', release: '1.0.0' });
  assert.ok(H.visibleText(html).includes('2 stages · 3 runs; 2 runs of this release are not in the roadmap'), H.visibleText(html).slice(0, 600));
});

test('#291 the Releases filter combines with the epic filter', () => {
  const html = H.loadRoadmap().R.html(fixture(), () => {}, { showAll: true, since: 'total', release: '1.0.0', epic: 'E2' });
  assert.equal(H.itemShown(html, 'i1'), false, 'i1 is in epic E1');
  assert.equal(H.itemShown(html, 'i2'), true);
  assert.equal(H.itemShown(html, 'i3'), true);
  assert.equal(H.itemShown(html, 'i4'), false, 'i4 is not in 1.0.0');
});

test('#291 a release chosen whose runs the date range hides: the empty state says so and "Show all time" sets the range to Total', async () => {
  const R = H.loadRoadmap().R;
  const d = fixture();
  const old = H.iso(H.NOW - 10 * H.DAY);
  for (const st of d.roadmap.stages) for (const it of st.items || []) it.origin = old; // #555: release entries have no items
  const html = R.html(d, () => {}, { showAll: true, since: '24h', release: '1.0.0' });
  assert.equal(H.stageCount(html), 0);
  const empty = must(byTestId(html, 'roadmap-release-empty')[0], 'a roadmap-release-empty state');
  assert.match(H.visibleText(empty.inner), /date range hides/);
  assert.equal(H.visibleText(empty.inner).includes('Show all items'), false);
  const { ctx, calls } = H.makeCtx();
  await R.onClick(H.clickOn(html, (e) => 'data-rm-all-time' in e.attrs), ctx, d);
  assert.deepEqual(calls.since, ['total']);
});

// ---- #555: a release is its own item of the roadmap; its card shows when planned too ----------------------
// Shape assumed (the issue's): a release is an entry of `roadmap.stages` between stages,
// { kind: 'release', id, name, status?, runId? } (no items; not a stage: the stages keep their numbers).
// The service's roadmapReleases (data.releases) places every release entry, a planned one included:
// { version, status: 'planned', runs: [], estimate: { usd, minutes } }. Right after the dashed line
// (`roadmap-cut-line`, naming the release), the release's card (`roadmap-release-block`) shows its
// name, its state (Planned), the stages it closes (by name: the ones since the previous release) and
// its estimate.
function plannedFixture({ status = 'planned', entry = {} } = {}) {
  const est = (usd) => ({ usd, minutes: 60, runs: 12 });
  return {
    roadmap: {
      state: 'planned',
      stages: [
        { id: 'st1', name: 'Login', note: '', estimate: est(3), items: [H.item('i1', 'planned', 1, 'Issue 1')] },
        { id: 'st2', name: 'Profile', note: '', estimate: est(4.5), items: [H.item('i2', 'planned', 2, 'Issue 2')] },
        { kind: 'release', id: 'rel-120', name: '1.2.0', ...entry },
        { id: 'st3', name: 'Payments', note: '', estimate: est(2), items: [H.item('i3', 'planned', 3, 'Issue 3')] },
      ],
    },
    issues: [1, 2, 3].map((n) => ({ number: n, title: `Issue ${n}`, labels: [] })),
    releases: { releases: [{ version: '1.2.0', status, runs: [], estimate: { usd: 7.5, minutes: 90 }, ...(entry.runId ? { runId: entry.runId } : {}) }] },
  };
}
const plannedBlock = (d = plannedFixture()) => {
  const html = H.loadRoadmap().R.html(d, () => {}, ALL);
  return { html, block: must(blockOf(html, '1.2.0'), 'a roadmap-release-block "Release 1.2.0"') };
};

test('#555 a planned release\'s card sits right after its dashed line, before the next stage; the stages keep their numbers', () => {
  const { html, block } = plannedBlock();
  const cut = must(byTestId(html, 'roadmap-cut-line').find((e) => allText(e).includes('1.2.0')), 'the dashed line of 1.2.0');
  assert.deepEqual([block.start > cut.start, block.start < must(H.stageEl(html, 3), 'Stage 3').start, H.stageCount(html)], [true, true, 3]);
});

test('#555 a planned release\'s card says Planned', () => {
  assert.match(H.visibleText(plannedBlock().block.inner), /planned/i);
});

test('#555 a planned release\'s card names the stages it closes', () => {
  const text = H.visibleText(plannedBlock().block.inner);
  assert.deepEqual([text.includes('Login'), text.includes('Profile'), text.includes('Payments')], [true, true, false]);
});

test('#555 a planned release\'s card shows its estimate', () => {
  assert.ok(H.visibleText(plannedBlock().block.inner).includes('$7.50'), H.visibleText(plannedBlock().block.inner));
});

test('#555 a release entry whose run is checking keeps its card in its place in the list', () => {
  const { html, block } = plannedBlock(plannedFixture({ status: 'checking', entry: { status: 'running', runId: 'rel-run-120' } }));
  assert.deepEqual([block.start > must(H.stageEl(html, 2), 'Stage 2').start, block.start < must(H.stageEl(html, 3), 'Stage 3').start, /checking/i.test(H.visibleText(block.inner))], [true, true, true]);
});

test('#291 a release with no stage in the roadmap: its block and line alone, with its run count', () => {
  const html = H.loadRoadmap().R.html(fixture(), () => {}, { showAll: true, since: 'total', release: '0.9.0' });
  assert.equal(H.stageCount(html), 0);
  assert.ok(blockOf(html, '0.9.0'), 'the 0.9.0 block');
  const line = must(lineOf(html, '0.9.0'), 'the 0.9.0 line');
  assert.ok(H.visibleText(line.inner).includes('1 run'), H.visibleText(line.inner));
});
