// The CLIs a workflow needs (#319), for the first-run Setup's Workflows step, the Start panel and
// Workflows › Definitions (the `requirements` of each workflows:list entry). The same sources as
// usage.preflight at Start, read from the unrendered workflow: each enabled agent's provider (a
// "{{ inputs.x }}" provider resolves to the given input, else its default; an agent whose
// `enabled` template is off is left out, as dropDisabledAgents does) and the supervisor's provider
// (orchestrator.supervisor.provider, else orchestrator.provider, else claude, as setupSupervisor
// does); steps name agents, so they add nothing of their own. Git is always needed (worktrees,
// diffs). `forge`: the workflow has a `git_platform` input, i.e. it talks to GitHub or GitLab
// (issues, backlog sync, pull requests) through gh or glab; the local workflows that only allow
// bash:gh in their tools do not count, nor a run in `mode: local` (#630: feature and fix only push main).
// - workflowRequirements(wf, inputs) -> { clis: sorted ids among claude, codex, git, grok; forge };
// - missingRequirements(reqs, states): from apps/desktop/renderer/setup-model.js (shared with the renderer).

const { render } = require('../../engine/workflow');
const { missingRequirements } = require('@craftorio/shared/setup-model');
const registry = require('@craftorio/shared/providers');

const CLIS = registry.clis().map((a) => a.cli);
const off = (v) => ['', 'false', '0', 'no', 'off', 'none'].includes(String(v).trim().toLowerCase());

function inputValues(wf, inputs = {}) {
  const out = {};
  for (const [key, def] of Object.entries(wf?.inputs || {})) if (def && def.default !== undefined) out[key] = def.default;
  return { ...out, ...(inputs || {}) };
}

/** The CLI id of a provider name of the workflow ('claude' for a claude-code provider), or null. */
function cliOf(wf, name) {
  const cfg = wf?.providers?.[name];
  if (cfg) return registry.byType(cfg.type)?.cli || (CLIS.includes(name) ? name : null);
  return CLIS.includes(name) ? name : null;
}

function workflowRequirements(wf, inputs = {}) {
  const values = inputValues(wf, inputs);
  const resolve = (v) => (typeof v === 'string' && v.includes('{{') ? render(v, { inputs: values }) : v);
  const names = [];
  for (const agent of Object.values(wf?.agents || {})) {
    if (!agent) continue;
    if (agent.enabled !== undefined && (typeof agent.enabled === 'string' ? off(resolve(agent.enabled)) : !agent.enabled)) continue;
    names.push(resolve(agent.provider));
  }
  const orch = wf?.orchestrator || {};
  if (orch.supervisor && orch.supervisor.enabled !== false) names.push(resolve(orch.supervisor.provider || orch.provider || 'claude'));
  const clis = new Set(['git']);
  for (const name of names) {
    const id = name && !off(name) ? cliOf(wf, String(name).trim()) : null;
    if (id) clis.add(id);
  }
  return { clis: [...clis].sort(), forge: !!wf?.inputs?.git_platform && values.mode !== 'local' };
}

module.exports = {
  missingRequirements,
  workflowRequirements,
};
