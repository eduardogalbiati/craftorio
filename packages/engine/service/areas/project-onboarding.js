// @ts-check
// Service area (#640, onboarding step 3 of docs/work/first-project-onboarding/plan.md): the jobs that
// follow a new project's import, chained by dependency: clone (#639, packages/engine/domains/project/projects.js)
// → facts → (the Ways of working profile ∥ the project map). #731: the project map job draws the city plan
// (project-map.js drawMap: the cartographer's turn, validated and saved) then runs the Oracle's report
// (analyzeMap), so the project's City is grouped by the plan after the onboarding. #730: the report's
// findings stay findings (no Refactor proposal, no Product Owner ranking): the wizard's review files them.
// The free part (facts and what git tells of the profile, spec R5) runs once the clone is ready; the paid part (the
// project map and, #74, the Oracle's turn on the profile fields git leaves open) only after onboardingAnalyze
// ("analyze later" never calls it, nor does a restart): until then such a profile job is `waiting` with git's
// profile. A done analysis says what it cost, costUsd, when its record does; after a restart too (savedMap: the
// project's real report is its map, done and not paid twice). The project map takes the
// machine-wide slot SLOT (packages/engine/engine/machine-slot.js), so it waits for
// other heavy work on the machine. The state of each project is kept in memory:
//   { projectId, status: cloning | ready | analyzing | analyzed | failed, code?: no-access | clone-failed,
//     reason?, wanted? (#74: analyze asked during the clone, runs when it ends),
//     jobs: { clone, facts, profile, projectMap: { status: waiting | running | done | failed | skipped, error?, costUsd? } },
//     #725: a failed job is { status: 'failed', error (the full error), code: cli-missing | invalid-ranking |
//     no-folder | refused | timeout | failed, reason (≤ 160 characters), cli? } (failureOf); once the paid
//     part ended the status is analyzed even with a failed job, and analyzing again runs only what is not done;
//     cli: { provider: github | gitlab, status: checking | ok | missing | signed-out, reason? } | null,
//     remote?: { provider, status: creating | created | missing | signed-out | failed, url?, reason? },
//     #738: access?: { push } (gh's permissions.push, once read), fork?: { status: suggested | created | reused |
//     declined | failed, repo?, url?, reason? } (only without push: the wizard's "Create a fork / Work locally") }
// #632 (spec R4): create() makes a new project instead of importing one: git init on main, README and
// .gitignore in a first commit, then its private remote only when asked and gh / glab is signed in (`remote`);
// it is ready at once, nothing is cloned, and the three answers are its profile (jobs.profile.profile); its
// state also has the project's `name`, so the wizard follows it (remote: creating) before create() answers.
// and every change is pushed as `onboarding:changed` (channels/onboarding.js). A refused access check or
// a failed clone ends `failed` with a readable reason (#107: a refused access check creates no project at all:
// start answers { status: 'failed', code: repo-not-found | repo-no-access | not-a-git-repo | no-network | no-git,
// reason } with no projectId; CRAFTORIO_E2E_REPO_ACCESS stands for git's answer in a simulated run); onboardingRetry runs again what failed (the
// access check and the clone, a failed job) and always checks gh / glab again. A project removed while
// its jobs run loses its state; no error of a job escapes the chain.
// #741: the wizard's own state is saved with the project's record, `onboarding: { step, picks, finished }`
// (saveWizard on every change of the wizard, finish on Finish; status() answers it as `wizard`), so it outlives
// the process; start() with the repository of an existing project resumes its unfinished onboarding (no second
// project) or answers { exists, finished, projectId } for a finished one.
// #30: a clone with an npm lockfile and no node_modules gets `deps: { status: missing | installing | installed |
// failed, lockfile, command, reason? }` (depsOf, in the change that makes it ready, and on restore): the machine
// checks (rule_check) need them. installDeps runs `npm ci` (with --ignore-scripts under the project's setting,
// #472) in the clone through `install` (default: deps-cache.js runCommand).
// #105: a folder imported by its file:// URL (the project's `source`): gh / glab follow its real remote (`repo`),
// no push permission or push check is read (its runs push to the folder), and with no remote the profile is local.

const fs = require('fs');
const path = require('path');
const OnboardingModel = require('@craftorio/shared/onboarding-model');
const Platforms = require('@craftorio/shared/platforms');
// #848: the platform the gh E2E hook stands for, the GitHub adapter's own id (#351: no platform literal here)
const { id: E2E_REPOS_PLATFORM } = require('@craftorio/shared/platforms/github');
const agents = require('../../domains/agents/agents');
const arch = require('../../domains/oracle/oracle-architecture');
const depsCache = require('../../engine/deps-cache');
const { oneLine } = require('../../engine/gate-summary');
const issues = require('../../domains/backlog/issues');
const { identityArgs } = require('../../engine/worktree');
const projectMap = require('../../domains/project/project-map');
const projects = require('../../domains/project/projects');
const seedRuns = require('../seed-runs');
const simulation = require('../../engine/simulation');
const slots = require('../../engine/machine-slot');
const {
  checkPushAccess,
  cloneFolder,
  execGit,
  isGitUrl,
  isSshUrl,
  pushableUrl,
  sameRepo,
} = require('../../domains/workspace/workspace');
const { resolveCommandAsync } = require('../../engine/providers');
const {
  clientError,
  runTool,
} = require('../common');
const { toolSignIn } = require('./settings');

const SLOT = slots.ANALYSIS_SLOT;
const JOBS = ['clone', 'facts', 'profile', 'projectMap'];
const PAID = ['projectMap'];

// a readable reason for an access check that did not reach the repository; #107: by its cause (never
// "credentials" for a repository that does not exist or a folder without git)
const ACCESS_LEADS = {
  'no-git': 'Git is not installed, so the repository cannot be cloned. Install git and retry.',
  'no-network': 'The repository could not be reached: check the network connection and retry.',
  'not-a-git-repo': 'The folder is not a git repository: pick a folder with git in it, or import its URL.',
  'repo-not-found': 'No repository was found at this URL: check the owner and the name, then import again.',
};
function accessReason(access) {
  const detail = String(access.message || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean).slice(-1)[0] || '';
  const lead = ACCESS_LEADS[access.status] || ACCESS_LEADS[access.cause]
    || 'The repository could not be reached with your credentials: check the URL, or sign in with access to it, and retry.';
  return detail ? `${lead} (${detail})` : lead;
}

// #107: the answer to an import refused before anything is created (no project, no folder in repos/): no
// projectId, its cause as the code (repo-not-found | repo-no-access | not-a-git-repo | no-network | no-git)
const refusedImport = (access) => ({
  status: 'failed',
  code: access.cause || access.status,
  reason: accessReason(access),
  jobs: { ...Object.fromEntries(JOBS.map((j) => [j, { status: 'waiting' }])), clone: { status: 'skipped' } },
  cli: null,
});

