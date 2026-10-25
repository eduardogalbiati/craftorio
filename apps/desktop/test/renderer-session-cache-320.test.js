// #320: the session table's "Next turn" column and the gate card's "Continue:" line. Acceptance
// tests, written before the code, through the whole page (test/agent-chat-page-harness.js).
//
// - The session table of an expanded run card (renderRunList, apps/desktop/renderer/run-list.js): a
//   "Next turn" header, and in each row [data-testid="run-session-card"] a cell
//   [data-testid="session-next-turn"] with data-next-turn="fresh|warm|cold|new" (none for a closed
//   session), whose text leads with the state ("fresh from note", "warm · 42 min left",
//   "cold since HH:MM · ~337K tokens", "new session", "—") and whose title explains it (an estimate).
//   The sessions come in sessionView's shape: lastTurnAt, contextTokens, hasNote, mode, nextTurn.
// - The gate card (gateCardHtml(runId, gate, fullHtml), apps/desktop/renderer/gate-panel.js): one line
//   [data-testid="gate-next-turns"] "Continue: developer fresh from note ~20K · reviewer resumes
//   cold ~140K ...", one entry per agent with an open session, from the run's sessions in
//   state.runs.get(runId).sessions (the snapshots of the session.* events: last_turn_at,
//   context_tokens, mode, has_note, fresh_after_idle_ms, next_turn).
const test = require('node:test');
const assert = require('node:assert/strict');
const { textOf } = require('./mini-dom');
const { loadPage, settle } = require('./agent-chat-page-harness');

const MIN = 60e3;
const HOUR = 60 * MIN;
const ago = (ms) => new Date(Date.now() - ms).toISOString();

// sessionView's shape, with the cache state
const view = (agent, extra) => ({
  id: `s-${agent}`, agent, provider: 'claude', model: 'claude-sonnet-5', status: 'idle', turns: 2,
  tokens: { input: 1000, output: 500, cache_read: 0, cache_write: 0, total: 1500 }, costUsd: 0.1, ...extra,
});
const SESSIONS = [
  view('developer', { mode: 'handoff', hasNote: true, lastTurnAt: ago(3 * HOUR), contextTokens: 337000, nextTurn: { kind: 'fresh', tokens: 20000 } }),
  view('reviewer', { mode: 'persistent', hasNote: false, lastTurnAt: ago(18 * MIN), contextTokens: 70000, nextTurn: { kind: 'warm', until: Date.now() + 42 * MIN, tokens: 70000 } }),
  view('builder', { mode: 'persistent', hasNote: false, lastTurnAt: ago(3 * HOUR), contextTokens: 337000, nextTurn: { kind: 'cold', since: Date.now() - 2 * HOUR, tokens: 337000 } }),
  view('verifier', { mode: 'ephemeral', hasNote: false, lastTurnAt: null, contextTokens: null, turns: 0, nextTurn: { kind: 'new' } }),
  view('healer', { mode: 'persistent', status: 'success', hasNote: true, lastTurnAt: ago(3 * HOUR), contextTokens: 50000, nextTurn: null }),
];
const RUN = {
  runId: 'r1', status: 'running', workflow: 'ai-development-local-hero', task: 'Fix the widget', startedAt: ago(4 * HOUR), durationMs: 60000,
  sessions: SESSIONS,
};

async function cardPage() {
  const page = await loadPage({ api: { listArtifacts: async () => [{ artifacts: [] }], runDiff: async () => null } });
  page.run("document.body.insertAdjacentHTML('beforeend', '<div id=\"box\"></div>')");
  page.sandbox.__runs = [RUN];
  page.run("__rl = { runs: __runs, expanded: new Set(['r1']), arts: new Map(), msgs: new Map() }; __opts = { prefix: 'project', box: '#box', empty: 'No runs yet', start() {}, rerender: () => renderRunList(__rl, __opts), reload() {}, loadMore() {} }; renderRunList(__rl, __opts)");
  await settle();
  assert.ok(page.$('#box [data-run="r1"] [data-testid="run-session-card"][data-agent="reviewer"]'), 'the expanded card lists the sessions');
  return page;
}
const cell = (page, agent) => {
  const el = page.$(`#box [data-run="r1"] [data-testid="run-session-card"][data-agent="${agent}"] [data-testid="session-next-turn"]`);
  assert.ok(el, `the ${agent} row has a Next turn cell`);
  return el;
};
const text = (el) => textOf(el).replace(/\s+/g, ' ').trim();

