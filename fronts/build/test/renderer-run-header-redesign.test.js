// The Run screen's tab row after the redesign (2026-11-28, the owner's Claude Design proposal): the run's title
// leads the row; a live run at a human gate reads "Waiting for you"; at most two actions show as buttons, the
// one the run's state calls for first, and every other action is an entry of the row's ⋮ menu with its old id;
// the run's stations (the Roadmap lane's) and its time and cost sit under the row; a failed run's banner says
// where it stopped and carries Resume from step… (the accent button) and Ask the supervisor.
// The page is the real one (test/renderer-app-harness.js), as in renderer-run-tabs-410.test.js.
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('@craftorio/ui-kit/test/renderer-app-harness');

/** The Run screen showing run r1 → { app, el(id) (the fake element, or null) }. */
async function runScreen({ status = 'running', past = false, events = [], gate = false, trail = [] } = {}) {
  const app = loadApp({ api: { runChain: async () => null, listActiveRuns: async () => [], listRuns: async () => ({ runs: [] }) } });
  await app.boot();
  app.sandbox.__run = { id: 'r1', status, title: 'Add a /health endpoint', startedAt: Date.now() - 90000, finishedAt: status === 'running' ? null : Date.now(), workflow: 'software-development', file: 'software-development.yaml', inputs: {} };
  app.sandbox.__events = events;
  app.sandbox.__past = past;
  app.sandbox.__gate = gate;
  app.sandbox.__trail = trail;
  app.run(`(() => {
    const v = newRunView(); v.past = __past; v.run = __run; v.events = __events;
    if (__gate) v.approvals.set('a1', { approval_id: 'a1', run_id: 'r1', step_id: 'developer_check', message: 'Check it', choices: [{ id: 'approve', label: 'Approve' }] });
    if (__trail.length) { v.trail = new RunProgress.StepTrail(); for (const ev of __trail) v.trail.apply(ev); }
    state.runs.set('r1', v); state.runId = 'r1';
  })()`);
  app.run("showView('run')");
  await app.settle();
  app.run('render()');
  await app.settle();
  const el = (id) => app.created.find((c) => c.id === id) || app.elements.get(`#${id}`) || null;
  return { app, el };
}
const html = (e) => String(e?.innerHTML || '');
const plan = (app, r, ids, opts) => JSON.parse(app.run(`JSON.stringify(runActionPlan(${JSON.stringify(r)}, ${JSON.stringify(ids)}, ${JSON.stringify(opts || {})}))`));

test('runActionPlan: a live run shows no action button (Pause and Stop are the row\'s own), all go to ⋮', async () => {
  const { app } = await runScreen();
  const p = plan(app, { status: 'running' }, ['btn-run-sup', 'btn-run-watch', 'btn-run-diff', 'btn-run-analytics']);
  assert.deepEqual(p.buttons, []);
  assert.deepEqual(p.menu, ['btn-run-sup', 'btn-run-watch', 'btn-run-diff', 'btn-run-analytics']);
});

test('runActionPlan: a failed run leaves Resume and the supervisor to its fail banner: no button on the row', async () => {
  const { app } = await runScreen();
  const p = plan(app, { status: 'failed' }, ['btn-run-sup', 'btn-run-resume', 'btn-run-analytics'], { failBanner: true });
  assert.deepEqual(p.buttons, []);
  assert.equal(p.menu.length, 3, 'nothing is gone: every action is a ⋮ entry');
});

test('runActionPlan: an ended run with changes leads with Review changes (accent), then Resume from step…', async () => {
  const { app } = await runScreen();
  const p = plan(app, { status: 'success' }, ['btn-run-sup', 'btn-run-resume', 'btn-run-diff', 'btn-run-analytics', 'btn-run-replay-map'], { past: true });
  assert.deepEqual(p.buttons, ['btn-run-diff', 'btn-run-resume']);
  assert.equal(p.primary, true);
  assert.deepEqual(p.menu, ['btn-run-sup', 'btn-run-analytics', 'btn-run-replay-map']);
});

test('runActionPlan: an ended run without changes leads with Resume from step…, then Ask the supervisor', async () => {
  const { app } = await runScreen();
  assert.deepEqual(plan(app, { status: 'cancelled' }, ['btn-run-sup', 'btn-run-resume', 'btn-run-analytics'], { past: true }).buttons, ['btn-run-resume', 'btn-run-sup']);
});

test('runActionPlan: an accepted Write & Review run leads with Save to issue', async () => {
  const { app } = await runScreen();
  assert.deepEqual(plan(app, { status: 'success' }, ['btn-run-sup', 'btn-run-resume', 'btn-run-save-issue', 'btn-run-analytics'], { past: true }).buttons, ['btn-run-save-issue']);
});

test('the tab row: a finished run with changes shows Review changes as the accent button and the rest in a closed ⋮ menu', async () => {
  const { el } = await runScreen({ status: 'success', past: true, events: [{ type: 'worktree.ready', run_id: 'r1' }] });
  const row = html(el('run-actions'));
  assert.match(row, /<button type="button" class="btn sm primary" id="btn-run-diff"/);
  assert.match(row, /data-testid="run-actions-more"[^>]*>⋮<\/button>/);
  assert.match(row, /<div class="run-actions-pop hidden" data-run-more-pop>/, 'the menu is closed');
  assert.match(row, /role="menuitem"[^>]*id="btn-run-analytics"/, 'Open in Analytics is a ⋮ entry with its old id');
  assert.match(row, /aria-haspopup="menu" aria-expanded="false"/);
});

test('the tab row: the run\'s title, its workflow and Simulated lead the row (the Workflow panel no longer repeats them)', async () => {
  const { el } = await runScreen({ status: 'success', past: true });
  const title = html(el('run-screen-title'));
  assert.match(title, /data-testid="run-title-text"[^>]*>Add a \/health endpoint</);
  assert.match(title, /software-development/);
  assert.doesNotMatch(html(el('run-summary')), /run-title-text/);
});

test('a live run at a human gate reads "Waiting for you" (data-status="waiting"), as the run chat and the Roadmap say it', async () => {
  const { el } = await runScreen({ status: 'running', gate: true });
  const pill = el('run-screen-status');
  assert.equal(pill.dataset.status, 'waiting');
  assert.equal(pill.textContent, 'Waiting for you');
});

test('a live run with no gate keeps "Running" (data-status="running")', async () => {
  const { el } = await runScreen({ status: 'running' });
  assert.equal(el('run-screen-status').dataset.status, 'running');
});

test('the stations row shows the run\'s time and cost', async () => {
  const { el } = await runScreen({ status: 'success', past: true });
  assert.match(String(el('run-stats').textContent), /\$|US\$/);
});

test('a failed run\'s banner: where it stopped (the trail\'s last step), Resume from step… as the accent button and Ask the supervisor', async () => {
  const ts = new Date().toISOString();
  const trail = [{ type: 'step.started', step_id: 'secret_scan', ts, run_id: 'r1' }];
  const { el } = await runScreen({ status: 'failed', past: true, trail });
  const banner = html(el('run-fail-banner'));
  assert.match(banner, /data-testid="run-fail-where">Stopped at /);
  assert.match(banner, /class="btn sm primary" id="btn-banner-resume"/);
  assert.match(banner, /id="btn-banner-sup"/);
});
