// #310: the workflow filter of Workflows › Runs (fronts/build/views/workflows/workflows.js with the
// shared list of packages/ui-kit/run-list.js). The Runs tab shows a <select data-testid="runs-workflow-filter">
// beside the status chips: "All workflows" and each workflow of the service's `workflows` answer
// ({ workflow, count }) with its count. Picking one loads the list again with `workflow` set
// (api.listRuns, runs:list); the choice stays across tab visits and is not saved for the next start.
// The views are the real page (test/renderer-app-harness.js loads index.html's scripts in a vm); the
// fake DOM parses nothing, so the control is found in the markup strings the view produced.
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadApp, text } = require('@craftorio/ui-kit/test/renderer-app-harness');

const SD = 'software-development.yaml';
const BF = 'bug-fix.yaml';
const row = (runId, file) => ({ runId, id: runId, workflow: file.replace(/\.yaml$/, ''), file, status: 'success', sessions: [], startedAt: '2026-10-01T10:00:00Z' });

// api.listRuns: the runs of the asked workflow (or every one), with the per-workflow counts.
function listRunsStub() {
  const runs = [row('sd1', SD), row('sd2', SD), row('sd3', SD), row('bf1', BF)];
  return async (opts = {}) => {
    if (Array.isArray(opts.ids)) return { runs: runs.filter((r) => opts.ids.includes(r.runId)) };
    const shown = opts.workflow ? runs.filter((r) => r.file === opts.workflow) : runs;
    return {
      runs: shown, total: shown.length, nextOffset: shown.length, hasMore: false, hiddenSim: 0,
      counts: { all: shown.length, running: 0, success: shown.length, failed: 0 },
      workflows: [{ workflow: SD, count: 3 }, { workflow: BF, count: 1 }],
    };
  };
}

async function openRuns(app) {
  await app.boot();
  app.run("state.workflowsTab = 'runs'; showView('workflows')");
  await app.settle(20);
}

// Every markup string the page holds: the views' markup and what was rendered into each element.
function allMarkup(app) {
  const own = [...app.defs.values()].map((d) => d.markup || '');
  const rendered = [...app.elements.values(), ...app.created].map((el) => String(el.innerHTML || ''));
  return [...own, ...rendered];
}

// The workflow filter: its opening tag, its options' markup, and the fake element its handler sits on.
function findFilter(app) {
  const tagRe = /<select\b[^>]*data-testid="runs-workflow-filter"[^>]*>/;
  for (const html of allMarkup(app)) {
    const m = tagRe.exec(html);
    if (!m) continue;
    const tag = m[0];
    const close = html.indexOf('</select>', m.index);
    const inline = close > 0 ? html.slice(m.index + tag.length, close) : '';
    const id = /\bid="([^"]+)"/.exec(tag)?.[1];
    // the element the view wired: its own #id, else whichever fake element has a change handler on it
    let el = id ? app.el(`#${id}`) : null;
    if (!el || !(el.onchange || el.oninput || el.listeners.change || el.listeners.input)) {
      const known = new Set(['#workflow-show-sim', '#workflow-run-search', '#wf-search']);
      el = [...app.elements.entries()].filter(([key]) => !known.has(key)).map(([, e]) => e)
        .concat(app.created)
        .find((e) => (e.onchange || e.listeners.change) && (e.key !== '' || e.tagName === 'SELECT') && /runs-workflow-filter|workflow/i.test(`${e.key} ${e.id} ${JSON.stringify(e.dataset)} ${JSON.stringify(e.attrs)}`)) || el;
    }
    return { tag, options: inline || String(el?.innerHTML || ''), el };
  }
  return null;
}

// Picks `value` in the filter: its change (or input) handlers, then the delegated ones of its box and the document.
async function pick(app, el, value) {
  el.value = value;
  const ev = { type: 'change', target: el, currentTarget: el, preventDefault() {}, stopPropagation() { this.stopped = true; } };
  await el.onchange?.(ev);
  for (const fn of el.listeners.change || []) await fn(ev);
  if (!el.onchange && !(el.listeners.change || []).length) {
    await el.oninput?.(ev);
    for (const fn of el.listeners.input || []) await fn(ev);
  }
  for (const box of ['#workflow-run-filters', '#view-workflows']) {
    if (ev.stopped) break;
    const b = app.el(box);
    await b.onchange?.(ev);
    for (const fn of b.listeners.change || []) await fn(ev);
  }
  await app.settle(20);
}

const listCalls = (app) => app.callsTo('listRuns').map(([opts]) => opts || {}).filter((o) => !Array.isArray(o.ids));
const lastWorkflow = (app) => { const c = listCalls(app); return c.length ? (c[c.length - 1].workflow || '') : null; };

test('the Runs tab shows a workflow filter (a <select>): "All workflows" and each workflow with its run count', async () => {
  const app = loadApp({ api: { listRuns: listRunsStub() } });
  await openRuns(app);
  const filter = findFilter(app);
  assert.ok(filter, 'no <select data-testid="runs-workflow-filter"> in the Runs tab');
  assert.match(text(filter.options), /All workflows/);
  for (const [file, count] of [[SD, 3], [BF, 1]]) {
    const opt = new RegExp(`<option\\b[^>]*value="${file.replace(/\./g, '\\.')}"[^>]*>([^<]*)</option>`).exec(filter.options);
    assert.ok(opt, `no option for ${file}`);
    assert.match(opt[1], new RegExp(`\\b${count}\\b`), `the option of ${file} shows its count`);
  }
});

