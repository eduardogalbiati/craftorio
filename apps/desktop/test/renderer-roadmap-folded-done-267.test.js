// #267 "The Roadmap's '+n done' is a green chip that expands only its stage". Acceptance tests
// written before the code. backlog-roadmap.js is evaluated whole in a vm sandbox
// (test/roadmap-status-helpers.js loadRoadmap) with a fixed clock; clicks go through
// BacklogRoadmap.onClick with a fake target built from the rendered markup (its closest() walks the
// element's real ancestors), then the view is drawn again as backlog.js's ctx.render() would.
//
// Contract (the seam these tests assume):
// - In the default view (Planned, #268; no `view` passed) a stage's finished items (done or skipped,
//   within the date window: here they ended an hour ago) fold into a `<button>` reading exactly
//   "+1 done", class `rm-done-chip`, WITHOUT `data-rm-show-all` (it no longer turns Show all on),
//   `aria-expanded="false"`, an aria-label naming the count and the stage ("Show 1 done item of
//   stage 1"), and a title listing the folded items ("#3 Done three (done)").
// - A click on it unfolds that stage's finished items in place; the chip then reads "Hide 1 done"
//   with aria-expanded="true"; ctx.setShowAll is never called; the other stages stay folded. A second
//   click folds it back.
// - The choice is remembered per stage id across re-renders (the roadmap file re-read every 2 s,
//   #204, gives a fresh data object), and forgotten once that stage has no finished item to fold.
// - css: the chip's selector uses the run chat's `.duo-note.done` colour tokens (var(--green) and
//   rgba(74, 222, 128, …)).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const H = require('./roadmap-status-helpers');

const recent = { origin: H.iso(H.NOW - 3 * H.HOUR) };
const ended = (id, status, n, title) => H.item(id, status, n, title, {
  ...recent, runId: `run-${id}`, runs: [`run-${id}`],
  run: H.run({ status: status === 'done' ? 'success' : 'failed', startedAt: H.iso(H.NOW - 2 * H.HOUR), finishedAt: H.iso(H.NOW - H.HOUR) }),
});
// two stages, each with one done item and one planned item; a third with only open work
function data() {
  return H.roadmapOf([
    { id: 'st1', name: '', note: '', items: [ended('d1', 'done', 3, 'Done three'), H.item('p1', 'planned', 4, 'Planned four', recent)] },
    { id: 'st2', name: '', note: '', items: [ended('d2', 'done', 5, 'Done five'), H.item('p2', 'planned', 6, 'Planned six', recent)] },
  ], { state: 'paused' });
}
// the "+n done" / "Hide n done" button of stage `n` (1-based)
function chipOf(html, n) {
  const stage = H.stageEl(html, n);
  assert.ok(stage, `Stage ${n} is rendered`);
  const chip = H.findEl(stage.outer, (e) => e.name === 'button' && /^(\+\d+|Hide \d+) done$/.test(H.visibleText(e.inner)));
  assert.ok(chip, `Stage ${n} has a "+n done" button`);
  return chip;
}
// clicks the chip of stage `n` (offsets inside the stage's markup + the stage's own offset)
async function clickChip(R, html, n, ctx) {
  const chip = chipOf(html, n);
  const stage = H.stageEl(html, n);
  const ev = H.clickOn(html, (e) => e.start === stage.start + chip.start);
  return R.onClick(ev, ctx, data());
}

test('#267 the folded finished items show as a "+1 done" button (class rm-done-chip) that no longer turns Show all on', () => {
  const { R } = H.loadRoadmap();
  const chip = chipOf(R.html(data(), () => {}), 1);
  assert.equal(H.visibleText(chip.inner), '+1 done');
  assert.match(chip.attrs.class || '', /\brm-done-chip\b/);
  assert.equal('data-rm-show-all' in chip.attrs, false);
});

