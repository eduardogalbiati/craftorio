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

// ---- open pull/merge requests ----------------------------------------------------------------
// An issue already has work in flight when an open PR/MR refers to it: GitHub's closing references,
// a closing keyword ("Fixes #12") or a link to the issue in the description, or "#12" in the title
// (this repository's own convention: "Add X (#12)").
const CLOSING = /\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?|implement(?:s|ed)?)\b[:\s]+((?:[^\s#]*#\d+[,\s]*(?:and\s+)?)+)/gi;

/**
 * The issue numbers a PR/MR refers to. `issuesUrl` is the repository's issue URL prefix
 * (https://github.com/o/r/issues/ or https://gitlab.com/g/r/-/issues/).
 */
function referencedIssues({ title = '', body = '', closing = [] }, issuesUrl) {
  const found = new Set(closing);
  for (const m of String(title).matchAll(/(?:^|[^\w/&!])#(\d+)(?!\d)/g)) found.add(Number(m[1]));
  for (const m of String(body).matchAll(CLOSING)) {
    for (const r of m[1].matchAll(/(?:^|[\s,])#(\d+)(?!\d)/g)) found.add(Number(r[1]));
  }
  if (issuesUrl) {
    const esc = issuesUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    for (const m of `${title}\n${body}`.matchAll(new RegExp(`${esc}(\\d+)(?!\\d)`, 'gi'))) found.add(Number(m[1]));
  }
  return [...found].sort((a, b) => a - b);
}

/**
 * Every open PR (GitHub) or MR (GitLab) of the repository with the issues it refers to:
 * { number, title, url, draft, issues: number[] }.
 * @param {{ platform: string, repo: string, exec?: (cli: string, args: string[]) => Promise<string> }} opts
 */
async function fetchOpenPullRequests({ platform, repo, exec = execCli }) {
  const parsed = parseRepoUrl(repo);
  if (!parsed || !PLATFORMS[platform]?.cli) return [];
  if (platform === 'github') {
    const target = parsed.host === 'github.com' ? parsed.path : `${parsed.host}/${parsed.path}`;
    const args = (fields) => ['pr', 'list', '--repo', target, '--state', 'open', '--limit', String(MAX_ISSUES), '--json', fields];
    const fields = 'number,title,url,isDraft,body';
    let out;
    try {
      out = await exec('gh', args(`${fields},closingIssuesReferences`));
    } catch (e) {
      // older gh versions do not know closingIssuesReferences: the text references still work
      if (!/closingIssuesReferences/.test(e.message)) throw e;
      out = await exec('gh', args(fields));
    }
    const issuesUrl = `https://${parsed.host}/${parsed.path}/issues/`;
    return JSON.parse(out || '[]').map((p) => ({
      number: p.number, title: p.title, url: p.url, draft: !!p.isDraft,
      issues: referencedIssues({ title: p.title, body: p.body, closing: (p.closingIssuesReferences || []).map((i) => i.number) }, issuesUrl),
    }));
  }
  const target = parsed.host === 'gitlab.com' ? parsed.path : `https://${parsed.host}/${parsed.path}`;
  const out = await exec('glab', ['mr', 'list', '--repo', target, '--per-page', '100', '--output', 'json']);
  const issuesUrl = `https://${parsed.host}/${parsed.path}/-/issues/`;
  return JSON.parse(out || '[]').map((m) => ({
    number: m.iid, title: m.title, url: m.web_url, draft: !!(m.draft || m.work_in_progress),
    issues: referencedIssues({ title: m.title, body: m.description }, issuesUrl),
  }));
}

/** Adds to each issue the open PRs/MRs that refer to it: pullRequests: { number, title, url, draft }[]. */
function attachPullRequests(issues, prs) {
  return issues.map((issue) => ({
    ...issue,
    pullRequests: prs.filter((p) => p.issues.includes(issue.number)).map(({ number, title, url, draft }) => ({ number, title, url, draft })),
  }));
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
  // the issues are what the screen needs: PRs that cannot be read leave a note, not an error
  let pullRequestsError = null;
  const [fetched, prs] = await Promise.all([
    fetchIssues({ platform, repo: project.repo, exec }),
    fetchOpenPullRequests({ platform, repo: project.repo, exec }).catch((e) => { pullRequestsError = e.message; return []; }),
  ]);
  const issues = attachPullRequests(fetched, prs);
  issues.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
  const data = { projectId: project.id, platform, repo: project.repo, syncedAt: new Date().toISOString(), pullRequestsError, issues };
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(cacheFile(dir, project.id), JSON.stringify(data, null, 2));
  return data;
}

// ---- issue ↔ run links -------------------------------------------------------------------
// A run works on an issue when it was started for it (the Backlog's "Assign workflow", recorded
// as run.issues; runs recorded before groups have run.issue) or, for runs started by hand, when
// its task or one of its text inputs mentions the issue's URL or "#<number>". Simulated runs only
// count through the explicit link.
function mentions(run, issue) {
  const text = [run.task, ...Object.values(run.inputs || {})].filter((v) => typeof v === 'string').join('\n');
  return (!!issue.url && text.includes(issue.url)) || new RegExp(`(^|[^\\w/&])#${issue.number}(?!\\d)`).test(text);
}
/** The issues a run was started for: run.issues, or [run.issue] for runs recorded before groups. */
const runIssues = (run) => (Array.isArray(run?.issues) ? run.issues : run?.issue ? [run.issue] : []);
const sameIssue = (a, issue) => (a.url ? a.url === issue.url : a.number === issue.number);
const startedFor = (run, issue) => runIssues(run).some((a) => sameIssue(a, issue));

// An open issue whose latest run merged into the local base (`merge: local`) is not done until
// that work reaches origin: its merge commit, or a commit closing it, is among the commits not
// pushed yet. Without a known push status (never checked, or the check failed) it counts as not pushed.
function notPushed(issue, run, local) {
  if (!run.localMerge) return false;
  if (!local || local.error) return true;
  return (local.issues || []).includes(issue.number) || (local.commits || []).some((c) => c.sha === run.localMerge.commit);
}

// Kanban column from the issue state, its place in the queue, its latest run and the project's
// local commits not pushed yet (localStatus in src/local-push.js). Done = closed on the platform,
// only: an open issue whose run succeeded (a PR not merged yet, a push the platform hasn't seen)
// stays in progress until a sync reports it closed.
function columnOf(issue, latest, queued, local) {
  if (issue.state === 'closed') return 'done';
  if (queued) return 'in_progress';
  if (!latest) return 'todo';
  if (latest.waiting) return 'waiting';
  if (latest.status === 'success') return notPushed(issue, latest, local) ? 'local' : 'in_progress';
  if (latest.status === 'cancelled') return 'todo';
  return 'in_progress'; // running, failed, interrupted
}

/**
 * Adds to each issue the project's runs that work on it (newest first), its place in the queue
 * and its column: todo | in_progress | waiting (a run stopped at a human gate) | local (merged
 * into the local base, not pushed yet) | done.
 * @param {object[]} issues from fetchIssues
 * @param {{ runId, workflow, status, startedAt, mock?, waiting?, issue?, task?, inputs?, localMerge?, recovery? }[]} runs the project's runs
 * @param {{ items: object[] } | null} queue the project's queue (readQueue)
 * @param {{ commits: { sha }[], issues: number[], error? } | null} local the project's commits not pushed (readLocal)
 */
function linkRuns(issues, runs, queue = null, local = null) {
  const sorted = [...runs].sort((a, b) => String(b.startedAt).localeCompare(String(a.startedAt)));
  const items = queue?.items || [];
  return issues.map((issue) => {
    const linked = sorted.filter((r) => startedFor(r, issue) || (!r.mock && !runIssues(r).length && mentions(r, issue)))
      .map((r) => {
        // a run started for a group: the other issues it implements ("grouped with #a, #b")
        const others = runIssues(r).filter((a) => !sameIssue(a, issue)).map((a) => a.number);
        return {
          runId: r.runId, workflow: r.workflow, status: r.status, startedAt: r.startedAt, mock: !!r.mock, waiting: !!r.waiting,
          ...(r.localMerge ? { localMerge: r.localMerge } : {}), ...(others.length ? { groupedWith: others } : {}),
          // the supervisor sent the run back after a failed merge (runs.js fromEvents)
          ...(r.recovery ? { recovery: r.recovery } : {}),
        };
      });
    const at = items.findIndex((q) => itemIssues(q).some((x) => x.number === issue.number));
    const others = at < 0 ? [] : itemIssues(items[at]).map((x) => x.number).filter((n) => n !== issue.number);
    const queued = at < 0 ? null : {
      position: at + 1, workflow: items[at].workflowName || items[at].workflow, mock: !!items[at].mock, ...(others.length ? { groupedWith: others } : {}),
    };
    return { ...issue, runs: linked, queued, column: columnOf(issue, linked[0], queued, local) };
  });
}

// ---- local commits not pushed ----------------------------------------------------------------
// The last localStatus (src/local-push.js) of a project, in <workspace>/backlog/<project id>.local.json:
// read on every Backlog read without touching git, refreshed by a sync, a local merge or a push.
const localFile = (dir, projectId) => path.join(dir, `${path.basename(String(projectId))}.local.json`);

function readLocal(dir, projectId) {
  try { return JSON.parse(fs.readFileSync(localFile(dir, projectId), 'utf8')); } catch { return null; }
}

function writeLocal(dir, projectId, status) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(localFile(dir, projectId), JSON.stringify(status, null, 2));
  return status;
}

// ---- queue -----------------------------------------------------------------------------------
// Issues assigned to a workflow wait in <workspace>/backlog/<project id>.queue.json until the
// service starts them while there are free run slots (Settings › Execution › Concurrent runs; one at
// a time by default): { paused, error, inputs: { <workflow file>: inputs }, items, skipped }.
// An item is one run: one issue ({ number, url, title, body, knownPullRequests, ... }), or a group
// sent as a single run (one branch, one PR/MR), which also has `issues`: the same fields per issue,
// in the order selected; its number/url/title are the first issue's.
// `skipped` lists the issues taken out right before their start, with the reason (an open PR/MR).
const queueFile = (dir, projectId) => path.join(dir, `${path.basename(String(projectId))}.queue.json`);
const emptyQueue = () => ({ paused: false, error: null, inputs: {}, items: [], skipped: [] });
const MAX_SKIPPED = 20;

function readQueue(dir, projectId) {
  try { return { ...emptyQueue(), ...JSON.parse(fs.readFileSync(queueFile(dir, projectId), 'utf8')) }; } catch { return emptyQueue(); }
}

function writeQueue(dir, projectId, queue) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(queueFile(dir, projectId), JSON.stringify(queue, null, 2));
  return queue;
}

const updateQueue = (dir, projectId, fn) => writeQueue(dir, projectId, fn(readQueue(dir, projectId)) || readQueue(dir, projectId));

const issueFields = (i) => ({ number: i.number, url: i.url, title: i.title, body: i.body || '', knownPullRequests: i.knownPullRequests || [] });
/** The issues of a queue item: its `issues` (a group), or the item itself. */
const itemIssues = (item) => (Array.isArray(item.issues) && item.issues.length ? item.issues : [issueFields(item)]);
// An item with these issues: a group while it has two or more, a single issue otherwise.
function withIssues(item, issues) {
  const { issues: _old, ...rest } = item;
  return { ...rest, ...issueFields(issues[0]), ...(issues.length > 1 ? { issues } : {}) };
}

// addedAt of an assignment: strictly increasing, so nextQueued's "oldest first" across projects
// never ties (two assignments in the same millisecond would fall back to the folder listing order).
let lastStamp = 0;
function queueStamp() {
  lastStamp = Math.max(Date.now(), lastStamp + 1);
  return new Date(lastStamp).toISOString();
}

/**
 * Queues issues for a workflow and remembers the inputs used for it in this project. Issues
 * already queued are skipped. Assigning resumes a paused queue. The open PRs/MRs an issue has when
 * it is assigned were accepted by the user ("assign anyway"): only newer ones skip it later.
 * `group`: the issues go as one item (one run, one branch, one PR/MR), in the order given.
 * @param {{ issues: { number, url, title, body, pullRequests? }[], workflow: string, workflowName?: string, inputs?: object, mock?: boolean, group?: boolean }} a
 */
function enqueue(dir, projectId, { issues, workflow, workflowName = null, inputs = {}, mock = false, group = false }) {
  return updateQueue(dir, projectId, (q) => {
    const have = new Set(q.items.flatMap((x) => itemIssues(x).map((i) => i.number)));
    const now = queueStamp();
    const fresh = issues.filter((i) => !have.has(i.number))
      .map((i) => issueFields({ ...i, knownPullRequests: (i.pullRequests || []).map((p) => p.url) }));
    const base = { workflow, workflowName, inputs, mock: !!mock, addedAt: now };
    const added = !fresh.length ? [] : group ? [withIssues(base, fresh)] : fresh.map((i) => withIssues(base, [i]));
    const numbers = new Set(fresh.map((x) => x.number));
    return {
      ...q, paused: false, error: null, inputs: { ...q.inputs, [workflow]: inputs }, items: [...q.items, ...added],
      skipped: (q.skipped || []).filter((s) => !numbers.has(s.number)),
    };
  });
}

// The queue items without one issue: a group loses that issue (and ends when none is left), or
// with `whole`, the item holding it is taken out with all its issues.
function withoutIssue(items, number, whole = false) {
  return items.flatMap((x) => {
    const issues = itemIssues(x);
    if (!issues.some((i) => i.number === number)) return [x];
    const left = issues.filter((i) => i.number !== number);
    return whole || !left.length ? [] : [withIssues(x, left)];
  });
}

/**
 * Takes an issue out of the queue (and out of the skipped list). An issue of a group leaves the
 * group, whose other issues stay queued; `cancelGroup` takes the whole group out instead.
 */
function unqueue(dir, projectId, number, { cancelGroup = false } = {}) {
  return updateQueue(dir, projectId, (q) => ({ ...q, items: withoutIssue(q.items, number, cancelGroup), skipped: (q.skipped || []).filter((s) => s.number !== number) }));
}

/** Takes a queued issue out right before its start and records why (shown by the queue); the rest of its group stays. */
function skipQueued(dir, projectId, number, reason) {
  return updateQueue(dir, projectId, (q) => {
    const issue = q.items.flatMap(itemIssues).find((i) => i.number === number);
    if (!issue) return q;
    const entry = { number, title: issue.title, url: issue.url, reason, at: new Date().toISOString() };
    return { ...q, items: withoutIssue(q.items, number), skipped: [...(q.skipped || []).filter((s) => s.number !== number), entry].slice(-MAX_SKIPPED) };
  });
}

/**
 * The open PRs/MRs of a queued issue that were not there when it was assigned (checked again right
 * before it starts). A check that fails lets the issue start: the last sync had none new either.
 * For a group, each PR/MR carries `issue`: the number of the group's issue it refers to.
 */
async function newPullRequests({ item, platform, repo, exec }) {
  let prs;
  try { prs = await fetchOpenPullRequests({ platform, repo, exec }); } catch { return []; }
  const issues = itemIssues(item);
  return issues.flatMap((issue) => {
    const known = new Set(issue.knownPullRequests || []);
    return prs.filter((p) => p.issues.includes(issue.number) && !known.has(p.url))
      .map(({ number, title, url, draft }) => ({ number, title, url, draft, ...(issues.length > 1 ? { issue: issue.number } : {}) }));
  });
}

function setPaused(dir, projectId, paused, error = null) {
  return updateQueue(dir, projectId, (q) => ({ ...q, paused: !!paused, error: paused ? error : null }));
}

// Project ids with a queue file.
function queuedProjects(dir) {
  try { return fs.readdirSync(dir).filter((f) => f.endsWith('.queue.json')).map((f) => f.slice(0, -'.queue.json'.length)); } catch { return []; }
}

/**
 * The next item to start: the oldest one across the projects whose queue is not paused, among
 * those `canStart(projectId, item)` accepts (a project at its limit of concurrent runs waits).
 */
function nextQueued(dir, canStart = () => true) {
  const heads = queuedProjects(dir)
    .map((projectId) => ({ projectId, q: readQueue(dir, projectId) }))
    .filter(({ q }) => !q.paused && q.items.length)
    .map(({ projectId, q }) => ({ projectId, item: q.items[0] }))
    .filter(({ projectId, item }) => canStart(projectId, item));
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

// The task of a group: every issue (title, URL and body) in the order selected, shipped together.
function groupTask(issues) {
  const refs = issues.map((i) => `#${i.number}`).join(', ');
  return [
    `Implement these ${issues.length} issues together (${refs}).`,
    'They ship together in one branch and one PR/MR that closes every one of them. Account for each issue: '
      + 'say what was done for each one, and if one cannot be done, say which and why (never drop it silently).',
    ...issues.map((i, n) => `## ${n + 1}. #${i.number} ${i.title}\n\nIssue: ${i.url}\n\n${i.body || ''}`.trim()),
  ].join('\n\n');
}

/**
 * The inputs of a run started for a queued item: the saved inputs, the task (issue title, URL and
 * body; every issue of a group, see groupTask), the project folder in the path inputs left empty,
 * `issue` (the first issue's URL) and `issues` (every URL, in order) when the workflow has them.
 * @param {{ inputs: object }} wf the workflow (its input definitions)
 */
function runInputs(item, wf, folder) {
  const inputs = { ...item.inputs };
  const defs = wf.inputs || {};
  const issues = itemIssues(item);
  if (defs.task) inputs.task = issues.length > 1 ? groupTask(issues) : `${item.title}\n\nIssue: ${item.url}\n\n${item.body || ''}`.trim();
  for (const [k, def] of Object.entries(defs)) {
    if (k !== 'task' && (def.type || 'string') === 'string' && /path|dir/i.test(k) && !inputs[k] && folder) inputs[k] = folder;
  }
  if (defs.issue) inputs.issue = item.url;
  if (defs.issues) inputs.issues = issues.map((i) => i.url);
  return inputs;
}

module.exports = {
  PLATFORMS, DEFAULT_PLATFORM, parseRepoUrl, platformOfHost, taskProgress, fetchIssues, readBacklog, syncBacklog, linkRuns,
  referencedIssues, fetchOpenPullRequests, attachPullRequests,
  readQueue, enqueue, unqueue, skipQueued, newPullRequests, setPaused, nextQueued, pauseAll, runInputs,
  itemIssues, runIssues, execCli, readLocal, writeLocal,
};
