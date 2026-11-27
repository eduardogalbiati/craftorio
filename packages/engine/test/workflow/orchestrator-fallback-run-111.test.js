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

async function runFixture(t, options) {
  const dir = tmp(t);
  const file = path.join(dir, 'wf.yaml');
  fs.writeFileSync(file, THREE_AGENTS);
  const run = new WorkflowRun({ file, inputs: {}, mock: true, runsDir: path.join(dir, 'runs'), skillsDirs: [], ...options });
  const events = [];
  run.on('event', (ev) => events.push(ev));
  await run.start();
  const started = events.find((e) => e.type === 'workflow.started') || {};
  const finished = events.find((e) => e.type === 'workflow.finished') || {};
  const notes = events.filter((e) => e.type === 'log').map((e) => String(e.message || ''));
  return { started, finished, notes };
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
