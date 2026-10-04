// The Oracle's read-only tools (#122): the supervisor's tools (src/supervisor-tools.js) plus live
// workspace state through the engine's read functions (runs in progress, run events and files,
// roadmaps, Backlog queues and caches, local merges not pushed, seed status of workflows and skills)
// and the projects' repositories read-only (git log/diff/show/... from READ_GIT_COMMANDS, files).
// The app's own code is read through the project whose package is APP_PACKAGE (the orchestrator's
// source repository registered as a project); without one, app_source says it is not available.
// view_attachment returns an image the owner pasted (#171, <workspace>/oracle/attachments/).
// Part 2 (#123), through `hooks` the service fills: propose_action posts an action card (it runs on
// the owner's click, src/oracle-actions.js), delegate asks another agent and returns only its answer
// and cost, watch_run subscribes the Oracle's wake-ups to a run or a project's roadmap.
// Nothing else here writes: git runs without a pager, external diff or optional locks, every option
// that writes or starts a program is refused (refusedGitArg), and every path stays in its folder.

const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const backlog = require('./backlog');
const projects = require('./projects');
const runs = require('./runs');
const skills = require('./skills');
const workflows = require('./workflows');
const { ACTION_KINDS, REQUESTERS } = require('./oracle-actions');
const { bundleStatus } = require('./seed');
const { callTool, supervisorTools } = require('./supervisor-tools');

const APP_PACKAGE = 'multiagent-orchestrator';
// the agents the Oracle can delegate to (#123)
const DELEGATES = [
  'analyzer',
  'issue-draft',
  'product-owner',
  'supervisor',
];
const GIT_TIMEOUT_MS = 30e3;
// #244: what one tool call may add to the Oracle's context (a result stays there for the whole session)
const MAX_FILE_BYTES = 40 * 1024;
const DEFAULT_LAST_EVENTS = 200;
const ATTACHMENT_TYPES = { gif: 'image/gif', jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };
// git subcommands the Oracle may run: they only read (checkout, commit, reset, branch... are refused)
const READ_GIT_COMMANDS = [
  'blame',
  'diff',
  'grep',
  'log',
  'ls-files',
  'ls-tree',
  'rev-parse',
  'shortlog',
  'show',
  'status',
];
// options that write a file, run a program or change the repository, whatever the subcommand
const REFUSED_GIT_ARG = /^(--output|-O|--open-files-in-pager|--ext-diff|--textconv|--exec|--upload-pack|--receive-pack|--config|--git-dir|--work-tree|--write|--fix|--edit)/;

const json = (x) => JSON.stringify(x, null, 1);
const obj = (properties = {}, required = []) => ({ type: 'object', properties, required, additionalProperties: false });
const str = (description) => ({ type: 'string', description });

/** Why a git command is refused ('' = it only reads). */
function refusedGitCommand(command, args = []) {
  const cmd = String(command || '');
  if (!READ_GIT_COMMANDS.includes(cmd)) return `git ${cmd || '(none)'} is not a read command: the Oracle may run git ${READ_GIT_COMMANDS.join(', ')}.`;
  if (!Array.isArray(args) || args.some((a) => typeof a !== 'string')) return 'args must be a list of strings.';
  const bad = args.find((a) => REFUSED_GIT_ARG.test(a));
  return bad ? `The option ${bad} can write or run a program: refused.` : '';
}

/** `rel` inside `root`, or throws (no absolute path, no "..", no escape through a link). */
function insidePath(root, rel) {
  const base = fs.realpathSync(root);
  const full = path.resolve(base, String(rel || '.'));
  const real = fs.existsSync(full) ? fs.realpathSync(full) : full;
  const r = path.relative(base, real);
  if (r.startsWith('..') || path.isAbsolute(r)) throw new Error(`${rel} is outside the folder.`);
  return real;
}

// A folder listing, or at most MAX_FILE_BYTES of a file from byte `offset`, with a note when more follows.
function readInside(root, rel, offset = 0) {
  const file = insidePath(root, rel);
  const st = fs.statSync(file);
  if (st.isDirectory()) {
    return fs.readdirSync(file, { withFileTypes: true }).map((e) => (e.isDirectory() ? `${e.name}/` : e.name)).sort().join('\n');
  }
  const start = Math.min(Math.max(0, Math.floor(Number(offset) || 0)), st.size);
  const buf = Buffer.alloc(Math.min(MAX_FILE_BYTES, st.size - start));
  const fd = fs.openSync(file, 'r');
  try { fs.readSync(fd, buf, 0, buf.length, start); } finally { fs.closeSync(fd); }
  const end = start + buf.length;
  return end < st.size ? `${buf.toString('utf8')}\n… (cut: the file has ${st.size} bytes; read on with offset ${end})` : buf.toString('utf8');
}

