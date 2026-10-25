// Steps of fronts/build/features/run.feature for #369: a Claude turn on a model the installed Claude Code does not
// know (its stderr says `[claude-code:unrecognized_model] {"model":"claude-haiku-5-5",...}` and the CLI
// prices the turn at Opus rates) is priced from its tokens, or shown as unknown with no price.
// Seeded data (NEW, the shape the engine records): the session snapshot's `cost_estimate`
//   { source: 'tokens' | 'unknown', model, cli_version, cli_cost_usd }
// (the same sources as the turn's `cost_source` in test/unknown-model-pricing-369.test.js)
// with `cost_usd` the price from the tokens (source tokens) or null (source unknown); a session
// priced by the CLI as usual has no `cost_estimate`. Every session's cost cell, in Workflows › Runs
// (the expanded row) and on the Run screen (run-session-card), gets data-testid session-cost (NEW),
// and, when estimated or unpriced, data-testid session-cost-note (NEW) saying "estimated from tokens"
// or "no price for <model>", with the explanation "Claude Code <version> does not know <model>" in
// its text or its title. Locators are roles and data-testid only (skills/ui-conventions).

const fs = require('fs');
const path = require('path');
const { expect } = require('@playwright/test');
const { Given, Then } = require('../../../../features/steps/fixtures');

const LOAD_TIMEOUT = 30000;
const MIN = 6e4;
const WORKFLOW = 'ai-development-local-hero';
const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// A finished simulated AI Development run of the demo project, two days back (the run list reads the
// runs folder when the screen opens). Its turns are added by the "And its ..." steps, each one
// rewriting events.jsonl and summary.json.
const seeded = (e2e) => {
  expect(e2e.costRun, 'a run was seeded in this scenario').toBeTruthy();
  return e2e.costRun;
};

function writeRun(run) {
  const at = (m) => new Date(run.start + m * MIN).toISOString();
  const end = run.turns.length * 10 + 1;
  const events = [
    { ts: at(0), type: 'workflow.started', workflow: WORKFLOW, file: `${WORKFLOW}.yaml`, project_id: run.projectId, mock: true, inputs: { task: run.task }, steps: run.turns.map((t) => ({ id: t.step, type: 'agent', agent: t.session.agent })) },
    ...run.turns.flatMap((t, i) => {
      const from = at(i * 10 + 1);
      const to = at(i * 10 + 10);
      const open = { ...t.session, status: 'running', turns: 0 };
      return [
        { ts: from, type: 'step.started', step_id: t.step, step_type: 'agent', agent: t.session.agent, visit: 1 },
        { ts: from, type: 'session.opened', session_id: t.session.id, session: open },
        { ts: to, type: 'session.message_received', session_id: t.session.id, step_id: t.step, text: 'Done.', cost_usd: t.session.cost_usd, duration_ms: 9 * MIN, session: t.session },
        { ts: to, type: 'step.finished', step_id: t.step, duration_ms: 9 * MIN, output: { summary: `${t.session.agent} finished.` } },
        { ts: to, type: 'session.closed', session_id: t.session.id, status: 'success', session: t.session },
      ];
    }),
    { ts: at(end), type: 'workflow.finished', status: 'success' },
  ].map((e, i) => ({ seq: i + 1, run_id: run.runId, ...e }));
  fs.mkdirSync(run.dir, { recursive: true });
  fs.writeFileSync(path.join(run.dir, 'events.jsonl'), `${events.map((e) => JSON.stringify(e)).join('\n')}\n`);
  fs.writeFileSync(path.join(run.dir, 'summary.json'), JSON.stringify({
    run_id: run.runId, workflow: WORKFLOW, project_id: run.projectId, mock: true, inputs: { task: run.task }, status: 'success', started_at: at(0), finished_at: at(end), duration_ms: end * MIN, sessions: run.turns.map((t) => t.session),
  }, null, 2));
}

