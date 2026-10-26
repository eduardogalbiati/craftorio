// A roadmap edit based on an older read (#287). The Roadmap screen (and the Product Owner's move, an
// Oracle edit that says what it read) sends the whole stages with the `updatedAt` it read (`base`);
// when the stored roadmap is newer, `onStored` applies only what the edit changed against that read
// to the stored stages, by item and stage id, and keeps everything else as stored:
// - a stage's name, note or switch; an item's workflow, simulation, chain, each input, and
//   its issues (the ones the edit added or took out, so an issue appended elsewhere stays);
// - a move (to another stage, or a new order), a removal, a new item or stage;
// - a release entry (#555, { kind: 'release', id, name }, between stages) is added, moved, renamed and
//   removed like a stage (it has no items: a removal takes it out, an empty one stays).
// It refuses, changing nothing, when the edit cannot be applied: the item or stage it changes is gone,
// the same field changed on both sides to different values, an item it removes changed elsewhere,
// or the read is no longer known (packages/engine/domains/roadmap/roadmap.js keeps the recent reads in memory, `readRoadmapAt`).
// Pure (no file access, the stages given are never changed): used by the roadmap channels
// (packages/engine/service/channels/roadmap.js) and the Oracle's roadmap.stages (packages/engine/service/areas/oracle.js).

const path = require('path');
const {
  isRelease,
  releaseEntries,
} = require('@multiagent/shared/roadmap-model');

const clone = (v) => JSON.parse(JSON.stringify(v ?? null));
const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
const numbers = (x) => (x?.issues?.length ? x.issues : x?.number ? [x] : []).map((i) => Number(typeof i === 'object' ? i.number : i));
const itemLabel = (x) => numbers(x).map((n) => `#${n}`).join(' + ') || 'an item';
const stageLabel = (stages, s) => {
  const n = stages.findIndex((x) => x.id === s.id);
  return `stage ${n + 1}${s.name ? ` "${s.name}"` : ''}`;
};
const upper = (text) => text.charAt(0).toUpperCase() + text.slice(1);
const refuse = (why) => ({ ok: false, reason: `${upper(why)} Nothing was saved.` });

// what an edit changes on a stage and on an item, with the words the refusal uses
const STAGE = {
  name: { what: 'name', get: (s) => String(s?.name || '').trim() },
  note: { what: 'note', get: (s) => String(s?.note || '').trim() },
  disabled: { what: 'switch', get: (s) => !!s?.disabled },
};
const ITEM = {
  workflow: { what: 'workflow', get: (x) => path.basename(String(x?.workflow || '')) },
  mock: { what: 'simulation setting', get: (x) => !!x?.mock },
  then: { what: '"When it finishes"', get: (x) => x?.then ?? null },
};
const content = (x) => ({ ...Object.fromEntries(Object.entries(ITEM).map(([k, f]) => [k, f.get(x)])), inputs: x?.inputs || {}, issues: numbers(x) });

// the elements of `list` whose id is in `ids` take the order of `ids`, in the places they hold
function reorder(list, ids) {
  const slots = list.map((x, n) => (ids.includes(x.id) ? n : -1)).filter((n) => n >= 0);
  const byId = new Map(list.map((x) => [x.id, x]));
  slots.forEach((n, j) => { list[n] = byId.get(ids[j]); });
}

/**
 * The edit (`edited` against `read`, the stages the writer read) applied to the stored stages
 * (`current`): { ok: true, stages } or { ok: false, reason } (a sentence for the owner).
 */
