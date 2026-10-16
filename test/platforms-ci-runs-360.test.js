// #360 CI runs through the platform adapters (ciRunsCommand / parseCiRuns) and src/oracle-platform.js.
const test = require('node:test');
const assert = require('node:assert/strict');

const github = () => require('../src/shared/platforms/github');
const gitlab = () => require('../src/shared/platforms/gitlab');
const oraclePlatform = () => require('../src/oracle-platform');

const GH_RUNS = JSON.stringify([
  { databaseId: 101, name: 'CI', status: 'completed', conclusion: 'success', createdAt: '2026-10-01T10:00:00Z', updatedAt: '2026-10-01T10:05:00Z', url: 'https://github.com/o/r/actions/runs/101' },
  { databaseId: 102, name: 'CI', status: 'in_progress', conclusion: '', createdAt: '2026-10-02T10:00:00Z', updatedAt: '2026-10-02T10:01:00Z', url: 'https://github.com/o/r/actions/runs/102' },
]);
const GL_PIPELINES = JSON.stringify([
  { id: 201, ref: 'main', status: 'success', created_at: '2026-10-01T10:00:00Z', updated_at: '2026-10-01T10:05:00Z', web_url: 'https://gitlab.com/g/p/-/pipelines/201' },
]);

test('#360 github ciRunsCommand lists runs of the target repo with gh', () => {
  const cmd = github().ciRunsCommand({ target: 'o/r', limit: 20 });
  assert.equal(cmd.cli, 'gh');
  for (const a of ['run', 'list', '--repo', 'o/r']) assert.ok(cmd.args.includes(a), a);
});

test('#360 github parseCiRuns reads gh run list JSON into items with id and status', () => {
  const runs = github().parseCiRuns(GH_RUNS);
  assert.equal(runs.length, 2);
  assert.equal(String(runs[0].id), '101');
  assert.equal(typeof runs[0].status, 'string');
  assert.equal(runs[0].url, 'https://github.com/o/r/actions/runs/101');
});

test('#360 github parseCiRuns gives [] for empty or invalid text', () => {
  assert.deepEqual(github().parseCiRuns(''), []);
  assert.deepEqual(github().parseCiRuns('not json'), []);
});

test('#360 gitlab ciRunsCommand calls the pipelines API with glab', () => {
  const cmd = gitlab().ciRunsCommand({ target: 'g/p', limit: 20 });
  assert.equal(cmd.cli, 'glab');
  assert.ok(cmd.args.includes('api'));
  assert.ok(cmd.args.some((a) => String(a).includes('pipelines')));
});

test('#360 gitlab parseCiRuns reads pipelines JSON into items with id and status', () => {
  const runs = gitlab().parseCiRuns(GL_PIPELINES);
  assert.equal(runs.length, 1);
  assert.equal(String(runs[0].id), '201');
  assert.equal(runs[0].status, 'success');
  assert.equal(runs[0].url, 'https://gitlab.com/g/p/-/pipelines/201');
});

test('#360 gitlab parseCiRuns gives [] for empty or invalid text', () => {
  assert.deepEqual(gitlab().parseCiRuns(''), []);
  assert.deepEqual(gitlab().parseCiRuns('not json'), []);
});

test('#360 oracle-platform delegates ciRunsCommand and ciRunsResult to the adapter', () => {
  const op = oraclePlatform();
  assert.equal(op.ciRunsCommand('github', { target: 'o/r', limit: 5 }).cli, 'gh');
  assert.equal(op.ciRunsCommand('gitlab', { target: 'g/p', limit: 5 }).cli, 'glab');
  assert.equal(String(op.ciRunsResult('github', GH_RUNS)[0].id), '101');
  assert.equal(String(op.ciRunsResult('gitlab', GL_PIPELINES)[0].id), '201');
});
