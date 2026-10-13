// #245 "Readable names everywhere": the screens. Acceptance tests written before the code.
//
// Where a step id was the visible text, its readable name shows instead: the YAML's `display` when
// the run's workflow.started carried one (the renderer's run objects get it as `stepNames`: step id →
// name, next to `agentNames`; see test/workflow-display-245.test.js for the event's shape), else
// displayName(id) from src/renderer/display-name.js ("acceptance_tests" → "Acceptance tests"). The id
// stays in tooltips only: a title, an aria-label or an app tooltip card (role="tooltip", #236: the
// progress strip and the roadmap ring carry no native title).
//
// Covered: the Roadmap card's run progress (src/renderer/views/backlog/backlog-roadmap.js: the step
// text, the steps popover's chips and its "Now:" line), the run list's progress strip
// (src/renderer/run-list.js runProgressStrip / progressChip: the chip name and its state line) and the
// artifacts panel's round heads (src/renderer/artifacts-panel.js: "Acceptance tests · round 1").
// Then a sweep: those screens rendered with runs walking the bundled workflows' real steps must show
// no snake_case agent / step / workflow id in their visible text.
//
// "Visible text" here: the markup's text with tags removed (so attributes such as title, aria-label
// and data-* never count), without the content of <code>, <pre>, <details>, <svg> and app tooltip
// cards (role="tooltip"). The modules are evaluated whole in vm sandboxes as in
// test/renderer-roadmap-tooltips.test.js and test/artifacts-panel.test.js, with the real displayName
// as the renderer has it (window.displayName, and app.js's agentLabel built on it).
// Not unit-testable here: the live path (app.js runInfo from the live workflow.started event) and the
// Run screen (views/run/run.js), which need the whole app.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const yaml = require('js-yaml');
const AgentColors = require('../src/renderer/agent-colors.js');
const { displayName } = require('../src/shared/display-name.js');
const { fakeRoot, waitTick } = require('./artifacts-panel-helpers');

const R = path.join(__dirname, '..', 'src', 'renderer');
const WORKFLOWS = path.join(__dirname, '..', 'workflows');
const read = (...p) => fs.readFileSync(path.join(R, ...p), 'utf8');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const decode = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
const agentLabel = (slug, names) => displayName(slug, names);

// ---- visible text vs tooltips ----------------------------------------------------------------

// Removes the elements `pick(tagName, attrs)` selects (with their content, nested same-name tags
// balanced); returns the markup left and the removed fragments.
function dropElements(html, pick) {
  let out = String(html);
  const removed = [];
  for (;;) {
    const open = /<([a-zA-Z][\w-]*)\b([^>]*)>/g;
    let m;
    let found = null;
    while ((m = open.exec(out))) if (pick(m[1].toLowerCase(), m[2])) { found = m; break; }
    if (!found) return { html: out, removed };
    const name = found[1].toLowerCase();
    let end = out.length;
    if (!/\/\s*$/.test(found[2])) {
      const tags = new RegExp(`<(/?)${name}\\b[^>]*?(/?)>`, 'gi');
      tags.lastIndex = found.index + found[0].length;
      let depth = 1;
      let t;
      while ((t = tags.exec(out))) {
        if (t[1]) depth -= 1;
        else if (!t[2]) depth += 1;
        if (!depth) { end = t.index + t[0].length; break; }
      }
    } else end = found.index + found[0].length;
    removed.push(out.slice(found.index, end));
    out = out.slice(0, found.index) + out.slice(end);
  }
}

