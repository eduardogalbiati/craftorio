// #723: the #353 snapshot (test/simulated-run-events-353.js) keeps what simulation decides, not what
// this checkout contains: the test-id check's list of missing ids (output kind `test_ids`, its
// `message` and `missing`) follows the E2E step definitions and the renderer, so the projection
// replaces both with `<repo-dependent>` and keeps the rest of the output. Other outputs keep their
// message. Seam: the helper's `project(event, dirs)`.
const test = require('node:test');
const assert = require('node:assert/strict');
const { project } = require('./simulated-run-events-353');

const testIdsFinished = (missingIds) => ({
  type: 'step.finished',
  step_id: 'testid_check',
  seq: 78,
  ts: '2026-11-02T14:18:48.000Z',
  output: {
    kind: 'test_ids',
    status: 'missing',
    round: 2,
    steps: ['features/steps'],
    renderer: ['src/renderer/'],
    message: `${missingIds.length} test id(s) the E2E step definitions use are not in src/renderer/:\n${missingIds.map((id) => `- \`${id}\``).join('\n')}`,
    missing: missingIds.map((id) => ({ id, files: ['features/steps/app.steps.js'] })),
  },
});

test('#723 a test_ids output keeps its status, round and folders and drops the repository-dependent list', () => {
  const out = project(testIdsFinished(['login-screen', 'account-chip']), []);
  assert.equal(out.type, 'step.finished');
  assert.equal(out.step_id, 'testid_check');
  assert.equal(out.output.message, '<repo-dependent>');
  assert.equal(out.output.missing, '<repo-dependent>');
  assert.equal(out.output.kind, 'test_ids');
  assert.equal(out.output.status, 'missing');
  assert.equal(out.output.round, 2);
  assert.deepEqual(out.output.steps, ['features/steps']);
  assert.deepEqual(out.output.renderer, ['src/renderer/']);
});

test('#723 two checkouts with different missing test ids give the same snapshot entry', () => {
  const a = project(testIdsFinished(['login-screen']), []);
  const b = project(testIdsFinished(['login-screen', 'account-chip', 'wizard-workflow-why']), []);
  assert.equal(JSON.stringify(a), JSON.stringify(b));
});

test('#723 an output of another kind keeps its message', () => {
  const out = project({ type: 'step.finished', step_id: 'lint', output: { kind: 'check', status: 'ok', message: '3 files checked' } }, []);
  assert.equal(out.output.message, '3 files checked');
  assert.equal(out.output.kind, 'check');
});

test('#723 an output without a kind, or not an object, is projected unchanged', () => {
  assert.equal(project({ type: 'step.finished', step_id: 's', output: { message: 'done', missing: ['x'] } }, []).output.message, 'done');
  assert.deepEqual(project({ type: 'step.finished', step_id: 's', output: { message: 'done', missing: ['x'] } }, []).output.missing, ['x']);
  assert.equal(project({ type: 'step.finished', step_id: 's', output: 'plain text' }, []).output, 'plain text');
  assert.equal(project({ type: 'step.finished', step_id: 's', output: null }, []).output, null);
});
