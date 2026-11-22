// #270 A shared Alerts component (one bar of alerts at the top of a page) and its first user, the
// Backlog / Roadmap screen. Acceptance tests written before the code.
//
// Interface the developer implements:
// NEW module packages/ui-kit/alerts.js, UMD like gate-oracle.js (Node: module.exports; browser:
// window.Alerts), self-contained, no Backlog code (it names no backlog, roadmap or api):
//   alert: { id, level: 'info'|'warning'|'error', title, text, actions: [{ label, onClick, primary }],
//            dismissible, createdAt? (ISO string or ms) }
//   sortAlerts(alerts) -> a new array: errors, then warnings, then infos; within a level the OLDEST
//       first (createdAt ascending; without createdAt, the given order).
//   alertsHtml(alerts, index = 0) -> the markup ('' with no alert): the sorted list's alert at
//       `index`, as an element with class `alert alert-<level>` and role="alert" (error) or
//       role="status" (warning, info), its title and text; its actions as
//       <button data-alert="<id>" data-alert-action="<action index>">label</button>; a dismiss control
//       <button data-alert-dismiss="<id>"> only when dismissible and not an error; with more than one
//       alert a counter "<n>/<total>" (class `alerts-count`) and arrows [data-alert-nav="prev"] /
//       [data-alert-nav="next"]. Navigation WRAPS (next on the last → the first, prev on the first →
//       the last).
//   mount(container) -> { set(alerts) }: set() renders alertsHtml into container.innerHTML (keeping
//       the shown alert by id when it is still there, else the first); clicks on the container
//       (container.onclick or its 'click' listener, delegated through e.target.closest) handle the
//       arrows, an action (its onClick is called) and dismiss (the alert leaves the list).
// Backlog: the page markup has <div id="bl-alerts"> (the component's root carries data-testid="page-alerts",
//   each alert data-testid="page-alert" with data-level, the counter data-testid="alerts-counter",
//   as fronts/build/features/steps/backlog.steps.js expects) at the top of the
//   page, before the filter row (.pr-toolbar); backlog.js mounts window.Alerts on it and sets, on
//   every render, Board and Roadmap alike: unpushed local commits (info, title "Not pushed", action
//   "Push…" opening the push dialog), a stale Backlog Refresh (warning, action "Refresh now"), a
//   roadmap paused by an item's failure (`state: 'paused'` + `pausedBy` + `error`: error, its text
//   the roadmap's error). An alert leaves when its condition clears.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const H = require('./page-pieces');
const { loadApp, text } = require('./renderer-app-harness');

const MODULE = path.join(__dirname, '..', 'alerts.js');
const load = () => require(MODULE);

const alert = (id, level, createdAt, extra = {}) => ({ id, level, title: `Title ${id}`, text: `Text ${id}`, actions: [], dismissible: true, createdAt, ...extra });
const THREE = () => [
  alert('info1', 'info', '2026-10-04T10:00:00.000Z'),
  alert('warn1', 'warning', '2026-10-04T11:00:00.000Z'),
  alert('err1', 'error', '2026-10-04T11:30:00.000Z'),
];

// a fake container: its markup is parsed to build click targets whose closest() walks real ancestors
function container() {
  const c = { innerHTML: '', onclick: null, listeners: {}, dataset: {}, classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    addEventListener(t, fn) { (this.listeners[t] ||= []).push(fn); }, removeEventListener() {}, querySelector: () => null, querySelectorAll: () => [], setAttribute() {}, removeAttribute() {} };
  c.click = async (pred) => {
    const el = H.findEl(c.innerHTML, pred);
    assert.ok(el, 'the element to click is rendered in the alerts');
    const ev = { target: H.fakeEl(el), currentTarget: c, type: 'click', preventDefault() {}, stopPropagation() {} };
    await c.onclick?.(ev);
    for (const fn of c.listeners.click || []) await fn(ev);
  };
  return c;
}
const shown = (html) => H.findEl(html, (e) => /\balert-(info|warning|error)\b/.test(e.attrs.class || ''));
const counter = (html) => H.visibleText(H.findEl(html, (e) => /\balerts-count\b/.test(e.attrs.class || ''))?.inner || '');

// ---- the component ----------------------------------------------------------------------------

test('#270 sortAlerts: errors first, then warnings, then infos; the oldest first within a level', () => {
  const list = [
    alert('i-new', 'info', '2026-10-04T11:00:00.000Z'),
    alert('w', 'warning', '2026-10-04T09:00:00.000Z'),
    alert('e-new', 'error', '2026-10-04T11:30:00.000Z'),
    alert('i-old', 'info', '2026-10-04T08:00:00.000Z'),
    alert('e-old', 'error', '2026-10-04T07:00:00.000Z'),
  ];
  assert.deepEqual(Array.from(load().sortAlerts(list), (a) => a.id), ['e-old', 'e-new', 'w', 'i-old', 'i-new']);
});

