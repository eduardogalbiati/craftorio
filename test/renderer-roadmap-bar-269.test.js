// #269 The Roadmap bar: a state dot, Pause / Stop with icons and colours, Clear in a ⋮ menu, and the
// filters in their own row above the bar. Acceptance tests written before the code.
// src/renderer/views/backlog/backlog-roadmap.js is evaluated whole in a vm sandbox
// (test/roadmap-status-helpers.js loadRoadmap); clicks go through BacklogRoadmap.onClick with targets
// built from the rendered markup (their closest() walks the real ancestors).
//
// Interface the developer implements (window.BacklogRoadmap, backlog-roadmap.js):
// - The bar (`data-testid="roadmap-bar"`) starts with a state dot, before the "Roadmap" title:
//     <span class="rm-state-dot is-<state>" title="<Readable>" aria-label="<Readable>" …></span>
//   <state>: running (blue, pulsing) · paused (amber: paused by the owner or the budget) · failed (red:
//   `state: 'paused'` with `pausedBy`, an item's failure paused it) · planned (grey) · done (green).
//   The readable label (title and aria-label) names the state: "Running", "Paused", "Paused by a
//   failure" (any text matching /fail/i), "Planned", "Done". The old text badge (a `.badge` with
//   `data-status`) is no longer in the bar.
// - Pause ([data-rm="pause"]): an <svg> pause icon before the text "Pause", class `warn-ghost`.
//   Stop ([data-rm="stop"]): an <svg> stop (square) icon before "Stop", class `danger`. Stop asks
//   confirmDialog first; cancelled → api.pauseRoadmap is not called.
// - Clear is not a bar button: a vertical three-dots button at the end of the bar,
//     <button data-rm-menu aria-haspopup="menu" aria-expanded="false|true" …>⋮</button>
//   onClick on it opens the menu (ctx.render() redraws): an element with role="menu" whose entries
//   (role="menuitem", built from a list) include [data-rm="clear"]. Clear still confirms.
//   BacklogRoadmap.onKeyDown(e, ctx): Escape with the menu open closes it (ctx.render(), returns true).
// - Filters: the Planned/All switch ([data-rm-view]), the date filter ([data-rm-since]) and Group by
//   epic ([data-rm-by-epic]) render in a row `data-testid="filter-row"` (the E2E steps' name) placed BEFORE the bar in
//   BacklogRoadmap.html's output; the bar keeps only the dot, the title, the counts
//   (data-testid="roadmap-count") and the actions.
const test = require('node:test');
const assert = require('node:assert/strict');
const H = require('./roadmap-status-helpers');

const view = { showAll: true, since: 'total' };
const recent = H.iso(H.NOW - H.HOUR);
const planned = (id = 'a', n = 1) => H.item(id, 'planned', n, `Issue ${n}`, { origin: recent });

function load() {
  const out = H.loadRoadmap();
  const calls = { confirm: [], pause: [], clear: [] };
  out.sandbox.confirmDialog = async (...a) => { calls.confirm.push(a.map(String)); return false; };
  out.sandbox.api.pauseRoadmap = async (...a) => { calls.pause.push(a.map(String)); return { roadmap: { state: 'paused', stages: [] } }; };
  out.sandbox.api.clearRoadmap = async (...a) => { calls.clear.push(a.map(String)); return { roadmap: { state: 'planned', stages: [] } }; };
  return { ...out, calls };
}
const data = (roadmap) => H.roadmapOf([{ id: 'st1', name: '', note: '', items: [planned()] }], roadmap);
const barOf = (html) => {
  const bar = H.findEl(html, (e) => e.attrs['data-testid'] === 'roadmap-bar');
  assert.ok(bar, 'the roadmap bar is rendered');
  return bar;
};
const hasClass = (e, c) => String(e.attrs.class || '').split(/\s+/).includes(c);
const dotOf = (html) => H.findEl(barOf(html).outer, (e) => hasClass(e, 'rm-state-dot'));

