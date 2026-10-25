// Service area: the Discovery board's column automations (#259, src/domains/discovery/discovery.js ON_ENTER). A card
// moved into a column whose `on_enter` is in 'ask' mode gets a proposal (the pipeline or workflow
// with its cost estimate from past runs, #215); 'on' starts it at once; the owner's Run
// (discovery:run-automation) starts a proposed one. The run is a saved pipeline (areas/pipelines.js:
// its first stage, the rest as its chain) or a workflow, its inputs rendered from the card, under the
// card's project, so it counts in the project's slots and budgets like any run. The card records it
// (card.automation, 'running') and, when the last run ends (the chain's 'run:chain' events,
// areas/chain.js, say which run follows a stage), the `document` output becomes a new version of the
// card's document and the thread gets the run and its cost (discovery.recordAutomation). The clarity
// check (`check: 'clarity'`) is no run: it asks the card's next open point in its thread (Grill me),
// which waits for the person. An automation never moves or commits a card and never answers a gate
// of a real run: the card shows it running while the gate waits for the owner. Under
// MULTIAGENT_SIMULATION_ONLY the run is a simulation (the mock provider, no cost) and its gates take
// their first choice, answered as 'auto' like `npm run run -- --mock --auto-approve` (#260: a ship
// transition never follows), so a simulated automation ends by itself.
// The automations in progress are kept in memory; a card left 'running' by a previous session of the
// app is settled from its runs' folders when the board is read (reconcileDiscoveryAutomations): the
// result of a pipeline that ended meanwhile comes back, a run still alive is followed again, a run
// that is gone ends the automation as interrupted.

const path = require('path');
const { childRunCost, loadWorkflow } = require('../../engine/workflow');
const simulation = require('../../engine/simulation');
const chainModel = require('../../shared/chain-model');
const discovery = require('../../domains/discovery/discovery');
const projects = require('../../projects');
const runs = require('../../runs');

// the stages of a pipeline followed from the run folders (a chain's nextRunId), at most
const MAX_STAGES = 20;

