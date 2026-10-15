// The city's layout reuses the product's rules (#373 review): test files are those of
// src/shared/globs.js TESTS_PATHS, and the quadrant colours follow ArchitectureModel.QUADRANTS.
const test = require('node:test');
const assert = require('node:assert');
const CityLayout = require('../src/shared/city-layout');
const { QUADRANTS } = require('../src/shared/architecture-model');

test('isTest follows the shared test patterns, Java and C# included', () => {
  for (const p of ['src/test/java/a/FooTest.java', 'Api.Tests/UserTests.cs', 'features/login.feature', 'src/a.test.js', 'pkg/x_test.go']) {
    assert.strictEqual(CityLayout.isTest(p), true, p);
  }
  for (const p of ['src/main/java/a/Foo.java', 'src/app.js', 'Api/User.cs']) {
    assert.strictEqual(CityLayout.isTest(p), false, p);
  }
});

test('the quadrant legend lists the facts model quadrants, each with its own colour', () => {
  const layout = { buildings: QUADRANTS.map((q, i) => ({ path: `f${i}.js`, quadrant: q })), zones: [] };
  const { colours, legend } = CityLayout.colourBy(layout, 'quadrant');
  assert.deepStrictEqual(legend.slice(0, QUADRANTS.length).map((l) => l.label), QUADRANTS);
  assert.strictEqual(new Set(colours).size, QUADRANTS.length);
  assert.ok(!colours.includes(legend[legend.length - 1].colour), 'no measured building takes the Not measured colour');
});
