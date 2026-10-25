// #227: an agent's robot painted in its role colour (agent-colors.js), not only a glow.
// - packages/ui-kit/robots.js is a browser IIFE (window.Robots): it is evaluated in a sandbox with a
//   bare `window`. `Robots.svg(variant, state, { color })` paints the body and the shoulder plate in
//   `color`, gives the visor glow a lighter tint of it, and keeps the provider's emblem and the
//   model plaque, so Claude / Codex / Grok stay recognizable.
// - packages/ui-kit/run-list.js (top-level functions only) is evaluated whole in a sandbox: the runs
//   list's progress strip draws each agent's robot in its colour, and a saved look still wins.
// - fronts/plan/views/duo/duo.js: Write & Review's robots, pulled out of the source.
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
const yaml = require('js-yaml');
const AgentColors = require('../agent-colors.js');

const read = (...p) => fs.readFileSync(page(p.join('/')), 'utf8');

function loadRobots() {
  const sandbox = { window: {} };
  vm.createContext(sandbox);
  vm.runInContext(read('robots.js'), sandbox);
  return sandbox.window.Robots;
}
const Robots = loadRobots();

const luma = (h) => { const n = parseInt(h.slice(1), 16); return (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255; };
// the fill of the antennas' glowing tips (the visor glow's colour in the idle state)
const antennaFill = (svg) => /<circle cx="[^"]+" cy="[^"]+" r="9" fill="(#[0-9a-fA-F]{6})"/.exec(svg)?.[1];
// the round shoulder plate
const plateFill = (svg) => /<circle r="32" fill="([^"]+)"/.exec(svg)?.[1];
// an emblem's own artwork, as Robots.emblem draws it alone
const emblemArt = (name) => /<g [^>]*>([\s\S]*)<\/g><\/svg>$/.exec(Robots.emblem(name))[1];
// two renders compared without their unique filter ids
const normal = (svg) => svg.replace(/rb\d+/g, 'rb');

const ORANGE = '#FF8A3D'; // test_writer
const BLUE = '#4C7DFF'; // developer

test('Robots.svg with an agent colour paints the body and the shoulder plate in it, not the brand colour', () => {
  const plain = Robots.svg('claude', 'idle', { bubble: false });
  assert.match(plain, /fill="#D97757"/i, 'the Claude robot without a colour keeps its brand body');
  const painted = Robots.svg('claude', 'idle', { bubble: false, color: ORANGE });
  assert.equal(String(plateFill(painted)).toUpperCase(), ORANGE, 'the shoulder plate takes the agent colour');
  assert.ok(painted.toUpperCase().split(`FILL="${ORANGE}"`).length - 1 >= 2, 'the body box and the plate are both in the agent colour');
  assert.doesNotMatch(painted, /fill="#D97757"/i, 'the brand body colour is gone');
});

test('Robots.svg with an agent colour keeps the provider\'s emblem (chest and plate) for Claude, Codex and Grok', () => {
  for (const [variant, logo] of [['claude', 'spark'], ['gpt', 'knot'], ['grok', 'slash']]) {
    const painted = Robots.svg(variant, 'idle', { bubble: false, color: BLUE });
    assert.equal(String(plateFill(painted)).toUpperCase(), BLUE, `${variant}: plate in the agent colour`);
    const art = emblemArt(logo);
    assert.ok(art.length > 0, `${logo} artwork found`);
    assert.ok(painted.split(art).length - 1 >= 2, `${variant}: the ${logo} emblem is still drawn on the chest and the plate`);
  }
});

test('Robots.svg with an agent colour keeps the model plaque', () => {
  const painted = Robots.svg('claude', 'idle', { bubble: false, color: ORANGE, plaque: 'Opus 5.5' });
  assert.match(painted, />Opus 5\.5<\/text>/);
});

test('Robots.svg with an agent colour gives the visor glow a lighter tint of that colour', () => {
  const painted = Robots.svg('claude', 'idle', { bubble: false, color: BLUE });
  const glow = antennaFill(painted);
  assert.ok(glow, 'the antennas glow in a #RRGGBB colour');
  assert.notEqual(glow.toUpperCase(), '#FFB38A', 'not the Claude brand glow');
  assert.ok(luma(glow) > luma(BLUE), `${glow} is lighter than ${BLUE}`);
  const n = parseInt(glow.slice(1), 16);
  const [r, g, b] = [n >> 16, (n >> 8) & 255, n & 255];
  assert.ok(b >= r && b >= g, `${glow} is a tint of the blue, not another hue`);
});

test('Robots.svg: two Claude agents with different role colours are no longer the same robot', () => {
  const a = Robots.svg('claude', 'idle', { bubble: false, plaque: '', color: ORANGE });
  const b = Robots.svg('claude', 'idle', { bubble: false, plaque: '', color: BLUE });
  assert.notEqual(normal(a), normal(b));
});

// ---------------------------------------------------------------- the runs list's progress strip

function loadRunList({ looks = {}, workflows = [] } = {}) {
  const calls = [];
  const sandbox = {
    console,
    document: { addEventListener() {} },
    Robots,
    AgentColors,
    RunChatModel: { providerType: (p) => ({ claude: 'claude-code', codex: 'codex-cli', grok: 'grok-cli' }[p] || p) },
    AgentLooks: { forWorkflow: (workflow, agent) => looks[`${workflow}/${agent}`] || null },
    state: { workflows, runs: new Map() },
    esc: (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]),
    fmtDur: (ms) => `${Math.round((ms || 0) / 1000)}s`,
    fmtUsd: (n) => `$${(Number(n) || 0).toFixed(2)}`,
    agentLabel: (agent) => agent,
    calls,
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(read('run-list.js'), sandbox);
  return sandbox;
}

