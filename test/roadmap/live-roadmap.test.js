// Live roadmap (#164, src/domains/roadmap/live-roadmap.js): the pure helpers the service's refill
// (src/service/areas/live-roadmap.js) and advance() (src/domains/roadmap/roadmap.js) build on. See
// test/roadmap.test.js for advance()'s refill outcome and setLive, and
// test/service/live-roadmap.test.js for the end-to-end refill.
const test = require('node:test');
const assert = require('node:assert/strict');
const live = require('../../src/domains/roadmap/live-roadmap');

const issue = (number, over = {}) => ({ number, state: 'open', isEpic: false, labels: [], pullRequests: [], runs: [], ...over });
const label = (name) => ({ name });

// ---- candidates --------------------------------------------------------------------------

test('candidates: open issues with a complexity:n label up to the cap, lowest complexity first, then lowest number', () => {
  const data = { issues: [
    issue(1, { labels: [label('complexity:3')] }),
    issue(2, { labels: [label('complexity:1')] }),
    issue(3, { labels: [label('complexity:1')] }),
    issue(4, { labels: [label('complexity:5')] }), // above the default cap (2): left out
    issue(5), // no complexity label: left out (size unknown)
  ] };
  const picked = live.candidates(data, { complexityCap: 2 });
  assert.deepEqual(picked.map((i) => i.number), [2, 3]);
});

test('candidates: leaves out a closed issue, an epic (isEpic or an "epic" label), and one not "todo"', () => {
  const data = { issues: [
    issue(1, { state: 'closed', labels: [label('complexity:1')] }),
    issue(2, { isEpic: true, labels: [label('complexity:1')] }),
    issue(3, { labels: [label('complexity:1'), label('epic')] }),
    issue(4, { column: 'doing', labels: [label('complexity:1')] }),
    issue(5, { column: 'todo', labels: [label('complexity:1')] }),
  ] };
  assert.deepEqual(live.candidates(data).map((i) => i.number), [5]);
});

test('candidates: leaves out an issue already queued, planned in the roadmap, with an open PR, or with a pending/running run', () => {
  const planned = { number: 10, labels: [label('complexity:1')] };
  const data = {
    issues: [
      issue(1, { queued: true, labels: [label('complexity:1')] }),
      issue(2, { roadmap: { stage: 1 }, labels: [label('complexity:1')] }),
      issue(3, { pullRequests: [{ url: 'u' }], labels: [label('complexity:1')] }),
      issue(4, { runs: [{ status: 'running' }], labels: [label('complexity:1')] }),
      issue(5, { runs: [{ status: 'pending' }], labels: [label('complexity:1')] }),
      issue(6, { runs: [{ status: 'success' }], labels: [label('complexity:1')] }), // a finished run does not block it
      planned,
    ],
    queue: { items: [{ workflow: 'w.yaml', issues: [{ number: 20 }] }] },
    roadmap: { stages: [{ items: [{ workflow: 'w.yaml', issues: [{ number: 10 }] }] }] },
  };
  assert.deepEqual(live.candidates(data).map((i) => i.number), [6]);
});

test('candidates: leaves out an issue flagged to enrich first (needs-info, enrich, case-insensitive)', () => {
  const data = { issues: [
    issue(1, { labels: [label('complexity:1'), label('needs-info')] }),
    issue(2, { labels: [label('complexity:1'), label('Enrich')] }),
    issue(3, { labels: [label('complexity:1'), label('needs_details')] }),
    issue(4, { labels: [label('complexity:1')] }),
  ] };
  assert.deepEqual(live.candidates(data).map((i) => i.number), [4]);
});

test('candidates: an issue queued in the plain queue by number (no `issues` list) is still excluded', () => {
  const data = {
    issues: [issue(7, { labels: [label('complexity:1')] })],
    queue: { items: [{ workflow: 'w.yaml', number: 7 }] },
  };
  assert.deepEqual(live.candidates(data), []);
});

// ---- complexityOf -------------------------------------------------------------------------

test('complexityOf reads the first complexity:n label in any of its written forms; null without one', () => {
  assert.equal(live.complexityOf({ labels: [label('complexity:3')] }), 3);
  assert.equal(live.complexityOf({ labels: [label('complexity=4')] }), 4);
  assert.equal(live.complexityOf({ labels: [label('Complexity-5')] }), 5);
  assert.equal(live.complexityOf({ labels: [label('complexity/2')] }), 2);
  assert.equal(live.complexityOf({ labels: [label('bug')] }), null);
  assert.equal(live.complexityOf({ labels: [] }), null);
  assert.equal(live.complexityOf({}), null);
});

