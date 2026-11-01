// #282 Roadmap card redesign. Acceptance tests written before the code.
// fronts/build/views/backlog/backlog-roadmap.js is evaluated whole in a vm sandbox
// (test/roadmap-status-helpers.js loadRoadmap, fixed clock); the workflows come from api.listWorkflows,
// built here from the bundled workflows/*.yaml (the service's list shape plus each workflow's groups
// and its steps' own fields); clicks go through BacklogRoadmap.onClick with targets built from the
// rendered markup (their closest() walks the real ancestors).
//
// The testid contract (shared with the E2E agent):
// - item `roadmap-item`; issues footer `roadmap-issues-foot` ("4 issues · complexity 9");
// - meters `roadmap-meter-cost` / `roadmap-meter-time`, `data-verdict` = estimate | none | over | ok;
//   the live timer `roadmap-run-timer` sits in the time meter, the only timer of the card;
// - status block `roadmap-status`: the pill, `roadmap-progress-step`, `roadmap-round` ("Round 2 · fix
//   round after Review", never truncated), Waiting for you, Retry / Skip, ↑ ↓ Remove;
// - workflow band `roadmap-workflow`: `roadmap-workflow-name`, the mode toggle `roadmap-mode`
//   (buttons data-mode="auto" | "validated", aria-pressed, disabled while it runs with "locked while it
//   runs"), "Open run →" (`run-chip`, data-run), Simulated;
// - pipeline `roadmap-pipeline` of `roadmap-station` (data-step, data-state done | running | back |
//   todo | gate): "working…", "×2", "asked for fixes", "next" (running item) or "—" (planned item);
//   Validated adds a gate station "Your check" right after Develop; a click on a station opens the run;
// - stage head: `roadmap-stage-menu` (⋮, aria-label "Stage actions", aria-haspopup) opening a menu
//   (role="menuitem") with Release here, Run this stage, Run earlier, Run later, add note, Disable.
// Not testable here: the widths (540px at 1200px), the responsive layouts, screenshots, contrast.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const H = require('./roadmap-status-helpers');

const HERO = 'feature.yaml';
const DEV_WORKFLOWS = ['feature.yaml', 'fix.yaml'];

// a bundled workflow as api.listWorkflows gives it (packages/engine/service/areas/workflows.js), with its groups
function wfEntry(file) {
  const { loadWorkflow } = require('@multiagent/engine/engine/workflow');
  const wf = loadWorkflow(path.join(__dirname, '..', '..', '..', 'workflows', file));
  return {
    file,
    name: wf.metadata?.name || file,
    description: wf.metadata?.description,
    inputs: wf.inputs || {},
    outputs: wf.outputs || {},
    groups: wf.groups || [],
    agents: Object.fromEntries(Object.entries(wf.agents || {}).map(([k, a]) => [k, { provider: a.provider, model: a.model, ...(a.display ? { display: a.display } : {}) }])),
    steps: wf.steps.map((s) => ({
      ...s,
      type: s.type || 'agent',
      agent: s.agents ? s.agents.join(' · ') : s.agent || null,
      next: [...new Set((s.transitions || []).map((x) => x.goto).filter(Boolean))],
    })),
  };
}
const humanSteps = (file) => wfEntry(file).steps.filter((s) => s.type === 'human_approval').map((s) => s.id);

const view = { showAll: true, since: 'total' };
const recent = H.iso(H.NOW - H.HOUR);
const ISSUES = [[101, 'Login page', 2], [102, 'Logout button', 2], [103, 'Reset password', 2], [104, 'Remember me', 3]];
const backlogIssues = ISSUES.map(([number, title, c]) => ({ number, title, state: 'open', url: `https://github.com/o/r/issues/${number}`, labels: [{ name: `complexity:${c}` }] }));
const fourIssues = () => ISSUES.map(([n, title]) => H.ref(n, title));
const ESTIMATE = { usd: 5, minutes: 60, runs: 12, complexity: 9, estimated: false, basis: 'Median of the last 12 successful runs', timeBasis: 'From 12 past runs' };

