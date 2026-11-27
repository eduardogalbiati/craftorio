// The first-run Setup's pure model (#319): CLI status badges, what each CLI is for, a workflow's
// requirement badges and what it still lacks, and the workflows shown in Start (settings.hiddenWorkflows).
// #643: the Setup lost its Workflows step, and preselectedWorkflows with it.
// - statusBadge(tool): { label, state } for an envDetails entry ({ id, path, connected, checking });
//   state is 'checking' | 'missing' | 'signed-out' | 'ready';
// - requiredTools(opts): #97, the required CLI ids, sorted: the orchestrator AI chosen in the Setup
//   (opts.orchestrator, settings.orchestratorProvider: 'claude' | 'codex'; anything else is claude) and git;
// - toolRequirement(id, opts): 'Required' or 'Optional: <what it enables>';
// - requirementBadges(reqs, opts): 'Needs Codex'... for a workflow's { clis, forge } (packages/engine/domains/workflow/workflow-requirements.js),
//   beyond the required tools;
// - missingRequirements(reqs, states): the CLI ids not 'ready', plus 'forge' when neither gh nor glab is;
// - missingLabel(missing): 'Missing Codex CLI' for a card or the Start panel ('' when nothing);
// - visibleWorkflows(workflows, hidden): the workflows not hidden from Start, order kept;
// - workflowId(file): the id hiddenWorkflows keeps (the file name without .yaml);
// - installHintText(tool): #110, a missing CLI's install prose in the interface language (setup.install_text.<id>).
// The labels are in the interface language (#329, packages/shared/i18n.js); the states never change.
// Browser: window.SetupModel; Node: module.exports (packages/engine/domains/workflow/workflow-requirements.js, the tests).
(function (root) {
  const node = typeof module === 'object' && module.exports;
  // the catalog's helper, at call time (in the browser i18n.js may load after this file)
  const t = (...a) => (node ? require('./i18n') : root.I18n)?.t(...a) ?? a[0];
  const NAMES = { claude: 'Claude Code', codex: 'Codex CLI', grok: 'Grok Build', gh: 'GitHub CLI', glab: 'GitLab CLI', git: 'Git', gitleaks: 'Gitleaks' };
  const SHORT = { claude: 'Claude Code', codex: 'Codex', grok: 'Grok', git: 'Git' };
  // #97: the orchestrator's CLI (orchestrator-models.js orchestratorOf: Grok Build is never one) and git
  const orchestratorOf = (/** @type {unknown} */ v) => (node ? require('./orchestrator-models') : root.OrchestratorModels).orchestratorOf(v);
  /** @param {{ orchestrator?: string }} [opts] */
  const requiredTools = (opts) => [orchestratorOf(opts?.orchestrator), 'git'].sort();
  const forge = () => t('setup.forge');

  const toolName = (id) => NAMES[id] || String(id || '');
  /** A workflow's id in settings.hiddenWorkflows: its file name without .yaml. */
  const workflowId = (file) => String(file || '').replace(/\.ya?ml$/i, '');

  function statusBadge(tool) {
    if (tool?.checking) return { label: t('setup.status.checking'), state: 'checking' };
    if (!tool?.path) return { label: t('setup.status.missing'), state: 'missing' };
    if (!tool.connected) return { label: t('setup.status.signed_out'), state: 'signed-out' };
    return { label: t('setup.status.ready'), state: 'ready' };
  }

  function toolRequirement(id, opts) {
    if (requiredTools(opts).includes(id)) return t('setup.required');
    if (id === 'gh' || id === 'glab') return t('setup.optional_forge');
    if (id === 'gitleaks') return t('setup.optional_secret_scan');
    return t('setup.optional_models');
  }

  /** Badges for what a workflow needs beyond the required orchestrator CLI and Git. */
  function requirementBadges(reqs, opts) {
    const required = requiredTools(opts);
    const out = (reqs?.clis || []).filter((id) => !required.includes(id)).map((id) => t('setup.needs', { name: SHORT[id] || toolName(id) }));
    if (reqs?.forge) out.push(t('setup.needs', { name: forge() }));
    return out;
  }

  function missingRequirements(reqs, states = {}) {
    const missing = (reqs?.clis || []).filter((id) => states[id] !== 'ready');
    if (reqs?.forge && states.gh !== 'ready' && states.glab !== 'ready') missing.push('forge');
    return [...new Set(missing)].sort();
  }

  function missingLabel(missing) {
    if (!missing?.length) return '';
    return t('setup.missing', { names: missing.map((id) => (id === 'forge' ? forge() : toolName(id))).join(', ') });
  }

  // #110: the engine's English install prose (install-commands.js INSTALL_TEXT / MAC_NO_BREW_TEXT) in the interface
  // language: by the key the engine names (`installHintKey`), else (a hint without one, e.g. a manual job's) found by
  // the CLI's id when it is the catalog's English text; any other hint (a command) as it came.
  const HINT_KEYS = ['setup.install_text', 'setup.install_text_mac'];
  function installHintText(tool) {
    const hint = tool?.installHint;
    if (!hint) return '';
    if (tool.installHintKey) return t(tool.installHintKey) === tool.installHintKey ? hint : t(tool.installHintKey);
    const key = HINT_KEYS.map((k) => `${k}.${tool.id}`).find((k) => t(k, null, 'en') === hint);
    return key ? t(key) : hint;
  }

  function visibleWorkflows(workflows, hidden) {
    const set = new Set(Array.isArray(hidden) ? hidden : []);
    return (workflows || []).filter((w) => !set.has(w.id));
  }

  const api = {
    installHintText,
    missingLabel,
    missingRequirements,
    requiredTools,
    requirementBadges,
    statusBadge,
    toolName,
    toolRequirement,
    visibleWorkflows,
    workflowId,
  };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.SetupModel = api;
})(typeof window !== 'undefined' ? window : globalThis);
