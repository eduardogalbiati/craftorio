// #487: a project's workflow set composed from its ways of working. The ways-of-working seed
// (seeds/ways-of-working/seed.md) infers a profile from the repository (#630: the mode, local merge or
// pull requests; the CI's triggers; unit or unit+E2E tests and the E2E command; the release style, the
// test and check commands, languages); the interview (packages/engine/service/areas/workflow-interview.js)
// asks only what the profile leaves open (openQuestions), and the owner may override any inferred field
// (answers named after the profile's fields, PROFILE_FIELDS). composeWorkflowSet builds the set from the
// step fragments (fragments/dev-pipeline, fix-pipeline, local-merge-pipeline, pr-pipeline,
// release-pipeline): feature and fix in the chosen mode (Local ends with push_main) and release in the
// chosen release style (waiting for the release CI when the CI runs on tags), with the project's facts
// (test, E2E and check commands, languages, language skills) in the agents' prompts, and the
// `.multiagent/project.yaml` manifest that lists them (packages/engine/domains/project/project-manifest.js),
// merged into the one the repository already has (mergeManifest). Pure: it returns YAML texts;
// writing them into the project is the service's, on the owner's click.

'use strict';

const path = require('path');
const yaml = require('js-yaml');
const I18n = require('@multiagent/shared/i18n');
const registry = require('@multiagent/shared/providers');
const { PLATFORMS } = require('@multiagent/shared/platforms');
const { PROFILE, PROFILE_LABELS } = require('@multiagent/shared/onboarding-model');
const { MANIFEST_FILE } = require('../project/project-manifest');

const MULTIAGENT_DIR = path.posix.dirname(MANIFEST_FILE);

// #630 (spec R6): local merges into the local base and pushes main as the workflow's last step;
// remote opens a pull request. ci: what the CI runs on. tests: E2E first when the project has an E2E suite.
// The values and their labels: the onboarding's profile (packages/shared/onboarding-model.js).
const MODES = PROFILE.mode;
const CI_STYLES = PROFILE.ci;
const TEST_STYLES = PROFILE.tests;
// a profile field's choices for a question: [{ value, label }]; #726: the model's label keys, in English
// (Ways of working shows the engine's questions as they are)
const profileChoices = (field) => Object.entries(PROFILE_LABELS[field]).map(([value, key]) => ({ value, label: I18n.t(key, undefined, 'en') }));
const RELEASE_STYLES = ['milestone', 'per-merge', 'train', 'rc-stable'];
const REVIEW_LEVELS = ['light', 'standard', 'strict'];
// review rounds before the change goes on to the escalation gate, and the reviewer's effort
const REVIEW = { light: { rounds: 1, effort: 'low' }, standard: { rounds: 2, effort: 'medium' }, strict: { rounds: 3, effort: 'high' } };

// a language as the seed or the Architecture facts name it → the `language` key of the skills
// (unit-test-writer-<key>, packages/engine/engine/language-skills.js)
const LANGUAGE_KEYS = {
  'c#': 'csharp',
  csharp: 'csharp',
  go: 'go',
  golang: 'go',
  java: 'java',
  javascript: 'js',
  js: 'js',
  kotlin: 'java',
  node: 'js',
  py: 'python',
  python: 'python',
  rust: 'rust',
  ts: 'js',
  typescript: 'js',
};
// each language's commands, within the repository tool policy (packages/engine/engine/run/load.js repositoryToolPolicy)
const TOOLCHAIN = {
  csharp: ['bash:dotnet'],
  go: ['bash:go'],
  java: ['bash:gradle', 'bash:mvn'],
  js: ['bash:node', 'bash:npm', 'bash:npx'],
  python: ['bash:pip', 'bash:pytest', 'bash:python'],
  rust: ['bash:cargo'],
};
// a test command's runner the policy allows, beyond the language's own
const RUNNERS = ['./gradlew', './mvnw', 'cargo', 'dotnet', 'go', 'gradle', 'mvn', 'node', 'npm', 'npx', 'pnpm', 'poetry', 'py', 'pytest', 'python', 'python3', 'uv', 'yarn'];

// the workflow provider definition of the CLI the agents run on (its adapter's, as the Builder writes it)
const PROVIDERS = { claude: registry.byId('claude').definition };
// the profile's fields the owner may override with an answer of the same name
const PROFILE_FIELDS = ['checkCommand', 'ci', 'e2eCommand', 'languages', 'mode', 'release', 'testCommand', 'tests'];
const STRONG_MODEL = 'claude-opus-5-5';
const FAST_MODEL = 'claude-sonnet-5';

