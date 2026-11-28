// The Home redesign (2026-11-28, the owner's Claude Design proposal and his choices): "What needs you" first, with
// counted chips and the rows the menu's screens add (a PR that needs the owner, a new production error, the day's budget
// at 80 % or more); the flow; the Now, Roadmap and Next release blocks, each only while it has something to show; then
// "Last watch" (the last run of the Night watch, its figures in the interface language) beside "Last 24 hours".
// Through the page (test/renderer-app-harness.js), as renderer-home-flow-255.test.js.
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadApp, text } = require('./renderer-app-harness');

const NOW = Date.now();
const iso = (minsAgo) => new Date(NOW - minsAgo * 60000).toISOString();
const PROJECTS = [{ id: 'p1', name: 'Project One', repo: 'https://github.com/o/r', folder: 'C:/work/one' }];
const BASE_API = {
  listProjects: async () => PROJECTS,
  getSettings: async () => ({ lastProject: 'p1' }),
  listWorkflows: async () => [{ file: 'software-development.yaml', name: 'software-development', category: 'build' }],
  getBacklog: async () => ({ issues: [], epics: [], roadmap: { stages: [] } }),
};
async function home(api = {}) {
  const app = loadApp({ storage: { 'craftorio.currentProject': 'p1' }, api: { ...BASE_API, ...api } });
  await app.boot();
  app.run("showView('dashboard')");
  await app.settle(30);
  return app;
}
const body = (app) => String(app.el('#home-body').innerHTML || '');
const kinds = (app) => [...body(app).matchAll(/data-testid="home-needs-item" data-kind="([^"]+)"/g)].map((m) => m[1]);
const blockIds = (app) => [...body(app).matchAll(/data-testid="home-block" data-block="([^"]+)"/g)].map((m) => m[1]);

test('"What needs you" comes first, before the flow, with its counted chips', async () => {
  const app = await home({ listActiveRuns: async () => [{ runId: 'g1', workflow: 'software-development', projectId: 'p1', status: 'running', waiting: 1, startedAt: iso(30), gates: [{ approval_id: 'a1', step_id: 'review', message: 'Approve?', requested_at: iso(20) }] }] });
  const html = body(app);
  assert.ok(html.indexOf('data-testid="home-needs-you"') < html.indexOf('data-testid="home-flow-strip"'), 'needs before the flow');
  assert.match(html, /data-testid="home-needs-waiting">1 waiting for you</);
});

test('a PR that needs the owner is a row with Open PRs (the PRs screen\'s "Need you" group)', async () => {
  const app = await home({ listPullRequests: async () => ({ projects: [{ projectId: 'p1', groups: { needYou: [{ number: 42, title: 'Add a /health endpoint', state: 'ready' }], waiting: [], others: [] } }] }) });
  assert.ok(kinds(app).includes('pr'), kinds(app).join());
  const row = /data-kind="pr">([\s\S]*?)data-home-pulls="42"[^>]*>([^<]+)</.exec(body(app));
  assert.ok(row, 'the PR row with its button');
  assert.match(text(row[1]), /#42 Add a \/health endpoint/);
  assert.match(text(row[1]), /only the merge is left/);
  assert.equal(row[2], 'Open PRs');
});

test('a new production error is a row with Diagnose; a diagnosed one is not', async () => {
  const app = await home({ monitorState: async () => ({ groups: [
    { fingerprint: 'f1', title: 'TypeError: x is undefined', where: 'api/runs.ts', count: 38, state: 'new' },
    { fingerprint: 'f2', title: 'Old error', state: 'intent' },
  ] }) });
  assert.deepEqual(kinds(app).filter((k) => k === 'error'), ['error']);
  assert.match(body(app), /TypeError: x is undefined/);
  assert.match(body(app), /38 times/);
  assert.match(body(app), /data-home-errors="f1"[^>]*>Diagnose</);
  assert.doesNotMatch(body(app), /Old error/);
});

test('the day\'s budget at 80 % or more is a usage row; below it is not', async () => {
  const at = async (spent) => home({ getUsage: async () => ({ spending: { day: { spentUsd: spent, limitUsd: 20 } } }) });
  const high = await at(18.4);
  await high.settle(20);
  assert.ok(kinds(high).includes('usage'));
  assert.match(body(high), /Daily budget at 92%/);
  const low = await at(10);
  await low.settle(20);
  assert.ok(!kinds(low).includes('usage'));
});

test('the blocks show only with content: none on a quiet project', async () => {
  const app = await home();
  assert.deepEqual(blockIds(app), []);
  assert.doesNotMatch(body(app), /data-testid="home-blocks"/);
});

test('Now lists the project\'s runs in progress, each opening its run; Roadmap shows the stage with work; Next release what merged locally', async () => {
  const app = await home({
    listActiveRuns: async () => [{ runId: 'r1', workflow: 'software-development', title: 'Fix the login page', projectId: 'p1', status: 'running', waiting: 0, startedAt: iso(12), gates: [] }],
    getBacklog: async () => ({
      issues: [{ number: 7, title: 'Issue 7', state: 'open', column: 'local', labels: [], isEpic: false }], epics: [],
      roadmap: { stages: [{ id: 's1', name: 'Payments', items: [{ id: 'i1', status: 'failed', workflow: 'w' }, { id: 'i2', status: 'planned', workflow: 'w' }] }] },
    }),
  });
  assert.deepEqual(blockIds(app), ['now', 'roadmap', 'release']);
  assert.match(body(app), /data-testid="home-live-run" data-home-run="r1"/);
  assert.match(text(body(app)), /Fix the login page/);
  assert.match(text(body(app)), /Stage 1 · Payments/);
  assert.match(text(body(app)), /0 of 2 done · 0 running · 0 waiting for you · 1 failed/);
  assert.match(text(body(app)), /1 issue merged locally, not pushed yet/);
});

test('"Last watch": the last run of the watch with its date and how long ago it ended, its figures as wells', async () => {
  const counts = { runs: 16, issues: 3, activeHours: 6.5, windowHours: 9, incidents: 7, auto: 2, resolved: 2, escalated: 6, gatesOpen: 1, proposed: 0, gatesCrossed: 0, neverActions: 0, blocked: 1, refused: 1 };
  const app = await home({ nightWatchMorning: async () => ({ window: { from: iso(600), to: iso(180) }, summary: { ran: 'x', did: 'x', waits: 'x', safety: 'x', alarm: false, counts, regressions: [], limits: [] } }) });
  await app.settle(20);
  const card = String(app.el('#dash-nightwatch').innerHTML || '');
  assert.match(text(card), /Last watch/);
  assert.match(text(card), /ended 3 h ago/);
  assert.match(text(card), /Runs\s*16\s*3 issues delivered/);
  assert.match(text(card), /Incidents\s*7\s*2 resolved · 6 escalated/);
  assert.match(text(card), /Waiting for you: 1 gate\(s\) open/);
  assert.match(card, /id="dash-nw-open"[^>]*>View report</);
});
