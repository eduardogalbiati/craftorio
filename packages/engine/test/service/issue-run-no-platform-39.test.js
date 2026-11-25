// #39 acceptance, written before the code: the issue workflow's run on a project with no repository (its filer runs
// nothing, workflows/issue.yaml) records no git_platform, or records it as local; a project with a repository keeps
// the platform it was started with. Seams: projects:create / projects:update, run:start and runs:active (simulated
// runs of the bundled issue.yaml).
process.env.CRAFTORIO_MOCK_DELAY_SCALE ??= '0.05';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { makeService, until, watchRuns } = require('./helpers');

async function recordedPlatform(t, { repo = null, inputs = {} } = {}) {
  const { service, api } = makeService(t);
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'service-issue-39-'));
  t.after(() => fs.rmSync(folder, { recursive: true, force: true, maxRetries: 3 }));
  const p = await api['projects:create']({ name: 'lista de compras', folder });
  if (repo) await api['projects:update']({ id: p.id, patch: { repo } });
  const { gates } = watchRuns(service);
  const started = [];
  service.events.on('run:event', (ev) => { if (ev.type === 'workflow.started') started.push(ev); });
  const { runId } = await api['run:start']({ file: 'issue.yaml', inputs: { request: 'Export the list as CSV', project_path: folder, ...inputs }, mock: true, projectId: p.id });
  await until(() => gates.has(runId));
  const live = api['runs:active']().find((r) => r.runId === runId);
  const event = started.find((e) => e.run_id === runId);
  return [live.inputs?.git_platform ?? '', event?.inputs?.git_platform ?? ''];
}
const NONE = ['', 'local'];

test('#39 a simulated issue run on a project with no repository records no platform', async (t) => {
  const recorded = await recordedPlatform(t);
  assert.equal(recorded.every((v) => NONE.includes(v)), true, `git_platform: ${JSON.stringify(recorded)}`);
});

test('#39 a project with a repository keeps the platform its issue run was started with', async (t) => {
  assert.deepEqual(await recordedPlatform(t, { repo: 'https://gitlab.com/o/lista', inputs: { git_platform: 'gl' } }), ['gl', 'gl']);
});
