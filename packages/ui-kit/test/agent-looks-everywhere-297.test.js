// #297 (2-4): an agent's look is the same everywhere.
// - The run's 3D view (packages/ui-kit/run3d/view.js, agentDef): asks window.AgentLooks.forWorkflow(<the
//   run's workflow file without .yaml, or its name>, <agent key>) first. A saved look is drawn as
//   saved (its boxes, colours, eyes and emblem; the role colour is not painted over it); without one,
//   the provider's robot in the agent's role colour (AgentColors.hexFor), as today.
// - The Agents screen (apps/desktop/renderer/views/agents/agents.js): an uncustomised workflow agent's card and
//   the editor's first preview draw the provider's robot painted in its role colour
//   (AgentColors.hexFor(key, the workflow's agents[key])), as the run chat does; a customised one its
//   saved look; the supervisor / Product Owner / Oracle keep their own looks; "Reset look" goes back to
//   the coloured provider robot. The workflow agent card's "View" button reads "Customize look".
//
// Seams (public ones, no internals copied):
// - view.js is an ES module bundled by scripts/build-3d.js (react, three). It is evaluated here in a
//   vm sandbox with its `import` lines dropped and `export` keywords removed, three.js / react stubbed
//   (only Vector3, CanvasTexture, RoundedBoxGeometry and useSyncExternalStore are referenced), and
//   reached through its own exports: begin({ player, workflows }) then agentDef(agentKey).
//   "The robot drawn" is what scene.jsx hands to <Robot>: `variant={def.variant}` and
//   `color={def.<field>}` (the field is read from scene.jsx's source, `color` today, so a developer may
//   move the robot's paint to another field). It is drawn with the real Robots.look (robots.js).
// - agents.js is evaluated whole in a sandbox (window = the sandbox) with the real robots.js and
//   agent-colors.js, a small fake DOM (one fake element per selector) and a fake window.api. The card
//   is reached through window.AgentCards.card (the builder's agent picker uses it too); the editor
//   through the registered view's mount() / show(), a click on the card, and the #btn-ag-reset /
//   #ag-eyes handlers. The robot's colour is read from the drawn SVG: the shoulder plate
//   (`<circle r="32" fill=…>`), as test/renderer-agent-robots.test.js does.
// Every module is loaded inside a test (or a per-test helper), so this file loads before the code exists.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { pageDirs, pageFile, pageFiles } = require('../../../scripts/source-tree');
const PAGE_ROOT = path.join(__dirname, '..', '..', '..');
// a page file by its page-relative name, wherever its layer is (phase 3 of the reorganisation study)
const page = (rel) => pageFile(PAGE_ROOT, rel);
void pageDirs; void pageFiles; void page;
const vm = require('vm');
const { withI18n } = require('@multiagent/shared/test/i18n-sandbox.js');

const RENDERER = path.join(__dirname, '..');
const read = (...p) => fs.readFileSync(path.join(RENDERER, ...p), 'utf8');

const ORANGE = '#FF8A3D'; // test_writer's role colour (agent-colors.js ROLES)
const CUSTOM = '#123456'; // a workflow agent's own `color:` in its YAML
const SAVED = { body: '#112233', shell: '#FDF6E3', visor: '#3B0764', glow: '#4ADE80', eyes: 'arcs', emblem: 'gear' };

// a workflow as api.listWorkflows gives it: its file, its metadata name and its agents' definitions
const WF = {
  file: 'my-flow.yaml',
  name: 'My Flow',
  agents: {
    test_writer: { provider: 'claude', model: 'claude-opus-5-5' },
    my_bot: { provider: 'claude', model: 'claude-opus-5-5', color: CUSTOM },
  },
};

function loadRobots() {
  const sandbox = { window: {}, document: { dispatchEvent() {} }, CustomEvent: class { constructor(type, init) { this.type = type; this.detail = init?.detail; } } };
  vm.createContext(withI18n(sandbox));
  vm.runInContext(read('robots.js'), sandbox);
  return sandbox.window.Robots;
}
const loadAgentColors = () => require(path.join(RENDERER, 'agent-colors.js'));

const plateFill = (svg) => String(/<circle r="32" fill="([^"]+)"/.exec(String(svg))?.[1] || '').toUpperCase();
// an emblem's own artwork, as Robots.emblem draws it alone
const emblemArt = (Robots, name) => /<g [^>]*>([\s\S]*)<\/g><\/svg>$/.exec(Robots.emblem(name))[1];

// ============================================================ the run's 3D view (run3d/view.js)

