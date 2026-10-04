// #238: archive issues from the Backlog. Acceptance tests, written before the code: archiving closes
// the issue on the platform (GitHub: not planned) and labels it `archived` (the label is created with
// a neutral colour when the repository lacks it); restoring reopens it and removes the label; a planned
// issue (roadmap item planned or running) or one with a run in progress is refused with its reason; a
// failure is per issue and leaves it as it was. The Product Owner and the roadmap ignore archived
// issues, and the retired `deprioritized` label is gone from the skills.
//
// Seams this file expects (src/backlog.js, next to issueCloseCommand; `exec` is execCli's signature,
// the system boundary, so gh/glab are never started here):
//   archiveIssues({ platform, repo, numbers, issues, dir, projectId, exec }) -> Promise<{ results: [{ number, ok, error? }] }>
//     `issues`: the Backlog's issues with their links (the service's withIssueRuns: `roadmap`
//     { stage, status }, `runs` [{ status }]) for the guards; `dir`/`projectId`: the backlog cache,
//     where each archived issue is at once closed with the `archived` label (it leaves the Open view).
//     Never throws for one issue: a refusal or a CLI failure is that issue's { ok: false, error }.
//   restoreIssues({ platform, repo, numbers, dir, projectId, exec }) -> Promise<{ results: [{ number, ok, error? }] }>
// The guard's reason text comes from src/renderer/views/backlog/backlog-archive.js
// archiveBlockReason (see test/renderer-backlog-archive.test.js): "Planned in stage 41: remove it
// from the roadmap first".
// Product Owner: backlogReport leaves archived issues out, even when they are in the owner's selection.
// Roadmap: saveStages refuses an archived issue; propose leaves it out (the rest of the proposal stays).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const productOwner = require('../src/product-owner');
const roadmaps = require('../src/roadmap');

const ROOT = path.join(__dirname, '..');
const loadBacklog = () => require('../src/backlog');

