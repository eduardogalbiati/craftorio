// #30 on the gate surfaces: a check_environment gate (its record carries `environment`: { reason, dir,
// command, manager?, install? }) says its cause in one line in the interface language at every draw, and
// a choice with a catalog key (`label_key`) reads that key ("Tentar de novo" in pt-BR). The Run screen's
// gate cards redraw when the language changes. Evaluated in a vm sandbox with app.js's esc and the real
// gate-panel.js, as gate-oracle-183.test.js does.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { withI18n } = require('@craftorio/shared/test/i18n-sandbox');
const { pageFile } = require('../../../scripts/source-tree');

const renderer = path.join(__dirname, '..');
const read = (...p) => fs.readFileSync(path.join(...p), 'utf8');
const appSrc = read(renderer, 'app.js');
const gateSrc = read(renderer, 'gate-panel.js');
const runSrc = fs.readFileSync(pageFile(path.join(__dirname, '..', '..', '..'), 'views/run/run.js'), 'utf8');

const DIR = '/repos/widgets';
const CHOICES = [
  { id: 'retry', label: 'Try again', label_key: 'engine.check_environment_retry' },
  { id: 'stop', label: 'Stop the run as failed', label_key: 'engine.check_environment_stop' },
];
const GATE = {
  run_id: 'r1', approval_id: 'a1', step_id: 'check_environment', choices: CHOICES,
  message: `Error: Cannot find module 'left-pad'\n    at Module._resolveFilename (node:internal/modules/cjs/loader:1225:15)`,
  environment: { reason: 'deps_missing', dir: DIR, command: 'npm run check', manager: 'npm', install: 'npm ci' },
};

function sandboxOf(t, lang, extra = {}) {
  const esc = /const esc = \(s\) => [^\n]+/.exec(appSrc)?.[0];
  assert.ok(esc, 'esc not found in app.js: the source moved');
  const sandbox = {
    state: { runs: new Map() },
    document: { querySelector: () => null, querySelectorAll: () => [], getElementById: () => null },
    api: {},
    ...extra,
  };
  sandbox.window = sandbox;
  sandbox.self = sandbox;
  withI18n(sandbox);
  const before = sandbox.I18n.getLanguage();
  sandbox.I18n.setLanguage(lang);
  t.after(() => sandbox.I18n.setLanguage(before));
  vm.createContext(sandbox);
  vm.runInContext(esc, sandbox);
  vm.runInContext(gateSrc, sandbox);
  return sandbox;
}

const labels = (list) => Array.from(list, (c) => String(c.label));

test('#30 gateEnvironmentText: no environment on the gate gives no text', (t) => {
  const s = sandboxOf(t, 'en');
  assert.equal(s.gateEnvironmentText({ step_id: 'check_failed', message: 'x' }), '');
  assert.equal(s.gateEnvironmentText(null), '');
});

test('#30 gateEnvironmentText: npm dependencies missing reads "rode npm ci em <pasta>" in pt-BR', (t) => {
  const s = sandboxOf(t, 'pt-BR');
  assert.equal(s.gateEnvironmentText(GATE), `as dependências do projeto não estão instaladas: rode npm ci em ${DIR}`);
});

test('#30 gateEnvironmentText: a pnpm project names its own install command, not npm ci', (t) => {
  const s = sandboxOf(t, 'pt-BR');
  const text = s.gateEnvironmentText({ ...GATE, environment: { ...GATE.environment, manager: 'pnpm', install: 'pnpm install --frozen-lockfile' } });
  assert.equal(text, `as dependências do projeto não estão instaladas: rode pnpm install --frozen-lockfile em ${DIR}`);
});

test('#30 gateEnvironmentText: a missing command says so in one line', (t) => {
  const s = sandboxOf(t, 'en');
  const text = String(s.gateEnvironmentText({ ...GATE, environment: { reason: 'command_missing', dir: DIR, command: 'make check' } }));
  assert.equal(text.includes('make check'), true, text);
  assert.equal(text.includes('\n'), false, text);
});

test('#30 gateChoices and gateAnswers read label_key in the interface language', (t) => {
  const s = sandboxOf(t, 'pt-BR');
  assert.deepEqual(labels(s.gateChoices(GATE)), ['Tentar de novo', 'Parar a run como falha']);
  assert.deepEqual(labels(s.gateAnswers(GATE)), ['Tentar de novo', 'Parar a run como falha']);
});

test('#30 a choice without label_key keeps its workflow label', (t) => {
  const s = sandboxOf(t, 'pt-BR');
  const gate = { ...GATE, choices: [{ id: 'continue', label: 'Continue to the review anyway' }] };
  assert.deepEqual(labels(s.gateChoices(gate)), ['Continue to the review anyway']);
  assert.deepEqual(labels(s.gateAnswers(gate)), ['Continue to the review anyway']);
});

function drawRunGates(t, lang) {
  const fn = /function renderRunGates\(\) \{[\s\S]*?\n\}/.exec(runSrc)?.[0];
  assert.ok(fn, 'renderRunGates not found in views/run/run.js: the source moved');
  const box = { classList: { toggle() {} }, dataset: {}, innerHTML: '', querySelectorAll: () => [] };
  const s = sandboxOf(t, lang, {
    $: (sel) => (sel === '#run-gates' ? box : null),
    selectedView: () => ({ approvals: new Map([['a1', GATE]]), run: { run_id: 'r1', id: 'r1' } }),
    runLabel: () => 'feature · #30',
    mountGateSides() {},
    paintGateApps() {},
  });
  vm.runInContext(`${fn}\nthis.renderRunGates = renderRunGates;`, s);
  return { s, box };
}

test('#30 Run screen: the check_environment card shows the one-line cause and the translated retry, no stack trace', (t) => {
  const { s, box } = drawRunGates(t, 'pt-BR');
  s.renderRunGates();
  const html = String(box.innerHTML);
  assert.equal(html.includes('data-testid="check-environment-message"'), true);
  assert.equal(html.includes(`rode npm ci em ${DIR}`), true);
  assert.equal(html.includes('Tentar de novo'), true);
  assert.equal(/\bat Module\._resolveFilename/.test(html), false, 'no stack frame in the card');
});

test('#30 Run screen: switching the interface language redraws the gate cards in the new language', (t) => {
  const { s, box } = drawRunGates(t, 'en');
  s.renderRunGates();
  const keyEn = String(box.dataset.key);
  assert.equal(String(box.innerHTML).includes('Try again'), true);
  s.I18n.setLanguage('pt-BR');
  s.renderRunGates();
  assert.notEqual(String(box.dataset.key), keyEn);
  assert.equal(String(box.innerHTML).includes('Tentar de novo'), true);
});
