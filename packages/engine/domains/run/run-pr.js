// A run's pull/merge request and display title (#84), for the run lists, the sidebar, the Run
// screen, the run chat and the Backlog cards.
//
// - The PR comes from the latest step output with `pr_url` / `pr_number` (e.g. the `ci` step); a
//   resumed run without one of its own shows the PR of the run it resumes (the chain).
// - Its state is read with `gh pr view` / `glab mr view` (no LLM) and mapped to what the lists
//   show: pending | ready | failing | conflict | draft | merged | closed | open (| unknown when it
//   cannot be read). The service caches it (`prCache`) and refreshes the runs in progress.
// - The title the owner gives a run lives in runs/<id>/meta.json ({ title }), never in
//   events.jsonl. Without one, the default title is the issue ("#12 Title") or the task's first line.

const fs = require('fs');
const path = require('path');
const { GL_FAILED, ghCheckBucket, ghPrState, glMrState, parseTarget } = require('../../engine/probes');
const { resolveCommand } = require('../../engine/providers');
const { execShim } = require('../machine/shell');
const github = require('@multiagent/shared/platforms/github');
const gitlab = require('@multiagent/shared/platforms/gitlab');
const { parseRepoUrl, projectPlatform, resolvePlatform } = require('@multiagent/shared/platforms');

// ---- the PR of a run ---------------------------------------------------------------------------
// One step output → { number, url } or null.
function prOfOutput(output) {
  if (!output || typeof output !== 'object') return null;
  const url = typeof output.pr_url === 'string' && /^https?:\/\//.test(output.pr_url) ? output.pr_url : null;
  const n = Number(output.pr_number);
  const number = Number.isInteger(n) && n > 0 ? n : url ? parseTarget(url)?.id ?? null : null;
  return url || number ? { number, url } : null;
}

// The latest step output with a PR, in a run's events → { number, url } or null.
function prOfEvents(events) {
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i];
    if (e.type !== 'step.finished') continue;
    const pr = prOfOutput(e.output);
    if (pr) return pr;
  }
  return null;
}

// ---- the PR state ----------------------------------------------------------------------------
const PR_STATES = ['closed', 'conflict', 'draft', 'failing', 'merged', 'open', 'pending', 'ready', 'unknown'];

// `gh pr view --json state,isDraft,mergeable,mergeStateStatus,statusCheckRollup` → { state, detail }
function ghPrDisplay(pr) {
  const s = ghPrState(pr);
  // #797: a merged PR's commit is what its roadmap item keeps
  if (s.state === 'merged') return { state: s.state, detail: s.detail, ...(pr.mergeCommit?.oid ? { mergedCommit: pr.mergeCommit.oid } : {}) };
  if (s.state === 'closed') return { state: s.state, detail: s.detail };
  if (pr.isDraft) return { state: 'draft', detail: 'draft PR' };
  if (s.state === 'conflict') return { state: 'conflict', detail: s.detail };
  if (s.state === 'failed') return { state: 'failing', detail: s.detail };
  if (s.state === 'pending') return { state: 'pending', detail: s.detail };
  if (pr.mergeable === 'MERGEABLE' && String(pr.mergeStateStatus || '').toUpperCase() === 'CLEAN') return { state: 'ready', detail: `ready to merge (${s.detail})` };
  return { state: 'open', detail: `open, ${s.detail}${pr.mergeStateStatus ? ` (${String(pr.mergeStateStatus).toLowerCase()})` : ''}` };
}

// `glab mr view <iid> --output json` → { state, detail }
function glMrDisplay(mr) {
  const s = glMrState(mr);
  // #797: a squashed MR has no merge commit of its own: its squash commit is what landed
  const commit = mr.merge_commit_sha || mr.squash_commit_sha;
  if (s.state === 'merged') return { state: s.state, detail: s.detail, ...(commit ? { mergedCommit: commit } : {}) };
  if (s.state === 'closed') return { state: s.state, detail: s.detail };
  if (mr.draft || mr.work_in_progress) return { state: 'draft', detail: 'draft MR' };
  if (s.state === 'conflict') return { state: 'conflict', detail: s.detail };
  if (s.state === 'failed') return { state: 'failing', detail: s.detail };
  if (s.state === 'pending') return { state: 'pending', detail: s.detail };
  // detailed_merge_status (GitLab 15.6+), merge_status before it
  const ms = mr.detailed_merge_status || mr.merge_status;
  if (['passed', 'none'].includes(s.state) && ['mergeable', 'can_be_merged'].includes(ms)) return { state: 'ready', detail: `ready to merge (${s.detail})` };
  return { state: 'open', detail: `open, ${s.detail}` };
}

