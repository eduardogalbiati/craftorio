#!/usr/bin/env node
// Publishes a run's UI screenshots on its PR/MR: commits the PNGs to a dedicated branch (one folder
// per PR/MR) and posts one comment with them, original/modified side by side. The working tree, the
// index and the current branch are never touched (git plumbing with an index of its own).
//
//   node publish.js --platform gh|gl --pr-url <PR/MR URL> --dir <run_dir>/evidence
//                   [--remote origin] [--branch pr-screenshots] [--no-comment]
//   node publish.js --cleanup --platform gh|gl --pr-url <PR/MR URL> [--remote origin] [--branch pr-screenshots]
//
// --dir <run_dir>/evidence: its manifest.json (#146), whose final set is published (images marked
// `final`, a `modified` image with its `pair`, paths relative to the run folder). A run recorded
// before #146: --dir <run_dir>/screenshots with screenshots.json ([{ "path", "caption", "before" }],
// paths relative to --dir, or absolute). Folders of PRs/MRs that are no longer open are removed
// from the branch in the same commit. Prints the comment body, then `comment: posted` when posted.
// --cleanup (run by the workflow when the PR/MR merges or closes) only removes that PR/MR's folder
// and those of other PRs/MRs no longer open; it always exits 0.

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const MARKER = '<!-- multiagent:screenshots -->';

/** { host, project, number } from a GitHub PR or GitLab MR URL, or throws. */
function parsePrUrl(platform, url) {
  const u = new URL(String(url));
  const re = platform === 'gl' ? /^\/(.+?)\/-\/merge_requests\/(\d+)\/?$/ : /^\/([^/]+\/[^/]+)\/pull\/(\d+)\/?$/;
  const m = re.exec(u.pathname);
  if (!m) throw new Error(`not a ${platform === 'gl' ? 'GitLab merge request' : 'GitHub pull request'} URL: ${url}`);
  return { host: u.host, project: m[1], number: Number(m[2]) };
}

/** URL that renders the file inline in a comment (private repositories included, for members). */
function fileUrl(platform, target, branch, file) {
  const base = `https://${target.host}/${target.project}`;
  return platform === 'gl' ? `${base}/-/raw/${branch}/${file}` : `${base}/blob/${branch}/${file}?raw=true`;
}

const resolver = (dir) => (p) => {
  const file = path.resolve(dir, String(p));
  if (!/\.(png|jpe?g|gif|webp)$/i.test(file)) throw new Error(`not an image: ${p}`);
  if (!fs.existsSync(file)) throw new Error(`missing screenshot: ${p}`);
  return file;
};

// The shots to publish: [{ caption, path, original }] (path: the modified image, or the original
// alone for a screen the change removes). --dir is <run_dir>/evidence with manifest.json (its final
// set; paths relative to the run folder), or a legacy folder with screenshots.json.
function readManifest(dir) {
  const evidence = path.join(dir, 'manifest.json');
  if (fs.existsSync(evidence)) {
    const m = JSON.parse(fs.readFileSync(evidence, 'utf8'));
    const resolve = resolver(path.dirname(path.resolve(dir)));
    const final = (m.images || []).filter((x) => x.final);
    const pairedOriginals = new Set(final.filter((x) => x.side === 'modified' && x.pair).map((x) => x.pair));
    // a final original paired with an earlier round's modified (the last round recaptured only the
    // original) is published with that modified; an original without a pair is a removed screen
    const shots = final.filter((x) => x.side === 'modified' || !pairedOriginals.has(x.path)).map((x) => {
      const caption = String(x.caption || x.key || path.basename(x.path));
      if (x.side === 'modified') return { caption, path: resolve(x.path), original: x.pair ? resolve(x.pair) : null, removed: false };
      if (x.pair) return { caption, path: resolve(x.pair), original: resolve(x.path), removed: false };
      return { caption, path: resolve(x.path), original: null, removed: true };
    });
    if (!shots.length) throw new Error('manifest.json has no final screenshots');
    return shots;
  }
  const list = JSON.parse(fs.readFileSync(path.join(dir, 'screenshots.json'), 'utf8'));
  if (!Array.isArray(list) || !list.length) throw new Error('screenshots.json has no screenshots');
  const resolve = resolver(dir);
  return list.map((s) => ({ caption: String(s.caption || path.basename(s.path)), path: resolve(s.path), original: s.before ? resolve(s.before) : null }));
}