function tmp(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'archive-238-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

const GH_REPO = 'https://github.com/o/r';
const GL_REPO = 'https://gitlab.com/g/r';
const label = (name) => ({ name, color: null });
const openIssue = (number, extra = {}) => ({ number, title: `Issue ${number}`, state: 'open', url: `${GH_REPO}/issues/${number}`, body: 'Do it', labels: [], assignees: [], tasks: { done: 0, total: 0 }, ...extra });
const archivedIssue = (number, extra = {}) => openIssue(number, { state: 'closed', labels: [label('archived')], ...extra });

// The backlog cache of project `demo` with these issues (what a sync writes).
function writeCache(dir, issues, { platform = 'github', repo = GH_REPO } = {}) {
  fs.writeFileSync(path.join(dir, 'demo.json'), JSON.stringify({ projectId: 'demo', platform, repo, issues }));
}
const cached = (dir, number) => JSON.parse(fs.readFileSync(path.join(dir, 'demo.json'), 'utf8')).issues.find((i) => i.number === number);
const hasArchived = (issue) => (issue.labels || []).some((l) => String(l?.name ?? l).toLowerCase() === 'archived');

// A fake gh/glab: records every call and keeps each issue's state and labels, so a re-read
// (`issue view`) answers what the earlier calls did. `fail(cli, args)` returns an Error to throw.
function fakePlatform({ platform = 'github', labels = ['bug'], issues = {}, fail = () => null } = {}) {
  const calls = [];
  const state = new Map(Object.entries(issues).map(([n, s]) => [Number(n), { state: s.state || 'open', labels: [...(s.labels || [])] }]));
  const of = (n) => {
    if (!state.has(n)) state.set(n, { state: 'open', labels: [] });
    return state.get(n);
  };
  const flag = (args, name) => { const at = args.indexOf(name); return at >= 0 ? args[at + 1] : null; };
  const exec = async (cli, args) => {
    calls.push([cli, ...args]);
    const err = fail(cli, args);
    if (err) throw err;
    const [what, verb, num] = args;
    const n = Number(num);
    if (what === 'label' && verb === 'list') return JSON.stringify(labels.map((name) => ({ name })));
    if (what === 'label' && verb === 'create') { labels.push(args[2] === '--name' ? args[3] : args[2]); return ''; }
    if (what !== 'issue') return '';
    if (verb === 'close') of(n).state = 'closed';
    if (verb === 'reopen') of(n).state = 'open';
    if (verb === 'edit' || verb === 'update') {
      const add = flag(args, '--add-label') || flag(args, '--label');
      const remove = flag(args, '--remove-label') || flag(args, '--unlabel');
      if (add) of(n).labels = [...new Set([...of(n).labels, ...add.split(',')])];
      if (remove) of(n).labels = of(n).labels.filter((l) => !remove.split(',').includes(l));
    }
    if (verb === 'view') {
      const s = of(n);
      return platform === 'github'
        ? JSON.stringify({ number: n, title: `Issue ${n}`, state: s.state === 'open' ? 'OPEN' : 'CLOSED', labels: s.labels.map((name) => ({ name, color: 'ededed' })), url: `${GH_REPO}/issues/${n}`, author: { login: 'a' }, assignees: [], body: 'Do it', createdAt: 'c', updatedAt: 'u' })
        : JSON.stringify({ iid: n, title: `Issue ${n}`, state: s.state === 'open' ? 'opened' : 'closed', labels: s.labels, web_url: `${GL_REPO}/-/issues/${n}`, author: { username: 'a' }, assignees: [], description: 'Do it', created_at: 'c', updated_at: 'u' });
    }
    return '';
  };
  return { exec, calls, state };
}

const called = (calls, expected) => calls.some((c) => JSON.stringify(c) === JSON.stringify(expected));
// any call that acts on issue `n` (issue close/edit/update/reopen/comment <n>)
const touched = (calls, n) => calls.some((c) => c[1] === 'issue' && c[2] !== 'list' && c[2] !== 'view' && c[3] === String(n));
const labelAdds = (calls, n) => calls.filter((c) => c[1] === 'issue' && c[3] === String(n) && (c.includes('--add-label') || (c[0] === 'glab' && c[2] === 'update' && c.includes('--label')))).length;
const labelRemoves = (calls, n) => calls.filter((c) => c[1] === 'issue' && c[3] === String(n) && (c.includes('--remove-label') || c.includes('--unlabel'))).length;

function archiveFn() {
  const { archiveIssues } = loadBacklog();
  assert.equal(typeof archiveIssues, 'function', 'src/backlog.js exports archiveIssues');
  return archiveIssues;
}
function restoreFn() {
  const { restoreIssues } = loadBacklog();
  assert.equal(typeof restoreIssues, 'function', 'src/backlog.js exports restoreIssues');
  return restoreIssues;
}

// ---- archive: close + label, per platform ------------------------------------------------------

test('archiveIssues (GitHub): one issue is closed as not planned and labelled archived; the cache shows it closed and archived at once', async (t) => {
  const archiveIssues = archiveFn();
  const dir = tmp(t);
  const issues = [openIssue(12), openIssue(13)];
  writeCache(dir, issues);
  const gh = fakePlatform({ labels: ['bug', 'archived'] });

  const res = await archiveIssues({ platform: 'github', repo: GH_REPO, numbers: [12], issues, dir, projectId: 'demo', exec: gh.exec });

  assert.deepEqual(res.results, [{ number: 12, ok: true }]);
  assert.ok(called(gh.calls, ['gh', 'issue', 'close', '12', '--repo', 'o/r', '--reason', 'not planned']), JSON.stringify(gh.calls));
  assert.ok(called(gh.calls, ['gh', 'issue', 'edit', '12', '--repo', 'o/r', '--add-label', 'archived']), JSON.stringify(gh.calls));
  assert.equal(touched(gh.calls, 13), false, 'the other issue is left alone');
  // the label existed: none is created
  assert.equal(gh.calls.filter((c) => c[1] === 'label' && c[2] === 'create').length, 0);
  const c12 = cached(dir, 12);
  assert.equal(c12.state, 'closed');
  assert.ok(hasArchived(c12), 'the cached issue carries the archived label');
  assert.equal(cached(dir, 13).state, 'open');
});

test('archiveIssues (GitHub): several issues each get closed and labelled; a missing `archived` label is created once, with a neutral colour', async (t) => {
  const archiveIssues = archiveFn();
  const dir = tmp(t);
  const issues = [openIssue(12), openIssue(15)];
  writeCache(dir, issues);
  const gh = fakePlatform({ labels: ['bug'] });

  const res = await archiveIssues({ platform: 'github', repo: GH_REPO, numbers: [12, 15], issues, dir, projectId: 'demo', exec: gh.exec });

  assert.deepEqual(res.results, [{ number: 12, ok: true }, { number: 15, ok: true }]);
  for (const n of ['12', '15']) {
    assert.ok(called(gh.calls, ['gh', 'issue', 'close', n, '--repo', 'o/r', '--reason', 'not planned']), `close #${n}`);
    assert.ok(called(gh.calls, ['gh', 'issue', 'edit', n, '--repo', 'o/r', '--add-label', 'archived']), `label #${n}`);
  }
  const creates = gh.calls.filter((c) => c[0] === 'gh' && c[1] === 'label' && c[2] === 'create');
  assert.equal(creates.length, 1, 'the label is created once, not per issue');
  const [create] = creates;
  assert.equal(create[3], 'archived');
  assert.ok(create.includes('--repo') && create[create.indexOf('--repo') + 1] === 'o/r');
  const color = String(create[create.indexOf('--color') + 1] || '').replace(/^#/, '');
  assert.match(color, /^[0-9a-f]{6}$/i, 'a hex colour');
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(color.slice(i, i + 2), 16));
  assert.ok(Math.max(r, g, b) - Math.min(r, g, b) <= 0x10, `a neutral (grey) colour, got #${color}`);
  // the label is created before an issue gets it
  const createdAt = gh.calls.indexOf(create);
  const firstLabel = gh.calls.findIndex((c) => c.includes('--add-label'));
  assert.ok(createdAt < firstLabel);
  assert.ok(hasArchived(cached(dir, 12)) && hasArchived(cached(dir, 15)));
});

test('archiveIssues (GitLab): each issue is closed and labelled archived with glab', async (t) => {
  const archiveIssues = archiveFn();
  const dir = tmp(t);
  const issues = [openIssue(12, { url: `${GL_REPO}/-/issues/12` }), openIssue(15, { url: `${GL_REPO}/-/issues/15` })];
  writeCache(dir, issues, { platform: 'gitlab', repo: GL_REPO });
  const gl = fakePlatform({ platform: 'gitlab' });

  const res = await archiveIssues({ platform: 'gitlab', repo: GL_REPO, numbers: [12, 15], issues, dir, projectId: 'demo', exec: gl.exec });

  assert.deepEqual(res.results, [{ number: 12, ok: true }, { number: 15, ok: true }]);
  for (const n of ['12', '15']) {
    assert.ok(called(gl.calls, ['glab', 'issue', 'close', n, '--repo', 'g/r']), `close #${n}: ${JSON.stringify(gl.calls)}`);
    assert.ok(called(gl.calls, ['glab', 'issue', 'update', n, '--repo', 'g/r', '--label', 'archived']), `label #${n}`);
  }
  assert.equal(gl.calls.some((c) => c[0] === 'gh'), false, 'gh is never called for GitLab');
  assert.equal(cached(dir, 12).state, 'closed');
  assert.ok(hasArchived(cached(dir, 15)));
});

// ---- guards ----------------------------------------------------------------------------------

test('archiveIssues: an issue planned in the roadmap is refused with its reason and never reaches the CLI; the others still go through', async (t) => {
  const archiveIssues = archiveFn();
  const dir = tmp(t);
  const issues = [openIssue(12), openIssue(20, { roadmap: { stage: 41, name: 'Stage 41', status: 'planned', itemId: 'item-1' } })];
  writeCache(dir, issues);
  const gh = fakePlatform({ labels: ['archived'] });

  const res = await archiveIssues({ platform: 'github', repo: GH_REPO, numbers: [12, 20], issues, dir, projectId: 'demo', exec: gh.exec });

  assert.deepEqual(res.results, [
    { number: 12, ok: true },
    { number: 20, ok: false, error: 'Planned in stage 41: remove it from the roadmap first' },
  ]);
  assert.equal(touched(gh.calls, 20), false, 'nothing is sent for the planned issue');
  assert.equal(cached(dir, 20).state, 'open');
  assert.equal(hasArchived(cached(dir, 20)), false);
});

test('archiveIssues: an issue whose roadmap item is running, or with a run in progress, is refused too', async (t) => {
  const archiveIssues = archiveFn();
  const dir = tmp(t);
  const issues = [
    openIssue(21, { roadmap: { stage: 3, name: 'Stage 3', status: 'running', itemId: 'item-2' } }),
    openIssue(22, { runs: [{ runId: '20261004-010101-abcd1234', workflow: 'software-development', status: 'running', mock: false }] }),
    openIssue(23, { roadmap: { stage: 1, name: 'Stage 1', status: 'done', itemId: 'item-3' }, runs: [{ runId: 'old', status: 'success', mock: false }] }),
  ];
  writeCache(dir, issues);
  const gh = fakePlatform({ labels: ['archived'] });

  const res = await archiveIssues({ platform: 'github', repo: GH_REPO, numbers: [21, 22, 23], issues, dir, projectId: 'demo', exec: gh.exec });
  const by = Object.fromEntries(res.results.map((r) => [r.number, r]));

  assert.equal(by[21].ok, false);
  assert.match(by[21].error, /stage 3/);
  assert.match(by[21].error, /roadmap/);
  assert.equal(by[22].ok, false);
  assert.match(by[22].error, /\brun\b/i);
  // a finished roadmap item and a finished run do not block
  assert.equal(by[23].ok, true);
  assert.equal(touched(gh.calls, 21), false);
  assert.equal(touched(gh.calls, 22), false);
  assert.ok(called(gh.calls, ['gh', 'issue', 'close', '23', '--repo', 'o/r', '--reason', 'not planned']));
});

// ---- failures ----------------------------------------------------------------------------------

test('archiveIssues: a failure on one of three is reported for that issue, leaves it as it was, and the other two still go through', async (t) => {
  const archiveIssues = archiveFn();
  const dir = tmp(t);
  const issues = [openIssue(12), openIssue(15), openIssue(18)];
  writeCache(dir, issues);
  const gh = fakePlatform({
    labels: ['archived'],
    fail: (cli, args) => (args[0] === 'issue' && args[2] === '15' && ['close', 'edit'].includes(args[1])
      ? new Error('gh issue close failed: HTTP 403: Resource not accessible by integration') : null),
  });

  const res = await archiveIssues({ platform: 'github', repo: GH_REPO, numbers: [12, 15, 18], issues, dir, projectId: 'demo', exec: gh.exec });
  const by = Object.fromEntries(res.results.map((r) => [r.number, r]));

  assert.deepEqual(res.results.map((r) => r.number), [12, 15, 18]);
  assert.equal(by[12].ok, true);
  assert.equal(by[18].ok, true);
  assert.equal(by[15].ok, false);
  assert.match(by[15].error, /HTTP 403/);
  // #15 is left as it was: open on the platform, no archived label kept, open in the cache
  assert.equal(gh.state.get(15)?.state ?? 'open', 'open');
  assert.equal(labelAdds(gh.calls, 15) - labelRemoves(gh.calls, 15) <= 0, true, 'no archived label left on #15');
  assert.equal(cached(dir, 15).state, 'open');
  assert.equal(hasArchived(cached(dir, 15)), false);
  assert.equal(cached(dir, 12).state, 'closed');
  assert.equal(cached(dir, 18).state, 'closed');
});

test('archiveIssues: a missing CLI is reported per issue (no exception), and nothing changes in the cache', async (t) => {
  const archiveIssues = archiveFn();
  const dir = tmp(t);
  const issues = [openIssue(12), openIssue(15)];
  writeCache(dir, issues);
  const exec = async () => { throw new Error('The gh CLI is not installed (see Settings › Agents & CLIs).'); };

  const res = await archiveIssues({ platform: 'github', repo: GH_REPO, numbers: [12, 15], issues, dir, projectId: 'demo', exec });

  assert.deepEqual(res.results.map((r) => [r.number, r.ok]), [[12, false], [15, false]]);
  for (const r of res.results) assert.match(r.error, /gh CLI is not installed/);
  assert.equal(cached(dir, 12).state, 'open');
  assert.equal(cached(dir, 15).state, 'open');
});

// ---- restore -----------------------------------------------------------------------------------

test('restoreIssues (GitHub): reopens the issue and removes the archived label; the cache shows it open, without the label', async (t) => {
  const restoreIssues = restoreFn();
  const dir = tmp(t);
  writeCache(dir, [archivedIssue(12), archivedIssue(13)]);
  const gh = fakePlatform({ labels: ['archived'], issues: { 12: { state: 'closed', labels: ['archived'] }, 13: { state: 'closed', labels: ['archived'] } } });

  const res = await restoreIssues({ platform: 'github', repo: GH_REPO, numbers: [12], dir, projectId: 'demo', exec: gh.exec });

  assert.deepEqual(res.results, [{ number: 12, ok: true }]);
  assert.ok(called(gh.calls, ['gh', 'issue', 'reopen', '12', '--repo', 'o/r']), JSON.stringify(gh.calls));
  assert.ok(called(gh.calls, ['gh', 'issue', 'edit', '12', '--repo', 'o/r', '--remove-label', 'archived']), JSON.stringify(gh.calls));
  assert.equal(touched(gh.calls, 13), false);
  const c12 = cached(dir, 12);
  assert.equal(c12.state, 'open');
  assert.equal(hasArchived(c12), false);
  assert.equal(cached(dir, 13).state, 'closed');
});

test('restoreIssues (GitLab): reopens the issue and removes the archived label with glab', async (t) => {
  const restoreIssues = restoreFn();
  const dir = tmp(t);
  writeCache(dir, [archivedIssue(12, { url: `${GL_REPO}/-/issues/12` })], { platform: 'gitlab', repo: GL_REPO });
  const gl = fakePlatform({ platform: 'gitlab', issues: { 12: { state: 'closed', labels: ['archived'] } } });

  const res = await restoreIssues({ platform: 'gitlab', repo: GL_REPO, numbers: [12], dir, projectId: 'demo', exec: gl.exec });

  assert.deepEqual(res.results, [{ number: 12, ok: true }]);
  assert.ok(called(gl.calls, ['glab', 'issue', 'reopen', '12', '--repo', 'g/r']), JSON.stringify(gl.calls));
  assert.ok(called(gl.calls, ['glab', 'issue', 'update', '12', '--repo', 'g/r', '--unlabel', 'archived']), JSON.stringify(gl.calls));
  assert.equal(cached(dir, 12).state, 'open');
  assert.equal(hasArchived(cached(dir, 12)), false);
});

test('restoreIssues: a failure is reported for that issue and leaves it archived; the others are restored', async (t) => {
  const restoreIssues = restoreFn();
  const dir = tmp(t);
  writeCache(dir, [archivedIssue(12), archivedIssue(15)]);
  const gh = fakePlatform({
    labels: ['archived'],
    issues: { 12: { state: 'closed', labels: ['archived'] }, 15: { state: 'closed', labels: ['archived'] } },
    fail: (cli, args) => (args[0] === 'issue' && args[2] === '15' ? new Error('gh issue reopen failed: error connecting to api.github.com') : null),
  });

  const res = await restoreIssues({ platform: 'github', repo: GH_REPO, numbers: [12, 15], dir, projectId: 'demo', exec: gh.exec });
  const by = Object.fromEntries(res.results.map((r) => [r.number, r]));

  assert.equal(by[12].ok, true);
  assert.equal(by[15].ok, false);
  assert.match(by[15].error, /error connecting/);
  assert.equal(cached(dir, 15).state, 'closed');
  assert.ok(hasArchived(cached(dir, 15)));
  assert.equal(cached(dir, 12).state, 'open');
});

// ---- the Product Owner ignores archived issues ---------------------------------------------------

test('backlogReport: an archived issue (closed, label archived) is not in the report, even when the owner selected it; a plain closed selection still is', () => {
  const data = {
    projectId: 'demo',
    issues: [
      { number: 1, state: 'open', title: 'Open work item', labels: [], body: 'a' },
      { number: 12, state: 'closed', title: 'Shelved idea', labels: [label('archived')], body: 'b' },
      { number: 13, state: 'closed', title: 'Closed old work', labels: [], body: 'c' },
    ],
  };
  const plain = productOwner.backlogReport({ data, workflows: [] });
  assert.match(plain, /#1 Open work item/);
  assert.doesNotMatch(plain, /Shelved idea/);

  const selected = productOwner.backlogReport({ data, workflows: [], selection: [12, 13] });
  assert.doesNotMatch(selected, /Shelved idea/, 'an archived issue is left out even when attached');
  assert.doesNotMatch(selected, /#12\b/);
  assert.match(selected, /### #13 Closed old work \(closed: leave it out\)/, 'a closed (not archived) attached issue is still shown, marked');
});

// ---- the roadmap ignores archived issues --------------------------------------------------------

test('roadmap saveStages: an archived issue cannot be added to a stage (the error names it and says it is archived)', (t) => {
  const dir = tmp(t);
  const issues = [openIssue(1), archivedIssue(12)];
  assert.throws(
    () => roadmaps.saveStages(dir, 'demo', [{ name: 'One', items: [{ workflow: 'software-development.yaml', number: 12 }] }], { issues }),
    (e) => /#12/.test(e.message) && /archived/i.test(e.message),
  );
  // an open issue is still accepted
  const saved = roadmaps.saveStages(dir, 'demo', [{ name: 'One', items: [{ workflow: 'software-development.yaml', number: 1 }] }], { issues });
  assert.deepEqual(saved.stages.flatMap((s) => s.items.map((x) => x.number)), [1]);
});

test('roadmap propose: an archived issue is left out of a Product Owner proposal; the rest of it is added', (t) => {
  const dir = tmp(t);
  const issues = [openIssue(1), openIssue(2), archivedIssue(12), archivedIssue(13)];
  const { roadmap } = roadmaps.propose(dir, 'demo', {
    stages: [
      { name: 'First', items: [{ workflow: 'software-development.yaml', issues: [1, 12] }] },
      { name: 'Second', items: [{ workflow: 'software-development.yaml', issues: [13] }, { workflow: 'software-development.yaml', issues: [2] }] },
    ],
  }, { issues });
  const planned = roadmap.stages.flatMap((s) => s.items.flatMap((x) => (x.issues || []).map((i) => i.number)));
  assert.deepEqual(planned.sort((a, b) => a - b), [1, 2]);
});

// ---- the retired `deprioritized` label is gone from the skills ---------------------------------------

test('skills: issue-creator (gh, gl) and the Product Owner skill do not mention the retired `deprioritized` label', () => {
  for (const skill of ['issue-creator-gh', 'issue-creator-gl', 'backlog-product-owner']) {
    const folder = path.join(ROOT, 'skills', skill);
    assert.ok(fs.existsSync(path.join(folder, 'SKILL.md')), `${skill}/SKILL.md exists`);
    const files = fs.readdirSync(folder, { recursive: true }).filter((f) => /\.md$/i.test(String(f)));
    for (const f of files) {
      assert.doesNotMatch(fs.readFileSync(path.join(folder, String(f)), 'utf8'), /depriorit/i, `${skill}/${f}`);
    }
  }
});
