// #117 acceptance tests (written before the code): a Codex turn on a ChatGPT account has no API price,
// so its cost is unknown. A turn, an agent (session card and detail), a run list row with its sessions'
// total, and the Run screen's total with no price read "unknown" in the interface language ("desconhecido"
// in pt-BR), never "—", "≈ $0.00" nor an amount of 0; a run mixing priced and unpriced turns says its total
// is partial ("partial" / "parcial").
// As renderer-unknown-cost-72.test.js: the run recorded in a temp runs folder (runs.listRuns, sessionView)
// and drawn by the whole page (agent-chat-page-harness.js); a turn through the page's own event handler.
// Assumption: a Codex turn with no price arrives as the engine's session.message_received with
// cost_usd null and no cost_source (the adapter emits costUsd null), i.e. null means "unknown".
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const I18n = require('@craftorio/shared/i18n');
const { textOf } = require('@craftorio/ui-kit/test/mini-dom');
const { loadPage, settle } = require('@craftorio/ui-kit/test/agent-chat-page-harness');
const H = require('./roadmap-status-helpers');

const RUN_ID = '20261127-120428-a9d41117';
const WORD = { en: /unknown/i, 'pt-BR': /desconhecido/i };
const PARTIAL = { en: /partial/i, 'pt-BR': /parcial/i };
const ZERO = /\$\s*0[.,]00/;

test.afterEach(() => I18n.setLanguage('en'));

const tokens = { input: 1e6, output: 2000, cache_read: 0, cache_write: 0, reasoning: 500 };
const ORCHESTRATOR = { id: 'orchestrator', agent: 'orchestrator', provider: 'engine', model: 'engine', turns: 0, status: 'success', tokens: {}, cost_usd: 0 };
// a Codex session on a ChatGPT account: nothing recorded, no price for its model
const CODEX = { id: 's-developer', agent: 'developer', provider: 'codex', model: 'gpt-6-luna', step_id: 'develop', turns: 1, status: 'success', mode: 'ephemeral', tokens, cost_usd: 0, provider_session_id: 'cli-dev' };
const CLAUDE = { id: 's-reviewer', agent: 'reviewer', provider: 'claude', model: 'claude-opus-5-5', step_id: 'review', turns: 1, status: 'success', mode: 'ephemeral', tokens: { input: 1000, output: 2000, cache_read: 0, cache_write: 0, reasoning: 0 }, cost_usd: 0.93, provider_session_id: 'cli-rev' };

function recorded(t, sessions) {
  const runs = require('@craftorio/engine/domains/run/runs');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'renderer-unknown-cost-117-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const at = H.iso(H.NOW - 2 * H.HOUR);
  const end = H.iso(H.NOW - H.HOUR);
  fs.mkdirSync(path.join(dir, RUN_ID));
  fs.writeFileSync(path.join(dir, RUN_ID, 'events.jsonl'), `${JSON.stringify({ seq: 1, run_id: RUN_ID, ts: at, type: 'workflow.started', workflow: 'w', file: 'wf-117.yaml', mock: false, inputs: { task: 'Fix it' } })}\n`);
  fs.writeFileSync(path.join(dir, RUN_ID, 'summary.json'), JSON.stringify({ run_id: RUN_ID, workflow: 'w', status: 'success', mock: false, inputs: { task: 'Fix it' }, started_at: at, finished_at: end, duration_ms: H.HOUR, cost_usd: sessions.reduce((a, s) => a + (s.cost_usd || 0), 0), sessions }));
  return runs.listRuns(dir);
}
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
async function runScreen(lang, sessions) {
  const page = await pageIn(lang);
  page.sandbox.__run = { id: RUN_ID, status: 'success', workflow: 'w', inputs: {}, startedAt: H.NOW - 2 * H.HOUR, finishedAt: H.NOW - H.HOUR };
  page.sandbox.__sessions = [ORCHESTRATOR, ...sessions];
  page.run(`(() => {
    const v = { ...newRunView(), run: __run, past: true, sessions: new Map(__sessions.map((s) => [s.id, { ...s, turnLog: new Map() }])) };
    state.view = 'run'; state.runs.set(__run.id, v); state.runId = __run.id; state.selected = __sessions[1].id;
    renderSessions(); renderDetail();
  })()`);
  await settle(20);
  return page;
}
const cardCost = (page, id) => textOf(page.$(`.session-card[data-id="${id}"] [data-testid="session-cost"]`)).trim();
const detailCost = (page) => textOf([...page.$('#tab-detail').querySelectorAll('.detail-head dd')].at(-1)).trim();
const runTotal = (page) => textOf(page.$('.session-card[data-id="orchestrator"] [data-testid="run-total-cost"]')).trim();

async function listRowHtml(lang, list) {
  const page = await pageIn(lang);
  page.sandbox.__row = listed(list);
  return page.run('runListRow(__row, { expanded: new Set([__row.runId]), msgs: new Map(), columns: new Map() })');
}
const rowCost = (html) => H.visibleText(H.findEl(html, (e) => e.attrs.class === 'pr-row').inner);
const totalRow = (html) => H.visibleText(H.findEl(html, (e) => e.attrs['data-testid'] === 'run-total-cost').inner);

