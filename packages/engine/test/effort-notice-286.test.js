// #286 (developer's own tests): an agent effort its provider cannot pass is logged at the run's
// start (WorkflowRun notices), checked on the resolved provider, so a templated one counts too;
// loadWorkflow's warnings stay out of the workflow's own keys.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const yaml = require('js-yaml');
const { WorkflowRun, loadWorkflow } = require('../engine/workflow');

function fixture(t, agent) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'effort-notice-286-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'wf.yaml');
  fs.writeFileSync(file, yaml.dump({
    apiVersion: 'craftorio/v1',
    kind: 'Workflow',
    metadata: { name: 'effort-notice' },
    inputs: { cli: { type: 'string', enum: ['plain', 'effort'], default: 'plain' } },
    providers: {
      plain: { type: 'claude-code', command: 'claude', args: ['-p'] },
      effort: { type: 'claude-code', command: 'claude', args: ['-p'], effort_args: ['--effort', '{{ effort }}'] },
    },
    agents: { reviewer: { model: 'm', ...agent } },
    steps: [{ id: 'review', agent: 'reviewer', prompt: 'Review it.', transitions: [{ goto: 'end' }] }],
  }));
  return { file, runsDir: dir };
}

const warned = (run) => run.notices.filter((n) => /effort of reviewer is not passed/.test(n.message));

test('#286 a templated provider without effort_args is warned at run start, not at load', (t) => {
  const { file, runsDir } = fixture(t, { provider: '{{ inputs.cli }}', effort: 'high' });
  assert.deepEqual(loadWorkflow(file).warnings, []);
  const run = new WorkflowRun({ file, inputs: {}, mock: true, runsDir });
  assert.equal(warned(run).length, 1);
  assert.equal(warned(run)[0].level, 'warn');
  const ok = new WorkflowRun({ file, inputs: { cli: 'effort' }, mock: true, runsDir });
  assert.equal(warned(ok).length, 0);
});

test('#286 an effort that resolves to empty is not warned; warnings are not an enumerable key', (t) => {
  const { file, runsDir } = fixture(t, { provider: 'plain', effort: "{{ '' }}" });
  const run = new WorkflowRun({ file, inputs: {}, mock: true, runsDir });
  assert.equal(warned(run).length, 0);
  const wf = loadWorkflow(fixture(t, { provider: 'plain', effort: 'high' }).file);
  assert.equal(wf.warnings.length, 1);
  assert.equal(Object.keys(wf).includes('warnings'), false);
});
