// #354 A project's Conflict map tab: one table merging the Roadmap's Conflict map panel (the saved
// map of packages/engine/domains/project/conflict-map.js, the Backlog payload's `conflictMap`) and Analytics › Performance's
// "Files most runs edit" (channel analytics:performance, packages/engine/domains/project/repo-performance.js). The Roadmap and
// Analytics › Performance lose their own copy for a one-line link "Conflict map: in Projects ›
// <project>". Acceptance tests written before the code; the tabs themselves are in
// test/renderer-projects-354.test.js.
// The page is the real one (test/renderer-app-harness.js), read through test/project-page-helpers.js.
// The contract assumed here (data-testids shared with features/steps/projects.steps.js):
// - data sources: the existing channels, api.getRepositoryPerformance({ projectId, from, to, marker })
//   and api.getBacklog(projectId).conflictMap (no new channel);
// - the tab is data-testid="project-conflict-map"; each file is a row data-testid="project-conflict-row"
//   carrying the attributes its (delegated) click handler reads; an opened row shows
//   data-testid="project-conflict-detail" (the runs behind the count, the single lines most changed
//   in the file, the trend);
// - the controls in the tab: 7 / 30 / 90 days buttons, From / To date inputs, a before/after marker
//   input, Refresh, and "Ask for a plan" when a file is over the limit;
// - the link on the Roadmap and on Analytics › Performance: data-testid="conflict-map-link", a click
//   opens the project's page on its Conflict map tab.
const test = require('node:test');
const assert = require('node:assert/strict');
const H = require('./roadmap-status-helpers');
const { loadApp } = require('./renderer-app-harness');
const { clickRendered, hasTestId, pageMarkup, region, tabsOf } = require('./project-page-helpers');

const PROJECTS = [
  { id: 'p1', name: 'Project One', repo: 'https://github.com/o/one', folder: 'C:/work/one', exists: true, isGit: true },
  { id: 'p2', name: 'Project Two', repo: 'https://github.com/o/two', folder: 'C:/work/two', exists: true, isGit: true },
];
const DAY = 864e5;

// the saved conflict map: src/a.js changed by 4 of the 6 newest runs (hot), src/only-map.js by 2
const CONFLICT_MAP = {
  source: 'runs',
  runs: 6,
  runIds: ['r1', 'r2', 'r3', 'r4', 'r5', 'r6'],
  files: [
    { file: 'src/a.js', runs: 4, runIds: ['r1', 'r2', 'r3', 'r4'], conflicts: 3, lastRun: 'r1' },
    { file: 'src/only-map.js', runs: 2, runIds: ['r5', 'r6'], conflicts: 0, lastRun: 'r5' },
  ],
  lines: [{ file: 'src/a.js', line: 42, text: 'export const REGISTRY = [alpha, beta];', runIds: ['r1', 'r2'] }],
};

// analytics:performance: src/a.js edited by 6 of 10 runs (over the 30% limit), src/only-perf.js by 3
function perf(extra = {}) {
  return {
    project: { id: 'p1', name: 'Project One', folder: 'C:/work/one', isGit: true },
    from: '2026-09-13', to: '2026-10-12',
    runs: 10, runsWithCommits: 10, sharedLimit: 0.3,
    files: [
      { file: 'src/a.js', runs: 6, share: 0.6, lines: 120, recommendation: { kind: 'registry', text: 'Split it by feature', evidence: { share: 0.6, runs: 6, lines: 120, conflicts: 3 } } },
      { file: 'src/only-perf.js', runs: 3, share: 0.3, lines: 40 },
    ],
    topFile: { file: 'src/a.js', share: 0.6 },
    filesOverLimit: 1, conflictShare: 0.1, conflictRuns: 1, conflictCostShare: 0.05, costUsd: 12, peak: 2,
    compare: null,
    conflicts: [{ runId: 'r1', title: 'Run one', status: 'success', startedAt: '2026-10-01T10:00:00Z', via: 'local merge', costUsd: 1, files: ['src/a.js'], workflow: 'software-development.yaml' }],
    parallel: { hours: Array(24).fill(0), days: [] },
    empty: false,
    ...extra,
  };
}
const BACKLOG = (conflictMap) => ({ platform: 'github', syncedAt: '2026-10-01T00:00:00Z', issues: [], epics: [], conflictMap });
const ROADMAP = {
  state: 'planned', simulated: false, scope: null,
  stages: [{ id: 'st1', name: 'Checkout', note: '', items: [{ id: 'it1', status: 'planned', runId: null, runs: [], error: null, workflow: 'software-development.yaml', inputs: {}, issues: [{ number: 1, title: 'Issue 1', url: 'https://github.com/o/one/issues/1' }] }] }],
};