const card = (extra = {}) => ({
  id: 'a', status: 'planned', workflow: HERO, workflowName: 'Software development, local hero', inputs: {}, mock: false,
  issues: fourIssues(), origin: recent, runId: null, runs: [], error: null, ...extra,
});
const one = (x, roadmap = {}) => ({ roadmap: { state: 'planned', stages: [{ id: 'st1', name: '', note: '', items: [x] }], ...roadmap }, issues: backlogIssues });

// a run in its fix round: develop done, code review sent it back, develop again (visit 2)
const dev = () => [{ agent: 'developer', provider: 'claude', model: 'claude-sonnet-5', cost: 0.1, durationMs: 1000 }];
const step = (id, status, at, extra = {}) => ({ step: id, status, ts: H.iso(at), agents: dev(), ...(status === 'running' || status === 'waiting' ? {} : { durationMs: 5 * H.MIN }), ...extra });
const TYPICAL = { develop: 10 * H.MIN, code_review: 5 * H.MIN, test: 5 * H.MIN, suite: 5 * H.MIN, build: 5 * H.MIN, verify_change: 5 * H.MIN };
function runningCard(extra = {}) {
  const start = H.NOW - 20 * H.MIN;
  const progress = [
    step('develop', 'done', start, { durationMs: 10 * H.MIN }),
    step('code_review', 'done', start + 10 * H.MIN, { durationMs: 5 * H.MIN }),
    step('develop', 'running', start + 15 * H.MIN, { visit: 2 }),
  ];
  return card({
    status: 'running', runId: 'run-9', runs: ['run-9'], estimate: ESTIMATE, actualUsd: 9, actualMinutes: 20,
    run: H.run({ status: 'running', workflow: HERO, startedAt: H.iso(start), progress, groups: wfEntry(HERO).groups, stepTimes: TYPICAL, history: 12 }),
    ...extra,
  });
}

// a roadmap module whose workflows are loaded (the first draw asks api.listWorkflows)
// (the app's run title, run-meta.js: the first issue's title and "(+n)" for the others)
const runTitle = (r) => `${r.issues?.[0]?.title || r.workflow}${r.issues?.length > 1 ? ` (+${r.issues.length - 1})` : ''}`;
async function ready() {
  const loaded = H.loadRoadmap({ listWorkflows: async () => DEV_WORKFLOWS.map(wfEntry), runTitle });
  const saved = [];
  loaded.sandbox.api.saveRoadmap = async (projectId, stages, label) => {
    saved.push({ stages: H.clone(stages), label: label ?? null });
    return { roadmap: { state: 'planned', stages }, issues: backlogIssues };
  };
  loaded.R.html(H.roadmapOf([]), () => {});
  await H.settle();
  await H.settle();
  return { ...loaded, saved };
}
const draw = (R, d) => R.html(d, () => {}, view);

const byTestId = (html, id) => H.findEl(html, (e) => e.attrs['data-testid'] === id);
const allByTestId = (html, id) => H.findAll(html, (e) => e.attrs['data-testid'] === id);
function part(html, itemId, testid) {
  const el = byTestId(H.itemEl(html, itemId).outer, testid);
  assert.ok(el, `item ${itemId} has a [data-testid="${testid}"]`);
  return el;
}
const text = (el) => H.visibleText(el.inner);
function stations(html, itemId = 'a') {
  const pipe = part(html, itemId, 'roadmap-pipeline');
  return allByTestId(pipe.outer, 'roadmap-station').map((e) => ({ step: e.attrs['data-step'] || '', state: e.attrs['data-state'] || '', text: text(e) }));
}
const isDevelop = (s) => s.step.toLowerCase() === 'develop';

// ---- a planned item ---------------------------------------------------------------------------------

test('#282 planned item with an estimate: both meters say estimate', async () => {
  const { R } = await ready();
  const html = draw(R, one(card({ estimate: ESTIMATE })));
  assert.deepEqual([part(html, 'a', 'roadmap-meter-cost').attrs['data-verdict'], part(html, 'a', 'roadmap-meter-time').attrs['data-verdict']], ['estimate', 'estimate']);
});

