// #236: no native `title` tooltips where the app shows its own card: the Roadmap's stations (fronts/build/
// views/backlog/backlog-roadmap.js: each has the hover card of who worked there) and the progress strip's
// agent cards (packages/ui-kit/run-list.js: .rp-av / .rp-card, .rp-state, .rp-more, .rp-skip). The run summary
// the ring's tooltip held is the open row's folded summary, the "Open the run at <step>" hint an aria-label.
// Since the lanes of 2026-11-27 the ring has no popover: the Progress cell's one title says the exact figures.
// backlog-roadmap.js is loaded whole like test/renderer-backlog-roadmap-view.test.js, but with the
// REAL run-list.js chips and avatars (evaluated in their own sandbox as in
// test/renderer-agent-robots.test.js) instead of stubs, so the popover's markup is the real one.
// Not unit-testable here: the popover's on-screen positioning and flipping near the window's edges.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
// a page file by its page-relative name, in whichever layer holds it (the UI kit, a front, the page folder)
const pageFileOf = (rel) => require('../../../scripts/source-tree').pageFile(path.join(__dirname, '..', '..', '..'), rel);
const vm = require('vm');
const { withI18n } = require('@craftorio/shared/test/i18n-sandbox.js');
const AgentColors = require('@craftorio/ui-kit/agent-colors.js');

const read = (...p) => fs.readFileSync(pageFileOf(p.join('/')), 'utf8');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const text = (html) => String(html).replace(/<[^>]*>/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\s+/g, ' ');
const titles = (html) => String(html).match(/\stitle="[^"]*"/g) || [];

function loadRobots() {
  const sandbox = { window: {} };
  vm.createContext(withI18n(sandbox));
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
  vm.createContext(withI18n(sandbox));
  vm.runInContext(read('status-pill.js'), sandbox);
  vm.runInContext(read('..', '..', '..', 'packages', 'shared', 'run-progress-model.js'), sandbox);
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
  vm.createContext(withI18n(sandbox));
  vm.runInContext(read('status-pill.js'), sandbox);
  vm.runInContext(read('..', '..', '..', 'packages', 'shared', 'run-progress-model.js'), sandbox);
  vm.runInContext(read('..', '..', '..', 'packages', 'shared', 'default-workflow.js'), sandbox);
  vm.runInContext(read('..', '..', '..', 'packages', 'shared', 'roadmap-model.js'), sandbox); // the real RoadmapModel (#349)
  vm.runInContext(read('..', '..', '..', 'packages', 'shared', 'run-inputs.js'), sandbox);
  vm.runInContext(read('workflow-inputs.js'), sandbox);
  if (fs.existsSync(pageFileOf('estimates.js'))) vm.runInContext(read('estimates.js'), sandbox);
  vm.runInContext(read('menu.js'), sandbox); // the shared menu (#748)
  vm.runInContext(read('views', 'backlog', 'backlog-roadmap-meters.js'), sandbox); // the meters, the timer and the Progress cell (split out on 2026-11-27)
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
  const at = html.indexOf('data-testid="roadmap-item"');
  assert.ok(at >= 0, 'the run\'s row is rendered');
  // the row with its open panel: from its opening tag to the end of its group
  const row = html.slice(html.lastIndexOf('<', at), html.indexOf('</section>', at));
  const where = (id) => { const k = row.indexOf(`data-testid="${id}"`); assert.ok(k >= 0, `${id} is rendered`); return k; };
  // the lane: from its opening tag to the Progress cell after it; the summary: its folded block in the open row
  const pipeline = row.slice(row.lastIndexOf('<', where('roadmap-pipeline')), row.lastIndexOf('<', where('roadmap-status')));
  const steps = row.slice(row.lastIndexOf('<details', where('roadmap-run-summary')), row.indexOf('</details>', where('roadmap-run-summary')));
  return { row, steps, pipeline };
}

test('#236 the roadmap ring (.rm-ring) and the current step carry no title of their own; the Progress cell around the ring has one, its name: the exact figures', () => {
  const { row } = progressMarkup();
  const ring = /<span\b[^>]*class="rm-ring[^"]*"[^>]*>/.exec(row)?.[0];
  const step = /<span\b[^>]*data-testid="roadmap-progress-step"[^>]*>/.exec(row)?.[0];
  assert.ok(ring, 'the ring is rendered');
  assert.ok(step, 'the current step is rendered');
  assert.doesNotMatch(ring, /\stitle=/);
  assert.doesNotMatch(step, /\stitle=/);
  const cell = /<div class="rm-cell-progress" role="img" data-testid="roadmap-status" aria-label="([^"]*)" title="([^"]*)">/.exec(row);
  assert.ok(cell, 'the Progress cell is rendered');
  assert.equal(cell[1], cell[2]);
  assert.match(cell[1], /^Progress \d+%/);
});

