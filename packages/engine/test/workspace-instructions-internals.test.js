// #43, internal details: the exclusion's globs, the arguments per isolation, a workflow's own --settings,
// and an update that replaces the file in one rename.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { providerArgs } = require('../engine/capabilities');
const { instructionsExcludes } = require('../engine/project-instructions');
const { methods } = require('../engine/run/sessions');
const { seedWorkspaceInstructions } = require('../domains/workspace/workspace-instructions');

function tmpDir(t) {
  const dir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'ws-instructions-internals-')));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }));
  return dir;
}

test('#43 the excludes are absolute paths with no glob character of the folder\'s name', (t) => {
  const dir = path.join(tmpDir(t), 'my (beta) [1] {a}');
  fs.mkdirSync(dir);
  const excludes = instructionsExcludes(dir);
  assert.deepEqual(excludes.map((e) => e.split('/').slice(-2).join('/')), ['my ?beta? ?1? ?a?/CLAUDE.md', 'my ?beta? ?1? ?a?/AGENTS.md']);
  assert.ok(excludes.every((e) => path.isAbsolute(e)), excludes.join(', '));
});

test('#43 one --settings per call: both settings isolated, the excludes alone not isolated, nothing for another CLI', () => {
  const instructionsExcludes = ['/ws/AGENTS.md'];
  const settings = (o) => {
    const { args } = providerArgs('claude-code', { ...o, instructionsExcludes });
    assert.equal(args.filter((a) => a === '--settings').length, 1);
    return JSON.parse(args[args.indexOf('--settings') + 1]);
  };
  assert.deepEqual(settings({}), { autoMemoryEnabled: false, claudeMdExcludes: instructionsExcludes });
  assert.deepEqual(settings({ isolated: false }), { claudeMdExcludes: instructionsExcludes });
  for (const type of ['codex-cli', 'grok-cli']) assert.deepEqual(providerArgs(type, { instructionsExcludes }), providerArgs(type, {}), type);
});

test('#43 a workflow\'s own --settings is the only one, with one warning when not isolated', () => {
  const events = [];
  const run = { machine: {}, runDir: '/ws/runs/r1', capsLogged: new Set(), emitEvent: (type, data) => events.push({ type, ...data }) };
  const excludes = (o) => methods.workspaceExcludes.call(run, { id: 's1', agent: 'dev' }, { providerType: 'claude-code', isolated: false, ownArgs: [], ...o });
  assert.ok(excludes({}).length);
  assert.deepEqual(excludes({ providerType: 'codex-cli' }), []);
  assert.deepEqual(excludes({ isolated: true, ownArgs: ['--settings', '{}'] }), []);
  assert.equal(events.length, 0);
  for (const ownArgs of [['--settings', '{}'], ['--settings={}']]) assert.deepEqual(excludes({ ownArgs }), []);
  assert.deepEqual(events.map((e) => [e.level, e.kind]), [['warn', 'instructions']]);
});

test('#43 an update that cannot be written leaves the old file whole, and the next start updates it', (t) => {
  const dir = tmpDir(t);
  const [app, ws] = ['app', 'ws'].map((d) => path.join(dir, d));
  fs.mkdirSync(app);
  const text = (s) => fs.writeFileSync(path.join(app, 'AGENTS.workspace.md'), s);
  const file = path.join(ws, 'AGENTS.md');
  text('version 1\n');
  assert.deepEqual(seedWorkspaceInstructions(app, ws), ['AGENTS.md']);
  text('version 2\n');
  const rename = t.mock.method(fs, 'renameSync', () => { throw new Error('disk gone'); });
  assert.throws(() => seedWorkspaceInstructions(app, ws), /disk gone/);
  rename.mock.restore();
  assert.equal(fs.readFileSync(file, 'utf8'), 'version 1\n');
  seedWorkspaceInstructions(app, ws);
  assert.equal(fs.readFileSync(file, 'utf8'), 'version 2\n');
  assert.deepEqual(fs.readdirSync(ws).sort(), ['.seeded.json', 'AGENTS.md']);
});

test('#43 an app without the text seeds nothing', (t) => {
  const dir = tmpDir(t);
  assert.deepEqual(seedWorkspaceInstructions(dir, path.join(dir, 'ws')), []);
  assert.equal(fs.existsSync(path.join(dir, 'ws', 'AGENTS.md')), false);
});
