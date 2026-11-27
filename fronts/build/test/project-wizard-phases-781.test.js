// #781: the wizard's step 3 says what the analysis is doing, line by line (fronts/build/views/projects/
// project-wizard-workflows.js). Acceptance tests, written before the code, on the real page through
// project-wizard-helpers.js (packages/ui-kit/test/renderer-app-harness.js).
//
// The contract these tests assume:
// - wizard-analysis-phases holds three ActivityLines (packages/ui-kit/activity-line.js): wizard-phase-git,
//   wizard-phase-files, wizard-phase-oracle. Shown while analyzing AND once analyzed when the analysis ran in this
//   wizard; never in choose or manual.
// - it replaces wizard-workflows-spinner and any .spinner in the column. wizard-workflows-analyzing stays the
//   role="status" wrapper of the phases, the dimmed rows stay (aria-busy, inert).
// - the wizard reads api.workflowInterviewState({ projectId }) as soon as the profile job runs, again on each
//   onboarding:changed while it runs, and every second while it runs, and stops when it ended. A failing read never
//   breaks the column. (The harness's setInterval never fires and no test sleeps: the second-by-second read is the
//   BDD feature's; here, the read on each change.)
// - visible text (English catalog): git line /git history/i; files line /files/i; oracle line /Oracle/; done git
//   summary has "312 commits", the merges' number, "8 tags" joined by " · "; files done summary names the languages;
//   oracle skipped: /not needed/i; oracle running: `reading` in the line and the elapsed time as m:ss
//   (.activity-line-meta). The pt-BR catalog has "Lendo o histórico do git".
// - failed: wizard-workflows-failed holds an ActivityLine data-state="failed" with the reason and the
//   wizard-workflows-retry button. "Define manually" stays.
// - Continue (wizard-next) is never blocked by the phases (#725): enabled while they run and once analyzed. #100:
//   in the failed state it is locked until Retry or Define manually (the workflows are not defined).
const test = require('node:test');
const assert = require('node:assert/strict');
const H = require('@craftorio/ui-kit/test/page-pieces');
const W = require('./project-wizard-helpers');

const { PID, byTestId, classesOf, clone, emit, press, wizardMarkup } = W;

const PROFILE = { mode: 'remote', ci: 'release', tests: 'unit' };
const CLONED = { clone: { status: 'done' }, facts: { status: 'done' } };
const PROFILING = { projectId: PID, status: 'analyzing', cli: W.CLI_OK, jobs: W.jobs({ ...CLONED, profile: { status: 'running' } }) };
const PROFILED = { projectId: PID, status: 'analyzing', cli: W.CLI_OK, jobs: W.jobs({ ...CLONED, profile: { status: 'done', profile: PROFILE }, projectMap: { status: 'running' } }) };
const PROFILE_ERROR = 'The interview refused: the Oracle\'s daily budget is spent.';
const PROFILE_FAILED = { projectId: PID, status: 'ready', cli: W.CLI_OK, jobs: W.jobs({ ...CLONED, profile: { status: 'failed', error: PROFILE_ERROR, code: 'refused', reason: PROFILE_ERROR } }) };

const GIT_FOUND = { commits: 312, merges: 41, tags: 8, authors: 3 };
const FILES_FOUND = { languages: ['rust', 'shell'], testCommand: 'cargo test', ci: 'release' };
const READING = 'Reading src/main.rs';
const ago = (seconds) => new Date(Date.now() - seconds * 1000).toISOString();

const GIT_RUNNING = { running: null, error: null, phases: { git: { status: 'running' }, files: { status: 'pending' }, oracle: { status: 'pending' } } };
const oracleRunning = (since) => ({
  running: { since, items: 3, last: READING },
  error: null,
  phases: { git: { status: 'done', found: GIT_FOUND }, files: { status: 'done', found: FILES_FOUND }, oracle: { status: 'running', since, reading: READING } },
});
const ENDED = { running: null, error: null, phases: { git: { status: 'done', found: GIT_FOUND }, files: { status: 'done', found: FILES_FOUND }, oracle: { status: 'done' } } };
const NOT_NEEDED = { running: null, error: null, phases: { git: { status: 'done', found: GIT_FOUND }, files: { status: 'done', found: FILES_FOUND }, oracle: { status: 'not-needed' } } };