// #107: the E2E hook of a simulated run (features/steps/onboarding.steps.js): CRAFTORIO_E2E_REPO_ACCESS=not-found |
// no-access stands for git ls-remote on an http(s) URL, in git's own words (checkAccess names the cause from them)
const E2E_ACCESS = {
  'no-access': "remote: Invalid username or password.\nfatal: Authentication failed (The requested URL returned error: 403)",
  'not-found': 'remote: Repository not found.\nfatal: repository not found',
};
function e2eAccessGit(repo) {
  const answer = simulation.simulationOnly() && /^https?:\/\//i.test(repo) ? E2E_ACCESS[process.env.CRAFTORIO_E2E_REPO_ACCESS || ''] : null;
  return answer ? async () => { throw new Error(`git ls-remote failed: ${answer}`); } : null;
}

// #725: a failed job's { code, reason, cli? } from its error: the known failures (refactor-priority.js's CLI
// missing, invalid ranking and no folder, a profile job without a profile, a refused job, providers.js's
// timeout) get their code, one of OnboardingModel.FAILURE_CODES (the wizard words them in its language),
// 'failed' else; reason: the error's first line, at most 160 characters
const cut = (text, n = 160) => (text.length > n ? `${text.slice(0, n - 1)}…` : text);
const CLI_MISSING = /needs (\S+), which is not installed/;
const FAILURE_TESTS = {
  'cli-missing': (e, error) => CLI_MISSING.test(error),
  'invalid-ranking': (e, error) => /ranking (could not be read|is not valid)/.test(error),
  'no-folder': (e, error) => /has no folder on this machine/.test(error),
  'no-profile': (e) => Boolean(e?.noProfile),
  refused: (e) => Boolean(e?.refused),
  timeout: (e, error) => /^Timed out after/.test(error),
};
function failureOf(e) {
  const error = String(e?.message || e || '');
  const line = cut(error.split(/\r?\n/).map((l) => l.trim()).find(Boolean) || 'The job failed without a reason.');
  const code = OnboardingModel.FAILURE_CODES.find((c) => FAILURE_TESTS[c](e, error)) || 'failed';
  return { code, ...(code === 'cli-missing' ? { cli: /** @type {RegExpMatchArray} */ (error.match(CLI_MISSING))[1] } : {}), reason: line };
}

// an E2E hook's comma-separated list of names (the environment variable named)
const listed = (name) => String(process.env[name] || '').split(',').map((s) => s.trim()).filter(Boolean);

// #725: the E2E hooks of a simulated run (features/steps/onboarding.steps.js): the jobs named in
// CRAFTORIO_E2E_ONBOARDING_HOLD never end, those in CRAFTORIO_E2E_ONBOARDING_FAIL throw
function e2eJobs(jobs) {
  if (!simulation.simulationOnly()) return jobs;
  const hold = listed('CRAFTORIO_E2E_ONBOARDING_HOLD');
  const fail = listed('CRAFTORIO_E2E_ONBOARDING_FAIL');
  if (!hold.length && !fail.length) return jobs;
  return Object.fromEntries(Object.entries(jobs).map(([name, run]) => [name, async (input) => {
    if (hold.includes(name)) return new Promise(() => {});
    if (fail.includes(name)) throw new Error(`The simulated ${name} failed (e2e).`);
    return run(input);
  }]));
}

// #74: the E2E hook of a simulated run (simulation.js e2eOnboardingCosts): a job named there acts as a paid one
// with that cost, the profile as one the Oracle completes only once the analysis is asked for
function e2eCosts(jobs) {
  const costs = simulation.e2eOnboardingCosts();
  if (!costs) return jobs;
  return Object.fromEntries(Object.entries(jobs).map(([name, run]) => [name, async (input) => {
    const result = await run(input);
    if (!Number.isFinite(costs[name])) return result;
    const paid = { ...result, simulated: false };
    return name === 'profile' && !input.oracle ? { ...paid, needsOracle: true } : { ...paid, costUsd: costs[name], cost_usd: costs[name] };
  }]));
}

// #731: the E2E hook of a simulated run (features/steps/onboarding.steps.js): CRAFTORIO_E2E_CITY_PLAN_FAIL=1
// makes the projectMap job's city plan throw before the Oracle's report
function e2eCityPlan() {
  if (simulation.simulationOnly() && process.env.CRAFTORIO_E2E_CITY_PLAN_FAIL === '1') throw new Error('The simulated city plan failed (e2e).');
}

// #724 #743: the clone is not one of those jobs (follow() awaits projects.cloneJob): in a simulated run
// CRAFTORIO_E2E_ONBOARDING_HOLD=clone keeps it cloning, CRAFTORIO_E2E_ONBOARDING_CLONE_DELAY_MS slows it
function e2eCloneWait() {
  if (!simulation.simulationOnly()) return null;
  if (listed('CRAFTORIO_E2E_ONBOARDING_HOLD').includes('clone')) return new Promise(() => {});
  const ms = Number(process.env.CRAFTORIO_E2E_ONBOARDING_CLONE_DELAY_MS);
  return ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : null;
}

// 'github' | 'gitlab' (a platform with a CLI) from the repository's URL, null for another host
// (the registry's rule, the one the wizard shows: packages/shared/platforms/index.js)
const providerOf = (repo) => Platforms.platformOfRepoUrl(repo)?.id || null;

// the cli part of the state from what the check answered
function cliState(provider, found) {
  const { cli: id, label } = issues.PLATFORMS[provider];
  const name = `${label} CLI`;
  if (!found?.installed) return { provider, status: 'missing', reason: `The ${name} (${id}) is not installed: the import goes on, but issues and pull requests are unavailable until you install it.` };
  if (!found.signedIn) return { provider, status: 'signed-out', reason: `The ${name} (${id}) is not signed in: the import goes on, but issues and pull requests are unavailable until you run ${id} auth login.` };
  return { provider, status: 'ok' };
}

// gh / glab on this machine: installed, and signed in (settings.js's probe)
const machineCli = (provider) => toolSignIn(issues.PLATFORMS[provider].cli);

// the wizard's repository step before any import (#669, mock-2): per platform with a CLI, { provider, cli,
// installed, signedIn, account? }, from the same probe as the import's check
const cliAccounts = (cli = accountsCli) => Promise.all(Platforms.PLATFORMS.filter((p) => p.cli)
  .map(async (p) => ({ provider: p.id, cli: p.cli, ...(await cli(p.id)) })));

// #848: the E2E hook of a simulated run (features/steps/onboarding.steps.js): CRAFTORIO_E2E_GITHUB_REPOS=<JSON
// array of { name, private, updatedAt }, newest first> stands for gh on the repository step: GitHub signed in as
// e2e-owner and that list, without calling gh. null without the hook (or with no JSON array)
function e2eGithubRepos() {
  if (!simulation.simulationOnly() || !process.env.CRAFTORIO_E2E_GITHUB_REPOS) return null;
  try {
    const repos = JSON.parse(process.env.CRAFTORIO_E2E_GITHUB_REPOS);
    return Array.isArray(repos) ? repos : null;
  } catch { return null; }
}
const accountsCli = (provider) => (provider === E2E_REPOS_PLATFORM && e2eGithubRepos()
  ? { installed: true, signedIn: true, account: E2E_LOGIN }
  : machineCli(provider));

