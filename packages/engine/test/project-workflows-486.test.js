// #486: a project's workflow set and default, read from the repository's manifest (#485's
// `.multiagent/project.yaml`, packages/engine/domains/project/project-manifest.js) when the project is created. Acceptance tests,
// written before the code.
//
// Spec (the interface these tests assume):
//   require('../domains/project/projects').projectManifest(target, { exec, fetch }) -> Promise of
//     - { workflows: [{ name, file?, category, description }] } (the manifest's entries, in order);
//     - null when the folder / repository has no manifest;
//     - { workflows: [], pending: true, message } when a remote repository cannot be read without
//       credentials (a private repository): message says it "will be read after cloning".
//     target: { folder } (read from the folder) or { url } (a remote repository, read before cloning:
//     the provider's contents API through `exec(cli, args)` (gh api / glab api; same signature as
//     packages/engine/domains/backlog/issues.js execCli: resolves with stdout), or an unauthenticated raw read with `fetch(url)`
//     for a public repository). `exec` and `fetch` are the only boundaries stubbed here.
//   Channel projects:manifest: one object argument, { url } or { folder } -> the same result; a
//     missing or non-object argument is refused (as #485's repository channels).
//   projects:create / projects:update accept `workflows: [{ name, origin, ... }]` and
//     `defaultWorkflow` (a workflow name; `.yaml` tolerated); the project record keeps both. Without
//     a `defaultWorkflow`, the default is the first checked workflow whose category is solo or team.
//     Created without workflows, the record is as today (no workflow set, no default).
//   The project's defaultWorkflow replaces Settings' default for that project's new items: the
//     Product Owner's roadmap.add (po:request) and its simulated plan (po:ask).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const MANIFEST = `version: 1
workflows:
  - name: backlog-refresh
    category: intake
    description: Refresh the issues
  - name: software-development
    category: team
    description: Pull requests, CI and CD
  - name: software-development-local-hero
    category: solo
