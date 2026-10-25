// #275 acceptance tests (written before the code): the Analytics › 24/7 tab's "Hours of the day" heatmap
// (src/renderer/views/analytics/analytics-occupancy.js, a tab of views/analytics/analytics.js through
// window.AnalyticsTabs). The tab runs in a vm sandbox like test/renderer-analytics-agents-280.test.js:
// app.js's globals stubbed, `api` a stub whose every method answers the analytics:occupancy payload,
// navigator.language = 'pt-BR' and the process in America/Sao_Paulo (the owner's locale and time zone).
//
// Contract asserted through the rendered HTML only:
// - each cell is an <i class="an-heat-cell an-heat-l0..l4"> (l0: idle, l1: <25%, l2: <50%, l3: <75%,
//   l4: >=75%) in a .an-heat-row of [data-testid="an-occ-heat"]; a null hour is <i class="an-heat-cell
//   an-heat-nodata"> with no level class;
// - the heading "Hours of the day" says "(more active hours are stronger)", never "darker";
// - a legend [data-testid="an-occ-heat-legend"] with the words idle, fully active, no data and one swatch
//   per class an-heat-l0..l4 and an-heat-nodata;
// - .an-heat-day labels and the day chart's labels ([data-testid="an-occ-days"]) use the owner's locale
//   (pt-BR: 04/10, never 10-04);
// - each cell's title: the local day, the hour range (14:00–15:00), the active minutes and the share.
const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { withI18n } = require('@multiagent/shared/test/i18n-sandbox.js');

const FILE = path.join(__dirname, '..', 'src', 'renderer', 'views', 'analytics', 'analytics-occupancy.js');
const LS = 'multiagent.analytics.occupancy';
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// ---- fixture: two local days, oldest first as packages/engine/domains/run/occupancy.js builds them -------------------------
const NEWEST = '2026-10-04';
const OLDEST = '2026-10-03';
function newestHourly() {
  const h = Array(24).fill(0);
  h[0] = 0; h[1] = 0.4; h[2] = 1.0; h[3] = 0.1; h[4] = 0.6; h[14] = 0.78; h[23] = null;
  return h;
}
const idle = (noWork) => ({ noWork, blocked: 0, gate: 0, appClosed: 0, other: 0, total: noWork });
const side = (hours, activeHours) => ({ hours, activeHours, occupancy: hours ? activeHours / hours : null, idleHours: idle(hours - activeHours), issues: 0, costUsd: 0, lines: 0 });
const day = (d, hourly, activeHours) => ({ day: d, hours: 24, activeHours, idleHours: idle(24 - activeHours), occupancy: activeHours / 24, hourly, partial: false, costUsd: 0, issues: 0 });

function payload() {
  return {
    empty: false, span: 7, appLog: true, partialSince: null, hint: null, running: false,
    occupancy: 0.1, activeHours: 4, costUsd: 0, issues: 0, lines: 0, streakMinutes: 0, idleNowMinutes: 30,
    avgConcurrent: 1, peakConcurrent: 1,
    cards: {
      day: { occupancy: 0.1, activeHours: 2.4, hours: 24 },
      week: { occupancy: 0.1, activeHours: 4, hours: 48, longestGap: null },
      month: { occupancy: 0.1, activeHours: 4, hours: 48 },
    },
    days: [day(OLDEST, Array(24).fill(0.5), 12), day(NEWEST, newestHourly(), 2.88)],
    gaps: [], nights: [], calibration: [],
    nightWatch: { nights: 0, inside: side(0, 0), outside: side(48, 4) },
    cost: { perActiveHour: null, perIssue: null, per100Lines: null },
  };
}

