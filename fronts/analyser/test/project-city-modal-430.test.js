// #430: every "Show on the map" opens the project's City view full-screen in a modal over the screen
// it was asked from (fronts/analyser/views/project/project-city-modal.js, a new script of index.html),
// with the requested overlay and its card; nothing navigates.
// The entry points are the ones the app's screens call: ProjectCityImpact.showIssue / showStage /
// fromRoadmap (Backlog card, Roadmap), ProjectCityRelease.showRelease (Releases, a release run's
// page), ProjectCityAgents.replay (a run's "Replay on the map"). The window is
// test/city-modes-harness.js's (every renderer city script, the modal's included, the api faked at
// its boundary, openProjectView a stub recording its calls in calls.openCity), on a screen that is
// not the Project screen (state.view), with a button that has the focus (the one that asked).
// The modal's contract (test ids decided here):
//   data-testid="city-modal": the modal, in document.body, role="dialog", aria-modal="true"; one at a
//     time (a second Show on the map replaces its overlay); it holds the City view
//     (data-testid="project-city") in the mode of the overlay asked, with its card;
//   data-testid="city-modal-close": its Close; Close and Esc (handled by the module itself, even when
//     app.js has called preventDefault because a .modal is open) remove it, give the focus back to the
//     element that had it, leave state.view and the Architecture tab's remembered mode
//     (sessionStorage multiagent.architecture.view) as they were;
//   data-testid="city-modal-open-project": "Open in Projects", which opens the project (openProjectView)
//     and closes the modal;
//   the focus moves into the modal when it opens; the City view's states (loading, not a git
//     repository, no WebGL) show inside it with the City view's own messages.
// openCity (project-architecture.js) is called only from the Project screen; the labels are catalog
// keys project_city_modal.* in en.json and pt-BR.json.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
// a page file by its page-relative name, in whichever layer holds it (the UI kit, a front, the page folder)
const pageFileOf = (rel) => require('../../../scripts/source-tree').pageFile(path.join(__dirname, '..', '..', '..'), rel);
const H = require('./city-modes-harness');

const { ISSUE, STAGE, REPLAY, settle, q, text, mode, title } = H;
const ROOT = path.join(__dirname, '..', '..', '..');
const MODAL_FILE = pageFileOf('views/project/project-city-modal.js');
const VIEW_KEY = 'multiagent.architecture.view';

// the window with the modal's module (the harness loads every *city* script, this one included)
function loadModal(opts) {
  assert.equal(fs.existsSync(MODAL_FILE), true, 'fronts/analyser/views/project/project-city-modal.js exists (#430)');
  return H.loadWindow(opts);
}

/** The window on screen `view` (not the Project screen), its "Show on the map" button focused. */
function onScreen(t, view = 'backlog', { city = null, ...opts } = {}) {
  const h = loadModal(opts);
  const doc = h.dom.document;
  const shown = [];
  h.w.showView = (v) => { shown.push(String(v)); };
  h.w.state.view = view;
  h.w.sessionStorage.setItem(VIEW_KEY, 'facts'); // the tab's remembered mode: Facts
  if (city) h.w.api.architectureCity = city;
  // app.js's Esc: the layer on top (an open .modal) takes it, preventDefault for the views' own Esc
  doc.addEventListener('keydown', (e) => { if (e.key === 'Escape' && doc.querySelector('.modal:not(.hidden)')) e.preventDefault(); });
  const screen = doc.createElement('div');
  screen.setAttribute('data-testid', 'origin-screen');
  screen.innerHTML = '<button type="button" data-testid="origin-button">Show on the map</button>';
  doc.body.appendChild(screen);
  const button = q(screen, 'origin-button');
  button.focus();
  const o = { ...h, doc, shown, screen, button };
  t.after(() => { try { q(modalOf(o), 'city-modal-close')?.click(); } catch { /* already closed */ } });
  return o;
}

