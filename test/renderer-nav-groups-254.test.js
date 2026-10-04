// #254 Menu by the flow: the sidebar in groups (Plan & Design, Code & Build, Workflows, AI) built from
// the views' own `nav` entries, Home at the top, Night watch and Settings at the end; a group
// collapses (remembered); Roadmap is a screen of its own (Code & Build › Roadmap); the Workflows tabs
// are menu items; Projects lives inside Settings.
// The grouping rule is src/renderer/nav-groups.js (pure, no DOM: window.NavGroups in the page,
// module.exports in Node), required inside each test so this file loads before it exists. The views
// are the real page (test/renderer-app-harness.js loads index.html's scripts in a vm sandbox).
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { loadApp, makeStorage, navEntries, text } = require('./renderer-app-harness');

const NAV_GROUPS = path.join(__dirname, '..', 'src', 'renderer', 'nav-groups.js');
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

test('NavGroups.GROUPS: plan, code, workflows and ai, in that order, with their titles', () => {
  const { GROUPS } = navGroups();
  assert.deepEqual(GROUPS.map((g) => g.id), ['plan', 'code', 'workflows', 'ai']);
  assert.deepEqual(GROUPS.map((g) => g.title), ['Plan & Design', 'Code & Build', 'Workflows', 'AI']);
});

test('navLayout: the groups come in their fixed order whatever the views\' order, each with its title and its items by order; an empty group is left out', () => {
  const { navLayout } = navGroups();
  const layout = navLayout([
    { id: 'usage', label: 'Usage', order: 90, group: 'ai' },
    { id: 'backlog', label: 'Backlog', order: 40, group: 'code' },
    { id: 'agents', label: 'Agents', order: 70, group: 'ai' },
    { id: 'duo', label: 'Write & Review', order: 120, group: 'plan' },
  ]);
  const grouped = layout.filter((b) => b.group);
  assert.deepEqual(grouped.map((b) => b.group), ['plan', 'code', 'ai']);
  assert.deepEqual(grouped.map((b) => b.title), ['Plan & Design', 'Code & Build', 'AI']);
  assert.deepEqual(grouped[2].items.map((i) => i.id), ['agents', 'usage']);
});

test('the menu built from the real views: Home, Plan & Design, Code & Build, Workflows (its tabs), AI, then Night watch and Settings', () => {
  const { navLayout } = navGroups();
  const app = loadApp();
  const entries = navEntries(app.defs);
  const expected = [
    'Home',
    '[plan]', 'Write & Review', 'AI Arena',
    '[code]', 'Backlog', 'Roadmap', 'Sessions',
    '[workflows]', 'Definitions', 'Runs', 'Builder', 'Pipelines',
    '[ai]', 'Agents', 'Skills', 'Usage',
    'Night watch',
    'Settings',
  ];
  // entries the issue does not place (e.g. Analytics) are left out of the comparison
  const got = tokens(navLayout(entries)).filter((t) => expected.includes(t));
  assert.deepEqual(got, expected);
});

test('no menu entry is left for the Dashboard (now Home), the Supervisor (now a drawer), Projects (inside Settings) or Artifacts (a tab of Runs)', () => {
  const app = loadApp();
  const labels = navEntries(app.defs).map((e) => text(e.label));
  for (const gone of ['Dashboard', 'Supervisor', 'Projects', 'Artifacts']) {
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
  assert.equal(ng.isCollapsed('code', storage), false);
  ng.setCollapsed('code', true, storage);
  assert.equal(ng.isCollapsed('code', storage), true);
  assert.equal(ng.isCollapsed('plan', storage), false);
  assert.ok(storage.length > 0, 'nothing was stored');
  ng = navGroups(); // a new window
  assert.equal(ng.isCollapsed('code', storage), true);
  ng.setCollapsed('code', false, storage);
  assert.equal(ng.isCollapsed('code', storage), false);
});

test('the page\'s sidebar shows the four group titles', async () => {
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
  for (const title of ['Plan & Design', 'Code & Build', 'Workflows', 'AI']) {
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

test('Settings has a Projects tab (Settings › Projects)', () => {
  const app = loadApp();
  assert.match(app.defs.get('settings').markup, /data-stab="projects"/);
});
