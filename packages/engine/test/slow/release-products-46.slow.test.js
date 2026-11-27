// #46: a release run of one product of a repository that declares several in .craftorio/project.yaml.
// Whole runs of workflows/release.yaml on scratch repositories with a local bare `origin` (no network,
// no model: the suites are green at once, so no agent step runs). The runs are real ones, with their
// own worktree, unless the test is about the simulation or a prompt.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { WorkflowRun } = require('../../engine/workflow');

process.env.CRAFTORIO_MOCK_DELAY_SCALE = '0.02';
// No user git config (identity, hooks, aliases), as on CI; the run commits for real.
const emptyConfig = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'gitcfg-')), 'config');
fs.writeFileSync(emptyConfig, '');
Object.assign(process.env, {
  GIT_CONFIG_GLOBAL: emptyConfig, GIT_CONFIG_NOSYSTEM: '1',
  GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t',
});

const WORKFLOW = path.join(__dirname, '..', '..', '..', '..', 'workflows', 'release.yaml');
// 2 minutes: a macOS CI runner took 86 s for one of these (v1.1.0's Deploy); Linux takes ~20 s
const LIMIT = { timeout: 120000 };

const git = (cwd, ...args) => execFileSync('git', ['-c', 'init.defaultBranch=main', '-c', 'core.autocrlf=false', ...args], { cwd, stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim();
const json = (o) => `${JSON.stringify(o, null, 2)}\n`;

// A product's own version command, as a project would write it: the pending changesets of the product
// (`.changeset/<slug>-<issue>.md`, which name its package) bump its package.json and its changelog and
// are deleted; with none it changes nothing.
const BUMP = `const fs = require('fs');
const path = require('path');
const folder = process.argv[2];
const file = path.join(folder, 'package.json');
const pkg = JSON.parse(fs.readFileSync(file, 'utf8'));
const mine = fs.readdirSync('.changeset').filter((f) => f.endsWith('.md') && fs.readFileSync(path.join('.changeset', f), 'utf8').includes(JSON.stringify(pkg.name) + ': minor'));
if (!mine.length) process.exit(0);
const [major, minor] = pkg.version.split('.').map(Number);
pkg.version = [major, minor + 1, 0].join('.');
fs.writeFileSync(file, JSON.stringify(pkg, null, 2) + '\\n');
fs.appendFileSync(path.join(folder, 'CHANGELOG.md'), '## ' + pkg.version + '\\n');
for (const f of mine) fs.rmSync(path.join('.changeset', f));
`;
const product = (id, folder, prefix) => `  - id: ${id}\n    folder: ${folder}\n    tag_prefix: "${prefix}"\n    version_command: node bump.js ${folder}\n`;
const APP = product('desk-app', 'apps/desk', 'v');
const ENGINE = product('engine', 'engine', 'engine-v');
// a pending changeset of the package `desk` (the app's) or `motor` (the engine's)
const changeset = (name) => `---\n"${name}": minor\n---\n\nA change users see.\n`;
const manifest = (...products) => ({ '.craftorio/project.yaml': `version: 1\nproducts:\n${products.join('')}` });

// the unit suite of every scratch project: green; it notes the commit and the versions it ran on
const suite = (log) => `const fs = require('fs');
const version = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')).version; } catch { return null; } };
const head = require('child_process').execFileSync('git', ['rev-parse', 'HEAD']).toString().trim();
fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify({ head, root: version('package.json'), app: version('apps/desk/package.json'), engine: version('engine/package.json') }) + '\\n');
`;

// origin (bare) + repo (main checked out, everything on origin)
function project(t, files) {
  const tmp = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'release-46-')));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 5 }));
  const f = { tmp, origin: path.join(tmp, 'origin.git'), repo: path.join(tmp, 'repo'), log: path.join(tmp, 'unit.log') };
  git(tmp, 'init', '-q', '--bare', f.origin);
  git(tmp, 'clone', '-q', f.origin, f.repo);
  git(f.repo, 'checkout', '-q', '-b', 'main');
  f.commit = (message, changes) => {
    for (const [name, text] of Object.entries(changes)) {
      fs.mkdirSync(path.dirname(path.join(f.repo, name)), { recursive: true });
      fs.writeFileSync(path.join(f.repo, name), text);
    }
    git(f.repo, 'add', '-A');
    git(f.repo, 'commit', '-q', '-m', message);
    return git(f.repo, 'rev-parse', 'HEAD');
  };
  f.push = (...refs) => git(f.repo, 'push', '-q', 'origin', 'main', ...refs);
  f.originRef = (ref) => git(f.origin, 'rev-parse', `${ref}^{commit}`);
  f.originTags = () => git(f.origin, 'tag').split('\n').filter(Boolean);
  f.originFile = (name) => { try { return git(f.origin, 'show', `main:${name}`); } catch { return null; } };
  f.unitRuns = () => (fs.existsSync(f.log) ? fs.readFileSync(f.log, 'utf8').trim().split('\n').map((l) => JSON.parse(l)) : []);
  f.commit('base', { 'check.js': suite(f.log), ...files });
  f.push();
  return f;
}

