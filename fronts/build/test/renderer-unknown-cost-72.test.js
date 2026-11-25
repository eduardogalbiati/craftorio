// #72 acceptance tests (written before the code): how the roadmap, the run list and the Run screen
// show a total that includes a turn of unknown cost (a model the CLI does not know and the app has no
// price for): marked "at least" or "≈" (pt-BR "pelo menos" / "ao menos" / "no mínimo" or the sign),
// in en and pt-BR, and a run whose costs are all known unmarked.
// The data goes through the engine (a recorded run in a temp runs folder: runs.listRuns, sessionView,
// cost-estimate.withEstimates) and into the renderer as the service sends it, so no field name is
// assumed here. Roadmap: roadmap-status-helpers.js. Run list and Run screen: the whole page
// (agent-chat-page-harness.js). Visible text only, titles don't count.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const I18n = require('@craftorio/shared/i18n');
const { textOf } = require('@craftorio/ui-kit/test/mini-dom');
const { loadPage, settle } = require('@craftorio/ui-kit/test/agent-chat-page-harness');
const H = require('./roadmap-status-helpers');

const MARK = /≈|≥|at least|pelo menos|ao menos|no mínimo/i;
const UNKNOWN = 'claude-unknown-9';
const RUN_ID = '20261125-070829-c5c50072';
const WF = 'wf-72.yaml'; // not the roadmap item's workflow: no past run to estimate from, so no "≈" of an estimate
const LANGS = ['en', 'pt-BR'];

test.afterEach(() => I18n.setLanguage('en'));

const session = (agent, model, cost, extra = {}) => ({
  id: `s-${agent}`, agent, provider: 'claude', model, step_id: agent, turns: 1, status: 'success', mode: 'ephemeral',
  tokens: { input: 1000, output: 2000, cache_read: 0, cache_write: 0, reasoning: 0 }, cost_usd: cost, provider_session_id: `cli-${agent}`, ...extra,
});
const ORCHESTRATOR = { id: 'orchestrator', agent: 'orchestrator', provider: 'engine', model: 'engine', turns: 0, status: 'success', tokens: {}, cost_usd: 0 };
const KNOWN_ONLY = [ORCHESTRATOR, session('developer', 'claude-opus-5-5', 0.93)];
const WITH_UNKNOWN = [...KNOWN_ONLY, session('reviewer', UNKNOWN, null, { cost_estimate: { source: 'unknown', model: UNKNOWN, cli_version: '2.1.316', cli_cost_usd: 0.24 } })];

// the recorded real run, as the run list reads it
function recorded(t, sessions) {
  const runs = require('@craftorio/engine/domains/run/runs');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'renderer-unknown-cost-72-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const at = H.iso(H.NOW - 2 * H.HOUR);
  const end = H.iso(H.NOW - H.HOUR);
  fs.mkdirSync(path.join(dir, RUN_ID));
  fs.writeFileSync(path.join(dir, RUN_ID, 'events.jsonl'), `${JSON.stringify({ seq: 1, run_id: RUN_ID, ts: at, type: 'workflow.started', workflow: 'w', file: WF, mock: false, inputs: { task: 'Fix it' } })}\n`);
  fs.writeFileSync(path.join(dir, RUN_ID, 'summary.json'), JSON.stringify({ run_id: RUN_ID, workflow: 'w', status: 'success', mock: false, inputs: { task: 'Fix it' }, started_at: at, finished_at: end, duration_ms: H.HOUR, cost_usd: 0.93, sessions }));
  return runs.listRuns(dir);
}
// "US$ 0,93", "$0.9300" → 93 (the first amount of a text, in cents)
function centsIn(text) {
  const m = /\$\s*(\d+)[.,](\d+)/.exec(text.replace(/ /g, ' '));
  assert.ok(m, `an amount in "${text}"`);
  return Math.round(Number(`${m[1]}.${m[2]}`) * 100);
}

