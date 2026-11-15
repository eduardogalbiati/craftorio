// #836 Mockups phase 3 (the handoff), the screens:
// - the mockup editor (fronts/plan/views/mockups/mockup-editor.js, index.html?window=mockup) has
//   "Review this screen" (data-testid mockup-review-screen, data-mockup-review-screen), "Start a development
//   run" (mockup-start-run, data-mockup-start-run) and "Prepare issues" (mockup-prepare-issues,
//   data-mockup-prepare-issues), handled by the editor root's click listener like the #835 tools;
// - Review this screen first shows the estimate (mockup-cost-estimate, MockupModel 'review-screen': $0.10 to
//   $0.40) and reviews nothing; its confirm button (mockup-review-confirm, data-mockup-review-confirm) calls
//   api.reviewMockupScreen(projectId, slug, axe) once and draws the findings (mockup-review-finding); a
//   screen loaded or a run that finishes never reviews;
// - Start a development run freezes the current version (api.freezeMockupVersion(projectId, slug, commit))
//   and sends the main window AgentsWindow-style { name: 'mockups:start-run', target: { projectId, inputs:
//   { mockup: <the frozen folder> } } } (api.navigateMainWindow); it never starts a run itself; in the main
//   window the 'mockups:start-run' navigation opens the Start drawer (openDrawer) with the project and the
//   `mockup` input filled;
// - Prepare issues, with regions selected, sends the main window { name: 'mockups:prepare-issues', target }
//   whose target names each selected data-mid; it files nothing;
// - the Mockups screen offers "Recreate from the running app" (mockup-recreate-from-app);
// - the #258 commit dialog (fronts/plan/views/discovery/discovery-commit.js) opened with `crops`
//   (DiscoveryCommit.open({ projectId, card, crops: [{ mid, file, name }], done })) draws each crop
//   (discovery-commit-crop, data-mid) and files nothing before File the issues; File the issues sends the
//   crops (their data-mids and files) with the issues.
// The editor and the Mockups screen run on the real page through packages/ui-kit/test/renderer-app-harness.js;
// the commit dialog through test/discovery-board-harness.js. Values are compared as primitives.
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadApp, text } = require('@multiagent/ui-kit/test/renderer-app-harness');
const { boardApi, card, openBoard, settle, P } = require('./discovery-board-harness');

const SLUG = 'orders-dashboard';
const COMMIT = 'c41e2a9aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const FROZEN = '/ws/mockups/p1/frozen/orders-dashboard@c41e2a9';
const FINDINGS = [
  { kind: 'kit', rule: 'raw-color', value: '#ff3366', mid: 'm5', message: 'The Pay button uses #ff3366, not a kit token' },
  { kind: 'axe', rule: 'color-contrast', mid: 'm2', message: 'The title does not meet the contrast ratio' },
];
const RUN_STARTS = /^(startRun|runPipeline|startWorkflowRun|startMockupRun)$/;

// all the markup the page's elements hold
const allMarkup = (app) => [...app.elements.values(), ...app.created].map((e) => String(e.innerHTML || '')).join('\n');
// the text of the first element marked `testid` up to its closing tag `tag`
const textOf = (html, testid, tag) => {
  const at = html.indexOf(`data-testid="${testid}"`);
  return at < 0 ? null : text(html.slice(html.lastIndexOf('<', at), html.indexOf(`</${tag}>`, at)));
};
// the text that follows the element marked `testid` (its content and a little after)
const textAfter = (html, testid) => {
  const at = html.indexOf(`data-testid="${testid}"`);
  return at < 0 ? '' : text(html.slice(html.lastIndexOf('<', at), at + 600));
};

