// #436 naming a release: the last three releases and a "Suggest version" button. Acceptance tests
// written before the code.
// Both places where a release is named show the last three shipped releases as text above the field
// ("1.1.2 · 2026-10-13 · 4 issues"; "No release yet" when none shipped) and a "Suggest version" button
// that fills the field with packages/shared/release-version.js's suggestion (window.ReleaseVersion, loaded
// by index.html) and never submits; a line under the field says why (the reason).
// - the Roadmap's cut line dialog (#cut-line-modal of backlog.js, opened by a stage's "Release here"
//   in backlog-roadmap.js; its field #cut-line-name);
// - the Releases screen's next release (fronts/build/views/releases/releases.js; its field #rel-version).
// The page is the real one (test/renderer-app-harness.js loads index.html's scripts in a vm sandbox,
// as test/renderer-releases-260.test.js does); the Roadmap's markup is read with
// test/roadmap-status-helpers.js's reader to click its menu entries. The data-testids the change adds:
//   recent-releases          the list of the last releases (its container)
//   suggest-version          the "Suggest version" button
//   suggest-version-reason   the line under the field saying why
// The button is clicked as the page would: the fake element of its id when its markup has one (the
// one `$('#id')` wires), else of its data-testid, with every attribute its markup carries.
const test = require('node:test');
const assert = require('node:assert/strict');
const H = require('./roadmap-status-helpers');
const { loadApp } = require('@multiagent/ui-kit/test/renderer-app-harness');

// releases:list: the history (newest first) plus, here, one release that has not shipped
const shipped = (version, date, issues) => ({ version, tag: version, date, issues: Array.from({ length: issues }, (_, k) => ({ number: 100 + k, title: `Issue ${100 + k}` })), runs: [], cost: 1 });
const RELEASES = [
  { ...shipped('1.2.0', '2026-10-20T12:00:00.000Z', 2), status: 'checking' }, // not shipped
  shipped('1.1.2', '2026-10-13T12:00:00.000Z', 4),
  shipped('1.1.1', '2026-10-07T12:00:00.000Z', 3),
  shipped('1.1.0', '2026-10-01T12:00:00.000Z', 2),
  shipped('1.0.0', '2026-09-01T12:00:00.000Z', 5),
];
// what "Suggest version" may answer after 1.1.2 (bug-only issues here: 1.1.3 expected)
const AFTER_112 = ['1.1.3', '1.2.0', '2.0.0'];

// every markup string and text the page holds: the views' own markup, what was written into an element, what was inserted
function pageMarkup(app, { defs = true } = {}) {
  const parts = [];
  if (defs) for (const def of app.defs.values()) parts.push(String(def.markup || ''));
  for (const el of [...app.elements.values(), ...app.created]) {
    parts.push(String(el.innerHTML || ''), String(el.textContent || ''));
    for (const [, html] of el.inserted || []) parts.push(String(html || ''));
  }
  return parts.join('\n');
}