const pending = { '.changeset/fast-app-11.md': changeset('desk'), '.changeset/fast-engine-12.md': changeset('motor') };
// two products at 1.0.0, each tagged on origin, and one changeset each merged since (`changesets`)
function twoProducts(t, { tags = ['v1.0.0', 'engine-v1.0.0'], changesets = pending } = {}) {
  const f = project(t, {
    ...manifest(APP, ENGINE),
    'bump.js': BUMP,
    'package.json': json({ name: 'mono', private: true, version: '1.0.0' }),
    'apps/desk/package.json': json({ name: 'desk', version: '1.0.0' }),
    'engine/package.json': json({ name: 'motor', version: '1.0.0' }),
    '.changeset/README.txt': 'pending changes\n',
  });
  for (const tag of tags) git(f.repo, 'tag', tag);
  f.push(...tags);
  if (Object.keys(changesets).length) f.commit('Merged since the last releases', { ...changesets, 'apps/desk/a.js': '1\n', 'engine/b.js': '1\n' });
  return f;
}

// A release run: the ship gate is answered Ship and ship_failed `Try again` (`onGate` before each answer)
async function release(f, { inputs = {}, mock = false, mockSequences = undefined, onGate = () => {} } = {}) {
  const run = new WorkflowRun({
    file: WORKFLOW,
    inputs: { task: 'Release', repo_path: f.repo, base_branch: 'main', unit_command: 'node check.js', e2e_suite: 'skip', ...inputs },
    runsDir: path.join(f.tmp, 'runs'),
    ...(mock ? { mock: true, mockSequences } : { worktreesDir: path.join(f.tmp, 'worktrees') }),
  });
  const events = [];
  const gates = [];
  run.on('event', (ev) => {
    events.push(ev);
    if (ev.type !== 'approval.requested') return;
    gates.push(ev);
    onGate(ev);
    // ship_failed is tried again once, then stopped; any other gate ends the run
    const answers = { ship: 'ship', ship_failed: gates.filter((g) => g.step_id === 'ship_failed').length > 1 ? 'stop' : 'retry' };
    const answer = answers[ev.step_id] ?? ev.choices?.at(-1)?.id ?? false;
    setImmediate(() => run.resolveApproval(ev.approval_id, answer, 'user', ''));
  });
  // a step that stops the run may reject start(); the run's end is read from its events either way
  await run.start().catch(() => {});
  const finished = events.find((e) => e.type === 'workflow.finished');
  const started = events.filter((e) => e.type === 'step.started').map((e) => e.step_id);
  return {
    run, events, gates, started, finished, status: run.status,
    shipGate: gates.find((g) => g.step_id === 'ship'),
    prompts: (id) => events.filter((e) => e.type === 'session.message_sent' && e.step_id === id).map((e) => String(e.prompt || '')),
    // what the run told its owner, one string per message
    said: [finished?.error, ...events.map((e) => (e.type === 'step.finished' ? JSON.stringify(e.output ?? '') : e.type === 'log' || e.type === 'approval.requested' ? e.message : ''))].filter(Boolean).map(String),
  };
}

