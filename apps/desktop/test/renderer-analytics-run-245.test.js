// Analytics › Run tab (apps/desktop/renderer/views/analytics/analytics-run.js) names steps and agents as people
// read them (#245): the step table, the per-agent charts and the timeline's visible labels show no
// snake_case step or agent id; the ids stay in tooltips (title). The tab runs in a vm sandbox with the
// app.js globals it uses stubbed and the real displayName.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
// a page file by its page-relative name, in whichever layer holds it (the UI kit, a front, the page folder)
const pageFileOf = (rel) => require('../../../scripts/source-tree').pageFile(path.join(__dirname, '..', '..', '..'), rel);
const vm = require('vm');
const { withI18n } = require('@multiagent/shared/test/i18n-sandbox.js');
const { displayName } = require('@multiagent/shared/display-name.js');

const FILE = pageFileOf('views/analytics/analytics-run.js');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const T = (min) => new Date(Date.UTC(2026, 9, 4, 10, min)).toISOString();
const agent = (name, extra = {}) => ({
  agent: name, activeMs: 60000, waitingMs: 10000, turns: 2, costUsd: 1.5, totalTokens: 1000, usdPerMTokens: 3,
  tokens: { input: 400, output: 300, cache_read: 200, cache_write: 100 }, ...extra,
});
const FIGURES = {
  runId: 'run-245', title: 'Readable names', workflow: 'AI development (local hero)', file: 'ai-development-local-hero.yaml',
  status: 'success', mock: true, startedAt: T(0), finishedAt: T(40), issues: [245],
  costUsd: 3, costPerIssue: 3, durationMs: 2400000, activeMs: 2000000, gateWaitMs: 400000,
  gates: [{ gate: 'human_review', from: T(38), to: T(40), waitMs: 120000 }], suiteRounds: [], slowestTools: [],
  timeline: [
    { row: 'test_writer', step: 'acceptance_tests', visit: 1, from: T(0), to: T(15), durationMs: 900000, costUsd: 1.5 },
    { row: 'orchestrator', step: 'red_check', visit: 1, from: T(15), to: T(20), durationMs: 300000 },
    { row: 'developer', step: 'verify_change', visit: 1, from: T(20), to: T(40), durationMs: 1200000, costUsd: 1.5 },
  ],
  agents: [agent('test_writer'), agent('developer')],
  steps: [
    { step: 'acceptance_tests', agent: 'test_writer', visits: 1, durationMs: 900000 },
    { step: 'red_check', agent: null, visits: 1, durationMs: 300000 },
    { step: 'verify_change', agent: 'developer', visits: 1, durationMs: 1200000 },
  ],
};

async function renderTab(figures = FIGURES) {
  const window = {};
  const sandbox = {
    window, console, displayName,
    StatusPill: require('@multiagent/ui-kit/status-pill.js'), // the real readable statuses (#266)
    sessionStorage: { getItem: () => null, setItem: () => {} },
    api: { getRunAnalysis: async () => ({ runs: [{ runId: figures.runId, title: figures.title, status: 'success', workflow: figures.workflow }], figures, comparison: null }) },
    esc, errMsg: (e) => String(e?.message || e),
    fmtDur: (ms) => `${Math.round((ms || 0) / 1000)}s`, fmtUsd: (v) => `$${Number(v || 0).toFixed(2)}`,
    fmtNum: (v) => String(v ?? 0), fmtTok: (v) => String(v ?? 0), dateOf: (s) => String(s).slice(0, 10),
    costMarks: () => '',
  };
  vm.createContext(withI18n(sandbox));
  vm.runInContext(fs.readFileSync(FILE, 'utf8'), sandbox, { filename: FILE });
  const tab = window.AnalyticsTabs.run;
  await tab.load();
  const body = { innerHTML: '', querySelector: () => null, querySelectorAll: () => [] };
  tab.render(body);
  return body.innerHTML;
}

// what a person reads: tags (so title/aria-label attributes) dropped, <title> tooltips of the SVG too
const visible = (html) => html.replace(/<title>[\s\S]*?<\/title>/g, ' ').replace(/<code[\s\S]*?<\/code>/g, ' ')
  .replace(/<[^>]*>/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ');
const IDS = ['acceptance_tests', 'red_check', 'verify_change', 'test_writer', 'human_review'];
const leaks = (text) => IDS.filter((id) => new RegExp(`\\b${id}\\b`).test(text));

const stepTable = (html) => html.slice(html.indexOf('<th>Step</th>'), html.indexOf('Suite rounds</h3>'));

test('#245 Analytics Run tab: the step table names steps and agents readably, the ids in their tooltips', async () => {
  const table = stepTable(await renderTab());
  for (const name of ['Acceptance tests', 'Red check', 'Verify change', 'Test writer']) assert.match(visible(table), new RegExp(name));
  assert.deepEqual(leaks(visible(table)), []);
  assert.match(table, /title="acceptance_tests"/);
  assert.match(table, /title="test_writer"/);
});

test('#245 Analytics Run tab: the per-agent charts (time, turns, cost, tokens) name agents readably, not "test_writer"', async () => {
  const html = await renderTab();
  const charts = html.slice(html.indexOf('Time per agent'), html.indexOf('<th>Step</th>'));
  assert.match(visible(charts), /Test writer/);
  assert.deepEqual(leaks(visible(charts)), []);
});

// #308: the Tokens per agent bar says how much of the agent's tokens its sub-agents made, only when they ran
const tokenBars = (html) => html.slice(html.indexOf('Tokens per agent'), html.indexOf('<th>Step</th>'));

test('#308 Analytics Run tab: an agent whose turns started sub-agents shows their calls and tokens in its Tokens per agent bar', async () => {
  const html = tokenBars(await renderTab({ ...FIGURES, agents: [agent('test_writer'), agent('developer', { subagents: { calls: 3, tokens: 812200 } })] }));
  const marks = [...html.matchAll(/data-testid="an-agent-subagents"[^>]*>([^<]*)</g)].map((m) => m[1]);
  assert.equal(marks.length, 1);
  assert.match(marks[0], /of which sub-agents: 3 calls, 812200 tokens/);
  assert.equal((html.match(/data-testid="an-agent-tokens"/g) || []).length, 2);
});

test('#308 Analytics Run tab: agents without sub-agents (and runs recorded before #308) show no sub-agents mark', async () => {
  const html = tokenBars(await renderTab());
  assert.equal(html.includes('an-agent-subagents'), false);
  assert.doesNotMatch(visible(html), /sub-agents/);
});

test('#245 Analytics Run tab: the timeline\'s visible labels (bars and agent rows) show no step or agent id', async () => {
  const html = await renderTab();
  const gantt = html.slice(html.indexOf('data-testid="an-run-timeline"'), html.indexOf('Time per agent'));
  const labels = [...gantt.matchAll(/<text[^>]*>([^<]*)<\/text>/g)].map((m) => m[1]).join(' | ');
  assert.match(labels, /Acceptance tests/);
  assert.match(labels, /Test writer/);
  assert.deepEqual(leaks(labels), [], `timeline labels: ${labels}`);
});

test('#245 Analytics Run tab: nothing on the tab shows a snake_case step or agent id', async () => {
  assert.deepEqual(leaks(visible(await renderTab())), []);
});