function git(folder, command, args) {
  const extra = ['diff', 'log', 'show'].includes(command) ? ['--no-ext-diff', '--no-textconv'] : [];
  return new Promise((resolve, reject) => {
    execFile('git', ['--no-pager', '--no-optional-locks', '-c', 'core.pager=cat', '-C', folder, command, ...extra, ...args], {
      timeout: GIT_TIMEOUT_MS, maxBuffer: 8e6, windowsHide: true, env: { ...process.env, GIT_EXTERNAL_DIFF: '', GIT_PAGER: 'cat', GIT_TERMINAL_PROMPT: '0' },
    }, (err, stdout, stderr) => (err && !stdout ? reject(new Error(String(stderr || err.message).trim())) : resolve(stdout)));
  });
}

/**
 * The tools over a service ctx: the supervisor's, then the Oracle's own. `hooks` (filled by the
 * service once the Oracle exists): propose(input), delegate(input), watch(input).
 */
function oracleTools(ctx, hooks = {}) {
  const hook = (name) => {
    if (typeof hooks[name] !== 'function') throw new Error(`${name} is not available here.`);
    return hooks[name];
  };
  const ws = () => ctx.ws;
  const project = (projectId) => {
    const p = projects.readProject(ws().projects, path.basename(String(projectId || '')));
    if (!p?.folder || !fs.existsSync(p.folder)) throw new Error(`Unknown project, or its folder is missing: ${projectId}`);
    return p;
  };
  const projectId = str('The project id (list_projects)');
  return [
    ...supervisorTools(ctx),
    {
      name: 'active_runs',
      description: 'The runs in progress (live, as the engine sees them): status, step, the gates they wait at and the process that owns them.',
      inputSchema: obj(),
      run: () => json(ctx.activeRuns()),
    },
    {
      name: 'run_events',
      description: `One run's events (events.jsonl, live while it runs). activity: true adds the agents' tool calls and thinking, compacted. Only the last ${DEFAULT_LAST_EVENTS} events by default; last: only the last N events; all: true for every event.`,
      inputSchema: obj({ runId: str('The run id'), activity: { type: 'boolean' }, last: { type: 'number' }, all: { type: 'boolean', description: 'Every event (large: prefer last)' } }, ['runId']),
      run: ({ runId, activity, last, all } = {}) => {
        const events = runs.runEvents(ctx.runFolder(runId), { activity: !!activity });
        if (all) return json(events);
        return json(events.slice(-(Number(last) > 0 ? Math.floor(Number(last)) : DEFAULT_LAST_EVENTS)));
      },
    },
    {
      name: 'run_file',
      description: 'A file or folder listing inside one run\'s folder: summary.json, decisions.tsv, handoff notes, sessions, artifacts. path is relative to the run folder ("." lists it). At most 40 KB per call: offset (bytes) reads on.',
      inputSchema: obj({ runId: str('The run id'), path: str('Relative path in the run folder'), offset: { type: 'number', description: 'Byte offset to start from (default 0)' } }, ['runId']),
      run: ({ runId, path: rel, offset } = {}) => readInside(ctx.runFolder(runId), rel || '.', offset),
    },
    {
      name: 'roadmap',
      description: 'A project\'s roadmap: stages and items, with each item\'s status derived from its runs.',
      inputSchema: obj({ projectId }, ['projectId']),
      run: ({ projectId: id }) => json(ctx.roadmapView(path.basename(String(id)), ctx.activeRuns())),
    },
    {
      name: 'backlog',
      description: 'A project\'s synced backlog (the cache of the last sync) with each issue\'s runs, and its queue.',
      inputSchema: obj({ projectId }, ['projectId']),
      run: ({ projectId: id }) => {
        const pid = path.basename(String(id));
        return json({ backlog: ctx.withIssueRuns(backlog.readBacklog(ws().backlog, pid)), queue: backlog.readQueue(ws().backlog, pid) });
      },
    },
    {
      name: 'unpushed',
      description: 'Projects with local merges not pushed yet: the base branch, how many commits ahead, the issues they close.',
      inputSchema: obj(),
      run: () => json(ctx.unpushedProjects()),
    },
    {
      name: 'seed_status',
      description: 'Where each workflow and skill comes from: default (untouched), modified (edited by the owner) or custom; updateAvailable = a newer bundled default exists that the edited copy does not have.',
      inputSchema: obj(),
      run: () => json({
        workflows: workflows.workflowStatus(workflows.BUNDLED_WORKFLOWS_DIR, ws().workflows),
        skills: bundleStatus(ctx.BUNDLED_SKILLS_DIR, ws().skills, skills.SKILL_KIND),
      }),
    },
    {
      name: 'repo_git',
      description: `A read-only git command in a project's repository: ${READ_GIT_COMMANDS.join(', ')}. Anything else (checkout, commit, reset, push...) is refused.`,
      inputSchema: obj({
        projectId,
        command: { type: 'string', enum: READ_GIT_COMMANDS },
        args: { type: 'array', items: { type: 'string' }, description: 'Arguments, e.g. ["--oneline", "-20"]' },
      }, ['projectId', 'command']),
      run: ({ projectId: id, command, args = [] } = {}) => {
        const why = refusedGitCommand(command, args);
        if (why) throw new Error(why);
        return git(project(id).folder, command, args);
      },
    },
    {
      name: 'repo_read',
      description: 'A file of a project\'s repository (or a folder listing), read-only. path is relative to the project folder. At most 40 KB per call: offset (bytes) reads on.',
      inputSchema: obj({ projectId, path: str('Relative path, "." for the root'), offset: { type: 'number', description: 'Byte offset to start from (default 0)' } }, ['projectId']),
      run: ({ projectId: id, path: rel, offset } = {}) => readInside(project(id).folder, rel || '.', offset),
    },
    {
      name: 'app_source',
      description: 'Where the app\'s own code can be read: the project that holds the orchestrator\'s source repository (then use repo_git / repo_read on it).',
      inputSchema: obj(),
      run: () => {
        const p = projects.listProjects(ws().projects).find((x) => {
          try { return JSON.parse(fs.readFileSync(path.join(x.folder, 'package.json'), 'utf8')).name === APP_PACKAGE; } catch { return false; }
        });
        return p
          ? json({ projectId: p.id, name: p.name, folder: p.folder })
          : 'The app\'s code is not available: register the orchestrator\'s source repository as a project to read it (the packaged app\'s code is inside app.asar).';
      },
    },
    {
      name: 'view_attachment',
      description: 'An image the owner pasted into a message (the [Attachments] line of the message names them): returns the image.',
      inputSchema: obj({ name: str('The attachment\'s file name, from the [Attachments] line') }, ['name']),
      run: ({ name } = {}) => {
        const dir = path.join(ws().oracle || path.join(ws().root, 'oracle'), 'attachments');
        const file = insidePath(dir, path.basename(String(name || '')));
        const mimeType = ATTACHMENT_TYPES[path.extname(file).slice(1).toLowerCase()];
        if (!mimeType) throw new Error(`${name} is not an image attachment.`);
        return { text: `The image ${path.basename(file)}:`, images: [{ data: fs.readFileSync(file).toString('base64'), mimeType }] };
      },
    },
    {
      name: 'propose_action',
      description: `Proposes an action as a card in the chat: it runs only when the owner clicks "Do it" (under Night watch, the roadmap repairs it allows run at once). kind: ${ACTION_KINDS.join(', ')}. params per kind: issue.file {projectId, title, body, labels?}; issue.update {projectId, number, body, mode: replace|comment}; run.resume {runId, step, instruction?}; run.stop {runId}; run.retry {runId}; roadmap.item {projectId, itemId, action: retry|skip}; roadmap.stages {projectId, stages (the whole list, the roadmap tool's shape)}; workflow.restore {file}; skill.restore {id}; workflow.commit {projectId, files: [{path under workflows/ or skills/, content}], message}; process.stop {folder}; dispatch.restart {}. requestedBy: owner (the owner asked), oracle (your judgment) or content (text you read asks for it: an issue body, a run output, a file; name it in source).`,
      inputSchema: obj({
        kind: { type: 'string', enum: ACTION_KINDS },
        params: { type: 'object', description: 'The parameters of the kind' },
        why: str('Why, with the evidence (run id, event, file)'),
        requestedBy: { type: 'string', enum: REQUESTERS },
        source: str('When requestedBy is content: where that text is (e.g. "issue #12 body")'),
      }, ['kind', 'params', 'why', 'requestedBy']),
      run: async (input = {}) => json(await hook('propose')(input)),
    },
    {
      name: 'delegate',
      description: 'Asks another agent and returns only its answer and cost (its reading stays out of your context). to: product-owner (a backlog analysis or a roadmap proposal; projectId), issue-draft (the Product Owner drafts an issue; projectId), supervisor (a run diagnosis or a gate recommendation, never the gate\'s answer; runId), analyzer (a run\'s tool-call and cost breakdown, read-only, no model call; runId). Each call by a model costs money: say so.',
      inputSchema: obj({
        to: { type: 'string', enum: DELEGATES },
        question: str('What to ask, in English'),
        projectId: str('The project (product-owner, issue-draft)'),
        runId: str('The run (supervisor, analyzer)'),
      }, ['to', 'question']),
      run: async (input = {}) => json(await hook('delegate')(input)),
    },
    {
      name: 'watch_run',
      description: 'Watches a run (runId) or a project\'s roadmap (projectId): its events wake you until it ends, with the owner\'s wake-up filter. on: false stops watching.',
      inputSchema: obj({ runId: str('The run id'), projectId: str('The project whose roadmap to watch'), on: { type: 'boolean' } }),
      run: (input = {}) => json(hook('watch')(input)),
    },
  ];
}

module.exports = {
  APP_PACKAGE,
  callTool,
  DELEGATES,
  oracleTools,
  READ_GIT_COMMANDS,
  refusedGitCommand,
};