// the signed-in account's repositories as its CLI lists them (mock-2's list under the field, the adapter's
// repoListCommand / parseRepos): [{ name: 'owner/repo', private, updatedAt }], [] for an unknown provider or
// when the CLI is missing, signed out or answers no JSON. #848: up to 100, so the wizard's filter finds
// older repositories too (GitLab's --per-page caps at 100)
async function machineRepos(provider) {
  const platform = Platforms.findPlatform(provider);
  if (!platform?.cli || typeof platform.repoListCommand !== 'function') return [];
  const e2e = provider === E2E_REPOS_PLATFORM ? e2eGithubRepos() : null;
  if (e2e) return e2e;
  const { cli, args } = platform.repoListCommand(100);
  const r = await resolveCommandAsync(cli);
  if (!r) return [];
  const out = await runTool(r.file, args);
  return out.ok ? platform.parseRepos(out.out) : [];
}

// #632: why a new project's remote was not created, when its CLI is missing or signed out
function remoteReason(provider, status) {
  const { cli: id, label } = issues.PLATFORMS[provider];
  return status === 'missing'
    ? `The ${label} CLI (${id}) is not installed, so no repository was created on ${label}: the project stays local.`
    : `The ${label} CLI (${id}) is not signed in, so no repository was created on ${label}: the project stays local until you run ${id} auth login.`;
}

// #632 (spec R4): the private repository of a new project, created by its platform's CLI from its folder
// (the adapter's repoCreateCommand, never public), then origin set and main pushed when it has a commit
// → { ok, url } | { ok: false, error }. The system boundary the tests replace.
async function machineRemote(provider, { name, folder }) {
  const platform = Platforms.findPlatform(provider);
  if (!platform?.cli || typeof platform.repoCreateCommand !== 'function') return { ok: false, error: `No CLI creates repositories on ${provider}.` };
  // a simulated run never publishes anything outside the machine
  if (simulation.simulationOnly()) return { ok: false, error: `Simulation only: no repository is created on ${platform.label}.` };
  const { cli, args } = platform.repoCreateCommand({ name, folder });
  const r = await resolveCommandAsync(cli);
  if (!r) return { ok: false, error: `${cli} is not installed.` };
  const created = await runTool(r.file, args, {}, { cwd: folder, timeout: 60000 });
  const url = (created.out.match(/https:\/\/\S+/g) || []).slice(-1)[0]?.replace(/\.git$/, '') || null;
  if (!created.ok || !url) return { ok: false, error: created.out || `${cli} did not create the repository.` };
  try {
    await execGit(['remote', 'get-url', 'origin'], folder).catch(() => execGit(['remote', 'add', 'origin', `${url}.git`], folder));
    const committed = await execGit(['rev-parse', '--verify', '--quiet', 'HEAD'], folder).then(() => true, () => false);
    if (committed) await execGit(['push', '-u', 'origin', 'main'], folder, { timeout: 60000 });
  } catch (e) {
    return { ok: false, url, error: `The repository ${url} was created, but main was not pushed: ${String(e?.message || e)}` };
  }
  return { ok: true, url };
}

// #738: the simulated gh of an E2E run (features/steps/onboarding.steps.js): CRAFTORIO_E2E_REPO_PUSH=0|1 is
// the imported repository's permissions.push, whatever its host (a local file:// one too); with it, the
// signed-in user is e2e-owner, who has no fork yet, and `gh repo fork` answers a fork URL without the network.
// Without the hook a simulated run reads nothing (null: unknown).
const E2E_LOGIN = 'e2e-owner';
function e2ePlatformCli(args) {
  const hook = process.env.CRAFTORIO_E2E_REPO_PUSH;
  if (hook !== '0' && hook !== '1') return null;
  const a = args.map(String);
  const api = a[0] === 'api' ? a.find((x, i) => i > 0 && !x.startsWith('-')) || '' : null;
  if (api === 'user') return { ok: true, out: JSON.stringify({ login: E2E_LOGIN }) };
  if (api && api.startsWith(`repos/${E2E_LOGIN}/`)) return { ok: false, out: 'gh: Not Found (HTTP 404)' };
  if (api && api.startsWith('repos/')) return { ok: true, out: JSON.stringify({ full_name: api.slice(6), fork: false, permissions: { pull: true, push: hook === '1' } }) };
  if (a[0] === 'repo' && a[1] === 'fork') return { ok: true, out: `https://github.com/${E2E_LOGIN}/${String(a[2] || '').split('/').pop()}\n` };
  return null;
}

// #79: the simulated git credentials of an E2E run (simulation.e2eGitPush, CRAFTORIO_E2E_GIT_PUSH=0): the push
// check fails as git does without credentials until the simulated setup-git (e2eSetupGit) sets them up
let e2eGitSetUp = false;
function e2eSetupGit(provider, args) {
  const command = Platforms.findPlatform(provider)?.setupGitCommand?.();
  if (simulation.e2eGitPush() === null || !command || args.map(String).join(' ') !== command.args.join(' ')) return null;
  e2eGitSetUp = true;
  return { ok: true, out: '' };
}

/** #79: whether the clone in `folder` can push (workspace.js checkPushAccess, git without the app's credential
 * helper, as the runs' agents push); simulated under CRAFTORIO_E2E_GIT_PUSH. */
function machinePushCheck(folder) {
  const hook = simulation.e2eGitPush();
  if (hook === null) return checkPushAccess(folder, { run: (args, cwd) => execGit(args, cwd, { auth: false, timeout: 60000 }) });
  const refused = 'fatal: could not read Username for \'https://github.com\': terminal prompts disabled';
  return checkPushAccess(folder, {
    run: (args) => (args[0] === 'push' && !hook && !e2eGitSetUp ? Promise.reject(new Error(refused)) : Promise.resolve('https://github.com/e2e-owner/repo.git')),
  });
}

// #738: gh / glab for a provider, args as given (the system boundary the tests replace) → { ok, out }; a
// simulated run never calls them (e2ePlatformCli's answers, else { ok: false })
async function machinePlatformCli(provider, args, /** @type {{ cwd?: string }} */ { cwd } = {}) {
  if (simulation.simulationOnly()) return e2eSetupGit(provider, args) || e2ePlatformCli(args) || { ok: false, out: 'Simulation only: gh / glab are not called.' };
  const id = issues.PLATFORMS[provider]?.cli;
  const r = id ? await resolveCommandAsync(id) : null;
  if (!r) return { ok: false, out: `${id || provider} is not installed.` };
  return runTool(r.file, args, {}, { cwd, timeout: 60000 });
}

// #738: a CLI's JSON answer, null when it failed or answered something else
function jsonOf(answer) {
  if (!answer?.ok) return null;
  try { return JSON.parse(String(answer.out)); } catch { return null; }
}

// #738: the repository's owner/name, the one rule of the wizard's notice (onboarding-model.js forkSuggestion)
const ownerRepoOf = (repo) => /** @type {{ repo: string }} */ (OnboardingModel.forkSuggestion({ repo, push: false })).repo;

// #738: the repository's name on its platform: the full path where the platform has subgroups (GitLab,
// the registry's Platforms.parseRepoUrl), else owner/repo
const forkNameOf = (platform, repo) => (platform.subgroups ? Platforms.parseRepoUrl(repo)?.path || '' : ownerRepoOf(repo));

