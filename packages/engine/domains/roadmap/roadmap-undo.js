// Undo of an owner's roadmap edit (#281). `recordEdit` keeps what an edit changed: the stages before
// and after it, with its label ("Removed #279 from the roadmap"). `undoEdit` puts that back into the
// roadmap as it is now, never an older copy of the whole file:
// - what the edit removed comes back at its place (an item, with its stage when it went too), the
//   stages and the items go back to their order, a stage to its name and note, a release entry
//   (#555) to its place and name (not one whose release run started);
// - what the edit added goes, unless it has started since;
// - an item that exists now keeps its run (status, runId, runs, error), and one that is running or
//   done is not changed at all; items and stages added since stay.
// It refuses, changing nothing, when an issue it brings back is planned in another unfinished item
// now, or when nothing of the edit is left to put back. An edit without `after` is an earlier version
// (packages/engine/domains/roadmap/roadmap-history.js, Restore): the same rule, with nothing known to have been added.
// The current stages carry each item's status as derived from its run (`running`, `done`…): the file
// stores an item with a run as `planned` (packages/engine/domains/roadmap/roadmap.js persisted), so the channels overlay the
// derived statuses before calling it.
// Pure (no file access, the stages given are never changed): used by the roadmap channels
// (packages/engine/service/channels/roadmap.js) and packages/engine/domains/roadmap/roadmap-history.js.

const { testsLater } = require('./roadmap');
const { isFinished, isRelease } = require('@multiagent/shared/roadmap-model');

const clone = (v) => JSON.parse(JSON.stringify(v ?? null));
const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
const issuesOf = (x) => (x.issues?.length ? x.issues : x.number ? [x] : []);
const itemsOf = (stages) => new Map((stages || []).flatMap((s) => (s.items || []).map((x) => [x.id, x])));
const stagesById = (stages) => new Map((stages || []).map((s) => [s.id, s]));
// an item without its run: what an edit changes
const content = (x) => { const { status, runId, runs, error, ...rest } = x; return rest; };
const untouchable = (x) => x.status === 'running' || x.status === 'done';
const notStarted = (x) => x.status === 'planned' && !x.runId;
const stageLabel = (stages, n) => `stage ${n + 1}${stages[n].name ? ` "${stages[n].name}"` : ''}`;

/** What an edit changed: { label, at, before, after } (copies of the stages, JSON-safe). */
function recordEdit(beforeStages, afterStages, label) {
  return { label: String(label || 'Edited the roadmap'), at: new Date().toISOString(), before: clone(beforeStages) || [], after: clone(afterStages) || [] };
}

/** The stages with the edit taken back: { ok: true, stages }, or { ok: false, reason } (nothing changes). */
function undoEdit(currentStages, edit) {
  const before = edit?.before || [];
  const after = Array.isArray(edit?.after) ? edit.after : null;
  const current = clone(currentStages) || [];
  const [was, then, now] = [itemsOf(before), itemsOf(after), itemsOf(current)];
  const [thenStages, nowStages] = [stagesById(after), stagesById(current)];
  const changed = new Set(); // the items brought back or given their earlier content

  // a stage of before is put back when it is still there or the edit removed it (not one removed since)
  const back = before.filter((s) => nowStages.has(s.id) || !after || !thenStages.has(s.id));
  const home = new Set(back.flatMap((s) => (s.items || []).map((x) => x.id)));
  // what the edit added and has not started goes with it
  const added = (x) => !!after && then.has(x.id) && !was.has(x.id) && notStarted(x);
  const stays = (x) => !home.has(x.id) && !added(x);

  function item(old) {
    const cur = now.get(old.id);
    // removed by the edit: back as it was; removed since: it stays out
    if (!cur) { if (after && then.has(old.id)) return null; changed.add(old.id); return clone(old); }
    if (untouchable(cur)) return cur;
    // #395: a skip the edit made (Move on from a stage) and still in place is taken back with it
    const unskipped = !!after && cur.status === 'skipped' && then.get(old.id)?.status === 'skipped' && old.status !== 'skipped';
    if (after && !unskipped && same(content(old), content(then.get(old.id) || {}))) return cur;
    // #395: a Move on taken back: the item waits at its gate again as the stage's (its run untouched)
    const unparked = cur.status === 'parked' && old.status !== 'parked';
    const out = { ...clone(content(old)), status: unparked || unskipped ? old.status : cur.status, runId: cur.runId, runs: cur.runs, error: unskipped ? old.error : cur.error, ...(cur.parked && !unparked ? { parked: cur.parked } : {}) };
    if (out.error === undefined) delete out.error;
    if (!same(out, cur)) changed.add(old.id);
    return out;
  }
  function head(old, cur) {
    if (!cur) { const { items, ...rest } = clone(old); return rest; }
    const { items, ...rest } = cur;
    const edited = thenStages.get(old.id);
    for (const k of ['name', 'note', 'disabled']) {
      if (after && edited && same(old[k], edited[k])) continue;
      // #555: a release whose run has started is not the edit's to rename
      if (isRelease(rest) && (rest.status || rest.runId)) continue;
      if (old[k] === undefined) delete rest[k]; else rest[k] = clone(old[k]);
    }
    return rest;
  }

  // #555: a release entry (no items) comes back or stays by itself; one the edit added goes, unless its run started
  const addedRelease = (s) => !!after && thenStages.has(s.id) && !before.some((b) => b.id === s.id) && !s.status && !s.runId;
  const stages = [];
  for (const old of back) {
    const cur = nowStages.get(old.id);
    const items = [...(old.items || []).map(item).filter(Boolean), ...(cur?.items || []).filter(stays)];
    if (items.length || isRelease(old)) stages.push({ ...head(old, cur), items });
  }
  // the stages added since (or by the edit, with what has started in them)
  const known = new Set(back.map((s) => s.id));
  for (const cur of current) {
    if (known.has(cur.id)) continue;
    const items = (cur.items || []).filter(stays);
    if (items.length || (isRelease(cur) && !addedRelease(cur))) stages.push({ ...cur, items });
  }

  // an issue belongs to one unfinished item (packages/engine/domains/roadmap/roadmap.js assertUnique)
  const open = (x) => !isFinished(x) && !testsLater(x);
  for (const [n, stage] of stages.entries()) {
    for (const x of stage.items.filter(open)) {
      for (const [m, other] of stages.entries()) {
        for (const y of other.items) {
          if (y.id === x.id || !open(y) || !(changed.has(x.id) || changed.has(y.id))) continue;
          const twice = issuesOf(x).find((i) => issuesOf(y).some((j) => j.number === i.number));
          if (!twice) continue;
          const at = changed.has(x.id) ? m : n;
          return { ok: false, reason: `Issue #${twice.number} is planned in another item now (${stageLabel(stages, at)}): putting this back would plan it twice. Remove it there first.` };
        }
      }
    }
  }
  if (same(stages, current)) return { ok: false, reason: 'Nothing to put back: what this edit changed is no longer in the roadmap.' };
  return { ok: true, stages };
}

module.exports = {
  recordEdit,
  undoEdit,
};
