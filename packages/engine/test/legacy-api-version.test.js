// T2c: a workflow written before the rename to Craftorio (apiVersion: multiagent/v1) still loads,
// the same as one with apiVersion: craftorio/v1; the bundled workflows use the new name.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { loadWorkflow } = require('../engine/workflow');

const BODY = `kind: Workflow
metadata:
  name: legacy-api-version
agents:
  dev:
    provider: mock
steps:
  - id: only
    agent: dev
    prompt: "Say hello"
`;

test('T2c a workflow with apiVersion multiagent/v1 loads like one with craftorio/v1', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'craftorio-api-version-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const load = (version) => {
    const file = path.join(dir, `${version.replace('/', '-')}.yaml`);
    fs.writeFileSync(file, `apiVersion: ${version}\n${BODY}`);
    return loadWorkflow(file);
  };
  const oldOne = load('multiagent/v1');
  const newOne = load('craftorio/v1');
  assert.deepEqual(oldOne.steps.map((s) => s.id), ['only']);
  assert.deepEqual(oldOne.steps, newOne.steps);
});

test('T2c the bundled workflows declare apiVersion craftorio/v1', () => {
  const dir = path.join(__dirname, '..', '..', '..', 'workflows');
  for (const f of fs.readdirSync(dir).filter((x) => /\.ya?ml$/.test(x))) {
    const m = fs.readFileSync(path.join(dir, f), 'utf8').match(/^apiVersion:\s*(\S+)/m);
    if (m) assert.equal(m[1], 'craftorio/v1', f);
  }
});
