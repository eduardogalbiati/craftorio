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
const { ghPrState, glMrState, parseTarget } = require('../../engine/probes');
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