const HEADER = '# Composed by the ways-of-working interview (Projects > Ways of working, #487) from the\n'
  + '# repository\'s history and the owner\'s answers. Edit it by hand or in the Builder; commit it to use it.\n';

const str = (v) => (v == null ? '' : String(v).trim());
// a project value inside a template: kept as written, never read as a template
const literal = (v) => (/[{}]/.test(str(v)) ? `{% raw %}${str(v)}{% endraw %}` : str(v));
const unique = (list) => [...new Set(list)];

/** The language keys and the language skills of a list of languages: { languages, skills }. */
function languageFacts(languages) {
  const keys = unique((Array.isArray(languages) ? languages : []).map((l) => LANGUAGE_KEYS[str(l).toLowerCase()]).filter(Boolean));
  return { languages: keys, skills: keys.map((k) => `unit-test-writer-${k}`) };
}

// the profile's mode; a #487 profile named the merge style instead (local | pr)
const modeOf = (profile) => (MODES.includes(profile?.mode) ? profile.mode : { local: 'local', pr: 'remote' }[profile?.merge] || null);
const isRemote = (profile) => modeOf(profile) === 'remote';
const hasUi = (profile) => (profile?.languages || []).some((l) => LANGUAGE_KEYS[str(l).toLowerCase()] === 'js');

/**
 * The questions the profile leaves open, each with its default from the profile:
 * [{ id, label, question, type: 'choice'|'number', options?, default }]. Validation, the budget per
 * issue, screenshots and the review rigour are always the owner's; the release style, the mode, the
 * CI and the tests only when the analysis could not settle them.
 */
function openQuestions(profile) {
  const remote = isRemote(profile);
  const choice = (values) => values.map(([value, label]) => ({ value, label }));
  const out = [
    { id: 'validate', label: 'Validation', question: 'Approve every change before it lands, or trust the automatic checks?', type: 'choice', options: choice([['validate', 'Validate every round'], ['auto', 'Trust auto']]), default: 'validate' },
    { id: 'budget', label: 'Budget per issue', question: 'The most one issue may spend on models, in US$.', type: 'number', default: remote ? 30 : 20 },
    { id: 'screenshots', label: 'Screenshots', question: 'Capture the screens a change touches as its evidence?', type: 'choice', options: choice([['on', 'On'], ['off', 'Off']]), default: hasUi(profile) ? 'on' : 'off' },
    { id: 'review', label: 'Review rigour', question: 'How hard the code review is before the tests run.', type: 'choice', options: choice([['light', 'Light: one round'], ['standard', 'Standard: two rounds'], ['strict', 'Strict: three rounds']]), default: remote ? 'strict' : 'standard' },
  ];
  if (!RELEASE_STYLES.includes(profile?.release)) {
    out.push({ id: 'release', label: 'Release style', question: 'How the project releases: no tag history settles it.', type: 'choice', options: choice([['milestone', 'Milestone'], ['per-merge', 'Per merge'], ['train', 'Release train'], ['rc-stable', 'Release candidate, then stable']]), default: remote ? 'train' : 'milestone' });
  }
  if (!modeOf(profile)) {
    // #738: Fork + PR comes from the onboarding (no push access), never from this question
    out.push({ id: 'mode', label: 'Mode', question: 'How changes land: merged into the local base and pushed, or through pull requests.', type: 'choice', options: profileChoices('mode').filter((o) => o.value !== 'fork'), default: 'local' });
  }
  if (!CI_STYLES.includes(profile?.ci)) {
    out.push({ id: 'ci', label: 'CI', question: 'What the project\'s CI runs on: no CI file settles it.', type: 'choice', options: profileChoices('ci'), default: 'none' });
  }
  if (!TEST_STYLES.includes(profile?.tests)) {
    out.push({ id: 'tests', label: 'Tests', question: 'Does the project have an E2E suite the feature workflow writes first?', type: 'choice', options: profileChoices('tests'), default: 'unit' });
  }
  return out;
}

const languageList = (v) => (Array.isArray(v) ? v : str(v).split(',')).map(str).filter(Boolean);

