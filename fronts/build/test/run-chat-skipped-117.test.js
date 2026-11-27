// #117 acceptance tests (written before the code): a skipped Rule checks step (rule_check, step type
// `check`, output status `skipped`) reads "Skipped" (pt-BR "Pulado") in the run's Chat, never
// "Passed" / "Passou".
// Seams: RunChatModel (the orchestrator message of a step with no agent, #795) and the label runchat.js
// draws for the message's state (its orchState, read from the page script as the other run chat tests
// read its functions), in the interface language.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const I18n = require('@craftorio/shared/i18n');
const { RunChatModel } = require('../views/runchat/run-chat-model');

const T = (m, s = 0) => new Date(Date.UTC(2026, 10, 27, 12, m, s)).toISOString();
test.afterEach(() => I18n.setLanguage('en'));

function skippedRuleCheck() {
  const m = new RunChatModel();
  for (const ev of [
    { seq: 0, type: 'workflow.started', run_id: 'r1', workflow: 'feature', ts: T(0) },
    { seq: 1, type: 'step.started', step_id: 'rule_check', visit: 1, step_type: 'check', agent: null, ts: T(1) },
    { seq: 2, type: 'log', level: 'info', kind: 'check', step_id: 'rule_check', status: 'skipped', message: 'rule_check: Rule checks skipped: the project has no check command.', ts: T(1, 1) },
    { seq: 3, type: 'step.finished', step_id: 'rule_check', visit: 1, ts: T(1, 2), output: { kind: 'check', status: 'skipped', command: '', findings: [], message: 'Rule checks skipped: the project has no check command.', round: 1 } },
  ]) m.apply(ev);
  const [it] = m.items.filter((i) => i.kind === 'orchestrator' && i.step === 'rule_check');
  assert.ok(it, 'the run chat has an orchestrator message for rule_check');
  return it;
}

// the state pill's text runchat.js draws for an orchestrator message's state
function pillText(state, lang) {
  const pageFile = require('../../../scripts/source-tree').pageFile(path.join(__dirname, '..', '..', '..'), 'views/runchat/runchat.js');
  const src = fs.readFileSync(pageFile, 'utf8');
  const line = /const orchState = [^\n]*/.exec(src)?.[0];
  assert.ok(line, 'runchat.js names an orchestrator message\'s state with orchState');
  I18n.setLanguage(lang);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const sandbox = { t: (k, p) => I18n.t(k, p), esc, I18n, __state: state };
  vm.createContext(sandbox);
  return String(vm.runInContext(`${line}\norchState(__state)`, sandbox));
}

test('#117 run chat: a skipped Rule checks step is not shown as passed', () => {
  assert.notEqual(skippedRuleCheck().state, 'passed');
});

test('#117 run chat (en): a skipped Rule checks step reads "Skipped", not "Passed"', () => {
  const label = pillText(skippedRuleCheck().state, 'en');
  assert.match(label, /Skipped/);
  assert.doesNotMatch(label, /Passed/);
});

test('#117 run chat (pt-BR): a skipped Rule checks step reads "Pulado", not "Passou"', () => {
  const label = pillText(skippedRuleCheck().state, 'pt-BR');
  assert.match(label, /Pulado/);
  assert.doesNotMatch(label, /Passou/);
});