// clicks the "Suggest version" button the markup draws (see the header)
async function clickSuggest(app, within) {
  const btn = H.findEl(pageMarkup(app), (e) => e.attrs['data-testid'] === 'suggest-version');
  assert.ok(btn, 'a "Suggest version" button (data-testid="suggest-version")');
  const attrs = { ...btn.attrs };
  const dataset = {};
  for (const [k, v] of Object.entries(attrs)) if (k.startsWith('data-')) dataset[k.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = v;
  const sel = attrs.id ? `#${attrs.id}` : '[data-testid="suggest-version"]';
  await app.click(sel, { attrs, dataset, within });
  await app.settle(20);
}

// ---- the cut line dialog --------------------------------------------------------------------------------

const ref = (number) => ({ number, title: `Issue ${number}`, url: `https://github.com/o/r/issues/${number}` });
const item = (id, number) => ({ id, status: 'planned', workflow: 'software-development-local-hero.yaml', inputs: {}, issues: [ref(number)] });
const roadmapData = () => ({
  roadmap: { state: 'planned', updatedAt: '2026-10-21T10:00:00.000Z', stages: [
    { id: 'st1', name: '', note: '', items: [item('i1', 330)] },
    { id: 'st2', name: '', note: '', items: [item('i2', 331)] },
  ] },
  issues: [{ number: 330, title: 'Issue 330', labels: ['bug'] }, { number: 331, title: 'Issue 331', labels: ['bug'] }],
  epics: [],
});
const VIEW = { showAll: true, since: 'total' };
const stageOf = (html, s) => H.findEl(html, (e) => e.attrs['data-testid'] === 'roadmap-stage' && e.attrs['data-stage'] === String(s));

// the page booted, stage 1's ⋮ menu opened and "Release here" clicked: the dialog is open (its promise pending)
async function openCutLine(releases) {
  const app = loadApp({
    api: {
      listReleases: async () => ({ projectId: 'p1', releases, next: null, line: null, run: null }),
      saveRoadmap: async (projectId, stages) => ({ roadmap: { state: 'planned', stages }, issues: [] }),
    },
  });
  await app.boot();
  const R = app.sandbox.window.BacklogRoadmap;
  assert.ok(R, 'BacklogRoadmap loaded');
  const d = roadmapData();
  const { ctx } = H.makeCtx();
  await R.onClick(H.clickOn(stageOf(R.html(d, () => {}, VIEW), 0).outer, (e) => e.attrs['data-testid'] === 'roadmap-stage-menu'), ctx, d);
  const html = R.html(d, () => {}, VIEW);
  R.onClick(H.clickOn(stageOf(html, 0).outer, (e) => e.attrs['data-rm-release'] === 'add'), ctx, d); // waits for the dialog: not awaited
  await app.settle(30);
  assert.equal(app.el('#cut-line-modal').classList.contains('hidden'), false, 'the cut line dialog is open');
  return app;
}

test('#436 cut line dialog: shows the last three shipped releases as text, newest first', async () => {
  const app = await openCutLine(RELEASES);
  assert.ok(app.callsTo('listReleases').length > 0, 'the dialog asked for the releases (releases:list)');
  assert.match(pageMarkup(app), /data-testid="recent-releases"/, 'a list of the last releases (data-testid="recent-releases")');
  const shown = H.visibleText(pageMarkup(app, { defs: false }));
  assert.ok(/1\.1\.2\s*·\s*2026-10-13\s*·\s*4 issues/.test(shown), `"1.1.2 · 2026-10-13 · 4 issues": ${shown.slice(0, 400)}`);
  assert.ok(shown.includes('1.1.1') && shown.includes('1.1.0'), 'the two before it');
  assert.ok(shown.indexOf('1.1.2') < shown.indexOf('1.1.1') && shown.indexOf('1.1.1') < shown.indexOf('1.1.0'), 'newest first');
});

test('#436 cut line dialog: the fourth shipped release and an unshipped one are not listed', async () => {
  const app = await openCutLine(RELEASES);
  const shown = H.visibleText(pageMarkup(app, { defs: false }));
  assert.ok(shown.includes('1.1.2'), `the list is drawn (fixture check): ${shown.slice(0, 200)}`);
  assert.equal(shown.includes('1.0.0'), false, 'the oldest of the four shipped is left out');
  assert.equal(shown.includes('1.2.0'), false, 'a release that has not shipped is left out');
});

test('#436 cut line dialog: "No release yet" when nothing shipped', async () => {
  const app = await openCutLine([]);
  assert.ok(app.callsTo('listReleases').length > 0, 'the dialog asked for the releases (releases:list)');
  assert.match(pageMarkup(app, { defs: false }), /No release yet/i);
});

test('#436 cut line dialog: "Suggest version" fills the name field with the suggestion and saves nothing', async () => {
  const app = await openCutLine(RELEASES);
  await clickSuggest(app, ['#cut-line-form', '#cut-line-modal']);
  const value = String(app.el('#cut-line-name').value);
  assert.ok(AFTER_112.includes(value), `the field holds a version after 1.1.2 (1.1.3 for bug fixes only): "${value}"`);
  assert.equal(app.callsTo('saveRoadmap').length, 0, 'no cut line saved: the button never submits');
  assert.equal(app.el('#cut-line-modal').classList.contains('hidden'), false, 'the dialog stays open');
  assert.match(pageMarkup(app), /data-testid="suggest-version-reason"/, 'a line under the field says why (data-testid="suggest-version-reason")');
});

// ---- the Releases screen ---------------------------------------------------------------------------------

const NEXT = { issues: [{ number: 330, title: 'Fix the alert', labels: ['bug'] }, { number: 331, title: 'Fix the bar', labels: ['bug'] }], commits: 2, runs: [], notes: '' };

async function showReleases(releases = RELEASES) {
  const app = loadApp({ api: { listReleases: async () => ({ projectId: 'p1', releases, next: NEXT, line: null, run: null }) } });
  await app.boot();
  app.run("showView('releases')");
  await app.settle(20);
  assert.equal(app.state().view, 'releases');
  return app;
}

test('#436 Releases screen: the next release shows the last three shipped releases as text above the version field', async () => {
  const app = await showReleases();
  const body = String(app.el('#rel-body').innerHTML);
  const list = H.findEl(body, (e) => e.attrs['data-testid'] === 'recent-releases');
  assert.ok(list, 'a list of the last releases (data-testid="recent-releases") in the next release');
  const shown = H.visibleText(list.inner);
  assert.ok(/1\.1\.2\s*·\s*2026-10-13\s*·\s*4 issues/.test(shown), `"1.1.2 · 2026-10-13 · 4 issues": ${shown}`);
  assert.ok(shown.includes('1.1.1') && shown.includes('1.1.0'), `the two before it: ${shown}`);
  assert.equal(shown.includes('1.0.0'), false, 'the oldest of the four shipped is left out');
  assert.equal(shown.includes('1.2.0'), false, 'a release that has not shipped is left out');
  assert.ok(list.start < body.indexOf('id="rel-version"'), 'above the version field');
});

test('#436 Releases screen: "Suggest version" fills #rel-version and starts no release', async () => {
  const app = await showReleases();
  await clickSuggest(app, ['#rel-body']);
  const value = String(app.el('#rel-version').value);
  assert.ok(AFTER_112.includes(value), `the field holds a version after 1.1.2 (1.1.3 for bug fixes only): "${value}"`);
  assert.equal(app.callsTo('startRelease').length, 0, 'no release run started (releases:start)');
  assert.match(pageMarkup(app), /data-testid="suggest-version-reason"/, 'a line under the field says why (data-testid="suggest-version-reason")');
});
