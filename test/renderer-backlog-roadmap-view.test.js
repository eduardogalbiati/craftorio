// src/renderer/views/backlog/backlog-roadmap.js: what the Roadmap tab shows (#215, #216, #217).
// Loaded whole into a vm sandbox like test/renderer-backlog-roadmap.test.js, with the real
// WorkflowInputs (#116, its inputPills, #216) and Estimates (src/renderer/estimates.js, #215) modules.
// The seam is BacklogRoadmap.html(data, rerender, view): `view` is the Backlog's filter shared by the
// Board and Roadmap tabs ({ epic, showAll }); without it the Roadmap shows the open work only (#217).
// - #217: finished stages hidden by default ("N finished stages hidden"), a stage's done items folded
//   ("+N done"), Show all brings everything back, the epic filter keeps only its items.
// - #215: "≈ 1 h 45 min" next to "≈ $15.18"; after the run "$22.21 / ≈ $15.18" coloured by the
//   verdict (class rm-verdict-good / -warn / -bad, plus an arrow or sign), the difference in the
//   tooltip; while running "58 min of ≈ 1 h 45".
// - #216: the item's inputs as pills with the workflow's labels ("Unit tests: Run existing").
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const R = path.join(__dirname, '..', 'src', 'renderer');
const read = (...p) => fs.readFileSync(path.join(R, ...p), 'utf8');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

function loadRoadmap({ listWorkflows } = {}) {
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
    robotAvatar: () => '<svg class="robot"></svg>',
    agentLabel: (agent) => agent,
    PERSON_SVG: '<svg class="person"></svg>',
    ENGINE_SVG: '<svg class="engine"></svg>',
    progressChip: (c) => esc(c.name),
    ChainModel: { chainBadgesHtml: () => '' },
    scheduleRender: () => {},
    markdownHtml: (s) => esc(s),
    localStorage: { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) },
    document: { querySelector: () => null, querySelectorAll: () => [] },
    api: {
      listWorkflows: listWorkflows || (async () => []),
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
  vm.runInContext(read('run-progress-model.js'), sandbox);
  vm.runInContext(read('default-workflow.js'), sandbox);
  vm.runInContext(read('workflow-inputs.js'), sandbox);
  // #215's shared estimate rules; missing before the change (the tests then fail on their assertions)
  if (fs.existsSync(path.join(R, 'estimates.js'))) vm.runInContext(read('estimates.js'), sandbox);
  vm.runInContext(read('views', 'backlog', 'backlog-roadmap.js'), sandbox);
  return sandbox.window.BacklogRoadmap;
}

const settle = () => new Promise((r) => setTimeout(r, 0));
// the visible text of some markup (tags dropped, entities decoded)
const text = (html) => html.replace(/<[^>]*>/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\s+/g, ' ');
// the markup of one item (from its box to the next item's)
function itemBlock(html, id) {
  const start = html.indexOf(`data-item="${id}"`);
  assert.ok(start >= 0, `item ${id} is not rendered`);
  const next = html.indexOf('data-item="', start + 10);
  return html.slice(start, next < 0 ? undefined : next);
}
// the head of the stage numbered `n` (1-based, the real number)
function stageHead(html, n) {
  const sections = html.split('<section class="rm-stage').slice(1);
  const sec = sections.find((s) => new RegExp(`>\\s*Stage ${n}\\s*<`).test(s));
  assert.ok(sec, `Stage ${n} is not rendered`);
  const start = sec.indexOf('rm-stage-head');
  return sec.slice(start, sec.indexOf('</div>', start));
}
// the markup from a verdict class to the next badge
function verdictBadge(block, level) {
  const i = block.indexOf(`rm-verdict-${level}`);
  if (i < 0) return null;
  const next = block.indexOf('class="badge', i);
  return block.slice(i, next < 0 ? i + 400 : next);
}
// #282: the cost or time line of an item's card (its value, its estimate, its verdict), with its data-verdict
function meter(block, kind) {
  const at = block.indexOf(`data-testid="roadmap-meter-${kind}"`);
  assert.ok(at >= 0, `the ${kind} line is rendered`);
  const next = block.indexOf('data-testid="roadmap-', at + 20);
  const html = block.slice(at, next < 0 ? undefined : next);
  return { html, verdict: /data-verdict="([^"]*)"/.exec(html)?.[1] };
}

