// #440, the city map: one mode at a time, each with only the panels its question needs. The whole
// Architecture tab runs in a mini DOM (test/city-modes-harness.js: every renderer city script, the
// shared cores, the app's api faked at its boundary, a fake setInterval registry), and the modes are
// opened through the entry points the app's screens call: ProjectCityImpact.showIssue / showStage
// (Backlog card, Roadmap), ProjectCityRelease.showRelease (Releases), ProjectCityAgents.replay (a run's
// "Replay on the map"), and the Live toggle of Explore.
// The contract these tests set (tests first):
//   - the City root (data-testid="project-city") carries data-city-mode="explore|live|replay|impact|stage|release";
//   - the header's title, data-testid="city-mode-title": the project's name in Explore, "Live",
//     "Replay of <run>", "Issue #<n>", "Stage <name>", "Release <from> → <to>";
//   - data-testid="city-mode-close": no Close in Explore (the tab is where the owner came from); in any
//     other mode it goes back to Explore; Esc (not in full screen) does the same;
//   - each panel's root has data-city-panel="<name>": notes (the notes under the header: problems,
//     "Analyze this project"), connections (Most connected), agents (Agents at work), impact (the
//     issue's or the stage's card), release, replay, legend; a mode shows only its own panels (another
//     mode's are removed or hidden: the `hidden` attribute or class);
//   - Live: data-testid="city-live-toggle" in Explore's header (a checkbox, or a button with
//     aria-pressed), off by default; architecture:agents is not read while it is off; never offered on
//     a release's city (absent, hidden or disabled);
//   - no orphan state: leaving a mode leaves no layer on the city (ProjectCity.overlay(name, null)),
//     no legend row, no card and no poll of that mode.
// Assertions are on primitives only. No real run, no model call.
const test = require('node:test');
const assert = require('node:assert/strict');
const H = require('./city-modes-harness');

const { ISSUE, STAGE, settle, q, shownId, shownPanel, layersOn, isOn, mode, title, legendText } = H;

async function explore(t, opts) {
  const o = await H.openCity(opts);
  assert.ok(o.root, 'the City view is on screen');
  t.after(() => { try { o.w.ProjectArchitecture.show('other', o.dom.document.createElement('div')); } catch { /* the tab is gone */ } });
  return o;
}
const live = (o) => q(o.root, 'city-live-toggle');
async function setLive(o, on) {
  const el = live(o);
  assert.ok(el, 'the Live toggle');
  if (isOn(el) !== on) el.click();
  await settle();
}
const close = async (o) => {
  const btn = q(o.root, 'city-mode-close');
  assert.ok(btn, 'the mode\'s Close');
  btn.click();
  await settle();
};
async function showRelease(o) {
  o.w.ProjectCityRelease.showRelease('p1', { to: '1.1.2' });
  await settle();
}
async function showIssue(o, issue = ISSUE) {
  o.w.ProjectCityImpact.showIssue('p1', issue);
  await settle();
}

test('#440 Explore is the default: its title is the project, its panels are Most connected, the notes and the legend, nothing of another mode', async (t) => {
  const o = await explore(t);
  const { root } = o;
  assert.equal(mode(root), 'explore');
  assert.equal(title(root), 'fixture-app');
  assert.equal(shownId(root, 'city-mode-close'), false, 'no Close in Explore: the tab is where the owner came from');
  assert.equal(shownPanel(root, 'connections'), true, 'Most connected');
  assert.equal(shownPanel(root, 'notes'), true, 'the notes');
  assert.equal(shownId(root, 'project-city-problems'), true, 'the plan\'s real problems');
  assert.equal(shownId(root, 'project-city-analyze'), true, '"Analyze this project"');
  assert.equal(shownId(root, 'project-city-search'), true, 'the search');
  for (const other of ['agents', 'impact', 'release', 'replay']) assert.equal(shownPanel(root, other), false, `no ${other} panel`);
  assert.equal(shownId(root, 'city-agents'), false, 'no Agents at work card');
});

test('#440 Live is off by default: Explore never reads the agents at work, even as time passes', async (t) => {
  const o = await explore(t);
  assert.equal(shownId(o.root, 'city-live-toggle'), true, 'a Live toggle in Explore');
  assert.equal(isOn(live(o)), false, 'off by default');
  o.tick();
  o.tick();
  await settle();
  assert.equal(o.calls.agents.length, 0, 'architecture:agents not read with Live off');
});

