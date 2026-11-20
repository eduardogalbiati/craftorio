// #845: a repository whose Issues are turned off is a state of the repository, not a failed Backlog read.
// backlog.js syncBacklog (what the wizard's Review and the Backlog screen ask for) resolves with
// `issuesDisabled: true` and no issues when gh answers "has disabled issues" (glab: "disabled"), and caches
// that answer (readBacklog) for the screen's next read. A network failure still rejects with its reason.
// The CLI is the system boundary: a fake gh/glab first on the PATH (as project-onboarding-repos-848.test.js),
// run through the real execCli. Its `issue` commands fail with `stderr` (exit 1); any other command prints [].
//
// The fake CLI is a #!/bin/sh script: macOS and Linux only.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { resolveCommand } = require('../engine/providers');
const backlog = require('../domains/backlog/backlog');

const POSIX = { skip: process.platform === 'win32' ? 'needs a shell script as the CLI' : false };
const GH_DISABLED = "the 'o/r' repository has disabled issues";
const GLAB_DISABLED = 'The issues feature is disabled for this project';
const NETWORK = 'error connecting to api.github.com';

// `cli` first on the PATH for this test: `<cli> issue ...` writes `stderr` and exits 1, anything else prints []
function fakeCli(t, cli, stderr) {
  resolveCommand(cli);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'issues-off-845-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(dir, 'err'), stderr);
  fs.writeFileSync(path.join(dir, cli), `#!/bin/sh\nif [ "$1" = "issue" ]; then cat "${dir}/err" >&2; exit 1; fi\necho '[]'\n`, { mode: 0o755 });
  const realPath = process.env.PATH;
  process.env.PATH = [dir, realPath].join(path.delimiter);
  t.after(() => { process.env.PATH = realPath; });
  return dir;
}

function cacheDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'backlog-845-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

const GITHUB = { id: 'p', repo: 'https://github.com/o/r' };
const GITLAB = { id: 'g', repo: 'https://gitlab.com/g/app' };

test('#845 gh "has disabled issues": the sync resolves with issuesDisabled and no issues', POSIX, async (t) => {
  fakeCli(t, 'gh', GH_DISABLED);
  const data = await backlog.syncBacklog({ dir: cacheDir(t), project: GITHUB, platform: 'github' });
  assert.equal(data.issuesDisabled, true);
  assert.equal(data.issues.length, 0);
});

test('#845 gh "has disabled issues" on a followed sync (the wizard\'s Review, read in steps): resolves with issuesDisabled', POSIX, async (t) => {
  fakeCli(t, 'gh', GH_DISABLED);
  const data = await backlog.syncBacklog({ dir: cacheDir(t), project: GITHUB, platform: 'github', followed: true, onProgress: () => {} });
  assert.equal(data.issuesDisabled, true);
  assert.equal(data.issues.length, 0);
});

test('#845 the issues-disabled answer is cached: the next read of the backlog says so too', POSIX, async (t) => {
  fakeCli(t, 'gh', GH_DISABLED);
  const dir = cacheDir(t);
  await backlog.syncBacklog({ dir, project: GITHUB, platform: 'github' });
  const cached = backlog.readBacklog(dir, GITHUB.id);
  assert.equal(cached?.issuesDisabled, true);
});

test('#845 glab "issues feature is disabled": the sync resolves with issuesDisabled and no issues', POSIX, async (t) => {
  fakeCli(t, 'glab', GLAB_DISABLED);
  const data = await backlog.syncBacklog({ dir: cacheDir(t), project: GITLAB, platform: 'gitlab' });
  assert.equal(data.issuesDisabled, true);
  assert.equal(data.issues.length, 0);
});

test('#845 a network failure is still a failed read: the sync rejects with its reason', POSIX, async (t) => {
  fakeCli(t, 'gh', NETWORK);
  await assert.rejects(
    backlog.syncBacklog({ dir: cacheDir(t), project: GITHUB, platform: 'github' }),
    (e) => String(e.message).includes(NETWORK),
  );
});

test('#845 a network failure on a followed sync rejects with its reason too', POSIX, async (t) => {
  fakeCli(t, 'gh', NETWORK);
  await assert.rejects(
    backlog.syncBacklog({ dir: cacheDir(t), project: GITHUB, platform: 'github', followed: true, onProgress: () => {} }),
    (e) => String(e.message).includes(NETWORK),
  );
});

test('#845 a repository with issues reports issuesDisabled as not true', async (t) => {
  const exec = async (_cli, args) => (args[0] === 'issue' ? JSON.stringify([{ number: 1, title: 'A', body: '', state: 'OPEN', labels: [], url: 'https://github.com/o/r/issues/1', updatedAt: '2026-11-20T10:00:00Z' }]) : '[]');
  const data = await backlog.syncBacklog({ dir: cacheDir(t), project: GITHUB, platform: 'github', exec });
  assert.notEqual(data.issuesDisabled, true);
  assert.equal(data.issues.length, 1);
});

// ---- the words (packages/shared/i18n) ---------------------------------------------------------
const catalog = (lang) => JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'shared', 'i18n', `${lang}.json`), 'utf8'));

test('#845 en has backlog.issues_disabled: "Issues are turned off in this repository"', () => {
  assert.equal(catalog('en')['backlog.issues_disabled'], 'Issues are turned off in this repository');
});

test('#845 pt-BR has backlog.issues_disabled, translated', () => {
  const pt = catalog('pt-BR')['backlog.issues_disabled'];
  assert.equal(typeof pt, 'string');
  assert.equal(pt.trim().length > 0, true);
  assert.notEqual(pt, 'Issues are turned off in this repository');
});
