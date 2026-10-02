// The Backlog's Product Owner (#105, src/product-owner.js): the analysis report schema, its mock
// answer, sizing/estimates, the monthly usage ledger that budgets the conversation itself, and
// registering an issue in the conversation (#117): the question cap per thread, each thread's
// folder in the runs folder, filing and discarding a draft.
// Live progress (#180): ask's onItem/signal stream and stop a mock turn fast (mockSteps' delays
// scaled down, like the mock provider).
process.env.MULTIAGENT_MOCK_DELAY_SCALE ??= '0.05';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const productOwner = require('../src/product-owner');
const runs = require('../src/runs');
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

test('normalizeAnswer maps a group\'s mode_reason to modeReason, absent when the group has none', () => {
  const raw = {
    summary: 'ok',
    groups: [
      { issues: [1], workflow: 'software-development.yaml', reason: 'r', mode_reason: 'Validated: the owner can try it in the app' },
      { issues: [2], workflow: 'software-development.yaml', reason: 'r' },
    ],
  };
  const out = productOwner.normalizeAnswer(raw, { issues: ISSUES, history: [], workflows: [{ file: 'software-development.yaml' }] });
  assert.equal(out.groups[0].modeReason, 'Validated: the owner can try it in the app');
  assert.equal('modeReason' in out.groups[1], false);
});

test('RULES states the rule for mode_reason (validated for a change the owner can try in the app, auto otherwise): checked on the source, RULES is not exported', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'product-owner.js'), 'utf8');
  const rules = /const RULES = \[[\s\S]*?\]\.join\('\\n'\);/.exec(src)[0];
  assert.match(rules, /mode_reason/);
  assert.match(rules, /validated/);
  assert.match(rules, /auto/);
});

// ---- Send to Product Owner (#169): the Backlog's selection attached to a plan question -------------

test('normalizeAnswer with a selection keeps only the open attached issues in a group; another issue it named moves to `suggested`, and a closed attached issue is listed in `closed`', () => {
  const issues = [
    { number: 1, state: 'open', title: 'A', labels: [] },
    { number: 2, state: 'open', title: 'B', labels: [] },
    { number: 3, state: 'closed', title: 'C', labels: [] }, // attached, but closed
    { number: 4, state: 'open', title: 'D', labels: [] }, // open, not attached: named for the group, moved out
  ];
  const raw = {
    summary: 'ok',
    groups: [{ name: 'G', issues: [1, 2, 4], workflow: 'software-development.yaml', reason: 'r' }],
  };
  const out = productOwner.normalizeAnswer(raw, {
    issues, history: [], workflows: [{ file: 'software-development.yaml' }], selection: [1, 2, 3],
  });
  assert.deepEqual(out.groups[0].issues, [1, 2]); // #4 is not attached: never in a group's issues
  assert.deepEqual(out.groups[0].suggested, [{ issue: 4, reason: 'Named by the Product Owner for this group.' }]);
  assert.deepEqual(out.closed, [3]);
});

test('normalizeAnswer with a selection drops a suggested issue that is closed, already attached, or duplicated, keeping the rest', () => {
  const issues = [
    { number: 1, state: 'open' },
    { number: 2, state: 'open' },
    { number: 3, state: 'closed' },
    { number: 5, state: 'open' },
  ];
  const raw = {
    summary: 'ok',
    groups: [{
      name: 'G',
      issues: [1],
      workflow: 'software-development.yaml',
      reason: 'r',
      suggested: [
        { issue: 3, reason: 'closed, dropped' },
        { issue: 2, reason: 'attached, dropped' },
        { issue: 5, reason: 'kept' },
        { issue: 5, reason: 'duplicate, dropped' },
      ],
    }],
  };
  const out = productOwner.normalizeAnswer(raw, {
    issues, history: [], workflows: [{ file: 'software-development.yaml' }], selection: [1, 2],
  });
  assert.deepEqual(out.groups[0].suggested, [{ issue: 5, reason: 'kept' }]);
});

test('normalizeAnswer without a selection drops a suggested issue that is closed, already in the group, or duplicated; nothing is reported as closed', () => {
  const issues = [
    { number: 1, state: 'open' },
    { number: 2, state: 'closed' },
    { number: 3, state: 'open' },
  ];
  const raw = {
    summary: 'ok',
    groups: [{
      name: 'G',
      issues: [1],
      workflow: 'software-development.yaml',
      reason: 'r',
      suggested: [
        { issue: 2, reason: 'closed, dropped' },
        { issue: 1, reason: 'already in the group, dropped' },
        { issue: 3, reason: 'kept' },
        { issue: 3, reason: 'duplicate, dropped' },
      ],
    }],
  };
  const out = productOwner.normalizeAnswer(raw, { issues, history: [], workflows: [{ file: 'software-development.yaml' }] });
  assert.deepEqual(out.groups[0].suggested, [{ issue: 3, reason: 'kept' }]);
  assert.equal('closed' in out, false);
});

