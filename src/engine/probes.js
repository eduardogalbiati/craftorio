// Deterministic checks the engine runs between the turns of a `/loop` step (`wait:` in the YAML),
// so an agent is not called (and paid) only to ask GitHub/GitLab whether CI finished.
//
// A probe reads the state of a pull/merge request or a CI run with `gh` / `glab` and returns
// { state, detail, fingerprint? }:
//   pr_checks     pending | none (no check registered) | passed | failed | conflict | merged | closed
//                 | quota_exhausted (GitHub Actions minutes ran out: no check will start this month)
//   pr_changes    open | merged | closed, with a fingerprint of what the agent reacts to (head commit,
//                 mergeability, review decision, comments and reviews, check results)
//   workflow_run  pending | passed | failed
//   pr_mergeable  passed (open, no conflict, checks green or none) | conflict | failed | pending
//                 | blocked (branch protection: a required review or check) | behind | merged | closed:
//                 the check right before a merge (`check:` on a gate, `precheck:` on a transition)
// The engine decides what each state means (poll again, finish the step, or call the agent).

const {
  homebrewInstalled,
  resolveCommand,
} = require('./providers');
const { installHint } = require('../install-commands');
const { execShim } = require('../shell');
const github = require('../shared/platforms/github');
const gitlab = require('../shared/platforms/gitlab');
const { PLATFORMS, findPlatform, resolvePlatform } = require('../shared/platforms');

const PROBES = ['pr_checks', 'pr_changes', 'workflow_run', 'pr_mergeable'];

// URL (agent output) → { platform (the short id: gh | gl), host, repo, kind: 'pr' | 'run', id }, or null.
// The URL forms are the adapters' parseTargetUrl (src/shared/platforms/).
function parseTarget(url) {
  for (const p of PLATFORMS) {
    const t = p.parseTargetUrl(url);
    if (t) return { platform: p.short, ...t };
  }
  return null;
}

// ---- GitHub ------------------------------------------------------------------------------------
const GH_FAILED = ['FAILURE', 'CANCELLED', 'TIMED_OUT', 'ACTION_REQUIRED', 'STARTUP_FAILURE', 'ERROR'];
const GH_PASSED = ['SUCCESS', 'NEUTRAL', 'SKIPPED'];

// statusCheckRollup mixes check runs (status + conclusion) and commit statuses (state)
function ghCheckBucket(c) {
  if (c.__typename === 'StatusContext' || (c.state && !c.status)) {
    const s = String(c.state || '').toUpperCase();
    return GH_FAILED.includes(s) ? 'fail' : GH_PASSED.includes(s) ? 'pass' : 'pending';
  }
  if (String(c.status || '').toUpperCase() !== 'COMPLETED') return 'pending';
  const k = String(c.conclusion || '').toUpperCase();
  return GH_FAILED.includes(k) ? 'fail' : GH_PASSED.includes(k) ? 'pass' : 'pending';
}

const checkName = (c) => c.name || c.context || '?';
const countBuckets = (buckets) => buckets.reduce((a, b) => ({ ...a, [b]: (a[b] || 0) + 1 }), {});

// `gh pr view --json state,mergeable,mergeStateStatus,headRefOid,statusCheckRollup[,reviewDecision,comments,reviews]`
function ghPrState(pr) {
  const checks = (pr.statusCheckRollup || []).map((c) => ({ name: checkName(c), bucket: ghCheckBucket(c) }));
  const n = countBuckets(checks.map((c) => c.bucket));
  const fingerprint = JSON.stringify({
    head: pr.headRefOid || null, state: pr.state || null, mergeable: pr.mergeable || null, merge_state: pr.mergeStateStatus || null,
    review: pr.reviewDecision || null, comments: (pr.comments || []).length, reviews: (pr.reviews || []).length,
    checks: checks.map((c) => `${c.name}:${c.bucket}`).sort(),
  });
  const failed = checks.filter((c) => c.bucket === 'fail').map((c) => c.name);
  const s = String(pr.state || '').toUpperCase();
  let state;
  let detail;
  if (s === 'MERGED') [state, detail] = ['merged', 'the PR was merged'];
  else if (s === 'CLOSED') [state, detail] = ['closed', 'the PR was closed without merge'];
  else if (pr.mergeable === 'CONFLICTING' || pr.mergeStateStatus === 'DIRTY') [state, detail] = ['conflict', 'the PR conflicts with its base (CI will not start)'];
  else if (failed.length) [state, detail] = ['failed', `checks failed: ${failed.join(', ')}`];
  else if (!checks.length) [state, detail] = ['none', 'no check registered on the head commit yet'];
  else if (n.pending) [state, detail] = ['pending', `${n.pending} of ${checks.length} checks still running`];
  else [state, detail] = ['passed', `all ${checks.length} checks passed`];
  return { state, detail, fingerprint, head: pr.headRefOid || null };
}