// ---- the tab in a sandbox ---------------------------------------------------------------------------
async function loadTab({ data = payload() } = {}) {
  const calls = [];
  const answer = async (...args) => { calls.push(args); return data; };
  const api = new Proxy({}, { get: (_, name) => (name === 'then' ? undefined : answer) });
  const storage = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) }; };
  const localStorage = storage();
  localStorage.setItem(LS, '7');
  const window = {};
  window.window = window;
  const sandbox = {
    window, console, api, esc, Intl, Date,
    navigator: { language: 'pt-BR', languages: ['pt-BR'] },
    fmtUsd: (n) => `$${(Number(n) || 0).toFixed(2)}`,
    fmtNum: (n) => String(n || 0), fmtDur: (ms) => `${Math.round((ms || 0) / 1000)}s`,
    dateOf: (s) => String(s).slice(0, 16).replace('T', ' '), timeOf: (s) => String(s).slice(11, 16),
    errMsg: (e) => String(e?.message || e), localStorage, sessionStorage: storage(),
    document: { querySelector: () => null, querySelectorAll: () => [], getElementById: () => null, addEventListener: () => {} },
    showView: () => {},
  };
  window.document = sandbox.document;
  window.navigator = sandbox.navigator;
  sandbox.t = withI18n({}).t; // the text only: the dates keep following the machine's locale here
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(FILE, 'utf8'), sandbox, { filename: FILE });
  const tab = window.AnalyticsTabs?.occupancy;
  assert.ok(tab, 'window.AnalyticsTabs.occupancy is registered');
  await tab.load();
  const body = { innerHTML: '', querySelector: () => null, querySelectorAll: () => [], addEventListener: () => {}, dataset: {} };
  tab.render(body);
  return { tab, calls, html: body.innerHTML };
}

// ---- reading the markup (strings and counts only) --------------------------------------------------
// what a person reads: tags dropped (so title attributes too)
const visible = (html) => html.replace(/<title>[\s\S]*?<\/title>/g, ' ').replace(/<[^>]*>/g, ' ')
  .replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, ' ');

// the element carrying data-testid="id", with its content: its own tag balanced
function element(html, id) {
  const at = html.indexOf(`data-testid="${id}"`);
  assert.ok(at >= 0, `data-testid="${id}" is rendered`);
  const open = html.lastIndexOf('<', at);
  const tag = /^<([a-z0-9]+)/i.exec(html.slice(open))?.[1];
  assert.ok(tag, `data-testid="${id}" sits on a tag`);
  const re = new RegExp(`<(/?)${tag}\\b[^>]*>`, 'gi');
  re.lastIndex = open;
  let depth = 0; let m;
  while ((m = re.exec(html))) {
    depth += m[1] ? -1 : 1;
    if (depth === 0) return html.slice(open, m.index + m[0].length);
  }
  return html.slice(open);
}
// the heat strip's day rows (the hour axis row excluded), each with its label and its <i> cells
function heatRows(html) {
  const heat = element(html, 'an-occ-heat');
  return [...heat.matchAll(/<div\b[^>]*class="[^"]*\ban-heat-row\b[^"]*"[^>]*>([\s\S]*?)<\/div>/g)]
    .filter((m) => !m[0].includes('an-heat-axis'))
    .map((m) => ({
      label: visible(/<span\b[^>]*class="[^"]*\ban-heat-day\b[^"]*"[^>]*>([\s\S]*?)<\/span>/.exec(m[1])?.[1] ?? '').trim(),
      cells: [...m[1].matchAll(/<i\b[^>]*>/g)].map((c) => ({
        classes: (/class="([^"]*)"/.exec(c[0])?.[1] ?? '').split(/\s+/).filter(Boolean),
        title: (/title="([^"]*)"/.exec(c[0])?.[1] ?? '').replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&'),
      })),
    }));
}
const levels = (cell) => cell.classes.filter((c) => /^an-heat-l\d$/.test(c));
const newestRow = (html) => {
  const rows = heatRows(html);
  assert.equal(rows.length, 2, 'one heat row per day');
  return rows[0];
};
const cell = (html, hour) => {
  const row = newestRow(html);
  assert.equal(row.cells.length, 24, 'the newest row has 24 hour cells');
  return row.cells[hour];
};
const heading = (html) => {
  const h = /<h3[^>]*>[^<]*Hours of the day[\s\S]*?<\/h3>/.exec(html)?.[0];
  assert.ok(h, 'the "Hours of the day" heading is rendered');
  return visible(h);
};