async function editor({ api = {} } = {}) {
  const app = loadApp({
    storage: { 'multiagent.currentProject': 'p1' },
    api: {
      listProjects: async () => [{ id: 'p1', name: 'Project One', repo: 'https://github.com/o/r', folder: 'C:/repo' }],
      getSettings: async () => ({ lastProject: 'p1' }),
      listMockupVersions: async () => [{ commit: COMMIT, message: 'Smaller title' }],
      readMockupChat: async () => [],
      listMockupVariants: async () => ({ current: 'main', variants: [{ name: 'main' }] }),
      listMockupFlows: async () => [],
      listMockups: async () => [{ slug: SLUG, title: 'Orders dashboard' }],
      freezeMockupVersion: async (projectId, slug, commit) => ({ ref: `${slug}@${commit}`, slug, commit, dir: FROZEN }),
      reviewMockupScreen: async () => ({ findings: FINDINGS, costUsd: 0, model: 'simulated' }),
      ...api,
    },
  });
  app.sandbox.location.search = `?window=mockup&project=p1&slug=${SLUG}`;
  await app.boot();
  await app.settle(10);
  const frame = { name: 'canvas window', postMessage() {} };
  app.el('#mockup-canvas').contentWindow = frame;
  const post = async (data) => { app.sandbox.dispatchEvent({ type: 'message', source: frame, data }); await app.settle(); };
  const press = (key) => app.click(`[data-${key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}]`, { dataset: { [key]: '' }, within: ['#mockup-editor-root'] });
  const markup = () => allMarkup(app);
  const runStarts = () => app.apiCalls.map(([n]) => n).filter((n) => RUN_STARTS.test(n));
  return { app, post, press, markup, runStarts };
}

// ---- the editor's controls -----------------------------------------------------------------------------

test('#836 the editor offers "Review this screen"', async () => {
  const { markup } = await editor();
  assert.equal(textOf(markup(), 'mockup-review-screen', 'button'), 'Review this screen');
});

test('#836 the editor offers "Start a development run"', async () => {
  const { markup } = await editor();
  assert.equal(textOf(markup(), 'mockup-start-run', 'button'), 'Start a development run');
});

test('#836 the editor offers "Prepare issues"', async () => {
  const { markup } = await editor();
  assert.equal(textOf(markup(), 'mockup-prepare-issues', 'button'), 'Prepare issues');
});

// ---- Review this screen: the estimate first, then the review on demand ----------------------------------

test('#836 Review this screen shows the review\'s estimate ($0.10 to $0.40) first', async () => {
  const { press, markup } = await editor();
  await press('mockupReviewScreen');
  const estimate = textAfter(markup(), 'mockup-cost-estimate');
  assert.deepEqual([estimate.includes('$0.10'), estimate.includes('$0.40')], [true, true], estimate);
});

test('#836 Review this screen reviews nothing while its estimate waits for the confirm', async () => {
  const { app, press, markup } = await editor();
  await press('mockupReviewScreen');
  assert.deepEqual([markup().includes('data-testid="mockup-cost-estimate"'), app.callsTo('reviewMockupScreen').length], [true, 0]);
});

test('#836 confirming the estimate reviews the screen once', async () => {
  const { app, press } = await editor();
  await press('mockupReviewScreen');
  await press('mockupReviewConfirm');
  assert.deepEqual(app.callsTo('reviewMockupScreen').map((a) => [a[0], a[1]]), [['p1', SLUG]]);
});

test('#836 the review\'s findings are drawn', async () => {
  const { press, markup } = await editor();
  await press('mockupReviewScreen');
  await press('mockupReviewConfirm');
  const html = markup();
  assert.equal(html.includes('data-testid="mockup-review-finding"'), true);
  assert.deepEqual(FINDINGS.map((f) => text(html).includes(f.message)), [true, true]);
});

// never a review on every turn: the editor that offers it does not run it on a load or a finished run
test('#836 loading the screen and a finished run never review it', async () => {
  const { app, markup } = await editor();
  for (const fn of app.apiHandlers.onEvent || []) fn({ type: 'run.finished' });
  await app.settle(10);
  assert.deepEqual([markup().includes('data-testid="mockup-review-screen"'), app.callsTo('reviewMockupScreen').length], [true, 0]);
});

