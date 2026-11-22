// #781: a job that ended settles what a late read of the interview left unended, so no line runs for ever.
const test = require('node:test');
const assert = require('node:assert/strict');
const { analysisPhases } = require('@craftorio/shared/onboarding-model');

const states = (args) => analysisPhases(args).map((p) => p.state);
const interview = (git, files, oracle) => ({ phases: { git: { status: git }, files: { status: files }, oracle: { status: oracle } } });

test('#781 a job done over a read that still said running: the lines are done', () => {
  assert.deepEqual(states({ job: { status: 'done' }, interview: interview('done', 'done', 'running') }), ['done', 'done', 'done']);
  assert.deepEqual(states({ job: { status: 'done' }, interview: interview('running', 'pending', 'pending') }), ['done', 'done', 'done']);
});

test('#781 a job done keeps an Oracle not needed skipped', () => {
  assert.deepEqual(states({ job: { status: 'done' }, interview: interview('done', 'done', 'not-needed') }), ['done', 'done', 'skipped']);
});

test('#781 a job failed over phases all pending: git failed', () => {
  assert.deepEqual(states({ job: { status: 'failed' }, interview: interview('pending', 'pending', 'pending') }), ['failed', 'pending', 'pending']);
});
