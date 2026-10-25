// #258 Commit a discovery card: the internals the acceptance tests (test/discovery-commit-258.test.js)
// leave out. src/domains/discovery/discovery-commit.js: the proposal by the rules (proposeSplit), a model's proposal
// kept to the card (normalizeSplit), the owner's split checked (checkSplit), a filing that fails
// half-way (commitCard), the simulated CLI (simulatedExec) and a released card's delivery.
// src/domains/discovery/discovery.js: the issues' cards (issueCards), and a committed card that is neither merged nor
// brought back to the board by a restore.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { layout } = require('../../src/workspace');
const discovery = require('../../src/domains/discovery/discovery');
const commits = require('../../src/domains/discovery/discovery-commit');

const P = 'p1';
const REPO = 'https://github.com/o/r';

function tmp(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'discovery-commit-int-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return layout(root);
}

function readyCard(dir, { title = 'Export runs as CSV', acceptance = '', score = 90 } = {}) {
  const card = discovery.createCard(dir, P, { title, text: '# Export\n\nThe runs table cannot be exported.' });
  discovery.updateCard(dir, P, card.id, { acceptance, clarity: { score, gaps: [] } });
  discovery.moveCard(dir, P, card.id, 'ready', { by: 'tester' });
  return card.id;
}

const tasks = (n) => Array.from({ length: n }, (_, i) => `Task ${i + 1}`);
const checklist = (list) => list.map((t) => `- [ ] ${t}`).join('\n');

test('proposeSplit: a few acceptance criteria become one issue with every task and the default workflow', () => {
  const card = { id: 'c1', title: 'Export runs as CSV', acceptance: checklist(['Add the CSV writer', 'Add the Export button']) };
  assert.deepEqual(commits.proposeSplit(card, { workflow: 'software-development.yaml' }), {
    issues: [{ title: 'Export runs as CSV', tasks: ['Add the CSV writer', 'Add the Export button'], complexity: 1, workflow: 'software-development.yaml', reason: '' }],
  });
});

test('proposeSplit: plain list items count as tasks; a card without criteria still gets one task', () => {
  assert.deepEqual(commits.cardTasks({ acceptance: '1. First\n2) Second\n* Third\n\nA paragraph.' }), ['First', 'Second', 'Third']);
  const none = commits.proposeSplit({ id: 'c1', title: 'Export runs as CSV', acceptance: '' });
  assert.equal(none.issues.length, 1);
  assert.equal(none.issues[0].tasks.length, 1);
});

test('proposeSplit: more tasks than one run takes are split into two to four issues, every task in exactly one', () => {
  const all = tasks(11);
  const { issues } = commits.proposeSplit({ id: 'c1', title: 'A big card', acceptance: checklist(all) });
  assert.ok(issues.length >= 2 && issues.length <= 4, `${issues.length} issues`);
  assert.deepEqual(issues.flatMap((i) => i.tasks), all);
  assert.ok(issues.every((i) => i.title && i.complexity >= 1 && i.complexity <= 5));
});

test('proposeSplit: criteria written in parts under headings become one issue per part', () => {
  const acceptance = ['## Budget', '- [ ] A daily budget per project', '- [ ] No new run past the budget', '', '## Reporting', '- [ ] Usage shows the spend', '- [ ] A notice at 80%'].join('\n');
  const { issues } = commits.proposeSplit({ id: 'c1', title: 'Per-project budget', acceptance });
  assert.deepEqual(issues.map((i) => [i.title, i.tasks]), [
    ['Per-project budget: Budget', ['A daily budget per project', 'No new run past the budget']],
    ['Per-project budget: Reporting', ['Usage shows the spend', 'A notice at 80%']],
  ]);
});