const HIDDEN_TAGS = new Set(['code', 'pre', 'details', 'svg', 'script', 'style']);
const isTooltip = (attrs) => /\brole\s*=\s*"tooltip"/.test(attrs);
const textOf = (html) => decode(String(html).replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();

function visibleText(html) {
  return textOf(dropElements(html, (tag, attrs) => HIDDEN_TAGS.has(tag) || isTooltip(attrs)).html);
}

// What the tooltips say: title and aria-label values, and the app's tooltip cards
function tooltipText(html) {
  const attrs = [...String(html).matchAll(/\s(?:title|aria-label)="([^"]*)"/g)].map((m) => decode(m[1]));
  const cards = dropElements(html, (tag, a) => isTooltip(a)).removed.map(textOf);
  return [...attrs, ...cards].join(' | ');
}

// ---- sandboxes ---------------------------------------------------------------------------------

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
    displayName,
    agentLabel,
    requestAnimationFrame: () => 0,
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(read('status-pill.js'), sandbox);
  vm.runInContext(read('..', 'shared', 'run-progress-model.js'), sandbox);
  vm.runInContext(read('run-list.js'), sandbox);
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
    displayName,
    agentLabel,
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
  vm.runInContext(read('status-pill.js'), sandbox);
  vm.runInContext(read('..', 'shared', 'run-progress-model.js'), sandbox);
  vm.runInContext(read('..', 'shared', 'default-workflow.js'), sandbox);
  vm.runInContext(read('workflow-inputs.js'), sandbox);
  if (fs.existsSync(path.join(R, 'estimates.js'))) vm.runInContext(read('estimates.js'), sandbox);
  vm.runInContext(read('views', 'backlog', 'backlog-roadmap.js'), sandbox);
  return sandbox.window.BacklogRoadmap;
}

// The artifacts panel with the real displayName (test/artifacts-panel-helpers.js's loadPanel has none)
function loadPanel({ ev, files }) {
  const sandbox = {
    esc,
    displayName,
    agentLabel,
    artKindIcon: (kind) => `<i data-kind="${kind}"></i>`,
    fmtSize: (n) => (n == null ? '' : `${n} B`),
    markdownHtml: (t) => `<md>${t}</md>`,
    renderJsonText: (t) => t,
    renderDelimited: (t) => `<table>${t}</table>`,
    errMsg: (e) => String(e?.message || e),
    openArtifactsAt: () => {},
    showToast: () => {},
    ArtifactMenu: { open: () => {} },
    ImageViewer: { THUMB: 'tabindex="0" role="button" title="Click to enlarge" data-iv-thumb', open: () => {} },
    api: {
      listArtifacts: async () => [{ artifacts: files }],
      readArtifact: async () => ({ text: '' }),
      runEvidence: async () => ev,
    },
    window: { displayName },
    document: {},
    setTimeout, clearTimeout, Date,
  };
  vm.createContext(sandbox);
  vm.runInContext(read('artifacts-panel.js'), sandbox);
  return sandbox.window.ArtifactsPanel;
}

// ---- fixtures ------------------------------------------------------------------------------------

const trail = (step, status, agent, extra = {}) => ({
  step, status, ts: '2026-10-04T10:00:00.000Z', durationMs: status === 'running' ? undefined : 60000,
  agents: agent ? [{ agent, provider: 'claude', model: 'claude-sonnet-5', cost: 0.2, durationMs: 60000 }] : [], ...extra,
});

// a roadmap item whose run (no groups: each step is its own chip) works at acceptance_tests
function roadmapItem(run = {}) {
  return {
    id: 'it1', status: 'running', runId: 'run-245', workflow: 'ai-development-local-hero.yaml', inputs: {},
    issues: [{ number: 245, title: 'Readable names everywhere', url: 'https://github.com/o/r/issues/245' }],
    run: {
      status: 'running', mock: true, startedAt: '2026-10-04T10:00:00.000Z', workflow: 'ai-development-local-hero.yaml',
      progress: [trail('acceptance_tests', 'running', 'test_writer')],
      groups: [], stepTimes: {}, history: 0, agentNames: null,
      ...run,
    },
  };
}

