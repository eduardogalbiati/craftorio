// #432: characterization of the Roadmap's click handling (BacklogRoadmap.onClick) before its chain of
// closest() branches becomes a table: the branches no other test clicks (the city map, the earlier page,
// a release run, Move on, the budget, Cancel pause, the versions dialog, From the queue, Propose/Replace,
// an item's Move on / Skip, Add an input, a cut line removed, an item removed) and the shared ending
// (false when the click is not the roadmap's, an error in the screen's error line, the redraw, the focus).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { withI18n } = require('@multiagent/shared/test/i18n-sandbox.js');

// a module by its page-relative name, whichever layer holds it; a shared module by its path from the page folder
const read = (...p) => fs.readFileSync(p[0].startsWith('..') ? path.join(__dirname, '..', '..', '..', 'apps', 'desktop', 'renderer', ...p) : require('../../../scripts/source-tree').pageFile(path.join(__dirname, '..', '..', '..'), p.join('/')), 'utf8');
const roadmapSrc = read('views', 'backlog', 'backlog-roadmap.js');
const MODULES = ['status-pill.js', 'estimates.js', '../../../packages/shared/run-progress-model.js', '../../../packages/shared/default-workflow.js', '../../../packages/shared/roadmap-model.js', 'workflow-inputs.js'].map((f) => read(f));
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const plain = (v) => JSON.parse(JSON.stringify(v ?? null)); // primitives only: never compare vm objects

// The module in a sandbox; every api call, dialog, toast and window call is recorded as plain values.
function load({ confirm = true, api = {}, elements = {}, globals = {} } = {}) {
  const calls = { api: [], confirm: [], toasts: [], showRun: [], showView: [], resume: [], cityImpact: [], scrolled: [], focused: [], errors: [] };
  const record = (name, answer) => async (...args) => {
    calls.api.push([name, ...plain(args)]);
    return answer ? answer(...args) : { roadmap: { state: 'planned', stages: [] }, edit: { id: `e-${name}` } };
  };
  const apiNames = ['saveRoadmap', 'startRoadmap', 'parkRoadmapStage', 'roadmapBudget', 'cancelRoadmapPause', 'pauseRoadmap', 'roadmapFromQueue', 'proposeRoadmap', 'roadmapItem', 'roadmapVersions', 'restoreRoadmapVersion', 'clearRoadmap', 'undoRoadmap', 'listReleases', 'listWorkflows'];
  const sandbox = {
    esc, state: { runs: new Map() }, errMsg: (e) => String(e?.message || e), devMode: () => false,
    confirmDialog: async (...args) => { calls.confirm.push(plain(args)); return typeof confirm === 'function' ? confirm(...args) : confirm; },
    keptWorkDialog: async () => null, choiceDialog: async () => null,
    fmtDur: (ms) => (ms == null ? 'unknown' : `${Math.round(ms / 1000)}s`),
    robotAvatar: () => '<svg class="robot"></svg>', agentLabel: (agent) => agent,
    PERSON_SVG: '<svg class="person"></svg>', ENGINE_SVG: '<svg class="engine"></svg>',
    progressChip: (c) => esc(c.name), ChainModel: { chainBadgesHtml: () => '' }, scheduleRender: () => {},
    showToast: (title, detail) => calls.toasts.push([String(title), String(detail)]),
    showRun: (...args) => calls.showRun.push(plain(args)),
    showView: (name) => calls.showView.push(name),
    console: { error: (what) => calls.errors.push(String(what)), log() {}, warn() {} },
    api: Object.fromEntries(apiNames.map((n) => [n, record(n, api[n])])),
    ...globals,
  };
  sandbox.document = {
    querySelector: (sel) => {
      if (sel in elements) return elements[sel];
      if (sel.startsWith('#bl-list .rm-stage[data-stage=')) return { scrollIntoView: () => calls.scrolled.push(sel) };
      if (sel === '.rm [autofocus]') return { focus: () => calls.focused.push(sel) };
      return null;
    },
    querySelectorAll: () => [],
  };
  sandbox.setTimeout = setTimeout; sandbox.clearTimeout = clearTimeout;
  sandbox.window = sandbox;
  vm.createContext(withI18n(sandbox));
  for (const m of MODULES) vm.runInContext(m, sandbox);
  vm.runInContext(roadmapSrc, sandbox);
  return { R: sandbox.BacklogRoadmap, calls, sandbox };
}