// #738: the fork's remote URL in the original's protocol: an SSH original (git@host:… or ssh://) gets
// git@host:<fork path>.git, so an owner who signs in by SSH key keeps pushing; else <fork url>.git, cloned the
// way that can push (#79, workspace.js pushableUrl: SSH when the platform CLI's protocol is ssh; isSshUrl, the
// push check's rule)
async function forkRemoteOf(forkUrl, repo) {
  const parts = isSshUrl(repo) && Platforms.parseRepoUrl(forkUrl);
  return parts ? `git@${parts.host}:${parts.path}.git` : (await pushableUrl(`${forkUrl}.git`)).url;
}

const README = (name) => `# ${name}\n`;
const GITIGNORE = ['node_modules/', '.env', '.env.*', '!.env.example', '.DS_Store', 'Thumbs.db', 'dist/', 'build/', 'coverage/', '*.log', ''].join('\n');

/** @typedef {{ ok: boolean, url?: string | null, error?: string }} RemoteAnswer */

/**
 * The onboarding of new projects: { start, status, analyze, retry } (the state is documented above).
 * git: projects.js's git (ls-remote and clone); cli(provider) → { installed, signedIn };
 * jobs: { facts, profile, projectMap }, each async ({ projectId, folder, facts }) => result; #74: profile also gets
 * oracle (the analysis was asked for: it may call the model), else it answers needsOracle: true when a model would;
 * slotsDir: the machine slots' folder (default: the machine's); pollMs: the slot's poll (default:
 * acquireSlot's); emit(event, state); #632: remote(provider, { name, folder }) → { ok, url?, error? } creates
 * a new project's private repository (default: gh / glab, machineRemote); #30: install(cmd, args, { cwd }) →
 * { code, output } runs the dependency install (default: deps-cache.js runCommand); #74: savedMap(project) →
 * { costUsd } | null, the project map an earlier process saved (default: none); #79: pushCheck(folder) → { ok, reason?,
 * fix?, setupGit? }, whether the clone can push (default: machinePushCheck).
 * @param {{ projectsDir: string, reposDir: string, git?: typeof execGit, cli?: typeof machineCli, jobs: any, slotsDir?: string,
 *   emit?: (event: string, state: any) => void, pollMs?: number, remote?: (provider: string, spec: { name: string, folder: string }) => Promise<RemoteAnswer>,
 *   platformCli?: typeof machinePlatformCli, install?: typeof depsCache.runCommand, savedMap?: (project: any) => any,
 *   pushCheck?: typeof machinePushCheck }} options
 */