// ---- #148: a group's synthesized applied state (groups scenario) survives normalizeAnswer ----------

test('normalizeAnswer (mock only): keeps a group\'s simulated marker, its covered issues filtered to what the group actually kept, the stage defaulting to 1 when the proposed one is not a positive integer', () => {
  const issues = [{ number: 1, state: 'open' }, { number: 2, state: 'open' }];
  const raw = {
    summary: 'ok',
    groups: [{ name: 'G', issues: [1, 2], workflow: 'software-development.yaml', reason: 'r', simulated: { covered: [1, 999], stage: 0 } }],
  };
  const out = productOwner.normalizeAnswer(raw, { issues, history: [], workflows: [{ file: 'software-development.yaml' }], mock: true });
  assert.deepEqual(out.groups[0].simulated, { covered: [1], stage: 1 }); // #999 is unknown to the backlog: dropped
});

test('normalizeAnswer: a simulated marker is dropped without `mock` (a real answer never carries one), and when its covered issues are not among the group\'s own', () => {
  const issues = [{ number: 1, state: 'open' }, { number: 2, state: 'open' }, { number: 3, state: 'open' }];
  const simulated = { covered: [1], stage: 2 };
  const withoutMock = productOwner.normalizeAnswer(
    { summary: 'ok', groups: [{ name: 'G', issues: [1, 2], workflow: 'software-development.yaml', reason: 'r', simulated }] },
    { issues, history: [], workflows: [{ file: 'software-development.yaml' }] },
  );
  assert.equal('simulated' in withoutMock.groups[0], false);

  const outsideGroup = productOwner.normalizeAnswer(
    { summary: 'ok', groups: [{ name: 'G', issues: [1, 2], workflow: 'software-development.yaml', reason: 'r', simulated: { covered: [3], stage: 2 } }] },
    { issues, history: [], workflows: [{ file: 'software-development.yaml' }], mock: true },
  );
  assert.equal('simulated' in outsideGroup.groups[0], false); // #3 exists, but is not one of this group's issues
});

// ---- #148: mockScenario, the drawer's simulation-only scenario picker -------------------------------

test('mockScenario refuses an id outside MOCK_SCENARIOS', () => {
  assert.throws(() => productOwner.mockScenario('nope', { data: { issues: ISSUES } }), /Unknown simulated scenario: nope\./);
});

test('mockScenario(\'error\') throws a simulated error naming the scenario; nothing is spent (no message is returned to record)', () => {
  assert.throws(() => productOwner.mockScenario('error', { data: { issues: ISSUES } }), /Simulated error \(scenario "error"\): the Product Owner could not answer\./);
});

test('mockScenario(\'groups\'): on a backlog with no roadmap, queue or runs, synthesizes "Already applied" (its one issue covered at stage 1) and "Partly applied" (two issues, only the first covered)', () => {
  const out = productOwner.mockScenario('groups', { data: { issues: ISSUES } }); // 3 open, plannable issues: #1, #2, #3
  assert.equal(out.groups[0].name, 'Already applied');
  assert.deepEqual(out.groups[0].issues, [1]);
  assert.deepEqual(out.groups[0].simulated, { covered: [1], stage: 1 });
  assert.equal(out.groups[1].name, 'Partly applied');
  assert.deepEqual(out.groups[1].issues, [2, 3]);
  assert.deepEqual(out.groups[1].simulated, { covered: [2], stage: 1 });
});

test('mockScenario(\'groups\'): with one plannable issue only the "Already applied" group is produced', () => {
  const out = productOwner.mockScenario('groups', { data: { issues: ISSUES.slice(0, 1) } });
  assert.equal(out.groups.length, 1);
  assert.equal(out.groups[0].name, 'Already applied');
});

test('mockScenario(\'groups\'): with two plannable issues, "Partly applied" covers its only issue, so the group reads as fully applied (no issue left out)', () => {
  const out = productOwner.mockScenario('groups', { data: { issues: ISSUES.slice(0, 2) } });
  assert.equal(out.groups.length, 2);
  assert.equal(out.groups[1].name, 'Partly applied');
  assert.deepEqual(out.groups[1].issues, [2]);
  assert.deepEqual(out.groups[1].simulated.covered, [2]);
});

test('mockScenario(\'large-answer\'): up to 12 further groups (vs 4 for every other plan scenario), a long summary to scroll through, and issues to enrich', () => {
  const many = Array.from({ length: 30 }, (_, n) => ({ number: n + 1, state: 'open', title: `Issue ${n + 1}`, labels: [], body: 'x' }));
  const groups = productOwner.mockScenario('groups', { data: { issues: many } });
  const large = productOwner.mockScenario('large-answer', { data: { issues: many } });
  assert.ok(large.groups.length > groups.groups.length);
  assert.match(large.summary, /Paragraph 1\./);
  assert.ok(large.enrich.length > 0);
  assert.deepEqual(groups.enrich, []); // only the large-answer scenario proposes issues to enrich
});

