// #409: the expanded card of a run in the runs list (src/renderer/run-list.js, shared by Workflows ›
// Runs and Projects) has two actions only, "◆ Send to supervisor" and "Open run" (last), with "Resume
// from step…" before them on a resumable run; the run id stays at the left of the row. Open run opens
// the Run screen (Details) even when the remembered run view is the chat. Send to supervisor opens the
// Supervisor's chat (window.openSupervisorChat, views/supervisor/supervisor.js) with the run attached
// and sends nothing; while the Supervisor answers, the button is disabled ("Supervisor is answering…").
// Acceptance tests, written before the code, through the whole page (test/agent-chat-page-harness.js)
// with the page global renderRunList, as test/renderer-run-card-289.test.js does.
//
// Seams: the card's [data-testid="run-id"] (the action row is its nearest ancestor holding buttons,
// outside the sessions table and the Artifacts / Repository columns); the buttons by their text; the
// page globals openRunChat / openPastRun (stubbed to record), state.runView; the Supervisor drawer
// (#svc-drawer, its chat's agent-chat-input / agent-chat-send), the run's own supervisor drawer
// (#sup-drawer, must stay closed); the fake api records every call (no ask* call = no model call).
const test = require('node:test');
const assert = require('node:assert/strict');
const { textOf } = require('./mini-dom');
const { loadPage, settle, deferred, part } = require('./agent-chat-page-harness');

const RUN_ID = 'run-20261015-409card';
const base = (extra = {}) => ({
  runId: RUN_ID, status: 'success', workflow: 'software-development', task: 'Fix the widget', startedAt: '2026-10-15T10:00:00Z', durationMs: 60000,
  artifactCount: 0, issues: [{ number: 409, title: 'Run card actions' }],
  sessions: [{ id: 's1', agent: 'developer', provider: 'claude-code', model: 'claude-sonnet-5', status: 'success', turns: 2 }],
  ...extra,
});
// not resumable (canResume: the run of this window), finished
const FINISHED_HERE = base({ current: true });
// resumable: failed, not this window's
const FAILED = base({ status: 'failed', error: 'The developer step failed: tests are red.' });

/** The page with `runs` in a list box, `expanded` (run ids) open; `api` overrides the fake api. */
async function cardPage({ runs = [FINISHED_HERE], expanded = [RUN_ID], api = {} } = {}) {
  const page = await loadPage({ api: { listArtifacts: async () => [{ artifacts: [] }], runDiff: async () => ({ simulated: true, unavailable: null, base: null, commits: [], commit: null, files: [] }), runDiffFile: async () => ({}), ...api } });
  page.run("document.body.insertAdjacentHTML('beforeend', '<div id=\"box\"></div>')");
  page.sandbox.__runs = runs;
  page.sandbox.__expanded = expanded;
  page.run("__rl = { runs: __runs, expanded: new Set(__expanded), arts: new Map(), msgs: new Map() }; __opts = { prefix: 'project', box: '#box', empty: 'No runs yet', start() {}, rerender: () => renderRunList(__rl, __opts), reload() {}, loadMore() {} }; renderRunList(__rl, __opts)");
  await settle();
  return page;
}

const OUTSIDE_ROW = '.pr-sessions, table, [data-testid="run-card-artifacts"], [data-testid="run-card-repository"]';

/** The expanded card's action row of `runId`: the nearest ancestor of its run id that holds buttons. */
function actionRow(page, runId = RUN_ID) {
  const card = page.$(`#box [data-testid="run-list-row"][data-run="${runId}"] .pr-body`);
  assert.ok(!!card, `the card of ${runId} is expanded`);
  const id = card.querySelector('[data-testid="run-id"]');
  assert.ok(!!id, 'the card shows its run id ([data-testid="run-id"])');
  let row = id.parentElement;
  while (row && row !== card && !row.querySelectorAll('button').some((b) => !b.closest(OUTSIDE_ROW))) row = row.parentElement;
  assert.ok(!!row, 'a row with buttons holds the run id');
  return { row, id };
}
const rowButtons = (row) => row.querySelectorAll('button').filter((b) => !b.closest(OUTSIDE_ROW));
const label = (b) => textOf(b).replace(/\s+/g, ' ').trim();
const labels = (row) => rowButtons(row).map(label);
const find = (row, re) => rowButtons(row).find((b) => re.test(label(b)));
const sendButton = (page, runId) => find(actionRow(page, runId).row, /Send to supervisor|Supervisor is answering/);
const openRunButton = (page, runId) => find(actionRow(page, runId).row, /^Open run$/);
const REMOVED = [/Open logs/, /Ask the supervisor/, /Watch with the supervisor/, /Open chat/, /View run/, /Open in Analytics/];
const askCalls = (page) => page.calls.filter(([name]) => /^ask/i.test(name)).map(([name]) => name);

// ---- the action row ------------------------------------------------------------------------------------

test('#409 a non-resumable run\'s card has exactly "◆ Send to supervisor" then "Open run", none of the removed actions, its run id at the left', async () => {
  // a finished run of this window, and a running one (it had "Watch with the supervisor")
  for (const run of [FINISHED_HERE, base({ status: 'running', current: true, durationMs: undefined })]) {
    const page = await cardPage({ runs: [run] });
    const { row, id } = actionRow(page);
    const names = labels(row);
    assert.equal(names.length, 2, `two buttons for a ${run.status} run: ${names.join(' | ')}`);
    assert.match(names[0], /^◆\s*Send to supervisor$/);
    assert.equal(names[1], 'Open run');
    const rowText = textOf(row);
    for (const re of REMOVED) assert.doesNotMatch(rowText, re);
    assert.equal(textOf(id).trim(), RUN_ID);
    const order = row.querySelectorAll('*');
    assert.ok(order.indexOf(id) < order.indexOf(rowButtons(row)[0]), 'the run id comes before the buttons (at the left)');
  }
});

