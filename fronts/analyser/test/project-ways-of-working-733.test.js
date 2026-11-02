// #733 acceptance, written before the code: the Ways of working drawer
// (fronts/analyser/views/project/project-ways-of-working.js) opens on the project's last analysis, and
// shows a loader (spinner, "Analyzing the repository…", elapsed time, current activity) while one runs.
// Same mini DOM and fake window.api as project-ways-of-working-487.test.js.
//
// The contract assumed here (new seams of #733):
// - api.workflowInterviewLast({ projectId }) (channel workflows:interviewLast) → null (never analyzed) or
//   { profile, evidence, questions, simulated, date, costUsd }: the saved run, without running it;
// - api.workflowInterviewState({ projectId }) (channel workflows:interviewState) → { running: { since,
//   items, last } | null, error: string | null } (seed-runs.js runState of the ways-of-working seed);
// - test ids (new): ways-of-working-analyzed-on ("Analyzed on <date> · <cost or free>"),
//   ways-of-working-analyze-again (the secondary re-run, its estimate inside), ways-of-working-loader
//   (the spinner block) with ways-of-working-elapsed and ways-of-working-activity inside,
//   ways-of-working-error (the reason) and ways-of-working-retry, ways-of-working-current-set with one
//   ways-of-working-current-workflow per workflow of the project (data-name), the project's workflows
//   being read from the project the drawer is opened with (p.workflows, saved by #729);
// - kept: ways-of-working-analyze, ways-of-working-profile, ways-of-working-evidence,
//   ways-of-working-question, ways-of-working-proposed-workflow, ways-of-working-estimate.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const pageFileOf = (rel) => require('../../../scripts/source-tree').pageFile(path.join(__dirname, '..', '..', '..'), rel);
const vm = require('vm');
const I18n = require('@multiagent/shared/i18n.js');
const { withI18n } = require('@multiagent/shared/test/i18n-sandbox');
const { createDom } = require('@multiagent/ui-kit/test/mini-dom');

const FILE = pageFileOf('views/project/project-ways-of-working.js');

const INTERVIEW = {
  profile: { mode: 'local', release: null, testCommand: 'npm test', checkCommand: null, ci: 'release', tests: 'unit', languages: ['js'] },
  evidence: { team: { numbers: { authors: 1 }, commits: ['a1b2c3d4e5'] } },
  questions: [
    { id: 'review', label: 'Review', question: 'How strict?', type: 'choice', options: [{ value: 'standard', label: 'Standard' }, { value: 'strict', label: 'Strict' }], default: 'standard' },
    { id: 'release', label: 'Release', question: 'Which release?', type: 'choice', options: [{ value: 'milestone', label: 'Milestone' }, { value: 'train', label: 'Train' }], default: 'milestone' },
  ],
  simulated: false,
};
const LAST = { ...INTERVIEW, date: '2026-10-28T09:30:00.000Z', costUsd: 0.05 };
const IDLE = { running: null, error: null };

const proposal = (name) => ({ workflows: [{ name, category: 'solo', path: `.multiagent/workflows/${name}.yaml`, yaml: '' }], manifest: { path: '.multiagent/project.yaml', yaml: '' } });
const clone = (x) => JSON.parse(JSON.stringify(x));

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