/** The profile with the owner's overrides (answers named after its fields; an empty answer keeps the inferred value). */
function withOverrides(profile, answers) {
  const out = { ...(profile || {}) };
  for (const f of PROFILE_FIELDS) {
    const v = answers?.[f];
    if (v == null || (typeof v === 'string' && !v.trim())) continue;
    out[f] = f === 'languages' ? languageList(v) : v;
  }
  return out;
}

// the platform a CI or platform the seed names belongs to ("GitLab CI", "github"), GitHub's when none matches
const platformOfCi = (ci) => PLATFORMS.find((p) => ci.toLowerCase().includes(p.id)) || PLATFORMS[0];

// The profile under the owner's answers, each field checked: what the composition builds from
function settingsOf(profile = {}, answers = {}) {
  const p = profile || {};
  const a = answers || {};
  const mode = modeOf({ mode: a.mode, merge: a.merge }) || modeOf(p) || 'local';
  const defaults = Object.fromEntries(openQuestions({ ...p, mode, release: null, ci: null, tests: null }).map((q) => [q.id, q.default]));
  const pick = (id, allowed) => [a[id], p[id], defaults[id]].find((v) => allowed.includes(v));
  const budget = Number(a.budget);
  // a #487 profile's ci named the CI itself (GitHub Actions): the platform, not a trigger
  const platform = [a.platform, p.platform, a.ci, p.ci].map(str).find((v) => v && !CI_STYLES.includes(v)) || '';
  return {
    mode,
    ci: pick('ci', CI_STYLES),
    tests: pick('tests', TEST_STYLES),
    release: pick('release', RELEASE_STYLES),
    review: pick('review', REVIEW_LEVELS),
    validate: !(a.validate === false || a.validate === 'auto'),
    screenshots: a.screenshots === undefined ? defaults.screenshots === 'on' : a.screenshots === true || a.screenshots === 'on',
    budget: Number.isFinite(budget) && budget > 0 ? budget : defaults.budget,
    testCommand: str(a.testCommand) || str(p.testCommand),
    e2eCommand: str(a.e2eCommand) || str(p.e2eCommand),
    checkCommand: str(a.checkCommand) || str(p.checkCommand),
    platform: platformOfCi(platform).short,
  };
}

const runnerOf = (command) => {
  const first = str(command).split(/\s+/)[0];
  return RUNNERS.includes(first) ? [`bash:${first}`] : [];
};
const toolsOf = (s, facts, extra) => unique([...extra, ...(facts.languages || []).flatMap((k) => TOOLCHAIN[k] || []), ...runnerOf(s.testCommand), ...runnerOf(s.checkCommand)]).sort();

// the project's facts, as a paragraph of an agent's system prompt
function factsText(s, facts) {
  const langs = (facts.languages || []).length ? facts.languages.join(', ') : 'see the project\'s files';
  const tests = s.testCommand ? `\`${literal(s.testCommand)}\`` : 'the test command found from the project\'s files';
  const check = s.checkCommand ? `; its checks (lint, types) run with \`${literal(s.checkCommand)}\`` : '';
  return `The project: languages ${langs}; its tests run with ${tests}${check}.`;
}

const agent = ({ model = STRONG_MODEL, effort, session = 'persistent', tools, skills, system }) => ({
  provider: 'claude',
  model,
  ...(effort ? { effort } : {}),
  session,
  capabilities: { tools, web: false },
  ...(skills && skills.length ? { skills } : {}),
  system_prompt: `${system.trim()}\nNobody can answer questions: record assumptions. Write in the language the Language line names.\n`,
});

const workflowBase = ({ name, description, category, tags, inputs, worktree, budget }) => ({
  apiVersion: 'multiagent/v1',
  kind: 'Workflow',
  metadata: { name, version: '0.1.0', description, tags, category },
  inputs,
  providers: PROVIDERS,
  defaults: {
    fresh_after_idle: '55m',
    working_dir: worktree ? '{{ worktree_dir }}' : '{{ inputs.project_path }}',
    timeout: '30m',
    max_context: '150k',
    retry: { max_attempts: 2, backoff: 'exponential', initial_delay: '10s' },
  },
  orchestrator: {
    provider: 'claude',
    model: FAST_MODEL,
    ...(worktree ? { worktree } : {}),
    supervisor: { enabled: true, on_call: true, max_interventions: 2, max_cost_usd: 5 },
    limits: { max_total_duration: '8h', max_total_cost_usd: budget },
  },
});

