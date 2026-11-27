// #74: importing a project says what its analyses cost before they run (the Ways of working profile is not
// free when the Oracle may complete it), what they cost once they ended, and refreshes the header's cost.
// Acceptance tests, written before the code, on the real page (project-wizard-helpers.js).
//
// Contract (what these tests assume of the wizard's data and markup):
// - the estimates are read on the analysis step, before anything starts: api.seedEstimate({ projectId,
//   seedId: 'ways-of-working' }) -> { costUsd | null, free, basis } for the profile (free: no model is called;
//   costUsd null: not known) and api.architectureEstimate(projectId) -> { estimate: { usd } | null };
// - a done job's cost is jobs.<id>.costUsd in the onboarding's state (the records' figures; the fakes of
//   workflowInterviewLast and architectureReport give the same ones); a profile job done with simulated: true
//   called no model, so it is free;
// - step 3's rows are wizard-cost's li.wizard-job, each with its .wizard-amount; the total is wizard-cost-total;
// - #100 (visual-layout): before the analysis is asked for (the two choices), step 3 has no wizard-cost: the estimated
//   total is said beside Analyze with AI (wizard-workflows-choice-cost). The rows show once it is asked for and until
//   the profile job ends (and whenever a job failed); a row that will call a model and has not ended carries the "AI"
//   badge (wizard-job-paid), its amount empty while not known (the total says "unknown until it runs", once);
// - "Skip, analyze later" is gone (#100): Define manually, then Continue, is the path that starts nothing;
// - NEW on the review: data-testid="wizard-review-costs", holding one element data-part="profile", one
//   data-part="projectMap" (each its analysis and its amount) and data-testid="wizard-review-cost-total".
const test = require('node:test');
const assert = require('node:assert/strict');
const H = require('@craftorio/ui-kit/test/page-pieces');
const W = require('./project-wizard-helpers');

const PROFILE_USD = 0.4159;
const MAP_USD = 0.7384;
const PROFILE = { mode: 'local', release: 'milestone', testCommand: 'npm test', ci: 'none', tests: 'unit', languages: ['js'] };

// amounts as a person reads them: a no-break space is a space
const textOf = (html) => H.visibleText(html).replace(/[\u00a0\u202f]/g, ' ');
const hasClass = (e, name) => W.classesOf(e).includes(name);

// estimates: the profile's (seedEstimate's answer) and the project map's (a number or null)
const apiOf = ({ profile = { costUsd: null, free: false, basis: 0 }, map = null, records = {} } = {}) => ({
  seedEstimate: async () => W.clone(profile),
  architectureEstimate: async () => ({ estimate: map == null ? null : { usd: map, basis: 2 } }),
  architectureCity: async () => null,
  architectureReport: async () => ({ report: { id: 'r1', costUsd: records.projectMap ?? null }, findings: [] }),
  workflowInterviewLast: async () => ({ profile: PROFILE, evidence: {}, questions: [], simulated: false, date: '2026-11-25T10:00:00Z', costUsd: records.profile ?? null }),
  getBacklog: async () => ({ issues: [] }),
});

async function analysisStep(opts) {
  const app = await W.atAnalysis({ api: apiOf(opts) });
  await app.settle(10);
  return app;
}

async function inPortuguese(app) {
  app.sandbox.I18n.setLanguage('pt-BR');
  app.sandbox.I18n.notify();
  await app.settle(10);
}

// #100: Analyze with AI asked for (api.analyzeOnboarding: the helpers' ANALYZING, the profile job not ended): the
// job rows and their total show; before it, the two choices stand alone (no wizard-cost)
async function analyzing(opts) {
  const app = await analysisStep(opts);
  assert.equal(W.byTestId(W.wizardMarkup(app), 'wizard-cost'), null, 'no wizard-cost while the two choices show');
  await W.press(app, 'wizard-workflows-choice-analyze');
  await app.settle(10);
  return app;
}
const choiceCost = (app) => textOf(W.byTestId(W.wizardMarkup(app), 'wizard-workflows-choice-cost')?.outer || '').trim();

const costBlock = (app) => {
  const el = W.byTestId(W.wizardMarkup(app), 'wizard-cost');
  assert.equal(el == null, false, 'data-testid="wizard-cost" on the analysis step');
  return el.outer;
};
// a job's row of step 3
function rowOf(app, id) {
  const rows = H.findAll(costBlock(app), (e) => e.name === 'li' && hasClass(e, 'wizard-job'));
  const row = rows.find((r) => (id === 'profile' ? !!W.byTestId(r.outer, 'wizard-profile') : r.attrs['data-part'] === id));
  assert.equal(row === undefined, false, `the row of ${id}`);
  return row;
}
// the amount of a job's row of step 3, as read
function amountOf(app, id) {
  const amount = H.findEl(rowOf(app, id).outer, (e) => hasClass(e, 'wizard-amount'));
  return textOf(amount.outer).trim();
}
// the "AI" badge of a row that will call a model and has not ended ('' without it)
const paidBadge = (app, id) => textOf(W.byTestId(rowOf(app, id).outer, 'wizard-job-paid')?.outer || '').trim();
const totalOf = (app) => textOf(W.byTestId(costBlock(app), 'wizard-cost-total').outer).trim();

