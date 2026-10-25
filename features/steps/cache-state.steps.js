// Steps of features/run.feature for #320: how each session's next turn starts. The agents table of a
// run (Workflows › Runs, the expanded row: one row per session, data-testid run-session-card,
// data-agent) gets a "Next turn" cell (data-testid session-next-turn, NEW; data-next-turn
// fresh | warm | cold | new, NEW): "fresh from note", "warm · 42 min left", "cold since HH:MM ·
// ~337K tokens ≈ $X", "new session", or "—" for a closed session. Every gate card (run-gate) gets one
// line (data-testid gate-next-turns, NEW) saying what Continue re-reads per agent with an open session.
// Time is not faked: the seeded run's timestamps are written relative to Date.now(). Locators are
// roles and data-testid only (skills/ui-conventions).

const fs = require('fs');
const path = require('path');
const { expect } = require('@playwright/test');
const { Given, When, Then } = require('./fixtures');

const LOAD_TIMEOUT = 30000;
const GATE_TIMEOUT = 120000;
const MIN = 6e4;
const WORKFLOW = 'software-development-local-hero';
const stepIdOf = (name) => name.trim().toLowerCase().replace(/\s+/g, '_');
const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// the seeded run's folder, kept on the scenario's e2e state so the "And its ..." steps append to it
const seeded = (e2e) => {
  expect(e2e.cacheRun, 'a run was seeded in this scenario').toBeTruthy();
  return e2e.cacheRun;
};
// adds the turns and writes events.jsonl again: workflow.started, the turns in time order, then the
// gate's events last (the run stopped there)
const append = (e2e, events) => {
  const run = seeded(e2e);
  run.turns.push(...events);
  const turns = [...run.turns].sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts));
  const lines = [run.started, ...turns, ...run.gateEvents].map((e, i) => JSON.stringify({ seq: i + 1, run_id: run.runId, ...e }));
  fs.writeFileSync(path.join(run.dir, 'events.jsonl'), `${lines.join('\n')}\n`);
};

// A session snapshot as the engine records it (packages/engine/engine/workflow.js snapshot) with #320's fields:
// last_turn_at, context_tokens, mode, has_note, fresh_after_idle_ms
const snapshot = (id, agent, step, fields) => ({
  id, agent, provider: 'claude', model: 'claude-opus-5-5', effort: null, parent_id: null, step_id: step,
  turns: 1, tokens: { input: 1200, output: 3400, cache_read: fields.context_tokens || 0, cache_creation: 0 }, cost_usd: 0.4,
  status: 'idle', provider_session_id: `${id}-cli`, cwd: null, fresh_after_idle_ms: null, ...fields,
});

// One agent turn of the seeded run: its step, its session opened, its answer `ago` minutes ago
function turnEvents(e2e, { agent, step, mode, ago, contextTokens, hasNote }) {
  const end = Date.now() - ago * MIN;
  const start = end - 10 * MIN;
  const id = `s-${step}`;
  const session = snapshot(id, agent, step, {
    mode, opened_at: new Date(start).toISOString(), last_turn_at: new Date(end).toISOString(), context_tokens: contextTokens, has_note: hasNote,
  });
  return [
    { ts: new Date(start).toISOString(), type: 'step.started', step_id: step, step_type: 'agent', agent, visit: 1 },
    { ts: new Date(start).toISOString(), type: 'session.opened', session_id: id, session },
    { ts: new Date(end).toISOString(), type: 'session.message_received', session_id: id, step_id: step, text: 'Done.', cost_usd: 0.4, duration_ms: 10 * MIN, session },
    { ts: new Date(end).toISOString(), type: 'step.finished', step_id: step, duration_ms: 10 * MIN, output: { summary: `${agent} finished.` } },
  ];
}

// A simulated software-development-local-hero run of the demo project that stopped at the gate
// `gate` (no summary.json, no owner.json: written like the #288 interrupted run, so the run list shows
// it and its agents table is rebuilt from the recorded events). Its persistent `agent` (no note, no
// fresh_after_idle) answered `ago` minutes ago with a context of `tokens` tokens; then the gate asked.
Given('the demo project has a run {string} stopped at the gate {string} whose persistent {string} last turn ended {int} minutes ago with a context of {int} tokens', async ({ e2e }, suffix, gate, agent, ago, tokens) => {
  const start = Date.now() - (ago + 60) * MIN;
  const runId = `${new Date(start).toISOString().slice(0, 10).replace(/-/g, '')}-091500-${suffix}`;
  const dir = path.join(e2e.scratch, 'workspace', 'runs', runId);
  // the gate asked a minute ago, after every turn
  const at = new Date(Date.now() - MIN).toISOString();
  fs.mkdirSync(dir, { recursive: true });
  e2e.cacheRun = {
    runId,
    dir,
    started: { ts: new Date(start).toISOString(), type: 'workflow.started', workflow: WORKFLOW, file: `${WORKFLOW}.yaml`, project_id: e2e.project.id, mock: true, inputs: { task: `A run stopped at a gate (${suffix})` } },
    turns: [],
    gateEvents: [
      { ts: at, type: 'step.started', step_id: stepIdOf(gate), step_type: 'human_approval' },
      { ts: at, type: 'approval.requested', step_id: stepIdOf(gate), approval_id: `gate-${suffix}`, message: 'Check the work before the run goes on.' },
    ],
  };
  append(e2e, turnEvents(e2e, { agent, step: `${agent}_turn`, mode: 'persistent', ago, contextTokens: tokens, hasNote: false }));
});