/** view.js's exports, evaluated in a sandbox with the given window globals. */
function loadView(windowGlobals) {
  let src = read('run3d', 'view.js');
  src = src.replace(/^import [^\n]*\n/gm, '').replace(/^export (function|const|let|class|async function) /gm, '$1 ');
  const names = [...src.matchAll(/^(?:async )?(?:function|const|let|class) (\w+)/gm)].map((m) => m[1]);
  for (const n of ['begin', 'end', 'agentDef']) assert.ok(names.includes(n), `view.js no longer defines ${n}: the module moved`);
  class Vector3 { constructor(x = 0, y = 0, z = 0) { Object.assign(this, { x, y, z }); } normalize() { return this; } copy() { return this; } set() { return this; } }
  const sandbox = {
    THREE: { Vector3, CanvasTexture: class {}, SRGBColorSpace: 'srgb' },
    RoundedBoxGeometry: class { dispose() {} },
    useSyncExternalStore: () => undefined,
    window: { Run3DTheme: { pick: (name) => ({ name: name || 'dark', status: {} }) }, ...windowGlobals },
    console,
  };
  vm.createContext(withI18n(sandbox));
  vm.runInContext(`${src}\nthis.__mod = { ${names.join(', ')} };`, sandbox, { filename: 'run3d/view.js' });
  return sandbox.__mod;
}

/** The robot field scene.jsx paints <Robot> with: `color={def.<field>}`. */
function robotPaintField() {
  const scene = read('run3d', 'scene.jsx');
  const m = /<Robot\s+variant=\{def\.variant\}\s+color=\{def\.(\w+)\}/.exec(scene);
  assert.ok(m, 'scene.jsx no longer draws a workflow agent as <Robot variant={def.variant} color={def.…}>: update this test\'s seam');
  return m[1];
}

/** A 3D view begun on a run of WF with one agent session, and the forWorkflow calls it made. */
function view3d({ looks = {}, agent = 'test_writer', run = { id: 'r1', workflow: WF.name, file: WF.file }, sessionOpen = true } = {}) {
  const Robots = loadRobots();
  const AgentColors = loadAgentColors();
  const calls = [];
  const AgentLooks = {
    // keyed as agents.js keys them: the file without .yaml, and the workflow's name
    forWorkflow: (workflow, a) => { calls.push([String(workflow), String(a)]); return looks[`${workflow}/${a}`] || null; },
  };
  const mod = loadView({ Robots, AgentColors, AgentLooks, RunChatModel: { providerType: (p) => ({ claude: 'claude-code', codex: 'codex-cli', grok: 'grok-cli' }[p] || p) } });
  const session = { name: agent, label: agent.replace(/_/g, ' '), provider: 'claude', model: 'claude-opus-5-5' };
  const model = { run, agents: sessionOpen ? { [agent]: session } : {} };
  const player = { model, subscribe: () => () => {}, notify() {} };
  mod.begin({ player, workflows: [WF] });
  // the agent's session opens (its provider and model become known)
  const openSession = () => { model.agents[agent] = session; };
  const reopen = () => { mod.end(); mod.begin({ player, workflows: [WF] }); };
  return { mod, calls, Robots, AgentColors, looks, openSession, reopen };
}

/** The robot the scene would draw for `def` (Robots.look with the scene's paint field). */
function drawn(Robots, def, field) {
  const paint = def[field];
  return Robots.look(def.variant, 'idle', paint ? { color: paint } : {});
}

test('3D view: agentDef asks AgentLooks.forWorkflow with the run\'s workflow (file without .yaml, or its name) and the agent key', () => {
  const { mod, calls } = view3d();
  mod.agentDef('test_writer');
  const asked = calls.filter(([, a]) => a === 'test_writer').map(([w]) => w);
  assert.ok(asked.length > 0, `agentDef never called window.AgentLooks.forWorkflow(…, 'test_writer'); calls: ${JSON.stringify(calls)}`);
  assert.ok(asked.some((w) => w === 'my-flow' || w === 'My Flow'),
    `forWorkflow was asked with ${JSON.stringify(asked)}, expected 'my-flow' (the file without .yaml) or 'My Flow' (its name)`);
});

