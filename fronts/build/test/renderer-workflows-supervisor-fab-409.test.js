// #409: the Workflows screen (fronts/build/views/workflows/workflows.js) opens the Supervisor from a
// round button at the bottom right, on every tab, like the Backlog's Product Owner button (#btn-bl-po,
// .po-fab): the Supervisor's robot (robots.js 'supervisor' variant, purple #7C5CFF), opening the
// Supervisor's drawer (#svc-drawer); an answer the person has not seen puts the yellow dot on it
// (.status-dot, like the PO's) until the drawer opens. The header's "◆ Supervisor" button goes away.
// Acceptance tests, written before the code, through the whole page (test/agent-chat-page-harness.js).
//
// Seams: [data-testid="supervisor-fab"] inside #view-workflows (suggested id: #btn-wf-sup-fab, class
// po-fab or a sibling class); the drawer's #svc-drawer, its chat's agent-chat-input / agent-chat-send,
// its close button #btn-svc-close; the fake api's askSupervisorChat, held until the test settles it.
const test = require('node:test');
const assert = require('node:assert/strict');
const { textOf } = require('@multiagent/ui-kit/test/mini-dom');
const { loadPage, settle, deferred, part } = require('@multiagent/ui-kit/test/agent-chat-page-harness');

const TABS = ['definitions', 'runs', 'builder', 'pipelines'];
const fab = (page) => page.$('#view-workflows [data-testid="supervisor-fab"]');
const hiddenUp = (el) => { for (let cur = el; cur && cur.nodeType === 1; cur = cur.parentElement) if (cur.classList.contains('hidden')) return true; return false; };
const drawerOpen = (page) => page.$('#svc-drawer').classList.contains('open');
const hasDot = (page) => fab(page).querySelector('.status-dot') !== null;

async function workflowsPage(api = {}, tab = 'runs') {
  const page = await loadPage({ api });
  page.run(`showWorkflowsTab('${tab}'); showView('workflows')`);
  await settle();
  assert.equal(page.run('state.view'), 'workflows');
  return page;
}

test('#409 the Workflows screen has a round Supervisor button with the Supervisor\'s robot, shown on every tab', async () => {
  const page = await workflowsPage();
  for (const tab of TABS) {
    page.run(`showWorkflowsTab('${tab}')`);
    await settle();
    const b = fab(page);
    assert.ok(b !== null, `[data-testid="supervisor-fab"] on the ${tab} tab`);
    assert.equal(hiddenUp(b), false, `visible on the ${tab} tab`);
    assert.equal(b.localName, 'button');
    assert.match(b.innerHTML, /<svg/, 'a robot drawing');
    assert.match(b.innerHTML, /#7C5CFF/i, 'the Supervisor\'s robot (its purple)');
    assert.match(`${b.getAttribute('aria-label') || ''} ${b.getAttribute('title') || ''}`, /Supervisor/);
  }
});

test('#409 the Workflows header has no "◆ Supervisor" button any more', async () => {
  const page = await workflowsPage();
  assert.equal(page.$('#btn-wf-supervisor') === null, true, '#btn-wf-supervisor is gone');
  const head = page.$('#view-workflows .page-head');
  assert.ok(head !== null, 'the header');
  const named = head.querySelectorAll('button').map((b) => textOf(b).replace(/\s+/g, ' ').trim()).filter((t) => /Supervisor/.test(t));
  assert.deepEqual(named, []);
});

test('#409 clicking the round button opens the Supervisor\'s drawer and sends nothing', async () => {
  const page = await workflowsPage();
  assert.equal(drawerOpen(page), false);
  const b = fab(page);
  assert.ok(b !== null, 'the round Supervisor button');
  b.click();
  await settle();
  assert.equal(drawerOpen(page), true);
  assert.deepEqual(page.calls.filter(([n]) => /^ask/i.test(n)).map(([n]) => n), []);
});

test('#409 an answer that lands with the drawer closed puts the yellow dot on the round button until the drawer opens', async () => {
  const asked = deferred();
  const page = await workflowsPage({ askSupervisorChat: () => asked.promise });
  assert.ok(fab(page) !== null, 'the round Supervisor button');
  assert.equal(hasDot(page), false, 'no dot at first');
  fab(page).click();
  await settle();
  page.dom.type(part(page, '#svc-drawer', 'agent-chat-input'), 'Which runs failed recently?');
  part(page, '#svc-drawer', 'agent-chat-send').click();
  await settle();
  page.$('#btn-svc-close').click();
  await settle();
  assert.equal(drawerOpen(page), false);
  asked.resolve({ messages: [{ role: 'user', text: 'Which runs failed recently?', ts: '2026-10-15T10:00:00Z' }, { role: 'assistant', text: 'None.', ts: '2026-10-15T10:00:05Z' }] });
  await settle();
  assert.equal(hasDot(page), true, 'the yellow dot: an unseen answer');
  fab(page).click();
  await settle();
  assert.equal(drawerOpen(page), true);
  assert.equal(hasDot(page), false, 'seen: the dot goes');
});