function roadmapProgress(item) {
  const html = loadRoadmap().html({ roadmap: { state: 'running', stages: [{ id: 'st1', name: '', note: '', items: [item] }] }, issues: [] }, () => {}, { showAll: true });
  const at = html.indexOf('class="rm-progress');
  assert.ok(at >= 0, 'the run\'s progress ring is rendered');
  // from the ring's opening tag to the item's meta row (its own opening tag left out)
  const start = html.lastIndexOf('<', at);
  const meta = html.indexOf('class="rm-meta"', at);
  return { html, block: html.slice(start, meta < 0 ? undefined : html.lastIndexOf('<', meta)) };
}

const stepText = (block) => {
  const m = /<div\b[^>]*class="rm-progress-text"[^>]*>([\s\S]*?)<\/div>/.exec(block);
  assert.ok(m, 'the current step text (.rm-progress-text) is rendered');
  return visibleText(m[1]);
};

// ---- the Roadmap card ------------------------------------------------------------------------------

test('#245 roadmap card: the run\'s current step reads "Acceptance tests", not "acceptance_tests"', () => {
  const { block } = roadmapProgress(roadmapItem());
  assert.match(stepText(block), /Acceptance tests/);
  assert.doesNotMatch(visibleText(block), /acceptance_tests/, 'no snake_case id in the card\'s visible text (step text, popover chips, "Now:" line)');
});

test('#245 roadmap card: the id acceptance_tests is still there for debugging, in a tooltip only', () => {
  const { block } = roadmapProgress(roadmapItem());
  assert.doesNotMatch(visibleText(block), /acceptance_tests/);
  assert.match(tooltipText(block), /acceptance_tests/);
});

test('#245 roadmap card: the YAML\'s display carried by the run (stepNames, from workflow.started) wins over displayName', () => {
  const { block } = roadmapProgress(roadmapItem({ stepNames: { acceptance_tests: 'Tests written first' } }));
  assert.match(stepText(block), /Tests written first/);
  assert.doesNotMatch(visibleText(block), /acceptance_tests|Acceptance tests/);
});

test('#245 roadmap card: a run that failed at red_check reads "Failed at Red check"', () => {
  const { block } = roadmapProgress(roadmapItem({ status: 'failed', progress: [trail('acceptance_tests', 'done', 'test_writer'), trail('red_check', 'failed', null, { type: 'suite' })] }));
  assert.match(stepText(block), /Failed at Red check/);
  assert.doesNotMatch(visibleText(block), /red_check|acceptance_tests/);
});

// ---- the run list's progress strip ---------------------------------------------------------------

const stripRun = (extra = {}) => ({
  runId: 'run-245', current: false, status: 'running', workflow: 'ai-development-local-hero.yaml', groups: [],
  progress: [trail('acceptance_tests', 'done', 'test_writer'), trail('red_check', 'done', null, { type: 'suite' }), trail('verify_change', 'running', 'verifier')],
  ...extra,
});

