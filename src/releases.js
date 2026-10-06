// Releases (#260): what decides "this set is good, ship it". A project's release history lives in
// <workspace>/releases/<project id>.json: { releases: [{ version, tag, date, commit, issues:
// [{ number, title }], runs: [run id], cost (US$), tests: { unit: { status, passed, failed }, e2e },
// notes, status: 'shipped' }], next: { notes } } (`readReleases`, `recordRelease`, `saveNextNotes`).
// The next release is what merged locally since the last one (`nextRelease`, pure: the project's
// runs that merged into the local base and the commits origin does not have), with notes generated
// from its issues and runs (`releaseNotes`) until the owner edits them.
// A release is checked by a run of the bundled release workflow (workflows/release.yaml: the whole
// unit suite and the whole E2E suite, the developer only for a regression, with `historyText`), started
// by a roadmap's cut line (src/roadmap.js) or from the Releases screen. Its `ship` gate is the
// owner's: Ship is the `ship:` transition of the engine (src/engine/workflow.js), which calls
// `shipRelease`: `git push origin <base>` (never forced) and the tag at that commit. Nothing else
// in this module touches origin. Shipping marks the release's issues and the discovery cards linked
// to them Released (`markReleased`, pure). The Backlog applies it to its issues on every read, from
// the history; the cards are marked in the discovery card store when the release is recorded
// (`releaseCards`: `links.release` of each card whose `links.issues` holds a shipped issue; the
// store is src/discovery.js of #256, handed in by the service).
// Service: src/service/areas/releases.js; channels: src/service/channels/releases.js; screen:
// src/renderer/views/releases/releases.js.

const fs = require('fs');
const path = require('path');
const { git, repoRoot } = require('./engine/worktree');
const { defaultBase, pushBase } = require('./local-push');
const { writeJsonSafe } = require('./state-file');

const PUSH_TIMEOUT_MS = 120e3;
const HISTORY_LINES = 30;

const releasesFile = (dir, projectId) => path.join(dir, `${path.basename(String(projectId))}.json`);
const emptyHistory = () => ({ releases: [], next: { notes: '' } });

function readReleases(dir, projectId) {
  try {
    const h = JSON.parse(fs.readFileSync(releasesFile(dir, projectId), 'utf8'));
    return { releases: Array.isArray(h?.releases) ? h.releases.filter((r) => r && typeof r === 'object') : [], next: { notes: String(h?.next?.notes || '') } };
  } catch { return emptyHistory(); }
}

// What a release history file must look like (src/state-file.js refuses a write that breaks it).
function historyProblem(h) {
  if (!h || !Array.isArray(h.releases)) return 'releases is not a list';
  const bad = h.releases.find((r) => !r || !String(r.version || '').trim());
  return bad === undefined ? null : 'a release has no version';
}

const writeReleases = (dir, projectId, history) => writeJsonSafe(releasesFile(dir, projectId), history, { validate: historyProblem });

/** Adds a shipped release to the project's history; the next release starts with empty notes. */
function recordRelease(dir, projectId, release) {
  const h = readReleases(dir, projectId);
  return writeReleases(dir, projectId, { releases: [...h.releases, { ...release, status: 'shipped' }], next: { notes: '' } });
}

/** The owner's notes of the next release (empty: generated again from its issues and runs). */
function saveNextNotes(dir, projectId, notes) {
  const h = readReleases(dir, projectId);
  return writeReleases(dir, projectId, { ...h, next: { ...h.next, notes: String(notes ?? '').trim() } });
}

const byDate = (a, b) => String(a.date || '').localeCompare(String(b.date || ''));
/** The project's last shipped release, or null. */
const lastRelease = (history) => [...(history?.releases || [])].sort(byDate).at(-1) || null;