const opts = (read) => ({ api: { workflowInterviewState: read } });
const answers = (value) => opts(async () => clone(value));

// the wizard at step 3, the analysis picked and the profile job running
async function analyzing(options) {
  const app = await W.atAnalysis(options);
  await press(app, 'wizard-workflows-choice-analyze');
  await emit(app, PROFILING);
  return app;
}

const part = (app, id) => byTestId(wizardMarkup(app), id);
const stateOf = (app, id) => part(app, id)?.attrs['data-state'] ?? null;
const lineText = (app, id) => H.visibleText(part(app, id)?.inner || '');
const interviewReads = (app) => app.callsTo('workflowInterviewState');

function assertContinue(app, when, { locked = false } = {}) {
  const next = part(app, 'wizard-next');
  assert.equal(next === null, false, `${when}: Continue is shown`);
  assert.equal('disabled' in next.attrs, locked, `${when}: Continue is ${locked ? 'locked (#100)' : 'enabled'}`);
}

// ---- the three lines ------------------------------------------------------------------------------------

test('#781 while analyzing, wizard-analysis-phases holds the git, files and Oracle lines, in this order', { timeout: 20000 }, async () => {
  const app = await analyzing(answers(GIT_RUNNING));
  const phases = part(app, 'wizard-analysis-phases');
  assert.equal(phases === null, false, 'data-testid="wizard-analysis-phases"');
  const ids = H.findAll(phases.outer, (e) => /^wizard-phase-/.test(e.attrs['data-testid'] || '')).map((e) => e.attrs['data-testid']);
  assert.deepEqual(ids, ['wizard-phase-git', 'wizard-phase-files', 'wizard-phase-oracle']);
  assert.equal(classesOf(part(app, 'wizard-phase-git')).includes('activity-line'), true, 'an ActivityLine');
});

test('#781 the phases replace the spinner, inside the role="status" wrapper', { timeout: 20000 }, async () => {
  const app = await analyzing(answers(GIT_RUNNING));
  const wrapper = part(app, 'wizard-workflows-analyzing');
  assert.equal(wrapper?.attrs.role, 'status');
  assert.equal(byTestId(wrapper?.outer || '', 'wizard-analysis-phases') === null, false, 'the phases are in the wrapper');
  assert.equal(part(app, 'wizard-workflows-spinner'), null, 'no wizard-workflows-spinner');
  assert.equal(W.hasSpinner(part(app, 'wizard-workflows-column')?.outer), false, 'no .spinner in the column');
});

test('#781 the workflows\' rows stay dimmed under the phases', { timeout: 20000 }, async () => {
  const app = await analyzing(answers(GIT_RUNNING));
  const rows = part(app, 'wizard-workflows-rows');
  assert.equal(rows?.attrs['aria-busy'], 'true');
  assert.equal('inert' in (rows?.attrs || {}), true);
});

test('#781 each line follows the interview: git running, the others pending, with their words', { timeout: 20000 }, async () => {
  const app = await analyzing(answers(GIT_RUNNING));
  assert.equal(stateOf(app, 'wizard-phase-git'), 'running');
  assert.match(lineText(app, 'wizard-phase-git'), /git history/i);
  assert.equal(stateOf(app, 'wizard-phase-files'), 'pending');
  assert.match(lineText(app, 'wizard-phase-files'), /files/i);
  assert.equal(stateOf(app, 'wizard-phase-oracle'), 'pending');
  assert.match(lineText(app, 'wizard-phase-oracle'), /Oracle/);
});

