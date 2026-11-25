// #72: a recovered run (#607, `recover`) counts what its turns of unknown cost spent by the CLI's
// figure toward max_total_cost_usd and the provider's monthly budget, as before the app died. A
// WorkflowRun built from a recorded log and never started; its limits are checked directly.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { WorkflowRun } = require('../../engine/workflow');

const FIXTURE = `apiVersion: craftorio/v1
kind: Workflow
metadata: { name: fixture-unknown-cost-recovery-72 }
providers:
  claude: { type: claude-code, command: claude, args: ["-p"] }
orchestrator:
  limits:
    max_total_cost_usd: 5
agents:
  dev: { provider: claude, model: x, session: ephemeral }
steps:
  - id: develop
    agent: dev
    prompt: "Implement it."
`;

// a run recovered from a log whose one session recorded US$ `cost` and `estimate` (cost_estimate)
function recovered(t, cost, estimate, options = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'unknown-cost-recovery-72-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'wf.yaml');
  fs.writeFileSync(file, FIXTURE);
  const session = { id: 's2', agent: 'dev', provider: 'claude', model: 'x', mode: 'ephemeral', turns: 1, cost_usd: cost, tokens: {}, ...(estimate ? { cost_estimate: estimate } : {}) };
  const ts = new Date().toISOString();
  const events = [
    { seq: 1, type: 'workflow.started', ts, mock: true },
    { seq: 2, type: 'step.started', ts, step_id: 'develop', visit: 1 },
    { seq: 3, type: 'session.opened', ts, session_id: 's2', session: { ...session, turns: 0, cost_usd: 0, cost_estimate: undefined } },
    { seq: 4, type: 'session.message_sent', ts, session_id: 's2', step_id: 'develop', turn: 1 },
    { seq: 5, type: 'session.message_received', ts, session_id: 's2', step_id: 'develop', turn: 1, session },
  ];
  const run = new WorkflowRun({ file, inputs: {}, mock: true, runsDir: path.join(dir, 'runs'), skillsDirs: [], recover: { runId: 'r72', events, worktree: null }, ...options });
  run.orchestrator = { id: 'orchestrator' };
  run.startedAt = Date.now();
  return run;
}
const unknown = (extra) => ({ source: 'unknown', model: 'x', cli_cost_usd: 4, ...extra });

test('#72 a recovered run counts its unknown turns\' CLI figure toward max_total_cost_usd', (t) => {
  assert.throws(() => recovered(t, 2, unknown({ unknown_cli_usd: 4 })).checkLimits(), /Maximum cost exceeded/);
  assert.doesNotThrow(() => recovered(t, 2, null).checkLimits());
});

test('#72 a run recorded before unknown_cli_usd counts the whole CLI figure when its last turn was unknown', (t) => {
  assert.throws(() => recovered(t, 2, unknown()).checkLimits(), /Maximum cost exceeded/);
});

test('#72 a recovered run never counts the CLI figure of the turns priced from tokens', (t) => {
  assert.doesNotThrow(() => recovered(t, 2, unknown({ source: 'tokens' })).checkLimits());
  assert.doesNotThrow(() => recovered(t, 2, unknown({ source: 'tokens', unknown_cli_usd: 1 })).checkLimits());
  assert.throws(() => recovered(t, 2, unknown({ source: 'tokens', unknown_cli_usd: 3.5 })).checkLimits(), /Maximum cost exceeded/);
});

test('#72 a recovered run counts its unknown turns\' CLI figure once toward the provider\'s monthly budget', (t) => {
  const budget = (limitUsd) => ({ budget: { claude: { name: 'Claude Code', limitUsd, usedUsd: 0, blockOnLimit: true } } });
  assert.throws(() => recovered(t, 2, unknown({ unknown_cli_usd: 4 }), budget(5)).checkBudget('claude'), /\$6\.00 of \$5/);
  assert.doesNotThrow(() => recovered(t, 2, unknown({ unknown_cli_usd: 4 }), budget(10)).checkBudget('claude'));
});
