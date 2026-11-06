// The analysis seed runs a service shares (#360, #487): the Architecture tab's seeds:run
// (channels/seeds.js) and the Ways of working interview (areas/workflow-interview.js) run a seed
// through here, so both see the same run in progress (one per project and seed at a time; a second
// one is refused as busy) and the last run's error. A run: the project's recorded tool (seedTools)
// through the shell, else one Oracle turn read-only in its daily budget (packages/engine/domains/oracle/oracle-seeds.js),
// simulated under mock or MULTIAGENT_SIMULATION_ONLY; saved under <workspace>/architecture/. The
// state lives per service context (a WeakMap on ctx), read at call time.
// runDefaultsOf (#735): a project's run defaults over its last ways-of-working profile, for the run
// dialog's hints, the Backlog's queue and the Roadmap.

const { execFile, exec: execShell } = require('child_process');
const path = require('path');
const agents = require('../domains/agents/agents');
const oracleSeeds = require('../domains/oracle/oracle-seeds');
const projects = require('../domains/project/projects');
const runDefaults = require('../domains/project/project-run-defaults');
const simulation = require('../engine/simulation');
const { clientError, requireId } = require('./common');

const TOOL_TIMEOUT_MS = 10 * 60e3;
const GIT_TIMEOUT_MS = 15e3;
const MAX_OUTPUT = 64 * 1024 * 1024;
const PROGRESS_TEXT = 160;

// ctx → { running: Map(`${projectId}/${seedId}` → { since, items, last }), errors: Map(key → message) }
const states = new WeakMap();
const stateOf = (ctx) => {
  if (!states.has(ctx)) states.set(ctx, { running: new Map(), errors: new Map() });
  return states.get(ctx);
};
const key = (p, seedId) => `${p.id}/${seedId}`;

// git in the project's folder → stdout trimmed, or null when it fails (not a repository, unknown commit)
const git = (folder, argv) => new Promise((resolve) => {
  execFile('git', argv, { cwd: folder, timeout: GIT_TIMEOUT_MS, windowsHide: true }, (err, out) => resolve(err ? null : String(out).trim()));
});

// A recorded tool's command, through the shell (the owner wrote it), in the project's folder → stdout
const runTool = (command, { cwd }) => new Promise((resolve, reject) => {
  execShell(command, { cwd, timeout: TOOL_TIMEOUT_MS, maxBuffer: MAX_OUTPUT, windowsHide: true }, (err, out, errOut) => {
    if (err) reject(new Error(`${command} failed: ${String(errOut || err.message).trim().slice(0, 500)}`));
    else resolve(String(out));
  });
});

// where the seeds' runs are saved: <workspace>/architecture/<project id>/seeds/<seed id>/<stamp>/
const seedsRoot = (ctx) => path.join(ctx.ws.root, 'architecture');

/** The project of a channel's projectId, with a folder; a client error when unknown. */
function projectOf(ctx, projectId) {
  const id = requireId(projectId, 'project id');
  let p = null;
  try { p = projects.readProject(ctx.ws.projects, id); } catch (e) { if (e.code !== 'ENOENT') throw e; }
  if (!p || !p.folder) throw clientError(`Unknown project: ${id}`);
  return p;
}

/** The project's recorded tool command for a seed, or null. */
const toolOf = (p, seedId) => (p.seedTools && p.seedTools[seedId]) || null;

/** The run of a seed in progress on a project ({ since, items, last } copy, or null) and its last error. */
function runState(ctx, p, seedId) {
  const { running, errors } = stateOf(ctx);
  const now = running.get(key(p, seedId));
  return { running: now ? { ...now } : null, error: errors.get(key(p, seedId)) || null };
}

/**
 * Runs `seed` on project `p` → oracleSeeds.runSeed's answer ({ date, source, costUsd, simulated }, or
 * { refused }: busy when the same seed already runs on the project, or the Oracle's budget).
 */
async function runSeed(ctx, { project: p, seed, mock }) {
  const { running, errors } = stateOf(ctx);
  const k = key(p, seed.id);
  if (running.has(k)) return { refused: { reason: 'busy', text: `The seed ${seed.id} is already running on this project (since ${running.get(k).since}).` } };
  const now = { since: new Date().toISOString(), items: 0, last: null };
  running.set(k, now);
  errors.delete(k);
  try {
    const simulated = !!mock || simulation.simulationOnly();
    const command = toolOf(p, seed.id);
    const head = p.isGit ? await git(p.folder, ['rev-parse', 'HEAD']) : null;
    const onItem = (it) => {
      now.items++;
      // #781: a tool call with what it reads (the wizard's Oracle line says it)
      const on = it?.input?.file_path || it?.input?.path || it?.input?.pattern || it?.input?.command || '';
      now.last = String((it && (it.text || (it.name && `${it.name} ${on}`.trim()) || it.kind)) || '').slice(0, PROGRESS_TEXT) || null;
    };
    return await oracleSeeds.runSeed({
      root: seedsRoot(ctx), project: p, seed, mock: simulated, head, onItem,
      tool: command ? { command } : null, exec: runTool,
      oracle: simulated || command ? null : ctx.oracleService(), agent: agents.readAgent(ctx.ws.agents, agents.ORACLE_ID),
    });
  } catch (e) {
    errors.set(k, e.message);
    throw e;
  } finally {
    running.delete(k);
  }
}

/** #735: a project's run defaults, from its last ways-of-working analysis' profile and its files. */
function runDefaultsOf(ctx, project) {
  return runDefaults.projectRunDefaults({ project, profile: runDefaults.savedProfile(seedsRoot(ctx), project.id) });
}

/** #735: runDefaultsOf without the git read of the default branch (base_branch null: the workflow's
 * own default), synchronous, so a run start (run:start, the Backlog's queue, the Roadmap) reserves
 * its run at once, with no await between reading its state and starting it. */
function runDefaultsNow(ctx, project) {
  return runDefaults.runDefaultsWith({ project, profile: runDefaults.savedProfile(seedsRoot(ctx), project.id) });
}

module.exports = {
  git,
  projectOf,
  runDefaultsNow,
  runDefaultsOf,
  runSeed,
  runState,
  seedsRoot,
  toolOf,
};