// ---- Start a development run: the run start opened with the mockup, never a run ------------------------

test('#836 Start a development run freezes the current version', async () => {
  const { app, press } = await editor();
  await press('mockupStartRun');
  assert.deepEqual(app.callsTo('freezeMockupVersion').map((a) => [a[0], a[1], a[2]]), [['p1', SLUG, COMMIT]]);
});

test('#836 Start a development run asks the main window to open the run start with the mockup input filled', async () => {
  const { app, press } = await editor();
  await press('mockupStartRun');
  const sent = app.callsTo('navigateMainWindow').map(([m]) => JSON.parse(JSON.stringify(m)));
  assert.deepEqual(sent.map((m) => [m.name, m.target?.projectId, m.target?.inputs?.mockup]), [['mockups:start-run', 'p1', FROZEN]]);
});

test('#836 Start a development run only opens the run start: it never starts a run', async () => {
  const { app, press, runStarts } = await editor();
  await press('mockupStartRun');
  const opened = app.callsTo('navigateMainWindow').filter(([m]) => m?.name === 'mockups:start-run').length;
  assert.deepEqual([opened, runStarts()], [1, []]);
});

async function mainWindow() {
  const app = loadApp({
    storage: { 'multiagent.currentProject': 'p1' },
    api: {
      listProjects: async () => [{ id: 'p1', name: 'Project One', repo: 'https://github.com/o/r', folder: 'C:/repo' }],
      getSettings: async () => ({ lastProject: 'p1' }),
    },
  });
  await app.boot();
  const opened = [];
  app.sandbox.openDrawer = async (opts) => { opened.push(JSON.parse(JSON.stringify(opts ?? null))); };
  const navigate = async (m) => { for (const fn of app.apiHandlers.onMainWindowNavigate || []) await fn(m); await app.settle(10); };
  return { app, opened, navigate };
}

test('#836 in the main window mockups:start-run opens the Start drawer with the project and the mockup input', async () => {
  const { opened, navigate } = await mainWindow();
  await navigate({ name: 'mockups:start-run', target: { projectId: 'p1', inputs: { mockup: FROZEN } } });
  assert.deepEqual(opened.map((o) => [o?.project, o?.inputs?.mockup]), [['p1', FROZEN]]);
});

test('#836 in the main window mockups:start-run opens the drawer and starts no run', async () => {
  const { app, opened, navigate } = await mainWindow();
  await navigate({ name: 'mockups:start-run', target: { projectId: 'p1', inputs: { mockup: FROZEN } } });
  assert.deepEqual([opened.length, app.apiCalls.map(([n]) => n).filter((n) => RUN_STARTS.test(n))], [1, []]);
});

// ---- Prepare issues: the selected regions go to the commit dialog, nothing filed ----------------------

async function withTwoRegions() {
  const e = await editor({ api: { saveMockupCrops: async (projectId, slug, commit, regions) => regions.map((r, i) => ({ mid: r.mid, file: `refs/crop${i}.png`, name: `${slug}@c41e2a9-${r.mid}.png` })) } });
  await e.post({ type: 'mockup:select', mid: 'm2', selector: 'main > h1', text: 'Orders', box: [0, 0, 200, 40] });
  await e.post({ type: 'mockup:select', mid: 'm5', selector: 'main > button', text: 'Pay', box: [0, 50, 80, 30], add: true });
  return e;
}

test('#836 Prepare issues sends the main window the selected regions, each with its data-mid', async () => {
  const { app, press } = await withTwoRegions();
  await press('mockupPrepareIssues');
  const sent = app.callsTo('navigateMainWindow').map(([m]) => JSON.parse(JSON.stringify(m))).filter((m) => m.name === 'mockups:prepare-issues');
  const target = JSON.stringify(sent[0]?.target ?? null);
  assert.deepEqual([sent.length, target.includes('"m2"'), target.includes('"m5"')], [1, true, true]);
});

