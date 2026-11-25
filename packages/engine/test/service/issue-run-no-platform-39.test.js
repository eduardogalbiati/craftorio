// #39 acceptance, written before the code: the issue workflow's run on a project with no repository (its filer runs
// nothing, workflows/issue.yaml) records no git_platform, or records it as local; a project with a repository keeps
// the platform it was started with. Seams: projects:create / projects:update, run:start, run:stop, runs:resume and
// runs:active (simulated runs of the bundled issue.yaml, or of an older copy of it in the workspace), and the skills a
// turn of issue.yaml's agents gets (WorkflowRun.skillNames, as language-skills-run-340).
process.env.CRAFTORIO_MOCK_DELAY_SCALE ??= '0.05';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { WorkflowRun } = require('../../engine/workflow');
const { makeService, until, watchRuns } = require('./helpers');

const ROOT = path.join(__dirname, '..', '..', '..', '..');
const BUNDLED = path.join(ROOT, 'workflows', 'issue.yaml');

async function setup(t, { repo = null } = {}) {
  const { service, api } = makeService(t);
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'service-issue-39-'));
  t.after(() => fs.rmSync(folder, { recursive: true, force: true, maxRetries: 3 }));
  const p = await api['projects:create']({ name: 'lista de compras', folder });
  if (repo) await api['projects:update']({ id: p.id, patch: { repo } });
  const started = [];
  service.events.on('run:event', (ev) => { if (ev.type === 'workflow.started') started.push(ev); });
  return { service, api, folder, p, started, ...watchRuns(service) };
}
async function recorded(f, runId) {
  await until(() => f.gates.has(runId));
  const live = f.api['runs:active']().find((r) => r.runId === runId);
  const event = f.started.find((e) => e.run_id === runId);
  return [live.inputs?.git_platform ?? '', event?.inputs?.git_platform ?? ''];
}
const start = (f, { file = 'issue.yaml', inputs = {} } = {}) => f.api['run:start']({ file, inputs: { request: 'Export the list as CSV', project_path: f.folder, ...inputs }, mock: true, projectId: f.p.id });
async function recordedPlatform(t, { repo = null, inputs = {} } = {}) {
  const f = await setup(t, { repo });
  return recorded(f, (await start(f, { inputs })).runId);
}
const NONE = ['', 'local'];

test('#39 a simulated issue run on a project with no repository records no platform', async (t) => {
  const values = await recordedPlatform(t);
  assert.equal(values.every((v) => NONE.includes(v)), true, `git_platform: ${JSON.stringify(values)}`);
});

test('#39 a project with a repository keeps the platform its issue run was started with', async (t) => {
  assert.deepEqual(await recordedPlatform(t, { repo: 'https://gitlab.com/o/lista', inputs: { git_platform: 'gl' } }), ['gl', 'gl']);
});

test('#39 an older copy of issue.yaml in the workspace, which does not know local, still starts and keeps its platform', async (t) => {
  const f = await setup(t);
  const bundled = fs.readFileSync(BUNDLED, 'utf8');
  const older = bundled.replace('options: { gh: GitHub, gl: GitLab, local: Local }', 'options: { gh: GitHub, gl: GitLab }');
  assert.notEqual(older, bundled, 'the copy differs from the bundled file');
  fs.writeFileSync(path.join(f.service.workspace().workflows, 'issue.yaml'), older);
  assert.deepEqual(await recorded(f, (await start(f)).runId), ['gh', 'gh']);
});

for (const [repo, platform] of [['https://gitlab.com/o/lista', 'gl'], ['https://github.com/o/lista', 'gh']]) {
  test(`#39 an issue run started with no repository and resumed once the project has one (${repo}) records its platform`, async (t) => {
    const f = await setup(t);
    const { runId } = await start(f);
    await until(() => f.gates.has(runId));
    f.api['run:stop']({ runId });
    await until(() => f.finished.has(runId));
    await f.api['projects:update']({ id: f.p.id, patch: { repo } });
    const step = (await f.api['runs:resumeOptions']({ runId })).steps[0].id;
    const resumed = await f.api['runs:resume']({ runId, step });
    assert.deepEqual(await recorded(f, resumed.runId), [platform, platform]);
  });
}

for (const [platform, skill] of [['local', 'issue-creator-gh'], ['gh', 'issue-creator-gh'], ['gl', 'issue-creator-gl']]) {
  test(`#39 with git_platform ${platform} issue.yaml's agents get the ${skill} skill, which exists`, (t) => {
    const runsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'runs-39-'));
    t.after(() => fs.rmSync(runsDir, { recursive: true, force: true, maxRetries: 3 }));
    const run = new WorkflowRun({ file: BUNDLED, inputs: { request: 'x', project_path: ROOT, git_platform: platform }, mock: true, runsDir });
    const names = Object.values(run.wf.agents).flatMap((a) => run.skillNames(a.skills || [])).filter((n) => n.startsWith('issue-creator-'));
    assert.deepEqual([...new Set(names)], [skill]);
    assert.equal(names.length, 2, 'the analyzer and the filer');
    assert.equal(fs.existsSync(path.join(ROOT, 'skills', skill)), true);
  });
}
