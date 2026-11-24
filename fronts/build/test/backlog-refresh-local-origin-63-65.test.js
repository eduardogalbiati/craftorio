// skills/backlog-refresh/apply.js on a project created from a local folder (#63): the clone's `origin`
// is that folder, and the folder's own `origin` is the platform repository. And (#65) an answer with
// nothing to write is never refused for its `repo`, while one that would write still must match.
// Seam: apply(), with real git repositories and a fake gh/glab (`cli`).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');
const { execFileSync } = require('child_process');
const { apply } = require('../../../skills/backlog-refresh/apply');

const git = (cwd, ...args) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'init.defaultBranch=main', '-c', 'core.autocrlf=false', ...args], { cwd, stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim();

// <tmp>/projects/finance-app (the person's folder, its origin = `remote`, none when null) and its
// clone <tmp>/repos/projects-finance-app, whose origin is that folder (as a path or a file:// URL)
function localProject(t, { remote, as = 'path' }) {
  const tmp = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'bl-refresh-local-')));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 5 }));
  const folder = path.join(tmp, 'projects', 'finance-app');
  fs.mkdirSync(folder, { recursive: true });
  git(folder, 'init', '-q');
  fs.writeFileSync(path.join(folder, 'a.txt'), 'a\n');
  git(folder, 'add', 'a.txt');
  git(folder, 'commit', '-q', '-m', 'base');
  if (remote) git(folder, 'remote', 'add', 'origin', remote);
  const clone = path.join(tmp, 'repos', 'projects-finance-app');
  fs.mkdirSync(path.dirname(clone));
  git(tmp, 'clone', '-q', folder, clone);
  git(clone, 'remote', 'set-url', 'origin', as === 'file-url' ? pathToFileURL(folder).href : folder);
  const runDir = path.join(tmp, 'run');
  fs.mkdirSync(runDir);
  return { tmp, folder, clone, runDir };
}

// runs apply() on an answer with a fake gh/glab that records its calls
function applyAnswer({ clone, runDir }, answer, { platform = 'gh', mode = 'safe' } = {}) {
  const file = path.join(runDir, 'refresh.json');
  fs.writeFileSync(file, JSON.stringify(answer));
  const calls = [];
  const cli = (cmd, args) => {
    calls.push([cmd, ...args]);
    if (args[1] !== 'view') return '';
    return platform === 'gl'
      ? JSON.stringify({ description: 'before old after', updated_at: '', state: 'opened', labels: [] })
      : JSON.stringify({ body: 'before old after', updatedAt: '', state: 'OPEN', labels: [] });
  };
  let result = null;
  let error = '';
  try { result = apply({ platform, mode, file, project: clone, cli, today: '2026-11-24' }); } catch (e) { error = String(e.message); }
  return { result, error, calls };
}

const edit = { number: 5, edits: [{ find: 'old', replace: 'new' }], complexity: 0 };
// `--repo <value>` of every gh/glab call
const repos = (calls) => calls.map((c) => c[c.indexOf('--repo') + 1]);

for (const as of ['path', 'file-url']) {
  test(`#63 apply: an origin that is a local folder (${as}) reads and edits the issues of that folder's own GitHub origin`, (t) => {
    const p = localProject(t, { remote: 'git@github.com:owner/finance-app.git', as });
    const { result, error, calls } = applyAnswer(p, { repo: 'owner/finance-app', issues: [edit] });
    assert.equal(error, '');
    assert.deepEqual(result.results, [{ number: 5, result: 'updated', changes: ['body (1 edit)'] }]);
    assert.equal(result.repo, 'owner/finance-app');
    assert.deepEqual(calls.map((c) => c[2]), ['view', 'edit']);
    assert.deepEqual(repos(calls), ['owner/finance-app', 'owner/finance-app']);
  });

  test(`#63 apply: a local folder origin (${as}) with no platform remote behind it fails saying the project is not on GitHub/GitLab, nothing applied`, (t) => {
    const p = localProject(t, { remote: null, as });
    const { error, calls } = applyAnswer(p, { repo: 'owner/finance-app', issues: [edit] });
    assert.match(error, /\b(?:not|no)\b.{0,80}(?:GitHub\/GitLab|GitHub or GitLab)/i);
    assert.doesNotMatch(error, /not a GitHub remote/);
    assert.deepEqual(calls, []);
    assert.equal(fs.existsSync(path.join(p.runDir, 'applied-safe.json')), false);
  });
}

