// workflows/*.yaml (#216): every input of a bundled workflow has a human `label`, and every value of
// an enum input has its label in `options` (#116), so the cards show friendly pills
// (WorkflowInputs.inputPills) and never a snake_case key or value.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

const dir = path.join(__dirname, '..', 'workflows');
const bundled = fs.readdirSync(dir).filter((f) => /\.ya?ml$/.test(f)).sort();

test('every input of every bundled workflow has a label', () => {
  const missing = [];
  for (const file of bundled) {
    const wf = yaml.load(fs.readFileSync(path.join(dir, file), 'utf8'));
    for (const [key, def] of Object.entries(wf.inputs || {})) {
      if (!def || typeof def !== 'object' || !String(def.label || '').trim()) missing.push(`${file}: ${key}`);
    }
  }
  assert.deepEqual(missing, [], `inputs without a label:\n${missing.join('\n')}`);
});

test('every enum value of every bundled workflow input has an option label', () => {
  const missing = [];
  for (const file of bundled) {
    const wf = yaml.load(fs.readFileSync(path.join(dir, file), 'utf8'));
    for (const [key, def] of Object.entries(wf.inputs || {})) {
      if (!Array.isArray(def?.enum)) continue;
      for (const v of def.enum) {
        const label = def.options && typeof def.options === 'object' ? def.options[String(v)] : undefined;
        if (label == null || !String(label).trim()) missing.push(`${file}: ${key} = ${v}`);
      }
    }
  }
  assert.deepEqual(missing, [], `enum values without an option label:\n${missing.join('\n')}`);
});
