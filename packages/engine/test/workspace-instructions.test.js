// #43: a session opened in the workspace folder takes the Oracle's role: opening a workspace leaves
// <workspace>/AGENTS.md, the bytes of workspace-instructions/AGENTS.workspace.md, and the Claude agents of
// a run do not load it. Acceptance tests written before the code.
// Seams: opening a workspace (setupWorkspace, then service.setWorkspace, as the app does; the server's
// bin); an app update through CRAFTORIO_APP_ROOT (a child process: appRoot() is cached); WorkflowRun whose
// "CLI" is test/fixtures/fake-claude-instructions.js (no model call), which records the files it loads.
// Assumptions: the default is read from the app root (app-root.js bundledDir), as the other defaults are;
// the CLI matches claudeMdExcludes with the real path of its folder (process.cwd()).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const { createService } = require('../service');
const { WorkflowRun } = require('../engine/workflow');
const { setupWorkspace } = require('../domains/workspace/workspace');
const { fixture, git } = require('./worktree-helpers');

const ROOT = path.join(__dirname, '..', '..', '..');
const TEXT = fs.readFileSync(path.join(ROOT, 'workspace-instructions', 'AGENTS.workspace.md'));
const FAKE = path.join(__dirname, 'fixtures', 'fake-claude-instructions.js').replace(/\\/g, '/');

function tmpDir(t, prefix) {
  const dir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }));
  return dir;
}

// A workspace folder; open() opens it as a new start of the app
function appWorkspace(t) {
  process.env.CRAFTORIO_SIMULATION_ONLY = '1';
  const cliHome = tmpDir(t, 'ws-instructions-home-');
  const dir = tmpDir(t, 'ws-instructions-');
  let service = null;
  t.after(() => service?.shutdown());
  return {
    dir,
    file: path.join(dir, 'AGENTS.md'),
    open() {
      service?.shutdown();
      service = createService({ host: { trashItem: async () => {}, appVersion: '9.9.9', isPackaged: false, cliHome } });
      service.setWorkspace(setupWorkspace(dir, { persist: false }));
    },
  };
}

const named = (dir, name) => fs.readdirSync(dir).filter((n) => n.toLowerCase() === name);
// 'same' rather than the bytes: a failure's message stays short
const same = (file, bytes) => {
  if (!fs.existsSync(file)) return 'missing';
  return fs.readFileSync(file).equals(Buffer.from(bytes)) ? 'same' : 'different';
};

// ---- seeded --------------------------------------------------------------------------------------

test('#43 opening a new workspace leaves AGENTS.md with the bytes of the app\'s text, and no CLAUDE.md', (t) => {
  const ws = appWorkspace(t);
  ws.open();
  assert.equal(same(ws.file, TEXT), 'same');
  assert.deepEqual(named(ws.dir, 'claude.md'), []);
});

test('#43 opening a workspace an older version left adds AGENTS.md, and no CLAUDE.md', (t) => {
  const ws = appWorkspace(t);
  setupWorkspace(ws.dir, { persist: false });
  fs.writeFileSync(path.join(ws.dir, 'settings.json'), JSON.stringify({ setupDone: true }));
  ws.open();
  assert.equal(same(ws.file, TEXT), 'same');
  assert.deepEqual(named(ws.dir, 'claude.md'), []);
});

test('#43 an edited AGENTS.md is left as it is at the next start', (t) => {
  const ws = appWorkspace(t);
  ws.open();
  assert.equal(same(ws.file, TEXT), 'same');
  fs.appendFileSync(ws.file, '\nMy own rule.\n');
  const edited = fs.readFileSync(ws.file);
  ws.open();
  assert.equal(same(ws.file, edited), 'same');
});

test('#43 a deleted AGENTS.md does not come back at the next start', (t) => {
  const ws = appWorkspace(t);
  ws.open();
  assert.equal(same(ws.file, TEXT), 'same');
  fs.rmSync(ws.file);
  ws.open();
  assert.equal(same(ws.file, TEXT), 'missing');
});

test('#43 an AGENTS.md and a CLAUDE.md the user already had are never changed', (t) => {
  const ws = appWorkspace(t);
  const claude = path.join(ws.dir, 'CLAUDE.md');
  fs.writeFileSync(ws.file, '# Mine\r\n');
  fs.writeFileSync(claude, '# Mine too\r\n');
  ws.open();
  ws.open();
  assert.deepEqual([same(ws.file, '# Mine\r\n'), same(claude, '# Mine too\r\n')], ['same', 'same']);
});