const why = (r) => `status ${r.status}, steps ${r.started.join(' > ')}, error ${r.finished?.error}`;
const gateSaid = (r, id) => r.gates.filter((g) => g.step_id === id).map((g) => g.message).join('\n');
const times = (r, id) => r.started.filter((s) => s === id).length;
// refs and files of both repositories, to prove that a run left them alone
const snapshot = (f) => JSON.stringify([
  git(f.origin, 'for-each-ref'), git(f.repo, 'for-each-ref'), git(f.repo, 'rev-parse', 'HEAD'), git(f.repo, 'status', '--porcelain', '--untracked-files=all'),
]);
// the run stopped before the suites and nothing left the machine
function assertStopped(f, r, before) {
  assert.equal(r.status, 'failed', why(r));
  assert.equal(r.started.includes('unit'), false, 'no suite ran');
  assert.equal(r.shipGate === undefined, true, 'no Ship gate');
  assert.equal(git(f.origin, 'for-each-ref'), before, 'origin is untouched');
  assert.equal(git(f.repo, 'tag').split('\n').includes('engine-v1.1.0'), false, 'no tag was made');
}

// ---------- no product declared ----------

test('#46 a repository without products is released as today: the version in package.json, the tag is the input as it is', LIMIT, async (t) => {
  const f = project(t, { 'package.json': json({ name: 'solo', version: '0.3.0' }) });
  const r = await release(f, { inputs: { version: '1.2.0' } });
  assert.equal(r.status, 'success', why(r));
  assert.deepEqual(f.originTags(), ['1.2.0']);
  assert.equal(JSON.parse(f.originFile('package.json')).version, '1.2.0');
  assert.equal(f.unitRuns().length, 1);
  assert.equal(f.unitRuns()[0].root, '1.2.0', 'the suite ran on the version commit');
  assert.equal(f.originRef('1.2.0'), f.unitRuns()[0].head, 'the tag is on the commit the suite passed on');
  assert.equal(f.originRef('main'), f.originRef('1.2.0'));
});

// ---------- the product, its version and its tag ----------

test('#46 releasing the engine: its own command writes its version and changelog before the suites; only engine-v1.1.0 is pushed', LIMIT, async (t) => {
  const f = twoProducts(t);
  // a tag the owner has only locally is not this release's
  git(f.repo, 'tag', 'v1.0.1-local');
  const r = await release(f, { inputs: { product: 'engine', version: '1.1.0' } });
  assert.equal(r.status, 'success', why(r));
  const [unit] = f.unitRuns();
  assert.equal(unit.engine, '1.1.0', 'the suite ran on the engine\'s new version');
  assert.deepEqual(f.originTags().sort(), ['engine-v1.0.0', 'engine-v1.1.0', 'v1.0.0']);
  assert.equal(f.originRef('engine-v1.1.0'), unit.head, 'the tag is on the commit the suite passed on');
  assert.equal(f.originRef('main'), unit.head, 'the local base went to origin');
  assert.equal(JSON.parse(f.originFile('engine/package.json')).version, '1.1.0');
  assert.match(String(f.originFile('engine/CHANGELOG.md')), /1\.1\.0/);
  assert.equal(f.originFile('.changeset/fast-engine-12.md'), null, 'its changeset is consumed');
  assert.deepEqual([JSON.parse(f.originFile('package.json')).version, JSON.parse(f.originFile('apps/desk/package.json')).version], ['1.0.0', '1.0.0'], 'the app is not bumped');
  assert.equal(f.originFile('.changeset/fast-app-11.md') !== null, true, 'the app\'s changeset waits for its own release');
});

test('#46 releasing the app: its own command writes its version; the tag is v1.1.0 and the engine is not bumped', LIMIT, async (t) => {
  const f = twoProducts(t);
  const r = await release(f, { inputs: { product: 'desk-app', version: 'v1.1.0' } });
  assert.equal(r.status, 'success', why(r));
  assert.deepEqual(f.originTags().sort(), ['engine-v1.0.0', 'v1.0.0', 'v1.1.0']);
  assert.equal(f.unitRuns()[0].app, '1.1.0');
  assert.equal(f.originRef('v1.1.0'), f.unitRuns()[0].head);
  assert.equal(JSON.parse(f.originFile('engine/package.json')).version, '1.0.0');
  assert.equal(f.originFile('.changeset/fast-engine-12.md') !== null, true);
});