// one closed Claude session of the agent, one turn; `cost` is cost_usd, `estimate` the #369 field
function addTurn(e2e, agent, model, cost, estimate) {
  const run = seeded(e2e);
  const step = `${agent}_turn`;
  const session = {
    id: `s-${step}`, agent, provider: 'claude', model, effort: null, parent_id: null, step_id: step, turns: 1,
    tokens: { input: 1200, output: 3400, cache_read: 52000, cache_creation: 8000 }, cost_usd: cost,
    status: 'success', provider_session_id: `s-${step}-cli`, cwd: null, mode: 'ephemeral',
    ...(estimate ? { cost_estimate: estimate } : {}),
  };
  run.turns.push({ step, session });
  writeRun(run);
}

Given('the demo project has a finished AI Development run {string}', async ({ e2e }, suffix) => {
  const start = Date.now() - 2 * 864e5;
  const runId = `${new Date(start).toISOString().slice(0, 10).replace(/-/g, '')}-111500-${suffix}`;
  e2e.costRun = {
    runId, start, projectId: e2e.project.id, task: `A run with Claude turns and their costs (${suffix})`,
    dir: path.join(e2e.scratch, 'workspace', 'runs', runId), turns: [],
  };
  writeRun(e2e.costRun);
});

// the turn priced from its tokens: cost_usd is the estimate, the CLI's own number (Opus rates) is kept
Given('its {string} turn ran on {string}, a model Claude Code {string} does not know, priced from its tokens at {float} while the CLI said {float}', async ({ e2e }, agent, model, version, cost, cliCost) => {
  addTurn(e2e, agent, model, cost, { source: 'tokens', model, cli_version: version, cli_cost_usd: cliCost });
});

// the turn on a model with no price: its cost is unknown (null), never the CLI's number
Given('its {string} turn ran on {string}, a model Claude Code {string} does not know and has no price for, while the CLI said {float}', async ({ e2e }, agent, model, version, cliCost) => {
  addTurn(e2e, agent, model, null, { source: 'unknown', model, cli_version: version, cli_cost_usd: cliCost });
});

// a turn on a model the CLI knows, priced by the CLI as usual
Given('its {string} turn ran on the known model {string} at {float}', async ({ e2e }, agent, model, cost) => {
  addTurn(e2e, agent, model, cost, null);
});

// the cost cell of the agent's session (its latest visible row or card: the run list or the Run screen)
const card = (page, agent) => page.locator(`[data-testid="run-session-card"][data-agent="${agent}"]`).filter({ visible: true }).last();
const cost = (page, agent) => card(page, agent).getByTestId('session-cost');
const note = (page, agent) => card(page, agent).getByTestId('session-cost-note');
// what the note says: its text and its title (the explanation may be a tooltip)
const noteWords = async (page, agent) => {
  const el = note(page, agent).first();
  if (!(await el.count())) return '';
  return `${await el.innerText()} ${(await el.getAttribute('title')) || ''}`.replace(/\s+/g, ' ');
};

Then('the cost of the run\'s {string} session shows {string}', async ({ e2e }, agent, text) => {
  await expect(cost(e2e.window, agent)).toBeVisible({ timeout: LOAD_TIMEOUT });
  await expect(cost(e2e.window, agent)).toContainText(text);
});

Then('the cost of the run\'s {string} session does not show {string}', async ({ e2e }, agent, text) => {
  await expect(cost(e2e.window, agent)).toBeVisible({ timeout: LOAD_TIMEOUT });
  await expect(cost(e2e.window, agent)).not.toContainText(text);
});

Then('the cost of the run\'s {string} session is marked {string} because {string}', async ({ e2e }, agent, mark, why) => {
  await expect(note(e2e.window, agent)).toBeVisible({ timeout: LOAD_TIMEOUT });
  await expect(note(e2e.window, agent)).toContainText(new RegExp(escRe(mark), 'i'));
  await expect.poll(() => noteWords(e2e.window, agent), { timeout: LOAD_TIMEOUT }).toMatch(new RegExp(escRe(why), 'i'));
});

Then('the cost of the run\'s {string} session has no estimate mark', async ({ e2e }, agent) => {
  await expect(cost(e2e.window, agent)).toBeVisible({ timeout: LOAD_TIMEOUT });
  await expect(note(e2e.window, agent)).toHaveCount(0);
  await expect(cost(e2e.window, agent)).not.toContainText(/estimated from tokens|no price/i);
});
