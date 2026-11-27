// #105: shared fixture of local-import-remote-105.test.js and ../backlog/local-import-backlog-105.test.js (no
// *.test.js suffix: never run on its own). A folder on this computer imported as the new-project wizard does
// (step 1's folder card: onboarding:start with the folder's file:// URL), through the whole service in a
// simulation (test/service/helpers.js makeService): no network, no real gh / glab, no model.
// The person's folder is a real git repository in os.tmpdir(): with origin = a GitHub URL (L1, never fetched)
// or with no remote at all (L2). Its history is PR-like (a root commit, then two branches by another author
// merged with --no-ff by the owner), so git's own reading of it (workflow-interview.js landingOf) says
// "remote": only the folder's remote can tell the import is local.
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');
const { execFileSync } = require('child_process');
const projects = require('../../domains/project/projects');
const { makeService } = require('../service/helpers');

const GITHUB = 'https://github.com/acme/widget.git';

const run = (cwd, args, who = 'Owner <owner@example.com>') => {
  const [, name, email] = /^(.*) <(.*)>$/.exec(who);
  return execFileSync('git', ['-c', `user.name=${name}`, '-c', `user.email=${email}`, '-c', 'init.defaultBranch=main', '-c', 'core.autocrlf=false', '-c', 'commit.gpgsign=false', ...args], { cwd, stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim();
};

function commit(cwd, file, who) {
  fs.writeFileSync(path.join(cwd, file), `${file}\n`);
  run(cwd, ['add', file], who);
  run(cwd, ['commit', '-q', '--no-verify', '-m', `Add ${file}`], who);
}

/** The person's folder: a git repository on main with a PR-like history; origin = `remote` (none when null). */
function personFolder(t, { remote = null } = {}) {
  const tmp = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'local-import-105-')));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 }));
  const folder = path.join(tmp, 'widget');
  fs.mkdirSync(folder);
  run(folder, ['init', '-q']);
  run(folder, ['symbolic-ref', 'HEAD', 'refs/heads/main']);
  commit(folder, 'README.md');
  for (const branch of ['one', 'two']) {
    run(folder, ['checkout', '-q', '-b', branch]);
    commit(folder, `${branch}.txt`, 'Dev <dev@example.com>');
    run(folder, ['checkout', '-q', 'main']);
    run(folder, ['merge', '-q', '--no-ff', '-m', `Merge ${branch}`, branch]);
  }
  if (remote) run(folder, ['remote', 'add', 'origin', remote]);
  return folder;
}

const pause = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(read, pred, what, tries = 400) {
  let last;
  for (let i = 0; i < tries; i++) {
    last = await read();
    if (pred(last)) return last;
    await pause(50);
  }
  assert.fail(`${what}: still ${JSON.stringify(last)}`);
}

/**
 * Imports `folder` as the wizard's folder card does and waits for its clone (and, with `profile`, the free profile
 * job step 3 reads). → { api, ws, id, project (the saved record), state (onboarding:status) }
 */
async function importFolder(t, folder, { profile = false } = {}) {
  const { service, api } = makeService(t);
  const ws = service.workspace();
  const started = await api['onboarding:start']({ name: 'Widget', repo: pathToFileURL(folder).href });
  const id = started.projectId;
  const status = () => api['onboarding:status']({ projectId: id });
  let state = await until(status, (s) => s.status !== 'cloning', 'the clone ends');
  assert.equal(state.status, 'ready', `the import is ready: ${JSON.stringify({ status: state.status, reason: state.reason })}`);
  if (profile) state = await until(status, (s) => ['done', 'failed'].includes(s.jobs?.profile?.status), 'the profile job ends');
  return { api, ws, id, project: projects.readProject(ws.projects, id), state };
}

module.exports = { GITHUB, importFolder, personFolder, run };
