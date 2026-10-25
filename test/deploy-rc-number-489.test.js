// #489 the rc number N is the same in deploy.yml (the GitHub prerelease vX.Y.Z-rc.N) and in the app
// (the candidate recordCandidate writes, src/domains/releases/releases.js): the shell lines of deploy.yml that compute
// N run in a throwaway repository, against the app's candidates for the same pushes, including a
// push that carries several first-parent commits. Needs a POSIX shell (Git Bash on Windows).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const emptyConfig = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'gitcfg-')), 'config');
fs.writeFileSync(emptyConfig, '');
process.env.GIT_CONFIG_GLOBAL = emptyConfig;
process.env.GIT_CONFIG_NOSYSTEM = '1';

const git = (cwd, ...args) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'init.defaultBranch=main', '-c', 'core.autocrlf=false', ...args], { cwd, stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim();

// Git Bash on Windows (never WSL's bash.exe), else the PATH's bash
function bash() {
  if (process.platform !== 'win32') return 'bash';
  const exec = execFileSync('git', ['--exec-path']).toString().trim();
  for (const up of [['..', '..', '..', 'bin', 'bash.exe'], ['..', '..', 'bin', 'bash.exe']]) {
    const file = path.join(exec, ...up);
    if (fs.existsSync(file)) return file;
  }
  return null;
}

// the lines of the publish step from STABLE=... to RC="v${VERSION}-rc.${N}"
function rcScript() {
  const lines = fs.readFileSync(path.join(__dirname, '..', '.github', 'workflows', 'deploy.yml'), 'utf8').split(/\r?\n/);
  const from = lines.findIndex((l) => /^\s*STABLE=/.test(l));
  const to = lines.findIndex((l, i) => i > from && /^\s*RC="v\$\{VERSION\}-rc\./.test(l));
  assert.ok(from >= 0 && to > from, 'deploy.yml computes STABLE then RC="v${VERSION}-rc.${N}"');
  return `${lines.slice(from, to + 1).map((l) => l.trim()).join('\n')}\necho "$RC"\n`;
}

test('#489 deploy.yml and the app give a push the same rc number, also for a push of several merges', (t) => {
  const sh = bash();
  if (!sh) return t.skip('no POSIX shell (Git Bash) here');
  const releases = require('../src/domains/releases/releases');
  const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'rcnum489-')));
  t.after(() => fs.rmSync(root, { recursive: true, force: true, maxRetries: 3 }));
  const repo = path.join(root, 'repo');
  const dir = path.join(root, 'releases');
  fs.mkdirSync(repo);
  fs.mkdirSync(dir);
  git(repo, 'init', '-q');
  const commit = (name) => { fs.writeFileSync(path.join(repo, name), `${name}\n`); git(repo, 'add', name); git(repo, 'commit', '-q', '-m', name); return git(repo, 'rev-parse', 'HEAD'); };
  const stableSha = commit('init');
  git(repo, 'tag', 'v1.2.0');
  fs.writeFileSync(path.join(dir, 'p1.json'), JSON.stringify({ releases: [{ version: 'v1.2.0', tag: 'v1.2.0', commit: stableSha, date: '2026-10-10T10:00:00.000Z', issues: [], runs: [], status: 'shipped' }], next: { notes: '' } }));
  const script = rcScript();
  const shellRc = () => execFileSync(sh, ['-c', script], { cwd: repo, env: { ...process.env, VERSION: '1.3.0' } }).toString().trim();

  const app = [];
  const shell = [];
  // push 1: two merges at once; push 2: one merge
  commit('m1');
  const tip1 = commit('m2');
  app.push(releases.recordCandidate(dir, 'p1', { commit: tip1, version: '1.3.0', date: '2026-10-11T10:00:00.000Z' }).tag);
  shell.push(shellRc());
  const tip2 = commit('m3');
  app.push(releases.recordCandidate(dir, 'p1', { commit: tip2, version: '1.3.0', date: '2026-10-12T10:00:00.000Z' }).tag);
  shell.push(shellRc());
  assert.deepEqual(app, shell);
});
