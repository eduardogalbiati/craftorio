// #111 (acceptance tests, written before the code): a bundled workflow run with Codex as the orchestrator AI (#97)
// runs each mapped Codex model the account lacks on the closest offered one (Sol -> gpt-6-luna on an account offering
// gpt-6-luna and gpt-5.6-*), records the models it ran on (workflow.started agents) and says in the run's notes
// which model replaced which; never a silent swap, never a model the account does not list. Claude unchanged.
//
// Contract assumed: WorkflowRun (packages/engine/engine/workflow.js, orchestrator-choice.js) reads the account's
// Codex model cache the way cli-sessions.js cachedModels does with no home (CODEX_HOME/models_cache.json, else
// ~/.codex) and applies orchestrator-models codexFallback to the Codex agents; each replacement is a run note: a
// `log` event (the run's notices channel, events.jsonl) whose message names both the mapped and the used model.
// Only the filesystem is faked (CODEX_HOME at a temp folder); mock provider, no real CLI.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.CRAFTORIO_MOCK_DELAY_SCALE = '0.02';

const { WorkflowRun } = require('../../engine/workflow');

const THREE_AGENTS = `apiVersion: craftorio/v1
kind: Workflow
metadata: { name: fixture-fallback-111 }
agents:
  writer: { provider: claude, model: claude-opus-5-5, session: ephemeral, timeout: 10m }
  checker: { provider: claude, model: claude-sonnet-5-5, session: ephemeral, timeout: 10m }
  mapper: { provider: claude, model: claude-haiku-5-5, session: ephemeral, timeout: 10m }
steps:
  - id: write
    agent: writer
    prompt: "Write the document."
  - id: check
    agent: checker
    prompt: "Check the document."
  - id: map
    agent: mapper
    prompt: "Map the document."
`;

const POOR = ['gpt-6-luna', 'gpt-5.6-terra', 'gpt-5.6-luna', 'gpt-reserve', 'codex-auto-review'];
const FULL = ['gpt-6.2-astra', 'gpt-6.2-sol', 'gpt-6.1-terra', 'gpt-6-luna'];

