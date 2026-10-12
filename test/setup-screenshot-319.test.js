// #319 (acceptance tests, written before the code): scripts/screenshot.js draws the first-run
// Setup. Parameter style chosen: a 'setup' view whose steps are modes, like backlog's
// (`--view setup --mode agents`), named setup-<mode>. Steps: agents, try-it-safely, workflows,
// first-project. Only the argument parser is checked here: no Electron.
const test = require('node:test');
const assert = require('node:assert/strict');
const { parseArgs, usage, VIEWS } = require('../scripts/screenshot');

const STEPS = ['agents', 'try-it-safely', 'workflows', 'first-project'];

test('the screenshot script offers a setup view with one mode per Setup step', () => {
  assert.ok(VIEWS.setup, 'a setup view');
  for (const step of STEPS) assert.ok((VIEWS.setup.modes || []).includes(step), `setup mode ${step}`);
});

test('--view setup --mode <step> names the file setup-<step>; other modes are refused', () => {
  for (const step of STEPS) assert.equal(parseArgs(['--view', 'setup', '--mode', step]).name, `setup-${step}`);
  assert.throws(() => parseArgs(['--view', 'setup', '--mode', 'kanban']), /does not apply to setup/);
});

test('--help lists the setup view', () => {
  assert.match(usage(), /setup/);
  assert.match(usage(), /try-it-safely/);
});
