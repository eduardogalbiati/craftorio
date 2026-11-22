// #266: the screens beyond the roadmap and the kanban show readable statuses through StatusPill:
// the usage widget's recent runs table, the supervisor drawer's run line, the resume dialog's run
// line, the Run screen's child runs, the Oracle's run notices and the pipeline strip
// (chain-model.js). Each keeps the raw id in data-status and never shows it as text.
// The page surfaces go through test/agent-chat-page-harness.js (the whole page in one sandbox).
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadPage, openOracle, settle } = require('./agent-chat-page-harness');

// the statuses and the label each must read
const LABELS = [['succeeded', 'Succeeded'], ['failed', 'Failed'], ['interrupted', 'Interrupted'], ['stopped', 'Stopped'], ['running', 'Running']];

const stripTags = (html) => String(html).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
// the label of each data-status pill in the markup, in order: [id, visible text]
function pills(html) {
  const out = [];
  const re = /<span class="pill[^"]*" data-status="([^"]*)"[^>]*>([\s\S]*?)<\/span>(<\/span>)?/g;
  for (let m; (m = re.exec(html));) out.push([m[1], stripTags(m[2])]);
  return out;
}

test.describe('readable statuses on the other screens (#266)', () => {
  let page;
  test.before(async () => { page = await loadPage(); });

  test('the usage widget\'s recent runs table shows each run status as its label', () => {
    const runs = LABELS.map(([status], i) => ({ runId: `r${i}`, workflow: 'Software development', status, startedAt: '2026-10-04T10:00:00Z', tokens: 10, costUsd: 0.1 }));
    page.sandbox.__runs = runs;
    const html = page.run('runsTableHtml({ runs: __runs, providers: [] })');
    assert.deepEqual(pills(html), LABELS);
    const cells = stripTags(html);
    for (const [id] of LABELS) assert.equal(new RegExp(`\\b${id}\\b`).test(cells), false, `no raw "${id}" in the table text`);
  });

  test('the supervisor drawer\'s run line shows the run status as its label', () => {
    page.run("state.sup = Object.assign({}, state.sup, { runId: '20261004-1', workflow: 'Software development', status: 'interrupted', issues: [], loading: false, result: null, error: null })");
    page.run('renderSupervisor()');
    const html = page.$('#sup-run').innerHTML;
    assert.deepEqual(pills(html), [['interrupted', 'Interrupted']]);
    assert.equal(/\binterrupted\b/.test(page.$('#sup-run').textContent), false);
  });

  test('the Run screen\'s child runs show each child status as its label', () => {
    page.sandbox.__run = { childRuns: [
      { run_id: 'c1', workflow: 'wf', step_id: 'fan', index: 0, status: 'succeeded' },
      { run_id: 'c2', workflow: 'wf', step_id: 'fan', index: 1, status: 'failed' },
      { workflow: 'wf', step_id: 'fan', index: 2, status: 'queued' },
    ] };
    const html = page.run('childRunsStrip(__run)');
    assert.deepEqual(pills(html), [['succeeded', 'Succeeded'], ['failed', 'Failed'], ['queued', 'Queued']]);
  });
});

test('the resume dialog shows the run status as its label', async () => {
  const page = await loadPage({ api: { resumeOptions: async (runId) => ({ runId, workflow: 'Software development', status: 'stopped', active: true, steps: [] }) } });
  await page.sandbox.openResumeDialog('20261004-2');
  await settle();
  const html = page.$('#resume-run').innerHTML;
  assert.deepEqual(pills(html), [['stopped', 'Stopped']]);
  assert.equal(/\bstopped\b/.test(page.$('#resume-run').textContent), false);
});

test('an Oracle run notice leads with the readable status, the id kept in data-status', async () => {
  const page = await openOracle({
    oracleHistory: async () => [{ kind: 'notice', status: 'failed', runId: '20261004-3', text: 'Run 20261004-3 failed at Code review.', ts: '2026-10-04T12:00:00Z' }],
  });
  const notice = page.$('[data-testid="oracle-run-notice"]');
  assert.equal(notice === null, false, 'the notice is drawn');
  const pill = notice.querySelector('[data-status]');
  assert.equal(pill === null, false, 'the notice has a status pill');
  assert.equal(pill.getAttribute('data-status'), 'failed');
  assert.equal(pill.textContent.trim(), 'Failed');
});

test('the pipeline strip shows each stage run status as its label, queued when it has none', () => {
  const had = Object.prototype.hasOwnProperty.call(globalThis, 'StatusPill');
  globalThis.StatusPill = require('../status-pill');
  try {
    const chain = require('@craftorio/shared/chain-model');
    const html = chain.pipelineStagesHtml(
      { stages: [{ workflow: 'a.yaml' }, { workflow: 'b.yaml' }, { workflow: 'c.yaml' }] },
      { names: { 'a.yaml': 'Stage A', 'b.yaml': 'Stage B', 'c.yaml': 'Stage C' }, runs: [{ runId: 'r1', status: 'succeeded' }, { runId: 'r2', status: 'running' }, {}] },
    );
    assert.deepEqual(pills(html), [['succeeded', 'Succeeded'], ['running', 'Running'], ['queued', 'Queued']]);
    assert.match(html, /class="status-dot"/, 'a running stage leads with the pulsing dot');
  } finally {
    if (!had) delete globalThis.StatusPill;
  }
});

// #437: a status pill stays on one line (style.css .pill: white-space: nowrap), its label too, in
// pt-BR. The pill's markup (StatusPill.statusPill) is cascaded with style.css by test/css-layout.js.
test('#437 a status pill and its label keep one line (white-space: nowrap), in pt-BR', (t) => {
  const I18n = require('@craftorio/shared/i18n.js');
  const { parseHtml, styleSheet, layoutOf, elements } = require('./css-layout.js');
  I18n.setLanguage('pt-BR');
  t.after(() => I18n.setLanguage('en'));
  const { statusPill } = require('../status-pill');
  const L = layoutOf(styleSheet(['style.css']));
  for (const status of ['success', 'running', 'waiting', 'local', 'parked', 'failed_to_start']) {
    const all = elements(parseHtml(statusPill(status)));
    const pill = all.find((e) => e.classes.has('pill'));
    const label = all.find((e) => e.attrs['data-testid'] === 'status-label');
    assert.ok(pill && label, `${status}: no pill or no label`);
    assert.equal(L.computed(pill).wrap, 'nowrap', `${status}: .pill wraps (no white-space: nowrap)`);
    assert.equal(L.computed(label).wrap, 'nowrap', `${status}: the pill's label wraps`);
  }
});
