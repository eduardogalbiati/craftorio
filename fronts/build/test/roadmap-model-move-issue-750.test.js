// #750 (moved from backlog-roadmap.js; the rule is #163): RoadmapModel.dropProblem and moveIssue, the
// drag-and-drop of an issue from one roadmap item into another, now in packages/shared/roadmap-model.js.
// dropProblem(stages, { issue, from }, toId): '' when the drop is allowed, otherwise why not.
// moveIssue(stages, number, fromId, toId): moves the issue (changes `stages`), false when refused.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const MODEL = path.join(__dirname, '..', '..', '..', 'packages', 'shared', 'roadmap-model.js');
const load = () => require(MODEL);

const issue = (n) => ({ number: n, url: `https://github.com/o/r/issues/${n}`, title: `Issue ${n}`, body: '', knownPullRequests: [] });
// an item of either shape: an `issues` list (two or more), or one issue stored as the item (before #163)
const item = (id, status, numbers, extra = {}) => {
  const issues = numbers.map(issue);
  return { id, workflow: 'software-development', status, ...issues[0], ...(issues.length > 1 ? { issues } : {}), ...extra };
};
const stages = () => [
  { id: 's1', items: [item('a', 'planned', [1, 2]), item('b', 'planned', [3])] },
  { id: 's2', items: [item('c', 'failed', [4]), item('d', 'running', [5]), item('e', 'done', [6]), item('w', 'running', [7], { waiting: true })] }, // w: its run waits at a human gate (#395)
];
const numbersOf = (x) => Array.from(x.issues || [x], (i) => i.number);
const ids = (st) => st.map((s) => s.items.map((x) => x.id).join(','));

test('#750 dropProblem: an issue may join another planned or failed item', () => {
  const { dropProblem } = load();
  assert.equal(dropProblem(stages(), { issue: 3, from: 'b' }, 'a'), '');
  assert.equal(dropProblem(stages(), { issue: 1, from: 'a' }, 'c'), '');
});

test('#750 dropProblem: refuses an issue no longer in its item, a missing target and the same item', () => {
  const { dropProblem } = load();
  assert.match(dropProblem(stages(), { issue: 9, from: 'a' }, 'b'), /#9 is no longer in that item/);
  assert.match(dropProblem(stages(), { issue: 1, from: 'gone' }, 'b'), /#1 is no longer in that item/);
  assert.match(dropProblem(stages(), { issue: 1, from: 'a' }, 'nowhere'), /another item/);
  assert.match(dropProblem(stages(), { issue: 1, from: 'a' }, 'a'), /#1 is already in this item/);
});

test('#750 dropProblem: a running, done or gate-waiting item takes no issue', () => {
  const { dropProblem } = load();
  assert.match(dropProblem(stages(), { issue: 3, from: 'b' }, 'd'), /running/);
  assert.match(dropProblem(stages(), { issue: 3, from: 'b' }, 'e'), /done/);
  assert.match(dropProblem(stages(), { issue: 3, from: 'b' }, 'w'), /waiting at a gate/);
});

test('#750 moveIssue: the issue joins the target (a group) and the emptied item goes', () => {
  const { moveIssue } = load();
  const st = stages();
  assert.equal(moveIssue(st, 3, 'b', 'a'), true);
  const a = st[0].items.find((x) => x.id === 'a');
  assert.deepEqual(numbersOf(a), [1, 2, 3]);
  assert.deepEqual([a.number, a.title], [1, 'Issue 1'], 'the first issue stays at the top');
  assert.deepEqual(ids(st), ['a', 'c,d,e,w']);
});

test('#750 moveIssue: the source keeps its other issues, its first one at the top; a single-issue target becomes a group', () => {
  const { moveIssue } = load();
  const st = stages();
  assert.equal(moveIssue(st, 1, 'a', 'c'), true);
  const a = st[0].items.find((x) => x.id === 'a');
  const c = st[1].items.find((x) => x.id === 'c');
  assert.deepEqual([numbersOf(a), a.number, a.title], [[2], 2, 'Issue 2']);
  assert.deepEqual([numbersOf(c), c.number], [[4, 1], 4]);
  assert.deepEqual(ids(st), ['a,b', 'c,d,e,w']);
});

test('#750 moveIssue: a refused drop changes nothing and returns false', () => {
  const { moveIssue } = load();
  const st = stages();
  const before = JSON.stringify(st);
  assert.equal(moveIssue(st, 3, 'b', 'd'), false);
  assert.equal(moveIssue(st, 9, 'b', 'a'), false);
  assert.equal(JSON.stringify(st), before);
});