test('#781 the git line done sums up its commits, merges and tags', { timeout: 20000 }, async () => {
  const app = await analyzing(answers(oracleRunning(ago(5))));
  assert.equal(stateOf(app, 'wizard-phase-git'), 'done');
  assert.match(lineText(app, 'wizard-phase-git'), /312 commits · [^·]*41[^·]* · 8 tags/);
});

test('#781 the files line done names the languages', { timeout: 20000 }, async () => {
  const app = await analyzing(answers(oracleRunning(ago(5))));
  assert.equal(stateOf(app, 'wizard-phase-files'), 'done');
  assert.match(lineText(app, 'wizard-phase-files'), /rust/i);
  assert.match(lineText(app, 'wizard-phase-files'), /shell/i);
});

test('#781 the Oracle\'s line running says what it reads and the time elapsed as m:ss', { timeout: 20000 }, async () => {
  const app = await analyzing(answers(oracleRunning(ago(75))));
  assert.equal(stateOf(app, 'wizard-phase-oracle'), 'running');
  assert.equal(lineText(app, 'wizard-phase-oracle').includes(READING), true, lineText(app, 'wizard-phase-oracle'));
  const meta = H.findEl(part(app, 'wizard-phase-oracle')?.outer || '', (e) => classesOf(e).includes('activity-line-meta'));
  assert.match(H.visibleText(meta?.inner || ''), /^1:\d\d$/);
});

test('#781 an Oracle not needed reads as skipped, in words', { timeout: 20000 }, async () => {
  const app = await analyzing(answers(NOT_NEEDED));
  assert.equal(stateOf(app, 'wizard-phase-oracle'), 'skipped');
  assert.match(lineText(app, 'wizard-phase-oracle'), /not needed/i);
});

test('#781 the pt-BR catalog says "Lendo o histórico do git"', { timeout: 20000 }, async () => {
  const app = await W.atAnalysis(answers(GIT_RUNNING));
  app.sandbox.I18n.setLanguage('pt-BR');
  await press(app, 'wizard-workflows-choice-analyze');
  await emit(app, PROFILING);
  assert.equal(lineText(app, 'wizard-phase-git').includes('Lendo o histórico do git'), true, lineText(app, 'wizard-phase-git'));
});

// ---- when they show --------------------------------------------------------------------------------------

test('#781 once analyzed in this wizard the lines stay, ended, over the rows', { timeout: 20000 }, async () => {
  const app = await analyzing(answers(ENDED));
  await emit(app, PROFILED);
  assert.equal(part(app, 'wizard-workflows-column')?.attrs['data-state'], 'analyzed');
  assert.equal(part(app, 'wizard-analysis-phases') === null, false, 'the phases stay');
  assert.equal(stateOf(app, 'wizard-phase-git'), 'done');
  assert.equal(stateOf(app, 'wizard-phase-oracle'), 'done');
});

test('#781 no phases before a choice', { timeout: 20000 }, async () => {
  const app = await W.atAnalysis(answers(GIT_RUNNING));
  assert.equal(part(app, 'wizard-workflows-column')?.attrs['data-state'], 'choose');
  assert.equal(part(app, 'wizard-analysis-phases'), null);
});

test('#781 no phases when defined by hand', { timeout: 20000 }, async () => {
  const app = await W.atAnalysis(answers(GIT_RUNNING));
  await press(app, 'wizard-workflows-choice-manual');
  assert.equal(part(app, 'wizard-workflows-column')?.attrs['data-state'], 'manual');
  assert.equal(part(app, 'wizard-analysis-phases'), null);
});

// ---- the reads -------------------------------------------------------------------------------------------

test('#781 the interview is not read before the profile job runs', { timeout: 20000 }, async () => {
  const app = await W.atAnalysis(answers(GIT_RUNNING));
  assert.equal(interviewReads(app).length, 0);
});

