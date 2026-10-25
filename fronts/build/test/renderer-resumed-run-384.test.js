// #384 "A failed run that was resumed still shows only Failed": what the cards show. Acceptance
// tests written before the code.
//
// Seams:
// - The run list row (packages/ui-kit/run-list.js runListRow, shared by Workflows › Runs, Projects ›
//   Project and the Dashboard's lists), evaluated whole in a vm sandbox with the real StatusPill
//   (test/roadmap-status-helpers.js loadRunList), on a runs:list row.
// - The roadmap card (fronts/build/views/backlog/backlog-roadmap.js BacklogRoadmap.html), evaluated
//   whole with the real RoadmapModel (loadRoadmap), on a roadmap:get item.
// Assertions read what a person sees (the pill's label and colour class, the row's text) and where
// the link goes (an element whose data-* attribute or href names the resumed run), not the markup.
//
// Assumptions (the names the developer implements):
// - A runs:list row of a run that was resumed carries `resumedBy: { runId, status }` (the resumed
//   run's id and its status as the lists show it; see test/resumed-run-status-384.test.js).
// - The row's status pill (the first `.pill` of the row) of a failed run resumed by a run that
//   succeeded or is still running reads "Resumed", in a neutral colour (not `pill-failed`).
// - Next to it the row says how the resume is doing ("Resumed → succeeded", "… running", "… failed":
//   the resumed run's status, readable) with a link to the resumed run: an element carrying the
//   resumed run's id in a data-* attribute (e.g. data-run-link / data-open-run) or an href.
// - A roadmap item resumed from its failed run: `runId` is the resumed run (the run chip opens it),
//   `runs` lists the earlier run first; the card shows the earlier run in its history, as an element
//   carrying its id (data-* or href) other than the run chip.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const H = require('./roadmap-status-helpers');

const FAILED = '20261014-100000-failed01';
const RESUMED = '20261014-110000-resumed1';

// ---- the run list row ------------------------------------------------------------------------------

// a failed run's runs:list row, resumed by RESUMED whose status is `status`
const failedRow = (status) => ({
  runId: FAILED, status: 'failed', workflow: 'software-development.yaml', title: 'Login page', task: 'Fix the login page',
  startedAt: '2026-10-04T10:00:00.000Z', finishedAt: '2026-10-04T10:30:00.000Z', durationMs: 30 * 60000, progress: [], sessions: [],
  error: 'Step develop failed', resumedBy: { runId: RESUMED, status },
});

function rowHtml(status) {
  const rl = H.loadRunList();
  return rl.runListRow(failedRow(status), { expanded: new Set(), id: 'p1', msgs: new Map() });
}

// the row's status pill: its first `.pill`
function pillOf(html) {
  const pill = H.findEl(html, (e) => /\bpill\b/.test(e.attrs.class || ''));
  assert.ok(pill, 'the row has a status pill');
  return pill;
}

// what the row says besides its status pill
const restOf = (html, pill) => H.visibleText(H.dropWhere(html, (e) => e.start === pill.start));

// an element (not the row itself) whose data-* attribute or href names `runId`
function linkTo(html, runId, { except = () => false } = {}) {
  return H.findEl(html, (e) => e.attrs['data-testid'] !== 'run-list-row' && !except(e)
    && Object.entries(e.attrs).some(([k, v]) => (k.startsWith('data-') || k === 'href') && String(v).includes(runId)));
}

test('#384 run list: a failed run resumed by a run that succeeded reads "Resumed" (neutral, not red), says it succeeded and links the resumed run', () => {
  const html = rowHtml('success');
  const pill = pillOf(html);
  assert.equal(H.visibleText(pill.inner), 'Resumed');
  assert.doesNotMatch(pill.attrs.class || '', /pill-failed/, 'not the red Failed pill');
  assert.notEqual(pill.attrs['data-status'], 'failed');
  assert.match(restOf(html, pill), /succeeded/i, `the row says how the resume ended: "${restOf(html, pill)}"`);
  assert.ok(linkTo(html, RESUMED), 'a link to the resumed run');
});

test('#384 run list: a failed run whose resume is still running reads "Resumed", says it is running and links it', () => {
  const html = rowHtml('running');
  const pill = pillOf(html);
  assert.equal(H.visibleText(pill.inner), 'Resumed');
  assert.doesNotMatch(pill.attrs.class || '', /pill-failed/, 'not the red Failed pill');
  assert.match(restOf(html, pill), /running/i, `the row says the resume is running: "${restOf(html, pill)}"`);
  assert.ok(linkTo(html, RESUMED), 'a link to the resumed run');
});

test('#384 run list: a failed run whose resume failed too says the resume failed, with the link', () => {
  const html = rowHtml('failed');
  const pill = pillOf(html);
  const rest = restOf(html, pill);
  assert.match(rest, /resum/i, `the row says it was resumed: "${rest}"`);
  assert.match(rest, /failed/i, `and that the resume failed: "${rest}"`);
  assert.ok(linkTo(html, RESUMED), 'a link to the resumed run');
});

// ---- the roadmap card ------------------------------------------------------------------------------

const HERO = 'software-development-local-hero.yaml';
function wfEntry(file) {
  const { loadWorkflow } = require('@multiagent/engine/engine/workflow');
  const wf = loadWorkflow(path.join(__dirname, '..', '..', '..', 'workflows', file));
  return {
    file, name: wf.metadata?.name || file, inputs: wf.inputs || {}, outputs: wf.outputs || {}, groups: wf.groups || [],
    agents: Object.fromEntries(Object.entries(wf.agents || {}).map(([k, a]) => [k, { provider: a.provider, model: a.model }])),
    steps: wf.steps.map((s) => ({ ...s, type: s.type || 'agent', agent: s.agents ? s.agents.join(' · ') : s.agent || null, next: [...new Set((s.transitions || []).map((x) => x.goto).filter(Boolean))] })),
  };
}

test('#384 roadmap card: an item resumed from its failed run shows the resumed run as its run, the failed run in its history', async () => {
  const { R } = H.loadRoadmap({ listWorkflows: async () => [wfEntry(HERO)] });
  R.html(H.roadmapOf([]), () => {});
  await H.settle();
  await H.settle();
  const item = H.item('a', 'done', 101, 'Login page', {
    workflow: HERO, runId: RESUMED, runs: [FAILED, RESUMED], error: null, mock: true,
    run: H.run({ status: 'success', mock: true, workflow: HERO, startedAt: H.iso(H.NOW - H.HOUR), finishedAt: H.iso(H.NOW - 30 * H.MIN) }),
  });
  const html = R.html({ roadmap: { state: 'running', stages: [{ id: 'st1', name: '', note: '', items: [item] }] }, issues: [] }, () => {}, { showAll: true, since: 'total' });
  const card = H.itemEl(html, 'a').outer;
  const chip = H.findEl(card, (e) => e.attrs['data-testid'] === 'run-chip');
  assert.ok(chip, 'the card has its run chip');
  assert.equal(chip.attrs['data-run'], RESUMED, 'the run chip opens the resumed run');
  const isChip = (e) => e.attrs['data-testid'] === 'run-chip' || (chip && e.start >= chip.start && e.end <= chip.end);
  assert.ok(linkTo(card, FAILED, { except: isChip }), 'the card lists the earlier (failed) run in its history');
});
