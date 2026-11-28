// #127 acceptance, written before the code: step 3 of the new-project wizard (Analysis and workflows) has a back arrow
// to the two ways of defining the workflows. On the real page (packages/ui-kit/test/renderer-app-harness.js), driven
// through project-wizard-helpers.js as project-wizard-manual-analyses-20.test.js does.
//
// The contract assumed here:
// - the arrow is a <button type="button"> with data-testid="wizard-workflows-back", at the top left of step 3,
//   before the step's heading ("Workflows of <name>", h2#project-wizard-title); shown when the workflows column's
//   (wizard-workflows-column) data-state is "manual" or "analyzed", never on "choose";
// - it has an aria-label and a title, both "Back to how the workflows are defined" in English, translated in pt-BR;
// - a click puts the column back on "choose" (wizard-workflows-choice-analyze and -manual show again) and calls no
//   engine method (no api.analyzeOnboarding, api.retryOnboarding nor api.startOnboarding);
// - the rows' picks made by hand (a wizard-workflow-tile clicked, aria-pressed="true") are kept: Define manually
//   again shows them as the owner left them.
const test = require('node:test');
const assert = require('node:assert/strict');
const H = require('@craftorio/ui-kit/test/page-pieces');
const W = require('./project-wizard-helpers');

const BACK = 'wizard-workflows-back';
const TOOLTIP = 'Back to how the workflows are defined';
const PROFILE = { mode: 'local', ci: 'release', release: 'milestone', tests: 'unit', testCommand: 'npm test', languages: ['javascript'] };
// the profile job done while the other analyses still run: the rows show with the analysis' reasons
const PROFILED = {
  projectId: W.PID, status: 'analyzing', profile: PROFILE, cli: W.CLI_OK,
  jobs: { clone: { status: 'done' }, facts: { status: 'done' }, profile: { status: 'done', profile: PROFILE }, projectMap: { status: 'running' }, ranking: { status: 'waiting' } },
};

const column = (app) => W.byTestId(W.wizardMarkup(app), 'wizard-workflows-column');
const columnState = (app) => column(app)?.attrs['data-state'] ?? null;
const backOf = (app) => W.byTestId(W.wizardMarkup(app), BACK);
const engineCalls = (app) => ['analyzeOnboarding', 'retryOnboarding', 'startOnboarding'].map((m) => `${m}:${app.callsTo(m).length}`).join(' ');
const tiles = (app) => H.findAll(W.wizardMarkup(app), (e) => e.attrs['data-testid'] === 'wizard-workflow-tile');
const pressedTiles = (app) => tiles(app).filter((e) => e.attrs['aria-pressed'] === 'true').map((e) => `${e.attrs['data-kind']}=${e.attrs['data-value']}`).sort();

async function manual(app) {
  await W.press(app, 'wizard-workflows-choice-manual');
  assert.equal(columnState(app), 'manual', 'Define manually shows the rows');
}

async function analyzed(app) {
  await W.press(app, 'wizard-workflows-choice-analyze');
  await W.emit(app, PROFILED);
  assert.equal(columnState(app), 'analyzed', `the analysis' rows (data-state ${columnState(app)})`);
}

test('#127 on the two choices (choose) there is no back arrow', { timeout: 30000 }, async () => {
  const app = await W.atAnalysis();
  assert.equal(columnState(app), 'choose', 'the two choices');
  assert.equal(backOf(app) === null, true, `no data-testid="${BACK}"`);
});

for (const [state, reach] of [['manual', manual], ['analyzed', analyzed]]) {
  test(`#127 ${state}: the back arrow shows at the top of the step, before its heading, as a button`, { timeout: 30000 }, async () => {
    const app = await W.atAnalysis();
    await reach(app);
    const back = backOf(app);
    assert.ok(back, `data-testid="${BACK}" shows on ${state}`);
    assert.equal(back.name, 'button', `a <button> (${back.name})`);
    assert.equal(back.attrs.type, 'button', 'type="button"');
    const html = W.wizardMarkup(app);
    const at = html.indexOf(back.outer);
    const heading = html.indexOf('id="project-wizard-title"');
    assert.notEqual(heading, -1, 'the step\'s heading (Workflows of <name>)');
    assert.equal(at < heading, true, 'the arrow comes before the heading');
  });

  test(`#127 ${state}: a click on the back arrow shows the two choices again and starts nothing`, { timeout: 30000 }, async () => {
    const app = await W.atAnalysis();
    await reach(app);
    const before = engineCalls(app);
    await W.press(app, BACK);
    await app.settle(20);
    assert.equal(columnState(app), 'choose', `wizard-workflows-column data-state: ${columnState(app)}`);
    const html = W.wizardMarkup(app);
    assert.ok(W.byTestId(html, 'wizard-workflows-choice-analyze'), 'Analyze with AI shows again');
    assert.ok(W.byTestId(html, 'wizard-workflows-choice-manual'), 'Define manually shows again');
    assert.equal(backOf(app) === null, true, 'no back arrow on the two choices');
    assert.equal(engineCalls(app), before, 'no engine call from the click');
  });
}

test('#127 the back arrow has a label for assistive tech and a tooltip: "Back to how the workflows are defined"', { timeout: 30000 }, async () => {
  const app = await W.atAnalysis();
  await manual(app);
  const back = backOf(app);
  assert.ok(back, `data-testid="${BACK}"`);
  assert.equal(back.attrs['aria-label'], TOOLTIP, 'aria-label');
  assert.equal(back.attrs.title, TOOLTIP, 'title');
});

test('#127 pt-BR: the back arrow\'s label and tooltip are translated', { timeout: 30000 }, async () => {
  const app = await W.atAnalysis();
  app.sandbox.I18n.setLanguage('pt-BR');
  await app.settle(10);
  await manual(app);
  const back = backOf(app);
  assert.ok(back, `data-testid="${BACK}"`);
  const label = String(back.attrs['aria-label'] || '');
  assert.notEqual(label.trim(), '', 'an aria-label');
  assert.notEqual(label, TOOLTIP, `translated, not the English text (${label})`);
  assert.doesNotMatch(label, /onboarding\./, `not a bare catalog key (${label})`);
  assert.equal(back.attrs.title, label, 'the tooltip says the same');
});

test('#127 back from the manual rows, then Define manually again: the picks made by hand are kept', { timeout: 30000 }, async () => {
  const app = await W.atAnalysis();
  await manual(app);
  // a tile that is not picked yet, in a row with more than one choice
  const tile = tiles(app).find((e) => e.attrs['aria-pressed'] !== 'true');
  assert.ok(tile, 'a row offers a tile not picked yet');
  const kind = tile.attrs['data-kind'];
  const value = tile.attrs['data-value'];
  await W.clickRendered(app, tile, ['#project-wizard']);
  await app.settle(10);
  const picked = pressedTiles(app);
  assert.equal(picked.includes(`${kind}=${value}`), true, `the click picked ${kind}=${value} (${picked.join(', ')})`);
  await W.press(app, BACK);
  assert.equal(columnState(app), 'choose', 'back on the two choices');
  await manual(app);
  assert.deepEqual(pressedTiles(app), picked, 'the rows as the owner left them');
});
