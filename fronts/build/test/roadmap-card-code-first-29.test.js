// #29 acceptance, written before the code: the roadmap card's pipeline (fronts/build/views/backlog/
// backlog-roadmap.js stationsOf, RunProgress.pipeline) follows the feature item's test order. Code first
// (`test_order: code_first`, the local-code variant): the developer codes first and the test writer writes
// the acceptance tests after it, so the Develop station comes before the Tests station. E2E first keeps
// Tests before Develop. Harness of renderer-roadmap-card-282.test.js (roadmap-status-helpers.js loadRoadmap,
// the real workflows/feature.yaml).
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const H = require('./roadmap-status-helpers');

const FILE = 'feature.yaml';

// the bundled workflow as api.listWorkflows gives it, with its groups (copied from renderer-roadmap-card-282)
function wfEntry(file) {
  const { loadWorkflow } = require('@craftorio/engine/engine/workflow');
  const wf = loadWorkflow(path.join(__dirname, '..', '..', '..', 'workflows', file));
  return {
    file,
    name: wf.metadata?.name || file,
    description: wf.metadata?.description,
    inputs: wf.inputs || {},
    outputs: wf.outputs || {},
    groups: wf.groups || [],
    agents: Object.fromEntries(Object.entries(wf.agents || {}).map(([k, a]) => [k, { provider: a.provider, model: a.model }])),
    steps: wf.steps.map((s) => ({
      ...s,
      type: s.type || 'agent',
      agent: s.agents ? s.agents.join(' · ') : s.agent || null,
      next: [...new Set((s.transitions || []).map((x) => x.goto).filter(Boolean))],
    })),
  };
}

const card = (inputs) => ({
  id: 'a', status: 'planned', workflow: FILE, workflowName: 'feature', inputs, mock: false,
  issues: [H.ref(101, 'Login page')], origin: H.iso(H.NOW - H.HOUR), runId: null, runs: [], error: null,
});
const one = (x) => ({ roadmap: { state: 'planned', stages: [{ id: 'st1', name: '', note: '', items: [x] }] }, issues: [] });

async function stationNames(inputs) {
  const { R } = H.loadRoadmap({ listWorkflows: async () => [wfEntry(FILE)], runTitle: (r) => r.workflow });
  R.html(H.roadmapOf([]), () => {});
  await H.settle();
  await H.settle();
  const html = R.html(one(card(inputs)), () => {}, { showAll: true, since: 'total' });
  const item = H.itemEl(html, 'a');
  const pipe = H.findEl(item.outer, (e) => e.attrs['data-testid'] === 'roadmap-pipeline');
  assert.ok(pipe, 'the item has a roadmap-pipeline');
  return H.findAll(pipe.outer, (e) => e.attrs['data-testid'] === 'roadmap-station').map((e) => e.attrs['data-step'] || '');
}

test('#29 a planned feature item with test order Code first: the Develop station comes before Tests', async () => {
  assert.deepEqual(await stationNames({ test_order: 'code_first', mode: 'auto' }), ['Develop', 'Tests', 'Review', 'Validate', 'Merge']);
});

test('#29 a planned feature item with test order E2E first (unchanged): Tests before Develop', async () => {
  assert.deepEqual(await stationNames({ test_order: 'e2e_first', mode: 'auto' }), ['Tests', 'Develop', 'Review', 'Validate', 'Merge']);
});