/** The comment body: one section per screenshot, an Original | Modified table for a pair. */
function commentBody(shots, urlOf) {
  const img = (file, alt) => `<img src="${urlOf(file)}" alt="${alt.replace(/"/g, '&quot;')}" width="480">`;
  const parts = [MARKER, '### UI screenshots', ''];
  for (const s of shots) {
    parts.push(`**${s.caption}**${s.removed ? ' (original only: the change removes this screen)' : ''}`, '');
    if (s.original) parts.push('| Original | Modified |', '|---|---|', `| ${img(s.original, `${s.caption} (original)`)} | ${img(s.path, `${s.caption} (modified)`)} |`);
    else parts.push(img(s.path, s.caption));
    parts.push('');
  }
  parts.push('<sub>Captured in simulation by the test step. Stored on the `pr-screenshots` branch; removed once the PR/MR is closed.</sub>');
  return parts.join('\n');
}

// Stable, cache-busting names: <name>-<content hash>.png (a new capture never shows an old image).
function storedName(file) {
  const hash = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex').slice(0, 8);
  const ext = path.extname(file).toLowerCase();
  return `${path.basename(file, path.extname(file)).replace(/[^\w.-]+/g, '-')}-${hash}${ext}`;
}

function openNumbers(platform, target, cli) {
  const out = platform === 'gl'
    ? cli('glab', ['mr', 'list', '--repo', `https://${target.host}/${target.project}`, '--per-page', '100', '--output', 'json'])
    : cli('gh', ['pr', 'list', '--repo', `${target.host}/${target.project}`, '--state', 'open', '--limit', '1000', '--json', 'number']);
  return new Set(JSON.parse(out || '[]').map((x) => Number(platform === 'gl' ? x.iid : x.number)));
}

const run = (cmd, args, opts = {}) => execFileSync(cmd, args, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true, ...opts });
const defaultCli = (cmd, args, input) => run(cmd, args, { input });

/**
 * Rewrites `branch` from its remote head with git plumbing (an index of its own) and pushes it.
 * edit({ git, parent }) stages the change and returns { message, ...extra }, or null for nothing to
 * commit. Returns { commit, ...extra } (commit null when nothing was pushed).
 */
