// #426 moving a stage or an item moves it past what the view hides. Acceptance tests written before
// the code.
// - src/renderer/views/backlog/backlog-roadmap.js is loaded whole in a vm sandbox with the shared
//   harness (test/roadmap-status-helpers.js, as test/renderer-roadmap-stage-menu-282.test.js does).
// - The view is drawn first (BacklogRoadmap.html with the view: Planned, All, an epic), then the stage's
//   ⋮ menu is opened and "↑ Run earlier" / "↓ Run later" clicked, or an item's ↑ / ↓ button.
// - What was saved is read from the api.saveRoadmap mock (the `roadmap:save` channel): its arguments
//   (projectId, stages, label, base) are copied to plain JSON, and the stage / item order compared by
//   ids. The toast is window.showToast's title and detail (the save answers an `edit.id`, #281).
// - Planned hides the finished stages (every item done or skipped); a disabled stage with a planned
//   item is still drawn there (dimmed). The epic filter hides the stages with no item of that epic.
const test = require('node:test');
const assert = require('node:assert/strict');
const H = require('./roadmap-status-helpers');

const T1 = '2026-10-20T10:00:00.000Z';
const PLANNED = { showAll: false, since: 'total' };
const ALL = { showAll: true, since: 'total' };

const it = (id, status, n) => H.item(id, status, n, `Issue ${n}`, { runId: null, runs: [], error: null });
const stage = (id, items, extra = {}) => ({ id, name: '', note: '', items, ...extra });

// [A planned, B done, C skipped, D planned, E disabled (planned item), F done, G planned, H done, I skipped]
// Planned draws A, D, E, G; it hides B, C, F, H, I.
function mixed() {
  return {
    roadmap: {
      state: 'planned',
      updatedAt: T1,
      stages: [
        stage('A', [it('a1', 'planned', 101)]),
        stage('B', [it('b1', 'done', 102)]),
        stage('C', [it('c1', 'skipped', 103)]),
        stage('D', [it('d1', 'planned', 104), it('d2', 'planned', 105)]),
        stage('E', [it('e1', 'planned', 106)], { disabled: true }),
        stage('F', [it('f1', 'done', 107)]),
        stage('G', [it('g1', 'planned', 108)]),
        stage('H', [it('h1', 'done', 109)]),
        stage('I', [it('i1', 'skipped', 110)]),
      ],
    },
    issues: [],
  };
}

// [X done, Y skipped, P planned, Q planned]: the top drawn stage has hidden stages before it
function hiddenOnTop() {
  return {
    roadmap: {
      state: 'planned',
      updatedAt: T1,
      stages: [
        stage('X', [it('x1', 'done', 201)]),
        stage('Y', [it('y1', 'skipped', 202)]),
        stage('P', [it('p1', 'planned', 203)]),
        stage('Q', [it('q1', 'planned', 204)]),
      ],
    },
    issues: [],
  };
}

function load() {
  const out = H.loadRoadmap();
  const saved = [];
  const toasts = [];
  out.sandbox.api.saveRoadmap = async (...args) => {
    saved.push(JSON.parse(JSON.stringify(args))); // primitives only: never compare vm objects
    return { roadmap: { state: 'planned', stages: args[1] }, issues: [], edit: { id: `e${saved.length}` } };
  };
  out.sandbox.window.showToast = (title, detail) => { toasts.push(`${String(title ?? '')} ${String(detail ?? '')}`); };
  return { ...out, saved, toasts };
}

