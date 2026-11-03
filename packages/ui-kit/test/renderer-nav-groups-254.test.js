// #254 Menu by the flow: the sidebar in groups (Plan & Design, Code & Build, Workflows, AI) built from
// the views' own `nav` entries, Home at the top, Night watch and Settings at the end; a group
// collapses (remembered); Roadmap is a screen of its own (Code & Build › Roadmap); the Workflows tabs
// are menu items. Projects lived inside Settings until #354 brought it back to the menu (Code & Build,
// before Backlog: test/renderer-projects-354.test.js).
// The grouping rule is packages/ui-kit/nav-groups.js (pure, no DOM: window.NavGroups in the page,
// module.exports in Node), required inside each test so this file loads before it exists. The views
// are the real page (test/renderer-app-harness.js loads index.html's scripts in a vm sandbox).
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { loadApp, makeStorage, navEntries, text } = require('./renderer-app-harness');

const NAV_GROUPS = path.join(__dirname, '..', 'nav-groups.js');
const navGroups = () => {
  delete require.cache[require.resolve(NAV_GROUPS)];
  return require(NAV_GROUPS);
};

// the layout as a flat list: a group's id, then its items' labels; an entry outside any group by its label
function tokens(layout) {
  return layout.flatMap((block) => (block.group
    ? [`[${block.group}]`, ...block.items.map((i) => text(i.label))]
    : block.items.map((i) => text(i.label))));
}

// #634: a fifth group, Monitor (Errors, Night watch), after AI
test('NavGroups.GROUPS: plan, code, workflows, ai and monitor, in that order, with their titles', () => {
  const { GROUPS } = navGroups();
  assert.deepEqual(GROUPS.map((g) => g.id), ['plan', 'build', 'workflows', 'ai', 'monitor']);
  assert.deepEqual(GROUPS.map((g) => g.title), ['Plan & Design', 'Code & Build', 'Workflows', 'AI', 'Monitor']);
});

test('navLayout: the groups come in their fixed order whatever the views\' order, each with its title and its items by order; an empty group is left out', () => {
  const { navLayout } = navGroups();
  const layout = navLayout([
    { id: 'usage', label: 'Usage', order: 90, group: 'ai' },
    { id: 'backlog', label: 'Backlog', order: 40, group: 'build' },
    { id: 'agents', label: 'Agents', order: 70, group: 'ai' },
    { id: 'duo', label: 'Write & Review', order: 120, group: 'plan' },
  ]);
  const grouped = layout.filter((b) => b.group);
  assert.deepEqual(grouped.map((b) => b.group), ['plan', 'build', 'ai']);
  assert.deepEqual(grouped.map((b) => b.title), ['Plan & Design', 'Code & Build', 'AI']);
  assert.deepEqual(grouped[2].items.map((i) => i.id), ['agents', 'usage']);
});

// #634: Night watch moved into the Monitor group, after Errors
test('the menu built from the real views: Home, Plan & Design, Code & Build, Workflows (its tabs), AI, Monitor (Errors, Night watch), then Settings', () => {
  const { navLayout } = navGroups();
  const app = loadApp();
  const entries = navEntries(app.defs);
  const expected = [
    'Home',
    '[plan]', 'Write & Review', 'AI Arena',
    '[build]', 'Projects', 'Backlog', 'Roadmap', 'Sessions',
    '[workflows]', 'Definitions', 'Runs', 'Builder', 'Pipelines',
    '[ai]', 'Agents', 'Skills', 'Usage',
    '[monitor]', 'Errors', 'Night watch',
    'Settings',
  ];
  // entries the issue does not place (e.g. Analytics) are left out of the comparison
  const got = tokens(navLayout(entries)).filter((t) => expected.includes(t));
  assert.deepEqual(got, expected);
});

test('no menu entry is left for the Dashboard (now Home), the Supervisor (now a drawer) or Artifacts (a tab of Runs)', () => {
  const app = loadApp();
  const labels = navEntries(app.defs).map((e) => text(e.label));
  for (const gone of ['Dashboard', 'Supervisor', 'Artifacts']) {
    assert.ok(!labels.includes(gone), `"${gone}" is still a menu entry: ${labels.join(', ')}`);
  }
  const home = navEntries(app.defs).find((e) => text(e.label) === 'Home');
  assert.equal(home?.id, 'dashboard', 'Home opens the dashboard screen');
  assert.ok(!home.group, 'Home is in no group');
});

test('the Workflows items open the Workflows screen on their tab: a view with several entries gives each its `tab`', () => {
  const app = loadApp();
  const wf = navEntries(app.defs).filter((e) => e.group === 'workflows');
  assert.ok(wf.every((e) => e.id === 'workflows'), 'every Workflows item opens the Workflows screen');
  assert.deepEqual(wf.map((e) => e.tab).sort(), ['builder', 'definitions', 'pipelines', 'runs']);
});

test('a group collapses and stays collapsed: the choice is kept in the given storage', () => {
  const storage = makeStorage();
  let ng = navGroups();
  assert.equal(ng.isCollapsed('build', storage), false);
  ng.setCollapsed('build', true, storage);
  assert.equal(ng.isCollapsed('build', storage), true);
  assert.equal(ng.isCollapsed('plan', storage), false);
  assert.ok(storage.length > 0, 'nothing was stored');
  ng = navGroups(); // a new window
  assert.equal(ng.isCollapsed('build', storage), true);
  ng.setCollapsed('build', false, storage);
  assert.equal(ng.isCollapsed('build', storage), false);
});

