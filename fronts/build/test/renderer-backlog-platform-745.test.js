// #745: the Backlog / Roadmap use the header project's platform (its repository's host, or the platform
// stored on a self-hosted project), never a global select. backlog.js runs only inside the Electron
// renderer, so its pieces are pulled out of the source and evaluated in a sandbox (as
// renderer-run-summary.test.js does): selectProject (the header's project), the render block of the
// platform select / badge and the select's change handler (a self-hosted project).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const Platforms = require('@craftorio/shared/platforms');

const pageFileOf = (rel) => require('../../../scripts/source-tree').pageFile(path.join(__dirname, '..', '..', '..'), rel);
const src = fs.readFileSync(pageFileOf('views/backlog/backlog.js'), 'utf8');

function piece(name, re) {
  const m = re.exec(src);
  assert.ok(m, `${name} not found in views/backlog/backlog.js: the source moved`);
  return m[0];
}

const PROJECT_LINE = piece('project', /const project = \(\) => [^\n]+/);
const KNOWN_LINE = piece('knownPlatform', /const knownPlatform = \(\) => [^\n]+/);
const SELECT_PROJECT = piece('selectProject', /async function selectProject\(id\) \{[\s\S]*?\n {2}\}/);
const PLATFORM_BLOCK = piece('the platform select / badge', /const plat = \$b\('#bl-platform'\);[\s\S]*?Object\.assign\(badge[^\n]+/);
const ON_CHANGE = piece('#bl-platform onchange', /\$b\('#bl-platform'\)\.onchange = \(e\) => \{[\s\S]*?\n {4}\};/);

const PROJECTS = [
  { id: 'gh', name: 'Orchestrator', repo: 'https://github.com/o/r' },
  { id: 'gl', name: 'Pharmaged', repo: 'https://gitlab.com/eduardogalbiati/pharmaged' },
  { id: 'sh', name: 'Corp', repo: 'https://git.company.com/team/r', platform: 'gitlab' },
  { id: 'unknown', name: 'Corp 2', repo: 'https://git.company.com/team/other' },
];

const classList = () => {
  const set = new Set();
  return { toggle: (c, on) => (on ? set.add(c) : set.delete(c)), contains: (c) => set.has(c), add: (c) => set.add(c) };
};

function sandboxFor({ projects = PROJECTS, cached = null } = {}) {
  const els = { '#bl-platform': { innerHTML: '', value: '', classList: classList() }, '#bl-platform-badge': { textContent: '', title: '', classList: classList() } };
  const box = {
    window: { Platforms },
    state: { view: 'roadmap', settings: { backlogPlatform: 'github' } },
    bl: { projects: projects.map((p) => ({ ...p })), projectId: null, seq: 0, expanded: new Set(), selected: new Set(), platform: null, data: null, error: null },
    PLATFORMS: { github: { label: 'GitHub' }, gitlab: { label: 'GitLab' }, bitbucket: { label: 'Bitbucket', soon: true } },
    DEFAULT_PLATFORM: 'github',
    synced: [],
    updates: [],
    api: { getBacklog: async () => cached, updateProject: async (id, patch) => { box.updates.push([id, JSON.stringify(patch)]); } },
    els,
    $b: (sel) => els[sel],
    t: (k) => k,
    esc: (s) => String(s),
    errMsg: (e) => String(e?.message || e),
    loadLabels: () => [],
    setData: (d) => { box.bl.data = d; },
    render: () => {},
    openStage: () => {},
  };
  box.sync = () => { box.synced.push(box.bl.platform); };
  vm.createContext(box);
  vm.runInContext(`var stageToShow = null;\n${PROJECT_LINE}\n${KNOWN_LINE}\n${SELECT_PROJECT}\n`
    + `function drawPlatform() {\n${PLATFORM_BLOCK}\n}\n`
    + `function mountPlatform() {\n${ON_CHANGE}\n}\n`
    + 'this.selectProject = selectProject; this.drawPlatform = drawPlatform; this.mountPlatform = mountPlatform;', box);
  return box;
}

test('#745 a GitLab project\'s Roadmap syncs with GitLab on open, whatever the global setting says', async () => {
  const box = sandboxFor();
  await box.selectProject('gl');
  assert.deepEqual([box.bl.platform, box.synced.join(',')], ['gitlab', 'gitlab']);
});

test('#745 switching the header\'s project GitHub ↔ GitLab switches the platform', async () => {
  const box = sandboxFor();
  await box.selectProject('gh');
  await box.selectProject('gl');
  await box.selectProject('gh');
  assert.deepEqual(box.synced, ['github', 'gitlab', 'github']);
});

test('#745 a self-hosted project syncs with the platform stored on it', async () => {
  const box = sandboxFor();
  await box.selectProject('sh');
  assert.deepEqual([box.bl.platform, box.synced.join(',')], ['gitlab', 'gitlab']);
});

test('#745 a stale cache of another platform does not win over the project\'s', async () => {
  const box = sandboxFor({ cached: { platform: 'github', issues: [] } });
  await box.selectProject('gl');
  assert.equal(box.bl.platform, 'gitlab');
});

test('#745 a known platform shows a badge with its name and hides the select', async () => {
  const box = sandboxFor();
  await box.selectProject('gl');
  box.drawPlatform();
  const sel = box.els['#bl-platform'], badge = box.els['#bl-platform-badge'];
  assert.deepEqual([sel.classList.contains('hidden'), badge.classList.contains('hidden'), badge.textContent], [true, false, 'GitLab']);
});

test('#745 an unknown self-hosted host keeps the select and no badge', async () => {
  const box = sandboxFor();
  await box.selectProject('unknown');
  box.drawPlatform();
  const sel = box.els['#bl-platform'], badge = box.els['#bl-platform-badge'];
  assert.deepEqual([sel.classList.contains('hidden'), badge.classList.contains('hidden')], [false, true]);
});

test('#745 picking a platform for a self-hosted project saves it on the project (projects:update), not as a global setting', async () => {
  const box = sandboxFor();
  await box.selectProject('unknown');
  box.mountPlatform();
  box.els['#bl-platform'].onchange({ target: { value: 'gitlab' } });
  await new Promise((r) => setImmediate(r));
  assert.deepEqual([box.updates.map((u) => u.join(' ')).join('|'), box.state.settings.backlogPlatform, box.synced.at(-1)], ['unknown {"platform":"gitlab"}', 'github', 'gitlab']);
});

test('#745 a platform not available yet (soon) is not saved on the project', async () => {
  const box = sandboxFor();
  await box.selectProject('unknown');
  box.mountPlatform();
  box.els['#bl-platform'].onchange({ target: { value: 'bitbucket' } });
  await new Promise((r) => setImmediate(r));
  assert.equal(box.updates.length, 0);
});
