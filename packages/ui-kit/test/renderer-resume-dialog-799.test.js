// #799: the Resume from step… dialog (packages/ui-kit/resume-dialog.js) after a provider limit: the
// stopped step preselected, the developer's model and effort changeable for the new run, and the
// limit note saying the limit and what each agent's next turn re-reads.
//
// Acceptance tests written before the code, through the whole page
// (test/agent-chat-page-harness.js), with a fake api.resumeOptions at the boundary.
//
// Interface the developer provides:
// - when o.inputDefs has developer_model / developer_effort: a <select> each with
//   data-testid="resume-input-<key>", its label and options from the definition, preselected at
//   o.inputs[key]; none when inputDefs is empty or absent.
// - On Resume, a changed value goes as the 7th argument of api.resumeRun.
// - [data-testid="resume-limit-note"] says the limit and, with o.turns, SessionCache.continueText's text.
const test = require('node:test');
const assert = require('node:assert/strict');
const { textOf } = require('./mini-dom');
const { loadPage, settle } = require('./agent-chat-page-harness');

const OPUS = 'claude-opus-5-5';
const FABLE = 'claude-fable-5-1';
const MODEL_DEF = { label: 'Developer model', type: 'string', enum: [OPUS, FABLE], default: OPUS, options: { [OPUS]: 'Opus 5.5', [FABLE]: 'Fable 5.1' } };
const EFFORT_DEF = { label: 'Developer effort', type: 'string', enum: ['default', 'low', 'high'], default: 'default', options: { default: 'Default', low: 'Low', high: 'High' } };
const COLD_TURN = { agent: 'developer', turn: { kind: 'cold', since: 1790000000000, tokens: 140000, cost_usd: 0.7 } };

const step = (id, visits) => ({ id, type: 'agent', gate: false, visits, blockedBy: null, confirm: null });
const OPTIONS = (over = {}) => ({
  runId: 'r-799', workflow: 'Feature', file: 'feature.yaml', status: 'failed', active: false, mock: true,
  steps: [step('plan', 1), step('develop', 1), step('finish', 0)],
  stoppedAt: 'develop', failedStep: 'develop', suggested: 'develop', limit: null, worktree: null,
  sessions: [], handoffs: [], paused: null,
  inputs: { developer_model: FABLE, developer_effort: 'high' },
  inputDefs: { developer_model: MODEL_DEF, developer_effort: EFFORT_DEF },
  turns: [],
  ...over,
});

async function openDialog(options) {
  const page = await loadPage({ api: { resumeOptions: async () => options, resumeRun: async () => ({ runId: 'r-new' }) } });
  await page.sandbox.openResumeDialog('r-799');
  await settle();
  return page;
}

const selectOf = (page, key) => page.$(`[data-testid="resume-input-${key}"]`);
const choose = (page, key, value) => {
  const select = selectOf(page, key);
  select.value = value;
  select.dispatchEvent(new page.dom.classes.Event('change', { bubbles: true }));
};
// the arguments of each api.resumeRun call, as plain values
async function pressResume(page) {
  page.$('#btn-resume-yes').click();
  await settle(20);
  return page.callsTo('resumeRun').map((args) => JSON.parse(JSON.stringify(args)));
}
const noteOf = (page) => textOf(page.$('[data-testid="resume-limit-note"]'));

test('#799 resume dialog: the step the run failed at is preselected', async () => {
  const page = await openDialog(OPTIONS());
  assert.equal(page.$('#resume-step').value, 'develop');
});

test('#799 resume dialog: the developer model select shows the run\'s value', async () => {
  const page = await openDialog(OPTIONS());
  assert.equal(selectOf(page, 'developer_model')?.value, FABLE);
});

test('#799 resume dialog: the developer effort select shows the run\'s value', async () => {
  const page = await openDialog(OPTIONS());
  assert.equal(selectOf(page, 'developer_effort')?.value, 'high');
});

test('#799 resume dialog: a select offers the definition\'s options, by their labels', async () => {
  const page = await openDialog(OPTIONS());
  const options = Array.from(selectOf(page, 'developer_model')?.querySelectorAll('option') || []).map((o) => [o.getAttribute('value'), textOf(o)]);
  assert.deepEqual(options, [[OPUS, 'Opus 5.5'], [FABLE, 'Fable 5.1']]);
});

test('#799 resume dialog: each select has its definition\'s label', async () => {
  const page = await openDialog(OPTIONS());
  const body = textOf(page.$('#resume-body'));
  assert.deepEqual([body.includes('Developer model'), body.includes('Developer effort')], [true, true]);
});

test('#799 resume dialog: a workflow declaring only the model has one select', async () => {
  const page = await openDialog(OPTIONS({ inputs: { developer_model: FABLE }, inputDefs: { developer_model: MODEL_DEF } }));
  assert.deepEqual([selectOf(page, 'developer_model') === null, selectOf(page, 'developer_effort') === null], [false, true]);
});

test('#799 resume dialog: no select when inputDefs is empty', async () => {
  const page = await openDialog(OPTIONS({ inputs: {}, inputDefs: {} }));
  assert.deepEqual([selectOf(page, 'developer_model') === null, selectOf(page, 'developer_effort') === null], [true, true]);
});

test('#799 resume dialog: no select when the service sends no inputDefs', async () => {
  const { inputs, inputDefs, ...older } = OPTIONS();
  const page = await openDialog(older);
  assert.deepEqual([selectOf(page, 'developer_model') === null, selectOf(page, 'developer_effort') === null], [true, true]);
});

test('#799 resume dialog: a changed model reaches api.resumeRun as its 7th argument', async () => {
  const page = await openDialog(OPTIONS());
  choose(page, 'developer_model', OPUS);
  const calls = await pressResume(page);
  assert.equal(calls.length, 1);
  assert.deepEqual([calls[0][0], calls[0][1]], ['r-799', 'develop']);
  assert.deepEqual(calls[0][6], { developer_model: OPUS });
});

test('#799 resume dialog: a changed effort reaches api.resumeRun as its 7th argument', async () => {
  const page = await openDialog(OPTIONS());
  choose(page, 'developer_effort', 'low');
  const calls = await pressResume(page);
  assert.deepEqual(calls[0]?.[6], { developer_effort: 'low' });
});

test('#799 resume dialog: nothing changed sends no input', async () => {
  const page = await openDialog(OPTIONS());
  const calls = await pressResume(page);
  assert.equal(calls.length, 1);
  assert.deepEqual(Object.keys(calls[0][6] || {}), []);
});

test('#799 resume dialog: the limit note says the limit', async () => {
  const page = await openDialog(OPTIONS({ limit: "You've hit your weekly limit" }));
  assert.match(noteOf(page), /weekly limit/i);
});

test('#799 resume dialog: the limit note says what each agent\'s next turn re-reads', async () => {
  const page = await openDialog(OPTIONS({ limit: "You've hit your weekly limit", turns: [COLD_TURN] }));
  assert.match(noteOf(page), /developer resumes cold ~140K ≈ \$0\.70/i);
});

test('#799 resume dialog: the limit note says nothing of re-reading without turns', async () => {
  const page = await openDialog(OPTIONS({ limit: "You've hit your weekly limit", turns: [] }));
  assert.doesNotMatch(noteOf(page), /Continue:/);
});