function createOnboarding({ projectsDir, reposDir, git = execGit, cli = machineCli, jobs, slotsDir, emit = () => {}, pollMs, remote = machineRemote, platformCli = machinePlatformCli, install = (cmd, args, opts) => depsCache.runCommand(cmd, args, opts), savedMap = () => null, pushCheck = machinePushCheck }) {
  const states = new Map();
  // per project: { wanted (analyze was asked during the clone), asked (the paid part was started), facts (the
  // facts job's promise), free, paid (the running parts), cli }
  const work = new Map();
  const workOf = (id) => { if (!work.has(id)) work.set(id, {}); return work.get(id); };
  const snapshot = (s) => JSON.parse(JSON.stringify(s));

  // no-op once the project's state is gone (the project was removed while a job ran)
  function change(id, patch, jobPatch = {}) {
    const s = states.get(id);
    if (!s) return;
    Object.assign(s, patch);
    for (const k of Object.keys(patch)) if (patch[k] === undefined) delete s[k];
    for (const [job, value] of Object.entries(jobPatch)) s.jobs[job] = value;
    emit('onboarding:changed', withWizard(snapshot(s), projectOf(id)));
  }

  // #741: a state with the wizard saved on the project's record (`wizard`), when it has one
  function withWizard(snap, p) {
    const o = p?.onboarding;
    return o ? { ...snap, wizard: { step: o.step, picks: o.picks || {}, finished: o.finished === true } } : snap;
  }

  // the project, or null once it was removed
  function projectOf(id) {
    try { return projects.readProject(projectsDir, id); } catch { return null; }
  }

  // an error outside the jobs (the project read, the clone's wait): the state is dropped when the project
  // was removed, else it ends failed with the error as its reason
  function stopped(id, e) {
    if (!projectOf(id)) { states.delete(id); work.delete(id); return; }
    change(id, { status: 'failed', code: undefined, reason: `The onboarding stopped: ${String(e?.message || e)}` });
  }

  // #74: what an analysis cost, the interview's or the project map's, when its record says it
  function costPart(result) {
    const cost = result?.costUsd ?? result?.cost_usd;
    return Number.isFinite(cost) ? { costUsd: cost } : {};
  }

  // a job of the chain: running (with the machine slot when `heavy`), then done or failed → its result, or null;
  // input() is read inside, so a removed project fails the job instead of escaping
  async function runJob(id, name, input, { heavy = false } = {}) {
    let slot = null;
    try {
      if (heavy) slot = await slots.acquireSlot(SLOT, { dir: slotsDir, pollMs, holder: `onboarding ${id} (${name})`, inherit: '' });
      change(id, {}, { [name]: { status: 'running' } });
      const result = await jobs[name](input());
      if (result?.refused) throw Object.assign(new Error(result.refused.text || String(result.refused.reason || result.refused)), { refused: true });
      // #725: a profile job without a profile failed (its Retry runs it again)
      if (name === 'profile' && !result?.profile) throw Object.assign(new Error('The ways of working analysis answered no profile.'), { noProfile: true });
      // #630: the profile job keeps its profile, for the wizard's step 3 (jobs.profile.profile); #738: its mode
      // follows the fork choice (no push access: an external contribution)
      // #105: a local folder's mode follows its remote (withRemoteMode)
      const profile = result?.profile ? withForkMode(withRemoteMode(result.profile, projectOf(id)), states.get(id)?.fork) : null;
      // #74: git's profile, the rest of it paid: it waits for the analysis (startPaid)
      if (result?.needsOracle) {
        change(id, {}, { [name]: { status: 'waiting', profile } });
        return { result };
      }
      // #781: simulated: no model turn, the wizard's Oracle line reads "not needed" after a restart too
      change(id, {}, { [name]: { status: 'done', ...(profile ? { profile } : {}), ...(result?.simulated ? { simulated: true } : {}), ...costPart(result) } });
      return { result };
    } catch (e) {
      // #725: the full error (the wizard's tooltip) and its short reason
      change(id, {}, { [name]: { status: 'failed', error: String(e?.message || e), ...failureOf(e) } });
      return null;
    } finally {
      slot?.release();
    }
  }

  const inputOf = (id) => ({ projectId: id, folder: projects.readProject(projectsDir, id).folder });

  // the profile job; #74: the Oracle only once the analysis was asked for
  const runProfile = (id, facts) => runJob(id, 'profile', () => ({ ...inputOf(id), facts: facts?.result ?? null, oracle: !!workOf(id).asked }));

  // the free part: the facts, then the profile (#74: `profile` false: only the facts, a profile kept is not paid twice)
  function startFree(id, { profile = true } = {}) {
    const w = workOf(id);
    w.facts = runJob(id, 'facts', () => inputOf(id));
    w.free = w.facts.then((facts) => (profile ? runProfile(id, facts) : null))
      .finally(() => { w.free = null; });
  }

  // #74: the Oracle's turn on a profile git left open (or a profile failed before the analysis was asked for),
  // after the free part; a turn that failed in the free part (a Retry) is not asked again: one paid try per click
  async function completeProfile(id, facts) {
    const w = workOf(id);
    const job = () => states.get(id)?.jobs?.profile;
    const again = !w.free && job()?.status === 'failed';
    await w.free;
    const waits = job()?.status === 'waiting' && !!job().profile; // git's profile, its open fields waiting
    if (waits || again) await runProfile(id, facts);
  }

  // the paid part: the project map once the facts are known (#730: no ranking after it) and, beside it, the profile's
  // Oracle turn (#74); analyzed once all ended.
  // #725: only the jobs not done run (a done project map is not paid twice), and a failed job is a state of
  // the analysis: the onboarding ends analyzed with it, never back to ready
  function startPaid(id) {
    const w = workOf(id);
    w.wanted = false;
    w.asked = true;
    const s0 = states.get(id);
    const done = (job) => s0?.jobs?.[job]?.status === 'done';
    const todo = Object.fromEntries(PAID.filter((job) => !done(job)).map((job) => [job, { status: 'waiting' }]));
    change(id, { status: 'analyzing', wanted: undefined }, todo);
    w.paid = (async () => {
      const facts = await w.facts;
      const input = () => ({ ...inputOf(id), facts: facts?.result ?? null });
      const profile = completeProfile(id, facts);
      const map = done('projectMap') ? { result: w.map ?? null } : await runJob(id, 'projectMap', input, { heavy: true });
      if (map) w.map = map.result;
      await profile;
      await w.free; // a profile retried meanwhile
      if (states.get(id)) change(id, { status: 'analyzed' });
    })().catch((e) => stopped(id, e)).finally(() => { w.paid = null; });
  }

  // gh / glab for the repository's provider (none for another host)
  function checkCli(id, repo) {
    const provider = providerOf(repo);
    const w = workOf(id);
    if (!provider) { change(id, { cli: null }); w.cli = Promise.resolve(); return w.cli; }
    change(id, { cli: { provider, status: 'checking' } });
    w.cli = Promise.resolve().then(() => cli(provider)).then((found) => cliState(provider, found), () => cliState(provider, null))
      .then((c) => change(id, { cli: c }));
    return w.cli;
  }

  // waits for the clone (and the CLI check), then ready with the free part, or failed with the clone's reason
  async function follow(id) {
    try {
      await e2eCloneWait();
      await projects.cloneJob(projectsDir, id);
      await workOf(id).cli;
      const p = projects.readProject(projectsDir, id);
      if (p.status !== 'ready') {
        change(id, { status: 'failed', code: 'clone-failed', reason: `The clone failed: ${p.cloneError || 'no reason was given.'}` }, { clone: { status: 'failed', error: p.cloneError || null } });
        return;
      }
      change(id, { status: 'ready', code: undefined, reason: undefined, deps: depsOf(p) }, { clone: { status: 'done' } });
      checkPush(id).catch(() => {});
      startFree(id);
      if (workOf(id).wanted) startPaid(id);
    } catch (e) {
      stopped(id, e);
    }
  }

  // #30: { status: 'missing', lockfile, command } for a clone with an npm lockfile and no installed
  // dependencies (depsCache.missingDeps, the same rule as rule_check's), else undefined (no lockfile,
  // another manager, installed); the command follows the project's setting (#472)
  function depsOf(p) {
    const d = p?.folder ? depsCache.missingDeps(p.folder) : null;
    if (d?.manager !== 'npm') return undefined;
    return { status: 'missing', lockfile: d.lockfile, command: p.ignoreInstallScripts ? 'npm ci --ignore-scripts' : 'npm ci' };
  }

  // #30: runs the offered install in the clone → the state; never rejects (a failed install is deps.status failed)
  async function installDeps(projectId) {
    // throws for a project without an onboarding; restores the state of an earlier process
    status(projectId);
    const p = projectOf(projectId);
    const deps = states.get(projectId)?.deps;
    if (!p || !deps || deps.status === 'installing' || deps.status === 'installed') return status(projectId);
    const [cmd, ...args] = deps.command.split(' ');
    change(projectId, { deps: { ...deps, status: 'installing', reason: undefined } });
    let r;
    try { r = await install(cmd, args, { cwd: p.folder }); } catch (e) { r = { code: null, output: String(e?.message || e) }; }
    const last = String(r?.output || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean).pop() || `${deps.command} exited with code ${r?.code}`;
    change(projectId, { deps: { ...deps, ...(r?.code === 0 ? { status: 'installed', reason: undefined } : { status: 'failed', reason: oneLine(last, 160) }) } });
    return status(projectId);
  }

  function cloning(id) {
    const waiting = Object.fromEntries(JOBS.map((j) => [j, { status: 'waiting' }]));
    change(id, { status: 'cloning', code: undefined, reason: undefined }, { ...waiting, clone: { status: 'running' } });
    follow(id);
  }

  function noAccess(id, access) {
    change(id, { status: 'failed', code: 'no-access', reason: accessReason(access) }, { clone: { status: 'skipped' } });
  }

  /**
   * Checks the access, creates the project and starts its clone; never waits for the clone. #741: the
   * repository of an existing project creates nothing: its onboarding not finished resumes (that project's
   * state, with its wizard), else { exists: true, finished: true, projectId } (the wizard offers to open it).
   */
  async function start(/** @type {{ name?: string, repo?: string }} */ { name, repo } = {}) {
    if (typeof name !== 'string' || !name.trim()) throw clientError('The project name is missing.');
    if (typeof repo !== 'string' || !repo.trim()) throw clientError('The repository URL is missing.');
    // #105: a folder imported before is found by its source (its repo is the folder's remote)
    const existing = projects.listProjects(projectsDir).find((x) => !x.error && (sameRepo(x.repo, repo) || sameRepo(x.source, repo)));
    if (existing) {
      if (!existing.onboarding || existing.onboarding.finished) return { exists: true, finished: true, projectId: existing.id };
      return status(existing.id);
    }
    const access = await projects.checkAccess(repo, { git: e2eAccessGit(repo) || git });
    // #107: a repository that cannot be imported creates nothing; the wizard words the cause. #640: a
    // folder of repos/ that already is its clone still imports (offline too)
    if (access.status !== 'reachable' && !cloneFolder(repo, reposDir).existing) return refusedImport(access);
    const p = await projects.createProject(projectsDir, { name, repo }, { git, reposDir });
    projects.updateProject(projectsDir, p.id, { onboarding: { step: 'repository', picks: {}, finished: false } });
    states.set(p.id, { projectId: p.id, status: 'cloning', jobs: Object.fromEntries(JOBS.map((j) => [j, { status: 'waiting' }])), cli: null });
    // #738: read before the profile job, so its mode already says fork; #105: a folder's runs push to the folder
    if (!p.source) await readPush(p.id, p.repo);
    checkCli(p.id, p.repo);
    cloning(p.id);
    return status(p.id);
  }

  // #738: the push permission of the repository, read through its platform adapter (repoInfoCommand,
  // parsePush: `gh api repos/<owner>/<repo>` or `glab api projects/<path>`): access: { push } once read;
  // without push the state suggests a fork (the wizard's notice). Not read on another host nor when the CLI
  // does not answer; never fails the import. A simulated run's E2E hook stands for gh on any host.
  async function readPush(id, repo) {
    const e2e = simulation.simulationOnly() && ['0', '1'].includes(/** @type {string} */ (process.env.CRAFTORIO_E2E_REPO_PUSH));
    const platform = Platforms.findPlatform(providerOf(repo) || (e2e ? Platforms.DEFAULT_PLATFORM : null));
    if (!platform) return;
    const name = forkNameOf(platform, repo);
    const answer = await Promise.resolve().then(() => platformCli(platform.id, platform.repoInfoCommand(name).args, {})).catch(() => null);
    const push = platform.parsePush(jsonOf(answer));
    if (typeof push !== 'boolean') return;
    change(id, { access: { push }, ...(push ? {} : { fork: { status: 'suggested', repo: name } }) });
  }

  // #738: the profile with the mode of the fork choice: fork while suggested or made, local once declined
  function withForkMode(profile, fork) {
    if (!fork) return profile;
    return { ...profile, mode: fork.status === 'declined' ? 'local' : 'fork' };
  }

  // #105: a folder imported from this computer (a source) follows its git: with no remote it has no pull request
  // to open (local mode), with a remote (its real repository) it opens pull requests there (remote mode)
  function withRemoteMode(profile, project) {
    if (!project?.source) return profile;
    return { ...profile, mode: project.repo ? 'remote' : 'local' };
  }

  // #738: the fork's state, and the profile job's mode with it when the profile is there
  function forkChange(id, fork) {
    const s = states.get(id);
    const job = s?.jobs?.profile;
    change(id, { fork }, job?.profile ? { profile: { ...job, profile: withForkMode(job.profile, fork) } } : {});
  }

  function forkable(projectId) {
    const s = states.get(projectId);
    if (!s) throw clientError(`No onboarding runs for the project ${projectId}.`);
    if (!s.fork) throw clientError(`The project ${projectId} needs no fork: you can push to its repository.`);
    return s;
  }

  // #738: the owner's fork of `name` → { status: 'reused' | 'created', url }, through the repository's
  // platform adapter (gh / glab; the E2E hook's gh on another host): the signed-in account (userCommand), its
  // repository of the same name reused when it is a fork of that one (isForkOf), else forkCommand (it never
  // sets remotes: fork() does it with git); the new fork's URL from its output, else read again. Or throws.
  async function makeFork(name, repo) {
    const platform = Platforms.findPlatform(providerOf(repo)) || Platforms.platformOrDefault();
    const run = (command) => platformCli(platform.id, command.args, {});
    const user = platform.parseUser(jsonOf(await run(platform.userCommand())));
    if (!user) throw new Error(`${platform.cli} did not say which account is signed in (${platform.cli} auth login).`);
    const mine = `${user}/${name.split('/').pop()}`;
    const read = async () => jsonOf(await run(platform.repoInfoCommand(mine)));
    const urlOf = (info, out) => String(platform.parseForkUrl(out) || platform.repoWebUrl(info) || `https://${Platforms.parseRepoUrl(repo)?.host || platform.host}/${mine}`).replace(/\.git$/, '');
    const found = await read();
    if (platform.isForkOf(found, name)) return { status: 'reused', url: urlOf(found) };
    const made = await run(platform.forkCommand(name));
    if (!made?.ok) throw new Error(String(made?.out || `${platform.cli} repo fork failed.`).trim());
    const url = platform.parseForkUrl(made.out) ? urlOf(null, made.out) : urlOf(await read());
    return { status: 'created', url };
  }

  /**
   * #738 "Create a fork": the owner's fork (reused when it exists), then in the project's clone origin = the
   * fork and upstream = the original; the project keeps fork: { url, upstream }. A failure leaves the
   * suggestion with its reason (fork: { status: 'failed' }), so the owner can try again or work locally.
   * The notice comes before the clone ends: the remotes change once the clone is done.
   */
  async function fork(projectId) {
    const s = forkable(projectId);
    let name = s.fork.repo;
    try {
      await projects.cloneJob(projectsDir, projectId);
      const p = projects.readProject(projectsDir, projectId);
      name = name || ownerRepoOf(p.repo);
      const made = await makeFork(name, p.repo);
      const remotes = String(await git(['remote'], p.folder)).split(/\s+/).filter(Boolean);
      await git(['remote', 'set-url', 'origin', await forkRemoteOf(made.url, p.repo)], p.folder);
      await git(['remote', remotes.includes('upstream') ? 'set-url' : 'add', 'upstream', p.repo], p.folder);
      projects.updateProject(projectsDir, projectId, { fork: { url: made.url, upstream: p.repo } });
      forkChange(projectId, made);
    } catch (e) {
      forkChange(projectId, { status: 'failed', repo: name, reason: String(e?.message || e) });
      return status(projectId);
    }
    // #79: the fork is the new origin: checked like an import (never a silent clone that cannot push)
    await checkPush(projectId).catch(() => {});
    return status(projectId);
  }

  /** #738 "Work locally": no fork, origin stays the original, the profile's mode is local (no pull request). */
  async function workLocally(projectId) {
    forkable(projectId);
    forkChange(projectId, { status: 'declined' });
    return status(projectId);
  }

  /**
   * The project's state, as the last onboarding:changed pushed it, with #741's wizard: { step, picks, finished }
   * (the project's record). A project removed drops its state; an onboarding of an earlier process (the app
   * restarted) is read back from the record (restore).
   */
  function status(projectId) {
    const p = projectOf(projectId);
    if (!p) { states.delete(projectId); work.delete(projectId); }
    else if (!states.has(projectId) && p.onboarding) restore(p);
    const s = states.get(projectId);
    if (!s) throw clientError(`No onboarding runs for the project ${projectId}.`);
    return withWizard(snapshot(s), p);
  }

  // #741: the state of an onboarding this process did not start: its clone as the record says, the free part
  // run again once the clone is ready (the facts and the profile the wizard's step 3 reads); #74: a project map already
  // saved is done, with what it cost
  function restore(p) {
    const waiting = Object.fromEntries(JOBS.map((j) => [j, { status: 'waiting' }]));
    const ready = p.status === 'ready';
    // #30: the dependencies still missing after a restart (the project page's Next steps reads them)
    const deps = ready ? depsOf(p) : undefined;
    const map = ready ? savedMap(p) : null;
    states.set(p.id, { projectId: p.id, name: p.name, status: ready ? 'ready' : 'failed', jobs: { ...waiting, ...(map ? { projectMap: { status: 'done', ...costPart(map) } } : {}), clone: { status: ready ? 'done' : 'failed' } }, cli: null, ...(deps ? { deps } : {}), ...(ready ? {} : { code: 'clone-failed', reason: `The clone failed: ${p.cloneError || 'no reason was given.'}` }) });
    if (ready && !p.onboarding.finished) startFree(p.id);
  }

  // #741: the wizard's state saved with the project (its step, the picks, finished kept)
  function saveWizard(projectId, /** @type {{ step?: string, picks?: any }} */ { step, picks } = {}) {
    if (!OnboardingModel.STEPS.some((x) => x.id === step)) throw clientError(`The wizard step must be one of: ${OnboardingModel.STEPS.map((x) => x.id).join(', ')}.`);
    const p = projectOf(projectId);
    if (!p) throw clientError(`No onboarding runs for the project ${projectId}.`);
    projects.updateProject(projectsDir, projectId, { onboarding: { step, picks: picks && typeof picks === 'object' ? picks : {}, finished: p.onboarding?.finished === true } });
    return status(projectId);
  }

  /** #741: Finish: the onboarding is finished (the Projects card no longer offers Continue). */
  function finish(projectId) {
    const p = projectOf(projectId);
    if (!p) throw clientError(`No onboarding runs for the project ${projectId}.`);
    projects.updateProject(projectsDir, projectId, { onboarding: { step: p.onboarding?.step || 'review', picks: p.onboarding?.picks || {}, finished: true } });
    return status(projectId);
  }

  /** Asks for the paid part: runs it now on a ready project, else once the clone is ready. */
  async function analyze(projectId) {
    const s = states.get(projectId);
    if (!s) throw clientError(`No onboarding runs for the project ${projectId}.`);
    const w = workOf(projectId);
    if (w.paid) return status(projectId);
    if (s.status === 'ready' || s.status === 'analyzed') startPaid(projectId);
    else {
      w.wanted = true;
      change(projectId, { wanted: true });
    }
    return status(projectId);
  }

  /** Runs again what failed: the access check and the clone, or the failed jobs; checks gh / glab again. */
  async function retry(projectId) {
    const s = states.get(projectId);
    if (!s) throw clientError(`No onboarding runs for the project ${projectId}.`);
    const p = projects.readProject(projectsDir, projectId);
    const w = workOf(projectId);
    checkCli(projectId, p.repo);
    if (s.status === 'failed') {
      // a project already cloned (its folder was kept) goes on without the access check and the clone
      if (p.status !== 'ready') {
        if (s.code === 'no-access') {
          const access = await projects.checkAccess(p.source || p.repo, { git });
          if (access.status !== 'reachable') { noAccess(projectId, access); return status(projectId); }
        }
        await projects.retryClone(projectsDir, projectId, { git });
      }
      cloning(projectId);
    } else if (['ready', 'analyzing', 'analyzed'].includes(s.status)) {
      // #725: each part on its own: a failed profile runs again while the paid part still runs, and the
      // reverse; a part still running is left alone. A profile job done without a valid profile (the wizard's
      // column says the analysis failed) runs again too, unless the profile is a new project's answers (#632)
      const failed = (job) => s.jobs[job].status === 'failed';
      const profileDone = s.jobs.profile.status === 'done';
      const answersProfile = s.jobs.facts.status === 'skipped';
      const noProfile = profileDone && !answersProfile
        && OnboardingModel.workflowsColumnState({ mode: 'analyze', profileJob: s.jobs.profile }) === 'failed';
      const keep = s.jobs.profile.status === 'running' || (profileDone && !noProfile);
      if (!w.free && (failed('facts') || failed('profile') || noProfile)) startFree(projectId, { profile: !keep });
      if (!w.paid && PAID.some(failed)) startPaid(projectId);
    }
    return status(projectId);
  }

  // #632: the answers of the questions, each among its values (onboarding-model.js CREATE_ANSWERS); #57: kind too
  function cleanAnswers(answers) {
    const a = { ...OnboardingModel.CREATE_DEFAULTS, ...(answers && typeof answers === 'object' ? answers : {}) };
    for (const [k, values] of Object.entries(OnboardingModel.CREATE_ANSWERS)) {
      if (!values.includes(a[k])) throw clientError(`The answer ${k} must be one of: ${values.join(', ')}.`);
    }
    return { mode: a.mode, ci: a.ci, release: a.release, kind: a.kind };
  }

  // #632: the local repository of a new project: git init on main, README.md and .gitignore in a first commit
  // (starts 'readme') or nothing more ('empty')
  async function initRepository(folder, name, starts) {
    await git(['init'], folder);
    await git(['symbolic-ref', 'HEAD', 'refs/heads/main'], folder);
    if (starts !== 'readme') return;
    fs.writeFileSync(path.join(folder, 'README.md'), README(name));
    fs.writeFileSync(path.join(folder, '.gitignore'), GITIGNORE);
    await git(['add', 'README.md', '.gitignore'], folder);
    const identity = await identityArgs(folder, (args, dir) => git(args, dir).then((s) => String(s).trim() || null, () => null));
    await git([...identity, '-c', 'commit.gpgsign=false', 'commit', '-m', 'Initial commit'], folder);
  }

  /**
   * #632 (spec R4): creates a new project in <projectsDir>/<slug> (an empty or new folder): its local
   * repository (initRepository); then, only when asked and its CLI is signed in, its private remote. Nothing
   * is cloned and no facts are read (an empty repository); the state is ready at once, with the answers as
   * its profile, and is pushed before the remote is asked. A failed local repository removes the project; a
   * remote that fails leaves the local project.
   */
  async function create(/** @type {{ name?: string, starts?: string, remote?: { provider?: string } | null, answers?: any }} */ { name, starts = 'readme', remote: wanted = null, answers } = {}) {
    if (typeof name !== 'string' || !name.trim()) throw clientError('The project name is missing.');
    if (!['readme', 'empty'].includes(starts)) throw clientError('The project starts with readme or empty.');
    const provider = wanted?.provider || null;
    if (provider && !Platforms.findPlatform(provider)?.cli) throw clientError(`No CLI creates repositories on ${provider}.`);
    const profile = { ...cleanAnswers(answers), tests: 'unit' };
    // #57: the kind answered is the owner's pick, saved on the project (runDefaultsWith reads it first)
    const p = await projects.createProject(projectsDir, { name, kind: profile.kind }, { git, fresh: true }).catch((e) => { throw clientError(String(e?.message || e)); });
    projects.updateProject(projectsDir, p.id, { onboarding: { step: 'repository', picks: {}, finished: false } });
    const folder = p.folder;
    try {
      await initRepository(folder, p.name, starts);
    } catch (e) {
      projects.removeProject(projectsDir, p.id);
      fs.rmSync(folder, { recursive: true, force: true });
      throw clientError(`The repository of ${p.name} could not be created: ${String(e?.message || e)}`);
    }
    const waiting = Object.fromEntries(JOBS.map((j) => [j, { status: 'waiting' }]));
    const jobs = {
      ...waiting,
      clone: { status: 'skipped' },
      facts: { status: 'skipped' },
      profile: { status: 'done', profile },
    };
    states.set(p.id, { projectId: p.id, name: p.name, status: 'ready', jobs, cli: null });
    change(p.id, {});
    if (provider) {
      const found = await Promise.resolve().then(() => cli(provider)).catch(() => null);
      const c = cliState(provider, found);
      if (c.status !== 'ok') {
        change(p.id, { remote: { provider, status: c.status, reason: remoteReason(provider, c.status) } });
      } else {
        change(p.id, { remote: { provider, status: 'creating' } });
        /** @type {RemoteAnswer} */
        const out = await Promise.resolve().then(() => remote(provider, { name: p.id, folder })).catch((e) => ({ ok: false, error: String(e?.message || e) }));
        if (out?.url) projects.updateProject(projectsDir, p.id, { repo: out.url });
        change(p.id, { remote: out?.ok ? { provider, status: 'created', url: out.url } : { provider, status: 'failed', reason: String(out?.error || 'The repository was not created.'), ...(out?.url ? { url: out.url } : {}) } });
      }
    }
    return status(p.id);
  }

  // #79: whether the clone can push (workspace.js checkPushAccess), once it is ready: pushCheck: { status: checking |
  // ok | failed | fixing, ok?, reason?, fix?, setupGit? }. Not checked without push permission until a fork is
  // made (the fork notice says it) nor for a local path; a simulated run checks only under its E2E hook
  // (CRAFTORIO_E2E_GIT_PUSH). Never fails the import.
  async function checkPush(id) {
    const s = states.get(id);
    const p = projectOf(id);
    if (!s || !p?.folder || (s.access?.push === false && !p.fork)) return;
    // #105: a folder's clone pushes to the folder (its source), never to its remote
    if (simulation.e2eGitPush() === null && (simulation.simulationOnly() || !isGitUrl(p.repo) || p.source)) return;
    change(id, { pushCheck: { status: 'checking' } });
    /** @type {{ ok: boolean, reason?: string, fix?: string, setupGit?: { platform: string, command: string } }} */
    const r = await Promise.resolve().then(() => pushCheck(p.folder)).catch((e) => ({ ok: false, reason: String(e?.message || e) }));
    change(id, { pushCheck: r.ok ? { status: 'ok', ok: true } : { status: 'failed', ok: false, reason: oneLine(String(r.reason || ''), 300), fix: r.fix || null, ...(r.setupGit ? { setupGit: r.setupGit } : {}) } });
  }

  /** #79: the push warning's button: runs the platform CLI's setup-git (when the check named it), then checks again. */
  async function setupGit(projectId) {
    status(projectId);
    const check = states.get(projectId)?.pushCheck;
    if (!check || check.ok !== false) throw clientError(`The project ${projectId} can push: nothing to set up.`);
    const platform = check.setupGit ? Platforms.findPlatform(check.setupGit.platform) : null;
    const command = platform?.setupGitCommand?.();
    if (platform && command) {
      change(projectId, { pushCheck: { ...check, status: 'fixing' } });
      const answer = await Promise.resolve().then(() => platformCli(platform.id, command.args, {})).catch((e) => ({ ok: false, out: String(e?.message || e) }));
      if (!answer?.ok) {
        change(projectId, { pushCheck: { ...check, status: 'failed', reason: oneLine(`${check.setupGit.command} failed: ${String(answer?.out || 'no reason was given.')}`, 300) } });
        return status(projectId);
      }
    }
    await checkPush(projectId);
    return status(projectId);
  }

  return { analyze, create, finish, fork, installDeps, retry, saveWizard, setupGit, start, status, workLocally };
}