test('#63 apply: a local folder whose own origin is another repository on this machine is not on GitHub/GitLab either', (t) => {
  const p = localProject(t, { remote: null });
  const bare = path.join(p.tmp, 'backup.git');
  git(p.tmp, 'init', '-q', '--bare', bare);
  git(p.folder, 'remote', 'add', 'origin', bare);
  const { error, calls } = applyAnswer(p, { repo: 'owner/finance-app', issues: [edit] });
  assert.match(error, /\b(?:not|no)\b.{0,80}(?:GitHub\/GitLab|GitHub or GitLab)/i);
  assert.deepEqual(calls, []);
});

test('#63 apply: the scope closes of a local-folder project go to the GitHub repository too', (t) => {
  const p = localProject(t, { remote: 'https://github.com/owner/finance-app.git' });
  const { result, error, calls } = applyAnswer(p, { repo: 'owner/finance-app', scope: [{ number: 9, action: 'close_done', reason: 'Done by #4' }] }, { mode: 'scope' });
  assert.equal(error, '');
  assert.equal(result.results[0].result, 'closed');
  assert.deepEqual(repos(calls), ['owner/finance-app', 'owner/finance-app']);
});

test('#63 apply: a local folder whose own origin is a GitLab project edits the issues there', (t) => {
  const p = localProject(t, { remote: 'git@gitlab.example.com:group/sub/finance-app.git', as: 'file-url' });
  const { result, error, calls } = applyAnswer(p, { repo: 'group/sub/finance-app', issues: [edit] }, { platform: 'gl' });
  assert.equal(error, '');
  assert.equal(result.results[0].result, 'updated');
  assert.deepEqual([...new Set(repos(calls))], ['https://gitlab.example.com/group/sub/finance-app']);
});

test('#63 #65 apply: on a local-folder project, an answer that would edit issues of another repository is still refused, nothing applied', (t) => {
  const p = localProject(t, { remote: 'https://github.com/owner/finance-app.git' });
  // the clone's folder name, the refresher's wrong guess
  const { error, calls } = applyAnswer(p, { repo: 'owner/projects-finance-app', issues: [edit] });
  assert.match(error, /The answer is about owner\/projects-finance-app, the project's remote is owner\/finance-app: nothing applied/);
  assert.deepEqual(calls, []);
  assert.equal(fs.existsSync(path.join(p.runDir, 'applied-safe.json')), false);
});

test('#65 apply: a scope proposal about another repository is still refused, nothing closed', (t) => {
  const p = localProject(t, { remote: 'https://github.com/owner/finance-app.git' });
  git(p.clone, 'remote', 'set-url', 'origin', 'https://github.com/owner/finance-app.git');
  const { error, calls } = applyAnswer(p, { repo: 'owner/projects-finance-app', issues: [], scope: [{ number: 9, action: 'close_done', reason: 'Done' }] }, { mode: 'scope' });
  assert.match(error, /nothing applied/);
  assert.deepEqual(calls, []);
});

for (const mode of ['safe', 'scope']) {
  test(`#65 apply: an answer with 0 reviewed issues and an unexpected repo is not refused (${mode}): nothing to write, no gh call`, (t) => {
    const p = localProject(t, { remote: 'https://github.com/owner/finance-app.git' });
    git(p.clone, 'remote', 'set-url', 'origin', 'https://github.com/owner/finance-app.git');
    const { result, error, calls } = applyAnswer(p, { repo: 'owner/projects-finance-app', reviewed: 0, issues: [], scope: [] }, { mode });
    assert.equal(error, '');
    assert.deepEqual(result.results, []);
    assert.equal(result.repo, 'owner/finance-app', 'the resolved repository, never the answer\'s');
    assert.deepEqual(calls, []);
  });
}

// the review found only current issues: entries without edits nor a complexity change write nothing
test('#65 apply: an answer whose issues have no edits, no complexity and no scope proposals is not refused for its repo', (t) => {
  const p = localProject(t, { remote: 'https://github.com/owner/finance-app.git' });
  git(p.clone, 'remote', 'set-url', 'origin', 'https://github.com/owner/finance-app.git');
  const { result, error, calls } = applyAnswer(p, { repo: 'owner/projects-finance-app', reviewed: 1, issues: [{ number: 3, edits: [], complexity: 0, note: '' }], scope: [] });
  assert.equal(error, '');
  assert.deepEqual(result.results, []);
  assert.deepEqual(calls, []);
});
