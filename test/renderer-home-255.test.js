// #255 Home: one overview of the flow from Inbox to Release, with Analytics as a tab. The first screen
// (the menu's Home) opens on the flow strip of the header's project (Inbox → Discovery → Ready →
// Backlog To do → Running → Merged locally → Released, a stage whose screen does not exist yet left
// out), "What needs you" (gates waiting with their age, failed roadmap items, discovery cards), "Today"
// (cost, runs finished and failed, the 24/7 occupancy, the next roadmap stage), an empty state for a
// new workspace, and an Analytics tab that keeps Analytics' own tabs (Analytics leaves the menu). The
// Oracle's dock and the Night watch morning summary stay on it.
// The page is the real one (test/renderer-app-harness.js loads index.html's scripts in a vm sandbox
// with a fake window.api; nothing is parsed, the tests read the markup strings the views produce).
// The contract assumed here:
// - Home is the view of the menu entry labelled "Home" (today id 'dashboard'); its section is
//   #view-<def.section || id>.
// - Tabs: role="tab", data-testid="home-tab-overview" / "home-tab-analytics", Overview selected
//   (aria-selected="true") by default. A tab click reaches the tab element
//   ([data-testid="home-tab-analytics"]) or a delegated listener on the Home section or the document.
// - Flow strip: data-testid="home-flow-strip"; each stage data-testid="home-flow-stage" with
//   data-stage (inbox, discovery, ready, todo, running, merged, released) and its count in a child
//   data-testid="home-flow-count". A click on a stage element opens its screen.
// - Needs you: data-testid="home-needs-you"; items data-testid="home-needs-item" with data-kind
//   gate | failed-item | discovery, each with a <button>.
// - Today: data-testid="home-today". Empty state: data-testid="home-empty" with the buttons
//   home-empty-create-project, home-empty-capture-idea, home-empty-run-workflow.
// The example data's sources (the api the screens already call): listDiscoveryCards(projectId,
// column) for the Inbox; getBacklog(projectId).issues' `column` (todo, in_progress, local, done) and
// .roadmap for the Backlog, the failed items and the next stage; listActiveRuns() for the runs in
// progress and their gates (requested_at); listUnpushed() for merged locally; listReleases(projectId)
// for the released. Each stage's count is the same whichever of these sources a stage is read from.
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadApp, navEntries, text } = require('./renderer-app-harness');

const NOW = Date.now();
const iso = (minsAgo) => new Date(NOW - minsAgo * 60000).toISOString();

const PROJECTS = [
  { id: 'p1', name: 'Project One', repo: 'https://github.com/o/r', folder: 'C:/work/one' },
  { id: 'p2', name: 'Project Two', repo: 'https://github.com/o/two', folder: 'C:/work/two' },
];

// discovery cards: p1 has 3 in the Inbox (and 2 in Triage), p2 has 7 in the Inbox
const card = (id, column, title) => ({ id, title, type: 'idea', column, author: 'alice', created: iso(60), updated: iso(60), attachments: [] });
const CARDS = {
  p1: [
    card('20261004-a001', 'inbox', 'Idea one'), card('20261004-a002', 'inbox', 'Idea two'), card('20261004-a003', 'inbox', 'Idea three'),
    card('20261004-a004', 'triage', 'Triaged one'), card('20261004-a005', 'triage', 'Triaged two'),
  ],
  p2: Array.from({ length: 7 }, (_, i) => card(`20261004-b00${i}`, 'inbox', `Other idea ${i}`)),
};

