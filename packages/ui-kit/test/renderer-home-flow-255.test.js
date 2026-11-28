// #255 Home's overview, beyond the acceptance tests (test/renderer-home-255.test.js): the discovery
// card waiting for the owner and its Answer button, the gates' ages and phone link, a roadmap gate
// waiting in another app, what the strip counts (no epic, no archived issue, merged locally from the
// board and the unpushed commits, the roadmap's runs), where a stage's count goes (the Runs tab
// filtered on the project, the board for one visit), "Today" (the day, the last night, tonight) and
// "Open roadmap" before the Backlog was ever read. Through the page (test/renderer-app-harness.js):
// a fake window.api, the markup Home writes into #home-body, the page's state and its clicks.
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadApp, text } = require('./renderer-app-harness');

const NOW = Date.now();
const iso = (minsAgo) => new Date(NOW - minsAgo * 60000).toISOString();

const PROJECTS = [{ id: 'p1', name: 'Project One', repo: 'https://github.com/o/r', folder: 'C:/work/one' }];
const ref = (number, title) => ({ number, title, url: `https://github.com/o/r/issues/${number}` });
const issue = (number, column, extra = {}) => ({ number, title: `Issue ${number}`, state: 'open', column, labels: [], isEpic: false, ...extra });
const gateRun = (runId, minsAgo, extra = {}) => ({
  runId, workflow: 'software-development', file: 'software-development.yaml', projectId: 'p1', issues: [], startedAt: iso(minsAgo + 5), status: 'running', waiting: 1, inputs: {}, passedGates: [],
  gates: [{ approval_id: `a-${runId}`, step_id: 'review', message: `Approve ${runId}?`, requested_at: iso(minsAgo), ts: iso(minsAgo), ...extra }],
});

const BASE_API = {
  listProjects: async () => PROJECTS,
  getSettings: async () => ({ lastProject: 'p1' }),
  listWorkflows: async () => [{ file: 'software-development.yaml', name: 'software-development', category: 'build' }],
  getBacklog: async () => ({ issues: [], epics: [], roadmap: { stages: [] } }),
};

// Home (the view `dashboard`) shown for the header's project p1
async function home(api = {}, storage = {}) {
  const app = loadApp({ storage: { 'craftorio.currentProject': 'p1', ...storage }, api: { ...BASE_API, ...api } });
  await app.boot();
  app.run("showView('dashboard')");
  await app.settle(30);
  return app;
}
const body = (app) => String(app.el('#home-body').innerHTML || '');
// the "What needs you" rows: { kind, html }
const needRows = (app) => [...body(app).matchAll(/<div class="home-need" data-testid="home-needs-item" data-kind="([^"]+)">([\s\S]*?)<\/div>\s*(?=<div class="home-need"|<\/div>)/g)]
  .map((m) => ({ kind: m[1], html: m[2], text: text(m[2]) }));
const count = (app, stage) => (new RegExp(`data-testid="home-flow-count" data-stage="${stage}"[^>]*>(\\d+)<`).exec(body(app)) || [])[1];
// a "Last 24 hours" stat (the Home redesign: its own box, #home-last24)
const stat = (app, label) => (new RegExp(`<label>${label}</label><b>([\\s\\S]*?)</b>`).exec(String(app.el('#home-last24').innerHTML || '')) || [])[1];
const clickHome = (app, sel, dataset) => app.click(sel, { dataset, within: ['#view-dashboard'] });

// ---- What needs you -----------------------------------------------------------------------------

