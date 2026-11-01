// #372: the Project map workflow seen from the service. workflows:list lists project-map.yaml with
// its cartographer; architecture:city tells the Architecture tab when to suggest "Refresh the map"
// (without starting anything): its result gains `refresh: { suggested, unmatchedShare, newFolders }`
// (CityModel.refreshSignal of the city it returns, see test/project-map-372.test.js): suggested when
// more than 5% of the drawn files match no rule of the saved plan, or a top-level folder has files
// and none matches a rule; never without a saved plan ("Map this project" instead).
// The workflow and the field are created by the change: each test reads them through the service.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { makeService } = require('@multiagent/engine/test/service/helpers');

function tmp(t, prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3 }));
  return dir;
}

function repoWith(t, files) {
  const dir = tmp(t, 'map372-repo-');
  const git = (args, env = {}) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'init.defaultBranch=main', '-c', 'core.autocrlf=false', ...args], { cwd: dir, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim();
  git(['init', '-q']);
  for (const rel of files) {
    const file = path.join(dir, ...rel.split('/'));
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, `// ${rel}\n`);
  }
  const date = '2026-01-05T12:00:00Z';
  git(['add', '-A']);
  git(['commit', '-q', '--no-verify', '-m', 'first'], { GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date });
  return dir;
}

const many = (folder, n) => Array.from({ length: n }, (_, i) => `${folder}/f${String(i).padStart(2, '0')}.js`);

const PLAN = {
  version: 1, project: 'fixture', summary: 'A fixture.', ignore: [],
  zones: [{ id: 'core', name: 'Core', kind: 'industrial', purpose: 'x' }],
  districts: [{ id: 'engine', name: 'Engine', zone: 'core', purpose: 'x', include: ['/src/**'], exclude: [] }],
  landmarks: [], ports: [], evidence: [],
};

async function setup(t, files) {
  const { service, api } = makeService(t);
  const project = await api['projects:create']({ name: 'map', folder: repoWith(t, files) });
  return { service, api, projectId: project.id };
}

test('#372 #631 workflows:list lists analyze-project.yaml with its cartographer', (t) => {
  const { api } = makeService(t);
  const wf = api['workflows:list']().find((w) => w.file === 'analyze-project.yaml');
  assert.ok(wf, 'analyze-project.yaml is listed');
  assert.equal(wf.name, 'analyze-project');
  assert.ok(wf.agents.cartographer, 'the cartographer');
  assert.equal(wf.merge, 'none', 'nothing is merged into the project');
});

test('#372 architecture:city suggests a refresh when a new top-level folder appears', async (t) => {
  const { api, projectId } = await setup(t, [...many('src', 30), 'tools/gen.js']);
  await api['architecture:savePlan']({ projectId, plan: PLAN });
  const out = await api['architecture:city']({ projectId });
  assert.ok(out.refresh, 'architecture:city returns refresh');
  assert.equal(out.refresh.suggested, true);
  assert.equal(out.refresh.newFolders.join(','), 'tools');
});

test('#372 architecture:city suggests no refresh when the saved plan still covers the files', async (t) => {
  const { api, projectId } = await setup(t, many('src', 30));
  await api['architecture:savePlan']({ projectId, plan: PLAN });
  const out = await api['architecture:city']({ projectId });
  assert.ok(out.refresh, 'architecture:city returns refresh');
  assert.equal(out.refresh.suggested, false);
});

test('#372 architecture:city suggests no refresh without a saved plan', async (t) => {
  const { api, projectId } = await setup(t, [...many('src', 3), 'tools/gen.js']);
  const out = await api['architecture:city']({ projectId });
  assert.ok(out.refresh, 'architecture:city returns refresh');
  assert.equal(out.refresh.suggested, false);
});

test('#372 architecture:city starts no run when it suggests a refresh', async (t) => {
  const { api, service, projectId } = await setup(t, [...many('src', 30), 'tools/gen.js']);
  await api['architecture:savePlan']({ projectId, plan: PLAN });
  const out = await api['architecture:city']({ projectId });
  assert.equal(out.refresh && out.refresh.suggested, true);
  const runsDir = service.workspace().runs;
  const runs = fs.existsSync(runsDir) ? fs.readdirSync(runsDir) : [];
  assert.equal(runs.length, 0, 'no run folder');
});
