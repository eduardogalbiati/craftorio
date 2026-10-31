// Service area (#640, onboarding step 3 of docs/work/first-project-onboarding/plan.md): the jobs that
// follow a new project's import, chained by dependency: clone (#639, packages/engine/domains/project/projects.js)
// → facts → (the Ways of working profile ∥ the project map) → the refactor ranking after the map.
// The free part (facts and profile, spec R5) runs once the clone is ready; the paid part (project map
// and ranking) only after onboardingAnalyze ("analyze later" never calls it). The project map and the
// ranking take the machine-wide slot SLOT (packages/engine/engine/machine-slot.js), so they wait for
// other heavy work on the machine. The state of each project is kept in memory:
//   { projectId, status: cloning | ready | analyzing | analyzed | failed, code?: no-access | clone-failed,
//     reason?, jobs: { clone, facts, profile, projectMap, ranking: { status: waiting | running | done | failed | skipped, error? } },
//     cli: { provider: github | gitlab, status: checking | ok | missing | signed-out, reason? } | null }
// and every change is pushed as `onboarding:changed` (channels/onboarding.js). A refused access check or
// a failed clone ends `failed` with a readable reason; onboardingRetry runs again what failed (the
// access check and the clone, a failed job) and always checks gh / glab again. A project removed while
// its jobs run loses its state; no error of a job escapes the chain.

const path = require('path');
const Platforms = require('@multiagent/shared/platforms');
const agents = require('../../domains/agents/agents');
const issues = require('../../domains/backlog/issues');
const priority = require('../../domains/refactor/refactor-priority');
const projectMap = require('../../domains/project/project-map');
const projects = require('../../domains/project/projects');
const simulation = require('../../engine/simulation');
const slots = require('../../engine/machine-slot');
const { clientError } = require('../common');
const { toolSignIn } = require('./settings');

const SLOT = slots.ANALYSIS_SLOT;
const JOBS = ['clone', 'facts', 'profile', 'projectMap', 'ranking'];

