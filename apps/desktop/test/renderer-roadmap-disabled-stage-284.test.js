// #284 Disable a roadmap stage: the screen. Acceptance tests written before the code.
// apps/desktop/renderer/views/backlog/backlog-roadmap.js is evaluated whole in a vm sandbox
// (test/roadmap-status-helpers.js loadRoadmap); clicks go through BacklogRoadmap.onClick with targets
// built from the rendered markup (their closest() walks the real ancestors, so the stage menu is
// expected inside its stage's section).
//
// Contract:
// - the stage menu (`roadmap-stage-menu`, #282) holds `roadmap-stage-toggle`: "Disable" on an enabled
//   stage, "Enable" on a disabled one (aria-pressed or aria-checked "true" when disabled); disabled with
//   a title while an item of the stage runs; absent on a finished stage.
// - a disabled stage: its section has data-disabled="true" and class `disabled`, a badge
//   `roadmap-stage-disabled` "Disabled", never the current stage; its Run this stage is disabled with a
//   title about enabling it.
// - the toggle saves at once (api.saveRoadmap with `disabled: true` / `false` on that stage and the
//   label "Disabled stage n" / "Enabled stage n") and shows the Undo toast (#281).
// - the bar's counts leave the disabled stages' items out and say "1 disabled"; once every enabled stage
//   is finished, the screen says how many disabled stages were left out ("1 disabled stage").
const test = require('node:test');
const assert = require('node:assert/strict');
const H = require('./roadmap-status-helpers');

const view = { showAll: true, since: 'total' };
const recent = H.iso(H.NOW - H.HOUR);
const it = (id, status, n, extra = {}) => H.item(id, status, n, `Issue ${n}`, { origin: recent, runId: null, runs: [], error: null, ...extra });
const runningItem = (id, n) => it(id, 'running', n, { runId: `run-${n}`, runs: [`run-${n}`], run: H.run({ status: 'running', startedAt: H.iso(H.NOW - 10 * H.MIN), progress: [] }) });
const stage = (id, items, extra = {}) => ({ id, name: '', note: '', items, ...extra });
const data = (stages, roadmap = {}) => ({ roadmap: { state: 'running', stages, ...roadmap }, issues: [] });

function load() {
  const out = H.loadRoadmap();
  const saved = [];
  const toasts = [];
  out.sandbox.api.saveRoadmap = async (projectId, stages, label) => {
    saved.push({ stages: H.clone(stages), label: label ?? null });
    return { roadmap: { state: 'running', stages }, issues: [], edit: { id: 'edit-1' } };
  };
  out.sandbox.api.undoRoadmap = async () => ({ roadmap: { state: 'running', stages: [] } });
  out.sandbox.showToast = (...a) => toasts.push(a);
  return { ...out, saved, toasts };
}
const draw = (R, d) => R.html(d, () => {}, view);
const stageOf = (html, s) => H.findEl(html, (e) => e.attrs['data-testid'] === 'roadmap-stage' && e.attrs['data-stage'] === String(s));
const hasClass = (e, c) => String(e.attrs.class || '').split(/\s+/).includes(c);
const text = (el) => H.visibleText(el.inner);

