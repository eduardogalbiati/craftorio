// #481 (SEC-22), packages/ui-kit/gate-panel.js runAppConfirmHtml: Run App's one-click confirmation of a
// command declared by the repository (.multiagent/local-preview.yaml, localPreview:info source
// 'repo') shows everything that will run: the full command, the install step, the env variables
// (name and value), and marks that it comes from the repository (an element with
// data-source="repo"), so a command a branch slipped in is never confirmed blind.
// Run in a vm sandbox with the app's esc and the catalog, as test/renderer-run-gates.test.js does.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { withI18n } = require('@craftorio/shared/test/i18n-sandbox.js');

const appSrc = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'packages', 'ui-kit', 'app.js'), 'utf8');
const gateSrc = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'packages', 'ui-kit', 'gate-panel.js'), 'utf8');

function loadConfirm() {
  const parts = {
    esc: /const esc = \(s\) => [^\n]+/.exec(appSrc)?.[0],
    runAppCommandHtml: /const runAppCommandHtml = [^\n]+/.exec(gateSrc)?.[0],
    runAppInstallHtml: /function runAppInstallHtml\([^)]*\) \{[\s\S]*?\n\}/.exec(gateSrc)?.[0],
    runAppConfirmHtml: /function runAppConfirmHtml\([^)]*\) \{[\s\S]*?\n\}/.exec(gateSrc)?.[0],
  };
  for (const [name, code] of Object.entries(parts)) assert.ok(code, `${name} not found: the source moved`);
  const sandbox = {};
  vm.createContext(withI18n(sandbox));
  vm.runInContext(`${Object.values(parts).join('\n')}\nthis.runAppConfirmHtml = runAppConfirmHtml;`, sandbox);
  return sandbox.runAppConfirmHtml;
}

const CFG = { install: 'npm ci --ignore-scripts', command: 'npm run dev -- --port 5173 --strictPort', url: 'http://localhost:5173', env: { API_URL: 'http://collector.example', DEBUG_LEVEL: 'verbose' } };
const INFO = {
  config: CFG, source: 'repo', from: '.multiagent/local-preview.yaml', confirmed: false, changed: false,
  project: { id: 'p1', name: 'Demo' }, suggestion: null, install: { state: 'will-run', text: 'Install will run: no install recorded' },
};

test('#481 Run App confirmation: the full command and the install step are shown', () => {
  const html = loadConfirm()(INFO, CFG);
  assert.equal(html.includes('npm run dev -- --port 5173 --strictPort'), true);
  assert.equal(html.includes('npm ci --ignore-scripts'), true);
});

test('#481 Run App confirmation: every env variable is shown with its value', () => {
  const html = loadConfirm()(INFO, CFG);
  assert.equal(html.includes('API_URL'), true, 'env name');
  assert.equal(html.includes('http://collector.example'), true, 'env value');
  assert.equal(html.includes('DEBUG_LEVEL'), true);
  assert.equal(html.includes('verbose'), true);
});

test('#481 Run App confirmation: a command from the repository is marked data-source="repo"', () => {
  const html = loadConfirm()(INFO, CFG);
  assert.match(html, /data-source="repo"/);
  const fromWorkflow = loadConfirm()({ ...INFO, source: 'workflow', from: 'the workflow (local_preview)' }, CFG);
  assert.doesNotMatch(fromWorkflow, /data-source="repo"/);
});
