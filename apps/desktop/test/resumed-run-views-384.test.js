// #384 review round 1: where else a resumed run says how it ended, and what the lookup costs.
//
// Seams:
// - StatusPill.runPill / resumedLink (packages/ui-kit/status-pill.js), pure: the pill and the link every
//   card that shows a run uses.
// - The Run screen's summary (#run-summary) and the Chat's finished note (run-chat-finished), through
//   the whole page (test/agent-chat-page-harness.js) with a fake api.listRuns.
// - runs.findRun (packages/engine/domains/run/runs.js) with the index open: a resume written just after a lookup is still
//   found; an unchanged runs folder is not listed again within 2 s (fs.readdirSync is the boundary).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { textOf } = require('@multiagent/ui-kit/test/mini-dom');
const { loadPage, settle } = require('@multiagent/ui-kit/test/agent-chat-page-harness');
const SP = require('@multiagent/ui-kit/status-pill.js');

const FAILED = '20261014-100000-failed01';
const RESUMED = '20261014-110000-resumed1';
const OTHER = '20261014-120000-other001';

// ---- StatusPill ----------------------------------------------------------------------------------

const attr = (html, name) => (html.match(new RegExp(`${name}="([^"]*)"`)) || [])[1] ?? null;
const text = (html) => html.replace(/<[^>]*>/g, '').trim();

test('#384 runPill: a run that ended without success and was resumed reads a neutral "Resumed", its own ending in the title', () => {
  for (const [status, label] of [['failed', 'Failed'], ['cancelled', 'Cancelled'], ['interrupted', 'Interrupted']]) {
    const html = SP.runPill(status, { runId: RESUMED, status: 'success' });
    assert.equal(text(html), 'Resumed', status);
    assert.equal(attr(html, 'data-status'), 'resumed', status);
    assert.doesNotMatch(attr(html, 'class') || '', /pill-failed/, status);
    assert.match(attr(html, 'title') || '', new RegExp(label), status);
  }
});

test('#384 runPill: a run that succeeded keeps its Succeeded pill even when a later run resumed it', () => {
  const html = SP.runPill('success', { runId: RESUMED, status: 'running' });
  assert.equal(attr(html, 'data-status'), 'success');
  assert.equal(html, SP.statusPill('success'));
});

test('#384 runPill: a failed run nobody resumed keeps its Failed pill', () => {
  assert.equal(SP.runPill('failed', null), SP.statusPill('failed'));
  assert.equal(attr(SP.runPill('failed', undefined), 'data-status'), 'failed');
});

test('#384 resumedLink: names the resumed run and how it is doing; nothing without a resume', () => {
  for (const [status, word] of [['success', 'succeeded'], ['running', 'running'], ['failed', 'failed']]) {
    const html = SP.resumedLink({ runId: RESUMED, status });
    assert.equal(attr(html, 'data-testid'), 'run-resumed-link');
    assert.equal(attr(html, 'data-run'), RESUMED);
    assert.equal(text(html), `Resumed → ${word}`);
  }
  assert.equal(SP.resumedLink(null), '');
  assert.equal(SP.resumedLink({ status: 'success' }), '');
});

// ---- the Run screen ------------------------------------------------------------------------------

function rowsApi(byId) {
  return { listRuns: async ({ ids } = {}) => ({ runs: (ids || []).map((id) => ({ runId: id, id, status: 'failed', resumedBy: byId[id] || null })) }) };
}

async function runScreen(run, byId) {
  const page = await loadPage({ api: rowsApi(byId) });
  page.sandbox.__run = run;
  // the selected run view (app.js: state.run reads state.runs.get(state.runId).run)
  page.run('state.view = "run"; state.runs.set(__run.id, { ...newRunView(), run: __run, past: true }); state.runId = __run.id; renderRunSummary();');
  await settle(20);
  return page;
}
// the runs:list { ids } calls of the Run screen (the page's own lists ask without ids)
const idCalls = (page) => page.callsTo('listRuns').filter((a) => a[0]?.ids).map((a) => JSON.stringify(a[0]));

test('#384 Run screen: the summary of a failed run that was resumed links the resumed run', async () => {
  const page = await runScreen({ id: FAILED, status: 'failed', workflow: 'software-development', inputs: {} }, { [FAILED]: { runId: RESUMED, status: 'success' } });
  const link = page.$('#run-summary [data-testid="run-resumed-link"]');
  assert.equal(link === null, false, 'the summary has the resume link');
  assert.equal(link.getAttribute('data-run'), RESUMED);
  assert.equal(textOf(link).trim(), 'Resumed → succeeded');
  assert.deepEqual(idCalls(page), [JSON.stringify({ ids: [FAILED] })]);
});

test('#384 Run screen: a run nobody resumed shows no resume link', async () => {
  const page = await runScreen({ id: FAILED, status: 'failed', workflow: 'software-development', inputs: {} }, {});
  assert.equal(page.$('#run-summary [data-testid="run-resumed-link"]') === null, true);
});

test('#384 Run screen: a running run never asks which run resumed it', async () => {
  const page = await runScreen({ id: FAILED, status: 'running', workflow: 'software-development', inputs: {} }, { [FAILED]: { runId: RESUMED, status: 'success' } });
  assert.deepEqual(idCalls(page), []);
  assert.equal(page.$('#run-summary [data-testid="run-resumed-link"]') === null, true);
});