const REPO_INPUTS = {
  repo_path: { label: 'Repository', type: 'string', required: true, description: 'Local repository path (a git repository).' },
  base_branch: { label: 'Base branch', type: 'string', default: 'main', description: 'The branch the work starts from and lands on.' },
};
// #738 Fork + PR: the worktree syncs the fork's base with upstream's first (worktree.js syncForkBase)
const worktreeOf = (s) => ({ repo: '{{ inputs.repo_path }}', base: '{{ inputs.base_branch }}', ...(s.mode === 'local' ? { remote: false } : {}), ...(s.mode === 'fork' ? { fork: true } : {}) });
// #738: a fork set tells pr-pipeline its mode (the fork block of its prompts) and takes a dependent
// roadmap item's parent branch and parent PR (the roadmap sets them)
const FORK_INPUTS = {
  mode: { label: 'Mode', type: 'string', enum: ['fork'], default: 'fork', options: { fork: 'Fork + PR' }, description: 'Fork + PR: the branch is pushed to your fork (origin), the pull request opened against the original (upstream).' },
  parent_branch: { label: 'Parent branch', type: 'string', default: '', description: 'The branch on your fork this run starts from (the earlier item of a split implementation). Empty: the fork\'s default branch, synced with the original.' },
  depends_on: { label: 'Depends on', type: 'string', default: '', description: 'The earlier pull request this one depends on (e.g. #12), written in the pull request\'s body.' },
  parent_pr: { label: 'Parent pull request', type: 'string', default: '', description: 'The URL of the earlier pull request to wait for: the pull request opens once it merged upstream, rebased onto the synced default branch.' },
};
const modeInputs = (s) => (s.mode === 'fork' ? FORK_INPUTS : {});
const withE2e = (s) => s.tests === 'unit+e2e' && !!s.e2eCommand;

// the project's E2E command as a step, after the unit suite (#630: tests unit+e2e)
const e2eStep = (s, fragment, next, failed) => ({ id: 'e2e', fragment, command: literal(s.e2eCommand), transitions: [
  { when: "output.status == 'pass'", goto: next },
  ...failed,
] });

// The develop → review → suite (→ e2e) → verify → land steps of feature and fix: the change lands with
// the local merge, then push_main (Local), or through a pull request (Remote)
function changeSteps(s, review) {
  const local = s.mode === 'local';
  // R7: only a project whose CI runs on pull requests waits for it; else the PR is opened and handed over
  const prCi = s.ci === 'pr+release';
  const land = local ? { merge: 'local', goto: 'push_main', on_error: 'resolve_merge' } : { goto: prCi ? 'ci' : 'pr_open' };
  const verified = s.validate ? { goto: 'validate' } : land;
  const retry = [
    { when: "output.status == 'blocked'", goto: 'verify_failed' },
    { when: 'true', goto: 'develop', max_visits: 2, on_exhausted: 'verify_failed' },
  ];
  return [
    { id: 'code_review', fragment: 'dev-pipeline', agent: 'reviewer', transitions: [
      { when: 'output.approved', goto: 'suite' },
      { when: 'true', goto: 'develop', max_visits: review.rounds, on_exhausted: 'verify_failed' },
    ] },
    { id: 'suite', fragment: 'dev-pipeline', command: literal(s.testCommand), transitions: [
      { when: "output.status == 'pass'", goto: withE2e(s) ? 'e2e' : 'verify_change' },
      ...retry,
    ] },
    ...(withE2e(s) ? [e2eStep(s, 'dev-pipeline', 'verify_change', retry)] : []),
    { id: 'verify_change', fragment: 'dev-pipeline', agent: 'verifier', transitions: [
      { when: "output.verdict != 'not_verified'", ...verified },
      { when: 'true', goto: 'develop', max_visits: 2, on_exhausted: 'verify_failed' },
    ] },
    ...(s.validate ? [{ id: 'validate', fragment: 'dev-pipeline', transitions: [{ when: 'approved', ...land }, { when: 'rejected', goto: 'develop' }] }] : []),
    { id: 'verify_failed', fragment: 'dev-pipeline', transitions: [{ when: 'approved', ...land }, { when: 'rejected', goto: 'end', status: 'failed' }] },
    ...(local
      ? [{ id: 'resolve_merge', fragment: 'local-merge-pipeline', agent: 'developer' }, { id: 'merge_blocked', fragment: 'local-merge-pipeline' }, { id: 'push_main', fragment: 'local-merge-pipeline' }]
      : prCi
        ? [{ id: 'ci', fragment: 'pr-pipeline', agent: 'ci_pusher' }, { id: 'ci_failed', fragment: 'pr-pipeline' }, { id: 'pr_review', fragment: 'pr-pipeline' }]
        : [{ id: 'pr_open', fragment: 'pr-pipeline', agent: 'ci_pusher' }, { id: 'pr_review', fragment: 'pr-pipeline' }]),
  ];
}