function makeCtx(projectId = 'p1') {
  const calls = { setData: [], setError: [], render: 0 };
  return { projectId, setData: (d) => calls.setData.push(plain(d)), setError: (e) => calls.setError.push(String(e)), render: () => { calls.render += 1; }, _calls: calls };
}

// A clicked element: `parts` maps each selector closest() finds to that ancestor's dataset (a comma
// list matches any of its selectors); `extra` adds an ancestor's own methods (querySelector…).
function target(parts, extra = {}) {
  const nodes = {};
  const closest = (sel) => {
    for (const one of sel.split(',').map((x) => x.trim())) if (one in nodes) return nodes[one];
    return null;
  };
  for (const [sel, dataset] of Object.entries(parts)) nodes[sel] = { dataset: dataset || {}, closest, ...(extra[sel] || {}) };
  return { dataset: {}, closest };
}
const inItem = (selector, dataset, itemId = 'it1', stage = 0) => target({ [selector]: dataset, '[data-item]': { item: itemId, stage: String(stage) }, '[data-stage]': { stage: String(stage) } });
const inStage = (selector, dataset, stage = 0) => target({ [selector]: dataset, '[data-stage]': { stage: String(stage) } });
const act = (name) => target({ '[data-rm]': { rm: name } });

const issue = (n) => ({ number: n, title: `Issue ${n}`, url: `https://x/${n}` });
const it1 = () => ({ id: 'it1', status: 'planned', workflow: 'w.yaml', issues: [issue(282), issue(284)], inputs: { mode: 'auto' } });
const it2 = () => ({ id: 'it2', status: 'planned', workflow: 'w.yaml', issues: [issue(290)], inputs: {} });
const it3 = () => ({ id: 'it3', status: 'planned', workflow: 'w.yaml', issues: [issue(300)], inputs: {} });
const roadmapData = (over = {}) => ({
  roadmap: { state: 'planned', updatedAt: '2026-10-22T09:00:00.000Z', stages: [
    { id: 'st1', name: 'One', note: '', items: [it1(), it2()], release: { name: 'v1.0' } },
    { id: 'st2', name: 'Two', note: '', items: [it3()] },
  ], ...over },
  issues: [issue(282)],
});

test('#432 a click on a project without a roadmap is not the roadmap\'s: false, nothing redrawn', async () => {
  const { R, calls } = load();
  const ctx = makeCtx();
  assert.equal(await R.onClick({ target: act('from-queue') }, ctx, { issues: [] }), false);
  assert.equal(ctx._calls.render, 0);
  assert.equal(calls.api.length, 0);
});

test('#432 a click on nothing of the roadmap\'s returns false without a redraw or an api call', async () => {
  const { R, calls } = load();
  const ctx = makeCtx();
  assert.equal(await R.onClick({ target: target({}) }, ctx, roadmapData()), false);
  assert.equal(await R.onClick({ target: act('no-such-action') }, ctx, roadmapData()), false);
  assert.equal(ctx._calls.render, 0);
  assert.equal(calls.api.length, 0);
});

test('#432 the Conflict map link is handled first, with or without a roadmap', async () => {
  const seen = [];
  const { R } = load({ globals: { ProjectConflictMap: { onLinkClick: (e) => { seen.push(e.target.closest('[data-conflict-map]') != null); return true; } } } });
  const ctx = makeCtx();
  assert.equal(await R.onClick({ target: target({ '[data-conflict-map]': {} }) }, ctx, {}), true);
  assert.deepEqual(seen, [true]);
  assert.equal(ctx._calls.render, 0);
});

test('#432 a disabled menu entry is the roadmap\'s and does nothing', async () => {
  const { R, calls } = load();
  const ctx = makeCtx();
  const t = target({ '[role="menuitem"][aria-disabled="true"]': {}, '[data-rm]': { rm: 'clear' } });
  assert.equal(await R.onClick({ target: t }, ctx, roadmapData()), true);
  assert.equal(calls.api.length, 0);
  assert.equal(calls.confirm.length, 0);
  assert.equal(ctx._calls.render, 0);
});

