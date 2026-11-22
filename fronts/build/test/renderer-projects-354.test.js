// #354 Projects back in the menu (Code & Build, before Backlog) and out of Settings; the Projects
// screen (the project cards, Open folder and New project in its header, the empty state); a
// project's page with the tabs Overview, Conflict map, Architecture and Refactor (the selected tab
// remembered per project, the header's project and the page kept in sync). Acceptance tests written
// before the code. The Conflict map tab and the removals from the Roadmap and Analytics are in
// test/renderer-project-conflict-map-354.test.js.
// The page is the real one (test/renderer-app-harness.js), read through test/project-page-helpers.js.
// The contract assumed here (the data-testids are those of fronts/build/features/steps/projects.steps.js):
// - the Projects screen is the view 'projects' (showView('projects')), with a menu entry labelled
//   "Projects" in the group 'build'; its section carries data-testid="projects-screen", each card
//   data-testid="project-card" (with the project's name and data-id), the empty state an
//   .empty-state with a "New project" button; a click on a card is delegated (to the list, the
//   section or the document);
// - a project's page is the view 'project' (openProjectView(id) stays the global that opens it), its
//   section data-testid="project-page" with the project's name in a heading (h1/h2) and its `menu`
//   'projects'; its tabs are rendered as markup: role="tab" buttons labelled Overview, Conflict map,
//   Architecture and Refactor, the selected one with aria-selected="true", re-rendered when the
//   selection changes; a click on a tab is delegated (to its container, the section or the document);
// - the Overview is data-testid="project-overview"; the Refactor tab shows
//   data-testid="refactor-state-no-report" until the project has an Architecture report (#357;
//   the Architecture tab is #356's, fronts/analyser/features/architecture.feature).
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const H = require('./roadmap-status-helpers');
const { loadApp, navEntries, text } = require('@craftorio/ui-kit/test/renderer-app-harness');
const { clickRendered, pageMarkup, region, tabsOf } = require('@craftorio/front-analyser/test/project-page-helpers');

const NAV_GROUPS = path.join(__dirname, '..', '..', '..', 'packages', 'ui-kit', 'nav-groups.js');
const navGroups = () => require(NAV_GROUPS);

const PROJECTS = [
  { id: 'p1', name: 'Project One', repo: 'https://github.com/o/one', folder: 'C:/work/one', exists: true, isGit: true },
  { id: 'p2', name: 'Project Two', repo: 'https://github.com/o/two', folder: 'C:/work/two', exists: true, isGit: true },
];
const TAB_LABELS = ['Overview', 'City', 'Health', 'Conflict map']; // #730

function page({ projects = PROJECTS, storage = {}, api = {} } = {}) {
  return loadApp({
    storage: { 'multiagent.currentProject': 'p1', ...storage },
    api: {
      listProjects: async () => projects,
      getSettings: async () => ({ lastProject: 'p1' }),
      listProjectRuns: async (id) => ({ runs: [], project: projects.find((p) => p.id === id), local: id === 'p1' ? { ahead: 2, base: 'main', issues: [] } : null }),
      getBacklog: async () => ({ platform: 'github', syncedAt: '2026-10-01T00:00:00Z', issues: [], epics: [] }),
      getRepositoryPerformance: () => new Promise(() => {}), // the Conflict map tab stays loading here
      // Settings draws its other pages too (the CLIs, the voice CLI's status)
      envDetails: async () => [],
      speechStatus: async () => ({ path: null, command: 'whisper', installHint: 'pip install whisper', models: [], model: 'base', languages: ['en'], language: 'en' }),
      ...api,
    },
  });
}

async function openProject(app, id) {
  app.run(`openProjectView(${JSON.stringify(id)})`);
  await app.settle(10);
}
const projectPage = (app) => region(app, 'project-page');
const tabs = (app) => tabsOf(projectPage(app));
const selectedTabs = (app) => [...new Set(tabs(app).filter((t) => t.selected).map((t) => t.label))];
async function selectTab(app, label) {
  const tab = tabs(app).find((t) => t.label === label);
  assert.ok(tab, `the project page has no "${label}" tab (role="tab")`);
  await clickRendered(app, tab.el);
}
const headings = (app) => H.findAll(projectPage(app), (e) => /^h[1-3]$/.test(e.name)).map((e) => H.visibleText(e.inner));

// ---- the menu and Settings ----------------------------------------------------------------------

