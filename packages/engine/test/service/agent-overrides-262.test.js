// #262 (acceptance tests, written before the code): the service side of per-run agent choices and
// fallbacks. run:start takes `agentOverrides` ({ <agent>: { provider?, model?, effort? } }, what the
// Start drawer / Assign dialog / roadmap item Edit send) and the run records them in
// workflow.started `agents`. Settings keep `providers: { <provider>: { fallbacks: [...] } }` and
// `models: { <model>: { timeout_factor?, max_total_cost_usd? } }` (workspace DEFAULT_SETTINGS, so
// writeSettings keeps them) and every run gets them (WorkflowRun options `fallbacks` / `models`).
// Simulation: mockSequences.usage_limits (see test/agent-fallbacks-262.test.js).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const workspace = require('../../domains/workspace/workspace');
const { makeService } = require('./helpers');

const FIXTURE = `apiVersion: multiagent/v1
kind: Workflow
metadata: { name: fixture-overrides-service-262 }
providers:
  claude:
    type: claude-code
    command: claude
    args: ["-p", "--output-format", "stream-json", "--verbose", "--model", "{{ model }}"]
  codex:
    type: codex-cli
    command: codex
    args: ["exec", "--json", "--skip-git-repo-check", "-m", "{{ model }}"]
    stdin_arg: "-"
agents:
  a: { provider: claude, model: claude-opus-5-5, session: ephemeral, timeout: 10m }
steps:
  - id: work
    agent: a
    prompt: "do the work"
`;

function startAndFinish(service, api, payload) {
  const events = [];
  let runId = null;
  const finished = new Promise((resolve) => {
    service.events.on('run:event', (ev) => {
      events.push(ev);
      if (ev.type === 'workflow.finished' && (!runId || ev.run_id === runId)) resolve(ev);
    });
  });
  return api['run:start'](payload).then(async (r) => {
    runId = r.runId;
    const end = await finished;
    return { ...r, end, events: events.filter((e) => !e.run_id || e.run_id === runId) };
  });
}

const eventsFile = (runDir) => fs.readFileSync(path.join(runDir, 'events.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));

test('#262 run:start forwards agentOverrides: the run records them in workflow.started agents and the turn uses them', async (t) => {
  const { service, api } = makeService(t);
  fs.writeFileSync(path.join(service.workspace().workflows, 'fixture-overrides-service-262.yaml'), FIXTURE);
  const { runDir, end } = await startAndFinish(service, api, {
    file: 'fixture-overrides-service-262.yaml', inputs: {}, mock: true,
    agentOverrides: { a: { provider: 'codex', model: 'gpt-6-luna', effort: 'medium' } },
  });
  assert.equal(end.status, 'success', end.error);
  const recorded = eventsFile(runDir);
  const a = recorded.find((e) => e.type === 'workflow.started')?.agents?.a || {};
  assert.deepEqual({ provider: a.provider, model: a.model, effort: a.effort }, { provider: 'codex', model: 'gpt-6-luna', effort: 'medium' });
  const turn = recorded.find((e) => e.type === 'session.message_received' && e.step_id === 'work');
  assert.equal(turn?.session?.model, 'gpt-6-luna');
});

test('#262 Settings\' per-provider fallbacks and per-model limits reach a run: Claude out of credits falls back to Codex, with Codex\'s timeout', async (t) => {
  const { service, api } = makeService(t);
  const ws = service.workspace();
  fs.writeFileSync(path.join(ws.workflows, 'fixture-overrides-service-262.yaml'), FIXTURE);
  workspace.writeSettings(ws, {
    providers: { claude: { fallbacks: ['codex:gpt-6-luna'] } },
    models: { 'gpt-6-luna': { timeout_factor: 2 } },
  });
  assert.deepEqual(workspace.readSettings(ws).providers, { claude: { fallbacks: ['codex:gpt-6-luna'] } }, 'Settings keep the chain');
  const { runDir, end } = await startAndFinish(service, api, {
    file: 'fixture-overrides-service-262.yaml', inputs: {}, mock: true, mockSequences: { usage_limits: ['claude'] },
  });
  assert.equal(end.status, 'success', end.error);
  const recorded = eventsFile(runDir);
  assert.deepEqual(recorded.filter((e) => e.type === 'agent.fallback').map((e) => `${e.from}>${e.to}`), ['claude:claude-opus-5-5>codex:gpt-6-luna']);
  const sent = recorded.filter((e) => e.type === 'session.message_sent' && e.step_id === 'work').map((e) => e.timeout_ms);
  assert.equal(sent[sent.length - 1], 1200000, 'the fallback turn gets gpt-6-luna\'s timeout_factor');
});
