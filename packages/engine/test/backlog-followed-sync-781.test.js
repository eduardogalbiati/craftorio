// #781: only a sync a screen follows reads the list in steps (backlog.js syncBacklog `followed`, the wizard's); the
// Backlog tab's Sync, which shows no count, keeps the single read. The platform's CLI is the boundary: a fake `exec`.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const backlog = require('../domains/backlog/backlog');
const { MAX_ISSUES } = require('../domains/backlog/issues');

const SIZE = 120;
const flag = (args, name) => Number(args[args.indexOf(name) + 1]);
const isIssueList = (args) => args[0] === 'issue' && args[1] === 'list';
const issues = (n) => Array.from({ length: n }, (_, i) => ({ number: i + 1, title: `Issue ${i + 1}`, state: 'OPEN', url: `https://github.com/o/r/issues/${i + 1}` }));

function fakeGh() {
  const lists = [];
  const exec = async (_cli, args) => {
    if (isIssueList(args)) {
      lists.push(flag(args, '--limit'));
      return JSON.stringify(issues(Math.min(SIZE, flag(args, '--limit'))));
    }
    return args[0] === 'api' ? String(SIZE) : '[]';
  };
  return { exec, lists };
}

async function sync(t, options) {
  const dir = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'bl-followed-781-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const fake = fakeGh();
  const reports = [];
  await backlog.syncBacklog({ dir, project: { id: 'p', repo: 'https://github.com/o/r' }, platform: 'github', exec: fake.exec, onProgress: (p) => reports.push(p), ...options });
  return { lists: fake.lists, reports };
}

test('#781 a sync no screen follows is one read, and still ends with its count', async (t) => {
  const { lists, reports } = await sync(t, {});
  assert.deepEqual(lists, [MAX_ISSUES]);
  assert.deepEqual(reports.at(-1), { what: 'issues', read: SIZE, total: SIZE });
});

test('#781 a followed sync reads in steps, and its count grows', async (t) => {
  const { lists, reports } = await sync(t, { followed: true });
  assert.deepEqual(lists, [40, 100, 200]);
  assert.equal(reports.some((p) => p.read === 40), true);
  assert.deepEqual(reports.at(-1), { what: 'issues', read: SIZE, total: SIZE });
});