test('#282 planned item without an estimate: the meters say "no estimate yet" (verdict none)', async () => {
  const { R } = await ready();
  const html = draw(R, one(card({ estimate: null })));
  const cost = part(html, 'a', 'roadmap-meter-cost');
  const time = part(html, 'a', 'roadmap-meter-time');
  assert.deepEqual([cost.attrs['data-verdict'], time.attrs['data-verdict'], /no estimate yet/.test(text(cost))], ['none', 'none', true]);
});

test('#282 the issues column ends with "4 issues · complexity 9"', async () => {
  const { R } = await ready();
  assert.match(text(part(draw(R, one(card())), 'a', 'roadmap-issues-foot')), /4 issues · complexity 9/);
});

test('#282 the issues footer of one issue says "1 issue", without complexity when it is unknown', async () => {
  const { R } = await ready();
  const d = one(card({ issues: [H.ref(200, 'No label')] }));
  const foot = text(part(draw(R, d), 'a', 'roadmap-issues-foot'));
  assert.deepEqual([/\b1 issue\b/.test(foot), /issues/.test(foot), /complexity/.test(foot)], [true, false, false]);
});

test('#282 planned item: the status block holds the Planned pill with ↑ ↓ Remove', async () => {
  const { R } = await ready();
  const status = text(part(draw(R, one(card())), 'a', 'roadmap-status'));
  assert.deepEqual([/Planned/.test(status), status.includes('↑'), status.includes('↓'), /remove/i.test(status)], [true, true, true, true]);
});

test('#282 planned item: every pipeline station is todo and shows "—"', async () => {
  const { R } = await ready();
  const list = stations(draw(R, one(card())));
  assert.ok(list.length > 0, 'the pipeline has stations');
  assert.deepEqual(list.filter((s) => s.state !== 'todo' || !s.text.includes('—')), []);
});

test('#282 planned item: the mode toggle is enabled, Automatic pressed, in the workflow band', async () => {
  const { R } = await ready();
  const band = part(draw(R, one(card())), 'a', 'roadmap-workflow');
  const mode = byTestId(band.outer, 'roadmap-mode');
  assert.ok(mode, 'the mode toggle is inside the workflow band');
  const buttons = H.findAll(mode.outer, (e) => e.name === 'button' && 'data-mode' in e.attrs)
    .map((e) => [e.attrs['data-mode'], e.attrs['aria-pressed'], 'disabled' in e.attrs]);
  assert.deepEqual(buttons, [['auto', 'true', false], ['validated', 'false', false]]);
});

test('#282 the workflow band names the workflow', async () => {
  const { R } = await ready();
  const band = part(draw(R, one(card())), 'a', 'roadmap-workflow');
  const name = byTestId(band.outer, 'roadmap-workflow-name');
  assert.ok(name, 'roadmap-workflow-name in the band');
  assert.match(text(name), /local hero/i);
});

test('#282 a simulated item says Simulated in the workflow band', async () => {
  const { R } = await ready();
  assert.match(text(part(draw(R, one(card({ mock: true }))), 'a', 'roadmap-workflow')), /Simulated/);
});

test('#282 Automatic mode: no gate station in the pipeline', async () => {
  const { R } = await ready();
  assert.equal(stations(draw(R, one(card({ inputs: { mode: 'auto' } })))).filter((s) => s.state === 'gate').length, 0);
});

test('#282 Validated mode on a planned item: a gate station "Your check" right after Develop', async () => {
  const { R } = await ready();
  const list = stations(draw(R, one(card({ inputs: { mode: 'validated' } }))));
  const gates = list.map((s, i) => [s, i]).filter(([s]) => s.state === 'gate');
  assert.equal(gates.length, 1);
  assert.match(gates[0][0].text, /Your check/);
  assert.equal(gates[0][1], list.findIndex(isDevelop) + 1);
});

