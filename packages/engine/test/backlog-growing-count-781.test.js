// #781: the count that grows while the backlog is read (issues.js fetchIssues with onProgress, the adapters'
// issueListSteps and issueCountCommand). The platform's CLI is the boundary: a fake `exec` answers each command.
const test = require('node:test');
const assert = require('node:assert/strict');
const { fetchIssues, MAX_ISSUES } = require('../domains/backlog/issues');
const { findPlatform } = require('@craftorio/shared/platforms');

const flag = (args, name) => Number(args[args.indexOf(name) + 1]);
const isList = (args) => args[0] === 'issue' && args[1] === 'list';
// #90: the authors read after the list (github.js issueAuthorsCommand), not a count
const isAuthors = (args) => args.join(' ').includes('authorAssociation');
const ghIssues = (n) => Array.from({ length: n }, (_, i) => ({ number: i + 1, title: `Issue ${i + 1}`, state: 'OPEN', url: `https://github.com/o/r/issues/${i + 1}` }));
const glIssues = (from, to) => Array.from({ length: Math.max(0, to - from) }, (_, i) => ({ iid: from + i + 1, title: 'x', state: 'opened' }));

// gh: `--limit` of a repository with `size` issues; the count answers after `countGate`, when there is one
function fakeGh(size, { count = String(size), countGate = null } = {}) {
  const calls = [];
  const exec = async (_cli, args) => {
    calls.push(args);
    if (isList(args)) return JSON.stringify(ghIssues(Math.min(size, flag(args, '--limit'))));
    if (isAuthors(args)) return '[]';
    if (countGate) await countGate;
    if (count instanceof Error) throw count;
    return count;
  };
  return { calls, exec };
}

function fakeGlab(size) {
  const calls = [];
  const exec = async (_cli, args) => {
    calls.push(args);
    if (!isList(args)) return JSON.stringify({ statistics: { counts: { all: size, closed: 0, opened: size } } });
    const per = flag(args, '--per-page');
    const start = (flag(args, '--page') - 1) * per;
    return JSON.stringify(glIssues(start, Math.min(size, start + per)));
  };
  return { calls, exec };
}

async function read(fake, platform = 'github', repo = 'https://github.com/o/r') {
  const reports = [];
  const issues = await fetchIssues({ platform, repo, exec: fake.exec, onProgress: (p) => reports.push(p) });
  return { issues, reports };
}

const lists = (calls) => calls.filter(isList);
// the counts the screen goes through: the total's own report repeats the read of its moment
const readsOf = (reports) => [...new Set(reports.map((p) => p.read))];

test('#781 GitHub: the count grows with each step, and says of how many', async () => {
  const fake = fakeGh(120);
  const { issues, reports } = await read(fake);
  assert.equal(issues.length, 120);
  assert.deepEqual(readsOf(reports), [40, 100]);
  assert.deepEqual(reports.at(-1), { what: 'issues', read: 100, total: 120 });
  assert.deepEqual(lists(fake.calls).map((a) => flag(a, '--limit')), [40, 100, 200]);
});

test('#781 GitHub: a repository smaller than the first step costs one list call', async () => {
  const fake = fakeGh(12);
  const { issues } = await read(fake);
  assert.equal(issues.length, 12);
  assert.equal(lists(fake.calls).length, 1);
});

test('#781 GitHub: the read stops at MAX_ISSUES, and the total says what will be read', async () => {
  const fake = fakeGh(1000);
  const { issues, reports } = await read(fake);
  assert.equal(issues.length, MAX_ISSUES);
  assert.deepEqual(lists(fake.calls).map((a) => flag(a, '--limit')), [40, 100, 200, MAX_ISSUES]);
  assert.deepEqual(reports.at(-1), { what: 'issues', read: MAX_ISSUES, total: MAX_ISSUES });
});

test('#781 GitLab: the pages join, up to the 100 issues of the single read', async () => {
  const fake = fakeGlab(130);
  const { issues, reports } = await read(fake, 'gitlab', 'https://gitlab.com/g/sub/r');
  assert.deepEqual(issues.map((i) => i.number), Array.from({ length: 100 }, (_, i) => i + 1));
  assert.deepEqual(readsOf(reports), [25, 50, 75, 100]);
  assert.deepEqual(reports.at(-1), { what: 'issues', read: 100, total: 100 });
  assert.ok(fake.calls.some((a) => a.includes('projects/g%2Fsub%2Fr/issues_statistics')));
});

test('#781 a count that fails or answers something else leaves the total unknown, and the read goes on', async () => {
  for (const count of [new Error('no scope'), '[]', '']) {
    const { issues, reports } = await read(fakeGh(50, { count }));
    assert.equal(issues.length, 50);
    assert.deepEqual(reports.map((p) => p.total), [null]);
  }
});

test('#781 a count that answers after the list reports nothing more', async () => {
  let release;
  const countGate = new Promise((r) => { release = r; });
  const { reports } = await read(fakeGh(50, { countGate }));
  const before = reports.length;
  release();
  await new Promise((r) => setImmediate(r));
  assert.equal(reports.length, before);
});

test('#781 the read count is never above the total', async () => {
  const { reports } = await read(fakeGh(120, { count: '30' }));
  assert.ok(reports.every((p) => p.total === null || p.read <= p.total), JSON.stringify(reports));
});

test('#781 a step that fails fails the read', async () => {
  const exec = async (_cli, args) => {
    if (isList(args) && flag(args, '--limit') > 40) throw new Error('gh failed');
    return JSON.stringify(ghIssues(40));
  };
  await assert.rejects(fetchIssues({ platform: 'github', repo: 'https://github.com/o/r', exec, onProgress: () => {} }), /gh failed/);
});

test('#781 with no onProgress the list stays one call, with no count', async () => {
  const fake = fakeGh(120);
  const issues = await fetchIssues({ platform: 'github', repo: 'https://github.com/o/r', exec: fake.exec });
  assert.equal(issues.length, 120);
  assert.equal(fake.calls.filter((a) => !isAuthors(a)).length, 1);
  assert.equal(flag(fake.calls[0], '--limit'), MAX_ISSUES);
});

test('#781 a self-hosted GitHub is counted on its own host', () => {
  const { args } = findPlatform('github').issueCountCommand({ host: 'ghe.corp', path: 'o/r' });
  assert.deepEqual(args.slice(0, 4), ['api', 'graphql', '--hostname', 'ghe.corp']);
  assert.ok(args.includes('owner=o') && args.includes('name=r'));
});