test('#432 an item\'s or a stage\'s city footprint opens the city impact with the project, the issues and the button\'s data', async () => {
  const got = [];
  const { R } = load({ globals: { ProjectCityImpact: { fromRoadmap: (pid, r, issues, dataset) => got.push([pid, r.stages.length, plain(issues).map((i) => i.number), plain(dataset)]) } } });
  const ctx = makeCtx();
  assert.equal(await R.onClick({ target: target({ '[data-rm-map-item]': { rmMapItem: 'it1' } }) }, ctx, roadmapData()), true);
  assert.equal(await R.onClick({ target: target({ '[data-rm-map-stage]': { rmMapStage: 'st2' } }) }, ctx, roadmapData()), true);
  assert.deepEqual(got, [['p1', 2, [282], { rmMapItem: 'it1' }], ['p1', 2, [282], { rmMapStage: 'st2' }]]);
  assert.equal(ctx._calls.render, 0);
});

test('#432 the earlier page redraws and scrolls back to the stage that led the list', async () => {
  const { R, calls } = load();
  const ctx = makeCtx();
  const t = target({ '[data-rm-earlier]': {}, '.rm': {} }, { '.rm': { querySelector: (sel) => (sel === '.rm-stage' ? { dataset: { stage: '3' } } : null) } });
  assert.equal(await R.onClick({ target: t }, ctx, roadmapData()), true);
  assert.equal(ctx._calls.render, 1);
  assert.deepEqual(calls.scrolled, ['#bl-list .rm-stage[data-stage="3"]']);
});

test('#432 a release\'s run opens that run; a shipped release opens the Releases screen', async () => {
  const { R, calls } = load();
  const ctx = makeCtx();
  assert.equal(await R.onClick({ target: target({ '[data-rm-release-run]': { rmReleaseRun: 'run-9' } }) }, ctx, roadmapData()), true);
  assert.equal(await R.onClick({ target: target({ '[data-rm-open-releases]': {} }) }, ctx, roadmapData()), true);
  assert.deepEqual(calls.showRun, [['run-9']]);
  assert.deepEqual(calls.showView, ['releases']);
  assert.equal(ctx._calls.render, 0);
});

test('#432 Resume from step opens the resume dialog when the app has it, and is still the roadmap\'s without it', async () => {
  const { R } = load();
  const ctx = makeCtx();
  assert.equal(await R.onClick({ target: target({ '[data-rm-resume]': { rmResume: 'run-4' } }) }, ctx, roadmapData()), true);
  const opened = [];
  const withDialog = load({ globals: { openResumeDialog: (id) => opened.push(id) } });
  assert.equal(await withDialog.R.onClick({ target: target({ '[data-rm-resume]': { rmResume: 'run-4' } }) }, ctx, roadmapData()), true);
  assert.deepEqual(opened, ['run-4']);
  assert.equal(ctx._calls.render, 0);
});

test('#432 Move on from this stage asks, parks the stage and offers Undo; declined, nothing is parked', async () => {
  const { R, calls } = load();
  const ctx = makeCtx();
  assert.equal(await R.onClick({ target: inStage('[data-rm-park-stage]', {}, 0) }, ctx, roadmapData()), true);
  assert.deepEqual(calls.api, [['parkRoadmapStage', 'p1', 'st1']]);
  assert.equal(calls.confirm.length, 1);
  assert.deepEqual(calls.toasts, [['Moved on from stage "One"', 'Its runs at a gate still wait for you.']]);
  assert.equal(ctx._calls.setData.length, 1);
  assert.equal(ctx._calls.render, 1);

  const no = load({ confirm: false });
  const ctx2 = makeCtx();
  assert.equal(await no.R.onClick({ target: inStage('[data-rm-park-stage]', {}, 1) }, ctx2, roadmapData()), true);
  assert.equal(no.calls.api.length, 0);
  assert.equal(ctx2._calls.render, 1, 'the shared ending redraws');
});

test('#432 a refused Move on in an open stage menu keeps the menu and calls nothing', async () => {
  const { R, calls } = load();
  const ctx = makeCtx();
  assert.equal(await R.onClick({ target: target({ '[data-rm-stage-menu]': { rmStageMenu: 'st1' } }) }, ctx, roadmapData()), true);
  assert.equal(ctx._calls.render, 1);
  assert.equal(await R.onClick({ target: target({ '[data-rm-park-stage][data-refused]': {}, '[data-rm-park-stage]': {}, '[data-stage]': { stage: '0' } }) }, ctx, roadmapData()), true);
  assert.equal(ctx._calls.render, 2);
  assert.equal(calls.api.length, 0);
  assert.equal(calls.confirm.length, 0);
});