const ref = (number, title) => ({ number, title, url: `https://github.com/o/r/issues/${number}` });
const item = (id, status, number, title, extra = {}) => ({ id, status, workflow: 'software-development-local-hero.yaml', inputs: {}, issues: [ref(number, title)], ...extra });

// four stages: finished (done + skipped), mixed (done + planned), failed, running
function roadmapData() {
  return {
    roadmap: { state: 'running', stages: [
      { id: 'st1', name: 'Old work', note: '', items: [item('i1', 'done', 1, 'Done one'), item('i2', 'skipped', 2, 'Skipped two')] },
      { id: 'st2', name: '', note: '', items: [item('i3', 'done', 3, 'Done three'), item('i4', 'planned', 4, 'Planned four')] },
      { id: 'st3', name: '', note: '', items: [item('i5', 'failed', 5, 'Failed five')] },
      { id: 'st4', name: '', note: '', items: [item('i6', 'running', 6, 'Running six')] },
    ] },
    issues: [
      { number: 1, title: 'Done one', labels: [], epic: '#12' },
      { number: 4, title: 'Planned four', labels: [], epic: '#10' },
      { number: 5, title: 'Failed five', labels: [], epic: '#11' },
      { number: 6, title: 'Running six', labels: [] },
    ],
    epics: [{ id: '#10', title: 'Auth' }, { id: '#11', title: 'Billing' }, { id: '#12', title: 'Docs' }],
  };
}

// ---- #217: open work by default, Show all, the epic filter ------------------------------------

// #268: the "N finished stages hidden · Show all" line is gone (the Planned | All switch replaces it); the header counts the items shown
test('#217 roadmap default: finished stages are hidden, the open ones keep their real stage numbers, and the header counts the items shown', () => {
  const html = loadRoadmap().html(roadmapData(), () => {});
  const t = text(html);
  assert.doesNotMatch(t, /Done one|Skipped two/);
  assert.doesNotMatch(t, /finished stages? hidden/);
  assert.match(t, /\b3 of 6 items · last 24 hours\b/);
  assert.doesNotMatch(html, />\s*Stage 1\s*</);
  assert.match(html, />\s*Stage 2\s*</);
  assert.match(t, /Planned four/);
  assert.match(t, /Failed five/); // failed is open work
  assert.match(t, /Running six/); // so is running
});

test('#217 roadmap default: a stage with done and open items shows its open items with "+N done" folded', () => {
  const html = loadRoadmap().html(roadmapData(), () => {});
  const head = html.split('<section class="rm-stage').find((s) => />\s*Stage 2\s*</.test(s));
  assert.ok(head, 'Stage 2 is rendered');
  assert.match(text(head), /\+1 done/);
  assert.match(text(head), /Planned four/);
});

test('#217 roadmap Show all: every stage and item comes back, in order, finished stages dimmed, no hidden line', () => {
  const html = loadRoadmap().html(roadmapData(), () => {}, { showAll: true, epic: '' });
  const t = text(html);
  for (const title of ['Done one', 'Skipped two', 'Done three', 'Planned four', 'Failed five', 'Running six']) assert.match(t, new RegExp(title));
  assert.ok(t.indexOf('Done one') < t.indexOf('Planned four') && t.indexOf('Planned four') < t.indexOf('Running six'), 'stages stay in order');
  assert.match(html, /<section class="rm-stage[^"]*\bfinished\b[^"]*"[^>]*data-stage="0"/);
  assert.doesNotMatch(t, /finished stages? hidden/);
});

test('#217 roadmap epic filter: only the items whose issues belong to the epic, stages left empty are hidden', () => {
  const html = loadRoadmap().html(roadmapData(), () => {}, { epic: '#10', showAll: false });
  const t = text(html);
  assert.match(t, /Planned four/);
  assert.doesNotMatch(t, /Failed five|Running six/);
  assert.doesNotMatch(html, />\s*Stage 3\s*</);
  assert.doesNotMatch(html, />\s*Stage 4\s*</);
});