// gh pr view's --json fields (glab mr view returns its whole JSON)
const REQUEST_FIELDS = 'state,isDraft,mergeable,mergeStateStatus,statusCheckRollup,mergeCommit';
// a request's JSON → { state, detail }, per platform
const DISPLAY = { [github.id]: ghPrDisplay, [gitlab.id]: glMrDisplay };

function readJson(cmd, args) {
  const { file } = resolveCommand(cmd) || {};
  if (!file) return Promise.reject(new Error(`${cmd} is not installed`));
  return new Promise((resolve, reject) => {
    execShim(file, args, { timeout: 30000, windowsHide: true, maxBuffer: 8 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) return reject(new Error(`${cmd}: ${String(stderr || err.message).trim().slice(0, 300)}`));
      try { resolve(JSON.parse(String(stdout).replace(/^﻿/, ''))); } catch { reject(new Error(`${cmd}: the output is not JSON`)); }
    });
  });
}

// { url } → { state, detail } read from GitHub/GitLab; `reader(cmd, args)` replaces the CLI call (tests).
async function fetchPrState(pr, { reader = readJson } = {}) {
  const t = parseTarget(pr?.url);
  if (!t || t.kind !== 'pr') return { state: 'unknown', detail: 'not a pull/merge request URL' };
  const p = resolvePlatform(t.platform);
  const c = p.requestViewCommand(t, REQUEST_FIELDS);
  return DISPLAY[p.id](await reader(c.cli, c.args));
}

// ---- the PR monitor's card (#809) -----------------------------------------------------------------
// What the pr_monitor step shows of a PR/MR, read with no LLM: { state (as fetchPrState), detail,
// ci: { status: passed | failed | running | none (no CI on PRs), failed: [jobs] },
// review: { status: approved | changes_requested | required (approvals missing) | none, by: [logins] },
// conflicts: { status: none | base }, comments: { unanswered }, result: { ready, blockers: [what blocks the merge] } }.
// A merged or closed PR/MR is only its state. A failed read rejects: the monitor keeps its last card.
const MONITOR_FIELDS = `${REQUEST_FIELDS},reviewDecision,latestReviews,comments,reviews,headRefOid`;
const THREADS_QUERY = 'query($owner:String!,$name:String!,$n:Int!){repository(owner:$owner,name:$name){pullRequest(number:$n){reviewThreads(first:100){nodes{isResolved}}}}}';

async function fetchPrMonitor(pr, { reader = readJson } = {}) {
  const t = parseTarget(pr?.url);
  if (!t || t.kind !== 'pr') throw new Error(`${JSON.stringify(String(pr?.url ?? ''))} is not a pull/merge request URL`);
  const p = resolvePlatform(t.platform);
  const c = p.requestViewCommand(t, MONITOR_FIELDS);
  const raw = await reader(c.cli, c.args);
  const shown = DISPLAY[p.id](raw);
  if (prEnded(shown.state)) return { state: shown.state, detail: shown.detail };
  const card = await (p.id === gitlab.id ? glMonitor(raw, t, reader) : ghMonitor(raw, t, reader));
  return { state: shown.state, detail: shown.detail, ...card, result: monitorResult(shown, card) };
}