test('#354 the menu has "Projects" in Code & Build, right before Backlog', () => {
  const app = loadApp();
  const entry = navEntries(app.defs).find((e) => text(e.label) === 'Projects');
  assert.ok(entry, 'no menu entry labelled "Projects"');
  assert.deepEqual([entry.id, entry.group], ['projects', 'build']);
  const code = navGroups().navLayout(navEntries(app.defs)).find((b) => b.group === 'build');
  const labels = code.items.map((i) => text(i.label));
  assert.equal(labels.indexOf('Backlog') - labels.indexOf('Projects'), 1, `Code & Build: ${labels.join(', ')}`);
});

test('#354 Settings has no Projects page any more', () => {
  const app = loadApp();
  const markup = app.defs.get('settings').markup;
  assert.equal(/data-stab="projects"/.test(markup), false, 'Settings still has a Projects tab');
  assert.equal(/data-spage="projects"/.test(markup), false, 'Settings still has a Projects page');
});

test('#354 showView(\'projects\') opens the Projects screen (not Settings) and reads the projects once', async () => {
  const app = page();
  await app.boot();
  const before = app.callsTo('listProjects').length;
  app.run("showView('projects')");
  await app.settle(10);
  assert.equal(app.state().view, 'projects');
  assert.equal(app.callsTo('listProjects').length - before, 1);
});

test('#354 a project\'s page lights the Projects menu entry', () => {
  const app = loadApp();
  assert.equal(app.defs.get('project').menu, 'projects');
});

test('#354 the project page\'s back link opens the Projects screen', async () => {
  const app = page();
  await app.boot();
  await openProject(app, 'p1');
  const back = H.findEl(projectPage(app), (e) => /^(button|a)$/.test(e.name) && /Projects/.test(H.visibleText(e.inner)) && e.attrs.role !== 'tab');
  assert.ok(back, 'no link back to Projects on the project page');
  await clickRendered(app, back);
  assert.equal(app.state().view, 'projects');
});

// #644: Home's "Create a project" opens the onboarding wizard (project-wizard.js); #741: the old New project
// dialog is gone, so the Start drawer's + and the header's "New project…" open the wizard too
test('#354 the New project entry points (Start drawer +, header "New project…", Home\'s "Create a project") open the wizard, never Settings', async () => {
  const app = page({ projects: [], storage: { 'multiagent.currentProject': '' } });
  await app.boot();
  const opened = [];
  const wizardOpen = () => { const w = app.created.find((e) => e.id === 'project-wizard'); return !!w && w.hidden !== true; };
  const closeWizard = () => app.run('window.ProjectWizard.close()');
  await app.click('#btn-drawer-new-project');
  await app.settle(10);
  opened.push(wizardOpen());
  closeWizard();
  const sel = app.el('#header-project');
  sel.value = '__new__';
  await sel.onchange({ target: sel });
  await app.settle(10);
  opened.push(wizardOpen());
  closeWizard();
  app.run("showView('dashboard')");
  await app.settle(10);
  await app.click('[data-home-act="project"]', { dataset: { homeAct: 'project' }, within: ['#view-dashboard'] });
  await app.settle(10);
  opened.push(wizardOpen());
  assert.deepEqual(opened, [true, true, true]);
  assert.notEqual(app.state().view, 'settings');
});

test('#354 no screen points to "Settings › Projects" any more (the Backlog without a project)', async () => {
  const app = page({ projects: [], storage: { 'multiagent.currentProject': '' } });
  await app.boot();
  app.run("showView('backlog')");
  await app.settle(10);
  assert.equal(text(pageMarkup(app)).includes('Settings › Projects'), false);
});

// ---- the Projects screen ------------------------------------------------------------------------

test('#354 the Projects screen has Open folder and New project in its header', async () => {
  const app = page();
  await app.boot();
  app.run("showView('projects')");
  await app.settle(10);
  const buttons = H.findAll(region(app, 'projects-screen'), (e) => e.name === 'button').map((e) => H.visibleText(e.inner));
  assert.ok(buttons.includes('Open folder'), `buttons: ${buttons.join(', ')}`);
  assert.ok(buttons.includes('New project'), `buttons: ${buttons.join(', ')}`);
});

// #643: the empty state's New project opens the onboarding wizard (project-wizard.js), no longer the dialog
test('#354 with no project, the Projects screen shows the empty state, whose New project opens the wizard', async () => {
  const app = page({ projects: [], storage: { 'multiagent.currentProject': '' } });
  await app.boot();
  app.run("showView('projects')");
  await app.settle(10);
  const screen = region(app, 'projects-screen');
  const empty = H.findEl(screen, (e) => /\bempty-state\b/.test(e.attrs.class || ''));
  assert.ok(empty, 'no empty state on the Projects screen');
  assert.match(H.visibleText(empty.inner), /No projects yet/);
  const btn = H.findEl(empty.outer, (e) => e.name === 'button' && H.visibleText(e.inner) === 'New project');
  assert.ok(btn, 'the empty state has no New project button');
  app.el('#project-modal-title').textContent = '';
  await clickRendered(app, btn);
  await app.settle(10);
  const wizard = app.created.find((e) => e.id === 'project-wizard');
  assert.equal(!!wizard && wizard.hidden !== true, true, 'the wizard is shown');
  assert.equal(app.el('#project-modal-title').textContent, '', 'the old dialog was not opened');
});