test('#781 the interview is read, with the project, as soon as the profile job runs', { timeout: 20000 }, async () => {
  const app = await analyzing(answers(GIT_RUNNING));
  assert.equal(interviewReads(app).length > 0, true, 'a read');
  assert.equal(String(interviewReads(app)[0][0]?.projectId), PID);
});

test('#781 the interview is read again on each onboarding:changed while the job runs', { timeout: 20000 }, async () => {
  const app = await analyzing(answers(GIT_RUNNING));
  const before = interviewReads(app).length;
  await emit(app, PROFILING);
  assert.equal(interviewReads(app).length > before, true, 'one more read');
});

test('#781 the line follows the new answer of the next read', { timeout: 20000 }, async () => {
  let answer = GIT_RUNNING;
  const app = await analyzing(opts(async () => clone(answer)));
  assert.equal(stateOf(app, 'wizard-phase-git'), 'running');
  answer = oracleRunning(ago(5));
  await emit(app, PROFILING);
  assert.equal(stateOf(app, 'wizard-phase-git'), 'done');
  assert.equal(stateOf(app, 'wizard-phase-oracle'), 'running');
});

test('#781 the reads stop once the job ended', { timeout: 20000 }, async () => {
  const app = await analyzing(answers(ENDED));
  await emit(app, PROFILED);
  const after = interviewReads(app).length;
  assert.equal(after > 0, true, 'it was read while the job ran');
  await emit(app, { ...PROFILED, jobs: { ...PROFILED.jobs, projectMap: { status: 'done' } } });
  assert.equal(interviewReads(app).length, after, 'no read after the end');
});

test('#781 a read that fails never breaks the column: git keeps running, Continue stays', { timeout: 20000 }, async () => {
  const app = await analyzing(opts(async () => { throw new Error('engine gone'); }));
  await emit(app, PROFILING);
  assert.equal(stateOf(app, 'wizard-phase-git'), 'running');
  assert.equal(stateOf(app, 'wizard-phase-files'), 'pending');
  assertContinue(app, 'after a failed read');
  assert.deepEqual(app.errors.map((e) => String(e?.message)).filter((m) => m.includes('engine gone')), [], 'no rejection left behind');
});

// ---- failed ----------------------------------------------------------------------------------------------

test('#781 failed: an ActivityLine with the reason and Retry, and Define manually stays', { timeout: 20000 }, async () => {
  const app = await analyzing(answers(GIT_RUNNING));
  await emit(app, PROFILE_FAILED);
  const failed = part(app, 'wizard-workflows-failed');
  assert.equal(failed === null, false, 'data-testid="wizard-workflows-failed"');
  const line = H.findEl(failed.outer, (e) => classesOf(e).includes('activity-line'));
  assert.equal(line?.attrs['data-state'], 'failed');
  assert.match(H.visibleText(line?.inner || ''), /daily budget/i);
  assert.equal(byTestId(line?.outer || '', 'wizard-workflows-retry') === null, false, 'Retry in the line');
  assert.equal(part(app, 'wizard-workflows-choice-manual') === null, false, 'Define manually');
});

test('#781 Retry of the failed line calls api.retryOnboarding', { timeout: 20000 }, async () => {
  const app = await analyzing(answers(GIT_RUNNING));
  await emit(app, PROFILE_FAILED);
  await press(app, 'wizard-workflows-retry');
  assert.deepEqual(app.callsTo('retryOnboarding').map((c) => String(c[0])), [PID]);
});

// ---- Continue --------------------------------------------------------------------------------------------

test('#781 Continue is never blocked by the phases; #100: a failed analysis locks it until Define manually', { timeout: 30000 }, async () => {
  const app = await analyzing(answers(GIT_RUNNING));
  assertContinue(app, 'git running');
  await emit(app, PROFILED);
  assertContinue(app, 'analyzed');
  await emit(app, PROFILE_FAILED);
  assertContinue(app, 'failed', { locked: true });
  await press(app, 'wizard-workflows-choice-manual');
  assertContinue(app, 'failed, then Define manually');
});
