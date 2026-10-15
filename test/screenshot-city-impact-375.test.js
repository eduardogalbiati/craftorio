// #375: `npm run screenshot -- --view project --tab architecture --mode city-issue` draws the project
// city with an issue's impact preview (expected buildings coloured by source, the rest grey, the
// header), and `--mode city-stage` a roadmap stage's footprint (each item its colour, a shared
// building red). The view module (scripts/screenshot/views/project.js) declares the modes; the
// Electron part of test/screenshot.test.js then opens every declared tab and mode by itself.
const test = require('node:test');
const assert = require('node:assert/strict');

const load = () => require('../scripts/screenshot');

for (const mode of ['city-issue', 'city-stage']) {
  test(`#375 the project view offers a ${mode} mode for its Architecture tab`, () => {
    const { VIEWS } = load();
    assert.ok(VIEWS.project.tabs.includes('architecture'), 'the architecture tab');
    assert.ok(VIEWS.project.modes.includes(mode), `project modes: ${VIEWS.project.modes.join(', ')}`);
  });

  test(`#375 --view project --tab architecture --mode ${mode} is accepted and named project-architecture-${mode}`, () => {
    const { parseArgs } = load();
    const args = parseArgs(['--view', 'project', '--tab', 'architecture', '--mode', mode]);
    assert.equal(args.view, 'project');
    assert.equal(args.tab, 'architecture');
    assert.equal(args.mode, mode);
    assert.equal(args.name, `project-architecture-${mode}`);
  });

  test(`#375 the usage text names the ${mode} mode of the project view`, () => {
    assert.match(load().usage(), new RegExp(`\\b${mode}\\b`));
  });
}
