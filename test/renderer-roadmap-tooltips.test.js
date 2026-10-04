// #236: no native `title` tooltips on the Roadmap's run progress (src/renderer/views/backlog/
// backlog-roadmap.js: the ring .rm-ring, the current step .rm-progress-text, the steps popover
// .rm-steps with its chips .rm-chip) nor on the progress strip's agent cards (src/renderer/run-list.js:
// .rp-av / .rp-card, .rp-state, .rp-more, .rp-skip): the run summary the ring's tooltip held moves into
// the popover, the "Open the run at <step>" hint into an aria-label.
// backlog-roadmap.js is loaded whole like test/renderer-backlog-roadmap-view.test.js, but with the
// REAL run-list.js chips and avatars (evaluated in their own sandbox as in
// test/renderer-agent-robots.test.js) instead of stubs, so the popover's markup is the real one.
// Not unit-testable here: the popover's on-screen positioning and flipping near the window's edges.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const AgentColors = require('../src/renderer/agent-colors.js');

const R = path.join(__dirname, '..', 'src', 'renderer');
const read = (...p) => fs.readFileSync(path.join(R, ...p), 'utf8');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const text = (html) => String(html).replace(/<[^>]*>/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\s+/g, ' ');
const titles = (html) => String(html).match(/\stitle="[^"]*"/g) || [];

function loadRobots() {
  const sandbox = { window: {} };
  vm.createContext(sandbox);
  vm.runInContext(read('robots.js'), sandbox);
  return sandbox.window.Robots;
}

function loadRunList() {
  const sandbox = {
    console,
    document: { addEventListener() {} },
    Robots: loadRobots(),
    AgentColors,
    RunChatModel: { providerType: (p) => ({ claude: 'claude-code', codex: 'codex-cli', grok: 'grok-cli' }[p] || p) },
    AgentLooks: { forWorkflow: () => null },
    state: { workflows: [], runs: new Map() },
    esc,
    fmtDur: (ms) => `${Math.round((ms || 0) / 1000)}s`,
    fmtUsd: (n) => `$${(Number(n) || 0).toFixed(2)}`,
    agentLabel: (agent) => agent,
    requestAnimationFrame: () => 0,
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(read('run-progress-model.js'), sandbox);
  vm.runInContext(read('run-list.js'), sandbox);
  // PERSON_SVG / ENGINE_SVG are top-level consts: script-scoped, read through the context
  sandbox.PERSON = vm.runInContext('PERSON_SVG', sandbox);
  sandbox.ENGINE = vm.runInContext('ENGINE_SVG', sandbox);
  return sandbox;
}

function loadRoadmap() {
  const rl = loadRunList();
  const store = new Map();
  const sandbox = {
    esc,
    state: {},
    errMsg: (e) => String(e?.message || e),
    devMode: () => false,
    confirmDialog: async () => true,
    keptWorkDialog: async () => null,
    choiceDialog: async () => null,
    fmtDur: (ms) => (ms == null ? 'unknown' : `${Math.round(ms / 1000)}s`),
    robotAvatar: (...a) => rl.robotAvatar(...a),
    agentLabel: (agent) => agent,
    PERSON_SVG: rl.PERSON,
    ENGINE_SVG: rl.ENGINE,
    progressChip: (...a) => rl.progressChip(...a),
    ChainModel: { chainBadgesHtml: () => '' },
    scheduleRender: () => {},
    markdownHtml: (s) => esc(s),
    localStorage: { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) },
    document: { querySelector: () => null, querySelectorAll: () => [] },
    api: {
      listWorkflows: async () => [],
      saveRoadmap: async (projectId, stages) => ({ roadmap: { state: 'planned', stages } }),
      startRoadmap: async () => ({ roadmap: { state: 'running', stages: [] } }),
      roadmapItem: async () => ({ roadmap: { state: 'planned', stages: [] } }),
      setRoadmapLive: async () => ({ roadmap: { state: 'running', stages: [] } }),
    },
  };
  sandbox.setTimeout = setTimeout;
  sandbox.clearTimeout = clearTimeout;
  sandbox.window = sandbox;
  sandbox.window.showRun = () => {};
  vm.createContext(sandbox);
  vm.runInContext(read('run-progress-model.js'), sandbox);
  vm.runInContext(read('default-workflow.js'), sandbox);
  vm.runInContext(read('workflow-inputs.js'), sandbox);
  if (fs.existsSync(path.join(R, 'estimates.js'))) vm.runInContext(read('estimates.js'), sandbox);
  vm.runInContext(read('views', 'backlog', 'backlog-roadmap.js'), sandbox);
  return sandbox.window.BacklogRoadmap;
}

// a run in progress at Review, after Develop and a human gate (Check)
const runningItem = () => ({
  id: 'it1', status: 'running', runId: 'run-42', workflow: 'w.yaml', inputs: {}, issues: [{ number: 1, title: 'Login page', url: 'https://github.com/o/r/issues/1' }],
  run: {
    status: 'running', mock: false, startedAt: '2026-10-03T10:00:00.000Z', workflow: 'w.yaml',
    progress: [
      { step: 'develop', status: 'done', ts: '2026-10-03T10:00:00.000Z', durationMs: 60000, agents: [{ agent: 'developer', provider: 'claude', model: 'claude-sonnet-5', cost: 0.5, durationMs: 60000 }] },
      { step: 'human_review', status: 'done', type: 'human_approval', ts: '2026-10-03T10:01:00.000Z', durationMs: 30000, agents: [] },
      { step: 'code_review', status: 'running', ts: '2026-10-03T10:02:00.000Z', agents: [{ agent: 'reviewer', provider: 'claude', model: 'claude-sonnet-5' }] },
    ],
    groups: [{ name: 'Develop', steps: ['develop'] }, { name: 'Check', steps: ['human_review'] }, { name: 'Review', steps: ['code_review'] }],
    stepTimes: {}, history: 0,
  },
});

