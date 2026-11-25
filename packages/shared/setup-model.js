// The first-run Setup's pure model (#319): CLI status badges, what each CLI is for, a workflow's
// requirement badges and what it still lacks, and the workflows shown in Start (settings.hiddenWorkflows).
// #643: the Setup lost its Workflows step, and preselectedWorkflows with it.
// - statusBadge(tool): { label, state } for an envDetails entry ({ id, path, connected, checking });
//   state is 'checking' | 'missing' | 'signed-out' | 'ready';
// - toolRequirement(id): 'Required' or 'Optional: <what it enables>';
// - requirementBadges(reqs): 'Needs Codex'... for a workflow's { clis, forge } (packages/engine/domains/workflow/workflow-requirements.js);
// - missingRequirements(reqs, states): the CLI ids not 'ready', plus 'forge' when neither gh nor glab is;
// - missingLabel(missing): 'Missing Codex CLI' for a card or the Start panel ('' when nothing);
// - visibleWorkflows(workflows, hidden): the workflows not hidden from Start, order kept;
// - workflowId(file): the id hiddenWorkflows keeps (the file name without .yaml).
// The labels are in the interface language (#329, packages/shared/i18n.js); the states never change.
// Browser: window.SetupModel; Node: module.exports (packages/engine/domains/workflow/workflow-requirements.js, the tests).
(function (root) {
  const node = typeof module === 'object' && module.exports;
  // the catalog's helper, at call time (in the browser i18n.js may load after this file)
  const t = (...a) => (node ? require('./i18n') : root.I18n)?.t(...a) ?? a[0];
  const NAMES = { claude: 'Claude Code', codex: 'Codex CLI', grok: 'Grok Build', gh: 'GitHub CLI', glab: 'GitLab CLI', git: 'Git', gitleaks: 'Gitleaks' };
  const SHORT = { claude: 'Claude Code', codex: 'Codex', grok: 'Grok', git: 'Git' };
  const REQUIRED = ['claude', 'git'];
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

  function toolRequirement(id) {
    if (REQUIRED.includes(id)) return t('setup.required');
    if (id === 'gh' || id === 'glab') return t('setup.optional_forge');
    if (id === 'gitleaks') return t('setup.optional_secret_scan');
    return t('setup.optional_models');
  }

  /** Badges for what a workflow needs beyond the required Claude Code and Git. */
  function requirementBadges(reqs) {
    const out = (reqs?.clis || []).filter((id) => !REQUIRED.includes(id)).map((id) => t('setup.needs', { name: SHORT[id] || toolName(id) }));
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

  function visibleWorkflows(workflows, hidden) {
    const set = new Set(Array.isArray(hidden) ? hidden : []);
    return (workflows || []).filter((w) => !set.has(w.id));
  }

  const api = {
    missingLabel,
    missingRequirements,
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
