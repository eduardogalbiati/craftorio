// #844 acceptance, written before the code: the Ways of working profile tells the truth about an imported
// repository's history. The fixture is the issue's shape: an owner who pushes straight to main (6 commits
// under two e-mails), one outside contributor whose 3 pull requests (#1-#3, under two names) the owner
// merged, one more person with one commit, 5 tags, no CI, no test command, no test file, no package.json.
// 5 git identities, 3 people.
//
// Spec (the interface these tests assume): require('../service/areas/workflow-interview')(ctx)
//   .workflowInterview({ projectId }) -> { profile, evidence, questions } (as in #487 / #640), run here
//   under MULTIAGENT_SIMULATION_ONLY=1 (no model: the free profile git and the files give).
// - evidence.team.numbers.authors counts people (identities of one person merged), not identities;
// - the mode is weighed by who merges: outside PRs merged by an owner who otherwise pushes straight to
//   main is a local flow (or the mode left open, asked as a question), never 'remote';
// - no test command and no test file: no test style is invented (tests not 'unit' / 'unit+e2e', no
//   question defaulting to 'unit');
// - the release style the questions default to is the one the wizard suggests for the same profile
//   (packages/shared/onboarding-model.js suggestWorkflows).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { setupWorkspace } = require('../domains/workspace/workspace');
const projects = require('../domains/project/projects');
const seeds = require('../domains/seed/seeds');
const OnboardingModel = require('@multiagent/shared/onboarding-model');

const loadArea = () => require('../service/areas/workflow-interview');

const OWNER = ['Ana Souza', 'ana@example.com'];
const OWNER_WORK = ['Ana Souza', 'ana.souza@work.example']; // the owner, another e-mail
const BRUNO = ['Bruno Lima', 'bruno@example.net'];
const BRUNO_SHORT = ['bruno', 'bruno@example.net']; // the contributor, another name
const CARLA = ['Carla Dias', 'carla@example.org'];

function tmp(t, prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }));
  return dir;
}

function simulation(t, value) {
  const before = process.env.MULTIAGENT_SIMULATION_ONLY;
  process.env.MULTIAGENT_SIMULATION_ONLY = value;
  t.after(() => { if (before === undefined) delete process.env.MULTIAGENT_SIMULATION_ONLY; else process.env.MULTIAGENT_SIMULATION_ONLY = before; });
}