function mergeEdit(read, edited, current) {
  const base = read || [];
  const out = clone(current) || [];
  const baseStages = new Map(base.map((s) => [s.id, s]));
  const baseItems = new Map(base.flatMap((s) => (s.items || []).map((x) => [x.id, { x, stage: s }])));
  const outStage = new Map(out.map((s) => [s.id, s]));
  // a stage of the edit: its id when it is known, else the edit's own (new) stage
  const key = (e) => (e.id && (baseStages.has(e.id) || outStage.has(e.id)) ? e.id : e);
  const where = (id) => {
    for (const s of out) {
      const n = (s.items || []).findIndex((x) => x.id === id);
      if (n >= 0) return { s, n };
    }
    return null;
  };
  // an item of the edit's stage `e` (at `k`) goes after the one before it there, else first
  const place = (target, e, k, item) => {
    const prev = e.items.slice(0, k).reverse().map((x) => target.items.findIndex((y) => y.id && y.id === x.id)).find((n) => n >= 0);
    target.items.splice(prev == null ? 0 : prev + 1, 0, item);
  };
  const gone = (s) => (outStage.has(s.id) ? null : `${stageLabel(base, s)} was removed elsewhere`);

  // 1. the stages' own fields
  for (const e of edited) {
    const b = e.id && baseStages.get(e.id);
    if (!b) continue;
    for (const [k, f] of Object.entries(STAGE)) {
      // a writer that does not know the switch (#284) leaves it as stored
      if (k === 'disabled' && e.disabled === undefined) continue;
      if (same(f.get(b), f.get(e))) continue;
      const c = outStage.get(b.id);
      if (!c) return refuse(`${gone(b)}: its ${f.what} could not be changed.`);
      if (!same(f.get(c), f.get(b)) && !same(f.get(c), f.get(e))) return refuse(`the ${f.what} of ${stageLabel(base, b)} was changed elsewhere too.`);
      if (k === 'disabled') {
        if (e.disabled) c.disabled = true; else delete c.disabled;
      } else c[k] = e[k];
    }
  }
  // #555: the release entries the edit removed go (a stage goes with its last item, step 4)
  const listed = new Set(edited.map((e) => e.id).filter(Boolean));
  for (const b of base.filter((s) => isRelease(s) && !listed.has(s.id))) {
    const c = outStage.get(b.id);
    if (c) out.splice(out.indexOf(c), 1);
    outStage.delete(b.id);
  }
  // 2. the stages the edit added, after the stage before them in the edit
  edited.forEach((e, i) => {
    if (key(e) !== e) return;
    const prev = edited.slice(0, i).reverse().map((x) => outStage.get(key(x))).find(Boolean);
    const stage = { ...clone(e), items: [] };
    out.splice(prev ? out.indexOf(prev) + 1 : 0, 0, stage);
    outStage.set(e, stage);
  });
  // 3. the stages' order, when the edit changed it (the stages added elsewhere keep their places)
  const ordered = edited.filter((e) => baseStages.has(e.id) && outStage.has(e.id)).map((e) => e.id);
  if (!same(ordered, base.map((s) => s.id).filter((id) => ordered.includes(id)))) reorder(out, ordered);

  // 4. the items the edit removed (one changed elsewhere since is not the edit's to remove)
  const kept = new Set(edited.flatMap((e) => (e.items || []).map((x) => x.id)).filter(Boolean));
  for (const [id, { x: b }] of baseItems) {
    if (kept.has(id)) continue;
    const at = where(id);
    if (!at) continue;
    if (!same(content(at.s.items[at.n]), content(b))) return refuse(`${itemLabel(b)} was changed elsewhere, so it was not removed.`);
    at.s.items.splice(at.n, 1);
  }

  // 5. the items the edit changed, moved or added
  for (const e of edited) {
    for (const [k, x] of (e.items || []).entries()) {
      const target = outStage.get(key(e));
      const was = x.id && baseItems.get(x.id);
      if (!was) {
        if (x.id && where(x.id)) continue;
        if (!target) return refuse(`${gone(e)}: ${itemLabel(x)} could not be added to it.`);
        place(target, e, k, clone(x));
        continue;
      }
      const b = was.x;
      const moved = key(e) !== was.stage.id;
      const changed = !same(content(b), content(x));
      const at = where(x.id);
      if (!at) {
        if (!changed && !moved) continue;
        return refuse(`${gone(was.stage) || `${itemLabel(b)} was removed from the roadmap elsewhere`}: the change to ${itemLabel(b)} could not be applied.`);
      }
      const cur = at.s.items[at.n];
      for (const [f, field] of Object.entries(ITEM)) {
        if (same(field.get(b), field.get(x))) continue;
        if (!same(field.get(cur), field.get(b)) && !same(field.get(cur), field.get(x))) return refuse(`the ${field.what} of ${itemLabel(b)} was changed elsewhere too.`);
        if (x[f] === undefined) delete cur[f]; else cur[f] = clone(x[f]);
        if (f === 'workflow') cur.workflowName = x.workflowName || cur.workflowName;
      }
      const inputs = { ...(cur.inputs || {}) };
      for (const name of new Set([...Object.keys(b.inputs || {}), ...Object.keys(x.inputs || {})])) {
        const [was0, now, mine] = [b.inputs?.[name], inputs[name], x.inputs?.[name]];
        if (same(was0, mine)) continue;
        if (!same(now, was0) && !same(now, mine)) return refuse(`the input "${name}" of ${itemLabel(b)} was changed elsewhere too.`);
        if (mine === undefined) delete inputs[name]; else inputs[name] = clone(mine);
      }
      cur.inputs = inputs;
      // the issues: the ones the edit took out go, the ones it added come; one added elsewhere stays
      const [had, has] = [new Set(numbers(b)), new Set(numbers(x))];
      if (had.size !== has.size || [...has].some((n) => !had.has(n))) {
        const kept = (cur.issues || []).filter((i) => has.has(Number(i?.number ?? i)) || !had.has(Number(i?.number ?? i)));
        const held = new Set(kept.map((i) => Number(i?.number ?? i)));
        const added = (x.issues?.length ? x.issues : [x]).filter((i) => !had.has(Number(i?.number ?? i)) && !held.has(Number(i?.number ?? i)));
        cur.issues = [...kept, ...clone(added)];
      }
      if (moved) {
        if (at.s.id !== was.stage.id && at.s !== target) return refuse(`${itemLabel(b)} was moved elsewhere too.`);
        if (!target) return refuse(`${gone(e) || 'its new stage is gone'}: ${itemLabel(b)} could not be moved there.`);
        if (target !== at.s) {
          at.s.items.splice(at.n, 1);
          place(target, e, k, cur);
        }
      }
    }
  }
  // 6. the items' order in each stage, when the edit changed it
  for (const e of edited) {
    const target = outStage.get(key(e));
    if (!target) continue;
    const ids = (e.items || []).map((x) => x.id).filter((id) => id && (target.items || []).some((y) => y.id === id));
    const before = (baseStages.get(e.id)?.items || []).map((x) => x.id).filter((id) => ids.includes(id));
    if (before.length === ids.length && !same(ids, before)) reorder(target.items, ids);
  }
  return { ok: true, stages: out.filter((s) => isRelease(s) || s.items.length) };
}

/**
 * The stages to write for an edit `stages` based on the read `base` (its updatedAt; none: the edit
 * replaces the stored stages, as before #287): as sent when nothing was written since, else merged
 * into the stored ones. `stored`: the roadmap now; `read`: the stages as of `base`, or null when unknown.
 */
function onStored({ stored, stages, base, read }) {
  if (!base || !stored?.updatedAt || String(base) === stored.updatedAt) return { ok: true, stages };
  if (!read) return refuse('the roadmap was changed elsewhere since this edit read it, and what it read is no longer known here: reload and apply the edit again.');
  // #555: an edit of the Roadmap screen carries its cut lines on the stages (`release`): as entries
  return mergeEdit(read, Array.isArray(stages) ? releaseEntries(stages) : [], stored.stages || []);
}

module.exports = {
  mergeEdit,
  onStored,
};