test('#836 Prepare issues only prepares them: it files nothing', async () => {
  const { app, press } = await withTwoRegions();
  await press('mockupPrepareIssues');
  const prepared = app.callsTo('navigateMainWindow').filter(([m]) => m?.name === 'mockups:prepare-issues').length;
  assert.deepEqual([prepared, app.callsTo('commitDiscoveryCard').length, app.callsTo('proposeRoadmap').length], [1, 0, 0]);
});

// ---- the Mockups screen: Recreate from the running app -------------------------------------------------

test('#836 the Mockups screen offers "Recreate from the running app"', async () => {
  const app = loadApp({
    storage: { 'multiagent.currentProject': 'p1' },
    api: {
      listProjects: async () => [{ id: 'p1', name: 'Project One', repo: 'https://github.com/o/r', folder: 'C:/repo' }],
      getSettings: async () => ({ lastProject: 'p1' }),
      listMockups: async () => [{ slug: SLUG, title: 'Orders dashboard' }],
    },
  });
  await app.boot();
  app.run("showView('mockups')");
  await app.settle(10);
  const html = [allMarkup(app), String(app.defs.get('mockups')?.markup || '')].join('\n');
  assert.equal(textOf(html, 'mockup-recreate-from-app', 'button'), 'Recreate from the running app');
});

// ---- the commit dialog with the crops ------------------------------------------------------------------

const tid = (id) => `[data-testid="${id}"]`;
const SPLIT = { issues: [{ title: 'Pay from the orders dashboard', tasks: ['Add the Pay button'], complexity: 1, workflow: 'feature.yaml', reason: '' }] };
const CROPS = [
  { mid: 'm2', file: 'refs/crop0.png', name: 'orders-dashboard@c41e2a9-m2.png' },
  { mid: 'm5', file: 'refs/crop1.png', name: 'orders-dashboard@c41e2a9-m5.png' },
];

async function dialogWithCrops() {
  const ready = card({ title: 'Orders dashboard', column: 'ready', clarity: 90 });
  const calls = [];
  const { methods } = boardApi({ cards: [ready] });
  const page = await openBoard({
    cards: [ready],
    api: {
      ...methods,
      proposeDiscoveryCommit: async () => ({ split: structuredClone(SPLIT), model: 'simulated', costUsd: 0 }),
      commitDiscoveryCard: async (projectId, cardId, split) => {
        calls.push(JSON.parse(JSON.stringify([projectId, cardId, split])));
        const issues = split.issues.map((i, n) => ({ ...i, number: 101 + n, url: `https://github.com/o/r/issues/${101 + n}` }));
        return { issues, card: { ...ready, column: 'committed' }, simulated: true };
      },
    },
  });
  page.sandbox.DiscoveryCommit.open({ projectId: P, card: structuredClone(ready), crops: structuredClone(CROPS), done() {} });
  await settle(20);
  return { page, calls, dialog: page.$(tid('discovery-commit-dialog')) };
}

const submit = async (page, dialog) => {
  const { Event } = page.dom.classes;
  dialog.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  await settle(30);
};

test('#836 the commit dialog draws each crop with its data-mid', async () => {
  const { dialog } = await dialogWithCrops();
  assert.deepEqual([...dialog.querySelectorAll(tid('discovery-commit-crop'))].map((c) => c.getAttribute('data-mid')), ['m2', 'm5']);
});

test('#836 the commit dialog shows the crops and files nothing before File the issues', async () => {
  const { calls, dialog } = await dialogWithCrops();
  assert.deepEqual([dialog.querySelectorAll(tid('discovery-commit-crop')).length, calls.length], [2, 0]);
});

test('#836 File the issues sends the crops (data-mid and file) with the issues', async () => {
  const { page, calls, dialog } = await dialogWithCrops();
  await submit(page, dialog);
  const sent = JSON.stringify(calls[0]?.[2] ?? null);
  assert.deepEqual([calls.length, ...CROPS.flatMap((c) => [sent.includes(`"${c.mid}"`), sent.includes(c.file)])], [1, true, true, true, true]);
});
