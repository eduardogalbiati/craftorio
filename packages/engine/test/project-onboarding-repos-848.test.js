// #848: the repositories the wizard's Repository step filters (packages/engine/service/areas/project-onboarding.js
// machineRepos / cliAccounts): up to 100 asked of the CLI, and the E2E hook CRAFTORIO_E2E_GITHUB_REPOS that stands
// for gh in a simulated run. The CLI is the system boundary: a fake gh first on the PATH (as run-pr-cli-797.test.js)
// records its arguments and prints the JSON of `gh repo list --json`.
//
// The fake CLI is a #!/bin/sh script: macOS and Linux only.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { resolveCommand } = require('../engine/providers');

const onboarding = () => require('../service/areas/project-onboarding');
const POSIX = { skip: process.platform === 'win32' ? 'needs a shell script as the CLI' : false };
const HOOK = 'CRAFTORIO_E2E_GITHUB_REPOS';
const SIM = 'CRAFTORIO_SIMULATION_ONLY';
const HOOK_REPOS = [
  { name: 'e2e-owner/shop-api', private: false, updatedAt: '2026-11-19T10:00:00Z' },
  { name: 'e2e-owner/legacy-shop', private: true, updatedAt: '2026-11-13T10:00:00Z' },
];
const CLI_JSON = JSON.stringify([{ nameWithOwner: 'cli-owner/from-gh', isPrivate: false, updatedAt: '2026-11-01T10:00:00Z' }]);

// sets the variables for this test only (undefined removes one)
function withEnv(t, vars) {
  const saved = Object.fromEntries(Object.keys(vars).map((k) => [k, process.env[k]]));
  for (const [k, v] of Object.entries(vars)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  t.after(() => { for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } });
}

// `cli` first on the PATH for this test → reads the arguments it was called with ([] when it never ran)
function fakeCli(t, cli, stdout) {
  resolveCommand(cli);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'repos-848-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(dir, 'out'), stdout);
  fs.writeFileSync(path.join(dir, cli), `#!/bin/sh\nprintf '%s\\n' "$@" > "${dir}/args"\ncat "${dir}/out"\n`, { mode: 0o755 });
  const realPath = process.env.PATH;
  process.env.PATH = [dir, realPath].join(path.delimiter);
  t.after(() => { process.env.PATH = realPath; });
  return () => (fs.existsSync(path.join(dir, 'args')) ? fs.readFileSync(path.join(dir, 'args'), 'utf8').trim().split('\n') : []);
}

const valueAfter = (args, flag) => { const i = args.indexOf(flag); return i < 0 ? null : args[i + 1]; };

test('#848 machineRepos asks gh for up to 100 repositories', POSIX, async (t) => {
  withEnv(t, { [HOOK]: undefined });
  const args = fakeCli(t, 'gh', CLI_JSON);
  const repos = await onboarding().machineRepos('github');
  assert.deepEqual(repos.map((r) => r.name), ['cli-owner/from-gh']);
  assert.deepEqual(args().slice(0, 2), ['repo', 'list']);
  assert.equal(valueAfter(args(), '--limit'), '100');
});

test('#848 machineRepos asks glab for up to 100 repositories', POSIX, async (t) => {
  const args = fakeCli(t, 'glab', JSON.stringify([{ path_with_namespace: 'grp/app', visibility: 'public', last_activity_at: null }]));
  const repos = await onboarding().machineRepos('gitlab');
  assert.deepEqual(repos.map((r) => r.name), ['grp/app']);
  assert.equal(valueAfter(args(), '--per-page'), '100');
});

test('#848 E2E hook: in a simulated run machineRepos(github) answers the hook\'s list in its order, without gh', POSIX, async (t) => {
  withEnv(t, { [SIM]: '1', [HOOK]: JSON.stringify(HOOK_REPOS) });
  const args = fakeCli(t, 'gh', CLI_JSON);
  const repos = await onboarding().machineRepos('github');
  assert.deepEqual(repos.map((r) => r.name), ['e2e-owner/shop-api', 'e2e-owner/legacy-shop']);
  assert.equal(args().length, 0);
});

test('#848 E2E hook: in a simulated run cliAccounts answers GitHub installed and signed in as e2e-owner', async (t) => {
  withEnv(t, { [SIM]: '1', [HOOK]: JSON.stringify(HOOK_REPOS) });
  const accounts = await onboarding().cliAccounts();
  const gh = accounts.find((a) => a.provider === 'github');
  assert.deepEqual([gh?.cli, gh?.installed, gh?.signedIn, gh?.account], ['gh', true, true, 'e2e-owner']);
});

test('#848 E2E hook: an invalid JSON falls back to gh\'s own list', POSIX, async (t) => {
  withEnv(t, { [SIM]: '1', [HOOK]: '[not json' });
  fakeCli(t, 'gh', CLI_JSON);
  const repos = await onboarding().machineRepos('github');
  assert.deepEqual(repos.map((r) => r.name), ['cli-owner/from-gh']);
});

test('#848 E2E hook: a JSON that is not an array falls back to gh\'s own list', POSIX, async (t) => {
  withEnv(t, { [SIM]: '1', [HOOK]: JSON.stringify({ name: 'e2e-owner/shop-api' }) });
  fakeCli(t, 'gh', CLI_JSON);
  const repos = await onboarding().machineRepos('github');
  assert.deepEqual(repos.map((r) => r.name), ['cli-owner/from-gh']);
});

test('#848 E2E hook: outside a simulated run the hook is ignored and gh answers', POSIX, async (t) => {
  withEnv(t, { [SIM]: '0', [HOOK]: JSON.stringify(HOOK_REPOS) });
  fakeCli(t, 'gh', CLI_JSON);
  const repos = await onboarding().machineRepos('github');
  assert.deepEqual(repos.map((r) => r.name), ['cli-owner/from-gh']);
});

test('#848 E2E hook: it stands for gh only, never for another provider\'s list', POSIX, async (t) => {
  withEnv(t, { [SIM]: '1', [HOOK]: JSON.stringify(HOOK_REPOS) });
  fakeCli(t, 'glab', JSON.stringify([{ path_with_namespace: 'grp/app', visibility: 'public', last_activity_at: null }]));
  const repos = await onboarding().machineRepos('gitlab');
  assert.deepEqual(repos.map((r) => r.name), ['grp/app']);
});