for (const lang of ['en', 'pt-BR']) {
  test(`#117 Run screen (${lang}): a Codex session with no price reads unknown in its card, not "—" nor $0`, { timeout: 60000 }, async () => {
    const card = cardCost(await runScreen(lang, [CODEX]), 's-developer');
    assert.match(card, WORD[lang]);
    assert.doesNotMatch(card, /—|\$/);
  });

  test(`#117 Run screen (${lang}): a Codex session with no price reads unknown in its detail, not "—" nor $0`, { timeout: 60000 }, async () => {
    const detail = detailCost(await runScreen(lang, [CODEX]));
    assert.match(detail, WORD[lang]);
    assert.doesNotMatch(detail, /—|\$/);
  });

  test(`#117 Run screen (${lang}): the total of a run whose only agent turns have no price reads unknown, not "≈ $0.00"`, { timeout: 60000 }, async () => {
    const total = runTotal(await runScreen(lang, [CODEX]));
    assert.match(total, WORD[lang]);
    assert.doesNotMatch(total, ZERO);
  });

  test(`#117 Run screen (${lang}): the total of a run mixing priced and unpriced turns says it is partial`, { timeout: 60000 }, async () => {
    const total = runTotal(await runScreen(lang, [CLAUDE, CODEX]));
    assert.match(total, PARTIAL[lang]);
    assert.match(total, /0[.,]93/);
  });

  test(`#117 run list (${lang}): a run whose only agent turns have no price reads unknown in its row and its sessions' total`, { timeout: 60000 }, async (t) => {
    const html = await listRowHtml(lang, recorded(t, [ORCHESTRATOR, CODEX]));
    assert.match(rowCost(html), WORD[lang]);
    assert.doesNotMatch(rowCost(html), ZERO);
    assert.match(totalRow(html), WORD[lang]);
    assert.doesNotMatch(totalRow(html), ZERO);
  });
}

test('#117 run list (pt-BR): a run mixing priced and unpriced turns says its total is partial', { timeout: 60000 }, async (t) => {
  const html = await listRowHtml('pt-BR', recorded(t, [ORCHESTRATOR, CLAUDE, CODEX]));
  assert.match(totalRow(html), /parcial/i);
});

// a Codex turn as the page receives it, through its event handler
async function codexTurnHead(lang) {
  const page = await pageIn(lang);
  const fire = (ev) => { for (const fn of page.handlers.onEvent || []) fn({ run_id: RUN_ID, ...ev }); };
  const ts = (s) => new Date(Date.UTC(2026, 10, 27, 12, 0, s)).toISOString();
  const snap = { ...CODEX, tokens: { input: 0, output: 0, cache_read: 0, cache_write: 0, reasoning: 0 }, turns: 0, cost_usd: 0, status: 'idle' };
  fire({ seq: 1, ts: ts(0), type: 'workflow.started', workflow: 'w', version: '1', mock: false, cost_accounting: 'per_turn', inputs: {}, steps: [{ id: 'develop', agent: 'developer' }] });
  fire({ seq: 2, ts: ts(1), type: 'session.opened', session_id: 's-developer', session: snap });
  fire({ seq: 3, ts: ts(2), type: 'session.message_sent', session_id: 's-developer', turn: 1, step_id: 'develop', prompt: 'Do it.' });
  fire({ seq: 4, ts: ts(3), type: 'session.stream', session_id: 's-developer', turn: 1, item: { kind: 'text', text: 'Done.' } });
  fire({ seq: 5, ts: ts(9), type: 'session.message_received', session_id: 's-developer', turn: 1, step_id: 'develop', text: 'Done.', usage: { input: 1000, output: 200, cache_read: 0, cache_write: 0, reasoning: 100 }, cost_usd: null, duration_ms: 6000, session: { ...snap, turns: 1, status: 'idle', tokens: { input: 1000, output: 200, cache_read: 0, cache_write: 0, reasoning: 100 } } });
  await settle(20);
  page.run(`state.view = 'run'; state.runId = ${JSON.stringify(RUN_ID)}; state.selected = 's-developer'; renderDetail()`);
  await settle(5);
  const heads = [...page.$('#tab-detail').querySelectorAll('.turn-head .meta')].map((x) => textOf(x).trim());
  assert.equal(heads.length, 1, 'the Run screen draws the Codex turn');
  return heads[0];
}

for (const lang of ['en', 'pt-BR']) {
  test(`#117 Run screen (${lang}): a Codex turn with no price reads unknown in its head, not "—" nor $0`, { timeout: 60000 }, async () => {
    const head = await codexTurnHead(lang);
    assert.match(head, WORD[lang]);
    assert.doesNotMatch(head, /—|\$\s*0[.,]0/);
  });
}
