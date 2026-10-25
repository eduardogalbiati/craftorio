// #286 (acceptance tests, written before the code): an agent's `effort` reaches its CLI. The
// development workflows' providers declare `effort_args` (as ai-arena.yaml does), no bundled
// workflow sets an effort its provider cannot pass, and ai-development-local-hero gains a
// `developer_effort` input (default: the CLI's own effort, no --effort flag).
//
// Assumptions (the issue leaves the API open):
// - The "never silent" check lives in loadWorkflow (src/engine/workflow.js), the existing
//   validation seam: it either throws an Error whose message contains
//   "the effort of <agent> is not passed: its provider has no effort_args", or returns the
//   workflow with a `warnings` array of strings containing it. Both are accepted.
// - The resolved effort of an agent is read from `new WorkflowRun(...).wf.agents.<name>.effort`
//   (resolved from the inputs in the constructor), and the CLI's args come from
//   providers.cliInvocation with that effort, as the engine calls it.
// - The `default` option of developer_effort has some non-empty label (not fixed by the issue);
//   low/medium/high/xhigh use the labels of writer_effort in writer-reviewer.yaml.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const yaml = require('js-yaml');

process.env.MULTIAGENT_MOCK_DELAY_SCALE = '0.02';

const WORKFLOWS = path.join(__dirname, '..', 'workflows');
const HERO = path.join(WORKFLOWS, 'ai-development-local-hero.yaml');
const readYaml = (file) => yaml.load(fs.readFileSync(path.join(WORKFLOWS, file), 'utf8'));
const ARENA = readYaml('ai-arena.yaml');
const DEV_WORKFLOWS = [
  'ai-development-local-hero.yaml',
  'e2e-release.yaml',
  'software-development-local-hero.yaml',
  'software-development.yaml',
];

// the args the engine gives the CLI for one turn of `agent` on `provider`
function argsOf(provider, agent) {
  const { cliInvocation } = require('../src/engine/providers');
  const { render } = require('../src/engine/workflow');
  return cliInvocation({ provider, model: agent.model || 'm', effort: agent.effort, prompt: 'p', render }).args.map(String);
}
const effortValueAfter = (args, flag) => {
  const i = args.indexOf(flag);
  return i < 0 ? null : args[i + 1];
};

function heroRun(t, inputs) {
  const { WorkflowRun } = require('../src/engine/workflow');
  const runsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dev-effort-286-'));
  t.after(() => fs.rmSync(runsDir, { recursive: true, force: true }));
  return new WorkflowRun({ file: HERO, inputs: { task: 'Add the feature', repo_path: runsDir, ...inputs }, mock: true, runsDir });
}

for (const file of DEV_WORKFLOWS) {
  test(`#286 ${file}: every declared provider has effort_args (claude: --effort {{ effort }})`, () => {
    const wf = readYaml(file);
    const providers = wf.providers || {};
    assert.ok(providers.claude, 'the workflow declares the claude provider');
    assert.equal(JSON.stringify((providers.claude.effort_args || []).map(String)), JSON.stringify(['--effort', '{{ effort }}']));
    for (const [name, p] of Object.entries(providers)) {
      assert.ok(Array.isArray(p.effort_args) && p.effort_args.length > 0, `provider ${name} of ${file} has effort_args`);
      assert.ok(p.effort_args.some((a) => String(a).includes('{{ effort }}')), `provider ${name} of ${file} passes {{ effort }}`);
      const arena = ARENA.providers[name];
      if (arena) assert.equal(JSON.stringify(p.effort_args), JSON.stringify(arena.effort_args), `provider ${name} matches ai-arena.yaml`);
    }
  });
}

// the providers an agent may run on: its literal provider, or every option of the input its template names
function providersOf(wf, agent) {
  const p = String(agent.provider || '');
  if (!p.includes('{{')) return [p];
  const m = p.match(/inputs\.(\w+)/);
  const input = m && (wf.inputs || {})[m[1]];
  return input && Array.isArray(input.enum) ? input.enum.map(String).filter((x) => x !== 'none') : Object.keys(wf.providers || {});
}

test('#286 no bundled workflow sets an agent effort on a provider without effort_args', () => {
  const files = fs.readdirSync(WORKFLOWS).filter((f) => f.endsWith('.yaml'));
  assert.ok(files.length >= 10);
  const silent = [];
  for (const file of files) {
    const wf = readYaml(file);
    for (const [name, a] of Object.entries(wf.agents || {})) {
      const effort = (a || {}).effort ?? (wf.defaults || {}).effort;
      if (effort === undefined || effort === null || effort === '') continue;
      for (const p of providersOf(wf, a)) {
        const provider = (wf.providers || {})[p];
        if (!provider || !Array.isArray(provider.effort_args) || !provider.effort_args.length) silent.push(`${file}: ${name} on ${p}`);
      }
    }
  }
  assert.equal(silent.join('\n'), '');
});

test('#286 ai-development-local-hero: an agent with effort high gets --effort high on claude; one without gets no --effort', () => {
  const wf = readYaml('ai-development-local-hero.yaml');
  const claude = wf.providers.claude;
  const withEffort = argsOf(claude, { model: 'claude-opus-5-5', effort: 'high' });
  assert.equal(effortValueAfter(withEffort, '--effort'), 'high');
  const without = argsOf(claude, { model: 'claude-opus-5-5' });
  assert.equal(without.includes('--effort'), false);
});

