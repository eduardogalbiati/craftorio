// Service area: the diff viewer's data (#118), read-only (git diff / log / show, never a checkout or
// a write in the worktree). runDiff: a run's changed files between the merge base with its base
// branch and the branch head (`git diff --find-renames <base>...HEAD`), or one commit of the branch
// only, with each file's status, +/- counts and patch (huge files and binaries without it) and the
// branch's commits for the commit picker. runDiffFile: one file's patch and both sides' contents
// (expanding context, "load diff" of a huge file, image previews as data URLs). The folder and the
// base come from the open gate (approvalId, its work_dir and diff_base) or else from the run's
// worktree.ready event (once an ended run's folder is gone, its branch in the repository, #202),
// never from the caller. A simulated run, or one without a worktree, gets the
// files the developer reported instead (simulated / unavailable), not an error.

const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { resolveCommand } = require('../../engine/providers');
const runs = require('../../runs');
const supervisor = require('../../supervisor');

// Above either limit a file's patch is left out of runDiff (a lockfile, a generated file): the
// viewer collapses it with "load diff" (runDiffFile).
const LARGE_LINES = 1500;
const LARGE_BYTES = 200 * 1024;
// A side's contents above this are not sent (no context expansion for that file).
const MAX_CONTENT_BYTES = 5 * 1024 * 1024;
const IMAGE_TYPES = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.bmp': 'image/bmp', '.ico': 'image/x-icon', '.svg': 'image/svg+xml' };
const STATUS = { A: 'added', C: 'added', D: 'deleted', M: 'modified', R: 'renamed', T: 'modified' };