// ---- liveSettings -------------------------------------------------------------------------

test('liveSettings: defaults when settings has none, and refreshFirst defaults true', () => {
  assert.deepEqual(live.liveSettings(), live.DEFAULTS);
  assert.deepEqual(live.liveSettings({}), live.DEFAULTS);
});

test('liveSettings: clamps a valid complexityCap/maxStages to 1-10 and dailyBudgetUsd to 0-10000', () => {
  assert.deepEqual(
    live.liveSettings({ liveRoadmap: { complexityCap: 99, maxStages: 1, dailyBudgetUsd: 20000, refreshFirst: false } }),
    { complexityCap: 10, maxStages: 1, dailyBudgetUsd: 10000, refreshFirst: false },
  );
  assert.deepEqual(
    live.liveSettings({ liveRoadmap: { complexityCap: 1, maxStages: 10, dailyBudgetUsd: 0 } }),
    { complexityCap: 1, maxStages: 10, dailyBudgetUsd: 0, refreshFirst: true },
  );
});

test('liveSettings: a value below its minimum (or not a number) falls back to the default instead of clamping up', () => {
  assert.deepEqual(
    live.liveSettings({ liveRoadmap: { complexityCap: 'x', maxStages: 0, dailyBudgetUsd: -5 } }),
    { complexityCap: 2, maxStages: 3, dailyBudgetUsd: 50, refreshFirst: true },
  );
  assert.deepEqual(
    live.liveSettings({ liveRoadmap: { complexityCap: null, maxStages: NaN } }),
    { complexityCap: 2, maxStages: 3, dailyBudgetUsd: 50, refreshFirst: true },
  );
});

// ---- refillQuestion / refillNote --------------------------------------------------------

test('refillQuestion names the complexity cap and the max stages (singular when it is 1)', () => {
  assert.match(live.refillQuestion({ complexityCap: 2, maxStages: 3 }), /complexity 2 or less/);
  assert.match(live.refillQuestion({ complexityCap: 2, maxStages: 3 }), /at most 3 stages/);
  assert.match(live.refillQuestion({ complexityCap: 1, maxStages: 1 }), /at most 1 stage\b/);
});

test('refillNote formats the time and the cost to two decimals', () => {
  assert.equal(live.refillNote('2026-10-02T03:12:00.000Z', 1.5), `Added by the live roadmap at ${new Date('2026-10-02T03:12:00.000Z').getHours().toString().padStart(2, '0')}:12, Product Owner answer US$ 1.50.`);
  assert.match(live.refillNote('2026-10-02T03:12:00.000Z', 0), /US\$ 0\.00\./);
});

// ---- refillStages -------------------------------------------------------------------------

const allowed = new Set([1, 2, 3, 4, 5]);

test('refillStages: keeps only allowed, non-enriched issues; drops a group left empty or with no workflow', () => {
  const answer = {
    enrich: [{ issue: 2 }],
    groups: [
      { issues: [1, 2, 99], workflow: 'w.yaml' }, // 2 enriched, 99 not allowed
      { issues: [3], workflow: '' }, // no workflow: dropped
      { issues: [6], workflow: 'w.yaml' }, // not allowed at all: dropped
    ],
  };
  const stages = live.refillStages(answer, { allowed });
  assert.equal(stages.length, 1);
  assert.deepEqual(stages[0].items.map((x) => x.issues), [[1]]);
});

test('refillStages: a group larger than maxGroup is truncated to its first maxGroup allowed issues, keeping their given order', () => {
  const answer = { groups: [{ issues: [4, 1, 3, 2], workflow: 'w.yaml' }] };
  const stages = live.refillStages(answer, { allowed, maxGroup: 2 });
  assert.deepEqual(stages[0].items[0].issues, [4, 1]);
});

test('refillStages: no maxGroup means no limit (every allowed issue of the group is kept)', () => {
  const answer = { groups: [{ issues: [1, 2, 3], workflow: 'w.yaml' }] };
  const stages = live.refillStages(answer, { allowed });
  assert.deepEqual(stages[0].items[0].issues, [1, 2, 3]);
});

