// #409: the Supervisor's chat (src/renderer/views/supervisor/supervisor.js) takes a run as context:
// window.openSupervisorChat({ run: { runId, workflow, status, error, issues } }) opens the drawer with
// the run attached (shown in the drawer, removable like the Product Owner's attached issues) and calls
// no model until the person writes and sends. Acceptance tests, written before the code, through the
// whole page (test/agent-chat-page-harness.js).
//
// Assumed signature: openSupervisorChat({ run }) with the fields the run card passed to openSupervisor
// (run-list.js); openSupervisorChat() with no argument keeps opening the plain chat (a guard, green
// today).
const test = require('node:test');
const assert = require('node:assert/strict');
const { textOf } = require('./mini-dom');
const { loadPage, settle } = require('./agent-chat-page-harness');

const RUN = { runId: 'run-20261015-409attach', workflow: 'software-development', status: 'failed', error: 'Tests are red.', mock: true, issues: [{ number: 409, title: 'Run card actions' }] };
const askCalls = (page) => page.calls.filter(([name]) => /^ask/i.test(name)).map(([name]) => name);

test('#409 openSupervisorChat({ run }) opens the drawer with the run attached (its id shown) and calls no model', async () => {
  const page = await loadPage();
  page.sandbox.__run = RUN;
  page.run('window.openSupervisorChat({ run: __run })');
  await settle();
  assert.equal(page.$('#svc-drawer').classList.contains('open'), true, 'the drawer is open');
  assert.ok(textOf(page.$('#svc-drawer')).includes(RUN.runId), 'the drawer shows the attached run');
  assert.ok(!textOf(page.$('#svc-screen')).includes(RUN.runId), 'as an attachment, not as the screen line');
  assert.deepEqual(askCalls(page), [], 'nothing was sent to a model');
});

test('#409 openSupervisorChat() with no argument opens the plain chat, no run attached', async () => {
  const page = await loadPage();
  page.run('window.openSupervisorChat()');
  await settle();
  assert.equal(page.$('#svc-drawer').classList.contains('open'), true, 'the drawer is open');
  assert.ok(!/run-20261015-409/.test(textOf(page.$('#svc-drawer'))), 'no run attached');
  assert.deepEqual(askCalls(page), []);
});
