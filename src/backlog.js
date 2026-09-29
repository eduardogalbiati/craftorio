// Backlog: a project's issues, fetched from its git platform with that platform's CLI (gh for
// GitHub, glab for GitLab) and cached in <workspace>/backlog/<project id>.json, so the screen shows
// the last sync right away (and offline) while a new one runs.
// Bitbucket is a choice in Settings but has no sync yet (no official CLI).

const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { resolveCommand } = require('./engine/providers');

const PLATFORMS = {
  github: { label: 'GitHub', cli: 'gh', host: 'github.com' },
  gitlab: { label: 'GitLab', cli: 'glab', host: 'gitlab.com' },
  bitbucket: { label: 'Bitbucket', cli: null, host: 'bitbucket.org' },
};
const DEFAULT_PLATFORM = 'github';
const MAX_ISSUES = 300;

/**
 * https://host/owner/repo(.git), ssh://git@host/owner/repo.git, git@host:owner/repo.git
 * → { host, path: 'owner/repo' } (GitLab paths may have subgroups), or null.
 */
function parseRepoUrl(url) {
  const s = String(url || '').trim().replace(/[?#].*$/, '');
  const m = s.match(/^(?:https?|ssh|git):\/\/(?:[^@/]+@)?([^/:]+)(?::\d+)?\/(.+)$/i) || s.match(/^[\w.-]+@([\w.-]+):(.+)$/);
  if (!m) return null;
  const repoPath = m[2].replace(/\/+$/, '').replace(/\.git$/i, '');
  if (!repoPath.includes('/')) return null;
  return { host: m[1].toLowerCase(), path: repoPath };
}

// The platform a well-known host belongs to (self-hosted hosts: unknown).
const platformOfHost = (host) => Object.keys(PLATFORMS).find((p) => PLATFORMS[p].host === host) || null;

// Progress of the markdown task list in an issue body ("- [ ]" / "- [x]").
function taskProgress(body) {
  const boxes = String(body || '').match(/^\s*[-*+] \[[ xX]\]/gm) || [];
  return { done: boxes.filter((b) => /\[[xX]\]/.test(b)).length, total: boxes.length };
}

function normalizeGithub(raw) {
  return raw.map((i) => ({
    number: i.number,
    title: i.title,
    state: String(i.state).toLowerCase() === 'open' ? 'open' : 'closed',
    labels: (i.labels || []).map((l) => ({ name: l.name, color: l.color ? `#${l.color}` : null })),
    url: i.url,
    author: i.author?.login || null,
    assignees: (i.assignees || []).map((a) => a.login),
    body: i.body || '',
    tasks: taskProgress(i.body),
    createdAt: i.createdAt,
    updatedAt: i.updatedAt,
  }));
}

function normalizeGitlab(raw) {
  return raw.map((i) => ({
    number: i.iid,
    title: i.title,
    state: i.state === 'opened' ? 'open' : 'closed',
    labels: (i.labels || []).map((name) => ({ name: typeof name === 'string' ? name : name.name, color: name.color || null })),
    url: i.web_url,
    author: i.author?.username || null,
    assignees: (i.assignees || []).map((a) => a.username),
    body: i.description || '',
    tasks: taskProgress(i.description),
    createdAt: i.created_at,
    updatedAt: i.updated_at,
  }));
}

// Runs a platform CLI and resolves with its stdout.
function execCli(cli, args) {
  const r = resolveCommand(cli);
  if (!r) return Promise.reject(new Error(`The ${cli} CLI is not installed (see Settings › Agents & CLIs).`));
  return new Promise((resolve, reject) => {
    execFile(r.shell ? `"${r.file}"` : r.file, args, { windowsHide: true, timeout: 60000, shell: r.shell, maxBuffer: 32 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) reject(new Error(`${cli} ${args.slice(0, 2).join(' ')} failed: ${String(stderr || err.message).trim()}`));
      else resolve(stdout);
    });
  });
}

/**
 * Fetches every issue (open and closed, newest first, up to MAX_ISSUES) of a repository.
 * @param {{ platform: string, repo: string, exec?: (cli: string, args: string[]) => Promise<string> }} opts
 */
async function fetchIssues({ platform, repo, exec = execCli }) {
  const p = PLATFORMS[platform];
  if (!p) throw new Error(`Unknown backlog platform: ${platform}`);
  if (!p.cli) throw new Error(`${p.label} sync is not available yet. Pick GitHub or GitLab.`);
  const parsed = parseRepoUrl(repo);
  if (!parsed) throw new Error(`The project's repository is not a recognizable git URL: ${repo || '(none)'}`);
  const owner = platformOfHost(parsed.host);
  if (owner && owner !== platform) throw new Error(`The project's repository is on ${parsed.host}; pick ${PLATFORMS[owner].label} to sync it.`);

  if (platform === 'github') {
    const target = parsed.host === 'github.com' ? parsed.path : `${parsed.host}/${parsed.path}`;
    const out = await exec('gh', ['issue', 'list', '--repo', target, '--state', 'all', '--limit', String(MAX_ISSUES),
      '--json', 'number,title,state,labels,url,author,assignees,body,createdAt,updatedAt']);
    return normalizeGithub(JSON.parse(out || '[]'));
  }
  const target = parsed.host === 'gitlab.com' ? parsed.path : `https://${parsed.host}/${parsed.path}`;
  const out = await exec('glab', ['issue', 'list', '--repo', target, '--all', '--per-page', '100', '--output', 'json']);
  return normalizeGitlab(JSON.parse(out || '[]'));
}

const cacheFile = (dir, projectId) => path.join(dir, `${path.basename(String(projectId))}.json`);

/** The last sync of a project, or null. */
function readBacklog(dir, projectId) {
  try { return JSON.parse(fs.readFileSync(cacheFile(dir, projectId), 'utf8')); } catch { return null; }
}

/**
 * Fetches the project's issues and caches them.
 * @param {{ dir: string, project: { id: string, repo?: string }, platform: string, exec?: Function }} opts
 */
async function syncBacklog({ dir, project, platform, exec }) {
  if (!project.repo) throw new Error('This project has no repository. Add one in Projects to sync its issues.');
  const issues = await fetchIssues({ platform, repo: project.repo, exec });
  issues.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
  const data = { projectId: project.id, platform, repo: project.repo, syncedAt: new Date().toISOString(), issues };
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(cacheFile(dir, project.id), JSON.stringify(data, null, 2));
  return data;
}

// ---- issue ↔ run links -------------------------------------------------------------------
// A run works on an issue when it was started for it (the Backlog's "Assign workflow", recorded
// as run.issue) or, for runs started by hand, when its task or one of its text inputs mentions
// the issue's URL or "#<number>". Simulated runs only count through the explicit link.
function mentions(run, issue) {
  const text = [run.task, ...Object.values(run.inputs || {})].filter((v) => typeof v === 'string').join('\n');
  return (!!issue.url && text.includes(issue.url)) || new RegExp(`(^|[^\\w/&])#${issue.number}(?!\\d)`).test(text);
}
const startedFor = (run, issue) => !!run.issue && (run.issue.url ? run.issue.url === issue.url : run.issue.number === issue.number);

// Kanban column from the issue state, its place in the queue and its latest run.
function columnOf(issue, latest, queued) {
  if (issue.state === 'closed') return 'done';
  if (queued) return 'in_progress';
  if (!latest) return 'todo';
  if (latest.waiting) return 'waiting';
  if (latest.status === 'success') return 'done';
  if (latest.status === 'cancelled') return 'todo';
  return 'in_progress'; // running, failed, interrupted
}

/**
 * Adds to each issue the project's runs that work on it (newest first), its place in the queue
 * and its column: todo | in_progress | waiting (a run stopped at a human gate) | done.
 * @param {object[]} issues from fetchIssues
 * @param {{ runId, workflow, status, startedAt, mock?, waiting?, issue?, task?, inputs? }[]} runs the project's runs
 * @param {{ items: object[] } | null} queue the project's queue (readQueue)
 */
function linkRuns(issues, runs, queue = null) {
  const sorted = [...runs].sort((a, b) => String(b.startedAt).localeCompare(String(a.startedAt)));
  const items = queue?.items || [];
  return issues.map((issue) => {
    const linked = sorted.filter((r) => startedFor(r, issue) || (!r.mock && !r.issue && mentions(r, issue)))
      .map((r) => ({ runId: r.runId, workflow: r.workflow, status: r.status, startedAt: r.startedAt, mock: !!r.mock, waiting: !!r.waiting }));
    const at = items.findIndex((q) => q.number === issue.number);
    const queued = at < 0 ? null : { position: at + 1, workflow: items[at].workflowName || items[at].workflow, mock: !!items[at].mock };
    return { ...issue, runs: linked, queued, column: columnOf(issue, linked[0], queued) };
  });
}

// ---- queue -----------------------------------------------------------------------------------
// Issues assigned to a workflow wait in <workspace>/backlog/<project id>.queue.json until the
// service starts them, one at a time: { paused, error, inputs: { <workflow file>: inputs }, items }.
const queueFile = (dir, projectId) => path.join(dir, `${path.basename(String(projectId))}.queue.json`);
const emptyQueue = () => ({ paused: false, error: null, inputs: {}, items: [] });

function readQueue(dir, projectId) {
  try { return { ...emptyQueue(), ...JSON.parse(fs.readFileSync(queueFile(dir, projectId), 'utf8')) }; } catch { return emptyQueue(); }
}

function writeQueue(dir, projectId, queue) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(queueFile(dir, projectId), JSON.stringify(queue, null, 2));
  return queue;
}