// GitHub: the checks, the review decision with its latest reviews, the unresolved review threads
async function ghMonitor(pr, t, reader) {
  const checks = (pr.statusCheckRollup || []).map((c) => ({ name: c.name || c.context || '?', bucket: ghCheckBucket(c) }));
  const failed = checks.filter((c) => c.bucket === 'fail').map((c) => c.name);
  const ci = { status: !checks.length ? 'none' : failed.length ? 'failed' : checks.some((c) => c.bucket === 'pending') ? 'running' : 'passed', failed };
  const by = (state) => (pr.latestReviews || []).filter((r) => r.state === state).map((r) => r.author?.login).filter(Boolean);
  const decision = String(pr.reviewDecision || '').toUpperCase();
  const review = decision === 'CHANGES_REQUESTED' ? { status: 'changes_requested', by: by('CHANGES_REQUESTED') }
    : decision === 'REVIEW_REQUIRED' ? { status: 'required', by: [] }
      : decision === 'APPROVED' || by('APPROVED').length ? { status: 'approved', by: by('APPROVED') } : { status: 'none', by: [] };
  const conflicts = { status: pr.mergeable === 'CONFLICTING' || pr.mergeStateStatus === 'DIRTY' ? 'base' : 'none' };
  const [owner, name] = t.repo.split('/');
  const threads = await reader('gh', ['api', 'graphql', ...github.apiHostArgs({ host: t.host }), '-f', `query=${THREADS_QUERY}`, '-f', `owner=${owner}`, '-f', `name=${name}`, '-F', `n=${t.id}`])
    .then((r) => r?.data?.repository?.pullRequest?.reviewThreads?.nodes, () => null);
  // no thread list (a token without the scope, a reader standing in for gh): the PR's comments
  const unanswered = Array.isArray(threads) ? threads.filter((n) => !n.isResolved).length : (pr.comments || []).length;
  return { ci, review, conflicts, comments: { unanswered } };
}

// GitLab: the head pipeline (its failed jobs), approvals and reviewers, the unresolved discussions
async function glMonitor(mr, t, reader) {
  const api = (route) => reader('glab', ['api', `projects/${mr.project_id}/${route}`, ...gitlab.apiHostArgs({ host: t.host })]);
  const mrApi = (what) => api(`merge_requests/${mr.iid ?? t.id}/${what}`);
  const pipeline = mr.head_pipeline || mr.pipeline || null;
  const ps = String(pipeline?.status || '').toLowerCase();
  const [approvals, reviewers, discussions, jobs] = await Promise.all([
    mrApi('approvals'), mrApi('reviewers'), mrApi('discussions'),
    GL_FAILED.includes(ps) && pipeline?.id ? api(`pipelines/${pipeline.id}/jobs`) : [],
  ]);
  const failed = (jobs || []).filter((j) => GL_FAILED.includes(String(j.status || '').toLowerCase())).map((j) => j.name);
  const ci = { status: !pipeline ? 'none' : GL_FAILED.includes(ps) ? 'failed' : ['success', 'skipped'].includes(ps) ? 'passed' : 'running', failed };
  const changesBy = (reviewers || []).filter((r) => r.state === 'requested_changes').map((r) => r.user?.username).filter(Boolean);
  const approvedBy = (approvals?.approved_by || []).map((a) => a.user?.username).filter(Boolean);
  const review = changesBy.length ? { status: 'changes_requested', by: changesBy }
    : approvals?.approvals_left > 0 || approvals?.approved === false ? { status: 'required', by: [] }
      : approvedBy.length ? { status: 'approved', by: approvedBy } : { status: 'none', by: [] };
  const conflicts = { status: mr.has_conflicts || mr.detailed_merge_status === 'conflict' ? 'base' : 'none' };
  const unanswered = (discussions || []).filter((d) => (d.notes || []).some((n) => n.resolvable && !n.resolved)).length;
  return { ci, review, conflicts, comments: { unanswered } };
}

// What blocks the merge (English, the engine's words) → { ready, blockers }
function monitorResult(shown, { ci, review, conflicts, comments }) {
  const blockers = [];
  if (shown.state === 'draft') blockers.push('draft');
  if (ci.status === 'failed') blockers.push(`CI failed${ci.failed.length ? ` (${ci.failed.join(', ')})` : ''}`);
  if (ci.status === 'running') blockers.push('CI running');
  if (review.status === 'changes_requested') blockers.push(`changes requested${review.by.length ? ` by ${review.by.join(', ')}` : ''}`);
  if (review.status === 'required') blockers.push('approvals missing');
  if (conflicts.status === 'base') blockers.push('conflict with the base');
  if (comments.unanswered) blockers.push(`${comments.unanswered} unanswered comment${comments.unanswered > 1 ? 's' : ''}`);
  if (!blockers.length && shown.state !== 'ready') blockers.push(shown.detail);
  return { ready: !blockers.length, blockers };
}