test('#320 the session table has a "Next turn" column', async () => {
  const page = await cardPage();
  const heads = page.document.querySelectorAll('#box [data-run="r1"] th').map((th) => text(th));
  assert.ok(heads.includes('Next turn'), `the headers are ${heads.join(' | ')}`);
});

test('#320 Next turn: a handoff agent starts fresh from its note', async () => {
  const page = await cardPage();
  const c = cell(page, 'developer');
  assert.equal(c.getAttribute('data-next-turn'), 'fresh');
  assert.match(text(c), /^fresh from note/);
});

test('#320 Next turn: a warm session says how many minutes are left, the text before the colour', async () => {
  const page = await cardPage();
  const c = cell(page, 'reviewer');
  assert.equal(c.getAttribute('data-next-turn'), 'warm');
  assert.match(text(c), /^warm · 4[12] min left/);
  assert.match(c.getAttribute('title') || '', /estimate/i, 'the tooltip says the lifetime is an estimate');
});

test('#320 Next turn: a cold session says since when and the context it will write again', async () => {
  const page = await cardPage();
  const c = cell(page, 'builder');
  assert.equal(c.getAttribute('data-next-turn'), 'cold');
  assert.match(text(c), /^cold since \d{1,2}:\d{2}/);
  assert.match(text(c), /~337K tokens/);
});

test('#320 Next turn: an ephemeral agent or one with no turn yet is a new session; a closed session shows a dash', async () => {
  const page = await cardPage();
  const fresh = cell(page, 'verifier');
  assert.equal(fresh.getAttribute('data-next-turn'), 'new');
  assert.match(text(fresh), /^new session/);
  const closed = cell(page, 'healer');
  assert.equal(closed.getAttribute('data-next-turn'), null);
  assert.equal(text(closed), '—');
});

test('#320 the minute tick redraws an expanded runs list: a warm session turns cold once its lifetime passes', async () => {
  const page = await loadPage({ api: { listArtifacts: async () => [{ artifacts: [] }], runDiff: async () => null } });
  const t0 = Date.parse('2026-10-12T12:00:00Z');
  page.sandbox.__now = t0;
  page.run('Date.now = () => __now'); // the page's own clock (the sandbox's Date, not the test's)
  page.sandbox.__runs = [{ ...RUN, sessions: [view('reviewer', {
    mode: 'persistent', hasNote: false, lastTurnAt: new Date(t0 - 50 * MIN).toISOString(), contextTokens: 70000,
    cacheLifetimeMs: HOUR, nextTurn: { kind: 'warm', until: t0 + 10 * MIN, tokens: 70000 },
  })] }];
  page.run("if (!document.querySelector('#workflow-runs')) document.body.insertAdjacentHTML('beforeend', '<div id=\"workflow-runs\"></div>')");
  page.run("state.view = 'workflows'; state.workflowsTab = 'runs'; state.wr = { ...(state.wr || {}), runs: __runs, expanded: new Set(['r1']), arts: new Map(), msgs: new Map() }; renderWorkflowRuns()");
  await settle();
  const sel = '#workflow-runs [data-run="r1"] [data-testid="run-session-card"][data-agent="reviewer"] [data-testid="session-next-turn"]';
  assert.ok(page.$(sel), 'the expanded run lists the reviewer with its Next turn');
  assert.equal(page.$(sel).getAttribute('data-next-turn'), 'warm');
  assert.match(text(page.$(sel)), /^warm · 10 min left/);

  page.sandbox.__now = t0 + 4 * MIN;
  page.run('tickRunLists()');
  await settle();
  assert.match(text(page.$(sel)), /^warm · 6 min left/, 'the minutes left move on');

  page.sandbox.__now = t0 + 15 * MIN;
  page.run('tickRunLists()');
  await settle();
  assert.equal(page.$(sel).getAttribute('data-next-turn'), 'cold');
  assert.match(text(page.$(sel)), /^cold since \d{1,2}:\d{2} · ~70K tokens/);
});

