// Backlog: a project's issues, fetched from its git platform with that platform's CLI (gh for
// GitHub, glab for GitLab) and cached in <workspace>/backlog/<project id>.json, so the screen shows
// the last sync right away (and offline) while a new one runs.
// Bitbucket is a choice in Settings but has no sync yet (no official CLI).
// `linkRuns` ties runs to issues (`run.issues` recorded by the engine, `run.issue` for older runs,
// else task/inputs mentioning the URL or `#n`, mock runs excluded; `groupedWith` = the other issues
// of the same run or queued group) and picks the kanban column (todo / in_progress / waiting / local
// / done; done = closed on the platform). Simulated (mock) runs and queue items are listed but never
// move the column: it comes from the newest real run and the real queue items. Each sync also reads the open PRs/MRs
// (`fetchOpenPullRequests`, `referencedIssues`) into `issue.pullRequests`. Assigning a workflow
// queues issues (the index's queue tables, src/store.js, snapshotted to `<id>.queue.json`) (`enqueue`, `group: true` = one item with `issues` for one run,
// `itemIssues`, `unqueue`, `runInputs` builds one task listing every issue of a group; before a real
// start `newPullRequests` and `skipQueued`); the service's `dispatchQueue` starts queued issues while
// there are free run slots (`claimQueued`: atomic with the index). Column `local`: an open issue whose latest run merged
// locally while its commit is not on origin (`readLocal`/`writeLocal`: `<id>.local.json`).
// Write & Review runs started from an issue (`enrich` on the linked run) never move its column; their
// accepted document can be saved back to the issue (`saveRunToIssue`: replace the description or comment).
// An issue-tracker run whose owner chose "create and queue" is chained to a queue (#134): the service
// (src/service/areas/chain.js) syncs the backlog and assigns its `issues` output when the run ends.
// Each sync also reads the epics (#138, src/domains/backlog/epics.js readEpics): `issue.epic` and the cache's `epics`.
// The platform is the source of truth (#168): queue and roadmap items keep a read-only copy of their
// issues, refreshed by each sync (`refreshQueuedCopies`) and read again right before a run starts
// (`freshIssues`, with the cache as a recorded fallback when the platform cannot be read).
// Archive (#238): `archiveIssues` closes issues as not planned with the `archived` label (guards:
// src/shared/backlog-archive.js), `restoreIssues` reopens them.
// The platform CLI helpers and the issue copies live in src/domains/backlog/issues.js (re-exported here, #345).
// Screen: src/renderer/views/backlog/backlog.js; channels: src/service/channels/backlog.js.

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { readEpics } = require('./epics');
const {
  DEFAULT_PLATFORM,
  MAX_ISSUES,
  PLATFORMS,
  adapterOf,
  cliTarget,
  commandDisplay,
  execCli,
  fetchIssue,
  fetchIssues,
  issueCreateCommand,
  issueFields,
  itemIssues,
  parseRepoUrl,
  platformOfHost,
  repoLabels,
  runCommand,
  taskProgress,
  withSyncedText,
} = require('./issues');
const { refreshCopies } = require('../../roadmap');
const { writeJsonSafe } = require('../../state-file');
const { storeFor } = require('../../store');
const TimeZone = require('../analytics/time-zone');
const { ARCHIVED_LABEL, archiveBlockReason } = require('../../shared/backlog-archive');
const { LIVE_ITEM_STATES } = require('../../shared/roadmap-model');