const AI_DEV = yaml.load(fs.readFileSync(path.join(__dirname, '..', '..', '..', 'workflows', 'ai-development-local-hero.yaml'), 'utf8'));
const AI_DEV_WF = { file: 'ai-development-local-hero.yaml', name: AI_DEV.name, agents: AI_DEV.agents };
// an agent entry of the progress strip (RunProgress.progressGroups), done
const agentEntry = (step, agent) => ({ agent, steps: [step], provider: 'claude', model: AI_DEV.agents[agent].model, cost: 0.1, durationMs: 1000 });
const doneChip = { status: 'done' };

test('progress strip: each agent\'s robot is painted in its role colour (test writer orange, developer blue)', () => {
  const rl = loadRunList({ workflows: [AI_DEV_WF] });
  const writer = rl.progressAvatar(agentEntry('acceptance_tests', 'test_writer'), doneChip, null, 'ai-development-local-hero.yaml');
  const dev = rl.progressAvatar(agentEntry('develop', 'developer'), doneChip, null, 'ai-development-local-hero.yaml');
  assert.match(writer, /<circle r="32" fill="#FF8A3D"/i, 'the test writer\'s robot has an orange plate');
  assert.match(dev, /<circle r="32" fill="#4C7DFF"/i, 'the developer\'s robot has a blue plate');
});

test('progress strip of an AI Development run: every agent step\'s robot differs from its neighbour\'s', () => {
  const rl = loadRunList({ workflows: [AI_DEV_WF] });
  const steps = [['acceptance_tests', 'test_writer'], ['develop', 'developer'], ['code_review', 'reviewer'], ['build', 'builder'], ['evidence', 'evidence'], ['verify_change', 'verifier']];
  // code_review is a fan-out (#151): its agents include the reviewer
  for (const [step, agent] of steps) {
    const s = AI_DEV.steps.find((x) => x.id === step);
    assert.ok(s?.agent === agent || (s?.agents || []).includes(agent), `${step} is ${agent}'s step`);
  }
  const arts = steps.map(([step, agent]) => normal(rl.progressAvatar(agentEntry(step, agent), doneChip, null, 'ai-development-local-hero.yaml').replace(/ style="[^"]*"| title="[^"]*"/g, '')));
  for (let i = 1; i < arts.length; i++) assert.notEqual(arts[i], arts[i - 1], `${steps[i - 1][0]} and ${steps[i][0]} have the same robot`);
});

test('progress strip: a look saved for the agent in Agents still wins over the role colour', () => {
  const look = Robots.fromAppearance({ body: '#112233', emblem: 'none' }, 'Saved');
  const rl = loadRunList({ workflows: [AI_DEV_WF], looks: { 'ai-development-local-hero.yaml/test_writer': look } });
  const writer = rl.progressAvatar(agentEntry('acceptance_tests', 'test_writer'), doneChip, null, 'ai-development-local-hero.yaml');
  assert.match(writer, /<circle r="32" fill="#112233"/i, 'the saved look\'s body colour');
  assert.doesNotMatch(writer, /fill="#FF8A3D"/i, 'not the role colour');
});

test('progress strip: the avatar\'s tooltip carries a role chip by the agent\'s name', () => {
  const rl = loadRunList({ workflows: [AI_DEV_WF] });
  const writer = rl.progressAvatar(agentEntry('acceptance_tests', 'test_writer'), doneChip, null, 'ai-development-local-hero.yaml');
  assert.match(writer, /class="[^"]*agent-chip[^"]*"[^>]*>test writer</, 'a chip saying "test writer"');
});

// ---------------------------------------------------------------- Write & Review

function loadDuoRobots(looks = {}) {
  const src = read('views', 'duo', 'duo.js');
  const block = /\n  const MIRRORED = [\s\S]*?\n  const avatar = [^\n]+/.exec(src)?.[0];
  assert.ok(block, 'the robots block (MIRRORED … avatar) not found in duo.js: the source moved');
  const sandbox = {
    Robots: { ...Robots, svg: (variant, st, opts) => ({ variant, st, ...opts }) },
    AgentColors,
    state: { workflows: [] },
    window: { AgentLooks: { forWorkflow: (workflow, agent) => looks[`${workflow}/${agent}`] || null } },
    config: {
      writer: { provider: 'claude-code', model: 'claude-opus-5-5' },
      reviewer: { provider: 'claude-code', model: 'claude-opus-5-5' },
      supervisor: { internal: true },
    },
  };
  sandbox.window.AgentColors = AgentColors;
  sandbox.window.Robots = sandbox.Robots;
  vm.createContext(sandbox);
  vm.runInContext(`${block}\nthis.robotSvg = robotSvg;`, sandbox);
  return sandbox.robotSvg;
}

test('Write & Review: the reviewer\'s robot is painted in the reviewer colour', () => {
  const robotSvg = loadDuoRobots();
  assert.equal(String(robotSvg('reviewer').color).toUpperCase(), '#A06BFF');
});

test('Write & Review: a look saved for the reviewer in Agents still wins over the role colour', () => {
  const robotSvg = loadDuoRobots({ 'writer-reviewer/reviewer': 'saved-look' });
  const r = robotSvg('reviewer');
  assert.equal(r.variant, 'saved-look');
  assert.equal(r.color, undefined);
});