function progressMarkup() {
  const html = loadRoadmap().html({ roadmap: { state: 'running', stages: [{ id: 'st1', name: '', note: '', items: [runningItem()] }] }, issues: [] }, () => {}, { showAll: true });
  const start = html.indexOf('class="rm-progress');
  assert.ok(start >= 0, 'the run\'s progress ring is rendered');
  const meta = html.indexOf('class="rm-meta"', start);
  const block = html.slice(start, meta < 0 ? undefined : meta);
  const stepsAt = block.indexOf('class="rm-steps"');
  assert.ok(stepsAt >= 0, 'the steps popover (.rm-steps) is rendered');
  return { block, steps: block.slice(block.lastIndexOf('<', stepsAt)) };
}

test('#236 the roadmap ring (.rm-ring) and the current step text (.rm-progress-text) carry no title attribute', () => {
  const { block } = progressMarkup();
  const ring = /<button\b[^>]*class="rm-ring"[^>]*>/.exec(block)?.[0];
  const step = /<div\b[^>]*class="rm-progress-text"[^>]*>/.exec(block)?.[0];
  assert.ok(ring, 'the ring is rendered');
  assert.ok(step, 'the current step text is rendered');
  assert.doesNotMatch(ring, /\stitle=/);
  assert.doesNotMatch(step, /\stitle=/);
});

test('#236 the run summary the ring\'s tooltip held (elapsed time, run id) is inside the steps popover (.rm-steps)', () => {
  const { steps } = progressMarkup();
  const t = text(steps);
  assert.match(t, /Elapsed/);
  assert.match(t, /run-42/);
});

test('#236 nothing inside the steps popover carries a title: step chips, their state line, the agents\' robots and the human\'s avatar', () => {
  const { steps } = progressMarkup();
  assert.match(steps, /class="rm-chip"/, 'the step chips are in the popover');
  assert.deepEqual(titles(steps), []);
});

test('#236 each step chip keeps its "Open the run at <step>" hint as an aria-label (or visible text), not a title', () => {
  const { steps } = progressMarkup();
  const chips = steps.match(/<button\b[^>]*class="rm-chip"[^>]*>/g) || [];
  assert.equal(chips.length, 3);
  const noTitles = steps.replace(/\stitle="[^"]*"/g, '');
  for (const name of ['Develop', 'Check', 'Review']) assert.ok(noTitles.includes(`Open the run at ${name}`), `the hint for ${name} is kept outside a title`);
});

// ---- run-list.js: the progress strip's agent cards ----------------------------------------------

const agentEntry = (agent, step) => ({ agent, steps: [step], provider: 'claude', model: 'claude-sonnet-5', human: false, cost: 0.1, durationMs: 1000 });

test('#236 a progress chip (run-list progressChip) with a human gate and more than four agents carries no title: not on .rp-state, a robot (.rp-av), the human avatar or the "+N" more badge', () => {
  const rl = loadRunList();
  const chip = {
    name: 'Review', grouped: true, round: 1, status: 'running', current: 'code_review',
    steps: [{ step: 'code_review' }, { step: 'human_review' }],
    agents: [
      { agent: 'You', human: true, steps: ['human_review'], cost: 0, durationMs: 30000 },
      agentEntry('reviewer', 'code_review'), agentEntry('security', 'code_review'), agentEntry('tester', 'code_review'),
      agentEntry('builder', 'code_review'), agentEntry('verifier', 'code_review'),
    ],
  };
  const html = rl.progressChip(chip, null, 'w.yaml');
  assert.match(html, /class="rp-state"/);
  assert.match(html, /rp-more/);
  assert.deepEqual(titles(html), []);
});

test('#236 the human gate\'s avatar keeps what its tooltip said ("You (human gate)") in an aria-label or its card, not in a title', () => {
  const rl = loadRunList();
  const html = rl.progressAvatar({ agent: 'You', human: true, steps: ['human_review'], cost: 0, durationMs: 30000 }, { status: 'done' }, null, 'w.yaml');
  assert.deepEqual(titles(html), []);
  assert.match(html, /You \(human gate\)/);
});

test('#236 the run list\'s progress strip (runProgressStrip) carries no title, the "+N" of the skipped early steps included', () => {
  const rl = loadRunList();
  const steps = Array.from({ length: 10 }, (_, n) => ({ step: `step_${n + 1}`, status: 'done', agents: [{ agent: 'developer', provider: 'claude', model: 'claude-sonnet-5' }] }));
  const html = rl.runProgressStrip({ runId: 'run-7', current: false, status: 'success', progress: steps, groups: [], workflow: 'w.yaml' });
  assert.match(html, /\+2/, 'the two earliest steps are folded into "+2"');
  assert.deepEqual(titles(html), []);
});