// #797: a PR a run's output names by its number only → with its URL, on the project's upstream when it
// works on a fork (#738: the PR lives there), else on its repository; as it was when neither is known
function prOnProject(pr, project) {
  if (pr?.url || !pr?.number) return pr;
  const at = parseRepoUrl(project?.fork?.upstream || project?.repo);
  const platform = projectPlatform(project);
  return at && platform ? { ...pr, url: platform.requestUrl(`https://${at.host}/${at.path}`, pr.number) } : pr;
}

// A PR with what was read of it (`mergedCommit`, #797: only a merged one has it)
const withRead = (pr, { state, detail, checkedAt, mergedCommit }) => ({ ...pr, state, detail, checkedAt, ...(mergedCommit ? { mergedCommit } : {}) });

// Whether a PR's state is its last: a merged or closed PR does not change any more
const prEnded = (state) => ['closed', 'merged'].includes(state);

// PR states by URL, with the time they were read. An ended PR (prEnded) is not read again;
// the others are read again after `ttlMs` (finished runs: on demand, when shown).
function prCache({ reader, ttlMs = 5 * 60 * 1000, now = Date.now } = {}) {
  const byUrl = new Map(); // url → { state, detail, mergedCommit?, checkedAt, at }
  const pending = new Map(); // url → promise
  const fresh = (hit, maxAgeMs) => hit && (prEnded(hit.state) || now() - hit.at < maxAgeMs);
  return {
    get: (url) => byUrl.get(url) || null,
    // { number, url } → the PR with { state, detail, checkedAt }; maxAgeMs: 0 reads it again
    async refresh(pr, { maxAgeMs = ttlMs } = {}) {
      if (!pr?.url) return pr;
      const hit = byUrl.get(pr.url);
      if (fresh(hit, maxAgeMs)) return withRead(pr, hit);
      if (!pending.has(pr.url)) {
        pending.set(pr.url, fetchPrState(pr, { reader })
          .catch((e) => ({ state: 'unknown', detail: `could not read the PR: ${e.message}` }))
          .then((s) => {
            const at = now();
            byUrl.set(pr.url, { ...s, at, checkedAt: new Date(at).toISOString() });
            return byUrl.get(pr.url);
          })
          .finally(() => pending.delete(pr.url)));
      }
      return withRead(pr, await pending.get(pr.url));
    },
  };
}

// ---- the run's title ---------------------------------------------------------------------------
function readMeta(runDir) {
  try { return JSON.parse(fs.readFileSync(path.join(runDir, 'meta.json'), 'utf8')) || {}; } catch { return {}; }
}

// Sets (or, with an empty title, clears) the owner's title of a run. Returns the meta.
function writeTitle(runDir, title) {
  const meta = readMeta(runDir);
  const clean = String(title ?? '').replace(/\s+/g, ' ').trim().slice(0, 200);
  if (clean) meta.title = clean;
  else delete meta.title;
  fs.writeFileSync(path.join(runDir, 'meta.json'), `${JSON.stringify(meta, null, 2)}\n`);
  return meta;
}

// The title a run shows when the owner gave it none: its issue(s), or the first line of its task.
function defaultTitle({ issues, task }) {
  if (Array.isArray(issues) && issues.length) {
    const first = issues[0];
    const head = `#${first.number}${first.title ? ` ${first.title}` : ''}`;
    return issues.length > 1 ? `${head} (+${issues.length - 1})` : head;
  }
  const line = String(task || '').split('\n').map((l) => l.trim()).find(Boolean);
  return line ? line.slice(0, 120) : null;
}

module.exports = {
  defaultTitle,
  fetchPrMonitor,
  fetchPrState,
  ghPrDisplay,
  glMrDisplay,
  PR_STATES,
  prCache,
  prEnded,
  prOfEvents,
  prOfOutput,
  prOnProject,
  readMeta,
  withRead,
  writeTitle,
};