test('refillStages: maxGroup 1 gives one issue per group, each a separate item', () => {
  const answer = { groups: [{ issues: [1, 2], workflow: 'w.yaml' }, { issues: [3], workflow: 'w.yaml' }] };
  const stages = live.refillStages(answer, { allowed, maxGroup: 1 });
  assert.deepEqual(stages[0].items.map((x) => x.issues), [[1], [3]]);
});

test('refillStages: an issue already used by an earlier group (named twice) is not used again by a later one', () => {
  const answer = { groups: [{ issues: [1, 2], workflow: 'w.yaml' }, { issues: [2, 3], workflow: 'w.yaml' }] };
  const stages = live.refillStages(answer, { allowed });
  assert.deepEqual(stages.flatMap((s) => s.items).map((x) => x.issues), [[1, 2], [3]]);
});

test('refillStages: stages are ordered by the answer\'s own `stage` number and capped to maxStages; a missing stage defaults to 1', () => {
  const answer = { groups: [
    { issues: [1], workflow: 'w.yaml', stage: 3 },
    { issues: [2], workflow: 'w.yaml' }, // no stage: defaults to 1
    { issues: [3], workflow: 'w.yaml', stage: 2 },
    { issues: [4], workflow: 'w.yaml', stage: 5 }, // dropped: only the first 3 distinct stages are kept
  ] };
  const stages = live.refillStages(answer, { allowed, maxStages: 3 });
  assert.deepEqual(stages.map((s) => s.items[0].issues[0]), [2, 3, 1]);
  assert.equal(stages.length, 3);
});

test('refillStages: names each stage "Live refill n" in order, carries the given note, mock flag and origin, and only the optional reason/modeReason when present', () => {
  const answer = { groups: [
    { issues: [1], workflow: 'w.yaml', reason: 'same files', modeReason: 'validated' },
    { issues: [2], workflow: 'w.yaml', stage: 2 },
  ] };
  const stages = live.refillStages(answer, { allowed, mock: true, origin: 'ts-1', note: 'Added by the live roadmap at 03:12.' });
  assert.deepEqual(stages.map((s) => s.name), ['Live refill 1', 'Live refill 2']);
  assert.equal(stages[0].note, 'Added by the live roadmap at 03:12.');
  assert.equal(stages[0].items[0].mock, true);
  assert.equal(stages[0].items[0].origin, 'ts-1');
  assert.equal(stages[0].items[0].reason, 'same files');
  assert.equal(stages[0].items[0].modeReason, 'validated');
  assert.equal('reason' in stages[1].items[0], false);
  assert.equal('modeReason' in stages[1].items[0], false);
});

// ---- applyRefill --------------------------------------------------------------------------

const withStages = (statuses) => ({ state: 'running', stages: [{ items: statuses.map((status, n) => ({ id: `i${n}`, status })) }] });

test('applyRefill throws on an unknown status', () => {
  assert.throws(() => live.applyRefill({ state: 'running', stages: [] }, { status: 'bogus' }), /Unknown live refill status/);
});

test('applyRefill: "refilling" only records the attempt, never ends or pauses the roadmap even with nothing left', () => {
  const after = live.applyRefill(withStages(['done', 'skipped']), { status: 'refilling', at: '2026-10-02T03:00:00Z', message: 'asking' });
  assert.equal(after.state, 'running');
  assert.deepEqual(after.liveRefill, { status: 'refilling', at: '2026-10-02T03:00:00Z', added: 0, costUsd: 0, message: 'asking' });
});

test('applyRefill: "added" never ends the roadmap, even when every item happens to already be finished', () => {
  const after = live.applyRefill(withStages(['done', 'skipped']), { status: 'added', added: 1, message: 'ok' });
  assert.equal(after.state, 'running');
});

test('applyRefill: an outcome other than refilling/added ends a running roadmap done once nothing is left (empty, budget, off)', () => {
  for (const status of ['empty', 'budget', 'off']) {
    const after = live.applyRefill(withStages(['done', 'skipped']), { status, message: `m-${status}` });
    assert.equal(after.state, 'done', status);
    assert.equal(after.error, null, status);
    assert.equal(after.pausedBy, null, status);
    assert.equal(after.scope, null, status);
  }
});

