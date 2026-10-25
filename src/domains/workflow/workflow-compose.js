// #487: a project's workflow set composed from its ways of working. The ways-of-working seed
// (seeds/ways-of-working/seed.md) infers a profile from the repository (solo or team, local merge or
// pull requests, the release style, the test and check commands, CI, languages); the interview
// (src/service/areas/workflow-interview.js) asks only what the profile leaves open (openQuestions),
// and the owner may override any inferred field (answers named after the profile's fields, PROFILE_FIELDS).
// composeWorkflowSet builds the set from the step fragments (fragments/intake-pipeline,
// dev-pipeline, local-merge-pipeline, pr-pipeline, release-pipeline): an intake workflow, the
// development workflow in the chosen merge style, the release workflow in the chosen release style,
// with the project's facts (test and check commands, languages, language skills) in the agents'
// prompts, and the `.multiagent/project.yaml` manifest that lists them (src/domains/project/project-manifest.js),
// merged into the one the repository already has (mergeManifest). Pure: it returns YAML texts;
// writing them into the project is the service's, on the owner's click.

'use strict';

const path = require('path');
const yaml = require('js-yaml');
const registry = require('@multiagent/shared/providers');
const { PLATFORMS } = require('@multiagent/shared/platforms');
const { MANIFEST_FILE } = require('../project/project-manifest');

const MULTIAGENT_DIR = path.posix.dirname(MANIFEST_FILE);

const TEAM_STYLES = ['solo', 'team'];
const MERGE_STYLES = ['local', 'pr'];
const RELEASE_STYLES = ['milestone', 'per-merge', 'train', 'rc-stable'];
const REVIEW_LEVELS = ['light', 'standard', 'strict'];
// review rounds before the change goes on to the escalation gate, and the reviewer's effort
const REVIEW = { light: { rounds: 1, effort: 'low' }, standard: { rounds: 2, effort: 'medium' }, strict: { rounds: 3, effort: 'high' } };

// a language as the seed or the Architecture facts name it → the `language` key of the skills
// (unit-test-writer-<key>, src/engine/language-skills.js)
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
// each language's commands, within the repository tool policy (src/engine/run/load.js repositoryToolPolicy)
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
const PROFILE_FIELDS = ['checkCommand', 'ci', 'languages', 'merge', 'release', 'team', 'testCommand'];
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

const isTeam = (profile) => profile?.team === 'team';
const hasUi = (profile) => (profile?.languages || []).some((l) => LANGUAGE_KEYS[str(l).toLowerCase()] === 'js');

/**
 * The questions the profile leaves open, each with its default from the profile:
 * [{ id, label, question, type: 'choice'|'number', options?, default }]. Validation, the budget per
 * issue, screenshots and the review rigour are always the owner's; the release style, the merge
 * style and solo or team only when the analysis could not settle them.
 */