// #634: Monitor is the fifth
test('the page\'s sidebar shows the five group titles', async () => {
  const app = loadApp();
  await app.boot();
  // what the sidebar holds: its own markup, and what was put into it or into an element of it (`nav…` selectors)
  const seen = new Set();
  const parts = [];
  const walk = (el) => {
    if (!el || typeof el !== 'object' || seen.has(el)) return;
    seen.add(el);
    parts.push(el.innerHTML, el.textContent, ...(el.inserted || []).map(([, html]) => html));
    (el.appended || []).forEach(walk);
  };
  [...app.elements.entries()].filter(([sel]) => /sidebar|(^|[#.\s])nav/.test(sel)).forEach(([, el]) => walk(el));
  const dom = parts.map(text).join(' | ');
  for (const title of ['Plan & Design', 'Code & Build', 'Workflows', 'AI', 'Monitor']) {
    assert.ok(dom.includes(title), `the sidebar has no "${title}" group title`);
  }
});

// a click on a sidebar entry, through the sidebar's delegated listener (app.js)
async function clickNav(app, dataset) {
  const target = app.sandbox.document.createElement('button');
  target.className = 'nav-item';
  Object.assign(target.dataset, dataset);
  const sidebar = app.el('nav.sidebar');
  const ev = { type: 'click', target, currentTarget: sidebar, preventDefault() {}, stopPropagation() {} };
  await sidebar.onclick?.(ev);
  for (const fn of sidebar.listeners.click || []) await fn(ev);
  await app.settle();
}

test('Workflows › Definitions and Workflows › Pipelines in the menu open the Workflows screen on that tab', async () => {
  const app = loadApp();
  await app.boot();
  await clickNav(app, { view: 'workflows', tab: 'definitions' });
  assert.equal(app.state().view, 'workflows');
  assert.equal(app.state().workflowsTab, 'definitions');
  await clickNav(app, { view: 'workflows', tab: 'pipelines' });
  assert.equal(app.state().view, 'workflows');
  assert.equal(app.state().workflowsTab, 'pipelines');
});

test('the Backlog keeps its Board and Epics tabs; Roadmap is no longer one of its tabs', () => {
  const app = loadApp();
  const markup = app.defs.get('backlog').markup;
  assert.match(markup, /data-bl-tab="board"/);
  assert.match(markup, /data-bl-tab="epics"/);
  assert.doesNotMatch(markup, /data-bl-tab="roadmap"/);
});

test('Roadmap is a screen of its own, and the links that opened the Backlog\'s Roadmap tab open it', async () => {
  const app = loadApp();
  await app.boot();
  assert.ok(app.defs.has('roadmap'), 'no view registers the id "roadmap"');
  app.run("showView('backlog')");
  await app.settle();
  app.run('window.BacklogActions.showRoadmap()');
  await app.settle();
  assert.equal(app.state().view, 'roadmap');
  app.run("showView('backlog')");
  await app.settle();
  app.run('window.BacklogActions.openStage(1)');
  await app.settle();
  assert.equal(app.state().view, 'roadmap');
});

// a group's element in the sidebar, its title button and its items' box
function navGroup(app, id) {
  const el = app.created.find((e) => e.dataset.group === id && e.classList.contains('nav-group'));
  assert.ok(el, `no "${id}" group in the sidebar`);
  return {
    el,
    title: el.appended.find((n) => n.classList.contains('nav-group-title')),
    items: el.appended.find((n) => n.classList.contains('nav-group-items')),
  };
}

test('a click on a group\'s title folds it (aria-expanded false, its items hidden), remembered; a second click unfolds it', () => {
  const app = loadApp();
  const code = navGroup(app, 'build');
  assert.equal(code.title.getAttribute('aria-expanded'), 'true');
  assert.equal(code.items.classList.contains('hidden'), false);
  code.title.onclick();
  assert.equal(code.title.getAttribute('aria-expanded'), 'false');
  assert.equal(code.items.classList.contains('hidden'), true);
  assert.equal(code.el.classList.contains('collapsed'), true);
  assert.deepEqual(JSON.parse(app.sandbox.localStorage.getItem('multiagent.navCollapsed')), ['build']);
  // the other groups stay open
  assert.equal(navGroup(app, 'plan').items.classList.contains('hidden'), false);
  code.title.onclick();
  assert.equal(code.title.getAttribute('aria-expanded'), 'true');
  assert.equal(code.items.classList.contains('hidden'), false);
});

test('a group folded in a previous window is drawn folded', () => {
  const app = loadApp({ storage: { 'multiagent.navCollapsed': JSON.stringify(['ai']) } });
  const ai = navGroup(app, 'ai');
  assert.equal(ai.title.getAttribute('aria-expanded'), 'false');
  assert.equal(ai.items.classList.contains('hidden'), true);
  assert.equal(navGroup(app, 'build').items.classList.contains('hidden'), false);
});