const issue = (number, column, title = `Issue ${number}`) => ({ number, title, state: column === 'done' ? 'closed' : 'open', column, labels: [], isEpic: false, url: `https://github.com/o/r/issues/${number}` });
const ref = (number, title) => ({ number, title, url: `https://github.com/o/r/issues/${number}` });
// p1's backlog: 4 to do, 2 in progress, 5 merged locally, 1 done (released); its roadmap: the stage
// "Checkout" done, the stage "Payments" (the next one) with a failed item and a planned one
const BACKLOG = {
  p1: {
    issues: [
      issue(11, 'todo'), issue(12, 'todo'), issue(13, 'todo'), issue(14, 'todo'),
      issue(15, 'in_progress'), issue(16, 'in_progress'),
      issue(17, 'local'), issue(18, 'local'), issue(19, 'local'), issue(20, 'local'), issue(22, 'local'),
      issue(30, 'done', 'Add a /health endpoint'),
    ],
    epics: [],
    roadmap: {
      state: 'running',
      stages: [
        { id: 'st1', name: 'Checkout', note: '', items: [{ id: 'i1', status: 'done', workflow: 'software-development.yaml', inputs: {}, issues: [ref(30, 'Add a /health endpoint')], runId: 'r0', runs: ['r0'], error: null }] },
        { id: 'st2', name: 'Payments', note: '', items: [
          { id: 'i2', status: 'failed', workflow: 'software-development.yaml', inputs: {}, issues: [ref(21, 'Refund a failed payment')], runId: 'r9', runs: ['r9'], error: 'Run r9 failed: the tests did not pass' },
          { id: 'i3', status: 'planned', workflow: 'software-development.yaml', inputs: {}, issues: [ref(23, 'Pay by link')], runId: null, runs: [], error: null },
        ] },
      ],
    },
  },
  p2: { issues: [issue(40, 'todo'), issue(41, 'local')], epics: [], roadmap: { state: 'planned', stages: [] } },
};

// two runs in progress on p1 (r1 waits at a gate asked 90 minutes ago), one on p2
const ACTIVE = [
  { runId: 'r1', workflow: 'software-development', file: 'software-development.yaml', projectId: 'p1', project_id: 'p1', issues: [ref(15, 'Issue 15')], startedAt: iso(120), status: 'running', waiting: 1, inputs: {},
    gates: [{ approval_id: 'a1', step_id: 'review', message: 'Approve the change?', requested_at: iso(90), ts: iso(90) }], passedGates: [] },
  { runId: 'r2', workflow: 'software-development', file: 'software-development.yaml', projectId: 'p1', project_id: 'p1', issues: [ref(16, 'Issue 16')], startedAt: iso(30), status: 'running', waiting: 0, inputs: {}, gates: [], passedGates: [] },
  { runId: 'r3', workflow: 'software-development', file: 'software-development.yaml', projectId: 'p2', project_id: 'p2', issues: [], startedAt: iso(10), status: 'running', waiting: 0, inputs: {}, gates: [], passedGates: [] },
];

const RELEASES = {
  p1: { releases: [{ version: 'v1.2.0', date: iso(600), issues: [ref(30, 'Add a /health endpoint')], runs: 3, cost: 4.5, tests: { unit: 'pass' }, notes: 'Health check' }], next: { issues: [], commits: 5, runs: 0, notes: '' } },
  p2: { releases: [], next: { issues: [], commits: 1, runs: 0, notes: '' } },
};

const MORNING = {
  window: { from: iso(720), to: iso(240) },
  summary: { ran: 'Ran 3 runs overnight.', did: 'Retried 1 failed item.', waits: '1 gate waits for you.', safety: 'No safety alarm.', alarm: false },
};

// the first argument as { projectId, ... } whether the view passes positional args or one object
const argsOf = (args, names) => (args[0] && typeof args[0] === 'object' ? args[0] : Object.fromEntries(names.map((n, i) => [n, args[i]])));

const EXAMPLE_API = {
  listProjects: async () => PROJECTS,
  getSettings: async () => ({ lastProject: 'p1' }),
  listWorkflows: async () => [{ file: 'software-development.yaml', name: 'software-development', category: 'build' }],
  listDiscoveryCards: async (...a) => {
    const { projectId, column } = argsOf(a, ['projectId', 'column']);
    return (CARDS[projectId] || []).filter((c) => !column || c.column === column);
  },
  getBacklog: async (...a) => BACKLOG[argsOf(a, ['projectId']).projectId] || { issues: [], epics: [], roadmap: { stages: [] } },
  listActiveRuns: async () => ACTIVE,
  listUnpushed: async () => [{ projectId: 'p1', name: 'Project One', base: 'main', ahead: 5, issues: [17, 18, 19, 20, 22] }, { projectId: 'p2', name: 'Project Two', base: 'main', ahead: 1, issues: [41] }],
  listReleases: async (...a) => RELEASES[argsOf(a, ['projectId']).projectId] || { releases: [], next: null },
  nightWatchMorning: async () => MORNING,
};