function page({ performance = async () => perf(), conflictMap = CONFLICT_MAP, backlog = null, storage = {} } = {}) {
  return loadApp({
    storage: { 'multiagent.currentProject': 'p1', ...storage },
    api: {
      listProjects: async () => PROJECTS,
      getSettings: async () => ({ lastProject: 'p1' }),
      listProjectRuns: async (id) => ({ runs: [], project: PROJECTS.find((p) => p.id === id), local: null }),
      getBacklog: async () => backlog || BACKLOG(conflictMap),
      syncBacklog: async () => backlog || BACKLOG(conflictMap),
      getRepositoryPerformance: performance,
    },
  });
}

// the project page of p1 on its Conflict map tab
async function conflictTab(opts) {
  const app = page(opts);
  await app.boot();
  app.run("openProjectView('p1')");
  await app.settle(10);
  const tab = tabsOf(region(app, 'project-page')).find((t) => t.label === 'Conflict map');
  assert.ok(tab, 'the project page has no "Conflict map" tab (role="tab")');
  await clickRendered(app, tab.el);
  await app.settle(10);
  return app;
}
const tabText = (app) => H.visibleText(region(app, 'project-conflict-map'));
const rows = (app) => H.findAll(region(app, 'project-conflict-map'), (e) => e.attrs['data-testid'] === 'project-conflict-row');
function row(app, file) {
  const found = rows(app).filter((r) => H.visibleText(r.inner).includes(file));
  assert.ok(found.length, `no row for ${file}: ${rows(app).map((r) => H.visibleText(r.inner)).join(' | ')}`);
  return found.at(-1);
}
const lastPerfArgs = (app) => app.callsTo('getRepositoryPerformance').at(-1)?.[0] || {};

// ---- the Conflict map tab -----------------------------------------------------------------------

test('#354 Conflict map tab: reads the performance of the project shown', async () => {
  const app = await conflictTab();
  assert.equal(lastPerfArgs(app).projectId, 'p1');
});

test('#354 Conflict map tab: "Loading…" while the data is read', async () => {
  const app = await conflictTab({ performance: () => new Promise(() => {}) });
  assert.match(tabText(app), /Loading/);
});

test('#354 Conflict map tab: a project whose folder is not a git repository says so', async () => {
  const app = await conflictTab({ conflictMap: null, performance: async () => perf({ project: { id: 'p1', name: 'Project One', isGit: false }, empty: true, files: [] }) });
  assert.match(tabText(app), /not a git repository/i);
});

test('#354 Conflict map tab: no runs with commits in the range says so', async () => {
  const app = await conflictTab({ conflictMap: null, performance: async () => perf({ empty: true, files: [], runs: 0, runsWithCommits: 0 }) });
  assert.match(tabText(app), /No runs with commits/i);
  assert.equal(rows(app).length, 0);
});

test('#354 Conflict map tab: an error shows its message', async () => {
  const app = await conflictTab({ performance: async () => { throw new Error('git log exploded'); } });
  assert.match(tabText(app), /git log exploded/);
});

test('#354 Conflict map tab: one table of both sources, a file found in only one of them included, ranked by how many runs edited it', async () => {
  const app = await conflictTab();
  const order = [...new Set(rows(app).map((r) => (H.visibleText(r.inner).match(/src\/[\w-]+\.js/) || [''])[0]))];
  assert.deepEqual(order, ['src/a.js', 'src/only-perf.js', 'src/only-map.js']);
});

test('#354 Conflict map tab: a row has its run count and share of runs', async () => {
  const app = await conflictTab();
  const t = H.visibleText(row(app, 'src/only-perf.js').inner);
  assert.match(t, /\b3\b/, `row: ${t}`);
  assert.match(t, /\b30%/, `row: ${t}`);
});

test('#354 Conflict map tab: a hot file has the hot badge, the others none', async () => {
  const app = await conflictTab();
  const hot = (file) => /\bhot\b/i.test(H.visibleText(row(app, file).inner));
  assert.deepEqual([hot('src/a.js'), hot('src/only-perf.js'), hot('src/only-map.js')], [true, false, false]);
});

test('#354 Conflict map tab: a row has the number of merge conflicts that named the file', async () => {
  const app = await conflictTab();
  assert.match(H.visibleText(row(app, 'src/a.js').inner), /\b3\b/);
  assert.match(tabText(app), /conflict/i);
});

