// Analysis seeds on a project's Architecture tab (#360): the workspace's seeds (src/seeds.js) with
// each one's last run, its recorded tool and the commits since (seeds:list); the cost estimate
// (free with a tool; else the mean of the seed's last real runs); a run (src/domains/oracle/oracle-seeds.js: one
// Oracle turn read-only in its daily budget, or the project's tool, simulated under mock or
// MULTIAGENT_SIMULATION_ONLY; one run per project and seed at a time, shared with the Ways of working
// interview: src/service/seed-runs.js); the history and one result
// (<workspace>/architecture/<project id>/seeds/<seed id>/<stamp>/); the tool command recorded in the
// project's settings (seedTools); and "Make it a tool" (src/seed-tool-issue.js: an issue in the
// project's tracker, a preview in simulation). Nothing here crosses a human gate or writes to the project.

const arch = require('../../domains/oracle/oracle-architecture');
const backlog = require('../../domains/backlog/backlog');
const projects = require('../../projects');
const seeds = require('../../seeds');
const oracleSeeds = require('../../domains/oracle/oracle-seeds');
const seedRuns = require('../seed-runs');
const toolIssue = require('../../seed-tool-issue');
const workspace = require('../../workspace');
const simulation = require('../../engine/simulation');
const { clientError, requireId } = require('../common');
const {
  args,
  BOOL,
  INT,
  listOf,
  nullable,
  NUMBER,
  OBJECT,
  PROJECT_ID,
  shape,
  STRING,
} = require('../schemas');

const SEED_ID = { type: 'string', minLength: 1, maxLength: 200, pattern: '^[A-Za-z0-9][A-Za-z0-9._-]*$', title: 'seed id', description: 'An analysis seed id (seeds/<seedId>/seed.md).' };
const RUN_DATE = { type: 'string', minLength: 1, maxLength: 80, pattern: '^[A-Za-z0-9._-]+$', title: 'seed run date', description: 'A seed run\'s folder (its stamp).' };
const COMMAND = { type: 'string', maxLength: 2000, description: 'The command that prints the seed\'s JSON model, run in the project\'s folder.' };
const LAST_RUN = shape({ date: STRING, source: STRING, costUsd: nullable(NUMBER), simulated: BOOL }, ['date', 'source']);
const ROW = shape({
  id: STRING, name: STRING, summary: STRING, cost: STRING, needs: listOf(STRING), produces: listOf(STRING),
  lastRun: nullable(LAST_RUN), tool: nullable(STRING), commitsSince: nullable(INT), running: nullable(OBJECT), error: nullable(STRING),
}, ['id', 'name', 'summary', 'lastRun', 'tool', 'commitsSince']);
const RUN = shape({ date: STRING, source: STRING, costUsd: nullable(NUMBER), simulated: BOOL, refused: OBJECT }, []);

