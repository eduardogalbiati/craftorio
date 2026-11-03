// #469, #474 internals: the `shell_quote` filter an action passes a user value through, the loader's
// refusal of agent output fed to a shell through `{% set %}` or a whole-output interpolation, and
// the builder's one-time trust of a custom workflow (listWorkflows' `trusted`, remembered by the
// fingerprint of the file's text in settings' trustedFiles).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { render } = require('../../engine/run/templates');
const { loadWorkflow } = require('../../engine/run/load');
const { makeService } = require('./helpers');

test('#469 shell_quote keeps a value one argument of the platform\'s shell', () => {
  if (process.platform === 'win32') {
    assert.throws(() => render('{{ v | shell_quote }}', { v: 'a"b' }), /cmd\.exe/);
    assert.throws(() => render('{{ v | shell_quote }}', { v: '%PATH%' }), /cmd\.exe/);
    assert.equal(render('{{ v | shell_quote }}', { v: 'C:/my dir/$(x); y' }), '"C:/my dir/$(x); y"');
  } else {
    assert.equal(render('{{ v | shell_quote }}', { v: 'C:/my "dir"/$(x)' }), `'C:/my "dir"/$(x)'`);
    assert.equal(render('{{ v | shell_quote }}', { v: "it's" }), `'it'\\''s'`);
  }
});

function loadError(t, action) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shell-safe-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'wf.yaml');
  fs.writeFileSync(file, `orchestrator:
  worktree: { repo: ".", base: main }
agents:
  dev: { provider: mock }
steps:
  - id: x
    agent: dev
    prompt: Do it.
    output_schema:
      type: object
      properties:
        text: { type: string }
        n: { type: integer }
    transitions:
      - action: ${JSON.stringify(action)}
        goto: end
`);
  try { loadWorkflow(file); return null; } catch (e) { return e.message; }
}

test('#469 agent output through {% set %}, a whole output or a filter applied to a part is refused', (t) => {
  assert.match(loadError(t, '{% set v = steps.x.output.text %}echo {{ v }}'), /action/);
  assert.match(loadError(t, 'echo {{ steps.x.output | to_json }}'), /action/);
  assert.match(loadError(t, "echo {{ steps.x.output.text ~ 'a' | shell_quote }}"), /action/);
  assert.match(loadError(t, "echo {{ steps['x'].output.text }}"), /action/);
  assert.equal(loadError(t, '{% if steps.x.output.text %}echo {{ steps.x.output.n }} {{ steps.x.output.text | shell_quote }}{% endif %}'), null);
});

test('#474 a custom workflow is trusted once confirmed, until its file changes outside the app', (t) => {
  const { api, service } = makeService(t);
  const dir = service.workspace().workflows;
  const file = 'shared-copy.yaml';
  fs.writeFileSync(path.join(dir, file), fs.readFileSync(path.join(dir, 'fixture-service.yaml'), 'utf8'));
  const listed = () => api['workflows:list']().find((w) => w.file === file);
  assert.equal(listed().trusted, false);
  assert.ok(api['workflows:list']().filter((w) => w.origin !== 'custom').every((w) => w.trusted));

  const { spec } = api['builder:load'](file);
  api['builder:save']({ file, spec }); // saved without the confirmation: still not trusted
  assert.equal(listed().trusted, false);
  api['builder:save']({ file, spec, trust: true });
  assert.equal(listed().trusted, true);
  api['builder:save']({ file, spec }); // a trusted file stays trusted with its new text
  assert.equal(listed().trusted, true);

  fs.appendFileSync(path.join(dir, file), '\n# edited elsewhere\n');
  assert.equal(listed().trusted, false);

  // a copy of a bundled workflow is the owner's own: trusted
  const { file: copy } = api['builder:clone']('write-doc.yaml'); // #648: writer-reviewer is an alias now
  assert.equal(api['workflows:list']().find((w) => w.file === copy).trusted, true);
});