test('3D view: a look saved in Agents is the robot drawn (its body, shell, visor, glow, eyes and emblem), not painted in the role colour', () => {
  const field = robotPaintField();
  // what agents.js stores for a saved look: Robots.fromAppearance's variant object
  const savedVariant = loadRobots().fromAppearance(SAVED, 'Saved');
  const looks = { 'my-flow/test_writer': savedVariant, 'My Flow/test_writer': savedVariant };
  const { mod, Robots } = view3d({ looks });
  const def = mod.agentDef('test_writer');
  const v = drawn(Robots, def, field);
  const got = { body: String(v.body).toUpperCase(), head: String(v.head).toUpperCase(), screen: String(v.screen).toUpperCase(), accent: String(v.accent).toUpperCase(), eyes: String(v.eyes), logo: String(v.logo) };
  assert.deepEqual(got, { body: '#112233', head: '#FDF6E3', screen: '#3B0764', accent: '#4ADE80', eyes: 'arcs', logo: 'gear' },
    'the 3D robot is the saved look as saved');
  assert.notEqual(String(def[field] || '').toUpperCase(), ORANGE, `the role colour is not painted over the saved look (def.${field})`);
});

test('3D view: without a saved look, the provider\'s robot painted in the role colour (test writer orange)', () => {
  const field = robotPaintField();
  const { mod, Robots } = view3d();
  const def = mod.agentDef('test_writer');
  assert.equal(typeof def.variant === 'string' ? def.variant : JSON.stringify(def.variant), Robots.variantFor('claude-code', 'claude-opus-5-5'), 'the Claude Code robot');
  assert.equal(String(def[field]).toUpperCase(), ORANGE);
  assert.equal(String(drawn(Robots, def, field).body).toUpperCase(), ORANGE);
});

test('3D view: without a saved look, a workflow\'s own `color:` paints the robot (AgentColors.hexFor(key, def))', () => {
  const field = robotPaintField();
  const { mod } = view3d({ agent: 'my_bot' });
  assert.equal(String(mod.agentDef('my_bot')[field]).toUpperCase(), CUSTOM);
});

test('3D view: a run known only by its workflow\'s name (no file) still draws the look saved under that name', () => {
  const field = robotPaintField();
  const savedVariant = loadRobots().fromAppearance(SAVED, 'Saved');
  const { mod, Robots } = view3d({ looks: { 'My Flow/test_writer': savedVariant }, run: { id: 'r1', workflow: WF.name } });
  const def = mod.agentDef('test_writer');
  assert.equal(String(drawn(Robots, def, field).body).toUpperCase(), '#112233');
  assert.equal(String(drawn(Robots, def, field).logo), 'gear');
});

test('3D view: with a saved look, the role colour still marks the agent\'s desk and chips (def.color)', () => {
  const savedVariant = loadRobots().fromAppearance(SAVED, 'Saved');
  const { mod } = view3d({ looks: { 'my-flow/test_writer': savedVariant, 'My Flow/test_writer': savedVariant } });
  assert.equal(String(mod.agentDef('test_writer').color).toUpperCase(), ORANGE);
});

test('3D view: a robot drawn before its session opened gets the Claude robot once its model is known', () => {
  const { mod, Robots, openSession } = view3d({ sessionOpen: false });
  mod.agentDef('test_writer'); // seen before its session: provider and model unknown
  openSession();
  const def = mod.agentDef('test_writer');
  assert.equal(typeof def.variant === 'string' ? def.variant : JSON.stringify(def.variant), Robots.variantFor('claude-code', 'claude-opus-5-5'));
});

test('3D view: a look saved while the overlay is open shows on the next opening', () => {
  const field = robotPaintField();
  const { mod, Robots, looks, reopen } = view3d();
  assert.equal(String(drawn(Robots, mod.agentDef('test_writer'), field).body).toUpperCase(), ORANGE, 'no look saved yet');
  const savedVariant = loadRobots().fromAppearance(SAVED, 'Saved');
  looks['my-flow/test_writer'] = savedVariant;
  looks['My Flow/test_writer'] = savedVariant;
  reopen();
  assert.equal(String(drawn(Robots, mod.agentDef('test_writer'), field).body).toUpperCase(), '#112233');
});

test('3D view: the HUD draws its robots from the same agentDef as the scene', () => {
  const hud = read('run3d', 'hud.jsx');
  assert.match(hud, /import \{[^}]*\bagentDef\b[^}]*\} from '\.\/view\.js'/, 'hud.jsx imports agentDef from view.js');
  assert.match(hud, /\bagentDef\(agent\)/, 'the HUD\'s robot of an agent is agentDef(agent)');
  assert.match(hud, /window\.Robots\.svg\(def\.variant\b/, 'the HUD draws def.variant (the saved look when there is one)');
});

// ============================================================ the Agents screen (views/agents/agents.js)

const SUPERVISOR_LOOK = { body: '#7C5CFF', shell: '#F4F4F6', visor: '#15161A', glow: '#C9B8FF', eyes: 'dots', emblem: 'none' };
const PO_LOOK = { body: '#0F9F8F', shell: '#F4F4F6', visor: '#15161A', glow: '#9FF5E6', eyes: 'arcs', emblem: 'clipboard' };
const ORACLE_LOOK = { body: '#1E3A8A', shell: '#F4F4F6', visor: '#15161A', glow: '#FCD34D', eyes: 'slits', emblem: 'eye' };

