// #469, #474 internals: an action interpolates unfiltered only an allowlist of names (not the step's
// own text output, nor vars), shell_quote doubles trailing backslashes on Windows, and a template
// subscript with a built key is refused. Seams: loadWorkflow (src/engine/run/load.js), render
// (src/engine/run/templates.js).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { loadWorkflow } = require('../src/engine/run/load');
const { render } = require('../src/engine/run/templates');

function errorOf(t, text) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tpl-internals-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'wf.yaml');
  fs.writeFileSync(file, text);
  try { loadWorkflow(file); return null; } catch (e) { return e.message; }
}

// agent step x (text string, n integer) whose only transition carries `transition` (indented 8)
function workflow({ transition = '', prompt = 'Build it.' } = {}) {
  return `inputs:
  project_path:
    type: string
    default: ""
orchestrator:
  worktree:
    repo: "{{ inputs.project_path }}"
    base: main
agents:
  dev:
    provider: mock
steps:
  - id: x
    agent: dev
    prompt: ${JSON.stringify(prompt)}
    output_schema:
      type: object
      required: [text, n]
      properties:
        text: { type: string }
        n: { type: integer }
    transitions:
      - when: "true"
${transition}        goto: end
`;
}
const action = (a, extra = '') => `${extra}        action: ${JSON.stringify(a)}\n`;

test('#469 an action reading the step\'s own text output or a var is refused, a typed own field loads', (t) => {
  assert.match(errorOf(t, workflow({ transition: action('echo {{ output.text }}') })), /action interpolates output\.text/);
  assert.match(errorOf(t, workflow({ transition: action('echo {{ vars.s }}', '        set: { s: "{{ output.text }}" }\n') })), /vars\.s/);
  assert.match(errorOf(t, workflow({ transition: action('echo {{ action_error }}') })), /action_error/);
  assert.match(errorOf(t, workflow({ transition: action('echo {{ steps.x.outputs[0].text }}') })), /steps\.x\.outputs/);
  assert.equal(errorOf(t, workflow({ transition: action('echo {{ output.n }} {{ steps.x.output.n }}') })), null);
});

test('#469 allowlisted names, bound names and a filtered value load in an action', (t) => {
  const a = "{% for f in ['a', 'b'] %}node \"{{ skill_dir('s') }}/x.js\" {{ f }} --run {{ run_id }} --dir \"{{ run_dir }}\" --i {{ iteration }} {{ inputs.project_path | shell_quote }} {{ output.text | shell_quote }}{% endfor %}";
  assert.equal(errorOf(t, workflow({ transition: action(a) })), null);
  assert.match(errorOf(t, workflow({ transition: action('echo {{ output.text ~ inputs.x | shell_quote }}') })), /output\.text/);
});

test('#469 shell_quote on Windows doubles trailing backslashes', (t) => {
  const platform = Object.getOwnPropertyDescriptor(process, 'platform');
  Object.defineProperty(process, 'platform', { value: 'win32' });
  t.after(() => Object.defineProperty(process, 'platform', platform));
  assert.equal(render('{{ p | shell_quote }}', { p: 'C:\\proj\\' }), '"C:\\proj\\\\"');
  assert.equal(render('{{ p | shell_quote }}', { p: 'C:\\proj' }), '"C:\\proj"');
});

test('#474 a subscript with a built key is refused, a literal or a name loads', (t) => {
  const built = "{{ ''['const' ~ 'ructor']['const' ~ 'ructor']('return this')() }}";
  assert.match(errorOf(t, workflow({ prompt: built })), /subscript/);
  assert.equal(errorOf(t, workflow({ prompt: "{{ steps.x.output['text'] }} {{ inputs[name] }} {{ a[0] }} {{ b[f.agent] }} {{ [1, 2] }}" })), null);
});

test('#474 a refused name says to rename the step or input', (t) => {
  assert.match(errorOf(t, workflow({ prompt: '{{ inputs.process }}' })), /renamed/);
});
