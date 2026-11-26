// #79: the import checks that its clone can push before the wizard ends, and the push warning's button sets up
// git's credentials (packages/engine/service/areas/project-onboarding.js: the state's pushCheck, setupGit).
// Boundaries replaced: git's clone (a real `git init` with origin = the URL), gh (platformCli) and the push check
// itself (createOnboarding's pushCheck option, the clone's `git push --dry-run`). Under
// CRAFTORIO_SIMULATION_ONLY the check runs only with its E2E switch (CRAFTORIO_E2E_GIT_PUSH), set here so the
// injected check is used.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const loadArea = () => require('../service/areas/project-onboarding');

const GITHUB = 'https://github.com/acme/widgets.git';
const FIX = { platform: 'github', command: 'gh auth setup-git' };

function tmp(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'onboarding-push-79-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }));
  return dir;
}

function e2eSwitch(t) {
  const before = process.env.CRAFTORIO_E2E_GIT_PUSH;
  process.env.CRAFTORIO_E2E_GIT_PUSH = '1';
  t.after(() => { if (before === undefined) delete process.env.CRAFTORIO_E2E_GIT_PUSH; else process.env.CRAFTORIO_E2E_GIT_PUSH = before; });
}

const pause = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(ob, id, pred, what) {
  let last;
  for (let i = 0; i < 300; i++) {
    last = await ob.status(id);
    if (pred(last)) return last;
    await pause(10);
  }
  assert.fail(`${what}: still ${JSON.stringify(last?.pushCheck ?? null)} (status ${last?.status})`);
}

const realGit = (args, cwd) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'init.defaultBranch=main', ...args], { cwd, stdio: ['ignore', 'pipe', 'pipe'] }).toString();
const git = async (args, cwd) => {
  if (args[0] === 'ls-remote') return 'abc123\tHEAD\n';
  if (args[0] === 'clone') {
    const [, url, dest] = args;
    fs.mkdirSync(dest, { recursive: true });
    realGit(['init', '-q'], dest);
    realGit(['remote', 'add', 'origin', url], dest);
    return '';
  }
  return realGit(args, cwd);
};

// gh: the repository with push permission; `auth setup-git` answers `setupOk`
function fakeGh({ setupOk = true } = {}) {
  const calls = [];
  const platformCli = async (provider, args) => {
    const a = args.map(String);
    calls.push({ provider, args: a });
    if (a[0] === 'api' && a.some((x) => /^\/?repos\/acme\/widgets$/.test(x))) {
      return { ok: true, out: JSON.stringify({ full_name: 'acme/widgets', fork: false, html_url: 'https://github.com/acme/widgets', clone_url: GITHUB, default_branch: 'main', permissions: { push: true, pull: true } }) };
    }
    if (a[0] === 'auth' && a[1] === 'setup-git') return setupOk ? { ok: true, out: '' } : { ok: false, out: 'gh: not logged in' };
    return { ok: false, out: `unexpected gh ${a.join(' ')}` };
  };
  return { platformCli, setupCalls: () => calls.filter((c) => c.args[0] === 'auth' && c.args[1] === 'setup-git') };
}

// the clone's push check: refused (git without credentials) until `fixed()` is called
function fakePushCheck({ refused = true } = {}) {
  let fixed = !refused;
  let checks = 0;
  const pushCheck = async () => {
    checks++;
    return fixed ? { ok: true } : { ok: false, reason: 'fatal: could not read Username for \'https://github.com\': terminal prompts disabled', fix: 'Run `gh auth setup-git` so git uses the GitHub CLI\'s sign-in.', setupGit: FIX };
  };
  return { pushCheck, fix: () => { fixed = true; }, checks: () => checks };
}

function setup(t, { gh = fakeGh(), check = fakePushCheck(), repo = GITHUB } = {}) {
  e2eSwitch(t);
  const root = tmp(t);
  const ob = loadArea().createOnboarding({
    projectsDir: path.join(root, 'projects'),
    reposDir: path.join(root, 'repos'),
    git,
    cli: async () => ({ installed: true, signedIn: true }),
    platformCli: async (provider, args, opts) => {
      const answer = await gh.platformCli(provider, args, opts);
      if (answer.ok && args[0] === 'auth' && args[1] === 'setup-git') check.fix();
      return answer;
    },
    pushCheck: check.pushCheck,
    jobs: {
      facts: async () => ({ commits: 3 }),
      profile: async () => ({ profile: { mode: 'remote', ci: 'pr+release', tests: 'unit' } }),
      projectMap: async () => ({ findings: [] }),
    },
    slotsDir: path.join(root, 'locks'),
  });
  return { ob, gh, check, start: () => ob.start({ name: 'Widgets', repo }) };
}

const settled = (s) => s.pushCheck && (s.pushCheck.status === 'ok' || s.pushCheck.status === 'failed');

test('#79 a clone that cannot push: the import says so with the fix, and the import itself does not fail', async (t) => {
  const { ob, start } = setup(t);
  const s = await start();
  const done = await until(ob, s.projectId, settled, 'the push check');
  assert.equal(done.pushCheck.ok, false);
  assert.match(String(done.pushCheck.fix), /gh auth setup-git/);
  assert.match(String(done.pushCheck.reason), /could not read Username/);
  assert.notEqual(done.status, 'failed');
});

test('#79 a clone that can push: the push check reads ok and there is nothing to fix', async (t) => {
  const { ob, start } = setup(t, { check: fakePushCheck({ refused: false }) });
  const s = await start();
  const done = await until(ob, s.projectId, settled, 'the push check');
  assert.equal(done.pushCheck.ok, true);
  assert.equal(done.pushCheck.fix ?? null, null);
});

test('#79 the push warning\'s button runs gh auth setup-git once, checks again and the warning clears', async (t) => {
  const { ob, gh, check, start } = setup(t);
  const s = await start();
  await until(ob, s.projectId, settled, 'the push check');
  const before = check.checks();
  const after = await ob.setupGit(s.projectId);
  const final = after.pushCheck?.status === 'ok' ? after : await until(ob, s.projectId, (x) => x.pushCheck?.status === 'ok', 'the check after setup-git');
  assert.equal(gh.setupCalls().length, 1);
  assert.equal(gh.setupCalls()[0].provider, 'github');
  assert.equal(check.checks() > before, true, 'checked again after the setup');
  assert.equal(final.pushCheck.ok, true);
});

test('#79 a setup-git that fails keeps the warning, with why it failed', async (t) => {
  const { ob, start } = setup(t, { gh: fakeGh({ setupOk: false }) });
  const s = await start();
  await until(ob, s.projectId, settled, 'the push check');
  const after = await ob.setupGit(s.projectId);
  assert.equal(after.pushCheck.ok, false);
  assert.equal(after.pushCheck.status, 'failed');
  assert.match(String(after.pushCheck.reason), /setup-git/);
});

test('#79 the button on a clone that can push is refused: nothing to set up, gh is not called', async (t) => {
  const { ob, gh, start } = setup(t, { check: fakePushCheck({ refused: false }) });
  const s = await start();
  await until(ob, s.projectId, settled, 'the push check');
  await assert.rejects(ob.setupGit(s.projectId), /nothing to set up/);
  assert.equal(gh.setupCalls().length, 0);
});
