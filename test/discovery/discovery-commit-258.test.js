// #258 Commit a discovery card to the backlog: a Ready card at or above the commit bar (85%) is
// split into one or more issues, each filed with "From discovery card <id>" in its body; the card
// keeps their numbers in links.issues and leaves the board for the Committed list, where it shows
// its issues' delivery progress (to do, running, merged locally, done), then Delivered and Released.
// A committed card never goes back to the board: new learning is a new card linked to it.
//
// The contract these tests assume, src/domains/discovery/discovery-commit.js (required inside each test, so a missing
// module fails its tests, not the file):
//   COMMIT_BAR === 85
//   checkCommit(card) → { ok, score, bar, gaps }
//   commitCard({ dir, projectId, cardId, split: { issues: [{ title, tasks, complexity, workflow }] },
//     platform, repo, exec, by }) → { issues: [{ number, url, title }], card }
//   cardDelivery(card, issues, releases) → { stage, counts: { todo, running, local, done }, issues: [{ number, column }] }
// and in src/domains/discovery/discovery.js: moveCard refuses a committed card; createCard({ from }) links the new card.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { layout } = require('../../src/domains/workspace/workspace');
const discovery = require('../../src/domains/discovery/discovery');

const load = () => require('../../src/domains/discovery/discovery-commit');
const P = 'p1';
const REPO = 'https://github.com/o/r';

function tmp(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'discovery-commit-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return layout(root).discovery;
}

// A card in Ready with the given clarity score and gaps (below the bar: moved anyway with a reason).
function readyCard(dir, { title = 'Export runs as CSV', score = 90, gaps = [] } = {}) {
  const card = discovery.createCard(dir, P, { title, text: 'The runs table cannot be exported.' });
  discovery.updateCard(dir, P, card.id, { clarity: { score, gaps } });
  const opts = score >= 85 ? { by: 'tester' } : { by: 'tester', force: true, reason: 'Needed for the test' };
  discovery.moveCard(dir, P, card.id, 'ready', opts);
  return card.id;
}

// The gh CLI stub: records each call, keeps each filed issue's body, files #101, #102, ...
function ghStub() {
  const calls = [];
  const bodies = [];
  let next = 100;
  const exec = async (cli, args) => {
    calls.push([cli, ...args]);
    if (args[0] === 'label' && args[1] === 'list') return '[]';
    if (args[0] === 'issue' && args[1] === 'create') {
      const at = (flag) => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : null; };
      const file = at('--body-file');
      bodies.push(file ? fs.readFileSync(file, 'utf8') : String(at('--body') ?? at('--description') ?? ''));
      next += 1;
      return `${REPO}/issues/${next}\n`;
    }
    return '';
  };
  return { exec, calls, bodies };
}

const SPLIT = {
  issues: [
    { title: 'Export the runs table', tasks: ['Add the CSV writer', 'Add the Export button'], complexity: 2, workflow: 'software-development.yaml' },
    { title: 'Document the export', tasks: ['Describe the CSV columns'], complexity: 1, workflow: 'software-development.yaml' },
  ],
};

// ---- A.1 / A.2 the bar --------------------------------------------------------------------------

test('A.1 the commit bar is 85', () => {
  assert.equal(load().COMMIT_BAR, 85);
});

test('A.2 checkCommit: a Ready card at 84% is refused with its gaps, at 85% it passes', () => {
  const { checkCommit } = load();
  const low = checkCommit({ id: 'c1', column: 'ready', clarity: { score: 84, gaps: ['Who reads the file', 'Which columns'] } });
  assert.deepEqual({ ok: low.ok, score: low.score, bar: low.bar, gaps: low.gaps }, { ok: false, score: 84, bar: 85, gaps: ['Who reads the file', 'Which columns'] });
  const at = checkCommit({ id: 'c2', column: 'ready', clarity: { score: 85, gaps: [] } });
  assert.deepEqual({ ok: at.ok, score: at.score, bar: at.bar }, { ok: true, score: 85, bar: 85 });
});

test('A.2 checkCommit: a card outside Ready, or never scored, is not committed', () => {
  const { checkCommit } = load();
  assert.equal(checkCommit({ id: 'c1', column: 'define', clarity: { score: 90, gaps: [] } }).ok, false);
  assert.equal(checkCommit({ id: 'c2', column: 'ready' }).ok, false);
  assert.equal(checkCommit({ id: 'c3', column: 'ready', clarity: { score: null, gaps: [] } }).ok, false);
});

// ---- A.3 commitCard -----------------------------------------------------------------------------

