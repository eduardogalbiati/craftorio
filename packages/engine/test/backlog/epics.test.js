// Epics (#138, packages/engine/domains/backlog/epics.js): the level above the issue read on every backlog sync. typedEpics finds
// GitHub issues whose issue type is "Epic" (any state, since a closed epic must keep its progress);
// readEpics groups members (GitHub sub-issues, GitLab group epics or epic::<slug> labels) with their
// progress; applyEpic creates an epic and/or links members, writing to the platform only when it is
// not a preview.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const epics = require('../../domains/backlog/epics');

function tmp(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'epics-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

// A fake CLI runner routed by a substring of the joined args; records every call.
function fakeExec(routes) {
  const calls = [];
  const exec = async (cli, args) => {
    calls.push([cli, ...args]);
    const joined = args.join(' ');
    for (const [match, out] of routes) if (joined.includes(match)) return typeof out === 'function' ? out(args) : out;
    return '';
  };
  return { exec, calls };
}

// ---- typedEpics: the gh api call shape -----------------------------------------------------------

test('typedEpics: reads every issue state, paginated, and keeps only numbers typed "Epic"', async () => {
  const { exec, calls } = fakeExec([['issues?state=all', '5 9\n']]);
  const set = await epics.typedEpics({ platform: 'github', repo: 'https://github.com/o/r', exec });
  assert.deepEqual([...set].sort(), [5, 9]);
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], 'gh');
  assert.ok(calls[0].includes('--paginate'));
  assert.ok(calls[0].some((a) => a.includes('repos/o/r/issues?state=all&per_page=100')));
});

test('typedEpics: a repository without issue types (or a failed call) gives an empty set, not an error', async () => {
  const exec = async () => { throw new Error('gh: unknown field type.name'); };
  const set = await epics.typedEpics({ platform: 'github', repo: 'https://github.com/o/r', exec });
  assert.deepEqual([...set], []);
});

// ---- readEpics: GitHub -----------------------------------------------------------------------------

test('readEpics: a CLOSED GitHub issue typed Epic (no epic label) still lists with its sub-issues and progress', async () => {
  const issues = [
    { number: 1, state: 'closed', title: 'Theme epic', labels: [], url: 'https://github.com/o/r/issues/1' },
    { number: 2, state: 'open', title: 'Child A', labels: [], url: 'https://github.com/o/r/issues/2' },
    { number: 3, state: 'closed', title: 'Child B', labels: [], url: 'https://github.com/o/r/issues/3' },
  ];
  const { exec } = fakeExec([
    ['issues?state=all', '1\n'],
    ['sub_issues', JSON.stringify([{ number: 2 }, { number: 3 }])],
  ]);
  const { issues: out, epics: list, epicsError } = await epics.readEpics({ platform: 'github', repo: 'https://github.com/o/r', issues, exec });
  assert.equal(epicsError, null);
  assert.equal(list.length, 1);
  assert.deepEqual(list[0], {
    id: '#1', number: 1, kind: 'issue', title: 'Theme epic', url: 'https://github.com/o/r/issues/1', state: 'closed',
    members: [2, 3], progress: { open: 1, closed: 1, total: 2 },
  });
  assert.equal(out.find((i) => i.number === 1).isEpic, true);
  assert.equal(out.find((i) => i.number === 2).epic, '#1');
  assert.equal(out.find((i) => i.number === 3).epic, '#1');
});

test('readEpics: an "epic" label works without issue types, and an issue in no epic carries neither field', async () => {
  const issues = [
    { number: 10, state: 'open', title: 'UI epic', labels: [{ name: 'epic' }], url: 'u10' },
    { number: 11, state: 'open', title: 'Member', labels: [], url: 'u11' },
    { number: 12, state: 'open', title: 'On its own', labels: [], url: 'u12' },
  ];
  const { exec } = fakeExec([
    ['issues?state=all', ''],
    ['sub_issues', JSON.stringify([{ number: 11 }])],
  ]);
  const { issues: out, epics: list } = await epics.readEpics({ platform: 'github', repo: 'https://github.com/o/r', issues, exec });
  assert.equal(list.length, 1);
  assert.equal(out.find((i) => i.number === 11).epic, '#10');
  assert.equal('epic' in out.find((i) => i.number === 12), false);
  assert.equal('isEpic' in out.find((i) => i.number === 12), false);
});

