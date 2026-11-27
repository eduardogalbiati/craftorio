// #40 acceptance, written before the code: the new-project wizard (fronts/build/views/projects/project-wizard*.js)
// for a repository whose .craftorio/ manifest declares its own default workflow (ai-development-remote-hero) that
// waits for the owner's acceptance at the current commit. Step 3 (Analysis and workflows) and step 4 (Review) say
// it must be reviewed and accepted before it runs, with a "Review and accept" action (pt-BR "Revisar e aceitar")
// leading to Workflows › Definitions. An accepted default shows no such notice. Driven on the real page as
// project-wizard-default-kinds-790-791.test.js drives it.
//
// The contract assumed here:
// - the manifest reaches the wizard as today (api.projectManifest; the record's defaultWorkflow);
// - "waits for acceptance" is the existing rule (packages/ui-kit/workflows-acceptance.js awaitsAcceptance): an entry
//   of api.listWorkflows({ projectId[, repositoryOnly] }) with origin 'repository' and accepted === false;
// - the notice is data-testid="wizard-default-awaiting-acceptance" (on step 3 and on step 4), naming the workflow,
//   with a <button> or <a> whose text is the "Review and accept" action. Visual-layout rework: on step 3 it sits
//   inside the Default row (data-kind="default", in its hint's place), one short sentence, the workflow named by the
//   row's own select; a default with no manifest row (the record's) gets it under the rows, naming the workflow; it
//   comes with the rows (not while the two choices show).
const test = require('node:test');
const assert = require('node:assert/strict');
const H = require('@craftorio/ui-kit/test/page-pieces');
const W = require('./project-wizard-helpers');

const { PID, clone, jobs, CLI_OK } = W;
const NOTICE = 'wizard-default-awaiting-acceptance';
const REPO_WF = 'ai-development-remote-hero';
const PROFILE = { mode: 'remote', ci: 'release', tests: 'unit' };
const PROFILED = {
  projectId: PID, status: 'analyzing', profile: PROFILE, cli: CLI_OK,
  jobs: jobs({ clone: { status: 'done' }, facts: { status: 'done' }, profile: { status: 'done', profile: PROFILE }, projectMap: { status: 'running' } }),
};
const ANALYZED = {
  projectId: PID, status: 'analyzed', profile: PROFILE, cli: CLI_OK,
  jobs: jobs({ clone: { status: 'done' }, facts: { status: 'done' }, profile: { status: 'done', profile: PROFILE }, projectMap: { status: 'done' }, ranking: { status: 'done' } }),
};
const SET = [{ name: REPO_WF, file: `workflows/${REPO_WF}.yaml`, category: 'build' }, { name: 'feature', category: 'build' }];
const MANIFEST = { workflows: SET, default: REPO_WF, kinds: {} };
const RECORD = { id: PID, name: W.NAME, repo: W.REPO, folder: 'C:/ws/repos/new', exists: true, defaultWorkflow: REPO_WF };
const task = { task: { type: 'string', required: true } };
const WORKSPACE = [{ file: 'feature.yaml', name: 'Feature', category: 'build', steps: [], inputs: task }];
const repoEntry = (accepted) => ({
  file: `${REPO_WF}.yaml`, name: REPO_WF, origin: 'repository', projectId: PID, commit: 'c0ffee1234567890',
  changedCommit: accepted ? null : 'c0ffee1234567890', accepted, acceptedCommit: accepted ? 'c0ffee1234567890' : null,
  trusted: accepted, steps: [], inputs: task, category: 'build',
});

async function atWorkflows({ accepted = false, lang = 'en', manifest = MANIFEST, analyze = true } = {}) {
  const app = await W.atAnalysis({
    api: {
      listProjects: async () => [clone(RECORD)],
      listWorkflows: async (opts = {}) => {
        if (opts?.projectId !== PID) return clone(WORKSPACE);
        return clone(opts.repositoryOnly ? [repoEntry(accepted)] : [...WORKSPACE, repoEntry(accepted)]);
      },
      projectManifest: async () => clone(manifest),
      onboardingStatus: async () => clone(ANALYZED),
      analyzeOnboarding: async (id) => ({ ...clone(PROFILED), projectId: id }),
      getBacklog: async () => ({ issues: [] }),
      backlogProgress: async () => null,
    },
    record: (a) => { if (lang !== 'en') a.sandbox.I18n.setLanguage(lang); },
  });
  if (!analyze) { await app.settle(20); return app; }
  await W.press(app, 'wizard-workflows-choice-analyze');
  await W.emit(app, PROFILED);
  await app.settle(20);
  return app;
}

async function atReview(opts) {
  const app = await atWorkflows(opts);
  await W.emit(app, ANALYZED);
  await W.press(app, 'wizard-next');
  await app.settle(20);
  assert.equal(W.currentStep(app), 'review', 'the review');
  return app;
}