const updateQueue = (dir, projectId, fn) => writeQueue(dir, projectId, fn(readQueue(dir, projectId)) || readQueue(dir, projectId));

/**
 * Queues issues for a workflow and remembers the inputs used for it in this project. Issues
 * already queued are skipped. Assigning resumes a paused queue.
 * @param {{ issues: { number, url, title, body }[], workflow: string, workflowName?: string, inputs?: object, mock?: boolean }} a
 */
function enqueue(dir, projectId, { issues, workflow, workflowName = null, inputs = {}, mock = false }) {
  return updateQueue(dir, projectId, (q) => {
    const have = new Set(q.items.map((x) => x.number));
    const now = new Date().toISOString();
    const added = issues.filter((i) => !have.has(i.number)).map((i) => ({
      number: i.number, url: i.url, title: i.title, body: i.body || '', workflow, workflowName, inputs, mock: !!mock, addedAt: now,
    }));
    return { ...q, paused: false, error: null, inputs: { ...q.inputs, [workflow]: inputs }, items: [...q.items, ...added] };
  });
}

function unqueue(dir, projectId, number) {
  return updateQueue(dir, projectId, (q) => ({ ...q, items: q.items.filter((x) => x.number !== number) }));
}

function setPaused(dir, projectId, paused, error = null) {
  return updateQueue(dir, projectId, (q) => ({ ...q, paused: !!paused, error: paused ? error : null }));
}

