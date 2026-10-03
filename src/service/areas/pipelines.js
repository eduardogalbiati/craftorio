// Service area: saved pipelines (#135, src/pipelines.js). The list for Workflows › Definitions, the
// Start drawer and the Backlog's Assign (each file checked against its workflows' declared outputs,
// with its origin: default, modified or custom); starting one (its first stage's run with the rest of
// the pipeline as its chain, areas/chain.js carries it on); what Assign queues for one; a pipeline
// run (its runs grouped by the pipeline run's id, the first run's); saving a run's chain as a new
// pipeline; and restoring a bundled default over an edited copy (the copy goes to the trash).

const fs = require('fs');
const path = require('path');
const { loadWorkflow } = require('../../engine/workflow');
const chain = require('../../renderer/chain-model');
const pipelines = require('../../pipelines');
const runs = require('../../runs');

module.exports = (ctx) => {
  const dir = () => ctx.ws.pipelines;
  const workflowOf = (file) => loadWorkflow(ctx.workflowPath(file).file);

  // A pipeline file of the workspace, parsed and checked (throws with the reason).
  function readPipeline(file) {
    const name = path.basename(String(file || ''));
    if (!pipelines.isPipelineFile(name)) throw new Error(`Not a pipeline file: ${name}`);
    const full = path.join(dir(), name);
    if (!fs.existsSync(full)) throw new Error(`Pipeline not found: ${name}`);
    return pipelines.loadPipelineText(fs.readFileSync(full, 'utf8'), name, workflowOf);
  }

  // <workspace>/pipelines/*.yaml, each { file, origin, restorable, name, description, category,
  // stages: [{ workflow, target, map: { input: output }, inputs, on }] }; a file that fails to load
  // (or maps an output its previous workflow doesn't declare) comes back with its error.
  function listPipelines() {
    if (!fs.existsSync(dir())) return [];
    const status = pipelines.pipelineStatus(pipelines.BUNDLED_PIPELINES_DIR, dir());
    return fs.readdirSync(dir()).filter(pipelines.isPipelineFile).sort().map((file) => {
      const st = status[file] || { origin: 'custom', updateAvailable: false, restorable: false };
      const origin = { origin: st.origin, updateAvailable: st.updateAvailable, restorable: st.restorable };
      try {
        return { ...readPipeline(file), ...origin };
      } catch (e) {
        return { file, ...origin, name: file, error: e.message, stages: [] };
      }
    });
  }

  /**
   * Starts a pipeline: its first stage's workflow with the owner's inputs over the stage's fixed ones,
   * the rest of the pipeline as the run's chain. Every gate still waits for the owner.
   * @returns {{ runId, runDir, pipelineId }} the pipeline run's id is its first run's
   */
  async function runPipeline({ file, inputs, mock, projectId }) {
    const p = readPipeline(file);
    const first = p.stages[0];
    const started = await ctx.startWorkflowRun({
      file: first.workflow, inputs: { ...first.inputs, ...(inputs || {}) }, mock: !!mock, projectId: projectId || undefined,
      then: pipelines.pipelineThen(p),
      notices: [{ level: 'info', message: `Stage 1 of ${p.stages.length} of pipeline "${p.name}" (${p.file}).` }],
    });
    return { ...started, pipelineId: started.runId };
  }

  /** What the Backlog's Assign queues for a pipeline: its first workflow, fixed inputs and chain. */
  function pipelineAssign(file) {
    const p = readPipeline(file);
    const first = p.stages[0];
    return { workflow: first.workflow, inputs: { ...first.inputs }, then: pipelines.pipelineThen(p) };
  }

  /** A pipeline's workflows with a rough cost from past runs (an estimate, chain-model estimateCost). */
  function pipelineEstimate({ file }) {
    const p = readPipeline(file);
    const est = chain.estimateCost(pipelines.pipelineWorkflows(p), runs.listRuns(ctx.ws.runs));
    return { ...est, text: chain.estimateText(est), productOwner: p.stages.some((s) => s.target === 'product_owner') };
  }

  /**
   * A pipeline run: the pipeline (from its file, else from what its runs recorded) and, per stage, the
   * run that ran it ({ runId, status, workflow } or null), the current stage (the last one started)
   * and its chain's state (paused, dropped…).
   */
  function pipelineRun({ id }) {
    const key = String(id || '');
    if (!key) throw new Error('Say which pipeline run.');
    const live = ctx.activeRuns().map((r) => ({ runId: r.runId, status: r.waiting ? 'waiting' : r.status, workflow: r.workflow, file: r.file, chain: r.chain }));
    const members = [];
    const seen = new Set();
    for (const r of [...live, ...runs.listRuns(ctx.ws.runs)]) {
      if (seen.has(r.runId)) continue;
      const p = chain.pipelineOf(r.chain, r.runId);
      if (!p || (p.id || r.runId) !== key) continue;
      seen.add(r.runId);
      members.push({ runId: r.runId, status: r.status, workflow: r.workflow, file: r.file, pipeline: p, chain: r.chain });
    }
    if (!members.length) throw new Error(`Pipeline run not found: ${key}`);
    const ref = members[0].pipeline;
    let def = null;
    try { def = readPipeline(ref.file); } catch { /* changed or deleted since: the runs' own record */ }
    const count = Math.max(def?.stages.length || 0, ref.stages, ...members.map((m) => m.pipeline.stage + 1));
    const stages = def?.stages || Array.from({ length: count }, (_, i) => ({ workflow: members.find((m) => m.pipeline.stage === i)?.file || null, target: 'workflow', map: {}, inputs: {} }));
    const byStage = Array.from({ length: count }, (_, i) => members.filter((m) => m.pipeline.stage === i).pop() || null);
    const current = byStage.reduce((at, m, i) => (m ? i : at), 0);
    const last = byStage[current];
    return {
      id: key, file: ref.file, name: def?.name || ref.name, stages,
      runs: byStage.map((m) => (m ? { runId: m.runId, status: m.status, workflow: m.workflow } : null)),
      current, state: last?.chain?.state || null, reason: last?.chain?.reason || null,
    };
  }

  /**
   * Saves a run's chain (set up by hand, phase 1) as a pipeline: the run's workflow, then each step of
   * its chain. A new file named after the pipeline, never over an existing one; checked like any.
   */
  function savePipeline({ runId, name, description, category }) {
    const c = ctx.runChain({ runId });
    if (!c?.then) throw new Error('This run has no chain to save: add one with "When it finishes" first.');
    const live = ctx.liveRun(runId);
    const runDir = live ? null : ctx.runFolder(runId);
    const file = live ? path.basename(live.file) : runs.readRun(path.dirname(runDir), path.basename(runDir))?.file;
    if (!file) throw new Error(`The workflow of run ${runId} is not known.`);
    const p = pipelines.fromChain({ file, then: c.then }, { name, description, category });
    pipelines.validatePipeline(pipelines.parsePipeline(p, p.file), workflowOf);
    fs.mkdirSync(dir(), { recursive: true });
    const dest = path.join(dir(), p.file);
    if (fs.existsSync(dest)) throw new Error(`A pipeline file named ${p.file} already exists: pick another name.`);
    fs.writeFileSync(dest, pipelines.toYaml(p));
    return { file: p.file, name: p.name };
  }

  // Replaces the user's edited copy of a bundled pipeline with the default; the edited copy goes to
  // the trash (recoverable).
  async function restorePipeline(file) {
    const name = path.basename(String(file || ''));
    if (!pipelines.pipelineStatus(pipelines.BUNDLED_PIPELINES_DIR, dir())[name]?.restorable) throw new Error(`"${name}" has no bundled default to restore.`);
    await ctx.host.trashItem(path.join(dir(), name));
    pipelines.restorePipeline(pipelines.BUNDLED_PIPELINES_DIR, dir(), name);
    return true;
  }

  return {
    listPipelines,
    pipelineAssign,
    pipelineEstimate,
    pipelineRun,
    restorePipeline,
    runPipeline,
    savePipeline,
  };
};
