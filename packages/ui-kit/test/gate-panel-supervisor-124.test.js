// #124 on the gate surfaces (packages/ui-kit/gate-panel.js): the Run screen's step card says when the
// supervisor on call answered a gate alone (supervisorAnswerHtml: who, the answer's label in the interface
// language, why), and a gate the supervisor could not cross shows the answer it would have taken under the
// workflow's recommendation (heldSupervisorAnswerHtml, through gateCardHtml). Evaluated in a vm sandbox with
// app.js's esc and the real gate-panel.js, as gate-environment-30.test.js does; only strings are compared.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { withI18n } = require('@craftorio/shared/test/i18n-sandbox');

const renderer = path.join(__dirname, '..');
const appSrc = fs.readFileSync(path.join(renderer, 'app.js'), 'utf8');
const gateSrc = fs.readFileSync(path.join(renderer, 'gate-panel.js'), 'utf8');

function sandboxOf(t, lang) {
  const esc = /const esc = \(s\) => [^\n]+/.exec(appSrc)?.[0];
  assert.ok(esc, 'esc not found in app.js: the source moved');
  const sandbox = {
    state: { runs: new Map() },
    document: { querySelector: () => null, querySelectorAll: () => [], getElementById: () => null },
    api: {},
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

const count = (html, re) => (html.match(re) || []).length;
const REASON = 'The same test failed in both rounds';

test('#124 supervisorAnswerHtml: a step nobody or the owner answered shows nothing', (t) => {
  const s = sandboxOf(t, 'en');
  assert.equal(s.supervisorAnswerHtml({ id: 'test_failed' }), '');
  assert.equal(s.supervisorAnswerHtml({ id: 'test_failed', supervisor: null }), '');
  assert.equal(s.supervisorAnswerHtml(null), '');
});

test('#124 supervisorAnswerHtml: a choice the supervisor took says who, the label and why, with its test id and step', (t) => {
  const s = sandboxOf(t, 'en');
  const html = s.supervisorAnswerHtml({ id: 'test_failed', supervisor: { choice: 'stop', by: 'supervisor', reason: REASON, label: 'Stop the run', label_key: 'engine.test_failed_stop' } });
  assert.equal(count(html, /data-testid="gate-supervisor-answer"/g), 1);
  assert.match(html, /data-step="test_failed"/);
  assert.match(html, /The supervisor answered this gate with &quot;Stop the run&quot;/);
  assert.equal(html.includes(REASON), true);
});

test('#124 supervisorAnswerHtml: in pt-BR the label reads its catalog key, not the English text the engine recorded', (t) => {
  const s = sandboxOf(t, 'pt-BR');
  const html = s.supervisorAnswerHtml({ id: 'test_failed', supervisor: { choice: 'stop', by: 'supervisor', reason: REASON, label: 'Stop the run', label_key: 'engine.test_failed_stop' } });
  assert.match(html, /O supervisor respondeu este gate com &quot;Parar a run&quot;/);
  assert.equal(html.includes('Stop the run'), false);
});

test('#124 supervisorAnswerHtml: an Approve / Reject gate shows Aprovar / Rejeitar in pt-BR, never undefined', (t) => {
  const s = sandboxOf(t, 'pt-BR');
  const yes = s.supervisorAnswerHtml({ id: 'review', supervisor: { approved: true, by: 'supervisor', label: 'Approve', label_key: 'common.approve' } });
  const no = s.supervisorAnswerHtml({ id: 'review', supervisor: { approved: false, by: 'supervisor', label: 'Reject', label_key: 'gate_panel.reject' } });
  assert.match(yes, /&quot;Aprovar&quot;/);
  assert.match(no, /&quot;Rejeitar&quot;/);
  assert.equal(yes.includes('undefined') || no.includes('undefined'), false);
});

test("#124 supervisorAnswerHtml: a workflow's own button text without a key is shown as written", (t) => {
  const s = sandboxOf(t, 'pt-BR');
  const html = s.supervisorAnswerHtml({ id: 'ship', supervisor: { choice: 'later', by: 'supervisor', label: 'Ship it tomorrow' } });
  assert.match(html, /&quot;Ship it tomorrow&quot;/);
});

test('#124 supervisorAnswerHtml: an older event without a label reads the bundled gate key, else the answer id', (t) => {
  const s = sandboxOf(t, 'pt-BR');
  const bundled = s.supervisorAnswerHtml({ id: 'test_failed', supervisor: { choice: 'continue', by: 'supervisor' } });
  const unknown = s.supervisorAnswerHtml({ id: 'my_gate', supervisor: { choice: 'park', by: 'supervisor' } });
  assert.match(bundled, /&quot;Ir para o build mesmo assim&quot;/);
  assert.match(unknown, /&quot;park&quot;/);
  assert.equal(bundled.includes('undefined') || unknown.includes('undefined'), false);
});

test('#124 supervisorAnswerHtml: the reason and the step id are escaped', (t) => {
  const s = sandboxOf(t, 'en');
  const html = s.supervisorAnswerHtml({ id: 'gate"x', supervisor: { choice: 'stop', by: 'supervisor', reason: '<img src=x onerror=1>' } });
  assert.equal(html.includes('<img'), false);
  assert.equal(html.includes('gate"x'), false);
});

const brief = (recommendation) => ({ headline: 'The tests failed', recommendation });
const WF_REC = { source: 'workflow', answer: 'stop', label: 'Stop the run', reason: 'the change is not tested green' };
const HELD = { answer: 'continue', label: 'Continue to the build anyway', label_key: 'engine.test_failed_continue', reason: 'The failing test is outside the change', answered: false };

test("#124 gateCardHtml: a held supervisor answer shows under the workflow's recommendation, with who would have taken it and why", (t) => {
  const s = sandboxOf(t, 'en');
  const html = s.gateCardHtml('r1', { step_id: 'test_failed', choices: [], brief: brief(WF_REC), supervisor: HELD }, '<p>full</p>');
  assert.equal(html.includes('the change is not tested green'), true, "the workflow's recommendation stays");
  assert.equal(count(html, /data-testid="gate-supervisor-recommendation"/g), 1);
  assert.match(html, /Recommended by the supervisor:/);
  assert.equal(html.includes('Continue to the build anyway'), true);
  assert.equal(html.includes('The failing test is outside the change'), true);
  assert.equal(html.indexOf('the change is not tested green') < html.indexOf('Recommended by the supervisor:'), true, 'under the recommendation');
});

test('#124 gateCardHtml: the held answer reads in pt-BR', (t) => {
  const s = sandboxOf(t, 'pt-BR');
  const html = s.gateCardHtml('r1', { step_id: 'test_failed', choices: [], brief: brief(WF_REC), supervisor: HELD }, '<p>full</p>');
  assert.match(html, /Recomendado pelo supervisor:/);
  assert.equal(html.includes('Ir para o build mesmo assim'), true);
});

test('#124 gateCardHtml: a diagnosis the supervisor did not hold back (no answered:false) adds no held answer', (t) => {
  const s = sandboxOf(t, 'en');
  const diag = { recommend: 'stop', recommendation: 'Stop: the suite is red' };
  const html = s.gateCardHtml('r1', { step_id: 'test_failed', choices: [], brief: brief(WF_REC), supervisor: diag }, '<p>full</p>');
  assert.equal(count(html, /data-testid="gate-supervisor-recommendation"/g), 0);
  assert.equal(html.includes('Recommended by the supervisor:'), false);
});

test("#124 gateCardHtml: the supervisor's own recommendation is marked once, not doubled by a held answer", (t) => {
  const s = sandboxOf(t, 'en');
  const rec = { source: 'supervisor', answer: 'continue', label: 'Continue to the build anyway', reason: 'outside the change' };
  const html = s.gateCardHtml('r1', { step_id: 'test_failed', choices: [], brief: brief(rec), supervisor: HELD }, '<p>full</p>');
  assert.equal(count(html, /data-testid="gate-supervisor-recommendation"/g), 1);
});