// the agents of feature and fix; `order` is the developer's way of working with the tests
function changeAgents(s, facts, order) {
  const local = s.mode === 'local';
  const review = REVIEW[s.review];
  const facts1 = factsText(s, facts);
  const build = toolsOf(s, facts, ['bash:git', 'edit', 'read', 'write']);
  return {
    developer: agent({ effort: 'high', tools: build, skills: facts.skills, system: `You are the developer. You implement the task on the run's branch with small, cohesive changes that follow the project's conventions, with their tests. ${order} ${facts1} Never push, except in the push main step.` }),
    reviewer: agent({ effort: review.effort, tools: ['bash:git', 'read'], system: `You are the code reviewer (${s.review} rigour). You read the change's diff and approve it or list what to change; you change nothing. ${facts1}` }),
    verifier: agent({ model: FAST_MODEL, effort: 'medium', tools: toolsOf(s, facts, ['bash:git', 'read']), skills: facts.skills, system: `You are the verifier. You check, with one command and its observed result, that the change does what the task asked. ${facts1}${s.screenshots ? ' Capture the screens the change touches (the project\'s screenshot command, else a short description of each state) and name them in your evidence.' : ''}` }),
    ...(local ? {} : { ci_pusher: agent({ model: FAST_MODEL, effort: 'medium', tools: ['bash:gh', 'bash:git', 'bash:glab', 'read'], system: s.mode === 'fork'
      // #738: the owner can't push to the original: the branch goes to the fork, the PR to upstream
      ? 'You are the CI pusher. You push the run\'s branch to origin (the owner\'s fork), open its pull request against the original repository (upstream) and read its CI. Never push to upstream. The pull request follows the repository\'s CONTRIBUTING.md and its pull request template.'
      : 'You are the CI pusher. You push the run\'s branch, open its pull request and read its CI.' }) }),
  };
}

const landsText = (s) => (s.mode === 'local'
  ? 'then merges it into the local base branch and pushes it (push_main). No pull request.'
  : s.mode === 'fork'
    ? `then pushes it to your fork and opens a pull request against the original${s.ci === 'pr+release' ? ', waits for its CI' : ''}; the maintainers merge it.`
    : `then opens a pull request${s.ci === 'pr+release' ? ' and waits for its CI' : ''}; the team merges it.`);
const CHANGE_INPUTS = {
  task: { label: 'Task', type: 'string', required: true, description: 'Feature or bug to implement.' },
  issue: { label: 'Issue', type: 'string', default: '', description: 'URL of the issue this run implements (set by the Backlog screen).' },
};

function featureWorkflow(s, facts) {
  const doc = workflowBase({
    name: 'feature',
    description: `Develops, reviews, tests and verifies a change in its own worktree, ${landsText(s)}`,
    category: 'build',
    tags: ['dev', 'review', 'test', s.mode],
    budget: s.budget,
    worktree: worktreeOf(s),
    inputs: { ...CHANGE_INPUTS, ...REPO_INPUTS, ...modeInputs(s) },
  });
  // spec D14: with E2E the scenarios come first; unit only: implement, then the unit tests
  const order = withE2e(s)
    ? `Write the E2E scenarios of the task first (they run with \`${literal(s.e2eCommand)}\`), then implement until they pass.`
    : 'Implement the change, then write its unit tests.';
  doc.agents = changeAgents(s, facts, order);
  doc.steps = [
    { id: 'develop', fragment: 'dev-pipeline', agent: 'developer', transitions: [{ when: 'true', goto: 'code_review' }] },
    ...changeSteps(s, REVIEW[s.review]),
  ];
  return doc;
}

