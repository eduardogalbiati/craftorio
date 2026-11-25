// Releases (#260): what decides "this set is good, ship it". A project's release history lives in
// <workspace>/releases/<project id>.json: { releases: [{ version, tag, date, commit, issues:
// [{ number, title }], runs: [run id], cost (US$), tests: { unit: { status, passed, failed }, e2e },
// notes, status: 'shipped' }], next: { notes } } (`readReleases`, `recordRelease`, `saveNextNotes`).
// The next release is what merged locally since the last one (`nextRelease`, pure: the project's
// runs that merged into the local base and the commits origin does not have), with notes generated
// from its issues and runs (`releaseNotes`) until the owner edits them.
// A release is checked by a run of the bundled release workflow (workflows/release.yaml: the whole
// unit suite and the whole E2E suite, the developer only for a regression, with `historyText`), started
// by a roadmap's cut line (packages/engine/domains/roadmap/roadmap.js) or from the Releases screen. Its `ship` gate is the
// owner's: Ship is the `ship:` transition of the engine (packages/engine/engine/workflow.js), which calls
// `shipRelease`: `git push origin <base>` (never forced) and the tag at that commit. Nothing else
// in this module touches origin. Shipping marks the release's issues and the discovery cards linked
// to them Released (`markReleased`, pure). The Backlog applies it to its issues on every read, from
// the history; the cards are marked in the discovery card store when the release is recorded
// (`releaseCards`: `links.release` of each card whose `links.issues` holds a shipped issue; the
// store is packages/engine/domains/discovery/discovery.js of #256, handed in by the service).
// Service: packages/engine/service/areas/releases.js; channels: packages/engine/service/channels/releases.js; screen:
// fronts/build/views/releases/releases.js.
// #489 "rc + stable": every merge into main is a release candidate, recorded in the history's
// `candidates: [{ tag: 'vX.Y.Z-rc.N', commit, date, runId, issues: [{ number, title, labels }], held? }]`
// (`rcTag`, N = `mergesSinceStable`). The stable release is a candidate promoted without a rebuild
// (`promoteRelease`): its commit is tagged vX.Y.Z (.github/workflows/deploy.yml then turns the rc's
// GitHub release into the latest one) and recorded with `rc`, the issues since the last stable
// (`issuesSinceStable`) and the version packages/shared/release-version.js suggests (`stableVersion`).
// A held candidate (`holdCandidate`) is never promoted by the night's train (packages/engine/domains/night/night-watch.js).
// #46 products: a repository that declares products in its manifest (packages/engine/domains/project/project-manifest.js)
// releases one at a time (`productOf`): its own version command, tag (`productTag`) and last release
// (`writeProductVersion`). The history's releases are the main product's (`mainProduct`: the one tagged
// vX.Y.Z); one of another product carries `product` and never counts as the last release.

const fs = require('fs');
const path = require('path');
const {
  git,
  identityArgs,
  repoRoot,
} = require('../../engine/worktree');
const { projectVersion } = require('../../engine/project-version');
const {
  closingCommits,
  defaultBase,
  pushBase,
} = require('../local/local-push');
const { readManifest } = require('../project/project-manifest');
const {
  compareSemver,
  releaseSemver,
  SEMVER,
} = require('./semver');
const { issuesOf } = require('@craftorio/shared/city-release');
const { suggestVersion } = require('@craftorio/shared/release-version');
const { writeJsonSafe } = require('../workspace/state-file');

const PUSH_TIMEOUT_MS = 120e3;
const HISTORY_LINES = 30;

const releasesFile = (dir, projectId) => path.join(dir, `${path.basename(String(projectId))}.json`);
const emptyHistory = () => ({ releases: [], next: { notes: '' } });
const objects = (list) => (Array.isArray(list) ? list.filter((r) => r && typeof r === 'object') : []);
// #489: `candidates` only when the file has them (a history without one reads as before)
const withCandidates = (list) => (Array.isArray(list) ? { candidates: objects(list) } : {});

function readReleases(dir, projectId) {
  try {
    const h = JSON.parse(fs.readFileSync(releasesFile(dir, projectId), 'utf8'));
    return { releases: objects(h?.releases), ...withCandidates(h?.candidates), next: { notes: String(h?.next?.notes || '') } };
  } catch { return emptyHistory(); }
}

