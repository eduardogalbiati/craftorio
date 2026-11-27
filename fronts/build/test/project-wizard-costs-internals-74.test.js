// #74, the details behind project-wizard-costs-74.test.js: what Analyze says it costs, the note of an unknown cost,
// Analyze asked during the clone (the engine's `wanted`; #100: "Skip, analyze later" is gone, Define manually then
// Continue is the path that starts nothing), the review while it runs or after a failure, the column after a restart,
// when the estimates are read, the texts in pt-BR, and (#100, visual-layout) the wizard-progress strip while the
// engine analyses. The job rows (wizard-cost) show only once the analysis is asked for and until the profile job
// ends, or while a job failed: `analyzing()` below asks for it.
const test = require('node:test');
const assert = require('node:assert/strict');
const H = require('@craftorio/ui-kit/test/page-pieces');
const W = require('./project-wizard-helpers');

const PROFILE = { mode: 'local', release: null, ci: 'none', tests: 'unit' };
const textOf = (html) => H.visibleText(html).replace(/[  ]/g, ' ').trim();
const apiOf = ({ profile = { costUsd: null, free: false, basis: 0 }, map = null } = {}) => ({
  seedEstimate: async () => W.clone(profile),
  architectureEstimate: async () => ({ estimate: map == null ? null : { usd: map, basis: 2 } }),
});
const jobsWith = (profile, projectMap) => W.jobs({ clone: { status: 'done' }, facts: { status: 'done' }, profile, projectMap });
const at = (app, id) => W.byTestId(W.wizardMarkup(app), id);

async function analysisStep(opts) {
  const app = await W.atAnalysis({ api: apiOf(opts) });
  await app.settle(10);
  return app;
}
// #100: Analyze with AI pressed (api.analyzeOnboarding: the helpers' ANALYZING, the profile job not ended): the rows show
async function analyze(app) {
  await W.press(app, 'wizard-workflows-choice-analyze');
  await app.settle(10);
  return app;
}
const analyzing = async (opts) => analyze(await analysisStep(opts));

test('#74 Analyze the repository says the estimated total beside it', async () => {
  const app = await analysisStep({ profile: { costUsd: 0.42, free: false, basis: 1 }, map: 0.74 });
  assert.match(textOf(at(app, 'wizard-workflows-choice-cost').outer), /\$1\.16/);
  assert.equal(at(app, 'wizard-cost-unknown') == null, true);
});

test('#74 with no estimate at all a note says the cost is not known before it runs', async () => {
  const app = await analysisStep();
  assert.equal(textOf(at(app, 'wizard-workflows-choice-cost').outer), 'Cost: unknown until it runs');
  assert.equal(at(app, 'wizard-cost-unknown') == null, true, 'no note while the two choices show (no wizard-cost)');
  await analyze(app);
  assert.equal(textOf(at(app, 'wizard-cost-total').outer), 'unknown until it runs');
  assert.match(textOf(at(app, 'wizard-cost-unknown').outer), /The real amount shows on the Review step/);
});

test('#74 a free profile does not turn an unknown total into $0', async () => {
  const app = await analysisStep({ profile: { costUsd: 0, free: true } });
  assert.equal(textOf(at(app, 'wizard-workflows-choice-cost').outer), 'Cost: unknown until it runs');
  await analyze(app);
  assert.equal(textOf(at(app, 'wizard-cost-total').outer), 'unknown until it runs');
});

// #100: "Skip, analyze later" (wizard-skip) no longer exists; what `wanted` now decides is Continue's analyzeLater
const savedAnalyzeLater = (app) => JSON.parse(JSON.stringify(app.callsTo('saveOnboardingWizard').at(-1)?.[0] || {})).picks?.analyzeLater ?? false;
test('#74 #100 there is no Skip; once Analyze was asked during the clone (wanted), Continue does not leave the analysis for later', async () => {
  const saving = { saveOnboardingWizard: async (data) => ({ ...W.clone(W.READY), projectId: data?.projectId }) };
  const app = await W.atAnalysis({ api: { ...apiOf(), ...saving } });
  assert.equal(at(app, 'wizard-skip') == null, true, 'no wizard-skip before the analysis is asked for');
  await W.emit(app, { ...W.CLONING, wanted: true });
  assert.equal(at(app, 'wizard-skip') == null, true);
  await W.toReview(app, 'manual');
  assert.equal(app.callsTo('analyzeOnboarding').length, 0, 'Continue starts nothing');
  assert.equal(savedAnalyzeLater(app), false, 'the analysis was asked for: not saved as "analyze later"');
  // without it, the same path leaves the analysis for later
  const plain = await W.atAnalysis({ api: { ...apiOf(), ...saving } });
  await W.toReview(plain, 'manual');
  assert.equal(savedAnalyzeLater(plain), true);
});

