// #781: OnboardingModel.analysisPhases, the three lines of the wizard's analysis from the profile job and the
// interview's state (packages/shared/onboarding-model.js). Acceptance tests, written before the code.
//
// The contract these tests assume: analysisPhases({ job, interview }), job: the onboarding's profile job; interview:
// workflowInterviewState's answer or null →
//   [{ id: 'git', state, found }, { id: 'files', state, found }, { id: 'oracle', state, reading, since }],
// always those three, in this order. state is an ActivityLine state: the engine's status maps 1:1, except
// not-needed → skipped.
// - job waiting / absent, no interview: all pending.
// - job running, interview null or no phases (the timing gap): git running, files and oracle pending.
// - job done, no phases (a resumed wizard, a restarted engine): git and files done; oracle skipped when
//   job.simulated, else done.
// - job failed: the phase that was running is failed (git when none was known); later ones stay pending.
const test = require('node:test');
const assert = require('node:assert/strict');

const load = () => require('@multiagent/shared/onboarding-model');
const phases = (args) => load().analysisPhases(args);
const states = (args) => phases(args).map((p) => p.state);

const GIT_FOUND = { commits: 312, merges: 41, tags: 8, authors: 3 };
const FILES_FOUND = { languages: ['rust'], testCommand: 'cargo test', ci: 'release' };
const SINCE = '2026-11-05T10:00:00.000Z';
const interview = (git, files, oracle) => ({
  running: null,
  error: null,
  phases: { git: { status: git }, files: { status: files }, oracle: { status: oracle } },
});

test('#781 always the three phases, git, files and oracle, in this order', () => {
  assert.deepEqual(phases({ job: null, interview: null }).map((p) => p.id), ['git', 'files', 'oracle']);
  assert.deepEqual(phases({ job: { status: 'done' }, interview: interview('done', 'done', 'done') }).map((p) => p.id), ['git', 'files', 'oracle']);
});

test('#781 a job waiting or absent, with no interview: all pending', () => {
  assert.deepEqual(states({ job: { status: 'waiting' }, interview: null }), ['pending', 'pending', 'pending']);
  assert.deepEqual(states({ job: undefined, interview: null }), ['pending', 'pending', 'pending']);
});

test('#781 a job running before the interview answered: git running, the rest pending', () => {
  assert.deepEqual(states({ job: { status: 'running' }, interview: null }), ['running', 'pending', 'pending']);
  assert.deepEqual(states({ job: { status: 'running' }, interview: { running: null, error: null } }), ['running', 'pending', 'pending']);
  assert.deepEqual(states({ job: { status: 'running' }, interview: { running: null, error: null, phases: null } }), ['running', 'pending', 'pending']);
});

test('#781 the engine\'s statuses map one to one', () => {
  assert.deepEqual(states({ job: { status: 'running' }, interview: interview('done', 'running', 'pending') }), ['done', 'running', 'pending']);
  assert.deepEqual(states({ job: { status: 'running' }, interview: interview('done', 'done', 'running') }), ['done', 'done', 'running']);
  assert.deepEqual(states({ job: { status: 'failed' }, interview: interview('done', 'done', 'failed') }), ['done', 'done', 'failed']);
});

test('#781 an Oracle not needed is skipped', () => {
  assert.deepEqual(states({ job: { status: 'done' }, interview: interview('done', 'done', 'not-needed') }), ['done', 'done', 'skipped']);
});

test('#781 what the phases found, and what the Oracle reads since when, come through', () => {
  const answer = {
    running: { since: SINCE, items: 3, last: 'Reading src/main.rs' },
    error: null,
    phases: {
      git: { status: 'done', found: GIT_FOUND },
      files: { status: 'done', found: FILES_FOUND },
      oracle: { status: 'running', since: SINCE, reading: 'Reading src/main.rs' },
    },
  };
  const [git, files, oracle] = phases({ job: { status: 'running' }, interview: answer });
  assert.deepEqual(git.found, GIT_FOUND);
  assert.deepEqual(files.found, FILES_FOUND);
  assert.equal(oracle.reading, 'Reading src/main.rs');
  assert.equal(oracle.since, SINCE);
});

test('#781 a job done with no phases (a resumed wizard): git and files done, the Oracle done', () => {
  assert.deepEqual(states({ job: { status: 'done' }, interview: null }), ['done', 'done', 'done']);
  assert.deepEqual(states({ job: { status: 'done', simulated: false }, interview: { running: null, error: null } }), ['done', 'done', 'done']);
});

test('#781 a simulated job done with no phases: the Oracle skipped', () => {
  assert.deepEqual(states({ job: { status: 'done', simulated: true }, interview: null }), ['done', 'done', 'skipped']);
});

test('#781 a job failed: the phase that was running fails, the later ones stay pending', () => {
  assert.deepEqual(states({ job: { status: 'failed' }, interview: interview('done', 'running', 'pending') }), ['done', 'failed', 'pending']);
  assert.deepEqual(states({ job: { status: 'failed' }, interview: interview('running', 'pending', 'pending') }), ['failed', 'pending', 'pending']);
  assert.deepEqual(states({ job: { status: 'failed' }, interview: interview('done', 'done', 'running') }), ['done', 'done', 'failed']);
});

test('#781 a job failed with no phase known: git fails, the rest stay pending', () => {
  assert.deepEqual(states({ job: { status: 'failed' }, interview: null }), ['failed', 'pending', 'pending']);
});
