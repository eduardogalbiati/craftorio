// @ts-check
// The orchestrator AI a run follows (#97, from packages/engine/engine/workflow.js): `orchestratedWorkflow`
// moves a bundled default workflow (feature, fix, release) to settings.orchestratorProvider through
// packages/shared/orchestrator-models.js (its agents, its orchestrator and the model inputs it offers);
// `resolveAgentTemplates` renders each agent's provider / model / effort templates over the inputs once per
// run, a Claude model a template left on a Codex agent mapped to its counterpart; `orchestratorSession`
// is the provider and model the orchestrator's session shows (the deterministic engine unless the run
// moved to the chosen AI; a simulation keeps `mock` and names the provider it simulates).
// #111: `applyCodexFallback` runs a Codex model the account does not offer on the closest offered one, with a note.
// The run records its orchestrator AI in workflow.started (`startedFields`: orchestrator_ai, and
// orchestrator_applied when the workflow moved to it); a recovered (#607) or resumed run keeps the one
// its run recorded (`runOrchestrator`; a run from before #97 ran on claude), never the current setting:
// its conversations and recorded model inputs belong to that provider. The supervisor reads the same
// record (domains/supervisor/supervisor.js supervisorConfig).

'use strict';

const OrchestratorModels = require('@craftorio/shared/orchestrator-models');
const { render } = require('./templates');
const { cachedModelList } = require('../../domains/cli/cli-models-cache');

// the orchestrator AI a run's workflow.started recorded ('claude' for a run from before #97)
const startedOrchestrator = (/** @type {any[]} */ events) => OrchestratorModels.orchestratorOf((events || []).find((e) => e?.type === 'workflow.started')?.orchestrator_ai);

// the orchestrator AI a run takes: a recovered run's own, a resumed run's (resume.orchestrator, from
// supervisor.resumeSpec), else the one given (settings.orchestratorProvider, or the parent run's)
function runOrchestrator(/** @type {{ orchestrator?: string, resume?: any, recover?: any }} */ { orchestrator, resume, recover }) {
  if (recover) return startedOrchestrator(recover.events);
  if (resume) return OrchestratorModels.orchestratorOf(resume.orchestrator);
  return orchestrator;
}

// { wf, onOrchestrator, inputs, orchestrator }: the workflow and the run's inputs on the run's orchestrator
function orchestratedWorkflow(/** @type {any} */ written, /** @type {any} */ inputs, /** @type {{ orchestrator?: string, bundledWorkflow?: boolean, resume?: any, recover?: any }} */ opts) {
  const orchestrator = runOrchestrator(opts);
  const o = { bundled: opts.bundledWorkflow };
  const wf = OrchestratorModels.applyOrchestrator(written, orchestrator, o);
  const onOrchestrator = wf !== written;
  const values = inputs || {};
  return { wf, onOrchestrator, orchestrator, inputs: onOrchestrator ? OrchestratorModels.mapRunInputs(written, values, orchestrator, o) : values };
}

// what workflow.started records of it
function startedFields(/** @type {{ orchestratorAI?: string, onOrchestrator?: boolean }} */ run) {
  return { orchestrator_ai: OrchestratorModels.orchestratorOf(run.orchestratorAI), ...(run.onOrchestrator ? { orchestrator_applied: true } : {}) };
}

// An agent's provider, model and effort can be templates over the inputs
// (provider: "{{ inputs.writer_provider }}"), so a workflow can let the user pick them.
// Resolved once per run, before anything reads them (preflight, budgets, sessions).
function resolveAgentTemplates(/** @type {any} */ wf, /** @type {any} */ inputs, /** @type {boolean} */ onOrchestrator) {
  for (const a of Object.values(wf.agents || {})) {
    for (const k of ['provider', 'model', 'effort']) {
      if (typeof a[k] === 'string' && a[k].includes('{{')) a[k] = render(a[k], { inputs }).trim();
    }
    // #97: a Claude model left by a template (a value saved before the choice) on its Codex counterpart
    // (mapModel maps only for a Codex agent)
    if (onOrchestrator) a.model = OrchestratorModels.mapModel(a.model, a.provider);
  }
}

// #111: each Codex agent (and the orchestrator / supervisor on Codex) whose model the account does not offer
// (offered: the slugs of the CLI's model cache, read from CODEX_HOME or ~/.codex when not given) runs on its
// fallback (OrchestratorModels.codexFallback); returns one note per replacement, naming both models (the run
// logs them: never a silent swap). An empty list (no cache: nothing known) or a model with no fallback changes
// nothing: usage.preflight refuses the latter.
function applyCodexFallback(/** @type {any} */ wf, offered = cachedModelList(OrchestratorModels.CODEX).map((/** @type {any} */ m) => m.id)) {
  if (!Array.isArray(offered) || !offered.length) return [];
  const CODEX = OrchestratorModels.CODEX;
  const orch = wf.orchestrator || {};
  const targets = [
    ...Object.entries(wf.agents || {}).map(([name, a]) => ({ who: `Agent "${name}"`, block: a })),
    { who: 'The orchestrator', block: orch },
    { who: 'The supervisor', block: orch.supervisor },
  ];
  const notes = [];
  for (const { who, block } of targets) {
    if (!block || typeof block !== 'object' || block.provider !== CODEX || typeof block.model !== 'string') continue;
    const model = block.model.trim();
    if (!model || model.includes('{{') || offered.includes(model)) continue;
    const use = OrchestratorModels.codexFallback(model, offered);
    if (!use) continue;
    block.model = use;
    notes.push(`${who} runs on ${use} instead of ${model}: this Codex account does not offer ${model} (its model list).`);
  }
  return notes;
}

function orchestratorSession(/** @type {{ wf: any, onOrchestrator?: boolean, mock?: boolean }} */ run) {
  const orch = run.wf.orchestrator || {};
  if (!run.onOrchestrator || !orch.provider) return { provider: 'engine', model: 'engine (deterministic)' };
  const model = String(orch.model || '');
  return run.mock ? { provider: 'mock', model, simulates: orch.provider } : { provider: orch.provider, model };
}

module.exports = {
  applyCodexFallback,
  orchestratedWorkflow,
  orchestratorSession,
  resolveAgentTemplates,
  runOrchestrator,
  startedFields,
  startedOrchestrator,
};