// A release name as a git tag: spaces become dashes, what a ref cannot hold goes ("Sprint 12: beta" → "Sprint-12-beta").
function tagName(name) {
  return String(name || '').trim().replace(/\s+/g, '-').replace(/[~^:?*[\]\\\x00-\x1f\x7f]/g, '').replace(/\.{2,}/g, '.')
    .replace(/@\{/g, '').replace(/\/{2,}/g, '/').replace(/^[-./]+|[./]+$/g, '').replace(/\.lock$/i, '');
}

const runCount = (runs) => (Array.isArray(runs) ? runs.length : Number(runs) || 0);
const usd = (n) => `$${(Number(n) || 0).toFixed(2)}`;

/**
 * The release notes (Markdown) generated from the release's issues and runs.
 * @param {{ version?: string, issues?: { number, title }[], runs?: { runId, workflow, cost }[] | number }} release
 */
function releaseNotes({ version = '', issues = [], runs = [] } = {}) {
  const lines = [`# ${String(version || '').trim() || 'Next release'}`, ''];
  if (issues.length) lines.push(...issues.map((i) => `- #${i.number} ${String(i.title || '').trim()}`.trimEnd()));
  else lines.push('No issue closed by this release.');
  const n = runCount(runs);
  const cost = Array.isArray(runs) ? runs.reduce((a, r) => a + (Number(r?.cost) || 0), 0) : 0;
  lines.push('', `${n} run${n === 1 ? '' : 's'}${cost ? `, ${usd(cost)}` : ''}.`);
  return lines.join('\n');
}

/**
 * Shipping a release marks its issues, and the discovery cards linked to one of them, Released
 * (pure: new lists, the inputs stay as they are).
 * @param {{ issues?: { number }[], cards?: { issues?: number[] }[] }} board
 * @param {{ version: string, issues: number[] }} release
 */
function markReleased({ issues = [], cards = [] } = {}, { version, issues: numbers = [] } = {}) {
  const shipped = new Set((numbers || []).map(Number));
  const mark = (x) => ({ ...x, status: 'released', released: version });
  return {
    issues: issues.map((i) => (shipped.has(Number(i.number)) ? mark(i) : i)),
    cards: cards.map((c) => ((c.issues || []).some((n) => shipped.has(Number(n))) ? mark(c) : c)),
  };
}

/**
 * Marks the discovery cards linked to one of the release's issues Released in the card store:
 * their `links.release` becomes the version. A card already released keeps its first release.
 * @param {{ listCards: Function, updateCard: Function }} store the discovery card store (src/discovery.js, #256)
 * @param {string} dir the workspace's discovery folder
 * @param {{ version: string, issues: number[] }} release
 * @returns {string[]} the ids of the cards marked
 */
function releaseCards(store, dir, projectId, { version, issues = [] } = {}) {
  if (!String(version || '').trim()) return [];
  const open = store.listCards(dir, projectId).filter((c) => !c.links?.release).map((c) => ({ id: c.id, issues: c.links?.issues || [] }));
  const marked = markReleased({ cards: open }, { version, issues }).cards.filter((c) => c.status === 'released');
  for (const c of marked) store.updateCard(dir, projectId, c.id, { links: { release: version } });
  return marked.map((c) => c.id);
}

/**
 * Ship: pushes the local <base> to origin/<base> (never forced) and tags that commit, locally and
 * on origin. A push origin rejects (it moved) ships nothing: update the local base first. A tag
 * that already names another commit, locally or on origin, is refused before anything is pushed;
 * shipping the same release twice is safe (what is already on origin stays).
 * @param {{ repo: string, base?: string, tag: string, expect?: string }} o expect: the commit the release
 *   was checked on; a local base at another commit (it moved meanwhile) ships nothing
 * @returns {Promise<{ tag, base, commit, pushed: boolean, commits, issues }>} pushed: false when origin already had the base
 */
async function shipRelease({ repo, base = null, tag, expect = null }) {
  const name = tagName(tag);
  if (!name) throw new Error('A release needs a name or version to tag.');
  const root = await repoRoot(repo);
  if (!root) throw new Error(`${repo || '(no folder)'} is not a git repository.`);
  await git(['check-ref-format', `refs/tags/${name}`], root).catch(() => { throw new Error(`"${name}" is not a valid tag name.`); });
  base = base || await defaultBase(root);
  const commit = await git(['rev-parse', '--verify', '--quiet', `refs/heads/${base}^{commit}`], root).catch(() => null);
  if (!commit) throw new Error(`The local branch ${base} does not exist.`);
  if (expect && commit !== expect) throw new Error(`The local ${base} is at ${commit.slice(0, 8)}, not at the commit the release was checked on (${String(expect).slice(0, 8)}): check the release again. Nothing was pushed.`);
  // the tag is checked before anything goes out: one that names another commit, here or on origin, ships nothing more
  const local = await git(['rev-parse', '--verify', '--quiet', `refs/tags/${name}^{commit}`], root).catch(() => null);
  const remote = await remoteTag(root, name);
  const taken = [local, remote].find((sha) => sha && sha !== commit);
  if (taken) throw new Error(`The tag ${name} already names another commit (${taken.slice(0, 8)}, an earlier release or Ship): choose another release name. Nothing was pushed this time.`);
  const result = await pushBase({ repo: root, base });
  if (result.rejected) throw new Error(`origin/${base} has commits the local ${base} has not: update the local ${base} (Backlog › Update and push), then ship again. Nothing was tagged.`);
  if (!local) await git(['tag', name, commit], root);
  if (!remote) await git(['push', 'origin', `refs/tags/${name}:refs/tags/${name}`], root, { timeout: PUSH_TIMEOUT_MS, auth: true });
  return { tag: name, base, commit, pushed: !!result.pushed, commits: result.commits, issues: result.issues };
}

// The commit a tag names on origin (an annotated tag peeled), or null when origin has no such tag.
async function remoteTag(root, name) {
  const out = await git(['ls-remote', '--tags', 'origin', `refs/tags/${name}`, `refs/tags/${name}^{}`], root, { timeout: PUSH_TIMEOUT_MS, auth: true });
  const lines = out.split('\n').map((l) => l.trim().split(/\s+/)).filter((l) => l[1]);
  return (lines.find((l) => l[1].endsWith('^{}')) || lines[0])?.[0] || null;
}

/**
 * The next release (pure): what merged locally since the last one.
 * @param {{ history?: object, runs?: object[], local?: { commits?: { sha, subject, issues }[], issues?: number[] } | null, issues?: { number, title }[], version?: string }} o
 *   runs: the project's runs (src/runs.js listRuns); local: its commits not pushed (backlog.readLocal);
 *   issues: the synced backlog's issues (titles); version: the name of the cut line waiting, when there is one
 * @returns {{ version, since, issues: { number, title }[], runs: { runId, workflow, title, cost }[], commits: number, cost, notes, generated: boolean }}
 */
function nextRelease({ history = null, runs = [], local = null, issues = [], version = '' } = {}) {
  const last = lastRelease(history);
  const since = last?.date || '';
  const merged = runs
    .filter((r) => !r.mock && r.status === 'success' && r.localMerge && (!since || String(r.finishedAt || r.startedAt || '') > since))
    .sort((a, b) => String(a.startedAt || '').localeCompare(String(b.startedAt || '')));
  const titles = new Map((issues || []).map((i) => [Number(i.number), i.title]));
  const found = new Map();
  for (const r of merged) for (const i of r.issues || []) if (i?.number && !found.has(Number(i.number))) found.set(Number(i.number), i.title || titles.get(Number(i.number)) || '');
  for (const n of local?.issues || []) if (!found.has(Number(n))) found.set(Number(n), titles.get(Number(n)) || '');
  const list = [...found].map(([number, title]) => ({ number, title })).sort((a, b) => a.number - b.number);
  const runList = merged.map((r) => ({ runId: r.runId, workflow: r.workflow || '', title: r.title || '', cost: Number(r.costUsd) || 0 }));
  const saved = String(history?.next?.notes || '').trim();
  return {
    version: String(version || '').trim(), since: since || null, issues: list, runs: runList,
    commits: local?.commits?.length || 0, cost: runList.reduce((a, r) => a + r.cost, 0),
    notes: saved || releaseNotes({ version, issues: list, runs: runList }), generated: !saved,
  };
}

/**
 * The history since the last release, for the developer a red suite calls (the release workflow's
 * `history` input): the runs with their issues and folders (decisions.tsv and handoffs/ are read
 * there) and the commits, at most HISTORY_LINES of each.
 * @param {ReturnType<typeof nextRelease>} next
 * @param {{ runsDir?: string, commits?: { sha, subject }[] }} [o]
 */
function historyText(next, { runsDir = '', commits = [] } = {}) {
  const issueLine = next.issues.length ? `Issues: ${next.issues.map((i) => `#${i.number} ${i.title}`.trim()).join('; ')}` : 'Issues: none recorded.';
  const runLines = next.runs.slice(-HISTORY_LINES).map((r) => `- ${r.runId} (${r.workflow})${r.title ? `: ${r.title}` : ''}${runsDir ? ` — ${path.join(runsDir, r.runId)}` : ''}`);
  const commitLines = commits.slice(0, HISTORY_LINES).map((c) => `- ${String(c.sha).slice(0, 8)} ${c.subject}`);
  return [
    `Since ${next.since ? `the last release (${next.since})` : 'the first commit not on origin (no release yet)'}:`,
    issueLine,
    runLines.length ? `Runs (each folder holds summary.json, decisions.tsv and handoffs/):\n${runLines.join('\n')}` : 'Runs: none recorded.',
    commitLines.length ? `Commits:\n${commitLines.join('\n')}` : 'Commits: read them with git log.',
  ].join('\n');
}

const SUITE_KEYS = { unit: 'unit', e2e: 'e2e' };
/** The suites' results of a release run (its summary's steps `unit` and `e2e`): { unit: { status, passed, failed }, e2e }. */
function testResults(steps = {}) {
  const out = {};
  for (const [key, id] of Object.entries(SUITE_KEYS)) {
    const o = steps?.[id]?.output;
    if (o?.kind !== 'suite') continue;
    out[key] = { status: o.status, ...(o.passed != null ? { passed: o.passed } : {}), ...(o.failed != null ? { failed: o.failed } : {}) };
  }
  return out;
}

module.exports = {
  historyText,
  lastRelease,
  markReleased,
  nextRelease,
  readReleases,
  recordRelease,
  releaseCards,
  releaseNotes,
  releasesFile,
  saveNextNotes,
  shipRelease,
  tagName,
  testResults,
};