test('#320 the colour follows the state: warm green, cold orange, from the theme\'s variables', () => {
  const css = require('fs').readFileSync(require('path').join(__dirname, '..', '..', '..', 'apps', 'desktop', 'renderer', 'style.css'), 'utf8');
  assert.match(css, /\.next-turn\[data-next-turn="warm"\][^{]*\{[^}]*color:\s*var\(--green\)/);
  assert.match(css, /\.next-turn\[data-next-turn="cold"\][^{]*\{[^}]*color:\s*var\(--orange\)/);
  assert.match(css, /:root\s*\{[^}]*--green:[^}]*--orange:/, 'both colours are theme variables');
});

// ---- the gate card ----------------------------------------------------------------------------------

// the snapshots the Run screen keeps per run (state.runs.get(id).sessions, from the session.* events)
const snap = (agent, extra) => ({
  id: `s-${agent}`, agent, provider: 'claude', model: 'claude-sonnet-5', status: 'idle', closed_at: null, turns: 2,
  tokens: { input: 1000, output: 500 }, cost_usd: 0.1, fresh_after_idle_ms: null, ...extra,
});
const GATE = {
  step_id: 'developer_check', approval_id: 'a1', message: 'Validate the change',
  brief: { headline: 'The change is ready to validate', body: 'All green.' },
  choices: [{ id: 'approve', label: 'Approve' }, { id: 'changes', label: 'Request changes' }],
};

async function gateLine(sessions, gate = GATE) {
  const page = await loadPage();
  page.sandbox.__sessions = sessions;
  page.sandbox.__gate = gate;
  page.run("state.runs.set('r1', { run: { id: 'r1', workflow: 'ai-development-local-hero', status: 'running' }, events: [], approvals: new Map(), sessions: new Map(__sessions.map((s) => [s.id, s])) })");
  const html = page.run("gateCardHtml('r1', __gate, '<p>Validate the change</p>')");
  page.sandbox.__html = html;
  page.run("document.body.insertAdjacentHTML('beforeend', '<div id=\"gate-box\">' + __html + '</div>')");
  const line = page.$('#gate-box [data-testid="gate-next-turns"]');
  assert.ok(line, 'the gate card has the Continue line');
  return { line: text(line), card: text(page.$('#gate-box')) };
}

test('#320 the gate card says what Continue will re-read, per agent with an open session', async () => {
  const { line, card } = await gateLine([
    snap('developer', { mode: 'handoff', has_note: true, last_turn_at: ago(3 * HOUR), context_tokens: 337000, next_turn: { kind: 'fresh', tokens: 20000 } }),
    snap('reviewer', { mode: 'persistent', has_note: false, last_turn_at: ago(3 * HOUR), context_tokens: 140000, next_turn: { kind: 'cold', since: Date.now() - 2 * HOUR, tokens: 140000 } }),
    snap('builder', { mode: 'persistent', status: 'success', closed_at: ago(3 * HOUR), has_note: true, last_turn_at: ago(3 * HOUR), context_tokens: 50000, next_turn: null }),
  ]);
  assert.match(line, /^Continue:/);
  assert.match(line, /developer[^·]*fresh from note/i);
  assert.match(line, /reviewer[^·]*cold[^·]*140K/i);
  assert.doesNotMatch(line, /builder/i, 'a closed session is not listed');
  assert.match(card, /The change is ready to validate/, 'the gate\'s own summary is still there');
});

test('#320 a gate whose agents are all fresh or warm says so in one line, with no cold resume', async () => {
  const { line } = await gateLine([
    snap('developer', { mode: 'handoff', has_note: true, last_turn_at: ago(10 * MIN), context_tokens: 90000, next_turn: { kind: 'fresh', tokens: 20000 } }),
    snap('reviewer', { mode: 'persistent', has_note: false, last_turn_at: ago(18 * MIN), context_tokens: 70000, next_turn: { kind: 'warm', until: Date.now() + 42 * MIN, tokens: 70000 } }),
  ]);
  assert.match(line, /^Continue:/);
  assert.doesNotMatch(line, /cold/i);
  assert.match(line, /warm|fresh/i);
});

test('#320 a gate without a brief shows its message and the Continue line', async () => {
  const { line, card } = await gateLine([
    snap('reviewer', { mode: 'persistent', has_note: false, last_turn_at: ago(3 * HOUR), context_tokens: 140000, cold_resume_usd: 0.7, next_turn: { kind: 'cold', since: Date.now() - 2 * HOUR, tokens: 140000 } }),
  ], { ...GATE, brief: undefined });
  assert.match(card, /Validate the change/);
  assert.match(line, /^Continue:/);
  assert.match(line, /reviewer[^·]*resumes cold ~140K ≈ \$0\.70/i);
});
