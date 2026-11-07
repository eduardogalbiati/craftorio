// #799, internals of the Resume from step… dialog's input selects (packages/ui-kit/resume-dialog.js):
// a definition without labels reads as WorkflowInputs says, and a value an override ran on, outside
// the input's list, leads the select and only a different choice reaches the new run.
const test = require('node:test');
const assert = require('node:assert/strict');
const { textOf } = require('./mini-dom');
const { loadPage, settle } = require('./agent-chat-page-harness');

const DEF = { type: 'string', enum: ['claude-opus-5-5', 'claude-fable-5-1'], default: 'claude-opus-5-5' };
// a workflow whose effort list has no `default`: a blank override still ran on the provider's default
const EFFORT = { type: 'string', enum: ['low', 'high'], default: 'low', options: { low: 'Low', high: 'High' } };
const OPTIONS = (value, key, def) => ({
  runId: 'r-799', workflow: 'Feature', file: 'feature.yaml', status: 'failed', active: false, mock: true,
  steps: [{ id: 'develop', type: 'agent', gate: false, visits: 1, blockedBy: null, confirm: null }],
  stoppedAt: 'develop', failedStep: 'develop', suggested: 'develop', limit: null, worktree: null, sessions: [], handoffs: [], paused: null, turns: [],
  inputs: value === undefined ? {} : { [key]: value }, inputDefs: { [key]: def },
});

async function openDialog(value, key = 'developer_model', def = DEF) {
  const page = await loadPage({ api: { resumeOptions: async () => OPTIONS(value, key, def), resumeRun: async () => ({ runId: 'r-new' }) } });
  await page.sandbox.openResumeDialog('r-799');
  await settle();
  return { page, select: page.$(`[data-testid="resume-input-${key}"]`) };
}
async function pressResume(page) {
  page.$('#btn-resume-yes').click();
  await settle(20);
  return JSON.parse(JSON.stringify(page.callsTo('resumeRun')[0]));
}

test('#799 resume dialog: a definition without labels never shows a slug', async () => {
  const { page, select } = await openDialog('claude-opus-5-5');
  assert.equal(textOf(page.$('label[for="resume-input-developer_model"]')), 'Developer model');
  assert.deepEqual(Array.from(select.querySelectorAll('option')).map(textOf), ['Claude opus 5 5', 'Claude fable 5 1']);
});

test('#799 resume dialog: a value outside the list leads the select and, kept, changes nothing', async () => {
  const { page, select } = await openDialog('gpt-5');
  assert.equal(select.value, 'gpt-5');
  assert.deepEqual(Array.from(select.querySelectorAll('option')).map((o) => o.getAttribute('value')), ['gpt-5', ...DEF.enum]);
  assert.equal((await pressResume(page))[6], undefined);
});

test('#799 resume dialog: a choice of the list over that value reaches the new run', async () => {
  const { page, select } = await openDialog('gpt-5');
  select.value = 'claude-opus-5-5';
  assert.deepEqual((await pressResume(page))[6], { developer_model: 'claude-opus-5-5' });
});

test('#799 resume dialog: a blank effort reads Default when the list has none, and kept changes nothing', async () => {
  const { page, select } = await openDialog('default', 'developer_effort', EFFORT);
  assert.equal(select.value, 'default');
  assert.deepEqual(Array.from(select.querySelectorAll('option')).map(textOf), ['Default', 'Low', 'High']);
  assert.equal((await pressResume(page))[6], undefined);
});

test('#799 resume dialog: a choice over that Default reaches the new run', async () => {
  const { page, select } = await openDialog('default', 'developer_effort', EFFORT);
  select.value = 'high';
  assert.deepEqual((await pressResume(page))[6], { developer_effort: 'high' });
});

test('#799 resume dialog: an input the run has no value for changes nothing unless the owner picks one', async () => {
  const { page } = await openDialog(undefined, 'developer_effort', { type: 'string', enum: ['low', 'high'] });
  assert.equal((await pressResume(page))[6], undefined);
});

test('#799 resume dialog: an input the run has no value for reads Not set, ahead of the list', async () => {
  const { select } = await openDialog(undefined, 'developer_effort', EFFORT);
  assert.equal(select.value, '');
  assert.deepEqual(Array.from(select.querySelectorAll('option')).map(textOf), ['Not set', 'Low', 'High']);
});

test('#799 resume dialog: the first value of the list can be chosen over Not set', async () => {
  const { page, select } = await openDialog(undefined, 'developer_effort', EFFORT);
  select.value = 'low';
  assert.deepEqual((await pressResume(page))[6], { developer_effort: 'low' });
});
