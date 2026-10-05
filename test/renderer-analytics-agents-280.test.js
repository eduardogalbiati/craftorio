// #280 acceptance tests (written before the code): Analytics › Agents (src/renderer/views/analytics/
// analytics-agents.js, a tab of views/analytics/analytics.js through window.AnalyticsTabs). The tab runs
// in a vm sandbox, like test/renderer-analytics-run-245.test.js: app.js's globals stubbed (the real
// fmtUsd/fmtTok of usage-widget.js), window.Robots.svg stubbed to a marker <svg data-robot data-state>,
// and `api` a stub whose every method answers the analytics:agents payload (the tab may name its method
// as it likes) and records its arguments.
//
// Assumed interface: window.AnalyticsTabs.agents = { id: 'agents', label: 'Agents', order (after 24/7's 20),
// load({ from, to }) (analytics.js passes the screen's date range), render(body) }.
// Payload: see test/analytics-agents-channel-280.test.js ({ agents: { oracle, 'product-owner', supervisor } }),
// plus agents.oracle.today = { spentUsd, limitUsd } (today's spend vs the daily budget) and
// agents.oracle.totals.wakeUps / questions.
// data-testids the developer adds: agents-card-oracle, agents-card-product-owner, agents-card-supervisor
// (the three cards, in that order), agents-chart (cost per day), agents-sessions-table, agents-session-row
// (one per row), agents-show-more, agents-empty (nothing in the range), agents-retry (after a read error).
// Not covered here (they need a real DOM: E2E): a click on a card filtering the table, the US$/Tokens
// toggle and its memory, the chart's hover, the cards wrapping.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { displayName } = require('../src/renderer/display-name.js');

