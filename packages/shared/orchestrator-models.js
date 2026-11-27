// @ts-check
// The orchestrator AI chosen in the Setup (#97, settings.orchestratorProvider: 'claude' | 'codex') and
// the one mapping from the Claude models of the default workflows to their Codex counterparts. The
// bundled default workflows (feature, fix, release) are written on Claude; with Codex chosen they run
// their orchestrator and their agents on Codex, each Claude model replaced by its Codex model, and the
// multi-model second reviewer (on Codex in the YAML) moves to Claude, a provider other than the
// orchestrator's. A custom workflow keeps the providers it names.
// - ORCHESTRATORS: the AIs that can lead a run (Grok Build is not one);
// - orchestratorOf(value): 'codex' for 'codex', else 'claude' (no setting, Grok, anything else);
// - CODEX_MODEL_FOR: { <claude model>: <codex model> }; CODEX_LABEL_FOR: the Codex models' names;
// - mapModel(model, provider): the model to run on with that orchestrator (unknown models unchanged);
// - followsOrchestrator(wf): the workflow is one of the bundled defaults (metadata.name);
// - applyOrchestrator(wf, provider, { bundled }) -> the workflow to run: a new object with Codex, the
//   same `wf` with Claude, no provider or a custom workflow (bundled false; default followsOrchestrator);
// - mapRunInputs(wf, inputs, provider, { bundled }): a run's given values of a model input mapped the same way.
// The Codex slugs must exist for the account: usage.preflight checks them against the CLI's model cache.
// Browser: window.OrchestratorModels; Node: module.exports (workflow-requirements.js, workflow.js).
(function (root) {
  const node = typeof module === 'object' && module.exports;
  const registry = () => (node ? require('./providers') : root.Providers);

  const ORCHESTRATORS = ['claude', 'codex'];
  // the two provider ids, named once (#348: no provider literal compared outside the registry)
  const CLAUDE = ORCHESTRATORS[0];
  const CODEX = ORCHESTRATORS[1];
  /** @type {Record<string, string>} */
  const CODEX_MODEL_FOR = {
    'claude-fable-5-2': 'gpt-6.2-astra',
    'claude-opus-5-5': 'gpt-6.2-sol',
    'claude-sonnet-5-5': 'gpt-6.1-terra',
    'claude-haiku-5-5': 'gpt-6-luna',
  };
  /** @type {Record<string, string>} */
  const CODEX_LABEL_FOR = {
    'gpt-6.2-astra': 'GPT Astra 6.2',
    'gpt-6.2-sol': 'GPT Sol 6.2',
    'gpt-6.1-terra': 'GPT Terra',
    'gpt-6-luna': 'GPT Luna',
  };
  /** @type {Record<string, string>} */
  const CLAUDE_MODEL_FOR = Object.fromEntries(Object.entries(CODEX_MODEL_FOR).map(([c, x]) => [x, c]));
  const DEFAULT_WORKFLOWS = ['feature', 'fix', 'release'];

  /** @param {unknown} value */
  const orchestratorOf = (value) => (value === CODEX ? CODEX : CLAUDE);

  /** @param {unknown} model @param {unknown} provider */
  function mapModel(model, provider) {
    if (provider !== CODEX || typeof model !== 'string') return model;
    return CODEX_MODEL_FOR[model] || model;
  }

  // a model template ("{{ inputs.developer_model or 'claude-opus-5-5' }}"): each Claude id in it mapped
  /** @param {unknown} value @param {Record<string, string>} table */
  function mapIn(value, table) {
    if (typeof value !== 'string') return value;
    if (table[value]) return table[value];
    if (!value.includes('{{')) return value;
    let out = value;
    for (const [from, to] of Object.entries(table)) out = out.split(from).join(to);
    return out;
  }

  /** @param {any} wf */
  function followsOrchestrator(wf) {
    return DEFAULT_WORKFLOWS.includes(String(wf?.metadata?.name || '').trim().toLowerCase());
  }

  const known = (/** @type {unknown} */ v) => typeof v === 'string' && !!CODEX_MODEL_FOR[v];
  /** @param {any} def an input of the workflow as written: does it pick a Claude model? */
  const isModelInput = (def) => (Array.isArray(def?.enum) && def.enum.some(known)) || known(def?.default);

  // a model input (feature's developer_model): its enum, default and options on the Codex models; a
  // Claude model with no Codex counterpart (a saved Fable 5.1) is left out
  /** @param {any} def */
  function mapModelInput(def) {
    if (!isModelInput(def)) return def;
    const out = { ...def };
    const keep = (/** @type {unknown} */ v) => known(v) || !/^claude-/.test(String(v));
    if (Array.isArray(def.enum)) out.enum = def.enum.filter(keep).map((/** @type {unknown} */ v) => mapModel(v, CODEX));
    if (def.default !== undefined) out.default = mapModel(def.default, CODEX);
    if (def.options && typeof def.options === 'object') {
      out.options = Object.fromEntries(Object.entries(def.options).filter(([k]) => keep(k))
        .map(([k, label]) => [mapModel(k, CODEX), CODEX_LABEL_FOR[CODEX_MODEL_FOR[k]] || label]));
    }
    return out;
  }

  /**
   * @param {any} wf the loaded workflow (not changed)
   * @param {unknown} provider settings.orchestratorProvider
   * @param {{ bundled?: boolean }} [opts]
   */
  function applyOrchestrator(wf, provider, { bundled } = {}) {
    if (!wf || orchestratorOf(provider) !== CODEX) return wf;
    if (!(bundled ?? followsOrchestrator(wf))) return wf;
    const out = JSON.parse(JSON.stringify(wf));
    // the loader's non-enumerable fields (name, warnings) the JSON clone drops
    for (const key of Object.getOwnPropertyNames(wf)) {
      const desc = Object.getOwnPropertyDescriptor(wf, key);
      if (desc && !desc.enumerable) Object.defineProperty(out, key, desc);
    }
    addProviders(out);
    moveOrchestrator(out.orchestrator || (out.orchestrator = {}));
    for (const agent of Object.values(out.agents || {})) moveAgent(agent);
    for (const [key, def] of Object.entries(out.inputs || {})) out.inputs[key] = mapModelInput(def);
    if (out.models && typeof out.models === 'object') mapModelLimits(out.models);
    return out;
  }

  // the providers: blocks the moved agents run on (a copy of each adapter's definition)
  /** @param {any} out */
  function addProviders(out) {
    out.providers = { ...(out.providers || {}) };
    for (const id of [CODEX, CLAUDE]) {
      const def = registry()?.byId(id)?.definition;
      if (!out.providers[id] && def) out.providers[id] = JSON.parse(JSON.stringify(def));
    }
  }

  /** @param {any} orch the workflow's orchestrator: block (changed) */
  function moveOrchestrator(orch) {
    orch.provider = CODEX;
    orch.model = mapIn(orch.model || 'claude-sonnet-5-5', CODEX_MODEL_FOR);
    const sup = orch.supervisor;
    if (!sup || typeof sup !== 'object') return;
    if (sup.provider === CLAUDE) sup.provider = CODEX;
    if (sup.model) sup.model = mapIn(sup.model, CODEX_MODEL_FOR);
  }

  /** @param {any} agent an agent (changed): Claude to Codex, the multi-model Codex reviewer to Claude */
  function moveAgent(agent) {
    if (!agent || typeof agent !== 'object') return;
    if (agent.provider === CLAUDE) {
      agent.provider = CODEX;
      agent.model = mapIn(agent.model, CODEX_MODEL_FOR);
    } else if (agent.provider === CODEX) {
      // the multi-model second reviewer: on a provider other than the orchestrator's
      agent.provider = CLAUDE;
      agent.model = mapIn(agent.model, CLAUDE_MODEL_FOR);
      if (typeof agent.model === 'string' && !agent.model.startsWith('claude-')) agent.model = 'claude-haiku-5-5';
    }
  }

  // models: limits (Fable's timeout_factor) given to the Codex counterparts too
  /** @param {Record<string, any>} models */
  function mapModelLimits(models) {
    for (const [model, limits] of Object.entries(models)) {
      const codex = CODEX_MODEL_FOR[model];
      if (codex && !models[codex]) models[codex] = limits;
    }
  }

  /**
   * The values given to a run (a saved Developer model 'claude-opus-5-5') on the models applyOrchestrator
   * gave the same workflow; `inputs` unchanged when it leaves the workflow as it is.
   * @param {any} wf the loaded workflow, as written @param {any} inputs @param {unknown} provider
   * @param {{ bundled?: boolean }} [opts]
   */
  function mapRunInputs(wf, inputs, provider, { bundled } = {}) {
    if (!wf || !inputs || orchestratorOf(provider) !== CODEX || !(bundled ?? followsOrchestrator(wf))) return inputs;
    const out = { ...inputs };
    for (const [key, def] of Object.entries(wf.inputs || {})) {
      if (isModelInput(def) && key in out) out[key] = mapModel(out[key], CODEX);
    }
    return out;
  }

  const api = {
    applyOrchestrator,
    CODEX_LABEL_FOR,
    CODEX_MODEL_FOR,
    followsOrchestrator,
    mapModel,
    mapRunInputs,
    ORCHESTRATORS,
    orchestratorOf,
  };
  if (node) module.exports = api;
  else root.OrchestratorModels = api;
})(typeof window !== 'undefined' ? window : globalThis);