describe('#275 24/7 heatmap: more is more, legend, local dates', () => {
  let tzBefore;
  before(() => { tzBefore = process.env.TZ; process.env.TZ = 'America/Sao_Paulo'; });
  after(() => { if (tzBefore === undefined) delete process.env.TZ; else process.env.TZ = tzBefore; });

  test('row labels follow the pt-BR locale in America/Sao_Paulo, newest day first', async () => {
    const { html } = await loadTab();
    const rows = heatRows(html);
    assert.equal(rows.length, 2, 'one heat row per day');
    assert.match(rows[0].label, /04\/10/, `the newest row is labelled 04/10 (got "${rows[0].label}")`);
    assert.equal(rows[0].label.includes('10-04'), false, 'no ISO month-day');
    assert.equal(rows[0].label.startsWith('10/04'), false, 'not month first');
    assert.match(rows[1].label, /03\/10/, `the older row is labelled 03/10 (got "${rows[1].label}")`);
  });

  test('an idle hour gets the faintest level', async () => {
    const { html } = await loadTab();
    const c = cell(html, 0);
    assert.equal(c.classes.includes('an-heat-cell'), true, `cell class (got "${c.classes.join(' ')}")`);
    assert.equal(c.classes.includes('an-heat-l0'), true, 'idle: an-heat-l0');
    assert.equal(levels(c).length, 1, 'exactly one level class');
    assert.equal(c.classes.includes('an-heat-nodata'), false, 'an idle hour is not a no-data hour');
  });

  test('a fully active hour gets the strongest level', async () => {
    const { html } = await loadTab();
    const c = cell(html, 2);
    assert.equal(c.classes.includes('an-heat-l4'), true, `share 1.0: an-heat-l4 (got "${c.classes.join(' ')}")`);
    assert.equal(levels(c).length, 1, 'exactly one level class');
  });

  test('the levels in between climb with the share', async () => {
    const { html } = await loadTab();
    for (const [hour, expected] of [[3, 'an-heat-l1'], [1, 'an-heat-l2'], [4, 'an-heat-l3']]) {
      const c = cell(html, hour);
      assert.equal(levels(c).join(' '), expected, `hour ${hour} (got "${c.classes.join(' ')}")`);
    }
  });

  test('a no-data hour is not an idle hour', async () => {
    const { html } = await loadTab();
    const c = cell(html, 23);
    assert.equal(c.classes.includes('an-heat-cell'), true, 'still a cell');
    assert.equal(c.classes.includes('an-heat-nodata'), true, `null share: an-heat-nodata (got "${c.classes.join(' ')}")`);
    assert.equal(levels(c).length, 0, 'no level class');
    assert.match(c.title, /no data/i, `its tooltip says no data (got "${c.title}")`);
  });

  test('every cell carries exactly one level class or the no-data class', async () => {
    const { html } = await loadTab();
    for (const row of heatRows(html)) {
      assert.equal(row.cells.length, 24, `24 cells in the row ${row.label}`);
      for (const [h, c] of row.cells.entries()) {
        const kinds = levels(c).length + (c.classes.includes('an-heat-nodata') ? 1 : 0);
        assert.equal(kinds, 1, `${row.label} hour ${h}: one kind (got "${c.classes.join(' ')}")`);
      }
    }
  });

  test('the heading says more active hours are stronger, not darker', async () => {
    const { html } = await loadTab();
    const h = heading(html);
    assert.equal(h.includes('(more active hours are stronger)'), true, `caption (got "${h}")`);
    assert.equal(/darker/i.test(h), false, 'no "darker"');
  });

  test('a legend explains idle, fully active and no data with the same swatch classes', async () => {
    const { html } = await loadTab();
    const legend = element(html, 'an-occ-heat-legend');
    const text = visible(legend);
    for (const word of ['idle', 'fully active', 'no data']) assert.equal(text.toLowerCase().includes(word), true, `legend says "${word}" (got "${text}")`);
    for (const cls of ['an-heat-l0', 'an-heat-l1', 'an-heat-l2', 'an-heat-l3', 'an-heat-l4', 'an-heat-nodata']) {
      assert.equal(new RegExp(`class="[^"]*\\b${cls}\\b[^"]*"`).test(legend), true, `a swatch with ${cls}`);
    }
  });

  test("a cell's tooltip says the local day, the hour range, the active minutes and the share", async () => {
    const { html } = await loadTab();
    const t = cell(html, 14).title;
    assert.match(t, /04\/10/, `the day in the owner's format (got "${t}")`);
    assert.match(t, /14:00[–-]15:00/, 'the hour range');
    assert.match(t, /47 min/, 'the active minutes (0.78 × 60)');
    assert.match(t, /78%/, 'the share');
  });

  test('hours stay local: hourly index 14 reads 14:00–15:00 even in America/Sao_Paulo', async () => {
    const { html } = await loadTab();
    const t = cell(html, 14).title;
    assert.match(t, /\b14:00[–-]15:00\b/, `not shifted by the time zone (got "${t}")`);
    assert.equal(/\b(11|17):00/.test(t), false, 'no UTC-shifted hour');
  });

  test('the day chart labels follow the same convention', async () => {
    const { html } = await loadTab();
    const chart = element(html, 'an-occ-days');
    assert.equal(chart.includes('04/10'), true, 'the day chart labels 04/10');
    assert.equal(chart.includes('10-04'), false, 'no ISO month-day in the day chart');
  });
});