test('#267 the chip\'s tooltip lists the folded items with their state', () => {
  const { R } = H.loadRoadmap();
  const title = chipOf(R.html(data(), () => {}), 1).attrs.title || '';
  assert.match(title, /#3\b/);
  assert.match(title, /\(done\)/);
});

test('#267 the chip is collapsed (aria-expanded="false") and its aria-label names the count and the stage', () => {
  const { R } = H.loadRoadmap();
  const chip = chipOf(R.html(data(), () => {}), 1);
  assert.equal(chip.attrs['aria-expanded'], 'false');
  assert.match(chip.attrs['aria-label'] || '', /1 done/);
  assert.match(chip.attrs['aria-label'] || '', /stage 1\b/i);
});

test('#267 a click unfolds only that stage\'s finished items in place: "Hide 1 done", aria-expanded="true", Show all untouched', async () => {
  const { R } = H.loadRoadmap();
  const { ctx, calls } = H.makeCtx();
  const before = R.html(data(), () => {});
  assert.equal(H.itemShown(before, 'd1'), false, 'folded at first');
  const handled = await clickChip(R, before, 1, ctx);
  assert.equal(handled, true);
  assert.deepEqual(calls.showAll, [], 'ctx.setShowAll is not called');
  const after = R.html(data(), () => {});
  assert.equal(H.itemShown(after, 'd1'), true, 'stage 1\'s done item is back');
  assert.ok(H.stageEl(after, 1).outer.includes('data-item="d1"'), 'in its own stage');
  const chip = chipOf(after, 1);
  assert.equal(H.visibleText(chip.inner), 'Hide 1 done');
  assert.equal(chip.attrs['aria-expanded'], 'true');
});

test('#267 unfolding one stage leaves the other stages folded', async () => {
  const { R } = H.loadRoadmap();
  const { ctx } = H.makeCtx();
  await clickChip(R, R.html(data(), () => {}), 1, ctx);
  const after = R.html(data(), () => {});
  assert.equal(H.itemShown(after, 'd1'), true, 'stage 1 is unfolded');
  assert.equal(H.itemShown(after, 'd2'), false);
  assert.equal(H.visibleText(chipOf(after, 2).inner), '+1 done');
});

test('#267 a second click folds the stage back', async () => {
  const { R } = H.loadRoadmap();
  const { ctx } = H.makeCtx();
  await clickChip(R, R.html(data(), () => {}), 1, ctx);
  const open = R.html(data(), () => {});
  assert.equal(H.itemShown(open, 'd1'), true, 'the first click unfolded it');
  await clickChip(R, open, 1, ctx);
  const after = R.html(data(), () => {});
  assert.equal(H.itemShown(after, 'd1'), false);
  assert.equal(H.visibleText(chipOf(after, 1).inner), '+1 done');
});

test('#267 the unfolded stage stays unfolded when the roadmap file is read again (a fresh data object)', async () => {
  const { R } = H.loadRoadmap();
  const { ctx } = H.makeCtx();
  await clickChip(R, R.html(data(), () => {}), 1, ctx);
  const reread = R.html(H.clone(data()), () => {});
  assert.equal(H.itemShown(reread, 'd1'), true);
  assert.equal(H.visibleText(chipOf(reread, 1).inner), 'Hide 1 done');
});

test('#267 the choice is forgotten once the stage has no finished item left to fold', async () => {
  const { R } = H.loadRoadmap();
  const { ctx } = H.makeCtx();
  await clickChip(R, R.html(data(), () => {}), 1, ctx);
  assert.equal(H.itemShown(R.html(data(), () => {}), 'd1'), true, 'the click unfolded it');
  // the done item left stage 1 (e.g. moved by an edit of the file): nothing to fold there
  const without = data();
  without.roadmap.stages[1].items.push(without.roadmap.stages[0].items.shift());
  R.html(without, () => {});
  // it is back: folded again
  const again = R.html(data(), () => {});
  assert.equal(H.itemShown(again, 'd1'), false);
  assert.equal(H.visibleText(chipOf(again, 1).inner), '+1 done');
});

test('#267 css: the done chip is green with the run chat\'s .duo-note.done tokens', () => {
  const css = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p); else if (e.name.endsWith('.css')) css.push(fs.readFileSync(p, 'utf8'));
    }
  };
  walk(H.R);
  const text = css.join('\n').replace(/\/\*[\s\S]*?\*\//g, '');
  const bodies = [...text.matchAll(/([^{}]*rm-done-chip[^{}]*)\{([^{}]*)\}/g)].map((m) => m[2].replace(/\s+/g, ''));
  assert.ok(bodies.length > 0, 'a css rule for .rm-done-chip');
  assert.ok(bodies.some((b) => b.includes('var(--green)')), 'its text in var(--green)');
  assert.ok(bodies.some((b) => b.includes('rgba(74,222,128,')), 'its background / border in rgba(74, 222, 128, …)');
});