test('#245 run list strip: the chips read "Acceptance tests", "Red check" and "Verify change…", not their ids', () => {
  const html = loadRunList().runProgressStrip(stripRun());
  const names = [...html.matchAll(/<div class="rp-name[^"]*">([\s\S]*?)<\/div>/g)].map((m) => visibleText(m[1]));
  assert.deepEqual(names, ['Acceptance tests', 'Red check', 'Verify change']);
  const state = [...html.matchAll(/<div class="rp-state">([\s\S]*?)<\/div>/g)].map((m) => visibleText(m[1])).at(-1);
  assert.match(state, /^Verify change/);
  assert.doesNotMatch(visibleText(html), /acceptance_tests|red_check|verify_change/);
});

test('#245 run list strip: the step ids stay in the tooltips (aria-label / the app\'s card), for debugging', () => {
  const html = loadRunList().runProgressStrip(stripRun());
  assert.doesNotMatch(visibleText(html), /acceptance_tests/);
  assert.match(tooltipText(html), /acceptance_tests/);
  assert.match(tooltipText(html), /verify_change/);
});

test('#245 run list strip: a run\'s stepNames (the YAML display from its workflow.started) name its chips', () => {
  const html = loadRunList().runProgressStrip(stripRun({ stepNames: { red_check: 'Red check (tests fail first)', verify_change: 'Final verification' } }));
  const text = visibleText(html);
  assert.match(text, /Red check \(tests fail first\)/);
  assert.match(text, /Final verification/);
  assert.doesNotMatch(text, /verify_change|red_check|Verify change/);
});

test('#245 run list strip: a grouped chip\'s state line names its current step ("Validate" … "Verify change…")', () => {
  const html = loadRunList().runProgressStrip(stripRun({ groups: [{ name: 'Validate', steps: ['red_check', 'verify_change'] }] }));
  const text = visibleText(html);
  assert.match(text, /Validate/);
  assert.match(text, /Verify change…/);
  assert.doesNotMatch(text, /verify_change/);
});

// ---- the artifacts panel -------------------------------------------------------------------------

const fileEntry = (file) => ({ path: file, name: path.basename(file), rel: file.replace('/r/', ''), kind: 'image', size: 1, mtime: '2026-01-01T00:00:00Z' });

// final round: acceptance_tests round 1; an older round (History): red_check round 1
function evidence() {
  const shot = (step, side, final, pair) => ({
    path: `evidence/${step}/round-1/245-home.${side}.png`, file: `/r/evidence/${step}/round-1/245-home.${side}.png`,
    pair: pair ? `evidence/${step}/round-1/245-home.${pair}.png` : null, pair_file: pair ? `/r/evidence/${step}/round-1/245-home.${pair}.png` : null,
    side, key: '245-home', issue: '245', caption: 'Home', commit: side === 'modified' ? 'abc1234' : null, step, round: 1, final,
  });
  return {
    version: 1, base: 'main', branch: 'feat/245',
    final: { step: 'acceptance_tests', round: 1 },
    rounds: [
      { step: 'red_check', round: 1, captured_at: '2026-01-01T00:00:00Z', final: false },
      { step: 'acceptance_tests', round: 1, captured_at: '2026-01-02T00:00:00Z', final: true },
    ],
    images: [
      shot('acceptance_tests', 'modified', true, 'original'), shot('acceptance_tests', 'original', true, 'modified'),
      shot('red_check', 'modified', false, null),
    ],
  };
}

async function panelHtml(opts = {}) {
  const ev = evidence();
  const ArtifactsPanel = loadPanel({ ev, files: ev.images.map((x) => fileEntry(x.file)) });
  const { root } = fakeRoot();
  ArtifactsPanel.mount(root, { runId: 'r1', ...opts });
  await waitTick();
  return root.innerHTML;
}

test('#245 artifacts panel: the final screenshots\' head reads "Acceptance tests · round 1", not "acceptance_tests · round 1"', async () => {
  const html = await panelHtml();
  const text = visibleText(html);
  assert.match(text, /Acceptance tests · round 1/);
  assert.doesNotMatch(text, /acceptance_tests · round/);
});

test('#245 artifacts panel: History\'s round heads read "Red check · round 1"', async () => {
  const html = await panelHtml();
  const history = dropElements(html, (tag) => tag === 'details').removed.join('');
  assert.ok(history, 'the History section is rendered');
  assert.match(textOf(history), /Red check · round 1/);
  assert.doesNotMatch(textOf(history), /red_check · round/);
});

test('#245 artifacts panel: the gate\'s latest capture head (extras.capture) reads "Acceptance tests · round 1"', async () => {
  const cap = { kind: 'screenshots', folder: 'acceptance_tests', round: 1, taken: 2, screens: 1, errors: [], reason: null };
  const html = await panelHtml({ flat: true, extras: { capture: cap } });
  assert.match(visibleText(html), /Acceptance tests · round 1/);
  assert.doesNotMatch(visibleText(html), /acceptance_tests · round/);
});

// ---- the sweep: no snake_case id left on these screens -------------------------------------------

// Every agent key, step id and workflow name of the bundled workflows
function knownIds() {
  const ids = new Set();
  const workflows = [];
  for (const f of fs.readdirSync(WORKFLOWS).filter((x) => /\.ya?ml$/i.test(x)).sort()) {
    const wf = yaml.load(fs.readFileSync(path.join(WORKFLOWS, f), 'utf8'));
    workflows.push({ file: f, wf });
    for (const k of Object.keys(wf.agents || {})) ids.add(k);
    for (const s of wf.steps || []) ids.add(s.id);
    if (wf.metadata?.name) ids.add(wf.metadata.name);
    ids.add(f.replace(/\.ya?ml$/i, ''));
  }
  return { ids, workflows };
}

const SNAKE = /\b[a-z]+_[a-z_]+\b/g;
function snakeIdsIn(html, ids) {
  return [...new Set((visibleText(html).match(SNAKE) || []).filter((w) => ids.has(w)))];
}

// A run walking the workflow's first `n` steps (the last one running), as the run list / roadmap get it
function walk(wf, n) {
  const steps = (wf.steps || []).slice(0, n);
  return steps.map((s, i) => trail(s.id, i === steps.length - 1 ? 'running' : 'done', s.type ? null : s.agent || (s.agents || [])[0] || null, s.type ? { type: s.type } : {}));
}

test('#245 sweep: the roadmap cards, run list strips and artifacts panel of runs of the bundled workflows show no snake_case id', async () => {
  const { ids, workflows } = knownIds();
  const leaks = [];
  for (const { file, wf } of workflows) {
    const snake = (wf.steps || []).filter((s) => /_/.test(s.id));
    if (!snake.length) continue;
    for (const groups of [[], wf.groups || []]) {
      for (const n of [1, 3, 8, (wf.steps || []).length]) {
        const progress = walk(wf, n);
        const strip = loadRunList().runProgressStrip({ runId: 'run-x', current: false, status: 'running', workflow: file, groups, progress });
        for (const id of snakeIdsIn(strip, ids)) leaks.push(`run list strip (${file}, ${n} steps${groups.length ? ', grouped' : ''}): ${id}`);
        for (const status of ['running', 'failed']) {
          const { block } = roadmapProgress(roadmapItem({ status, workflow: file, groups, progress: status === 'failed' ? progress.map((p, i) => (i === progress.length - 1 ? { ...p, status: 'failed' } : p)) : progress }));
          for (const id of snakeIdsIn(block, ids)) leaks.push(`roadmap card (${file}, ${n} steps, ${status}${groups.length ? ', grouped' : ''}): ${id}`);
        }
      }
    }
  }
  for (const id of snakeIdsIn(await panelHtml(), ids)) leaks.push(`artifacts panel: ${id}`);
  const cap = { kind: 'screenshots', folder: 'acceptance_tests', round: 1, taken: 2, screens: 1, errors: [], reason: null };
  for (const id of snakeIdsIn(await panelHtml({ flat: true, extras: { capture: cap } }), ids)) leaks.push(`artifacts panel (gate capture): ${id}`);
  assert.deepEqual([...new Set(leaks)].slice(0, 40), [], 'snake_case ids in visible text');
});

test('#245 sweep helper: visible text ignores titles, aria-labels, tooltip cards, <code>, <pre> and <details> (sanity check of the test itself)', () => {
  const html = '<div title="red_check" aria-label="red_check">Red check<span role="tooltip"><span>red_check</span></span><code>red_check</code><pre>red_check</pre><details><summary>x</summary>red_check</details></div>';
  assert.equal(visibleText(html), 'Red check');
  assert.match(tooltipText(html), /red_check/);
  assert.deepEqual(snakeIdsIn('<b>verify_change</b>', new Set(['verify_change'])), ['verify_change']);
});