/** Why the project's history file cannot be read (#291: the Roadmap says so), or null (it reads, or there is none yet). */
function historyError(dir, projectId) {
  let text;
  try { text = fs.readFileSync(releasesFile(dir, projectId), 'utf8'); } catch (e) { return e.code === 'ENOENT' ? null : e.message; }
  try { return historyProblem(JSON.parse(text)); } catch (e) { return e.message; }
}

// What a release history file must look like (packages/engine/domains/workspace/state-file.js refuses a write that breaks it).
function historyProblem(h) {
  if (!h || !Array.isArray(h.releases)) return 'releases is not a list';
  if (h.candidates !== undefined && !Array.isArray(h.candidates)) return 'candidates is not a list';
  const bad = h.releases.find((r) => !r || !String(r.version || '').trim());
  return bad === undefined ? null : 'a release has no version';
}

const writeReleases = (dir, projectId, history) => writeJsonSafe(releasesFile(dir, projectId), history, { validate: historyProblem });

/** Adds a shipped release to the project's history; the next release starts with empty notes (another product's, #46, leaves them). */
function recordRelease(dir, projectId, release) {
  const h = readReleases(dir, projectId);
  return writeReleases(dir, projectId, { releases: [...h.releases, { ...release, status: 'shipped' }], ...withCandidates(h.candidates), next: release.product ? h.next : { notes: '' } });
}

/** The owner's notes of the next release (empty: generated again from its issues and runs). */
function saveNextNotes(dir, projectId, notes) {
  const h = readReleases(dir, projectId);
  return writeReleases(dir, projectId, { ...h, next: { ...h.next, notes: String(notes ?? '').trim() } });
}

const byDate = (a, b) => String(a.date || '').localeCompare(String(b.date || ''));
/** The project's last shipped release, or null; another product's (#46) does not count. */
const lastRelease = (history) => (history?.releases || []).filter((r) => !r.product).sort(byDate).at(-1) || null;

// #489: where the last stable release cuts the candidates: the date of the rc it promoted (by its
// tag or commit), not the promotion's own time, so a later rc held or red when an older one was
// promoted stays a candidate; the release's date when it did not come from an rc (a milestone).
function stableBoundary(history) {
  const last = lastRelease(history);
  if (!last) return '';
  const rc = objects(history?.candidates).find((c) => (last.rc && c.tag === last.rc) || (last.commit && c.commit === last.commit));
  return String(rc?.date || last.date || '');
}

/** #489: the release candidates merged after the last stable release (all of them before the first one), oldest first. */
function candidatesSinceStable(history) {
  const since = stableBoundary(history);
  return objects(history?.candidates).filter((c) => !since || String(c.date || '') > since).sort(byDate);
}

/** #489: how many merges (release candidates) came after the last stable release. */
const mergesSinceStable = (history) => candidatesSinceStable(history).length;

// the candidates since the last stable up to the one dated `upTo` (all of them without it)
const candidatesUpTo = (history, upTo) => candidatesSinceStable(history).filter((c) => !upTo || String(c.date || '') <= String(upTo));

/** #489: the issues of the candidates since the last stable release (up to the candidate dated `upTo`), each once, by number. */
function issuesSinceStable(history, upTo = null) {
  const found = new Map();
  for (const c of candidatesUpTo(history, upTo)) for (const i of c.issues || []) if (i?.number && !found.has(Number(i.number))) found.set(Number(i.number), i);
  return [...found.values()].sort((a, b) => Number(a.number) - Number(b.number));
}

/** #489: a candidate's tag, `vX.Y.Z-rc.N` (N: the merges since the last stable). */
const rcTag = ({ version, mergesSinceStable: n }) => `v${String(version || '').trim().replace(/^v/i, '')}-rc.${Number(n) || 1}`;

/**
 * #489: the stable version of a promotion: the owner's `version` when given, else
 * packages/shared/release-version.js's suggestion over the issues since the last stable release (up to
 * the candidate dated `upTo`, the one promoted).
 * @returns {{ version: string, bump: string|null }}
 */
