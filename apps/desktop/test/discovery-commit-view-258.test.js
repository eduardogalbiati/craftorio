// #258 Commit a discovery card to the backlog, on the screens: the Discovery board's card panel
// offers "Commit to the backlog" (data-testid="discovery-commit") for a Ready card at or above 85%,
// disabled under it with the gaps and Grill me; the committed cards leave the columns for a
// Committed list (data-testid="discovery-committed", each data-testid="discovery-committed-card")
// with their delivery progress; the Backlog shows an issue's discovery card as a badge
// (data-testid="issue-discovery-card"). Harnesses: test/discovery-board-harness.js (the board with
// a fake store) and test/renderer-app-harness.js (the Backlog).
const test = require('node:test');
const assert = require('node:assert/strict');
const { boardApi, card, openBoard } = require('./discovery-board-harness');
const { loadApp } = require('@multiagent/ui-kit/test/renderer-app-harness');

const tid = (id) => `[data-testid="${id}"]`;

test('D. a Ready card at 90% offers an enabled "Commit to the backlog"; at 70% it is disabled, with the gaps and Grill me', async () => {
  const clear = card({ title: 'Export runs as CSV', column: 'ready', clarity: 90 });
  const vague = card({ title: 'Share a run report', column: 'ready', clarity: 70 });
  vague.clarity.gaps = ['Who reads the report', 'Which runs it covers'];
  const page = await openBoard({ cards: [clear, vague] });

  const detail = await page.openCard(clear.id);
  const commit = detail.querySelector(tid('discovery-commit'));
  assert.ok(commit, 'no [data-testid="discovery-commit"] in the panel of a Ready card at 90%');
  assert.equal(page.text(commit), 'Commit to the backlog');
  assert.equal(!!commit.disabled, false);

  page.run("document.querySelector('[data-detail=\"close\"]').click()");
  const other = await page.openCard(vague.id);
  const refused = other.querySelector(tid('discovery-commit'));
  assert.ok(refused, 'no [data-testid="discovery-commit"] in the panel of a Ready card at 70%');
  assert.equal(!!refused.disabled, true);
  assert.deepEqual(other.querySelectorAll(`${tid('clarity-missing')} li`).map((li) => page.text(li)), ['Who reads the report', 'Which runs it covers']);
  assert.ok(other.querySelector(`${tid('grill-me')}, ${tid('card-grill-me')}`), 'no Grill me shortcut in the panel');
});

test('D. a committed card shows in the Committed list, out of the columns, with its delivery progress', async () => {
  const live = card({ title: 'Still shaping', column: 'shape', clarity: 40 });
  const done = { ...card({ title: 'Export runs as CSV', column: 'committed', clarity: 90 }), links: { issues: [101, 102, 103], release: null } };
  const delivery = { stage: 'in_delivery', counts: { todo: 1, running: 1, local: 0, done: 1 }, issues: [{ number: 101, column: 'done' }, { number: 102, column: 'in_progress' }, { number: 103, column: 'todo' }] };
  const { methods } = boardApi({ cards: [live] });
  const page = await openBoard({ cards: [live], api: { discoveryBoard: async () => ({ ...(await methods.discoveryBoard()), committed: [{ ...done, delivery }] }) } });
  const list = page.$(tid('discovery-committed'));
  assert.ok(list, 'no [data-testid="discovery-committed"] list');
  const entries = list.querySelectorAll(tid('discovery-committed-card'));
  assert.equal(entries.length, 1);
  assert.equal(entries[0].closest(tid('discovery-column')), null, 'the committed card is not in a column');
  const shown = page.text(entries[0]);
  assert.ok(shown.includes('Export runs as CSV'), shown);
  assert.ok(shown.includes('1 done'), shown);
  assert.ok(shown.includes('1 running'), shown);
  assert.equal(page.cardColumn(done.id), null, 'no board column holds the committed card');
});

test('D. the Backlog shows an issue filed from a discovery card with a badge naming the card', async () => {
  const issue = (number, extra = {}) => ({
    number, title: `Issue ${number}`, state: 'open', column: 'todo', labels: [], assignees: [], author: 'eduardo', body: '',
    url: `https://github.com/o/r/issues/${number}`, createdAt: '2026-09-01T00:00:00Z', updatedAt: '2026-09-10T00:00:00Z',
    tasks: { total: 0, done: 0 }, runs: [], pullRequests: [], ...extra,
  });
  const data = { platform: 'github', syncedAt: '2026-10-01T00:00:00Z', issues: [issue(101, { discoveryCard: { id: '20261004-a1b2', title: 'Export runs as CSV' } }), issue(2)], epics: [] };
  const app = loadApp({
    storage: { 'multiagent.backlogProject': 'p1', 'multiagent.currentProject': 'p1' },
    api: {
      listProjects: async () => [{ id: 'p1', name: 'Project One', repo: 'https://github.com/o/r' }],
      getSettings: async () => ({ lastProject: 'p1' }),
      getBacklog: async () => data,
      syncBacklog: async () => data,
    },
  });
  await app.boot();
  app.run("showView('backlog')");
  await app.settle(10);
  await app.click('#bl-mode', { dataset: { mode: 'list' } });
  const html = String(app.el('#bl-list').innerHTML);
  const badges = [...html.matchAll(/data-testid="issue-discovery-card"[^>]*>([\s\S]*?)<\/[a-z]+>/g)].map((m) => m[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim());
  assert.equal(badges.length, 1, 'one issue carries a discovery card');
  assert.ok(badges[0].includes('Export runs as CSV'), badges[0]);
});