const modals = (o) => [...o.doc.body.querySelectorAll('[data-testid="city-modal"]')].filter((el) => H.visible(o.doc.body, el));
const modalOf = (o) => modals(o)[0] || null;
const cityOf = (o) => q(modalOf(o), 'project-city');
const navigated = (o) => ({ openProjectView: o.calls.openCity.length, view: String(o.w.state.view), shown: o.shown.length });
const stayed = (view) => ({ openProjectView: 0, view, shown: 0 });

test('#430 an issue\'s "Show on the map" opens a modal dialog over the Backlog', async (t) => {
  const o = onScreen(t, 'backlog');
  o.w.ProjectCityImpact.showIssue('p1', ISSUE);
  await settle();
  const m = modalOf(o);
  assert.equal(m === null, false, 'a data-testid="city-modal" in document.body');
  assert.equal(String(m.getAttribute('role')), 'dialog');
  assert.equal(String(m.getAttribute('aria-modal')), 'true');
  assert.equal(o.screen.isConnected, true, 'the Backlog is still there under it');
  assert.deepEqual(navigated(o), stayed('backlog'), 'nothing navigates');
});

test('#430 the modal holds the project\'s City view in the issue\'s impact mode with its card', async (t) => {
  const o = onScreen(t, 'backlog');
  o.w.ProjectCityImpact.showIssue('p1', ISSUE);
  await settle();
  const city = cityOf(o);
  assert.equal(city === null, false, 'the City view inside the modal');
  assert.equal(mode(city), 'impact');
  assert.equal(title(city), 'Issue #375');
  assert.equal(H.visible(city, q(city, 'city-impact')), true, 'the impact card');
  assert.match(text(q(city, 'city-impact-header')), /#375/);
});

test('#430 a roadmap stage\'s "Show the stage on the map" opens its footprint in the modal', async (t) => {
  const o = onScreen(t, 'backlog');
  o.w.ProjectCityImpact.showStage('p1', STAGE);
  await settle();
  const city = cityOf(o);
  assert.equal(city === null, false, 'the City view inside the modal');
  assert.equal(mode(city), 'stage');
  assert.match(text(q(city, 'city-impact-conflicts')), /src\/engine\/run\.js/);
  assert.deepEqual(navigated(o), stayed('backlog'));
});

test('#430 a release\'s "Show on the map" opens the release in the modal over Releases', async (t) => {
  const o = onScreen(t, 'releases');
  o.w.ProjectCityRelease.showRelease('p1', { to: '1.1.2' });
  await settle();
  const city = cityOf(o);
  assert.equal(city === null, false, 'the City view inside the modal');
  assert.equal(mode(city), 'release');
  assert.equal(H.visible(city, q(city, 'city-release')), true, 'the release card');
  assert.equal(o.calls.release.some((r) => r.to === '1.1.2'), true, 'the release 1.1.2 was read');
  assert.deepEqual(navigated(o), stayed('releases'));
});

test('#430 a run\'s "Replay on the map" plays the run in the modal over the run\'s screen', async (t) => {
  const o = onScreen(t, 'run');
  o.w.ProjectCityAgents.replay('p1', REPLAY.runId);
  await settle();
  const city = cityOf(o);
  assert.equal(city === null, false, 'the City view inside the modal');
  assert.equal(mode(city), 'replay');
  assert.equal(q(city, 'city-replay-timeline') === null, false, 'the replay\'s timeline');
  assert.equal(o.calls.agents.some((a) => a.runId === REPLAY.runId), true, 'the run\'s touches were read');
  assert.deepEqual(navigated(o), stayed('run'));
});

test('#430 Close removes the modal and leaves the screen as it was', async (t) => {
  const o = onScreen(t, 'backlog');
  o.w.ProjectCityImpact.showIssue('p1', ISSUE);
  await settle();
  const close = q(modalOf(o), 'city-modal-close');
  assert.equal(close === null, false, 'data-testid="city-modal-close"');
  close.click();
  await settle();
  assert.equal(modals(o).length, 0, 'no modal left');
  assert.equal(o.doc.body.querySelectorAll('[data-testid="project-city"]').length, 0, 'no City view left on the Backlog');
  assert.equal(o.screen.isConnected, true);
  assert.deepEqual(navigated(o), stayed('backlog'));
});

test('#430 Esc closes the modal, even when app.js marked the key as taken by a modal', async (t) => {
  const o = onScreen(t, 'releases');
  o.w.ProjectCityRelease.showRelease('p1', { to: '1.1.2' });
  await settle();
  assert.equal(modals(o).length, 1, 'the modal is open');
  o.dom.keydown(o.doc.activeElement || o.doc.body, 'Escape');
  await settle();
  assert.equal(modals(o).length, 0, 'Esc closed it');
  assert.deepEqual(navigated(o), stayed('releases'));
});

test('#430 the focus moves into the modal when it opens', async (t) => {
  const o = onScreen(t, 'backlog');
  o.w.ProjectCityImpact.showIssue('p1', ISSUE);
  await settle();
  const m = modalOf(o);
  assert.equal(m === null, false, 'the modal');
  assert.equal(m.contains(o.doc.activeElement), true, 'the focused element is inside the modal');
});

test('#430 Close gives the focus back to the button that opened the modal', async (t) => {
  const o = onScreen(t, 'backlog');
  o.w.ProjectCityImpact.showIssue('p1', ISSUE);
  await settle();
  q(modalOf(o), 'city-modal-close')?.click();
  await settle();
  assert.equal(o.doc.activeElement === o.button, true, 'the "Show on the map" button has the focus again');
});

test('#430 Esc gives the focus back to the button that opened the modal', async (t) => {
  const o = onScreen(t, 'run');
  o.w.ProjectCityAgents.replay('p1', REPLAY.runId);
  await settle();
  assert.equal(modals(o).length, 1, 'the modal is open');
  o.dom.keydown(o.doc.activeElement || o.doc.body, 'Escape');
  await settle();
  assert.equal(o.doc.activeElement === o.button, true, 'the "Replay on the map" button has the focus again');
});

test('#430 a second "Show on the map" while the modal is open replaces the overlay: one modal, the stage', async (t) => {
  const o = onScreen(t, 'backlog');
  o.w.ProjectCityImpact.showIssue('p1', ISSUE);
  await settle();
  o.w.ProjectCityImpact.showStage('p1', STAGE);
  await settle();
  assert.equal(modals(o).length, 1, 'one modal');
  assert.equal(o.doc.body.querySelectorAll('[data-testid="project-city"]').length, 1, 'one City view');
  assert.equal(mode(cityOf(o)), 'stage');
  assert.match(title(cityOf(o)), /Stage.*Engine fixes/);
  assert.equal(q(cityOf(o), 'city-impact-header') === null, true, 'no card of the issue left');
});

test('#430 a release asked while an issue is on the modal replaces it: one modal, the release', async (t) => {
  const o = onScreen(t, 'backlog');
  o.w.ProjectCityImpact.showIssue('p1', ISSUE);
  await settle();
  o.w.ProjectCityRelease.showRelease('p1', { to: '1.1.2' });
  await settle();
  assert.equal(modals(o).length, 1, 'one modal');
  assert.equal(o.doc.body.querySelectorAll('[data-testid="project-city"]').length, 1, 'one City view');
  assert.equal(mode(cityOf(o)), 'release');
});

test('#430 the modal has an "Open in Projects" link', async (t) => {
  const o = onScreen(t, 'backlog');
  o.w.ProjectCityImpact.showIssue('p1', ISSUE);
  await settle();
  const link = q(modalOf(o), 'city-modal-open-project');
  assert.equal(link === null, false, 'data-testid="city-modal-open-project"');
  assert.equal(text(link), 'Open in Projects');
});

test('#430 "Open in Projects" opens the project and closes the modal', async (t) => {
  const o = onScreen(t, 'backlog');
  o.w.ProjectCityImpact.showIssue('p1', ISSUE);
  await settle();
  q(modalOf(o), 'city-modal-open-project')?.click();
  await settle();
  assert.deepEqual(o.calls.openCity, ['p1'], 'openProjectView for project p1');
  assert.equal(modals(o).length, 0, 'the modal is closed');
});

test('#430 the Architecture tab\'s remembered mode is not changed by the modal', async (t) => {
  const o = onScreen(t, 'backlog');
  o.w.ProjectCityImpact.showIssue('p1', ISSUE);
  await settle();
  assert.equal(modals(o).length, 1, 'the modal is open');
  q(modalOf(o), 'city-modal-close')?.click();
  await settle();
  assert.equal(String(o.w.sessionStorage.getItem(VIEW_KEY)), 'facts');
});

test('#430 the modal shows the City view\'s loading state while the city is read', async (t) => {
  const o = onScreen(t, 'backlog', { city: () => new Promise(() => {}) });
  o.w.ProjectCityImpact.showIssue('p1', ISSUE);
  await settle();
  assert.equal(modalOf(o) === null, false, 'the modal');
  assert.match(text(q(modalOf(o), 'project-city-loading')), /Reading the facts/i);
});

test('#430 the modal shows the City view\'s "Not a git repository"', async (t) => {
  const o = onScreen(t, 'backlog', { city: async () => ({ state: 'not-git', model: null, validation: null }) });
  o.w.ProjectCityImpact.showIssue('p1', ISSUE);
  await settle();
  assert.equal(modalOf(o) === null, false, 'the modal');
  assert.match(text(q(modalOf(o), 'project-city-not-git')), /Not a git repository/);
});

test('#430 the modal shows the City view\'s message when WebGL is not available', async (t) => {
  const o = onScreen(t, 'backlog');
  o.w.ProjectCityImpact.showIssue('p1', ISSUE);
  await settle();
  assert.equal(modalOf(o) === null, false, 'the modal');
  assert.match(text(q(modalOf(o), 'project-city-message')), /WebGL is not available/);
});

test('#430 openCity is called only from the Project screen\'s files', () => {
  const allowed = new Set(['fronts/analyser/views/project/project.js', 'fronts/analyser/views/project/project-architecture.js']);
  const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) return walk(full);
    return e.name.endsWith('.js') ? [full] : [];
  });
  const callers = walk(path.join(ROOT, 'apps', 'desktop', 'renderer'))
    .filter((f) => /\bopenCity\(/.test(fs.readFileSync(f, 'utf8')))
    .map((f) => path.relative(ROOT, f).split(path.sep).join('/'))
    .filter((f) => !allowed.has(f))
    .sort();
  assert.deepEqual(callers, []);
});

test('#430 index.html loads views/project/project-city-modal.js', () => {
  const html = fs.readFileSync(pageFileOf('index.html'), 'utf8');
  assert.match(html, /<script src="[^"]*views\/project\/project-city-modal\.js"><\/script>/, 'its <script> in index.html (npm run docs writes the list)');
});

test('#430 the modal\'s labels are catalog keys project_city_modal.* in en and pt-BR, "Open in Projects" among them', () => {
  const read = (lang) => JSON.parse(fs.readFileSync(path.join(ROOT, 'packages', 'shared', 'i18n', `${lang}.json`), 'utf8'));
  const en = read('en');
  const pt = read('pt-BR');
  const keys = (cat) => Object.keys(cat).filter((k) => k.startsWith('project_city_modal.')).sort();
  assert.notDeepEqual(keys(en), [], 'project_city_modal.* keys in en.json');
  assert.deepEqual(keys(pt), keys(en), 'the same keys in pt-BR.json');
  assert.equal(keys(en).some((k) => en[k] === 'Open in Projects'), true, '"Open in Projects" in en.json');
  assert.equal(keys(pt).every((k) => typeof pt[k] === 'string' && pt[k].trim() !== ''), true, 'pt-BR has a text for each');
});
