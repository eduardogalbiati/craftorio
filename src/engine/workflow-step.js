// The `type: workflow` step (#174, workflow chaining phase 3 of #136): a step without an agent that
// runs another workflow as a child run and waits for it.
//   - id: develop
//     type: workflow
//     workflow: software-development.yaml       # a template over the run
//     inputs: { task: "{{ item.title }}", repo_path: "{{ inputs.repo_path }}" }
//     foreach: "{{ steps.plan.output.issues }}"  # optional: one child per item (`item`, `index` in the templates)
//     max_parallel: 2                            # optional, with foreach (default 1)
// An input written as one whole `{{ expr }}` keeps the value's type (a list stays a list); any other
// template renders to text. With `foreach`, items that declare the same `files` never run at the same
// time (the Product Owner's grouping rule), whatever `max_parallel` says.
// Each child is a normal run (its own folder, worktree, sessions and gates), started through the
// run's `startChild` hook (the service starts it like any run, linked by `parent_run`); its gates wait
// for the owner, and so does this step: nothing here answers a gate. Stopping the parent stops its
// children; each `workflow.child_finished` carries the child's cost (its children's included, #175).
// It never throws for a child's outcome:
//   once:    { kind: 'workflow', workflow, status, run_id, outputs, error }
//   foreach: { kind: 'workflow', workflow, status, runs: [{ index, item, run_id, status, error, outputs }],
//              outputs: [<outputs per item>], succeeded, failed }
// `status` is success when every child succeeded, failed when one failed, else cancelled; the engine
// routes a step that is not a success to its `on_error` (or its transitions, which see `output.status`).

const path = require('path');

const WHOLE = /^\s*\{\{([\s\S]*?)\}\}\s*$/;
// how deep children may nest (a workflow that runs a workflow that runs ...)
const MAX_DEPTH = 3;

const plain = (v) => v && typeof v === 'object' && !Array.isArray(v);

/** Throws on a bad `type: workflow` step; `file` is the workflow that holds it. */
function validateWorkflowStep(s, file) {
  const where = `Step "${s.id}"`;
  if (s.agent || s.agents) throw new Error(`${where}: a workflow step has no agent (its child workflow has them).`);
  if (typeof s.workflow !== 'string' || !s.workflow.trim()) throw new Error(`${where}: workflow must name the workflow file to run (e.g. software-development.yaml).`);
  if (file && !s.workflow.includes('{{') && path.basename(s.workflow) === path.basename(file)) throw new Error(`${where}: a workflow cannot run itself.`);
  if (s.inputs !== undefined && !plain(s.inputs)) throw new Error(`${where}: inputs must be a map of the child workflow's inputs.`);
  if (s.foreach !== undefined && typeof s.foreach !== 'string' && !Array.isArray(s.foreach)) throw new Error(`${where}: foreach must be a list or a template that gives one (e.g. "{{ steps.plan.output.issues }}").`);
  if (s.max_parallel !== undefined) {
    if (s.foreach === undefined) throw new Error(`${where}: max_parallel needs foreach.`);
    const n = s.max_parallel;
    if (!(typeof n === 'string' && n.includes('{{')) && !(Number.isInteger(+n) && +n >= 1)) throw new Error(`${where}: max_parallel must be a whole number of 1 or more.`);
  }
}

// A template's value: a whole `{{ expr }}` keeps its type (through to_json), anything else is text.
// Lists and maps are resolved item by item.
function resolveValue(v, scope, render) {
  if (Array.isArray(v)) return v.map((x) => resolveValue(x, scope, render));
  if (plain(v)) return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, resolveValue(x, scope, render)]));
  if (typeof v !== 'string') return v;
  const m = WHOLE.exec(v);
  if (m && !m[1].includes('{{') && !m[1].includes('}}')) {
    const text = render(`{{ (${m[1]}) | to_json }}`, scope).trim();
    if (!text || text === 'undefined') return null;
    try { return JSON.parse(text); } catch { return text; }
  }
  return render(v, scope);
}

// The foreach list: a list, JSON text of one, or one item per line.
function foreachItems(step, scope, render) {
  const v = resolveValue(step.foreach, scope, render);
  if (v == null || v === '') return [];
  if (Array.isArray(v)) return v;
  if (typeof v === 'string') {
    try { const parsed = JSON.parse(v); if (Array.isArray(parsed)) return parsed; } catch { /* lines */ }
    return v.split('\n').map((x) => x.trim()).filter(Boolean);
  }
  throw new Error(`Step "${step.id}": foreach gave ${typeof v}, not a list.`);
}

