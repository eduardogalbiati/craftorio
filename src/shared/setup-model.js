// The first-run Setup's pure model (#319): CLI status badges, what each CLI is for, a workflow's
// requirement badges and what it still lacks, the workflows preselected in the Workflows step and
// the ones shown in Start (settings.hiddenWorkflows).
// - statusBadge(tool): { label, state } for an envDetails entry ({ id, path, connected, checking });
//   state is 'checking' | 'missing' | 'signed-out' | 'ready';
// - toolRequirement(id): 'Required' or 'Optional: <what it enables>';
// - requirementBadges(reqs): 'Needs Codex'... for a workflow's { clis, forge } (src/workflow-requirements.js);
// - missingRequirements(reqs, states): the CLI ids not 'ready', plus 'forge' when neither gh nor glab is;
// - missingLabel(missing): 'Missing Codex CLI' for a card or the Start panel ('' when nothing);
// - preselectedWorkflows(workflows, states): the ready ids, ai-development-local-hero first;
// - visibleWorkflows(workflows, hidden): the workflows not hidden from Start, order kept;
// - workflowId(file): the id hiddenWorkflows keeps (the file name without .yaml).
// Browser: window.SetupModel; Node: module.exports (src/workflow-requirements.js, the tests).
(function (root) {
  const NAMES = { claude: 'Claude Code', codex: 'Codex CLI', grok: 'Grok Build', gh: 'GitHub CLI', glab: 'GitLab CLI', git: 'Git' };
  const SHORT = { claude: 'Claude Code', codex: 'Codex', grok: 'Grok', git: 'Git' };
  const REQUIRED = ['claude', 'git'];
  const FIRST = 'ai-development-local-hero';
  const FORGE = 'GitHub or GitLab CLI';

  const toolName = (id) => NAMES[id] || String(id || '');
  /** A workflow's id in settings.hiddenWorkflows: its file name without .yaml. */
  const workflowId = (file) => String(file || '').replace(/\.ya?ml$/i, '');

  function statusBadge(tool) {
    if (tool?.checking) return { label: 'Checking…', state: 'checking' };
    if (!tool?.path) return { label: 'Not installed', state: 'missing' };
    if (!tool.connected) return { label: 'Not signed in', state: 'signed-out' };
    return { label: 'Ready', state: 'ready' };
  }

  function toolRequirement(id) {
    if (REQUIRED.includes(id)) return 'Required';
    if (id === 'gh' || id === 'glab') return 'Optional: Backlog sync and pull requests';
    return 'Optional: multi-model workflows';
  }

  /** Badges for what a workflow needs beyond the required Claude Code and Git. */
  function requirementBadges(reqs) {
    const out = (reqs?.clis || []).filter((id) => !REQUIRED.includes(id)).map((id) => `Needs ${SHORT[id] || toolName(id)}`);
    if (reqs?.forge) out.push(`Needs ${FORGE}`);
    return out;
  }

  function missingRequirements(reqs, states = {}) {
    const missing = (reqs?.clis || []).filter((id) => states[id] !== 'ready');
    if (reqs?.forge && states.gh !== 'ready' && states.glab !== 'ready') missing.push('forge');
    return [...new Set(missing)].sort();
  }

  function missingLabel(missing) {
    if (!missing?.length) return '';
    return `Missing ${missing.map((id) => (id === 'forge' ? FORGE : toolName(id))).join(', ')}`;
  }

  function preselectedWorkflows(workflows, states) {
    const ready = (workflows || []).filter((w) => !missingRequirements(w.requirements, states).length).map((w) => w.id);
    return ready.includes(FIRST) ? [FIRST, ...ready.filter((id) => id !== FIRST)] : ready;
  }

  function visibleWorkflows(workflows, hidden) {
    const set = new Set(Array.isArray(hidden) ? hidden : []);
    return (workflows || []).filter((w) => !set.has(w.id));
  }

  const api = {
    FIRST,
    missingLabel,
    missingRequirements,
    preselectedWorkflows,
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