module.exports = (ctx) => {
  let current = null;

  // one onboarding per open workspace, with the real jobs
  function onboarding() {
    const ws = ctx.ws;
    if (current?.ws === ws) return current.ob;
    const archRoot = path.join(ws.root, 'architecture');
    // #731: a plan already drawn for a project whose Oracle report then failed: its Retry reuses it (and its
    // cost) instead of paying the cartographer again; dropped once the report is saved
    const drawn = new Map();
    const jobs = {
      facts: ({ projectId, folder }) => projectMap.mapFacts({ folder, archRoot, projectId }),
      // { refused } (an interview already running, the Oracle's budget) fails the job, so Retry runs it again
      // #74: the free read until the analysis is asked for
      profile: ({ projectId, oracle }) => ctx.workflowInterview({ projectId, free: !oracle }),
      // #731: the city plan first (the cartographer's turn, validated and saved), then the Oracle's report with
      // both turns' cost: a refused plan never pays the Oracle; after a saved plan and a failed report,
      // Retry runs only the report.
      // #730: the report's findings stay findings (the review and the Health tab file them as issues on a click)
      projectMap: async ({ projectId, folder }) => {
        e2eCityPlan();
        const mock = simulation.simulationOnly();
        const oracle = ctx.oracleService();
        const agent = agents.readAgent(ws.agents, agents.ORACLE_ID);
        const plan = drawn.get(projectId) || await projectMap.drawMap({ folder, archRoot, projectId, mock, oracle, agent, skillsDirs: [ws.skills, ctx.BUNDLED_SKILLS_DIR] });
        drawn.set(projectId, plan);
        const out = await projectMap.analyzeMap({ folder, archRoot, projectId, mock, oracle, agent, planCostUsd: plan.cost_usd, planTokens: plan.tokens });
        drawn.delete(projectId);
        return out;
      },
    };
    // #74: the project's last report a model made (a simulated one is not its map), since it was imported
    const savedMap = (p) => {
      const last = arch.listReports(archRoot, p.id)[0];
      return last && !last.simulated && seedRuns.sinceCreated(p, last.date) ? last : null;
    };
    const ob = createOnboarding({ projectsDir: ws.projects, reposDir: ws.repos, jobs: e2eJobs(e2eCosts(jobs)), savedMap, emit: (event, state) => ctx.events.emit(event, state) });
    current = { ws, ob };
    return ob;
  }

  return {
    onboardingAccounts: () => cliAccounts(),
    onboardingAnalyze: ({ projectId }) => onboarding().analyze(projectId),
    onboardingCreate: (data) => onboarding().create(data),
    onboardingFinish: ({ projectId }) => onboarding().finish(projectId),
    onboardingFork: ({ projectId }) => onboarding().fork(projectId),
    onboardingInstallDeps: ({ projectId }) => onboarding().installDeps(projectId),
    onboardingRepos: (/** @type {{ provider?: string }} */ { provider } = {}) => machineRepos(provider),
    onboardingRetry: ({ projectId }) => onboarding().retry(projectId),
    onboardingSaveWizard: (/** @type {{ projectId?: string, step?: string, picks?: any }} */ { projectId, step, picks } = {}) => onboarding().saveWizard(projectId, { step, picks }),
    onboardingSetupGit: ({ projectId }) => onboarding().setupGit(projectId),
    onboardingStart: (data) => onboarding().start(data),
    onboardingStatus: ({ projectId }) => onboarding().status(projectId),
    onboardingWorkLocally: ({ projectId }) => onboarding().workLocally(projectId),
  };
};

module.exports.cliAccounts = cliAccounts;
module.exports.createOnboarding = createOnboarding;
module.exports.E2E_LOGIN = E2E_LOGIN;
module.exports.machinePlatformCli = machinePlatformCli;
module.exports.machineRemote = machineRemote;
module.exports.machineRepos = machineRepos;
module.exports.SLOT = SLOT;