test('#440 Live on shows the agents card alone and polls; Live off stops the poll and removes the agents layer', async (t) => {
  const o = await explore(t, { agents: () => H.BUSY() });
  await setLive(o, true);
  assert.equal(mode(o.root), 'live');
  assert.equal(title(o.root), 'Live');
  assert.equal(shownPanel(o.root, 'agents'), true, 'Agents at work');
  assert.equal(shownPanel(o.root, 'connections'), false, 'no Most connected in Live');
  assert.equal(shownId(o.root, 'project-city-problems'), false, 'no plan problems in Live');
  assert.ok(o.calls.agents.length >= 1, 'architecture:agents read');
  assert.deepEqual(layersOn(o.calls), ['agents'], 'the trails on the city');
  await setLive(o, false);
  assert.equal(mode(o.root), 'explore');
  assert.equal(shownPanel(o.root, 'agents'), false, 'the agents card is gone');
  assert.deepEqual(layersOn(o.calls), [], 'no trail left on the city');
  const before = o.calls.agents.length;
  o.tick();
  o.tick();
  await settle();
  assert.equal(o.calls.agents.length, before, 'no poll left running');
});

test('#440 "Show on the map" of an issue opens the impact mode alone: its title, its card, its legend rows, its layer only', async (t) => {
  const o = await explore(t);
  await showIssue(o);
  const { root } = o;
  assert.equal(mode(root), 'impact');
  assert.equal(title(root), 'Issue #375');
  assert.equal(shownId(root, 'city-mode-close'), true, 'a Close');
  assert.equal(shownPanel(root, 'impact'), true, 'the impact card');
  assert.equal(shownId(root, 'city-impact-header'), true);
  assert.match(legendText(root), /Cited in the issue/);
  for (const other of ['connections', 'agents', 'release', 'replay', 'notes']) assert.equal(shownPanel(root, other), false, `no ${other} panel`);
  assert.equal(shownId(root, 'project-city-problems'), false, 'no plan problems');
  assert.deepEqual(layersOn(o.calls), ['impact']);
});

test('#440 closing the impact mode removes its legend rows, its layer and its card, and Explore comes back', async (t) => {
  const o = await explore(t);
  await showIssue(o);
  await close(o);
  const { root } = o;
  assert.equal(mode(root), 'explore');
  assert.equal(title(root), 'fixture-app');
  assert.doesNotMatch(legendText(root), /Cited in the issue|Impact/i, 'no impact row left in the legend');
  assert.deepEqual(layersOn(o.calls), [], 'no impact colour left on the city');
  assert.equal(shownPanel(root, 'impact'), false);
  assert.equal(shownId(root, 'city-impact-header'), false, 'no stale card');
  assert.equal(shownPanel(root, 'connections'), true, 'Most connected is back');
});

test('#440 Esc leaves the impact mode the same way Close does', async (t) => {
  const o = await explore(t);
  await showIssue(o);
  o.dom.keydown(o.dom.document.body, 'Escape');
  await settle();
  assert.equal(mode(o.root), 'explore');
  assert.doesNotMatch(legendText(o.root), /Cited in the issue/);
  assert.deepEqual(layersOn(o.calls), []);
});

test('#440 "Show the stage on the map" opens the stage mode: its title, its conflicts, no row of the issue opened before', async (t) => {
  const o = await explore(t);
  await showIssue(o);
  o.w.ProjectCityImpact.showStage('p1', STAGE);
  await settle();
  const { root } = o;
  assert.equal(mode(root), 'stage');
  assert.match(title(root), /^Stage\b/);
  assert.match(title(root), /Engine fixes/);
  assert.equal(shownId(root, 'city-impact-conflicts'), true);
  assert.equal(shownId(root, 'city-impact-header'), false, 'the issue\'s card is gone');
  assert.doesNotMatch(legendText(root), /Cited in the issue/, 'no row of the issue\'s preview');
  assert.match(legendText(root), /First item/);
  assert.equal(shownPanel(root, 'connections'), false);
});

test('#440 a second "Show on the map" replaces the stage: the issue\'s mode alone, no row of the stage left', async (t) => {
  const o = await explore(t);
  o.w.ProjectCityImpact.showStage('p1', STAGE);
  await settle();
  await showIssue(o);
  const { root } = o;
  assert.equal(mode(root), 'impact');
  assert.equal(title(root), 'Issue #375');
  assert.equal(shownId(root, 'city-impact-stage'), false, 'no stale stage card');
  assert.doesNotMatch(legendText(root), /First item|Second item/);
  assert.deepEqual(layersOn(o.calls), ['impact']);
});

