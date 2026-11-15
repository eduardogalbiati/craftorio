// #568 review round 2: GitHub's issue events take no `since`, so the reader pages through them (50 a page)
// up to the first event older than `since`, 5 pages at most; with no `since` it reads one page.
// Seam: readGithubEvents of packages/engine/domains/triggers/platform-events.js, `gh api` faked.

const test = require('node:test');
const assert = require('node:assert/strict');

const load = () => require('../../domains/triggers/platform-events');

const SINCE = '2026-11-15T10:00:00Z';

// a page of 50 issue events, newest first, the last one at `oldest`
function page(n, oldest) {
  const items = [];
  for (let i = 0; i < 50; i++) {
    items.push({
      id: n * 1000 + i, event: 'labeled', label: { name: 'ready' },
      created_at: i === 49 ? oldest : '2026-11-15T12:00:00Z',
      issue: { number: n * 100 + i, html_url: `https://github.com/acme/app/issues/${n * 100 + i}` },
    });
  }
  return items;
}

// a fake `gh api`: the issue events from `pages` by their `&page=N`, every other endpoint empty
function fakeExec(pages) {
  const eventPages = [];
  const exec = async (cmd, args) => {
    const endpoint = args[1];
    if (!endpoint.includes('/issues/events')) return '[]';
    const n = Number(/[?&]page=(\d+)/.exec(endpoint)[1]);
    eventPages.push(n);
    return JSON.stringify(pages[n - 1] || []);
  };
  return { exec, eventPages };
}

test('#568 without since the GitHub reader reads one page of issue events', async () => {
  const { exec, eventPages } = fakeExec([page(1, '2026-11-15T12:00:00Z'), page(2, '2026-11-15T12:00:00Z')]);
  await load().readGithubEvents({ repo: 'acme/app', exec });
  assert.deepEqual(eventPages, [1]);
});

test('#568 the GitHub reader stops at the page holding an event older than since', async () => {
  const { exec, eventPages } = fakeExec([page(1, '2026-11-15T11:00:00Z'), page(2, '2026-11-15T09:00:00Z'), page(3, '2026-11-15T08:00:00Z')]);
  await load().readGithubEvents({ repo: 'acme/app', since: SINCE, exec });
  assert.deepEqual(eventPages, [1, 2]);
});

test('#568 the GitHub reader reads 5 pages of issue events at most', async () => {
  const pages = [1, 2, 3, 4, 5, 6, 7].map((n) => page(n, '2026-11-15T11:00:00Z'));
  const { exec, eventPages } = fakeExec(pages);
  await load().readGithubEvents({ repo: 'acme/app', since: SINCE, exec });
  assert.deepEqual(eventPages, [1, 2, 3, 4, 5]);
});

test('#568 a short page of issue events is the last one read', async () => {
  const short = page(1, '2026-11-15T11:00:00Z').slice(0, 10);
  const { exec, eventPages } = fakeExec([short, page(2, '2026-11-15T11:00:00Z')]);
  await load().readGithubEvents({ repo: 'acme/app', since: SINCE, exec });
  assert.deepEqual(eventPages, [1]);
});

test('#568 labels from every page read are events, the ones older than since are not', async () => {
  const { exec } = fakeExec([page(1, '2026-11-15T11:00:00Z'), page(2, '2026-11-15T09:00:00Z')]);
  const events = await load().readGithubEvents({ repo: 'acme/app', since: SINCE, exec });
  const labeled = events.filter((e) => e.kind === 'issue_labeled');
  // 50 from the first page, 49 from the second (its last one is older than since)
  assert.equal(labeled.length, 99);
  assert.equal(labeled.some((e) => e.id === 'gh:labeled:2049'), false);
  assert.equal(labeled.some((e) => e.id === 'gh:labeled:2048'), true);
});