module.exports = (ctx) => {
  // git's output (a Buffer when raw), or throws with git's first error line.
  function git(dir, args, raw = false) {
    const g = resolveCommand('git');
    if (!g) throw new Error('git is not installed.');
    return new Promise((resolve, reject) => {
      execFile(g.file, ['-C', dir, '-c', 'core.quotepath=off', '--no-pager', ...args], { windowsHide: true, timeout: 30000, maxBuffer: 256 * 1024 * 1024, encoding: raw ? 'buffer' : 'utf8' }, (err, stdout, stderr) => {
        if (err) reject(new Error(`git ${args[0]} failed: ${String(stderr || err.message).trim().split('\n')[0]}`));
        else resolve(stdout);
      });
    });
  }
  const gitOrNull = (dir, args, raw) => git(dir, args, raw).catch(() => null);

  function runEvents(runId) {
    try { return supervisor.readEvents(ctx.runFolder(runId)); } catch { return []; }
  }

  // The files the developer reported (its last files_changed): a simulated run's only changes.
  function reportedFiles(events) {
    for (let i = events.length - 1; i >= 0; i--) {
      const o = events[i].type === 'step.finished' ? events[i].output : null;
      if (o && typeof o === 'object' && Array.isArray(o.files_changed)) {
        return o.files_changed.map((f) => String(typeof f === 'object' && f ? f.file || f.path || '' : f)).filter(Boolean)
          .map((file) => ({ file, oldFile: null, status: 'reported', added: null, deleted: null, binary: false, image: false, large: false, patch: null }));
      }
    }
    return [];
  }

  // { dir, base } of the run's branch, or { problem } when there is nothing to diff.
  function diffSource({ runId, approvalId }) {
    const id = path.basename(ctx.runFolder(String(runId || '')));
    const live = ctx.active.get(id);
    const mock = live ? live.mock : runs.readRun(ctx.ws.runs, id)?.mock;
    const events = runEvents(id);
    if (mock) return { events, simulated: true };
    const gate = approvalId ? live?.pendingGates().find((g) => g.approval_id === approvalId) : null;
    if (gate?.diff_base && gate.work_dir) return { events, dir: gate.work_dir, bases: [gate.diff_base] };
    const ready = events.find((e) => e.type === 'worktree.ready');
    const name = String(ready?.base || '').replace(/^origin\//, '');
    const bases = [ready?.base, name, ready?.commit].filter(Boolean);
    if (ready?.dir && fs.existsSync(ready.dir)) return { events, dir: ready.dir, head: 'HEAD', bases };
    // #202: an ended run's folder is gone, its branch keeps the work: read it in the repository
    const branch = [...events].reverse().find((e) => e.type === 'worktree.removed' && e.branch)?.branch;
    if (ready?.repo && branch && !branch.startsWith('-') && fs.existsSync(ready.repo)) return { events, dir: ready.repo, head: `refs/heads/${branch}`, bases };
    return { events, problem: 'This run has no git worktree left to compare.' };
  }

  // The merge base of the branch head with the first base that resolves.
  async function mergeBase(dir, bases, head) {
    for (const b of bases) {
      if (String(b).startsWith('-')) continue;
      const mb = await gitOrNull(dir, ['merge-base', String(b), head]);
      if (mb && mb.trim()) return { base: String(b), mergeBase: mb.trim() };
    }
    throw new Error(`None of the run's base refs resolves in its worktree (${bases.join(', ')}).`);
  }

  async function branchCommits(dir, mb, head) {
    const out = await git(dir, ['log', '--format=%H%x1f%h%x1f%s%x1f%an%x1f%aI', `${mb}..${head}`]);
    return out.split('\n').filter(Boolean).map((l) => {
      const [sha, short, subject, author, date] = l.split('\x1f');
      return { sha, short, subject, author, date };
    });
  }

  // The two refs compared: the whole branch, or one of its commits against its parent.
  async function resolveRange(opts) {
    const src = diffSource(opts);
    if (src.simulated || src.problem) return src;
    const { base, mergeBase: mb } = await mergeBase(src.dir, src.bases, src.head || 'HEAD');
    const commits = await branchCommits(src.dir, mb, src.head || 'HEAD');
    let from = mb;
    let to = src.head || 'HEAD';
    let commit = null;
    if (opts.commit) {
      commit = commits.find((c) => c.sha === opts.commit || c.short === opts.commit);
      if (!commit) throw new Error(`Commit ${opts.commit} is not one of this branch's commits.`);
      from = `${commit.sha}^`;
      to = commit.sha;
    }
    return { ...src, base, mergeBase: mb, commits, commit, from, to };
  }

  // [{ file, oldFile, status, added, deleted, binary }] from --name-status -z and --numstat -z.
  async function changedFiles(dir, from, to) {
    const range = ['--find-renames', '-z', from, to, '--'];
    const names = (await git(dir, ['diff', '--name-status', ...range])).split('\0');
    const files = [];
    for (let i = 0; i < names.length - 1;) {
      const code = names[i++];
      const kind = STATUS[code[0]] || 'modified';
      const two = code[0] === 'R' || code[0] === 'C';
      const oldFile = two ? names[i++] : null;
      files.push({ file: names[i++], oldFile: code[0] === 'R' ? oldFile : null, status: kind });
    }
    const nums = (await git(dir, ['diff', '--numstat', ...range])).split('\0');
    const counts = [];
    for (let i = 0; i < nums.length - 1;) {
      const [added, deleted, name] = nums[i++].split('\t');
      if (!name) i += 2; // a rename: the old and new names follow
      counts.push({ added: added === '-' ? null : +added, deleted: deleted === '-' ? null : +deleted, binary: added === '-' });
    }
    return files.map((f, i) => ({ ...f, ...(counts[i] || { added: null, deleted: null, binary: false }) }));
  }

  // The whole patch split per file, in git's order (the same as --name-status's).
  async function patches(dir, from, to) {
    const out = await git(dir, ['diff', '--find-renames', '--no-color', '--no-ext-diff', from, to, '--']);
    return out.split(/^(?=diff --git )/m).filter((p) => p.startsWith('diff --git '));
  }

  // opts: { runId, approvalId?, commit? }
  async function runDiff(opts = {}) {
    const r = await resolveRange(opts);
    if (r.simulated || r.problem) {
      return { simulated: !!r.simulated, unavailable: r.problem || null, base: null, commits: [], commit: null, files: reportedFiles(r.events) };
    }
    const files = await changedFiles(r.dir, r.from, r.to);
    const all = await patches(r.dir, r.from, r.to);
    const aligned = all.length === files.length;
    return {
      simulated: false, unavailable: null, base: r.base, mergeBase: r.mergeBase, commits: r.commits, commit: r.commit?.sha || null,
      files: files.map((f, i) => {
        const image = !!IMAGE_TYPES[path.extname(f.file).toLowerCase()];
        const patch = aligned ? all[i] : null;
        const large = !f.binary && ((f.added || 0) + (f.deleted || 0) > LARGE_LINES || (patch?.length || 0) > LARGE_BYTES);
        return { ...f, image, large, patch: f.binary || large ? null : patch };
      }),
    };
  }

  // A side's text (null: the file is not on that side, or too big), or a data URL for an image.
  async function side(dir, ref, file, image) {
    if (!file) return null;
    const buf = await gitOrNull(dir, ['show', `${ref}:${file}`], true);
    if (!buf || buf.length > MAX_CONTENT_BYTES) return null;
    return image ? `data:${IMAGE_TYPES[path.extname(file).toLowerCase()]};base64,${buf.toString('base64')}` : buf.toString('utf8');
  }

  // opts: { runId, approvalId?, commit?, file, oldFile? } -> { patch, before, after, image }
  async function runDiffFile(opts = {}) {
    const file = String(opts.file || '');
    if (!file) throw new Error('Which file?');
    const r = await resolveRange(opts);
    if (r.simulated || r.problem) throw new Error(r.problem || 'A simulated run has no diff.');
    const oldFile = opts.oldFile ? String(opts.oldFile) : null;
    const image = !!IMAGE_TYPES[path.extname(file).toLowerCase()];
    const [patch, before, after] = await Promise.all([
      git(r.dir, ['diff', '--find-renames', '--no-color', '--no-ext-diff', r.from, r.to, '--', ...(oldFile ? [oldFile] : []), file]),
      side(r.dir, r.from, oldFile || file, image),
      side(r.dir, r.to, file, image),
    ]);
    return { file, oldFile, image, patch, before, after };
  }

  return {
    runDiff,
    runDiffFile,
  };
};
