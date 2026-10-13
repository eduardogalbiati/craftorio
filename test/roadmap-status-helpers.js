// Shared helpers of the acceptance tests for #266, #267, #268 and #272 (readable statuses, the
// Roadmap's run chip, its "+n done" chip, its date filter / Planned | All switch / pages, and the
// card's live timer). Not a test file itself (no `.test.js`).
//
// - The renderer scripts are evaluated whole in vm sandboxes, as in
//   test/renderer-roadmap-tooltips.test.js and test/renderer-display-names-245.test.js, with the real
//   RunProgress, WorkflowInputs, Estimates, displayName and run-list.js chips.
// - src/renderer/status-pill.js (#266, new) is evaluated into each sandbox when it exists, so the
//   test files load before it does and fail test by test; loadStatusPill() requires it in Node.
// - A fixed clock: each sandbox's Date is replaced by one whose `now` the test sets (setNow), for
//   both Date.now() and `new Date()` without arguments.
// - A small HTML reader (elements with their parents) builds fake click / change targets from the
//   rendered markup: target.closest(selector) walks the real ancestors of the element, so whatever
//   data attributes the markup carries drive BacklogRoadmap.onClick / onChange as the app's DOM would.
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const AgentColors = require('../src/renderer/agent-colors.js');
const { displayName } = require('../src/shared/display-name.js');

const R = path.join(__dirname, '..', 'src', 'renderer');
const read = (...p) => fs.readFileSync(path.join(R, ...p), 'utf8');
const exists = (...p) => fs.existsSync(path.join(R, ...p));
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const decode = (s) => String(s).replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
const agentLabel = (slug, names) => displayName(slug, names);

// the fixed "now" of these tests
const NOW = Date.parse('2026-10-04T12:00:00.000Z');
const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const iso = (ms) => new Date(ms).toISOString();
const settle = () => new Promise((r) => setTimeout(r, 0));

// ---- a fixed clock in a sandbox ---------------------------------------------------------------
function installClock(sandbox, now = NOW) {
  vm.runInContext(`(() => {
    const Real = Date;
    globalThis.__now = ${Number(now)};
    class FixedDate extends Real {
      constructor(...a) { if (a.length) super(...a); else super(globalThis.__now); }
      static now() { return globalThis.__now; }
    }
    globalThis.Date = FixedDate;
  })();`, sandbox);
  return (ms) => { sandbox.__now = ms; };
}

// ---- the new shared helper (#266) -------------------------------------------------------------
function loadStatusPill() {
  const file = path.join(R, 'status-pill.js');
  delete require.cache[require.resolve(file)];
  return require(file); // throws while the module does not exist: the test fails on its own
}
function evalStatusPill(sandbox) {
  if (exists('status-pill.js')) vm.runInContext(read('status-pill.js'), sandbox);
}

// ---- sandboxes ---------------------------------------------------------------------------------
function loadRobots() {
  const sandbox = { window: {} };
  vm.createContext(sandbox);
  vm.runInContext(read('robots.js'), sandbox);
  return sandbox.window.Robots;
}

