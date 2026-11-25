// #74, the details behind project-wizard-costs-74.test.js: what Analyze says it costs, the note of an unknown cost,
// Skip once Analyze was asked during the clone, the review while it runs or after a failure, the column after a restart.
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
