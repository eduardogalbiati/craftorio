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
const { Given, When, Then } = require('../../../../features/steps/fixtures');

const LOAD_TIMEOUT = 30000;
const MIN = 6e4;
const WORKFLOW = 'ai-development-local-hero';
const ORCHESTRATOR = {
  id: 'orchestrator', agent: 'orchestrator', provider: 'engine', model: 'engine', effort: null, parent_id: null, step_id: null, turns: 0,
  tokens: { input: 0, output: 0, cache_read: 0, cache_write: 0 }, cost_usd: 0, status: 'success', provider_session_id: null, cwd: null,
};
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
    { ts: at(0), type: 'workflow.started', workflow: WORKFLOW, file: `${WORKFLOW}.yaml`, project_id: run.projectId, mock: !run.real, inputs: { task: run.task }, steps: run.turns.map((t) => (t.machine ? { id: t.step, type: t.machine.type } : { id: t.step, type: 'agent', agent: t.session.agent })) },
    // #72: the engine's own session, whose card on the Run screen carries the run's total cost
    ...(run.real ? [{ ts: at(0), type: 'session.opened', session_id: ORCHESTRATOR.id, session: { ...ORCHESTRATOR, status: 'running' } }] : []),
    ...run.turns.flatMap((t, i) => {
      const from = at(i * 10 + 1);
      const to = at(i * 10 + 10);
      // #117: a step with no agent (the rule checks), run by the orchestrator: started, then its output
      if (t.machine) {
        return [
          { ts: from, type: 'step.started', step_id: t.step, step_type: t.machine.type, visit: 1 },
          { ts: to, type: 'step.finished', step_id: t.step, duration_ms: 9 * MIN, output: t.machine.output },
        ];
      }
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
    run_id: run.runId, workflow: WORKFLOW, project_id: run.projectId, mock: !run.real, inputs: { task: run.task }, status: 'success', started_at: at(0), finished_at: at(end), duration_ms: end * MIN,
    sessions: [...(run.real ? [ORCHESTRATOR] : []), ...run.turns.filter((t) => t.session).map((t) => t.session)],
  }, null, 2));
}

