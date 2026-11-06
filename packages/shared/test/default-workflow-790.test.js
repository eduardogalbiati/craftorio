// #790: packages/shared/default-workflow.js follows the project, never the global setting. Acceptance
// tests, written before the code.
// Seams: DefaultWorkflow.projectDefault(project, manifestDefault) -> a name without .yaml: the project's
// defaultWorkflow, the manifest's default, the first build workflow of project.workflows, `feature`;
// DefaultWorkflow.current() in the renderer, run in a vm with window.CurrentProject and state (as
// packages/engine/test/default-workflow-project-486.test.js does).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const load = () => require('../default-workflow');
const src = fs.readFileSync(path.join(__dirname, '..', 'default-workflow.js'), 'utf8');

const WORKFLOWS = [
  { file: 'feature.yaml', name: 'feature' },
  { file: 'from-settings.yaml', name: 'From settings' },
  { file: 'first-build.yaml', name: 'First build' },
];

function renderer(project) {
  const window = { CurrentProject: { get: () => project?.id || null } };
  const sandbox = { window, state: { workflows: WORKFLOWS, settings: { defaultWorkflow: 'from-settings.yaml' }, projects: project ? [project] : [] } };
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox);
  return window.DefaultWorkflow;
}

test('#790 projectDefault: the project\'s own default first, without its .yaml', () => {
  assert.equal(load().projectDefault({ defaultWorkflow: 'mine.yaml', workflows: [{ name: 'sd', category: 'build' }] }, 'hero'), 'mine');
});

test('#790 projectDefault: then the manifest\'s default', () => {
  assert.equal(load().projectDefault({ workflows: [{ name: 'sd', category: 'build' }] }, 'hero'), 'hero');
});

test('#790 projectDefault: then the project\'s first build workflow', () => {
  assert.equal(load().projectDefault({ workflows: [{ name: 'refresh', category: 'intake' }, { name: 'sd', category: 'build' }] }, null), 'sd');
});

test('#790 projectDefault: last, feature', () => {
  assert.equal(load().projectDefault({}, null), 'feature');
});

test('#790 projectDefault: no project is feature too', () => {
  assert.equal(load().projectDefault(null), 'feature');
});

test('#790 current(): a project with no default takes its first build workflow, not the setting', () => {
  const DW = renderer({ id: 'p', workflows: [{ name: 'first-build', category: 'build' }] });
  assert.equal(DW.current().file, 'first-build.yaml');
});

test('#790 current(): with no project the setting is not read either', () => {
  assert.equal(renderer(null).current().file, 'feature.yaml');
});