function stableVersion({ history, version = '', upTo = null } = {}) {
  const own = String(version || '').trim();
  if (own) return { version: own, bump: null };
  const s = suggestVersion({ last: lastRelease(history)?.version || '', issues: issuesSinceStable(history, upTo) });
  return { version: s.version, bump: s.bump };
}

/**
 * #489: records the release candidate of a push of the base (`commit`, its tip): its tag is
 * rcTag over `version` (package.json's) and the merges since the last stable plus this one. A
 * commit already recorded is kept as it is. Returns the candidate.
 * @param {{ commit: string, version: string, runId?: string|null, issues?: object[], date?: string }} c
 */
function recordCandidate(dir, projectId, { commit, version, runId = null, issues = [], date = null }) {
  if (!commit || !String(version || '').trim()) throw new Error('A release candidate needs a commit and a version.');
  const h = readReleases(dir, projectId);
  const list = objects(h.candidates);
  const known = list.find((c) => c.commit === commit);
  if (known) return known;
  const tag = rcTag({ version, mergesSinceStable: mergesSinceStable(h) + 1 });
  const cand = { tag, commit, date: date || new Date().toISOString(), runId, issues: objects(issues) };
  writeReleases(dir, projectId, { ...h, candidates: [...list, cand] });
  return cand;
}

/** #489: puts a release candidate on Hold (the train never promotes it) or takes it off. */
function holdCandidate(dir, projectId, tag, held = true) {
  const h = readReleases(dir, projectId);
  const list = objects(h.candidates);
  if (!list.some((c) => c.tag === tag)) throw new Error(`There is no release candidate ${tag || '(no tag)'}: refresh the Releases screen.`);
  const candidates = list.map((c) => {
    if (c.tag !== tag) return c;
    const { held: _, ...rest } = c;
    return held ? { ...rest, held: true } : rest;
  });
  return writeReleases(dir, projectId, { ...h, candidates });
}

/**
 * #489: promotes the release candidate of `commit` to the stable release, without a rebuild:
 * `tagCommit({ tag, commit })` tags that same commit vX.Y.Z (the git boundary, injected), then the
 * stable release is recorded with the issues since the last stable. A commit without a candidate
 * is refused before anything is tagged.
 * @param {{ dir: string, projectId: string, commit: string, version?: string, tagCommit: Function, date?: string }} o
 * @returns {Promise<{ tag, version, commit, rc }>}
 */
async function promoteRelease({ dir, projectId, commit, version = '', tagCommit, date = null }) {
  const h = readReleases(dir, projectId);
  const cand = objects(h.candidates).find((c) => commit && c.commit === commit);
  if (!cand) throw new Error(`The commit ${String(commit || '(none)').slice(0, 8)} has no release candidate (rc): only a merge built as an rc can be promoted. Refresh the Releases screen and promote a listed candidate.`);
  const v = stableVersion({ history: h, version, upTo: cand.date }).version;
  const tag = tagName(`v${String(v).replace(/^v/i, '')}`);
  if (!tag) throw new Error('A promotion needs a stable version (e.g. 1.3.0).');
  if (h.releases.some((r) => r.tag === tag)) throw new Error(`The stable release ${tag} already exists: choose another version.`);
  // what the candidate's commit holds: the candidates since the last stable up to it
  const issues = issuesSinceStable(h, cand.date);
  const runs = [...new Set(candidatesUpTo(h, cand.date).map((c) => c.runId).filter(Boolean))];
  await tagCommit({ tag, commit });
  recordRelease(dir, projectId, {
    version: tag, tag, date: date || new Date().toISOString(), commit, rc: cand.tag, issues, runs,
    notes: releaseNotes({ version: tag, issues, runs }),
  });
  return { tag, version: tag, commit, rc: cand.tag };
}

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
 * @param {{ listCards: Function, updateCard: Function }} store the discovery card store (packages/engine/domains/discovery/discovery.js, #256)
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
  const tags = await tagsAt(root, name, commit);
  const result = await pushBase({ repo: root, base });
  if (result.rejected) throw new Error(`origin/${base} has commits the local ${base} has not: update the local ${base} (Backlog › Update and push), then ship again. Nothing was tagged.`);
  if (result.noRemote) throw new Error(`${result.reason} Nothing was tagged.`); // #73
  // #861: a local-folder origin left untouched (uncommitted changes or a diverged base there): no tag without the base
  if (!result.pushed && result.commands?.length) throw new Error(`${result.reason} Nothing was tagged.`);
  await pushTag(root, name, commit, tags);
  return { tag: name, base, commit, pushed: !!result.pushed, commits: result.commits, issues: result.issues };
}