test('picking a workflow loads the list again with { workflow } set; "All workflows" clears it', async () => {
  const app = loadApp({ api: { listRuns: listRunsStub() } });
  await openRuns(app);
  assert.equal(lastWorkflow(app), '', 'the first load asks for every workflow');
  const filter = findFilter(app);
  assert.ok(filter?.el, 'no workflow filter to pick from');

  const before = listCalls(app).length;
  await pick(app, filter.el, SD);
  assert.ok(listCalls(app).length > before, 'picking a workflow reloads the list');
  assert.equal(lastWorkflow(app), SD);
  const last = listCalls(app).at(-1);
  assert.equal(last.offset, 0, 'from the first page');

  await pick(app, filter.el, '');
  assert.equal(lastWorkflow(app), '', '"All workflows" asks for every workflow again');
});

test('the picked workflow combines with the status chip and the search in the same request', async () => {
  const app = loadApp({ api: { listRuns: listRunsStub() } });
  await openRuns(app);
  const filter = findFilter(app);
  assert.ok(filter?.el, 'no workflow filter to pick from');
  app.run("state.wr.filter = 'failed'; state.wr.q = 'login'; state.wr.showSim = true");
  await pick(app, filter.el, BF);
  const last = listCalls(app).at(-1);
  assert.equal(last.workflow, BF);
  assert.equal(last.filter, 'failed');
  assert.equal(last.q, 'login');
  assert.equal(last.showSim, true);
});

test('the picked workflow stays after another tab and back, and is not saved for the next start', async () => {
  const app = loadApp({ api: { listRuns: listRunsStub() } });
  await openRuns(app);
  const filter = findFilter(app);
  assert.ok(filter?.el, 'no workflow filter to pick from');
  await pick(app, filter.el, SD);

  app.run("showWorkflowsTab('definitions')");
  await app.settle(20);
  const before = listCalls(app).length;
  app.run("showWorkflowsTab('runs')");
  await app.settle(20);
  assert.ok(listCalls(app).length > before, 'back on Runs, the list loads');
  assert.equal(lastWorkflow(app), SD, 'still the picked workflow');

  const saved = [...app.sandbox.localStorage.store.values()].some((v) => v.includes(SD));
  assert.equal(saved, false, 'the choice is not in localStorage: an app restart starts on "All workflows"');

  const restarted = loadApp({ api: { listRuns: listRunsStub() } });
  await openRuns(restarted);
  assert.equal(lastWorkflow(restarted), '');
});

test('a workflow with no runs shows the list\'s empty message, not an error', async () => {
  const empty = async () => ({ runs: [], total: 0, nextOffset: 0, hasMore: false, hiddenSim: 0, counts: { all: 0, running: 0, success: 0, failed: 0 }, workflows: [{ workflow: SD, count: 3 }] });
  const app = loadApp({ api: { listRuns: empty } });
  await openRuns(app);
  const filter = findFilter(app);
  assert.ok(filter?.el, 'no workflow filter to pick from');
  await pick(app, filter.el, BF);
  assert.equal(lastWorkflow(app), BF);
  assert.equal(app.el('#workflow-runs-error').textContent, '', 'no error line');
  assert.doesNotMatch(app.el('#workflow-runs').innerHTML, /Could not load/);
  assert.match(text(app.el('#workflow-runs').innerHTML), /No workflows have run yet|No runs match/);
});

test('a picked workflow the service no longer lists stays an option with count 0, and the list says no runs match', async () => {
  // e.g. its only runs were simulated and "Show simulated" went off
  const empty = async () => ({ runs: [], total: 0, nextOffset: 0, hasMore: false, hiddenSim: 0, counts: { all: 0, running: 0, success: 0, failed: 0 }, workflows: [{ workflow: SD, count: 3 }] });
  const app = loadApp({ api: { listRuns: empty } });
  await openRuns(app);
  await pick(app, findFilter(app).el, BF);
  const options = String(app.el('#workflow-run-workflow').innerHTML);
  const opt = /<option\b[^>]*value="bug-fix\.yaml"[^>]*>([^<]*)<\/option>/.exec(options);
  assert.ok(opt, 'the picked workflow is still an option');
  assert.match(opt[1], /\(0\)/);
  assert.match(opt[0], /selected/);
  assert.match(text(app.el('#workflow-runs').innerHTML), /No runs match this filter/);
  assert.equal(app.el('#workflow-runs-error').textContent, '');
});

test('opening a run in the list (showRunInList) clears the picked workflow', async () => {
  const app = loadApp({ api: { listRuns: listRunsStub() } });
  await openRuns(app);
  await pick(app, findFilter(app).el, BF);
  assert.equal(lastWorkflow(app), BF);
  app.run("showRunInList('sd1')");
  await app.settle(20);
  assert.equal(lastWorkflow(app), '', 'the run shows whatever workflow it ran');
});
