// #785: the drawer reads the project's run defaults (api.projectInputHints) on its own time: they may
// fail, or arrive after the drawer moved to another project. Neither changes what a recommendation says
// or saves for the project in view.
const test = require('node:test');
const assert = require('node:assert/strict');
const { deferred } = require('@multiagent/ui-kit/test/agent-chat-page-harness');
const { HINTS, RUN_DEFAULTS, plain, openDrawer, recommendation, click, byTestId, textOf, settle } = require('./backlog-po-785-harness');

test('#785 without the project\'s hints, a value the PO chose on purpose still goes to the roadmap', { timeout: 30000 }, async () => {
  const page = await openDrawer({ history: recommendation({ inputs: { mode: 'local' } }), api: { projectInputHints: async () => { throw new Error('offline'); } } });
  await click(page, page.$('#po-log [data-po-act="roadmap"]'), '"Colocar no roadmap"');
  assert.deepEqual(page.added[0].inputs, { mode: 'local' });
});

test('#785 without the project\'s hints, the owner\'s change back to the workflow\'s default still goes to the roadmap', { timeout: 30000 }, async () => {
  const page = await openDrawer({ history: recommendation({ inputs: { mode: 'remote' } }), api: { projectInputHints: async () => { throw new Error('offline'); } } });
  await click(page, byTestId(page.$('#po-log'), 'po-decisions-edit'), '"Editar"');
  const select = byTestId(page.$('#po-log'), 'po-decisions-form')?.querySelector('[data-wi-input="mode"]') ?? null;
  assert.equal(select === null, false, 'the form\'s Mode select');
  select.value = 'local';
  select.dispatchEvent(new page.dom.classes.Event('change', { bubbles: true }));
  await settle(30);
  await click(page, page.$('#po-log [data-po-act="roadmap"]'), '"Colocar no roadmap"');
  assert.deepEqual(page.added[0].inputs, { mode: 'local' });
});

test('#785 the hints of the previous project, arriving late, do not reach the card', { timeout: 30000 }, async () => {
  const late = deferred();
  const page = await openDrawer({
    history: recommendation(),
    api: { projectInputHints: async (projectId) => (projectId === 'other' ? late.promise : plain(HINTS)) },
  });
  const actions = page.sandbox.BacklogActions;
  actions.projectId = () => 'other';
  const leaving = page.sandbox.BacklogPO.open();
  await settle(30);
  actions.projectId = () => 'demo';
  await page.sandbox.BacklogPO.open();
  late.resolve({ ...HINTS, runDefaults: { ...RUN_DEFAULTS, mode: 'remote' } });
  await leaving; // its render is the one that would show the other project's values
  await settle(30);
  assert.match(textOf(byTestId(page.$('#po-log'), 'po-decision-mode')), /Fork/);
});