test('#282 clicking Validated saves the mode at once and the re-rendered pipeline has the gate station', async () => {
  const { R, saved } = await ready();
  const d = one(card({ inputs: { mode: 'auto' } }));
  const html = draw(R, d);
  const { ctx } = H.makeCtx();
  await R.onClick(H.clickOn(html, (e) => e.attrs['data-mode'] === 'validated'), ctx, d);
  assert.equal(saved.length, 1);
  assert.equal(saved[0].stages[0].items[0].inputs.mode, 'validated');
  const again = draw(R, one(saved[0].stages[0].items[0]));
  assert.equal(stations(again).filter((s) => s.state === 'gate').length, 1);
});

test('#282 clicking Automatic on a Validated item saves it and removes the gate station', async () => {
  const { R, saved } = await ready();
  const d = one(card({ inputs: { mode: 'validated' } }));
  const html = draw(R, d);
  const { ctx } = H.makeCtx();
  await R.onClick(H.clickOn(html, (e) => e.attrs['data-mode'] === 'auto'), ctx, d);
  assert.equal(saved.length, 1);
  assert.equal(saved[0].stages[0].items[0].inputs.mode, 'auto');
  assert.equal(stations(draw(R, one(saved[0].stages[0].items[0]))).filter((s) => s.state === 'gate').length, 0);
});

// ---- a running item (fix round) ------------------------------------------------------------------------

const running = (extra) => one(runningCard(extra), { state: 'running' });

test('#282 running item: exactly one live timer, inside the time meter', async () => {
  const { R } = await ready();
  const html = draw(R, running());
  const box = H.itemEl(html, 'a');
  const timers = allByTestId(box.outer, 'roadmap-run-timer');
  const meter = part(html, 'a', 'roadmap-meter-time');
  assert.deepEqual([timers.length, allByTestId(meter.outer, 'roadmap-run-timer').length], [1, 1]);
});

test('#282 running item: no "x of ≈ y" time badge outside the meters', async () => {
  const { R } = await ready();
  const box = H.itemEl(draw(R, running()), 'a').outer;
  const rest = H.dropWhere(box, (e) => ['roadmap-meter-time', 'roadmap-meter-cost'].includes(e.attrs['data-testid']));
  assert.equal(/of ≈/.test(H.visibleText(rest)), false);
});

test('#282 running item: the round reads in full "Round 2 · fix round after Review", never truncated', async () => {
  const { R } = await ready();
  const status = part(draw(R, running()), 'a', 'roadmap-status');
  const round = byTestId(status.outer, 'roadmap-round');
  assert.ok(round, 'roadmap-round inside roadmap-status');
  assert.match(text(round), /^Round 2 · fix round after (Code )?[Rr]eview$/);
  assert.equal(round.outer.includes('…'), false);
});

test('#282 running item: the status block shows the step name and no agent avatar', async () => {
  const { R } = await ready();
  const status = part(draw(R, running()), 'a', 'roadmap-status');
  const avatar = H.findEl(status.outer, (e) => e.attrs['data-testid'] === 'progress-agent' || /\brp-av\b/.test(e.attrs.class || ''));
  assert.deepEqual([!!byTestId(status.outer, 'roadmap-progress-step'), avatar === null], [true, true]);
});

test('#282 running item: the mode buttons are disabled and say "locked while it runs"', async () => {
  const { R } = await ready();
  const band = part(draw(R, running()), 'a', 'roadmap-workflow');
  const mode = byTestId(band.outer, 'roadmap-mode');
  assert.ok(mode, 'the mode toggle stays in the band');
  const buttons = H.findAll(mode.outer, (e) => e.name === 'button' && 'data-mode' in e.attrs);
  assert.deepEqual([buttons.length, buttons.every((e) => 'disabled' in e.attrs), /locked while it runs/.test(text(band))], [2, true, true]);
});

test('#282 running item: the running station says "working…" with its round "×2"', async () => {
  const { R } = await ready();
  const runningStations = stations(draw(R, running())).filter((s) => s.state === 'running');
  assert.equal(runningStations.length, 1);
  assert.deepEqual([isDevelop(runningStations[0]), runningStations[0].text.includes('working…'), runningStations[0].text.includes('×2')], [true, true, true]);
});

