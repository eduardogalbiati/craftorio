// #262: the "Agents" section of a run's options (src/renderer/agent-overrides.js, window.AgentOverrides),
// shared by the Start drawer, the Assign dialog and a roadmap item's Edit. html() renders the workflow
// list's agents (workflows:list, runs_on resolved with the inputs' defaults); read() returns only what the
// user changed. The section's markup is read back into small fake fields (no DOM library in the project).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'agent-overrides.js'), 'utf8');

function load() {
  const sandbox = { document: { addEventListener() {} } };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(SRC, sandbox);
  return sandbox.window.AgentOverrides;
}

const attr = (tag, name) => (new RegExp(`${name}="([^"]*)"`).exec(tag) || [])[1];

// the section's rows as fake elements: what read() queries (data-ao-agent rows, their data-ao fields)
function fakeSection(html) {
  const rows = html.split('data-ao-agent="').slice(1).map((chunk) => {
    const fields = {};
    for (const m of chunk.matchAll(/<(select|input)\b[^>]*data-ao="(\w+)"[^>]*>/g)) {
      const [tag, kind] = m;
      const body = kind === 'select' ? chunk.slice(m.index + tag.length, chunk.indexOf('</select>', m.index)) : '';
      const value = kind === 'input' ? attr(tag, 'value') : (/<option value="([^"]*)"[^>]* selected/.exec(body) || /<option value="([^"]*)"/.exec(body) || [])[1];
      fields[m[2]] = { value: value ?? '', dataset: { aoDefault: attr(tag, 'data-ao-default') ?? '' } };
    }
    return { dataset: { aoAgent: chunk.slice(0, chunk.indexOf('"')) }, querySelector: (sel) => fields[/data-ao="(\w+)"/.exec(sel)[1]] || null, fields };
  });
  return { rows, querySelectorAll: () => rows };
}

const FIXTURE = `apiVersion: multiagent/v1
kind: Workflow
metadata: { name: fixture-renderer-ao-262 }
inputs:
  developer_model: { type: string, default: claude-opus-5-5 }
providers:
  claude: { type: claude-code, command: claude, args: ["-p", "--model", "{{ model }}"] }
  codex: { type: codex-cli, command: codex, args: ["exec", "-m", "{{ model }}"] }
agents:
  developer: { provider: claude, model: "{{ inputs.developer_model }}", session: ephemeral }
  reviewer: { provider: claude, model: claude-sonnet-5, effort: high, session: ephemeral }
steps:
  - id: develop
    agent: developer
    prompt: "Develop."
`;

function listed(t) {
  const { makeService } = require('./service/helpers');
  const { service, api } = makeService(t);
  fs.writeFileSync(path.join(service.workspace().workflows, 'fixture-renderer-ao-262.yaml'), FIXTURE);
  return api['workflows:list']().find((w) => w.file === 'fixture-renderer-ao-262.yaml');
}

test('#262 Agents section: each agent shows the workflow\'s provider, model and effort, and read() sends nothing when nothing changed', (t) => {
  const AO = load();
  const section = fakeSection(AO.html(listed(t), { prefix: 'start-ao' }));
  assert.deepEqual(section.rows.map((r) => r.dataset.aoAgent), ['developer', 'reviewer']);
  const dev = section.rows[0].fields;
  assert.deepEqual([dev.provider.value, dev.model.value, dev.effort.value], ['claude', 'claude-opus-5-5', '']);
  const rev = section.rows[1].fields;
  assert.deepEqual([rev.provider.value, rev.model.value, rev.effort.value], ['claude', 'claude-sonnet-5', 'high']);
  assert.equal(JSON.stringify(AO.read(section)), '{}');
});

test('#262 Agents section: a model over an input sends no override when only the input changes, so the run uses the input\'s value', (t) => {
  const AO = load();
  const section = fakeSection(AO.html(listed(t), { prefix: 'start-ao' }));
  // the user picks claude-fable-5-1 in the workflow's developer_model input: the Agents row is left as it is
  assert.equal(JSON.stringify(AO.read(section)), '{}');
});

test('#262 Agents section: read() returns only the fields the user changed, per agent', (t) => {
  const AO = load();
  const section = fakeSection(AO.html(listed(t), { prefix: 'start-ao' }));
  section.rows[0].fields.model.value = ' claude-fable-5-1 ';
  section.rows[1].fields.provider.value = 'codex';
  section.rows[1].fields.model.value = 'gpt-6-luna';
  section.rows[1].fields.effort.value = '';
  assert.equal(JSON.stringify(AO.read(section)), JSON.stringify({
    developer: { model: 'claude-fable-5-1' },
    reviewer: { provider: 'codex', model: 'gpt-6-luna', effort: '' },
  }));
});

test('#262 Agents section: a model cleared to whitespace is not sent as an override', (t) => {
  const AO = load();
  const section = fakeSection(AO.html(listed(t), { prefix: 'start-ao' }));
  section.rows[0].fields.model.value = '   ';
  assert.equal(JSON.stringify(AO.read(section)), '{}');
});

test('#262 Agents section: an earlier choice (a roadmap item\'s agentOverrides) is shown and read back', (t) => {
  const AO = load();
  const values = { reviewer: { provider: 'codex', model: 'gpt-6-luna' } };
  const section = fakeSection(AO.html(listed(t), { prefix: 'rm-ao-1', values }));
  assert.equal(JSON.stringify(AO.read(section)), JSON.stringify(values));
});
