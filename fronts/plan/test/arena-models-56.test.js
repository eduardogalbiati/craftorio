// #56: the models the AI Arena offers (fronts/plan/views/arena/arena.js). Acceptance tests written
// before the code, through the page (renderer-app-harness.js: the setup is read from the markup the
// screen drew). The four default contenders fill the first slots; the fifth, added by hand, is the
// small Haiku model. A contender saved on an earlier version keeps it and stays selected.
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('@craftorio/ui-kit/test/renderer-app-harness');

const OLD_FABLE = 'claude-fable-5-1';

async function openArena(storage = {}) {
  const app = loadApp({ api: { listProjects: async () => [], listSkills: async () => [] }, storage });
  await app.boot();
  app.run("showView('arena')");
  await app.settle();
  return app;
}
// the model selected in each contender's card, in order (null: no option is selected)
const selectedModels = (app) => [...String(app.el('#arena-contenders').innerHTML).matchAll(/<select data-field="model"[^>]*>([\s\S]*?)<\/select>/g)]
  .map(([, options]) => /<option[^>]*\sselected[^>]*>([^<]*)</.exec(options)?.[1] ?? null);

test('#56 the contender added after the default ones runs on Haiku 5.5', async () => {
  const app = await openArena();
  app.el('#arena-add').onclick();
  assert.equal(selectedModels(app)[4], 'claude-haiku-5-5');
});

test('#56 a saved contender on an earlier version keeps its model and shows it selected', async () => {
  const saved = { contenders: [{ provider: 'claude-code', model: OLD_FABLE, effort: 'high' }, { provider: 'claude-code', model: 'claude-opus-5-5', effort: 'high' }] };
  const app = await openArena({ 'craftorio.arena': JSON.stringify(saved) });
  assert.deepEqual(selectedModels(app), [OLD_FABLE, 'claude-opus-5-5']);
});
