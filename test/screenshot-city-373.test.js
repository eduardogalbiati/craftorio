// #373: `npm run screenshot -- --view project --tab architecture --mode city` draws the project city
// with simulated facts. The view module (scripts/screenshot/views/project.js) declares the mode; the
// Electron part of test/screenshot.test.js then opens every declared tab and mode by itself.
const test = require('node:test');
const assert = require('node:assert/strict');

const load = () => require('../scripts/screenshot');

test('#373 the project view offers a city mode for its Architecture tab', () => {
  const { VIEWS } = load();
  assert.ok(VIEWS.project.tabs.includes('architecture'), 'the architecture tab');
  assert.ok(VIEWS.project.modes.includes('city'), `project modes: ${VIEWS.project.modes.join(', ')}`);
});

test('#373 --view project --tab architecture --mode city is accepted and named project-architecture-city', () => {
  const { parseArgs } = load();
  const args = parseArgs(['--view', 'project', '--tab', 'architecture', '--mode', 'city']);
  assert.equal(args.view, 'project');
  assert.equal(args.tab, 'architecture');
  assert.equal(args.mode, 'city');
  assert.equal(args.name, 'project-architecture-city');
});

test('#373 the usage text names the city mode of the project view', () => {
  assert.match(load().usage(), /\bcity\b/);
});
