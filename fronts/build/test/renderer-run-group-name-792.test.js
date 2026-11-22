// #792: the sections of the Run screen (run.js renderSteps) name the last group as the card does: a run's
// `Open PR` group reads "Abrir PR" in Portuguese, a local merge keeps "Merge". The translation is only what
// a person reads: the section's data-group stays the workflow's name, the key of its open/closed state.
// The page is the real one (renderer-app-harness.js); the run is fed through window.api's onEvent handler.
const test = require('node:test');
const assert = require('node:assert/strict');
const I18n = require('@craftorio/shared/i18n.js');
const { loadApp } = require('@craftorio/ui-kit/test/renderer-app-harness');

const STEPS = [{ id: 'develop', agent: 'dev' }, { id: 'pr_open', agent: 'dev' }];

// [data-group, the name a person reads] of each section of the Run screen
async function sections(t, language, lastGroup) {
  I18n.setLanguage(language);
  t.after(() => I18n.setLanguage('en'));
  const app = loadApp();
  await app.boot();
  app.run(`(window.I18n || I18n).setLanguage('${language}')`);
  let seq = 0;
  const emit = (ev) => app.apiHandlers.onEvent.forEach((fn) => fn({ run_id: 'r1', ts: new Date().toISOString(), seq: ++seq, ...ev }));
  emit({ type: 'workflow.started', workflow: 'wf', run_dir: 'C:/ws/runs/r1', inputs: {}, steps: STEPS, groups: [{ name: 'Develop', steps: ['develop'] }, { name: lastGroup, steps: ['pr_open'] }] });
  for (const id of ['develop', 'pr_open']) emit({ type: 'step.started', step_id: id, visit: 1, step_type: 'agent' });
  app.run("state.runId = 'r1'; showView('run')");
  await app.settle(30);
  assert.deepEqual(app.errors.map((e) => String(e.message)), [], 'the page drew without errors');
  return [...String(app.el('#steps').innerHTML).matchAll(/data-group="([^"]*)"[\s\S]*?<b>([^<]*)<\/b>/g)].map((m) => [m[1], m[2]]);
}

test('#792 the Run screen shows the section of a run that opens a pull request as Abrir PR, in Portuguese', async (t) => {
  assert.deepEqual(await sections(t, 'pt-BR', 'Open PR'), [['Develop', 'Develop'], ['Open PR', 'Abrir PR']]);
});

test('#792 the Run screen shows it as Open PR, in English', async (t) => {
  assert.deepEqual(await sections(t, 'en', 'Open PR'), [['Develop', 'Develop'], ['Open PR', 'Open PR']]);
});

test('#792 the Run screen keeps Merge for a local merge, in Portuguese too', async (t) => {
  assert.deepEqual(await sections(t, 'pt-BR', 'Merge'), [['Develop', 'Develop'], ['Merge', 'Merge']]);
});