test('#282 running item: the station that sent it back says "asked for fixes"', async () => {
  const { R } = await ready();
  const back = stations(draw(R, running())).filter((s) => s.state === 'back');
  assert.equal(back.length, 1);
  assert.deepEqual([/review/i.test(back[0].step), back[0].text.includes('asked for fixes')], [true, true]);
});

test('#282 running item: the stations still to come say "next"', async () => {
  const { R } = await ready();
  const todo = stations(draw(R, running())).filter((s) => s.state === 'todo');
  assert.ok(todo.length > 0, 'stations to come');
  assert.deepEqual(todo.filter((s) => !s.text.includes('next')), []);
});

test('#282 running item over its cost estimate: the cost meter is "over" with ▲ and the percentage', async () => {
  const { R } = await ready();
  const cost = part(draw(R, running()), 'a', 'roadmap-meter-cost');
  assert.deepEqual([cost.attrs['data-verdict'], text(cost).includes('▲'), /\+\d+%/.test(text(cost))], ['over', true, true]);
});

test('#282 running item: the first issue\'s title appears once (no run chip line repeating it)', async () => {
  const { R } = await ready();
  const box = H.itemEl(draw(R, running()), 'a');
  assert.equal(H.visibleText(box.outer).split('Login page').length - 1, 1);
});

test('#282 running item: "Open run →" in the workflow band is the run chip of its run', async () => {
  const { R } = await ready();
  const band = part(draw(R, running()), 'a', 'roadmap-workflow');
  const link = byTestId(band.outer, 'run-chip');
  assert.ok(link, 'run-chip in the workflow band');
  assert.deepEqual([link.attrs['data-run'], /Open run/.test(text(link))], ['run-9', true]);
});

test('#282 a click on a station opens the run', async () => {
  const { R, sandbox } = await ready();
  const opened = [];
  sandbox.window.showRun = (id) => opened.push(String(id));
  const d = running();
  const html = draw(R, d);
  const { ctx } = H.makeCtx();
  await R.onClick(H.clickOn(H.itemEl(html, 'a').outer, (e) => e.attrs['data-testid'] === 'roadmap-station' && e.attrs['data-state'] === 'running'), ctx, d);
  assert.deepEqual(opened, ['run-9']);
});

// ---- waiting, failed, done -------------------------------------------------------------------------------

test('#282 an item waiting at a gate says "Waiting for you" in its status block', async () => {
  const { R } = await ready();
  const start = H.NOW - 15 * H.MIN;
  const progress = [step('develop', 'done', start, { durationMs: 10 * H.MIN }), step('developer_check', 'waiting', start + 10 * H.MIN, { type: 'human_approval', agents: [] })];
  const x = card({ status: 'running', waiting: true, runId: 'run-9', runs: ['run-9'], inputs: { mode: 'validated' }, run: H.run({ status: 'running', waiting: true, gate: 'Try the change', workflow: HERO, startedAt: H.iso(start), progress, groups: wfEntry(HERO).groups, stepTimes: TYPICAL }) });
  assert.match(text(part(draw(R, one(x, { state: 'running' })), 'a', 'roadmap-status')), /Waiting for you/);
});

test('#282 a failed item offers Retry and Skip in its status block', async () => {
  const { R } = await ready();
  const start = H.NOW - 30 * H.MIN;
  const x = card({ status: 'failed', runId: 'run-f', runs: ['run-f'], error: 'Run run-f failed: tests failed', run: H.run({ status: 'failed', workflow: HERO, startedAt: H.iso(start), finishedAt: H.iso(start + 20 * H.MIN), progress: [step('develop', 'failed', start)], groups: wfEntry(HERO).groups }) });
  const status = part(draw(R, one(x, { state: 'paused', pausedBy: 'a' })), 'a', 'roadmap-status');
  const buttons = H.findAll(status.outer, (e) => e.name === 'button').map((e) => text(e));
  assert.deepEqual([buttons.some((b) => /Retry/.test(b)), buttons.some((b) => /Skip/.test(b))], [true, true]);
});