// a workflow agent as packages/engine/domains/agents/agents.js lists it (api.listAgents)
const wfAgent = (key, extra = {}) => ({
  id: `workflow:${WF.file}:${key}`, key, name: key.replace(/_/g, ' '), system: false, readOnly: true,
  workflow: { file: WF.file, name: WF.name }, description: `An agent of the ${WF.name} workflow.`, prompt: '',
  provider: 'claude', providerType: 'claude-code', model: 'claude-opus-5-5', effort: 'high', pickedAtStart: [],
  session: 'persistent', skills: [], capabilities: 'read, edit', steps: ['develop'], appearance: null, updatedAt: null,
  ...extra,
});
const AGENTS = [
  { id: 'supervisor', name: 'Supervisor', system: true, appearance: SUPERVISOR_LOOK, skills: [] },
  { id: 'product-owner', name: 'Product Owner', system: true, appearance: PO_LOOK, model: 'claude-opus-5-5', skills: [] },
  { id: 'oracle', name: 'Oracle', system: true, appearance: ORACLE_LOOK, model: 'claude-opus-5-5', skills: [] },
  wfAgent('test_writer'),
  wfAgent('my_bot'),
];

/** agents.js in a sandbox with a fake DOM: { win, view (its registerView def), el(sel) }. */
function loadAgentsScreen({ agents = AGENTS } = {}) {
  const Robots = loadRobots();
  const AgentColors = loadAgentColors();
  const elements = new Map();
  const unesc = (s) => s.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
  function el(sel) {
    if (elements.has(sel)) return elements.get(sel);
    const set = new Set();
    const e = {
      sel, innerHTML: '', textContent: '', value: '', readOnly: false, disabled: false, scrollTop: 0, dataset: {},
      classList: {
        toggle: (c, force) => { const on = force === undefined ? !set.has(c) : !!force; if (on) set.add(c); else set.delete(c); return on; },
        add: (c) => set.add(c), remove: (c) => set.delete(c), contains: (c) => set.has(c),
      },
      addEventListener() {}, removeEventListener() {}, focus() {}, blur() {}, closest: () => null,
      // the list's cards, from the markup the screen wrote (each `.agent-card` with its data-id)
      querySelectorAll(q) {
        if (q !== '.agent-card') return [];
        return [...String(this.innerHTML).matchAll(/<div class="[^"]*\bagent-card\b[^"]*"[^>]*\bdata-id="([^"]+)"/g)]
          .map((m) => { const card = el(`card:${unesc(m[1])}`); card.dataset = { id: unesc(m[1]) }; return card; });
      },
    };
    elements.set(sel, e);
    return e;
  }
  const defs = [];
  const sandbox = {
    console, Robots, AgentColors,
    CustomEvent: class { constructor(type, init) { this.type = type; this.detail = init?.detail; } },
    document: { querySelector: (sel) => el(sel), addEventListener() {}, dispatchEvent() {}, activeElement: null },
    registerView: (def) => defs.push(def),
    state: { skills: [], workflows: [WF] },
    esc: (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]),
    dateOf: (d) => String(d), errMsg: (e) => String(e?.message || e), showToast() {}, openModal() {}, closeModal() {},
    confirmDialog: async () => false, showWorkflowDefinition() {},
    PoCalibration: {
      bindSlider() {}, sliderHtml: () => '', tooltip: () => '', step: () => ({ name: '' }), DEFAULT: 3,
      cost: { bindSlider() {}, sliderHtml: () => '', tooltip: () => '', step: () => ({ name: '' }), DEFAULT: 3 },
    },
    api: { listAgents: async () => agents, listSkills: async () => [], saveAgent: async () => ({}), createAgent: async () => ({}), removeAgent: async () => ({}) },
  };
  sandbox.window = sandbox;
  vm.createContext(withI18n(sandbox));
  vm.runInContext(fs.readFileSync(page('views/agents/agents.js'), 'utf8'), sandbox, { filename: 'views/agents/agents.js' });
  const view = defs.find((d) => d.id === 'agents');
  assert.ok(view, 'agents.js registers the "agents" view');
  return { win: sandbox, view, el, Robots, agents };
}

const cardOf = (screen, a) => String(screen.win.AgentCards.card(a, { skillIds: new Set(), actions: true }));