test('#74 the review says what is still running, and a failed analysis as not reported, out of the total', async () => {
  const app = await analysisStep();
  const done = { status: 'done', profile: PROFILE, costUsd: 0.42 };
  await W.emit(app, { ...W.ANALYZING, jobs: jobsWith(done, { status: 'running' }) });
  await W.toReview(app, 'manual'); // #100: Continue waits for the workflows to be defined
  const costs = () => textOf(at(app, 'wizard-review-costs').outer);
  assert.match(costs(), /running/i);
  assert.match(costs(), /Total so far/);
  await W.emit(app, { ...W.ANALYZED, jobs: jobsWith(done, { status: 'failed', error: 'boom', reason: 'boom' }) });
  assert.match(costs(), /Not reported/);
  assert.match(textOf(at(app, 'wizard-review-cost-total').outer), /\$0\.42/);
  assert.match(costs(), /leaves out an analysis/);
});

test('#74 git\'s profile waiting for an analysis nobody asked for offers the choice again', async () => {
  const app = await analysisStep();
  await W.press(app, 'wizard-workflows-choice-analyze');
  await W.emit(app, { ...W.READY, jobs: jobsWith({ status: 'waiting', profile: PROFILE }, { status: 'waiting' }) });
  assert.equal(at(app, 'wizard-workflows-column').attrs['data-state'], 'choose');
});

test('#74 a resumed review, its analyses done before the restart, says what they cost', async () => {
  const app = await analysisStep({ profile: { costUsd: 0.42, free: false, basis: 1 } });
  const done = { status: 'done', profile: PROFILE, costUsd: 0.42 };
  await W.emit(app, { ...W.READY, jobs: jobsWith(done, { status: 'done', costUsd: 0.74 }) });
  await W.toReview(app, 'manual'); // #100: was "Skip, analyze later"; nothing is started
  await app.settle(10);
  assert.equal(app.callsTo('analyzeOnboarding').length, 0);
  assert.match(textOf(at(app, 'wizard-review-cost-total').outer), /\$1\.16/);
});

// the jobs' amounts of step 3, by data-part
function amountOf(app, id) {
  const row = H.findEl(at(app, 'wizard-cost').outer, (e) => e.attrs['data-part'] === id);
  return textOf(H.findEl(row.outer, (e) => W.classesOf(e).includes('wizard-amount')).outer);
}
// the "AI" badge (wizard-job-paid) of a row that will call a model and has not ended, '' without it
const paidOf = (app, id) => textOf(W.byTestId(H.findEl(at(app, 'wizard-cost').outer, (e) => e.attrs['data-part'] === id).outer, 'wizard-job-paid')?.outer || '');
const inLanguage = async (app, lang) => {
  app.sandbox.I18n.setLanguage(lang);
  app.sandbox.I18n.notify();
  await app.settle(10);
};
const inPortuguese = (app) => inLanguage(app, 'pt-BR');
const reviewed = async (app, state) => {
  await W.emit(app, state);
  await W.toReview(app, 'manual'); // #100: Continue waits for the workflows to be defined; nothing is started
  await app.settle(10);
  assert.equal(W.currentStep(app), 'review');
};

test('#74 in pt-BR: the unknown cost, the total that leaves an analysis out and the price beside Analyze', async () => {
  const unknown = await analysisStep();
  await inPortuguese(unknown);
  assert.equal(textOf(at(unknown, 'wizard-workflows-choice-cost').outer), 'Custo: desconhecido até rodar');
  await analyze(unknown);
  assert.equal(textOf(at(unknown, 'wizard-cost-total').outer), 'desconhecido até rodar');
  assert.match(textOf(at(unknown, 'wizard-cost-unknown').outer), /O valor real aparece na Revisão/);
  const partial = await analysisStep({ map: 0.74 });
  await inPortuguese(partial);
  assert.equal(textOf(at(partial, 'wizard-workflows-choice-cost').outer), 'Custo: US$ 0,74');
  await inLanguage(partial, 'en');
  await analyze(partial);
  assert.match(textOf(at(partial, 'wizard-cost-unknown').outer), /leaves out an analysis whose cost is not known/);
  await inPortuguese(partial);
  assert.match(textOf(at(partial, 'wizard-cost-unknown').outer), /deixa de fora uma análise de custo desconhecido/);
});