const FILE = path.join(__dirname, '..', 'src', 'renderer', 'views', 'analytics', 'analytics-agents.js');
const RANGE = { from: '2026-09-01', to: '2026-09-30' };
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
// usage-widget.js's helpers, as the app has them
function fmtTok(n) {
  n = Number(n) || 0;
  const a = Math.abs(n);
  const short = (v, s) => `${v.toFixed(v < 100 ? 1 : 0).replace(/\.0$/, '')}${s}`;
  if (a >= 1e9) return short(n / 1e9, 'B');
  if (a >= 1e6) return short(n / 1e6, 'M');
  if (a >= 1e3) return short(n / 1e3, 'K');
  return String(Math.round(n));
}
const fmtUsd = (n) => `$${(Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const tok = (input, output, cache_read, cache_write) => ({ input, output, cache_read, cache_write });
const T = (day, h = 10) => `2026-09-${String(day).padStart(2, '0')}T${String(h).padStart(2, '0')}:00:00.000Z`;
const session = (agent, sessionId, day, extra = {}) => ({
  agent, sessionId, start: T(day), startReason: 'first', turns: 1, contextAtEnd: null, costUsd: 0.1, tokens: tok(10, 10, 0, 0), end: T(day, 11), endReason: 'open', ...extra,
});
const agent = (totals, sessions = [], extra = {}) => ({ totals: { tokens: tok(0, 0, 0, 0), ...totals }, days: [], sessions, ...extra });
const EMPTY = () => agent({ costUsd: 0, turns: 0, sessions: 0 });

// cost per turn: Oracle $0.50, Product Owner $0.25, Supervisor $0.20; shares 50%, 25%, 25%
function payload() {
  return {
    agents: {
      oracle: agent({ costUsd: 2, tokens: tok(360, 210, 250, 330), turns: 4, sessions: 2, wakeUps: 1, questions: 3 }, [
        session('oracle', 'o-old', 3, { startReason: null, endReason: 'compaction' }),
        session('oracle', 'o-new', 9, { startReason: 'compaction', endReason: 'open', costUsd: 1.9 }),
      ], {
        today: { spentUsd: 0.4, limitUsd: 3 },
        days: [{ day: '2026-09-03', costUsd: 0.1, tokens: tok(10, 10, 0, 0) }, { day: '2026-09-09', costUsd: 1.9, tokens: tok(350, 200, 250, 330) }],
      }),
      'product-owner': agent({ costUsd: 1, tokens: tok(400, 300, 0, 0), turns: 4, sessions: 4, projects: 2 }, [
        session('product-owner', 'po-1', 5, { startReason: 'one-shot', endReason: 'answered', costUsd: 1 }),
      ], { days: [{ day: '2026-09-05', costUsd: 1, tokens: tok(400, 300, 0, 0) }] }),
      supervisor: agent({ costUsd: 1, tokens: tok(500, 100, 0, 200), turns: 5, sessions: 2 }, [
        session('supervisor', 's-1', 7, { startReason: 'cleared', endReason: 'open', costUsd: 0.7 }),
      ], { days: [{ day: '2026-09-07', costUsd: 1, tokens: tok(500, 100, 0, 200) }] }),
    },
  };
}

// failFirst: only the first read fails (a Retry then succeeds)
async function loadTab({ data = payload(), fail = null, failFirst = null, load = true } = {}) {
  const calls = [];
  const answer = async (...args) => {
    calls.push(args);
    if (fail) throw new Error(fail);
    if (failFirst && calls.length === 1) throw new Error(failFirst);
    return data;
  };
  const api = new Proxy({}, { get: (_, name) => (name === 'then' ? undefined : answer) });
  const window = {};
  const Robots = { svg: (variant, state = 'idle') => `<svg data-robot="${variant}" data-state="${state}"></svg>`, VARIANTS: {}, STATES: {} };
  window.Robots = Robots;
  const storage = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) }; };
  const sandbox = {
    window, console, displayName, Robots, api, esc, fmtUsd, fmtTok,
    fmtNum: (n) => (n || 0).toLocaleString('en-US'), fmtCost: (n) => (n == null ? '—' : `$${Number(n).toFixed(4)}`),
    fmtDur: (ms) => `${Math.round((ms || 0) / 1000)}s`, timeOf: (s) => String(s).slice(11, 16), dateOf: (s) => String(s).slice(0, 16).replace('T', ' '),
    errMsg: (e) => String(e?.message || e), localStorage: storage(), sessionStorage: storage(),
    document: { querySelector: () => null, querySelectorAll: () => [], getElementById: () => null, addEventListener: () => {} },
    showView: () => {},
  };
  window.document = sandbox.document;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(FILE, 'utf8'), sandbox, { filename: FILE });
  const tab = window.AnalyticsTabs?.agents;
  assert.ok(tab, 'window.AnalyticsTabs.agents is registered');
  if (load) await tab.load({ ...RANGE });
  const render = () => {
    const body = { innerHTML: '', querySelector: () => null, querySelectorAll: () => [], addEventListener: () => {}, dataset: {} };
    tab.render(body);
    return body.innerHTML;
  };
  return { tab, calls, render };
}

// a body whose controls can be used: querySelectorAll hands out one fake element per `data-ag-<name>`
// attribute of the current markup (dataset and value as the browser would give), so the tab's own
// handlers run; `use(name, value)` finds the last one handed out and returns it
function interactiveBody() {
  const handed = [];
  const camel = (name) => `ag${name[0].toUpperCase()}${name.slice(1)}`;
  const body = {
    innerHTML: '', dataset: {}, addEventListener: () => {},
    querySelector: (sel) => (sel === '[data-ag-root]' ? (body.innerHTML.includes('data-ag-root') ? {} : null) : { focus: () => {} }),
    querySelectorAll: (sel) => {
      const name = /^\[data-ag-([a-z]+)\]$/.exec(sel)?.[1];
      if (!name) return [];
      const els = [...body.innerHTML.matchAll(new RegExp(`data-ag-${name}(?:="([^"]*)")?`, 'g'))]
        .map((m) => ({ name, dataset: { [camel(name)]: m[1] ?? '' }, value: '', focus: () => {} }));
      handed.push(...els);
      return els;
    },
  };
  const use = (name, value) => {
    const el = handed.filter((e) => e.name === name && (value == null || e.dataset[camel(name)] === value)).pop();
    assert.ok(el, `a data-ag-${name}${value ? `="${value}"` : ''} control is rendered`);
    return el;
  };
  return { body, use };
}
const rowAgents = (html) => rows(html).map((r) => {
  const text = visible(`<x ${r}`);
  return ['Product Owner', 'Supervisor', 'Oracle'].find((n) => text.includes(n)) || '?';
});

