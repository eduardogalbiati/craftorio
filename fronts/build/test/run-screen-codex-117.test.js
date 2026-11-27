// #117 acceptance tests (written before the code): a Codex step on the Run screen and the run list.
// - Provider tag: a Codex session is tagged with its CLI and its model ("Codex · gpt-6-luna"), never with
//   the account type "CHATGPT".
// - No reasoning shown: a Codex session whose turns report reasoning tokens but stream no thinking item
//   says once that the CLI does not show its reasoning, instead of showing nothing.
// Seams: the whole page (agent-chat-page-harness.js): the Run screen's session cards and detail
// (renderSessions / renderDetail), the run list's row with its sessions (runListRow). Visible text only.
// Assumptions: the account the session ran on is recorded as `account: 'chatgpt'` (#312); the sentence
// about the reasoning says the CLI "does not show its reasoning" (the issue's words; "doesn't" accepted).
const test = require('node:test');
const assert = require('node:assert/strict');
const I18n = require('@craftorio/shared/i18n');
const { textOf } = require('@craftorio/ui-kit/test/mini-dom');
const { loadPage, settle } = require('@craftorio/ui-kit/test/agent-chat-page-harness');
const H = require('./roadmap-status-helpers');

const RUN_ID = '20261127-120428-b9d41117';
test.afterEach(() => I18n.setLanguage('en'));

const ORCHESTRATOR = { id: 'orchestrator', agent: 'orchestrator', provider: 'engine', model: 'engine', turns: 0, status: 'success', tokens: {}, cost_usd: 0 };
const CODEX = {
  id: 's-developer', agent: 'developer', provider: 'codex', model: 'gpt-6-luna', account: 'chatgpt', step_id: 'develop', turns: 2, status: 'success', mode: 'ephemeral',
  tokens: { input: 5000, output: 900, cache_read: 0, cache_write: 0, reasoning: 400 }, cost_usd: 0, provider_session_id: 'cli-dev',
};
const result = (reasoning) => ({ usage: { input: 2500, output: 450, cache_read: 0, cache_write: 0, reasoning }, cost: null, duration: 3000 });
// two turns with reasoning tokens and no thinking item (Codex streams none)
const TURNS = [
  { n: 1, stepId: 'develop', items: [{ kind: 'text', text: 'Read the code.' }], result: result(200) },
  { n: 2, stepId: 'develop', items: [{ kind: 'tool_call', id: 'c1', name: 'shell', input: { command: 'npm test' } }, { kind: 'text', text: 'Done.' }], result: result(200) },
];

async function runScreen(lang, session, turns = []) {
  const page = await loadPage();
  page.sandbox.__lang = lang;
  page.run('I18n.setLanguage(__lang)');
  page.sandbox.__run = { id: RUN_ID, status: 'success', workflow: 'w', inputs: {}, startedAt: H.NOW - 2 * H.HOUR, finishedAt: H.NOW - H.HOUR };
  page.sandbox.__sessions = [ORCHESTRATOR, session];
  page.sandbox.__turns = turns;
  page.run(`(() => {
    const v = { ...newRunView(), run: __run, past: true, sessions: new Map(__sessions.map((s) => [s.id, { ...s, turnLog: new Map(s.id === 'orchestrator' ? [] : __turns.map((x) => [x.n, x])) }])) };
    state.view = 'run'; state.runs.set(__run.id, v); state.runId = __run.id; state.selected = __sessions[1].id;
    renderSessions(); renderDetail();
  })()`);
  await settle(20);
  return page;
}
const cardBadges = (page) => textOf(page.$('.session-card[data-id="s-developer"] .badges')).replace(/\s+/g, ' ').trim();
const detailText = (page) => textOf(page.$('#tab-detail')).replace(/\s+/g, ' ').trim();

test('#117 Run screen: a Codex session card is tagged with the CLI and its model, not the account type', { timeout: 60000 }, async () => {
  const badges = cardBadges(await runScreen('en', CODEX));
  assert.match(badges, /Codex/);
  assert.match(badges, /gpt-6-luna/);
  assert.doesNotMatch(badges, /chatgpt/i);
});

test('#117 run list: a Codex session row is tagged with the CLI and its model, not the account type', { timeout: 60000 }, async () => {
  const { sessionView } = require('@craftorio/engine/service/common');
  const page = await loadPage();
  page.sandbox.__row = {
    runId: RUN_ID, workflow: 'w', status: 'success', mock: false, inputs: { task: 'Fix it' }, startedAt: H.iso(H.NOW - 2 * H.HOUR), finishedAt: H.iso(H.NOW - H.HOUR),
    costUsd: 0, sessions: [ORCHESTRATOR, CODEX].map((s) => sessionView(s, false)),
  };
  const html = page.run('runListRow(__row, { expanded: new Set([__row.runId]), msgs: new Map(), columns: new Map() })');
  // the cell that holds the Codex session's provider tag (its model and account sit next to it)
  const badge = H.findEl(html, (e) => e.name === 'span' && /gpt-6-luna/.test(e.parent?.inner || '') && /\bbadge p-/.test(e.attrs.class || ''));
  assert.ok(badge && badge.parent, 'the expanded run lists its Codex session');
  const text = H.visibleText(badge.parent.inner);
  assert.match(text, /Codex/);
  assert.match(text, /gpt-6-luna/);
  assert.doesNotMatch(text, /chatgpt/i);
});

const NOT_SHOWN = /(does not|doesn't) show (its |the )?reasoning/gi;

test('#117 Run screen: a Codex session with reasoning tokens and no thinking says once that the CLI does not show its reasoning', { timeout: 60000 }, async () => {
  const text = detailText(await runScreen('en', CODEX, TURNS));
  assert.equal((text.match(NOT_SHOWN) || []).length, 1, text);
});

test('#117 Run screen: a session whose turns show their thinking does not say the reasoning is hidden', { timeout: 60000 }, async () => {
  const claude = { ...CODEX, provider: 'claude', model: 'claude-opus-5-5', account: undefined };
  const turns = TURNS.map((x) => ({ ...x, items: [{ kind: 'thinking', text: 'Let me look.' }, ...x.items] }));
  const text = detailText(await runScreen('en', claude, turns));
  assert.equal((text.match(NOT_SHOWN) || []).length, 0, text);
});
