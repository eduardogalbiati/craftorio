// #799: the seed of --view resume reads, through the real runs:resumeOptions, as the states its
// screenshots show: the dialog at Develop with the run's model and effort and, with --mode limit, the
// provider's weekly limit and what the developer's next turn re-reads.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { makeService } = require('../packages/engine/test/service/helpers');
const projects = require('../packages/engine/domains/project/projects');
const { parseArgs, VIEWS } = require('../scripts/screenshot');

async function seededOptions(t, argv) {
  const { service, api } = makeService(t);
  const ws = service.workspace();
  const project = await projects.createProject(ws.projects, { name: 'demo-app' });
  await VIEWS.resume.seed({ args: parseArgs(argv), project, ws });
  const [runId] = fs.readdirSync(ws.runs).filter((d) => fs.existsSync(path.join(ws.runs, d, 'events.jsonl')));
  return api['runs:resumeOptions']({ runId });
}

test('#799 --view resume: the failed run suggests Develop and offers the model and the effort', async (t) => {
  const o = await seededOptions(t, ['--view', 'resume']);
  assert.equal(o.suggested, 'develop');
  assert.equal(o.limit, null);
  assert.equal(o.inputs.developer_model, 'claude-fable-5-1');
  assert.equal(o.inputs.developer_effort, 'high');
  assert.deepEqual(Object.keys(o.inputDefs).sort(), ['developer_effort', 'developer_model']);
});

test('#799 --view resume --mode limit: the run names the weekly limit and what its next turn re-reads', async (t) => {
  const o = await seededOptions(t, ['--view', 'resume', '--mode', 'limit']);
  assert.equal(o.suggested, 'develop');
  assert.match(String(o.limit), /weekly limit/i);
  assert.equal(o.providerLimit, true);
  assert.equal(o.turns.length, 1);
  assert.equal(o.turns[0].agent, 'developer');
});