// #630: fix reproduces the bug first, fixes it with its regression test (E2E after, when the project has
// them); its hotfix mode is the urgent lane: from the last release tag, shipped as a patch
function fixWorkflow(s, facts) {
  const doc = workflowBase({
    name: 'fix',
    description: `Reproduces a bug, fixes it with its regression test, reviews, tests and verifies it, ${landsText(s)} Hotfix mode: from the last release tag, shipped as a patch.`,
    category: 'build',
    tags: ['fix', 'review', 'test', s.mode],
    budget: Math.max(5, Math.round(s.budget / 2)),
    worktree: worktreeOf(s),
    inputs: {
      ...CHANGE_INPUTS,
      hotfix: { label: 'Hotfix', type: 'boolean', default: false, description: 'An urgent fix: branched from the last release tag and shipped as a patch release.' },
      ...REPO_INPUTS,
      ...modeInputs(s),
    },
  });
  const order = withE2e(s)
    ? `Fix the bug with a unit regression test; the E2E suite (\`${literal(s.e2eCommand)}\`) runs after.`
    : 'Fix the bug, then write its regression test.';
  doc.agents = changeAgents(s, facts, order);
  doc.steps = [
    { id: 'reproduce', fragment: 'fix-pipeline', agent: 'developer', transitions: [{ when: 'true', goto: 'develop' }] },
    { id: 'develop', fragment: 'fix-pipeline', agent: 'developer', transitions: [{ when: 'true', goto: 'code_review' }] },
    ...changeSteps(s, REVIEW.light),
  ];
  return doc;
}

// each release style: what the release manager gathers, and the steps after the tests
const RELEASE_STYLE = {
  milestone: { scope: 'Milestone', what: 'A release closes a milestone: it contains the issues of that milestone, merged since the last tag.', gate: true },
  'per-merge': { scope: 'Merge', what: 'A release follows every merge: it contains the change merged since the last tag, usually one.', gate: false },
  train: { scope: 'Train', what: 'Releases leave on a fixed cadence: a release contains everything merged since the last train\'s tag, whatever it is.', gate: true },
  'rc-stable': { scope: 'Release', what: 'A release candidate (-rc.N tag) is cut first and tried; the stable tag follows on the same commit once it holds.', gate: true },
};

function releaseWorkflow(s, facts) {
  const style = RELEASE_STYLE[s.release];
  // #630 (spec R7): with a CI on tags, the release pushes the tag and waits for that run
  const waitCi = s.ci !== 'none';
  const doc = workflowBase({
    name: 'release',
    description: `Releases the project (${s.release}): gathers the changes, runs the tests${withE2e(s) ? ' and the E2E suite' : ''}, writes the notes and tags the version${waitCi ? ', then waits for the release CI' : ''}. Nothing ships from here: the tag is the release.`,
    category: 'build',
    tags: ['release', s.release],
    budget: Math.max(5, Math.round(s.budget / 2)),
    worktree: worktreeOf(s),
    inputs: {
      ...REPO_INPUTS,
      scope: { label: style.scope, type: 'string', default: '', description: 'What this release covers (a milestone, a train, a version); empty: everything since the last tag.' },
    },
  });
  const facts1 = factsText(s, facts);
  doc.agents = {
    release_manager: agent({ model: FAST_MODEL, effort: 'medium', tools: ['bash:git', 'read'], system: `You are the release manager. ${style.what} ${facts1} Read only.` }),
    notes_writer: agent({ model: FAST_MODEL, effort: 'low', session: 'ephemeral', tools: ['bash:git', 'read'], system: 'You write the release notes from the changes the release manager gathered.' }),
    tagger: agent({ model: FAST_MODEL, effort: 'low', session: 'ephemeral', tools: ['bash:git', 'read'], system: 'You tag the release on the base branch. You change no file and never force anything.' }),
    ...(waitCi ? { ci_watcher: agent({ model: FAST_MODEL, effort: 'low', session: 'ephemeral', tools: ['bash:gh', 'bash:git', 'bash:glab', 'read'], system: 'You read the CI run of the release tag and report its status. You change nothing.' }) } : {}),
  };
  const rc = s.release === 'rc-stable';
  const gate = style.gate || s.validate;
  const afterNotes = rc ? 'tag_rc' : gate ? 'approve' : 'tag';
  const failed = [{ when: 'true', goto: 'end', status: 'failed' }];
  doc.steps = [
    { id: 'prepare', fragment: 'release-pipeline', agent: 'release_manager', transitions: [{ when: 'true', goto: 'suite' }] },
    { id: 'suite', fragment: 'release-pipeline', command: literal(s.testCommand), transitions: [
      { when: "output.status == 'pass'", goto: withE2e(s) ? 'e2e' : 'notes' },
      ...failed,
    ] },
    ...(withE2e(s) ? [e2eStep(s, 'release-pipeline', 'notes', failed)] : []),
    { id: 'notes', fragment: 'release-pipeline', agent: 'notes_writer', transitions: [{ when: 'true', goto: afterNotes }] },
    ...(rc ? [
      { id: 'tag_rc', fragment: 'release-pipeline', agent: 'tagger', transitions: [{ when: 'true', goto: 'soak' }] },
      { id: 'soak', fragment: 'release-pipeline', transitions: [{ when: 'approved', goto: 'tag' }, { when: 'rejected', goto: 'end', status: 'cancelled' }] },
    ] : gate ? [
      { id: 'approve', fragment: 'release-pipeline', transitions: [{ when: 'approved', goto: 'tag' }, { when: 'rejected', goto: 'end', status: 'cancelled' }] },
    ] : []),
    { id: 'tag', fragment: 'release-pipeline', agent: 'tagger', transitions: [{ when: 'true', goto: waitCi ? 'release_ci' : 'end' }] },
    ...(waitCi ? [{ id: 'release_ci', fragment: 'release-pipeline', agent: 'ci_watcher' }, { id: 'release_ci_failed', fragment: 'release-pipeline' }] : []),
  ];
  return doc;
}