test('#354 Conflict map tab: an opened row shows the runs behind the count, the lines most changed in the file and the trend', async () => {
  const app = await conflictTab();
  await clickRendered(app, row(app, 'src/a.js'));
  const detail = H.visibleText(region(app, 'project-conflict-detail'));
  assert.ok(['r1', 'r2', 'r3', 'r4'].every((id) => new RegExp(`\\b${id}\\b`).test(detail)), `detail: ${detail}`);
  assert.ok(detail.includes('export const REGISTRY = [alpha, beta];'), `detail: ${detail}`);
  assert.match(detail, /\b42\b/);
  assert.match(detail, /trend/i);
});

test('#354 Conflict map tab: the range (7 / 30 / 90 days, From, To), the before/after marker, Refresh and Ask for a plan', async () => {
  const app = await conflictTab();
  const tab = region(app, 'project-conflict-map');
  const buttons = H.findAll(tab, (e) => e.name === 'button').map((e) => H.visibleText(e.inner));
  for (const label of ['7 days', '30 days', '90 days', 'Refresh', 'Ask for a plan']) assert.ok(buttons.includes(label), `no "${label}" button: ${buttons.join(', ')}`);
  assert.equal(H.findAll(tab, (e) => e.name === 'input' && e.attrs.type === 'date').length, 2, 'From and To date inputs');
  assert.ok(H.findEl(tab, (e) => e.name === 'label' && /before\/after/i.test(H.visibleText(e.inner)) && /<input\b/.test(e.inner)), 'a Before/after marker input');
});

test('#354 Conflict map tab: Refresh reads the data again', async () => {
  const app = await conflictTab();
  const before = app.callsTo('getRepositoryPerformance').length;
  const refresh = H.findAll(region(app, 'project-conflict-map'), (e) => e.name === 'button' && H.visibleText(e.inner) === 'Refresh').at(-1);
  await clickRendered(app, refresh);
  assert.equal(app.callsTo('getRepositoryPerformance').length - before, 1);
});

test('#354 Conflict map tab: "7 days" reads the last 7 days', async () => {
  const app = await conflictTab();
  const seven = H.findAll(region(app, 'project-conflict-map'), (e) => e.name === 'button' && H.visibleText(e.inner) === '7 days').at(-1);
  assert.ok(seven, 'no "7 days" button');
  await clickRendered(app, seven);
  const { from, to } = lastPerfArgs(app);
  assert.equal((Date.parse(to) - Date.parse(from)) / DAY, 6, `from ${from} to ${to}`);
});

