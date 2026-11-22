// #735: the run's 2D view (fronts/build/views/run/run.js) dims the steps and agents a run's inputs rule
// out: stepsThatDontApply(v, all) → Map id → { reason, step }, over the app's workflow description
// (steps with an `agents` list, state.workflows) and the run's inputs. Pulled out of the source and run
// in a sandbox with the real RunPlan, as renderer-run-summary.test.js does for run.js helpers.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const RunPlan = require('@craftorio/shared/run-plan');

const pageFileOf = (rel) => require('../../../scripts/source-tree').pageFile(path.join(__dirname, '..', '..', '..'), rel);
const runSrc = fs.readFileSync(pageFileOf('views/run/run.js'), 'utf8');
const FN = /function stepsThatDontApply\(v, all\) \{[\s\S]*?\n\}/.exec(runSrc)?.[0];

const DESCRIBED = {
  file: 'feature.yaml',
  name: 'feature',
  inputs: {
    ui_folders: { type: 'array', default: ['src/renderer/'] },
    screenshots: { type: 'string', default: 'all' },
    e2e_tests: { type: 'string', default: 'write_and_run' },
  },
  steps: [
    { id: 'develop' },
    { id: 'developer_screenshots' },
    { id: 'testid_check' },
    { id: 'code_review', agents: ['reviewer', 'ui_reviewer'] },
    { id: 'e2e' },
  ],
};

function dontApply(inputs, { workflows = [DESCRIBED] } = {}) {
  assert.ok(FN, 'stepsThatDontApply(v, all) not found in views/run/run.js: the source moved');
  const box = { window: { RunPlan }, state: { workflows } };
  vm.createContext(box);
  vm.runInContext(`${FN}\nthis.fn = stepsThatDontApply;`, box);
  const v = { run: { file: 'feature.yaml', workflow: 'feature', inputs } };
  const all = DESCRIBED.steps.map((s) => ({ id: s.id }));
  const map = box.fn(v, all);
  return [...map.entries()].map(([id, x]) => `${id}@${x.step}:${x.reason}`).sort();
}

test('#735 a backend run (no UI folders) dims the UI steps and the code review\'s UI reviewer', () => {
  assert.deepEqual(dontApply({ ui_folders: [], screenshots: 'off', e2e_tests: 'off' }), [
    'developer_screenshots@developer_screenshots:run.doesnt_apply_no_ui',
    'e2e@e2e:run.doesnt_apply_no_ui',
    'testid_check@testid_check:run.doesnt_apply_no_ui',
    'ui_reviewer@code_review:run.doesnt_apply_no_ui',
  ]);
});

test('#735 a run with UI folders and E2E on dims nothing', () => {
  assert.deepEqual(dontApply({ ui_folders: ['web/'], screenshots: 'all', e2e_tests: 'write_and_run' }), []);
});

test('#735 the reasons read as text in both languages ("Doesn\'t apply: no UI in this project")', () => {
  const en = require('@craftorio/shared/i18n/en.json');
  const pt = require('@craftorio/shared/i18n/pt-BR.json');
  const get = (cat, key) => key.split('.').reduce((o, k) => (o == null ? o : o[k]), cat) ?? cat[key];
  assert.match(String(get(en, 'run.doesnt_apply_no_ui')), /doesn.t apply.*no UI/i);
  assert.equal(typeof get(pt, 'run.doesnt_apply_no_ui'), 'string');
  assert.notEqual(get(pt, 'run.doesnt_apply_no_ui'), get(en, 'run.doesnt_apply_no_ui'));
});

test('#735 without the workflow\'s description the run dims nothing it can\'t tell', () => {
  assert.deepEqual(dontApply({ ui_folders: [] }, { workflows: [] }), []);
});