// ---- the roadmap -----------------------------------------------------------------------------------

function roadmapPage(list) {
  const { withEstimates } = require('@craftorio/engine/domains/usage/cost-estimate');
  const out = H.loadRoadmap();
  out.sandbox.navigator = { platform: 'linux' };
  out.sandbox.api.platform = 'linux';
  vm.runInContext(H.read('term-dock.js'), out.sandbox);
  vm.runInContext(H.read('views', 'backlog', 'backlog-live.js'), out.sandbox);
  vm.runInContext(H.read('..', '..', '..', 'packages', 'shared', 'roadmap-summary.js'), out.sandbox);
  const run = H.run({ status: 'success', startedAt: H.iso(H.NOW - 2 * H.HOUR), finishedAt: H.iso(H.NOW - H.HOUR) });
  const item = H.item('a', 'done', 1, 'Issue 1', { origin: H.iso(H.NOW - H.HOUR), mock: false, runId: RUN_ID, runs: [RUN_ID], run });
  const roadmap = withEstimates({ state: 'running', stages: [{ id: 's1', name: '', note: '', items: [item] }] }, list);
  return out.R.html({ roadmap, issues: [{ number: 1, title: 'Issue 1', labels: [] }] }, () => {}, { showAll: true, since: 'total' });
}
const meterText = (page) => H.visibleText(H.findEl(H.itemEl(page, 'a').outer, (e) => e.attrs['data-testid'] === 'roadmap-meter-cost').inner);
function spentText(page) {
  const stats = H.findAll(page, (e) => String(e.attrs.class || '').split(/\s+/).includes('rm-head-stats'))[0];
  assert.ok(stats, 'the header\'s rm-head-stats band');
  const cols = H.elements(stats.outer).filter((e) => e.parent && e.parent.start === 0 && e.start > 0).map((e) => H.textNodes(e.inner));
  return cols[3].join(' ');
}

for (const lang of LANGS) {
  test(`#72 roadmap (${lang}): a done item whose run includes an unknown cost marks its cost and the header's Spent`, (t) => {
    I18n.setLanguage(lang);
    const page = roadmapPage(recorded(t, WITH_UNKNOWN));
    assert.match(meterText(page), MARK);
    assert.match(spentText(page), MARK);
  });
}

test('#72 roadmap: a done item whose costs are all known is not marked, $0.93', (t) => {
  const page = roadmapPage(recorded(t, KNOWN_ONLY));
  assert.match(meterText(page), /\$0\.93/);
  assert.doesNotMatch(meterText(page), MARK);
  assert.match(spentText(page), /\$0\.93/);
  assert.doesNotMatch(spentText(page), MARK);
});

// ---- the run list and the Run screen ----------------------------------------------------------------

// the run as the service lists it: its row plus its sessions through sessionView
function listed(list) {
  const { sessionView } = require('@craftorio/engine/service/common');
  const [r] = list;
  return { ...r, sessions: r.sessions.map((s) => sessionView(s, false)) };
}
async function pageIn(lang) {
  const page = await loadPage();
  page.sandbox.__lang = lang;
  page.run('I18n.setLanguage(__lang)');
  return page;
}
async function listRowHtml(lang, list) {
  const page = await pageIn(lang);
  page.sandbox.__row = listed(list);
  return page.run('runListRow(__row, { expanded: new Set([__row.runId]), msgs: new Map(), columns: new Map() })');
}
const rowCost = (html) => H.visibleText(H.findEl(html, (e) => e.attrs.class === 'pr-row').inner);
const totalRow = (html) => H.visibleText(H.findEl(html, (e) => e.attrs['data-testid'] === 'run-total-cost').inner);