test('#217 roadmap epic filter with Show all: the epic\'s finished items come back too', () => {
  const html = loadRoadmap().html(roadmapData(), () => {}, { epic: '#12', showAll: true });
  const t = text(html);
  assert.match(t, /Done one/);
  assert.doesNotMatch(t, /Planned four|Failed five/);
});

test('#217 roadmap empty result: says why and offers Show all', () => {
  const html = loadRoadmap().html(roadmapData(), () => {}, { epic: '#12', showAll: false });
  const t = text(html);
  assert.match(t, /No open roadmap items in epic Docs/);
  assert.match(html, /<button[^>]*>[^<]*Show all/);
});

// ---- #215: time next to cost, real vs estimate with a verdict ----------------------------------

const estimate = { usd: 15.18, minutes: 105, runs: 30, complexity: 6, estimated: false, basis: 'Median of the last 30 successful runs' };
const single = (x, stageExtra = {}) => ({ roadmap: { state: 'running', stages: [{ id: 'st1', name: '', note: '', items: [x], ...stageExtra }] }, issues: [] });

test('#215 a planned item shows its estimated time next to its estimated cost', () => {
  const html = loadRoadmap().html(single(item('a', 'planned', 1, 'A', { estimate })), () => {});
  const t = text(itemBlock(html, 'a'));
  assert.match(t, /≈ \$15\.18/);
  assert.match(t, /≈ 1 h 45 min/);
});

// #282: the stage's estimate shows with more than one item (a single item's card already says it)
const pair = (x, stageExtra = {}) => ({ roadmap: { state: 'running', stages: [{ id: 'st1', name: '', note: '', items: [x, { ...x, id: `${x.id}2`, issues: [ref(99, 'Other')] }], ...stageExtra }] }, issues: [] });

test('#215 a stage shows its estimated duration', () => {
  const data = pair(item('a', 'planned', 1, 'A', { estimate }), { estimate: { usd: 30.36, minutes: 105, items: 2, missing: 0, runs: 30 } });
  assert.match(text(stageHead(loadRoadmap().html(data, () => {}), 1)), /≈ 1 h 45 min/);
});

test('#215 an item without history says "no estimate yet"', () => {
  const html = loadRoadmap().html(single(item('a', 'planned', 1, 'A', { estimate: null })), () => {});
  assert.match(text(itemBlock(html, 'a')), /no estimate yet/);
});

test('#215 a finished item worse than estimated: real / estimate in red with an up sign, the difference in the tooltip', () => {
  const x = item('a', 'done', 1, 'A', { estimate, actualUsd: 22.21, actualMinutes: 221, runId: 'r1', runs: ['r1'] });
  const block = itemBlock(loadRoadmap().html(single(x), () => {}, { showAll: true }), 'a');
  const t = text(block);
  assert.match(t, /\$22\.21 of ≈ \$15\.18/);
  assert.match(t, /3 h 41 min of ≈ 1 h 45 min/);
  const bad = verdictBadge(block, 'bad');
  assert.ok(bad, 'a rm-verdict-bad badge');
  assert.match(text(`<x ${bad}`), /[▲↑+]/);
  assert.match(block, /title="[^"]*\+46%[^"]*\$7\.03 more/);
});

test('#215 a finished item better than estimated: green with a down sign', () => {
  const x = item('a', 'done', 1, 'A', { estimate, actualUsd: 10, actualMinutes: 60, runId: 'r1', runs: ['r1'] });
  const block = itemBlock(loadRoadmap().html(single(x), () => {}, { showAll: true }), 'a');
  const good = verdictBadge(block, 'good');
  assert.ok(good, 'a rm-verdict-good badge');
  assert.match(text(`<x ${good}`), /[▼↓−-]/);
  assert.doesNotMatch(block, /rm-verdict-(warn|bad)/);
  assert.match(block, /title="[^"]*[−-]34%/);
});

test('#215 a finished item slightly over the estimate is amber; cost and time get their own verdicts', () => {
  const x = item('a', 'done', 1, 'A', { estimate, actualUsd: 17, actualMinutes: 221, runId: 'r1', runs: ['r1'] });
  const block = itemBlock(loadRoadmap().html(single(x), () => {}, { showAll: true }), 'a');
  const cost = meter(block, 'cost');
  const time = meter(block, 'time');
  assert.equal(cost.verdict, 'warn');
  assert.match(text(cost.html), /\$17\.00/);
  assert.match(cost.html, /rm-verdict-warn/);
  assert.equal(time.verdict, 'over');
  assert.match(text(time.html), /3 h 41 min/);
  assert.match(time.html, /rm-verdict-bad/);
});