// what a person reads: tags dropped (so title attributes too), <title> tooltips of SVGs too
const visible = (html) => html.replace(/<title>[\s\S]*?<\/title>/g, ' ').replace(/<[^>]*>/g, ' ')
  .replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, ' ');
const TOP = ['agents-card-oracle', 'agents-card-product-owner', 'agents-card-supervisor', 'agents-chart', 'agents-sessions-table'];
// a top-level block: from its data-testid to the next top-level one
function block(html, id) {
  const at = html.indexOf(`data-testid="${id}"`);
  assert.ok(at >= 0, `data-testid="${id}" is rendered`);
  const next = TOP.map((x) => html.indexOf(`data-testid="${x}"`, at + 1)).filter((i) => i > at);
  return html.slice(at, next.length ? Math.min(...next) : undefined);
}
const rows = (html) => block(html, 'agents-sessions-table').split('data-testid="agents-session-row"').slice(1);

// ---- the tab (criterion 5) -------------------------------------------------------------------------

test('#280 Agents tab: registered in window.AnalyticsTabs after 24/7, and it reads analytics:agents with the screen\'s date range', async () => {
  const { tab, calls } = await loadTab();
  assert.equal(tab.id, 'agents');
  assert.equal(tab.label, 'Agents');
  assert.ok(tab.order > 20, `order ${tab.order} comes after 24/7's 20`);
  assert.equal(calls.length, 1, 'one read');
  assert.equal(calls[0][0]?.from, RANGE.from);
  assert.equal(calls[0][0]?.to, RANGE.to);
});

test('#280 Agents tab: index.html loads analytics-agents.js before analytics.js', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'index.html'), 'utf8');
  const tab = html.indexOf('views/analytics/analytics-agents.js');
  assert.ok(tab >= 0, 'the script is in index.html');
  assert.ok(tab < html.indexOf('views/analytics/analytics.js'), 'before analytics.js');
});

test('#280 Agents tab: three cards in the order Oracle, Product Owner, Supervisor, each with its robot and its name', async () => {
  const { render } = await loadTab();
  const html = render();
  const at = TOP.slice(0, 3).map((id) => html.indexOf(`data-testid="${id}"`));
  assert.ok(at.every((i) => i >= 0), `the three cards: ${at}`);
  assert.deepEqual([...at].sort((a, b) => a - b), at, 'Oracle, Product Owner, Supervisor');
  for (const [id, name] of [['oracle', 'Oracle'], ['product-owner', 'Product Owner'], ['supervisor', 'Supervisor']]) {
    const card = block(html, `agents-card-${id}`);
    assert.match(card, new RegExp(`data-robot="${id}"`), `${id}'s robot`);
    assert.match(visible(card), new RegExp(name), `${id}'s name`);
  }
});

test('#280 Agents tab: a card shows cost, the four token kinds, turns, sessions, cost per turn and its share of the three', async () => {
  const { render } = await loadTab();
  const card = visible(block(render(), 'agents-card-oracle'));
  assert.match(card, /\$2\.00/, 'cost');
  for (const n of ['360', '210', '250', '330']) assert.match(card, new RegExp(`\\b${n}\\b`), `tokens ${n}`);
  assert.match(card, /input/i);
  assert.match(card, /output/i);
  assert.match(card, /cache read/i);
  assert.match(card, /cache write/i);
  assert.match(card, /\b4\b/, 'turns');
  assert.match(card, /turns?/i);
  assert.match(card, /sessions?/i);
  assert.match(card, /\$0\.50/, 'cost per turn');
  assert.match(card, /50\s*%/, 'share of the three');
  assert.match(visible(block(render(), 'agents-card-supervisor')), /\$0\.20/, 'the Supervisor\'s cost per turn');
  assert.match(visible(block(render(), 'agents-card-product-owner')), /25\s*%/, 'the Product Owner\'s share');
});

