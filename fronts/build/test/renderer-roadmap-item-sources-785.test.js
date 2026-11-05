// #785: the Roadmap item editor starts from the resolved values (the item's, then the project's run
// defaults, then the workflow's) and says where each comes from; Save keeps only what the owner chose.
// An old item with a full default set is not rewritten by opening it: the editor lists the saved values
// that differ from the project's, with one "use the project's values" action.
// Acceptance tests written before the code. Harness: backlog-po-785-harness.js (the whole page);
// window.BacklogRoadmap's html / onClick driven on real elements.
// Contract the developer provides (chosen here; the ids agreed with the BDD scenarios):
// - the editor reads the run defaults from api.projectInputHints(view.project)'s `runDefaults`;
// - workflow-input-source-<key>: the source of a field (WorkflowInputs.formHtml's `sources`);
// - workflow-inputs-differ: the notice listing each differing input by its label, only when one differs;
// - workflow-inputs-use-project: the action, in the notice; its click saves at once (api.saveRoadmap),
//   with the differing keys removed from the item.
const test = require('node:test');
const assert = require('node:assert/strict');
const { FEATURE, HINTS, plain, loadPage, byTestId, settle, textOf } = require('./backlog-po-785-harness');

const VIEW = { showAll: true, since: 'total', project: 'p1' };
const OLD_INPUTS = {
  mode: 'local', test_order: 'e2e_first', e2e_tests: 'write_and_run', screenshots: 'all', ui_folders: 'src/renderer/',
  steps_folders: 'features/steps', test_command: '', check_command: '', unit_tests: 'write_and_run',
};

async function openEditor(inputs, { language = 'pt-BR', hints = async () => plain(HINTS) } = {}) {
  const item = { id: 'it1', status: 'planned', workflow: 'feature.yaml', issues: [{ number: 7, title: 'Index the notes', url: 'u' }], inputs };
  const data = { projectId: 'p1', roadmap: { state: 'planned', stages: [{ id: 'st1', name: '', note: '', items: [item] }] }, issues: [] };
  const page = await loadPage({
    api: {
      listWorkflows: async () => [FEATURE],
      projectInputHints: hints,
      saveRoadmap: async (_p, stages) => ({ roadmap: { state: 'planned', stages } }),
    },
  });
  page.sandbox.I18n.setLanguage(language);
  const R = page.sandbox.BacklogRoadmap;
  const ctx = { projectId: 'p1', setData() {}, setError() {}, render() {} };
  const box = page.document.createElement('div');
  const draw = () => { box.innerHTML = R.html(data, () => {}, VIEW); };
  const clickOn = async (sel) => {
    const target = box.querySelector(sel);
    assert.equal(target === null, false, `${sel} is rendered`);
    await R.onClick({ target }, ctx, data);
    await settle(20);
    draw();
  };
  draw();
  await settle(20);
  draw();
  await clickOn('[data-rm-edit]');
  const saves = () => page.callsTo('saveRoadmap').map((a) => plain(a[1][0].items[0].inputs));
  const source = (key) => textOf(byTestId(box, `workflow-input-source-${key}`));
  const field = (key) => box.querySelector(`[data-rm-field="${key}"]`)?.value ?? null;
  return { page, box, draw, clickOn, saves, source, field };
}

test('#785 the hints that failed are asked again: the next render shows the project\'s values', { timeout: 30000 }, async () => {
  let asked = 0;
  const e = await openEditor({}, { hints: async () => { asked += 1; if (asked === 1) throw new Error('offline'); return plain(HINTS); } });
  assert.deepEqual([asked, e.field('mode'), e.source('mode')], [2, 'fork', 'do projeto']);
});

test('#785 the editor follows a project configuration changed while the project stays in view', { timeout: 30000, todo: 'known limit of #785: hintsFor and the 30 s hints cache keep the old values' }, async () => {
  let hints = HINTS;
  const e = await openEditor({}, { hints: async () => plain(hints) });
  hints = { ...HINTS, runDefaults: { ...HINTS.runDefaults, mode: 'remote' } };
  e.draw();
  await settle(20);
  e.draw();
  assert.equal(e.field('mode'), 'remote');
});

test('#785 the editor of an item with no inputs starts from the project\'s values', { timeout: 30000 }, async () => {
  const e = await openEditor({});
  assert.deepEqual([e.field('mode'), e.field('e2e_tests'), e.field('test_order'), e.field('language'), e.field('test_command')], ['fork', 'off', 'code_first', 'rust', 'cargo test']);
});

test('#785 a value from the project says "do projeto"', { timeout: 30000 }, async () => {
  assert.equal((await openEditor({})).source('mode'), 'do projeto');
});

test('#785 a value from the workflow says "do workflow"', { timeout: 30000 }, async () => {
  assert.equal((await openEditor({})).source('unit_tests'), 'do workflow');
});

test('#785 a value set on the item says "neste item"', { timeout: 30000 }, async () => {
  assert.equal((await openEditor({ e2e_tests: 'write' })).source('e2e_tests'), 'neste item');
});

test('#785 saving the editor untouched stores no input', { timeout: 30000 }, async () => {
  const e = await openEditor({});
  await e.clickOn('[data-rm-save]');
  assert.deepEqual(e.saves(), [{}]);
});

test('#785 a change in the editor stores only that key', { timeout: 30000 }, async () => {
  const e = await openEditor({});
  e.page.sandbox.WorkflowInputs.set(e.box.querySelector('.rm-form'), 'e2e_tests', 'write');
  await e.clickOn('[data-rm-save]');
  assert.deepEqual(e.saves(), [{ e2e_tests: 'write' }]);
});

test('#785 opening an old item saves nothing', { timeout: 30000 }, async () => {
  assert.deepEqual((await openEditor(OLD_INPUTS)).saves(), []);
});

test('#785 an old item\'s editor shows its saved values, marked "neste item"', { timeout: 30000 }, async () => {
  const e = await openEditor(OLD_INPUTS);
  assert.deepEqual([e.field('mode'), e.source('mode')], ['local', 'neste item']);
});

test('#785 an old item\'s editor lists the saved values that differ from the project\'s', { timeout: 30000 }, async () => {
  const notice = textOf(byTestId((await openEditor(OLD_INPUTS, { language: 'en' })).box, 'workflow-inputs-differ'));
  assert.deepEqual(['Mode', 'Test order', 'E2E tests', 'Screenshots'].filter((label) => !notice.includes(label)), []);
});

test('#785 the notice leaves out a saved value with no project value to differ from', { timeout: 30000 }, async () => {
  const notice = textOf(byTestId((await openEditor(OLD_INPUTS, { language: 'en' })).box, 'workflow-inputs-differ'));
  assert.deepEqual([notice === '', notice.includes('Unit tests')], [false, false]);
});

test('#785 an old item offers one "use the project\'s values" action', { timeout: 30000 }, async () => {
  const e = await openEditor(OLD_INPUTS);
  assert.equal(Array.from(e.box.querySelectorAll('[data-testid="workflow-inputs-use-project"]')).length, 1);
});

test('#785 the action leaves the item without the values that differed', { timeout: 30000 }, async () => {
  const e = await openEditor(OLD_INPUTS);
  await e.clickOn('[data-testid="workflow-inputs-use-project"]');
  assert.deepEqual(e.saves(), [{ unit_tests: 'write_and_run' }]);
});

test('#785 an item that differs from nothing shows no notice', { timeout: 30000 }, async () => {
  const e = await openEditor({ unit_tests: 'off' });
  assert.equal(byTestId(e.box, 'workflow-inputs-differ'), null);
});
