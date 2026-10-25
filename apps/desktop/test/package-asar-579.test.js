// #579 (phase 3 review): what the packaged app leaves out of the asar. The workspaces (the kit, the
// fronts, the apps) and their dereferenced copies under node_modules/@multiagent/ hold folders that are
// not the app: tests, scripts, Playwright features, the analyser's city layout POC with its
// screenshots (2.9 MB), the 3D views' JSX sources (bundled into generated/), and the browser app
// (the engine serves it). Each is run through packagerOptions().ignore, the way @electron/packager
// does: ignored when any pattern matches the path from the app root (a leading slash).
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { packagerOptions } = require('../scripts/package');

const root = path.join(__dirname, '..', '..', '..');
const ignore = packagerOptions({ platform: 'win32', arch: 'x64', out: path.join(root, 'dist') }).ignore;
const ignored = (p) => ignore.some((re) => re.test(p));

test('the asar leaves out the fronts\' POCs, features, tests and 3D sources, in the workspace and in its node_modules copy', () => {
  for (const p of [
    '/fronts/analyser/poc/city-modes.html',
    '/fronts/analyser/poc/city-modes-screenshots/city-modes-explore-laptop-dark.jpg',
    '/fronts/analyser/features/architecture.feature',
    '/fronts/build/features/steps/backlog.steps.js',
    '/fronts/plan/test/renderer-inbox-256.test.js',
    '/fronts/analyser/city3d/main.jsx',
    '/packages/ui-kit/run3d/scene.jsx',
    '/packages/ui-kit/test/renderer-app-harness.js',
    '/packages/ui-kit/features/app.feature',
    '/node_modules/@multiagent/front-analyser/poc/city-modes-screenshots/x.jpg',
    '/node_modules/@multiagent/front-analyser/city3d/main.jsx',
    '/node_modules/@multiagent/front-build/features/backlog.feature',
    '/node_modules/@multiagent/ui-kit/run3d/main.jsx',
    '/node_modules/@multiagent/ui-kit/test/x.test.js',
    '/apps/desktop/test/x.test.js',
    '/apps/desktop/scripts/package.js',
    '/apps/desktop/renderer/city3d/main.jsx',
    '/poc/run-3d.html',
  ]) assert.equal(ignored(p), true, `${p} is left out`);
});

test('the asar leaves out the browser app and its copy, and the engine package itself (the host requires its copy)', () => {
  for (const p of ['/apps/web', '/apps/web/renderer/index.html', '/apps/web/renderer/api-http.js', '/node_modules/@multiagent/web/renderer/api-http.js', '/packages/engine/engine/workflow.js']) {
    assert.equal(ignored(p), true, `${p} is left out`);
  }
});

test('the asar keeps the page, the kit, the fronts\' screens and Home cards, the shared package and the copies the host requires', () => {
  for (const p of [
    '/apps/desktop/renderer/index.html',
    '/apps/desktop/host/main.js',
    '/apps/desktop/composition.js',
    '/packages/ui-kit/app.js',
    '/packages/ui-kit/style.css',
    '/packages/ui-kit/views/dashboard/dashboard.js',
    '/fronts/analyser/views/project/project-city.js',
    '/fronts/analyser/views/project/project-city.css',
    '/fronts/build/views/backlog/backlog.js',
    '/fronts/build/build-home.js',
    '/packages/shared/i18n.js',
    '/node_modules/@multiagent/engine/engine/workflow.js',
    '/node_modules/@multiagent/shared/i18n.js',
    '/generated/project-city.js',
    '/workflows/software-development.yaml',
  ]) assert.equal(ignored(p), false, `${p} is shipped`);
});