// opens stage `s`'s menu (0-based) → the markup after, the menu and the toggle in it (null when none)
async function openStageMenu(R, d, s) {
  const html = draw(R, d);
  const section = stageOf(html, s);
  assert.ok(section, `stage ${s + 1} is drawn`);
  if (!H.findEl(section.outer, (e) => e.attrs['data-testid'] === 'roadmap-stage-menu')) return { html, menu: null, toggle: null, items: [] };
  const { ctx } = H.makeCtx();
  await R.onClick(H.clickOn(section.outer, (e) => e.attrs['data-testid'] === 'roadmap-stage-menu'), ctx, d);
  const open = draw(R, d);
  const menu = H.findAll(stageOf(open, s).outer, (e) => e.attrs.role === 'menu')[0] || null;
  const toggle = H.findEl(stageOf(open, s).outer, (e) => e.attrs['data-testid'] === 'roadmap-stage-toggle');
  const items = menu ? H.findAll(menu.outer, (e) => e.attrs.role === 'menuitem' || e.attrs.role === 'menuitemcheckbox') : [];
  return { html: open, menu, toggle, items };
}
async function clickToggle(R, d, s) {
  const { html, toggle } = await openStageMenu(R, d, s);
  assert.ok(toggle, 'the stage menu has roadmap-stage-toggle');
  const { ctx } = H.makeCtx();
  await R.onClick(H.clickOn(stageOf(html, s).outer, (e) => e.attrs['data-testid'] === 'roadmap-stage-toggle'), ctx, d);
}

// stage 1 done, stage 2 disabled (planned), stage 3 planned
const withDisabled = () => data([
  stage('st1', [it('a', 'done', 1)]),
  stage('st2', [it('b', 'planned', 2)], { disabled: true }),
  stage('st3', [it('c', 'planned', 3)]),
]);
// stage 1 running, stage 2 and 3 planned (enabled)
const allEnabled = () => data([
  stage('st1', [runningItem('a', 1)]),
  stage('st2', [it('b', 'planned', 2)]),
  stage('st3', [it('c', 'planned', 3)]),
]);

// ---- a disabled stage's look ------------------------------------------------------------------------

test('#284 a disabled stage is marked: data-disabled="true", class disabled and a "Disabled" badge', () => {
  const { R } = load();
  const section = stageOf(draw(R, withDisabled()), 1);
  const badge = H.findEl(section.outer, (e) => e.attrs['data-testid'] === 'roadmap-stage-disabled');
  assert.deepEqual([section.attrs['data-disabled'], hasClass(section, 'disabled'), badge ? text(badge) : null], ['true', true, 'Disabled']);
});

test('#284 a disabled stage is never the current stage: the next enabled stage is', () => {
  const { R } = load();
  const html = draw(R, withDisabled());
  assert.deepEqual([hasClass(stageOf(html, 1), 'current'), hasClass(stageOf(html, 2), 'current')], [false, true]);
});

test('#284 a disabled stage\'s Run this stage is disabled, its title asking to enable the stage', async () => {
  const { R } = load();
  const { items } = await openStageMenu(R, withDisabled(), 1);
  const run = items.find((e) => /Run this stage/.test(text(e)));
  assert.ok(run, 'Run this stage is in the stage menu');
  assert.deepEqual(['disabled' in run.attrs || run.attrs['aria-disabled'] === 'true', /enable/i.test(run.attrs.title || '')], [true, true]);
});

// ---- the toggle ----------------------------------------------------------------------------------------

test('#284 an enabled stage\'s menu offers "Disable", not pressed', async () => {
  const { R } = load();
  const { toggle } = await openStageMenu(R, allEnabled(), 1);
  assert.ok(toggle, 'roadmap-stage-toggle in the menu');
  const pressed = toggle.attrs['aria-pressed'] ?? toggle.attrs['aria-checked'];
  assert.deepEqual([text(toggle), pressed], ['Disable', 'false']);
});

test('#284 a disabled stage\'s menu offers "Enable", pressed', async () => {
  const { R } = load();
  const { toggle } = await openStageMenu(R, withDisabled(), 1);
  assert.ok(toggle, 'roadmap-stage-toggle in the menu');
  const pressed = toggle.attrs['aria-pressed'] ?? toggle.attrs['aria-checked'];
  assert.deepEqual([text(toggle), pressed], ['Enable', 'true']);
});

test('#284 clicking Disable saves at once with disabled: true on that stage, labelled "Disabled stage 2"', async () => {
  const { R, saved } = load();
  await clickToggle(R, allEnabled(), 1);
  assert.equal(saved.length, 1);
  assert.deepEqual([saved[0].stages[1].disabled, !!saved[0].stages[0].disabled, !!saved[0].stages[2].disabled, saved[0].label], [true, false, false, 'Disabled stage 2']);
});