test('#282 a done item: the meters compare with the estimate (cost under it ok, time well over it over)', async () => {
  const { R } = await ready();
  const start = H.NOW - 4 * H.HOUR;
  const x = card({ status: 'done', runId: 'run-d', runs: ['run-d'], estimate: ESTIMATE, actualUsd: 4, actualMinutes: 150, run: H.run({ status: 'success', workflow: HERO, startedAt: H.iso(start), finishedAt: H.iso(start + 150 * H.MIN), progress: [step('develop', 'done', start, { durationMs: 150 * H.MIN })], groups: wfEntry(HERO).groups }) });
  const html = draw(R, one(x, { state: 'done' }));
  assert.deepEqual([part(html, 'a', 'roadmap-meter-cost').attrs['data-verdict'], part(html, 'a', 'roadmap-meter-time').attrs['data-verdict']], ['ok', 'over']);
});

// ---- #614: a run that merged cleanly draws its Merge station done ------------------------------------------
// Assumed: the service's runView gives the card's run `mergedCommit` (the merged commit, null when the
// run did not merge); the card passes it to RunProgress.pipeline, whose Merge station is then done (✓)
// and names that commit (its title, its accessible name or its text).
const AI_HERO = 'feature.yaml';
const MERGED = 'abc1234def567890abc1234def567890abc12345';
function mergedCard(mergedCommit) {
  const start = H.NOW - 2 * H.HOUR;
  const progress = [step('develop', 'done', start), step('code_review', 'done', start + 10 * H.MIN), step('test', 'done', start + 20 * H.MIN)];
  return card({
    workflow: AI_HERO, workflowName: 'AI development, local hero', status: 'done', runId: 'run-m', runs: ['run-m'],
    run: H.run({ status: 'success', workflow: AI_HERO, startedAt: H.iso(start), finishedAt: H.iso(start + 30 * H.MIN), progress, groups: wfEntry(AI_HERO).groups, mergedCommit }),
  });
}
const mergeStation = (html) => allByTestId(part(html, 'a', 'roadmap-pipeline').outer, 'roadmap-station').find((e) => e.attrs['data-step'] === 'Merge');

test('#614 a done item whose run merged cleanly (never entered resolve_merge): the Merge station is done ✓', async () => {
  const { R } = await ready();
  const st = mergeStation(draw(R, one(mergedCard(MERGED), { state: 'done' })));
  assert.ok(st, 'a Merge station');
  assert.deepEqual([st.attrs['data-state'], text(st).includes('✓')], ['done', true]);
});

test('#614 the Merge station of a merged run names the merged commit', async () => {
  const { R } = await ready();
  const st = mergeStation(draw(R, one(mergedCard(MERGED), { state: 'done' })));
  assert.ok(st, 'a Merge station');
  assert.match(`${st.attrs.title || ''} ${st.attrs['aria-label'] || ''} ${H.visibleText(st.outer)}`, /abc1234/);
});

// ---- the stations of each bundled development workflow ---------------------------------------------------

for (const file of DEV_WORKFLOWS) {
  test(`#282 stations of a planned ${file} item (Automatic): non-empty, a Develop station, no human gate, no step twice`, async () => {
    const { R } = await ready();
    const list = stations(draw(R, one(card({ workflow: file, workflowName: file.replace(/\.yaml$/, ''), inputs: { mode: 'auto' } }))));
    const gates = new Set(humanSteps(file));
    const steps = list.map((s) => s.step);
    assert.deepEqual([
      list.length > 0,
      list.some(isDevelop),
      list.some((s) => s.state === 'gate' || gates.has(s.step)),
      new Set(steps).size === steps.length,
    ], [true, true, false, true]);
  });
}

// ---- the stage head -------------------------------------------------------------------------------------

const stageOf = (html, s) => H.findEl(html, (e) => e.attrs['data-testid'] === 'roadmap-stage' && e.attrs['data-stage'] === String(s));
const inMenu = (el) => { for (let p = el.parent; p; p = p.parent) if (p.attrs.role === 'menu') return true; return false; };
const headText = (section) => H.visibleText(H.dropWhere(section.outer, (e) => e.attrs['data-testid'] === 'roadmap-item' || e.attrs.role === 'menu'));