const DONE = (profile, map) => ({
  ...W.ANALYZED,
  jobs: W.jobs({ clone: { status: 'done' }, facts: { status: 'done' }, profile: { status: 'done', profile: PROFILE, ...profile }, projectMap: { status: 'done', ...map } }),
});
const PAID = DONE({ costUsd: PROFILE_USD }, { costUsd: MAP_USD });

// ---- before anything runs ----------------------------------------------------------------------------------

test('#74 the profile the Oracle may complete shows its estimate, never free', async () => {
  const app = await analysisStep({ profile: { costUsd: PROFILE_USD, free: false, basis: 2 }, map: MAP_USD });
  assert.equal(app.callsTo('analyzeOnboarding').length, 0, 'nothing started');
  // before anything runs the estimate is beside Analyze with AI, the profile's in it
  assert.equal(W.byTestId(W.wizardMarkup(app), 'wizard-cost'), null, 'no job rows while the two choices show');
  assert.match(choiceCost(app), /\$1\.15/);
  assert.doesNotMatch(choiceCost(app), /free/i);
  // asked for: its row, not ended, shows the estimate
  await W.press(app, 'wizard-workflows-choice-analyze');
  await app.settle(10);
  assert.match(amountOf(app, 'profile'), /\$0\.42/);
  assert.doesNotMatch(amountOf(app, 'profile'), /free/i);
  assert.equal(paidBadge(app, 'profile'), 'AI');
});

test('#74 in pt-BR the profile\'s estimate is in the interface\'s format, never "grátis"', async () => {
  const app = await analyzing({ profile: { costUsd: PROFILE_USD, free: false, basis: 2 }, map: MAP_USD });
  await inPortuguese(app);
  assert.match(amountOf(app, 'profile'), /US\$ 0,42/);
  assert.doesNotMatch(amountOf(app, 'profile'), /grátis/i);
});

test('#74 a profile with no model call stays free, in English and in pt-BR', async () => {
  const app = await analyzing({ profile: { costUsd: 0, free: true }, map: MAP_USD });
  assert.equal(amountOf(app, 'profile'), 'free');
  assert.equal(paidBadge(app, 'profile'), '', 'no "AI" badge on a profile that calls no model');
  await inPortuguese(app);
  assert.equal(amountOf(app, 'profile'), 'grátis');
});

test('#74 a profile with no estimate says it is not known before it runs, in English and in pt-BR', async () => {
  const app = await analysisStep();
  assert.equal(choiceCost(app), 'Cost: unknown until it runs', 'beside Analyze with AI, before anything runs');
  await W.press(app, 'wizard-workflows-choice-analyze');
  await app.settle(10);
  // the row says it calls a model ("AI"), never an amount nor "free"; "unknown" is said once, in the total
  assert.equal(amountOf(app, 'profile'), '');
  assert.equal(paidBadge(app, 'profile'), 'AI');
  assert.equal(totalOf(app), 'unknown until it runs');
  await inPortuguese(app);
  assert.equal(amountOf(app, 'profile'), '');
  assert.equal(paidBadge(app, 'profile'), 'IA');
  assert.equal(totalOf(app), 'desconhecido até rodar');
});

test('#74 the estimated total is the profile\'s plus the project map\'s', async () => {
  const app = await analyzing({ profile: { costUsd: PROFILE_USD, free: false, basis: 2 }, map: MAP_USD });
  assert.match(totalOf(app), /\$1\.15/);
});

test('#74 a total that leaves the profile out says so without naming the old refactor ranking', async () => {
  const app = await analyzing({ map: MAP_USD });
  assert.equal(amountOf(app, 'profile'), '');
  assert.equal(paidBadge(app, 'profile'), 'AI');
  assert.match(totalOf(app), /\$0\.74/);
  const said = textOf(costBlock(app));
  assert.match(textOf(W.byTestId(costBlock(app), 'wizard-cost-unknown')?.outer || ''), /leaves out an analysis whose cost is not known/);
  assert.doesNotMatch(said, /ranking/i);
  await inPortuguese(app);
  assert.doesNotMatch(textOf(costBlock(app)), /ranking/i);
});

// ---- once they ended ---------------------------------------------------------------------------------------

test('#74 a done analysis shows what it cost, not its estimate nor "free"', async () => {
  const app = await analyzing({ profile: { costUsd: 0.1, free: false, basis: 2 }, map: 0.2, records: { profile: PROFILE_USD, projectMap: MAP_USD } });
  // the rows stay while the profile job has not ended: the project map, done, shows what it cost
  await W.emit(app, { ...W.ANALYZING, jobs: W.jobs({ clone: { status: 'done' }, facts: { status: 'done' }, profile: { status: 'running' }, projectMap: { status: 'done', costUsd: MAP_USD } }) });
  await app.settle(10);
  assert.match(amountOf(app, 'projectMap'), /\$0\.74/);
  assert.equal(paidBadge(app, 'projectMap'), '', 'no "AI" badge once it ended');
  assert.match(amountOf(app, 'profile'), /\$0\.10/, 'the one still running keeps its estimate');
  // and with a failed job (its row has the reason and Retry): the profile, done, shows what it cost
  await W.emit(app, DONE({ costUsd: PROFILE_USD }, { status: 'failed', error: 'boom', reason: 'boom' }));
  await app.settle(10);
  assert.match(amountOf(app, 'profile'), /\$0\.42/);
  assert.equal(amountOf(app, 'projectMap'), '—');
  // #100: once all ended the workflows take the step: the costs are the review's (below)
  await W.emit(app, PAID);
  await app.settle(10);
  assert.equal(W.byTestId(W.wizardMarkup(app), 'wizard-cost'), null, 'no job rows once the analysis ended');
});