// a readable reason for an access check that did not reach the repository
function accessReason(access) {
  const detail = String(access.message || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean).slice(-1)[0] || '';
  const lead = access.status === 'no-git' ? 'Git is not installed, so the repository cannot be cloned. Install git and retry.'
    : access.status === 'no-network' ? 'The repository could not be reached: check the network connection and retry.'
      : 'The repository could not be reached with your credentials: check the URL, or sign in with access to it, and retry.';
  return detail ? `${lead} (${detail})` : lead;
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

/**
 * The onboarding of new projects: { start, status, analyze, retry } (the state is documented above).
 * git: projects.js's git (ls-remote and clone); cli(provider) → { installed, signedIn };
 * jobs: { facts, profile, projectMap, ranking }, each async ({ projectId, folder, facts }) => result;
 * slotsDir: the machine slots' folder (default: the machine's); pollMs: the slot's poll (default:
 * acquireSlot's); emit(event, state).
 */
function createOnboarding({ projectsDir, reposDir, git, cli = machineCli, jobs, slotsDir, emit = () => {}, pollMs }) {
  const states = new Map();
  // per project: { wanted (analyze was asked), facts (the facts job's promise), free, paid (the running parts), cli }
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
    emit('onboarding:changed', snapshot(s));
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

  // a job of the chain: running (with the machine slot when `heavy`), then done or failed → its result, or null;
  // input() is read inside, so a removed project fails the job instead of escaping
  async function runJob(id, name, input, { heavy = false } = {}) {
    let slot = null;
    try {
      if (heavy) slot = await slots.acquireSlot(SLOT, { dir: slotsDir, pollMs, holder: `onboarding ${id} (${name})`, inherit: '' });
      change(id, {}, { [name]: { status: 'running' } });
      const result = await jobs[name](input());
      if (result?.refused) throw new Error(result.refused.text || String(result.refused));
      change(id, {}, { [name]: { status: 'done' } });
      return { result };
    } catch (e) {
      change(id, {}, { [name]: { status: 'failed', error: String(e?.message || e) } });
      return null;
    } finally {
      slot?.release();
    }
  }

  const inputOf = (id) => ({ projectId: id, folder: projects.readProject(projectsDir, id).folder });

  // the free part: the facts, then the profile
  function startFree(id) {
    const w = workOf(id);
    w.facts = runJob(id, 'facts', () => inputOf(id));
    w.free = w.facts.then((facts) => runJob(id, 'profile', () => ({ ...inputOf(id), facts: facts?.result ?? null })))
      .finally(() => { w.free = null; });
  }

  // the paid part: the project map once the facts are known, the ranking after it; analyzed once all ended
  function startPaid(id) {
    const w = workOf(id);
    w.wanted = false;
    change(id, { status: 'analyzing' }, { projectMap: { status: 'waiting' }, ranking: { status: 'waiting' } });
    w.paid = (async () => {
      const facts = await w.facts;
      const input = () => ({ ...inputOf(id), facts: facts?.result ?? null });
      const map = await runJob(id, 'projectMap', input, { heavy: true });
      if (map) await runJob(id, 'ranking', () => ({ ...input(), map: map.result }), { heavy: true });
      else change(id, {}, { ranking: { status: 'skipped' } });
      await w.free;
      const s = states.get(id);
      if (s) change(id, { status: s.jobs.projectMap.status === 'done' && s.jobs.ranking.status === 'done' ? 'analyzed' : 'ready' });
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
      await projects.cloneJob(projectsDir, id);
      await workOf(id).cli;
      const p = projects.readProject(projectsDir, id);
      if (p.status !== 'ready') {
        change(id, { status: 'failed', code: 'clone-failed', reason: `The clone failed: ${p.cloneError || 'no reason was given.'}` }, { clone: { status: 'failed', error: p.cloneError || null } });
        return;
      }
      change(id, { status: 'ready', code: undefined, reason: undefined }, { clone: { status: 'done' } });
      startFree(id);
      if (workOf(id).wanted) startPaid(id);
    } catch (e) {
      stopped(id, e);
    }
  }

  function cloning(id) {
    const waiting = Object.fromEntries(JOBS.map((j) => [j, { status: 'waiting' }]));
    change(id, { status: 'cloning', code: undefined, reason: undefined }, { ...waiting, clone: { status: 'running' } });
    follow(id);
  }

  function noAccess(id, access) {
    change(id, { status: 'failed', code: 'no-access', reason: accessReason(access) }, { clone: { status: 'skipped' } });
  }

  /** Checks the access, creates the project and starts its clone; never waits for the clone. */
  async function start({ name, repo } = {}) {
    if (typeof name !== 'string' || !name.trim()) throw clientError('The project name is missing.');
    if (typeof repo !== 'string' || !repo.trim()) throw clientError('The repository URL is missing.');
    const access = await projects.checkAccess(repo, { git });
    const p = await projects.createProject(projectsDir, { name, repo }, { git, reposDir, ...(access.status === 'reachable' ? {} : { cloneError: accessReason(access) }) });
    // a folder of repos/ that already is a clone (a removed project imported again) needs no access
    const reachable = access.status === 'reachable' || p.status === 'ready';
    states.set(p.id, { projectId: p.id, status: 'cloning', jobs: Object.fromEntries(JOBS.map((j) => [j, { status: 'waiting' }])), cli: null });
    if (!reachable) noAccess(p.id, access);
    checkCli(p.id, p.repo);
    if (reachable) cloning(p.id);
    return status(p.id);
  }

  /** The project's state, as the last onboarding:changed pushed it. */
  function status(projectId) {
    const s = states.get(projectId);
    if (!s) throw clientError(`No onboarding runs for the project ${projectId}.`);
    return snapshot(s);
  }

  /** Asks for the paid part: runs it now on a ready project, else once the clone is ready. */
  async function analyze(projectId) {
    const s = states.get(projectId);
    if (!s) throw clientError(`No onboarding runs for the project ${projectId}.`);
    const w = workOf(projectId);
    if (w.paid) return status(projectId);
    if (s.status === 'ready' || s.status === 'analyzed') startPaid(projectId);
    else w.wanted = true;
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
          const access = await projects.checkAccess(p.repo, { git });
          if (access.status !== 'reachable') { noAccess(projectId, access); return status(projectId); }
        }
        await projects.retryClone(projectsDir, projectId, { git });
      }
      cloning(projectId);
    } else if (!w.free && !w.paid && ['ready', 'analyzed'].includes(s.status)) {
      const failed = (job) => s.jobs[job].status === 'failed';
      if (failed('facts') || failed('profile')) startFree(projectId);
      if (['projectMap', 'ranking'].some(failed)) startPaid(projectId);
    }
    return status(projectId);
  }

  return { analyze, retry, start, status };
}

module.exports = (ctx) => {
  let current = null;

  // one onboarding per open workspace, with the real jobs
  function onboarding() {
    const ws = ctx.ws;
    if (current?.ws === ws) return current.ob;
    const archRoot = path.join(ws.root, 'architecture');
    const jobs = {
      facts: ({ projectId, folder }) => projectMap.mapFacts({ folder, archRoot, projectId }),
      // { refused } (an interview already running, the Oracle's budget) fails the job, so Retry runs it again
      profile: ({ projectId }) => ctx.workflowInterview({ projectId }),
      projectMap: ({ projectId, folder }) => projectMap.analyzeMap({ folder, archRoot, projectId, mock: simulation.simulationOnly(), oracle: ctx.oracleService(), agent: agents.readAgent(ws.agents, agents.ORACLE_ID) }),
      // the Product Owner's turn comes from the analyser front (ctx.refactorPriorityOptions); without it, the simulated ranking
      ranking: ({ projectId }) => priority.rankProject({ refactorRoot: path.join(ws.root, 'refactor'), backlogDir: ws.backlog, projectId, model: null, mock: simulation.simulationOnly() || !ctx.refactorPriorityOptions, options: () => ctx.refactorPriorityOptions?.(projectId) }),
    };
    const ob = createOnboarding({ projectsDir: ws.projects, reposDir: ws.repos, jobs, emit: (event, state) => ctx.events.emit(event, state) });
    current = { ws, ob };
    return ob;
  }

  return {
    onboardingAnalyze: ({ projectId }) => onboarding().analyze(projectId),
    onboardingRetry: ({ projectId }) => onboarding().retry(projectId),
    onboardingStart: (data) => onboarding().start(data),
    onboardingStatus: ({ projectId }) => onboarding().status(projectId),
  };
};

module.exports.createOnboarding = createOnboarding;
module.exports.SLOT = SLOT;
