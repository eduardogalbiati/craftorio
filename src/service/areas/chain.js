// Service area: workflow chaining (#134, src/renderer/chain-model.js). A run started with a `then`
// (the Start drawer, the Backlog's Assign, a roadmap item, or a gate choice such as the issue
// tracker's "Create and queue") hands its declared outputs to what follows when it finishes:
// another workflow (its inputs mapped from the outputs, `from` recorded in the next run), the
// Product Owner (the produced issues as planned roadmap stages, never started by itself), or the
// Backlog queue. Only a success goes on (a development workflow must also have merged); anything
// else pauses the chain with a notice, and the owner resumes or drops it. The chain's state lives in
// runs/<id>/chain.json (src/domains/run/runs.js readChain/writeChain). It never answers a gate: the next run's
// gates wait for the owner like any run's. A simulated run only chains simulated runs, and queues
// nothing (it filed no real issue).

const path = require('path');
const { loadWorkflow } = require('../../engine/workflow');
const simulation = require('../../engine/simulation');
const chain = require('@multiagent/shared/chain-model');
const { platformOrDefault } = require('@multiagent/shared/platforms');
const agents = require('../../domains/agents/agents');
const backlog = require('../../domains/backlog/backlog');
const live = require('../../domains/roadmap/live-roadmap');
const notifier = require('../../domains/workspace/notifications');
const productOwner = require('../../domains/po/product-owner');
const projects = require('../../domains/project/projects');
const roadmaps = require('../../domains/roadmap/roadmap');
const runs = require('../../domains/run/runs');
const usage = require('../../domains/usage/usage');
const workspace = require('../../domains/workspace/workspace');
const { resolveCommand } = require('../../engine/providers');

// stages a Product Owner proposal may add for one finished run
const PO_MAX_STAGES = 10;