test('#280 Agents tab: the Oracle\'s card adds today\'s spend against the daily budget and wake-ups vs questions', async () => {
  const { render } = await loadTab();
  const card = visible(block(render(), 'agents-card-oracle'));
  assert.match(card, /\$0\.40/, 'today\'s spend');
  assert.match(card, /\$3\.00/, 'the daily budget');
  assert.match(card, /wake-?ups?/i);
  assert.match(card, /questions?/i);
});

test('#280 Agents tab: the Product Owner\'s card adds its number of projects', async () => {
  const { render } = await loadTab();
  assert.match(visible(block(render(), 'agents-card-product-owner')), /\b2\s+projects\b/i);
});

test('#280 Agents tab: a cost-per-day chart with a legend of the three agents', async () => {
  const { render } = await loadTab();
  const chart = block(render(), 'agents-chart');
  for (const name of ['Oracle', 'Product Owner', 'Supervisor']) assert.match(visible(chart), new RegExp(name), `legend: ${name}`);
});

// ---- the sessions table (criterion 7) --------------------------------------------------------------

test('#280 Agents tab: the sessions table lists the newest session first', async () => {
  const { render } = await loadTab();
  const list = rows(render());
  assert.equal(list.length, 4, 'every session of the three agents');
  // each session has its own cost: Sep 9 $1.90, Sep 7 $0.70, Sep 5 $1.00, Sep 3 $0.10
  assert.deepEqual(list.map((r) => (visible(r).match(/\$\d+\.\d\d/) || [''])[0]), ['$1.90', '$0.70', '$1.00', '$0.10']);
});

test('#280 Agents tab: start and end reasons are chips with a tooltip; an earlier session\'s reason is "—", an open one says "open"', async () => {
  const { render } = await loadTab();
  const list = rows(render());
  const newest = list[0];
  assert.match(visible(newest), /compaction/i, 'the start reason chip');
  assert.match(newest, /title="[^"]*compaction[^"]*handoff note[^"]*"/i, 'its tooltip explains it');
  assert.match(visible(newest), /\bopen\b/i, 'an open session says open');
  const oldest = list[3];
  assert.match(visible(oldest), /—/, 'no start reason recorded: —');
  const po = list[2];
  assert.match(visible(po), /one-shot/i);
  assert.match(visible(po), /answered/i);
});

test('#280 Agents tab: 60 sessions show 50 rows and "Show more"', async () => {
  const data = payload();
  data.agents.oracle.sessions = Array.from({ length: 60 }, (_, i) => session('oracle', `o-${i}`, 1 + (i % 28), { start: new Date(Date.UTC(2026, 8, 1, 0, i)).toISOString() }));
  data.agents['product-owner'].sessions = [];
  data.agents.supervisor.sessions = [];
  const { render } = await loadTab({ data });
  const html = render();
  assert.equal(rows(html).length, 50);
  assert.match(html, /data-testid="agents-show-more"/);
  assert.match(visible(block(html, 'agents-sessions-table')), /Show more/i);
});

// ---- states (criterion 8) --------------------------------------------------------------------------

test('#280 Agents tab: before its data arrives it says it is loading', async () => {
  const { render } = await loadTab({ load: false });
  assert.match(visible(render()), /Loading/i);
});

test('#280 Agents tab: an agent with no turns in the range keeps its card, robot idle, "No turns in this range"', async () => {
  const data = payload();
  data.agents['product-owner'] = EMPTY();
  const { render } = await loadTab({ data });
  const html = render();
  const card = block(html, 'agents-card-product-owner');
  assert.match(card, /data-robot="product-owner" data-state="idle"/);
  assert.match(visible(card), /No turns in this range/);
  assert.match(html, /data-testid="agents-card-oracle"/, 'the other cards stay');
  assert.doesNotMatch(html, /data-testid="agents-empty"/);
});

