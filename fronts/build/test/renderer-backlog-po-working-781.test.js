// #781: the Product Owner's working line says what it does (fronts/build/views/backlog/backlog-po.js). Acceptance
// tests, written before the code, on the whole page through backlog-po-785-harness.js (askProductOwner never
// resolves by default). The Oracle's and the Supervisor's working lines are not touched (agent-chat.js is shared).
//
// The contract these tests assume: #po-working (po-working), while the PO works, holds an ActivityLine
// (packages/ui-kit/activity-line.js) data-state="running", no .spinner; its text names the action: at the start
// "Reading N open issues" (N: the open issues of BacklogActions.data()), then the live turn's current step when
// progress arrives (chat:progress { chat: 'po', key, turnId, phase, items }, packages/ui-kit/live-turn.js); the
// elapsed time stays in .activity-line-meta. When it ends the line is hidden as today.
const test = require('node:test');
const assert = require('node:assert/strict');
const { openDrawer, send, isHidden, settle, textOf, plain } = require('./backlog-po-785-harness');

const issue = (number, state) => ({ number, state, title: `Issue ${number}`, url: `https://example.test/${number}`, labels: [], body: '' });
const ISSUES = [issue(1, 'open'), issue(2, 'open'), issue(3, 'open'), issue(4, 'closed')];

// the drawer on three open issues and a closed one, a question sent
async function working(opts) {
  const page = await openDrawer(opts);
  page.sandbox.BacklogActions.data = () => ({ projectId: 'demo', issues: plain(ISSUES) });
  await send(page, 'What next?');
  return page;
}

const box = (page) => page.$('#po-working');
const line = (page) => box(page)?.querySelector('.activity-line') ?? null;
const meta = (page) => box(page)?.querySelector('.activity-line-meta') ?? null;

// a chat:progress event of the PO's turn on project "demo"
async function progress(page, event) {
  for (const fn of page.handlers.onChatProgress || []) fn({ chat: 'po', key: 'demo', turnId: 't1', ...event });
  await settle(10);
}

test('#781 while the PO works, #po-working holds a running ActivityLine and no spinner', { timeout: 20000 }, async () => {
  const page = await working();
  assert.equal(isHidden(box(page)), false, 'the line shows');
  assert.equal(line(page) === null, false, 'an ActivityLine');
  assert.equal(line(page)?.getAttribute('data-state'), 'running');
  assert.equal(box(page).querySelector('.spinner') === null, true, 'no .spinner');
});

test('#781 at the start the line says "Reading N open issues", the closed ones left out', { timeout: 20000 }, async () => {
  const page = await working();
  assert.equal(textOf(line(page)).includes('Reading 3 open issues'), true, textOf(box(page)));
});

test('#781 when progress arrives the line says the live turn\'s current step', { timeout: 20000 }, async () => {
  const page = await working();
  await progress(page, { phase: 'start' });
  await progress(page, { phase: 'items', items: [{ kind: 'tool_call', id: 'c1', name: 'Read', input: { file_path: 'src/notes/index.js' } }] });
  assert.equal(textOf(line(page)).includes('Reading src/notes/index.js'), true, textOf(box(page)));
  assert.equal(textOf(line(page)).includes('Reading 3 open issues'), false, textOf(box(page)));
});

test('#781 the elapsed time stays in .activity-line-meta', { timeout: 20000 }, async () => {
  const page = await working();
  assert.match(textOf(meta(page)), /^\d+:\d\d$/);
});

test('#781 the line keeps the elapsed time once progress arrives', { timeout: 20000 }, async () => {
  const page = await working();
  await progress(page, { phase: 'start' });
  await progress(page, { phase: 'items', items: [{ kind: 'tool_call', id: 'c1', name: 'Read', input: { file_path: 'src/notes/index.js' } }] });
  assert.match(textOf(meta(page)), /^\d+:\d\d$/);
});

test('#781 when the answer lands the line is hidden', { timeout: 20000 }, async () => {
  let answer;
  const turn = new Promise((resolve) => { answer = resolve; });
  const page = await working({ api: { askProductOwner: () => turn } });
  assert.equal(isHidden(box(page)), false, 'it shows while the PO works');
  answer({ messages: [{ role: 'user', text: 'What next?', ts: '2026-11-05T10:00:00.000Z' }, { role: 'po', text: 'The plan.', ts: '2026-11-05T10:00:30.000Z', costUsd: 0 }] });
  await settle(30);
  assert.equal(isHidden(box(page)), true);
});