test('#215 while running: elapsed vs estimate, amber then red once it passes the estimate', () => {
  const R0 = loadRoadmap();
  const at = (minutes) => itemBlock(R0.html(single(item('a', 'running', 1, 'A', { estimate, actualUsd: 5, actualMinutes: minutes, runId: 'r1', runs: ['r1'] })), () => {}), 'a');
  assert.match(text(at(58)), /58 min of ≈ 1 h 45/);
  assert.doesNotMatch(at(58), /rm-verdict-(warn|bad)/);
  assert.ok(verdictBadge(at(120), 'warn'), 'past the estimate by 14%: amber');
  assert.ok(verdictBadge(at(140), 'bad'), 'past the estimate by 33%: red');
});

test('#215 a finished stage shows its real total cost against its estimate, coloured', () => {
  const x = item('a', 'done', 1, 'A', { estimate, actualUsd: 22.21, actualMinutes: 221, runId: 'r1', runs: ['r1'] });
  const data = pair(x, { estimate: { usd: 15.18, minutes: 105, items: 2, missing: 0, runs: 30 }, actualUsd: 22.21 });
  const head = stageHead(loadRoadmap().html(data, () => {}, { showAll: true }), 1);
  assert.match(text(head), /\$22\.21/);
  assert.match(head, /rm-verdict-bad/);
});

// ---- #216: inputs as friendly pills ------------------------------------------------------------

const heroWorkflow = {
  file: 'software-development-local-hero.yaml',
  name: 'Software development, local hero',
  inputs: {
    mode: { enum: ['auto', 'validated'], default: 'auto', label: 'Mode', options: { auto: 'Automatic', validated: 'Validated' } },
    unit_tests: { enum: ['write_and_run', 'run_existing', 'off'], default: 'write_and_run', label: 'Unit tests', options: { write_and_run: 'Write and run', run_existing: 'Run existing', off: 'Off' }, description: 'How the change is tested.' },
    e2e_tests: { enum: ['off', 'write', 'write_and_run'], default: 'off', label: 'E2E', options: { off: 'Off', write: 'Write only', write_and_run: 'Write and run' } },
    screenshots: { enum: ['all', 'changed', 'off'], default: 'all', label: 'Screenshots', options: { all: 'All', changed: 'Changed', off: 'Off' } },
    language: { enum: ['js', 'python'], default: 'js', label: 'Language', options: { js: 'JavaScript', python: 'Python' } },
  },
};

test('#216 the roadmap card shows inputs as pills with the workflow\'s labels: no snake_case, no key: value, defaults not shown as pills', async () => {
  const R0 = loadRoadmap({ listWorkflows: async () => [heroWorkflow] });
  const x = item('a', 'planned', 1, 'A', { inputs: { mode: 'auto', unit_tests: 'run_existing', e2e_tests: 'write', screenshots: 'off', language: 'js' } });
  R0.html(single(x), () => {});
  await settle();
  const block = itemBlock(R0.html(single(x), () => {}), 'a');
  const meta = block.slice(block.indexOf('rm-meta'));
  const t = text(meta.slice(0, meta.indexOf('</div>')));
  assert.match(t, /Unit tests: Run existing/);
  assert.match(t, /E2E: Write only/);
  assert.match(t, /Screenshots: Off/);
  assert.doesNotMatch(t, /_/, 'no snake_case on the card');
  assert.doesNotMatch(t, /=/);
  assert.doesNotMatch(t, /unit_tests|e2e_tests|screenshots:/);
  // at its default: hidden, or dimmed (a class naming it), never a plain pill
  const lang = meta.indexOf('JavaScript');
  if (lang >= 0) assert.match(meta.slice(meta.lastIndexOf('class="', lang), lang), /dim|default/);
  assert.match(block, /title="[^"]*unit_tests[^"]*run_existing/); // the raw key and value stay in the tooltip
});
