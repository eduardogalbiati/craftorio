// #737: the git repository the integration tests (*.slow.test.js) start from. `repoFromTemplate(t)`
// builds a template once per test process (git init on main, src/app.js committed as "base") and
// gives each test its own copy (fs.cpSync), removed when that test ends: no `git init` + commits per
// test, and copies are independent, so the tests of a file can run concurrently. Like the per-test
// repositories it replaces, the copy has no local git config (identity given per command).
// Registers no test (test/test-suite-layout-305-306.test.js).
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const git = (cwd, ...args) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'init.defaultBranch=main', '-c', 'core.autocrlf=false', ...args], { cwd, stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim();

let template = null;

// built on first use, removed when the process exits
function templateRepo() {
  if (template) return template;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'git-template-'));
  git(dir, 'init', '-q');
  fs.mkdirSync(path.join(dir, 'src'));
  fs.writeFileSync(path.join(dir, 'src', 'app.js'), 'module.exports = 1;\n');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'base');
  process.on('exit', () => {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* temp folder */ }
  });
  template = dir;
  return dir;
}

/** A fresh copy of the template repository for test context `t`, deleted after that test. */
function repoFromTemplate(t) {
  const src = templateRepo();
  // fs.cpSync now and then fails with ENOENT on a .git folder on the macOS release runners (v1.5.0
  // Deploy, darwin arm64): a fresh folder and another try, three at most
  for (let attempt = 1; ; attempt++) {
    const dest = fs.mkdtempSync(path.join(os.tmpdir(), 'git-repo-'));
    try {
      fs.cpSync(src, dest, { recursive: true });
    } catch (e) {
      fs.rmSync(dest, { recursive: true, force: true, maxRetries: 5 });
      if (e.code === 'ENOENT' && attempt < 3) continue;
      throw e;
    }
    t.after(() => fs.rmSync(dest, { recursive: true, force: true, maxRetries: 5 }));
    return dest;
  }
}

module.exports = {
  repoFromTemplate,
};
