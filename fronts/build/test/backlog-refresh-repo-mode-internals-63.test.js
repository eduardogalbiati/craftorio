// skills/backlog-refresh/apply.js `--mode repo` (#63, #65): the repository the workflow names in the
// review prompt, printed as gh/glab take it in --repo, with no answer file. Seam: the script's CLI and
// resolveRepo, with real git repositories.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');
const { resolveRepo } = require('../../../skills/backlog-refresh/apply');

const APPLY_JS = path.join(__dirname, '..', '..', '..', 'skills', 'backlog-refresh', 'apply.js');
const git = (cwd, ...args) => execFileSync('git', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim();

function repo(t, { origin = null, bare = false } = {}) {
  const dir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'bl-refresh-repo-')));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5 }));
  git(dir, 'init', '-q', ...(bare ? ['--bare'] : []));
  if (origin) git(dir, 'remote', 'add', 'origin', origin);
  return dir;
}
const repoMode = (platform, project) => spawnSync(process.execPath, [APPLY_JS, '--platform', platform, '--mode', 'repo', '--project', project], { encoding: 'utf8' });

test('--mode repo prints owner/name on GitHub, needing no --file', (t) => {
  const r = repoMode('gh', repo(t, { origin: 'git@github.com:owner/finance-app.git' }));
  assert.deepEqual([r.status, r.stdout, r.stderr], [0, 'owner/finance-app\n', '']);
});

test('--mode repo prints the GitLab project with its host, through the local folder', (t) => {
  const folder = repo(t, { origin: 'git@gitlab.example.com:group/sub/app.git' });
  const r = repoMode('gl', repo(t, { origin: folder }));
  assert.deepEqual([r.status, r.stdout], [0, 'https://gitlab.example.com/group/sub/app\n']);
});

test('--mode repo exits 2 with one line when the project has no origin, and refuses an unknown platform', (t) => {
  const dir = repo(t);
  const r = repoMode('gh', dir);
  assert.deepEqual([r.status, r.stdout, r.stderr], [2, '', `apply: The project is not on GitHub/GitLab: ${dir} has no origin remote.\n`]);
  assert.match(repoMode('xx', dir).stderr, /--platform takes gh or gl/);
});

test('resolveRepo: a relative origin is read from the project, and only one hop is followed', (t) => {
  const folder = repo(t, { origin: 'https://github.com/owner/app.git' });
  const clone = repo(t, { origin: `../${path.basename(folder)}` });
  assert.deepEqual(resolveRepo('gh', clone), { host: 'github.com', project: 'owner/app' });
  assert.throws(() => resolveRepo('gh', repo(t, { origin: clone })), /not on GitHub\/GitLab/);
});

test('resolveRepo: a bare repository on this machine is not the person\'s folder (the localOrigin rule)', (t) => {
  const bare = repo(t, { origin: 'https://github.com/owner/app.git', bare: true });
  assert.throws(() => resolveRepo('gh', repo(t, { origin: bare })), /not on GitHub\/GitLab: its origin is a bare repository/);
});

test('resolveRepo: a folder that is gone keeps git\'s own error, never "not on GitHub/GitLab"', (t) => {
  const project = repo(t, { origin: path.join(os.tmpdir(), 'bl-refresh-gone', 'x') });
  assert.throws(() => resolveRepo('gh', project), (e) => !/not on GitHub/.test(e.message) && /cannot change to/.test(String(e.stderr)));
});