test('#74 the review\'s texts, in English and in pt-BR: the title, the total so far, the one not reported', async () => {
  const app = await analysisStep();
  const done = { status: 'done', profile: PROFILE, costUsd: 0.42 };
  await reviewed(app, { ...W.ANALYZING, jobs: jobsWith(done, { status: 'running' }) });
  const said = () => textOf(at(app, 'wizard-review-costs').outer);
  assert.match(said(), /Cost of the analyses/); // onboarding.review_cost_title, reworded
  await inPortuguese(app);
  assert.match(said(), /Custo das análises/);
  assert.match(said(), /Total até agora/);
  await W.emit(app, { ...W.ANALYZED, jobs: jobsWith(done, { status: 'failed', error: 'boom', reason: 'boom' }) });
  assert.match(said(), /Não informado/);
  assert.match(said(), /deixa de fora uma análise que não informou o custo/);
});

test('#74 a review whose analyses called no model is free; one that reported nothing says so, never $0', async () => {
  const free = await analysisStep();
  await reviewed(free, { ...W.ANALYZED, jobs: jobsWith({ status: 'done', profile: PROFILE, simulated: true }, { status: 'done', simulated: true }) });
  assert.equal(textOf(at(free, 'wizard-review-cost-total').outer), 'free');
  const silent = await analysisStep();
  await reviewed(silent, { ...W.ANALYZED, jobs: jobsWith({ status: 'failed', error: 'x', reason: 'x' }, { status: 'failed', error: 'x', reason: 'x' }) });
  assert.equal(textOf(at(silent, 'wizard-review-cost-total').outer), 'Not reported');
});

test('#74 #100 the review of an import whose analysis was left for later (Define manually, Continue) has no costs', async () => {
  const app = await analysisStep({ profile: { costUsd: 0.42, free: false, basis: 1 }, map: 0.74 });
  await W.toReview(app, 'manual');
  await app.settle(10);
  assert.equal(W.currentStep(app), 'review');
  assert.equal(app.callsTo('analyzeOnboarding').length, 0, 'nothing was started');
  assert.equal(at(app, 'wizard-review-costs') == null, true);
});

test('#74 an amount: "Estimating…" until read, "—" for a failed job with an estimate and for a done one with no cost', async () => {
  const waiting = await W.atAnalysis({ api: { seedEstimate: () => new Promise(() => {}), architectureEstimate: () => new Promise(() => {}) } });
  await waiting.settle(10);
  assert.equal(at(waiting, 'wizard-workflows-choice-cost') == null, true);
  await analyze(waiting);
  assert.match(amountOf(waiting, 'profile'), /Estimating/);
  const app = await analysisStep({ map: 0.74 });
  await W.emit(app, { ...W.ANALYZED, jobs: jobsWith({ status: 'done', profile: PROFILE }, { status: 'failed', error: 'x', reason: 'x' }) });
  assert.equal(amountOf(app, 'profile'), '—');
  assert.equal(amountOf(app, 'projectMap'), '—');
});

test('#74 an estimate that cannot be read is not known, never free', async () => {
  const fails = async () => { throw new Error('no answer'); };
  const app = await W.atAnalysis({ api: { seedEstimate: fails, architectureEstimate: fails } });
  await app.settle(10);
  assert.equal(textOf(at(app, 'wizard-workflows-choice-cost').outer), 'Cost: unknown until it runs');
  await analyze(app);
  // a row whose cost is not known: the "AI" badge (it calls a model), no amount; "unknown" is said once, in the total
  for (const id of ['profile', 'projectMap']) {
    assert.equal(amountOf(app, id), '', id);
    assert.equal(paidOf(app, id), 'AI', id);
  }
  assert.equal(textOf(at(app, 'wizard-cost-total').outer), 'unknown until it runs');
});

test('#74 the estimates are asked for this project, the map\'s from the other projects too', async () => {
  const app = await analysisStep();
  assert.deepEqual(W.clone(app.callsTo('seedEstimate').at(-1)), [{ projectId: W.PID, seedId: 'ways-of-working' }]);
  assert.deepEqual(W.clone(app.callsTo('architectureEstimate').at(-1)), [W.PID, { others: true }]);
});

// the analysis step opened while the clone still runs (step 2's Next, #641), the estimates answered by `answers`;
// #100: Analyze with AI asked there (the engine keeps it for the clone's end: `wanted`), so the job rows show
async function whileCloning(answers) {
  let n = 0;
  const app = await W.imported(W.CLONING, { api: { ...apiOf(), seedEstimate: () => answers[Math.min(n++, answers.length - 1)], analyzeOnboarding: async () => ({ ...W.clone(W.CLONING), wanted: true }) } });
  if (W.currentStep(app) !== 'analysis') await W.press(app, 'wizard-next');
  assert.equal(W.currentStep(app), 'analysis');
  await app.settle(10);
  await analyze(app);
  return { app, reads: () => n };
}

test('#74 an estimate read during the clone is read again once it is there, then no more', async () => {
  const { app, reads } = await whileCloning([Promise.resolve({ costUsd: 0.42, free: false, basis: 1 }), Promise.resolve({ costUsd: 0, free: true, basis: 0 })]);
  assert.match(amountOf(app, 'profile'), /\$0\.42/);
  await W.emit(app, W.READY);
  await app.settle(10);
  assert.equal(amountOf(app, 'profile'), 'free');
  await W.emit(app, W.ANALYZING);
  assert.equal(reads(), 2);
});