test('#270 alertsHtml: three alerts show the error first with role="alert", its title and text, and the counter "1/3"', () => {
  const html = load().alertsHtml(THREE());
  const el = shown(html);
  assert.ok(el, 'an .alert-<level> element');
  assert.deepEqual([/\balert-error\b/.test(el.attrs.class), el.attrs.role], [true, 'alert']);
  assert.match(H.visibleText(el.outer), /Title err1/);
  assert.match(H.visibleText(el.outer), /Text err1/);
  assert.equal(counter(html), '1/3');
});

test('#270 alertsHtml: a warning and an info have role="status" and their level class', () => {
  const { alertsHtml } = load();
  const got = ['warning', 'info'].map((level) => {
    const el = shown(alertsHtml([alert('x', level)]));
    return el ? [el.attrs.role, new RegExp(`\\balert-${level}\\b`).test(el.attrs.class)] : null;
  });
  assert.deepEqual(got, [['status', true], ['status', true]]);
});

test('#270 mount: the arrows move between alerts and wrap around (next after the last → the first, prev on the first → the last)', async () => {
  const c = container();
  load().mount(c).set(THREE());
  const nav = (dir) => c.click((e) => e.attrs['data-alert-nav'] === dir);
  const seen = [counter(c.innerHTML)];
  await nav('next'); seen.push(counter(c.innerHTML), /\balert-warning\b/.test(shown(c.innerHTML)?.attrs.class || ''));
  await nav('next'); seen.push(counter(c.innerHTML));
  await nav('next'); seen.push(counter(c.innerHTML));
  await nav('prev'); seen.push(counter(c.innerHTML));
  assert.deepEqual(seen, ['1/3', '2/3', true, '3/3', '1/3', '3/3']);
});

test('#270 mount: clicking an alert\'s action calls its onClick once', async () => {
  const c = container();
  let calls = 0;
  load().mount(c).set([alert('push', 'info', null, { actions: [{ label: 'Push…', onClick: () => { calls += 1; }, primary: true }] })]);
  await c.click((e) => 'data-alert-action' in e.attrs && H.visibleText(e.inner) === 'Push…');
  assert.equal(calls, 1);
});

test('#270 a dismissible info has a dismiss control that removes it; an error never has one', async () => {
  const { alertsHtml, mount } = load();
  const err = alertsHtml([alert('e', 'error', null, { dismissible: true })]);
  assert.equal(!!H.findEl(err, (e) => 'data-alert-dismiss' in e.attrs), false, 'no dismiss on an error');
  const c = container();
  mount(c).set([alert('w', 'warning', '2026-10-04T08:00:00.000Z'), alert('i', 'info', '2026-10-04T09:00:00.000Z'), alert('i2', 'info', '2026-10-04T10:00:00.000Z')]);
  await c.click((e) => e.attrs['data-alert-nav'] === 'next');
  await c.click((e) => e.attrs['data-alert-dismiss'] === 'i');
  assert.equal(counter(c.innerHTML), '1/2');
  const left = [H.visibleText(shown(c.innerHTML)?.outer || '')];
  await c.click((e) => e.attrs['data-alert-nav'] === 'next');
  left.push(H.visibleText(shown(c.innerHTML)?.outer || ''));
  assert.deepEqual(left.map((t) => /Title i(?!2)\b/.test(t)), [false, false], 'the dismissed alert is gone');
});

test('#270 alerts.js is a shared component: no Backlog, roadmap or api code in it', () => {
  load();
  const src = fs.readFileSync(MODULE, 'utf8').replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, '');
  assert.equal(/backlog|roadmap|\bapi\./i.test(src), false);
});

// ---- the Backlog / Roadmap screen ---------------------------------------------------------------