test('#409 a resumable run\'s card has "Resume from step…" before "Send to supervisor" and "Open run"', async () => {
  const page = await cardPage({ runs: [FAILED] });
  const names = labels(actionRow(page).row);
  assert.equal(names.length, 3, names.join(' | '));
  assert.match(names[0], /^Resume from step…$/);
  assert.match(names[1], /Send to supervisor$/);
  assert.equal(names[2], 'Open run');
});

test('#409 a child run\'s card has the same two actions', async () => {
  const parent = base({ runId: 'run-parent-409', current: true, childRuns: [{ run_id: RUN_ID, status: 'success' }] });
  const child = { ...FINISHED_HERE, parentRun: { run_id: 'run-parent-409', workflow: 'software-development', step_id: 'child', index: 0 } };
  const page = await cardPage({ runs: [parent, child], expanded: [RUN_ID] });
  assert.ok(page.$(`#box [data-run="${RUN_ID}"].pr-child`) !== null,'the child is nested under its parent');
  const names = labels(actionRow(page).row);
  assert.equal(names.length, 2, names.join(' | '));
  assert.match(names[0], /Send to supervisor$/);
  assert.equal(names[1], 'Open run');
});

// ---- Open run ------------------------------------------------------------------------------------------

test('#409 "Open run" opens the run on the Run screen (Details) even when the remembered run view is the chat', async () => {
  const page = await cardPage();
  page.run("setRunView('chat')");
  assert.equal(page.run('state.runView'), 'chat');
  const chats = [];
  const past = [];
  page.sandbox.openRunChat = (a) => chats.push(a?.runId);
  // a run this window does not follow opens from its recorded events (app.js openPastRun)
  page.sandbox.openPastRun = (runId) => past.push(runId);
  const btn = openRunButton(page);
  assert.ok(!!btn,'an "Open run" button');
  btn.click();
  await settle();
  assert.deepEqual(chats, [], 'the run chat was not opened');
  assert.ok(past.includes(RUN_ID) || page.run('state.view') === 'run', `the Run screen opened on ${RUN_ID} (openPastRun: ${past.join(', ') || 'none'}, view: ${page.run('state.view')})`);
});

// ---- Send to supervisor --------------------------------------------------------------------------------

test('#409 "Send to supervisor" opens the Supervisor\'s chat with the run attached, sends nothing, and leaves the run\'s supervisor drawer closed', async () => {
  const page = await cardPage({ runs: [FAILED] });
  const btn = sendButton(page);
  assert.ok(!!btn,'a "Send to supervisor" button');
  btn.click();
  await settle();
  assert.equal(page.$('#svc-drawer').classList.contains('open'), true, 'the Supervisor\'s chat drawer is open');
  assert.equal(page.$('#sup-drawer')?.classList.contains('open') ?? false, false, 'not the run\'s supervisor drawer (openSupervisor)');
  assert.ok(textOf(page.$('#svc-drawer')).includes(RUN_ID), 'the drawer shows the attached run (its id)');
  assert.ok(!textOf(page.$('#svc-screen')).includes(RUN_ID), 'as an attachment, not as the screen line');
  assert.deepEqual(askCalls(page), [], 'nothing was sent to a model');
});

test('#409 the attached run goes with the question once the person writes and sends it', async () => {
  const asked = deferred();
  const page = await cardPage({ runs: [FAILED], api: { askSupervisorChat: () => asked.promise } });
  const btn = sendButton(page);
  assert.ok(!!btn,'a "Send to supervisor" button');
  btn.click();
  await settle();
  assert.deepEqual(askCalls(page), [], 'nothing sent before the person sends');
  page.dom.type(part(page, '#svc-drawer', 'agent-chat-input'), 'Why did it fail?');
  part(page, '#svc-drawer', 'agent-chat-send').click();
  await settle();
  const sent = page.callsTo('askSupervisorChat');
  assert.equal(sent.length, 1, 'one question sent');
  const payload = JSON.stringify(sent[0]);
  assert.ok(payload.includes('Why did it fail?'));
  assert.ok(payload.includes(RUN_ID), 'the run id goes with it');
  assert.ok(payload.includes('software-development'), 'its workflow');
  assert.ok(payload.includes('failed'), 'its status');
});

test('#409 while the Supervisor is answering, the card\'s button is disabled and says "Supervisor is answering…", then comes back', async () => {
  const asked = deferred();
  const page = await cardPage({ runs: [FAILED], api: { askSupervisorChat: () => asked.promise } });
  assert.ok(!!sendButton(page), 'a "Send to supervisor" button');
  assert.equal(sendButton(page).disabled, false, 'enabled while the Supervisor is idle');
  page.sandbox.openSupervisorChat();
  await settle();
  page.dom.type(part(page, '#svc-drawer', 'agent-chat-input'), 'Which runs failed recently?');
  part(page, '#svc-drawer', 'agent-chat-send').click();
  await settle();
  const busy = sendButton(page);
  assert.ok(!!busy, 'the button is still on the card');
  assert.equal(busy.disabled, true, 'disabled while the Supervisor answers');
  assert.match(`${label(busy)} ${busy.getAttribute('title') || ''}`, /Supervisor is answering…/);
  asked.resolve({ messages: [{ role: 'user', text: 'Which runs failed recently?', ts: '2026-10-15T10:00:00Z' }, { role: 'assistant', text: 'None.', ts: '2026-10-15T10:00:05Z' }] });
  await settle();
  const idle = sendButton(page);
  assert.equal(idle.disabled, false, 'enabled again once the answer lands');
  assert.match(label(idle), /Send to supervisor$/);
});
