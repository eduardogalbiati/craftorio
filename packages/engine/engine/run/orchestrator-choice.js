// @ts-check
// The orchestrator AI a run follows (#97, from packages/engine/engine/workflow.js): `orchestratedWorkflow`
// moves a bundled default workflow (feature, fix, release) to settings.orchestratorProvider through
// packages/shared/orchestrator-models.js (its agents, its orchestrator and the model inputs it offers);
// `resolveAgentTemplates` renders each agent's provider / model / effort templates over the inputs once per
// run, a Claude model a template left on a Codex agent mapped to its counterpart; `orchestratorSession`
// is the provider and model the orchestrator's session shows (the deterministic engine unless the run
// moved to the chosen AI; a simulation keeps `mock` and names the provider it simulates).

'use strict';

const OrchestratorModels = require('@craftorio/shared/orchestrator-models');
const { render } = require('./templates');

// { wf, onOrchestrator, inputs }: the workflow and the run's inputs on the chosen orchestrator
function orchestratedWorkflow(/** @type {any} */ written, /** @type {any} */ inputs, /** @type {string | undefined} */ orchestrator, /** @type {boolean | undefined} */ bundled) {
  const opts = { bundled };
  const wf = OrchestratorModels.applyOrchestrator(written, orchestrator, opts);
  const onOrchestrator = wf !== written;
  const values = inputs || {};
  return { wf, onOrchestrator, inputs: onOrchestrator ? OrchestratorModels.mapRunInputs(written, values, orchestrator, opts) : values };
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
    if (onOrchestrator && a.provider === 'codex') a.model = OrchestratorModels.mapModel(a.model, 'codex');
  }
}

function orchestratorSession(/** @type {{ wf: any, onOrchestrator?: boolean, mock?: boolean }} */ run) {
  const orch = run.wf.orchestrator || {};
  if (!run.onOrchestrator || !orch.provider) return { provider: 'engine', model: 'engine (deterministic)' };
  const model = String(orch.model || '');
  return run.mock ? { provider: 'mock', model, simulates: orch.provider } : { provider: orch.provider, model };
}

module.exports = {
  orchestratedWorkflow,
  orchestratorSession,
  resolveAgentTemplates,
};