// one closed Claude session of the agent, one turn; `cost` is cost_usd, `estimate` the #369 field
function addTurn(e2e, agent, model, cost, estimate, provider = 'claude') {
  const run = seeded(e2e);
  const step = `${agent}_turn`;
  const session = {
    id: `s-${step}`, agent, provider, model, effort: null, parent_id: null, step_id: step, turns: 1,
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

// ---- #72: a run's total never counts an unknown cost as zero, and is the same on every screen -----------
// A real run for the app (mock: false: Usage leaves simulated runs out), only read back from its files;
// nothing is started. NEW data-testids:
//   run-list-cost     the cost of a run's row in Workflows › Runs (with its mark)
//   run-total-cost    also the total cost on the Run screen's orchestrator card (the list's total row has it)
//   usage-run-cost    the cost cell of a row of Usage › Recent runs; the row: usage-run, data-run="<run id>"
//   usage-month-cost  the month cost of a CLI's card on Usage (usage-provider-card, data-provider="<CLI>")
// A total that includes an unknown cost says so in its visible text: "at least" or "≈".
const MARK = /≈|at least/i;
const CENT = 0.005;

Given('the demo project has a finished real run {string}', async ({ e2e }, suffix) => {
  const start = Date.now() - 45 * MIN;
  const runId = `${new Date(start).toISOString().slice(0, 10).replace(/-/g, '')}-101500-${suffix}`;
  e2e.costRun = {
    runId, start, real: true, projectId: e2e.project.id, task: `A real run with Claude turns and their costs (${suffix})`,
    dir: path.join(e2e.scratch, 'workspace', 'runs', runId), turns: [],
  };
  writeRun(e2e.costRun);
});

// where the run's total shows
const runRow = (page, runId) => page.locator(`[data-testid="run-list-row"][data-run="${runId}"]`).filter({ visible: true }).first();
const PLACES = {
  'the run list': (page, runId) => runRow(page, runId).getByTestId('run-list-cost'),
  'the run\'s sessions table': (page, runId) => runRow(page, runId).getByTestId('run-total-cost'),
  'the Run screen': (page) => page.locator('[data-testid="run-session-card"][data-agent="orchestrator"]').filter({ visible: true }).getByTestId('run-total-cost'),
  Usage: (page, runId) => page.locator(`[data-testid="usage-run"][data-run="${runId}"]`).filter({ visible: true }).getByTestId('usage-run-cost'),
};
function place(e2e, name) {
  if (!PLACES[name]) throw new Error(`no cost place "${name}" (known: ${Object.keys(PLACES).join(', ')})`);
  return PLACES[name](e2e.window, seeded(e2e).runId).first();
}
// the US$ amount of a text ("≈ $1.17", "at least $0.9300"), NaN without one
const amountOf = (text) => Number((/\$\s*([\d,]+(?:\.\d+)?)/.exec(text) || [])[1]?.replace(/,/g, '') ?? NaN);

Then('the run\'s total cost in {string} is marked as incomplete or approximate', async ({ e2e }, name) => {
  const el = place(e2e, name);
  await expect(el).toBeVisible({ timeout: LOAD_TIMEOUT });
  await expect(el).toContainText(MARK, { timeout: LOAD_TIMEOUT });
});

When('I note the run\'s total cost in {string}', async ({ e2e }, name) => {
  const el = place(e2e, name);
  await expect(el).toContainText(/\$\s*\d/, { timeout: LOAD_TIMEOUT });
  e2e.notedCost = amountOf(await el.innerText());
});

Then('the run\'s total cost in {string} is the noted one', async ({ e2e }, name) => {
  expect(e2e.notedCost, 'a run total was noted before').toBeGreaterThan(0);
  const el = place(e2e, name);
  await expect(el).toBeVisible({ timeout: LOAD_TIMEOUT });
  await expect.poll(async () => Math.abs(amountOf(await el.innerText()) - e2e.notedCost), { timeout: LOAD_TIMEOUT }).toBeLessThan(CENT);
});

// Usage's month cost of Claude Code, the provider of every direct call
const monthCost = (page) => page.locator('[data-testid="usage-provider-card"][data-provider="claude"]').filter({ visible: true }).getByTestId('usage-month-cost');

When('I note the month cost of Claude Code in Usage', async ({ e2e }) => {
  await expect(monthCost(e2e.window)).toContainText(/\$\s*\d/, { timeout: LOAD_TIMEOUT });
  e2e.notedMonth = amountOf(await monthCost(e2e.window).innerText());
});

// <workspace>/backlog/product-owner.usage.jsonl: one line per real call (product-owner.js recordUsage)
When('a Product Owner call costs {float}', async ({ e2e }, usd) => {
  const dir = path.join(e2e.scratch, 'workspace', 'backlog');
  fs.mkdirSync(dir, { recursive: true });
  fs.appendFileSync(path.join(dir, 'product-owner.usage.jsonl'), `${JSON.stringify({
    ts: new Date().toISOString(), agent: 'product-owner', projectId: e2e.project.id, provider: 'claude', model: 'claude-opus-5-5',
    tokens: { input: 900, output: 400, cache_read: 0, cache_write: 0 }, costUsd: usd, sessionId: 'po-issue-72', session: 'fresh', startReason: 'one-shot',
  })}\n`);
});

Then('the month cost of Claude Code in Usage grew by {float}', async ({ e2e }, usd) => {
  const before = e2e.notedMonth;
  expect(before, 'the month cost was noted before').toBeGreaterThanOrEqual(0);
  await expect(monthCost(e2e.window)).toBeVisible({ timeout: LOAD_TIMEOUT });
  // the card may round each total to the cent: one cent of tolerance
  await expect.poll(async () => Math.abs(amountOf(await monthCost(e2e.window).innerText()) - before - usd), { timeout: LOAD_TIMEOUT }).toBeLessThan(0.011);
});

// ---- #117: Codex on a ChatGPT account, the rule checks skipped ------------------------------------------
// A Codex turn reports tokens and no cost (packages/shared/providers/codex.js: costUsd null); on a
// ChatGPT account (a subscription) there is no API price to put on its tokens: its cost is unknown,
// drawn "unknown" in the interface language (run_list.cost_unknown: "desconhecido"), never "$0.00"
// nor "≈ $0.00". A total mixing it with priced turns says it is partial. The seeded session is what the
// engine records for such a turn today: provider codex, cost_usd null, tokens, no cost_estimate.
// Assumes no price is configured for the model (settings.prices) in the demo workspace.
Given('its {string} turn ran on Codex {string} on a ChatGPT account, which has no API price', async ({ e2e }, agent, model) => {
  addTurn(e2e, agent, model, null, null, 'codex');
});

// #404: the rule checks found no check script, linter or type checker, so the step was skipped
// (packages/engine/engine/check-step.js); step id rule_check, type check
Given('its {string} step was skipped because the project has no rule checks', async ({ e2e }, name) => {
  const ids = { 'Rule checks': 'rule_check' };
  if (!ids[name]) throw new Error(`unknown step "${name}" (known: ${Object.keys(ids).join(', ')})`);
  const run = seeded(e2e);
  run.turns.push({
    step: ids[name],
    machine: {
      type: 'check',
      output: { kind: 'check', status: 'skipped', command: '', findings: [], round: 1, message: 'Rule checks skipped: no check script, linter or type checker found in the project.' },
    },
  });
  writeRun(run);
});

// "partial" in the interface language (pt-BR "parcial"): the total leaves out a cost it does not know
Then('the run\'s total cost in {string} says it is partial', async ({ e2e }, name) => {
  const el = place(e2e, name);
  await expect(el).toBeVisible({ timeout: LOAD_TIMEOUT });
  await expect(el).toContainText(/partial|parcial/i, { timeout: LOAD_TIMEOUT });
});
