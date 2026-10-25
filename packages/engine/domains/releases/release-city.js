// A release on the project city (#376), the git side, read-only (no checkout): the base city at the
// previous release (packages/engine/domains/project/architecture-facts.js readCity with `ref`: the tree and the facts at that
// tag, with the current plan's rules), what changed (`git diff --name-status -M` through the pure
// core packages/shared/city-release.js, the lines from `--numstat`), and the release's commits with the
// issues they name (the issue filter). Tags in semver order (packages/engine/domains/releases/releases.js releaseSemver /
// compareSemver) for the two-tag picker. A project without tags compares any two commits. Never
// throws: a folder that is not a repository is 'not-git', a ref git does not know 'unknown-ref'.
// Used by packages/engine/service/channels/architecture.js (architecture:release).

'use strict';

const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const facts = require('../project/architecture-facts');
const {
  compareSemver,
  releaseSemver,
} = require('./releases');
const {
  issuesOf,
  parseNameStatus,
} = require('@multiagent/shared/city-release');

const GIT_TIMEOUT_MS = 120e3;
const MAX_BUFFER = 1 << 28;

function git(cwd, args) {
  return new Promise((resolve, reject) => {
    execFile('git', ['-c', 'core.quotepath=off', ...args], { cwd, timeout: GIT_TIMEOUT_MS, windowsHide: true, maxBuffer: MAX_BUFFER, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } }, (err, stdout, stderr) => {
      if (err) reject(new Error(`git ${args[0]} failed: ${String(stderr || err.message).trim()}`));
      else resolve(String(stdout));
    });
  });
}
const tryGit = (cwd, args) => git(cwd, args).catch(() => null);
const isRepo = (folder) => !!folder && fs.existsSync(path.join(folder, '.git'));
const commitOf = async (folder, ref) => ((await tryGit(folder, ['rev-parse', '--verify', '-q', `${ref}^{commit}`])) || '').trim() || null;

// path -> added + deleted lines, from `git diff --numstat -z -M` (a binary file counts 0; a rename
// is `a\td\t\0old\0new\0`, keyed by its new path)
function parseNumstat(text) {
  const lines = {};
  const parts = String(text || '').split('\0');
  for (let i = 0; i < parts.length; i++) {
    const m = /^(-|\d+)\t(-|\d+)\t(.*)$/s.exec(parts[i].replace(/^\n/, ''));
    if (!m) continue;
    const n = (Number(m[1]) || 0) + (Number(m[2]) || 0);
    let file = m[3];
    if (!file) {
      file = parts[i + 2] || '';
      i += 2;
    }
    if (file) lines[file.replace(/\\/g, '/')] = n;
  }
  return lines;
}

// [{ commit, subject, issues, files }] of `git log --name-only` with the format below
function parseCommits(text) {
  const out = [];
  for (const chunk of String(text || '').split('\x01')) {
    const end = chunk.indexOf('\x02');
    if (end < 0) continue;
    const [commit, subject = '', body = ''] = chunk.slice(0, end).split('\0');
    const files = chunk.slice(end + 1).split(/\r?\n/).map((f) => f.trim().replace(/\\/g, '/')).filter(Boolean);
    out.push({ commit: commit.trim(), subject: subject.trim(), issues: issuesOf(`${subject}\n${body}`), files });
  }
  return out;
}

/** The repository's tags, newest first: semver tags in semver order, then the others by name. */
async function listTags(folder) {
  if (!isRepo(folder)) return [];
  const tags = String(await tryGit(folder, ['tag', '--list']) || '').split(/\r?\n/).map((t) => t.trim()).filter(Boolean);
  const semver = tags.filter((t) => releaseSemver(t)).sort((a, b) => compareSemver(releaseSemver(b), releaseSemver(a)) || (a < b ? -1 : a > b ? 1 : 0));
  const others = tags.filter((t) => !releaseSemver(t)).sort();
  return [...semver, ...others];
}

/** The tag right before `tag` (semver order; for another name, the closest tag reachable before it), or null. */
async function previousTag(folder, tag) {
  if (!isRepo(folder) || !tag) return null;
  const v = releaseSemver(tag);
  if (!v) return String(await tryGit(folder, ['describe', '--tags', '--abbrev=0', `${tag}^`]) || '').trim() || null;
  const older = (await listTags(folder)).filter((t) => releaseSemver(t) && compareSemver(releaseSemver(t), v) < 0);
  return older[0] || null;
}

/** A project without tags picks two commits: the short hashes of the latest ones, newest first. */
async function recentCommits(folder, count = 30) {
  if (!isRepo(folder)) return [];
  return String(await tryGit(folder, ['log', '--no-merges', `-n${count}`, '--format=%h']) || '').split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
}

/**
 * A release on the city: { state, from, to, base: { model, validation }, changes: [{ status, path,
 * from?, lines }], commits: [{ commit, subject, issues, files }] }. from/to: any commit-ish.
 */
async function readReleaseCity(folder, { from, to, plan = null, exclude = [] } = {}) {
  const empty = { from: from || null, to: to || null, base: null, changes: [], commits: [] };
  if (!isRepo(folder)) return { state: 'not-git', ...empty };
  try {
    if (!from || !to || !(await commitOf(folder, from)) || !(await commitOf(folder, to))) return { state: 'unknown-ref', ...empty };
    const range = [from, to];
    const [nameStatus, numstat, log, base] = await Promise.all([
      git(folder, ['diff', '--name-status', '-M', ...range]),
      git(folder, ['diff', '--numstat', '-z', '-M', ...range]),
      git(folder, ['log', '--no-merges', '-M', '--name-only', '--format=%x01%H%x00%s%x00%b%x02', `${from}..${to}`]),
      facts.readCity(folder, { plan, exclude, ref: from }),
    ]);
    if (base.state !== 'ok') return { state: base.state, ...empty };
    const lines = parseNumstat(numstat);
    const changes = parseNameStatus(nameStatus).map((c) => ({ ...c, lines: lines[c.path] || 0 }));
    return { state: 'ok', from, to, base: { model: base.model, validation: base.validation }, changes, commits: parseCommits(log) };
  } catch (e) {
    return { state: 'failed', error: e.message, ...empty };
  }
}

module.exports = {
  listTags,
  parseCommits,
  parseNumstat,
  previousTag,
  readReleaseCity,
  recentCommits,
};