test('A.3 commitCard files each issue with "From discovery card <id>", the card\'s title and its tasks as checkboxes', async (t) => {
  const dir = tmp(t);
  const id = readyCard(dir);
  const gh = ghStub();
  const res = await load().commitCard({ dir, projectId: P, cardId: id, split: SPLIT, platform: 'github', repo: REPO, exec: gh.exec, by: 'tester' });
  const creates = gh.calls.filter((c) => c[1] === 'issue' && c[2] === 'create');
  assert.equal(creates.length, 2);
  assert.ok(creates.every((c) => c[0] === 'gh'));
  assert.ok(creates[0].includes('Export the runs table'));
  assert.ok(creates[1].includes('Document the export'));
  assert.equal(gh.bodies.length, 2);
  for (const body of gh.bodies) {
    assert.match(body, new RegExp(`^From discovery card ${id}\\s*$`, 'm'));
    assert.ok(body.includes('Export runs as CSV'), 'the body names the card');
  }
  assert.match(gh.bodies[0], /^- \[ \] Add the CSV writer\s*$/m);
  assert.match(gh.bodies[0], /^- \[ \] Add the Export button\s*$/m);
  assert.match(gh.bodies[1], /^- \[ \] Describe the CSV columns\s*$/m);
  assert.deepEqual(res.issues.map((i) => ({ number: i.number, url: i.url, title: i.title })), [
    { number: 101, url: `${REPO}/issues/101`, title: 'Export the runs table' },
    { number: 102, url: `${REPO}/issues/102`, title: 'Document the export' },
  ]);
});

test('A.3 commitCard records the issue numbers on the card and moves it off the board to committed', async (t) => {
  const dir = tmp(t);
  const id = readyCard(dir);
  const gh = ghStub();
  const res = await load().commitCard({ dir, projectId: P, cardId: id, split: SPLIT, platform: 'github', repo: REPO, exec: gh.exec, by: 'tester' });
  const card = discovery.readCard(dir, P, id);
  assert.deepEqual([...card.links.issues], [101, 102]);
  assert.equal(card.column, 'committed');
  assert.equal(res.card.column, 'committed');
  assert.deepEqual([...res.card.links.issues], [101, 102]);
  assert.deepEqual(discovery.listCards(dir, P, { column: 'ready' }).map((c) => c.id), []);
});

test('A.3 commitCard refuses a Ready card under 85% with its gaps, and files nothing', async (t) => {
  const dir = tmp(t);
  const id = readyCard(dir, { score: 84, gaps: ['Who reads the exported file', 'Which columns the file holds'] });
  const gh = ghStub();
  await assert.rejects(
    load().commitCard({ dir, projectId: P, cardId: id, split: SPLIT, platform: 'github', repo: REPO, exec: gh.exec, by: 'tester' }),
    (e) => {
      assert.ok(e.message.includes('85%'), e.message);
      assert.ok(e.message.includes('Who reads the exported file'), e.message);
      assert.ok(e.message.includes('Which columns the file holds'), e.message);
      return true;
    },
  );
  assert.deepEqual(gh.calls, []);
  const card = discovery.readCard(dir, P, id);
  assert.equal(card.column, 'ready');
  assert.deepEqual([...card.links.issues], []);
});

test('A.3 commitCard refuses a card outside Ready and a card already committed, and files nothing', async (t) => {
  const dir = tmp(t);
  const { commitCard } = load();
  const define = discovery.createCard(dir, P, { title: 'Not ready yet' });
  discovery.updateCard(dir, P, define.id, { clarity: { score: 90, gaps: [] } });
  discovery.moveCard(dir, P, define.id, 'define', { by: 'tester' });
  const gh = ghStub();
  await assert.rejects(commitCard({ dir, projectId: P, cardId: define.id, split: SPLIT, platform: 'github', repo: REPO, exec: gh.exec, by: 'tester' }));
  assert.deepEqual(gh.calls, []);

  const id = readyCard(dir);
  await commitCard({ dir, projectId: P, cardId: id, split: SPLIT, platform: 'github', repo: REPO, exec: ghStub().exec, by: 'tester' });
  const again = ghStub();
  await assert.rejects(commitCard({ dir, projectId: P, cardId: id, split: SPLIT, platform: 'github', repo: REPO, exec: again.exec, by: 'tester' }));
  assert.deepEqual(again.calls, []);
  assert.deepEqual([...discovery.readCard(dir, P, id).links.issues], [101, 102], 'the first commit\'s issues are kept');
});

test('A.3 commitCard refuses a split with no issues, and files nothing', async (t) => {
  const dir = tmp(t);
  const id = readyCard(dir);
  const gh = ghStub();
  const { commitCard } = load();
  await assert.rejects(commitCard({ dir, projectId: P, cardId: id, split: { issues: [] }, platform: 'github', repo: REPO, exec: gh.exec, by: 'tester' }));
  await assert.rejects(commitCard({ dir, projectId: P, cardId: id, split: {}, platform: 'github', repo: REPO, exec: gh.exec, by: 'tester' }));
  assert.deepEqual(gh.calls, []);
  assert.equal(discovery.readCard(dir, P, id).column, 'ready');
});