test('#269 bar: a running roadmap shows a blue pulsing state dot (is-running) before "Roadmap", readable in its title and aria-label', () => {
  const { R } = load();
  const html = R.html(data({ state: 'running' }), () => {}, view);
  const dot = dotOf(html);
  assert.ok(dot, 'a .rm-state-dot in the bar');
  assert.ok(hasClass(dot, 'is-running'), `class is-running in "${dot.attrs.class}"`);
  assert.match(dot.attrs.title || '', /Running/);
  assert.match(dot.attrs['aria-label'] || '', /Running/);
  const bar = barOf(html).outer;
  assert.ok(bar.indexOf('rm-state-dot') < bar.indexOf('Roadmap'), 'the dot comes before the "Roadmap" title');
});

test('#269 bar: the dot\'s class follows the state: paused (owner) amber, paused by a failure red, planned grey, done green', () => {
  const { R } = load();
  const cases = [
    [{ state: 'paused' }, 'is-paused', /paused/i],
    [{ state: 'paused', pausedBy: 'a', error: 'Run run-42 failed: tests failed' }, 'is-failed', /fail/i],
    [{ state: 'planned' }, 'is-planned', /planned/i],
    [{ state: 'done' }, 'is-done', /done/i],
  ];
  const got = cases.map(([r, cls, label]) => {
    const dot = dotOf(R.html(data(r), () => {}, view));
    return [!!dot && hasClass(dot, cls), !!dot && label.test(dot.attrs['aria-label'] || ''), !!dot && label.test(dot.attrs.title || '')];
  });
  assert.deepEqual(got, cases.map(() => [true, true, true]));
});

test('#269 bar: the old text state badge (a .badge with data-status) is gone from the bar', () => {
  const { R } = load();
  const bar = barOf(R.html(data({ state: 'running' }), () => {}, view));
  const badges = H.findAll(bar.outer, (e) => hasClass(e, 'badge') && 'data-status' in e.attrs).length;
  assert.equal(badges, 0);
});

test('#269 bar: Pause has a pause icon before its text and a muted amber class (warn-ghost); Stop a stop icon and a danger class', () => {
  const { R } = load();
  const bar = barOf(R.html(data({ state: 'running' }), () => {}, view)).outer;
  const pause = H.findEl(bar, (e) => e.attrs['data-rm'] === 'pause');
  const stop = H.findEl(bar, (e) => e.attrs['data-rm'] === 'stop');
  assert.ok(pause && stop, 'Pause and Stop in the bar');
  assert.deepEqual(
    [hasClass(pause, 'warn-ghost'), hasClass(stop, 'danger')],
    [true, true],
  );
  for (const [btn, word] of [[pause, 'Pause'], [stop, 'Stop']]) {
    const icon = btn.inner.indexOf('<svg');
    assert.ok(icon >= 0, `${word} has an svg icon`);
    assert.ok(icon < btn.inner.lastIndexOf(word), `${word}'s icon comes before its text`);
    assert.equal(H.visibleText(btn.inner), word);
  }
});

test('#269 Stop asks for a confirmation; cancelled, nothing is stopped', async () => {
  const { R, calls } = load();
  const d = data({ state: 'running' });
  const html = R.html(d, () => {}, view);
  const { ctx } = H.makeCtx();
  await R.onClick(H.clickOn(html, (e) => e.attrs['data-rm'] === 'stop'), ctx, d);
  assert.equal(calls.confirm.length, 1, 'confirmDialog was asked');
  assert.equal(calls.pause.length, 0, 'api.pauseRoadmap was not called');
});

