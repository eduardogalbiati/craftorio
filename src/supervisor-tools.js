// The supervisor's read-only tools over the service (#28): workflows, projects, runs, skills, agents,
// usage and analytics, the same data the screens show. The app-wide supervisor chat
// (src/supervisor-chat.js) offers them to its `claude` session through the MCP server
// (src/supervisor-mcp.js → src/supervisor-bridge.js → here). They read the app's data, never the
// repositories' code: no tool takes a free path, every id is reduced to a file name in the workspace.
// Each tool returns text (JSON or a report), clipped to MAX_CHARS.

const fs = require('fs');
const path = require('path');
const agents = require('./agents');
const analytics = require('./analytics');
const projects = require('./projects');
const skills = require('./skills');
const supervisor = require('./supervisor');

const MAX_CHARS = 60000;
const clip = (s) => (s.length > MAX_CHARS ? `${s.slice(0, MAX_CHARS)}\n… (clipped: ${s.length - MAX_CHARS} more characters)` : s);
const json = (x) => JSON.stringify(x, null, 1);
const obj = (properties = {}, required = []) => ({ type: 'object', properties, required, additionalProperties: false });
const str = (description) => ({ type: 'string', description });

/** The tools over a service ctx (src/service/index.js): [{ name, description, inputSchema, run(args) }]. */
function supervisorTools(ctx) {
  const ws = () => ctx.ws;
  return [
    {
      name: 'list_workflows',
      description: 'The workflows of the workspace: file, name, description, inputs, agents (provider, model, skills, capabilities) and steps.',
      inputSchema: obj(),
      // The fields the description names, not the screen's extras (builderProblems alone is a fifth of
      // the payload): the whole list must stay under MAX_CHARS, or clip() cuts the JSON mid-string.
      run: () => json(ctx.listWorkflows().map(({ file, origin, name, version, description, category, tags, inputs, outputs, agents: a, steps }) => (
        { file, origin, name, version, description, category, tags, inputs, outputs, agents: a, steps }))),
    },
    {
      name: 'read_workflow',
      description: 'One workflow\'s YAML and how the Builder opens it (full, fixed or readonly).',
      inputSchema: obj({ file: str('The workflow file name, e.g. software-development.yaml') }, ['file']),
      run: ({ file }) => {
        const name = path.basename(String(file || ''));
        const yaml = fs.readFileSync(path.join(ws().workflows, name), 'utf8');
        let mode = null;
        try { mode = ctx.loadBuilderWorkflow(name).mode; } catch { /* not drawn by the builder */ }
        return `# ${name} (builder mode: ${mode || 'unknown'})\n\n${yaml}`;
      },
    },
    {
      name: 'list_projects',
      description: 'The projects: id, name, folder, repository and settings.',
      inputSchema: obj(),
      run: () => json(projects.listProjects(ws().projects)),
    },
    {
      name: 'list_runs',
      description: 'The runs, newest first, with their workflow, status, project and title; the runs in progress with the gates they wait at.',
      inputSchema: obj({
        limit: { type: 'number', description: 'How many runs (default 30)' },
        projectId: str('Only the runs of this project'),
        status: str('Only the runs with this status (e.g. failed, succeeded, interrupted)'),
      }),
      run: ({ limit, projectId, status } = {}) => {
        let list = ctx.listAllRuns().runs;
        if (projectId) list = list.filter((r) => r.project?.id === projectId);
        if (status) list = list.filter((r) => r.status === status);
        return json({ active: ctx.activeRuns(), runs: list.slice(0, Math.max(1, Math.min(200, Number(limit) || 30))) });
      },
    },
    {
      name: 'run_report',
      description: 'The report of one run: steps, timeline, gates, errors, costs and handoff notes (what the supervisor reads to explain a run).',
      inputSchema: obj({ runId: str('The run id') }, ['runId']),
      run: ({ runId }) => supervisor.runReport(ctx.runFolder(runId), { workflowsDir: ctx.workflowDirs() }),
    },
    {
      name: 'list_skills',
      description: 'The skills of the workspace: id, name and description.',
      inputSchema: obj(),
      run: () => json(skills.listSkills(ws().skills).map((s) => ({ id: s.id, name: s.name, description: s.description, uses: s.uses }))),
    },
    {
      name: 'read_skill',
      description: 'One skill\'s SKILL.md and its files.',
      inputSchema: obj({ id: str('The skill id, e.g. code-review') }, ['id']),
      run: ({ id }) => json(skills.readSkill(ws().skills, path.basename(String(id || '')))),
    },
    {
      name: 'list_agents',
      description: 'The agents (robots): id, name, provider, model, effort, skills and the workflows that use them.',
      inputSchema: obj(),
      run: () => json(agents.listAgents(ws().agents, { workflowsDir: ws().workflows })),
    },
    {
      name: 'get_usage',
      description: 'Tokens and cost this month per provider, the budgets and the recent runs.',
      inputSchema: obj({ scope: { type: 'string', enum: ['orchestrator', 'machine'], description: 'orchestrator (default): the app\'s runs; machine: every CLI session on this machine' } }),
      run: ({ scope } = {}) => json(ctx.usageSnapshot(scope === 'machine' ? 'machine' : 'orchestrator')),
    },
    {
      name: 'get_analytics',
      description: 'The Analytics report of a date range: tokens, cost, sessions, tools and projects.',
      inputSchema: obj({
        from: str('First day, YYYY-MM-DD'),
        to: str('Last day, YYYY-MM-DD'),
        scope: { type: 'string', enum: ['orchestrator', 'machine'] },
      }),
      run: ({ from, to, scope } = {}) => analytics.analyticsReport(ctx.analyticsSnapshot({ from, to, scope })),
    },
  ];
}

/** The MCP view of the tools (tools/list). */
const describeTools = (tools) => tools.map(({ name, description, inputSchema }) => ({ name, description, inputSchema }));

/**
 * Runs one tool: { text, isError } (an error is an answer the model can read, not a failure). A
 * tool may return { text, images: [{ data (base64), mimeType }] }: the images are passed on.
 */
async function callTool(tools, name, args) {
  const tool = tools.find((t) => t.name === name);
  if (!tool) return { text: `Unknown tool: ${name}`, isError: true };
  try {
    const out = await tool.run(args || {});
    if (out && typeof out === 'object' && Array.isArray(out.images)) return { text: clip(String(out.text ?? '')), images: out.images, isError: false };
    return { text: clip(String(out ?? '')), isError: false };
  } catch (e) {
    return { text: e.message || String(e), isError: true };
  }
}

module.exports = {
  callTool,
  describeTools,
  MAX_CHARS,
  supervisorTools,
};