// The commits the tag names here and on origin ({ local, remote }, null when missing); a tag that
// already names another commit is refused.
async function tagsAt(root, name, commit) {
  const local = await git(['rev-parse', '--verify', '--quiet', `refs/tags/${name}^{commit}`], root).catch(() => null);
  const remote = await remoteTag(root, name);
  const taken = [local, remote].find((sha) => sha && sha !== commit);
  if (taken) throw new Error(`The tag ${name} already names another commit (${taken.slice(0, 8)}, an earlier release or Ship): choose another release name. Nothing was pushed this time.`);
  return { local, remote };
}

// Tags the commit (when the tag is missing here) and pushes the tag (when origin lacks it).
async function pushTag(root, name, commit, { local, remote }) {
  if (!local) await git(['tag', name, commit], root);
  if (!remote) await git(['push', 'origin', `refs/tags/${name}:refs/tags/${name}`], root, { timeout: PUSH_TIMEOUT_MS, auth: true });
}

/**
 * #489: the promotion's git boundary (promoteRelease's tagCommit): tags `commit` (a release candidate
 * already on origin) and pushes only the tag; .github/workflows/deploy.yml then turns the rc's GitHub
 * release into the stable one, without a rebuild. The base is never pushed.
 * @param {{ repo: string, tag: string, commit: string }} o
 */
async function tagRelease({ repo, tag, commit }) {
  const name = tagName(tag);
  const root = await repoRoot(repo);
  if (!root) throw new Error(`${repo || '(no folder)'} is not a git repository.`);
  await git(['check-ref-format', `refs/tags/${name}`], root).catch(() => { throw new Error(`"${name}" is not a valid tag name.`); });
  const sha = await git(['rev-parse', '--verify', '--quiet', `${commit}^{commit}`], root).catch(() => null);
  if (!sha) throw new Error(`The commit ${String(commit).slice(0, 8)} of the release candidate is not in ${root}: update the local base first. Nothing was tagged.`);
  await pushTag(root, name, sha, await tagsAt(root, name, sha));
  return { tag: name, commit: sha };
}

// The commit a tag names on origin (an annotated tag peeled), or null when origin has no such tag.
async function remoteTag(root, name) {
  const out = await git(['ls-remote', '--tags', 'origin', `refs/tags/${name}`, `refs/tags/${name}^{}`], root, { timeout: PUSH_TIMEOUT_MS, auth: true });
  const lines = out.split('\n').map((l) => l.trim().split(/\s+/)).filter((l) => l[1]);
  return (lines.find((l) => l[1].endsWith('^{}')) || lines[0])?.[0] || null;
}

const LOCKFILES = ['npm-shrinkwrap.json', 'package-lock.json'];

// Where each value of a (valid) JSON text sits, by key path (JSON of the path array): { start, end,
// key } (key: where its member's key starts), so a value is replaced without reformatting the file.
function jsonSpans(text) {
  const spans = new Map();
  let i = 0;
  const ws = () => { while (/\s/.test(text[i])) i++; };
  const str = () => {
    const s = i++;
    while (text[i] !== '"') i += text[i] === '\\' ? 2 : 1;
    return JSON.parse(text.slice(s, ++i));
  };
  const value = (p, key) => {
    ws();
    const start = i;
    if (text[i] === '{' || text[i] === '[') {
      const close = text[i++] === '{' ? '}' : ']';
      ws();
      if (text[i] === close) i++;
      else for (let n = 0; ; n++) {
        ws();
        const at = i;
        let k = n;
        if (close === '}') { k = str(); ws(); i++; }
        value([...p, k], at);
        ws();
        if (text[i++] === close) break;
      }
    } else if (text[i] === '"') str();
    else while (i < text.length && !/[\s,}\]]/.test(text[i])) i++;
    spans.set(JSON.stringify(p), { start, end: i, key });
  };
  value([], 0);
  return spans;
}