test('#236 the run summary the ring\'s tooltip held (elapsed time, run id) is in the open row, folded', () => {
  const { steps } = progressMarkup();
  const t = text(steps);
  assert.match(t, /Elapsed/);
  assert.match(t, /run-42/);
});

test('#236 nothing inside the run\'s summary or the lane carries a title: stations, their glyphs, the agents\' robots and the human\'s avatar', () => {
  const { steps, pipeline } = progressMarkup();
  assert.match(pipeline, /data-testid="roadmap-station"/, 'the stations are in the lane');
  assert.doesNotMatch(steps, /data-rm-chip/, 'no step strip in the summary');
  assert.deepEqual(titles(steps), []);
  assert.deepEqual(titles(pipeline), []);
});

test('#236 the station the run is at keeps its "Open the run at <step>" hint as an aria-label, not a title; the others are named with their state', () => {
  const { pipeline } = progressMarkup();
  const chips = pipeline.match(/<button\b[^>]*data-rm-chip="[^"]*"[^>]*>/g) || [];
  assert.equal(chips.length, 1);
  assert.match(chips[0], /aria-label="Open the run at Review \(running\)"/);
  for (const name of ['Develop', 'Check']) assert.ok(pipeline.includes(`aria-label="${name}: done"`), `${name} is named with its state`);
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

// #236 (reviewer): the agent card / steps popover placement (run-list.js placePopover) with stubbed
// rects: a 400x300 window, a 6px edge margin. `pop` measures `w` x `h` wherever it is put.
function place({ anchor, w, h, opts, vw = 400, vh = 300 }) {
  const rl = loadRunList();
  rl.document.documentElement = { clientWidth: vw, clientHeight: vh };
  const pop = { style: {}, getClientRects: () => [1], getBoundingClientRect: () => ({ width: w, height: h }) };
  const a = { getBoundingClientRect: () => ({ ...anchor, right: anchor.left + anchor.width, bottom: anchor.top + anchor.height }) };
  rl.placePopover(pop, a, opts);
  return pop.style;
}

test('#236 placePopover puts the card below its anchor, left-aligned, when there is room', () => {
  const s = place({ anchor: { left: 50, top: 40, width: 20, height: 20 }, w: 100, h: 50 });
  assert.equal(s.position, 'fixed');
  assert.equal(s.left, '50px');
  assert.equal(s.top, '64px'); // 60 + the 4px gap
});

test('#236 placePopover near the right edge clamps the card inside the window', () => {
  const s = place({ anchor: { left: 360, top: 40, width: 20, height: 20 }, w: 150, h: 50 });
  assert.equal(s.left, '244px'); // 400 - 150 - 6
});

test('#236 placePopover near the bottom edge flips the card above its anchor', () => {
  const s = place({ anchor: { left: 50, top: 260, width: 20, height: 20 }, w: 100, h: 80 });
  assert.equal(s.top, '176px'); // 260 - 4 - 80
});

test('#236 placePopover with alignRight lines the popover up with its anchor\'s right side, never past the left edge', () => {
  assert.equal(place({ anchor: { left: 300, top: 40, width: 40, height: 20 }, w: 200, h: 50, opts: { alignRight: true } }).left, '140px'); // 340 - 200
  assert.equal(place({ anchor: { left: 10, top: 40, width: 40, height: 20 }, w: 200, h: 50, opts: { alignRight: true } }).left, '6px');
});

test('#236 placePopover caps the card\'s width to the window so long lines wrap instead of running off', () => {
  assert.equal(place({ anchor: { left: 50, top: 40, width: 20, height: 20 }, w: 100, h: 50 }).maxWidth, '388px'); // 400 - 2 * 6
});

test('#236 placePopover leaves a hidden card alone', () => {
  const rl = loadRunList();
  rl.document.documentElement = { clientWidth: 400, clientHeight: 300 };
  const pop = { style: {}, getClientRects: () => [], getBoundingClientRect: () => ({ width: 0, height: 0 }) };
  rl.placePopover(pop, { getBoundingClientRect: () => ({ left: 0, top: 0, right: 0, bottom: 0 }) });
  assert.deepEqual({ ...pop.style }, {});
});
