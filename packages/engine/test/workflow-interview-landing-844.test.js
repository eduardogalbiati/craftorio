// #844 edges of the Ways of working profile git gives (simulated analysis, no model): who merges decides the
// mode, authors are people, and test files without a test command still read as unit tests.
// The issue's own history is in workflow-interview-truth-844.test.js; these are the cases around it.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { setupWorkspace } = require('../domains/workspace/workspace');
const projects = require('../domains/project/projects');
const seeds = require('../domains/seed/seeds');
const workflowInterviewArea = require('../service/areas/workflow-interview');

const OWNER = ['Ana Souza', 'ana@example.com'];
const OWNER_WORK = ['Ana Souza', 'ana.souza@work.example'];
const BRUNO = ['Bruno Lima', 'bruno@example.net'];
const CARLA = ['Carla Dias', 'carla@example.org'];

function tmp(t, prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }));
  return dir;
}

// a small git repository built step by step: commit(who, file), pr(n, [[who, file], ...]) merged by `merger`
function repo(t) {
  const dir = tmp(t, 'wfi-844e-repo-');
  const cfg = path.join(tmp(t, 'wfi-844e-gitcfg-'), 'config');
  fs.writeFileSync(cfg, '');
  const base = { ...process.env, GIT_CONFIG_GLOBAL: cfg, GIT_CONFIG_NOSYSTEM: '1' };
  const git = (who, ...args) => {
    const [name, email] = who;
    const env = { ...base, GIT_AUTHOR_NAME: name, GIT_AUTHOR_EMAIL: email, GIT_COMMITTER_NAME: name, GIT_COMMITTER_EMAIL: email };
    return execFileSync('git', ['-c', 'init.defaultBranch=main', '-c', 'core.autocrlf=false', '-c', 'commit.gpgsign=false', ...args], { cwd: dir, env, stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim();
  };
  let n = 0;
  const commit = (who, rel = 'src/app.py') => {
    n += 1;
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.appendFileSync(path.join(dir, rel), `change ${n}\n`);
    git(who, 'add', '.');
    git(who, 'commit', '-q', '-m', `change ${n}`);
  };
  git(OWNER, 'init', '-q');
  return {
    dir,
    commit,
    pr(number, merger, commits) {
      const branch = `pr-${number}`;
      git(merger, 'checkout', '-q', '-b', branch);
      for (const [who, rel] of commits) commit(who, rel);
      git(merger, 'checkout', '-q', 'main');
      git(merger, 'merge', '-q', '--no-ff', branch, '-m', `Merge pull request #${number} from someone/${branch}`);
    },
  };
}

async function interview(t, dir) {
  const before = process.env.CRAFTORIO_SIMULATION_ONLY;
  process.env.CRAFTORIO_SIMULATION_ONLY = '1';
  t.after(() => { if (before === undefined) delete process.env.CRAFTORIO_SIMULATION_ONLY; else process.env.CRAFTORIO_SIMULATION_ONLY = before; });
  const ws = setupWorkspace(tmp(t, 'wfi-844e-ws-'), { persist: false });
  seeds.seedSeeds(seeds.BUNDLED_SEEDS_DIR, ws.seeds);
  const project = await projects.createProject(ws.projects, { name: 'edge', folder: dir });
  const ctx = { ws, host: { appVersion: '9.9.9', isPackaged: false }, oracleService: () => { throw new Error('no model under simulation'); }, events: { emit: () => {} }, notify: () => {} };
  return workflowInterviewArea(ctx).workflowInterview({ projectId: project.id });
}

test('#844 the merger\'s root commit is not a straight push: one push for two merged PRs reads remote', async (t) => {
  const r = repo(t);
  r.commit(OWNER, 'README.md');
  r.commit(OWNER);
  r.pr(1, OWNER, [[BRUNO, 'src/cart.py']]);
  r.pr(2, OWNER, [[BRUNO, 'src/pay.py']]);
  const out = await interview(t, r.dir);
  assert.equal(out.profile.mode, 'remote');
  assert.equal(out.evidence.mode.numbers.ownerStraightCommits, 1);
  assert.equal(out.evidence.mode.numbers.mergeCommits, 2);
});

test('#844 merges by someone who never pushes straight to main read remote, whoever else pushes', async (t) => {
  const r = repo(t);
  r.commit(CARLA, 'README.md');
  r.pr(1, OWNER, [[BRUNO, 'src/cart.py']]);
  r.commit(CARLA);
  r.pr(2, OWNER, [[BRUNO, 'src/pay.py']]);
  r.commit(CARLA);
  r.commit(CARLA);
  const out = await interview(t, r.dir);
  assert.equal(out.profile.mode, 'remote');
  assert.equal(out.evidence.mode.numbers.ownerStraightCommits, 0);
});

test('#844 the merger\'s straight pushes under another e-mail are still theirs: local flow', async (t) => {
  const r = repo(t);
  r.commit(CARLA, 'README.md');
  r.commit(OWNER_WORK);
  r.pr(1, OWNER, [[BRUNO, 'src/cart.py']]);
  r.commit(OWNER_WORK);
  r.pr(2, OWNER, [[BRUNO, 'src/pay.py']]);
  const out = await interview(t, r.dir);
  assert.equal(out.profile.mode, 'local');
  assert.equal(out.evidence.mode.numbers.ownerStraightCommits, 2);
  assert.equal(out.evidence.team.numbers.authors, 3);
  assert.equal(out.evidence.team.numbers.identities, 4);
});

test('#844 a history with no merge is a local flow with one author per person', async (t) => {
  const r = repo(t);
  r.commit(OWNER, 'README.md');
  r.commit(OWNER_WORK);
  r.commit(OWNER);
  const out = await interview(t, r.dir);
  assert.equal(out.profile.mode, 'local');
  assert.equal(out.evidence.team.numbers.authors, 1);
  assert.equal(out.evidence.team.numbers.identities, 2);
});

test('#844 identities with an empty e-mail and different names are different people', async (t) => {
  const r = repo(t);
  r.commit(['Dora Reis', ''], 'README.md');
  r.commit(['Edu Melo', '']);
  const out = await interview(t, r.dir);
  assert.equal(out.evidence.team.numbers.authors, 2);
});

test('#844 test files without a test command still read as unit tests, never "none"', async (t) => {
  const r = repo(t);
  r.commit(OWNER, 'README.md');
  r.commit(OWNER, 'src/cart.py');
  r.commit(OWNER, 'tests/test_cart.py');
  const out = await interview(t, r.dir);
  assert.equal(out.profile.testCommand, null);
  assert.equal(out.profile.tests, 'unit');
});

test('#844 no test command and no test file read "none"', async (t) => {
  const r = repo(t);
  r.commit(OWNER, 'README.md');
  r.commit(OWNER, 'src/cart.py');
  const out = await interview(t, r.dir);
  assert.equal(out.profile.tests, 'none');
});
