// Backlog: a project's issues, fetched from its git platform with that platform's CLI (gh for
// GitHub, glab for GitLab) and cached in <workspace>/backlog/<project id>.json, so the screen shows
// the last sync right away (and offline) while a new one runs.
// Bitbucket is a choice in Settings but has no sync yet (no official CLI).
// `linkRuns` ties runs to issues (`run.issues` recorded by the engine, `run.issue` for older runs,
// else task/inputs mentioning the URL or `#n`, mock runs excluded; `groupedWith` = the other issues
// of the same run) and picks the kanban column (todo / in_progress / waiting / local / done; done =
// closed on the platform). Simulated (mock) runs are listed but never move the column: it comes from
// the newest real run. Each sync also reads the open PRs/MRs (`fetchOpenPullRequests`,
// `referencedIssues`) into `issue.pullRequests`. Assigning a workflow plans the issues in the roadmap
// (#446: the plain queue is retired; packages/engine/service/areas/backlog.js assignWorkflow); `itemIssues`
// and `runInputs` (one task listing every issue of a group) serve its items. Column `local`: an open issue whose latest run merged
// locally while its commit is not on origin (`readLocal`/`writeLocal`: `<id>.local.json`).
// Write & Review runs started from an issue (`enrich` on the linked run) never move its column; their
// accepted document can be saved back to the issue (`saveRunToIssue`: replace the description or comment).
// An issue-tracker run whose owner chose "create and plan" is chained to the roadmap (#134, #446): the service
// (packages/engine/service/areas/chain.js) syncs the backlog and plans its `issues` output when the run ends.
// Each sync also reads the epics (#138, packages/engine/domains/backlog/epics.js readEpics): `issue.epic` and the cache's `epics`.
// The platform is the source of truth (#168): roadmap items keep a read-only copy of their
// issues, refreshed by each sync (`refreshCopies`) and read again right before a run starts
// (`freshIssues`, with the cache as a recorded fallback when the platform cannot be read).
// Archive (#238): `archiveIssues` closes issues as not planned with the `archived` label (guards:
// packages/shared/backlog-archive.js), `restoreIssues` reopens them.
// The platform CLI helpers and the issue copies live in packages/engine/domains/backlog/issues.js (re-exported here, #345).
// #35: a project with no repository has a local backlog (local-backlog.js): readBacklog joins its issues, syncBacklog
// answers it without a CLI, projectBacklog never answers null for such a project.
// Screen: fronts/build/views/backlog/backlog.js; channels: packages/engine/service/channels/backlog.js.

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { readEpics } = require('./epics');
const localIssues = require('./local-backlog');
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
const { refreshCopies } = require('../roadmap/roadmap');
const TimeZone = require('../analytics/time-zone');
const { ARCHIVED_LABEL, archiveBlockReason } = require('@craftorio/shared/backlog-archive');
const { namesOf } = require('@craftorio/shared/default-workflow');
const { LIVE_ITEM_STATES } = require('@craftorio/shared/roadmap-model');
const { projectPlatform } = require('@craftorio/shared/platforms');
const { resolveRunInputs } = require('../project/project-run-defaults');

// the workflows that enrich an issue's text and do not implement it: write-doc, and Write & Review's
// old runs (#648: writer-reviewer became an alias of write-doc)
const ENRICH_WORKFLOWS = ['write-doc', 'writer-reviewer'];
// the issue workflow (#81, #648: issue-tracker's old runs too) files issues, it does not implement them:
// its runs never link to an issue they mention (e.g. "related to #41"); its "create and plan" choice
// queues the issues it filed
const ISSUE_WORKFLOWS = namesOf('issue.yaml');

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

/** #745: the platform a project syncs with: its own (projectPlatform), else `fallback`, else GitHub. */
const platformOf = (project, fallback = null) => projectPlatform(project)?.id || fallback || DEFAULT_PLATFORM;

// The synced cache alone (what a write to it starts from), or null.
function readCache(dir, projectId) {
  try { return JSON.parse(fs.readFileSync(cacheFile(dir, projectId), 'utf8')); } catch { return null; }
}

/**
 * The last sync of a project, or null. #35: with the local backlog's issues (local-backlog.js) after the synced
 * ones; a project with local issues and no sync (no repository, or one added later) answers its local backlog.
 */
function readBacklog(dir, projectId) {
  const cache = readCache(dir, projectId);
  const own = localIssues.readLocalIssues(dir, projectId);
  if (!own) return cache;
  if (!cache) return localIssues.localBacklog(projectId, own);
  return { ...cache, issues: [...(cache.issues || []), ...own] };
}

/** #35: readBacklog, or an empty local backlog for a project with no repository (never null for one). */
function projectBacklog(dir, project) {
  if (!project) return null;
  return readBacklog(dir, project.id) || (project.repo ? null : localIssues.localBacklog(project.id));
}