test('#269 Clear is no longer a bar button: a ⋮ menu button (aria-haspopup) ends the bar, closed by default', () => {
  const { R } = load();
  const html = R.html(data({ state: 'paused' }), () => {}, view);
  const bar = barOf(html).outer;
  assert.equal(!!H.findEl(bar, (e) => e.attrs['data-rm'] === 'clear'), false, 'no Clear button while the menu is closed');
  const menuBtn = H.findEl(bar, (e) => 'data-rm-menu' in e.attrs);
  assert.ok(menuBtn, 'a [data-rm-menu] button in the bar');
  assert.deepEqual([menuBtn.name, menuBtn.attrs['aria-haspopup'], menuBtn.attrs['aria-expanded'], H.visibleText(menuBtn.inner)], ['button', 'menu', 'false', '⋮']);
  const actions = H.findAll(bar, (e) => e.name === 'button').map((e) => e.start);
  assert.equal(Math.max(...actions), menuBtn.start, 'the ⋮ button is the last button of the bar');
});

test('#269 the ⋮ menu opens with Clear as a menu item, Clear still confirms, and Escape closes the menu', async () => {
  const { R, calls } = load();
  const d = data({ state: 'paused' });
  const { ctx, calls: ctxCalls } = H.makeCtx();
  await R.onClick(H.clickOn(R.html(d, () => {}, view), (e) => 'data-rm-menu' in e.attrs), ctx, d);
  assert.ok(ctxCalls.render >= 1, 'opening the menu redraws');
  const open = R.html(d, () => {}, view);
  const menu = H.findEl(open, (e) => e.attrs.role === 'menu');
  assert.ok(menu, 'role="menu" is rendered once opened');
  const clear = H.findEl(menu.outer, (e) => e.attrs['data-rm'] === 'clear');
  assert.ok(clear, 'Clear is inside the menu');
  assert.equal(clear.attrs.role, 'menuitem');
  assert.equal(H.findEl(open, (e) => 'data-rm-menu' in e.attrs)?.attrs['aria-expanded'], 'true');

  await R.onClick(H.clickOn(open, (e) => e.attrs['data-rm'] === 'clear'), ctx, d);
  assert.deepEqual([calls.confirm.length, calls.clear.length], [1, 0], 'Clear asked first; cancelled, nothing cleared');

  assert.equal(typeof R.onKeyDown, 'function', 'BacklogRoadmap.onKeyDown(e, ctx)');
  // reopen if the Clear click closed it, then Escape
  if (!H.findEl(R.html(d, () => {}, view), (e) => e.attrs.role === 'menu')) await R.onClick(H.clickOn(R.html(d, () => {}, view), (e) => 'data-rm-menu' in e.attrs), ctx, d);
  const handled = await R.onKeyDown({ key: 'Escape', preventDefault() {}, stopPropagation() {} }, ctx);
  assert.equal(handled, true);
  assert.equal(!!H.findEl(R.html(d, () => {}, view), (e) => e.attrs.role === 'menu'), false, 'Escape closed the menu');
});

test('#269 filters: Planned/All, the date filter and Group by epic sit in a filter row above the bar, not inside it; the bar keeps its counts', () => {
  const { R } = load();
  const d = data({ state: 'running' });
  d.epics = [{ id: '#10', title: 'Epic Alpha', members: [1] }];
  const html = R.html(d, () => {}, view);
  const bar = barOf(html);
  const inBar = ['data-rm-view', 'data-rm-since', 'data-rm-by-epic'].filter((a) => H.findEl(bar.outer, (e) => a in e.attrs));
  assert.deepEqual(inBar, [], 'no filter inside the bar');
  const row = H.findEl(html, (e) => e.attrs['data-testid'] === 'filter-row');
  assert.ok(row, 'a data-testid="filter-row" row');
  assert.ok(row.start < bar.start, 'the filter row comes before the bar');
  const inRow = ['data-rm-view', 'data-rm-since', 'data-rm-by-epic'].filter((a) => H.findEl(row.outer, (e) => a in e.attrs));
  assert.deepEqual(inRow, ['data-rm-view', 'data-rm-since', 'data-rm-by-epic']);
  assert.ok(H.findEl(bar.outer, (e) => e.attrs['data-testid'] === 'roadmap-count'), 'the counts stay in the bar');
});
