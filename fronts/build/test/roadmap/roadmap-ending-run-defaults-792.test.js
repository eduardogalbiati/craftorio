// #792: the card's badge and the default it is compared with read the project's run defaults by the
// run's own rule: a project whose run mode differs from its wizard pick, an old `mode: auto`, a blank mode.
const test = require('node:test');
const assert = require('node:assert/strict');
const H = require('../roadmap-status-helpers');

const FEATURE = { file: 'feature.yaml', name: 'feature', merge: 'local', steps: [], inputs: { mode: { enum: ['local', 'remote', 'fork'], default: 'local' }, validation: { enum: ['auto', 'validated'] } } };
const PROJECT = { id: 'p1', defaultWorkflow: 'feature', workflows: [{ name: 'feature', variant: 'local-code' }] };
const VIEW = { showAll: true, since: 'total', project: 'p1' };

const dataOf = (inputs) => ({ projectId: 'p1', issues: [], roadmap: { state: 'planned', stages: [{ id: 'st1', name: '', note: '', items: [{ id: 'a', status: 'planned', workflow: 'feature.yaml', workflowName: 'feature', inputs, mock: false, issues: [H.ref(1, 'Login page')], runId: null, runs: [], error: null }] }] } });

async function screen(runDefaults) {
  const { R, sandbox } = H.loadRoadmap({ listWorkflows: async () => [FEATURE] });
  sandbox.api.projectInputHints = async () => ({ runDefaults });
  Object.assign(sandbox.state, { workflows: [FEATURE], projects: [PROJECT] });
  sandbox.CurrentProject = { get: () => PROJECT.id };
  R.html(dataOf({}), () => {}, VIEW);
  await H.settle();
  await H.settle();
  return (inputs) => {
    const el = H.findEl(H.itemEl(R.html(dataOf(inputs), () => {}, VIEW), 'a').outer, (e) => e.attrs['data-testid'] === 'roadmap-item-ending');
    return { kind: el.attrs['data-ending'], differs: /rm-wf-push/.test(el.attrs.class), explained: /default/i.test(el.attrs.title) };
  };
}

test('#792 the project runs in remote mode against its local pick: an item without a mode ends like the default', async () => {
  const seen = await screen({ mode: 'remote' });
  assert.deepEqual(seen({}), { kind: 'pr', differs: false, explained: false });
  assert.deepEqual(seen({ mode: 'local' }), { kind: 'local', differs: true, explained: true });
});

test('#792 an old `mode: auto` hides the project\'s mode, as in the run: the workflow\'s default', async () => {
  const seen = await screen({ mode: 'remote' });
  assert.equal(seen({ mode: 'auto' }).kind, 'local');
});

test('#792 a blank mode hides nothing: the project\'s mode', async () => {
  const seen = await screen({ mode: 'remote' });
  assert.equal(seen({ mode: '' }).kind, 'pr');
});

test('#792 without a run default the default keeps its Feature entry\'s mode', async () => {
  const seen = await screen(null);
  assert.deepEqual(seen({}), { kind: 'local', differs: false, explained: false });
  assert.deepEqual(seen({ mode: 'remote' }), { kind: 'pr', differs: true, explained: true });
});