test('readEpics: GitHub, a failed sub-issues read for one epic leaves it with no members and a note, not a failed sync', async () => {
  const issues = [{ number: 20, state: 'open', title: 'Broken epic', labels: [{ name: 'epic' }], url: 'u20' }];
  const exec = async () => { throw new Error('gh api failed: HTTP 502'); };
  const { epics: list, epicsError } = await epics.readEpics({ platform: 'github', repo: 'https://github.com/o/r', issues, exec });
  assert.equal(list.length, 1);
  assert.deepEqual(list[0].members, []);
  assert.match(epicsError, /HTTP 502/);
});

// ---- readEpics: GitLab ------------------------------------------------------------------------------

test('readEpics: GitLab group epics group their issues by iid, with progress', async () => {
  const groupEpic = { iid: 3, title: 'Run safety', groupId: 44, url: 'https://gitlab.com/groups/g/-/epics/3' };
  const issues = [
    { number: 100, state: 'open', title: 'A', labels: [], url: 'u100', groupEpic },
    { number: 101, state: 'closed', title: 'B', labels: [], url: 'u101', groupEpic },
  ];
  const { issues: out, epics: list } = await epics.readEpics({ platform: 'gitlab', repo: 'https://gitlab.com/g/r', issues, exec: async () => '' });
  assert.equal(list.length, 1);
  assert.equal(list[0].id, '&3');
  assert.deepEqual(list[0].members, [100, 101]);
  assert.deepEqual(list[0].progress, { open: 1, closed: 1, total: 2 });
  assert.equal(out.find((i) => i.number === 100).epic, '&3');
  assert.equal('groupEpic' in out[0], false); // stripped from the output
});

test('readEpics: GitLab without group epics groups members by the scoped epic::<slug> label', async () => {
  const issues = [
    { number: 200, state: 'open', title: 'Run safety epic', labels: ['epic', 'epic::run-safety'], url: 'u200' },
    { number: 201, state: 'open', title: 'Member', labels: ['epic::run-safety'], url: 'u201' },
    { number: 202, state: 'open', title: 'Other theme', labels: ['epic::other'], url: 'u202' },
  ];
  const { issues: out, epics: list } = await epics.readEpics({ platform: 'gitlab', repo: 'https://gitlab.com/g/r', issues, exec: async () => '' });
  assert.equal(list.length, 1); // only one issue is labelled "epic"
  assert.deepEqual(list[0].members, [201]);
  assert.equal(out.find((i) => i.number === 201).epic, '#200');
  assert.equal('epic' in out.find((i) => i.number === 202), false); // its theme names no epic issue
});

// ---- applyEpic: a preview writes nothing ------------------------------------------------------------

test('applyEpic: a preview never calls the CLI, but returns the commands it would run', async (t) => {
  const dir = tmp(t);
  let called = false;
  const exec = async () => { called = true; return ''; };
  const res = await epics.applyEpic({
    platform: 'github', repo: 'https://github.com/o/r', epic: { title: 'New epic', goal: 'Goal' }, issues: [2, 3], epics: [], dir, preview: true, exec,
  });
  assert.equal(called, false);
  assert.equal(res.preview, true);
  assert.ok(res.commands.length > 0);
  assert.deepEqual(res.linked, [2, 3]);
  assert.deepEqual(fs.readdirSync(dir), []); // nothing written to disk either
});

// ---- applyEpic: GitHub, creating and linking for real ------------------------------------------------

test('applyEpic: creates a new GitHub epic issue and links its members as sub-issues', async (t) => {
  const dir = tmp(t);
  const calls = [];
  const exec = async (cli, args) => {
    calls.push([cli, ...args]);
    if (args[0] === 'label' && args[1] === 'list') return JSON.stringify([{ name: 'epic' }]);
    if (args[0] === 'issue' && args[1] === 'create') return 'https://github.com/o/r/issues/99\n';
    if (args.join(' ').includes('--jq .id')) return '12345';
    return '';
  };
  const res = await epics.applyEpic({
    platform: 'github', repo: 'https://github.com/o/r', epic: { title: 'New epic', goal: 'Goal text' }, issues: [2, 3], epics: [], dir, preview: false, exec,
  });
  assert.equal(res.epic.number, 99);
  assert.deepEqual(res.linked, [2, 3]);
  assert.ok(calls.some((c) => c[0] === 'gh' && c[1] === 'issue' && c[2] === 'create'));
  assert.ok(calls.some((c) => c.join(' ').includes('sub_issues') && c.includes('POST')));
  assert.ok(fs.readdirSync(dir).some((f) => f.endsWith('.md'))); // the new epic's body was written for gh to read
});

