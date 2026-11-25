// Screenshot seed of Usage (--view usage): a simulated run, a real run that includes a turn of unknown
// cost (#72, demoUnknownCostRun, its id ending in -unk00072, also on Workflows; demoUnknownCostItem puts
// such a turn in the roadmap's first done item) and a Product Owner call. Its GitHub Actions minutes are
// a demo answer of the simulated channels (scripts/screenshot/channels.js), and --missing-clis shows its
// CLIs missing.

const fs = require('fs');
const path = require('path');
const { writeEvents } = require('../helpers');

const tokens = (input, output, cacheRead) => ({ input, output, cache_read: cacheRead, cache_write: 0, reasoning: 0 });
const session = (id, agent, model, costUsd, extra = {}) => ({
  id, agent, provider: 'claude', model, effort: null, parent_id: 'orchestrator', step_id: agent === 'reviewer' ? 'code_review' : 'develop', turns: 1,
  tokens: tokens(9200, 41000, 2100000), cost_usd: costUsd, status: 'success', provider_session_id: `${id}-cli`, cwd: null, mode: 'ephemeral', ...extra,
});
// a turn on a model the installed Claude Code does not know and the app has no price for
const unknownTurn = () => session('s2', 'reviewer', 'claude-fable-5-2', 0, {
  tokens: tokens(2100, 3800, 240000),
  cost_estimate: { source: 'unknown', model: 'claude-fable-5-2', cli_version: '2.1.316', cli_cost_usd: 0.24, unknown_cli_usd: 0.24 },
});

function demoUnknownCostRun(ws, projectId) {
  const start = Date.now() - 50 * 6e4;
  const at = (m) => new Date(start + m * 6e4).toISOString();
  const runId = `${at(0).slice(0, 10).replace(/-/g, '')}-101500-unk00072`;
  const dir = path.join(ws.runs, runId);
  const base = { workflow: 'ai-development-local-hero', project_id: projectId, mock: false, inputs: { task: 'Write the README of the new project' } };
  const orchestrator = session('orchestrator', 'orchestrator', 'engine', 0, { provider: 'engine', parent_id: null, step_id: null, turns: 0, tokens: tokens(0, 0, 0) });
  const sessions = [orchestrator, session('s1', 'developer', 'claude-opus-5-5', 0.93), unknownTurn()];
  fs.mkdirSync(dir, { recursive: true });
  writeEvents(dir, runId, [
    { ts: at(0), type: 'workflow.started', file: 'ai-development-local-hero.yaml', ...base },
    ...sessions.flatMap((s, i) => [
      { ts: at(i * 10), type: 'session.opened', session_id: s.id, session: { ...s, status: 'idle' } },
      { ts: at(i * 10 + 9), type: 'session.closed', session_id: s.id, status: 'success', session: s },
    ]),
    { ts: at(40), type: 'workflow.finished', status: 'success', error: null },
  ]);
  fs.writeFileSync(path.join(dir, 'summary.json'), JSON.stringify({
    run_id: runId, ...base, status: 'success', started_at: at(0), finished_at: at(40), duration_ms: 40 * 6e4, cost_usd: 1.17, cost_approx: true, sessions,
  }, null, 2));
}

function demoUnknownCostItem(ws, projectId) {
  const roadmap = JSON.parse(fs.readFileSync(path.join(ws.backlog, `${projectId}.roadmap.json`), 'utf8'));
  const item = roadmap.stages.flatMap((s) => s.items || []).find((x) => x.status === 'done' && x.runId && !x.mock);
  const file = item && path.join(ws.runs, item.runId, 'summary.json');
  if (!file || !fs.existsSync(file)) return;
  const summary = JSON.parse(fs.readFileSync(file, 'utf8'));
  fs.writeFileSync(file, JSON.stringify({ ...summary, sessions: [...(summary.sessions || []), unknownTurn()] }, null, 2));
}

function seed({ ws, project }) {
  demoUnknownCostRun(ws, project.id);
  fs.mkdirSync(ws.backlog, { recursive: true });
  fs.appendFileSync(path.join(ws.backlog, 'product-owner.usage.jsonl'), `${JSON.stringify({
    ts: new Date().toISOString(), agent: 'product-owner', projectId: project.id, provider: 'claude', model: 'claude-opus-5-5', tokens: tokens(900, 400, 0), costUsd: 0.37, sessionId: 'po-demo', session: 'fresh', startReason: 'one-shot',
  })}\n`);
}

module.exports = {
  demoUnknownCostItem,
  demoUnknownCostRun,
  run: true,
  seed,
};
