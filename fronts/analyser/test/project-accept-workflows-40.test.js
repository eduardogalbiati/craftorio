// #40 acceptance, written before the code: a project imported with its own .craftorio/ manifest whose default
// workflow (here ai-development-remote-hero) waits for the owner's acceptance at the current commit.
// - The project page's Next steps card (fronts/analyser/views/project/project.js, project-next-steps) offers
//   "Accept the repository's workflows" (pt-BR "Aceitar os workflows do repositório") while it waits, and leaves
//   once it is accepted.
// - The project page (its settings / Workflows block) says the default must be reviewed and accepted before it runs.
// On the real page (renderer-app-harness), as project-next-steps-deps-30.test.js drives it.
//
// The contract assumed here:
// - "waits for acceptance" is the existing rule (packages/ui-kit/workflows-acceptance.js awaitsAcceptance): an entry
//   of api.listWorkflows({ projectId, repositoryOnly: true }) with origin 'repository' and accepted === false;
// - the project record carries the manifest's default (`manifest.default`, `defaultWorkflow`);
// - the Next steps entry is a <li data-testid="next-step-accept-workflows">; the project page's notice carries
//   data-testid="project-default-awaiting-acceptance".
const test = require('node:test');
const assert = require('node:assert/strict');
const H = require('@craftorio/ui-kit/test/page-pieces');
const { loadApp } = require('@craftorio/ui-kit/test/renderer-app-harness');
const { pageMarkup } = require('./project-page-helpers');

const PID = 'p1';
const REPO_WF = 'ai-development-remote-hero';
const PROJECT = {
  id: PID, name: 'Remote hero', repo: 'https://github.com/o/remote.git', folder: '/ws/repos/remote', exists: true, isGit: true,
  defaultWorkflow: REPO_WF, manifest: { default: REPO_WF },
};
const task = { task: { type: 'string', required: true } };
const WORKSPACE = [{ file: 'feature.yaml', name: 'Feature', category: 'build', steps: [], inputs: task }];
const repoEntry = (accepted) => ({
  file: `${REPO_WF}.yaml`, name: REPO_WF, origin: 'repository', projectId: PID, commit: 'c0ffee1234567890',
  changedCommit: accepted ? null : 'c0ffee1234567890', accepted, acceptedCommit: accepted ? 'c0ffee1234567890' : null,
  trusted: accepted, steps: [], inputs: task, category: 'build',
});
const clone = (x) => JSON.parse(JSON.stringify(x));

async function projectPage({ accepted = false, lang = 'en' } = {}) {
  const app = loadApp({
    storage: { 'craftorio.currentProject': PID, 'craftorio.nextSteps': JSON.stringify({ [PID]: 'open' }) },
    api: {
      getSettings: async () => ({ setupDone: true, lastProject: PID }),
      listProjects: async () => [clone(PROJECT)],
      listWorkflows: async (opts = {}) => {
        if (opts?.projectId !== PID) return clone(WORKSPACE);
        return clone(opts.repositoryOnly ? [repoEntry(accepted)] : [...WORKSPACE, repoEntry(accepted)]);
      },
      projectManifest: async () => ({ manifest: { default: REPO_WF, workflows: [{ name: REPO_WF, file: `workflows/${REPO_WF}.yaml` }] }, errors: [] }),
      onboardingStatus: async () => null,
      refactorProposals: async () => [],
      getBacklog: async () => ({ issues: [] }),
      refactorCadence: async () => ({ on: false, every: 10, since: null }),
      listDiscoveryCards: async () => [],
      listDiscoveryWaiting: async () => [],
    },
  });
  await app.boot();
  if (lang !== 'en') app.sandbox.I18n.setLanguage(lang);
  app.run(`openProjectView(${JSON.stringify(PID)})`);
  await app.settle(30);
  return app;
}

const shownEl = (e) => !('hidden' in e.attrs) && !String(e.attrs.class || '').split(/\s+/).includes('hidden');
const card = (app) => H.findEl(pageMarkup(app, { defs: false }), (e) => e.attrs['data-testid'] === 'project-next-steps' && shownEl(e));
const entry = (app) => H.findEl(card(app)?.outer || '', (e) => e.attrs['data-testid'] === 'next-step-accept-workflows');
const notice = (app) => H.findEl(pageMarkup(app, { defs: false }), (e) => e.attrs['data-testid'] === 'project-default-awaiting-acceptance' && shownEl(e));

test('#40 Next steps: a repository default awaiting acceptance adds "Accept the repository\'s workflows"', { timeout: 30000 }, async () => {
  const app = await projectPage();
  assert.equal(card(app) === null, false, 'the Next steps card is shown');
  const el = entry(app);
  assert.equal(el === null, false, 'next-step-accept-workflows is shown');
  assert.match(H.visibleText(el.inner), /accept the repository.s workflows/i, H.visibleText(el.inner));
});

test('#40 Next steps in pt-BR: the entry reads "Aceitar os workflows do repositório"', { timeout: 30000 }, async () => {
  const app = await projectPage({ lang: 'pt-BR' });
  const el = entry(app);
  assert.equal(el === null, false, 'next-step-accept-workflows is shown');
  assert.match(H.visibleText(el.inner), /aceitar os workflows do reposit[oó]rio/i, H.visibleText(el.inner));
});

test('#40 Next steps: once the repository default is accepted, the accept entry is gone', { timeout: 30000 }, async () => {
  const app = await projectPage({ accepted: true });
  assert.equal(card(app) === null, false, 'the Next steps card is shown');
  assert.equal(entry(app), null, 'no next-step-accept-workflows');
});

test('#40 project page: a default awaiting acceptance says it must be reviewed and accepted before it runs, naming it', { timeout: 30000 }, async () => {
  const app = await projectPage();
  const el = notice(app);
  assert.equal(el === null, false, 'project-default-awaiting-acceptance is shown');
  assert.equal(H.visibleText(el.inner).includes(REPO_WF), true, H.visibleText(el.inner));
});

test('#40 project page: the awaiting-acceptance notice leads to Workflows › Definitions', { timeout: 30000 }, async () => {
  const app = await projectPage();
  const el = notice(app);
  assert.equal(el === null, false, 'project-default-awaiting-acceptance is shown');
  assert.match(el.outer, /definitions/i, el.outer);
});

test('#40 project page: an accepted default shows no awaiting-acceptance notice', { timeout: 30000 }, async () => {
  const app = await projectPage({ accepted: true });
  assert.equal(notice(app), null);
});
