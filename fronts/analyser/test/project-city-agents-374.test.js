// #374, the agents overlay of the City view: fronts/analyser/views/project/project-city-agents.js, a
// classic script (window.ProjectCityAgents) built on #373's overlay API, in a mini DOM without WebGL.
// The contract:
//   ProjectCityAgents.attach(city, { projectId }) → { el, refresh, destroy }
//     city is a ProjectCity.create(...) handle; attach appends `el` (data-testid="city-agents") inside
//     city.el, polls api.architectureAgents({ projectId }) (refresh() polls now and resolves once the
//     answer is drawn) and places it with CityAgents.placeAgents(ProjectCity.current().layout, answer),
//     sets its layer with ProjectCity.overlay(name, spec) (destroy() removes it with
//     ProjectCity.overlay(name, null), stops polling and removes el; a second destroy() does nothing).
//   The HUD: no run in progress → "No agent is working on this project"; otherwise one
//     data-testid="city-agent" entry per robot whose text has "<agent> · <step>", a click on it opens
//     its run with the app's window.showRun(runId); one data-testid="city-collision" per collision with
//     its path and window.ProjectConflictMap.linkHtml(projectId) (data-testid="conflict-map-link").
// The city's main module, project-city.js, does not grow: at most 463 lines.
// The overlay module is created by the change: it is loaded inside each test (tests first).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
// a page file by its page-relative name, in whichever layer holds it (the UI kit, a front, the page folder)
const pageFileOf = (rel) => require('../../../scripts/source-tree').pageFile(path.join(__dirname, '..', '..', '..'), rel);
const vm = require('vm');
const { withI18n } = require('@craftorio/shared/test/i18n-sandbox');
const { createDom } = require('@craftorio/ui-kit/test/mini-dom');
const { buildModel } = require('@craftorio/shared/architecture-model');
const { buildCity } = require('@craftorio/shared/city-model');

const ROOT = path.join(__dirname, '..', '..', '..');
const CITY = pageFileOf('views/project/project-city.js');
const AGENTS = pageFileOf('views/project/project-city-agents.js');
const hash = '11'.repeat(20);
const FILES = [
  { path: 'src/engine/run.js', lines: 100 }, { path: 'src/engine/queue.js', lines: 40 },
  { path: 'src/engine/gates.js', lines: 30 }, { path: 'docs/a.md', lines: 5 },
];
const facts = () => buildModel({
  head: { commit: hash, date: '2026-01-05T12:00:00Z' }, branch: 'main', shallow: false, window: { since: null, until: null },
  files: FILES.map((f) => ({ ...f })), log: `\x01${hash} 2026-01-05T12:00:00Z\n\n${FILES.map((f) => `A\t${f.path}`).join('\n')}\n`,
  ignoreRevs: [], attributes: '', exclude: [], includeMass: true, complexity: null,
});