test('#432 the budget\'s Raise goes on at once; Resume anyway asks first and does nothing when declined', async () => {
  const { R, calls } = load();
  const ctx = makeCtx();
  assert.equal(await R.onClick({ target: act('budget-raise') }, ctx, roadmapData()), true);
  assert.equal(calls.confirm.length, 0);
  assert.equal(await R.onClick({ target: act('budget-resume') }, ctx, roadmapData()), true);
  assert.equal(calls.confirm.length, 1);
  assert.deepEqual(calls.api, [['roadmapBudget', 'p1', 'raise'], ['roadmapBudget', 'p1', 'resume']]);
  assert.equal(ctx._calls.setData.length, 2);
  assert.equal(ctx._calls.render, 2);

  const no = load({ confirm: false });
  const ctx2 = makeCtx();
  assert.equal(await no.R.onClick({ target: act('budget-resume') }, ctx2, roadmapData()), true);
  assert.equal(no.calls.api.length, 0);
  assert.equal(ctx2._calls.render, 0, 'declined: returns before the shared redraw');
});

test('#432 Cancel pause takes the pause back and redraws', async () => {
  const { R, calls } = load();
  const ctx = makeCtx();
  assert.equal(await R.onClick({ target: act('cancel-pause') }, ctx, roadmapData({ state: 'running' })), true);
  assert.deepEqual(calls.api, [['cancelRoadmapPause', 'p1']]);
  assert.equal(ctx._calls.setData.length, 1);
  assert.equal(ctx._calls.render, 1);
});

test('#432 Restore an earlier version without its dialog in the page only closes the menu', async () => {
  const { R, calls } = load();
  const ctx = makeCtx();
  assert.equal(await R.onClick({ target: act('versions') }, ctx, roadmapData()), true);
  assert.equal(calls.api.length, 0);
  assert.equal(ctx._calls.render, 1);
});

test('#432 Restore an earlier version lists the versions and a Restore puts one back with Undo', async () => {
  const el = () => {
    const classes = new Set(['hidden']);
    return { textContent: '', innerHTML: '', onclick: null, focused: 0, focus() { this.focused += 1; }, classList: { add: (c) => classes.add(c), remove: (c) => classes.delete(c), has: (c) => classes.has(c) } };
  };
  const elements = { '#rm-versions-modal': el(), '#rm-versions': el(), '#rm-versions-error': el(), '#btn-rm-versions-close': el() };
  const { R, calls } = load({ elements, api: {
    roadmapVersions: async () => [{ id: 'v1', label: 'Moved stage 2 up', at: '2026-10-22T08:00:00.000Z' }],
    restoreRoadmapVersion: async () => ({ roadmap: { state: 'planned', stages: [] }, edit: { id: 'e9' } }),
  } });
  const ctx = makeCtx();
  assert.equal(await R.onClick({ target: act('versions') }, ctx, roadmapData()), true);
  assert.equal(elements['#rm-versions-modal'].classList.has('hidden'), false);
  assert.equal(elements['#btn-rm-versions-close'].focused, 1);
  const list = elements['#rm-versions'].innerHTML;
  assert.match(list, /data-rm-restore="v1"/);
  assert.match(list, /Moved stage 2 up/);
  assert.deepEqual(calls.api, [['roadmapVersions', 'p1']]);

  const btn = { disabled: false, dataset: { rmRestore: 'v1' } };
  await elements['#rm-versions'].onclick({ target: { closest: (sel) => (sel === '[data-rm-restore]' ? btn : null) } });
  assert.deepEqual(calls.api[1], ['restoreRoadmapVersion', 'p1', 'v1']);
  assert.equal(elements['#rm-versions-modal'].classList.has('hidden'), true);
  assert.equal(ctx._calls.setData.length, 1);
  assert.deepEqual(calls.toasts.map((x) => x[0]), ['Restored an earlier version']);
});

