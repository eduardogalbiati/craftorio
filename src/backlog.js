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

// A run works on an issue when its task or one of its text inputs mentions the issue's URL or
// "#<number>". Simulated runs are left out (they don't touch the issue).
function mentions(run, issue) {
  const text = [run.task, ...Object.values(run.inputs || {})].filter((v) => typeof v === 'string').join('\n');
  return (!!issue.url && text.includes(issue.url)) || new RegExp(`(^|[^\\w/&])#${issue.number}(?!\\d)`).test(text);
}

/**
 * Adds to each issue the project's runs that work on it (newest first) and its column:
 * done (closed), in_progress (open with a linked run whose latest one was not cancelled) or todo.
 * @param {object[]} issues from fetchIssues
 * @param {{ runId, workflow, status, startedAt, mock?, task?, inputs? }[]} runs the project's runs
 */
function linkRuns(issues, runs) {
  const real = runs.filter((r) => !r.mock).sort((a, b) => String(b.startedAt).localeCompare(String(a.startedAt)));
  return issues.map((issue) => {
    const linked = real.filter((r) => mentions(r, issue)).map((r) => ({ runId: r.runId, workflow: r.workflow, status: r.status, startedAt: r.startedAt }));
    const column = issue.state === 'closed' ? 'done' : linked.length && linked[0].status !== 'cancelled' ? 'in_progress' : 'todo';
    return { ...issue, runs: linked, column };
  });
}

module.exports = { PLATFORMS, DEFAULT_PLATFORM, parseRepoUrl, platformOfHost, taskProgress, fetchIssues, readBacklog, syncBacklog, linkRuns };