function updateBranch({ cwd, remote, branch, requireBranch = false }, edit) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pr-screenshots-'));
  const env = { ...process.env, GIT_INDEX_FILE: path.join(tmp, 'index') };
  const git = (args, input) => run('git', args, { cwd, env, input }).trim();
  const hasIdentity = (() => { try { return !!git(['config', 'user.email']); } catch { return false; } })();
  const id = hasIdentity ? [] : ['-c', 'user.name=multiagent-orchestrator', '-c', 'user.email=multiagent-orchestrator@users.noreply.github.com'];
  try {
    for (let attempt = 1; ; attempt++) {
      let parent = null;
      try {
        git(['fetch', '--quiet', remote, `+refs/heads/${branch}:refs/remotes/${remote}/${branch}`]);
        parent = git(['rev-parse', '--verify', `refs/remotes/${remote}/${branch}^{commit}`]);
      } catch { /* first publish: the branch does not exist yet */ }
      if (!parent && requireBranch) return { commit: null };
      if (parent) git(['read-tree', parent]);
      else git(['read-tree', '--empty']);
      const change = edit({ git });
      if (!change) return { commit: null };
      const { message, ...extra } = change;
      const tree = git(['write-tree']);
      const commit = git([...id, 'commit-tree', tree, ...(parent ? ['-p', parent] : []), '-m', message]);
      try {
        git(['push', '--quiet', remote, `${commit}:refs/heads/${branch}`]);
      } catch (e) {
        if (attempt < 3) continue; // someone else pushed in between: start again from their commit
        throw e;
      }
      return { commit, ...extra };
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

/**
 * Unstages this PR's folder and the folders of PRs/MRs that are no longer open (none of those when
 * the open list can't be read). Returns the removed folder names.
 */
function pruneFolders(git, platform, target, cli) {
  let open = null;
  try { open = openNumbers(platform, target, cli); } catch (e) { process.stderr.write(`could not list open PRs/MRs, only #${target.number} pruned: ${e.message}\n`); }
  const folders = new Set(git(['ls-files']).split('\n').filter(Boolean).map((f) => f.split('/')[0]));
  const removed = [...folders].filter((f) => f === String(target.number) || (open && /^\d+$/.test(f) && !open.has(Number(f))));
  for (const f of removed) git(['rm', '--cached', '-r', '--quiet', '--ignore-unmatch', '--', f]);
  return removed;
}

/**
 * Commits the screenshots to `<branch>:<number>/` and pushes it; returns { body, commit, urls }.
 * cli(cmd, args, input?) runs gh/glab (injectable for tests); comment: false skips the comment.
 */
function publish({ platform, prUrl, dir, cwd = process.cwd(), remote = 'origin', branch = 'pr-screenshots', comment = true, cli = defaultCli }) {
  if (!['gh', 'gl'].includes(platform)) throw new Error('--platform takes gh or gl');
  const target = parsePrUrl(platform, prUrl);
  const shots = readManifest(dir);
  const r = updateBranch({ cwd, remote, branch }, ({ git }) => {
    // this PR's folder is replaced; folders of PRs that are no longer open go away
    pruneFolders(git, platform, target, cli);
    const stored = new Map();
    for (const file of shots.flatMap((s) => [s.path, s.original]).filter(Boolean)) {
      if (stored.has(file)) continue;
      const rel = `${target.number}/${storedName(file)}`;
      const blob = git(['hash-object', '-w', '--no-filters', '--', file]);
      git(['update-index', '--add', '--cacheinfo', `100644,${blob},${rel}`]);
      stored.set(file, rel);
    }
    return { message: `Screenshots for #${target.number}`, stored };
  });
  const urls = Object.fromEntries([...r.stored].map(([file, rel]) => [file, fileUrl(platform, target, branch, rel)]));
  const body = commentBody(shots, (file) => urls[file]);
  if (comment) {
    if (platform === 'gl') cli('glab', ['mr', 'note', String(target.number), '--repo', `https://${target.host}/${target.project}`, '-m', body]);
    else cli('gh', ['pr', 'comment', prUrl, '--body-file', '-'], body);
  }
  return { body, commit: r.commit, urls };
}

/**
 * Run when a PR/MR merges or closes: removes its folder (and those of other PRs/MRs no longer open)
 * from the branch. No branch or nothing to remove: no commit. Returns { commit, removed }.
 */
function cleanup({ platform, prUrl, cwd = process.cwd(), remote = 'origin', branch = 'pr-screenshots', cli = defaultCli }) {
  if (!['gh', 'gl'].includes(platform)) throw new Error('--platform takes gh or gl');
  const target = parsePrUrl(platform, prUrl);
  let removed = [];
  const r = updateBranch({ cwd, remote, branch, requireBranch: true }, ({ git }) => {
    removed = pruneFolders(git, platform, target, cli);
    return removed.length ? { message: `Remove screenshots of #${removed.join(', #')}` } : null;
  });
  return { commit: r.commit, removed: r.commit ? removed : [] };
}

function parseArgs(argv) {
  const a = { comment: true };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    const next = () => { const v = argv[++i]; if (v === undefined) throw new Error(`${k} needs a value`); return v; };
    if (k === '--platform') a.platform = next();
    else if (k === '--pr-url') a.prUrl = next();
    else if (k === '--dir') a.dir = next();
    else if (k === '--remote') a.remote = next();
    else if (k === '--branch') a.branch = next();
    else if (k === '--no-comment') a.comment = false;
    else if (k === '--cleanup') a.cleanup = true;
    else throw new Error(`Unknown argument: ${k}`);
  }
  for (const k of ['platform', 'prUrl', ...(a.cleanup ? [] : ['dir'])]) if (!a[k]) throw new Error(`missing --${k.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`);
  return a;
}

if (require.main === module && process.argv.includes('--cleanup')) {
  // runs as a workflow action right after a merge/close: best effort, never fails the step
  try {
    const r = cleanup(parseArgs(process.argv.slice(2)));
    console.log(r.commit ? `removed: ${r.removed.join(', ')}\ncommit: ${r.commit}` : 'nothing to remove');
  } catch (e) {
    console.log(`cleanup skipped: ${(e.stderr || e.message || String(e)).toString().trim()}`);
  }
} else if (require.main === module) {
  try {
    const r = publish(parseArgs(process.argv.slice(2)));
    console.log(r.body);
    console.log(`commit: ${r.commit}`);
    console.log(process.argv.includes('--no-comment') ? 'comment: skipped' : 'comment: posted');
  } catch (e) {
    console.error(`publish: ${(e.stderr || e.message || String(e)).toString().trim()}`);
    process.exit(1);
  }
}

module.exports = { publish, cleanup, parsePrUrl, fileUrl, commentBody, parseArgs };