/**
 * Fetches the project's issues and caches them.
 * #781: onProgress({ what: 'issues', read, total }): what is read so far (total null until known), with read === total
 * at the end. `followed`: a screen shows the count, so the list is read in steps and the count grows (issues.js
 * fetchIssues); the steps read more, so any other sync keeps the single read.
 * #845: a repository with Issues turned off resolves with no issues and `issuesDisabled: true` (cached too).
 * @param {{ dir: string, project: { id: string, repo?: string }, platform: string, exec?: Function, onProgress?: Function, followed?: boolean }} opts
 */
async function syncBacklog({ dir, project, platform: asked, exec, onProgress, followed = false }) {
  // #35: a project with no repository has its local backlog, nothing to read from a platform
  if (!project.repo) return projectBacklog(dir, project);
  // #745: the project's platform (its host, or the one stored on it) wins over the one asked
  const platform = platformOf(project, asked);
  // the issues are what the screen needs: PRs that cannot be read leave a note, not an error
  let pullRequestsError = null;
  // #845: a repository with Issues turned off syncs with no issues and says so (issuesDisabled), not a failed read
  let issuesDisabled = false;
  onProgress?.({ what: 'issues', read: 0, total: null });
  const [fetched, prs] = await Promise.all([
    fetchIssues({ platform, repo: project.repo, exec, onProgress: followed ? onProgress : undefined })
      .catch((e) => {
        if (!e.issuesDisabled) throw e;
        issuesDisabled = true;
        return [];
      })
      .then((issues) => {
        onProgress?.({ what: 'issues', read: issues.length, total: issues.length });
        return issues;
      }),
    fetchOpenPullRequests({ platform, repo: project.repo, exec }).catch((e) => { pullRequestsError = e.message; return []; }),
  ]);
  // epics, like the PRs, never fail the sync: an error leaves a note (epicsError)
  const { issues, epics, epicsError } = await readEpics({ platform, repo: project.repo, issues: attachPullRequests(fetched, prs), exec });
  issues.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
  const data = { projectId: project.id, platform, repo: project.repo, syncedAt: new Date().toISOString(), pullRequestsError, issues, epics, epicsError, ...(issuesDisabled ? { issuesDisabled } : {}) };
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(cacheFile(dir, project.id), JSON.stringify(data, null, 2));
  // the planned items not started yet show (and the Product Owner reads) the current text (#168);
  // a plan that cannot be written leaves the sync done
  try {
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

// Kanban column from the issue state, its latest real run and the project's
// local commits not pushed yet (localStatus in packages/engine/domains/local/local-push.js). Done = closed on the platform,
// only: an open issue whose run succeeded (a PR not merged yet, a push the platform hasn't seen)
// stays in progress until a sync reports it closed.
function columnOf(issue, latest, local) {
  if (issue.state === 'closed') return 'done';
  if (!latest) return 'todo';
  if (latest.waiting) return 'waiting';
  if (latest.status === 'success') return notPushed(issue, latest, local) ? 'local' : 'in_progress';
  if (latest.status === 'cancelled') return 'todo';
  return 'in_progress'; // running, failed, interrupted
}

/**
 * Adds to each issue the project's runs that work on it (newest first) and its column: todo |
 * in_progress | waiting (a run stopped at a human gate) | local (merged into the local base, not
 * pushed yet) | done.
 * @param {object[]} issues from fetchIssues
 * @param {{ runId, workflow, status, startedAt, mock?, waiting?, issue?, task?, inputs?, localMerge?, recovery? }[]} runs the project's runs
 * @param {{ commits: { sha }[], issues: number[], error? } | null} local the project's commits not pushed (readLocal)
 */
function linkRuns(issues, runs, local = null) {
  const sorted = [...runs].sort((a, b) => String(b.startedAt).localeCompare(String(a.startedAt)));
  return issues.map((issue) => {
    const linked = sorted.filter((r) => startedFor(r, issue) || (!r.mock && !ISSUE_WORKFLOWS.includes(r.workflow) &&!runIssues(r).length && mentions(r, issue)))
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
          ...(ENRICH_WORKFLOWS.includes(r.workflow) ? { enrich: true } : {}),
        };
      });
    // simulations stay in the issue's history but never decide its column
    return { ...issue, runs: linked, column: columnOf(issue, linked.find((r) => !r.mock && !r.enrich), local) };
  });
}

// ---- local commits not pushed ----------------------------------------------------------------
// The last localStatus (packages/engine/domains/local/local-push.js) of a project, in <workspace>/backlog/<project id>.local.json:
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

/**
 * #568: the CLI call that comments `text` on pull/merge request `number` (gh reads it from `file`, glab
 * takes it as an argument): { cli, args, display }.
 */
