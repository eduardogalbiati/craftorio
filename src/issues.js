// Issues as the git platform gives them (#345: moved down from src/backlog.js so src/epics.js and
// src/roadmap.js no longer require the backlog, which requires them; src/backlog.js re-exports all).
// - PLATFORMS, parseRepoUrl, platformOfHost, cliTarget: a repository URL read for gh (GitHub) / glab (GitLab);
// - execCli: runs a platform CLI; fetchIssues / fetchIssue: the issues, normalized (taskProgress);
// - issueCreateCommand, repoLabels: filing an issue (the Product Owner's Create, the epics);
// - issueFields, itemIssues, withSyncedText: the read-only copies queue and roadmap items keep (#168).

const { resolveCommand } = require('./engine/providers');
const { execShim } = require('./shell');

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
    // a group epic (GitLab paid tiers): read by src/epics.js, not kept in the cache
    ...(i.epic?.iid ? { groupEpic: { iid: i.epic.iid, title: i.epic.title || null, groupId: i.epic.group_id ?? null, url: i.epic.web_url || i.epic.url || null } } : {}),
  }));
}

// Runs a platform CLI and resolves with its stdout.
function execCli(cli, args) {
  const r = resolveCommand(cli);
  if (!r) return Promise.reject(new Error(`The ${cli} CLI is not installed (see Settings › Agents & CLIs).`));
  return new Promise((resolve, reject) => {
    execShim(r.file, args, { windowsHide: true, timeout: 60000, maxBuffer: 32 * 1024 * 1024 }, (err, stdout, stderr) => {
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

// The --repo value of gh/glab for a repository URL (same rules as fetchIssues).
function cliTarget(platform, repo) {
  const p = PLATFORMS[platform];
  if (!p?.cli) throw new Error(`Saving to an issue needs GitHub or GitLab (the backlog's platform is ${p?.label || platform || 'not set'}).`);
  const parsed = parseRepoUrl(repo);
  if (!parsed) throw new Error(`The project's repository is not a recognizable git URL: ${repo || '(none)'}`);
  if (platform === 'github') return parsed.host === 'github.com' ? parsed.path : `${parsed.host}/${parsed.path}`;
  return parsed.host === 'gitlab.com' ? parsed.path : `https://${parsed.host}/${parsed.path}`;
}

/**
 * The CLI call that files a new issue (the Product Owner's Create, #117): gh reads the body from
 * `file` (--body-file), glab takes it as an argument. { cli, args, display }.
 */
function issueCreateCommand({ platform, repo, title, labels = [], file, text }) {
  const target = cliTarget(platform, repo);
  const t = String(title || '').trim();
  if (!t) throw new Error('The issue has no title.');
  let cli;
  let args;
  if (platform === 'github') {
    cli = 'gh';
    args = ['issue', 'create', '--repo', target, '--title', t, '--body-file', file, ...labels.flatMap((l) => ['--label', l])];
  } else {
    cli = 'glab';
    args = ['issue', 'create', '--repo', target, '--title', t, '--description', text, ...(labels.length ? ['--label', labels.join(',')] : []), '--yes'];
  }
  const shown = args.map((a) => (a === text ? '<document>' : /\s/.test(a) ? `"${a}"` : a));
  return { cli, args, display: `${cli} ${shown.join(' ')}` };
}

/** The repository's label names (GitHub), or null when unknown (GitLab creates missing labels itself). */
async function repoLabels({ platform, repo, exec = execCli }) {
  if (platform !== 'github') return null;
  const out = await exec('gh', ['label', 'list', '--repo', cliTarget(platform, repo), '--limit', '500', '--json', 'name']);
  return JSON.parse(out || '[]').map((l) => l.name);
}

/** One issue, read again from the platform (same shape as fetchIssues). */
async function fetchIssue({ platform, repo, number, exec = execCli }) {
  const target = cliTarget(platform, repo);
  const n = String(Number(number));
  if (platform === 'github') {
    const out = await exec('gh', ['issue', 'view', n, '--repo', target, '--json', 'number,title,state,labels,url,author,assignees,body,createdAt,updatedAt']);
    return normalizeGithub([JSON.parse(out)])[0];
  }
  const out = await exec('glab', ['issue', 'view', n, '--repo', target, '--output', 'json']);
  return normalizeGitlab([JSON.parse(out)])[0];
}

// An item's copy of an issue (#168: read-only, refreshed by each sync and right before its run starts)
const issueFields = (i) => ({
  number: i.number, url: i.url, title: i.title, body: i.body || '', labels: i.labels || [], updatedAt: i.updatedAt || null,
  knownPullRequests: i.knownPullRequests || [],
});
/** The issues of a queue item: its `issues` (a group), or the item itself. */
const itemIssues = (item) => (Array.isArray(item.issues) && item.issues.length ? item.issues : [issueFields(item)]);

/** A copy of an issue with the text of `synced` (title, body, labels, updatedAt), or the copy when there is none. */
function withSyncedText(copy, synced) {
  if (!synced) return copy;
  return { ...copy, url: synced.url || copy.url, title: synced.title, body: synced.body || '', labels: synced.labels || [], updatedAt: synced.updatedAt || null };
}

module.exports = {
  cliTarget,
  DEFAULT_PLATFORM,
  execCli,
  fetchIssue,
  fetchIssues,
  issueCreateCommand,
  issueFields,
  itemIssues,
  MAX_ISSUES,
  parseRepoUrl,
  platformOfHost,
  PLATFORMS,
  repoLabels,
  taskProgress,
  withSyncedText,
};