function loadRunList({ now = NOW } = {}) {
  const sandbox = {
    console,
    document: { addEventListener() {} },
    Robots: loadRobots(),
    AgentColors,
    RunChatModel: { providerType: (p) => ({ claude: 'claude-code', codex: 'codex-cli', grok: 'grok-cli' }[p] || p) },
    AgentLooks: { forWorkflow: () => null },
    state: { workflows: [], runs: new Map(), runMeta: new Map() },
    esc,
    fmtDur: (ms) => `${Math.round((ms || 0) / 1000)}s`,
    fmtUsd: (n) => `$${(Number(n) || 0).toFixed(2)}`,
    fmtTok: (n) => String(n || 0),
    fmtNum: (n) => String(n || 0),
    dateOf: (s) => String(s || ''),
    runTitleHtml: (r) => esc(r.title || r.runId),
    prBadge: () => '',
    issuesOfRun: (r) => r?.issues || (r?.issue ? [r.issue] : []),
    displayName,
    agentLabel,
    requestAnimationFrame: () => 0,
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  const setNow = installClock(sandbox, now);
  evalStatusPill(sandbox);
  vm.runInContext(read('..', 'shared', 'run-progress-model.js'), sandbox);
  vm.runInContext(read('run-list.js'), sandbox);
  sandbox.PERSON = vm.runInContext('PERSON_SVG', sandbox);
  sandbox.ENGINE = vm.runInContext('ENGINE_SVG', sandbox);
  sandbox.setNow = setNow;
  return sandbox;
}

/**
 * backlog-roadmap.js in its sandbox → { R: window.BacklogRoadmap, sandbox, setNow }.
 * `runTitle`: the app's run title (run-meta.js's window.runTitle) for the run chip.
 */
function loadRoadmap({ listWorkflows, now = NOW, runTitle } = {}) {
  const rl = loadRunList({ now });
  const store = new Map();
  const sandbox = {
    console,
    esc,
    state: { runs: new Map(), runMeta: new Map() },
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
      listWorkflows: listWorkflows || (async () => []),
      saveRoadmap: async (projectId, stages) => ({ roadmap: { state: 'planned', stages } }),
      startRoadmap: async () => ({ roadmap: { state: 'running', stages: [] } }),
      roadmapItem: async () => ({ roadmap: { state: 'planned', stages: [] } }),
      setRoadmapLive: async () => ({ roadmap: { state: 'running', stages: [] } }),
    },
  };
  sandbox.setTimeout = setTimeout;
  sandbox.clearTimeout = clearTimeout;
  sandbox.setInterval = () => 0;
  sandbox.clearInterval = () => {};
  sandbox.window = sandbox;
  sandbox.window.showRun = () => {};
  if (runTitle) sandbox.runTitle = runTitle;
  vm.createContext(sandbox);
  const setNow = installClock(sandbox, now);
  // the run-list sandbox's clock follows too (its chips may read the time)
  const both = (ms) => { setNow(ms); rl.setNow(ms); };
  evalStatusPill(sandbox);
  vm.runInContext(read('..', 'shared', 'run-progress-model.js'), sandbox);
  vm.runInContext(read('..', 'shared', 'default-workflow.js'), sandbox);
  vm.runInContext(read('workflow-inputs.js'), sandbox);
  if (exists('estimates.js')) vm.runInContext(read('estimates.js'), sandbox);
  vm.runInContext(read('views', 'backlog', 'backlog-roadmap.js'), sandbox);
  return { R: sandbox.window.BacklogRoadmap, sandbox, setNow: both };
}

/**
 * The kanban / list card's run chip (backlog.js `const runLink = (r) => …`, #266): the arrow is
 * pulled out of the source (up to the next statement at the same indent) and run in a sandbox with
 * esc, displayName, window.runTitle and the StatusPill module, the way test/renderer-backlog-live.test.js
 * runs backlog.js's helpers.
 */
function loadRunLink({ runTitle = (r) => r.title || 'workflow' } = {}) {
  const src = read('views', 'backlog', 'backlog.js');
  const m = /\n([ \t]*)const runLink = [\s\S]*?(?=\n\1(?:\/\/|const |let |function |async function ))/.exec(src);
  assert.ok(m, 'runLink not found in backlog.js: the source moved');
  const sandbox = { esc, displayName, runTitle, console };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  evalStatusPill(sandbox);
  vm.runInContext(`${m[0]}\nthis.runLink = runLink;`, sandbox);
  return sandbox.runLink;
}

// ---- reading markup ----------------------------------------------------------------------------
const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']);