test('#46 a repository with one product releases it without being asked which', LIMIT, async (t) => {
  const f = project(t, { ...manifest(ENGINE), 'bump.js': BUMP, 'package.json': json({ name: 'mono', private: true, version: '5.0.0' }), 'engine/package.json': json({ name: 'motor', version: '1.0.0' }), '.changeset/fast-engine-12.md': changeset('motor') });
  git(f.repo, 'tag', 'engine-v1.0.0');
  f.push('engine-v1.0.0');
  const r = await release(f, { inputs: { version: '1.1.0' } });
  assert.equal(r.status, 'success', why(r));
  assert.deepEqual(f.originTags().sort(), ['engine-v1.0.0', 'engine-v1.1.0']);
  assert.equal(JSON.parse(f.originFile('engine/package.json')).version, '1.1.0');
  assert.equal(JSON.parse(f.originFile('package.json')).version, '5.0.0', 'the root is not the product\'s');
});

test('#46 two products and none chosen: the run stops before the suites and names them', LIMIT, async (t) => {
  const f = twoProducts(t);
  const before = git(f.origin, 'for-each-ref');
  const r = await release(f, { inputs: { version: '1.1.0' } });
  assertStopped(f, r, before);
  assert.equal(r.said.some((s) => /desk-app/.test(s) && /\bengine\b/.test(s)), true, `the products are named: ${r.said.join(' | ')}`);
});

test('#46 a product the repository does not declare: the run stops before the suites and names the ones it has', LIMIT, async (t) => {
  const f = twoProducts(t);
  const before = git(f.origin, 'for-each-ref');
  const r = await release(f, { inputs: { product: 'ghost', version: '1.1.0' } });
  assertStopped(f, r, before);
  assert.equal(r.said.some((s) => /ghost/.test(s) && /desk-app/.test(s) && /\bengine\b/.test(s)), true, `the products are named: ${r.said.join(' | ')}`);
});

test('#46 the command wrote another version than the one asked: the run stops before the suites and says both', LIMIT, async (t) => {
  const f = twoProducts(t);
  const before = git(f.origin, 'for-each-ref');
  const r = await release(f, { inputs: { product: 'engine', version: '1.4.0' } });
  assertStopped(f, r, before);
  assert.equal(r.said.some((s) => s.includes('1.4.0') && s.includes('1.1.0')), true, `both versions are said: ${r.said.join(' | ')}`);
  assert.equal(git(f.repo, 'tag').includes('engine-v1.4.0'), false);
  assert.equal(JSON.parse(fs.readFileSync(path.join(f.repo, 'engine', 'package.json'), 'utf8')).version, '1.0.0', 'the project\'s own checkout is untouched');
});

// ---------- the first release, a retry ----------

test('#46 first release: a product with no tag that has the asked version already is released as it is, without changeset or version commit', LIMIT, async (t) => {
  const f = twoProducts(t, { tags: [], changesets: {} });
  const base = git(f.repo, 'rev-parse', 'HEAD');
  const r = await release(f, { inputs: { product: 'engine', version: '1.0.0' } });
  assert.equal(r.status, 'success', why(r));
  assert.deepEqual(f.originTags(), ['engine-v1.0.0']);
  assert.equal(f.originRef('engine-v1.0.0'), base, 'no version commit: the tag is on the base');
  assert.equal(f.originRef('main'), base);
});