function prCommentCommand({ platform, repo, number, file, text }) {
  const target = cliTarget(platform, repo);
  const c = adapterOf(platform).prCommentCommand({ target, n: String(Number(number)), file, text });
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
  const data = readCache(dir, projectId);
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
  const issue = dir && projectId ? readCache(dir, projectId)?.issues?.find((i) => i.number === number) : null;
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
// Roadmap items keep a read-only copy of their issues (issueFields) for the screen and the
// Product Owner: every sync brings the copies of the items not started yet up to date
// (roadmap.refreshCopies), and right before a run starts its issues are read
// again from the platform (freshIssues). Nothing here writes to the platform.

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

// "Issue: <url>" before an issue's body; #35: a local issue has no URL, so no line
const issueLine = (i) => (i.url ? `Issue: ${i.url}\n\n` : '');

// The task of a group: every issue (title, URL and body) in the order selected, shipped together.
function groupTask(issues) {
  const refs = issues.map((i) => `#${i.number}`).join(', ');
  return [
    `Implement these ${issues.length} issues together (${refs}).`,
    'They ship together in one branch and one PR/MR that closes every one of them. Account for each issue: '
      + 'say what was done for each one, and if one cannot be done, say which and why (never drop it silently).',
    ...issues.map((i, n) => `## ${n + 1}. #${i.number} ${i.title}\n\n${issueLine(i)}${i.body || ''}`.trim()),
  ].join('\n\n');
}

/**
 * The inputs of a run started for a queued item: the saved inputs, the task (issue title, URL and
 * body; every issue of a group, see groupTask), the project folder in the path inputs left empty,
 * `issue` (the first issue's URL) and `issues` (every URL, in order) when the workflow has them.
 * #735: the item's saved inputs over the project's run defaults (`projectDefaults`, packages/engine/
 * domains/project/project-run-defaults.js), over the workflow's defaults. #785: a blank string an old
 * item saved hides neither of them.
 * @param {{ inputs: object }} wf the workflow (its input definitions)
 */
function runInputs(item, wf, folder, projectDefaults = null) {
  const defs = wf.inputs || {};
  const inputs = { ...item.inputs };
  if (projectDefaults) {
    // the workflow's own defaults stay the engine's to fill (setup.js resolveInputs)
    const { values, sources } = resolveRunInputs({ roadmap: item.inputs, project: projectDefaults, workflow: wf });
    for (const [k, v] of Object.entries(values)) {
      if (sources[k] === 'project') inputs[k] = v;
      else if (sources[k] === 'workflow') delete inputs[k];
    }
  }
  const issues = itemIssues(item);
  if (defs.task) inputs.task = issues.length > 1 ? groupTask(issues) : `${item.title}\n\n${issueLine(item)}${item.body || ''}`.trim();
  for (const [k, def] of Object.entries(defs)) {
    if (k !== 'task' && (def.type || 'string') === 'string' && /path|dir/i.test(k) && !inputs[k] && folder) inputs[k] = folder;
  }
  if (defs.issue && item.url) inputs.issue = item.url;
  if (defs.issues) inputs.issues = issues.map((i) => i.url).filter(Boolean);
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
  'mergedCommit',
  'pause',
  'pr',
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
    if (!LIVE_ITEM_STATES.has(x.status)) return {};
    // #615: a live run's cost so far, so the card's cost meter follows it without a full read
    const cost = typeof x.actualUsd === 'number' ? { actualUsd: x.actualUsd } : {};
    if (!x.run) return cost;
    const { status, mock, startedAt, finishedAt, waiting, gate, atGate, progress, error, mergedCommit } = x.run;
    // #614: a run that merged while live (a parked item's) shows its Merge station done
    return { ...cost, run: { status, mock, startedAt, finishedAt, waiting, gate, atGate, progress, error, ...(mergedCommit ? { mergedCommit } : {}) } };
  };
  const item = (x) => ({
    id: x.id, status: x.status || null, runId: x.runId || null, runs: x.runs || [], waiting: !!x.waiting,
    startedAt: x.run?.startedAt || null, elapsed: x.run?.startedAt ? (Date.parse(x.run.finishedAt) || Date.now()) - Date.parse(x.run.startedAt) : null,
    ...runOf(x),
    // #797: the PR the item waits for, also once its read changes
    ...(x.pr ? { pr: x.pr } : {}),
  });
  return {
    projectId: data.projectId,
    roadmap: {
      state: r.state || null, updatedAt: r.updatedAt || null, scope: r.scope || null, pausedBy: r.pausedBy || null, error: r.error || null,
      shape: r.shape || stagesShape(r.stages),
      stages: (r.stages || []).map((s) => ({ id: s.id, pause: s.pause || null, items: (s.items || []).map(item) })),
    },
    refresh: data.refresh || null,
    baseCheck: data.baseCheck || null,
  };
}

module.exports = {
  PLATFORMS, DEFAULT_PLATFORM, parseRepoUrl, platformOf, platformOfHost, taskProgress, fetchIssues, readBacklog, syncBacklog, linkRuns,
  referencedIssues, fetchOpenPullRequests, attachPullRequests,
  runInputs,
  itemIssues, runIssues, execCli, readLocal, writeLocal,
  archiveIssues,
  backlogState,
  cliTarget,
  fetchIssue,
  freshIssues,
  issueAppendBody,
  issueCloseCommand,
  issueCreateCommand,
  issueSaveBody,
  issueSaveCommand,
  localCreateCommand: localIssues.localCreateCommand,
  localSaveCommand: localIssues.localSaveCommand,
  prCommentCommand,
  projectBacklog,
  readIssueSaves,
  recordedIssues,
  repoLabels,
  restoreIssues,
  saveRunToIssue,
  stagesShape,
  updateCachedIssue,
  withSyncedText,
};
