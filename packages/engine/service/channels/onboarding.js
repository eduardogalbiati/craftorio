// The onboarding of a new project (#640, packages/engine/service/areas/project-onboarding.js): start
// the import (access check, project and clone), follow its jobs, ask for the paid analysis, retry what
// failed. Each answers the onboarding state, which onboarding:changed pushes on every change. Before any
// import, the wizard's repository step (#669, mock-2) reads gh / glab's sign-in and the account's repositories.
// #632: onboarding:create makes a new project instead of importing one (mock-3).
// #741: onboarding:save-wizard / onboarding:finish keep the wizard's step and picks with the project.
// #30: onboarding:install-deps installs a clone's missing dependencies (the project page's Next steps).

const {
  args,
  described,
  listOf,
  OBJECT,
  OPTIONS,
  PROJECT_ID,
  shape,
  STRING,
  text,
} = require('../schemas');

const ON_PROJECT = args({ projectId: PROJECT_ID }, ['projectId']);

module.exports = (ctx) => [
  // [{ provider, cli, installed, signedIn, account? }] per platform with a CLI (gh, glab)
  { channel: 'onboarding:accounts', method: 'onboardingAccounts', schema: { result: listOf(OBJECT) }, fn: () => ctx.onboardingAccounts() },
  // { name, repo }: checks the access, creates the project and starts its clone; never waits for the clone
  { channel: 'onboarding:start', method: 'startOnboarding', params: 'data', schema: { params: args({ name: text(200, 'The project name.'), repo: text(2000, 'The repository URL.') }, ['name', 'repo']), result: OBJECT }, fn: (data) => ctx.onboardingStart(data) },
  // #632 { name, starts, remote, answers }: creates a new project (git init, README and .gitignore, a first
  // commit on main), its private remote only when asked and gh / glab is signed in; ready at once, no clone;
  // #57: answers.kind is saved on the project as the owner's pick
  { channel: 'onboarding:create', method: 'createOnboarding', params: 'data', schema: { params: args({ name: text(200, 'The project name.'), starts: text(10, 'What the project starts with: readme or empty.'), remote: described(OPTIONS, 'The private remote to create: null, or { provider: github or gitlab }.'), answers: shape({ mode: STRING, ci: STRING, release: STRING, kind: STRING }) }, ['name']), result: OBJECT }, fn: (data) => ctx.onboardingCreate(data) },
  { channel: 'onboarding:status', method: 'onboardingStatus', params: ['projectId'], schema: { params: ON_PROJECT, result: OBJECT }, fn: (opts) => ctx.onboardingStatus(opts) },
  // the paid part (the project map: the city plan and the Oracle's report), only on the owner's click
  { channel: 'onboarding:analyze', method: 'analyzeOnboarding', params: ['projectId'], schema: { params: ON_PROJECT, result: OBJECT }, fn: (opts) => ctx.onboardingAnalyze(opts) },
  // the signed-in account's repositories as gh / glab list them ([] when signed out)
  { channel: 'onboarding:repos', method: 'onboardingRepos', params: ['provider'], schema: { params: args({ provider: text(40, 'The platform: github or gitlab.') }, ['provider']), result: listOf(shape({ name: STRING }, ['name'])) }, fn: (opts) => ctx.onboardingRepos(opts) },
  // runs again what failed (access check and clone, a failed job) and checks gh / glab again
  { channel: 'onboarding:retry', method: 'retryOnboarding', params: ['projectId'], schema: { params: ON_PROJECT, result: OBJECT }, fn: (opts) => ctx.onboardingRetry(opts) },
  // #738: no push access to the imported repository: "Create a fork" (origin = the owner's fork, upstream =
  // the original; Fork + PR) or "Work locally" (the Local way of working, no pull request)
  { channel: 'onboarding:fork', method: 'forkOnboarding', params: ['projectId'], schema: { params: ON_PROJECT, result: OBJECT }, fn: (opts) => ctx.onboardingFork(opts) },
  { channel: 'onboarding:work-locally', method: 'workLocallyOnboarding', params: ['projectId'], schema: { params: ON_PROJECT, result: OBJECT }, fn: (opts) => ctx.onboardingWorkLocally(opts) },
  // #79: the clone cannot push: runs the platform CLI's setup-git (`gh auth setup-git`), then checks the push again
  { channel: 'onboarding:setup-git', method: 'setupGitOnboarding', params: ['projectId'], schema: { params: ON_PROJECT, result: OBJECT }, fn: (opts) => ctx.onboardingSetupGit(opts) },
  // #30: the clone's dependencies (state.deps missing): runs npm ci there, --ignore-scripts under the project's setting
  { channel: 'onboarding:install-deps', method: 'installOnboardingDeps', params: ['projectId'], schema: { params: ON_PROJECT, result: OBJECT }, fn: (opts) => ctx.onboardingInstallDeps(opts) },
  // #741: the wizard's step and the owner's picks, saved with the project on every change (an onboarding left
  // before Finish resumes there); Finish marks it finished
  { channel: 'onboarding:save-wizard', method: 'saveOnboardingWizard', params: 'data', schema: { params: args({ projectId: PROJECT_ID, step: text(20, 'The wizard step: start, repository, analysis or review.'), picks: described(OBJECT, 'The owner\'s picks, kept as given.') }, ['projectId', 'step']), result: OBJECT }, fn: (data) => ctx.onboardingSaveWizard(data) },
  { channel: 'onboarding:finish', method: 'finishOnboarding', params: ['projectId'], schema: { params: ON_PROJECT, result: OBJECT }, fn: (opts) => ctx.onboardingFinish(opts) },
  { event: 'onboarding:changed', method: 'onOnboardingChanged' },
];