const issue = (number, extra = {}) => ({
  number, title: `Issue ${number}`, state: 'open', column: 'todo', labels: [], assignees: [], author: 'eduardo', body: '',
  url: `https://github.com/o/r/issues/${number}`, createdAt: '2026-09-01T00:00:00Z', updatedAt: '2026-09-10T00:00:00Z',
  tasks: { total: 0, done: 0 }, runs: [], pullRequests: [], ...extra,
});
const ROADMAP_ERROR = 'Run run-42 failed: 3 tests failed';
function backlogData() {
  return {
    platform: 'github',
    syncedAt: '2026-10-04T00:00:00Z',
    issues: [issue(1), issue(2)],
    epics: [],
    local: { ahead: 2, behind: 0, base: 'main', repo: 'C:/repo', issues: [1], commits: [{ sha: 'abcdef1234567', subject: 'Fix #1', issues: [1] }, { sha: '1234567abcdef', subject: 'Chore', issues: [] }] },
    refresh: { due: true, hoursAgo: 72, merges: 3, lastRun: { runId: 'refresh-1', startedAt: '2026-10-01T00:00:00Z' }, base: 'main' },
    roadmap: {
      state: 'paused', pausedBy: 'it1', error: ROADMAP_ERROR, simulated: false, scope: null,
      stages: [{ id: 'st1', name: '', note: '', items: [{ id: 'it1', status: 'failed', runId: 'run-42', runs: ['run-42'], error: ROADMAP_ERROR, workflow: 'feature.yaml', workflowName: 'Local hero', inputs: {}, issues: [{ number: 1, title: 'Issue 1', url: 'https://github.com/o/r/issues/1' }] }] }],
    },
  };
}
async function backlog(data) {
  const app = loadApp({
    storage: { 'craftorio.backlogProject': 'p1', 'craftorio.currentProject': 'p1' },
    api: {
      listProjects: async () => [{ id: 'p1', name: 'Project One', repo: 'https://github.com/o/r', folder: 'C:/repo' }],
      getSettings: async () => ({ lastProject: 'p1' }),
      getBacklog: async () => data,
      syncBacklog: async () => data,
    },
  });
  await app.boot();
  app.run("showView('backlog')");
  await app.settle(10);
  await app.click('#bl-mode', { dataset: { mode: 'kanban' } });
  return app;
}
const alertsBox = (app) => app.el('#bl-alerts').innerHTML;
// clicks a button rendered in #bl-alerts: its data-* attributes go on the fake target
async function clickIn(app, pred) {
  const el = H.findEl(alertsBox(app), pred);
  assert.ok(el, 'the button is rendered in #bl-alerts');
  const dataset = {};
  for (const [k, v] of Object.entries(el.attrs)) if (k.startsWith('data-')) dataset[k.slice(5).replace(/-([a-z])/g, (_, ch) => ch.toUpperCase())] = v;
  const sel = `[data-alert-click-${Math.random().toString(36).slice(2)}]`;
  return app.click(sel, { dataset, within: ['#bl-alerts'] });
}

test('#270 Backlog: the alerts box sits at the top of the page, before the filter row', async () => {
  const app = await backlog(backlogData());
  const markup = app.defs.get('backlog').markup;
  const at = markup.indexOf('id="bl-alerts"');
  assert.ok(at >= 0, '#bl-alerts in the Backlog page markup');
  assert.ok(at < markup.indexOf('class="pr-toolbar"'), '#bl-alerts comes before the filter row');
});

test('#270 Backlog Board: unpushed commits, a stale refresh and a roadmap paused by a failure show "1/3", the red error first', async () => {
  const app = await backlog(backlogData());
  const html = alertsBox(app);
  assert.equal(counter(html), '1/3');
  const first = shown(html);
  assert.deepEqual([/\balert-error\b/.test(first?.attrs.class || ''), first?.attrs.role], [true, 'alert']);
  assert.ok(H.visibleText(first.outer).includes(ROADMAP_ERROR), 'the error alert tells the roadmap\'s error');
});

test('#270 Roadmap: the same three alerts, "1/3", the error first', async () => {
  const app = await backlog(backlogData());
  app.run("showView('roadmap')");
  await app.settle(10);
  const html = alertsBox(app);
  assert.equal(counter(html), '1/3');
  assert.equal(/\balert-error\b/.test(shown(html)?.attrs.class || ''), true);
});

test('#270 Backlog: the "Not pushed" alert\'s Push… opens the push dialog', async () => {
  const app = await backlog(backlogData());
  await clickIn(app, (e) => e.attrs['data-alert-nav'] === 'prev'); // wraps to the last: the info
  assert.match(text(alertsBox(app)), /Not pushed/);
  await clickIn(app, (e) => 'data-alert-action' in e.attrs && H.visibleText(e.inner) === 'Push…');
  assert.equal(app.el('#push-title').textContent, 'Push 2 commits to origin/main');
});

test('#270 Backlog: an alert leaves when its condition clears (no unpushed commits → no "Not pushed", "1/2")', async () => {
  const data = backlogData();
  const app = await backlog(data);
  assert.equal(counter(alertsBox(app)), '1/3');
  data.local = { ahead: 0, behind: 0, base: 'main', issues: [], commits: [] };
  await app.click('#bl-mode', { dataset: { mode: 'kanban' } }); // any render
  assert.equal(counter(alertsBox(app)), '1/2');
  assert.doesNotMatch(alertsBox(app), /Not pushed/);
});