// the issue's history: 3 merges of outside PRs, the owner's 6 straight commits, 5 tags, 5 identities of 3 people
function importedRepo(t) {
  const dir = tmp(t, 'wfi-844-repo-');
  const cfg = path.join(tmp(t, 'wfi-844-gitcfg-'), 'config');
  fs.writeFileSync(cfg, '');
  const base = { ...process.env, GIT_CONFIG_GLOBAL: cfg, GIT_CONFIG_NOSYSTEM: '1' };
  const git = (who, ...args) => {
    const [name, email] = who;
    const env = { ...base, GIT_AUTHOR_NAME: name, GIT_AUTHOR_EMAIL: email, GIT_COMMITTER_NAME: name, GIT_COMMITTER_EMAIL: email };
    return execFileSync('git', ['-c', 'init.defaultBranch=main', '-c', 'core.autocrlf=false', '-c', 'commit.gpgsign=false', '-c', 'tag.gpgsign=false', ...args], { cwd: dir, env, stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim();
  };
  const write = (rel, text) => {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.appendFileSync(path.join(dir, rel), text);
  };
  const commit = (who, rel, msg) => {
    write(rel, `${msg}\n`);
    git(who, 'add', '.');
    git(who, 'commit', '-q', '-m', msg);
  };
  const pr = (branch, commits) => {
    git(OWNER, 'checkout', '-q', '-b', branch);
    for (const [who, rel, msg] of commits) commit(who, rel, msg);
    git(OWNER, 'checkout', '-q', 'main');
  };
  const merge = (n, branch) => git(OWNER, 'merge', '-q', '--no-ff', branch, '-m', `Merge pull request #${n} from bruno-lima/${branch}`);

  git(OWNER, 'init', '-q');
  git(OWNER, 'config', 'user.name', OWNER[0]);
  git(OWNER, 'config', 'user.email', OWNER[1]);
  git(OWNER, 'remote', 'add', 'origin', 'https://github.com/ana-souza/shop.git');
  commit(CARLA, 'README.md', 'Initial import');
  commit(OWNER, 'src/app.py', 'owner straight 1');
  git(OWNER, 'tag', 'v0.1.0');
  commit(OWNER_WORK, 'src/app.py', 'owner straight 2');
  pr('one',[[BRUNO, 'src/cart.py', 'cart: first cut'], [BRUNO, 'src/cart.py', 'cart: totals']]);
  commit(OWNER, 'src/app.py', 'owner straight 3');
  merge(1, 'one');
  git(OWNER, 'tag', 'v0.2.0');
  pr('two',[[BRUNO_SHORT, 'src/pay.py', 'pay: card form']]);
  commit(OWNER, 'docs/notes.md', 'owner straight 4');
  merge(2, 'two');
  git(OWNER, 'tag', 'v0.3.0');
  commit(OWNER, 'src/app.py', 'owner straight 5');
  pr('three',[[BRUNO, 'src/ship.py', 'ship: rates']]);
  merge(3, 'three');
  git(OWNER, 'tag', 'v0.4.0');
  commit(OWNER, 'src/app.py', 'owner straight 6');
  git(OWNER, 'tag', 'v0.5.0');
  return dir;
}

async function interviewed(t) {
  simulation(t, '1');
  const ws = setupWorkspace(tmp(t, 'wfi-844-ws-'), { persist: false });
  seeds.seedSeeds(seeds.BUNDLED_SEEDS_DIR, ws.seeds);
  const project = await projects.createProject(ws.projects, { name: 'shop', folder: importedRepo(t) });
  const ctx = { ws, host: { appVersion: '9.9.9', isPackaged: false }, oracleService: () => { throw new Error('no model under simulation'); }, events: { emit: () => {} }, notify: () => {} };
  return loadArea()(ctx).workflowInterview({ projectId: project.id });
}

const questionOf = (out, id) => (out.questions || []).find((q) => q.id === id) || null;

test('#844 authors are people: 5 git identities of 3 people count 3 authors', async (t) => {
  const out = await interviewed(t);
  assert.equal(out.evidence.team.numbers.authors, 3, `evidence.team: ${JSON.stringify(out.evidence.team.numbers)}`);
  const modeAuthors = out.evidence.mode?.numbers?.authors;
  if (modeAuthors !== undefined) assert.equal(modeAuthors, 3, `evidence.mode: ${JSON.stringify(out.evidence.mode.numbers)}`);
});

test('#844 outside PRs merged by an owner who pushes straight to main: the mode is local or left open, never remote', async (t) => {
  const out = await interviewed(t);
  assert.notEqual(out.profile.mode, 'remote', `profile.mode: ${out.profile.mode}`);
  const open = out.profile.mode == null && questionOf(out, 'mode') !== null;
  assert.equal(out.profile.mode === 'local' || open, true, `profile.mode ${JSON.stringify(out.profile.mode)}, mode question ${JSON.stringify(questionOf(out, 'mode'))}`);
});

test('#844 no test command and no test file: no test style is invented', async (t) => {
  const out = await interviewed(t);
  assert.equal(out.profile.testCommand, null, 'no test command in the fixture');
  assert.equal(['unit', 'unit+e2e'].includes(out.profile.tests), false, `profile.tests: ${JSON.stringify(out.profile.tests)}`);
  const unitDefaults = (out.questions || []).filter((q) => q.default === 'unit' || q.default === 'unit+e2e').map((q) => q.id);
  assert.deepEqual(unitDefaults, [], 'no question defaults to unit tests');
});

test('#844 the release style the questions default to is the one the wizard suggests for the same profile', async (t) => {
  const out = await interviewed(t);
  const wizard = OnboardingModel.suggestWorkflows(out.profile).suggestions.find((s) => s.id === 'release').value;
  const asked = questionOf(out, 'release');
  const engine = asked ? asked.default : out.profile.release;
  assert.equal(engine, wizard, `the questions' release ${JSON.stringify(engine)}, the wizard's ${JSON.stringify(wizard)} (profile.mode ${JSON.stringify(out.profile.mode)})`);
});