const homeEntry = (app) => navEntries(app.defs).find((e) => text(e.label) === 'Home');

// Home shown for the header's project p1 (or with `api` / `storage` overrides)
async function home({ api = {}, storage = { 'multiagent.currentProject': 'p1' } } = {}) {
  const app = loadApp({ storage, api: { ...EXAMPLE_API, ...api } });
  await app.boot();
  const entry = homeEntry(app);
  assert.ok(entry, 'a menu entry labelled "Home"');
  app.run(`showView(${JSON.stringify(entry.id)})`);
  await app.settle(30);
  const def = app.defs.get(entry.id);
  return { app, id: entry.id, section: `#view-${def.section || entry.id}` };
}

// every markup string the page holds: what was written into an element or inserted, then the views' own markup
function pageMarkup(app) {
  const parts = [];
  for (const el of [...app.elements.values(), ...app.created]) {
    parts.push(String(el.innerHTML || ''));
    for (const [, html] of el.inserted || []) parts.push(String(html || ''));
  }
  for (const def of app.defs.values()) parts.push(String(def.markup || ''), String(def.modals || ''));
  return parts.join('\n');
}

// the opening tags carrying data-testid="<testid>", each with its markup up to the next one (or `max` chars)
function blocks(html, testid, max = 2000) {
  const re = new RegExp(`<[a-z][^>]*\\bdata-testid="${testid}"[^>]*>`, 'gi');
  const tags = [...html.matchAll(re)];
  return tags.map((m, i) => {
    const end = i + 1 < tags.length ? Math.min(tags[i + 1].index, m.index + max) : m.index + max;
    return { tag: m[0], html: html.slice(m.index, end) };
  });
}
// one section of Home: from its tag up to the next Home section (or 3000 chars)
const SECTIONS = ['home-flow-strip', 'home-needs-you', 'home-today', 'home-empty'];
function section(html, testid) {
  const at = html.search(new RegExp(`<[a-z][^>]*\\bdata-testid="${testid}"`, 'i'));
  if (at < 0) return null;
  let end = at + 3000;
  for (const other of SECTIONS.filter((s) => s !== testid)) {
    const n = html.indexOf(`data-testid="${other}"`, at + 1);
    if (n > at && n < end) end = n;
  }
  return html.slice(at, end);
}
const attr = (tag, name) => new RegExp(`\\b${name}="([^"]*)"`).exec(tag)?.[1];

// the flow strip's stages in markup order: { stage: count }, a filled count winning over an empty one
function flowStages(app) {
  const out = {};
  for (const b of blocks(pageMarkup(app), 'home-flow-stage', 600)) {
    const stage = attr(b.tag, 'data-stage');
    const at = b.html.search(/\bdata-testid="home-flow-count"/);
    const count = at < 0 ? '' : (/^\s*(\d+)/.exec(text(b.html.slice(b.html.indexOf('>', at) + 1))) || [])[1] || '';
    if (stage && (count || !(stage in out))) out[stage] = count;
  }
  return out;
}

// a click on `sel` (given its dataset/attrs) that reaches its own handlers, the Home section's, then the document's
async function clickIn(app, sectionSel, sel, { dataset = {}, attrs = {}, within = [] } = {}) {
  await app.click(sel, { dataset, attrs, within: [...within, sectionSel] });
  await app.settle(10);
}

// ---- the menu -----------------------------------------------------------------------------------

test('Home is the first screen and Analytics leaves the menu (#255)', async () => {
  const app = loadApp({ api: EXAMPLE_API });
  await app.boot();
  const labels = navEntries(app.defs).map((e) => text(e.label));
  assert.ok(labels.includes('Home'), `a Home entry: ${labels.join(', ')}`);
  assert.ok(!labels.includes('Analytics'), `"Analytics" is still a menu entry: ${labels.join(', ')}`);
  assert.equal(app.state().view, homeEntry(app).id, 'the page opens on Home');
});