`;
const MANIFEST_NAMES = ['backlog-refresh', 'software-development', 'software-development-local-hero'];

const bare = (v) => String(v ?? '').replace(/\.ya?ml$/i, '');
const names = (out) => (out?.workflows || []).map((w) => w.name);

function tempDir(t, prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }));
  return dir;
}

function folderWithManifest(t, text = MANIFEST) {
  const dir = tempDir(t, 'pj-wf-486-');
  fs.mkdirSync(path.join(dir, '.multiagent'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.multiagent', 'project.yaml'), text);
  return dir;
}

const projectManifest = (...args) => {
  const projects = require('../domains/project/projects');
  assert.equal(typeof projects.projectManifest, 'function', 'packages/engine/domains/project/projects.js exports projectManifest');
  return projects.projectManifest(...args);
};

// ---- the boundaries: the provider CLI (gh / glab api) and fetch ------------------------------------

const b64 = (s) => Buffer.from(s, 'utf8').toString('base64');
const response = (status, body) => ({ ok: status >= 200 && status < 300, status, statusText: String(status), text: async () => body, json: async () => JSON.parse(body) });
const notFoundFetch = async () => response(404, 'Not Found');

// A CLI that can read the repository: the manifest's file (raw when asked for raw, else the
// contents API's JSON with base64 content), and the repository itself for any other call.
function cliWithFile(cli, text) {
  const calls = [];
  const exec = async (name, args) => {
    calls.push([name, ...args]);
    if (name !== cli) throw new Error(`The ${name} CLI is not installed.`);
    const joined = args.join(' ');
    if (/project\.yaml|project%2Eyaml/i.test(joined)) {
      if (text == null) throw new Error(`${name} api failed: HTTP 404: Not Found`);
      if (/raw/i.test(joined)) return text;
      return JSON.stringify({ type: 'file', encoding: 'base64', content: b64(text), name: 'project.yaml', file_name: 'project.yaml', path: '.multiagent/project.yaml', file_path: '.multiagent/project.yaml' });
    }
    return JSON.stringify({ full_name: 'o/r', path_with_namespace: 'o/r', private: true, visibility: 'private', default_branch: 'main' });
  };
  return { exec, calls };
}

test('#486 projectManifest reads a GitHub repository\'s manifest through gh api before cloning', async (t) => {
  const { exec, calls } = cliWithFile('gh', MANIFEST);
  const reposDir = tempDir(t, 'pj-wf-486-repos-');
  const out = await projectManifest({ url: 'https://github.com/o/r.git' }, { exec, fetch: notFoundFetch });
  assert.deepEqual(names(out), MANIFEST_NAMES);
  assert.deepEqual(out.workflows.map((w) => w.category), ['intake', 'team', 'solo']);
  assert.notEqual(out.pending, true);
  assert.ok(calls.some((c) => c[0] === 'gh' && c[1] === 'api'), 'gh api was asked');
  assert.equal(calls.some((c) => c.includes('clone')), false, 'nothing is cloned');
  assert.deepEqual(fs.readdirSync(reposDir), []);
});

test('#486 projectManifest reads a GitLab repository\'s manifest through glab api', async () => {
  const { exec, calls } = cliWithFile('glab', MANIFEST);
  const out = await projectManifest({ url: 'https://gitlab.com/o/r.git' }, { exec, fetch: notFoundFetch });
  assert.deepEqual(names(out), MANIFEST_NAMES);
  assert.ok(calls.some((c) => c[0] === 'glab' && c[1] === 'api'), 'glab api was asked');
});

test('#486 projectManifest reads a public repository\'s manifest with an unauthenticated raw read when no CLI can', async () => {
  const exec = async (name) => { throw new Error(`The ${name} CLI is not installed (see Settings › Agents & CLIs).`); };
  const fetch = async (url) => (/project\.yaml/.test(String(url)) ? response(200, MANIFEST) : response(200, '{}'));
  const out = await projectManifest({ url: 'https://github.com/o/r' }, { exec, fetch });
  assert.deepEqual(names(out), MANIFEST_NAMES);
});

test('#486 projectManifest of a remote repository without a manifest is null', async () => {
  const { exec } = cliWithFile('gh', null);
  const out = await projectManifest({ url: 'https://github.com/o/r.git' }, { exec, fetch: notFoundFetch });
  assert.equal(out, null);
});

test('#486 projectManifest of a private repository without credentials says it will be read after cloning', async () => {
  const exec = async (name) => { throw new Error(`${name} api failed: HTTP 401: Requires authentication. To get started with GitHub CLI, please run: gh auth login`); };
  const out = await projectManifest({ url: 'https://github.com/o/private.git' }, { exec, fetch: notFoundFetch });
  assert.ok(out, 'not null: the manifest may exist');
  assert.equal(out.pending, true);
  assert.match(String(out.message || ''), /after cloning/i);
  assert.deepEqual(names(out), []);
});

test('#486 projectManifest reads a local folder\'s manifest', async (t) => {
  const out = await projectManifest({ folder: folderWithManifest(t) }, { exec: async () => { throw new Error('no CLI for a folder'); }, fetch: notFoundFetch });
  assert.deepEqual(names(out), MANIFEST_NAMES);
});

test('#486 projectManifest of a folder without a manifest is null', async (t) => {
  const out = await projectManifest({ folder: tempDir(t, 'pj-wf-486-empty-') });
  assert.equal(out, null);
});

test('#486 projectManifest of a folder whose manifest is not valid YAML returns its errors and no workflows', async (t) => {
  const out = await projectManifest({ folder: folderWithManifest(t, 'version: 1\nworkflows: [\n  - name: a\n') });
  assert.ok(out, 'not null: the manifest exists');
  assert.ok(Array.isArray(out.errors) && out.errors.length > 0, `errors reported: ${JSON.stringify(out.errors)}`);
  assert.match(String(out.errors[0]), /not valid YAML/i);
  assert.deepEqual(names(out), []);
});

// ---- createProject on a repository it clones (the git runner is the boundary) -------------------

// A git runner whose clone makes the folder a repository holding `.multiagent/project.yaml`
function cloningGit(text = MANIFEST) {
  const calls = [];
  const git = async (args) => {
    calls.push(args.join(' '));
    if (args[0] === 'clone') {
      const folder = args[2];
      fs.mkdirSync(path.join(folder, '.git'), { recursive: true });
      fs.mkdirSync(path.join(folder, '.multiagent'), { recursive: true });
      fs.writeFileSync(path.join(folder, '.multiagent', 'project.yaml'), text);
    }
    return '';
  };
  return { git, calls };
}

// #639: the clone is a background job; the project once it ended (status no longer 'cloning')
async function cloned(projects, dir, id) {
  for (let i = 0; i < 300; i++) {
    const p = projects.readProject(dir, id);
    if (p.status !== 'cloning') return p;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error(`project ${id} still cloning after 3 s`);
}

test('#486 createProject on a freshly cloned repository with no workflows checked adopts the clone\'s manifest and derives the default', async (t) => {
  const root = tempDir(t, 'pj-wf-486-clone-');
  const { git, calls } = cloningGit();
  const projects = require('../domains/project/projects');
  const created = await projects.createProject(path.join(root, 'projects'), { name: 'Cloned', repo: 'https://github.com/o/r.git' }, { git, reposDir: path.join(root, 'repos') });
  const p = await cloned(projects, path.join(root, 'projects'), created.id);
  assert.equal(p.status, 'ready');
  assert.ok(calls.some((c) => c.startsWith('clone ')), 'the repository was cloned');
  assert.deepEqual(setOf(p), MANIFEST_NAMES.map((n) => `${n}:manifest`));
  // the first solo/team/build entry of the manifest (backlog-refresh is intake)
  assert.equal(bare(p.defaultWorkflow), 'software-development');
  const saved = projects.readProject(path.join(root, 'projects'), p.id);
  assert.deepEqual(setOf(saved), MANIFEST_NAMES.map((n) => `${n}:manifest`), 'written on the record');
  assert.equal(bare(saved.defaultWorkflow), 'software-development');
});

test('#486 createProject on a freshly cloned repository keeps the checked workflows, not the clone\'s manifest', async (t) => {
  const root = tempDir(t, 'pj-wf-486-clone-checked-');
  const { git } = cloningGit();
  const projects = require('../domains/project/projects');
  const workflows = [{ name: 'writer-reviewer', origin: 'bundled', category: 'build' }];
  const created = await projects.createProject(path.join(root, 'projects'), { name: 'Checked', repo: 'https://github.com/o/r.git', workflows }, { git, reposDir: path.join(root, 'repos') });
  const p = await cloned(projects, path.join(root, 'projects'), created.id);
  assert.deepEqual(setOf(p), ['writer-reviewer:bundled']);
  assert.equal(bare(p.defaultWorkflow), 'writer-reviewer');
});

// ---- the channel ---------------------------------------------------------------------------------

function service(t) {
  const { makeService } = require('./service/helpers');
  return makeService(t);
}

test('#486 projects:manifest { folder } answers the manifest\'s entries, null without one', async (t) => {
  const { api } = service(t);
  assert.equal(typeof api['projects:manifest'], 'function', 'the projects:manifest channel exists');
  const out = await api['projects:manifest']({ folder: folderWithManifest(t) });
  assert.deepEqual(names(out), MANIFEST_NAMES);
  assert.equal(await api['projects:manifest']({ folder: tempDir(t, 'pj-wf-486-none-') }), null);
});

// A self-hosted host (no gh / glab adapter): the channel reads the raw file with the global fetch,
// stubbed here, so neither a CLI nor the network is reached
function stubGlobalFetch(t, fn) {
  const original = globalThis.fetch;
  const urls = [];
  globalThis.fetch = async (url, ...rest) => { urls.push(String(url)); return fn(String(url), ...rest); };
  t.after(() => { globalThis.fetch = original; });
  return urls;
}

test('#486 projects:manifest { url } of a public self-hosted repository reads the raw manifest through fetch', async (t) => {
  const { api } = service(t);
  const urls = stubGlobalFetch(t, async (url) => (/\.multiagent\/project\.yaml$/.test(url) ? response(200, MANIFEST) : response(404, 'Not Found')));
  const out = await api['projects:manifest']({ url: 'https://git.example.test/o/r.git' });
  assert.deepEqual(names(out), MANIFEST_NAMES);
  assert.deepEqual(urls, ['https://git.example.test/o/r/-/raw/HEAD/.multiagent/project.yaml']);
});

test('#486 projects:manifest { url } that cannot be read (offline) says it will be read after cloning', async (t) => {
  const { api } = service(t);
  stubGlobalFetch(t, async () => { throw new Error('getaddrinfo ENOTFOUND git.example.test'); });
  const out = await api['projects:manifest']({ url: 'https://git.example.test/o/r.git' });
  assert.equal(out?.pending, true);
  assert.match(String(out.message || ''), /after cloning/i);
  assert.deepEqual(names(out), []);
});

test('#486 projects:manifest refuses a missing or non-object argument', async (t) => {
  const { api } = service(t);
  assert.equal(typeof api['projects:manifest'], 'function', 'the projects:manifest channel exists');
  await assert.rejects(async () => api['projects:manifest']());
  await assert.rejects(async () => api['projects:manifest']('C:/somewhere'));
});

// ---- the project record --------------------------------------------------------------------------

const projectFile = (svc, id) => JSON.parse(fs.readFileSync(path.join(svc.workspace().projects, `${id}.json`), 'utf8'));
const setOf = (p) => (p.workflows || []).map((w) => `${w.name}:${w.origin}`);

test('#486 projects:create keeps the workflow set and the given default on the record', async (t) => {
  const { api, service: svc } = service(t);
  const workflows = [
    { name: 'backlog-refresh', origin: 'manifest', category: 'intake' },
    { name: 'software-development', origin: 'manifest', category: 'team' },
  ];
  const p = await api['projects:create']({ name: 'wf-486', folder: folderWithManifest(t), workflows, defaultWorkflow: 'software-development' });
  assert.deepEqual(setOf(p), ['backlog-refresh:manifest', 'software-development:manifest']);
  assert.equal(bare(p.defaultWorkflow), 'software-development');
  const saved = projectFile(svc, p.id);
  assert.deepEqual(setOf(saved), ['backlog-refresh:manifest', 'software-development:manifest'], 'written in <workspace>/projects/<id>.json');
  assert.equal(bare(saved.defaultWorkflow), 'software-development');
  const listed = (await api['projects:list']()).find((x) => x.id === p.id);
  assert.equal(bare(listed.defaultWorkflow), 'software-development');
});

test('#486 without a given default, the default is the first checked solo or team workflow', async (t) => {
  const { api } = service(t);
  const soloFirst = await api['projects:create']({
    name: 'wf-486-solo',
    folder: folderWithManifest(t),
    workflows: [
      { name: 'backlog-refresh', origin: 'manifest', category: 'intake' },
      { name: 'software-development-local-hero', origin: 'manifest', category: 'solo' },
      { name: 'software-development', origin: 'manifest', category: 'team' },
    ],
  });
  assert.equal(bare(soloFirst.defaultWorkflow), 'software-development-local-hero');
  const teamFirst = await api['projects:create']({
    name: 'wf-486-team',
    folder: folderWithManifest(t),
    workflows: [
      { name: 'backlog-refresh', origin: 'manifest', category: 'intake' },
      { name: 'software-development', origin: 'manifest', category: 'team' },
      { name: 'software-development-local-hero', origin: 'manifest', category: 'solo' },
    ],
  });
  assert.equal(bare(teamFirst.defaultWorkflow), 'software-development');
});

test('#486 a project created without workflows keeps today\'s record (no set, no default)', async (t) => {
  const { api, service: svc } = service(t);
  const p = await api['projects:create']({ name: 'wf-486-plain', folder: tempDir(t, 'pj-wf-486-plain-') });
  const saved = projectFile(svc, p.id);
  assert.equal((saved.workflows || []).length, 0);
  assert.equal(saved.defaultWorkflow ?? null, null);
});

test('#486 projects:update changes the workflow set and the default (the project page\'s block)', async (t) => {
  const { api, service: svc } = service(t);
  const p = await api['projects:create']({ name: 'wf-486-edit', folder: tempDir(t, 'pj-wf-486-edit-') });
  const patch = { workflows: [{ name: 'writer-reviewer', origin: 'bundled' }, { name: 'software-development', origin: 'bundled' }], defaultWorkflow: 'software-development' };
  const next = await api['projects:update']({ id: p.id, patch });
  assert.deepEqual(setOf(next), ['writer-reviewer:bundled', 'software-development:bundled']);
  assert.equal(bare(next.defaultWorkflow), 'software-development');
  assert.equal(bare(projectFile(svc, p.id).defaultWorkflow), 'software-development');
});

// ---- the project's default for new items: roadmap.add and the Product Owner ---------------------

const OTHER_WORKFLOW = (issueWorkflow) => issueWorkflow.replace('name: fixture-issue', 'name: fixture-other');

// Two projects on one synced backlog each: `own` with defaultWorkflow fixture-other, `plain` without
// one; Settings' default is fixture-issue.yaml.
async function twoProjects(t) {
  const { makeService, ISSUE_WORKFLOW } = require('./service/helpers');
  const { service: svc, api } = makeService(t);
  const ws = svc.workspace();
  fs.writeFileSync(path.join(ws.workflows, 'fixture-issue.yaml'), ISSUE_WORKFLOW);
  fs.writeFileSync(path.join(ws.workflows, 'fixture-other.yaml'), OTHER_WORKFLOW(ISSUE_WORKFLOW));
  await api['settings:set']({ defaultWorkflow: 'fixture-issue.yaml' });
  const issue = (number) => ({ number, title: `Issue ${number}`, state: 'open', url: `https://github.com/o/r/issues/${number}`, body: 'Do it', labels: [], assignees: [], tasks: { done: 0, total: 0 } });
  fs.mkdirSync(ws.backlog, { recursive: true });
  const make = async (name, extra) => {
    const p = await api['projects:create']({ name, folder: tempDir(t, `pj-wf-486-${name}-`), ...extra });
    fs.writeFileSync(path.join(ws.backlog, `${p.id}.json`), JSON.stringify({ projectId: p.id, platform: 'github', repo: 'https://github.com/o/r', issues: [1, 2].map(issue) }));
    return p;
  };
  const own = await make('own', { workflows: [{ name: 'fixture-other', origin: 'workspace' }, { name: 'fixture-issue', origin: 'workspace' }], defaultWorkflow: 'fixture-other' });
  const plain = await make('plain', {});
  return { api, own, plain };
}