const dump = (doc) => `${HEADER}\n${yaml.dump(doc, { lineWidth: -1, noRefs: true })}`;

/**
 * The workflow set of a profile and the owner's answers (answers win over the profile):
 * { workflows: [{ name, category, path, yaml }], manifest: { path, yaml }, settings }. `facts`: the
 * project's { languages, skills } (default: the profile's languages, languageFacts). `existing`: the
 * repository's manifest (packages/engine/domains/project/project-manifest.js readManifest), which the composed one is merged
 * into (mergeManifest). Writes nothing.
 */
function composeWorkflowSet({ profile, answers, facts, existing } = {}) {
  const prof = withOverrides(profile, answers);
  const s = settingsOf(prof, answers);
  const f = facts && Array.isArray(facts.skills) ? { languages: languageFacts(facts.languages).languages, skills: facts.skills } : languageFacts(prof.languages);
  // #630 (spec D9): feature, fix and release, the code's life cycle
  const set = [
    { category: 'feature', doc: featureWorkflow(s, f) },
    { category: 'fix', doc: fixWorkflow(s, f) },
    { category: 'release', doc: releaseWorkflow(s, f) },
  ];
  const workflows = set.map(({ category, doc }) => ({
    name: doc.metadata.name,
    category,
    path: `${MULTIAGENT_DIR}/workflows/${doc.metadata.name}.yaml`,
    yaml: dump(doc),
  }));
  const manifest = mergeManifest(existing, set.map(({ category, doc }) => ({ name: doc.metadata.name, file: `workflows/${doc.metadata.name}.yaml`, category, description: doc.metadata.description })));
  return { workflows, manifest: { path: MANIFEST_FILE, yaml: dump(manifest) }, settings: s };
}

/**
 * The manifest of the repository's one (`existing`: { version, requires, workflows }, none: a new
 * one) with the composed entries: they replace the entries of the same name, in their place; the
 * other entries, version and requires stay.
 */
function mergeManifest(existing, entries) {
  const clean = (e) => Object.fromEntries(Object.entries(e).filter(([, v]) => v != null));
  const composed = new Map(entries.map((e) => [e.name, e]));
  const kept = (existing?.workflows || []).map((e) => composed.get(e.name) || clean(e));
  const added = entries.filter((e) => !kept.includes(e));
  return {
    version: existing?.version ?? 1,
    ...(existing?.requires ? { requires: existing.requires } : {}),
    workflows: [...kept, ...added],
  };
}

module.exports = {
  CI_STYLES,
  composeWorkflowSet,
  languageFacts,
  mergeManifest,
  MODES,
  openQuestions,
  PROFILE_FIELDS,
  RELEASE_STYLES,
  REVIEW_LEVELS,
  TEST_STYLES,
};
