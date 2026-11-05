// #785: a recommendation recorded before the change carries every input at the workflow's default. Added
// to the roadmap, only what was chosen goes; the card shows the project's values for the rest.
const test = require('node:test');
const assert = require('node:assert/strict');
const { openDrawer, recommendation, click, byTestId, textOf, settle } = require('./backlog-po-785-harness');

const OLD = { mode: 'local', test_order: 'e2e_first', e2e_tests: 'write_and_run', screenshots: 'all', test_command: '' };

// a conversation whose group was saved as it was before #785
function oldAnswer(inputs, extra = {}) {
  const history = recommendation();
  const g = history[1].answer.groups[0];
  delete g.inputsChosen;
  Object.assign(g, { inputs }, extra);
  return history;
}
const addToRoadmap = (page) => click(page, page.$('#po-log [data-po-act="roadmap"]'), '"Colocar no roadmap"');

test('#785 an old recommendation adds none of its defaults to the roadmap', { timeout: 30000 }, async () => {
  const page = await openDrawer({ history: oldAnswer(OLD) });
  await addToRoadmap(page);
  assert.deepEqual(page.added[0].inputs, {});
});

test('#785 an old recommendation keeps the value that is not a default', { timeout: 30000 }, async () => {
  const page = await openDrawer({ history: oldAnswer({ ...OLD, validation: 'validated' }) });
  await addToRoadmap(page);
  assert.deepEqual(page.added[0].inputs, { validation: 'validated' });
});

test('#785 an old recommendation keeps what its Cost step set on purpose', { timeout: 30000 }, async () => {
  const set = { e2e_tests: 'write_and_run' };
  const page = await openDrawer({ history: oldAnswer(OLD, { cost: { level: 5, name: 'Generous', inputs: set } }) });
  await addToRoadmap(page);
  assert.deepEqual(page.added[0].inputs, set);
});

test('#785 an old recommendation\'s card shows the project\'s mode', { timeout: 30000 }, async () => {
  const page = await openDrawer({ history: oldAnswer(OLD) });
  await settle(30);
  assert.match(textOf(byTestId(page.$('#po-log'), 'po-decision-mode')), /Fork/);
});

test('#785 a value the PO chose on purpose stays, even at the workflow\'s default', { timeout: 30000 }, async () => {
  const page = await openDrawer({ history: recommendation({ inputs: { mode: 'local' } }) });
  await addToRoadmap(page);
  assert.deepEqual(page.added[0].inputs, { mode: 'local' });
});