function openQuestions(profile) {
  const team = isTeam(profile);
  const choice = (values) => values.map(([value, label]) => ({ value, label }));
  const out = [
    { id: 'validate', label: 'Validation', question: 'Approve every change before it lands, or trust the automatic checks?', type: 'choice', options: choice([['validate', 'Validate every round'], ['auto', 'Trust auto']]), default: 'validate' },
    { id: 'budget', label: 'Budget per issue', question: 'The most one issue may spend on models, in US$.', type: 'number', default: team ? 30 : 20 },
    { id: 'screenshots', label: 'Screenshots', question: 'Capture the screens a change touches as its evidence?', type: 'choice', options: choice([['on', 'On'], ['off', 'Off']]), default: hasUi(profile) ? 'on' : 'off' },
    { id: 'review', label: 'Review rigour', question: 'How hard the code review is before the tests run.', type: 'choice', options: choice([['light', 'Light: one round'], ['standard', 'Standard: two rounds'], ['strict', 'Strict: three rounds']]), default: team ? 'strict' : 'standard' },
  ];
  if (!RELEASE_STYLES.includes(profile?.release)) {
    out.push({ id: 'release', label: 'Release style', question: 'How the project releases: no tag history settles it.', type: 'choice', options: choice([['milestone', 'Milestone'], ['per-merge', 'Per merge'], ['train', 'Release train'], ['rc-stable', 'Release candidate, then stable']]), default: team ? 'train' : 'milestone' });
  }
  if (!MERGE_STYLES.includes(profile?.merge)) {
    out.push({ id: 'merge', label: 'Merge', question: 'How changes land: merged locally or through pull requests.', type: 'choice', options: choice([['local', 'Local merge'], ['pr', 'Pull requests']]), default: team ? 'pr' : 'local' });
  }
  if (!TEAM_STYLES.includes(profile?.team)) {
    out.push({ id: 'team', label: 'Team', question: 'Who works on the project: one person, or a team that reviews each other\'s changes.', type: 'choice', options: choice([['solo', 'Solo'], ['team', 'Team']]), default: 'solo' });
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

// the platform a CI the seed names belongs to ("GitLab CI", "GitHub Actions"), GitHub's when none matches
const platformOfCi = (ci) => PLATFORMS.find((p) => ci.toLowerCase().includes(p.id)) || PLATFORMS[0];

// The profile under the owner's answers, each field checked: what the composition builds from
function settingsOf(profile = {}, answers = {}) {
  const p = profile || {};
  const a = answers || {};
  const defaults = Object.fromEntries(openQuestions({ ...p, release: null, merge: null }).map((q) => [q.id, q.default]));
  const pick = (id, allowed) => [a[id], p[id], defaults[id]].find((v) => allowed.includes(v));
  const budget = Number(a.budget);
  const testCommand = str(a.testCommand) || str(p.testCommand);
  return {
    team: [a.team, p.team].find((v) => TEAM_STYLES.includes(v)) || 'solo',
    merge: pick('merge', MERGE_STYLES),
    release: pick('release', RELEASE_STYLES),
    review: pick('review', REVIEW_LEVELS),
    validate: !(a.validate === false || a.validate === 'auto'),
    screenshots: a.screenshots === undefined ? defaults.screenshots === 'on' : a.screenshots === true || a.screenshots === 'on',
    budget: Number.isFinite(budget) && budget > 0 ? budget : defaults.budget,
    testCommand,
    checkCommand: str(a.checkCommand) || str(p.checkCommand),
    platform: platformOfCi(str(a.ci) || str(p.ci)).short,
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
const worktreeOf = (s) => ({ repo: '{{ inputs.repo_path }}', base: '{{ inputs.base_branch }}', ...(s.merge === 'local' ? { remote: false } : {}) });

function intakeWorkflow(s) {
  const doc = workflowBase({
    name: 'intake',
    description: `Turns a request into an issue of the project's tracker${s.validate ? ' after you review the draft' : ', filed as soon as it is written'}.`,
    category: 'plan',
    tags: ['issues', 'intake'],
    budget: Math.max(2, Math.round(s.budget / 4)),
    inputs: {
      request: { label: 'Request', type: 'string', required: true, description: 'The problem or the idea, in a few words, in any language.' },
      project_path: { label: 'Project folder', type: 'string', required: true, description: 'The repository the issue is about (read-only).' },
      git_platform: { label: 'Platform', type: 'string', enum: PLATFORMS.map((p) => p.short), default: s.platform, options: Object.fromEntries(PLATFORMS.map((p) => [p.short, p.label])), description: 'Where the issue is filed.' },
    },
  });
  const vcs = ['bash:gh', 'bash:git', 'bash:glab'];
  doc.agents = {
    issue_writer: agent({ effort: 'high', tools: ['read', ...vcs], system: `You are the issue writer. You turn the owner's request into an issue someone else can implement without asking, with evidence from the code (file:line). Read only: use git and gh/glab to read, never to change anything.` }),
    issue_filer: agent({ model: FAST_MODEL, effort: 'low', session: 'ephemeral', tools: ['bash:gh', 'bash:glab'], system: 'You are the issue filer. You file the drafted issue exactly as written, with its labels, and report its URL.' }),
  };
  doc.steps = [
    { id: 'write', fragment: 'intake-pipeline', agent: 'issue_writer', transitions: [{ when: 'true', goto: s.validate ? 'review' : 'file' }] },
    ...(s.validate ? [{ id: 'review', fragment: 'intake-pipeline', transitions: [{ when: 'approved', goto: 'file' }, { when: 'rejected', goto: 'write' }] }] : []),
    { id: 'file', fragment: 'intake-pipeline', agent: 'issue_filer', transitions: [{ when: 'true', goto: 'end' }] },
  ];
  return doc;
}

function developmentWorkflow(s, facts) {
  const local = s.merge === 'local';
  const review = REVIEW[s.review];
  const name = `development-${s.team}-${s.merge}`;
  const doc = workflowBase({
    name,
    description: local
      ? 'Develops, reviews, tests and verifies a change in its own worktree, then merges it into the local base branch. No push, no pull request.'
      : 'Develops, reviews, tests and verifies a change in its own worktree, then opens a pull request and waits for CI; the team merges it.',
    category: 'build',
    tags: ['dev', 'review', 'test', local ? 'local' : 'pr'],
    budget: s.budget,
    worktree: worktreeOf(s),
    inputs: {
      task: { label: 'Task', type: 'string', required: true, description: 'Feature or bug to implement.' },
      issue: { label: 'Issue', type: 'string', default: '', description: 'URL of the issue this run implements (set by the Backlog screen).' },
      ...REPO_INPUTS,
    },
  });
  const facts1 = factsText(s, facts);
  const build = toolsOf(s, facts, ['bash:git', 'edit', 'read', 'write']);
  doc.agents = {
    developer: agent({ effort: 'high', tools: build, skills: facts.skills, system: `You are the developer. You implement the task on the run's branch with small, cohesive changes that follow the project's conventions, with their tests. ${facts1} Never push.` }),
    reviewer: agent({ effort: review.effort, tools: ['bash:git', 'read'], system: `You are the code reviewer (${s.review} rigour). You read the change's diff and approve it or list what to change; you change nothing. ${facts1}` }),
    verifier: agent({ model: FAST_MODEL, effort: 'medium', tools: toolsOf(s, facts, ['bash:git', 'read']), skills: facts.skills, system: `You are the verifier. You check, with one command and its observed result, that the change does what the task asked. ${facts1}${s.screenshots ? ' Capture the screens the change touches (the project\'s screenshot command, else a short description of each state) and name them in your evidence.' : ''}` }),
    ...(local ? {} : { ci_pusher: agent({ model: FAST_MODEL, effort: 'medium', tools: ['bash:gh', 'bash:git', 'bash:glab', 'read'], system: 'You are the CI pusher. You push the run\'s branch, open its pull request and read its CI.' }) }),
  };
  // where a verified (or approved) change goes: the local merge, or the pull request
  const land = local ? { merge: 'local', goto: 'end', on_error: 'resolve_merge' } : { goto: 'ci' };
  const verified = s.validate ? { goto: 'validate' } : land;
  doc.steps = [
    { id: 'develop', fragment: 'dev-pipeline', agent: 'developer', transitions: [{ when: 'true', goto: 'code_review' }] },
    { id: 'code_review', fragment: 'dev-pipeline', agent: 'reviewer', transitions: [
      { when: 'output.approved', goto: 'suite' },
      { when: 'true', goto: 'develop', max_visits: review.rounds, on_exhausted: 'verify_failed' },
    ] },
    { id: 'suite', fragment: 'dev-pipeline', command: literal(s.testCommand), transitions: [
      { when: "output.status == 'pass'", goto: 'verify_change' },
      { when: "output.status == 'blocked'", goto: 'verify_failed' },
      { when: 'true', goto: 'develop', max_visits: 2, on_exhausted: 'verify_failed' },
    ] },
    { id: 'verify_change', fragment: 'dev-pipeline', agent: 'verifier', transitions: [
      { when: "output.verdict != 'not_verified'", ...verified },
      { when: 'true', goto: 'develop', max_visits: 2, on_exhausted: 'verify_failed' },
    ] },
    ...(s.validate ? [{ id: 'validate', fragment: 'dev-pipeline', transitions: [{ when: 'approved', ...land }, { when: 'rejected', goto: 'develop' }] }] : []),
    { id: 'verify_failed', fragment: 'dev-pipeline', transitions: [{ when: 'approved', ...land }, { when: 'rejected', goto: 'end', status: 'failed' }] },
    ...(local
      ? [{ id: 'resolve_merge', fragment: 'local-merge-pipeline', agent: 'developer' }, { id: 'merge_blocked', fragment: 'local-merge-pipeline' }]
      : [{ id: 'ci', fragment: 'pr-pipeline', agent: 'ci_pusher' }, { id: 'ci_failed', fragment: 'pr-pipeline' }, { id: 'pr_review', fragment: 'pr-pipeline' }]),
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
  const doc = workflowBase({
    name: `release-${s.release}`,
    description: `Releases the project (${s.release}): gathers the changes, runs the tests, writes the notes and tags the version. Nothing ships from here: the tag is the release.`,
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
  };
  const rc = s.release === 'rc-stable';
  const gate = style.gate || s.validate;
  const afterNotes = rc ? 'tag_rc' : gate ? 'approve' : 'tag';
  doc.steps = [
    { id: 'prepare', fragment: 'release-pipeline', agent: 'release_manager', transitions: [{ when: 'true', goto: 'suite' }] },
    { id: 'suite', fragment: 'release-pipeline', command: literal(s.testCommand), transitions: [
      { when: "output.status == 'pass'", goto: 'notes' },
      { when: 'true', goto: 'end', status: 'failed' },
    ] },
    { id: 'notes', fragment: 'release-pipeline', agent: 'notes_writer', transitions: [{ when: 'true', goto: afterNotes }] },
    ...(rc ? [
      { id: 'tag_rc', fragment: 'release-pipeline', agent: 'tagger', transitions: [{ when: 'true', goto: 'soak' }] },
      { id: 'soak', fragment: 'release-pipeline', transitions: [{ when: 'approved', goto: 'tag' }, { when: 'rejected', goto: 'end', status: 'cancelled' }] },
    ] : gate ? [
      { id: 'approve', fragment: 'release-pipeline', transitions: [{ when: 'approved', goto: 'tag' }, { when: 'rejected', goto: 'end', status: 'cancelled' }] },
    ] : []),
    { id: 'tag', fragment: 'release-pipeline', agent: 'tagger', transitions: [{ when: 'true', goto: 'end' }] },
  ];
  return doc;
}

const dump = (doc) => `${HEADER}\n${yaml.dump(doc, { lineWidth: -1, noRefs: true })}`;

/**
 * The workflow set of a profile and the owner's answers (answers win over the profile):
 * { workflows: [{ name, category, path, yaml }], manifest: { path, yaml }, settings }. `facts`: the
 * project's { languages, skills } (default: the profile's languages, languageFacts). `existing`: the
 * repository's manifest (src/domains/project/project-manifest.js readManifest), which the composed one is merged
 * into (mergeManifest). Writes nothing.
 */
function composeWorkflowSet({ profile, answers, facts, existing } = {}) {
  const prof = withOverrides(profile, answers);
  const s = settingsOf(prof, answers);
  const f = facts && Array.isArray(facts.skills) ? { languages: languageFacts(facts.languages).languages, skills: facts.skills } : languageFacts(prof.languages);
  const set = [
    { category: 'intake', doc: intakeWorkflow(s, f) },
    { category: s.team, doc: developmentWorkflow(s, f) },
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
  composeWorkflowSet,
  languageFacts,
  MERGE_STYLES,
  mergeManifest,
  openQuestions,
  PROFILE_FIELDS,
  RELEASE_STYLES,
  REVIEW_LEVELS,
  TEAM_STYLES,
};