// ---- the tabs -----------------------------------------------------------------------------------

test('Home has the tabs Overview and Analytics, Overview selected by default (#255)', async () => {
  const { app } = await home();
  const html = pageMarkup(app);
  const overview = blocks(html, 'home-tab-overview')[0];
  const analytics = blocks(html, 'home-tab-analytics')[0];
  assert.ok(overview, 'a tab data-testid="home-tab-overview"');
  assert.ok(analytics, 'a tab data-testid="home-tab-analytics"');
  assert.equal(attr(overview.tag, 'role'), 'tab');
  assert.equal(attr(analytics.tag, 'role'), 'tab');
  assert.match(text(overview.html), /^Overview/);
  assert.match(text(analytics.html), /^Analytics/);
  const selected = (b, testid) => {
    const el = [...app.elements.values(), ...app.created].find((e) => e.attrs['data-testid'] === testid || e.dataset.testid === testid);
    return el?.attrs['aria-selected'] ?? attr(b.tag, 'aria-selected');
  };
  assert.equal(selected(overview, 'home-tab-overview'), 'true', 'Overview is selected');
  assert.notEqual(selected(analytics, 'home-tab-analytics'), 'true', 'Analytics is not selected');
});

test('the Analytics tab shows Analytics with its own tabs Usage, Performance, Run and 24/7 (#255)', async () => {
  const { app, section: homeSel } = await home();
  assert.equal(app.callsTo('getAnalytics').length, 0, 'Overview does not load the analytics');
  await clickIn(app, homeSel,'[data-testid="home-tab-analytics"]', {
    dataset: { testid: 'home-tab-analytics', tab: 'analytics', homeTab: 'analytics' },
    attrs: { role: 'tab', 'data-testid': 'home-tab-analytics' },
  });
  await app.settle(20);
  assert.ok(app.callsTo('getAnalytics').length > 0, 'the Analytics tab loads its Usage tab');
  const labels = [...pageMarkup(app).matchAll(/<button\b[^>]*\bdata-an-tab="[^"]+"[^>]*>([^<]*)</g)].map((m) => m[1].trim());
  for (const label of ['Usage', 'Run', '24/7']) assert.ok(labels.includes(label), `an Analytics tab "${label}": ${labels.join(', ')}`);
  assert.ok(labels.some((l) => /Performance/.test(l)), `an Analytics Performance tab: ${labels.join(', ')}`);
});

// ---- the flow strip -----------------------------------------------------------------------------

test('the flow strip shows each stage with its count for the header\'s project; stages without a screen are left out (#255)', async () => {
  const { app } = await home();
  assert.ok(section(pageMarkup(app), 'home-flow-strip'), 'a flow strip (data-testid="home-flow-strip")');
  const stages = flowStages(app);
  // Discovery (Triage, Shape, Define) and Ready live on the Discovery board, not a screen yet (#261)
  if (!app.defs.has('discovery')) {
    assert.ok(!('discovery' in stages), 'the Discovery stage is hidden while its screen does not exist');
    assert.ok(!('ready' in stages), 'the Ready stage is hidden while its screen does not exist');
  }
  const known = Object.fromEntries(Object.entries(stages).filter(([s]) => !['discovery', 'ready'].includes(s)));
  assert.deepEqual(known, { inbox: '3', todo: '4', running: '2', merged: '5', released: '1' });
});

test('the flow strip follows the header\'s project (#255)', async () => {
  const { app, id } = await home();
  app.run("window.CurrentProject.set('p2')");
  await app.settle(10);
  app.run(`showView(${JSON.stringify(id)})`);
  await app.settle(30);
  const stages = flowStages(app);
  assert.equal(stages.inbox, '7', 'p2 has 7 cards in its Inbox');
  assert.equal(stages.todo, '1', 'p2 has 1 issue to do');
});

test('a stage\'s count opens its screen: Inbox, Backlog To do, Released (#255)', async () => {
  for (const [stage, view] of [['inbox', 'inbox'], ['todo', 'backlog'], ['released', 'releases']]) {
    const { app, section: homeSel } = await home();
    await clickIn(app, homeSel,'[data-testid="home-flow-stage"]', {
      dataset: { testid: 'home-flow-stage', stage },
      attrs: { 'data-testid': 'home-flow-stage', 'data-stage': stage },
      within: ['[data-testid="home-flow-strip"]'],
    });
    assert.equal(app.state().view, view, `the ${stage} stage opens ${view}`);
  }
});

// ---- what needs you -----------------------------------------------------------------------------

test('"What needs you" lists the waiting gate with its age and the failed roadmap item, each with a button (#255)', async () => {
  const { app } = await home();
  const needs = section(pageMarkup(app), 'home-needs-you');
  assert.ok(needs, 'a "What needs you" block (data-testid="home-needs-you")');
  const items = blocks(needs, 'home-needs-item', 1500);
  const gate = items.find((b) => attr(b.tag, 'data-kind') === 'gate');
  const failed = items.find((b) => attr(b.tag, 'data-kind') === 'failed-item');
  assert.ok(gate, `a gate item: ${text(needs)}`);
  assert.ok(failed, `a failed-item item: ${text(needs)}`);
  assert.match(text(gate.html), /\b(1\s*h|90\s*min|1\s*hour)/i, `the gate shows its age (asked 90 minutes ago): ${text(gate.html)}`);
  assert.match(gate.html, /<button\b/, 'the gate item has a button');
  assert.match(text(failed.html), /#21|Refund a failed payment/, `the failed item names its issue: ${text(failed.html)}`);
  assert.match(failed.html, /<button\b/, 'the failed item has a button');
});

// ---- today --------------------------------------------------------------------------------------

test('"Today" shows the cost, the runs finished and failed, the 24/7 occupancy and the next roadmap stage (#255)', async () => {
  const { app } = await home();
  const today = section(pageMarkup(app), 'home-today');
  assert.ok(today, 'a "Today" block (data-testid="home-today")');
  const t = text(today);
  assert.match(t, /cost/i, `the cost of the day: ${t}`);
  assert.match(t, /finished/i, `the runs finished: ${t}`);
  assert.match(t, /failed/i, `the runs failed: ${t}`);
  assert.match(t, /24\/7|occupancy/i, `the 24/7 occupancy: ${t}`);
  assert.ok(t.includes('Payments'), `the next roadmap stage: ${t}`);
});

// ---- the empty state ----------------------------------------------------------------------------

test('a new workspace (no project, no run) shows how to start: create a project, capture an idea, run a workflow (#255)', async () => {
  const { app } = await home({
    storage: {},
    api: {
      listProjects: async () => [],
      getSettings: async () => ({}),
      listWorkflows: async () => [],
      listActiveRuns: async () => [],
      listUnpushed: async () => [],
      listDiscoveryCards: async () => [],
      getBacklog: async () => null,
      listReleases: async () => null,
      nightWatchMorning: async () => null,
    },
  });
  const empty = section(pageMarkup(app), 'home-empty');
  assert.ok(empty, 'an empty state (data-testid="home-empty")');
  for (const testid of ['home-empty-create-project', 'home-empty-capture-idea', 'home-empty-run-workflow']) {
    const b = blocks(empty, testid)[0];
    assert.ok(b, `a button data-testid="${testid}"`);
    assert.match(b.tag, /^<button\b/i, `${testid} is a button`);
  }
});

// ---- what does not change -----------------------------------------------------------------------

test('the Oracle stays docked on Home (#255)', async () => {
  const { app, section: homeSel } = await home();
  const inserted = app.el(homeSel).inserted.map(([, html]) => html).join('\n');
  assert.match(inserted, /id="oracle-dock"/, 'the Oracle dock is in the Home section');
});

test('the Night watch morning summary still shows on Home (#255)', async () => {
  const { app } = await home();
  assert.ok(app.callsTo('nightWatchMorning').length > 0, 'Home asked for the morning summary');
  const t = text(pageMarkup(app));
  assert.ok(t.includes('Ran 3 runs overnight.'), 'the morning summary is shown');
  assert.ok(t.includes('1 gate waits for you.'), 'the morning summary is shown whole');
});
