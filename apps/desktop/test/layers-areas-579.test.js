// #580 review: the layering check tells the fronts apart. The UI kit is the `kit` area and each front
// its own `front:<id>` (both read from scripts/source-tree.js, so a new front needs no edit in
// scripts/layers.js); a front may require the kit and shared, never another front; an app's page
// folder is the `renderer` area; a package's tests and features are no area.
const test = require('node:test');
const assert = require('node:assert/strict');
const { AREAS, areaOf, PACKAGES } = require('../../../scripts/layers');

test('areaOf: the UI kit is `kit`, a front is `front:<id>`, an app\'s page folder is `renderer`; tests and features are no area', () => {
  assert.equal(areaOf('packages/ui-kit/app.js'), 'kit');
  assert.equal(areaOf('packages/ui-kit/views/dashboard/dashboard.js'), 'kit');
  assert.equal(areaOf('packages/ui-kit/test/x.test.js'), null);
  assert.equal(areaOf('fronts/build/views/backlog/backlog.js'), 'front:build');
  assert.equal(areaOf('fronts/build/build-home.js'), 'front:build');
  assert.equal(areaOf('fronts/build/features/steps/backlog.steps.js'), null);
  assert.equal(areaOf('apps/desktop/renderer/views/x/x.js'), 'renderer');
  assert.equal(areaOf('apps/web/renderer/api-http.js'), 'renderer');
  assert.equal(areaOf('apps/web/composition.js'), null);
});

test('the areas: a front may require its own files, the kit and shared, never another front; the kit only shared; a page only the kit and shared', () => {
  assert.deepEqual(AREAS.kit.may, ['kit', 'shared']);
  assert.deepEqual(AREAS.renderer.may, ['renderer', 'kit', 'shared']);
  for (const id of ['ai', 'analyser', 'build', 'plan']) {
    assert.deepEqual(AREAS[`front:${id}`].may, [`front:${id}`, 'kit', 'shared'], `front:${id}`);
    assert.equal(PACKAGES[`fronts/${id}`], `front:${id}`);
  }
  assert.equal(PACKAGES['packages/ui-kit'], 'kit');
});