test('#284 clicking Enable saves at once with disabled: false on that stage, labelled "Enabled stage 2"', async () => {
  const { R, saved } = load();
  await clickToggle(R, withDisabled(), 1);
  assert.equal(saved.length, 1);
  assert.deepEqual([saved[0].stages[1].disabled, saved[0].label], [false, 'Enabled stage 2']);
});

test('#284 Disable shows a toast with Undo, like the other edits (#281)', async () => {
  const { R, toasts } = load();
  await clickToggle(R, allEnabled(), 1);
  const undo = toasts.find((a) => a.some((x) => x && typeof x === 'object' && x.action?.label === 'Undo'));
  assert.ok(undo, 'a toast with an Undo action');
  assert.equal(undo[0], 'Disabled stage 2');
});

test('#284 the toggle is disabled, with a title, while an item of the stage runs', async () => {
  const { R } = load();
  const { toggle } = await openStageMenu(R, allEnabled(), 0);
  assert.ok(toggle, 'roadmap-stage-toggle in the running stage\'s menu');
  assert.deepEqual(['disabled' in toggle.attrs || toggle.attrs['aria-disabled'] === 'true', (toggle.attrs.title || '').length > 0], [true, true]);
});

test('#284 a finished stage\'s menu has no Disable toggle', async () => {
  const { R } = load();
  const { html, menu } = await openStageMenu(R, withDisabled(), 0);
  assert.equal(menu === null, false, 'the finished stage\'s menu opened');
  assert.equal(H.findEl(stageOf(html, 0).outer, (e) => e.attrs['data-testid'] === 'roadmap-stage-toggle'), null);
});

// ---- the counts --------------------------------------------------------------------------------------

test('#284 the bar\'s counts leave the disabled stage\'s items out and say "1 disabled"', () => {
  const { R } = load();
  const html = draw(R, withDisabled());
  const count = H.findEl(html, (e) => e.attrs['data-testid'] === 'roadmap-count');
  assert.ok(count, 'roadmap-count in the bar');
  assert.deepEqual([/of 2 items/.test(text(count)), /1 disabled/.test(text(count))], [true, true]);
});

test('#284 when every enabled stage is finished the screen says one disabled stage was left out', () => {
  const { R } = load();
  const d = data([
    stage('st1', [it('a', 'done', 1)]),
    stage('st2', [it('b', 'planned', 2)], { disabled: true }),
  ], { state: 'done' });
  assert.match(H.visibleText(draw(R, d)), /1 disabled stage/);
});

// ---- the view grouped by epic -------------------------------------------------------------------------

test('#284 grouped by epic, an item of a disabled stage is dimmed and says "stage n · disabled"; the others do not', async () => {
  const { R } = load();
  const d = { ...withDisabled(), epics: [{ id: 'E1', title: 'Epic one' }], issues: [1, 2, 3].map((number) => ({ number, title: `Issue ${number}`, epic: 'E1' })) };
  const { ctx } = H.makeCtx();
  await R.onChange({ target: { matches: (sel) => sel === '[data-rm-by-epic]', checked: true } }, ctx, d);
  const items = H.findAll(draw(R, d), (e) => e.attrs['data-testid'] === 'roadmap-item');
  const row = (n) => items.find((e) => text(e).includes(`Issue ${n}`));
  assert.deepEqual([2, 3].map((n) => !!row(n)), [true, true]);
  assert.deepEqual([hasClass(row(2), 'rm-item-off'), /stage 2 · disabled/.test(text(row(2)))], [true, true]);
  assert.deepEqual([hasClass(row(3), 'rm-item-off'), /disabled/.test(text(row(3)))], [false, false]);
});
