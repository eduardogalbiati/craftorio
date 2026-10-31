// scripts/site-data.js: the public page's build-time data. Only the issues the items name (and the open
// ones carrying the backlog label) are published, each with the pull requests that name it; commits are
// counted per week. Seams: the pure functions on planted files and lists, fetchGithub with a fake fetch.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { fetchGithub, frontMatterValue, gitActivity, issueRefs, linkPrs, weekly } = require('../scripts/site-data');

test('frontMatterValue reads a key without its comment or quotes', () => {
  const text = '---\nissue: "#636 (phases 0 and 1)"   # the issue\nrepo: a/b\n---\n# Title';
  assert.equal(frontMatterValue(text, 'issue'), '#636 (phases 0 and 1)');
  assert.equal(frontMatterValue(text, 'repo'), 'a/b');
  assert.equal(frontMatterValue(text, 'none'), '');
  assert.equal(frontMatterValue('# no front matter', 'issue'), '');
});

test('issueRefs: the issues the items name in intent.md or milestone.md', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'site-data-'));
  const put = (rel, text) => { fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true }); fs.writeFileSync(path.join(root, rel), text); };
  put('docs/work/a/intent.md', '---\nissue: "#628"\n---\n');
  put('docs/work/b/intent.md', '---\nissue: "#636 and #12"\n---\n');
  put('docs/work/c/milestone.md', '---\nissue: "#628"\n---\n');
  put('docs/work/d/spec.md', '---\nissue: "#999"\n---\n');
  assert.deepEqual(issueRefs(root), [12, 628, 636]);
  assert.deepEqual(issueRefs(path.join(root, 'nowhere')), []);
});

test('weekly: commits per week, the last week ending today, older ones left out', () => {
  const today = Date.parse('2026-10-31T12:00:00Z');
  const w = weekly(['2026-10-31', '2026-10-25', '2026-10-24', '2026-10-01', '2026-08-01', 'nonsense'], today, 4);
  assert.deepEqual(w.map((x) => x.start), ['2026-10-04', '2026-10-11', '2026-10-18', '2026-10-25']);
  assert.deepEqual(w.map((x) => x.commits), [0, 0, 1, 2]);
});

test('gitActivity is null outside a git repository', () => {
  assert.equal(gitActivity(fs.mkdtempSync(path.join(os.tmpdir(), 'no-git-'))), null);
});

test('linkPrs: a pull request belongs to the issues it names, never to a longer number', () => {
  const prs = [
    { number: 7, title: 'Docs (#628)', body: '', state: 'closed', merged_at: '2026-10-31', html_url: 'u7', updated_at: 'x' },
    { number: 8, title: 'Other', body: 'Closes #6280', state: 'open', merged_at: null, html_url: 'u8', updated_at: 'y' },
    { number: 9, title: 'Fix', body: 'Part of #628.', state: 'open', merged_at: null, html_url: 'u9', updated_at: 'z' },
  ];
  const links = linkPrs([628], prs);
  assert.deepEqual(links[628].map((p) => [p.number, p.state]), [[7, 'merged'], [9, 'open']]);
});

test('fetchGithub: only the named issues and the labelled backlog, with their pull requests; nothing without a token', async () => {
  assert.equal(await fetchGithub({ repo: 'a/b', token: '', numbers: [1] }), null);
  const calls = [];
  const data = {
    '': { private: true },
    '/issues/628': { number: 628, title: 'Onboarding', state: 'open', html_url: 'i628', labels: [{ name: 'epic' }], updated_at: 'u', closed_at: null },
    '/issues?state=open&labels=roadmap&per_page=50': [
      { number: 628, title: 'Onboarding', state: 'open', html_url: 'i628', labels: [] },
      { number: 700, title: 'Next idea', state: 'open', html_url: 'i700', labels: [{ name: 'roadmap' }] },
      { number: 701, title: 'A pull request', pull_request: {} },
      { number: 629, title: 'Onboarding phase 1', state: 'open', html_url: 'i629', labels: [] },
      { number: 638, title: 'Step 1', state: 'open', html_url: 'i638', labels: [] },
    ],
    '/issues/628/sub_issues?per_page=100': [
      { number: 629, title: 'Onboarding phase 1', state: 'open', html_url: 'i629', closed_at: null },
      { number: 630, title: 'Onboarding phase 2', state: 'closed', html_url: 'i630', closed_at: 'c' },
    ],
    '/issues/629/sub_issues?per_page=100': [{ number: 638, title: 'Step 1', state: 'closed', html_url: 'i638', closed_at: 'c' }],
    '/pulls?state=all&sort=updated&direction=desc&per_page=100': [{ number: 635, title: 'Docs (#628)', body: '', state: 'closed', merged_at: 'm', html_url: 'p635', updated_at: 'u' }],
  };
  const fetchImpl = async (url, opts) => {
    const key = url.replace('https://api.github.com/repos/a/b', '');
    calls.push([key, opts.headers.Authorization]);
    return { ok: key in data, status: key in data ? 200 : 404, json: async () => data[key] };
  };
  const out = await fetchGithub({ repo: 'a/b', token: 't', numbers: [628, 404], fetchImpl });
  assert.equal(out.private, true);
  assert.deepEqual(Object.keys(out.issues), ['628']);
  assert.deepEqual(out.issues[628].prs.map((p) => [p.number, p.state]), [[635, 'merged']]);
  assert.deepEqual(out.issues[628].children.map((c) => [c.number, c.state]), [[629, 'open'], [630, 'closed']], 'the sub-issues, open and closed');
  assert.deepEqual(out.issues[628].children[0].children.map((c) => [c.number, c.state]), [[638, 'closed']], 'a phase carries its steps');
  assert.deepEqual(out.backlog.map((b) => b.number), [700], 'the backlog leaves out named issues, their sub-issues, their steps and pull requests');
  assert.ok(calls.every(([, auth]) => auth === 'Bearer t'));
});
