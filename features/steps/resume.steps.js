// Steps of features/resume.feature (#799): the Resume from step… dialog of a stopped Feature run. Opening
// Runs, searching a run, the preselected step, the run's pills and its chat reuse app.steps.js,
// display-names.steps.js, agent-providers.steps.js and fronts/build/features/steps/run.steps.js.
// Locators are roles and data-testid only (skills/ui-conventions).
//
// What the scenarios expect of the dialog (the dialog named "Resume from step", index.html #resume-modal):
//   resume-input-developer_model   NEW: a <select> labelled "Developer model", its options the
//                                  workflow's labels ("Opus 5.5", "Fable 5.2"), at the run's value
//                                  (#56: an older one, "Fable 5.1", is kept and named)
//   resume-input-developer_effort  NEW: the same for "Developer effort" ("Default", "High"…)
//   resume-limit-note              the limit that stopped the run, now a provider's too ("weekly limit")
//   the button "Resume from this step" (#btn-resume-yes) starts the new run with the chosen values
// The dialog gives no test id to what the next turn re-reads: the step reads the context's size in the
// words of the gate card's Continue line (session-cache.js gateTurnText: "resumes cold ~140K").
//
// Seeding writes a run folder into the scratch workspace like agent-providers.steps.js (events.jsonl,
// summary.json); the run list reads the runs folder when the screen opens, so no reload is needed.

const fs = require('fs');
const path = require('path');
const { expect } = require('@playwright/test');
const { Given, When, Then } = require('./fixtures');
const { LOAD_TIMEOUT, runScreenId } = require('../support/run-screen');
const { FEATURE } = require('../support/workflows');

const MIN = 6e4;
const DAY = 864e5;
// feature.yaml's inputs developer_model and developer_effort: the label the owner reads, its value
// (Fable 5.1: no longer a choice, #56, what an earlier run saved)
const MODELS = { 'Opus 5.5': 'claude-opus-5-5', 'Fable 5.2': 'claude-fable-5-2', 'Fable 5.1': 'claude-fable-5-1' };
const EFFORTS = { Default: 'default', Low: 'low', Medium: 'medium', High: 'high', 'Extra high': 'xhigh' };

const valueOf = (values, label) => {
  if (!(label in values)) throw new Error(`no value for "${label}" (known: ${Object.keys(values).join(', ')})`);
  return values[label];
};

// the steps a Feature run finishes before Develop, each with the output its later steps read
const finishedSteps = (at) => [
  ['acceptance_tests', 'agent', 'test_writer', { summary: 'Wrote the acceptance tests.', tests_added: [], tests_changed: [], e2e_files: [], e2e_scope: 'none' }],
  ['red_check', 'suite', undefined, { status: 'red', message: 'The acceptance tests fail, as they should.' }],
  ['warm_up', 'agent', 'mapper', { summary: 'Mapped the code.', map: '' }],
].flatMap(([id, type, agent, output], i) => [
  { ts: at(1 + i), type: 'step.started', step_id: id, step_type: type, agent, visit: 1 },
  { ts: at(2 + i), type: 'step.finished', step_id: id, visit: 1, duration_ms: MIN, output },
]);

// A finished simulated Feature run of the demo project, days back, written as the engine ends a run
// whose Develop turn threw (agent-providers.steps.js: no step.finished of that step): its error in
// workflow.finished and in the summary. `session`: the developer's session fields over the defaults.
function seedStoppedRun(e2e, { suffix, task, inputs = {}, error, session = {} }) {
  const start = Date.now() - 2 * DAY;
  const runId = `${new Date(start).toISOString().slice(0, 10).replace(/-/g, '')}-101500-${suffix}`;
  const dir = path.join(e2e.scratch, 'workspace', 'runs', runId);
  const at = (m) => new Date(start + m * MIN).toISOString();
  const project = e2e.project;
  const allInputs = { task, repo_path: project.folder || project.repo, ...inputs };
  const developer = { id: 's-develop', agent: 'developer', provider: 'claude', model: inputs.developer_model || MODELS['Opus 5.5'], status: 'failed', turns: 1, cost_usd: 0, ...session };
  const inner = [
    ...finishedSteps(at),
    { ts: at(5), type: 'step.started', step_id: 'develop', step_type: 'agent', agent: 'developer', visit: 1 },
    { ts: at(5), type: 'session.opened', session_id: 's-develop', session: developer },
    { ts: at(5), type: 'session.message_sent', session_id: 's-develop', step_id: 'develop', text: `Implement: ${task}`, session: developer },
    { ts: at(6), type: 'log', level: 'error', step_id: 'develop', message: `develop: ${error}` },
    { ts: at(6), type: 'session.status', session_id: 's-develop', status: 'failed', session: developer },
  ];
  const steps = inner.filter((e) => e.type === 'step.started').map((e) => ({ id: e.step_id, type: e.step_type, agent: e.agent }));
  const events = [
    { ts: at(0), type: 'workflow.started', workflow: FEATURE.name, file: FEATURE.file, project_id: project.id, mock: true, inputs: allInputs, steps },
    ...inner,
    { ts: at(7), type: 'workflow.finished', status: 'failed', error },
  ].map((e, i) => ({ seq: i + 1, run_id: runId, ...e }));
  const files = {
    'events.jsonl': `${events.map((e) => JSON.stringify(e)).join('\n')}\n`,
    'summary.json': JSON.stringify({
      run_id: runId, workflow: FEATURE.name, file: FEATURE.file, project_id: project.id, mock: true, inputs: allInputs, status: 'failed', error, started_at: at(0), finished_at: at(7), duration_ms: 7 * MIN, sessions: [developer],
    }, null, 2),
  };
  fs.mkdirSync(dir, { recursive: true });
  for (const [name, content] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), content);
}