/** Opens the editor on agent `id` the way the user does: the Agents screen, then a click on its card. */
async function openEditor(screen, id) {
  screen.view.mount();
  await screen.view.show();
  const card = screen.el('#agents-list').querySelectorAll('.agent-card').find((c) => c.dataset.id === id);
  assert.ok(card, `the Agents screen lists a card for ${id}`);
  assert.equal(typeof card.onclick, 'function', 'the card opens the editor on click');
  await card.onclick({ target: { closest: () => null } });
  return () => String(screen.el('#ag-robot').innerHTML);
}

test('Agents card: an uncustomised workflow agent draws its provider\'s robot painted in its role colour (test writer orange)', () => {
  const screen = loadAgentsScreen();
  const svg = cardOf(screen, wfAgent('test_writer'));
  assert.equal(plateFill(svg), ORANGE, 'the card robot\'s shoulder plate is the test writer\'s orange');
  assert.ok(svg.split(emblemArt(screen.Robots, 'spark')).length - 1 >= 2, 'still the Claude Code robot: its spark emblem on the chest and the plate');
});

test('Agents card: a workflow agent\'s own `color:` (its definition in the workflow) paints the uncustomised robot', () => {
  const screen = loadAgentsScreen();
  assert.equal(plateFill(cardOf(screen, wfAgent('my_bot'))), CUSTOM);
});

test('Agents card: a customised workflow agent draws its saved look unchanged, not the role colour', () => {
  const screen = loadAgentsScreen();
  const svg = cardOf(screen, wfAgent('test_writer', { appearance: SAVED }));
  assert.equal(plateFill(svg), '#112233', 'the saved look\'s main colour');
  assert.doesNotMatch(svg, new RegExp(`fill="${ORANGE}"`, 'i'), 'no part painted in the role colour');
});

test('Agents card: the supervisor, the Product Owner and the Oracle keep their own looks', () => {
  const screen = loadAgentsScreen();
  for (const [a, body] of [[AGENTS[0], '#7C5CFF'], [AGENTS[1], '#0F9F8F'], [AGENTS[2], '#1E3A8A']]) {
    assert.equal(plateFill(cardOf(screen, a)), body, a.id);
  }
});

test('Agents card: a workflow agent\'s button reads "Customize look", not "View"', () => {
  const screen = loadAgentsScreen();
  const html = cardOf(screen, wfAgent('test_writer'));
  const labels = [...html.matchAll(/<button\b[^>]*>([\s\S]*?)<\/button>/g)].map((m) => m[1].replace(/<[^>]+>/g, '').trim());
  assert.ok(labels.includes('Customize look'), `the card's buttons: ${JSON.stringify(labels)}`);
  assert.ok(!labels.includes('View'), `no "View" button any more: ${JSON.stringify(labels)}`);
  const edit = /<button\b[^>]*data-act="edit"[^>]*>([\s\S]*?)<\/button>/.exec(html)?.[1].trim();
  assert.equal(edit, 'Customize look', 'the button that opens the editor (data-act="edit")');
});

test('Agents editor: an uncustomised workflow agent\'s first preview is its provider\'s robot in its role colour', async () => {
  const screen = loadAgentsScreen();
  const preview = await openEditor(screen, wfAgent('test_writer').id);
  assert.equal(plateFill(preview()), ORANGE);
  assert.ok(preview().split(emblemArt(screen.Robots, 'spark')).length - 1 >= 2, 'the Claude Code robot (spark emblem)');
});

test('Agents editor: a customised workflow agent\'s preview is its saved look', async () => {
  const screen = loadAgentsScreen({ agents: [...AGENTS.slice(0, 3), wfAgent('test_writer', { appearance: SAVED })] });
  const preview = await openEditor(screen, wfAgent('test_writer').id);
  assert.equal(plateFill(preview()), '#112233');
});

test('Agents editor: "Reset look" brings a workflow agent back to its provider\'s robot in its role colour', async () => {
  const screen = loadAgentsScreen();
  const preview = await openEditor(screen, wfAgent('test_writer').id);
  // customise: another eye style (the look becomes the editor's own appearance)
  screen.el('#ag-eyes').onclick({ target: { closest: (q) => (q === '[data-eyes]' ? { dataset: { eyes: 'bars' } } : null) } });
  assert.notEqual(plateFill(preview()), ORANGE, 'customised: the editor\'s look, not the role colour');
  screen.el('#btn-ag-reset').onclick();
  assert.equal(plateFill(preview()), ORANGE, 'after Reset look: the role colour again');
  assert.ok(preview().split(emblemArt(screen.Robots, 'spark')).length - 1 >= 2, 'after Reset look: the Claude Code robot again');
});
