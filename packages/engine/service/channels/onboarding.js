// The onboarding of a new project (#640, packages/engine/service/areas/project-onboarding.js): start
// the import (access check, project and clone), follow its jobs, ask for the paid analysis, retry what
// failed. Each answers the onboarding state, which onboarding:changed pushes on every change. Before any
// import, the wizard's repository step (#669, mock-2) reads gh / glab's sign-in and the account's repositories.

const {
  args,
  listOf,
  OBJECT,
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
  { channel: 'onboarding:status', method: 'onboardingStatus', params: ['projectId'], schema: { params: ON_PROJECT, result: OBJECT }, fn: (opts) => ctx.onboardingStatus(opts) },
  // the paid part (project map, then the refactor ranking), only on the owner's click
  { channel: 'onboarding:analyze', method: 'analyzeOnboarding', params: ['projectId'], schema: { params: ON_PROJECT, result: OBJECT }, fn: (opts) => ctx.onboardingAnalyze(opts) },
  // the signed-in account's repositories as gh / glab list them ([] when signed out)
  { channel: 'onboarding:repos', method: 'onboardingRepos', params: ['provider'], schema: { params: args({ provider: text(40, 'The platform: github or gitlab.') }, ['provider']), result: listOf(shape({ name: STRING }, ['name'])) }, fn: (opts) => ctx.onboardingRepos(opts) },
  // runs again what failed (access check and clone, a failed job) and checks gh / glab again
  { channel: 'onboarding:retry', method: 'retryOnboarding', params: ['projectId'], schema: { params: ON_PROJECT, result: OBJECT }, fn: (opts) => ctx.onboardingRetry(opts) },
  { event: 'onboarding:changed', method: 'onOnboardingChanged' },
];