// the workflow of Write & Review: its runs enrich an issue's text, they do not implement it
const ENRICH_WORKFLOW = 'writer-reviewer';
// the issue tracker (#81) files issues, it does not implement them: its runs never link to an issue
// they mention (e.g. "related to #41"); its "create and queue" choice queues the issues it filed
const ISSUE_TRACKER_WORKFLOW = 'issue-tracker';

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
  const p = adapterOf(platform);
  if (!parsed || !p) return [];
  const target = p.cliTarget(parsed);
  let out;
  try {
    out = await runCommand(exec, p.requestListCommand(target, MAX_ISSUES));
  } catch (e) {
    // older CLI versions do not know the closing references (gh's closingIssuesReferences): the text references still work
    if (!p.olderCli(e.message)) throw e;
    out = await runCommand(exec, p.requestListCommand(target, MAX_ISSUES, { closing: false }));
  }
  const issuesUrl = p.issuesUrl(parsed);
  return p.parseRequests(out).map(({ number, title, url, draft, body, closing }) => ({
    number, title, url, draft, issues: referencedIssues({ title, body, closing }, issuesUrl),
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
  // epics, like the PRs, never fail the sync: an error leaves a note (epicsError)
  const { issues, epics, epicsError } = await readEpics({ platform, repo: project.repo, issues: attachPullRequests(fetched, prs), exec });
  issues.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
  const data = { projectId: project.id, platform, repo: project.repo, syncedAt: new Date().toISOString(), pullRequestsError, issues, epics, epicsError };
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(cacheFile(dir, project.id), JSON.stringify(data, null, 2));
  // the planned items not started yet show (and the Product Owner reads) the current text (#168);
  // a plan that cannot be written leaves the sync done
  try {
    refreshQueuedCopies(dir, project.id, issues);
    refreshCopies(dir, project.id, issues);
  } catch (e) { console.error('planned issue copies:', e.message); }
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

// Kanban column from the issue state, a real queue item for it, its latest real run and the project's
// local commits not pushed yet (localStatus in src/domains/local/local-push.js). Done = closed on the platform,
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
    const linked = sorted.filter((r) => startedFor(r, issue) || (!r.mock && r.workflow !== ISSUE_TRACKER_WORKFLOW && !runIssues(r).length && mentions(r, issue)))
      .map((r) => {
        // a run started for a group: the other issues it implements ("grouped with #a, #b")
        const others = runIssues(r).filter((a) => !sameIssue(a, issue)).map((a) => a.number);
        return {
          runId: r.runId, workflow: r.workflow, status: r.status, startedAt: r.startedAt, mock: !!r.mock, waiting: !!r.waiting,
          ...(r.localMerge ? { localMerge: r.localMerge } : {}), ...(others.length ? { groupedWith: others } : {}),
          // the supervisor sent the run back after a failed merge (runs.js fromEvents)
          ...(r.recovery ? { recovery: r.recovery } : {}),
          // its display title and the PR it opened (#84)
          ...(r.title ? { title: r.title, customTitle: r.customTitle || null } : {}),
          ...(r.pr ? { pr: r.pr } : {}),
          // a Write & Review run enriching the issue's text (#103): shown on the card, never moves the column
          ...(r.workflow === ENRICH_WORKFLOW ? { enrich: true } : {}),
        };
      });
    const at = items.findIndex((q) => itemIssues(q).some((x) => x.number === issue.number));
    const others = at < 0 ? [] : itemIssues(items[at]).map((x) => x.number).filter((n) => n !== issue.number);
    const queued = at < 0 ? null : {
      position: at + 1, workflow: items[at].workflowName || items[at].workflow, mock: !!items[at].mock, ...(others.length ? { groupedWith: others } : {}),
    };
    // simulations stay in the issue's history (and keep their queued badge) but never decide its column
    const realQueued = items.some((q) => !q.mock && itemIssues(q).some((x) => x.number === issue.number));
    return { ...issue, runs: linked, queued, column: columnOf(issue, linked.find((r) => !r.mock && !r.enrich), realQueued, local) };
  });
}

// ---- local commits not pushed ----------------------------------------------------------------
// The last localStatus (src/domains/local/local-push.js) of a project, in <workspace>/backlog/<project id>.local.json:
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
// With the service's index open (src/store.js, #76) the queue lives in its tables: each change is
// one transaction and the file is only a readable snapshot written under that lock; without it
// (scripts, unit tests) the file is the queue.
const queueFile = (dir, projectId) => path.join(dir, `${path.basename(String(projectId))}.queue.json`);
const emptyQueue = () => ({ paused: false, error: null, inputs: {}, items: [], skipped: [] });
const MAX_SKIPPED = 20;

function readQueue(dir, projectId) {
  const store = storeFor(dir);
  if (store) return withoutStalePause({ ...emptyQueue(), ...(store.readQueue(path.basename(String(projectId))) || {}) });
  try { return withoutStalePause({ ...emptyQueue(), ...JSON.parse(fs.readFileSync(queueFile(dir, projectId), 'utf8')) }); } catch { return emptyQueue(); }
}