test('a discovery card whose thread ends with a question is a "What needs you" row with its question, age and an Answer button (#255)', async () => {
  const app = await home({
    listDiscoveryWaiting: async () => [
      { id: 'c1', title: 'Dark mode for the run log', column: 'inbox', question: { ts: iso(40), author: 'grill-me', text: 'Which contrast ratio?' } },
      { id: 'c2', title: 'Shaped card', column: 'shape', question: { ts: iso(20), author: 'grill-me', text: 'Who uses it?' } },
    ],
  });
  assert.deepEqual([...new Set(app.callsTo('listDiscoveryWaiting').map((a) => a.join()))], ['p1'], 'asked for the header\'s project');
  const cards = needRows(app).filter((r) => r.kind === 'card');
  assert.equal(cards.length, 2, 'the Inbox card, and the card in Shape now that the Discovery board is a screen (#257)');
  assert.match(cards[0].text, /Dark mode for the run log/);
  assert.match(cards[0].text, /grill-me: Which contrast ratio\?/);
  assert.match(cards[0].text, /waiting 40 min/);
  assert.match(cards[0].html, /<button[^>]*data-home-card="c1"[^>]*>Answer<\/button>/);
  assert.match(cards[1].text, /Shaped card/);
  assert.match(cards[1].text, /grill-me: Who uses it\?/);
  assert.match(cards[1].html, /<button[^>]*data-home-card="c2"[^>]*>Answer<\/button>/);
});

test('the Answer button opens the Inbox on the card (#255)', async () => {
  const app = await home({
    listDiscoveryWaiting: async () => [{ id: 'c1', title: 'Dark mode', column: 'inbox', question: { ts: iso(5), author: 'grill-me', text: 'Why?' } }],
  });
  await clickHome(app, '[data-home-card]', { homeCard: 'c1' });
  await app.settle(10);
  assert.equal(app.state().view, 'inbox');
  assert.deepEqual(app.callsTo('getDiscoveryCard').at(-1), ['p1', 'c1']);
});

test('a waiting gate shows its age by the minute, hour and day (#255)', async () => {
  const app = await home({ listActiveRuns: async () => [gateRun('r1', 0.5), gateRun('r2', 40), gateRun('r3', 90), gateRun('r4', 51 * 60)] });
  const ages = needRows(app).filter((r) => r.kind === 'gate').map((r) => (/waiting (.+?)\s*Open run/.exec(r.text) || [])[1]);
  assert.deepEqual(ages.sort(), ['1 h 30 min', '2 d 3 h', '40 min', '<1 min'].sort());
});

test('a gate with a phone page link shows it; a gate without one does not (#226, #255)', async () => {
  const app = await home({
    listActiveRuns: async () => [gateRun('r1', 10, { phoneUrl: 'https://phone.example/gates/r1/a-r1?t=tok' }), gateRun('r2', 10)],
  });
  const gates = needRows(app).filter((r) => r.kind === 'gate');
  assert.equal(gates.length, 2);
  const withLink = gates.filter((g) => /Phone link/.test(g.text));
  assert.equal(withLink.length, 1, 'one gate has a phone link');
  assert.match(withLink[0].html, /<a[^>]*href="https:\/\/phone\.example\/gates\/r1\/a-r1\?t=tok"[^>]*>Phone link<\/a>/);
  assert.match(withLink[0].html, /data-home-run="r1"/);
});