test('#46 Try again after a Ship that pushed the base and not the tag repeats nothing', LIMIT, async (t) => {
  const f = twoProducts(t);
  const hook = path.join(f.origin, 'hooks', 'update');
  fs.mkdirSync(path.dirname(hook), { recursive: true });
  fs.writeFileSync(hook, '#!/bin/sh\ncase "$1" in refs/tags/*) echo "no tags now" >&2; exit 1;; esac\nexit 0\n');
  fs.chmodSync(hook, 0o755);
  let partial = null;
  const r = await release(f, {
    inputs: { product: 'engine', version: '1.1.0' },
    onGate: (g) => {
      if (g.step_id !== 'ship_failed') return;
      partial = { main: f.originRef('main'), tags: f.originTags() };
      fs.rmSync(hook);
    },
  });
  assert.equal(r.status, 'success', why(r));
  assert.equal(partial === null, false, 'the first Ship failed at the tag');
  assert.deepEqual(partial.tags.sort(), ['engine-v1.0.0', 'v1.0.0']);
  assert.equal(f.originRef('main'), partial.main, 'the base was pushed once');
  assert.deepEqual(f.originTags().sort(), ['engine-v1.0.0', 'engine-v1.1.0', 'v1.0.0']);
  assert.equal(f.originRef('engine-v1.1.0'), partial.main);
  assert.equal(git(f.origin, 'log', '--format=%H', 'main', '--', 'engine/CHANGELOG.md').split('\n').length, 1, 'one version commit');
  assert.deepEqual([times(r, 'version'), times(r, 'unit')], [1, 1]);
});

test('#46 a tag of the product that only origin has, on another commit: Ship refuses it and pushes nothing', LIMIT, async (t) => {
  const f = twoProducts(t);
  git(f.repo, 'tag', 'engine-v1.1.0', 'v1.0.0');
  f.push('engine-v1.1.0');
  git(f.repo, 'tag', '-d', 'engine-v1.1.0');
  const before = git(f.origin, 'for-each-ref');
  const r = await release(f, { inputs: { product: 'engine', version: '1.1.0' } });
  assert.equal(r.status, 'failed', why(r));
  assert.match(gateSaid(r, 'ship_failed'), /engine-v1\.1\.0 already names another commit/);
  assert.equal(git(f.origin, 'for-each-ref'), before, 'origin is untouched');
});