test('#280 Agents tab: no turns for any of the three shows one empty state and no cards', async () => {
  const { render } = await loadTab({ data: { agents: { oracle: EMPTY(), 'product-owner': EMPTY(), supervisor: EMPTY() } } });
  const html = render();
  assert.equal(html.split('data-testid="agents-empty"').length - 1, 1, 'one empty state');
  for (const id of TOP.slice(0, 3)) assert.doesNotMatch(html, new RegExp(`data-testid="${id}"`));
});

test('#280 Agents tab: a read error shows its message and a Retry button', async () => {
  const { render } = await loadTab({ fail: 'disk unreadable 280' });
  const html = render();
  assert.match(visible(html), /disk unreadable 280/);
  assert.match(html, /data-testid="agents-retry"/);
  assert.match(visible(html), /Retry/);
});

// ---- the tab's controls ----------------------------------------------------------------------------

test('#280 Agents tab: a card says how many earlier turns have no recorded tokens', async () => {
  const data = payload();
  data.agents.supervisor.totals.turnsWithoutTokens = 2;
  const { render } = await loadTab({ data });
  const html = render();
  assert.match(visible(block(html, 'agents-card-supervisor')), /Tokens of 2 earlier turns not recorded/);
  assert.doesNotMatch(visible(block(html, 'agents-card-oracle')), /not recorded/);
});

test('#280 Agents tab: a click on a card shows only that agent\'s sessions, a second click every agent\'s again', async () => {
  const { tab } = await loadTab();
  const { body, use } = interactiveBody();
  tab.render(body);
  assert.deepEqual(rowAgents(body.innerHTML).sort(), ['Oracle', 'Oracle', 'Product Owner', 'Supervisor']);
  use('card', 'product-owner').onclick();
  assert.deepEqual(rowAgents(body.innerHTML), ['Product Owner']);
  assert.match(block(body.innerHTML, 'agents-card-product-owner'), /aria-pressed="true"/);
  use('card', 'product-owner').onclick();
  assert.equal(rows(body.innerHTML).length, 4);
});

test('#280 Agents tab: the agent filter of the sessions table shows only the chosen agent\'s sessions', async () => {
  const { tab } = await loadTab();
  const { body, use } = interactiveBody();
  tab.render(body);
  const select = use('filter');
  select.value = 'oracle';
  select.onchange();
  assert.deepEqual(rowAgents(body.innerHTML), ['Oracle', 'Oracle']);
  assert.match(body.innerHTML, /<option value="oracle" selected>/);
});

test('#280 Agents tab: "Show more" lists the next sessions', async () => {
  const data = payload();
  data.agents.oracle.sessions = Array.from({ length: 60 }, (_, i) => session('oracle', `o-${i}`, 1, { start: new Date(Date.UTC(2026, 8, 1, 0, i)).toISOString() }));
  data.agents['product-owner'].sessions = [];
  data.agents.supervisor.sessions = [];
  const { tab } = await loadTab({ data });
  const { body, use } = interactiveBody();
  tab.render(body);
  assert.equal(rows(body.innerHTML).length, 50);
  use('more').onclick();
  assert.equal(rows(body.innerHTML).length, 60);
  assert.doesNotMatch(body.innerHTML, /data-testid="agents-show-more"/);
});

test('#280 Agents tab: Retry reads the same date range again and shows the cards', async () => {
  const { tab, calls } = await loadTab({ failFirst: 'disk unreadable 280' });
  const { body, use } = interactiveBody();
  tab.render(body);
  assert.match(body.innerHTML, /data-testid="agents-retry"/);
  await use('retry').onclick();
  assert.equal(calls.length, 2, 'a second read');
  assert.equal(calls[1][0]?.from, RANGE.from);
  assert.equal(calls[1][0]?.to, RANGE.to);
  assert.match(body.innerHTML, /data-testid="agents-card-oracle"/);
  assert.doesNotMatch(body.innerHTML, /disk unreadable 280/);
});
