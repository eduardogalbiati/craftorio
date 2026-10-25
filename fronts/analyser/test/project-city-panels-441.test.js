// #441, the city map: every panel minimizes, the legend closes. The whole Architecture tab runs in a
// mini DOM (test/city-modes-harness.js), the modes opened through the app's entry points (#440).
// The contract these tests set (tests first):
//   - each panel's root has data-city-panel="<name>" (notes, connections, agents, impact, release,
//     replay, legend) and, in its title row, a chevron <button type="button"
//     data-testid="city-panel-toggle"> with aria-expanded ("true" expanded) and a title (its tooltip);
//     a <button>, so the keyboard reaches it;
//   - the panel's body is the element with data-city-panel-body; minimized, the chevron says
//     aria-expanded="false" and the body is hidden (the `hidden` attribute or class, or the panel's
//     `min` class) but stays in the DOM with its content and its state (the search typed, the issue
//     picked, the replay's position), and it keeps updating (the agents at work);
//   - the legend (data-testid="project-city-legend") has a close button data-testid="city-legend-close";
//     closed, a small button data-testid="city-legend-open" ("Legend") in its corner brings it back
//     with the same rows;
//   - each panel's state (minimized, the legend closed) is remembered per mode (and per viewer: the
//     window's storage), so a mode opens again the way the owner left it, and another mode is not changed.
// Assertions are on primitives only. No real run, no model call.
const test = require('node:test');
const assert = require('node:assert/strict');
const H = require('./city-modes-harness');

const { ISSUE, STAGE, settle, q, text, shownId, panel, toggleOf, bodyShown, layersOn, isOn, mode } = H;

async function explore(t, opts) {
  const o = await H.openCity(opts);
  assert.ok(o.root, 'the City view is on screen');
  t.after(() => { try { o.w.ProjectArchitecture.show('other', o.dom.document.createElement('div')); } catch { /* the tab is gone */ } });
  return o;
}
const expanded = (o, name) => String(toggleOf(panel(o.root, name))?.getAttribute('aria-expanded') ?? '');
async function toggle(o, name) {
  const btn = toggleOf(panel(o.root, name));
  assert.ok(btn, `the ${name} panel's chevron`);
  btn.click();
  await settle();
}
// the chevron's shape: a button, typed, with aria-expanded and a tooltip
function chevron(o, name) {
  const btn = toggleOf(panel(o.root, name));
  if (!btn) return `${name}: no chevron`;
  return [name, btn.localName, btn.getAttribute('type'), btn.getAttribute('aria-expanded'), String(btn.getAttribute('title') || '').trim() ? 'title' : 'no title'].join(' ');
}
const ok = (name) => `${name} button button true title`;
async function setLive(o, on) {
  const el = q(o.root, 'city-live-toggle');
  assert.ok(el, 'the Live toggle');
  if (isOn(el) !== on) el.click();
  await settle();
}
async function showRelease(o) {
  o.w.ProjectCityRelease.showRelease('p1', { to: '1.1.2' });
  await settle();
}
const closeMode = async (o) => {
  const btn = q(o.root, 'city-mode-close');
  assert.ok(btn, 'the mode\'s Close');
  btn.click();
  await settle();
};

test('#441 Explore\'s panels each have a chevron: a button with aria-expanded and a tooltip', async (t) => {
  const o = await explore(t);
  for (const name of ['notes', 'connections']) assert.equal(chevron(o, name), ok(name));
});

test('#441 every mode\'s panels have a chevron: impact, stage, release, replay, agents (Live)', async (t) => {
  const o = await explore(t, { agents: () => H.BUSY() });
  o.w.ProjectCityImpact.showIssue('p1', ISSUE);
  await settle();
  assert.equal(chevron(o, 'impact'), ok('impact'), 'the issue\'s card');
  o.w.ProjectCityImpact.showStage('p1', STAGE);
  await settle();
  assert.equal(chevron(o, 'impact'), ok('impact'), 'the stage\'s card');
  await showRelease(o);
  assert.equal(chevron(o, 'release'), ok('release'));
  await closeMode(o);
  o.w.ProjectCityAgents.replay('p1', H.REPLAY.runId);
  await settle();
  assert.equal(chevron(o, 'replay'), ok('replay'));
  await closeMode(o);
  await setLive(o, true);
  assert.equal(chevron(o, 'agents'), ok('agents'));
});

test('#441 minimizing Most connected folds it to its title row and keeps its content; expanding gives it back as it was', async (t) => {
  const o = await explore(t);
  const search = q(o.root, 'city-connections-search');
  assert.ok(search, 'the panel\'s search');
  o.dom.type(search, 'run');
  await settle();
  const rows = o.root.querySelectorAll('[data-testid="city-connection"]').length;
  await toggle(o, 'connections');
  const p = panel(o.root, 'connections');
  assert.equal(!!p, true, 'the panel stays on screen');
  assert.equal(expanded(o, 'connections'), 'false');
  assert.equal(bodyShown(o.root, p), false, 'its body is hidden');
  assert.match(text(p), /Most connected/, 'its title row stays');
  assert.equal(String(q(o.root, 'city-connections-search')?.value ?? ''), 'run', 'the search typed is kept');
  await toggle(o, 'connections');
  assert.equal(expanded(o, 'connections'), 'true');
  assert.equal(bodyShown(o.root, panel(o.root, 'connections')), true);
  assert.equal(String(q(o.root, 'city-connections-search')?.value ?? ''), 'run');
  assert.equal(o.root.querySelectorAll('[data-testid="city-connection"]').length, rows, 'the same rows');
});

