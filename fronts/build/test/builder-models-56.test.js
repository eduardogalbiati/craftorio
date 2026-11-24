// #56: the models the Builder offers for an agent (fronts/build/views/workflows/builder.js), read from
// the panel the screen drew (renderer-app-harness.js). A workflow saved on an earlier version shows its
// model selected, after the ones offered today.
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('@craftorio/ui-kit/test/renderer-app-harness');

const OFFERED = ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-fable-5-2', 'claude-haiku-5-5'];

const workflowOn = (model) => ({
  file: 'x.yaml',
  mode: 'full',
  problems: [],
  spec: {
    name: 'x',
    description: '',
    category: 'build',
    steps: [{ id: 's1', kind: 'agent', brief: '', agent: { source: 'custom', provider: 'claude', model, effort: 'high', system_prompt: '', skills: [] } }],
  },
});

// the model select of the open workflow's agent: every option, and the selected one
async function modelSelect(model) {
  const app = loadApp({ api: { loadBuilderWorkflow: async () => workflowOn(model) } });
  await app.boot();
  await app.sandbox.openInBuilder('x.yaml');
  await app.settle();
  const select = /<select id="wb-model"[^>]*>([\s\S]*?)<\/select>/.exec(String(app.el('#wb-panel').innerHTML))?.[1] ?? '';
  const options = [...select.matchAll(/<option([^>]*)>([^<]*)</g)];
  const named = ([, attrs, text]) => /value="([^"]*)"/.exec(attrs)?.[1] ?? text;
  return { options: options.map(named), selected: options.filter(([, attrs]) => /\bselected\b/.test(attrs)).map(named) };
}

test('#56 the Builder shows an agent\'s model of an earlier version, selected, after the models offered', async () => {
  const { options, selected } = await modelSelect('claude-fable-5-1');
  assert.deepEqual(selected, ['claude-fable-5-1']);
  assert.deepEqual(options.filter((m) => m.startsWith('claude-')).sort(), [...OFFERED, 'claude-fable-5-1'].sort());
  assert.equal(options.indexOf('claude-fable-5-1') > Math.max(...OFFERED.map((m) => options.indexOf(m))), true);
});

test('#56 the Builder offers the current models once each, with the agent\'s own selected', async () => {
  const { options, selected } = await modelSelect('claude-fable-5-2');
  assert.deepEqual(selected, ['claude-fable-5-2']);
  assert.deepEqual(options.filter((m) => m.startsWith('claude-')).sort(), [...OFFERED].sort());
});