// The files an item declares (`files: [...]`), normalized to compare paths.
const itemFiles = (item) => (plain(item) ? [].concat(item.files || []) : [])
  .filter((f) => typeof f === 'string' && f.trim())
  .map((f) => f.trim().replace(/\\/g, '/').replace(/^\.\//, '').toLowerCase());

// A short label of an item for the log and the child's notice: its number and title when it has them.
function itemLabel(item, index) {
  if (plain(item)) {
    const n = item.number != null ? `#${item.number}` : '';
    const t = item.title || item.name || item.id || '';
    return [n, t].filter(Boolean).join(' ') || `item ${index + 1}`;
  }
  return String(item).slice(0, 80) || `item ${index + 1}`;
}

/**
 * Runs `runOne(i)` for each index, at most `max` at a time, never two whose `files[i]` overlap.
 * runOne never rejects. Indexes not started when `signal` aborts are left undefined.
 */
async function schedule(count, max, files, runOne, signal) {
  const pending = [...Array(count).keys()];
  const running = new Map();
  while (pending.length || running.size) {
    while (!signal?.aborted && running.size < max) {
      const busy = new Set([...running.keys()].flatMap((i) => files[i]));
      const k = pending.findIndex((i) => !files[i].some((f) => busy.has(f)));
      if (k < 0) break;
      const [i] = pending.splice(k, 1);
      running.set(i, runOne(i).finally(() => running.delete(i)));
    }
    if (!running.size) break;
    await Promise.race(running.values());
  }
}

const overall = (statuses) => (statuses.every((s) => s === 'success') ? 'success' : statuses.includes('failed') ? 'failed' : 'cancelled');

/**
 * Runs a `type: workflow` step. startChild({ file, inputs, parent, label, signal, previous }) →
 * Promise<{ runId, finished: Promise<{ status, outputs, error, cost_usd }>, stop(), resumedFrom?,
 * reused? }>; emit(type, data) records an event on the parent run; parent: { run_id, workflow, depth }
 * of the run that holds the step. previous: { <index>: { run_id, status } } the children a resumed
 * parent's previous run started for this step (#175): startChild reuses a child that succeeded and
 * resumes one that did not, from where it stopped; an item with another label starts afresh.
 */
async function runWorkflowStep({ step, scope, render, startChild, emit, signal, parent, previous = null }) {
  const workflow = render(step.workflow, scope).trim();
  const foreach = step.foreach !== undefined;
  const items = foreach ? foreachItems(step, scope, render) : [null];
  const max = foreach ? Math.max(1, Math.floor(+resolveValue(step.max_parallel ?? 1, scope, render)) || 1) : 1;
  const depth = (parent.depth || 0) + 1;
  const live = new Map(); // index -> stop()
  const onAbort = () => { for (const stop of live.values()) stop(); };
  signal?.addEventListener('abort', onAbort);
  const results = new Array(items.length);

  const runOne = async (index) => {
    const item = items[index];
    const label = foreach ? itemLabel(item, index) : null;
    const base = { index, ...(foreach ? { item } : {}), run_id: null, status: 'failed', error: null, outputs: {} };
    let cost = 0;
    try {
      if (depth > MAX_DEPTH) throw new Error(`child workflows nest at most ${MAX_DEPTH} deep.`);
      const itemScope = foreach ? { ...scope, item, index } : scope;
      const inputs = resolveValue(step.inputs || {}, itemScope, render);
      const prev = previous?.[index];
      const child = await startChild({
        file: workflow, inputs, label, signal,
        parent: { run_id: parent.run_id, workflow: parent.workflow, step_id: step.id, depth, ...(foreach ? { index } : {}) },
        ...(prev?.run_id && (prev.label ?? null) === label ? { previous: { run_id: prev.run_id, status: prev.status } } : {}),
      });
      base.run_id = child.runId;
      live.set(index, child.stop);
      if (signal?.aborted) child.stop();
      emit('workflow.child_started', {
        step_id: step.id, child_run_id: child.runId, workflow, ...(foreach ? { index, label } : {}),
        ...(child.resumedFrom ? { resumed_from: child.resumedFrom } : {}), ...(child.reused ? { reused: true } : {}),
      });
      const end = await child.finished;
      Object.assign(base, { status: end.status || 'failed', error: end.error || null, outputs: end.outputs || {} });
      cost = +end.cost_usd || 0;
    } catch (e) {
      base.error = e.message;
      // stopped while it waited for a slot of Settings › Execution (#175)
      if (signal?.aborted) base.status = 'cancelled';
    } finally {
      live.delete(index);
    }
    emit('workflow.child_finished', { step_id: step.id, child_run_id: base.run_id, workflow, status: base.status, error: base.error, cost_usd: cost, ...(foreach ? { index, label } : {}) });
    results[index] = base;
  };

  try {
    if (foreach) {
      emit('log', { level: 'info', message: `${step.id}: ${items.length} item${items.length === 1 ? '' : 's'} for ${workflow}, at most ${max} at a time.` });
      await schedule(items.length, max, items.map(itemFiles), runOne, signal);
    } else {
      await runOne(0);
    }
  } finally {
    signal?.removeEventListener('abort', onAbort);
  }
  // items never started (the run was stopped)
  for (let i = 0; i < items.length; i++) {
    results[i] ??= { index: i, ...(foreach ? { item: items[i] } : {}), run_id: null, status: 'cancelled', error: 'not started: the run was stopped', outputs: {} };
  }
  if (!foreach) {
    const r = results[0];
    return { kind: 'workflow', workflow, status: r.status, run_id: r.run_id, outputs: r.outputs, error: r.error };
  }
  const statuses = results.map((r) => r.status);
  return {
    kind: 'workflow', workflow, status: overall(statuses), runs: results, outputs: results.map((r) => r.outputs),
    succeeded: statuses.filter((s) => s === 'success').length, failed: statuses.filter((s) => s !== 'success').length,
  };
}

module.exports = {
  itemFiles,
  resolveValue,
  runWorkflowStep,
  schedule,
  validateWorkflowStep,
};
