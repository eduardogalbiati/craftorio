// The first-project onboarding's pure model (#638, docs/work/first-project-onboarding/spec.md R1, R3,
// R5, R7): the wizard's steps and moves, the workflows suggested from a profile, the cost of the
// analyses before the click. The wizard and the engine share it; it reads no file and no DOM.
// - STEPS: the 4 steps in order, [{ id, needs }]: start (a source), repository (a repository and a
//   name), analysis (nothing: the analyses are optional), review (the last step);
// - initialState(): { step: 'start', source, repository, name, analyzeLater };
// - canGoNext(state), next(state), back(state), skipAnalysis(state): pure moves, a new state each;
//   skipAnalysis ("Skip, analyze later") goes from analysis to review with analyzeLater: true;
// - suggestWorkflows(profile): { suggestions: [{ id, reason }], defaulted } among today's workflows
//   for { mode: 'local' | 'remote', ci: 'none' | 'release' | 'pr+release', tests: 'unit' | 'unit+e2e' };
//   an empty or unknown profile gets the default workflow and defaulted: true;
// - costSummary(analyses): { total, parts: [{ id, estimate }], unknown: [id] } for the checked
//   [{ id, estimate, checked }]; a missing estimate is null (unknown), never $0.
// The reasons are English for now; the interface language comes with step 7 of the plan.
// Browser: window.OnboardingModel; Node: module.exports (the tests).
(function (root) {
  const STEPS = [
    { id: 'start', needs: ['source'] },
    { id: 'repository', needs: ['repository', 'name'] },
    { id: 'analysis', needs: [] },
    { id: 'review', needs: [] },
  ];
  const DEFAULT = 'ai-development-local-hero';
  const PROFILE = { mode: ['local', 'remote'], ci: ['none', 'release', 'pr+release'], tests: ['unit', 'unit+e2e'] };

  const filled = (v) => typeof v === 'string' && v.trim().length > 0;
  const stepIndex = (s) => Math.max(0, STEPS.findIndex((x) => x.id === s?.step));

  function initialState() {
    return { step: 'start', source: null, repository: '', name: '', analyzeLater: false };
  }

  function canGoNext(s) {
    const step = STEPS[stepIndex(s)];
    if (step.id === 'review') return false;
    return step.needs.every((k) => filled(s?.[k]));
  }

  function next(s) {
    if (!canGoNext(s)) return { ...s };
    return { ...s, step: STEPS[stepIndex(s) + 1].id };
  }

  function back(s) {
    return { ...s, step: STEPS[Math.max(0, stepIndex(s) - 1)].id };
  }

  function skipAnalysis(s) {
    if (s?.step !== 'analysis') return { ...s };
    return { ...s, step: 'review', analyzeLater: true };
  }

  const validProfile = (p) => !!p && Object.keys(PROFILE).every((k) => PROFILE[k].includes(p[k]));

  function suggestWorkflows(profile) {
    if (!validProfile(profile)) {
      return { suggestions: [{ id: DEFAULT, reason: 'No project profile yet: the default workflow' }], defaulted: true };
    }
    const out = [];
    const add = (id, reason) => { if (!out.some((s) => s.id === id)) out.push({ id, reason }); };
    const e2e = profile.tests === 'unit+e2e';
    if (profile.mode === 'local') {
      add(DEFAULT, 'Local project: develops and merges on your machine');
      if (e2e) add('software-development-local-hero', 'Unit and end-to-end tests: the local workflow with the e2e checks');
    } else {
      add('software-development', 'Remote repository: develops through a pull request');
      if (e2e) add('e2e-release', 'End-to-end tests: runs them before a release');
    }
    if (profile.ci !== 'none') add('release', 'CI builds releases: prepares and publishes a release');
    return { suggestions: out, defaulted: false };
  }

  function costSummary(analyses) {
    const parts = (analyses || []).filter((a) => a?.checked)
      .map((a) => ({ id: a.id, estimate: Number.isFinite(a.estimate) ? a.estimate : null }));
    const known = parts.filter((p) => p.estimate !== null);
    const unknown = parts.filter((p) => p.estimate === null).map((p) => p.id);
    const sum = known.reduce((acc, p) => acc + p.estimate, 0);
    // rounded to a millionth: drops the float noise (0.1 + 0.2) without turning a tiny cost into $0
    const total = parts.length && !known.length ? null : Math.round(sum * 1e6) / 1e6;
    return { total, parts, unknown };
  }

  const api = {
    DEFAULT,
    STEPS,
    back,
    canGoNext,
    costSummary,
    initialState,
    next,
    skipAnalysis,
    suggestWorkflows,
  };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.OnboardingModel = api;
})(typeof window !== 'undefined' ? window : globalThis);
