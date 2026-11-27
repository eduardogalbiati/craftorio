// #124 internals: the label the engine records with a gate answer the supervisor took or held back
// (gates.js gateAnswerLabel, also used by requestApproval for the buttons): a choice's own label with its
// catalog key, an Approve / Reject gate's own button text, or the catalog's Approve / Reject keys. The label
// is the workflow's (English) text; the screens translate it from label_key.
const test = require('node:test');
const assert = require('node:assert/strict');
const I18n = require('@craftorio/shared/i18n');
const { methods: gates } = require('../../engine/run/gates');

test.afterEach(() => I18n.setLanguage('en'));

const run = (vars = {}) => ({ ...gates, ctx: { inputs: {}, vars, steps: {}, bare: true }, emitEvent() {} });
const label = (step, answer, vars) => JSON.parse(JSON.stringify(run(vars).gateAnswerLabel(step, answer)));

test('#124 gateAnswerLabel: a choice gives its label and its catalog key', () => {
  const step = { id: 'test_failed', choices: [{ id: 'continue', label: 'Continue to the build anyway', label_key: 'engine.test_failed_continue' }, { id: 'stop', label: 'Stop the run', label_key: 'engine.test_failed_stop' }] };
  assert.deepEqual(label(step, 'stop'), { label: 'Stop the run', label_key: 'engine.test_failed_stop' });
});

test('#124 gateAnswerLabel: a choice without a key gives its rendered label only', () => {
  const step = { id: 'ship', choices: [{ id: 'later', label: 'Ship on {{ vars.day }}' }] };
  assert.deepEqual(label(step, 'later', { day: 'Monday' }), { label: 'Ship on Monday' });
});

test('#124 gateAnswerLabel: an Approve / Reject gate without its own text gives the catalog keys, in English whatever the language', () => {
  I18n.setLanguage('pt-BR');
  assert.deepEqual(label({ id: 'review' }, 'approve'), { label: 'Approve', label_key: 'common.approve' });
  assert.deepEqual(label({ id: 'review' }, 'reject'), { label: 'Reject', label_key: 'gate_panel.reject' });
});

test("#124 gateAnswerLabel: a gate's own approve / reject text is kept, without a key", () => {
  const step = { id: 'review', approve_label: 'Merge it', reject_label: 'Send it back' };
  assert.deepEqual(label(step, 'approve'), { label: 'Merge it' });
  assert.deepEqual(label(step, 'reject'), { label: 'Send it back' });
});

test('#124 gateAnswerLabel: an engine-made (raw) gate ignores its texts and uses the catalog keys', () => {
  const step = { id: 'check_environment', raw: true, approve_label: 'Merge it' };
  assert.deepEqual(label(step, 'approve'), { label: 'Approve', label_key: 'common.approve' });
});