// last: what workflowInterviewLast answers; runState: what workflowInterviewState answers (a function
// so a test can change it); interview: what workflowInterview answers (a function)
function loadDrawer({ last = null, runState = () => IDLE, interview = async () => clone(INTERVIEW) } = {}) {
  const calls = { interview: 0, last: 0, state: 0, compose: 0 };
  const api = {
    seedEstimate: async () => ({ costUsd: 0.1, free: false }),
    workflowInterview: async (...a) => { calls.interview++; return interview(...a); },
    workflowInterviewLast: async () => { calls.last++; return last ? clone(last) : null; },
    workflowInterviewState: async () => { calls.state++; return clone(runState()); },
    workflowCompose: async () => { calls.compose++; return proposal(`wf-${calls.compose}`); },
  };
  const sandbox = {
    console, setTimeout, clearTimeout, setInterval, clearInterval, queueMicrotask, Promise, Date,
    api,
    esc: (s) => String(s ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`),
    errMsg: (e) => String(e?.message || e), showToast: () => {},
    fmtUsd: (n) => `$${Number(n).toFixed(2)}`,
  };
  const dom = createDom({ window: sandbox });
  Object.assign(sandbox, { window: sandbox, document: dom.document }, dom.classes);
  withI18n(sandbox);
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(FILE, 'utf8'), sandbox, { filename: 'project-ways-of-working.js' });
  const doc = dom.document;
  const q = (id) => doc.querySelector(`[data-testid="${id}"]`);
  const qa = (id) => Array.from(doc.querySelectorAll(`[data-testid="${id}"]`));
  const click = (el) => el.dispatchEvent(new dom.classes.MouseEvent('click', { bubbles: true, cancelable: true }));
  const text = (el) => String(el?.textContent ?? '').replace(/\s+/g, ' ').trim();
  return { WOW: sandbox.ProjectWaysOfWorking, calls, q, qa, click, text };
}

const settle = async () => { for (let i = 0; i < 15; i++) await new Promise((r) => setImmediate(r)); };
// waits (real time, the drawer may poll the run's state) until `fn` answers true, up to `ms`
async function waitFor(fn, ms = 4000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    await settle();
    if (fn()) return true;
    await new Promise((r) => setTimeout(r, 50));
  }
  return fn();
}

const PROJECT = { id: 'p1', name: 'demo' };

async function opened(t, opts, project = PROJECT) {
  const was = I18n.getLanguage();
  I18n.setLanguage('en');
  const w = loadDrawer(opts);
  t.after(() => { w.WOW.close(); I18n.setLanguage(was); });
  await w.WOW.open(clone(project));
  await settle();
  return w;
}

// ---- criterion 1: opens on the last analysis --------------------------------------------------------

test('#733 with a saved analysis the drawer opens on its profile, evidence, open questions and proposed set without running the interview', async (t) => {
  const w = await opened(t, { last: LAST });
  assert.equal(w.calls.last >= 1, true, 'the drawer read the last analysis (api.workflowInterviewLast)');
  assert.equal(w.q('ways-of-working-profile') !== null, true, 'the profile is shown');
  assert.equal(w.qa('ways-of-working-evidence').length, 1);
  assert.equal(w.qa('ways-of-working-question').length, 2);
  assert.deepEqual(w.qa('ways-of-working-proposed-workflow').map((el) => el.getAttribute('data-name')), ['wf-1']);
  assert.equal(w.calls.interview, 0, 'api.workflowInterview is not called to show it');
});

test('#733 the saved analysis shows "Analyzed on <date> · <cost>"', async (t) => {
  const w = await opened(t, { last: LAST });
  const line = w.text(w.q('ways-of-working-analyzed-on'));
  assert.equal(line.includes('2026'), true, `the date in "${line}"`);
  assert.equal(line.includes('0.05'), true, `the cost in "${line}"`);
});

test('#733 an analysis that cost nothing (git settled it, or simulated) reads "free" on its Analyzed on line', async (t) => {
  const w = await opened(t, { last: { ...LAST, costUsd: 0 } });
  const line = w.text(w.q('ways-of-working-analyzed-on'));
  assert.equal(/\bfree\b/i.test(line), true, `"free" in "${line}"`);
  assert.equal(line.includes('0.00'), false, `no zero cost in "${line}"`);
});

// ---- criterion 2: Analyze again -------------------------------------------------------------------

test('#733 "Analyze again" is a secondary action with the estimate, and it re-runs the interview', async (t) => {
  const w = await opened(t, { last: LAST });
  const again = w.q('ways-of-working-analyze-again');
  assert.equal(again !== null, true, 'data-testid="ways-of-working-analyze-again"');
  assert.equal(String(again.getAttribute('class') || '').split(/\s+/).includes('primary'), false, 'not the primary action');
  assert.equal(w.text(again).includes('0.10') || w.text(again.parentElement).includes('0.10'), true, 'its estimate (US$ 0.10) next to it');
  w.click(again);
  await settle();
  assert.equal(w.calls.interview, 1);
});

// ---- criterion 3: the loader ----------------------------------------------------------------------

test('#733 after Analyze the drawer shows the loader with the elapsed time and the run\'s current activity', async (t) => {
  const held = deferred();
  const since = new Date(Date.now() - 65e3).toISOString();
  const w = await opened(t, { interview: () => held.promise, runState: () => ({ running: { since, items: 3, last: 'Reading package.json' }, error: null }) });
  w.click(w.q('ways-of-working-analyze'));
  const shown = await waitFor(() => w.text(w.q('ways-of-working-activity')).includes('Reading package.json'));
  assert.equal(w.q('ways-of-working-loader') !== null, true, 'data-testid="ways-of-working-loader"');
  assert.equal(/\d/.test(w.text(w.q('ways-of-working-elapsed'))), true, 'the elapsed time');
  assert.equal(shown, true, 'the run state\'s last item as the current activity');
  held.resolve(clone(INTERVIEW));
  await settle();
});

test('#733 a failed analysis shows the reason and Retry, which runs it again', async (t) => {
  let n = 0;
  const w = await opened(t, { interview: async () => { n++; if (n === 1) throw new Error('git log failed: not a repository'); return clone(INTERVIEW); } });
  w.click(w.q('ways-of-working-analyze'));
  await settle();
  assert.equal(w.text(w.q('ways-of-working-error')).includes('git log failed: not a repository'), true, 'the reason');
  w.click(w.q('ways-of-working-retry'));
  await settle();
  assert.equal(w.calls.interview, 2);
});

test('#733 reopening the drawer while the analysis runs shows the loader again, from the service\'s state', async (t) => {
  const since = new Date(Date.now() - 5e3).toISOString();
  const w = await opened(t, { last: null, runState: () => ({ running: { since, items: 1, last: 'git shortlog' }, error: null }) });
  assert.equal(await waitFor(() => w.q('ways-of-working-loader') !== null), true, 'the loader is shown');
  assert.equal(w.calls.interview, 0, 'no second analysis started');
});

// ---- criterion 4: the project's chosen workflows ----------------------------------------------------

test('#733 the project\'s chosen workflows are shown as the current set', async (t) => {
  const project = { ...PROJECT, workflows: [{ name: 'feature', category: 'feature', variant: 'local' }, { name: 'fix', category: 'fix' }], defaultWorkflow: 'feature' };
  const w = await opened(t, { last: LAST }, project);
  assert.equal(w.q('ways-of-working-current-set') !== null, true, 'data-testid="ways-of-working-current-set"');
  assert.deepEqual(w.qa('ways-of-working-current-workflow').map((el) => el.getAttribute('data-name')), ['feature', 'fix']);
});

// ---- criterion 5: never analyzed --------------------------------------------------------------------

test('#733 with no analysis yet the drawer shows the first screen: the intro, the cost and Analyze', async (t) => {
  const w = await opened(t, { last: null });
  assert.equal(w.calls.last >= 1, true, 'the drawer looked for a saved analysis (api.workflowInterviewLast)');
  assert.equal(w.q('ways-of-working-analyze') !== null, true, 'Analyze');
  assert.equal(w.text(w.q('ways-of-working-estimate')).includes('0.10'), true, 'the cost');
  assert.equal(w.q('ways-of-working-analyze-again') === null, true, 'no "Analyze again"');
  assert.equal(w.q('ways-of-working-profile') === null, true, 'no profile');
  assert.equal(w.calls.interview, 0);
});
