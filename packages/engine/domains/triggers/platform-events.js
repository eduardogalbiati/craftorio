// Platform events for the triggers (#568): what happened on a repository since a date, read with
// `gh api` (GitHub) or `glab api` (GitLab) through an injected `exec(cmd, args)` (production:
// packages/engine/domains/backlog/issues.js execCli), never a model call. Three kinds, normalised:
//   { kind: 'issue_labeled', id, url, label, issue: { number } }   a label added to an issue
//   { kind: 'pr_comment', id, url, body, pr: { number } }          a comment on a pull/merge request
//   { kind: 'ci_failed', id, url, branch }                          a failed Actions run / pipeline
// The id carries the platform's own id (`gh:labeled:<id>`), so the watcher's dedup survives a restart.
// A rate limit (the CLI's stderr says HTTP 403 or 429) rejects with code 'RATE_LIMITED': the watcher
// (triggers.js) backs off. The report back on the issue or PR is the platform adapters' (backlog.js
// issueSaveCommand / prCommentCommand, areas/triggers.js). The CLI of each reader is its platform
// adapter's (packages/shared/platforms/); readEvents picks the reader by the adapter's id (#351).

const github = require('@multiagent/shared/platforms/github');
const gitlab = require('@multiagent/shared/platforms/gitlab');

const RATE_LIMIT = /HTTP (403|429)/;
// one page per endpoint and poll (the issue events: up to MAX_PAGES, they take no `since`)
const PAGE = 50;
const MAX_PAGES = 5;

// exec with a rate limit turned into a RATE_LIMITED error; the JSON answer parsed
async function api(exec, cmd, endpoint) {
  let out;
  try {
    out = await exec(cmd, ['api', endpoint]);
  } catch (e) {
    if (RATE_LIMIT.test(String(e?.message || e))) throw Object.assign(new Error(String(e.message || e)), { code: 'RATE_LIMITED' });
    throw e;
  }
  try { return JSON.parse(String(out || 'null')); } catch { return null; }
}

const list = (v) => (Array.isArray(v) ? v : []);
// whether a platform date is at or after `since` (no since: everything)
const after = (date, since) => !since || !date || Date.parse(date) >= Date.parse(since);

// events by id, the first one kept: two endpoints never return an event twice
function unique(events) {
  const byId = new Map();
  for (const e of events) if (!byId.has(e.id)) byId.set(e.id, e);
  return [...byId.values()];
}

// GitHub's issue events take no `since` and mix every kind (closed, assigned, mentioned...), newest first:
// the pages up to the first event older than `since` (no since: the first page), MAX_PAGES at most
async function issueEventsSince(exec, base, since) {
  const out = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const items = list(await api(exec, github.cli, `${base}/issues/events?per_page=${PAGE}&page=${page}`));
    out.push(...items);
    const oldest = items[items.length - 1]?.created_at;
    if (!since || items.length < PAGE || (oldest && !after(oldest, since))) break;
  }
  return out;
}

/** GitHub: labels added to issues, comments on pull requests, failed Actions runs since `since`. */
async function readGithubEvents({ repo, since = null, exec }) {
  const base = `repos/${repo}`;
  const sinceQ = since ? `&since=${encodeURIComponent(since)}` : '';
  const issueEvents = await issueEventsSince(exec, base, since);
  const comments = list(await api(exec, github.cli, `${base}/issues/comments?per_page=${PAGE}&sort=created&direction=desc${sinceQ}`));
  const runs = await api(exec, github.cli, `${base}/actions/runs?status=failure&per_page=${PAGE}`);
  const events = [];
  for (const e of issueEvents) {
    if (e?.event !== 'labeled' || !e.label?.name || !e.issue || e.issue.pull_request || !after(e.created_at, since)) continue;
    events.push({ kind: 'issue_labeled', id: `gh:labeled:${e.id}`, url: e.issue.html_url || null, label: e.label.name, issue: { number: e.issue.number } });
  }
  for (const c of comments) {
    const pr = /\/pull\/(\d+)/.exec(String(c?.html_url || ''));
    if (!pr || !after(c.created_at, since)) continue;
    events.push({ kind: 'pr_comment', id: `gh:comment:${c.id}`, url: c.html_url, body: String(c.body || ''), pr: { number: Number(pr[1]) } });
  }
  for (const r of list(runs?.workflow_runs)) {
    if (r?.conclusion !== 'failure' || !after(r.updated_at || r.created_at, since)) continue;
    events.push({ kind: 'ci_failed', id: `gh:run:${r.id}`, url: r.html_url || null, branch: r.head_branch || null });
  }
  return unique(events);
}

/** GitLab: labels added to issues, notes on merge requests, failed pipelines since `since`. */
async function readGitlabEvents({ project, since = null, exec }) {
  const base = `projects/${encodeURIComponent(String(project))}`;
  const updated = since ? `&updated_after=${encodeURIComponent(since)}` : '';
  const events = [];
  for (const issue of list(await api(exec, 'glab', `${base}/issues?per_page=${PAGE}&order_by=updated_at${updated}`))) {
    for (const e of list(await api(exec, 'glab', `${base}/issues/${issue.iid}/resource_label_events?per_page=${PAGE}`))) {
      if (e?.action !== 'add' || !e.label?.name || (e.resource_id != null && e.resource_id !== issue.id) || !after(e.created_at, since)) continue;
      events.push({ kind: 'issue_labeled', id: `gl:label:${e.id}`, url: issue.web_url || null, label: e.label.name, issue: { number: issue.iid } });
    }
  }
  for (const mr of list(await api(exec, 'glab', `${base}/merge_requests?per_page=${PAGE}&order_by=updated_at${updated}`))) {
    for (const n of list(await api(exec, 'glab', `${base}/merge_requests/${mr.iid}/notes?per_page=${PAGE}&sort=desc`))) {
      if (!n || n.system || !after(n.created_at, since)) continue;
      events.push({ kind: 'pr_comment', id: `gl:note:${n.id}`, url: mr.web_url ? `${mr.web_url}#note_${n.id}` : null, body: String(n.body || ''), pr: { number: mr.iid } });
    }
  }
  for (const p of list(await api(exec, 'glab', `${base}/pipelines?status=failed&per_page=${PAGE}${updated}`))) {
    if (p?.status !== 'failed' || !after(p.updated_at || p.created_at, since)) continue;
    events.push({ kind: 'ci_failed', id: `gl:pipeline:${p.id}`, url: p.web_url || null, branch: p.ref || null });
  }
  return unique(events);
}

// the reader of each platform, by its adapter's id
const READERS = {
  [github.id]: ({ repo, since, exec }) => readGithubEvents({ repo, since, exec }),
  [gitlab.id]: ({ repo, since, exec }) => readGitlabEvents({ project: repo, since, exec }),
};

/** The events of `repo` (its path on the platform) on the platform with the adapter id `platform` (default: GitHub's). */
function readEvents({ platform, repo, since = null, exec }) {
  return (READERS[platform] || READERS[github.id])({ repo, since, exec });
}

module.exports = {
  readEvents,
  readGithubEvents,
  readGitlabEvents,
};