test('#43 an AGENTS.md the user made a link of is left a link, its target untouched or not created', { skip: process.platform === 'win32' && 'symlinks need a privilege on Windows' }, (t) => {
  const outside = tmpDir(t, 'ws-instructions-outside-');
  for (const exists of [true, false]) {
    const ws = appWorkspace(t);
    const target = path.join(outside, `${exists}.md`);
    if (exists) fs.writeFileSync(target, '# Mine\n');
    fs.symlinkSync(target, ws.file);
    ws.open();
    assert.equal(fs.lstatSync(ws.file).isSymbolicLink(), true);
    assert.equal(same(target, '# Mine\n'), exists ? 'same' : 'missing');
  }
});

test('#43 the engine server seeds AGENTS.md and no CLAUDE.md too', { timeout: 90000 }, async (t) => {
  const dir = tmpDir(t, 'ws-instructions-serve-');
  const home = path.join(dir, 'home');
  const workspace = path.join(dir, 'workspace');
  fs.mkdirSync(home);
  const env = {
    ...process.env, CRAFTORIO_SIMULATION_ONLY: '1', CRAFTORIO_AUTH: 'off', CRAFTORIO_SERVER_TOKEN: 'workspace-43-test-0123456789',
    CRAFTORIO_USER_DATA: path.join(home, 'user-data'), HOME: home, USERPROFILE: home, APPDATA: path.join(home, 'AppData'),
  };
  delete env.CRAFTORIO_WORKSPACE;
  delete env.NODE_TEST_CONTEXT;
  const child = spawn(process.execPath, [path.join(__dirname, '..', 'bin', 'craftorio-engine.js'), '--port', '0', '--workspace', workspace], { env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  let out = '';
  for (const s of [child.stdout, child.stderr]) s.on('data', (c) => { out += c; });
  const exited = new Promise((resolve) => { child.once('exit', resolve); });
  // stopped here and not in a hook: hooks run in order, and the folder's removal was registered first
  try {
    for (let i = 0; i < 600 && child.exitCode === null && !/Open: http/.test(out); i++) await new Promise((r) => setTimeout(r, 100));
    assert.match(out, /Open: http/, out);
    assert.equal(same(path.join(workspace, 'AGENTS.md'), TEXT), 'same');
    assert.deepEqual(named(workspace, 'claude.md'), []);
  } finally {
    if (child.exitCode === null) child.kill();
    await exited;
  }
});

// ---- app updates ---------------------------------------------------------------------------------

// Opens the workspace as an app whose text is `text` would
const OPEN = `
const { createService } = require(${JSON.stringify(path.join(__dirname, '..', 'service'))});
const { setupWorkspace } = require(${JSON.stringify(path.join(__dirname, '..', 'domains', 'workspace', 'workspace'))});
const [dir, cliHome] = process.argv.slice(2);
const service = createService({ host: { trashItem: async () => {}, appVersion: '9.9.9', isPackaged: false, cliHome } });
service.setWorkspace(setupWorkspace(dir, { persist: false }));
service.shutdown();
process.exit(0);
`;

function versionedWorkspace(t) {
  const tmp = tmpDir(t, 'ws-instructions-update-');
  const at = (name) => path.join(tmp, name);
  for (const d of ['app/workspace-instructions', 'home', 'ws']) fs.mkdirSync(at(d), { recursive: true });
  fs.writeFileSync(at('app/package.json'), JSON.stringify({ name: 'app', version: '9.9.9', workspaces: [] }));
  fs.writeFileSync(at('open.js'), OPEN);
  const env = { ...process.env, CRAFTORIO_SIMULATION_ONLY: '1', CRAFTORIO_APP_ROOT: at('app'), CRAFTORIO_USER_DATA: at('home'), HOME: at('home'), USERPROFILE: at('home') };
  delete env.CRAFTORIO_WORKSPACE;
  delete env.NODE_TEST_CONTEXT;
  return {
    file: at('ws/AGENTS.md'),
    openWith(text) {
      fs.writeFileSync(at('app/workspace-instructions/AGENTS.workspace.md'), text);
      const r = spawnSync(process.execPath, [at('open.js'), at('ws'), at('home')], { env, encoding: 'utf8', timeout: 60000, windowsHide: true });
      assert.equal(r.status, 0, r.stderr);
    },
  };
}

test('#43 an untouched AGENTS.md follows the app\'s updates, also after the first one', { timeout: 120000 }, (t) => {
  const ws = versionedWorkspace(t);
  for (const text of ['version 1\n', 'version 2, é\n', 'version 3\n']) {
    ws.openWith(text);
    assert.equal(same(ws.file, text), 'same', text);
  }
});

test('#43 an update leaves an edited AGENTS.md as it is, and so does the one after', { timeout: 120000 }, (t) => {
  const ws = versionedWorkspace(t);
  ws.openWith('version 1\n');
  assert.equal(same(ws.file, 'version 1\n'), 'same');
  fs.writeFileSync(ws.file, 'version 1\nMy own rule.\n');
  for (const text of ['version 2\n', 'version 3\n']) {
    ws.openWith(text);
    assert.equal(same(ws.file, 'version 1\nMy own rule.\n'), 'same', text);
  }
});

test('#43 an update does not bring a deleted AGENTS.md back, nor change the one the user wrote in its place', { timeout: 120000 }, (t) => {
  const ws = versionedWorkspace(t);
  ws.openWith('version 1\n');
  assert.equal(same(ws.file, 'version 1\n'), 'same');
  fs.rmSync(ws.file);
  ws.openWith('version 2\n');
  assert.equal(same(ws.file, 'version 2\n'), 'missing');
  fs.writeFileSync(ws.file, 'Mine\n');
  ws.openWith('version 3\n');
  assert.equal(same(ws.file, 'Mine\n'), 'same');
});

test('#43 an update never changes the AGENTS.md the user had before the first one', { timeout: 120000 }, (t) => {
  const ws = versionedWorkspace(t);
  fs.writeFileSync(ws.file, 'Mine\n');
  for (const text of ['version 1\n', 'version 2\n']) {
    ws.openWith(text);
    assert.equal(same(ws.file, 'Mine\n'), 'same', text);
  }
});

// ---- runs unaffected -----------------------------------------------------------------------------

// One run of a Claude agent on a repository holding `files`, in a workspace that has AGENTS.md.
// → the CLI's calls, the workspace's real root
async function runIn(t, files, { agent = '', steps = 1, session = 'ephemeral', workingDir = '{{ worktree_dir }}', spelling = 'canonical' } = {}) {
  const f = fixture(t, spelling);
  for (const [name, text] of Object.entries(files)) {
    fs.writeFileSync(path.join(f.repo, name), text);
    git(f.repo, 'add', '-f', name);
  }
  if (Object.keys(files).length) {
    git(f.repo, 'commit', '-q', '-m', 'instructions');
    git(f.repo, 'push', '-q', 'origin', 'main');
  }
  fs.writeFileSync(path.join(f.tmp, 'AGENTS.md'), TEXT);
  // the "CLI" is node + a fake that calls no model: the simulation-only guard is lifted for the test
  for (const k of ['CRAFTORIO_SIMULATION_ONLY', 'CRAFTORIO_WORKSPACE', 'CRAFTORIO_USER_DATA']) {
    const v = process.env[k];
    delete process.env[k];
    t.after(() => { if (v !== undefined) process.env[k] = v; });
  }
  const record = path.join(f.tmp, 'calls.jsonl');
  const file = path.join(f.tmp, 'wf.yaml');
  fs.writeFileSync(file, [
    'providers:',
    `  claude: { type: claude-code, command: node, args: ["${FAKE}", "--record", "${record.replace(/\\/g, '/')}", "-p"], resume_args: ["--resume", "{{ session_id }}"] }`,
    'inputs:',
    '  repo_path: { type: string, required: true }',
    'orchestrator:',
    '  worktree: { repo: "{{ inputs.repo_path }}", base: main }',
    'agents:',
    `  dev: { provider: claude, model: fake, session: ${session}, ${workingDir ? `working_dir: "${workingDir}", ` : ''}capabilities: { tools: [read] }${agent} }`,
    'steps:',
    ...Array.from({ length: steps }, (_, i) => `  - { id: work${i + 1}, agent: dev, supervise: false, prompt: "Do it." }`),
  ].join('\n'));
  const run = new WorkflowRun({ file, inputs: { repo_path: f.repo }, runsDir: path.join(f.tmp, 'runs'), worktreesDir: f.worktrees, skillsDirs: [path.join(ROOT, 'skills')] });
  const events = [];
  run.on('event', (ev) => events.push(ev));
  await run.start();
  const finished = events.find((e) => e.type === 'workflow.finished');
  assert.equal(finished.status, 'success', finished.error);
  const calls = fs.readFileSync(record, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  return { calls, root: fs.realpathSync.native(f.tmp) };
}

// the files the CLI loaded by itself inside the workspace, by their place: 'workspace/AGENTS.md', 'cwd/AGENTS.md'
// (a file above the temporary workspace is the machine's, not the test's)
const loaded = (call, root) => call.loaded.filter((f) => f.startsWith(root + path.sep)).map((f) => {
  const dir = path.dirname(f);
  const place = dir === root ? 'workspace' : dir === call.cwd ? 'cwd' : path.relative(root, dir);
  return `${place}/${path.basename(f)}`;
});
const slash = (p) => p.replace(/\\/g, '/');
const reached = (call) => `${call.stdin}\n${call.system}`;
const ORACLE_LINE = TEXT.toString('utf8').split('\n').find((l) => l.length > 40);

test('#43 isolation: false: the agent loads its repository\'s AGENTS.md and not the workspace\'s, on a resumed turn too', { timeout: 60000 }, async (t) => {
  const { calls, root } = await runIn(t, { 'AGENTS.md': 'MARK-REPO\n' }, { agent: ', isolation: false', session: 'persistent', steps: 2 });
  assert.equal(calls.length, 2);
  assert.ok(calls[1].resumed, 'the second step resumes the session');
  assert.deepEqual(calls.map((c) => loaded(c, root)), [['cwd/AGENTS.md'], ['cwd/AGENTS.md']]);
});

test('#43 isolation: false: a repository with a CLAUDE.md keeps loading it', { timeout: 60000 }, async (t) => {
  const { calls, root } = await runIn(t, { 'CLAUDE.md': '@AGENTS.md\n', 'AGENTS.md': 'MARK-REPO\n' }, { agent: ', isolation: false' });
  assert.deepEqual(loaded(calls[0], root), ['cwd/CLAUDE.md']);
});

test('#43 isolation: false: a repository with no instructions, and an agent in the run folder, load nothing', { timeout: 60000 }, async (t) => {
  for (const workingDir of ['{{ worktree_dir }}', '']) {
    const { calls, root } = await runIn(t, {}, { agent: ', isolation: false', workingDir });
    assert.deepEqual(loaded(calls[0], root), [], workingDir || 'run folder');
  }
});

test('#43 isolation: false: the workspace\'s file stays out when the workspace is opened through a link', { timeout: 60000 }, async (t) => {
  const { calls, root } = await runIn(t, { 'AGENTS.md': 'MARK-REPO\n' }, { agent: ', isolation: false', spelling: 'link' });
  assert.deepEqual(loaded(calls[0], root), ['cwd/AGENTS.md']);
});

test('#43 isolation: false: the arguments exclude the workspace\'s own files alone and set nothing else', { timeout: 60000 }, async (t) => {
  const { calls, root } = await runIn(t, { 'AGENTS.md': 'MARK-REPO\n' }, { agent: ', isolation: false' });
  const { argv, settings, sources } = calls[0];
  assert.equal(argv.filter((a) => a === '--settings').length, 1);
  assert.deepEqual(Object.keys(settings), ['claudeMdExcludes']);
  const excludes = settings.claudeMdExcludes.map(slash);
  assert.ok(excludes.includes(slash(path.join(root, 'AGENTS.md'))), excludes.join(', '));
  assert.deepEqual(excludes.filter((e) => ![slash(path.join(root, 'AGENTS.md')), slash(path.join(root, 'CLAUDE.md'))].includes(e)), []);
  assert.deepEqual(sources, ['user', 'project', 'local']);
});

test('#43 an isolated agent starts with its repository\'s instructions and none of the workspace\'s', { timeout: 60000 }, async (t) => {
  const { calls, root } = await runIn(t, { 'AGENTS.md': 'MARK-REPO\n' });
  const call = calls[0];
  assert.deepEqual(loaded(call, root), []);
  assert.equal(reached(call).split('MARK-REPO').length - 1, 1);
  assert.equal(reached(call).includes(ORACLE_LINE), false);
  assert.equal(call.argv.filter((a) => a === '--settings').length, 1);
  assert.equal(call.settings.autoMemoryEnabled, false);
});