async function runScreenTotal(lang, list) {
  const page = await pageIn(lang);
  page.sandbox.__run = { id: RUN_ID, status: 'success', workflow: 'w', inputs: {}, startedAt: H.NOW - 2 * H.HOUR, finishedAt: H.NOW - H.HOUR };
  page.sandbox.__sessions = list[0].sessions;
  page.run(`(() => {
    const v = { ...newRunView(), run: __run, past: true, sessions: new Map(__sessions.map((s) => [s.id, s])) };
    state.view = 'run'; state.runs.set(__run.id, v); state.runId = __run.id;
    renderSessions();
  })()`);
  await settle(20);
  const label = page.run("I18n.t('run.total_cost')");
  const metrics = [...page.$('#sessions').querySelectorAll('.session-card[data-id="orchestrator"] .metric')];
  const text = metrics.map((m) => textOf(m).trim()).find((x) => x.startsWith(label));
  assert.equal(typeof text, 'string', 'the Run screen has a total cost');
  return text;
}

for (const lang of LANGS) {
  test(`#72 run list (${lang}): a run that includes an unknown cost marks its cost and its sessions' total`, async (t) => {
    const html = await listRowHtml(lang, recorded(t, WITH_UNKNOWN));
    assert.match(rowCost(html), MARK);
    assert.match(totalRow(html), MARK);
  });

  test(`#72 Run screen (${lang}): the total cost of a run that includes an unknown cost is marked`, async (t) => {
    assert.match(await runScreenTotal(lang, recorded(t, WITH_UNKNOWN)), MARK);
  });
}

test('#72 the Run screen, the run list\'s row and its sessions\' total show the same amount as Usage for a run that includes an unknown cost', async (t) => {
  const list = recorded(t, WITH_UNKNOWN);
  const usage = require('@craftorio/engine/domains/usage/usage');
  const row = usage.computeUsage({ runsDir: path.dirname(list[0].runDir), now: new Date(H.NOW) }).runs[0];
  const html = await listRowHtml('en', list);
  const seen = { Usage: Math.round(row.costUsd * 100), 'Run screen': centsIn(await runScreenTotal('en', list)), 'run list': centsIn(rowCost(html)), 'sessions total': centsIn(totalRow(html)) };
  assert.equal(new Set(Object.values(seen)).size, 1, `one amount, in cents: ${JSON.stringify(seen)}`);
});

test('#72 the Run screen and the run list leave a run whose costs are all known unmarked', async (t) => {
  const list = recorded(t, KNOWN_ONLY);
  const html = await listRowHtml('en', list);
  assert.doesNotMatch(rowCost(html), MARK);
  assert.doesNotMatch(totalRow(html), MARK);
  assert.doesNotMatch(await runScreenTotal('en', list), MARK);
});

// ---- the Run screen's sessions, turns and child runs (after the code) ----------------------------------

const ESTIMATE = { source: 'unknown', model: UNKNOWN, cli_version: '2.1.316', cli_cost_usd: 0.24, unknown_cli_usd: 0.24 };
// its last turn had a price (US$ 0.50 recorded), a turn before it had none (the CLI said US$ 0.10)
const MIXED = session('reviewer', UNKNOWN, 0.5, { cost_estimate: { source: 'tokens', model: UNKNOWN, cli_cost_usd: 0.9, unknown_cli_usd: 0.1 } });

// the Run screen of a run with these sessions, the first one selected
async function runScreen(lang, sessions, { run = {}, turnLog } = {}) {
  const page = await pageIn(lang);
  page.sandbox.__run = { id: RUN_ID, status: 'success', workflow: 'w', inputs: {}, startedAt: H.NOW - 2 * H.HOUR, finishedAt: H.NOW - H.HOUR, ...run };
  page.sandbox.__sessions = [ORCHESTRATOR, ...sessions];
  page.sandbox.__turns = turnLog || [];
  page.run(`(() => {
    const v = { ...newRunView(), run: __run, past: true, sessions: new Map(__sessions.map((s) => [s.id, { ...s, turnLog: new Map(__turns.map((x) => [x.n, x])) }])) };
    state.view = 'run'; state.runs.set(__run.id, v); state.runId = __run.id; state.selected = __sessions[1].id;
    renderSessions(); renderDetail();
  })()`);
  await settle(20);
  return page;
}
const cardCost = (page, id) => textOf(page.$(`.session-card[data-id="${id}"] [data-testid="session-cost"]`)).trim();
// the cost of the selected session's detail (the last dd of its head) and its turns' heads
const detailCost = (page) => textOf([...page.$('#tab-detail').querySelectorAll('.detail-head dd')].at(-1)).trim();
const turnHeads = (page) => [...page.$('#tab-detail').querySelectorAll('.turn-head .meta')].map((x) => textOf(x).trim());