test('#46 a product that is the whole repository (folder: .) is released with its issues since its last tag', LIMIT, async (t) => {
  const f = project(t, { ...manifest(product('solo', '.', 'v')), 'bump.js': BUMP, 'package.json': json({ name: 'solo', version: '1.0.0' }), '.changeset/README.txt': 'pending changes\n' });
  git(f.repo, 'tag', 'v1.0.0');
  f.commit('Covered work\n\nCloses #4651', { 'src/a.js': '1\n', '.changeset/covered-4651.md': changeset('solo') });
  f.commit('Forgotten work\n\nCloses #4652', { 'src/b.js': '1\n' });
  f.push('v1.0.0');
  const r = await release(f, { inputs: { version: '1.1.0' } });
  assert.equal(r.status, 'success', why(r));
  assert.deepEqual(f.originTags().sort(), ['v1.0.0', 'v1.1.0']);
  assert.equal(JSON.parse(f.originFile('package.json')).version, '1.1.0');
  assert.match(gateSaid(r, 'ship'), /#4652\b/);
  assert.doesNotMatch(gateSaid(r, 'ship'), /#4651\b/);
});

// ---------- since the last release ----------

// an engine tag, engine work after it, then a newer tag of the app; `engineTag: false`: no engine tag
function history(t, { engineTag = true } = {}) {
  const f = twoProducts(t, { tags: engineTag ? ['engine-v1.0.0'] : [], changesets: {} });
  f.commit('Faster engine start (#21)\n\nCloses #21', { 'engine/fast.js': '1\n', '.changeset/fast-engine-21.md': changeset('motor') });
  f.commit('App colours (#22)\n\nCloses #22', { 'apps/desk/colours.js': '1\n' });
  git(f.repo, 'tag', 'v7.0.0');
  f.push('v7.0.0');
  return f;
}
// a first red unit suite calls the (simulated) developer, then the review runs
const REVIEWED = { mock: true, mockSequences: { suite: { unit: ['fail', 'pass'] } } };

test('#46 the review compares with the product\'s own last tag; another product\'s newer tag is not its last release', LIMIT, async (t) => {
  const f = history(t);
  const r = await release(f, { inputs: { product: 'engine', version: '1.1.0' }, ...REVIEWED });
  assert.equal(r.status, 'success', why(r));
  const prompt = r.prompts('review').join('\n');
  assert.equal(prompt.includes('engine-v1.0.0'), true, 'the engine\'s last tag is in the review');
  assert.equal(prompt.includes('v7.0.0'), false, 'the app\'s tag is not');
  assert.equal(prompt.includes('Faster engine start'), true, 'what came after the engine\'s tag is in the review');
  assert.equal(r.finished.outputs?.previous_version, 'engine-v1.0.0');
});

test('#46 a product with no tag: the review gets the repository\'s history and the run has no previous version', LIMIT, async (t) => {
  const f = history(t, { engineTag: false });
  const r = await release(f, { inputs: { product: 'engine', version: '1.1.0' }, ...REVIEWED });
  assert.equal(r.status, 'success', why(r));
  const prompt = r.prompts('review').join('\n');
  assert.equal(prompt.includes('v7.0.0'), false, 'another product\'s tag is not the last release');
  assert.equal(prompt.includes('Faster engine start'), true, 'the history is in the review');
  assert.equal(r.finished.outputs?.previous_version, '');
});

// ---------- missing changesets ----------

test('#46 merged issues of the product with no changeset are said before the suites and in the Ship gate; the owner can ship anyway', LIMIT, async (t) => {
  const f = twoProducts(t, { changesets: {} });
  f.commit('Covered engine work (#31)\n\nCloses #31', { 'engine/covered.js': '1\n', '.changeset/covered-31.md': changeset('motor') });
  f.commit('Forgotten engine work (#4632)\n\nCloses #4632', { 'engine/forgotten.js': '1\n' });
  f.commit('Forgotten app work (#4633)\n\nCloses #4633', { 'apps/desk/forgotten.js': '1\n' });
  f.push();
  const r = await release(f, { inputs: { product: 'engine', version: '1.1.0' } });
  assert.equal(r.status, 'success', why(r));
  const unitAt = r.events.findIndex((e) => e.type === 'step.started' && e.step_id === 'unit');
  const early = r.events.slice(0, unitAt).filter((e) => e.type === 'log' || e.type === 'step.finished').map((e) => JSON.stringify(e));
  assert.equal(early.some((s) => s.includes('#4632')), true, 'the issue is listed before the suites');
  assert.match(r.shipGate.message, /#4632\b/);
  // (all three are on origin already: the gate's "Not on origin yet" does not name them)
  assert.doesNotMatch(r.shipGate.message, /#4633\b/, 'the other product\'s issue is not this release\'s');
  assert.doesNotMatch(r.shipGate.message, /#31\b/, 'an issue with a changeset is not missing one');
  assert.equal(f.originTags().includes('engine-v1.1.0'), true);
});

test('#46 issues merged before the product\'s last tag are not missing a changeset', LIMIT, async (t) => {
  const f = twoProducts(t, { tags: ['v1.0.0'], changesets: {} });
  f.commit('Older engine work (#4641)\n\nCloses #4641', { 'engine/older.js': '1\n' });
  git(f.repo, 'tag', 'engine-v1.0.0');
  f.commit('A changeset of no issue', { '.changeset/quiet-hills.md': changeset('motor') });
  f.commit('Newer engine work (#4642)\n\nCloses #4642', { 'engine/newer.js': '1\n' });
  f.push('engine-v1.0.0');
  const r = await release(f, { inputs: { product: 'engine', version: '1.1.0' } });
  assert.equal(r.status, 'success', why(r));
  assert.match(r.shipGate.message, /#4642\b/);
  assert.doesNotMatch(r.shipGate.message, /#4641\b/);
});

// ---------- simulation ----------

for (const [id, tag] of [['desk-app', 'v1.1.0'], ['engine', 'engine-v1.1.0']]) {
  test(`#46 a simulated release of ${id} reaches the Ship gate with the tag ${tag} and writes, tags and pushes nothing`, LIMIT, async (t) => {
    const f = twoProducts(t);
    const before = snapshot(f);
    const r = await release(f, { inputs: { product: id, version: '1.1.0' }, mock: true, mockSequences: { suite: { unit: ['pass'] } } });
    assert.equal(r.status, 'success', why(r));
    assert.equal(r.shipGate.message.includes(`\`${tag}\``), true, `the Ship gate names the tag ${tag}: ${r.shipGate.message}`);
    assert.equal(snapshot(f), before, 'both repositories are as they were');
  });
}
