// waitReason's daytime rule (#241 review): the kinds that publish or are hard to reverse wait for the
// owner's click while the Night watch is off; under the watch, its permissions decide.
const test = require('node:test');
const assert = require('node:assert');
const { waitReason } = require('../src/agent-inbox');
const { CONFIRM_KINDS: PO_CONFIRM } = require('../src/product-owner');
const { CONFIRM_KINDS: SUP_CONFIRM } = require('../src/supervisor-chat');

test('by day, a confirm kind waits and another kind runs at once', () => {
  assert.match(waitReason('workflow.commit', {}, { confirmKinds: SUP_CONFIRM }), /owner's click/);
  assert.match(waitReason('issue.file', {}, { confirmKinds: PO_CONFIRM }), /owner's click/);
  assert.equal(waitReason('roadmap.add', {}, { confirmKinds: PO_CONFIRM }), null);
});

test('under the Night watch, an allowed confirm kind runs alone', () => {
  assert.equal(waitReason('dispatch.restart', {}, { confirmKinds: SUP_CONFIRM, watch: { active: true }, allowed: ['dispatch'] }), null);
});

test('the confirm lists hold the outward-facing kinds and none of the roadmap kinds', () => {
  assert.deepEqual([...PO_CONFIRM, ...SUP_CONFIRM].sort(), ['dispatch.restart', 'issue.file', 'issue.update', 'run.stop', 'skill.restore', 'workflow.commit', 'workflow.restore']);
});