test('#282 a stage of one item shows no stage estimate in its head; a stage of two items does', async () => {
  const { R } = await ready();
  const d = {
    roadmap: {
      state: 'planned',
      stages: [
        { id: 'st1', name: '', note: '', estimate: { usd: 12.34, minutes: 60, runs: 12 }, items: [card({ estimate: { ...ESTIMATE, usd: 12.34 } })] },
        { id: 'st2', name: '', note: '', estimate: { usd: 56.78, minutes: 60, runs: 12 }, items: [card({ id: 'b', issues: [H.ref(201, 'B')] }), card({ id: 'c', issues: [H.ref(202, 'C')] })] },
      ],
    },
    issues: backlogIssues,
  };
  const html = draw(R, d);
  assert.deepEqual([headText(stageOf(html, 0)).includes('12.34'), headText(stageOf(html, 1)).includes('56.78')], [false, true]);
});

function twoStages(state = 'running') {
  return {
    roadmap: {
      state,
      stages: [
        { id: 'st1', name: '', note: '', items: [runningCard()] },
        { id: 'st2', name: '', note: '', items: [card({ id: 'b', issues: [H.ref(201, 'Second')] })] },
      ],
    },
    issues: backlogIssues,
  };
}

test('#282 the stage head has a ⋮ "Stage actions" menu button', async () => {
  const { R } = await ready();
  const section = stageOf(draw(R, twoStages()), 1);
  const btn = byTestId(section.outer, 'roadmap-stage-menu');
  assert.ok(btn, 'roadmap-stage-menu in the stage');
  assert.deepEqual([btn.name, btn.attrs['aria-label'], 'aria-haspopup' in btn.attrs, text(btn)], ['button', 'Stage actions', true, '⋮']);
});

async function openStageMenu(R, d, s) {
  const html = draw(R, d);
  const btn = byTestId(stageOf(html, s).outer, 'roadmap-stage-menu');
  assert.ok(btn, `stage ${s + 1} has a menu button`);
  const { ctx } = H.makeCtx();
  await R.onClick(H.clickOn(stageOf(html, s).outer, (e) => e.attrs['data-testid'] === 'roadmap-stage-menu'), ctx, d);
  const open = draw(R, d);
  const menu = H.findAll(open, (e) => e.attrs.role === 'menu' && e.attrs['data-testid'] !== 'roadmap-menu')[0];
  assert.ok(menu, 'the stage menu opened (role="menu")');
  return { html: open, menu, items: H.findAll(menu.outer, (e) => e.attrs.role === 'menuitem' || e.attrs.role === 'menuitemcheckbox') };
}

test('#282 the stage menu lists Release here, Run this stage, Run earlier, Run later, add note and Disable', async () => {
  const { R } = await ready();
  const { items } = await openStageMenu(R, twoStages('planned'), 1);
  const names = items.map((e) => text(e)).join(' | ');
  assert.deepEqual([/Release here/, /Run this stage/, /Run earlier/i, /Run later/i, /add note/i, /Disable/].map((re) => re.test(names)), [true, true, true, true, true, true]);
});

test('#282 while the roadmap runs, the menu\'s Run this stage is disabled and says why', async () => {
  const { R } = await ready();
  const { items } = await openStageMenu(R, twoStages('running'), 1);
  const run = items.find((e) => /Run this stage/.test(text(e)));
  assert.ok(run, 'Run this stage is a menu item');
  assert.deepEqual(['disabled' in run.attrs || run.attrs['aria-disabled'] === 'true', /running/i.test(run.attrs.title || '')], [true, true]);
});

test('#282 Release here, Run this stage and Run earlier / later are no longer buttons of the stage head itself', async () => {
  const { R } = await ready();
  const section = stageOf(draw(R, twoStages('planned')), 1);
  const direct = H.findAll(section.outer, (e) => !inMenu(e) && e.attrs.role !== 'menuitem'
    && (e.attrs['data-rm-release'] === 'add' || 'data-rm-run-stage' in e.attrs || 'data-rm-stage' in e.attrs));
  const head = headText(section);
  assert.deepEqual([direct.length, /Release here/.test(head), /Run this stage/.test(head)], [0, false, false]);
});