const stageOf = (html, s) => H.findEl(html, (e) => e.attrs['data-testid'] === 'roadmap-stage' && e.attrs['data-stage'] === String(s));
const menuOf = (html, s) => H.findAll(stageOf(html, s).outer, (e) => e.attrs.role === 'menu')[0] || null;
const entryOf = (html, s, dir) => H.findEl(menuOf(html, s).outer, (e) => e.attrs.role === 'menuitem' && e.attrs['data-rm-stage'] === dir);
const ids = (stages) => stages.map((x) => x.id).join(',');
const whereIs = (stages, itemId) => {
  const s = stages.findIndex((x) => (x.items || []).some((i) => i.id === itemId));
  return { s, id: s < 0 ? null : stages[s].id ?? null, n: s < 0 ? -1 : stages[s].items.findIndex((i) => i.id === itemId), count: s < 0 ? 0 : stages[s].items.length };
};

// the view drawn, the stage's ⋮ menu opened (it is drawn again with the same view): the menu's markup
async function openMenu(R, d, s, view) {
  R.html(d, () => {}, view);
  const { ctx } = H.makeCtx();
  await R.onClick(H.clickOn(stageOf(R.html(d, () => {}, view), s).outer, (e) => e.attrs['data-testid'] === 'roadmap-stage-menu'), ctx, d);
  return R.html(d, () => {}, view);
}
// "↑ Run earlier" ('up') or "↓ Run later" ('down') of the stage at real index `s`, in `view`
async function moveStage(R, d, s, dir, view) {
  await clickEntry(R, d, await openMenu(R, d, s, view), s, dir);
}
// the entry of a menu already open (`html`: the view drawn with it)
async function clickEntry(R, d, html, s, dir) {
  const { ctx } = H.makeCtx();
  await R.onClick(H.clickOn(stageOf(html, s).outer, (e) => e.attrs.role === 'menuitem' && e.attrs['data-rm-stage'] === dir), ctx, d);
}
// the ↑ / ↓ button of item `id`, in `view`
async function moveItemBtn(R, d, id, dir, view) {
  const html = R.html(d, () => {}, view);
  const { ctx } = H.makeCtx();
  await R.onClick(H.clickOn(H.itemEl(html, id).outer, (e) => e.attrs['data-rm-move'] === dir), ctx, d);
}

// ---- 1. Planned: Run later passes the hidden stages ---------------------------------------------------

test('#426 Planned: "Run later" puts the stage just after the next drawn stage, the hidden ones in between keep their order', async () => {
  const { R, saved } = load();
  await moveStage(R, mixed(), 0, 'down', PLANNED);
  assert.equal(saved.length, 1, 'one save');
  assert.equal(ids(saved[0][1]), 'B,C,D,A,E,F,G,H,I', 'A lands after D (the next drawn stage); B and C stay in order');
});

test('#426 Planned: "Run earlier" puts the stage just before the previous drawn stage, past the hidden ones', async () => {
  const { R, saved } = load();
  await moveStage(R, mixed(), 6, 'up', PLANNED); // G: the previous drawn stage is E (index 4)
  assert.equal(saved.length, 1, 'one save');
  assert.equal(ids(saved[0][1]), 'A,B,C,D,G,E,F,H,I', 'G lands before E; F keeps its place after E');
});

// ---- 2. the ends of the drawn stages vs the roadmap's real ends ----------------------------------------

test('#426 Planned: "Run later" on the lowest drawn stage is on when hidden stages follow it, and moves it to the end of the roadmap', async () => {
  const { R, saved } = load();
  const d = mixed();
  const html = await openMenu(R, d, 6, PLANNED); // G, followed by H and I (hidden)
  assert.ok(!('aria-disabled' in entryOf(html, 6, 'down').attrs), 'not "the last stage": H and I follow it');
  await clickEntry(R, d, html, 6, 'down');
  assert.equal(saved.length, 1, 'one save');
  assert.equal(ids(saved[0][1]), 'A,B,C,D,E,F,H,I,G', 'G goes to the end, past H and I');
});

