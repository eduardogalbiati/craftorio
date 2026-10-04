// #279: the roadmap card's "Update the app after this" switch (src/renderer/views/backlog/backlog-roadmap.js),
// shown only when Self-healing can apply merged fixes to this app (api.appUpdateState → applies) and
// saved on the item (updateAfter) at once. The renderer runs in a vm sandbox (test/roadmap-status-helpers.js).
const test = require('node:test');
const assert = require('node:assert/strict');
const H = require('./roadmap-status-helpers');

function setup(applies) {
  const loaded = H.loadRoadmap();
  const saved = [];
  loaded.sandbox.api.appUpdateState = async () => (applies ? { applies: true, project: { id: 'p1', name: 'mao' }, short: '5d9be33', behind: 3 } : { applies: false, reason: "no project of this workspace is this app's repository" });
  loaded.sandbox.api.saveRoadmap = async (projectId, stages) => { saved.push(JSON.parse(JSON.stringify(stages))); return { roadmap: { state: 'planned', stages } }; };
  return { ...loaded, saved };
}

const data = () => H.roadmapOf([
  { id: 'st1', name: '', note: '', items: [H.item('i1', 'done', 1, 'Done one')] },
  { id: 'st2', name: '', note: '', items: [H.item('i2', 'planned', 2, 'Planned two'), H.item('i3', 'planned', 3, 'Marked three', { updateAfter: true })] },
], { state: 'planned' });

const switchOf = (html, id) => H.findEl(H.itemEl(html, id).outer, (e) => e.attrs['data-testid'] === 'roadmap-update-after');

// the first draw asks the main process whether the feature applies; the answer redraws
async function draw(R) {
  let again = 0;
  R.html(data(), () => { again++; });
  await H.settle();
  await H.settle();
  return { html: R.html(data(), () => {}), again };
}

test('#279 roadmap card: when the update applies, a card not finished offers "Update the app after this", ticked when marked', async () => {
  const { R } = setup(true);
  const { html, again } = await draw(R);
  assert.equal(again >= 1, true);
  const planned = switchOf(html, 'i2');
  assert.equal(planned === null, false);
  assert.equal('checked' in planned.attrs, false);
  assert.equal(planned.attrs['aria-label'], 'Update the app after this');
  assert.equal('checked' in switchOf(html, 'i3').attrs, true);
});

test('#279 roadmap card: a finished item never offers the switch', async () => {
  const { R } = setup(true);
  const { html } = await draw(R);
  // finished stages may be folded away; when the done item is drawn, it has no switch
  if (H.itemShown(html, 'i1')) assert.equal(switchOf(html, 'i1') === null, true);
  assert.equal(switchOf(html, 'i2') === null, false);
});

test('#279 roadmap card: when the update does not apply, no card offers the switch', async () => {
  const { R } = setup(false);
  const { html } = await draw(R);
  assert.equal(switchOf(html, 'i2') === null, true);
  assert.equal(switchOf(html, 'i3') === null, true);
});

test('#279 roadmap card: ticking the switch saves the item with updateAfter at once', async () => {
  const { R, saved } = setup(true);
  const { html } = await draw(R);
  const { ctx } = H.makeCtx();
  const el = H.findEl(H.itemEl(html, 'i2').outer, (e) => e.attrs['data-testid'] === 'roadmap-update-after');
  // the element parsed inside the whole markup, so closest() reaches its item and stage
  const inPage = H.findAll(html, (e) => e.attrs['data-testid'] === 'roadmap-update-after').find((e) => e.start >= H.itemEl(html, 'i2').start && e.end <= H.itemEl(html, 'i2').end);
  assert.equal(!!el && !!inPage, true);
  const target = H.fakeEl(inPage, { checked: true });
  await R.onClick({ target, preventDefault() {}, stopPropagation() {} }, ctx, data());
  assert.equal(saved.length, 1);
  const items = saved[0].flatMap((s) => s.items);
  assert.equal(items.find((x) => x.id === 'i2').updateAfter, true);
  assert.equal(items.find((x) => x.id === 'i3').updateAfter, true);
});
