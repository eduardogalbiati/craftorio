// The Backlog's Product Owner (#105, src/product-owner.js): the analysis report schema, its mock
// answer, sizing/estimates, and the monthly usage ledger that budgets the conversation itself.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const productOwner = require('../src/product-owner');
const usage = require('../src/usage');

function tmp(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'po-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

const ISSUES = [
  { number: 1, state: 'open', title: 'A', labels: [{ name: 'complexity:2' }, { name: 'area:engine' }], body: 'x'.repeat(200) },
  { number: 2, state: 'open', title: 'B', labels: [{ name: 'complexity:5' }], body: 'y'.repeat(200) },
  { number: 3, state: 'open', title: 'C', labels: [], body: 'short' },
];

// ---- monthUsage: the Product Owner's own calls, for the monthly budget check ---------------------

test('monthUsage returns an empty list when the ledger file does not exist yet', (t) => {
  const dir = tmp(t);
  assert.deepEqual(productOwner.monthUsage(dir), []);
});

test('monthUsage skips malformed lines and entries from other months, and maps the rest', (t) => {
  const dir = tmp(t);
  const file = path.join(dir, 'product-owner.usage.jsonl');
  fs.mkdirSync(dir, { recursive: true });
  const lines = [
    JSON.stringify({ ts: '2026-09-15T10:00:00.000Z', projectId: 'demo', provider: 'claude', model: 'claude-opus-5-5', tokens: { total: 1000 }, costUsd: 1.5 }),
    '{ not json',
    JSON.stringify({ ts: '2026-08-01T00:00:00.000Z', projectId: 'demo', provider: 'claude', model: 'claude-opus-5-5', tokens: { total: 999 }, costUsd: 9 }), // last month
    '',
  ];
  fs.writeFileSync(file, `${lines.join('\n')}\n`);
  const now = new Date('2026-09-30T12:00:00Z');
  assert.deepEqual(productOwner.monthUsage(dir, now), [
    { provider: 'claude', model: 'claude-opus-5-5', tokens: { total: 1000 }, costUsd: 1.5 },
  ]);
});

// ---- the ledger feeds the monthly budget check, even across a cleared conversation ----------------

test("the Product Owner's own past calls count toward the monthly budget and block a new question", async (t) => {
  const dir = tmp(t);
  const file = path.join(dir, 'product-owner.usage.jsonl');
  fs.mkdirSync(dir, { recursive: true });
  const now = new Date('2026-09-30T12:00:00Z');
  fs.writeFileSync(file, `${JSON.stringify({ ts: now.toISOString(), projectId: 'demo', provider: 'claude', model: 'claude-opus-5-5', tokens: { total: 100 }, costUsd: 3 })}\n`);

  const baseline = { claude: { name: 'Claude Code', limitUsd: 4, limitTokens: null, blockOnLimit: true, usedUsd: 1, usedTokens: 0 } };
  const merged = usage.withPeerUsage(baseline, productOwner.monthUsage(dir, now), {});
  assert.equal(merged.claude.usedUsd, 4); // $1 from runs + $3 from the Product Owner reaches the $4 limit

  let resolveCommandCalled = false;
  const out = await productOwner.ask({
    backlogDir: dir,
    projectId: 'demo',
    question: 'Analyze the backlog',
    data: { projectId: 'demo', issues: ISSUES },
    activeRuns: [],
    runs: [],
    workflows: [{ file: 'software-development.yaml', name: 'Software development' }],
    folder: null,
    agent: { model: 'claude-opus-5-5', effort: 'high' },
    skillsDirs: [],
    resolveCommand: () => { resolveCommandCalled = true; return 'claude'; },
    budget: merged,
    mock: false,
  });

  assert.equal(resolveCommandCalled, false); // the budget check throws before any CLI is resolved
  assert.match(out.message.text, /already reached its monthly budget/);
  assert.equal(out.message.error, true);
});

test('clearConversation forgets the chat but keeps the usage ledger', (t) => {
  const dir = tmp(t);
  const usageFile = path.join(dir, 'product-owner.usage.jsonl');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(usageFile, `${JSON.stringify({ ts: new Date().toISOString(), projectId: 'demo', provider: 'claude', model: 'm', tokens: { total: 10 }, costUsd: 0.1 })}\n`);
  const chatFile = path.join(dir, 'demo.po.jsonl');
  fs.writeFileSync(chatFile, `${JSON.stringify({ ts: new Date().toISOString(), role: 'user', text: 'hi' })}\n`);

  const left = productOwner.clearConversation(dir, 'demo');
  assert.deepEqual(left, []);
  assert.equal(fs.existsSync(chatFile), false);
  assert.equal(fs.existsSync(usageFile), true);
  assert.equal(productOwner.monthUsage(dir, new Date()).length, 1);
});

test('a mock ask writes nothing to the usage ledger', async (t) => {
  const dir = tmp(t);
  await productOwner.ask({
    backlogDir: dir,
    projectId: 'demo',
    question: 'Analyze the backlog',
    data: { projectId: 'demo', issues: ISSUES },
    activeRuns: [],
    runs: [],
    workflows: [{ file: 'software-development.yaml', name: 'Software development' }],
    mock: true,
  });
  assert.equal(fs.existsSync(path.join(dir, 'product-owner.usage.jsonl')), false);
  assert.deepEqual(productOwner.monthUsage(dir), []);
});

// ---- the analysis schema: unknown issues and workflows are dropped, sizes are computed here --------

test('normalizeAnswer keeps only known issue numbers and workflow files, and fills in each group size', () => {
  const raw = {
    summary: 'ok',
    groups: [
      { name: 'Engine work', issues: [1, 2, 999], workflow: 'nope.yaml', reason: 'same files' },
      { issues: [], workflow: 'software-development.yaml', reason: 'empty, dropped' },
    ],
    conflicts: [
      { issues: [1, 999], reason: 'only one known issue, dropped' },
      { issues: [1, 2], reason: 'overlapping files' },
    ],
    enrich: [{ issue: 3, reason: 'too short' }, { issue: 999, reason: 'unknown, dropped' }],
  };
  const out = productOwner.normalizeAnswer(raw, { issues: ISSUES, history: [], workflows: [{ file: 'software-development.yaml' }] });

  assert.equal(out.groups.length, 1);
  assert.deepEqual(out.groups[0].issues, [1, 2]);
  assert.equal(out.groups[0].name, 'Engine work');
  assert.equal(out.groups[0].workflow, 'software-development.yaml'); // unknown workflow falls back
  assert.equal(out.groups[0].stage, 1);
  assert.equal(out.groups[0].complexity, 7); // 2 + 5

  assert.equal(out.conflicts.length, 1);
  assert.deepEqual(out.conflicts[0].issues, [1, 2]);

  assert.deepEqual(out.enrich.map((e) => e.issue), [3]);
  assert.equal(out.enrich[0].link, 'https://github.com/eduardogalbiati/multiagent-orchestrator/issues/103');
});

test('sizeGroup warns at a complexity known to hit the context limit, and at a lower one for several issues', () => {
  assert.deepEqual(productOwner.sizeGroup([1], ISSUES, []).warnings, []); // complexity 2 alone: no warning
  const overContext = productOwner.sizeGroup([1, 2], ISSUES, []); // complexity 7: a group this size hit the context limit
  assert.match(overContext.warnings[0], /context limit/);
  const testTime = productOwner.sizeGroup([1, 3], ISSUES, []); // complexity 5 (2 + guessed 3), two issues: below the context cap
  assert.match(testTime.warnings[0], /test step may exceed its time budget/);
  const single = productOwner.sizeGroup([2], ISSUES, []); // complexity 5 alone: below the multi-issue test-time threshold
  assert.deepEqual(single.warnings, []);
});

test('sizeGroup guesses a missing complexity:n label as 3 and flags it', () => {
  const out = productOwner.sizeGroup([3], ISSUES, []);
  assert.equal(out.complexity, 3);
  assert.equal(out.guessed, true);
});

// ---- complexityOf and estimate --------------------------------------------------------------------

test('complexityOf reads the complexity:n label in a few spellings, and is null without one', () => {
  assert.equal(productOwner.complexityOf({ labels: [{ name: 'complexity:4' }] }), 4);
  assert.equal(productOwner.complexityOf({ labels: [{ name: 'complexity-4' }] }), 4);
  assert.equal(productOwner.complexityOf({ labels: ['complexity=4'] }), 4);
  assert.equal(productOwner.complexityOf({ labels: [{ name: 'bug' }] }), null);
  assert.equal(productOwner.complexityOf({}), null);
});

test('estimate is null without a past run, and is per-point from similarly sized runs when there is one', () => {
  assert.equal(productOwner.estimate(5, []), null);
  const history = [
    { complexity: 4, status: 'success', agentMinutes: 40, costUsd: 4 },
    { complexity: 10, status: 'success', agentMinutes: 200, costUsd: 20 }, // too far from 5, left out
  ];
  const out = productOwner.estimate(5, history);
  assert.equal(out.minutes, 50); // 40/4 per point * 5
  assert.equal(out.costUsd, 5); // 4/4 per point * 5
  assert.match(out.basis, /1 past run of complexity 3 to 7/);
});

// ---- the simulated answer: no model call, used in developer/simulated mode ------------------------

test('mockAnswer puts a repo-wide-looking issue alone in its own stage, ahead of the others, and flags short bodies to enrich', () => {
  const data = {
    issues: [
      { number: 10, state: 'open', title: 'Reformat the whole src/ tree', labels: [], body: 'x'.repeat(200) },
      { number: 11, state: 'open', title: 'Add an endpoint', labels: [{ name: 'area:server' }, { name: 'complexity:2' }], body: 'x'.repeat(200) },
      { number: 12, state: 'open', title: 'Fix a typo' },
    ],
  };
  const answer = productOwner.mockAnswer({ data, question: 'Analyze the backlog' });
  assert.match(answer.summary, /Simulated answer/);
  const refactorGroup = answer.groups.find((g) => g.issues.includes(10));
  assert.equal(refactorGroup.stage, 1);
  assert.ok(answer.groups.every((g) => g.issues.includes(10) || g.stage >= refactorGroup.stage));
  assert.ok(answer.conflicts.some((c) => c.issues.includes(10)));
  assert.deepEqual(answer.enrich.map((e) => e.issue), [12]); // no body at all
});

test('mockAnswer groups to-do issues sharing a label, up to complexity 6 per group', () => {
  const data = {
    issues: [
      { number: 1, state: 'open', title: 'One', labels: [{ name: 'area:ui' }, { name: 'complexity:3' }], body: 'x'.repeat(200) },
      { number: 2, state: 'open', title: 'Two', labels: [{ name: 'area:ui' }, { name: 'complexity:3' }], body: 'x'.repeat(200) },
      { number: 3, state: 'open', title: 'Three', labels: [{ name: 'area:ui' }, { name: 'complexity:3' }], body: 'x'.repeat(200) },
    ],
  };
  const answer = productOwner.mockAnswer({ data });
  const uiGroups = answer.groups.filter((g) => g.name === 'area:ui');
  assert.equal(uiGroups.length, 2); // 1+2 fit in one group (complexity 6), 3 starts a new one
  assert.deepEqual(uiGroups[0].issues, [1, 2]);
  assert.deepEqual(uiGroups[1].issues, [3]);
});

// ---- runHistory: past runs' merge conflicts feed the "do not run in parallel" section --------------

test('runHistory reads merge conflicts and the files they named from events.jsonl', (t) => {
  const dir = tmp(t);
  const runDir = path.join(dir, 'run1');
  fs.mkdirSync(runDir, { recursive: true });
  const events = [
    { type: 'log', message: 'merge conflict in src/engine/workflow.js' },
    { type: 'log', message: 'all good' },
  ];
  fs.writeFileSync(path.join(runDir, 'events.jsonl'), events.map((e) => JSON.stringify(e)).join('\n'));
  const runs = [{ runId: 'run1', workflow: 'software-development.yaml', status: 'success', finishedAt: '2026-09-29T00:00:00Z', mock: false, issues: [{ number: 1 }], durationMs: 60000, gateWaitMs: 0, costUsd: 1, tokens: { total: 100 }, runDir }];
  const [h] = productOwner.runHistory(runs, ISSUES);
  assert.equal(h.conflicts.count, 1);
  assert.deepEqual(h.conflicts.files, ['src/engine/workflow.js']);
  assert.equal(h.complexity, 2); // issue #1's complexity:2
});

test('runHistory leaves out mock, interrupted and unfinished runs', () => {
  const runs = [
    { runId: 'a', mock: true, finishedAt: '2026-09-29T00:00:00Z', status: 'success' },
    { runId: 'b', mock: false, status: 'interrupted', finishedAt: '2026-09-29T00:00:00Z' },
    { runId: 'c', mock: false, status: 'running' }, // no finishedAt
    { runId: 'd', mock: false, status: 'success', finishedAt: '2026-09-29T00:00:00Z', issues: [], durationMs: 0, gateWaitMs: 0, costUsd: 0, tokens: {} },
  ];
  assert.deepEqual(productOwner.runHistory(runs, ISSUES).map((h) => h.runId), ['d']);
});