// pr_mergeable: the PR/MR state (ghPrState / glMrState) plus what only blocks the merge itself.
// GitHub: mergeStateStatus BLOCKED (required review or check) / BEHIND (base protection wants it
// up to date) / UNKNOWN (GitHub is still computing it: pending). GitLab: detailed_merge_status.
function mergeableState(r, { mergeState, glStatus } = {}) {
  if (['merged', 'closed', 'conflict', 'failed', 'pending'].includes(r.state)) return { state: r.state, detail: r.detail, head: r.head };
  const ms = String(mergeState || '').toUpperCase();
  const gl = String(glStatus || '').toLowerCase();
  if (ms === 'BEHIND' || gl === 'need_rebase') return { state: 'behind', detail: 'the branch is behind its base and the base requires it up to date', head: r.head };
  if (ms === 'BLOCKED' || ['not_approved', 'discussions_not_resolved', 'blocked_status', 'requested_changes'].includes(gl)) {
    return { state: 'blocked', detail: `the merge is blocked by the base's protection (${ms || gl})`, head: r.head };
  }
  if (ms === 'UNKNOWN' || ['checking', 'unchecked', 'preparing'].includes(gl)) return { state: 'pending', detail: 'the mergeability is still being computed', head: r.head };
  return { state: 'passed', detail: r.state === 'none' ? 'mergeable, no check registered' : `mergeable, ${r.detail}`, head: r.head };
}

// `gh run view --json status,conclusion,url,name`
function ghRunState(run) {
  const name = run.name ? `${run.name}: ` : '';
  if (String(run.status || '').toLowerCase() !== 'completed') return { state: 'pending', detail: `${name}run ${String(run.status || 'queued').toLowerCase()}` };
  const k = String(run.conclusion || '').toUpperCase();
  if (GH_PASSED.includes(k)) return { state: 'passed', detail: `${name}run finished (${run.conclusion})` };
  return { state: 'failed', detail: `${name}run finished with ${run.conclusion || 'no conclusion'}` };
}

// ---- GitLab ------------------------------------------------------------------------------------
const GL_PENDING = ['created', 'waiting_for_resource', 'preparing', 'pending', 'running', 'scheduled', 'waiting_for_callback'];
const GL_FAILED = ['failed', 'canceled', 'canceling'];

// `glab mr view <iid> --output json`
function glMrState(mr) {
  const pipeline = mr.head_pipeline || mr.pipeline || null;
  const ps = String(pipeline?.status || '').toLowerCase();
  const fingerprint = JSON.stringify({
    head: mr.sha || null, state: mr.state || null, conflicts: !!mr.has_conflicts, merge_status: mr.detailed_merge_status || mr.merge_status || null,
    notes: mr.user_notes_count ?? null, discussions_resolved: mr.blocking_discussions_resolved ?? null, pipeline: ps || null,
  });
  const s = String(mr.state || '').toLowerCase();
  let state;
  let detail;
  if (s === 'merged') [state, detail] = ['merged', 'the MR was merged'];
  else if (s === 'closed') [state, detail] = ['closed', 'the MR was closed without merge'];
  else if (mr.has_conflicts || mr.detailed_merge_status === 'conflict') [state, detail] = ['conflict', 'the MR conflicts with its target branch'];
  else if (!ps) [state, detail] = ['none', 'no pipeline registered on the head commit yet'];
  else if (GL_FAILED.includes(ps)) [state, detail] = ['failed', `pipeline ${ps}`];
  else if (GL_PENDING.includes(ps)) [state, detail] = ['pending', `pipeline ${ps}`];
  else if (ps === 'success' || ps === 'skipped') [state, detail] = ['passed', `pipeline ${ps}`];
  else [state, detail] = ['unknown', `pipeline ${ps}`]; // manual: someone has to act
  return { state, detail, fingerprint, head: mr.sha || null };
}