test('a roadmap run waiting at a gate in another app is a gate row that opens the run (#255)', async () => {
  const app = await home({
    getBacklog: async () => ({
      issues: [], epics: [],
      roadmap: { stages: [{ name: 'Exports', items: [{ id: 'i1', status: 'running', waiting: true, runId: 'r7', issues: [ref(31, 'Export CSV')], run: { startedAt: iso(40) } }] }] },
    }),
  });
  const gates = needRows(app).filter((r) => r.kind === 'gate');
  assert.equal(gates.length, 1);
  assert.match(gates[0].text, /#31 Export CSV/);
  assert.match(gates[0].text, /waiting 40 min/);
  assert.match(gates[0].html, /data-home-run="r7"/);
});

// ---- the flow strip -----------------------------------------------------------------------------

test('the strip counts no epic and no archived issue; Merged locally joins the board\'s column and the unpushed commits; Running adds the roadmap\'s runs (#255)', async () => {
  const app = await home({
    getBacklog: async () => ({
      issues: [
        issue(11, 'todo'), issue(12, 'todo'), issue(13, 'todo', { isEpic: true }),
        issue(17, 'local'), issue(18, 'local'), issue(19, 'local', { state: 'closed', labels: ['archived'] }),
      ],
      epics: [],
      local: { issues: [18, 25] },
      roadmap: { stages: [{ name: 'S1', items: [
        { id: 'i1', status: 'running', runId: 'r1', issues: [] },
        { id: 'i2', status: 'running', runId: 'r8', issues: [] },
      ] }] },
    }),
    listActiveRuns: async () => [
      { ...gateRun('r1', 5), gates: [], waiting: 0 },
      { ...gateRun('r9', 5), projectId: 'p2', gates: [], waiting: 0 },
    ],
  });
  assert.equal(count(app, 'todo'), '2', 'the epic is not a card of the board');
  assert.equal(count(app, 'merged'), '3', '17, 18 and 25: the archived 19 left out, 18 counted once');
  assert.equal(count(app, 'running'), '2', 'r1 (this app) and r8 (the roadmap, elsewhere); r9 is another project\'s');
});

test('the Running count opens the Runs tab on the project\'s runs in progress, simulated ones included (#255)', async () => {
  const app = await home();
  await clickHome(app, '[data-testid="home-flow-count"]', { testid: 'home-flow-count', stage: 'running' });
  const s = app.state();
  assert.equal(s.view, 'workflows');
  assert.equal(s.workflowsTab, 'runs');
  assert.equal(s.wr.filter, 'running');
  assert.equal(s.wr.showSim, true);
  assert.equal(s.wr.q, 'Project One');
});

test('the To do and Merged locally counts open the board\'s columns for that visit only, the remembered mode kept (#255)', async () => {
  for (const stage of ['todo', 'merged']) {
    // (the Backlog syncs a project with a repository after its read: the same data)
    const backlog = async () => ({ issues: [issue(11, 'todo'), issue(17, 'local')], epics: [], roadmap: { stages: [] } });
    const app = await home({ getBacklog: backlog, syncBacklog: backlog }, { 'craftorio.backlogMode': 'list', 'craftorio.backlogBoard': 'list' });
    await clickHome(app, '[data-testid="home-flow-count"]', { testid: 'home-flow-count', stage });
    await app.settle(20);
    assert.equal(app.state().view, 'backlog');
    assert.match(String(app.el('#bl-list').innerHTML), /data-testid="backlog-board"/, `${stage}: the board's columns`);
    assert.equal(app.sandbox.localStorage.getItem('craftorio.backlogMode'), 'list', `${stage}: the remembered mode is not changed`);
    assert.equal(app.sandbox.localStorage.getItem('craftorio.backlogBoard'), 'list');
    app.run("showView('dashboard')");
    await app.settle(10);
    app.run("showView('backlog')");
    await app.settle(20);
    assert.doesNotMatch(String(app.el('#bl-list').innerHTML), /data-testid="backlog-board"/, `${stage}: the next visit shows the list again`);
  }
});

test('the Released count opens the Releases screen (#255)', async () => {
  const app = await home();
  await clickHome(app, '[data-testid="home-flow-count"]', { testid: 'home-flow-count', stage: 'released' });
  assert.equal(app.state().view, 'releases');
});

test('the strip follows the last project asked: a slower answer for the previous project is dropped (#255)', async () => {
  let releaseP1;
  const slow = new Promise((r) => { releaseP1 = r; });
  const app = loadApp({
    storage: { 'craftorio.currentProject': 'p1' },
    api: {
      ...BASE_API,
      listProjects: async () => [...PROJECTS, { id: 'p2', name: 'Project Two', repo: 'https://github.com/o/two', folder: 'C:/work/two' }],
      listDiscoveryCards: async (projectId) => {
        if (projectId === 'p1') { await slow; return [{ id: 'x', column: 'inbox' }, { id: 'y', column: 'inbox' }, { id: 'z', column: 'inbox' }]; }
        return [{ id: 'w', column: 'inbox' }];
      },
    },
  });
  await app.boot();
  app.run("showView('dashboard')");
  await app.settle(10);
  app.run("window.CurrentProject.set('p2')");
  app.run("showView('dashboard')");
  await app.settle(30);
  assert.equal(count(app, 'inbox'), '1', 'p2 has 1 card in its Inbox');
  releaseP1();
  await app.settle(30);
  assert.equal(count(app, 'inbox'), '1', 'the late answer for p1 does not replace p2\'s');
});

// ---- Today --------------------------------------------------------------------------------------

// the Home redesign (2026-11-28, the owner's choice): the last 24 hours instead of the calendar day; the cost is the
// real runs started in them, the last watch's cost the real runs started in its window
test('"Last 24 hours" counts the runs finished and failed in them, the cost of their real runs and of the last watch\'s, and the occupancy', async () => {
  const yesterday = iso(26 * 60);
  const now = new Date().toISOString();
  const app = await home({
    listRuns: async () => ({ runs: [
      { runId: 'a', status: 'success', startedAt: now, finishedAt: now },
      { runId: 'b', status: 'success', startedAt: now, finishedAt: now },
      { runId: 'c', status: 'failed', startedAt: now, finishedAt: now },
      { runId: 'd', status: 'success', startedAt: yesterday, finishedAt: yesterday },
      // (the night's runs: none finished nor failed, so the day's counts stay the ones above)
      { runId: 'n1', status: 'running', startedAt: iso(600), costUsd: 1.25 },
      { runId: 'n2', status: 'running', startedAt: iso(500), costUsd: 2, mock: true },
      { runId: 'n3', status: 'running', startedAt: iso(100), costUsd: 5 },
    ] }),
    getUsage: async () => ({ spending: { day: { spentUsd: 3.5 } } }),
    getOccupancy: async () => ({ occupancy: 0.36, activeHours: 8.6, idleNowMinutes: 0, running: 1 }),
    nightWatchMorning: async () => ({ window: { from: iso(720), to: iso(240) }, summary: { ran: 'Ran 1 run overnight.' } }),
  });
  await app.settle(20);
  assert.equal(stat(app, 'Runs finished'), '2', 'a run of 26 hours ago is not in the last 24 hours');
  assert.equal(stat(app, 'Runs failed'), '1');
  assert.equal(stat(app, 'Cost'), '$6.25', 'the real runs started in the last 24 hours (n1 and n3; n2 is simulated)');
  assert.equal(stat(app, 'Cost of the last watch'), '$1.25', 'the real runs started in the last watch\'s window only');
  assert.equal(stat(app, '24/7 occupancy'), '36%');
});

test('"Last 24 hours" shows tonight\'s cost while the Night watch is spending (#255)', async () => {
  const app = await home({ getUsage: async () => ({ spending: { day: { spentUsd: 1 }, night: { spentUsd: 0.8, estimated: true } } }) });
  await app.settle(20);
  assert.equal(stat(app, 'Cost tonight'), '≈ $0.80');
  assert.equal(stat(app, 'Cost of the last watch'), undefined);
});

// ---- Open roadmap -------------------------------------------------------------------------------

test('"Open roadmap" before the Backlog was ever read opens the Roadmap and shows the stage once it is drawn (#255)', async () => {
  const app = await home({
    getBacklog: async () => ({
      issues: [], epics: [],
      roadmap: { stages: [
        { name: 'Checkout', items: [{ id: 'i1', status: 'done', issues: [] }] },
        { name: 'Payments', items: [{ id: 'i2', status: 'failed', issues: [ref(21, 'Refund')], error: 'tests failed' }] },
      ] },
    }),
  });
  const failed = needRows(app).find((r) => r.kind === 'failed-item');
  assert.match(failed.html, /data-home-roadmap="2"/);
  await clickHome(app, '[data-home-roadmap]', { homeRoadmap: '2' });
  await app.settle(20);
  assert.equal(app.state().view, 'roadmap');
  assert.equal(app.el('#bl-list .rm-stage[data-stage="1"]').classList.contains('flash'), true, 'stage 2 is shown once the backlog is read');
});
