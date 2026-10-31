// Issues as the git platform gives them (#345: moved down from packages/engine/domains/backlog/backlog.js so packages/engine/domains/backlog/epics.js and
// packages/engine/domains/roadmap/roadmap.js no longer require the backlog, which requires them; packages/engine/domains/backlog/backlog.js re-exports all).
// - PLATFORMS, parseRepoUrl, platformOfHost, cliTarget (cliTargetOrName: an owner/name too): a repository URL read for gh (GitHub) / glab (GitLab);
// - execCli: runs a platform CLI; fetchIssues / fetchIssue: the issues, normalized (taskProgress);
// - issueCreateCommand, repoLabels: filing an issue (the Product Owner's Create, the epics);
// - issueFields, itemIssues, withSyncedText: the read-only copies queue and roadmap items keep (#168).
// The commands and JSON of each platform come from its adapter (packages/shared/platforms/, #351):
// adapterOf (the adapter of a syncing platform, or null), runCommand ({ cli, args } with an exec),
// commandDisplay (a command as a preview shows it).

const { resolveCommand } = require('../../engine/providers');
const { execShim } = require('../machine/shell');
const Platforms = require('@multiagent/shared/platforms');

// the backlog's platforms: the adapters, and Bitbucket (no sync yet)
const PLATFORMS = {
  ...Object.fromEntries(Platforms.PLATFORMS.map((p) => [p.id, { label: p.label, cli: p.cli, host: p.host }])),
  bitbucket: { label: 'Bitbucket', cli: null, host: 'bitbucket.org' },
};
const { DEFAULT_PLATFORM } = Platforms;
const MAX_ISSUES = 300;

// a repository URL → { host, path: 'owner/repo' } or null (the registry's, shared with the renderer: #641)
const { parseRepoUrl } = Platforms;

// The platform a well-known host belongs to (self-hosted hosts: unknown).
const platformOfHost = (host) => Object.keys(PLATFORMS).find((p) => PLATFORMS[p].host === host) || null;

// Progress of the markdown task list in an issue body ("- [ ]" / "- [x]").
function taskProgress(body) {
  const boxes = String(body || '').match(/^\s*[-*+] \[[ xX]\]/gm) || [];
  return { done: boxes.filter((b) => /\[[xX]\]/.test(b)).length, total: boxes.length };
}

// The platform's issues (the adapter's parseIssue) with their task progress.
function normalize(adapter, raw) {
  return raw.map((i) => {
    const issue = adapter.parseIssue(i);
    return { ...issue, tasks: taskProgress(issue.body) };
  });
}

// { cli, args } run with `exec`
const runCommand = (exec, c) => exec(c.cli, c.args);

// The adapter of a platform that syncs (packages/shared/platforms/), or null.
const adapterOf = (platform) => Platforms.findPlatform(platform);

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
  const p = adapterOf(platform);
  if (!p && PLATFORMS[platform]) throw new Error(`${PLATFORMS[platform].label} sync is not available yet. Pick GitHub or GitLab.`);
  if (!p) throw new Error(`Unknown backlog platform: ${platform}`);
  const parsed = parseRepoUrl(repo);
  if (!parsed) throw new Error(`The project's repository is not a recognizable git URL: ${repo || '(none)'}`);
  const owner = platformOfHost(parsed.host);
  if (owner && owner !== p.id) throw new Error(`The project's repository is on ${parsed.host}; pick ${PLATFORMS[owner].label} to sync it.`);

  const out = await runCommand(exec, p.issueListCommand(p.cliTarget(parsed), MAX_ISSUES));
  return normalize(p, JSON.parse(out || '[]'));
}

// The --repo value of gh/glab for a repository URL (same rules as fetchIssues).
function cliTarget(platform, repo) {
  const p = adapterOf(platform);
  if (!p) throw new Error(`Saving to an issue needs GitHub or GitLab (the backlog's platform is ${PLATFORMS[platform]?.label || platform || 'not set'}).`);
  const parsed = parseRepoUrl(repo);
  if (!parsed) throw new Error(`The project's repository is not a recognizable git URL: ${repo || '(none)'}`);
  return p.cliTarget(parsed);
}

// The --repo value for a repository URL, or an owner/name already (base health, seed tools)
function cliTargetOrName(platform, repo) {
  try { return cliTarget(platform, repo); } catch (e) {
    if (adapterOf(platform) && /^[^\s/]+\/\S+$/.test(String(repo || ''))) return String(repo);
    throw e;
  }
}

// The command as shown in a preview: `text` (a document passed as an argument) replaced.
const commandDisplay = ({ cli, args }, text) => `${cli} ${args.map((a) => (a === text ? '<document>' : /\s/.test(a) ? `"${a}"` : a)).join(' ')}`;

/**
 * The CLI call that files a new issue (the Product Owner's Create, #117): gh reads the body from
 * `file` (--body-file), glab takes it as an argument. { cli, args, display }.
 */
function issueCreateCommand({ platform, repo, title, labels = [], file, text }) {
  const target = cliTarget(platform, repo);
  const t = String(title || '').trim();
  if (!t) throw new Error('The issue has no title.');
  const c = adapterOf(platform).issueCreateCommand({ target, title: t, labels, file, text });
  return { ...c, display: commandDisplay(c, text) };
}

/** The repository's label names (GitHub), or null when unknown (GitLab creates missing labels itself). */
async function repoLabels({ platform, repo, exec = execCli }) {
  const p = adapterOf(platform);
  if (!p?.readsLabels) return null;
  return p.parseLabelNames(await runCommand(exec, p.labelListCommand(cliTarget(platform, repo))));
}

/** One issue, read again from the platform (same shape as fetchIssues). */
async function fetchIssue({ platform, repo, number, exec = execCli }) {
  const target = cliTarget(platform, repo);
  const p = adapterOf(platform);
  const out = await runCommand(exec, p.issueViewCommand(target, String(Number(number))));
  return normalize(p, [JSON.parse(out)])[0];
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
  adapterOf,
  cliTarget,
  cliTargetOrName,
  commandDisplay,
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
  runCommand,
  taskProgress,
  withSyncedText,
};