test('#440 the release mode: "Release 1.1.1 → 1.1.2", its card only: no agents, no Most connected, no plan problems, no Analyze, no Live', async (t) => {
  const o = await explore(t);
  await showRelease(o);
  const { root } = o;
  assert.equal(mode(root), 'release');
  assert.equal(title(root), 'Release 1.1.1 → 1.1.2');
  assert.equal(shownPanel(root, 'release'), true, 'the release card');
  assert.equal(shownId(root, 'city-release-header'), true);
  assert.equal(shownPanel(root, 'agents'), false, 'no agents panel');
  assert.equal(shownId(root, 'city-agents'), false, 'no Agents at work card');
  assert.equal(shownPanel(root, 'connections'), false, 'no Most connected');
  assert.equal(shownId(root, 'city-connections'), false, 'no Most connected card');
  // #439: today's notes are gone; the release card keeps only the plan's own problems (the fixture's
  // unknown zone), never a file or a district the base commit lacks
  assert.equal(shownPanel(root, 'notes'), false, 'no notes of today\'s city on a past release');
  const problems = [...root.querySelectorAll('[data-testid="project-city-problems"]')].filter((el) => H.visible(root, el));
  assert.equal(problems.every((el) => H.panel(root, 'release')?.contains(el)), true, 'plan problems only in the release card');
  const said = problems.map(H.text).join(' ');
  assert.doesNotMatch(said, /not in the repository|has no file/, 'no missing file or empty district as a problem on a past release');
  assert.equal(shownId(root, 'project-city-analyze'), false, 'no "Analyze this project"');
  const toggle = live(o);
  assert.equal(!toggle || !shownId(root, 'city-live-toggle') || toggle.disabled === true, true, 'Live is not offered on a release');
  assert.deepEqual(layersOn(o.calls), ['release']);
  o.tick();
  await settle();
  assert.equal(o.calls.agents.length, 0, 'no agents read on a release\'s city');
});

test('#440 a release opened after an impact preview keeps nothing of it: no legend row, no card, no colour', async (t) => {
  const o = await explore(t);
  await showIssue(o);
  await showRelease(o);
  const { root } = o;
  assert.equal(mode(root), 'release');
  assert.doesNotMatch(legendText(root), /Cited in the issue|Impact/i, 'the legend lost the impact\'s rows');
  assert.equal(shownPanel(root, 'impact'), false);
  assert.equal(shownId(root, 'city-impact-header'), false);
  assert.deepEqual(layersOn(o.calls), ['release']);
});

test('#440 Live is never on a past release\'s city: Live on, then a release: no agents card, no poll, no trail', async (t) => {
  const o = await explore(t, { agents: () => H.BUSY() });
  await setLive(o, true);
  await showRelease(o);
  assert.equal(mode(o.root), 'release');
  assert.equal(shownPanel(o.root, 'agents'), false);
  assert.equal(shownId(o.root, 'city-agents'), false);
  assert.deepEqual(layersOn(o.calls), ['release'], 'no agents trail on the release');
  const before = o.calls.agents.length;
  o.tick();
  o.tick();
  await settle();
  assert.equal(o.calls.agents.length, before, 'no agents poll under the release');
});

test('#440 closing the release goes back to Explore: the project\'s city, its title and Most connected, no release layer', async (t) => {
  const o = await explore(t);
  await showRelease(o);
  await close(o);
  const { root } = o;
  assert.equal(mode(root), 'explore');
  assert.equal(title(root), 'fixture-app');
  assert.equal(shownPanel(root, 'release'), false);
  assert.equal(shownPanel(root, 'connections'), true);
  assert.deepEqual(layersOn(o.calls), []);
});

test('#440 "Replay on the map" opens the replay mode alone; Close leaves no timeline, no trail and no tick reading the agents', async (t) => {
  const o = await explore(t);
  o.w.ProjectCityAgents.replay('p1', H.REPLAY.runId);
  await settle();
  const { root } = o;
  assert.equal(mode(root), 'replay');
  assert.match(title(root), /^Replay of\b/);
  assert.equal(shownPanel(root, 'replay'), true, 'the replay panel');
  assert.equal(shownId(root, 'city-replay-timeline'), true, 'the timeline');
  assert.equal(shownId(root, 'city-replay-play'), true, 'play / pause');
  assert.equal(shownPanel(root, 'connections'), false);
  assert.equal(shownId(root, 'project-city-problems'), false);
  await close(o);
  assert.equal(mode(root), 'explore');
  assert.equal(shownId(root, 'city-replay-timeline'), false, 'no stale timeline');
  assert.deepEqual(layersOn(o.calls), [], 'no trail left');
  const before = o.calls.agents.length;
  o.tick();
  o.tick();
  await settle();
  assert.equal(o.calls.agents.length, before, 'Live stays off after the replay: nothing polls');
});

// An entry point called from another screen no longer navigates (#430): it opens the city in a modal
// over that screen, and its Close leaves the screen as it was (test/project-city-modal-430.test.js).

// Esc belongs to what is on top: an open modal, the supervisor's drawer or the usage popover closes
// first (app.js), the city's mode stays.
for (const [what, html] of [
  ['a modal', '<div class="modal" role="dialog"></div>'],
  ['the supervisor\'s drawer', '<div id="sup-drawer" class="open"></div>'],
  ['the usage popover', '<div id="usage-pop"></div>'],
]) {
  test(`#440 Esc with ${what} open does not close the city's mode`, async (t) => {
    const o = await explore(t);
    await showIssue(o);
    const layer = o.dom.document.createElement('div');
    layer.innerHTML = html;
    o.dom.document.body.appendChild(layer);
    o.dom.keydown(o.dom.document.body, 'Escape');
    await settle();
    assert.equal(mode(o.root), 'impact', 'the issue\'s impact is still on screen');
    assert.match(legendText(o.root), /Cited in the issue/);
  });
}