function writeFixture(t, withEffortArgs) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dev-effort-286-wf-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'effort-check.yaml');
  const wf = {
    apiVersion: 'multiagent/v1',
    kind: 'Workflow',
    metadata: { name: 'fixture-effort-check' },
    providers: {
      claude: {
        type: 'claude-code', command: 'claude', args: ['-p', '--model', '{{ model }}'],
        ...(withEffortArgs ? { effort_args: ['--effort', '{{ effort }}'] } : {}),
      },
    },
    agents: { reviewer: { provider: 'claude', model: 'mock-model', effort: 'high' } },
    steps: [{ id: 'review', agent: 'reviewer', prompt: 'Review it.', transitions: [{ goto: 'end' }] }],
  };
  fs.writeFileSync(file, yaml.dump(wf));
  return file;
}

// the messages loadWorkflow reports for a file: its error (thrown) or its warnings
function loadMessages(file) {
  const { loadWorkflow } = require('../src/engine/workflow');
  try {
    const wf = loadWorkflow(file);
    return (Array.isArray(wf.warnings) ? wf.warnings : []).map(String).join('\n');
  } catch (e) {
    return String(e.message);
  }
}

test('#286 validation: an agent effort on a provider without effort_args is reported, never silent', (t) => {
  const messages = loadMessages(writeFixture(t, false));
  assert.match(messages, /effort of reviewer is not passed: its provider has no effort_args/);
});

test('#286 validation: an agent effort on a provider with effort_args is not reported', (t) => {
  const messages = loadMessages(writeFixture(t, true));
  assert.doesNotMatch(messages, /is not passed: its provider has no effort_args/);
});

test('#286 ai-development-local-hero: developer_effort input, right after developer_model', () => {
  const wf = readYaml('ai-development-local-hero.yaml');
  const keys = Object.keys(wf.inputs);
  assert.equal(keys.indexOf('developer_effort'), keys.indexOf('developer_model') + 1);
  const input = wf.inputs.developer_effort;
  assert.equal(input.label, 'Developer effort');
  assert.equal(input.type, 'string');
  assert.equal(JSON.stringify(input.enum), JSON.stringify(['default', 'low', 'medium', 'high', 'xhigh']));
  assert.equal(input.default, 'default');
  assert.equal(typeof input.description, 'string');
  assert.ok(input.description.trim().length > 0);
  const writer = readYaml('writer-reviewer.yaml').inputs.writer_effort.options;
  for (const k of ['low', 'medium', 'high', 'xhigh']) assert.equal((input.options || {})[k], writer[k], `label of ${k}`);
  assert.equal(typeof (input.options || {}).default, 'string');
  assert.ok(String((input.options || {}).default).trim().length > 0, 'the default option has a label');
});

test('#286 ai-development-local-hero: the developer effort is a template over inputs.developer_effort', () => {
  const dev = readYaml('ai-development-local-hero.yaml').agents.developer;
  assert.equal(typeof dev.effort, 'string');
  assert.match(dev.effort, /\{\{[^}]*inputs\.developer_effort[^}]*\}\}/);
});

test('#286 ai-development-local-hero: developer_effort default resolves to no effort and no --effort flag', (t) => {
  const run = heroRun(t, {});
  const dev = run.wf.agents.developer;
  assert.equal(dev.effort || '', '');
  assert.equal(argsOf(run.wf.providers.claude, dev).includes('--effort'), false);
  const explicit = heroRun(t, { developer_effort: 'default' });
  assert.equal(explicit.wf.agents.developer.effort || '', '');
  assert.equal(argsOf(explicit.wf.providers.claude, explicit.wf.agents.developer).includes('--effort'), false);
});

test('#286 ai-development-local-hero: developer_effort high gives the developer --effort high', (t) => {
  const run = heroRun(t, { developer_effort: 'high' });
  const dev = run.wf.agents.developer;
  assert.equal(dev.effort, 'high');
  assert.equal(effortValueAfter(argsOf(run.wf.providers.claude, dev), '--effort'), 'high');
  assert.equal(run.wf.agents.reviewer.effort, 'high', 'the reviewer keeps its own effort');
});

test('#286 Product Owner costInputs never sets developer_effort outside its enum', () => {
  const { costInputs } = require('../src/domains/po/product-owner');
  const file = 'ai-development-local-hero.yaml';
  const declared = readYaml(file).inputs;
  const allowed = (declared.developer_effort?.enum || ['default', 'low', 'medium', 'high', 'xhigh']).map(String);
  for (const cheapAgents of [false, true]) {
    const step = { level: 'economy', name: 'Economy', unitTests: 'run_existing', e2eTests: 'off', screenshots: 'off', cheapAgents };
    const out = costInputs({ workflow: file, inputs: {} }, step, [{ file, inputs: declared }]);
    const v = out.inputs.developer_effort;
    if (v !== undefined) assert.ok(allowed.includes(String(v)), `developer_effort ${v} is in the enum`);
  }
});