function parseAttrs(s) {
  const out = {};
  for (const m of String(s).matchAll(/([^\s=/"']+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g)) out[m[1].toLowerCase()] = decode(m[2] ?? m[3] ?? m[4] ?? '');
  return out;
}

/** Every element of `html`: { name, attrs, start, end, inner, outer, parent } (in document order). */
function elements(html) {
  const out = [];
  const stack = [];
  const re = /<(\/?)([a-zA-Z][\w-]*)\b((?:[^>"']|"[^"]*"|'[^']*')*)>/g;
  let m;
  while ((m = re.exec(html))) {
    const name = m[2].toLowerCase();
    if (m[1]) {
      const at = stack.map((x) => x.name).lastIndexOf(name);
      if (at < 0) continue;
      while (stack.length > at) {
        const el = stack.pop();
        el.end = stack.length === at ? m.index + m[0].length : m.index;
        el.innerEnd = m.index;
      }
      continue;
    }
    const el = { name, attrs: parseAttrs(m[3]), start: m.index, openEnd: m.index + m[0].length, parent: stack.at(-1) || null };
    out.push(el);
    if (VOID.has(name) || /\/\s*$/.test(m[3])) { el.end = el.openEnd; el.innerEnd = el.openEnd; } else stack.push(el);
  }
  for (const el of stack) { el.end = html.length; el.innerEnd = html.length; }
  for (const el of out) {
    el.outer = html.slice(el.start, el.end);
    el.inner = html.slice(el.openEnd, el.innerEnd);
  }
  return out;
}

const HIDDEN_TAGS = new Set(['code', 'pre', 'details', 'svg', 'script', 'style', 'template']);
const hiddenEl = (el) => HIDDEN_TAGS.has(el.name) || el.attrs.role === 'tooltip';

/** The markup without the elements `pick(el)` selects (content included). */
function dropWhere(html, pick) {
  const els = elements(html).filter(pick);
  let out = '';
  let at = 0;
  for (const el of els) {
    if (el.start < at) continue; // inside one already dropped
    out += html.slice(at, el.start);
    at = el.end;
  }
  return out + html.slice(at);
}

/** What a person reads: tags dropped, entities decoded; never titles, aria-labels, svg, tooltip cards, code. */
function visibleText(html) {
  return decode(dropWhere(String(html), hiddenEl).replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
}

/** The visible text nodes (each run of text between two tags, trimmed, non-empty). */
function textNodes(html) {
  return dropWhere(String(html), hiddenEl).split(/<[^>]*>/).map((t) => decode(t).replace(/\s+/g, ' ').trim()).filter(Boolean);
}

// ---- a minimal selector matcher (compound selectors, descendant combinator, comma lists) --------
function matchCompound(el, sel) {
  const m = /^([a-zA-Z][\w-]*|\*)?((?:[#.][\w-]+|\[[^\]]+\]|:[\w-]+)*)$/.exec(sel);
  if (!m) return false;
  if (m[1] && m[1] !== '*' && el.name !== m[1].toLowerCase()) return false;
  for (const t of m[2].matchAll(/([#.])([\w-]+)|\[([\w-]+)(?:([~^$*|]?=)\s*(?:"([^"]*)"|'([^']*)'|([^\]\s]*)))?\]|:([\w-]+)/g)) {
    if (t[1] === '#') { if (el.attrs.id !== t[2]) return false; continue; }
    if (t[1] === '.') { if (!String(el.attrs.class || '').split(/\s+/).includes(t[2])) return false; continue; }
    if (t[8]) continue; // pseudo-classes: not modelled
    const name = t[3].toLowerCase();
    if (!(name in el.attrs)) return false;
    if (!t[4]) continue;
    const want = t[5] ?? t[6] ?? t[7] ?? '';
    const have = el.attrs[name];
    if (t[4] === '=' && have !== want) return false;
    if (t[4] === '~=' && !have.split(/\s+/).includes(want)) return false;
    if (t[4] === '^=' && !have.startsWith(want)) return false;
    if (t[4] === '*=' && !have.includes(want)) return false;
  }
  return true;
}
function matches(el, selector) {
  return String(selector).split(',').map((s) => s.trim()).filter(Boolean).some((sel) => {
    const parts = sel.split(/\s+/);
    if (!matchCompound(el, parts.at(-1))) return false;
    let node = el.parent;
    for (let k = parts.length - 2; k >= 0; k--) {
      while (node && !matchCompound(node, parts[k])) node = node.parent;
      if (!node) return false;
      node = node.parent;
    }
    return true;
  });
}

const camel = (s) => s.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
/** A fake DOM element over a parsed element: dataset, classList, closest(), matches(), value, checked. */
function fakeEl(el, extra = {}) {
  if (!el) return null;
  const dataset = {};
  for (const [k, v] of Object.entries(el.attrs)) if (k.startsWith('data-')) dataset[camel(k.slice(5))] = v;
  const classes = String(el.attrs.class || '').split(/\s+/).filter(Boolean);
  return {
    tagName: el.name.toUpperCase(),
    dataset,
    className: classes.join(' '),
    classList: { contains: (c) => classes.includes(c), add() {}, remove() {}, toggle() {} },
    getAttribute: (n) => (n.toLowerCase() in el.attrs ? el.attrs[n.toLowerCase()] : null),
    hasAttribute: (n) => n.toLowerCase() in el.attrs,
    matches: (sel) => matches(el, sel),
    closest(sel) { for (let n = el; n; n = n.parent) if (matches(n, sel)) return n === el ? this : fakeEl(n); return null; },
    querySelector: () => null,
    querySelectorAll: () => [],
    textContent: visibleText(el.inner),
    value: el.attrs.value ?? '',
    checked: 'checked' in el.attrs,
    type: el.attrs.type || '',
    disabled: 'disabled' in el.attrs,
    focus() {},
    ...extra,
  };
}

/** The first element of `html` for which pred(el) holds (el: name, attrs, inner, outer, parent). */
function findEl(html, pred) {
  return elements(html).find(pred) || null;
}
function findAll(html, pred) {
  return elements(html).filter(pred);
}

/** A click event on the first element matching `pred`. */
function clickOn(html, pred) {
  const el = findEl(html, pred);
  assert.ok(el, 'the element to click is rendered');
  return { target: fakeEl(el), preventDefault() {}, stopPropagation() {} };
}

/** The roadmap's owner context (backlog.js's ctx) with what it was asked to do. */
function makeCtx() {
  const calls = { render: 0, showAll: [], since: [], errors: [], data: [] };
  const ctx = {
    projectId: 'p1',
    setData: (d) => calls.data.push(d),
    render: () => { calls.render += 1; },
    setError: (e) => calls.errors.push(e),
    setShowAll: (v) => calls.showAll.push(v),
    setSince: (v) => calls.since.push(v),
  };
  return { ctx, calls };
}

// ---- roadmap markup pieces ---------------------------------------------------------------------
/** The parsed element of item `id` (its .rm-item box). */
function itemEl(html, id) {
  const el = findEl(html, (e) => e.attrs['data-item'] === id && e.attrs['data-testid'] === 'roadmap-item');
  assert.ok(el, `item ${id} is not rendered`);
  return el;
}
const itemShown = (html, id) => !!findEl(html, (e) => e.attrs['data-item'] === id && e.attrs['data-testid'] === 'roadmap-item');
/** The <section> of the stage numbered `n` (1-based, as shown: "Stage n"), or null. */
function stageEl(html, n) {
  return findAll(html, (e) => e.attrs['data-testid'] === 'roadmap-stage')
    .find((e) => new RegExp(`>\\s*Stage ${n}\\s*<`).test(e.inner)) || null;
}
const stageCount = (html) => findAll(html, (e) => e.attrs['data-testid'] === 'roadmap-stage').length;
const clone = (x) => JSON.parse(JSON.stringify(x));

const ref = (number, title) => ({ number, title, url: `https://github.com/o/r/issues/${number}` });
/** A roadmap item; `extra` overrides (run, runId, origin, estimate, error…). */
const item = (id, status, number, title, extra = {}) => ({ id, status, workflow: 'software-development-local-hero.yaml', workflowName: 'Software development, local hero', inputs: {}, issues: [ref(number, title)], ...extra });
/** A run as the service attaches it to an item (src/service/areas/roadmap.js runView). */
const run = (extra = {}) => ({ status: 'running', mock: false, startedAt: null, finishedAt: null, waiting: false, gate: null, progress: [], groups: [], agentNames: null, stepNames: null, workflow: 'software-development-local-hero.yaml', error: null, stepTimes: {}, history: 0, ...extra });
const roadmapOf = (stages, extra = {}) => ({ roadmap: { state: 'running', stages, ...extra }, issues: [] });

module.exports = {
  R, read, exists, esc, decode, displayName, agentLabel,
  NOW, MIN, HOUR, DAY, iso, settle,
  installClock, loadStatusPill, loadRunList, loadRoadmap, loadRunLink,
  elements, findEl, findAll, visibleText, textNodes, dropWhere, fakeEl, clickOn, matches, makeCtx,
  itemEl, itemShown, stageEl, stageCount, clone, ref, item, run, roadmapOf,
};
