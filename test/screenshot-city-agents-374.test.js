// #374: `npm run screenshot -- --view project --tab architecture --mode city-agents` draws the project
// city with simulated runs in progress (agents on the roofs, a crane, a trail, a collision). The view
// module (scripts/screenshot/views/project.js) declares the mode; the Electron part of
// test/screenshot.test.js then opens every declared tab and mode by itself.
const test = require('node:test');
const assert = require('node:assert/strict');

const load = () => require('../scripts/screenshot');

test('#374 the project view offers a city-agents mode for its Architecture tab', () => {
  const { VIEWS } = load();
  assert.ok(VIEWS.project.tabs.includes('architecture'), 'the architecture tab');
  assert.ok(VIEWS.project.modes.includes('city-agents'), `project modes: ${VIEWS.project.modes.join(', ')}`);
});

test('#374 --view project --tab architecture --mode city-agents is accepted and named project-architecture-city-agents', () => {
  const { parseArgs } = load();
  const args = parseArgs(['--view', 'project', '--tab', 'architecture', '--mode', 'city-agents']);
  assert.equal(args.view, 'project');
  assert.equal(args.tab, 'architecture');
  assert.equal(args.mode, 'city-agents');
  assert.equal(args.name, 'project-architecture-city-agents');
});

test('#374 the usage text names the city-agents mode of the project view', () => {
  assert.match(load().usage(), /\bcity-agents\b/);
});
