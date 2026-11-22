// software-development whole runs in mock mode (#305: one theme per slow file): the language skills
// the test writer and the builder load (#340). A single `language` loads that language's skills as
// before; several ("js,rust") load the skills of each language whose files the run changed, so a
// JS-only change never carries the Rust skills. A simulated run has no worktree: its changes are the
// developer's files_changed (the mock reports src/auth/login.ts; mockSequences.files_changed:
// [[...files of visit 1], ...] overrides it).
// #630: software-development is feature.yaml (remote), tests first: the test writer's persistent
// session starts at acceptance_tests, before develop changed any file, so it loads the skills of
// every listed language; the builder's first turn (build) comes after develop and still filters.
// #737: the five runs are independent (no worktree, each its own runsDir): they run concurrently, so
// the file stays within the integration tier's ~30 s budget.
const { describe, test } = require('node:test');
const assert = require('node:assert/strict');

process.env.CRAFTORIO_MOCK_DELAY_SCALE = '0.02';
const { runSoftwareDevelopment } = require('../engine-helpers');

const PASSING = { verdict: ['approved'], preview_status: ['success'], tests_status: ['pass'], suite: { suite: ['pass'] } };
const firstPrompt = (events, step) => (events.find((e) => e.type === 'session.message_sent' && e.step_id === step) || {}).prompt || '';
const loaded = (prompt) => [...prompt.matchAll(/<skill name="((?:unit-test-writer|e2e-test-writer|build-audit)-[a-z]+)"/g)].map((m) => m[1]).sort();
const BOTH = ['e2e-test-writer-js', 'e2e-test-writer-rust', 'unit-test-writer-js', 'unit-test-writer-rust'];

async function skillsFor(inputs, mockSequences = {}) {
  const { events, finished } = await runSoftwareDevelopment({
    inputs: { unit_tests: 'write_and_run', e2e_tests: 'write', ...inputs },
    mockSequences: { ...PASSING, ...mockSequences },
  });
  assert.equal(finished.status, 'success', finished.error);
  return { test: loaded(firstPrompt(events, 'acceptance_tests')), build: loaded(firstPrompt(events, 'build')) };
}

describe('language skills (#340)', { concurrency: true }, () => {
  test('language: a single value loads that language\'s skills, whatever files changed (js, as today; rust)', { timeout: 240000 }, async () => {
    const [js, rust] = await Promise.all([skillsFor({ language: 'js' }), skillsFor({ language: 'rust' })]);
    assert.deepEqual(js.test, ['e2e-test-writer-js', 'unit-test-writer-js']);
    assert.deepEqual(js.build, ['build-audit-js']);

    assert.deepEqual(rust.test, ['e2e-test-writer-rust', 'unit-test-writer-rust']);
    assert.deepEqual(rust.build, ['build-audit-rust']);
  });

  test('language "js,rust": a run that changes only JS/TS files: the builder loads only the JS skills, the test writer (before any change) both', { timeout: 120000 }, async () => {
    const r = await skillsFor({ language: 'js,rust' });
    assert.deepEqual(r.test, BOTH); // written before any change: every listed language
    assert.deepEqual(r.build, ['build-audit-js']);
  });

  test('language "js,rust": a run that changes JS and Rust files loads the skills of both', { timeout: 120000 }, async () => {
    const r = await skillsFor({ language: 'js,rust' }, { files_changed: [['src/app.js', 'crates/core/src/lib.rs']] });
    assert.deepEqual(r.test, BOTH);
    assert.deepEqual(r.build, ['build-audit-js', 'build-audit-rust']);
  });

  test('language "js,rust": a run that changes only Rust files: the builder loads only the Rust skills, the test writer (before any change) both', { timeout: 120000 }, async () => {
    const r = await skillsFor({ language: 'js,rust' }, { files_changed: [['crates/core/src/lib.rs', 'crates/core/tests/api.rs']] });
    assert.deepEqual(r.test, BOTH); // written before any change: every listed language
    assert.deepEqual(r.build, ['build-audit-rust']);
  });
});