test('normalizeSplit: a model\'s proposal keeps only the card\'s tasks, each once; the ones it forgot join the last issue', () => {
  const card = { id: 'c1', title: 'Export', acceptance: checklist(['Writer', 'Button', 'Docs']) };
  const raw = {
    issues: [
      { title: 'Export the table', tasks: ['- [ ] Writer', 'Invented task'], complexity: 9, workflow: 'unknown.yaml' },
      { title: 'Second', tasks: ['writer', 'Button'], complexity: 2, workflow: 'local.yaml', reason: 'Ships on its own.' },
      { title: '', tasks: ['Docs'] },
    ],
  };
  assert.deepEqual(commits.normalizeSplit(raw, card, { workflow: 'software-development.yaml', workflows: ['software-development.yaml', 'local.yaml'] }), {
    issues: [
      { title: 'Export the table', tasks: ['Writer'], complexity: 1, workflow: 'software-development.yaml', reason: '' },
      { title: 'Second', tasks: ['Button', 'Docs'], complexity: 2, workflow: 'local.yaml', reason: 'Ships on its own.' },
    ],
  });
});

test('normalizeSplit: an unusable proposal falls back to the rules', () => {
  const card = { id: 'c1', title: 'Export', acceptance: checklist(['Writer']) };
  for (const raw of [null, {}, { issues: [] }, { issues: [{ title: 'No task of the card', tasks: ['Else'] }] }]) {
    assert.deepEqual(commits.normalizeSplit(raw, card, { workflow: 'w.yaml' }), commits.proposeSplit(card, { workflow: 'w.yaml' }));
  }
});

test('checkSplit: cleans the owner\'s split and refuses an issue without a title or without a task', () => {
  assert.deepEqual(commits.checkSplit({ issues: [{ title: '  Export  the table ', tasks: [' Writer ', ''], complexity: '3', workflow: 'C:/x/local.yaml' }] }),
    [{ title: 'Export the table', tasks: ['Writer'], complexity: 3, workflow: 'local.yaml' }]);
  assert.throws(() => commits.checkSplit({ issues: [{ title: '', tasks: ['Writer'] }] }), /title/);
  assert.throws(() => commits.checkSplit({ issues: [{ title: 'Export', tasks: [] }] }), /task/);
  assert.throws(() => commits.checkSplit({ issues: Array.from({ length: 9 }, (_, i) => ({ title: `I${i}`, tasks: ['t'] })) }), /at most 8/);
});