const itemWorkflows = (roadmap) => (roadmap?.stages || []).flatMap((s) => (s.items || []).map((x) => x.workflow));

test('#486 the Product Owner\'s roadmap.add puts a new item on the project\'s default, not Settings\' default', async (t) => {
  const { api, own, plain } = await twoProjects(t);
  const add = (p) => api['po:request']({ projectId: p.id, kind: 'roadmap.add', params: { issues: [1] }, reason: 'ready', from: 'oracle', ref: `r-${p.id}`, mock: true });
  const plainOut = await add(plain);
  assert.equal(plainOut.ok, true, JSON.stringify(plainOut));
  assert.deepEqual(itemWorkflows(await api['roadmap:get']({ projectId: plain.id })), ['fixture-issue.yaml'], 'a project without a default keeps Settings\' default');
  const ownOut = await add(own);
  assert.equal(ownOut.ok, true, JSON.stringify(ownOut));
  assert.deepEqual(itemWorkflows(await api['roadmap:get']({ projectId: own.id })), ['fixture-other.yaml']);
});

test('#486 the Product Owner\'s simulated plan puts its groups on the project\'s default', async (t) => {
  const { api, own, plain } = await twoProjects(t);
  const ask = (p) => api['po:ask']({ projectId: p.id, question: 'Analyze the backlog and propose runs', mock: true });
  const groupsOf = (out) => (out?.message?.answer?.groups || []).map((g) => g.workflow);
  const plainGroups = groupsOf(await ask(plain));
  assert.ok(plainGroups.length, 'the simulated plan has groups');
  assert.deepEqual([...new Set(plainGroups)], ['fixture-issue.yaml'], 'without a project default: Settings\' default');
  const ownGroups = groupsOf(await ask(own));
  assert.ok(ownGroups.length, 'the simulated plan has groups');
  assert.deepEqual([...new Set(ownGroups)], ['fixture-other.yaml']);
});