// After the change (same sandbox: pt-BR, America/Sao_Paulo). 2026-10-04 is a Sunday: pt-BR's short
// weekday is "dom." (ICU), and 2026-10-03 a Saturday ("sáb.").
describe('#275 24/7 tab: weekdays, local nights, the last hour, a malformed day', () => {
  let tzBefore;
  before(() => { tzBefore = process.env.TZ; process.env.TZ = 'America/Sao_Paulo'; });
  after(() => { if (tzBefore === undefined) delete process.env.TZ; else process.env.TZ = tzBefore; });
  const SUNDAY = /dom\.?,? ?04\/10/;

  test("a cell's tooltip starts with the weekday in the owner's locale", async () => {
    const { html } = await loadTab();
    const t = cell(html, 14).title;
    assert.match(t, SUNDAY, `weekday then day (got "${t}")`);
  });

  test('the last hour of the day wraps its range to midnight', async () => {
    const { html } = await loadTab();
    const t = cell(html, 23).title;
    assert.match(t, /23:00[–-]00:00/, `23:00–00:00, not 24:00 (got "${t}")`);
  });

  test("the day chart's bar tooltips name the weekday and the day", async () => {
    const { html } = await loadTab();
    const titles = [...element(html, 'an-occ-days').matchAll(/<title>([^<]*)<\/title>/g)].map((m) => m[1]);
    assert.equal(titles.length > 0, true, 'the bars have tooltips');
    assert.equal(titles.some((t) => SUNDAY.test(t)), true, `a tooltip of 04/10 with its weekday (got "${titles.join(' | ')}")`);
    assert.equal(titles.some((t) => t.includes('2026-10-04')), false, 'no ISO date in the tooltips');
  });

  test("the cost trend's tooltips name the weekday and the day", async () => {
    const data = payload();
    data.days = data.days.map((d) => ({ ...d, costUsd: 3 }));
    const { html } = await loadTab({ data });
    const dots = [...html.matchAll(/<title>([^<]*per active hour)<\/title>/g)].map((m) => m[1]);
    assert.equal(dots.length, 2, 'one dot per day with activity');
    assert.equal(dots.some((t) => SUNDAY.test(t)), true, `the 04/10 dot (got "${dots.join(' | ')}")`);
    assert.equal(dots.some((t) => t.includes('2026-10-')), false, 'no ISO date in the trend tooltips');
  });

  test("a night's date is the machine's local day of its start, not the UTC day", async () => {
    const data = payload();
    const startedAt = '2026-10-04T02:30:00.000Z'; // 23:30 on Saturday 03/10 in America/Sao_Paulo
    data.nights = [{ startedAt, watch: true, window: { from: startedAt, to: '2026-10-04T11:00:00.000Z' }, occupancy: 0.5, incidents: 0, actions: 1, hoursSaved: 2, costUsd: 1 }];
    const { html } = await loadTab({ data });
    const cellHtml = new RegExp(`<td class="nowrap" title="${startedAt}">([\\s\\S]*?)</td>`).exec(html)?.[1];
    assert.ok(cellHtml, 'the night row shows its start date');
    const text = visible(cellHtml).trim();
    assert.match(text, /s[áa]b\.?,? ?03\/10/, `Saturday 03/10 (got "${text}")`);
    assert.equal(text.includes('2026-10-04'), false, 'not the ISO UTC day');
  });

  test('a malformed day is shown as it is, never as an invalid date', async () => {
    const data = payload();
    data.days[1] = { ...data.days[1], day: 'unknown' };
    const { html } = await loadTab({ data });
    const rows = heatRows(html);
    assert.equal(rows[0].label, 'unknown', 'the raw text is the label');
    assert.equal(/Invalid Date|NaN/.test(html), false, 'no "Invalid Date" or NaN anywhere on the tab');
  });
});