test('A.3 a split of one issue files one issue', async (t) => {
  const dir = tmp(t);
  const id = readyCard(dir);
  const gh = ghStub();
  const res = await load().commitCard({ dir, projectId: P, cardId: id, split: { issues: [SPLIT.issues[0]] }, platform: 'github', repo: REPO, exec: gh.exec, by: 'tester' });
  assert.deepEqual(res.issues.map((i) => i.number), [101]);
  assert.deepEqual([...discovery.readCard(dir, P, id).links.issues], [101]);
});

// ---- A.4 cardDelivery ---------------------------------------------------------------------------

const committed = (issues) => ({ id: 'c1', title: 'Export runs as CSV', column: 'committed', links: { issues, release: null } });
const pick = (d) => ({ stage: d.stage, counts: { ...d.counts }, issues: d.issues.map((i) => ({ number: i.number, column: i.column })) });

test('A.4 cardDelivery counts the card\'s issues only: in progress and waiting are running', () => {
  const backlog = [
    { number: 101, column: 'todo' },
    { number: 102, column: 'in_progress' },
    { number: 103, column: 'waiting' },
    { number: 104, column: 'local' },
    { number: 999, column: 'done' },
  ];
  assert.deepEqual(pick(load().cardDelivery(committed([101, 102, 103, 104]), backlog, [])), {
    stage: 'in_delivery',
    counts: { todo: 1, running: 2, local: 1, done: 0 },
    issues: [{ number: 101, column: 'todo' }, { number: 102, column: 'in_progress' }, { number: 103, column: 'waiting' }, { number: 104, column: 'local' }],
  });
});

test('A.4 cardDelivery: a linked issue missing from the backlog counts as to do', () => {
  assert.deepEqual(pick(load().cardDelivery(committed([101, 105]), [{ number: 101, column: 'done' }], [])), {
    stage: 'in_delivery',
    counts: { todo: 1, running: 0, local: 0, done: 1 },
    issues: [{ number: 101, column: 'done' }, { number: 105, column: 'todo' }],
  });
});

test('A.4 cardDelivery: all issues done is delivered; all in a shipped release is released', () => {
  const { cardDelivery } = load();
  const backlog = [{ number: 101, column: 'done' }, { number: 102, column: 'done' }];
  const card = committed([101, 102]);
  assert.deepEqual(pick(cardDelivery(card, backlog, [])), {
    stage: 'delivered',
    counts: { todo: 0, running: 0, local: 0, done: 2 },
    issues: [{ number: 101, column: 'done' }, { number: 102, column: 'done' }],
  });
  const one = [{ version: '1.2.0', status: 'shipped', issues: [{ number: 101 }] }];
  assert.equal(cardDelivery(card, backlog, one).stage, 'delivered', 'one issue still unreleased');
  const draft = [{ version: '1.3.0', status: 'draft', issues: [{ number: 101 }, { number: 102 }] }];
  assert.equal(cardDelivery(card, backlog, draft).stage, 'delivered', 'a release not shipped does not count');
  const both = [{ version: '1.2.0', status: 'shipped', issues: [{ number: 101 }] }, { version: '1.3.0', status: 'shipped', issues: [{ number: 102 }, { number: 7 }] }];
  assert.equal(cardDelivery(card, backlog, both).stage, 'released');
});

// ---- B. a committed card stays off the board ---------------------------------------------------

test('B. a committed card cannot be moved back to the board, even with force and a reason', async (t) => {
  const dir = tmp(t);
  const id = readyCard(dir);
  await load().commitCard({ dir, projectId: P, cardId: id, split: SPLIT, platform: 'github', repo: REPO, exec: ghStub().exec, by: 'tester' });
  for (const column of ['ready', 'shape', 'inbox']) {
    assert.throws(() => discovery.moveCard(dir, P, id, column, { by: 'tester' }), /committed/i, `to ${column}`);
    assert.throws(() => discovery.moveCard(dir, P, id, column, { by: 'tester', force: true, reason: 'Changed my mind' }), /committed/i, `to ${column} with force`);
  }
  assert.equal(discovery.readCard(dir, P, id).column, 'committed');
});

test('B. new learning is a new Inbox card linked to the committed card (links.from)', async (t) => {
  const dir = tmp(t);
  const id = readyCard(dir);
  await load().commitCard({ dir, projectId: P, cardId: id, split: SPLIT, platform: 'github', repo: REPO, exec: ghStub().exec, by: 'tester' });
  const learned = discovery.createCard(dir, P, { title: 'Export also the costs', text: 'Learned from the CSV export.', from: id });
  assert.notEqual(learned.id, id);
  assert.equal(learned.column, 'inbox');
  assert.equal(learned.links.from, id);
  assert.equal(discovery.readCard(dir, P, learned.id).links.from, id);
  assert.equal(discovery.readCard(dir, P, id).column, 'committed', 'the committed card stays committed');
});
