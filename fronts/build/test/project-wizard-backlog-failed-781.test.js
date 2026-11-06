// #781: the Backlog card when its read fails (the reason with Retry, never "No open issues."), a project with no
// platform to read from (its empty line), and a wizard resumed on a running analysis following the interview.
const test = require('node:test');
const assert = require('node:assert/strict');
const H = require('@multiagent/ui-kit/test/page-pieces');
const W = require('./project-wizard-helpers');

const { PID, byTestId, emit, press, wizardMarkup } = W;
const NOT_SIGNED_IN = 'gh issue list failed: To get started with GitHub CLI, please run: gh auth login';

async function atReview(api) {
  const app = await W.atAnalysis({ api: { getBacklog: async () => null, ...api } });
  await emit(app, W.ANALYZED);
  await press(app, 'wizard-next');
  await app.settle(20);
  return app;
}

const line = (app) => byTestId(wizardMarkup(app), 'wizard-review-backlog-activity');
const lineText = (app) => H.visibleText(line(app)?.inner || '');
const failing = (message) => ({ syncBacklog: async () => { throw new Error(message); } });

test('#781 a backlog read that fails shows its reason and Retry, not an empty backlog', { timeout: 20000 }, async () => {
  const app = await atReview(failing(NOT_SIGNED_IN));
  assert.equal(line(app)?.attrs['data-state'], 'failed');
  assert.equal(line(app)?.attrs.role, 'alert');
  assert.equal(lineText(app).includes('gh auth login'), true, lineText(app));
  assert.equal(lineText(app).includes('No open issues.'), false, lineText(app));
  assert.equal(byTestId(wizardMarkup(app), 'wizard-review-backlog-retry') === null, false, 'its Retry');
  assert.equal(byTestId(wizardMarkup(app), 'wizard-review-backlog')?.attrs['data-state'], 'failed', 'the section says so too');
});

test('#781 the review\'s sync asks for the steps: its card shows the count', { timeout: 20000 }, async () => {
  const app = await atReview({ syncBacklog: async () => ({ issues: [] }) });
  assert.deepEqual(app.callsTo('syncBacklog').map((args) => [...args].map(String)), [[PID, 'null', 'true']]);
});

test('#781 Retry reads the backlog again and shows what it read', { timeout: 20000 }, async () => {
  let tries = 0;
  const app = await atReview({
    syncBacklog: async () => {
      tries += 1;
      if (tries === 1) throw new Error(NOT_SIGNED_IN);
      return { issues: [{ number: 7, title: 'Login fails on Safari' }] };
    },
  });
  await press(app, 'wizard-review-backlog-retry');
  await app.settle(20);
  assert.equal(tries, 2, 'read again');
  assert.equal(line(app)?.attrs['data-state'], 'done');
  assert.equal(H.visibleText(wizardMarkup(app)).includes('Login fails on Safari'), true);
  assert.equal(byTestId(wizardMarkup(app), 'wizard-review-backlog-retry'), null, 'no Retry once read');
});

test('#781 Retry that fails again keeps the reason and its Retry', { timeout: 20000 }, async () => {
  const app = await atReview(failing(NOT_SIGNED_IN));
  await press(app, 'wizard-review-backlog-retry');
  await app.settle(20);
  assert.equal(line(app)?.attrs['data-state'], 'failed');
  assert.equal(byTestId(wizardMarkup(app), 'wizard-review-backlog-retry') === null, false);
});

for (const reason of ['This project has no repository. Add one in Projects to sync its issues.', 'The project\'s repository is not a recognizable git URL: file:///tmp/repo.git']) {
  test(`#781 nowhere to read issues from is an empty backlog: ${reason}`, { timeout: 20000 }, async () => {
    const app = await atReview(failing(reason));
    assert.equal(line(app)?.attrs['data-state'], 'done');
    assert.equal(lineText(app).includes('No open issues.'), true, lineText(app));
  });
}

test('#781 a wizard resumed on a running analysis follows the interview at once', { timeout: 20000 }, async () => {
  const running = {
    projectId: PID,
    status: 'analyzing',
    cli: { provider: 'github', status: 'ok' },
    jobs: W.jobs({ clone: { status: 'done' }, facts: { status: 'done' }, profile: { status: 'running' } }),
    wizard: { step: 'analysis', picks: { workflowsMode: 'analyze' }, finished: false },
  };
  const since = new Date(Date.now() - 5000).toISOString();
  const interview = { running: { since, items: 2, last: 'Read Cargo.toml' }, error: null, phases: { git: { status: 'done' }, files: { status: 'done' }, oracle: { status: 'running', since, reading: 'Read Cargo.toml' } } };
  const app = W.page({ api: { onboardingStatus: async () => W.clone(running), workflowInterviewState: async () => W.clone(interview), architectureEstimate: async () => null } });
  await app.boot();
  W.wizard(app).open({ projectId: PID });
  await app.settle(20);
  assert.equal(app.callsTo('workflowInterviewState').length > 0, true, 'the interview is read with no onboarding:changed');
  assert.equal(H.visibleText(byTestId(wizardMarkup(app), 'wizard-phase-oracle')?.inner || '').includes('Read Cargo.toml'), true, 'what the Oracle reads');
});