// Project ids with a queue file.
function queuedProjects(dir) {
  try { return fs.readdirSync(dir).filter((f) => f.endsWith('.queue.json')).map((f) => f.slice(0, -'.queue.json'.length)); } catch { return []; }
}

/** The next item to start: the oldest one across the projects whose queue is not paused. */
function nextQueued(dir) {
  const heads = queuedProjects(dir)
    .map((projectId) => ({ projectId, q: readQueue(dir, projectId) }))
    .filter(({ q }) => !q.paused && q.items.length)
    .map(({ projectId, q }) => ({ projectId, item: q.items[0] }));
  heads.sort((a, b) => String(a.item.addedAt).localeCompare(String(b.item.addedAt)));
  return heads[0] || null;
}

/** Pauses every queue with items waiting (the app restarted: nothing starts without the user). */
function pauseAll(dir, reason) {
  for (const projectId of queuedProjects(dir)) {
    const q = readQueue(dir, projectId);
    if (q.items.length && !q.paused) writeQueue(dir, projectId, { ...q, paused: true, error: reason });
  }
}

/**
 * The inputs of a run started for a queued issue: the saved inputs, the task (issue title, URL and
 * body), the project folder in the path inputs left empty, and `issue` when the workflow has it.
 * @param {{ inputs: object }} wf the workflow (its input definitions)
 */
function runInputs(item, wf, folder) {
  const inputs = { ...item.inputs };
  const defs = wf.inputs || {};
  if (defs.task) inputs.task = `${item.title}\n\nIssue: ${item.url}\n\n${item.body || ''}`.trim();
  for (const [k, def] of Object.entries(defs)) {
    if (k !== 'task' && (def.type || 'string') === 'string' && /path|dir/i.test(k) && !inputs[k] && folder) inputs[k] = folder;
  }
  if (defs.issue) inputs.issue = item.url;
  return inputs;
}

module.exports = {
  PLATFORMS, DEFAULT_PLATFORM, parseRepoUrl, platformOfHost, taskProgress, fetchIssues, readBacklog, syncBacklog, linkRuns,
  readQueue, enqueue, unqueue, setPaused, nextQueued, pauseAll, runInputs,
};
