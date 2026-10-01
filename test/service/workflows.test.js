const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { makeService } = require('./helpers');

test('builder: bundled workflows open read-only and clone into an editable copy', async (t) => {
  const { api, service } = makeService(t);
  const ro = api['builder:load']('writer-reviewer.yaml');
  assert.equal(ro.mode, 'readonly');
  assert.ok(ro.spec.fixed && ro.problems.length);
  assert.throws(() => api['builder:save']({ file: 'writer-reviewer.yaml', spec: ro.spec }), /bundled with the app: clone it/);

  const { file } = api['builder:clone']('writer-reviewer.yaml');
  assert.equal(file, 'writer-reviewer-copy.yaml');
  assert.equal(api['builder:clone']('writer-reviewer.yaml').file, 'writer-reviewer-copy-2.yaml');
  const copy = api['builder:load'](file);
  assert.equal(copy.mode, 'fixed');
  assert.equal(copy.spec.name, 'writer-reviewer-copy');
  copy.spec.agents.signoff.effort = 'low';
  api['builder:save']({ file, spec: copy.spec });
  const listed = api['workflows:list']().find((w) => w.file === file);
  assert.equal(listed.origin, 'custom');
  assert.match(fs.readFileSync(path.join(service.workspace().workflows, file), 'utf8'), /^# =+/); // comments kept

  // a hand-written workflow the builder can't draw keeps its steps; one it made is fully editable
  assert.equal(api['builder:load']('fixture-service.yaml').mode, 'fixed');
  const desk = { id: 'a', kind: 'agent', brief: 'Do it.', context: true, access: 'read', agent: { source: 'custom', provider: 'claude', model: 'claude-opus-5-5', effort: 'default', system_prompt: 'You do it.', skills: [] } };
  const made = api['builder:save']({ file: null, spec: { name: 'Made here', description: '', category: 'build', steps: [desk] } });
  assert.equal(made.file, 'made-here.yaml');
  assert.equal(api['builder:load'](made.file).mode, 'full');
});
