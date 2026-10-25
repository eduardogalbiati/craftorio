// #428, the impact card in the City view's left column (apps/desktop/renderer/views/project/project-city-impact.js,
// project-city-impact.css, project-city-notes.js), in a mini DOM without WebGL next to the city's own
// scripts with the app's api faked at its boundary (as test/project-city-impact-show-375.test.js):
//   - the card (data-testid="city-impact") opens at the top of the left column, where the notes
//     (.pc-notes) start, the notes below it: the card is a preceding sibling of .pc-notes, or the first
//     thing inside it; it keeps its Close; its CSS is no longer centred (no left: 50% / translateX(-50%))
//     and it still scrolls when long;
//   - the Arcs note (project-city-edges) is gone with its catalog keys project_city_notes.arcs and
//     project_city_notes.hovering_those_files_draws_no_arc, in every language of packages/shared/i18n/;
//   - a stage with no building changed by two items: its data-testid="city-impact-conflicts" is one
//     muted line (a class with "muted", not the classes of the red box, only "No building is changed
//     by two items."); the red box stays for real conflicts;
//   - a run of the project in progress for an item of the stage: the stage card has
//     data-testid="city-impact-in-progress" naming the item ("In progress: #421 + #425 + #422") with the
//     run's colour (architecture:agents' runs[].colour) in its markup.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { withI18n } = require('@multiagent/shared/test/i18n-sandbox');
const { createDom } = require('./mini-dom');
const { buildModel } = require('@multiagent/shared/architecture-model');
const { buildCity } = require('@multiagent/shared/city-model');

const ROOT = path.join(__dirname, '..', '..', '..');
const DIR = path.join(ROOT, 'apps', 'desktop', 'renderer', 'views', 'project');
const hash = '42'.repeat(20);
const FILES = [
  { path: 'src/engine/run.js', lines: 100 }, { path: 'src/engine/queue.js', lines: 40 },
  { path: 'src/engine/gates.js', lines: 30 }, { path: 'docs/a.md', lines: 5 },
];
const facts = () => buildModel({
  head: { commit: hash, date: '2026-01-05T12:00:00Z' }, branch: 'main', shallow: false, window: { since: null, until: null },
  files: FILES.map((f) => ({ ...f })), log: `\x01${hash} 2026-01-05T12:00:00Z\n\n${FILES.map((f) => `A\t${f.path}`).join('\n')}\n`,
  ignoreRevs: [], attributes: '', exclude: [], includeMass: true, complexity: null,
});

const ISSUE = { number: 428, title: 'The card on the left', body: 'Change `src/engine/run.js` and src/engine/queue.js.', runs: [] };
const LIVE_COLOUR = '#e4572e';
const NO_RUN = () => ({ projectId: 'p1', runs: [], collisions: [] });