test('#74 an answer of the clone\'s read that comes late does not replace the one read after it', async () => {
  let late;
  const { app } = await whileCloning([new Promise((r) => { late = r; }), Promise.resolve({ costUsd: 0, free: true, basis: 0 })]);
  await W.emit(app, W.READY);
  await app.settle(10);
  late({ costUsd: 0.9, free: false, basis: 1 });
  await app.settle(10);
  assert.equal(amountOf(app, 'profile'), 'free');
});

test('#74 Analyze on a failed profile: before the analysis it starts it; after, it runs the failed job again', async () => {
  const failed = { status: 'failed', error: 'boom', reason: 'boom' };
  for (const [state, method] of [[W.READY, 'analyzeOnboarding'], [W.ANALYZED, 'retryOnboarding']]) {
    const app = await analysisStep();
    await W.emit(app, { ...state, jobs: jobsWith(failed, { status: state === W.ANALYZED ? 'done' : 'waiting' }) });
    await W.press(app, 'wizard-workflows-choice-manual');
    const before = { analyzeOnboarding: app.callsTo('analyzeOnboarding').length, retryOnboarding: app.callsTo('retryOnboarding').length };
    await W.press(app, 'wizard-workflows-choice-analyze');
    const made = Object.keys(before).filter((m) => app.callsTo(m).length > before[m]);
    assert.deepEqual(made, [method], state.status);
  }
});

// ---- #100 (visual-layout): the progress strip (wizard-progress) while the engine analyses ----------------------

const progressOf = (app) => {
  const strip = at(app, 'wizard-progress');
  if (!strip) return null;
  const bar = H.findEl(strip.outer, (e) => e.name === 'progress');
  return { text: textOf(strip.outer), max: bar?.attrs.max, value: bar?.attrs.value };
};
const jobRows = (app) => H.findAll(at(app, 'wizard-cost')?.outer || '', (e) => e.name === 'li' && W.classesOf(e).includes('wizard-job'));

test('#100 no progress strip before the analysis is asked for', async () => {
  const app = await analysisStep();
  assert.equal(progressOf(app), null);
  assert.equal(at(app, 'wizard-cost') == null, true);
});

test('#100 while the engine analyses, wizard-cost opens with wizard-progress: the jobs ended of the total, and the one running', async () => {
  const app = await analyzing(); // the helpers' ANALYZING: the clone done, the facts running
  assert.equal(H.findEl(W.wizardMarkup(app), (e) => W.classesOf(e).includes('wizard-analysis'))?.attrs['data-state'], 'analyzing', 'the step\'s screen (.wizard-analysis data-state)');
  assert.deepEqual(progressOf(app), { text: 'Analyzing · 1 of 4 steps · Facts', max: '4', value: '1' });
  assert.equal(jobRows(app).length, 4, 'the job rows under the strip');
  await inPortuguese(app);
  assert.equal(progressOf(app).text, 'Analisando · 1 de 4 etapas · Fatos');
});

test('#100 the workflows ready and the engine still analysing: wizard-cost holds only the strip, no job rows; gone once analyzed', async () => {
  const app = await analyzing();
  const profiled = { status: 'done', profile: { ...PROFILE, release: 'milestone' } };
  await W.emit(app, { ...W.ANALYZING, jobs: jobsWith(profiled, { status: 'running' }) });
  assert.equal(at(app, 'wizard-workflows-column').attrs['data-state'], 'analyzed');
  assert.deepEqual(progressOf(app), { text: 'Workflows ready · the rest of the analysis continues (3 of 4) · City and architecture', max: '4', value: '3' });
  assert.equal(jobRows(app).length, 0, 'no job rows beside the workflows');
  assert.equal(at(app, 'wizard-cost-total') == null, true);
  await W.emit(app, { ...W.ANALYZED, jobs: jobsWith(profiled, { status: 'done', costUsd: 0.74 }) });
  assert.equal(progressOf(app), null, 'no strip once the engine ended');
  assert.equal(at(app, 'wizard-cost') == null, true);
});

test('#74 Analyze says only what is still to run:a project map done before a restart is not in it', async () => {
  const app = await analysisStep({ profile: { costUsd: 0.42, free: false, basis: 1 }, map: 0.9 });
  await W.emit(app, { ...W.READY, jobs: jobsWith({ status: 'waiting', profile: PROFILE }, { status: 'done', costUsd: 0.74 }) });
  assert.match(textOf(at(app, 'wizard-workflows-choice-cost').outer), /\$0\.42/);
});