// a handoff agent whose turn ended `ago` minutes ago and left a handoff note (its next turn starts a
// fresh session from it)
Given('its {string} works from a handoff note, its last turn ended {int} minutes ago', async ({ e2e }, agent, ago) => {
  append(e2e, turnEvents(e2e, { agent, step: `${agent}_turn`, mode: 'handoff', ago, contextTokens: 20000, hasNote: true }));
  const run = seeded(e2e);
  fs.mkdirSync(path.join(run.dir, 'handoffs'), { recursive: true });
  fs.writeFileSync(path.join(run.dir, 'handoffs', `${agent}-1.md`), '# Handoff\n\n- Goal: the task.\n- Done: the first part.\n');
});

// an ephemeral agent whose session closed after its turn
Given('its {string} session is closed', async ({ e2e }, agent) => {
  const events = turnEvents(e2e, { agent, step: `${agent}_turn`, mode: 'ephemeral', ago: 40, contextTokens: 30000, hasNote: false });
  const closed = { ...events[1].session, status: 'success', closed_at: events[2].ts };
  append(e2e, [...events, { ts: events[2].ts, type: 'session.closed', session_id: events[1].session_id, status: 'success', session: closed }]);
});

// Workflows › Runs, after `I search the runs for`: expands the run's row until its agents table shows
When('I open the row of the run {string} in the list', async ({ e2e }, fragment) => {
  const row = e2e.window.locator(`[data-testid="run-list-row"][data-run$="${fragment}"]`).filter({ visible: true }).first();
  await expect(row).toBeVisible({ timeout: LOAD_TIMEOUT });
  const card = row.getByTestId('run-session-card').first();
  if (!(await card.isVisible())) await row.locator('.pr-row').first().click();
  await expect(card).toBeVisible({ timeout: LOAD_TIMEOUT });
});

// the "Next turn" cell of the agent's session row (its latest session)
const nextTurn = (page, agent) => page.locator(`[data-testid="run-session-card"][data-agent="${agent}"]`).filter({ visible: true }).last().getByTestId('session-next-turn');
const KINDS = ['fresh', 'warm', 'cold', 'new'];

// the cell reads both texts; when the first one names the kind (fresh, warm, cold, new) the cell's
// data-next-turn says it too
Then('the next turn of the run\'s {string} session shows {string} and {string}', async ({ e2e }, agent, a, b) => {
  const cell = nextTurn(e2e.window, agent);
  await expect(cell).toBeVisible({ timeout: LOAD_TIMEOUT });
  await expect(cell).toContainText(a);
  await expect(cell).toContainText(b);
  const kind = a.trim().split(/\s/)[0].toLowerCase();
  if (KINDS.includes(kind)) await expect(cell).toHaveAttribute('data-next-turn', kind);
});

Then('the next turn of the run\'s {string} session shows {string}', async ({ e2e }, agent, text) => {
  const cell = nextTurn(e2e.window, agent);
  await expect(cell).toBeVisible({ timeout: LOAD_TIMEOUT });
  await expect(cell).toContainText(text);
  const kind = text.trim().split(/\s/)[0].toLowerCase();
  if (KINDS.includes(kind)) await expect(cell).toHaveAttribute('data-next-turn', kind);
});

// the gate card's one line about what Continue re-reads
const continueLine = (page) => page.getByTestId('run-gate').first().getByTestId('gate-next-turns');

Then('the gate card\'s Continue line says {string}', async ({ e2e }, text) => {
  const line = continueLine(e2e.window);
  await expect(line).toBeVisible({ timeout: GATE_TIMEOUT });
  await expect(line).toContainText(new RegExp(escRe(text), 'i'));
});

Then('the gate card\'s Continue line does not say {string}', async ({ e2e }, text) => {
  const line = continueLine(e2e.window);
  await expect(line).toBeVisible({ timeout: GATE_TIMEOUT });
  await expect(line).not.toContainText(new RegExp(escRe(text), 'i'));
});