module.exports = (ctx) => {
  const dir = () => ctx.ws.discovery;
  // the automations in progress, by each run of theirs (a pipeline's stages are runs of their own):
  // { projectId, cardId, column, name, runId (the first run's), costUsd, document, waitingOn }
  const tracked = new Map();
  // the cards whose automation is being started: a second start meanwhile is refused
  const starting = new Set();

  const columnOf = (projectId, column) => {
    const col = discovery.readBoard(dir(), projectId).columns.find((c) => c.id === column);
    if (!col) throw new Error(`Unknown column: ${column}`);
    return col;
  };

  // what the automation runs: a pipeline's name comes from its file (the board's copy may be older)
  function describe(auto) {
    if (auto.check) return { kind: 'check', file: null, name: auto.name || 'Clarity check' };
    if (auto.pipeline) {
      const p = ctx.listPipelines().find((x) => x.file === auto.pipeline);
      return { kind: 'pipeline', file: auto.pipeline, name: p?.name || auto.name || auto.pipeline, error: p ? p.error || null : `Pipeline not found: ${auto.pipeline}` };
    }
    return { kind: 'workflow', file: auto.workflow || null, name: auto.name || auto.workflow || 'Workflow' };
  }

  // A rough cost before it runs: from past real runs of its workflows (null without any); a
  // simulation costs nothing, the clarity check calls no model.
  function estimateOf(auto) {
    if (auto.check) return { costUsd: 0, items: [], complete: true, text: 'No model call: the clarity rubric scores the card.' };
    if (simulation.simulationOnly()) return { costUsd: 0, items: [], complete: true, simulated: true, text: 'Simulated run: the mock provider costs nothing.' };
    try {
      if (auto.pipeline) return ctx.pipelineEstimate({ file: auto.pipeline });
      const est = chainModel.estimateCost([auto.workflow], runs.listRuns(ctx.ws.runs));
      return { ...est, text: chainModel.estimateText(est) };
    } catch (e) {
      return { costUsd: null, items: [], complete: false, error: e.message, text: e.message };
    }
  }

  // The proposal a move into an 'ask' column answers with: what would run, on which column, its estimate.
  function proposal(column, auto) {
    const what = describe(auto);
    return { status: 'proposed', column, mode: auto.mode, kind: what.kind, file: what.file, name: what.name, error: what.error || null, estimate: estimateOf(auto) };
  }

  /**
   * What a card's move into `card.column` starts (#259): the card as it is (no automation there,
   * 'off', or the card only changed place in its column), the card with a proposal ('ask'), or with
   * the run started ('on': { status: 'running', runId, name }; the clarity check, no run, answers
   * { status: 'done', question }; a start that fails leaves the move done and says why).
   */
  async function afterDiscoveryMove(projectId, card, from) {
    if (!card || card.column === from) return card;
    const auto = columnOf(projectId, card.column).on_enter;
    if (!auto || auto.mode === 'off') return card;
    if (auto.mode !== 'on') {
      // a clarity check with nothing to ask (a clear card, or no open point left) is not offered
      if (auto.check && !discovery.grillHasQuestion(dir(), projectId, card.id)) return card;
      return { ...card, automation: proposal(card.column, auto) };
    }
    try {
      const started = await startDiscoveryAutomation({ projectId, cardId: card.id, column: card.column });
      return { ...discovery.readCard(dir(), projectId, card.id), automation: { status: started.runId ? 'running' : 'done', column: card.column, ...started } };
    } catch (e) {
      return { ...card, automation: { status: 'failed', column: card.column, name: describe(auto).name, error: e.message } };
    }
  }

  /**
   * Starts the column's automation on the card (the owner's Run, or an 'on' column): the pipeline's
   * first run or the workflow's, with the inputs rendered from the card → { runId, name }. The
   * clarity check asks the next open point in the thread instead → { runId: null, name, question }.
   * Refused when the card left the column, an automation already runs on it, or the column's is off.
   */
  async function startDiscoveryAutomation({ projectId, cardId, column }) {
    const key = `${path.basename(String(projectId))}/${cardId}`;
    if (starting.has(key)) throw new Error('This card\'s automation is being started.');
    starting.add(key);
    try {
      return await start({ projectId, cardId, column });
    } finally {
      starting.delete(key);
    }
  }

  async function start({ projectId, cardId, column }) {
    const card = discovery.readCard(dir(), projectId, cardId);
    const col = columnOf(projectId, column);
    if (card.column !== column) throw new Error(`"${card.title}" is not in ${col.title}: nothing to run.`);
    if (card.automation?.state === 'running') {
      const { runId } = card.automation;
      if (tracked.has(runId) || ctx.liveRun(runId)) throw new Error(`An automation is already running on "${card.title}" (run ${runId}).`);
      // recorded by a previous session of the app: settled from its runs, or ended as interrupted
      settle(projectId, card);
      if (discovery.readCard(dir(), projectId, cardId).automation?.state === 'running') throw new Error(`An automation is already running on "${card.title}" (run ${runId}).`);
    }
    const auto = col.on_enter;
    if (!auto || auto.mode === 'off') throw new Error(`${col.title} has no automation on.`);
    const what = describe(auto);
    if (what.error) throw new Error(what.error);
    if (what.kind === 'check') {
      // Grill me: the question waits for the person in the card's thread; nothing is decided here
      const out = discovery.grillCard(dir(), projectId, cardId);
      return { runId: null, name: what.name, question: out.question || null };
    }
    const inputs = discovery.renderAutomationInputs(dir(), projectId, cardId, auto.inputs || {});
    const project = projects.readProject(ctx.ws.projects, path.basename(String(projectId)));
    const first = what.kind === 'pipeline' ? ctx.pipelineAssign(what.file).workflow : what.file;
    const wf = loadWorkflow(ctx.workflowPath(first).file);
    // the project folder is the agents' context when the workflow takes one
    if (wf.inputs?.project_path && inputs.project_path === undefined && project?.folder) inputs.project_path = project.folder;
    const mock = simulation.simulationOnly();
    const notices = [{ level: 'info', message: `Started by the Discovery board: ${what.name} on the card "${card.title}" (${cardId}) entering ${col.title}.` }];
    const started = what.kind === 'pipeline'
      ? await ctx.runPipeline({ file: what.file, inputs, mock, projectId })
      : await ctx.startWorkflowRun({ file: what.file, inputs, mock, projectId, notices });
    tracked.set(started.runId, { projectId, cardId, column, name: what.name, runId: started.runId, costUsd: 0, document: '', waitingOn: null });
    discovery.markAutomation(dir(), projectId, cardId, { runId: started.runId, name: what.name, column });
    return { runId: started.runId, name: what.name };
  }

  // The automation is over (its last run ended, or its chain stopped): the result goes to the card.
  function finish(t, status) {
    for (const [id, x] of tracked) if (x === t) tracked.delete(id);
    try {
      discovery.recordAutomation(dir(), t.projectId, t.cardId, { runId: t.runId, name: t.name, column: t.column, status, text: status === 'success' ? t.document : '', costUsd: t.costUsd });
    } catch (e) {
      console.error('discovery automation:', e.message);
    }
  }

  // A card left 'running' by a previous session of the app: its runs are followed from their folders
  // (a stage's chain names the next run). A pipeline that ended comes back to the card; a run still
  // alive is followed again; a run that is gone (not finished, not live) ends it as interrupted.
  function settle(projectId, card) {
    const { runId, name, column } = card.automation;
    const t = { projectId, cardId: card.id, column, name, runId, costUsd: 0, document: '', waitingOn: null };
    let id = runId;
    for (let n = 0; id && n < MAX_STAGES; n++) {
      if (ctx.liveRun(id)) { tracked.set(id, t); return; }
      let run = null;
      try { run = runs.readRun(ctx.ws.runs, id); } catch { /* unreadable: gone */ }
      if (!run || !run.finishedAt) { finish(t, 'interrupted'); return; }
      t.costUsd += (Number(run.costUsd) || 0) + (Number(run.childrenCostUsd) || 0);
      if (run.status === 'success' && String(run.outputs?.document ?? '').trim()) t.document = String(run.outputs.document);
      const chain = run.chain;
      if (run.status !== 'success' || !chain?.then || chain.then.action !== 'workflow') { finish(t, run.status || 'interrupted'); return; }
      if (chain.state === 'started' && chain.nextRunId) { id = chain.nextRunId; continue; }
      if (chain.state === 'done') { finish(t, 'success'); return; }
      // waiting (the chain never acted: the app closed first), paused or dropped
      finish(t, chain.state === 'waiting' ? 'interrupted' : chain.state || 'interrupted');
      return;
    }
    finish(t, 'interrupted');
  }

  /** Settles the project's cards left 'running' by a previous session (the board reads them). */
  function reconcileDiscoveryAutomations(projectId) {
    for (const card of discovery.listCards(dir(), projectId)) {
      const a = card.automation;
      if (a?.state !== 'running' || !a.runId || tracked.has(a.runId) || ctx.liveRun(a.runId)) continue;
      try { settle(projectId, card); } catch (e) { console.error('discovery automation:', e.message); }
    }
  }

  // A simulated automation's gate: nobody is there to answer it and the run is a mock; it takes its
  // first choice that needs no feedback, as 'auto' (never 'user'). A real run's gates wait for the owner.
  function answerSimulatedGate(ev) {
    if (!simulation.simulationOnly()) return;
    const run = ctx.liveRun(ev.run_id);
    if (!run?.mock) return;
    const choices = Array.isArray(ev.choices) ? ev.choices : [];
    const answer = choices.length ? (choices.find((c) => !c.feedback_required) || choices[0]).id : true;
    setTimeout(() => {
      try {
        if (run.resolveApproval(ev.approval_id, answer, 'auto') === false) console.error(`discovery automation: the simulated gate ${ev.approval_id} of run ${ev.run_id} refused "${answer}".`);
      } catch (e) { console.error('discovery automation gate:', e.message); }
    }, 50);
  }

  ctx.events.on('run:event', (ev) => {
    const t = tracked.get(ev?.run_id);
    if (!t) return;
    if (ev.type === 'approval.requested') answerSimulatedGate(ev);
    if (ev.type !== 'workflow.finished') return;
    t.costUsd += Number(childRunCost(ev.summary)) || 0;
    if (ev.status === 'success' && String(ev.outputs?.document ?? '').trim()) t.document = String(ev.outputs.document);
    // a stage with a chain: the chain says what follows (run:chain), the automation goes on with it
    if (ev.status === 'success' && ev.then?.action === 'workflow') { t.waitingOn = ev.run_id; return; }
    finish(t, ev.status);
  });

  // The chain of a stage decided (areas/chain.js write): the next run joins the automation, a chain
  // that stops ends it (paused: the owner may resume the chain on the run, its result then stays there).
  ctx.events.on('run:chain', (ev) => {
    const t = tracked.get(ev?.run_id);
    if (!t || t.waitingOn !== ev.run_id) return;
    if (ev.state === 'started' && ev.nextRunId) {
      t.waitingOn = null;
      tracked.set(ev.nextRunId, t);
      return;
    }
    if (ev.state === 'done') finish(t, 'success');
    else if (ev.state === 'paused' || ev.state === 'dropped') finish(t, ev.state);
  });

  return {
    afterDiscoveryMove,
    reconcileDiscoveryAutomations,
    startDiscoveryAutomation,
  };
};
