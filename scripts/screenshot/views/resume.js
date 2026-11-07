// Screenshot seed of the Resume from step dialog (--view resume, #799): a simulated Feature run of the
// demo project stopped at Develop on Fable 5.1, its dialog open at that step with the Developer model
// and effort choices. --mode limit: the same run stopped by the provider's weekly limit, with what the
// developer's next turn re-reads. Written as the engine ends a run whose Develop turn threw: no
// step.finished of that step, its error in workflow.finished and in the summary.

const fs = require('fs');
const path = require('path');
const { writeEvents } = require('../helpers');

const MIN = 60 * 1000;
const DAY = 24 * 60 * MIN;
const RUN_SUFFIX = 'resume799';
const ERRORS = {
  failed: 'The developer turn failed (simulated).',
  limit: "You've hit your weekly limit",
};
// the steps a Feature run finishes before Develop, each with the output its later steps read
const FINISHED = [
  ['acceptance_tests', 'agent', 'test_writer', { summary: 'Wrote the acceptance tests.', tests_added: [], tests_changed: [], e2e_files: [], e2e_scope: 'none' }],
  ['red_check', 'suite', undefined, { status: 'red', message: 'The acceptance tests fail, as they should.' }],
  ['warm_up', 'agent', 'mapper', { summary: 'Mapped the code.', map: '' }],
];

function seed({ args, project, ws }) {
  const limit = args.mode === 'limit';
  const error = limit ? ERRORS.limit : ERRORS.failed;
  const start = Date.now() - 2 * DAY;
  const at = (m) => new Date(start + m * MIN).toISOString();
  const runId = `${at(0).slice(0, 10).replace(/-/g, '')}-101500-${RUN_SUFFIX}`;
  const inputs = { task: 'Add a /health endpoint', repo_path: project.folder || project.repo, developer_model: 'claude-fable-5-1', developer_effort: 'high' };
  const developer = {
    id: 's-develop', agent: 'developer', provider: 'claude', model: inputs.developer_model, status: 'failed', turns: 1, cost_usd: 0,
    ...(limit ? { mode: 'persistent', provider_session_id: 's-develop-cli', last_turn_at: at(6), context_tokens: 140000, cache_lifetime_ms: 60 * MIN, has_note: false } : {}),
  };
  const finished = FINISHED.flatMap(([id, type, agent, output], i) => [
    { ts: at(1 + i), type: 'step.started', step_id: id, step_type: type, agent, visit: 1 },
    { ts: at(2 + i), type: 'step.finished', step_id: id, visit: 1, duration_ms: MIN, output },
  ]);
  const develop = [
    { ts: at(5), type: 'step.started', step_id: 'develop', step_type: 'agent', agent: 'developer', visit: 1 },
    { ts: at(5), type: 'session.opened', session_id: developer.id, session: developer },
    { ts: at(5), type: 'session.message_sent', session_id: developer.id, step_id: 'develop', text: `Implement: ${inputs.task}`, session: developer },
    { ts: at(6), type: 'log', level: 'error', step_id: 'develop', message: `develop: ${error}` },
    { ts: at(6), type: 'session.status', session_id: developer.id, status: 'failed', session: developer },
  ];
  const steps = [...finished, ...develop].filter((e) => e.type === 'step.started').map((e) => ({ id: e.step_id, type: e.step_type, agent: e.agent }));
  const dir = path.join(ws.runs, runId);
  writeEvents(dir, runId, [
    { ts: at(0), type: 'workflow.started', workflow: 'feature', file: 'feature.yaml', project_id: project.id, mock: true, inputs, steps },
    ...finished,
    ...develop,
    { ts: at(7), type: 'workflow.finished', status: 'failed', error },
  ]);
  fs.writeFileSync(path.join(dir, 'summary.json'), JSON.stringify({
    run_id: runId, workflow: 'feature', file: 'feature.yaml', project_id: project.id, mock: true, inputs, status: 'failed', error, started_at: at(0), finished_at: at(7), duration_ms: 7 * MIN, sessions: [developer],
  }, null, 2));
}

async function open({ js, runDirs }) {
  await js(`await window.openResumeDialog(${JSON.stringify(path.basename(runDirs()[0]))})`);
}

module.exports = {
  modes: ['limit'],
  open,
  seed,
};