// ---- the Chat's finished note --------------------------------------------------------------------

function chatEvents(runId) {
  const ts = (s) => new Date(Date.parse('2026-10-14T10:00:00.000Z') + s * 1000).toISOString();
  return [
    { seq: 1, run_id: runId, type: 'workflow.started', ts: ts(0), workflow: 'software-development', file: 'software-development.yaml', inputs: { task: 'Fix the widget' }, mock: true },
    { seq: 2, run_id: runId, type: 'step.started', ts: ts(1), step_id: 'develop', agent: 'developer' },
    { seq: 3, run_id: runId, type: 'workflow.finished', ts: ts(60), status: 'failed', error: 'Merge failed', summary: { cost_usd: 0, duration_ms: 60000 } },
  ];
}

async function openChat(page, runId) {
  page.sandbox.openRunChat({ runId, workflow: 'software-development', running: false });
  await settle(20);
  const note = page.$('#rc-messages').querySelector('[data-testid="run-chat-finished"]');
  assert.equal(note === null, false, `the finished note of ${runId} is drawn`);
  return note;
}

test('#384 Chat: the finished note of a past failed run links the run that resumed it; another run opened next has no stale link', async () => {
  const page = await loadPage({ api: { runEvents: async (id) => chatEvents(typeof id === 'object' ? id.runId : id), ...rowsApi({ [FAILED]: { runId: RESUMED, status: 'running' } }) } });
  const note = await openChat(page, FAILED);
  const link = note.querySelector('[data-testid="run-resumed-link"]');
  assert.equal(link === null, false, 'the note has the resume link');
  assert.equal(link.getAttribute('data-run'), RESUMED);
  assert.equal(textOf(link).trim(), 'Resumed → running');

  const other = await openChat(page, OTHER);
  assert.equal(other.querySelector('[data-testid="run-resumed-link"]') === null, true, 'no link carried over from the previous run');
});

// ---- runs.findRun: the resume lookup ------------------------------------------------------------

function writeRun(runsDir, runId, { status, resumedFrom = null, startMs }) {
  const dir = path.join(runsDir, runId);
  fs.mkdirSync(dir, { recursive: true });
  const iso = (ms) => new Date(ms).toISOString();
  const inputs = { task: 'Fix the login page' };
  const started = {
    ts: iso(startMs), type: 'workflow.started', run_id: runId, workflow: 'fixture-service', file: 'fixture-service.yaml', mock: true, inputs,
    cost_accounting: 'per_turn', turn_cost: 'max_result', ...(resumedFrom ? { resumed_from: { run_id: resumedFrom, step: 'work' } } : {}),
  };
  const summary = { run_id: runId, workflow: 'fixture-service', status, mock: true, started_at: iso(startMs), finished_at: iso(startMs + 60000), duration_ms: 60000, cost_usd: 0, sessions: [], inputs };
  const events = [started, { ts: iso(startMs + 60000), type: 'workflow.finished', status, ...(status === 'failed' ? { error: 'Step work failed' } : {}), summary }];
  fs.writeFileSync(path.join(dir, 'summary.json'), JSON.stringify(summary));
  fs.writeFileSync(path.join(dir, 'events.jsonl'), `${events.map((e) => JSON.stringify(e)).join('\n')}\n`);
}

const T0 = Date.parse('2026-10-14T10:00:00.000Z');

test('#384 findRun: a resume written right after a lookup (within 2 s) is still found', async (t) => {
  const { makeService } = require('@multiagent/engine/test/service/helpers');
  const { service, api } = makeService(t);
  const runsDir = service.workspace().runs;
  writeRun(runsDir, FAILED, { status: 'failed', startMs: T0 });
  const first = await api['runs:list']({ ids: [FAILED] });
  assert.equal(first.runs[0]?.resumedBy ?? null, null, 'not resumed yet');
  writeRun(runsDir, RESUMED, { status: 'success', resumedFrom: FAILED, startMs: T0 + 3600e3 });
  const second = await api['runs:list']({ ids: [FAILED] });
  assert.deepEqual([second.runs[0]?.resumedBy?.runId ?? null, second.runs[0]?.resumedBy?.status ?? null], [RESUMED, 'success']);
});

test('#384 findRun: an unchanged runs folder is not listed again within 2 s', async (t) => {
  const { makeService } = require('@multiagent/engine/test/service/helpers');
  const { service, api } = makeService(t);
  const runsDir = service.workspace().runs;
  writeRun(runsDir, FAILED, { status: 'failed', startMs: T0 });
  const listed = [];
  const real = fs.readdirSync;
  t.mock.method(fs, 'readdirSync', function (p, ...rest) {
    if (path.resolve(String(p)) === path.resolve(runsDir)) listed.push(p);
    return real.call(this, p, ...rest);
  });
  await api['runs:list']({ ids: [FAILED] });
  assert.ok(listed.length > 0, 'the first lookup of a failed run looks for a fresh resume in the runs folder');
  listed.length = 0;
  await api['runs:list']({ ids: [FAILED] });
  await api['runs:list']({ ids: [FAILED] });
  assert.equal(listed.length, 0, 'the runs folder was not listed again');
});
