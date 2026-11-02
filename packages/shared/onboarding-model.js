// The first-project onboarding's pure model (#638, docs/work/first-project-onboarding/spec.md R1, R3,
// R5, R7): the wizard's steps and moves, the workflows suggested from a profile, the cost of the
// analyses before the click. The wizard and the engine share it; it reads no file and no DOM.
// - STEPS: the 4 steps in order, [{ id, needs }]: start (a source), repository (a repository and a
//   name), analysis (nothing: the analyses are optional), review (the last step);
// - initialState(): { step: 'start', source, repository, name, analyzeLater };
// - canGoNext(state), next(state), back(state), skipAnalysis(state): pure moves, a new state each;
//   skipAnalysis ("Skip, analyze later") goes from analysis to review with analyzeLater: true;
// - suggestWorkflows(profile): { suggestions: [{ id, reason, value, choices }], defaulted }: feature, fix
//   and release (#630) for { mode: 'local' | 'remote', ci: 'none' | 'release' | 'pr+release', tests:
//   'unit' | 'unit+e2e' }, each with its reason and its selector (the value the profile picks among
//   choices [{ value, label }]); an empty or unknown profile gets the default profile's and
//   defaulted: true; ciChoice(profile) is step 3's CI row, profileLine(profile) the profile in one line;
//   PROFILE (each field's values) and PROFILE_LABELS (value → label) are the one list of the profile's
//   mode / ci / tests (the engine's workflow-compose.js reads them too);
// - #725 workflowsColumnState({ mode, profileJob }): step 3's right column, 'choose' | 'analyzing' |
//   'failed' | 'analyzed' | 'manual', from the owner's choice and the profile job; FAILURE_CODES: the
//   codes of a failed job the engine knows (failureOf in project-onboarding.js) and the wizard words;
// - costSummary(analyses): { total, parts: [{ id, estimate }], unknown: [id] } for the checked
//   [{ id, estimate, checked }]; a missing estimate is null (unknown), never $0;
// - repoNameFromUrl(url): the clone's folder name under <workspace>/repos, owner-repo (the engine's
//   cloneRepo and createProject, the wizard's "Will be cloned into" line, #669);
// - #632 "Create new project" (source 'new'): its repository step needs only the name; CREATE_ANSWERS
//   (mode / ci / release, each field's values) and CREATE_DEFAULTS are its three questions, slugify(name)
//   the new project's id and folder name (<workspace>/projects/<slug>).
// #726: every text is an i18n key, never English: the choices' and PROFILE_LABELS' labels are keys
// (onboarding.choice_* / onboarding.profile_*), a reason is a key or { key, params } whose params are keys
// or { key, params } too (onboarding.why_*), profileLine an array of keys; the interface resolves them
// (textOf in fronts/build/views/projects/project-wizard-workflows.js), the engine in English.
// Browser: window.OnboardingModel; Node: module.exports (the tests).
(function (root) {
  const STEPS = [
    { id: 'start', needs: ['source'] },
    { id: 'repository', needs: ['repository', 'name'] },
    { id: 'analysis', needs: [] },
    { id: 'review', needs: [] },
  ];
  const DEFAULT = 'feature';
  const PROFILE = { mode: ['local', 'remote'], ci: ['none', 'release', 'pr+release'], tests: ['unit', 'unit+e2e'] };

  const filled = (v) => typeof v === 'string' && v.trim().length > 0;
  const stepIndex = (s) => Math.max(0, STEPS.findIndex((x) => x.id === s?.step));

  function initialState() {
    return { step: 'start', source: null, repository: '', name: '', analyzeLater: false };
  }

  function canGoNext(s) {
    const step = STEPS[stepIndex(s)];
    if (step.id === 'review') return false;
    // #632: a new project (source 'new') has no repository to give, only its name
    const needs = step.id === 'repository' && s?.source === 'new' ? ['name'] : step.needs;
    return needs.every((k) => filled(s?.[k]));
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

  // #726: a value's i18n key, its '-' and '+' as '_' (onboarding.<area>_<value>)
  const keyOf = (area, value) => `onboarding.${area}_${String(value).replace(/[-+]/g, '_')}`;
  const keysOf = (area, values) => Object.fromEntries(values.map((v) => [v, keyOf(area, v)]));

  // #630 (spec R6): the profile's fields, value → label key (#726): the interview's questions
  // (packages/engine/domains/workflow/workflow-compose.js openQuestions), step 3's CI row and profileLine
  const PROFILE_LABELS = {
    mode: keysOf('profile_mode', PROFILE.mode),
    ci: keysOf('profile_ci', PROFILE.ci),
    tests: keysOf('profile_tests', PROFILE.tests),
  };
  // #735: the project's kind, value → label key (the wizard, the Ways of working drawer); PROJECT_KINDS
  // its values (packages/engine/domains/project/project-run-defaults.js): a backend gets no UI step
  const KIND_LABELS = {
    backend: 'ways_of_working.kind_backend',
    frontend: 'ways_of_working.kind_frontend',
    'full-stack': 'ways_of_working.kind_full_stack',
  };
  const PROJECT_KINDS = Object.keys(KIND_LABELS);
  // #630 (spec R7, mock-4): each suggested workflow's selector, value → label key (#726), and the value
  // the profile picks; the CI row is the profile's ci itself (ciChoice)
  const VARIANTS = ['remote-e2e', 'remote-code', 'local-e2e', 'local-code'];
  const CHOICES = {
    feature: keysOf('choice_feature', VARIANTS),
    fix: keysOf('choice_fix', VARIANTS),
    release: keysOf('choice_release', ['milestone', 'per-merge', 'train', 'rc-stable']),
    ci: PROFILE_LABELS.ci,
  };
  const DEFAULT_PROFILE = { mode: 'local', ci: 'none', tests: 'unit' };
  // #632 (spec R4, mock-3): the three answers of "Create new project", each field's values in the wizard's
  // order, and the ones picked by default
  const CREATE_ANSWERS = { mode: PROFILE.mode, ci: PROFILE.ci, release: Object.keys(CHOICES.release) };
  const CREATE_DEFAULTS = { mode: 'local', ci: 'release', release: 'milestone' };
  const choicesOf = (kind) => Object.entries(CHOICES[kind]).map(([value, label]) => ({ value, label }));

  // feature, fix and release, always (spec D9), each with its reason from the profile's rules (R7);
  // an empty or unknown profile gets the default profile's, with defaulted: true
  function suggestWorkflows(profile) {
    const valid = validProfile(profile);
    const p = valid ? profile : DEFAULT_PROFILE;
    const remote = p.mode === 'remote';
    const e2e = p.tests === 'unit+e2e';
    const variant = `${p.mode}-${e2e ? 'e2e' : 'code'}`;
    const release = CHOICES.release[profile?.release] ? profile.release : 'milestone';
    // #726: each reason is { key, params }, a param a key or { key, params } itself (the interface resolves them)
    const tests = e2e ? 'e2e' : 'unit';
    const why = [
      ['feature', variant, { key: 'onboarding.why_feature', params: { lands: `onboarding.why_lands_${remote ? 'remote' : 'local'}`, tests: `onboarding.why_feature_${tests}` } }],
      ['fix', variant, { key: `onboarding.why_fix_${tests}`, params: { hotfix: 'onboarding.why_fix_hotfix' } }],
      ['release', release, { key: p.ci === 'none' ? 'onboarding.why_release_none' : `onboarding.why_release_ci${e2e ? '_e2e' : ''}` }],
    ];
    const suggestions = why.map(([id, value, reason]) => ({
      id,
      reason: valid ? reason : { key: 'onboarding.why_no_profile', params: { reason } },
      value,
      choices: choicesOf(id),
    }));
    return { suggestions, defaulted: !valid };
  }

  // the CI row of step 3: what the project's CI runs on, with its reason and choices
  function ciChoice(profile) {
    const ci = validProfile(profile) ? profile.ci : DEFAULT_PROFILE.ci;
    return { id: 'ci', reason: keyOf('why_ci', ci), value: ci, choices: choicesOf('ci') };
  }

  // the profile in one line, as step 3's "Ways of working profile" says it: #726 its three label keys
  // (the interface joins them with ' · '), '' without a valid profile
  function profileLine(profile) {
    const p = validProfile(profile) ? profile : null;
    if (!p) return '';
    return Object.keys(PROFILE).map((k) => PROFILE_LABELS[k][p[k]]);
  }

  // #725: the state of step 3's "Suggested workflows" column from the owner's choice (mode: undefined |
  // 'analyze' | 'manual') and the profile job ({ status, profile }): choose (the two choices, no row yet),
  // analyzing (the profile job not ended), failed (it failed, or answered no valid profile), analyzed or manual
  // #725: a failed job's known codes, the one list of the engine (its short reason) and the wizard (its words)
  const FAILURE_CODES = ['cli-missing', 'invalid-ranking', 'no-folder', 'no-profile', 'refused', 'timeout'];

  function workflowsColumnState({ mode, profileJob } = {}) {
    if (mode === 'manual') return 'manual';
    if (mode !== 'analyze') return 'choose';
    const status = profileJob?.status;
    if (status === 'failed' || status === 'skipped') return 'failed';
    if (status !== 'done') return 'analyzing';
    return validProfile(profileJob.profile) ? 'analyzed' : 'failed';
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

  // a repository URL's parts, the one normalization of repoNameFromUrl and displayNameFromUrl: no query or
  // fragment, trailing slash nor .git, split on / and : ("git@host:owner/repo.git" → git@host, owner, repo)
  function repoUrlParts(url) {
    const clean = String(url ?? '').trim().replace(/[?#].*$/, '').replace(/\/+$/, '').replace(/\.git$/i, '');
    return clean.split(/[/:]/).filter(Boolean);
  }

  function repoNameFromUrl(url) {
    const name = repoUrlParts(url).slice(-2).join('-') || 'repo'; // owner-repo avoids collisions between forks
    return name.replace(/[^\w.-]/g, '_');
  }

  // #739: the project's display name from its repository URL (the wizard's URL field and its list pick):
  // the last path part, dashes and underscores as spaces, each word capitalized ("ai-memory" → "Ai Memory");
  // "" until the URL names an owner and a repository after its scheme and host (a URL being typed, a host alone);
  // the short form owner/repo has no host, and its owner may hold a dot (a GitLab group "my.company")
  function displayNameFromUrl(url) {
    const text = String(url ?? '');
    const parts = repoUrlParts(url);
    const full = text.includes('://') || text.includes('@');
    if (text.includes('://')) parts.shift(); // the scheme (https, ssh)
    // the host (github.com, git@gitlab.com): always after a scheme or in an scp form, else only before owner/repo
    if (/[.@]/.test(parts[0] || '') && (full || parts.length > 2)) parts.shift();
    if (parts.length < 2) return '';
    return parts.pop().split(/[-_\s]+/).filter(Boolean).map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
  }

  // #632: a project's id and a new project's folder name, the one rule (packages/engine/domains/project/projects.js
  // uses it): "Field Notes" → field-notes
  function slugify(name) {
    const s = String(name || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
      .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    return s || 'project';
  }

  const api = {
    CREATE_ANSWERS,
    CREATE_DEFAULTS,
    DEFAULT,
    FAILURE_CODES,
    KIND_LABELS,
    PROFILE,
    PROFILE_LABELS,
    PROJECT_KINDS,
    STEPS,
    back,
    canGoNext,
    ciChoice,
    costSummary,
    displayNameFromUrl,
    initialState,
    next,
    profileLine,
    repoNameFromUrl,
    skipAnalysis,
    slugify,
    suggestWorkflows,
    workflowsColumnState,
  };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.OnboardingModel = api;
})(typeof window !== 'undefined' ? window : globalThis);
