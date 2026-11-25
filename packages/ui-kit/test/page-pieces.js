// The UI kit's test pieces (not a test file): the renderer's scripts evaluated whole in vm sandboxes,
// a fixed clock, the shared status pill and run list loaded for real, and a small HTML reader that
// builds fake click / change targets from rendered markup (target.closest(selector) walks the real
// ancestors, so whatever data attributes the markup carries drive a screen's onClick / onChange as
// the app's DOM would). Shared by the kit's tests, the fronts' helpers (fronts/build/test/
// roadmap-status-helpers.js adds the Roadmap's pieces on top) and the analyser's page helpers, so no
// kit test depends on a front (#579 review of #583).
// - The page's files are read by their page-relative names, whichever layer holds them
//   (scripts/source-tree.js pageFile): robots.js, run-list.js, status-pill.js are the kit's.
// - A fixed clock: a sandbox's Date is replaced by one whose `now` the test sets (setNow), for both
//   Date.now() and `new Date()` without arguments.
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { withI18n } = require('@craftorio/shared/test/i18n-sandbox.js');
const AgentColors = require('../agent-colors.js');
const { displayName } = require('@craftorio/shared/display-name.js');

const { pageFile } = require('../../../scripts/source-tree');
const ROOT = path.join(__dirname, '..', '..', '..');
const read = (...p) => fs.readFileSync(pageFile(ROOT, p.join('/')), 'utf8');
const exists = (...p) => !!pageFile(ROOT, p.join('/'));
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
const clone = (x) => JSON.parse(JSON.stringify(x));

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

// ---- the shared status pill (#266) -------------------------------------------------------------
function loadStatusPill() {
  const file = pageFile(ROOT, 'status-pill.js');
  delete require.cache[require.resolve(file)];
  return require(file); // throws while the module does not exist: the test fails on its own
}
function evalStatusPill(sandbox) {
  if (exists('status-pill.js')) vm.runInContext(read('status-pill.js'), sandbox);
}

// ---- sandboxes ---------------------------------------------------------------------------------
function loadRobots() {
  const sandbox = { window: {} };
  vm.createContext(withI18n(sandbox));
  vm.runInContext(read('robots.js'), sandbox);
  return sandbox.window.Robots;
}

/** run-list.js in its sandbox, with the real robots, agent colours and run progress model; { setNow, PERSON, ENGINE, … }. */
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
    fmtUsd: (n, approx = false) => `${approx ? '≈ ' : ''}$${(Number(n) || 0).toFixed(2)}`,
    SessionCost: require('@craftorio/shared/session-cost'), // #72: the sessions' total
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
  vm.createContext(withI18n(sandbox));
  const setNow = installClock(sandbox, now);
  evalStatusPill(sandbox);
  vm.runInContext(read('..', '..', '..', 'packages', 'shared', 'run-progress-model.js'), sandbox);
  vm.runInContext(read('run-list.js'), sandbox);
  sandbox.PERSON = vm.runInContext('PERSON_SVG', sandbox);
  sandbox.ENGINE = vm.runInContext('ENGINE_SVG', sandbox);
  sandbox.setNow = setNow;
  return sandbox;
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

module.exports = {
  read, exists, esc, decode, displayName, agentLabel,
  NOW, MIN, HOUR, DAY, iso, settle, clone,
  installClock, loadStatusPill, evalStatusPill, loadRobots, loadRunList,
  elements, findEl, findAll, visibleText, textNodes, dropWhere, fakeEl, clickOn, matches,
};
