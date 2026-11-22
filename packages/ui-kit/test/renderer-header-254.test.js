// #254 Menu by the flow, the top bar: one project for the whole app, chosen in the header's project
// selector (remembered; by default the last used, else the first with a repository; "New project…"
// with none); Backlog, Roadmap, Analytics and the Product Owner read it, and switching it re-renders
// the current screen. The notifications bell (count + centre) and the Oracle button move to the top
// right of the header; the sidebar keeps the runs-in-progress indicator.
// The app's project is packages/ui-kit/current-project.js (window.CurrentProject in the page,
// module.exports in Node for its pure pickDefault), required inside each test so this file loads
// before it exists. The screens are the real page (test/renderer-app-harness.js).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { pageDirs, pageFile, pageFiles } = require('../../../scripts/source-tree');
const PAGE_ROOT = path.join(__dirname, '..', '..', '..');
// a page file by its page-relative name, wherever its layer is (phase 3 of the reorganisation study)
const pagePath = (rel) => pageFile(PAGE_ROOT, rel);
void pageDirs; void pageFiles;
const { loadApp, text } = require('./renderer-app-harness');

const RENDERER = path.join(__dirname, '..');
const currentProject = () => require(path.join(RENDERER, 'current-project.js'));
const html = () => fs.readFileSync(pagePath('index.html'), 'utf8');
const between = (s, open, close) => {
  const start = s.indexOf(open);
  assert.ok(start >= 0, `${open} not found in index.html`);
  return s.slice(start, s.indexOf(close, start));
};

const PROJECTS = [
  { id: 'p1', name: 'Project One', repo: 'https://github.com/o/one' },
  { id: 'p2', name: 'Project Two', repo: 'https://github.com/o/two' },
];
const EMPTY_BACKLOG = { platform: 'github', syncedAt: '2026-10-01T00:00:00Z', issues: [], epics: [] };

// the page with two projects; every place that remembered a project before #254 says p1
function page(extra = {}) {
  return loadApp({
    storage: { 'craftorio.backlogProject': 'p1', 'craftorio.analytics': JSON.stringify({ tab: 'performance', project: 'p1' }), ...(extra.storage || {}) },
    session: { 'craftorio.analytics.project': 'p1' },
    api: {
      listProjects: async () => PROJECTS,
      getSettings: async () => ({ lastProject: 'p1' }),
      getBacklog: async () => EMPTY_BACKLOG,
      syncBacklog: async () => EMPTY_BACKLOG,
      ...(extra.api || {}),
    },
  });
}
// the project ids an api call was about (a first argument id, or { projectId })
const projectArgs = (app, name) => app.callsTo(name).map((args) => (typeof args[0] === 'object' && args[0] ? args[0].projectId : args[0]));

test('CurrentProject.pickDefault: the last used project, else the first with a repository, else none', () => {
  const { pickDefault } = currentProject();
  const projects = [{ id: 'a', name: 'A' }, { id: 'b', name: 'B', repo: 'r' }, { id: 'c', name: 'C', repo: 'r' }];
  assert.equal(pickDefault(projects, 'c'), 'c');
  assert.equal(pickDefault(projects, 'gone'), 'b');
  assert.equal(pickDefault(projects, null), 'b');
  assert.equal(pickDefault([], null), null);
});

test('the header holds the project selector (#header-project) and, at its right, the notifications bell; the sidebar keeps the Run indicator', () => {
  const header = between(html(), '<header class="topbar">', '</header>');
  const sidebar = between(html(), '<nav class="sidebar">', '</nav>');
  assert.match(header, /<select[^>]*id="header-project"/);
  assert.match(header, /id="nav-notifications"/);
  assert.match(header, /id="nav-notifications-count"/);
  assert.doesNotMatch(sidebar, /id="nav-notifications"/);
  assert.match(sidebar, /id="nav-run"/);
});

test('the notifications bell in the header opens the notification centre', async () => {
  const app = page();
  await app.boot();
  await app.click('#nav-notifications');
  assert.equal(app.el('#notification-center').classList.contains('hidden'), false);
});

test('the Oracle button is no longer added to the sidebar: it sits in the header', async () => {
  const app = page();
  await app.boot();
  // #411: the sidebar's entries go to its menu part (nav.sidebar .sidebar-menu), so every sidebar node counts
  const sidebarNodes = [...app.elements.entries()].filter(([sel]) => /sidebar/.test(sel)).flatMap(([, el]) => el.appended || []);
  assert.ok(sidebarNodes.length > 0, 'nothing was placed in the sidebar: the check would prove nothing');
  assert.ok(!sidebarNodes.some((n) => n.id === 'nav-oracle'), 'the Oracle button is still appended to the sidebar');
  const inHeaderMarkup = /id="nav-oracle"/.test(between(html(), '<header class="topbar">', '</header>'));
  const addedToHeader = [...app.elements.entries()].some(([sel, el]) => /topbar|header/.test(sel) && el.appended.some((n) => n.id === 'nav-oracle'));
  assert.ok(inHeaderMarkup || addedToHeader, 'the Oracle button is not in the header');
});