for (const [lang, word] of [['en', 'unknown'], ['pt-BR', 'desconhecido']]) {
  test(`#72 Run screen (${lang}): a session whose only turn is unknown, and that turn, read "${word}", never 0.0000`, async () => {
    const result = { usage: { input: 1, output: 1 }, duration: 1000 };
    const page = await runScreen(lang, [session('reviewer', UNKNOWN, 0, { cost_estimate: ESTIMATE })], {
      turnLog: [{ n: 1, items: [], result: { ...result, cost: null, unknown: true } }, { n: 2, items: [], result: { ...result, cost: 0.4 } }],
    });
    assert.match(cardCost(page, 's-reviewer'), new RegExp(`^${word}`));
    assert.match(detailCost(page), new RegExp(`^${word}`));
    assert.doesNotMatch(cardCost(page, 's-reviewer') + detailCost(page), /0[.,]0000/);
    const [unknown, known] = turnHeads(page);
    assert.match(unknown, new RegExp(word));
    assert.match(known, /0[.,]4000/);
    assert.doesNotMatch(known, new RegExp(word));
  });
}

test('#72 Run screen: a session with known turns and an unknown last one shows its amount marked, in the card and the detail', async () => {
  const page = await runScreen('en', [session('reviewer', UNKNOWN, 0.5, { cost_estimate: ESTIMATE })]);
  assert.match(cardCost(page, 's-reviewer'), /≈ \$0\.5000/);
  assert.match(detailCost(page), /≈ \$0\.5000/);
});

test('#72 Run screen: a session with an unknown turn followed by a priced one is marked too', async () => {
  const page = await runScreen('en', [MIXED]);
  assert.match(cardCost(page, 's-reviewer'), MARK);
  assert.match(detailCost(page), MARK);
});

// the child runs' costs on the Run screen: the orchestrator's card, and the strip of child run links
const CHILDREN = (mark) => [{ run_id: 'c1', step_id: 'fan', workflow: 'w', status: 'success', cost_usd: 0.5, ...mark }];
async function childCosts(mark) {
  const page = await runScreen('en', [session('developer', 'claude-opus-5-5', 0.93)], { run: { childRuns: CHILDREN(mark) } });
  const label = page.run("I18n.t('run.child_runs_cost')");
  const card = [...page.$('#sessions').querySelectorAll('.session-card[data-id="orchestrator"] .metric')].map((m) => textOf(m).trim()).find((x) => x.startsWith(label));
  page.sandbox.__parent = { childRuns: CHILDREN(mark) };
  return { card, strip: H.visibleText(page.run('childRunsStrip(__parent)')) };
}

test('#72 Run screen: the child runs\' cost of the orchestrator\'s card is marked when a child\'s includes an unknown one, only then', async () => {
  assert.match((await childCosts({ cost_approx: true })).card, /≈ \$0\.5000/);
  assert.doesNotMatch((await childCosts({})).card, MARK);
});

test('#72 Run screen: the strip of child runs gives the same marked cost as the orchestrator\'s card', async () => {
  assert.match((await childCosts({ cost_approx: true })).strip, /≈ \$0\.5000/);
  assert.doesNotMatch((await childCosts({})).strip, MARK);
});