// an event of `type` on a parsed element of the tab, through the project page's own listeners
async function fire(app, type, el, extra = {}) {
  const target = app.el(`[data-test-${type}-${(fired += 1)}]`);
  for (const [k, v] of Object.entries(el.attrs)) {
    if (k.startsWith('data-')) target.dataset[k.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = v;
    else target.attrs[k] = v;
  }
  Object.assign(target, extra);
  const ev = { type, target, currentTarget: target, key: extra.key || '', defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, stopPropagation() {} };
  for (const fn of app.el('#view-project').listeners[type] || []) await fn(ev);
  await app.settle(10);
  return ev;
}
let fired = 0;
const input = (app, attr) => H.findEl(region(app, 'project-conflict-map'), (e) => e.name === 'input' && attr in e.attrs);
const pressed = (app) => H.findAll(region(app, 'project-conflict-map'), (e) => e.name === 'button' && e.attrs['aria-pressed'] === 'true').map((e) => H.visibleText(e.inner));
const detailShown = (app) => hasTestId(app, 'project-conflict-detail', { defs: false });

test('#354 Conflict map tab: Enter or Space on a row opens it, another key does not', async () => {
  for (const [key, opens] of [['Enter', true], [' ', true], ['a', false]]) {
    const app = await conflictTab();
    await fire(app, 'keydown', row(app, 'src/a.js'), { key });
    assert.equal(detailShown(app), opens, `key ${JSON.stringify(key)}`);
  }
});

test('#354 Conflict map tab: a From date reads that range again, with no quick range pressed', async () => {
  const app = await conflictTab();
  assert.deepEqual(pressed(app), ['30 days']);
  const before = app.callsTo('getRepositoryPerformance').length;
  await fire(app, 'change', input(app, 'data-pcm-from'), { value: '2026-09-01' });
  assert.equal(app.callsTo('getRepositoryPerformance').length - before, 1);
  assert.equal(lastPerfArgs(app).from, '2026-09-01');
  assert.deepEqual(pressed(app), []);
});

test('#354 Conflict map tab: a To date reads the range up to it', async () => {
  const app = await conflictTab();
  await fire(app, 'change', input(app, 'data-pcm-to'), { value: '2026-10-05' });
  assert.equal(lastPerfArgs(app).to, '2026-10-05');
  assert.deepEqual(pressed(app), []);
});

test('#354 Conflict map tab: a before/after marker reads the data again with it', async () => {
  const app = await conflictTab();
  await fire(app, 'change', input(app, 'data-pcm-marker'), { value: '  abc1234 ' });
  assert.equal(lastPerfArgs(app).marker, 'abc1234');
});

test('#354 Conflict map tab: a file only the saved map has shows the map\'s share of its runs', async () => {
  const app = await conflictTab();
  const t = H.visibleText(row(app, 'src/only-map.js').inner);
  assert.match(t, /\b2\b/, `row: ${t}`);
  assert.match(t, /\b33%/, `row: ${t}`);
});

test('#354 Conflict map tab: "Create issue" of an opened file over the limit opens the Issue tracker prefilled', async () => {
  const app = await conflictTab();
  // the Start drawer is another screen: record what it is asked to open
  app.run('openDrawer = (o) => { globalThis.__drawer = o; }');
  await clickRendered(app, row(app, 'src/a.js'));
  const btn = H.findEl(region(app, 'project-conflict-detail'), (e) => e.attrs['data-testid'] === 'pcm-create-issue');
  assert.ok(btn, 'no "Create issue" button in the opened row');
  await clickRendered(app, btn);
  const drawer = app.run('globalThis.__drawer && JSON.stringify(globalThis.__drawer)');
  assert.ok(drawer, 'the Issue tracker drawer did not open');
  const { workflow, project, inputs } = JSON.parse(drawer);
  assert.deepEqual([workflow, project], ['issue-tracker.yaml', 'p1']);
  assert.ok(inputs.request.includes('src/a.js') && inputs.request.includes('Split it by feature'), `request: ${inputs.request}`);
});

// ---- what the Roadmap and Analytics › Performance keep ------------------------------------------

test('#354 the Roadmap no longer draws the Conflict map panel: a one-line link "Conflict map: in Projects › <project>" in its place', async () => {
  const app = page({ backlog: { ...BACKLOG(CONFLICT_MAP), roadmap: ROADMAP } });
  await app.boot();
  app.run("showView('roadmap')");
  await app.settle(10);
  const now = pageMarkup(app, { defs: false });
  assert.equal(hasTestId(app, 'conflict-map', { defs: false }), false, 'the Roadmap still draws the Conflict map panel');
  const link = H.findEl(now, (e) => e.attrs['data-testid'] === 'conflict-map-link');
  assert.equal(link ? H.visibleText(link.inner) : null, 'Conflict map: in Projects › Project One');
});

function analytics() {
  return page({ storage: { 'multiagent.analytics': JSON.stringify({ tab: 'performance' }) } });
}

test('#354 Analytics › Performance no longer has "Files most runs edit": the link takes its place, the rest stays', async () => {
  const app = analytics();
  await app.boot();
  app.run("showView('analytics')");
  await app.settle(10);
  const body = app.el('#an-body').innerHTML;
  const t = H.visibleText(body);
  assert.equal(t.includes('Files most runs edit'), false, 'still "Files most runs edit"');
  const link = H.findEl(body, (e) => e.attrs['data-testid'] === 'conflict-map-link');
  assert.equal(link ? H.visibleText(link.inner) : null, 'Conflict map: in Projects › Project One');
  assert.ok(t.includes('Merge conflicts') && t.includes('Parallel work'), 'the rest of the tab is gone');
});

test('#354 the link "Conflict map: in Projects › <project>" opens the project\'s page on its Conflict map tab', async () => {
  const app = analytics();
  await app.boot();
  app.run("showView('analytics')");
  await app.settle(10);
  const link = H.findEl(app.el('#an-body').innerHTML, (e) => e.attrs['data-testid'] === 'conflict-map-link');
  assert.ok(link, 'no Conflict map link on Analytics › Performance');
  await clickRendered(app, link, ['#view-analytics', '#an-body']);
  assert.equal(app.state().view, 'project');
  const selected = [...new Set(tabsOf(region(app, 'project-page')).filter((t) => t.selected).map((t) => t.label))];
  assert.deepEqual(selected, ['Conflict map']);
});