// `glab api projects/:id/pipelines/:id`
function glPipelineState(p) {
  const ps = String(p.status || '').toLowerCase();
  if (GL_PENDING.includes(ps)) return { state: 'pending', detail: `pipeline ${ps}` };
  if (ps === 'success') return { state: 'passed', detail: 'pipeline success' };
  if (GL_FAILED.includes(ps)) return { state: 'failed', detail: `pipeline ${ps}` };
  return { state: 'unknown', detail: `pipeline ${ps || 'without status'}` };
}

// ---- running the CLIs ----------------------------------------------------------------------------
function run(cmd, args, { cwd, signal, timeout = 60000 }) {
  const resolved = resolveCommand(cmd);
  if (!resolved) {
    const hint = installHint(cmd, process.platform, { brew: homebrewInstalled() });
    return Promise.reject(new Error(`${cmd} is not installed${hint ? ` (${hint})` : ''}.`));
  }
  const { file } = resolved;
  return new Promise((resolve, reject) => {
    execShim(file, args, { cwd, signal, timeout, windowsHide: true, env: process.env, maxBuffer: 16 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) return reject(new Error(`${cmd} ${args.slice(0, 3).join(' ')}: ${String(stderr || err.message).trim().slice(0, 300)}`));
      try { resolve(JSON.parse(String(stdout).replace(/^﻿/, ''))); } catch { reject(new Error(`${cmd} ${args.slice(0, 3).join(' ')}: the output is not JSON`)); }
    });
  });
}

const GH_PR_FIELDS = 'state,mergeable,mergeStateStatus,headRefOid,statusCheckRollup';

// pr_checks on github.com with no check started, or failed checks: when the owner's Actions quota is
// exhausted (`quota(owner)` answers the message), none will run before the month resets, so the
// state becomes `quota_exhausted`. A quota that cannot be read changes nothing.
async function withQuota(result, t, quota) {
  const p = findPlatform(t.platform);
  if (!quota || !p?.actionsQuota || t.host !== p.host || !['none', 'failed'].includes(result.state)) return result;
  let message = null;
  try { message = await quota(t.repo.split('/')[0]); } catch { /* unknown quota */ }
  return message ? { ...result, state: 'quota_exhausted', detail: message } : result;
}

// { probe, target, cwd, signal, quota? } → { state, detail, fingerprint? }. Throws when the target is
// not a URL this probe can read or the CLI fails; the engine then calls the agent, as without `wait`.
async function runProbe({ probe, target, cwd, signal, quota }) {
  if (!PROBES.includes(probe)) throw new Error(`unknown probe "${probe}"`);
  const t = parseTarget(target);
  const wantsPr = probe !== 'workflow_run';
  if (!t || (t.kind === 'pr') !== wantsPr) throw new Error(`${probe}: ${JSON.stringify(String(target ?? ''))} is not a ${wantsPr ? 'pull/merge request' : 'CI run or pipeline'} URL`);
  const p = resolvePlatform(t.platform);
  const read = (c) => run(c.cli, c.args, { cwd, signal });
  if (t.kind === 'run') return RUN_STATES[p.id](await read(p.runViewCommand(t)));
  const fields = probe === 'pr_changes' ? `${GH_PR_FIELDS},reviewDecision,comments,reviews` : GH_PR_FIELDS;
  return REQUEST_PROBES[p.id](await read(p.requestViewCommand(t, fields)), { probe, t, quota });
}

// a CI run's JSON → { state, detail }, per platform
const RUN_STATES = { [github.id]: ghRunState, [gitlab.id]: glPipelineState };
// a request's JSON → the probe's result, per platform
const REQUEST_PROBES = {
  [github.id]: (pr, { probe, t, quota }) => {
    const state = ghPrState(pr);
    if (probe === 'pr_mergeable') return mergeableState(state, { mergeState: pr.mergeStateStatus });
    return probe === 'pr_checks' ? withQuota(state, t, quota) : state;
  },
  [gitlab.id]: (mr, { probe }) => (probe === 'pr_mergeable' ? mergeableState(glMrState(mr), { glStatus: mr.detailed_merge_status }) : glMrState(mr)),
};

module.exports = {
  ghPrState,
  ghRunState,
  glMrState,
  glPipelineState,
  mergeableState,
  parseTarget,
  PROBES,
  runProbe,
  withQuota,
};