const notice = (app) => W.byTestId(W.wizardMarkup(app), NOTICE);
const action = (el) => H.findEl(el?.inner || '', (e) => e.name === 'button' || e.name === 'a');

test('#40 step 3: a manifest default awaiting acceptance shows the notice, naming the workflow', { timeout: 30000 }, async () => {
  const app = await atWorkflows();
  assert.equal(W.currentStep(app), 'analysis', 'step 3');
  const row = H.findEl(W.wizardMarkup(app), (e) => e.attrs['data-testid'] === 'wizard-workflow-select' && e.attrs['data-workflow-kind'] === 'default');
  assert.equal(row === null, false, 'fixture: step 3 shows the manifest\'s Default row');
  const el = notice(app);
  assert.equal(el === null, false, `step 3 shows data-testid="${NOTICE}"`);
  // the notice is in the Default row, whose select names the workflow (the sentence itself says "This workflow")
  const defaultRow = H.findEl(W.wizardMarkup(app), (e) => e.attrs['data-testid'] === 'wizard-workflow' && e.attrs['data-kind'] === 'default');
  assert.equal(defaultRow === null, false, 'the Default row (data-kind="default")');
  assert.equal(W.byTestId(defaultRow.outer, NOTICE) === null, false, 'the notice is inside the Default row');
  const picked = H.findAll(row.inner, (e) => e.name === 'option').find((o) => 'selected' in o.attrs);
  assert.equal(picked?.attrs.value, REPO_WF, 'the row\'s select names the workflow');
  assert.equal(H.visibleText(defaultRow.inner).includes(REPO_WF), true, H.visibleText(defaultRow.inner));
  assert.match(H.visibleText(el.inner), /only runs after you accept it/i);
  assert.equal(H.findAll(W.wizardMarkup(app), (e) => e.attrs['data-testid'] === NOTICE).length, 1, 'said once on step 3');
});

test('#40 step 3: a default awaiting acceptance with no Default row (the manifest declares none) shows the notice under the rows, naming the workflow', { timeout: 30000 }, async () => {
  const app = await atWorkflows({ manifest: { workflows: SET, kinds: {} } });
  const defaultRow = H.findEl(W.wizardMarkup(app), (e) => e.attrs['data-testid'] === 'wizard-workflow' && e.attrs['data-kind'] === 'default');
  assert.equal(defaultRow, null, 'fixture: no Default row');
  const el = notice(app);
  assert.equal(el === null, false, `step 3 shows data-testid="${NOTICE}"`);
  assert.equal(H.visibleText(el.inner).includes(REPO_WF), true, H.visibleText(el.inner));
  assert.match(H.visibleText(action(el)?.inner || ''), /review and accept/i);
});

test('#40 step 3: no notice while the two choices show (it comes with the rows)', { timeout: 30000 }, async () => {
  const app = await atWorkflows({ analyze: false });
  assert.equal(W.byTestId(W.wizardMarkup(app), 'wizard-workflows-choice-manual') === null, false, 'the two choices');
  assert.equal(notice(app), null);
  await W.press(app, 'wizard-workflows-choice-manual');
  await app.settle(20);
  assert.equal(notice(app) === null, false, 'the notice with the rows defined by hand');
});

test('#40 step 3: the notice offers "Review and accept"', { timeout: 30000 }, async () => {
  const app = await atWorkflows();
  const a = action(notice(app));
  assert.equal(a === null, false, 'the notice has a button or a link');
  assert.match(H.visibleText(a.inner), /review and accept/i);
});

test('#40 step 3 in pt-BR: the notice offers "Revisar e aceitar"', { timeout: 30000 }, async () => {
  const app = await atWorkflows({ lang: 'pt-BR' });
  const a = action(notice(app));
  assert.equal(a === null, false, 'the notice has a button or a link');
  assert.match(H.visibleText(a.inner), /revisar e aceitar/i);
});

test('#40 step 4 (Review): a manifest default awaiting acceptance shows the notice, naming the workflow', { timeout: 30000 }, async () => {
  const app = await atReview();
  const el = notice(app);
  assert.equal(el === null, false, `the review shows data-testid="${NOTICE}"`);
  assert.equal(H.visibleText(el.inner).includes(REPO_WF), true, H.visibleText(el.inner));
});

test('#40 step 4 (Review): the notice offers "Review and accept"', { timeout: 30000 }, async () => {
  const app = await atReview();
  const a = action(notice(app));
  assert.equal(a === null, false, 'the notice has a button or a link');
  assert.match(H.visibleText(a.inner), /review and accept/i);
});

test('#40 unchanged: an accepted manifest default shows no awaiting-acceptance notice on step 3', { timeout: 30000 }, async () => {
  const app = await atWorkflows({ accepted: true });
  assert.equal(notice(app), null);
});

test('#40 unchanged: an accepted manifest default shows no awaiting-acceptance notice on the review', { timeout: 30000 }, async () => {
  const app = await atReview({ accepted: true });
  assert.equal(notice(app), null);
});