function load({ agents = NO_RUN } = {}) {
  const sandbox = {
    console, setTimeout, clearTimeout, setInterval, clearInterval, Promise,
    getComputedStyle: () => ({ getPropertyValue: () => '' }),
    localStorage: { getItem: () => null, setItem: () => {} },
    api: {
      architectureCity: async () => ({ state: 'ok', ...buildCity({ plan: null, facts: facts() }) }),
      architectureImpact: async () => ({ plan: null, history: {}, error: null }),
      architectureAgents: async () => JSON.parse(JSON.stringify(agents())),
      productOwnerHistory: async () => [],
      getBacklog: async () => ({ issues: [] }),
      runDiff: async () => ({ files: [] }),
    },
    esc: (s) => String(s ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`),
    errMsg: (e) => String(e?.message || e),
    showRun: () => {},
  };
  const dom = createDom({ window: sandbox });
  Object.assign(sandbox, { window: sandbox, document: dom.document }, dom.classes);
  dom.classes.Element.prototype.getContext = () => null;
  withI18n(sandbox);
  vm.createContext(sandbox);
  for (const f of ['globs.js', 'json-schema.js', 'architecture-model.js', 'city-model.js', 'city-layout.js', 'city-agents.js', 'city-impact.js', 'roadmap-model.js']) {
    vm.runInContext(fs.readFileSync(path.join(ROOT, 'packages', 'shared', f), 'utf8'), sandbox, { filename: f });
  }
  for (const f of ['project-city-modes.js', 'project-city-panels.js', 'project-city-notes.js', 'project-city-cards.js', 'project-city.js', 'project-city-impact.js']) {
    vm.runInContext(fs.readFileSync(path.join(DIR, f), 'utf8'), sandbox, { filename: f });
  }
  return sandbox;
}

const settle = async () => { for (let i = 0; i < 10; i++) await new Promise((r) => setImmediate(r)); };
const q = (el, id) => el?.querySelector(`[data-testid="${id}"]`) || null;
const text = (el) => String(el?.textContent ?? '').replace(/\s+/g, ' ').trim();

async function open(t, opts) {
  const w = load(opts);
  const city = w.ProjectCity.create({ projectId: 'p1', name: 'fixture-app' });
  w.document.body.appendChild(city.el);
  city.update({ facts: { state: 'ok', model: facts() }, estimate: null });
  await settle();
  const handle = w.ProjectCityImpact.attach(city, { projectId: 'p1' });
  t.after(() => { handle.destroy(); city.destroy(); });
  return { w, city, handle };
}

const stage = (items) => ({ name: 'Engine fixes', items });
const NO_CONFLICT = stage([
  { id: 'a', number: 1, title: 'First', body: 'Edit `src/engine/run.js`' },
  { id: 'b', number: 2, title: 'Second', body: 'Edit `docs/a.md`' },
]);
const CONFLICT = stage([
  { id: 'a', number: 1, title: 'First', body: 'Edit `src/engine/run.js`' },
  { id: 'b', number: 2, title: 'Second', body: 'Edit `src/engine/run.js`' },
]);

test('#428 the impact card opens at the top of the left column, the notes below it', async (t) => {
  const { city, handle } = await open(t);
  await handle.show({ issue: ISSUE });
  await settle();
  const card = q(city.el, 'city-impact');
  const notes = city.el.querySelector('.pc-notes');
  assert.equal(card === null, false, 'the card');
  assert.equal(notes === null, false, 'the notes (no plan yet)');
  const kids = (el) => (el?.parentNode ? [...el.parentNode.children] : []);
  // a sibling right before the notes, in their column
  const before = card.parentNode === notes.parentNode && kids(card).indexOf(card) < kids(notes).indexOf(notes);
  // or the first thing of the notes, before every note
  const firstNote = notes.querySelector('.pc-note');
  const inside = notes.contains(card) && (!firstNote || !card.contains(firstNote)) && (() => {
    const all = [...notes.querySelectorAll('*')];
    return !firstNote || all.indexOf(card) < all.indexOf(firstNote);
  })();
  assert.equal(before || inside, true, 'the card is in the notes\' column, above them');
});

test('#428 the card keeps its Close in the left column', async (t) => {
  const { city, handle } = await open(t);
  await handle.show({ issue: ISSUE });
  await settle();
  const close = q(q(city.el, 'city-impact'), 'city-impact-close');
  assert.equal(close === null, false, 'its Close');
  assert.equal(close.localName, 'button');
});

test('#428 the card\'s CSS is no longer centred over the city and it still scrolls when long', () => {
  const css = fs.readFileSync(path.join(DIR, 'project-city-impact.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const rules = [...css.matchAll(/([^{}]*\.pci\b[^{},]*)\{([^}]*)\}/g)].filter((m) => /\.pci\s*$/.test(m[1].trim())).map((m) => m[2]);
  assert.notEqual(rules.length, 0, 'a rule for the card (.pci)');
  const all = rules.join(';');
  assert.doesNotMatch(all, /translateX\(\s*-50%\s*\)/, 'no translateX(-50%)');
  assert.doesNotMatch(all, /(^|[;\s])left\s*:\s*50%/, 'no left: 50%');
  assert.match(all, /overflow(-y)?\s*:\s*auto/, 'it scrolls when long');
});

test('#428 the Arcs note\'s catalog keys are gone from every language', () => {
  const dir = path.join(ROOT, 'packages', 'shared', 'i18n');
  const left = fs.readdirSync(dir).filter((f) => f.endsWith('.json')).flatMap((f) => {
    const cat = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
    return ['project_city_notes.arcs', 'project_city_notes.hovering_those_files_draws_no_arc'].filter((k) => k in cat).map((k) => `${f} ${k}`);
  });
  assert.deepEqual(left, []);
});

test('#428 a stage with no building changed by two items shows one muted line, not the red box', async (t) => {
  const { city, handle } = await open(t);
  await handle.show({ stage: CONFLICT });
  await settle();
  const red = String(q(city.el, 'city-impact-conflicts')?.className ?? '');
  await handle.show({ stage: NO_CONFLICT });
  await settle();
  const line = q(city.el, 'city-impact-conflicts');
  assert.equal(line === null, false, 'data-testid="city-impact-conflicts"');
  assert.equal(text(line), 'No building is changed by two items.', 'one line, no "Changed by two items" heading');
  assert.match(String(line.className), /muted/, 'a muted class');
  assert.notEqual(String(line.className), red, 'not the red box\'s classes');
});

test('#428 a real conflict keeps the red box with its heading and the building', async (t) => {
  const { city, handle } = await open(t);
  await handle.show({ stage: CONFLICT });
  await settle();
  const box = q(city.el, 'city-impact-conflicts');
  assert.equal(box === null, false, 'the conflicts block');
  assert.match(text(box), /^Changed by two items/);
  assert.match(text(box), /src\/engine\/run\.js/);
  assert.doesNotMatch(String(box.className), /muted/);
});

test('#428 while a run of the project is in progress, the stage card names it with the run\'s colour', async (t) => {
  const agents = () => ({
    projectId: 'p1',
    runs: [{ id: 'run-live', workflow: 'software-development', colour: LIVE_COLOUR, issues: [421, 425, 422], agents: [], trail: [], dirty: [] }],
    collisions: [],
  });
  const { city, handle } = await open(t, { agents });
  await handle.show({ stage: stage([
    {
      id: 'it1', number: 421, title: '#421 + #425 + #422', body: 'Edit `src/engine/run.js`',
      issues: [{ number: 421 }, { number: 425 }, { number: 422 }],
      runs: [{ runId: 'run-live', status: 'running', mock: false }],
    },
    { id: 'it2', number: 430, title: '#430', body: 'Edit `docs/a.md`', runs: [] },
  ]) });
  await settle();
  const line = q(city.el, 'city-impact-in-progress');
  assert.equal(line === null, false, 'data-testid="city-impact-in-progress" on the stage card');
  assert.match(text(line), /In progress: #421 \+ #425 \+ #422/);
  assert.equal(String(line.outerHTML).includes(LIVE_COLOUR), true, 'the run\'s colour');
});

test('#428 with no run of the project in progress, the stage card has no "In progress" line', async (t) => {
  const { city, handle } = await open(t);
  await handle.show({ stage: NO_CONFLICT });
  await settle();
  assert.equal(q(city.el, 'city-impact-in-progress') === null, true);
  assert.doesNotMatch(text(q(city.el, 'city-impact-stage')), /In progress/);
});