module.exports = (ctx) => {
  const root = () => seedRuns.seedsRoot(ctx);
  const projectOf = (projectId) => seedRuns.projectOf(ctx, projectId);
  const seedOf = (seedId) => {
    const seed = seeds.readSeed(ctx.ws.seeds, requireId(seedId, 'seed id'));
    if (!seed) throw clientError(`Unknown analysis seed: ${seedId}`);
    return seed;
  };
  const { toolOf } = seedRuns;

  async function commitsSince(p, head) {
    if (!head || !p.isGit) return null;
    const n = await seedRuns.git(p.folder, ['rev-list', '--count', `${head}..HEAD`]);
    return n != null && /^\d+$/.test(n) ? Number(n) : null;
  }

  async function list({ projectId }) {
    const p = projectOf(projectId);
    return Promise.all(seeds.listSeeds(ctx.ws.seeds).map(async (s) => {
      const last = oracleSeeds.listSeedRuns(root(), p.id, s.id)[0] || null;
      const state = seedRuns.runState(ctx, p, s.id);
      return {
        id: s.id, name: s.name, summary: s.summary, cost: s.cost, needs: s.needs, produces: s.produces,
        lastRun: last ? { date: last.date, source: last.source, costUsd: last.costUsd, simulated: last.simulated } : null,
        tool: toolOf(p, s.id),
        commitsSince: last ? await commitsSince(p, last.head) : null,
        running: state.running,
        error: state.error || s.error || null,
      };
    }));
  }

  function estimate({ projectId, seedId }) {
    const p = projectOf(projectId);
    const seed = seedOf(seedId);
    if (toolOf(p, seed.id)) return { costUsd: 0, free: true };
    const runs = oracleSeeds.listSeedRuns(root(), p.id, seed.id).filter((r) => r.source === 'oracle').map((r) => ({ ...r, date: r.at }));
    const est = arch.estimateCost(runs);
    return est ? { costUsd: est.usd, free: false, basis: est.basis } : { costUsd: null, free: false, basis: 0 };
  }

  async function run({ projectId, seedId, mock }) {
    const out = await seedRuns.runSeed(ctx, { project: projectOf(projectId), seed: seedOf(seedId), mock });
    if (out.refused) return { refused: out.refused };
    return { date: out.date, source: out.source, costUsd: out.costUsd ?? null, simulated: !!out.simulated };
  }

  function result({ projectId, seedId, date }) {
    const p = projectOf(projectId);
    const saved = oracleSeeds.readSeedRun(root(), p.id, seedOf(seedId).id, requireId(date, 'seed run date'));
    if (!saved) throw clientError(`No run of the seed ${seedId} at ${date}.`);
    return saved;
  }

  function setTool({ projectId, seedId, command }) {
    const p = projectOf(projectId);
    const seed = seedOf(seedId);
    const tools = { ...(p.seedTools || {}) };
    const c = String(command || '').trim();
    if (c) tools[seed.id] = c;
    else delete tools[seed.id];
    projects.updateProject(ctx.ws.projects, p.id, { seedTools: tools });
    return { tool: c || null };
  }

  // the tracker the Backlog syncs (else the project's repository); nothing filed in simulation
  async function makeTool({ projectId, seedId }) {
    const p = projectOf(projectId);
    const seed = seedOf(seedId);
    const data = backlog.readBacklog(ctx.ws.backlog, p.id);
    const repo = data?.repo || p.repo;
    const preview = simulation.simulationOnly();
    if (!preview && !repo) throw clientError('The project has no repository: set its repository URL to file the issue.');
    return toolIssue.fileToolIssue({
      project: p, seed, preview, repo,
      platform: data?.platform || workspace.readSettings(ctx.ws).backlogPlatform || backlog.DEFAULT_PLATFORM,
      exec: backlog.execCli, dir: oracleSeeds.seedRunsDir(root(), p.id, seed.id),
    });
  }

  const ids = args({ projectId: PROJECT_ID, seedId: SEED_ID }, ['projectId', 'seedId']);
  return [
    {
      channel: 'seeds:list',
      method: 'listSeeds',
      params: ['...opts'],
      schema: { params: args({ projectId: PROJECT_ID }, ['projectId']), result: listOf(ROW) },
      fn: list,
    },
    {
      channel: 'seeds:estimate',
      method: 'seedEstimate',
      params: ['...opts'],
      schema: { params: ids, result: shape({ costUsd: nullable(NUMBER), free: BOOL, basis: INT }, ['costUsd', 'free']) },
      fn: estimate,
    },
    {
      channel: 'seeds:run',
      method: 'runSeed',
      params: ['...opts'],
      schema: { params: args({ projectId: PROJECT_ID, seedId: SEED_ID, mock: nullable(BOOL) }, ['projectId', 'seedId']), result: RUN },
      fn: run,
    },
    {
      channel: 'seeds:history',
      method: 'seedHistory',
      params: ['...opts'],
      schema: { params: ids, result: listOf(shape({ date: STRING, source: STRING, costUsd: nullable(NUMBER), simulated: BOOL, head: nullable(STRING) }, ['date', 'simulated'])) },
      fn: ({ projectId, seedId }) => oracleSeeds.listSeedRuns(root(), projectOf(projectId).id, seedOf(seedId).id),
    },
    {
      channel: 'seeds:result',
      method: 'seedResult',
      params: ['...opts'],
      schema: { params: args({ projectId: PROJECT_ID, seedId: SEED_ID, date: RUN_DATE }, ['projectId', 'seedId', 'date']), result: shape({ html: STRING, model: OBJECT }, ['html', 'model']) },
      fn: result,
    },
    {
      channel: 'seeds:setTool',
      method: 'setSeedTool',
      params: ['...opts'],
      schema: { params: args({ projectId: PROJECT_ID, seedId: SEED_ID, command: nullable(COMMAND) }, ['projectId', 'seedId']), result: shape({ tool: nullable(STRING) }, ['tool']) },
      fn: setTool,
    },
    {
      channel: 'seeds:makeTool',
      method: 'makeSeedTool',
      params: ['...opts'],
      schema: { params: ids, result: shape({ preview: BOOL, url: nullable(STRING), title: STRING, body: STRING }, ['preview', 'url', 'title', 'body']) },
      fn: makeTool,
    },
  ];
};