test('applyRefill: "failed" pauses a running roadmap with nothing left instead of ending it', () => {
  const after = live.applyRefill(withStages(['done']), { status: 'failed', message: 'boom' });
  assert.equal(after.state, 'paused');
  assert.equal(after.error, 'boom');
  assert.equal(after.pausedBy, null);
});

test('applyRefill: any status leaves a running roadmap running while an item is still unfinished', () => {
  for (const status of ['empty', 'budget', 'failed', 'off']) {
    const after = live.applyRefill(withStages(['done', 'planned']), { status, message: 'm' });
    assert.equal(after.state, 'running', status);
  }
});

test('applyRefill: a roadmap not running (already paused or done) is left as is', () => {
  const after = live.applyRefill({ ...withStages(['done']), state: 'paused' }, { status: 'empty', message: 'm' });
  assert.equal(after.state, 'paused');
});

test('applyRefill: liveRefills keeps only the last 24h, and skips an entry for a refill with no cost', () => {
  const roadmap = { state: 'running', stages: [{ items: [{ id: 'i1', status: 'planned' }] }], liveRefills: [
    { at: '2026-09-30T23:00:00Z', costUsd: 5 }, // older than 24h from `at` below: dropped
    { at: '2026-10-01T12:00:00Z', costUsd: 3 }, // within 24h: kept
  ] };
  const after = live.applyRefill(roadmap, { status: 'added', at: '2026-10-02T00:00:00Z', costUsd: 0, added: 1, message: 'm' });
  assert.deepEqual(after.liveRefills, [{ at: '2026-10-01T12:00:00Z', costUsd: 3 }]); // no entry added: costUsd is 0

  const withCost = live.applyRefill(roadmap, { status: 'added', at: '2026-10-02T00:00:00Z', costUsd: 2, added: 1, message: 'm' });
  assert.deepEqual(withCost.liveRefills, [{ at: '2026-10-01T12:00:00Z', costUsd: 3 }, { at: '2026-10-02T00:00:00Z', costUsd: 2 }]);
});

// ---- spentToday ---------------------------------------------------------------------------

test('spentToday sums refills and run costs within the last 24h, ignoring older ones', () => {
  const now = new Date('2026-10-02T12:00:00Z');
  const roadmap = {
    liveSince: '2026-09-01T00:00:00Z', // long ago: does not narrow the 24h window
    liveRefills: [
      { at: '2026-10-01T00:00:00Z', costUsd: 10 }, // 36h ago: too old
      { at: '2026-10-02T06:00:00Z', costUsd: 5 }, // within 24h
    ],
    stages: [{ items: [{ runId: 'r1', runs: ['r0', 'r1'] }] }],
  };
  const costs = { r0: { costUsd: 100, startedAt: '2026-10-01T00:00:00Z' }, r1: { costUsd: 7, startedAt: '2026-10-02T10:00:00Z' } };
  const spent = live.spentToday({ roadmap, runCost: (id) => costs[id] || null, now });
  assert.equal(spent, 12); // 5 (refill) + 7 (r1); r0 is too old, r0/r1 deduped as a set so each counted once
});

test('spentToday is bounded by liveSince when it is more recent than 24h ago: a cost just before going live does not count', () => {
  const now = new Date('2026-10-02T12:00:00Z');
  const roadmap = { liveSince: '2026-10-02T10:00:00Z', liveRefills: [{ at: '2026-10-02T09:00:00Z', costUsd: 50 }], stages: [] };
  assert.equal(live.spentToday({ roadmap, runCost: () => null, now }), 0);
});

test('spentToday rounds to the cent', () => {
  const roadmap = { liveRefills: [{ at: new Date().toISOString(), costUsd: 1.005 }], stages: [] };
  const spent = live.spentToday({ roadmap, runCost: () => null });
  assert.equal(spent, 1); // 1.005 * 100 = 100.49999... rounds down to 1.00 in floating point
});

// ---- budgetProblem ------------------------------------------------------------------------

test('budgetProblem: null while a 0 (no cap) or unreached budget, a message once spending reaches it', () => {
  assert.equal(live.budgetProblem(1000, { dailyBudgetUsd: 0 }), null);
  assert.equal(live.budgetProblem(10, { dailyBudgetUsd: 50 }), null);
  const msg = live.budgetProblem(50, { dailyBudgetUsd: 50 });
  assert.match(msg, /US\$ 50\.00/);
  assert.match(msg, /no more refills/);
});