// `text` with each [start, end, replacement] applied (spans of the original text).
const applyEdits = (text, edits) => edits.sort((a, b) => b[0] - a[0]).reduce((t, [s, e, r]) => t.slice(0, s) + r + t.slice(e), text);

// The edits that set package.json's `version` (added after `name`, or first, when missing).
function packageEdits(text, version) {
  const spans = jsonSpans(text);
  const at = spans.get('["version"]');
  if (at) return [[at.start, at.end, JSON.stringify(version)]];
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const members = [...spans.entries()].filter(([k]) => JSON.parse(k).length === 1).map(([, s]) => s);
  if (!members.length) return [[spans.get('[]').start, spans.get('[]').end, `{ "version": ${JSON.stringify(version)} }`]];
  const first = members.sort((a, b) => a.key - b.key)[0];
  const indent = text.slice(text.lastIndexOf('\n', first.key) + 1, first.key);
  const line = indent.trim() ? ' ' : eol + indent;
  const name = spans.get('["name"]');
  return name
    ? [[name.end, name.end, `,${line}"version": ${JSON.stringify(version)}`]]
    : [[first.key, first.key, `"version": ${JSON.stringify(version)},${line}`]];
}

// A detached worktree gets `branch` before the version commit (a branch of that name is left as it is).
async function ensureBranch(dir, branch) {
  if (!branch || await git(['symbolic-ref', '-q', 'HEAD'], dir).catch(() => null)) return;
  const exists = await git(['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`], dir).catch(() => null);
  if (!exists) await git(['switch', '-c', branch], dir);
}

/**
 * #325: before the suites, a release run writes the release's version into the project folder's
 * package.json (`version`, added when missing) and, when present, the root `version` and
 * `packages[""].version` of package-lock.json / npm-shrinkwrap.json, then commits them on the branch
 * checked out in `dir` (a detached worktree first gets `branch`). Nothing else changes: formatting,
 * key order and line endings are kept, no npm, workspace packages untouched. Nothing is written (with
 * a `reason`) when the name is not a semver, there is no package.json, the file already names the
 * version or a higher one (never downgrades); a mock run only says what it would set. Throws only
 * when git fails (the engine's step logs it and the release goes on).
 * @param {{ dir: string, version: string, mock?: boolean, branch?: string }} o
 * @returns {Promise<{ written: boolean, from: string|null, to: string|null, files: string[], commit: string|null, reason: string }>}
 */
async function writeReleaseVersion({ dir, version, mock = false, branch = null }) {
  const out = { written: false, from: null, to: releaseSemver(version), files: [], commit: null, reason: '' };
  const pkgFile = path.join(String(dir || ''), 'package.json');
  if (!out.to) return { ...out, reason: `The release's name "${version || ''}" is not a semver version (e.g. 1.2.0 or v1.2.0): package.json is left as it is.` };
  if (!dir || !fs.existsSync(pkgFile)) return { ...out, reason: 'The project has no package.json: no version is written (only Node projects get one).' };
  const texts = { 'package.json': fs.readFileSync(pkgFile, 'utf8') };
  let pkg;
  try { pkg = JSON.parse(texts['package.json']); } catch (e) { return { ...out, reason: `package.json is not valid JSON (${e.message}): its version is left as it is.` }; }
  out.from = typeof pkg.version === 'string' ? pkg.version : null;
  if (out.from === out.to) return { ...out, reason: `package.json already names ${out.to}.` };
  if (out.from && SEMVER.test(out.from) && compareSemver(out.to, out.from) < 0) return { ...out, reason: `The release ${out.to} is lower than package.json's ${out.from}: the version is never downgraded.` };
  const edits = { 'package.json': packageEdits(texts['package.json'], out.to) };
  for (const name of LOCKFILES) {
    const file = path.join(dir, name);
    if (!fs.existsSync(file)) continue;
    texts[name] = fs.readFileSync(file, 'utf8');
    let spans;
    try { JSON.parse(texts[name]); spans = jsonSpans(texts[name]); } catch { continue; }
    edits[name] = [['version'], ['packages', '', 'version']].map((p) => spans.get(JSON.stringify(p)))
      .filter((s) => s && texts[name][s.start] === '"').map((s) => [s.start, s.end, JSON.stringify(out.to)]);
  }
  out.files = Object.keys(edits).filter((name) => edits[name].length);
  const change = `package.json ${out.from || '(no version)'} → ${out.to}`;
  if (mock) return { ...out, reason: `Simulation: nothing written; a real run would set ${change} (${out.files.join(', ')}).` };
  await ensureBranch(dir, branch);
  for (const name of out.files) fs.writeFileSync(path.join(dir, name), applyEdits(texts[name], edits[name]));
  try {
    await git(['add', '--', ...out.files], dir);
    await git([...(await identityArgs(dir)), 'commit', '-q', '--no-verify', '-m', `Release ${out.to}: package.json version`, '--', ...out.files], dir);
  } catch (e) {
    // nothing left half-done: an uncommitted change would stop Ship's local merge
    for (const name of out.files) fs.writeFileSync(path.join(dir, name), texts[name]);
    await git(['reset', '-q', '--', ...out.files], dir).catch(() => {});
    throw e;
  }
  return { ...out, written: true, commit: await git(['rev-parse', 'HEAD'], dir), reason: `Set ${change} and committed it.` };
}

// ---------- products (#46) ----------

/**
 * The product a release of the checkout `dir` is of: the one asked by its id, or the only one declared;
 * null when the repository declares none (released as it always was, whatever was asked). Throws, naming the products, when it cannot tell.
 */
function productOf(dir, id = '') {
  if (!dir) return null;
  const { products, productErrors } = readManifest(dir);
  if (productErrors.length) throw new Error(`The repository's products cannot be read: ${productErrors.join(' ')} Fix them, then release.`);
  if (!products.length) return null;
  const asked = String(id || '').trim();
  const names = products.map((p) => p.id).join(', ');
  if (asked && !products.some((p) => p.id === asked)) throw new Error(`The repository declares no product "${asked}": choose one of ${names}.`);
  if (!asked && products.length > 1) throw new Error(`The repository declares several products (${names}): choose the one to release (the Product input).`);
  return products.find((p) => !asked || p.id === asked) || null;
}

/** The product the Releases screen and the roadmap's cut lines release: the one tagged vX.Y.Z, else the first; null without products. */
const mainProduct = (products) => (products || []).find((p) => ['v', ''].includes(p.tag_prefix)) || products?.[0] || null;

// The semver a release of the product is named by (1.2.0, v1.2.0 or its own tag), or null
function productSemver(product, name) {
  const asked = String(name || '').trim();
  const rest = asked.startsWith(product.tag_prefix) ? asked.slice(product.tag_prefix.length) : asked;
  return releaseSemver(asked) || (SEMVER.test(rest) ? rest : null);
}

/** The tag of a product's release (its prefix and the version), or null when the name is not a semver. */
function productTag(product, name) {
  const version = productSemver(product, name);
  return version ? `${product.tag_prefix}${version}` : null;
}

// The product's last tag below `version`, or null; a pre-release is not the last release of a stable one.
async function lastProductTag(dir, product, version) {
  const versions = (await git(['tag', '--list'], dir)).split(/\r?\n/).filter((t) => t.startsWith(product.tag_prefix)).map((t) => t.slice(product.tag_prefix.length));
  const older = versions.filter((v) => SEMVER.test(v) && compareSemver(v, version) < 0 && (SEMVER.exec(version)[4] || !SEMVER.exec(v)[4]));
  const last = older.sort(compareSemver).at(-1);
  return last ? `${product.tag_prefix}${last}` : null;
}

const productFolders = (product) => [product.folder, ...product.paths];

// The issues the pending changesets (.changeset/<slug>-<issue>.md, or #n in the text) are about, of the
// product's packages (one that names no package, or of a product without package.json, counts too);
// null when the repository has no changesets.
function changesetIssues(dir, product) {
  const folder = path.join(dir, '.changeset');
  if (!fs.existsSync(folder)) return null;
  const own = productFolders(product).map((f) => { try { return JSON.parse(fs.readFileSync(path.join(dir, f, 'package.json'), 'utf8')).name; } catch { return null; } }).filter(Boolean);
  const found = new Set();
  for (const file of fs.readdirSync(folder).filter((f) => f.endsWith('.md') && f !== 'README.md')) {
    const text = fs.readFileSync(path.join(folder, file), 'utf8');
    const front = /^---\r?\n([\s\S]*?)\r?\n?---/.exec(text)?.[1] || '';
    const names = [...front.matchAll(/^\s*(['"]?)([^'":\s]+)\1\s*:/gm)].map((m) => m[2]);
    if (own.length && names.length && !names.some((n) => own.includes(n))) continue;
    const number = /-(\d+)\.md$/.exec(file);
    for (const n of [...(number ? [Number(number[1])] : []), ...issuesOf(text)]) found.add(n);
  }
  return found;
}

// What the product's release holds: its last tag (`previous_version`, '' without one), the issues its
// commits since then close (`issues`), those with no changeset (`missing_changesets`) and the
// repository's newest commits since that tag (`history`).
async function sinceLastRelease(dir, product, version) {
  const previous = await lastProductTag(dir, product, version);
  const range = previous ? `refs/tags/${previous}..HEAD` : 'HEAD';
  const commits = await closingCommits(dir, ['--no-merges', range, '--', ...productFolders(product).map((f) => `:(literal)${f}`)]);
  const issues = [...new Set(commits.flatMap((c) => c.issues))].sort((a, b) => a - b);
  const covered = changesetIssues(dir, product);
  return {
    previous_version: previous || '',
    issues,
    missing_changesets: covered ? issues.filter((n) => !covered.has(n)) : [],
    history: await git(['log', '--oneline', '--no-decorate', '-n', String(HISTORY_LINES), range], dir),
  };
}

const untracked = async (dir) => (await git(['ls-files', '-z', '--others', '--exclude-standard'], dir)).split('\0').filter(Boolean);

// Runs the product's version command in the run's worktree and commits every file it changed on
// `branch`; a command that fails, commits by itself or writes another version leaves the worktree as it was.
async function commitProductVersion({ dir, product, to, branch, run }) {
  const dirty = await git(['diff', '--name-only', 'HEAD'], dir);
  if (dirty) throw new Error(`The run's worktree has uncommitted changes (${dirty.split('\n').slice(0, 5).join(', ')}): the version command of ${product.id} was not run.`);
  const head = await git(['rev-parse', 'HEAD'], dir);
  const before = new Set(await untracked(dir));
  const added = async () => (await untracked(dir)).filter((f) => !before.has(f));
  try {
    const r = await run(product.version_command, { cwd: dir });
    if (r.exit_code !== 0) throw new Error(`The version command of ${product.id} (${product.version_command}) failed (exit code ${r.exit_code}): ${String(r.output || '').trim().slice(-1000)}`);
    if (await git(['rev-parse', 'HEAD'], dir) !== head) throw new Error(`The version command of ${product.id} (${product.version_command}) made a commit: it must only write the files, the run commits them.`);
    const wrote = projectVersion(path.join(dir, product.folder))?.version || 'no version';
    if (wrote !== to) throw new Error(`The release asks for ${product.id} ${to}, but its version command (${product.version_command}) leaves it at ${wrote}: release ${wrote}, or change what the command reads (e.g. the changesets).`);
    const files = [...(await git(['diff', '--name-only', '-z', 'HEAD'], dir)).split('\0').filter(Boolean), ...(await added())];
    await ensureBranch(dir, branch);
    await git(['--literal-pathspecs', 'add', '-A', '--', ...files], dir);
    await git([...(await identityArgs(dir)), 'commit', '-q', '--no-verify', '-m', `Release ${product.id} ${to}`], dir);
    return { files, commit: await git(['rev-parse', 'HEAD'], dir) };
  } catch (e) {
    await git(['reset', '-q', '--hard', head], dir).catch(() => {});
    for (const f of await added().catch(() => [])) fs.rmSync(path.join(dir, f), { recursive: true, force: true });
    throw e;
  }
}

/**
 * #46: the version of a product's release, before the suites: its own command writes it and the run
 * commits what it changed; a product that has the version already is released as it is (no command,
 * no commit, no changeset asked for). Throws, so the run stops before the suites, when the name is not
 * a semver, the product has no version file, the version is lower (never a downgrade), its tag is
 * taken, the command fails or the version it wrote is not the one asked. `run` runs a command (the
 * machine adapter's runAction); a mock run reads only and says what a real one would do.
 * @param {{ dir: string, product: any, version: string, mock?: boolean, branch?: string|null, run?: Function }} o
 */
async function writeProductVersion({ dir, product, version, mock = false, branch = null, run = null }) {
  const to = productSemver(product, version);
  if (!to) throw new Error(`A release of ${product.id} needs a semver version (e.g. 1.2.0): "${version || ''}" is not one.`);
  const now = projectVersion(path.join(dir, product.folder));
  if (!now) throw new Error(`The product ${product.id} has no version in ${product.folder} (package.json or pyproject.toml): its release cannot be checked.`);
  const from = now.version;
  if (SEMVER.test(from) && compareSemver(to, from) < 0) throw new Error(`The release ${product.id} ${to} is lower than its version ${from}: the version is never downgraded.`);
  const tag = `${product.tag_prefix}${to}`;
  const tagged = await git(['rev-parse', '--verify', '--quiet', `refs/tags/${tag}^{commit}`], dir).catch(() => null);
  if (tagged && (from !== to || tagged !== await git(['rev-parse', 'HEAD'], dir))) throw new Error(`The tag ${tag} already names another commit (${tagged.slice(0, 8)}): choose another version of ${product.id}.`);
  const file = path.posix.join(product.folder, now.file);
  const out = { product: product.id, tag, tag_prefix: product.tag_prefix, folder: product.folder, written: false, from, to, files: [], commit: null, ...(await sinceLastRelease(dir, product, to)) };
  if (from === to) return { ...out, missing_changesets: [], change: '', reason: `${product.id} is at ${to} already: released as it is, without a version commit.` };
  const change = `${file} ${from} → ${to}`;
  if (mock) return { ...out, files: [file], change, reason: `Simulation: nothing run or written; a real run would set ${change} with ${product.version_command}.` };
  const done = await commitProductVersion({ dir, product, to, branch, run });
  return { ...out, ...done, written: true, change, reason: `Set ${change} with ${product.version_command} and committed it.` };
}

/**
 * The next release (pure): what merged locally since the last one.
 * @param {{ history?: object, runs?: object[], local?: { commits?: { sha, subject, issues }[], issues?: number[] } | null, issues?: { number, title }[], version?: string }} o
 *   runs: the project's runs (packages/engine/domains/run/runs.js listRuns); local: its commits not pushed (backlog.readLocal);
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
  const labels = new Map((issues || []).filter((i) => i.labels?.length).map((i) => [Number(i.number), i.labels]));
  const found = new Map();
  for (const r of merged) for (const i of r.issues || []) if (i?.number && !found.has(Number(i.number))) found.set(Number(i.number), i.title || titles.get(Number(i.number)) || '');
  for (const n of local?.issues || []) if (!found.has(Number(n))) found.set(Number(n), titles.get(Number(n)) || '');
  // #436: the labels the Releases screen's "Suggest version" reads (only when the backlog has some)
  const list = [...found].map(([number, title]) => (labels.has(number) ? { number, title, labels: labels.get(number) } : { number, title })).sort((a, b) => a.number - b.number);
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
  candidatesSinceStable,
  compareSemver,
  historyError,
  historyText,
  holdCandidate,
  issuesSinceStable,
  lastRelease,
  mainProduct,
  markReleased,
  mergesSinceStable,
  nextRelease,
  productOf,
  productTag,
  promoteRelease,
  // #861: the push of the local base a ship does, for a Local run's push_main (the machine adapter's one
  // way into the domains, scripts/layers.js EXCEPTIONS)
  pushBase,
  rcTag,
  readReleases,
  recordCandidate,
  recordRelease,
  releaseCards,
  releaseNotes,
  releaseSemver,
  releasesFile,
  saveNextNotes,
  shipRelease,
  stableVersion,
  tagName,
  tagRelease,
  testResults,
  writeProductVersion,
  writeReleaseVersion,
};