test('#426 Planned: "Run earlier" on the top drawn stage is on when hidden stages precede it, and moves it to the first place', async () => {
  const { R, saved } = load();
  const d = hiddenOnTop();
  const html = await openMenu(R, d, 2, PLANNED); // P, after X and Y (hidden)
  assert.ok(!('aria-disabled' in entryOf(html, 2, 'up').attrs), 'not "the first stage": X and Y precede it');
  await clickEntry(R, d, html, 2, 'up');
  assert.equal(saved.length, 1, 'one save');
  assert.equal(ids(saved[0][1]), 'P,X,Y,Q', 'P lands at index 0, X and Y keep their order');
});

test('#426 guard (unchanged): only the roadmap\'s real first / last stage has "Run earlier" / "Run later" off, with the reason', async () => {
  const { R, saved } = load();
  const d = hiddenOnTop();
  const last = await openMenu(R, d, 3, PLANNED); // Q: the real last stage
  assert.equal(entryOf(last, 3, 'down').attrs['aria-disabled'], 'true');
  assert.match(H.visibleText(menuOf(last, 3).inner), /It is the last stage/);
  await clickEntry(R, d, last, 3, 'down');
  assert.equal(saved.length, 0, 'nothing saved by the entry that is off');
});

// ---- 3. the epic filter --------------------------------------------------------------------------------

test('#426 epic filter: "Run later" passes the stages the epic hides (no item of that epic)', async () => {
  const { R, saved } = load();
  const d = {
    roadmap: {
      state: 'planned',
      updatedAt: T1,
      stages: [
        stage('K', [it('k1', 'planned', 301)]),
        stage('L', [it('l1', 'planned', 302)]),
        stage('M', [it('m1', 'planned', 303)]),
        stage('N', [it('n1', 'planned', 304)]),
      ],
    },
    issues: [{ number: 301, epic: 'E1' }, { number: 302, epic: 'E2' }, { number: 303, epic: 'E2' }, { number: 304, epic: 'E1' }],
    epics: [{ id: 'E1', title: 'One' }, { id: 'E2', title: 'Two' }],
  };
  const view = { ...PLANNED, epic: 'E1' }; // draws K and N
  assert.equal(stageOf(R.html(d, () => {}, view), 1), null, 'L is hidden by the epic (fixture check)');
  await moveStage(R, d, 0, 'down', view);
  assert.equal(saved.length, 1, 'one save');
  assert.equal(ids(saved[0][1]), 'L,M,N,K', 'K lands after N, the next stage of the epic; L and M keep their order');
});

test('#426 date range: in All with "Last 24 hours", "Run later" passes the stages with nothing in the range', async () => {
  const { R, saved } = load();
  const recent = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const old = '2020-01-01T00:00:00.000Z';
  const done = (id, n, origin) => H.item(id, 'done', n, `Issue ${n}`, { runId: null, runs: [], error: null, origin });
  const d = {
    roadmap: {
      state: 'planned',
      updatedAt: T1,
      stages: [stage('K', [done('k1', 401, recent)]), stage('L', [done('l1', 402, old)]), stage('M', [done('m1', 403, old)]), stage('N', [done('n1', 404, recent)])],
    },
    issues: [],
  };
  const view = { showAll: true, since: '24h' }; // draws K and N
  assert.equal(stageOf(R.html(d, () => {}, view), 1), null, 'L is out of the range (fixture check)');
  await moveStage(R, d, 0, 'down', view);
  assert.equal(saved.length, 1, 'one save');
  assert.equal(ids(saved[0][1]), 'L,M,N,K', 'K lands after N, the next stage in the range; L and M keep their order');
});

// ---- 4. the toast and the history name the real stage numbers -----------------------------------------

test('#426 the toast names the stage\'s number before and after the move, from the real indexes', async () => {
  const { R, saved, toasts } = load();
  await moveStage(R, mixed(), 0, 'down', PLANNED); // stage 1 → stage 4 (after D)
  assert.equal(saved.length, 1);
  assert.equal(toasts.length, 1, 'one toast with Undo');
  assert.match(toasts[0], /(^|\D)1(\D|$)/, `names stage 1: ${toasts[0]}`);
  assert.match(toasts[0], /(^|\D)4(\D|$)/, `names stage 4 (its place now): ${toasts[0]}`);
  assert.doesNotMatch(toasts[0], /(^|\D)2(\D|$)/, `not stage 2 (the swap's place): ${toasts[0]}`);
  assert.match(String(saved[0][2]), /(^|\D)1(\D|$)/, `the history label names stage 1: ${saved[0][2]}`);
});