test('the header selector lists the projects and selects the default one (the last used)', async () => {
  const app = page({ storage: { 'craftorio.currentProject': 'p2' } });
  await app.boot();
  const sel = app.el('#header-project');
  assert.match(text(sel.innerHTML), /Project One/);
  assert.match(text(sel.innerHTML), /Project Two/);
  assert.equal(app.run('window.CurrentProject.get()'), 'p2');
});

test('with no project, the header selector offers "New project…"', async () => {
  const app = loadApp({ api: { listProjects: async () => [] } });
  await app.boot();
  assert.match(text(app.el('#header-project').innerHTML), /New project…/);
});

test('choosing a project in the header sets the app\'s project, remembered for the next window', async () => {
  const app = page();
  await app.boot();
  const sel = app.el('#header-project');
  sel.value = 'p2';
  const ev = { type: 'change', target: sel, currentTarget: sel, preventDefault() {}, stopPropagation() {} };
  await sel.onchange?.(ev);
  for (const fn of sel.listeners.change || []) await fn(ev);
  await app.settle();
  assert.equal(app.run('window.CurrentProject.get()'), 'p2');

  const next = page({ storage: Object.fromEntries(app.sandbox.localStorage.store) });
  await next.boot();
  assert.equal(next.run('window.CurrentProject.get()'), 'p2');
});

test('the Backlog shows the header\'s project, and switching it re-renders the Backlog on the new one', async () => {
  const app = page();
  await app.boot();
  app.run("window.CurrentProject.set('p2')");
  app.run("showView('backlog')");
  await app.settle(10);
  assert.equal(projectArgs(app, 'getBacklog').at(-1), 'p2');
  assert.ok(!app.defs.get('backlog').markup.includes('id="bl-project"'), 'the Backlog still has its own project select');

  app.run("window.CurrentProject.set('p1')");
  await app.settle(10);
  assert.equal(app.state().view, 'backlog');
  assert.equal(projectArgs(app, 'getBacklog').at(-1), 'p1');
});

test('the Roadmap screen shows the header\'s project', async () => {
  const app = page();
  await app.boot();
  app.run("window.CurrentProject.set('p2')");
  const before = app.apiCalls.length;
  app.run("showView('roadmap')");
  await app.settle(10);
  assert.equal(app.state().view, 'roadmap');
  const ids = app.apiCalls.slice(before).map(([, args]) => (typeof args[0] === 'object' && args[0] ? args[0].projectId : args[0])).filter((id) => id === 'p1' || id === 'p2');
  assert.ok(ids.length, 'the Roadmap screen read no project');
  assert.ok(ids.every((id) => id === 'p2'), `the Roadmap read ${ids.join(', ')}`);
});

test('Analytics (Repository performance) analyses the header\'s project', async () => {
  const app = page();
  await app.boot();
  app.run("window.CurrentProject.set('p2')");
  app.run("showView('analytics')");
  await app.settle(10);
  assert.equal(projectArgs(app, 'getRepositoryPerformance').at(-1), 'p2');
});

// #741: the New project dialog is gone: the header's "New project…" opens the wizard (renderer-projects-354.test.js),
// whose Finish opens the new project; the tests of a project created by the dialog went with it.

test('a notification\'s project (focusProject) becomes the app\'s, and the Product Owner opens on it', async () => {
  const app = page({ storage: { 'craftorio.currentProject': 'p1' } });
  await app.boot();
  app.run("window.BacklogActions.focusProject('p2')");
  app.run("showView('backlog')");
  await app.run('window.BacklogPO.open()');
  await app.settle(10);
  assert.equal(app.run('window.CurrentProject.get()'), 'p2');
  assert.equal(app.run('window.BacklogPO.openProjectId()'), 'p2');
});

test('the Product Owner plans for the header\'s project', async () => {
  const app = page();
  await app.boot();
  app.run("window.CurrentProject.set('p2')");
  app.run("showView('backlog')");
  await app.settle(10);
  await app.run('window.BacklogPO.open()');
  await app.settle(10);
  assert.equal(app.run('window.BacklogPO.openProjectId()'), 'p2');
});