test('applyEpic: placing members in an existing epic creates no new issue', async (t) => {
  const dir = tmp(t);
  const calls = [];
  const exec = async (cli, args) => { calls.push([cli, ...args]); return args.join(' ').includes('--jq .id') ? '1' : ''; };
  const res = await epics.applyEpic({
    platform: 'github', repo: 'https://github.com/o/r', epic: { id: '#5' },
    issues: [6], epics: [{ id: '#5', number: 5, title: 'Existing epic', kind: 'issue' }], dir, preview: false, exec,
  });
  assert.equal(res.epic.number, 5);
  assert.deepEqual(res.linked, [6]);
  assert.ok(!calls.some((c) => c.includes('create')));
});

test('applyEpic: an unknown epic id (stale cache) is refused before anything is written', async (t) => {
  const dir = tmp(t);
  let called = false;
  const exec = async () => { called = true; return ''; };
  await assert.rejects(epics.applyEpic({
    platform: 'github', repo: 'https://github.com/o/r', epic: { id: '#404' }, issues: [1], epics: [], dir, preview: false, exec,
  }), /Unknown epic #404/);
  assert.equal(called, false);
});

// ---- applyEpic: GitLab, creating and linking for real (label-based, no group epics yet) --------------

// ---- filedToEpic: where an issue-tracker run's created issues join (#81, #133) -----------------

function filedSteps({ choice, existingReview = true } = {}) {
  const steps = {
    analyze: { output: { epic: { id: '#5', title: 'Run safety', match: 'clear', reason: 'same theme' } } },
    file: { output: { filed: [{ action: 'created', number: 10, url: 'u', title: 't' }] } },
  };
  if (existingReview) steps.review = { output: { choice } };
  return steps;
}

test('filedToEpic: with no review output (mode: auto) but a file output, the run is treated as "create"', () => {
  const plan = epics.filedToEpic({ workflow: 'issue-tracker', status: 'success', steps: filedSteps({ existingReview: false }) });
  assert.deepEqual(plan, { epic: '#5', numbers: [10] });
});

test('filedToEpic: a review choice of "add_to" (no new issue created in the epic\'s own theme) gives null', () => {
  const plan = epics.filedToEpic({ workflow: 'issue-tracker', status: 'success', steps: filedSteps({ choice: 'add_to' }) });
  assert.equal(plan, null);
});

test('filedToEpic: create and create_assign both place the created issues; steps undefined gives null, not a throw', () => {
  assert.deepEqual(epics.filedToEpic({ workflow: 'issue-tracker', status: 'success', steps: filedSteps({ choice: 'create' }) }), { epic: '#5', numbers: [10] });
  assert.deepEqual(epics.filedToEpic({ workflow: 'issue-tracker', status: 'success', steps: filedSteps({ choice: 'create_assign' }) }), { epic: '#5', numbers: [10] });
  assert.equal(epics.filedToEpic({ workflow: 'issue-tracker', status: 'success' }), null);
  assert.equal(epics.filedToEpic({}), null);
});

test('applyEpic: creates a GitLab label-based epic and links members with the scoped label', async (t) => {
  const dir = tmp(t);
  const calls = [];
  const exec = async (cli, args) => {
    calls.push([cli, ...args]);
    if (cli === 'glab' && args[0] === 'issue' && args[1] === 'create') return 'https://gitlab.com/g/r/-/issues/50\n';
    return '';
  };
  const res = await epics.applyEpic({
    platform: 'gitlab', repo: 'https://gitlab.com/g/r', epic: { title: 'Run safety', goal: 'g' }, issues: [6], epics: [], dir, preview: false, exec,
  });
  assert.equal(res.epic.kind, 'label');
  assert.equal(res.epic.number, 50);
  assert.deepEqual(res.linked, [6]);
  assert.ok(calls.some((c) => c[0] === 'glab' && c.includes('update') && c.some((a) => a.startsWith('epic::'))));
});
