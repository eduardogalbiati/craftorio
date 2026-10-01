// Service area: the workspace's SQLite index (src/store.js, #76). Opened with the workspace;
// without it (node:sqlite missing, a locked or broken file) everything still works on the plain
// files, the notification center and the gate history excepted. What the engine emits is written
// to it here: the run's row and its pending gates.

const runs = require('../../runs');
const { openStore } = require('../../store');

module.exports = (ctx) => {
  let store = null;
  let storeError = null;

  function openIndex() {
    closeIndex();
    storeError = null;
    try { store = openStore(ctx.ws); } catch (e) { storeError = e.message; console.error('index.db:', e.message); return; }
    // gates still open from the last time are of runs that did not survive: interrupted, never phantom gates
    try {
      for (const g of store.interruptGates([...ctx.active.keys()])) {
        ctx.notify({
          kind: 'run', event: 'gate_interrupted', title: `Gate interrupted: ${g.stepId || g.approvalId}`,
          body: `${g.message ? `${String(g.message).slice(0, 180)}\n` : ''}The app closed while run ${g.runId} waited here. Resume it from the run screen.`,
          target: { runId: g.runId },
        });
      }
    } catch (e) { console.error('index.db gates:', e.message); }
    // the run index catches up with runs/ (a new or rebuilt index reads every run once)
    setTimeout(() => { try { if (ctx.ws) runs.listRuns(ctx.ws.runs); } catch (e) { console.error('run index:', e.message); } }, 0);
  }

  function closeIndex() {
    try { store?.close(); } catch { /* already closed */ }
    store = null;
  }

  // What the engine emitted, written to the index: the run's row, its gates.
  function indexEvent(run, ev) {
    if (!store) return;
    try {
      if (ev.type === 'approval.requested') {
        const gate = run.pendingGates().find((g) => g.approval_id === ev.approval_id);
        if (gate) store.openGate(run.runId, gate); // answered by a listener already: no gate to keep
      } else if (ev.type === 'approval.resolved') store.closeGate(run.runId, ev.approval_id, ev.withdrawn ? 'withdrawn' : 'resolved');
      else if (ev.type === 'workflow.finished') store.closeRunGates(run.runId, 'closed');
      // summary.json is written with workflow.finished; workflow.started reaches events.jsonl through a
      // stream, so its row is read a moment later (a listing in between indexes it anyway)
      if (ev.type === 'workflow.finished') runs.indexRun(ctx.ws.runs, run.runId);
      if (ev.type === 'workflow.started') setTimeout(() => { try { if (store) runs.indexRun(ctx.ws.runs, run.runId); } catch { /* the next listing */ } }, 1000);
    } catch (e) { console.error('index.db:', e.message); }
  }

  return {
    closeIndex,
    indexEvent,
    openIndex,
    // the workspace's index, null when it could not be opened (storeError says why)
    get store() { return store; },
    get storeError() { return storeError; },
  };
};
