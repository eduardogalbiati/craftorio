// @ts-check
// The first-project onboarding's pure model (#638, docs/work/first-project-onboarding/spec.md R1, R3,
// R5, R7): the wizard's steps and moves, the workflows suggested from a profile, the cost of the
// analyses before the click. The wizard and the engine share it; it reads no file and no DOM.
// - STEPS: the 4 steps in order, [{ id, needs }]: start (a source), repository (a repository and a
//   name), analysis (nothing: the analyses are optional), review (the last step);
// - initialState(): { step: 'start', source, repository, name, analyzeLater };
// - canGoNext(state), next(state), back(state), skipAnalysis(state): pure moves, a new state each;
//   skipAnalysis ("Skip, analyze later") goes from analysis to review with analyzeLater: true; #850: next() from
//   the repository step of a new project (source 'new') sets analyzeLater too (step 3 and the review read it);
// - suggestWorkflows(profile): { suggestions: [{ id, reason, value, choices }], defaulted }: feature, fix
//   and release (#630) for { mode: 'local' | 'remote' | 'fork' (#738), ci: 'none' | 'release' | 'pr+release', tests:
//   'unit' | 'unit+e2e', #844 or 'none' / null with no test command: no unit tests promised }, each with its reason and its selector (the value the profile picks among
//   choices [{ value, label }]); an empty or unknown profile gets the default profile's and
//   defaulted: true; ciChoice(profile) is step 3's CI row, profileLine(profile) the profile in one line;
//   PROFILE (each field's values) and PROFILE_LABELS (value → label) are the one list of the profile's
//   mode / ci / tests (the engine's workflow-compose.js reads them too);
// - #725 workflowsColumnState({ mode, profileJob }): step 3's right column, 'choose' | 'analyzing' |
//   'failed' | 'analyzed' | 'manual', from the owner's choice and the profile job; FAILURE_CODES: the
//   codes of a failed job the engine knows (failureOf in project-onboarding.js) and the wizard words;
// - #781 analysisPhases({ job, interview }): step 3's activity lines from the profile job and
//   workflowInterviewState's answer: [{ id: 'git' | 'files', state, found }, { id: 'oracle', state, reading, since }],
//   state an ActivityLine state (not-needed → skipped);
// - costSummary(analyses): { total, parts: [{ id, estimate }], unknown: [id] } for the checked
//   [{ id, estimate, checked }]; a missing estimate is null (unknown), never $0;
// - repoNameFromUrl(url): the clone's folder name under <workspace>/repos, owner-repo (the engine's
//   cloneRepo and createProject, the wizard's "Will be cloned into" line, #669); #84: a local path or
//   file:// URL gives its folder's own name;
// - #79 #84 isGitUrl(s): a remote git URL (https://, ssh://, git://, git@host:path, no space), else a local path;
//   the one rule of repoNameFromUrl and the engine's (engine/push-access.js, domains/workspace/workspace.js);
// - #632 "Create new project" (source 'new'): its repository step needs only the name; CREATE_ANSWERS
//   (mode / ci / release, #57: kind, each field's values) and CREATE_DEFAULTS are its questions, slugify(name)
//   the new project's id and folder name (<workspace>/projects/<slug>). #108: newProjectFolderName(name, taken)
//   the folder it really gets (<slug>-2… when taken), nameRequired(state) the key of the "name required" line.
// - #738 forkSuggestion({ repo, push }): the "no push access" notice (Create a fork / Work locally), null
//   unless push === false.
// - #633 WORK_MODELS (light / standard / full, spec R9) and DEFAULT_WORK_MODEL ('light', #851): how work on
//   a project is documented, step 3's work model section and the project record's workModel.
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
  // #738: mode fork ("Fork + PR"): the owner cannot push to the original, runs push to their fork
  const PROFILE = { mode: ['local', 'remote', 'fork'], ci: ['none', 'release', 'pr+release'], tests: ['unit', 'unit+e2e'] };
  // #633: the work model (Light: an issue only; Standard: intent → spec → plan, Anthropic's AI-native SDLC
  // playbook simplified; Full: the whole playbook, + REVIEW.md and evals); #851: Light is the default
  const WORK_MODELS = ['light', 'standard', 'full'];
  const DEFAULT_WORK_MODEL = 'light';

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
    const step = STEPS[stepIndex(s) + 1].id;
    // #850: a new project (almost empty) has nothing to analyse yet: its analyses are left for later from step 3 on
    return { ...s, step, ...(step === 'analysis' && s?.source === 'new' ? { analyzeLater: true } : {}) };
  }

  function back(s) {
    return { ...s, step: STEPS[Math.max(0, stepIndex(s) - 1)].id };
  }

  function skipAnalysis(s) {
    if (s?.step !== 'analysis') return { ...s };
    return { ...s, step: 'review', analyzeLater: true };
  }

  // #844: a repository with no test command and no test file has no test style: tests 'none', or left
  // null by the analysis (an absent tests stays invalid)
  const noTests = (p) => !!p && (p.tests === 'none' || (p.tests === null && !p.testCommand));
  const validProfile = (p) => !!p && Object.keys(PROFILE).every((k) => PROFILE[k].includes(p[k]) || (k === 'tests' && noTests(p)));

  // #726: a value's i18n key, its '-' and '+' as '_' (onboarding.<area>_<value>)
  const keyOf = (area, value) => `onboarding.${area}_${String(value).replace(/[-+]/g, '_')}`;
  const keysOf = (area, values) => Object.fromEntries(values.map((v) => [v, keyOf(area, v)]));

  // #630 (spec R6): the profile's fields, value → label key (#726): the interview's questions
  // (packages/engine/domains/workflow/workflow-compose.js openQuestions), step 3's CI row and profileLine
  const PROFILE_LABELS = {
    mode: keysOf('profile_mode', PROFILE.mode),
    ci: keysOf('profile_ci', PROFILE.ci),
    // #844: 'none' (no tests found) is a label, not a test style of PROFILE.tests
    tests: keysOf('profile_tests', [...PROFILE.tests, 'none']),
  };
  // #735: the project's kind, value → label key (the wizard, the Ways of working drawer); PROJECT_KINDS
  // its values (packages/engine/domains/project/project-run-defaults.js): a backend gets no UI step;
  // #84: docs, a repository with no source code (documents only), gets none either
  const KIND_LABELS = {
    backend: 'ways_of_working.kind_backend',
    frontend: 'ways_of_working.kind_frontend',
    'full-stack': 'ways_of_working.kind_full_stack',
    docs: 'ways_of_working.kind_docs',
  };
  const PROJECT_KINDS = Object.keys(KIND_LABELS);
  // #630 (spec R7, mock-4): each suggested workflow's selector, value → label key (#726), and the value
  // the profile picks; the CI row is the profile's ci itself (ciChoice)
  const VARIANTS = ['remote-e2e', 'remote-code', 'local-e2e', 'local-code', 'fork-e2e', 'fork-code'];
  const CHOICES = {
    feature: keysOf('choice_feature', VARIANTS),
    fix: keysOf('choice_fix', VARIANTS),
    // #844: the fix's labels for a project without tests (no "Code + unit"), the same values
    fix_notests: keysOf('choice_fix_notests', VARIANTS),
    release: keysOf('choice_release', ['milestone', 'per-merge', 'train', 'rc-stable']),
    ci: PROFILE_LABELS.ci,
  };
  const DEFAULT_PROFILE = { mode: 'local', ci: 'none', tests: 'unit' };
  // #632 (spec R4, mock-3): the three answers of "Create new project", each field's values in the wizard's
  // order, and the ones picked by default
  // #738: a new project has no original repository to fork, so it is local or remote only
  // #57: and its kind, asked (an almost empty folder has nothing to detect): the kinds with code, no docs;
  // full-stack first and by default (the owner's call: most new projects have an interface and a server)
  const CREATE_ANSWERS = {
    mode: PROFILE.mode.filter((m) => m !== 'fork'),
    ci: PROFILE.ci,
    release: Object.keys(CHOICES.release),
    kind: ['full-stack', 'frontend', 'backend'],
  };
  const CREATE_DEFAULTS = { mode: 'local', ci: 'none', release: 'milestone', kind: 'full-stack' };
  const choicesOf = (kind) => Object.entries(CHOICES[kind]).map(([value, label]) => ({ value, label }));
  // #738: the fork-* variants only for a Fork + PR profile; the local/remote ones for the others
  const variantChoicesOf = (kind, mode) => choicesOf(kind).filter((c) => (mode === 'fork') === c.value.startsWith('fork-'));

  // feature, fix and release, always (spec D9), each with its reason from the profile's rules (R7);
  // an empty or unknown profile gets the default profile's, with defaulted: true
  function suggestWorkflows(profile) {
    const valid = validProfile(profile);
    const p = valid ? profile : DEFAULT_PROFILE;
    const e2e = p.tests === 'unit+e2e';
    const variant = `${p.mode}-${e2e ? 'e2e' : 'code'}`;
    const release = CHOICES.release[profile?.release] ? profile.release : 'milestone';
    // #726: each reason is { key, params }, a param a key or { key, params } itself (the interface resolves them)
    // #844: a project without tests is not promised unit tests
    const none = valid && noTests(p);
    const tests = e2e ? 'e2e' : none ? 'none' : 'unit';
    const why = [
      ['feature', variant, { key: 'onboarding.why_feature', params: { lands: `onboarding.why_lands_${p.mode}`, tests: `onboarding.why_feature_${tests}` } }],
      ['fix', variant, { key: `onboarding.why_fix_${tests}`, params: { hotfix: 'onboarding.why_fix_hotfix' } }],
      ['release', release, { key: p.ci === 'none' ? 'onboarding.why_release_none' : `onboarding.why_release_ci${e2e ? '_e2e' : ''}` }],
    ];
    const suggestions = why.map(([id, value, reason]) => ({
      id,
      reason: valid ? reason : { key: 'onboarding.why_no_profile', params: { reason } },
      value,
      choices: id === 'release' ? choicesOf(id) : variantChoicesOf(id === 'fix' && none ? 'fix_notests' : id, p.mode),
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
    return Object.keys(PROFILE).map((k) => PROFILE_LABELS[k][k === 'tests' && noTests(p) ? 'none' : p[k]]);
  }

  // #725: the state of step 3's "Suggested workflows" column from the owner's choice (mode: undefined |
  // 'analyze' | 'manual') and the profile job ({ status, profile }): choose (the two choices, no row yet),
  // analyzing (the profile job not ended), failed (it failed, or answered no valid profile), analyzed or manual
  // #725: a failed job's known codes, the one list of the engine (its short reason) and the wizard (its words)
  const FAILURE_CODES = ['cli-missing', 'invalid-ranking', 'no-folder', 'no-profile', 'refused', 'timeout'];

  function workflowsColumnState(/** @type {{ mode?: string, profileJob?: any }} */ { mode, profileJob } = {}) {
    if (mode === 'manual') return 'manual';
    if (mode !== 'analyze') return 'choose';
    const status = profileJob?.status;
    if (status === 'failed' || status === 'skipped') return 'failed';
    if (status !== 'done') return 'analyzing';
    return validProfile(profileJob.profile) ? 'analyzed' : 'failed';
  }

  // #781: the phases' states: the interview's when it answered, else what the job alone tells (it just started, or
  // a resumed wizard on a restarted engine); a job that ended settles what a late read left unended
  function phaseStates(job, known) {
    const status = job?.status;
    if (known) {
      const states = ['git', 'files', 'oracle'].map((id) => (known[id]?.status === 'not-needed' ? 'skipped' : known[id]?.status || 'pending'));
      return status === 'done' ? states.map((s) => (s === 'running' || s === 'pending' ? 'done' : s)) : states;
    }
    if (status === 'running') return ['running', 'pending', 'pending'];
    if (status === 'done') {
      const ended = ['done', 'done', 'done'];
      // a simulated job asks no oracle
      if (job.simulated) ended[2] = 'skipped';
      return ended;
    }
    return ['pending', 'pending', 'pending'];
  }

  function analysisPhases(/** @type {{ job?: any, interview?: any }} */ { job, interview } = {}) {
    const known = interview?.phases || null;
    const states = phaseStates(job, known);
    // a failed job: the phase it stopped at, the first one not ended
    if (job?.status === 'failed' && !states.includes('failed')) {
      const stopped = states.findIndex((s) => s === 'running' || s === 'pending');
      if (stopped >= 0) states[stopped] = 'failed';
    }
    return [
      { id: 'git', state: states[0], found: known?.git?.found || null },
      { id: 'files', state: states[1], found: known?.files?.found || null },
      { id: 'oracle', state: states[2], reading: known?.oracle?.reading || null, since: known?.oracle?.since || null },
    ];
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

  // a remote git URL (https, ssh, git:// or the scp form git@host:path, no space); else a local path
  function isGitUrl(s) {
    const text = String(s ?? '');
    return /^(https?|ssh|git):\/\/\S+$/i.test(text) || /^[\w.-]+@[\w.-]+:\S+$/.test(text);
  }

  function repoNameFromUrl(url) {
    // owner-repo avoids collisions between forks; #84: a local path (POSIX, C:\…, file://) is its folder's own name
    const parts = isGitUrl(String(url ?? '').trim()) ? repoUrlParts(url).slice(-2) : repoUrlParts(url).join('/').split('\\').join('/').split('/').filter(Boolean).slice(-1);
    return (parts.join('-') || 'repo').replace(/[^\w.-]/g, '_');
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
    return /** @type {string} */ (parts.pop()).split(/[-_\s]+/).filter(Boolean).map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
  }

  // #738: the wizard's notice when the owner cannot push to the imported repository (push === false; true
  // or unknown: null): its text names owner/repo, its choices Create a fork and Work locally (mode local)
  function forkSuggestion(/** @type {{ repo?: string | null, push?: boolean | null }} */ { repo, push } = {}) {
    if (push !== false) return null;
    const name = repoUrlParts(repo).slice(-2).join('/');
    return {
      repo: name,
      text: { key: 'onboarding.fork_notice', params: { repo: name } },
      choices: [{ id: 'fork', label: 'onboarding.fork_create' }, { id: 'local', label: 'onboarding.fork_work_locally' }],
    };
  }

  // #632: a project's id and a new project's folder name, the one rule (packages/engine/domains/project/projects.js
  // uses it): "Field Notes" → field-notes
  function slugify(name) {
    const s = String(name || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
      .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    return s || 'project';
  }

  // #108: the folder (and id) a new project named `name` gets, given the existing projects' ids: its slug, or the
  // first free <slug>-2, -3… (createProject's rule in packages/engine/domains/project/projects.js)
  function newProjectFolderName(name, taken = []) {
    const used = new Set(taken || []);
    const slug = slugify(name);
    let id = slug;
    for (let i = 2; used.has(id); i++) id = `${slug}-${i}`;
    return id;
  }

  // #108: the line under a new project's name while it is empty (an i18n key), null once a name is typed
  function nameRequired(s) {
    return s?.source === 'new' && s?.step === 'repository' && !filled(s?.name) ? 'onboarding.name_required' : null;
  }

  const api = {
    CREATE_ANSWERS,
    CREATE_DEFAULTS,
    DEFAULT,
    DEFAULT_WORK_MODEL,
    FAILURE_CODES,
    KIND_LABELS,
    PROFILE,
    PROFILE_LABELS,
    PROJECT_KINDS,
    STEPS,
    WORK_MODELS,
    analysisPhases,
    back,
    canGoNext,
    ciChoice,
    costSummary,
    displayNameFromUrl,
    forkSuggestion,
    initialState,
    isGitUrl,
    nameRequired,
    newProjectFolderName,
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