// ---- 5. an item past its stage's edge ------------------------------------------------------------------

test('#426 Planned: an item moved down past its stage\'s last place goes into the next drawn stage, never a hidden finished one', async () => {
  const { R, saved } = load();
  await moveItemBtn(R, mixed(), 'a1', 'down', PLANNED);
  assert.equal(saved.length, 1, 'one save');
  const at = whereIs(saved[0][1], 'a1');
  assert.equal(at.id, 'D', 'into D (the next drawn stage), not B (done, hidden)');
  assert.equal(at.n, 0, 'at the top of D');
  assert.equal(saved[0][1].find((x) => x.id === 'B').items.length, 1, 'B keeps only its own item');
});

test('#426 Planned: an item moved up past its stage\'s first place goes into the previous drawn stage, at its end', async () => {
  const { R, saved } = load();
  await moveItemBtn(R, mixed(), 'd1', 'up', PLANNED);
  assert.equal(saved.length, 1, 'one save');
  const at = whereIs(saved[0][1], 'd1');
  assert.equal(at.id, 'A', 'into A (the previous drawn stage), not C (skipped, hidden)');
  assert.equal(at.n, at.count - 1, 'at the end of A');
});

test('#426 Planned: an item moved down from the lowest drawn stage, with only hidden stages below, goes into a new last stage', async () => {
  const { R, saved } = load();
  await moveItemBtn(R, mixed(), 'g1', 'down', PLANNED);
  assert.equal(saved.length, 1, 'one save');
  const stages = saved[0][1];
  const at = whereIs(stages, 'g1');
  assert.equal(at.s, stages.length - 1, 'in the last stage');
  assert.equal(at.count, 1, 'alone in it: a new stage');
  assert.notEqual(at.id, 'H', 'not into H (done, hidden)');
  assert.equal(stages.find((x) => x.id === 'H').items.length, 1, 'H keeps only its own item');
  assert.equal(stages.find((x) => x.id === 'I').items.length, 1, 'I keeps only its own item');
});

// ---- 6. All, no filter: today's swap ------------------------------------------------------------------

test('#426 guard (unchanged): in All with no filter, "Run later" swaps the stage with the next one', async () => {
  const { R, saved } = load();
  await moveStage(R, mixed(), 0, 'down', ALL);
  assert.equal(saved.length, 1, 'one save');
  assert.equal(ids(saved[0][1]), 'B,A,C,D,E,F,G,H,I');
});

// ---- 7. one save with its base (#287) -----------------------------------------------------------------

test('#426 a stage moved past hidden stages and an item moved past them are each one save with the roadmap\'s updatedAt as base', async () => {
  const stageRun = load();
  await moveStage(stageRun.R, mixed(), 0, 'down', PLANNED);
  assert.equal(stageRun.saved.length, 1, 'the stage move: one save');
  assert.equal(stageRun.saved[0][3], T1, 'with the base read (#287)');
  assert.equal(ids(stageRun.saved[0][1]), 'B,C,D,A,E,F,G,H,I', 'the stage passed the hidden ones');
  const itemRun = load();
  await moveItemBtn(itemRun.R, mixed(), 'a1', 'down', PLANNED);
  assert.equal(itemRun.saved.length, 1, 'the item move: one save');
  assert.equal(itemRun.saved[0][3], T1, 'with the base read (#287)');
  assert.equal(whereIs(itemRun.saved[0][1], 'a1').id, 'D', 'the item passed the hidden ones');
});