Given('the demo project has a Feature run {string} that failed at Develop on {string} with the effort {string}', async ({ e2e }, suffix, model, effort) => {
  seedStoppedRun(e2e, {
    suffix,
    task: `A run that failed at Develop (${suffix})`,
    inputs: { developer_model: valueOf(MODELS, model), developer_effort: valueOf(EFFORTS, effort) },
    error: 'The developer turn failed (simulated).',
  });
});

// the provider's message is the run's error; the conversation stays open to resume (#320's fields of
// the session snapshot, cache-state.steps.js), its last turn past the hour of the prompt cache
Given('the demo project has a Feature run {string} stopped at Develop by {string} with a developer context of {int} tokens', async ({ e2e }, suffix, message, tokens) => {
  seedStoppedRun(e2e, {
    suffix,
    task: `A run stopped by a provider's limit (${suffix})`,
    error: message,
    session: {
      mode: 'persistent', provider_session_id: 's-develop-cli', last_turn_at: new Date(Date.now() - 2 * DAY + 6 * MIN).toISOString(), context_tokens: tokens, cache_lifetime_ms: 60 * MIN, has_note: false,
    },
  });
});

// ---- the dialog --------------------------------------------------------------------------------------

const resumeDialog = (page) => page.getByRole('dialog', { name: 'Resume from step', exact: true });
// "Developer model" → the select of the workflow's input developer_model
const resumeInput = (page, label) => resumeDialog(page).getByTestId(`resume-input-${label.trim().toLowerCase().replace(/\s+/g, '_')}`);

// Workflows › Runs, after `I search the runs for`: expands the run's row and clicks its button
When('I open Resume from step on the run {string} from the list', async ({ e2e }, fragment) => {
  const row = e2e.window.locator(`[data-testid="run-list-row"][data-run$="${fragment}"]`).filter({ visible: true }).first();
  await expect(row).toBeVisible({ timeout: LOAD_TIMEOUT });
  const button = row.getByRole('button', { name: 'Resume from step…', exact: true });
  if (!(await button.isVisible())) await row.locator('.pr-row').first().click();
  await button.click();
});

Then('the resume dialog shows {string} for {string}', async ({ e2e }, option, label) => {
  const select = resumeInput(e2e.window, label);
  await expect(select).toBeVisible({ timeout: LOAD_TIMEOUT });
  await expect(select).toHaveAccessibleName(label);
  await expect.poll(() => select.evaluate((el) => el.selectedOptions[0]?.textContent.trim() || '')).toBe(option);
});

Then('the resume dialog also offers {string} for {string}', async ({ e2e }, option, label) => {
  await expect(resumeInput(e2e.window, label).getByRole('option', { name: option, exact: true })).toBeAttached({ timeout: LOAD_TIMEOUT });
});

Then('the resume dialog says the run stopped at its {string}', async ({ e2e }, limit) => {
  const note = resumeDialog(e2e.window).getByTestId('resume-limit-note');
  await expect(note).toBeVisible({ timeout: LOAD_TIMEOUT });
  await expect(note).toContainText(limit);
});

Then('the resume dialog says the next turn would re-read about {string} tokens', async ({ e2e }, size) => {
  await expect(resumeDialog(e2e.window)).toContainText(size, { timeout: LOAD_TIMEOUT });
});

When('I choose {string} for {string} in the resume dialog', async ({ e2e }, option, label) => {
  const select = resumeInput(e2e.window, label);
  await expect(select).toBeVisible({ timeout: LOAD_TIMEOUT });
  await select.selectOption({ label: option });
});

When('I resume from this step', async ({ e2e }) => {
  await resumeDialog(e2e.window).getByRole('button', { name: 'Resume from this step', exact: true }).click({ timeout: LOAD_TIMEOUT });
});

// the dialog closes and the Run screen holds the new run, not the one it resumes
Then('a new run opens instead of the run {string}', async ({ e2e }, fragment) => {
  const page = e2e.window;
  await expect(resumeDialog(page)).toBeHidden({ timeout: LOAD_TIMEOUT });
  const id = runScreenId(page);
  await expect(id).toBeVisible({ timeout: LOAD_TIMEOUT });
  await expect(id).toHaveText(/\S/, { timeout: LOAD_TIMEOUT });
  await expect(id).not.toContainText(fragment, { timeout: LOAD_TIMEOUT });
});