function load(agentsAnswer) {
  const calls = { agents: [], showRun: [], overlay: [] };
  const sandbox = {
    console, setTimeout, clearTimeout, setInterval, clearInterval, Promise,
    getComputedStyle: () => ({ getPropertyValue: () => '' }),
    localStorage: { getItem: () => null, setItem: () => {} },
    api: {
      architectureCity: async () => ({ state: 'ok', ...buildCity({ plan: null, facts: facts() }) }),
      architectureAgents: async (arg) => { calls.agents.push(JSON.parse(JSON.stringify(arg))); return JSON.parse(JSON.stringify(agentsAnswer)); },
    },
    esc: (s) => String(s ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`),
    errMsg: (e) => String(e?.message || e),
    showRun: (runId) => { calls.showRun.push(String(runId)); },
    ProjectConflictMap: {
      linkHtml: (id) => `<p class="pcm-link small"><button type="button" class="link-btn" data-testid="conflict-map-link" data-pcm-link="${id}">Conflict map: in Projects › fixture</button></p>`,
      onLinkClick: () => false,
    },
  };
  const dom = createDom({ window: sandbox });
  Object.assign(sandbox, { window: sandbox, document: dom.document }, dom.classes);
  dom.classes.Element.prototype.getContext = () => null;
  withI18n(sandbox);
  vm.createContext(sandbox);
  for (const f of ['globs.js', 'json-schema.js', 'architecture-model.js', 'city-model.js', 'city-layout.js', 'city-agents.js']) {
    vm.runInContext(fs.readFileSync(path.join(ROOT, 'packages', 'shared', f), 'utf8'), sandbox, { filename: f });
  }
  for (const f of ['project-city-notes.js', 'project-city-cards.js']) vm.runInContext(fs.readFileSync(path.join(path.dirname(CITY), f), 'utf8'), sandbox, { filename: f });
  vm.runInContext(fs.readFileSync(CITY, 'utf8'), sandbox, { filename: 'project-city.js' });
  const overlay = sandbox.ProjectCity.overlay;
  sandbox.ProjectCity.overlay = (name, spec) => { calls.overlay.push({ name: String(name), spec: spec ? JSON.parse(JSON.stringify(spec)) : null }); return overlay(name, spec); };
  vm.runInContext(fs.readFileSync(AGENTS, 'utf8'), sandbox, { filename: 'project-city-agents.js' });
  return { w: sandbox, calls };
}

const settle = async () => { for (let i = 0; i < 10; i++) await new Promise((r) => setImmediate(r)); };
const q = (el, id) => el.querySelector(`[data-testid="${id}"]`);
const qa = (el, id) => [...el.querySelectorAll(`[data-testid="${id}"]`)];
const text = (el) => String(el?.textContent ?? '').replace(/\s+/g, ' ').trim();

async function open(t, agentsAnswer) {
  const { w, calls } = load(agentsAnswer);
  const city = w.ProjectCity.create({ projectId: 'p1', name: 'fixture-app' });
  w.document.body.appendChild(city.el);
  city.update({ facts: { state: 'ok', model: facts() }, estimate: null });
  await settle();
  const handle = w.ProjectCityAgents.attach(city, { projectId: 'p1' });
  t.after(() => { handle.destroy(); city.destroy(); });
  await handle.refresh();
  await settle();
  return { w, calls, city, handle };
}

const at = (s) => new Date(Date.parse('2026-10-13T10:00:00.000Z') + s * 1000).toISOString();
const BUSY = {
  projectId: 'p1',
  runs: [
    {
      id: 'run-1', colour: '#e4572e',
      agents: [
        { session_id: 's-dev', agent: 'developer', step: 'implement', path: 'src/engine/run.js', kind: 'change', ts: at(5) },
        { session_id: 's-rev', agent: 'reviewer', step: 'code_review', path: 'src/engine/queue.js', kind: 'read', ts: at(6) },
      ],
      trail: ['src/engine/gates.js', 'src/engine/run.js'],
      dirty: ['src/engine/run.js'],
    },
    { id: 'run-2', colour: '#4c9be8', agents: [], trail: ['src/engine/run.js'], dirty: [] },
  ],
  collisions: [{ path: 'src/engine/run.js', runs: ['run-1', 'run-2'] }],
};

test('#374 the City\'s main module does not grow, and the agents overlay has its own file', () => {
  const lines = fs.readFileSync(CITY, 'utf8').replace(/\r?\n$/, '').split(/\r?\n/).length;
  assert.ok(lines <= 463, `project-city.js has ${lines} lines`);
  assert.equal(fs.existsSync(AGENTS), true, 'fronts/analyser/views/project/project-city-agents.js exists');
});

test('#374 City agents: no run in progress says so', async (t) => {
  const { city, calls, handle } = await open(t, { projectId: 'p1', runs: [], collisions: [] });
  assert.deepEqual(calls.agents[0], { projectId: 'p1' });
  const hud = q(city.el, 'city-agents');
  assert.equal(!!hud, true, 'the agents HUD is inside the City view');
  assert.equal(hud === handle.el, true, 'attach returns the HUD as el');
  assert.match(text(hud), /No agent is working on this project/);
  assert.equal(qa(city.el, 'city-agent').length, 0);
  assert.equal(qa(city.el, 'city-collision').length, 0);
});

test('#374 City agents: one entry per agent at work, labelled "<agent> · <step>"', async (t) => {
  const { city } = await open(t, BUSY);
  const hud = q(city.el, 'city-agents');
  assert.doesNotMatch(text(hud), /No agent is working on this project/);
  const entries = qa(city.el, 'city-agent').map(text);
  assert.equal(entries.length, 2, entries.join(' | '));
  assert.equal(entries.filter((s) => s.includes('developer · implement')).length, 1, entries.join(' | '));
  assert.equal(entries.filter((s) => s.includes('reviewer · code_review')).length, 1, entries.join(' | '));
});

test('#374 City agents: a click on an agent opens its run', async (t) => {
  const { city, calls } = await open(t, BUSY);
  const dev = qa(city.el, 'city-agent').find((e) => text(e).includes('developer · implement'));
  assert.equal(!!dev, true, 'the developer\'s entry');
  dev.click();
  assert.deepEqual(calls.showRun, ['run-1']);
});

test('#374 City agents: a building changed by two runs is a collision risk with the Conflict map link', async (t) => {
  const { city } = await open(t, BUSY);
  const rows = qa(city.el, 'city-collision');
  assert.equal(rows.length, 1);
  assert.match(text(rows[0]), /src\/engine\/run\.js/);
  assert.equal(!!q(rows[0], 'conflict-map-link'), true, 'the Conflict map link');
});

test('#374 City agents: the robots go through the overlay API, and destroy removes the layer', async (t) => {
  const { city, calls, handle } = await open(t, BUSY);
  const set = calls.overlay.filter((c) => c.spec);
  assert.ok(set.length > 0, 'ProjectCity.overlay was given a layer');
  assert.match(JSON.stringify(set[set.length - 1].spec), /src\/engine\/run\.js/);
  const name = set[set.length - 1].name;
  handle.destroy();
  assert.equal(calls.overlay.some((c) => c.name === name && c.spec === null), true, 'the layer is removed');
  assert.equal(q(city.el, 'city-agents'), null, 'the HUD is gone');
});