test('commitCard: an issue\'s body has the card\'s document as evidence, and the later issues name the earlier ones', async (t) => {
  const ws = tmp(t);
  const id = readyCard(ws.discovery);
  const bodies = [];
  let next = 100;
  const exec = async (_cli, args) => {
    if (args[0] === 'label') return JSON.stringify([{ name: 'enhancement' }]);
    bodies.push(fs.readFileSync(args[args.indexOf('--body-file') + 1], 'utf8'));
    assert.deepEqual(args.filter((a, i) => args[i - 1] === '--label'), ['enhancement'], 'only the labels the repository has');
    next += 1;
    return `${REPO}/issues/${next}\n`;
  };
  const split = { issues: [{ title: 'One', tasks: ['A'], complexity: 2 }, { title: 'Two', tasks: ['B'], complexity: 1 }] };
  const res = await commits.commitCard({ dir: ws.discovery, projectId: P, cardId: id, split, platform: 'github', repo: REPO, exec, by: 'tester' });
  assert.match(bodies[0], /## From the card\n\n## Export\n\nThe runs table cannot be exported\./);
  assert.match(bodies[0], /part 1 of 2/);
  assert.doesNotMatch(bodies[0], /^Related:/m);
  assert.match(bodies[1], /^Related: #101 \(same discovery card\)\.$/m);
  assert.deepEqual(res.skippedLabels, ['complexity:2', 'complexity:1']);
  // the text of each issue is kept with the card, and the thread notes the commit
  assert.equal(fs.readdirSync(discovery.filedDir(ws.discovery, P, id)).length, 2);
  const last = discovery.readConversation(ws.discovery, P, id).at(-1);
  assert.equal(last.kind, 'commit');
  assert.deepEqual(last.issues, [101, 102]);
  assert.deepEqual(discovery.readCard(ws.discovery, P, id).history.at(-1).to, 'committed');
});

test('commitCard: a filing that fails after the first issue commits the card with what was filed; a first failure commits nothing', async (t) => {
  const ws = tmp(t);
  const split = { issues: [{ title: 'One', tasks: ['A'] }, { title: 'Two', tasks: ['B'] }, { title: 'Three', tasks: ['C'] }] };
  const failingFrom = (n) => {
    let calls = 0;
    return async (_cli, args) => {
      if (args[0] === 'label') return '[]';
      calls += 1;
      if (calls >= n) throw new Error('gh: network down');
      return `${REPO}/issues/${100 + calls}\n`;
    };
  };
  const first = readyCard(ws.discovery, { title: 'Fails at once' });
  await assert.rejects(commits.commitCard({ dir: ws.discovery, projectId: P, cardId: first, split, platform: 'github', repo: REPO, exec: failingFrom(1) }), /network down/);
  assert.equal(discovery.readCard(ws.discovery, P, first).column, 'ready');

  const second = readyCard(ws.discovery, { title: 'Fails half-way' });
  const res = await commits.commitCard({ dir: ws.discovery, projectId: P, cardId: second, split, platform: 'github', repo: REPO, exec: failingFrom(2) });
  assert.deepEqual(res.issues.map((i) => i.number), [101]);
  assert.deepEqual(res.failed.map((f) => f.title), ['Two', 'Three']);
  assert.match(res.failed[0].error, /network down/);
  const card = discovery.readCard(ws.discovery, P, second);
  assert.equal(card.column, 'committed');
  assert.deepEqual(card.links.issues, [101]);
});

test('commitCard: when the second of three filings fails, the third is not tried and the card\'s thread names the issues left', async (t) => {
  const ws = tmp(t);
  const id = readyCard(ws.discovery, { title: 'Fails at the second' });
  const titles = [];
  const exec = async (_cli, args) => {
    if (args[0] === 'label') return '[]';
    titles.push(args[args.indexOf('--title') + 1]);
    if (titles.length === 2) throw new Error('gh: rate limited');
    return `${REPO}/issues/201\n`;
  };
  const split = { issues: [{ title: 'One', tasks: ['A'] }, { title: 'Two', tasks: ['B'] }, { title: 'Three', tasks: ['C'] }] };
  const res = await commits.commitCard({ dir: ws.discovery, projectId: P, cardId: id, split, platform: 'github', repo: REPO, exec, by: 'tester' });
  assert.deepEqual(titles, ['One', 'Two'], 'nothing is filed after a failure');
  assert.deepEqual(res.failed.map((f) => f.title), ['Two', 'Three']);
  assert.match(res.failed[0].error, /rate limited/);
  assert.match(res.failed[1].error, /an issue before it failed/);
  const card = discovery.readCard(ws.discovery, P, id);
  assert.equal(card.column, 'committed');
  assert.deepEqual(card.links.issues, [201]);
  const note = discovery.readConversation(ws.discovery, P, id).at(-1);
  assert.equal(note.kind, 'commit');
  assert.deepEqual(note.issues, [201]);
  assert.match(note.text, /#201 One/);
  assert.match(note.text, /Not filed: Two; Three\./);
});

test('simulatedExec: an issue create joins the synced backlog with the next free number, and nothing else is run', async (t) => {
  const ws = tmp(t);
  fs.mkdirSync(ws.backlog, { recursive: true });
  const cache = path.join(ws.backlog, `${P}.json`);
  fs.writeFileSync(cache, JSON.stringify({ projectId: P, platform: 'github', repo: `${REPO}.git`, issues: [{ number: 41, title: 'Old', state: 'open' }] }));
  const id = readyCard(ws.discovery);
  const exec = commits.simulatedExec({ backlogDir: ws.backlog, projectId: P, platform: 'github', repo: REPO });
  const res = await commits.commitCard({ dir: ws.discovery, projectId: P, cardId: id, split: { issues: [{ title: 'One', tasks: ['A'] }, { title: 'Two', tasks: ['B'] }] }, platform: 'github', repo: REPO, exec });
  assert.deepEqual(res.issues.map((i) => [i.number, i.url]), [[42, `${REPO}/issues/42`], [43, `${REPO}/issues/43`]]);
  const { issues } = JSON.parse(fs.readFileSync(cache, 'utf8'));
  assert.deepEqual(issues.map((i) => i.number), [43, 42, 41]);
  assert.equal(issues[1].state, 'open');
  assert.match(issues[1].body, new RegExp(`^From discovery card ${id}$`, 'm'));
  assert.deepEqual(issues[1].tasks, { done: 0, total: 1 });
  assert.equal(await exec('gh', ['issue', 'close', '42']), '');
  // the simulated repository has the labels a commit uses: none is reported as left out
  assert.deepEqual(issues[1].labels.map((l) => l.name), ['enhancement', 'complexity:1']);
  assert.equal(res.skippedLabels, undefined);
});

test('commitCard preview: the same checks, then the commands it would run; nothing is filed or committed', async (t) => {
  const ws = tmp(t);
  const id = readyCard(ws.discovery);
  const exec = async () => { throw new Error('the CLI must not be called'); };
  const split = { issues: [{ title: 'One', tasks: ['A'] }, { title: 'Two', tasks: ['B'] }] };
  const res = await commits.commitCard({ dir: ws.discovery, projectId: P, cardId: id, split, platform: 'github', repo: REPO, exec, preview: true });
  assert.equal(res.preview, true);
  assert.deepEqual(res.issues, []);
  assert.equal(res.commands.length, 2);
  assert.match(res.commands[0], /^gh issue create --repo o\/r --title One --body-file /);
  assert.equal(discovery.readCard(ws.discovery, P, id).column, 'ready');
  assert.equal(fs.existsSync(discovery.filedDir(ws.discovery, P, id)), false);
  await assert.rejects(commits.commitCard({ dir: ws.discovery, projectId: P, cardId: id, split: { issues: [] }, platform: 'github', repo: REPO, exec, preview: true }), /Nothing to file/);
});

test('the store: a committed card is kept as it was committed; only its release is still written', (t) => {
  const ws = tmp(t);
  const dir = ws.discovery;
  const id = readyCard(dir);
  discovery.markCommitted(dir, P, id, { issues: [7, 8], by: 'tester' });
  const kept = /kept as it was committed/;
  assert.throws(() => discovery.updateCard(dir, P, id, { document: 'Rewritten' }), kept);
  assert.throws(() => discovery.updateCard(dir, P, id, { links: { issues: [] } }), kept);
  assert.throws(() => discovery.updateCard(dir, P, id, { links: { release: 'v1' }, title: 'Renamed' }), kept);
  assert.throws(() => discovery.addAttachment(dir, P, id, { name: 'a.txt', data: Buffer.from('x') }), kept);
  assert.throws(() => discovery.recordResult(dir, P, id, { source: 'write-review', text: 'A new document' }), kept);
  assert.throws(() => discovery.grillCard(dir, P, id), kept);
  assert.equal(discovery.updateCard(dir, P, id, { links: { release: 'v1' } }).links.release, 'v1');
  const card = discovery.readCard(dir, P, id);
  assert.deepEqual(card.links.issues, [7, 8]);
  assert.match(card.document, /cannot be exported/);
  // its thread still takes notes (the commit's own, a remark on the delivery)
  discovery.appendConversation(dir, P, id, { kind: 'note', author: 'tester', text: 'Shipped on Friday.' });
});

test('Grill me: a Ready card at its own lower bar is interviewed up to the commit bar', (t) => {
  const ws = tmp(t);
  const dir = ws.discovery;
  discovery.setClarityBar(dir, P, { byKind: { hotfix: 60 } });
  const card = discovery.createCard(dir, P, { title: 'Login loop after the token refresh', type: 'hotfix', text: 'The phone page asks to log in again.' });
  discovery.updateCard(dir, P, card.id, { clarity: { score: 70, gaps: ['Steps to reproduce'] } });
  discovery.moveCard(dir, P, card.id, 'define', { by: 'tester' });
  assert.equal(discovery.grillCard(dir, P, card.id).bar, 60, 'outside Ready: the bar of its type');
  discovery.moveCard(dir, P, card.id, 'ready', { by: 'tester' });
  assert.equal(discovery.readCard(dir, P, card.id).column, 'ready', 'it passed its own bar');
  assert.equal(discovery.grillCard(dir, P, card.id).bar, discovery.COMMIT_BAR);
  assert.equal(commits.COMMIT_BAR, discovery.COMMIT_BAR);
});

test('cardDelivery: a released card names the release of its last issue; a card without issues is in delivery', () => {
  const card = { links: { issues: [1, 2] } };
  const d = commits.cardDelivery(card, [{ number: 1, column: 'done', title: 'One', url: 'u1' }, { number: 2, column: 'done' }],
    [{ version: 'v1', status: 'shipped', issues: [{ number: 1 }] }, { version: 'v2', status: 'shipped', issues: [{ number: 2 }] }]);
  assert.equal(d.stage, 'released');
  assert.equal(d.release, 'v2');
  // whatever the order of the card's issues: the release that completed it
  assert.equal(commits.cardDelivery({ links: { issues: [2, 1] } }, [], [{ version: 'v1', status: 'shipped', issues: [{ number: 1 }] }, { version: 'v2', status: 'shipped', issues: [{ number: 2 }] }]).release, 'v2');
  assert.deepEqual(d.issues.map((i) => i.release), ['v1', 'v2']);
  assert.deepEqual({ title: d.issues[0].title, url: d.issues[0].url }, { title: 'One', url: 'u1' });
  assert.equal(commits.cardDelivery({ links: { issues: [] } }, [], []).stage, 'in_delivery');
  // an issue the backlog only knows by its state (no runs linked yet)
  assert.deepEqual(commits.cardDelivery({ links: { issues: [3] } }, [{ number: 3, state: 'closed' }], []).counts, { todo: 0, running: 0, local: 0, done: 1 });
});

test('the store: issueCards maps each filed issue to its card; a committed card is neither merged nor restored to the board', (t) => {
  const ws = tmp(t);
  const dir = ws.discovery;
  assert.equal(discovery.issueCards(dir, P).size, 0);
  assert.equal(discovery.issueCards(dir, '../../x').size, 0);
  const id = readyCard(dir);
  assert.throws(() => discovery.markCommitted(dir, P, id, { issues: [] }), /issues filed/);
  discovery.markCommitted(dir, P, id, { issues: [7, 8], by: 'tester' });
  assert.throws(() => discovery.markCommitted(dir, P, id, { issues: [9] }), /already committed/);
  assert.deepEqual([...discovery.issueCards(dir, P)], [[7, { id, title: 'Export runs as CSV' }], [8, { id, title: 'Export runs as CSV' }]]);
  assert.deepEqual(Object.values(discovery.readBoard(dir, P).order).flat(), [], 'the card is in no column');

  const other = discovery.createCard(dir, P, { title: 'Another idea' });
  assert.throws(() => discovery.mergeCard(dir, P, other.id, id), /committed/i);
  assert.throws(() => discovery.mergeCard(dir, P, id, other.id), /committed/i);
  assert.throws(() => discovery.createCard(dir, P, { title: 'Learned', from: '20200101-ffff' }), /not found/i);

  discovery.archiveCard(dir, P, id, { reason: 'test' });
  const back = discovery.restoreCard(dir, P, id);
  assert.equal(back.column, 'committed');
  assert.deepEqual(Object.values(discovery.readBoard(dir, P).order).flat().includes(id), false);
});