test('backlogReport with a selection gives the attached issues first and whole (even past the usual clip), marks a closed one to leave out, and excludes them from "Other open issues"', () => {
  const longBody = 'x'.repeat(5000);
  const data = {
    projectId: 'demo',
    issues: [
      { number: 1, state: 'open', title: 'Attached A', labels: [], body: longBody },
      { number: 2, state: 'closed', title: 'Attached closed', labels: [], body: 'y' },
      { number: 3, state: 'open', title: 'Other open issue', labels: [], body: 'z' },
    ],
  };
  const report = productOwner.backlogReport({ data, workflows: [], selection: [1, 2] });
  assert.match(report, /## Attached issues \(the owner's selection, in full\)/);
  assert.ok(report.includes(longBody)); // not clipped at the usual 600-character limit
  assert.match(report, /### #2 Attached closed \(closed: leave it out\)/);
  assert.match(report, /## Other open issues/);
  const otherSection = report.split('## Other open issues')[1];
  assert.doesNotMatch(otherSection, /#1 Attached A/);
  assert.doesNotMatch(otherSection, /#2 Attached closed/);
  assert.match(otherSection, /#3 Other open issue/);
});

test('backlogReport: the attached issues\' size does not count toward the context cap, so other open issues still fit', () => {
  const data = {
    projectId: 'demo',
    issues: [
      { number: 1, state: 'open', title: 'Big attached', labels: [], body: 'x'.repeat(70000) }, // alone over the 60000-character cap
      { number: 2, state: 'open', title: 'Small other', labels: [], body: 'short' },
    ],
  };
  const report = productOwner.backlogReport({ data, workflows: [], selection: [1] });
  assert.match(report, /#2 Small other/);
  assert.doesNotMatch(report, /more issues left out \(context cap\)/);
});

test('mockAnswer with a selection plans only the attached to-do issues, and suggests up to two other to-do issues of the same topic per group', () => {
  const data = {
    issues: [
      { number: 1, state: 'open', title: 'One', labels: [{ name: 'area:ui' }], column: 'todo' },
      { number: 2, state: 'open', title: 'Two', labels: [{ name: 'area:ui' }], column: 'todo' },
      { number: 3, state: 'open', title: 'Three', labels: [{ name: 'area:ui' }], column: 'todo' },
      { number: 4, state: 'open', title: 'Four', labels: [{ name: 'area:ui' }], column: 'todo' }, // same topic, 3rd candidate: left out (cap 2)
      { number: 5, state: 'open', title: 'Five', labels: [{ name: 'area:server' }], column: 'todo' }, // different topic: never suggested
    ],
  };
  const answer = productOwner.mockAnswer({ data, selection: [1] });
  assert.deepEqual(answer.groups.flatMap((g) => g.issues), [1]); // only the attached issue is planned
  assert.deepEqual(answer.groups[0].suggested.map((s) => s.issue), [2, 3]);
});

test('ask (mock, plan mode) with a selection: the user message records the attached issues the backlog knows (an unknown number dropped), and the answer carries `closed`', async (t) => {
  const dir = tmp(t);
  const issues = [
    { number: 1, state: 'open', title: 'A', labels: [], column: 'todo' },
    { number: 2, state: 'closed', title: 'B', labels: [] },
  ];
  const out = await productOwner.ask({
    backlogDir: dir,
    projectId: 'demo',
    question: 'Plan these',
    data: { projectId: 'demo', issues },
    workflows: [{ file: 'software-development.yaml', name: 'Software development' }],
    mock: true,
    mode: 'plan',
    selection: [1, 2, 999],
  });
  const userMessage = out.messages.find((m) => m.role === 'user');
  assert.deepEqual(userMessage.issues, [1, 2]); // #999 is unknown to the backlog: dropped
  assert.deepEqual(out.message.answer.closed, [2]); // #2 is closed: left out of the groups, reported
});

test('ask (mock, issue mode) ignores a selection: it is not recorded on the user message', async (t) => {
  const dir = tmp(t);
  const runsDir = tmp(t);
  const out = await productOwner.ask({
    backlogDir: dir, projectId: 'demo', runsDir, question: 'Login button broken', data: emptyBacklog([{ number: 1, state: 'open' }]), mock: true, mode: 'issue', selection: [1],
  });
  const userMessage = out.messages.find((m) => m.role === 'user');
  assert.equal('issues' in userMessage, false);
});

// ---- #180: live progress (ask's onItem/signal) --------------------------------------------------

test('ask (mock, onItem set): the simulated turn streams its fake steps and the answer\'s text, ending in the hidden ```json block, before the final message is recorded', async (t) => {
  const dir = tmp(t);
  const items = [];
  const out = await productOwner.ask({
    backlogDir: dir, projectId: 'demo', question: 'Analyze the backlog',
    data: { projectId: 'demo', issues: ISSUES }, workflows: [], mock: true, mode: 'plan',
    onItem: (it) => items.push(it),
  });
  assert.equal(items[0].kind, 'thinking');
  assert.deepEqual(items.filter((it) => it.kind === 'tool_call').map((it) => it.name), ['Read', 'Grep', 'Bash']);
  assert.ok(items.some((it) => it.kind === 'text'));
  assert.match(items.at(-1).text, /^```json\n\{\n {2}"simulated": true\n\}\n```$/);
  assert.ok(out.message.answer); // the recorded answer is unaffected by the streaming
});

test('ask (mock, no onItem): the simulated turn streams nothing, behaving as before #180', async (t) => {
  const dir = tmp(t);
  const out = await productOwner.ask({
    backlogDir: dir, projectId: 'demo', question: 'Analyze the backlog',
    data: { projectId: 'demo', issues: ISSUES }, workflows: [], mock: true, mode: 'plan',
  });
  assert.ok(out.message.answer);
});

test('ask (mock, aborted mid-stream): the message is recorded as stopped (not an error), with whatever prose was written so far', async (t) => {
  const dir = tmp(t);
  const controller = new AbortController();
  const items = [];
  const out = await productOwner.ask({
    backlogDir: dir, projectId: 'demo', question: 'Analyze the backlog',
    data: { projectId: 'demo', issues: ISSUES }, workflows: [], mock: true, mode: 'plan',
    signal: controller.signal,
    onItem: (it) => { items.push(it); if (it.kind === 'tool_call' && it.name === 'Grep') controller.abort(); },
  });
  assert.equal(out.message.role, 'po');
  assert.equal(out.message.stopped, true);
  assert.equal(out.message.error, undefined);
  assert.ok(!items.some((it) => it.kind === 'text')); // aborted before any text was streamed
  assert.equal(out.message.text, 'Stopped before answering.'); // nothing was written yet
});

test('ask (mock, scenario "error"): the fake steps and a partial line stream first; the failure is then recorded carrying what was written', async (t) => {
  const dir = tmp(t);
  const items = [];
  const out = await productOwner.ask({
    backlogDir: dir, projectId: 'demo', question: 'Analyze the backlog',
    data: { projectId: 'demo', issues: ISSUES }, workflows: [], mock: true, mode: 'plan', scenario: 'error',
    onItem: (it) => items.push(it),
  });
  assert.deepEqual(items.filter((it) => it.kind === 'tool_call').map((it) => it.name), ['Read', 'Grep', 'Bash']);
  assert.ok(items.some((it) => it.kind === 'text' && it.text.includes('the answer had started')));
  assert.equal(items.some((it) => it.kind === 'text' && it.text.includes('```json')), false); // a failure carries no json block
  assert.equal(out.message.error, true);
  assert.match(out.message.text, /Simulated error \(scenario "error"\): the Product Owner could not answer\./);
  assert.match(out.message.text, /Written before the error:\n\nSimulated: the answer had started when the error came\./);
});

test('callAgent includes SELECTION_RULES in the prompt only when a selection is given (checked on the source: callAgent needs a real CLI to run for real)', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'product-owner.js'), 'utf8');
  assert.match(src, /selection\.length \? SELECTION_RULES : '',/);
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
  const runList = [
    { runId: 'a', mock: true, finishedAt: '2026-09-29T00:00:00Z', status: 'success' },
    { runId: 'b', mock: false, status: 'interrupted', finishedAt: '2026-09-29T00:00:00Z' },
    { runId: 'c', mock: false, status: 'running' }, // no finishedAt
    { runId: 'd', mock: false, status: 'success', finishedAt: '2026-09-29T00:00:00Z', issues: [], durationMs: 0, gateWaitMs: 0, costUsd: 0, tokens: {} },
  ];
  assert.deepEqual(productOwner.runHistory(runList, ISSUES).map((h) => h.runId), ['d']);
});

// ---- registering an issue (#117): a conversation, the question cap, thread folders, filing -------

function emptyBacklog(issues = []) { return { projectId: 'demo', issues }; }

test('normalizeIssueAnswer caps questions to what the thread has left (maxQuestions), MAX_QUESTIONS (2) by default', () => {
  const raw = { reply: 'r', questions: ['a', 'b', 'c'], draft: { title: '', body: '', labels: [], related: [] }, duplicates: [], existing_issue: 0, addition: '', assumptions: [] };
  assert.equal(productOwner.normalizeIssueAnswer(raw, { issues: [] }).questions.length, 2);
  assert.equal(productOwner.normalizeIssueAnswer(raw, { issues: [], maxQuestions: 1 }).questions.length, 1);
  assert.deepEqual(productOwner.normalizeIssueAnswer(raw, { issues: [], maxQuestions: 0 }).questions, []);
});

test('a short first request gets one question (simulated); a longer follow-up gets a draft with no question, revising the same thread', async (t) => {
  const dir = tmp(t);
  const runsDir = tmp(t);
  const first = await productOwner.ask({
    backlogDir: dir, projectId: 'demo', runsDir, question: 'Login button broken', data: emptyBacklog(), mock: true, mode: 'issue',
  });
  assert.equal(first.message.issue.questions.length, 1);
  assert.equal(first.message.issue.draft, null);
  const thread = first.message.thread;

  const second = await productOwner.ask({
    backlogDir: dir, projectId: 'demo', runsDir, question: 'It happens on the settings page after clicking Save, nothing happens', data: emptyBacklog(), mock: true, mode: 'issue',
  });
  assert.deepEqual(second.message.issue.questions, []);
  assert.ok(second.message.issue.draft?.title);
  assert.equal(second.message.thread, thread); // the same thread: the draft revises it, it does not start a new one
});

test('the question cap (2 per thread) blocks further questions once two po messages already asked that many; filing resets it for the next thread', async (t) => {
  const dir = tmp(t);
  const runsDir = tmp(t);
  const first = await productOwner.ask({
    backlogDir: dir, projectId: 'demo', runsDir, question: 'Crash on save', data: emptyBacklog(), mock: true, mode: 'issue',
  });
  assert.equal(first.message.issue.questions.length, 1);
  const thread = first.message.thread;

  // a second po message with a question, appended as a real model turn would (the mock itself only
  // ever asks once): the thread now has 2 po messages totalling MAX_QUESTIONS (2) questions asked.
  const extra = { ts: new Date().toISOString(), role: 'po', mode: 'issue', thread, text: 'One more thing:', issue: { questions: ['Which project is this in?'] } };
  fs.appendFileSync(path.join(dir, 'demo.po.jsonl'), `${JSON.stringify(extra)}\n`);
  fs.appendFileSync(path.join(runsDir, thread, 'conversation.jsonl'), `${JSON.stringify(extra)}\n`);

  const third = await productOwner.ask({
    backlogDir: dir, projectId: 'demo', runsDir, question: 'It is the orchestrator project, same as before', data: emptyBacklog(), mock: true, mode: 'issue',
  });
  assert.deepEqual(third.message.issue.questions, []); // the cap is already reached: no more questions
  assert.equal(third.message.thread, thread);

  const draft = productOwner.currentDraft(third.messages);
  assert.ok(draft?.message.issue.draft);
  const exec = async (cli, args) => (args.includes('list') ? '[]' : 'https://github.com/example/repo/issues/42\n');
  await productOwner.fileDraft({
    backlogDir: dir, projectId: 'demo', runsDir, at: draft.message.ts, action: 'create', preview: false,
    platform: 'github', repo: 'https://github.com/example/repo', exec,
  });

  // the thread id is a second-resolution stamp: wait past the second so the next thread gets a new one
  await new Promise((resolve) => setTimeout(resolve, 1100));
  const after = await productOwner.ask({
    backlogDir: dir, projectId: 'demo', runsDir, question: 'Settings page also crashes', data: emptyBacklog(), mock: true, mode: 'issue',
  });
  assert.equal(after.message.issue.questions.length, 1); // free to ask again: filing closed the old thread, so its questions are not counted
  assert.notEqual(after.message.thread, thread);
});

test('ask with mode "issue" and a runs folder keeps the thread in runs/po-<project>-<stamp>/: conversation.jsonl, one analysis file per turn, and attachments moved in; nothing is filed on its own', async (t) => {
  const dir = tmp(t);
  const runsDir = tmp(t);
  const staged = productOwner.saveAttachment(dir, 'demo', { name: 'screenshot.png', data: Buffer.from('fake-image').toString('base64') });
  assert.ok(fs.existsSync(staged.path));

  const first = await productOwner.ask({
    backlogDir: dir, projectId: 'demo', runsDir, question: 'Login button broken', data: emptyBacklog(), mock: true, mode: 'issue', attachments: [staged.path],
  });
  const thread = first.message.thread;
  assert.match(thread, /^po-demo-\d{8}-\d{6}$/);
  const threadDir = path.join(runsDir, thread);
  assert.ok(fs.existsSync(path.join(threadDir, 'conversation.jsonl')));
  const lines = fs.readFileSync(path.join(threadDir, 'conversation.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.equal(lines.length, 2); // the owner's message and the Product Owner's answer
  assert.equal(lines[0].role, 'user');
  assert.equal(lines[1].role, 'po');

  // the staged attachment moved into the thread's attachments/ folder; the user message lists the new path
  assert.equal(fs.existsSync(staged.path), false);
  const moved = lines[0].attachments[0];
  assert.ok(fs.existsSync(moved));
  assert.equal(path.dirname(moved), path.join(threadDir, 'attachments'));

  const analysisFiles = fs.readdirSync(path.join(threadDir, 'analysis'));
  assert.equal(analysisFiles.length, 1);
  assert.match(fs.readFileSync(path.join(threadDir, 'analysis', analysisFiles[0]), 'utf8'), /```json/);
  assert.equal(fs.existsSync(path.join(threadDir, 'filed')), false); // nothing is filed without the owner's click

  const second = await productOwner.ask({
    backlogDir: dir, projectId: 'demo', runsDir, question: 'It happens on the settings page', data: emptyBacklog(), mock: true, mode: 'issue',
  });
  assert.equal(second.message.thread, thread); // reuses the same folder
  const lines2 = fs.readFileSync(path.join(threadDir, 'conversation.jsonl'), 'utf8').trim().split('\n');
  assert.equal(lines2.length, 4); // the second exchange appended to the same file
});

test('without a runs folder, the thread falls back to backlog/<project>.po/<thread>', async (t) => {
  const dir = tmp(t);
  const out = await productOwner.ask({
    backlogDir: dir, projectId: 'demo', question: 'Login crashes every time I click save on the settings page', data: emptyBacklog(), mock: true, mode: 'issue',
  });
  const fallback = path.join(dir, 'demo.po', out.message.thread);
  assert.ok(fs.existsSync(path.join(fallback, 'conversation.jsonl')));
});

test('fileDraft (not a preview) writes the body to the thread\'s filed/ folder and names that folder in the message; a preview writes nothing there and keeps the thread open', async (t) => {
  const dir = tmp(t);
  const runsDir = tmp(t);
  const asked = await productOwner.ask({
    backlogDir: dir, projectId: 'demo', runsDir, question: 'Login crashes every time I click save on the settings page', data: emptyBacklog(), mock: true, mode: 'issue',
  });
  const draft = productOwner.currentDraft(asked.messages);
  assert.ok(draft?.message.issue.draft);
  const threadFolder = path.join(runsDir, asked.message.thread);

  const preview = await productOwner.fileDraft({
    backlogDir: dir, projectId: 'demo', runsDir, at: draft.message.ts, action: 'create', preview: true,
    platform: 'github', repo: 'https://github.com/example/repo',
  });
  assert.equal(preview.preview, true);
  assert.equal(fs.existsSync(path.join(threadFolder, 'filed')), false);
  assert.ok(productOwner.currentDraft(preview.messages)); // a preview never ends the thread

  const exec = async (cli, args) => (args.includes('list') ? '[]' : 'https://github.com/example/repo/issues/42\n');
  const res = await productOwner.fileDraft({
    backlogDir: dir, projectId: 'demo', runsDir, at: draft.message.ts, action: 'create', preview: false,
    platform: 'github', repo: 'https://github.com/example/repo', exec,
  });
  assert.equal(res.filed.folder, threadFolder);
  assert.ok(res.message.text.includes(threadFolder));
  const filedFiles = fs.readdirSync(path.join(threadFolder, 'filed'));
  assert.equal(filedFiles.length, 1);
  assert.match(filedFiles[0], /-new\.md$/);
  assert.equal(productOwner.currentDraft(res.messages), null); // filing (not a preview) ends the thread
});

test('"Add to #n instead" appends a dated section to the existing issue\'s body, never creating a new issue', async (t) => {
  const dir = tmp(t);
  const runsDir = tmp(t);
  const issues = [{ number: 110, state: 'open', title: 'Some existing issue', body: 'Original body.\n' }];
  const asked = await productOwner.ask({
    backlogDir: dir, projectId: 'demo', runsDir, question: 'Add this to #110: also make it work in the run chat', data: emptyBacklog(issues), mock: true, mode: 'issue',
  });
  const draft = productOwner.currentDraft(asked.messages);
  assert.equal(draft.message.issue.existingIssue, 110);
  assert.ok(draft.message.issue.addition);

  const res = await productOwner.fileDraft({
    backlogDir: dir, projectId: 'demo', runsDir, at: draft.message.ts, action: 'append', number: 110, preview: true,
    platform: 'github', repo: 'https://github.com/example/repo', cached: { body: issues[0].body, url: 'https://github.com/example/repo/issues/110' },
  });
  assert.equal(res.filed.action, 'append');
  assert.equal(res.filed.number, 110);
  assert.doesNotMatch(res.command, /issue create/);
  assert.match(res.command, /issue edit/);
  assert.match(res.body, /Original body\./); // the original text is kept
  assert.match(res.body, /## Update \(\d{4}-\d{2}-\d{2}\)/); // a dated section is appended, not a replacement
});

test('discardDraft records the discard in the thread\'s own folder, and the next issue message starts a new thread', async (t) => {
  const dir = tmp(t);
  const runsDir = tmp(t);
  const asked = await productOwner.ask({
    backlogDir: dir, projectId: 'demo', runsDir, question: 'Login crashes every time I click save on the settings page', data: emptyBacklog(), mock: true, mode: 'issue',
  });
  const draft = productOwner.currentDraft(asked.messages);
  const thread = asked.message.thread;

  const messages = productOwner.discardDraft(dir, 'demo', draft.message.ts, runsDir);
  const discardMsg = messages[messages.length - 1];
  assert.equal(discardMsg.discarded, draft.message.ts);
  assert.equal(discardMsg.thread, thread);
  const lines = fs.readFileSync(path.join(runsDir, thread, 'conversation.jsonl'), 'utf8').trim().split('\n');
  assert.equal(lines.length, 3); // the owner's message, the draft, and the discard note
  assert.equal(productOwner.currentDraft(messages), null);

  // the thread id is a second-resolution stamp: wait past the second so the next thread gets a new one
  await new Promise((resolve) => setTimeout(resolve, 1100));
  const after = await productOwner.ask({
    backlogDir: dir, projectId: 'demo', runsDir, question: 'Settings page also crashes on load', data: emptyBacklog(), mock: true, mode: 'issue',
  });
  assert.notEqual(after.message.thread, thread);
  // a fresh thread, not the closed one: its folder has only this exchange, not the old thread's history
  const afterLines = fs.readFileSync(path.join(runsDir, after.message.thread, 'conversation.jsonl'), 'utf8').trim().split('\n');
  assert.equal(afterLines.length, 2);
});

test('clearConversation forgets the chat but leaves the thread folders in the runs folder untouched', async (t) => {
  const dir = tmp(t);
  const runsDir = tmp(t);
  const asked = await productOwner.ask({
    backlogDir: dir, projectId: 'demo', runsDir, question: 'Login crashes every time I click save on the settings page', data: emptyBacklog(), mock: true, mode: 'issue',
  });
  const threadFolder = path.join(runsDir, asked.message.thread);

  const left = productOwner.clearConversation(dir, 'demo');
  assert.deepEqual(left, []);
  assert.ok(fs.existsSync(path.join(threadFolder, 'conversation.jsonl'))); // the thread's own files stay
});

test('runs.listRuns ignores a runs/po-<project>-<stamp> folder: it has no events.jsonl, so it is not a run', async (t) => {
  const dir = tmp(t);
  const runsDir = tmp(t);
  await productOwner.ask({
    backlogDir: dir, projectId: 'demo', runsDir, question: 'Login crashes every time I click save on the settings page', data: emptyBacklog(), mock: true, mode: 'issue',
  });
  assert.ok(fs.readdirSync(runsDir).some((f) => f.startsWith('po-demo-')));
  assert.deepEqual(runs.listRuns(runsDir), []);
});

// ---- #124: splitting what is too big for one run, applied on the owner's click ---------------------

const BIG_BODY = [
  '- [ ] Update src/engine/workflow.js for X',
  '- [ ] Add src/engine/queue.js handling',
  '- [ ] Fix src/engine/graph.js edge case',
  '- [ ] Tweak src/engine/retry.js',
  '- [ ] Update src/engine/state.js',
  '- [ ] Adjust src/engine/index.js',
  '- [ ] Update src/renderer/backlog.js UI',
  '- [ ] Add src/renderer/kanban.js view',
  '- [ ] Fix src/renderer/style.css',
  '- [ ] Update src/renderer/app.js',
  '- [ ] Adjust src/renderer/index.html',
  '- [ ] Polish src/renderer/icons.js',
].join('\n');

test('a mock plan answer flags a 12-task, two-area issue too big for one run, with a split covering every task once', () => {
  const data = { issues: [{ number: 50, state: 'open', title: 'Big issue', labels: [], body: BIG_BODY }] };
  const answer = productOwner.mockAnswer({ data });
  assert.equal(answer.splits.length, 1);
  const [split] = answer.splits;
  assert.equal(split.issue, 50);
  const all = split.children.flatMap((c) => c.tasks).sort((a, b) => a - b);
  assert.deepEqual(all, Array.from({ length: 12 }, (_, i) => i + 1));
});

test('applySplit: files the proposed children and updates the parent only once called, and never files the same split twice', async (t) => {
  const dir = tmp(t);
  const runsDir = tmp(t);
  const bigIssue = { number: 50, state: 'open', title: 'Big issue', labels: [], body: BIG_BODY };
  const asked = await productOwner.ask({
    backlogDir: dir, projectId: 'demo', runsDir, question: 'Analyze the backlog', data: { issues: [bigIssue] }, mock: true,
  });
  const split = asked.message.answer.splits.find((s) => s.issue === 50);
  assert.ok(split);

  let created = 100;
  let filed = false;
  const exec = async (cli, args) => {
    if (args[0] === 'label' && args[1] === 'list') return JSON.stringify([]);
    if (args[0] === 'issue' && args[1] === 'create') { filed = true; created += 1; return `https://github.com/example/repo/issues/${created}\n`; }
    if (args[0] === 'issue' && args[1] === 'view') {
      return JSON.stringify({ number: 50, title: bigIssue.title, state: 'open', labels: [], url: 'u', author: null, assignees: [], body: bigIssue.body, createdAt: 'c', updatedAt: 'u' });
    }
    return '';
  };

  const res = await productOwner.applySplit({
    backlogDir: dir, projectId: 'demo', runsDir, at: asked.message.ts, split, preview: false,
    platform: 'github', repo: 'https://github.com/example/repo', data: { issues: [bigIssue] }, exec,
  });
  assert.equal(filed, true); // nothing was filed before this call
  assert.equal(res.children.length, split.children.length);
  assert.ok(res.children.every((c) => c.number));
  assert.match(res.message.text, /Split #50 into/);

  await assert.rejects(productOwner.applySplit({
    backlogDir: dir, projectId: 'demo', runsDir, at: asked.message.ts, split, preview: false,
    platform: 'github', repo: 'https://github.com/example/repo', data: { issues: [bigIssue] }, exec,
  }), /already split/);
});

// ---- #138: epics proposed by the Product Owner, applied on the owner's click -------------------------

test('applyEpicProposal: a mock plan answer proposes a new epic for issues sharing a theme; applying creates it and places them, and refuses a second apply', async (t) => {
  const dir = tmp(t);
  const runsDir = tmp(t);
  const issues = [
    { number: 1, state: 'open', title: 'One', labels: [{ name: 'area:ui' }], body: 'x'.repeat(200) },
    { number: 2, state: 'open', title: 'Two', labels: [{ name: 'area:ui' }], body: 'x'.repeat(200) },
  ];
  const asked = await productOwner.ask({
    backlogDir: dir, projectId: 'demo', runsDir, question: 'Analyze the backlog', data: { issues }, mock: true,
  });
  const create = asked.message.answer.epics.create[0];
  assert.deepEqual(create.issues, [1, 2]);

  let createdNumber = 900;
  let wrote = false;
  const exec = async (cli, args) => {
    if (args[0] === 'label' && args[1] === 'list') return JSON.stringify([]);
    if (args[0] === 'issue' && args[1] === 'create') { wrote = true; createdNumber += 1; return `https://github.com/example/repo/issues/${createdNumber}\n`; }
    return '';
  };
  const res = await productOwner.applyEpicProposal({
    backlogDir: dir, projectId: 'demo', runsDir, at: asked.message.ts, key: 'create:0', epic: { title: create.title, goal: create.goal }, issues: create.issues, preview: false,
    platform: 'github', repo: 'https://github.com/example/repo', data: { issues }, exec,
  });
  assert.equal(wrote, true);
  assert.equal(res.epic.number, 901);
  assert.deepEqual(res.linked, [1, 2]);
  assert.match(res.message.text, /Created the epic/);

  await assert.rejects(productOwner.applyEpicProposal({
    backlogDir: dir, projectId: 'demo', runsDir, at: asked.message.ts, key: 'create:0', epic: { title: create.title, goal: create.goal }, issues: create.issues, preview: false,
    platform: 'github', repo: 'https://github.com/example/repo', data: { issues }, exec,
  }), /already applied/);
});

test('applyEpicProposal: a preview writes nothing and never counts as applied', async (t) => {
  const dir = tmp(t);
  const runsDir = tmp(t);
  const issues = [
    { number: 1, state: 'open', title: 'One', labels: [{ name: 'area:ui' }], body: 'x'.repeat(200) },
    { number: 2, state: 'open', title: 'Two', labels: [{ name: 'area:ui' }], body: 'x'.repeat(200) },
  ];
  const asked = await productOwner.ask({
    backlogDir: dir, projectId: 'demo', runsDir, question: 'Analyze the backlog', data: { issues }, mock: true,
  });
  const create = asked.message.answer.epics.create[0];
  let called = false;
  const exec = async () => { called = true; return ''; };
  const res = await productOwner.applyEpicProposal({
    backlogDir: dir, projectId: 'demo', runsDir, at: asked.message.ts, key: 'create:0', epic: { title: create.title, goal: create.goal }, issues: create.issues, preview: true,
    platform: 'github', repo: 'https://github.com/example/repo', data: { issues }, exec,
  });
  assert.equal(called, false);
  assert.match(res.message.text, /Preview/);

  // the same proposal can still be applied for real afterwards: a preview never marks it as done
  const real = await productOwner.applyEpicProposal({
    backlogDir: dir, projectId: 'demo', runsDir, at: asked.message.ts, key: 'create:0', epic: { title: create.title, goal: create.goal }, issues: create.issues, preview: false,
    platform: 'github', repo: 'https://github.com/example/repo', data: { issues },
    exec: async (cli, args) => (args[0] === 'issue' && args[1] === 'create' ? 'https://github.com/example/repo/issues/950\n' : ''),
  });
  assert.equal(real.epic.number, 950);
});
