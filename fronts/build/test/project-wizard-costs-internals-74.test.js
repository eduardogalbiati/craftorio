// #74, the details behind project-wizard-costs-74.test.js: what Analyze says it costs, the note of an unknown cost,
// Skip once Analyze was asked during the clone, the review while it runs or after a failure, the column after a restart,
// when the estimates are read, and the texts in pt-BR.
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

test('#74 Analyze the repository says the estimated total beside it', async () => {
  const app = await analysisStep({ profile: { costUsd: 0.42, free: false, basis: 1 }, map: 0.74 });
  assert.match(textOf(at(app, 'wizard-workflows-choice-cost').outer), /\$1\.16/);
  assert.equal(at(app, 'wizard-cost-unknown') == null, true);
});

test('#74 with no estimate at all a note says the cost is not known before it runs', async () => {
  const app = await analysisStep();
  assert.match(textOf(at(app, 'wizard-cost-unknown').outer), /not known before they run/);
  assert.match(textOf(at(app, 'wizard-workflows-choice-cost').outer), /Not known yet/);
});

test('#74 a free profile does not turn an unknown total into $0', async () => {
  const app = await analysisStep({ profile: { costUsd: 0, free: true } });
  assert.equal(textOf(at(app, 'wizard-cost-total').outer), 'Not known yet');
});

test('#74 Skip is gone once Analyze was asked during the clone', async () => {
  const app = await analysisStep();
  assert.equal(at(app, 'wizard-skip') == null, false);
  await W.emit(app, { ...W.CLONING, wanted: true });
  assert.equal(at(app, 'wizard-skip') == null, true);
});

test('#74 the review says what is still running, and a failed analysis as not reported, out of the total', async () => {
  const app = await analysisStep();
  const done = { status: 'done', profile: PROFILE, costUsd: 0.42 };
  await W.emit(app, { ...W.ANALYZING, jobs: jobsWith(done, { status: 'running' }) });
  await W.press(app, 'wizard-next');
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
  await W.press(app, 'wizard-skip');
  await app.settle(10);
  assert.equal(W.currentStep(app), 'review');
  assert.match(textOf(at(app, 'wizard-review-cost-total').outer), /\$1\.16/);
});

// the jobs' amounts of step 3, by data-part
function amountOf(app, id) {
  const row = H.findEl(at(app, 'wizard-cost').outer, (e) => e.attrs['data-part'] === id);
  return textOf(H.findEl(row.outer, (e) => W.classesOf(e).includes('wizard-amount')).outer);
}
const inPortuguese = async (app) => {
  app.sandbox.I18n.setLanguage('pt-BR');
  app.sandbox.I18n.notify();
  await app.settle(10);
};
const reviewed = async (app, state) => {
  await W.emit(app, state);
  await W.press(app, 'wizard-next');
  await app.settle(10);
  assert.equal(W.currentStep(app), 'review');
};

test('#74 in pt-BR: the unknown cost, the total that leaves an analysis out and the price beside Analyze', async () => {
  const unknown = await analysisStep();
  await inPortuguese(unknown);
  assert.match(textOf(at(unknown, 'wizard-cost-unknown').outer), /não é conhecido antes de rodarem/);
  assert.equal(textOf(at(unknown, 'wizard-workflows-choice-cost').outer), 'Modelos reais · Ainda não estimado');
  const partial = await analysisStep({ map: 0.74 });
  assert.match(textOf(at(partial, 'wizard-cost-unknown').outer), /leaves out an analysis whose cost is not known/);
  await inPortuguese(partial);
  assert.match(textOf(at(partial, 'wizard-cost-unknown').outer), /deixa de fora uma análise de custo desconhecido/);
  assert.equal(textOf(at(partial, 'wizard-workflows-choice-cost').outer), 'Modelos reais · US$ 0,74');
});

test('#74 the review\'s texts, in English and in pt-BR: the title, the total so far, the one not reported', async () => {
  const app = await analysisStep();
  const done = { status: 'done', profile: PROFILE, costUsd: 0.42 };
  await reviewed(app, { ...W.ANALYZING, jobs: jobsWith(done, { status: 'running' }) });
  const said = () => textOf(at(app, 'wizard-review-costs').outer);
  assert.match(said(), /What the analyses cost/);
  await inPortuguese(app);
  assert.match(said(), /Quanto custaram as análises/);
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

test('#74 a skipped import\'s review has no costs', async () => {
  const app = await analysisStep({ profile: { costUsd: 0.42, free: false, basis: 1 }, map: 0.74 });
  await W.press(app, 'wizard-skip');
  await app.settle(10);
  assert.equal(W.currentStep(app), 'review');
  assert.equal(at(app, 'wizard-review-costs') == null, true);
});

test('#74 an amount: "Estimating…" until read, "—" for a failed job with an estimate and for a done one with no cost', async () => {
  const waiting = await W.atAnalysis({ api: { seedEstimate: () => new Promise(() => {}), architectureEstimate: () => new Promise(() => {}) } });
  await waiting.settle(10);
  assert.match(amountOf(waiting, 'profile'), /Estimating/);
  assert.equal(at(waiting, 'wizard-workflows-choice-cost') == null, true);
  const app = await analysisStep({ map: 0.74 });
  await W.emit(app, { ...W.ANALYZED, jobs: jobsWith({ status: 'done', profile: PROFILE }, { status: 'failed', error: 'x', reason: 'x' }) });
  assert.equal(amountOf(app, 'profile'), '—');
  assert.equal(amountOf(app, 'projectMap'), '—');
});

test('#74 an estimate that cannot be read is not known, never free', async () => {
  const fails = async () => { throw new Error('no answer'); };
  const app = await W.atAnalysis({ api: { seedEstimate: fails, architectureEstimate: fails } });
  await app.settle(10);
  assert.equal(amountOf(app, 'profile'), 'Not known yet');
  assert.equal(amountOf(app, 'projectMap'), 'Not known yet');
});

test('#74 the estimates are asked for this project, the map\'s from the other projects too', async () => {
  const app = await analysisStep();
  assert.deepEqual(W.clone(app.callsTo('seedEstimate').at(-1)), [{ projectId: W.PID, seedId: 'ways-of-working' }]);
  assert.deepEqual(W.clone(app.callsTo('architectureEstimate').at(-1)), [W.PID, { others: true }]);
});

// the analysis step opened while the clone still runs (step 2's Next, #641), the estimates answered by `answers`
async function whileCloning(answers) {
  let n = 0;
  const app = await W.imported(W.CLONING, { api: { ...apiOf(), seedEstimate: () => answers[Math.min(n++, answers.length - 1)] } });
  if (W.currentStep(app) !== 'analysis') await W.press(app, 'wizard-next');
  assert.equal(W.currentStep(app), 'analysis');
  await app.settle(10);
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

test('#74 Analyze says only what is still to run:a project map done before a restart is not in it', async () => {
  const app = await analysisStep({ profile: { costUsd: 0.42, free: false, basis: 1 }, map: 0.9 });
  await W.emit(app, { ...W.READY, jobs: jobsWith({ status: 'waiting', profile: PROFILE }, { status: 'done', costUsd: 0.74 }) });
  assert.match(textOf(at(app, 'wizard-workflows-choice-cost').outer), /\$0\.42/);
});