function tmp(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fallback-111-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

// the account's Codex model cache, as the CLI writes it, in a CODEX_HOME of the test's own
function codexHome(t, models) {
  const dir = tmp(t);
  fs.writeFileSync(path.join(dir, 'models_cache.json'), JSON.stringify({
    models: models.map((slug, i) => ({ slug, display_name: slug, visibility: 'list', priority: i + 1 })),
  }));
  const before = process.env.CODEX_HOME;
  process.env.CODEX_HOME = dir;
  t.after(() => { if (before === undefined) delete process.env.CODEX_HOME; else process.env.CODEX_HOME = before; });
}

async function runFixture(t, options, yaml = THREE_AGENTS) {
  const dir = tmp(t);
  const file = path.join(dir, 'wf.yaml');
  fs.writeFileSync(file, yaml);
  const run = new WorkflowRun({ file, inputs: {}, mock: true, runsDir: path.join(dir, 'runs'), skillsDirs: [], ...options });
  const events = [];
  run.on('event', (ev) => events.push(ev));
  await run.start();
  const started = events.find((e) => e.type === 'workflow.started') || {};
  const finished = events.find((e) => e.type === 'workflow.finished') || {};
  const notes = events.filter((e) => e.type === 'log').map((e) => String(e.message || ''));
  return { run, started, finished, notes };
}

test('#111 a Codex run on an account lacking Sol runs the Opus agent on gpt-6-luna and notes the replacement', { timeout: 60000 }, async (t) => {
  codexHome(t, POOR);
  const { started, finished, notes } = await runFixture(t, { orchestrator: 'codex', bundledWorkflow: true });
  assert.equal(finished.status, 'success', finished.error);
  assert.equal(started.agents?.writer?.provider, 'codex');
  assert.equal(started.agents?.writer?.model, 'gpt-6-luna');
  assert.ok(notes.some((m) => m.includes('gpt-6.2-sol') && m.includes('gpt-6-luna')),
    `a run note names gpt-6.2-sol replaced by gpt-6-luna: ${JSON.stringify(notes)}`);
});

test('#111 a Codex run never uses a model the account does not list; the offered Luna is kept and not noted', { timeout: 60000 }, async (t) => {
  codexHome(t, POOR);
  const { started, notes } = await runFixture(t, { orchestrator: 'codex', bundledWorkflow: true });
  for (const name of ['writer', 'checker', 'mapper']) {
    const model = started.agents?.[name]?.model;
    assert.equal(POOR.includes(model), true, `${name} runs on ${model}, a model the account lists`);
  }
  assert.equal(started.agents?.mapper?.model, 'gpt-6-luna');
  assert.ok(notes.some((m) => m.includes('gpt-6.1-terra')), `the Terra replacement is noted too: ${JSON.stringify(notes)}`);
});

test('#111 a Codex run on an account offering the full list keeps the #97 mapping and notes no replacement', { timeout: 60000 }, async (t) => {
  codexHome(t, FULL);
  const { started, finished, notes } = await runFixture(t, { orchestrator: 'codex', bundledWorkflow: true });
  assert.equal(finished.status, 'success', finished.error);
  assert.equal(started.agents?.writer?.model, 'gpt-6.2-sol');
  assert.equal(started.agents?.checker?.model, 'gpt-6.1-terra');
  assert.equal(started.agents?.mapper?.model, 'gpt-6-luna');
  assert.equal(notes.some((m) => /gpt-6\.2-sol|gpt-6\.1-terra/.test(m)), false, `no replacement note: ${JSON.stringify(notes)}`);
});

test('#111 with Claude Code as the orchestrator a poor Codex cache changes nothing', { timeout: 60000 }, async (t) => {
  codexHome(t, POOR);
  const { started, notes } = await runFixture(t, { orchestrator: 'claude', bundledWorkflow: true });
  assert.equal(started.agents?.writer?.provider, 'claude');
  assert.equal(started.agents?.writer?.model, 'claude-opus-5-5');
  assert.equal(started.agents?.checker?.model, 'claude-sonnet-5-5');
  assert.equal(notes.some((m) => m.includes('gpt-6-luna')), false, `no Codex note: ${JSON.stringify(notes)}`);
});

// ---- review round 1 -------------------------------------------------------------------------------------
// - a Codex agent falls back whatever the orchestrator (Claude, or a custom workflow), as usage.preflight lets it
//   through: the run and the preflight agree;
// - an agent left out of the run (enabled: false) gets no replacement note;
// - the supervisor (supervisorConfig, packages/engine/domains/supervisor/supervisor.js) of a run on Codex asks a
//   model the account lists, its own or inherited from the orchestrator.
const usage = require('../../domains/usage/usage');
const supervisor = require('../../domains/supervisor/supervisor');

const CUSTOM_CODEX_AGENT = `apiVersion: craftorio/v1
kind: Workflow
metadata: { name: fixture-custom-codex-111 }
providers:
  codex: { type: codex-cli, command: codex }
agents:
  writer: { provider: claude, model: claude-opus-5-5, session: ephemeral, timeout: 10m }
  second: { provider: codex, model: gpt-6-luna, session: ephemeral, timeout: 10m }
steps:
  - id: write
    agent: writer
    prompt: "Write the document."
  - id: second
    agent: second
    prompt: "Review the document."
`;

const DISABLED_CODEX_AGENT = `apiVersion: craftorio/v1
kind: Workflow
metadata: { name: fixture-disabled-codex-111 }
providers:
  codex: { type: codex-cli, command: codex }
agents:
  writer: { provider: claude, model: claude-opus-5-5, session: ephemeral, timeout: 10m }
  spare: { provider: codex, model: gpt-6.2-sol, session: ephemeral, timeout: 10m, enabled: false }
steps:
  - id: write
    agent: writer
    prompt: "Write the document."
`;

test('#111 a Codex agent of a custom workflow under Claude runs on an offered model, noted, and the preflight agrees', { timeout: 60000 }, async (t) => {
  codexHome(t, ['gpt-5.6-luna']);
  for (const options of [{ orchestrator: 'claude', bundledWorkflow: true }, { orchestrator: 'codex', bundledWorkflow: false }]) {
    const { run, started, finished, notes } = await runFixture(t, options, CUSTOM_CODEX_AGENT);
    const label = JSON.stringify(options);
    assert.equal(finished.status, 'success', `${label}: ${finished.error}`);
    assert.equal(started.agents?.second?.provider, 'codex', label);
    assert.equal(started.agents?.second?.model, 'gpt-5.6-luna', `${label}: a model the account lists`);
    assert.equal(started.agents?.writer?.model, 'claude-opus-5-5', `${label}: the Claude agent unchanged`);
    assert.ok(notes.some((m) => m.includes('gpt-6-luna') && m.includes('gpt-5.6-luna')), `${label}: a note names both models: ${JSON.stringify(notes)}`);
    const modelProblems = usage.preflight(run.wf, {}, () => ({ file: '/usr/bin/codex' }), {}).filter((p) => /gpt-|Codex/.test(p));
    assert.deepEqual(modelProblems, [], `${label}: the preflight lets the run through`);
  }
});

test('#111 an agent left out of the run (enabled: false) gets no replacement note', { timeout: 60000 }, async (t) => {
  codexHome(t, POOR);
  const { finished, notes } = await runFixture(t, { orchestrator: 'claude', bundledWorkflow: false }, DISABLED_CODEX_AGENT);
  assert.equal(finished.status, 'success', finished.error);
  assert.equal(notes.some((m) => m.includes('gpt-6.2-sol')), false, `no note for the disabled agent: ${JSON.stringify(notes)}`);
});

const BUNDLED = path.join(__dirname, '..', '..', '..', '..', 'workflows');

function writeRun(dir, started) {
  const runDir = path.join(dir, 'runs', '20261127-000000-fb111');
  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(path.join(runDir, 'events.jsonl'), `${JSON.stringify({ ts: '2026-11-27T00:00:00Z', type: 'workflow.started', inputs: {}, mock: true, ...started })}\n`);
  return runDir;
}

test('#111 supervisorConfig of a fix run moved to Codex asks a model the account lists', (t) => {
  codexHome(t, POOR);
  const cfg = supervisor.supervisorConfig(writeRun(tmp(t), { workflow: 'fix', file: 'fix.yaml', orchestrator_ai: 'codex', orchestrator_applied: true }), BUNDLED);
  assert.equal(cfg.providerName, 'codex');
  assert.equal(POOR.includes(cfg.model), true, `the supervisor's model ${cfg.model} is one the account lists`);
});

test('#111 supervisorConfig: a supervisor with no provider of its own, on a Codex orchestrator, asks a listed model', (t) => {
  codexHome(t, POOR);
  const workflows = tmp(t);
  fs.writeFileSync(path.join(workflows, 'inherit-111.yaml'), `apiVersion: craftorio/v1
kind: Workflow
metadata: { name: fixture-inherit-111 }
providers:
  codex: { type: codex-cli, command: codex }
orchestrator:
  provider: codex
  model: gpt-6-luna
  supervisor: { model: gpt-6.2-sol }
agents:
  writer: { provider: codex, model: gpt-6-luna, session: ephemeral, timeout: 10m }
steps:
  - id: write
    agent: writer
    prompt: "Write the document."
`);
  const cfg = supervisor.supervisorConfig(writeRun(tmp(t), { workflow: 'fixture-inherit-111', file: 'inherit-111.yaml', orchestrator_ai: 'codex' }), workflows);
  assert.equal(cfg.providerName, 'codex');
  assert.equal(POOR.includes(cfg.model), true, `the inherited supervisor's model ${cfg.model} is one the account lists`);
});

test('#111 supervisorConfig of a run on Claude keeps the Claude supervisor whatever the Codex cache', (t) => {
  codexHome(t, POOR);
  const cfg = supervisor.supervisorConfig(writeRun(tmp(t), { workflow: 'fix', file: 'fix.yaml', orchestrator_ai: 'claude' }), BUNDLED);
  assert.equal(cfg.providerName, 'claude');
  assert.equal(cfg.model, 'claude-sonnet-5-5');
});