test('#74 a profile git settled alone (simulated: no model call) is still free once done', async () => {
  const app = await analyzing({ map: MAP_USD, records: { profile: 0, projectMap: MAP_USD } });
  // the rows show after the profile ended only while a job failed (here the project map)
  await W.emit(app, DONE({ costUsd: 0, simulated: true }, { status: 'failed', error: 'boom', reason: 'boom' }));
  await app.settle(10);
  assert.equal(amountOf(app, 'profile'), 'free');
});

async function review() {
  const app = await analysisStep({ profile: { costUsd: 0.1, free: false, basis: 2 }, map: 0.2, records: { profile: PROFILE_USD, projectMap: MAP_USD } });
  await W.press(app, 'wizard-workflows-choice-analyze'); // #100: Continue waits for the workflows to be defined
  await W.emit(app, PAID);
  await W.press(app, 'wizard-next');
  await app.settle(10);
  assert.equal(W.currentStep(app), 'review');
  return app;
}
function reviewCosts(app) {
  const block = W.byTestId(W.wizardMarkup(app), 'wizard-review-costs');
  assert.equal(block == null, false, 'data-testid="wizard-review-costs" on the review');
  const part = (id) => {
    const el = H.findEl(block.outer, (e) => e.attrs['data-part'] === id);
    assert.equal(el == null, false, `the review's cost of ${id} (data-part)`);
    return textOf(el.outer);
  };
  return { profile: part('profile'), projectMap: part('projectMap'), total: textOf(W.byTestId(block.outer, 'wizard-review-cost-total')?.outer || '') };
}

test('#74 the review says what each analysis cost and the total', async () => {
  const costs = reviewCosts(await review());
  assert.match(costs.profile, /Ways of working/); // onboarding.job_profile, reworded
  assert.match(costs.profile, /\$0\.42/);
  assert.match(costs.projectMap, /\$0\.74/);
  assert.match(costs.total, /\$1\.15/);
});

test('#74 in pt-BR the review\'s costs are in Portuguese and its format', async () => {
  const app = await review();
  await inPortuguese(app);
  const costs = reviewCosts(app);
  assert.match(costs.profile, /Jeito de trabalhar/);
  assert.match(costs.profile, /US\$ 0,42/);
  assert.match(costs.projectMap, /US\$ 0,74/);
  assert.match(costs.total, /US\$ 1,15/);
});

// ---- Define manually, then Continue (#100: what "Skip, analyze later" was) ---------------------------------

test('#74 #100 Define manually then Continue starts no analysis and the review shows no amount spent ("Skip, analyze later" is gone)', async () => {
  const app = await analysisStep({ profile: { costUsd: PROFILE_USD, free: false, basis: 2 }, map: MAP_USD });
  assert.equal(W.byTestId(W.wizardMarkup(app), 'wizard-skip'), null, 'no "Skip, analyze later" (data-testid="wizard-skip")');
  await W.press(app, 'wizard-workflows-choice-manual');
  assert.equal(W.byTestId(W.wizardMarkup(app), 'wizard-skip'), null, 'no "Skip, analyze later" beside the rows either');
  await W.press(app, 'wizard-next');
  await app.settle(10);
  assert.equal(W.currentStep(app), 'review');
  for (const method of ['analyzeOnboarding', 'retryOnboarding', 'workflowInterview']) assert.equal(app.callsTo(method).length, 0, method);
  assert.doesNotMatch(textOf(W.wizardMarkup(app)), /\$\s?\d*[1-9]/, 'no amount spent (nor estimated) on a skipped import\'s review');
});

// ---- the header --------------------------------------------------------------------------------------------

test('#74 the header reads the usage again when the import\'s analyses end', { timeout: 30000 }, async () => {
  const app = await analysisStep();
  await W.emit(app, { ...W.ANALYZING, jobs: W.jobs({ clone: { status: 'done' }, facts: { status: 'done' }, profile: { status: 'running' }, projectMap: { status: 'running' } }) });
  // a first quiet time: the reads of the boot and of the start are over
  await new Promise((r) => setTimeout(r, 6000));
  const before = app.callsTo('getUsage').length;
  await W.emit(app, PAID);
  // the widget loads at most every 5 s
  for (let i = 0; i < 70 && app.callsTo('getUsage').length === before; i++) await new Promise((r) => setTimeout(r, 100));
  assert.equal(app.callsTo('getUsage').length > before, true, 'getUsage is called once the analyses ended');
});
