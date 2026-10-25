// #473 (SEC-8): a save_as the containment rule refuses fails the step with that reason, in a step
// without an output schema and in one with a schema (not an invalid output retried). Seam: a mock
// run of a one-step inline workflow (no worktree, nothing installed), as test/protect-files.test.js.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { WorkflowRun } = require('../engine/workflow');

process.env.MULTIAGENT_MOCK_DELAY_SCALE = '0.05';

function tmpDir(t, prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5 }));
  return dir;
}

// The run folder is <dir>/a/b/runs/<id>: "../../../escaped.md" lands in <dir>/a, outside it
async function mockRun(t, schemaLines) {
  const dir = tmpDir(t, 'save-as-step-473-');
  const file = path.join(dir, 'wf.yaml');
  fs.writeFileSync(file, [
    'providers:',
    '  claude: { type: claude-code, command: claude }',
    'agents:',
    '  dev: { provider: claude, model: m, session: ephemeral }',
    'steps:',
    '  - id: develop',
    '    agent: dev',
    '    prompt: "Write it."',
    '    save_as: "../../../escaped.md"',
    ...schemaLines,
    '    transitions:',
    '      - { when: "true", goto: end }',
    '',
  ].join('\n'));
  const run = new WorkflowRun({ file, inputs: {}, mock: true, runsDir: path.join(dir, 'a', 'b', 'runs'), skillsDirs: [] });
  const events = [];
  run.on('event', (ev) => events.push(ev));
  await run.start();
  const escaped = path.resolve(run.runDir, '../../../escaped.md');
  return { events, escaped };
}

const finished = (events) => events.find((e) => e.type === 'workflow.finished') || {};

test('#473 a refused save_as fails a step without an output schema', { timeout: 60000 }, async (t) => {
  const { events, escaped } = await mockRun(t, []);
  assert.match(String(finished(events).error), /save_as/i);
  assert.equal(fs.existsSync(escaped), false);
});

test('#473 a refused save_as fails a step with an output schema, without an invalid-output retry', { timeout: 60000 }, async (t) => {
  const { events, escaped } = await mockRun(t, [
    '    output_schema:',
    '      type: object',
    '      properties: { done: { type: boolean } }',
  ]);
  assert.match(String(finished(events).error), /save_as/i);
  assert.equal(events.filter((e) => e.type === 'log' && e.kind === 'invalid_output').length, 0);
  assert.equal(fs.existsSync(escaped), false);
});