test('#354 with two projects, the Projects screen shows one card per project', async () => {
  const app = page();
  await app.boot();
  app.run("showView('projects')");
  await app.settle(10);
  const cards = H.findAll(region(app, 'projects-screen'), (e) => e.attrs['data-testid'] === 'project-card');
  const names = [...new Set(cards.map((c) => (H.visibleText(c.inner).match(/Project (One|Two)/) || [''])[0]))];
  assert.deepEqual(names.sort(), ['Project One', 'Project Two']);
});

test('#354 a click on a card opens that project\'s page, and it becomes the header\'s project', async () => {
  const app = page();
  await app.boot();
  app.run("showView('projects')");
  await app.settle(10);
  const card = H.findAll(region(app, 'projects-screen'), (e) => e.attrs['data-testid'] === 'project-card').find((c) => H.visibleText(c.inner).includes('Project Two'));
  assert.ok(card, 'no card for Project Two');
  await clickRendered(app, card);
  assert.equal(app.state().view, 'project');
  assert.ok(headings(app).includes('Project Two'), `headings: ${headings(app).join(', ')}`);
  assert.equal(app.run('window.CurrentProject.get()'), 'p2');
});

// ---- a project's page ---------------------------------------------------------------------------

test('#354 #730 a project\'s page has the tabs Overview, City, Health and Conflict map, Overview selected', async () => {
  const app = page();
  await app.boot();
  await openProject(app, 'p1');
  assert.deepEqual([...new Set(tabs(app).map((t) => t.label))], TAB_LABELS);
  assert.deepEqual(selectedTabs(app), ['Overview']);
});

test('#354 the Overview tab shows the project\'s folder, repository and unpushed commits', async () => {
  const app = page();
  await app.boot();
  await openProject(app, 'p1');
  const overview = H.visibleText(region(app, 'project-overview'));
  assert.ok(overview.includes('C:/work/one'), `Overview: ${overview}`);
  assert.ok(overview.includes('https://github.com/o/one'), `Overview: ${overview}`);
  assert.match(overview, /\b2 commits\b/);
});

test('#354 a click on a tab selects it', async () => {
  const app = page();
  await app.boot();
  await openProject(app, 'p1');
  await selectTab(app, 'Health');
  assert.deepEqual(selectedTabs(app), ['Health']);
});

test('#354 the selected tab is remembered per project', async () => {
  const app = page();
  await app.boot();
  await openProject(app, 'p1');
  await selectTab(app, 'Conflict map');
  await openProject(app, 'p2');
  const p2 = selectedTabs(app);
  await openProject(app, 'p1');
  assert.deepEqual([p2, selectedTabs(app)], [['Overview'], ['Conflict map']]);
});

test('#354 the selected tab of a project is still selected in the next window', async () => {
  const app = page();
  await app.boot();
  await openProject(app, 'p1');
  await selectTab(app, 'Health');
  const next = page({ storage: Object.fromEntries(app.sandbox.localStorage.store) });
  await next.boot();
  await openProject(next, 'p1');
  assert.deepEqual(selectedTabs(next), ['Health']);
});

test('#354 choosing another project in the header switches the open project page to it', async () => {
  const app = page();
  await app.boot();
  await openProject(app, 'p1');
  app.run("window.CurrentProject.set('p2')");
  await app.settle(10);
  assert.equal(app.state().view, 'project');
  const h = headings(app);
  assert.deepEqual([h.includes('Project Two'), h.includes('Project One')], [true, false], `headings: ${h.join(', ')}`);
  assert.equal(app.callsTo('listProjectRuns').at(-1)[0], 'p2');
});

test('#354 #730 the Health tab of a project with no report says it was never analysed (no Refactor tab)', async () => {
  const app = page({ api: { architectureFacts: async () => ({ state: 'ok', model: null }), architectureReport: async () => ({ report: null, findings: [] }), listArchitectureReports: async () => [] } });
  await app.boot();
  await openProject(app, 'p1');
  assert.equal(tabs(app).some((t) => t.label === 'Refactor'), false);
  await selectTab(app, 'Health');
  assert.ok(region(app, 'architecture-state-never'), 'the never-analysed state');
});
