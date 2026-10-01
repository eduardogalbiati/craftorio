// Splitting what is too big for one run (#124, src/po-split.js): which issues get flagged, the
// deterministic proposal, repairing a model's answer so every parent task lands in exactly one
// child, the owner's edit check, and filing the children on the owner's click.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const poSplit = require('../src/po-split');

function tmp(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'po-split-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

// 12 tasks in two unrelated areas of the code (src/engine, src/renderer), no headings.
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
const ALL_TASKS = Array.from({ length: 12 }, (_, i) => i + 1);
const bigIssue = (extra = {}) => ({ number: 50, state: 'open', title: 'Big issue', body: BIG_BODY, labels: [{ name: 'complexity:3' }], ...extra });

// ---- splitSignals / proposeSplit: who gets flagged, and the deterministic proposal ------------------

test('splitSignals: a small issue (a couple of tasks, no complexity label) is never flagged', () => {
  const small = { number: 1, state: 'open', title: 'Small', body: '- [ ] one\n- [ ] two\n', labels: [] };
  assert.deepEqual(poSplit.splitSignals(small, {}), []);
  assert.equal(poSplit.proposeSplit(small, {}), null);
});

test('splitSignals: an issue with no task list at all is never flagged, even at complexity 5', () => {
  const noTasks = { number: 2, state: 'open', title: 'No checklist', body: 'Just prose, no tasks.', labels: [] };
  assert.deepEqual(poSplit.splitSignals(noTasks, { complexity: 5 }), []);
});

test('proposeSplit: 12 tasks in two unrelated areas of the code yield two children, covering every parent task exactly once', () => {
  const split = poSplit.proposeSplit(bigIssue(), {});
  assert.equal(split.children.length, 2);
  const all = split.children.flatMap((c) => c.tasks).sort((a, b) => a - b);
  assert.deepEqual(all, ALL_TASKS);
  assert.equal(new Set(all).size, ALL_TASKS.length); // none shared between children
  assert.ok(split.reasons.some((r) => /12 tasks/.test(r)));
  assert.ok(split.reasons.some((r) => /2 unrelated areas/.test(r)));
  assert.equal(split.parent, 'umbrella');
});

// ---- normalizeSplit: repairs a model's proposal, never invents or drops a task ----------------------

test('normalizeSplit repairs a model proposal that duplicates one task and drops another', () => {
  const raw = {
    children: [
      { title: 'Engine', tasks: [1, 2, 3, 4, 5, 6, 1], complexity: 2, stage: 1 }, // task 1 duplicated
      { title: 'Renderer', tasks: [7, 8, 9, 10, 11], complexity: 2, stage: 2 }, // task 12 missing
    ],
  };
  const out = poSplit.normalizeSplit(raw, bigIssue(), {});
  const all = out.children.flatMap((c) => c.tasks).sort((a, b) => a - b);
  assert.deepEqual(all, ALL_TASKS);
  assert.equal(out.repaired, true);
  assert.equal(out.children.find((c) => c.title === 'Renderer').tasks.includes(12), true); // joins its predecessor's child
});

test('normalizeSplit drops a task number the issue does not have, and falls back to the deterministic split when fewer than two children are left', () => {
  const raw = { children: [{ title: 'Everything', tasks: [1, 2, 3, 99], complexity: 3, stage: 1 }] };
  const out = poSplit.normalizeSplit(raw, bigIssue(), {});
  assert.ok(out.children.length >= 2); // the fallback proposal, not the model's single child
  const all = out.children.flatMap((c) => c.tasks).sort((a, b) => a - b);
  assert.deepEqual(all, ALL_TASKS);
});

test('normalizeSplit never splits a closed issue or one with no split signal', () => {
  assert.equal(poSplit.normalizeSplit({ children: [] }, bigIssue({ state: 'closed' }), {}), null);
  const small = { number: 3, state: 'open', title: 'Small', body: '- [ ] one\n- [ ] two\n', labels: [] };
  assert.equal(poSplit.normalizeSplit({ children: [{ title: 'A', tasks: [1] }, { title: 'B', tasks: [2] }] }, small, {}), null);
});

// ---- checkSplit: the owner's edit, checked before filing ---------------------------------------------

test('checkSplit accepts an owner-edited proposal only when every task of the parent is in exactly one child', () => {
  const issue = bigIssue();
  const good = { parent: 'umbrella', children: [{ title: 'A', tasks: [1, 2, 3, 4, 5, 6], complexity: 2, stage: 1 }, { title: 'B', tasks: [7, 8, 9, 10, 11, 12], complexity: 2, stage: 2 }] };
  const checked = poSplit.checkSplit(good, issue);
  assert.equal(checked.children.length, 2);
  assert.equal(checked.parent, 'umbrella');

  const missing = { children: [{ title: 'A', tasks: [1, 2, 3], complexity: 1, stage: 1 }, { title: 'B', tasks: [4, 5], complexity: 1, stage: 1 }] };
  assert.throws(() => poSplit.checkSplit(missing, issue), /task.*6.*none|none/i);

  const duplicated = { children: [{ title: 'A', tasks: [1, 2, 3, 4, 5, 6, 7], complexity: 1, stage: 1 }, { title: 'B', tasks: [7, 8, 9, 10, 11, 12], complexity: 1, stage: 1 }] };
  assert.throws(() => poSplit.checkSplit(duplicated, issue), /two children/);

  assert.throws(() => poSplit.checkSplit(good, bigIssue({ state: 'closed' })), /closed/);
});

// ---- fileSplit: nothing is filed without the owner's click -------------------------------------------

const SPLIT = { issue: 50, parent: 'umbrella', children: [
  { title: 'Engine work', tasks: [1, 2, 3, 4, 5, 6], complexity: 3, stage: 1 },
  { title: 'Renderer work', tasks: [7, 8, 9, 10, 11, 12], complexity: 3, stage: 2 },
] };

test('fileSplit: a preview returns the commands it would run, without calling the CLI or writing anything', async (t) => {
  const dir = tmp(t);
  let called = false;
  const exec = async () => { called = true; return ''; };
  const res = await poSplit.fileSplit({ platform: 'github', repo: 'https://github.com/o/r', parent: bigIssue(), split: SPLIT, dir, preview: true, exec });
  assert.equal(called, false);
  assert.equal(res.preview, true);
  assert.equal(res.children.length, 2);
  assert.deepEqual(fs.readdirSync(dir), []);
});

test('fileSplit: files each child with its tasks, then appends an umbrella task list to the parent', async (t) => {
  const dir = tmp(t);
  const calls = [];
  let created = 100;
  const exec = async (cli, args) => {
    calls.push([cli, ...args]);
    if (args[0] === 'label' && args[1] === 'list') return JSON.stringify([{ name: 'complexity:3' }]);
    if (args[0] === 'issue' && args[1] === 'create') { created += 1; return `https://github.com/o/r/issues/${created}\n`; }
    if (args[0] === 'issue' && args[1] === 'view') {
      return JSON.stringify({ number: 50, title: 'Big issue', state: 'open', labels: [], url: 'u', author: null, assignees: [], body: BIG_BODY, createdAt: 'c', updatedAt: 'u' });
    }
    return '';
  };
  const res = await poSplit.fileSplit({ platform: 'github', repo: 'https://github.com/o/r', parent: bigIssue(), split: SPLIT, dir, preview: false, exec });
  assert.deepEqual(res.children.map((c) => c.number), [101, 102]);
  assert.equal(res.parent.action, 'umbrella');
  assert.ok(calls.some((c) => c[0] === 'gh' && c[1] === 'issue' && c[2] === 'edit' && c.includes('50')));
  const umbrellaFile = fs.readdirSync(dir).find((f) => f.includes('umbrella'));
  const umbrellaText = fs.readFileSync(path.join(dir, umbrellaFile), 'utf8');
  assert.match(umbrellaText, /#101/);
  assert.match(umbrellaText, /#102/);
  const child1 = fs.readFileSync(path.join(dir, fs.readdirSync(dir).find((f) => f.includes('split-50-1'))), 'utf8');
  assert.match(child1, /Update src\/engine\/workflow\.js for X/);
  assert.doesNotMatch(child1, /src\/renderer/);
});

test('fileSplit: when the parent is closed in favour of its children, it gets a comment linking them and is closed', async (t) => {
  const dir = tmp(t);
  const calls = [];
  let created = 200;
  const exec = async (cli, args) => {
    calls.push([cli, ...args]);
    if (args[0] === 'label' && args[1] === 'list') return JSON.stringify([{ name: 'complexity:3' }]);
    if (args[0] === 'issue' && args[1] === 'create') { created += 1; return `https://github.com/o/r/issues/${created}\n`; }
    return '';
  };
  const res = await poSplit.fileSplit({ platform: 'github', repo: 'https://github.com/o/r', parent: bigIssue(), split: { ...SPLIT, parent: 'close' }, dir, preview: false, exec });
  assert.equal(res.parent.action, 'close');
  assert.ok(calls.some((c) => c[0] === 'gh' && c[1] === 'issue' && c[2] === 'comment'));
  assert.ok(calls.some((c) => c[0] === 'gh' && c[1] === 'issue' && c[2] === 'close'));
});

test('fileSplit: children of a parent already in an epic join it too', async (t) => {
  const dir = tmp(t);
  let created = 300;
  const exec = async (cli, args) => {
    if (args[0] === 'label' && args[1] === 'list') return JSON.stringify([{ name: 'complexity:3' }]);
    if (args[0] === 'issue' && args[1] === 'create') { created += 1; return `https://github.com/o/r/issues/${created}\n`; }
    if (args[0] === 'issue' && args[1] === 'view') {
      return JSON.stringify({ number: 50, title: 'Big issue', state: 'open', labels: [], url: 'u', author: null, assignees: [], body: BIG_BODY, createdAt: 'c', updatedAt: 'u' });
    }
    return '';
  };
  const epicList = [{ id: '#9', number: 9, title: 'Theme', kind: 'issue', members: [] }];
  const res = await poSplit.fileSplit({ platform: 'github', repo: 'https://github.com/o/r', parent: bigIssue({ epic: '#9' }), split: SPLIT, dir, preview: false, epicList, exec });
  assert.equal(res.epicError, undefined);
  assert.deepEqual(res.children.map((c) => c.number), [301, 302]);
});