test('#432 From the queue fills the roadmap from the queue', async () => {
  const { R, calls } = load();
  const ctx = makeCtx();
  assert.equal(await R.onClick({ target: act('from-queue') }, ctx, roadmapData({ stages: [] })), true);
  assert.deepEqual(calls.api, [['roadmapFromQueue', 'p1']]);
  assert.equal(ctx._calls.setData.length, 1);
  assert.equal(ctx._calls.render, 1);
});

test('#432 a failed action shows its error in the screen\'s error line and still redraws', async () => {
  const { R, calls } = load({ api: { roadmapFromQueue: async () => { throw new Error('queue is empty'); } } });
  const ctx = makeCtx();
  assert.equal(await R.onClick({ target: act('from-queue') }, ctx, roadmapData()), true);
  assert.deepEqual(ctx._calls.setError, ['queue is empty']);
  assert.deepEqual(calls.errors, ['roadmap edit:']);
  assert.equal(ctx._calls.render, 1);
});

test('#432 Propose: an empty proposal does nothing, invalid JSON is an error, a valid one is sent and the issues left out are said', async () => {
  const proposal = { value: '' };
  const { R, calls } = load({ elements: { '#rm-proposal': proposal }, api: { proposeRoadmap: async () => ({ roadmap: { state: 'planned', stages: [] }, dropped: [12, 13] }) } });
  const ctx = makeCtx();
  assert.equal(await R.onClick({ target: act('propose') }, ctx, roadmapData()), true);
  assert.equal(ctx._calls.render, 0, 'empty: returns before the shared redraw');
  proposal.value = '  {not json ';
  assert.equal(await R.onClick({ target: act('propose') }, ctx, roadmapData()), true);
  assert.equal(ctx._calls.setError.length, 1);
  assert.match(ctx._calls.setError[0], /JSON/);
  assert.equal(calls.api.length, 0);
  proposal.value = ' {"stages":[]} ';
  assert.equal(await R.onClick({ target: act('propose') }, ctx, roadmapData()), true);
  assert.deepEqual(calls.api, [['proposeRoadmap', 'p1', { stages: [] }, false]]);
  assert.equal(calls.confirm.length, 0);
  assert.equal(ctx._calls.setError.length, 2);
  assert.match(ctx._calls.setError[1], /#12, #13/);
  assert.equal(calls.toasts.length, 0, 'a proposal added has no Undo toast');
  assert.equal(ctx._calls.render, 2);
});

test('#432 Replace asks when the roadmap has stages, sends replace=true and offers Undo; declined, nothing is sent', async () => {
  const proposal = { value: '{"stages":[{"items":[]}]}' };
  const yes = load({ elements: { '#rm-proposal': proposal } });
  const ctx = makeCtx();
  assert.equal(await yes.R.onClick({ target: act('replace') }, ctx, roadmapData()), true);
  assert.equal(yes.calls.confirm.length, 1);
  assert.deepEqual(yes.calls.api, [['proposeRoadmap', 'p1', { stages: [{ items: [] }] }, true]]);
  assert.equal(yes.calls.toasts.length, 1);
  assert.match(yes.calls.toasts[0][1], /2/, 'its detail counts the stages that gave way');

  const empty = load({ elements: { '#rm-proposal': proposal } });
  assert.equal(await empty.R.onClick({ target: act('replace') }, makeCtx(), roadmapData({ stages: [] })), true);
  assert.equal(empty.calls.confirm.length, 0, 'no stages: nothing to ask');
  assert.equal(empty.calls.api.length, 1);

  const no = load({ confirm: false, elements: { '#rm-proposal': proposal } });
  const ctx2 = makeCtx();
  assert.equal(await no.R.onClick({ target: act('replace') }, ctx2, roadmapData()), true);
  assert.equal(no.calls.api.length, 0);
  assert.equal(ctx2._calls.render, 0);
});

test('#432 an item\'s Move on asks, parks it and offers Undo; Skip goes to the service at once', async () => {
  const { R, calls } = load();
  const ctx = makeCtx();
  assert.equal(await R.onClick({ target: inItem('[data-rm-item]', { rmItem: 'park' }) }, ctx, roadmapData()), true);
  assert.equal(calls.confirm.length, 1);
  assert.deepEqual(calls.api, [['roadmapItem', 'p1', 'it1', 'park']]);
  assert.deepEqual(calls.toasts, [['Moved on past #282, #284', 'Its run still waits at its gate for you.']]);
  assert.equal(await R.onClick({ target: inItem('[data-rm-item]', { rmItem: 'skip' }, 'it3', 1) }, ctx, roadmapData()), true);
  assert.deepEqual(calls.api[1], ['roadmapItem', 'p1', 'it3', 'skip']);
  assert.equal(calls.confirm.length, 1);
  assert.equal(ctx._calls.render, 2);

  const no = load({ confirm: false });
  assert.equal(await no.R.onClick({ target: inItem('[data-rm-item]', { rmItem: 'park' }) }, makeCtx(), roadmapData()), true);
  assert.equal(no.calls.api.length, 0);
});

test('#432 Add an input redraws and focuses the control just opened', async () => {
  const { R, calls } = load();
  const ctx = makeCtx();
  assert.equal(await R.onClick({ target: inItem('[data-rm-addinput]', {}) }, ctx, roadmapData()), true);
  assert.equal(ctx._calls.render, 1);
  assert.deepEqual(calls.focused, ['.rm [autofocus]']);
  assert.equal(calls.api.length, 0);
});

test('#432 removing a cut line asks, saves the stage without its release and offers Undo; declined, nothing is saved', async () => {
  const { R, calls } = load();
  const ctx = makeCtx();
  const t = target({ '[data-rm-release]': { rmRelease: 'remove' }, '[data-cut-stage]': { cutStage: '0' } });
  assert.equal(await R.onClick({ target: t }, ctx, roadmapData()), true);
  assert.equal(calls.confirm.length, 1);
  assert.equal(calls.api.length, 1);
  const [name, pid, stages, label, base] = calls.api[0];
  assert.equal(name, 'saveRoadmap');
  assert.equal(pid, 'p1');
  assert.equal('release' in stages[0], false);
  assert.deepEqual(stages.map((s) => s.items.map((x) => x.id)), [['it1', 'it2'], ['it3']]);
  assert.match(label, /v1\.0/);
  assert.equal(base, '2026-10-22T09:00:00.000Z');
  assert.equal(calls.toasts.length, 1, 'not quiet: a toast with Undo');
  assert.equal(ctx._calls.render, 1, 'save redraws; the branch returns before the shared redraw');

  const no = load({ confirm: false });
  const ctx2 = makeCtx();
  assert.equal(await no.R.onClick({ target: inStage('[data-rm-release]', { rmRelease: 'remove' }, 0) }, ctx2, roadmapData()), true);
  assert.equal(no.calls.api.length, 0);
  assert.equal(ctx2._calls.render, 0);
});

test('#432 removing an item saves its stage without it; the last item of a stage says its stage went too', async () => {
  const { R, calls } = load();
  const ctx = makeCtx();
  assert.equal(await R.onClick({ target: inItem('[data-rm-remove]', {}, 'it1', 0) }, ctx, roadmapData()), true);
  assert.deepEqual(calls.api[0][2].map((s) => s.items.map((x) => x.id)), [['it2'], ['it3']]);
  assert.match(calls.api[0][3], /#282, #284/);
  assert.equal(calls.toasts[0][1], '');
  assert.equal(await R.onClick({ target: inItem('[data-rm-remove]', {}, 'it3', 1) }, ctx, roadmapData()), true);
  assert.deepEqual(calls.api[1][2].map((s) => s.items.map((x) => x.id)), [['it1', 'it2'], []]);
  assert.match(calls.api[1][3], /#300/);
  assert.match(calls.toasts[1][1], /Two/);
  assert.equal(ctx._calls.render, 2);
  assert.equal(calls.confirm.length, 0, 'removed without asking');
});

test('#432 a click outside the open ⋮ menu closes it and redraws, even when the click is not the roadmap\'s', async () => {
  const { R } = load();
  const ctx = makeCtx();
  assert.equal(await R.onClick({ target: target({ '[data-rm-menu]': {} }) }, ctx, roadmapData()), true);
  assert.equal(ctx._calls.render, 1);
  assert.equal(await R.onClick({ target: target({}) }, ctx, roadmapData()), false);
  assert.equal(ctx._calls.render, 2);
  assert.equal(await R.onClick({ target: target({}) }, ctx, roadmapData()), false);
  assert.equal(ctx._calls.render, 2, 'already closed: no redraw');
});
