// #72 acceptance tests (written before the code): Usage and the header's usage counter mark a total
// that includes a turn of unknown cost ("at least" or "≈", and their pt-BR words), in en and pt-BR; a
// total of known costs stays unmarked.
// The usage is the engine's own answer (usage.computeUsage over a recorded run, plus budget.budgetState
// for the header's "today"), given to the whole page (agent-chat-page-harness.js) by api.getUsage, so no
// field name is assumed here. Visible text only, titles don't count.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { textOf } = require('@craftorio/ui-kit/test/mini-dom');
const { loadPage, settle } = require('@craftorio/ui-kit/test/agent-chat-page-harness');

const MARK = /≈|≥|at least|pelo menos|ao menos|no mínimo/i;
const NOW = new Date('2026-11-25T12:00:00Z');
const UNKNOWN = 'claude-unknown-9';
const RUN_ID = '20261125-070829-c5c50072';

const session = (agent, model, cost, extra = {}) => ({
  id: `s-${agent}`, agent, provider: 'claude', model, turns: 1, status: 'success', cost_usd: cost,
  tokens: { input: 1000, output: 2000, cache_read: 0, cache_write: 0, reasoning: 0 }, ...extra,
});
const KNOWN_ONLY = [session('developer', 'claude-opus-5-5', 0.93)];
const WITH_UNKNOWN = [...KNOWN_ONLY, session('reviewer', UNKNOWN, null, { cost_estimate: { source: 'unknown', model: UNKNOWN, cli_version: '2.1.316', cli_cost_usd: 0.24 } })];

// what usage:get answers for one recorded real run
function usageOf(t, sessions) {
  const usage = require('@craftorio/engine/domains/usage/usage');
  const budget = require('@craftorio/engine/domains/usage/budget');
  const runs = require('@craftorio/engine/domains/run/runs');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'usage-unknown-cost-72-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const at = '2026-11-25T07:08:29.000Z';
  fs.mkdirSync(path.join(dir, RUN_ID));
  fs.writeFileSync(path.join(dir, RUN_ID, 'events.jsonl'), `${JSON.stringify({ seq: 1, run_id: RUN_ID, ts: at, type: 'workflow.started', workflow: 'w', file: 'w.yaml', mock: false, inputs: {} })}\n`);
  fs.writeFileSync(path.join(dir, RUN_ID, 'summary.json'), JSON.stringify({ run_id: RUN_ID, workflow: 'w', status: 'success', mock: false, inputs: {}, started_at: at, finished_at: at, duration_ms: 1000, cost_usd: 0.93, sessions }));
  const state = budget.budgetState({ settings: { timeZone: 'UTC' }, runs: runs.listRuns(dir), now: NOW });
  return {
    ...usage.computeUsage({ runsDir: dir, now: NOW, installed: { claude: true } }),
    spending: { ...state, caps: budget.budgetSettings({}), text: budget.meterText(state) },
  };
}

// the Usage screen's and the header's visible texts
async function usageTexts(t, sessions, lang) {
  const u = usageOf(t, sessions);
  const page = await loadPage({ api: { getUsage: async () => u } });
  page.sandbox.__lang = lang;
  page.sandbox.__u = u;
  page.run("I18n.setLanguage(__lang); state.usageScope = 'orchestrator'; state.usage = __u; renderUsageWidget(); renderUsage();");
  await settle(20);
  const label = (key) => page.run(`I18n.t('${key}')`);
  const stats = [...page.$('#usage-cards').querySelectorAll('[data-provider="claude"] .u-stat')].map((x) => textOf(x).trim());
  const stat = (key) => stats.find((x) => x.startsWith(label(key)));
  const model = [...page.$('#usage-cards').querySelectorAll('[data-provider="claude"] tbody tr')].map((x) => textOf(x)).find((x) => x.includes(UNKNOWN));
  page.sandbox.__box = page.document.createElement('div');
  page.run('__box.innerHTML = runsTableHtml(__u);');
  return {
    month: stat('usage.month_cost'), today: stat('usage.cost_today'), model,
    runRow: textOf(page.sandbox.__box.querySelector('tbody tr')),
    counter: textOf(page.$('#usage-widget-text')), counterToday: textOf(page.$('#usage-widget-today')),
  };
}

for (const lang of ['en', 'pt-BR']) {
  test(`#72 Usage (${lang}): the month, the day and the run's row are marked when they include an unknown cost`, async (t) => {
    const x = await usageTexts(t, WITH_UNKNOWN, lang);
    for (const key of ['month', 'today', 'runRow']) assert.match(String(x[key]), MARK, key);
  });

  test(`#72 header (${lang}): the usage counter's month and today are marked when they include an unknown cost`, async (t) => {
    const x = await usageTexts(t, WITH_UNKNOWN, lang);
    for (const key of ['counter', 'counterToday']) assert.match(String(x[key]), MARK, key);
  });
}

test('#72 Usage: a model whose every turn has an unknown cost reads "unknown" or an amount marked as an estimate, never a bare amount', async (t) => {
  const x = await usageTexts(t, WITH_UNKNOWN, 'en');
  assert.equal(typeof x.model, 'string', `Usage lists ${UNKNOWN}`);
  assert.match(x.model.replace(UNKNOWN, ''), /unknown|no price|estimat|≈|≥|at least|—/i);
});

test('#72 Usage and the header: totals of known costs are not marked', async (t) => {
  const x = await usageTexts(t, KNOWN_ONLY, 'en');
  for (const key of ['month', 'today', 'runRow', 'counter', 'counterToday']) {
    assert.doesNotMatch(String(x[key]), MARK, key);
    assert.match(String(x[key]), /0\.93/, key);
  }
});