// #445: a run's failure pauses the queue with `reason` { key, values: { issues } } (drawn in the
// interface language); before, `error` held the English sentence, still recognised here
const QUEUE_FAILED = 'backlog.queue_failed';
const LEGACY_FAILED = / failed: resume to start the next issues\.$/;
const failureIssues = (q) => (q.reason?.key === QUEUE_FAILED ? (q.reason.values?.issues || []).map(Number)
  : LEGACY_FAILED.test(q.error || '') ? (q.error.match(/#(\d+)/g) || []).map((s) => +s.slice(1)) : null);

// A pause by a failure does not outlive its cause: an empty queue, or every issue it names done
// (`done(number)`), is not paused (#445). A pause by hand or by a start that failed stays.
function withoutStalePause(q, done = () => false) {
  const issues = q.paused ? failureIssues(q) : null;
  if (!issues || (q.items.length && !(issues.length && issues.every(done)))) return q;
  const { reason: _reason, ...rest } = q;
  return { ...rest, paused: false, error: null };
}

// What a queue must look like (#112: a write that breaks it is refused, src/state-file.js).
function queueProblem(q) {
  if (!q || typeof q !== 'object') return 'not an object';
  if (!Array.isArray(q.items)) return 'items is not a list';
  if (q.skipped && !Array.isArray(q.skipped)) return 'skipped is not a list';
  const bad = q.items.find((x) => !x || !x.workflow || !Number.isInteger(Number(x.number)));
  return bad ? `an item has no workflow or issue number: ${JSON.stringify(bad).slice(0, 120)}` : null;
}

// atomic, with the previous version kept as .bak (src/state-file.js)
function writeQueueFile(dir, projectId, queue) {
  return writeJsonSafe(queueFile(dir, projectId), queue, { validate: queueProblem });
}

function writeQueue(dir, projectId, queue) {
  const problem = queueProblem(queue);
  if (problem) writeQueueFile(dir, projectId, queue); // refused, logged and thrown before the index changes
  const store = storeFor(dir);
  if (!store) return writeQueueFile(dir, projectId, queue);
  return store.transaction(() => {
    store.writeQueue(path.basename(String(projectId)), queue);
    return writeQueueFile(dir, projectId, queue);
  });
}

// read, change and write in one transaction (with the index): a concurrent change waits for it
function updateQueue(dir, projectId, fn) {
  const apply = () => writeQueue(dir, projectId, withoutStalePause(fn(readQueue(dir, projectId)) || readQueue(dir, projectId)));
  const store = storeFor(dir);
  return store ? store.transaction(apply) : apply();
}

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
// then: what happens with each run's result when it finishes (#134, chain-model), given to its start
// agentOverrides (#262): the provider / model / effort per agent chosen for these runs (run:start's)
function enqueue(dir, projectId, { issues, workflow, workflowName = null, inputs = {}, mock = false, group = false, then = null, agentOverrides = null }) {
  return updateQueue(dir, projectId, (q) => {
    const have = new Set(q.items.flatMap((x) => itemIssues(x).map((i) => i.number)));
    const now = queueStamp();
    const fresh = issues.filter((i) => !have.has(i.number))
      .map((i) => issueFields({ ...i, knownPullRequests: (i.pullRequests || []).map((p) => p.url) }));
    const base = { workflow, workflowName, inputs, mock: !!mock, addedAt: now, ...(then ? { then } : {}), ...(agentOverrides && Object.keys(agentOverrides).length ? { agentOverrides } : {}) };
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

// `reason` (#445): a pause drawn in the interface language, { key, values }, instead of `error`
function setPaused(dir, projectId, paused, error = null, reason = null) {
  return updateQueue(dir, projectId, ({ reason: _old, ...q }) => ({ ...q, paused: !!paused, error: paused ? error : null, ...(paused && reason ? { reason } : {}) }));
}

/** #445: a run of the queue's own failed: its issues pause the queue (none when nothing waits). */
function pauseForFailure(dir, projectId, numbers) {
  return setPaused(dir, projectId, true, null, { key: QUEUE_FAILED, values: { issues: numbers.map(Number) } });
}

/** #445: the pause of a failure ends once each issue it names is done (`done(number)`). */
function clearDonePause(dir, projectId, done) {
  const q = readQueue(dir, projectId);
  if (withoutStalePause(q, done) !== q) updateQueue(dir, projectId, (cur) => withoutStalePause(cur, done));
}

// Project ids with a queue (rows of the index, else queue files).
function queuedProjects(dir) {
  const store = storeFor(dir);
  if (store) return store.queuedProjects();
  try { return fs.readdirSync(dir).filter((f) => f.endsWith('.queue.json')).map((f) => f.slice(0, -'.queue.json'.length)); } catch { return []; }
}

/**
 * The next item to start: the oldest one across the projects whose queue is not paused, among
 * those `canStart(projectId, item)` accepts (a project at its limit of concurrent runs waits).
 * Items another dispatcher claimed (claimQueued, being started) are passed over.
 */
function nextQueued(dir, canStart = () => true) {
  const store = storeFor(dir);
  const heads = queuedProjects(dir)
    .map((projectId) => ({ projectId, q: readQueue(dir, projectId) }))
    .filter(({ q }) => !q.paused && q.items.length)
    .map(({ projectId, q }) => {
      const claimed = store ? store.claimedNumbers(projectId) : new Set();
      return { projectId, item: q.items.find((x) => !claimed.has(x.number)) };
    })
    .filter(({ projectId, item }) => item && canStart(projectId, item));
  heads.sort((a, b) => String(a.item.addedAt).localeCompare(String(b.item.addedAt)));
  return heads[0] || null;
}

/**
 * nextQueued, taken atomically: with the index, the item is claimed in the same transaction, so two
 * dispatchers (two windows' services, or a server and the app on one workspace) never take the same
 * issue. The claim ends when the item leaves the queue (unqueue after its start) or releaseQueued.
 */
function claimQueued(dir, canStart = () => true) {
  const store = storeFor(dir);
  if (!store) return nextQueued(dir, canStart);
  return store.transaction(() => {
    const next = nextQueued(dir, canStart);
    if (next) store.claim(next.projectId, next.item.number);
    return next;
  });
}

/** Ends a dispatcher's claim on an item that did not start (it stays queued). */
function releaseQueued(dir, projectId, number) {
  storeFor(dir)?.release(path.basename(String(projectId)), number);
}

/** Pauses every queue with items waiting (the app restarted: nothing starts without the user). */
function pauseAll(dir, reason) {
  for (const projectId of queuedProjects(dir)) {
    updateQueue(dir, projectId, (q) => (q.items.length && !q.paused ? { ...q, paused: true, error: reason } : q));
  }
}

// ---- save a document to its issue ------------------------------------------------------------
// A Write & Review run started from an issue ("Enrich in Write & Review", run.issues) can save its
// accepted document (document.md) back to that issue, on the owner's confirmation only: `replace`
// makes the document the new description and keeps the original at the end in a collapsed
// <details> block; `comment` adds it as a comment and leaves the description as it is. A preview
// never calls the CLI. Each save is recorded in the run folder: issue-save.md (the text sent) and
// issue-saves.json ([{ number, url, mode, at, platform, commentUrl? }]), shown in Details and Artifacts.
const SAVE_MODES = ['replace', 'comment'];
const ORIGINAL_SUMMARY = '<details><summary>Original description</summary>';
const ORIGINAL_BLOCK = /\n*<details><summary>Original description<\/summary>\n\n([\s\S]*)\n\n<\/details>\s*$/;

/**
 * The text sent to the issue. `replace`: the document, then the original description in a collapsed
 * block (a description saved before keeps its first original, so saving again never nests blocks);
 * `comment`: the document only.
 */
function issueSaveBody({ mode, document, original = '' }) {
  const doc = String(document || '').replace(/\r\n/g, '\n').trim();
  if (mode === 'comment') return `${doc}\n`;
  const current = String(original || '').replace(/\r\n/g, '\n').trim();
  const kept = (current.match(ORIGINAL_BLOCK)?.[1] ?? current).trim();
  return kept ? `${doc}\n\n${ORIGINAL_SUMMARY}\n\n${kept}\n\n</details>\n` : `${doc}\n`;
}

/**
 * The CLI call that saves `text` to issue `number`: gh reads it from `file` (--body-file), glab
 * takes it as an argument. { cli, args, display } (display: the command as shown in the preview).
 */
function issueSaveCommand({ platform, repo, number, mode, file, text }) {
  if (!SAVE_MODES.includes(mode)) throw new Error(`Unknown save mode: ${mode} (replace or comment).`);
  const target = cliTarget(platform, repo);
  const c = adapterOf(platform).issueSaveCommand({ target, n: String(Number(number)), mode, file, text });
  return { ...c, display: commandDisplay(c, text) };
}

/** The CLI call that closes issue `number` (a parent split into child issues, #124): { cli, args, display }. */
function issueCloseCommand({ platform, repo, number }) {
  const target = cliTarget(platform, repo);
  const c = adapterOf(platform).issueCloseCommand(target, String(Number(number)));
  return { ...c, display: commandDisplay(c) };
}

/**
 * A description with `addition` appended as a dated section ("## Update (YYYY-MM-DD)"), keeping
 * everything already there (the hand-made updates of #77, #96, #110, #112). The date is the owner's
 * local day (`timeZone`, settings.timeZone, #273; unset: the computer's).
 */
function issueAppendBody({ original = '', addition, date = new Date(), timeZone = null }) {
  const current = String(original || '').replace(/\r\n/g, '\n').trimEnd();
  const add = String(addition || '').replace(/\r\n/g, '\n').trim();
  if (!add) throw new Error('Nothing to add to the issue.');
  const section = `## Update (${TimeZone.dayKey(date, timeZone)})\n\n${add}\n`;
  return current ? `${current}\n\n${section}` : section;
}

/** Replaces one issue in a project's cache (its pull requests are kept); returns the cache, or null without one. */
function updateCachedIssue(dir, projectId, issue) {
  const data = readBacklog(dir, projectId);
  if (!data) return null;
  data.issues = (data.issues || []).map((i) => (i.number === issue.number ? { ...i, ...issue, pullRequests: i.pullRequests || [] } : i));
  fs.writeFileSync(cacheFile(dir, projectId), JSON.stringify(data, null, 2));
  return data;
}

// ---- archive and restore (#238) ------------------------------------------------------------------
// Archiving closes the issue (GitHub: not planned) and labels it `archived`; restoring reopens it and
// removes the label. Each issue goes on its own: a refusal (archiveBlockReason) or a CLI failure is
// that issue's { ok: false, error }, the issue is put back as it was, and the others still go through.
// The cache is patched at once (no re-read), so the issue moves between the state chips right away.

const ARCHIVED_COLOR = 'ededed';
const sameLabel = (l, name) => String(l?.name ?? l).toLowerCase() === name;
const notAnIssue = (n) => (Number.isInteger(n) && n > 0 ? null : `Not an issue number: ${n}`);

function patchCachedIssue(dir, projectId, number, fn) {
  const issue = dir && projectId ? readBacklog(dir, projectId)?.issues?.find((i) => i.number === number) : null;
  if (issue) updateCachedIssue(dir, projectId, fn(issue));
}

/** The CLI call that adds (`add`) or removes the `archived` label of issue `number`. */
function archivedLabelCommand({ platform, repo, number, add }) {
  const target = cliTarget(platform, repo);
  return adapterOf(platform).issueLabelCommand({ target, n: String(Number(number)), label: ARCHIVED_LABEL, add });
}

/** The CLI call that reopens issue `number`. */
function issueReopenCommand({ platform, repo, number }) {
  const target = cliTarget(platform, repo);
  return adapterOf(platform).issueReopenCommand(target, String(Number(number)));
}

// Creates the `archived` label (neutral grey) when the GitHub repository lacks it; GitLab creates it itself.
async function ensureArchivedLabel({ platform, repo, exec }) {
  const labels = await repoLabels({ platform, repo, exec });
  if (!labels || labels.some((l) => sameLabel(l, ARCHIVED_LABEL))) return;
  const target = cliTarget(platform, repo);
  await runCommand(exec, adapterOf(platform).labelCreateCommand({ target, name: ARCHIVED_LABEL, color: ARCHIVED_COLOR, description: 'Archived from the Backlog: closed as not planned' }));
}

// Runs `steps` in order; when one fails, runs the undo of the steps already done (best effort) and rethrows.
async function runSteps(steps, exec) {
  const done = [];
  try {
    for (const s of steps) {
      await exec(s.cli, s.args);
      done.unshift(s);
    }
  } catch (e) {
    for (const s of done) await exec(s.undo.cli, s.undo.args).catch(() => {});
    throw e;
  }
}

/**
 * Archives issues: { results: [{ number, ok, error? }] }. `issues`: the Backlog's issues with their
 * roadmap and run links (the guards); `dir`/`projectId`: the backlog cache to patch.
 */
async function archiveIssues({ platform, repo, numbers, issues = [], dir = null, projectId = null, exec = execCli }) {
  const known = new Map((issues || []).map((i) => [i.number, i]));
  const results = [];
  let label = null;
  for (const number of (numbers || []).map(Number)) {
    const refused = notAnIssue(number) || archiveBlockReason(known.get(number));
    if (refused) {
      results.push({ number, ok: false, error: refused });
      continue;
    }
    try {
      label = label || ensureArchivedLabel({ platform, repo, exec });
      await label;
      const at = { platform, repo, number };
      await runSteps([
        { ...issueCloseCommand(at), undo: issueReopenCommand(at) },
        { ...archivedLabelCommand({ ...at, add: true }), undo: archivedLabelCommand({ ...at, add: false }) },
      ], exec);
      patchCachedIssue(dir, projectId, number, (i) => ({
        ...i,
        state: 'closed',
        labels: [...(i.labels || []).filter((l) => !sameLabel(l, ARCHIVED_LABEL)), { name: ARCHIVED_LABEL, color: `#${ARCHIVED_COLOR}` }],
      }));
      results.push({ number, ok: true });
    } catch (e) {
      results.push({ number, ok: false, error: e.message });
    }
  }
  return { results };
}

/** Restores archived issues (reopen, remove the label): { results: [{ number, ok, error? }] }. */
async function restoreIssues({ platform, repo, numbers, dir = null, projectId = null, exec = execCli }) {
  const results = [];
  for (const number of (numbers || []).map(Number)) {
    if (notAnIssue(number)) {
      results.push({ number, ok: false, error: notAnIssue(number) });
      continue;
    }
    try {
      const at = { platform, repo, number };
      await runSteps([
        { ...issueReopenCommand(at), undo: issueCloseCommand(at) },
        { ...archivedLabelCommand({ ...at, add: false }), undo: archivedLabelCommand({ ...at, add: true }) },
      ], exec);
      patchCachedIssue(dir, projectId, number, (i) => ({ ...i, state: 'open', labels: (i.labels || []).filter((l) => !sameLabel(l, ARCHIVED_LABEL)) }));
      results.push({ number, ok: true });
    } catch (e) {
      results.push({ number, ok: false, error: e.message });
    }
  }
  return { results };
}

// ---- the platform is the source of truth (#168) ------------------------------------------------
// Queue and roadmap items keep a read-only copy of their issues (issueFields) for the screen and the
// Product Owner: every sync brings the copies of the items not started yet up to date
// (refreshQueuedCopies, roadmap.refreshCopies), and right before a run starts its issues are read
// again from the platform (freshIssues). Nothing here writes to the platform.

const copyChanged = (copy, synced) => JSON.stringify(withSyncedText(copy, synced)) !== JSON.stringify(copy);

/**
 * Brings the copies of a project's queued issues up to `issues` (a sync, or a fresh read). Items a
 * dispatcher is starting (claimed) are left as they are, unless `includeClaimed`. Writes only on a change.
 */
function refreshQueuedCopies(dir, projectId, issues, { includeClaimed = false } = {}) {
  const known = new Map((issues || []).map((i) => [i.number, i]));
  const claimed = includeClaimed ? new Set() : storeFor(dir)?.claimedNumbers(projectId) || new Set();
  const open = (x) => !claimed.has(x.number);
  if (!readQueue(dir, projectId).items.some((x) => open(x) && itemIssues(x).some((i) => copyChanged(i, known.get(i.number))))) return false;
  updateQueue(dir, projectId, (q) => ({ ...q, items: q.items.map((x) => (open(x) ? withIssues(x, itemIssues(x).map((i) => withSyncedText(i, known.get(i.number)))) : x)) }));
  return true;
}

const clockOf = (iso) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? 'an unknown time' : d.toTimeString().slice(0, 5);
};

/**
 * The issues of an item read again from the platform right before its run starts (title, body,
 * state, labels, updatedAt), each `{ ...issueFields, state }`. A read that fails falls back to the
 * synced cache (`cache`, readBacklog) when its version is at least as new as the item's copy, else to
 * the copy, and says so: the issue gets `fallback: 'cache' | 'copy'` (and `cachedAt`), and a warning
 * for the run's log. `fromPlatform: false` (a simulation, a project without repository) never calls
 * the CLI: the newest of the cache and the copy, without warning.
 * @returns {Promise<{ issues: object[], warnings: string[] }>}
 */
async function freshIssues({ item, platform, repo, cache = null, fromPlatform = true, exec = execCli }) {
  const synced = new Map((cache?.issues || []).map((i) => [i.number, i]));
  const issues = [];
  const warnings = [];
  for (const copy of itemIssues(item)) {
    const kept = { knownPullRequests: copy.knownPullRequests || [] };
    let error = null;
    if (fromPlatform) {
      try {
        const read = await fetchIssue({ platform, repo, number: copy.number, exec });
        issues.push({ ...issueFields({ ...read, ...kept }), state: read.state });
        continue;
      } catch (e) { error = e.message; }
    }
    const cached = synced.get(copy.number);
    // a copy without updatedAt was saved before #168: the cache is at least as new
    const useCache = !!cached && !(copy.updatedAt && String(cached.updatedAt || '') < String(copy.updatedAt));
    issues.push({
      ...issueFields({ ...(useCache ? cached : copy), ...kept }), state: cached?.state || 'open',
      ...(error ? { fallback: useCache ? 'cache' : 'copy', ...(useCache ? { cachedAt: cache.syncedAt || null } : {}) } : {}),
    });
    if (error) {
      warnings.push(useCache ? `Issue #${copy.number} read from the cache of ${clockOf(cache.syncedAt)}: ${error}`
        : `Issue #${copy.number} read from the copy saved with the planned item (the cache has no newer version): ${error}`);
    }
  }
  return { issues, warnings };
}

/** What a run records of each issue it starts from (workflow.started `issues`): the version read (`updatedAt`) and any fallback. */
const recordedIssues = (issues) => issues.map(({ number, url, title, updatedAt = null, fallback = null, cachedAt = null }) => ({
  number, url, title, updatedAt, ...(fallback ? { fallback, cachedAt } : {}),
}));

const savesFile = (runDir) => path.join(runDir, 'issue-saves.json');
/** The saves of a run to its issue (issue-saves.json), oldest first. */
function readIssueSaves(runDir) {
  try { return JSON.parse(fs.readFileSync(savesFile(runDir), 'utf8')); } catch { return []; }
}

/**
 * Preview or save the accepted document of a run to its issue.
 * run: { runDir, status, mock, issues }; platform/repo: the project's backlog; cached: the issue as
 * last synced (its body is the original shown by a preview). `preview` (or a simulated run) never
 * calls the CLI; a save reads the issue again first, so the description kept is the current one,
 * then reads it once more into the cache (`dir`, `projectId`).
 * Returns { preview, mode, issue: { number, url, title }, command, body, saved?, refreshError? }.
 */
async function saveRunToIssue({ run, mode = 'replace', preview = false, platform, repo, cached = null, dir = null, projectId = null, exec = execCli }) {
  const issue = runIssues(run)[0];
  if (!issue) throw new Error('This run was not started from an issue.');
  if (run.status !== 'success') throw new Error('Only an accepted document can be saved to its issue.');
  let document;
  try { document = fs.readFileSync(path.join(run.runDir, 'document.md'), 'utf8'); } catch { throw new Error('The run has no document.md to save.'); }
  if (!document.trim()) throw new Error('The run\'s document.md is empty.');
  const file = path.join(run.runDir, 'issue-save.md');
  const dryRun = preview || !!run.mock;
  let original = cached?.body || '';
  if (!dryRun && mode === 'replace') original = (await fetchIssue({ platform, repo, number: issue.number, exec })).body;
  const body = issueSaveBody({ mode, document, original });
  const command = issueSaveCommand({ platform, repo, number: issue.number, mode, file, text: body });
  const out = { preview: dryRun, mode, issue: { number: issue.number, url: issue.url, title: issue.title || cached?.title || '' }, command: command.display, body };
  if (dryRun) return out;

  fs.writeFileSync(file, body);
  const stdout = String(await exec(command.cli, command.args) || '');
  const commentUrl = mode === 'comment' ? stdout.match(/https?:\/\/\S+/)?.[0] || null : null;
  const saved = { number: issue.number, url: issue.url, mode, platform, at: new Date().toISOString(), ...(commentUrl ? { commentUrl } : {}) };
  fs.writeFileSync(savesFile(run.runDir), JSON.stringify([...readIssueSaves(run.runDir), saved], null, 2));
  out.saved = saved;
  // the Backlog shows the new body, task progress and labels without a full sync
  if (dir && projectId) {
    try { updateCachedIssue(dir, projectId, await fetchIssue({ platform, repo, number: issue.number, exec })); } catch (e) { out.refreshError = e.message; }
  }
  return out;
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

// #491: what changes while runs go, from a Backlog with its runs (the service's withIssueRuns), for
// the Roadmap's live reloads: the roadmap's state and each item's status and live run (its ring and
// timer), the queue and the refresh banner; no issue bodies, no ended run's details (they no longer
// change), so it stays small however long the roadmap is. `shape`: a hash of the stages without what
// runs change (statuses, runs, estimates), so the screen fetches the whole Backlog only when an edit
// changed the stages (an issue added to an item, a note, a cut line), not on every status write
const LIVE_KEYS = new Set([
  'actualMinutes',
  'actualTopStep',
  'actualUsd',
  'error',
  'estimate',
  'finishedAt',
  'pause',
  'run',
  'runHistory',
  'runId',
  'runs',
  'startedAt',
  'status',
  'updatedAt',
  'waiting',
]);
const stagesShape = (stages) => crypto.createHash('sha1')
  .update(JSON.stringify(stages || [], (k, v) => (LIVE_KEYS.has(k) ? undefined : v)))
  .digest('hex').slice(0, 16);
function backlogState(data) {
  if (!data) return null;
  const r = data.roadmap || {};
  const runOf = (x) => {
    if (!x.run || !LIVE_ITEM_STATES.has(x.status)) return {};
    const { status, mock, startedAt, finishedAt, waiting, gate, atGate, progress, error } = x.run;
    return { run: { status, mock, startedAt, finishedAt, waiting, gate, atGate, progress, error } };
  };
  const item = (x) => ({
    id: x.id, status: x.status || null, runId: x.runId || null, runs: x.runs || [], waiting: !!x.waiting,
    startedAt: x.run?.startedAt || null, elapsed: x.run?.startedAt ? (Date.parse(x.run.finishedAt) || Date.now()) - Date.parse(x.run.startedAt) : null,
    ...runOf(x),
  });
  const queue = data.queue ? { ...data.queue, items: (data.queue.items || []).map(({ body, inputs, issues, ...rest }) => rest) } : null;
  return {
    projectId: data.projectId,
    roadmap: {
      state: r.state || null, updatedAt: r.updatedAt || null, scope: r.scope || null, pausedBy: r.pausedBy || null, error: r.error || null,
      shape: r.shape || stagesShape(r.stages),
      stages: (r.stages || []).map((s) => ({ id: s.id, pause: s.pause || null, items: (s.items || []).map(item) })),
    },
    queue,
    refresh: data.refresh || null,
    baseCheck: data.baseCheck || null,
  };
}

module.exports = {
  PLATFORMS, DEFAULT_PLATFORM, parseRepoUrl, platformOfHost, taskProgress, fetchIssues, readBacklog, syncBacklog, linkRuns,
  referencedIssues, fetchOpenPullRequests, attachPullRequests,
  readQueue, enqueue, unqueue, skipQueued, newPullRequests, setPaused, nextQueued, pauseAll, runInputs,
  itemIssues, runIssues, execCli, readLocal, writeLocal,
  archiveIssues,
  backlogState,
  claimQueued,
  clearDonePause,
  cliTarget,
  fetchIssue,
  freshIssues,
  issueAppendBody,
  issueCloseCommand,
  issueCreateCommand,
  issueSaveBody,
  issueSaveCommand,
  pauseForFailure,
  queuedProjects,
  readIssueSaves,
  recordedIssues,
  refreshQueuedCopies,
  releaseQueued,
  repoLabels,
  restoreIssues,
  saveRunToIssue,
  stagesShape,
  updateCachedIssue,
  withSyncedText,
};