test('#441 a minimized release card keeps the issue picked and its colours on the city', async (t) => {
  const o = await explore(t);
  await showRelease(o);
  const pick = q(o.root, 'city-release-issue');
  assert.ok(pick, 'the issue filter');
  pick.value = '12';
  pick.dispatchEvent(new o.w.Event('change', { bubbles: true }));
  await settle();
  await toggle(o, 'release');
  assert.equal(expanded(o, 'release'), 'false');
  assert.equal(bodyShown(o.root, panel(o.root, 'release')), false);
  assert.equal(String(q(o.root, 'city-release-issue')?.value ?? ''), '12', 'the issue picked is kept');
  assert.deepEqual(layersOn(o.calls), ['release'], 'the release stays on the city');
  await toggle(o, 'release');
  assert.equal(String(q(o.root, 'city-release-issue')?.value ?? ''), '12');
  assert.match(text(q(o.root, 'city-release-header')), /1 added/);
  assert.doesNotMatch(text(q(o.root, 'city-release-header')), /changed|removed/);
});

test('#441 a minimized Agents at work keeps updating', async (t) => {
  let who = 'developer';
  const o = await explore(t, { agents: () => H.BUSY(who) });
  await setLive(o, true);
  await toggle(o, 'agents');
  assert.equal(expanded(o, 'agents'), 'false');
  who = 'reviewer';
  o.tick(); // the poll
  await settle();
  const p = panel(o.root, 'agents');
  assert.match(text(p), /reviewer · implement/, 'the new agent is in the minimized panel');
  assert.equal(expanded(o, 'agents'), 'false', 'still minimized');
});

test('#441 a minimized replay keeps its position on the timeline', async (t) => {
  const o = await explore(t);
  o.w.ProjectCityAgents.replay('p1', H.REPLAY.runId);
  await settle();
  q(o.root, 'city-replay-play')?.click(); // pause
  await settle();
  const seek = q(o.root, 'city-replay-timeline');
  assert.ok(seek, 'the timeline');
  o.dom.type(seek, '12000');
  await settle();
  await toggle(o, 'replay');
  assert.equal(expanded(o, 'replay'), 'false');
  assert.equal(String(q(o.root, 'city-replay-timeline')?.value ?? ''), '12000');
  await toggle(o, 'replay');
  assert.equal(String(q(o.root, 'city-replay-timeline')?.value ?? ''), '12000');
});

test('#441 the legend closes, a small "Legend" button brings it back with the same rows', async (t) => {
  const o = await explore(t);
  const rows = text(q(o.root, 'project-city-legend'));
  assert.ok(rows.length > 0, 'the legend has rows');
  assert.equal(shownId(o.root, 'city-legend-open'), false, 'no "Legend" button while the legend is open');
  const x = q(o.root, 'city-legend-close');
  assert.ok(x, 'the legend\'s close button');
  x.click();
  await settle();
  assert.equal(shownId(o.root, 'project-city-legend'), false, 'the legend is closed');
  assert.equal(shownId(o.root, 'city-legend-open'), true);
  assert.equal(text(q(o.root, 'city-legend-open')), 'Legend');
  q(o.root, 'city-legend-open').click();
  await settle();
  assert.equal(shownId(o.root, 'project-city-legend'), true, 'the legend is back');
  assert.equal(shownId(o.root, 'city-legend-open'), false);
  assert.equal(text(q(o.root, 'project-city-legend')), rows, 'the same rows');
});

test('#441 the panels\' states are remembered per mode: the release opens again the way it was left, Explore is not changed', async (t) => {
  const o = await explore(t);
  await showRelease(o);
  await toggle(o, 'release');
  q(o.root, 'city-legend-close')?.click();
  await settle();
  await closeMode(o);
  assert.equal(mode(o.root), 'explore');
  assert.equal(shownId(o.root, 'project-city-legend'), true, 'Explore\'s legend stays open');
  assert.equal(expanded(o, 'connections'), 'true', 'Explore\'s panels stay expanded');
  await showRelease(o);
  assert.equal(expanded(o, 'release'), 'false', 'the release card is minimized again');
  assert.equal(shownId(o.root, 'project-city-legend'), false, 'the release\'s legend is closed again');
  assert.equal(shownId(o.root, 'city-legend-open'), true);
});

test('#441 a panel minimized in Explore stays minimized after another mode, and the other mode\'s panel opens expanded', async (t) => {
  const o = await explore(t);
  await toggle(o, 'connections');
  o.w.ProjectCityImpact.showIssue('p1', ISSUE);
  await settle();
  assert.equal(expanded(o, 'impact'), 'true', 'the impact card opens expanded');
  await closeMode(o);
  assert.equal(expanded(o, 'connections'), 'false', 'Most connected is still minimized');
});

test('#441 the states are kept per viewer: a new City view of the same window opens the release the way it was left', async (t) => {
  const o = await explore(t);
  await showRelease(o);
  await toggle(o, 'release');
  await closeMode(o);
  // another project, then this one again: a new City view, the same window's storage
  o.w.ProjectArchitecture.show('p2', o.dom.document.createElement('div'));
  await settle();
  const box = o.dom.document.createElement('div');
  o.dom.document.body.appendChild(box);
  o.w.ProjectArchitecture.show('p1', box);
  await settle();
  o.root = q(box, 'project-city');
  assert.ok(o.root, 'a new City view');
  await showRelease(o);
  assert.equal(expanded(o, 'release'), 'false');
});