module.exports = (ctx) => {
  // runs whose chain is being carried out (a resume clicked twice acts once)
  const acting = new Set();

  // every change of a chain's state is pushed as 'run:chain' { run_id, state, reason?, nextRunId? }:
  // the Discovery board's automations follow a pipeline from stage to stage with it (#259)
  const write = (runDir, patch) => {
    let out = null;
    try { out = runs.writeChain(runDir, patch); } catch (e) { console.error('chain.json:', e.message); }
    try { ctx.events.emit('run:chain', { run_id: path.basename(runDir), ...patch }); } catch (e) { console.error('run:chain:', e.message); }
    return out;
  };

  // The run's start and every change of its `then` (a gate choice, the owner's edit) go to chain.json.
  function recordChain(run, ev) {
    if (ev.type === 'workflow.started' && !run.then) return;
    write(run.runDir, { then: run.then || null, state: run.then ? 'waiting' : null, reason: null });
  }

  // What the next step needs of a finished run, from the live run or its folder.
  // pipelineId: the saved pipeline (#135) the run is a stage of, from its `from`
  function previous({ runId, runDir, workflow, file, outputs, outputDefs, inputs, projectId, mock, status, from }) {
    return {
      runId, runDir, workflow, file, outputs: outputs || {}, outputDefs: outputDefs || {}, inputs: inputs || {}, projectId: projectId || null, mock: !!mock, status,
      pipelineId: from?.pipeline?.id || null,
    };
  }

  function notice(prev, state, message, nextRunId = null) {
    ctx.notify(notifier.chainNotice({ runId: prev.runId, workflow: prev.workflow, state, message, nextRunId }), { projectId: prev.projectId });
  }

  function pause(prev, reason) {
    const message = `Chain paused: ${reason}. Resume it or drop it on the run.`;
    write(prev.runDir, { state: 'paused', reason: message });
    notice(prev, 'paused', message);
  }

  // A run that finished: its chain goes on, or pauses with the reason.
  async function continueChain(run, ev) {
    if (!run.then) return;
    const prev = previous({
      runId: run.runId, runDir: run.runDir, workflow: run.wf.metadata?.name || path.basename(run.file), file: path.basename(run.file),
      outputs: ev.outputs, outputDefs: run.wf.outputs, inputs: run.inputs, projectId: run.projectId, mock: run.mock, status: ev.status, from: run.from,
    });
    const blocked = chain.blockedReason({ status: ev.status, outputs: prev.outputs, outputDefs: prev.outputDefs, mock: prev.mock });
    if (blocked) { pause(prev, blocked); return; }
    await act(prev, run.then);
  }

  // Carries out a then for a finished run; a failure pauses the chain with its reason.
  async function act(prev, then) {
    if (acting.has(prev.runId)) return null;
    acting.add(prev.runId);
    try {
      if (then.action === 'workflow') return await startNext(prev, then);
      if (then.action === 'queue') return await queueIssues(prev, then);
      if (then.action === 'product_owner') return await askProductOwner(prev);
      return null;
    } catch (e) {
      pause(prev, e.message);
      return null;
    } finally {
      acting.delete(prev.runId);
    }
  }

  // Start workflow X: its inputs from the previous run's outputs; the produced issues stay linked. A
  // saved pipeline's stage (#135) hands the rest of the pipeline to the run it starts, with the
  // pipeline run's id (its first run's) stamped on it.
  async function startNext(prev, then) {
    const wf = loadWorkflow(ctx.workflowPath(then.workflow).file);
    const inputs = chain.nextInputs(then, prev, wf.inputs);
    const issues = wf.inputs?.issues || wf.inputs?.issue ? backlog.recordedIssues(chain.producedIssues(prev.outputs)) : [];
    const stamped = chain.withPipelineId(then, then.pipeline?.id || prev.pipelineId || prev.runId);
    const started = await ctx.startWorkflowRun({
      file: then.workflow, inputs, mock: prev.mock, projectId: prev.projectId,
      issues: issues.length ? issues : null, then: stamped.then || null,
      from: { run_id: prev.runId, workflow: prev.workflow, ...(stamped.pipeline ? { pipeline: stamped.pipeline } : {}) },
      notices: [{ level: 'info', message: `Started by the chain of run ${prev.runId} (${prev.workflow})${stamped.pipeline ? `: stage ${stamped.pipeline.stage + 1} of ${stamped.pipeline.stages} of pipeline "${stamped.pipeline.name}"` : ''}.` }],
    });
    const message = `${wf.metadata?.name || then.workflow} started (${started.runId}).`;
    write(prev.runDir, { state: 'started', reason: message, nextRunId: started.runId });
    notice(prev, 'started', message, started.runId);
    return started;
  }

  // Queue / Assign (the issue tracker's "Create and queue"): the backlog is synced (the new issues
  // are in it) and the produced issues are assigned like the Backlog's Assign does, in batches.
  async function queueIssues(prev, then) {
    if (prev.mock) {
      write(prev.runDir, { state: 'done', reason: 'Simulated run: nothing queued (it filed no real issue).' });
      return null;
    }
    if (!prev.projectId) throw new Error('the run has no project, so there is no Backlog to queue in');
    const { ws } = ctx;
    const maxGroup = workspace.readSettings(ws).backlogMaxGroup || workspace.DEFAULT_SETTINGS.backlogMaxGroup;
    const batches = chain.queueBatches(prev.outputs, maxGroup);
    if (!batches.length) {
      write(prev.runDir, { state: 'done', reason: 'No issue was produced: nothing queued.' });
      return null;
    }
    const project = projects.readProject(ws.projects, prev.projectId);
    const platform = platformOrDefault(prev.inputs.git_platform).id;
    await backlog.syncBacklog({ dir: ws.backlog, project, platform });
    for (const batch of batches) {
      await ctx.assignWorkflow({ projectId: project.id, numbers: batch.numbers, workflow: then.workflow, inputs: then.inputs || {}, mock: false, group: batch.group });
    }
    const n = batches.reduce((a, b) => a + b.numbers.length, 0);
    write(prev.runDir, { state: 'done', reason: `${n} issue${n === 1 ? '' : 's'} queued for ${then.workflow}.` });
    return null;
  }

  // Ask the Product Owner (#105) to place the produced issues: its plan becomes planned roadmap
  // stages (roadmaps.propose pauses a running roadmap); nothing starts until the owner presses Start.
  async function askProductOwner(prev) {
    if (!prev.projectId) throw new Error('the run has no project, so there is no roadmap to place the issues in');
    const numbers = chain.producedIssues(prev.outputs).map((i) => i.number);
    if (!numbers.length) {
      write(prev.runDir, { state: 'done', reason: 'No issue was produced: nothing for the Product Owner to place.' });
      return null;
    }
    const { ws } = ctx;
    const settings = workspace.readSettings(ws);
    const p = projects.readProject(ws.projects, prev.projectId);
    const simulated = prev.mock || simulation.simulationOnly();
    const cached = backlog.readBacklog(ws.backlog, p.id);
    if (!simulated && p.repo) {
      const platform = cached?.platform || settings.backlogPlatform || backlog.DEFAULT_PLATFORM;
      try { await backlog.syncBacklog({ dir: ws.backlog, project: p, platform }); } catch (e) { console.error('chain: sync before the Product Owner:', e.message); }
    }
    const data = ctx.withIssueRuns(backlog.readBacklog(ws.backlog, p.id));
    if (!data) throw new Error('sync the backlog first: the Product Owner reads the synced issues');
    const maxGroup = settings.backlogMaxGroup || workspace.DEFAULT_SETTINGS.backlogMaxGroup;
    const out = await productOwner.ask({
      backlogDir: ws.backlog,
      projectId: p.id,
      runsDir: ws.runs,
      question: [
        `Run ${prev.runId} (${prev.workflow}) produced issues ${numbers.map((n) => `#${n}`).join(', ')}.`,
        'Place them in the roadmap as planned stages, with your usual rules: group the issues that touch the same files into one run within the group size limits, and never put in one stage issues that must not run in parallel.',
        'List in `enrich` the issues too vague to implement without guessing: they are left out.',
      ].join(' '),
      data,
      activeRuns: ctx.activeRuns().filter((r) => r.projectId === p.id),
      runs: runs.runsForProject(runs.listRuns(ws.runs), p),
      workflows: ctx.listWorkflows().filter((w) => !w.error && w.inputs?.task),
      defaultWorkflow: projects.projectDefaultWorkflow(p, settings.defaultWorkflow), // #195; #486: the project's own first
      folder: p.folder,
      agent: agents.readAgent(ws.agents, agents.PRODUCT_OWNER_ID),
      skillsDirs: [ws.skills, ctx.BUNDLED_SKILLS_DIR],
      resolveCommand,
      // as po:ask: its own and the Oracle's calls count in the monthly budget (a blocking one refuses)
      budget: simulated ? null : usage.withPeerUsage(usage.budgetBaseline({ runsDir: ws.runs, settings, extraRuns: ctx.agentUsageRuns() }), productOwner.monthUsage(ws.backlog, new Date(), settings.timeZone), settings.prices),
      timeZone: settings.timeZone, // #273
      mock: simulated,
      mode: 'plan',
      selection: numbers,
    });
    const message = out.message || {};
    if (message.error) throw new Error(`the Product Owner could not answer: ${message.text}`);
    const note = `Proposed by the Product Owner after run ${prev.runId} (${prev.workflow}).`;
    const stages = live.refillStages(message.answer, { allowed: new Set(numbers), maxStages: PO_MAX_STAGES, maxGroup, mock: simulated, origin: message.ts || '', note });
    if (!stages.length) {
      write(prev.runDir, { state: 'done', reason: 'The Product Owner placed none of the issues.' });
      return null;
    }
    const before = roadmaps.readRoadmap(ws.backlog, p.id);
    const { roadmap } = roadmaps.propose(ws.backlog, p.id, { stages }, { issues: data.issues, alive: ctx.runAlive });
    const added = roadmap.stages.length - before.stages.length;
    const text = `The Product Owner proposed ${added} roadmap stage${added === 1 ? '' : 's'}: review them on the Backlog and press Start.`;
    write(prev.runDir, { state: 'done', reason: text });
    notice(prev, 'done', text);
    return { added };
  }

  // A finished run read from its folder, for a resume.
  function finishedRun(runId) {
    const dir = ctx.runFolder(runId);
    const info = runs.readRun(path.dirname(dir), path.basename(dir));
    if (!info || !info.finishedAt) throw new Error(`Run ${runId} has not finished: its chain goes on by itself when it does.`);
    let outputDefs = {};
    try { outputDefs = loadWorkflow(ctx.workflowPath(info.file).file).outputs || {}; } catch { /* the workflow is gone: no merge rule */ }
    return {
      info,
      prev: previous({
        runId: info.runId, runDir: dir, workflow: info.workflow, file: info.file, outputs: info.outputs, outputDefs,
        inputs: info.inputs, projectId: info.projectId, mock: info.mock, status: info.status, from: info.chain?.from,
      }),
    };
  }

  /**
   * Edits or cancels a run's chain (`then` null = nothing): while it runs (recorded as `run.then`),
   * or once it finished with its chain paused (chain.json; null drops it, the then is kept to show
   * what was dropped). A chain that already went on is final.
   */
  function setRunChain({ runId, then }) {
    const edited = chain.normalizeThen(then);
    // an edit of a pipeline's next stage (#135) that keeps its workflow keeps the stages after it
    const keepRest = (old) => (edited && old?.pipeline && edited.action === old.action && edited.workflow === old.workflow
      ? { ...edited, pipeline: old.pipeline, ...(old.then ? { then: old.then } : {}) } : edited);
    const run = ctx.liveRun(runId);
    if (run) {
      const next = keepRest(run.then);
      return { chain: { then: run.setThen(next), state: next ? 'waiting' : undefined } };
    }
    const { info, prev } = finishedRun(runId);
    if (!info.chain?.then) throw new Error(`Run ${runId} has finished without a chain: start the next workflow by hand.`);
    if (info.chain.state !== 'paused') throw new Error(`The chain of run ${runId} is ${info.chain.state}: it can no longer be changed.`);
    const next = keepRest(info.chain.then);
    const patch = next ? { then: next, state: 'paused' } : { state: 'dropped', reason: 'Dropped by the owner.' };
    return { chain: write(prev.runDir, patch) };
  }

  /** Resumes a paused chain: the owner decides it goes on, whatever the run's outcome. */
  async function resumeChain({ runId }) {
    const { info, prev } = finishedRun(runId);
    const then = info.chain?.then;
    if (!then) throw new Error(`Run ${runId} has no chain to resume.`);
    if (info.chain.state !== 'paused') throw new Error(`The chain of run ${runId} is ${info.chain.state || 'not paused'}: only a paused chain resumes.`);
    await act(prev, then);
    return runs.readRun(path.dirname(prev.runDir), path.basename(prev.runDir))?.chain || null;
  }

  /** A run's chain as the Run screen shows it ({ then, from, state, reason, nextRunId }), null without one. */
  function runChain({ runId }) {
    if (!runId) throw new Error('Say which run.');
    const run = ctx.liveRun(runId);
    if (run) return run.then || run.from ? { then: run.then, from: run.from, state: run.then ? 'waiting' : undefined } : null;
    const dir = ctx.runFolder(runId);
    return runs.readRun(path.dirname(dir), path.basename(dir))?.chain || null;
  }

  /** Drops a paused (or waiting) chain: nothing follows the run. */
  function dropChain({ runId }) {
    return setRunChain({ runId, then: null });
  }

  /** The workflows a chain would run after `file`, with a rough cost from past runs (an estimate). */
  function chainEstimate({ file, then }) {
    const t = chain.normalizeThen(then);
    const list = [file, ...chain.chainWorkflows(t)].filter(Boolean);
    const est = chain.estimateCost(list, runs.listRuns(ctx.ws.runs));
    return { ...est, text: chain.estimateText(est), productOwner: t?.action === 'product_owner' };
  }

  return {
    chainEstimate,
    continueChain,
    dropChain,
    recordChain,
    resumeChain,
    runChain,
    setRunChain,
  };
};
