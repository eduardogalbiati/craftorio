// Backlog roadmap (packages/engine/domains/roadmap/roadmap.js): ordered stages of runs per project, each stage after the
// previous one merged. Every channel returns the Backlog (withIssueRuns), whose `roadmap` the
// screen shows (apps/desktop/renderer/backlog-roadmap.js); the service's dispatchRoadmaps runs it.
// #281: an owner edit (save, propose, from-queue, clear, restore) first keeps the stages as they were
// (packages/engine/domains/roadmap/roadmap-history.js: backlog/<project>.roadmap.history/, the last 20). A save, a proposal that
// replaces the roadmap, Clear and a restore answer with `edit` ({ id, label }): the last such edit of
// a project is the one roadmap:undo takes back (packages/engine/domains/roadmap/roadmap-undo.js), kept in memory until the next
// one. roadmap:versions lists the kept versions and roadmap:restore-version puts one back; both
// follow Undo's rule and never stop a run.

const path = require('path');
const backlog = require('../../domains/backlog/backlog');
const history = require('../../domains/roadmap/roadmap-history');
const merge = require('../../domains/roadmap/roadmap-merge');
const roadmaps = require('../../domains/roadmap/roadmap');
const undo = require('../../domains/roadmap/roadmap-undo');
const RoadmapModel = require('@multiagent/shared/roadmap-model');
const { requireText } = require('../common');
const {
  ANY,
  args,
  BACKLOG,
  FLAG,
  listOf,
  nullable,
  OBJECT,
  PROJECT_ID,
  shape,
  STRING,
  text,
} = require('../schemas');

// most roadmap channels answer the project's Backlog (its `roadmap` is what the screen shows)
const ON_PROJECT = args({ projectId: PROJECT_ID }, ['projectId']);
const ACTION = text(40);
const ITEM_ID = { type: ['string', 'number'], description: 'A roadmap item or edit id.' };

module.exports = (ctx) => {
  const project = (projectId) => path.basename(String(projectId));
  const current = (projectId) => ctx.withIssueRuns(backlog.readBacklog(ctx.ws.backlog, project(projectId)));
  const synced = (projectId) => backlog.readBacklog(ctx.ws.backlog, project(projectId))?.issues || [];
  // #281: the history sits beside the roadmap file (backlog/<project>.roadmap.history/)
  const workspace = () => path.dirname(ctx.ws.backlog);
  const stagesOf = (id) => roadmaps.readRoadmap(ctx.ws.backlog, id).stages;
  const lastEdit = new Map(); // project id → the edit Undo takes back
  let edits = 0;
  // a history that cannot be written never blocks the edit itself
  const keep = (id, stages, label) => {
    try { history.saveVersion(workspace(), id, stages, label); } catch (e) { console.error('roadmap history:', id, e.message); }
  };
  // After an owner edit: the version before it is kept and the edit becomes the one to undo
  // (`undoable: false`: kept only, e.g. the queue moved in, which Undo could not give back).
  // → { id, label } for the screen's toast, or null when there is nothing to undo.
  // `paused` (#399, a stage pause, which changes the roadmap's state only): recorded although the
  // stages did not change; its Undo resumes the roadmap as it ran before ({ stage, simulated, scope }).
  function edited(id, before, label, { undoable = true, paused = null } = {}) {
    const after = stagesOf(id);
    if (!paused && JSON.stringify(before) === JSON.stringify(after)) return null;
    keep(id, before, label);
    if (!undoable) return null;
    edits += 1;
    const edit = { id: `${Date.now()}-${edits}`, ...undo.recordEdit(before, after, label), ...(paused ? { paused } : {}) };
    lastEdit.set(id, edit);
    return { id: edit.id, label: edit.label };
  }
  const withEdit = (projectId, edit) => ({ ...current(projectId), ...(edit ? { edit } : {}) });
  // the stored stages with each item's status as its run says (the file keeps an item with a run as
  // planned): Undo and Restore never change an item that is running or done
  const withRunStatus = (id, stages) => {
    const status = new Map((ctx.roadmapView(id)?.stages || []).flatMap((s) => s.items.map((x) => [x.id, x.status])));
    return stages.map((s) => ({ ...s, items: s.items.map((x) => ({ ...x, status: status.get(x.id) || x.status })) }));
  };
  // the stages put back by Undo or Restore (`change` → { ok, stages | reason }): a refusal changes nothing
  const putBack = (id, change) => roadmaps.restoreStages(ctx.ws.backlog, id, (stages) => {
    const out = change(withRunStatus(id, stages));
    if (!out.ok) throw new Error(out.reason);
    return out.stages;
  }, { alive: ctx.runAlive });
  // #399 Undo of a stage pause: the Resume button (roadmap:start), with the roadmap's mode and scope
  // from before the pause; refused when the roadmap no longer waits at that stage
  const resumePaused = async (id, edit) => {
    const r = roadmaps.readRoadmap(ctx.ws.backlog, id);
    if (r.state !== 'paused' || r.pausedStage !== edit.paused.stage) throw new Error('The roadmap no longer waits at this stage: nothing to resume.');
    await ctx.startRoadmap({ projectId: id, simulated: edit.paused.simulated, stage: edit.paused.scope });
  };
  return [
    { channel: 'roadmap:get', method: 'getRoadmap', params: ['projectId'], schema: { params: ON_PROJECT, result: OBJECT }, fn: ({ projectId }) => ctx.roadmapView(project(projectId)) },
    // the edited stages ([{ id?, name, note, items: [{ id?, workflow, inputs, mock, issues }] }]); runs are kept by item id;
    // label: what the edit did, in the roadmap's words (the history's line and the toast's title).
    // #287 base: the roadmap's updatedAt the screen read. When the roadmap was written since, only what
    // the edit changed is applied to the stored stages (packages/engine/domains/roadmap/roadmap-merge.js); an edit that cannot be
    // applied saves nothing and answers the Backlog with `conflict: { reason }`. The read, the merge and
    // the write happen in one synchronous step: two writers never interleave.
    {
      channel: 'roadmap:save',
      method: 'saveRoadmap',
      params: ['projectId', 'stages', 'label', 'base'],
      schema: { params: args({ projectId: PROJECT_ID, stages: listOf(OBJECT), label: nullable(text(500)), base: ANY }, ['projectId', 'stages']), result: OBJECT },
      fn: async ({ projectId, stages, label, base }) => {
        const id = project(projectId);
        const stored = roadmaps.readRoadmap(ctx.ws.backlog, id);
        const edit = merge.onStored({ stored, stages, base, read: base ? roadmaps.readRoadmapAt(ctx.ws.backlog, id, base) : null });
        if (!edit.ok) return { ...current(projectId), conflict: { reason: edit.reason } };
        const before = stored.stages;
        roadmaps.saveStages(ctx.ws.backlog, id, edit.stages, { issues: synced(projectId), alive: ctx.runAlive });
        const done = edited(id, before, String(label || 'Edited the roadmap'));
        await ctx.dispatchRoadmaps();
        return withEdit(projectId, done);
      },
    },
    // #281 Undo: the last edit taken back (what it removed returns, what it moved or renamed goes
    // back); refused with the reason when it cannot be done, or when a newer edit took its place
    {
      channel: 'roadmap:undo',
      method: 'undoRoadmap',
      params: ['projectId', 'editId'],
      schema: { params: args({ projectId: PROJECT_ID, editId: ITEM_ID }, ['projectId']), result: BACKLOG },
      fn: async ({ projectId, editId }) => {
        const id = project(projectId);
        const edit = lastEdit.get(id);
        if (!edit || edit.id !== String(editId)) throw new Error('Only the last edit can be undone here: use "Restore an earlier version…" in the roadmap\'s ⋮ menu.');
        const before = stagesOf(id);
        if (edit.paused) await resumePaused(id, edit);
        else putBack(id, (stages) => undo.undoEdit(stages, edit));
        lastEdit.delete(id);
        keep(id, before, `Undid: ${edit.label}`);
        await ctx.dispatchRoadmaps();
        return current(projectId);
      },
    },
    // #281 the kept versions, newest first ([{ id, at, label }]: the roadmap as it was before `label`)
    {
      channel: 'roadmap:versions',
      method: 'roadmapVersions',
      params: ['projectId'],
      schema: { params: ON_PROJECT, result: listOf(shape({ id: STRING, at: STRING, label: STRING }, ['id'])) },
      fn: ({ projectId }) => history.listVersions(workspace(), project(projectId)),
    },
    {
      channel: 'roadmap:restore-version',
      method: 'restoreRoadmapVersion',
      params: ['projectId', 'versionId'],
      schema: { params: args({ projectId: PROJECT_ID, versionId: ITEM_ID }, ['projectId']), result: OBJECT },
      fn: async ({ projectId, versionId }) => {
        const id = project(projectId);
        const before = stagesOf(id);
        const version = history.listVersions(workspace(), id).find((v) => v.id === String(versionId));
        putBack(id, (stages) => history.restoreVersion(workspace(), id, String(versionId), stages));
        const edit = edited(id, before, `Restored the roadmap from before "${version?.label || 'an edit'}"`);
        await ctx.dispatchRoadmaps();
        return withEdit(projectId, edit);
      },
    },
    // The Product Owner's "Build a roadmap" answer (#105): added at the end (or replacing the roadmap); a running roadmap keeps running (#654).
    {
      channel: 'roadmap:propose',
      method: 'proposeRoadmap',
      params: ['projectId', 'proposal', 'replace'],
      schema: { params: args({ projectId: PROJECT_ID, proposal: ANY, replace: FLAG }, ['projectId']), result: OBJECT },
      fn: ({ projectId, proposal, replace }) => {
        const before = stagesOf(project(projectId));
        const { dropped } = roadmaps.propose(ctx.ws.backlog, project(projectId), proposal, { replace: !!replace, issues: synced(projectId), alive: ctx.runAlive });
        const edit = edited(project(projectId), before, replace ? 'Replaced the roadmap' : 'Added a proposal to the roadmap', { undoable: !!replace });
        return { ...withEdit(projectId, edit), dropped };
      },
    },
    // The plain queue's items become a planned stage at the end (they leave the queue).
    {
      channel: 'roadmap:from-queue',
      method: 'roadmapFromQueue',
      params: ['projectId'],
      schema: { params: ON_PROJECT, result: BACKLOG },
      fn: ({ projectId }) => {
        const id = project(projectId);
        const queue = backlog.readQueue(ctx.ws.backlog, id);
        if (!queue.items.length) throw new Error('The queue is empty.');
        const before = stagesOf(id);
        roadmaps.propose(ctx.ws.backlog, id, [roadmaps.fromQueue(queue.items)], { issues: synced(id) });
        for (const item of queue.items) backlog.unqueue(ctx.ws.backlog, id, item.number, { cancelGroup: true });
        edited(id, before, 'Moved the queue into the roadmap', { undoable: false });
        return current(id);
      },
    },
    // simulated: every item runs as a simulation (mock runs), whatever its own setting; stage: a
    // stage id, to run only that stage (#141: the roadmap pauses when it is done)
    {
      channel: 'roadmap:start',
      method: 'startRoadmap',
      params: ['projectId', 'simulated', 'stage'],
      schema: { params: args({ projectId: PROJECT_ID, simulated: FLAG, stage: nullable(STRING) }, ['projectId']), result: nullable(OBJECT) },
      fn: ({ projectId, simulated, stage }) => ctx.startRoadmap({ projectId, simulated: !!simulated, stage: stage || null }),
    },
    // pause: nothing new starts (runs in progress go on); stop: back to a plan. #391 after: 'stage'
    // lets the current stage finish (its items still start), then pauses with "Stage N done"; 'now'
    // (the default, also for the budget cap, the update cycle and the control channel) pauses at once
    {
      channel: 'roadmap:pause',
      method: 'pauseRoadmap',
      params: ['projectId', 'stop', 'after'],
      schema: { params: args({ projectId: PROJECT_ID, stop: FLAG, after: nullable({ type: 'string', enum: ['stage', 'now'], description: 'stage: the current stage finishes, then the roadmap pauses; now: nothing new starts. Default: now.' }) }, ['projectId']), result: BACKLOG },
      fn: ({ projectId, stop, after }) => {
        if (after != null && !['stage', 'now'].includes(after)) throw new Error(`Unknown pause: ${after} (stage or now).`);
        if (!stop && after === 'stage') roadmaps.pauseAfterStage(ctx.ws.backlog, project(projectId));
        else roadmaps.setState(ctx.ws.backlog, project(projectId), stop ? 'planned' : 'paused');
        return current(projectId);
      },
    },
    // #391: Cancel pause takes back a "Pause after this stage": the whole roadmap runs again
    {
      channel: 'roadmap:cancel-pause',
      method: 'cancelRoadmapPause',
      params: ['projectId'],
      schema: { params: ON_PROJECT, result: BACKLOG },
      fn: async ({ projectId }) => {
        roadmaps.cancelPause(ctx.ws.backlog, project(projectId));
        await ctx.dispatchRoadmaps();
        return current(projectId);
      },
    },
    // #368: a stage's "Pause after current turn": its runs pause after their current turn and the
    // roadmap pauses at the stage (areas/roadmap.js pauseStage); Resume (roadmap:start) continues them.
    // #399: a line in the roadmap history and an edit in the answer, as Move on (the control channel);
    // its Undo (roadmap:undo) resumes the roadmap as Resume does
    {
      channel: 'roadmap:pause-stage',
      method: 'pauseRoadmapStage',
      params: ['projectId', 'stageId'],
      schema: { params: args({ projectId: PROJECT_ID, stageId: text(200) }, ['projectId', 'stageId']), result: BACKLOG },
      fn: async ({ projectId, stageId }) => {
        const id = project(projectId);
        const r = roadmaps.readRoadmap(ctx.ws.backlog, id);
        const before = r.stages;
        const at = before.findIndex((s) => s.id === String(stageId));
        const out = await ctx.pauseStage({ projectId, stageId: requireText(stageId, 'stage id', 200) });
        const name = at >= 0 ? before[at].name || `stage ${RoadmapModel.stageNumber(r, at)}` : 'a stage';
        // the screen's Resume rule: a #391 "Pause after this stage" scope resumes the whole roadmap
        const scoped = RoadmapModel.scopedStage(r);
        const paused = { stage: String(stageId), simulated: !!r.simulated, scope: scoped >= 0 ? r.stages[scoped].id : null };
        const edit = edited(id, before, `Paused ${name} after the current step`, { paused });
        return { ...out, ...(edit ? { edit } : {}) };
      },
    },
    // #395: a stage's "Move on from this stage": its items waiting at a human gate are parked (their
    // gates stay the owner's), its planned items not started skipped, and the next stage starts;
    // refused while one of its items runs an agent turn or a command ("Pause after current step")
    {
      channel: 'roadmap:park-stage',
      method: 'parkRoadmapStage',
      params: ['projectId', 'stageId'],
      schema: { params: args({ projectId: PROJECT_ID, stageId: text(200) }, ['projectId', 'stageId']), result: BACKLOG },
      fn: async ({ projectId, stageId }) => {
        const id = project(projectId);
        const before = stagesOf(id);
        const at = before.findIndex((s) => s.id === String(stageId));
        await ctx.parkStage({ projectId: id, stageId: requireText(stageId, 'stage id', 200) });
        const name = at >= 0 ? before[at].name || `stage ${RoadmapModel.stageNumber({ stages: before }, at)}` : 'a stage';
        return withEdit(projectId, edited(id, before, `Moved on from ${name}`));
      },
    },
    // A roadmap paused by the budget cap (#206, areas/budget.js): raise (the cap for today or tonight
    // becomes what is spent plus the next stage) or resume (this roadmap ignores the cap until the
    // day or the night ends); both run it again
    {
      channel: 'roadmap:budget',
      method: 'roadmapBudget',
      params: ['projectId', 'action'],
      schema: { params: args({ projectId: PROJECT_ID, action: ACTION }, ['projectId']), result: BACKLOG },
      fn: async ({ projectId, action }) => {
        await ctx.budgetAction({ projectId: project(projectId), action: requireText(action, 'budget action', 40) });
        return current(projectId);
      },
    },
    // Live roadmap (#164): on (only while running) the Product Owner refills it from the backlog when
    // its last stage ends; off lets the current stages finish and adds nothing more
    {
      channel: 'roadmap:live',
      method: 'setRoadmapLive',
      params: ['projectId', 'on'],
      schema: { params: args({ projectId: PROJECT_ID, on: FLAG }, ['projectId']), result: BACKLOG },
      fn: async ({ projectId, on }) => {
        roadmaps.setLive(ctx.ws.backlog, project(projectId), !!on, { by: 'owner' });
        await ctx.dispatchRoadmaps();
        return current(projectId);
      },
    },
    {
      channel: 'roadmap:clear',
      method: 'clearRoadmap',
      params: ['projectId'],
      schema: { params: ON_PROJECT, result: OBJECT },
      fn: ({ projectId }) => {
        const before = stagesOf(project(projectId));
        roadmaps.clearRoadmap(ctx.ws.backlog, project(projectId));
        return withEdit(projectId, edited(project(projectId), before, 'Cleared the roadmap'));
      },
    },
    // retry (the item runs again) or skip (it counts as finished) an item, usually the one that paused the roadmap.
    // A retry is refused while the item's run is alive (in any app process, #112); when its worktree,
    // or an ended run's of the same issues, still has commits of its own, the answer is the kept-work
    // question { confirm, kept, runId } (#170: Resume the old run / Start from scratch) until
    // `confirmed` (Start from scratch), which lets the item's next start go past that work.
    {
      channel: 'roadmap:item',
      method: 'roadmapItem',
      params: ['projectId', 'itemId', 'action', 'confirmed'],
      schema: { params: args({ projectId: PROJECT_ID, itemId: ITEM_ID, action: ACTION, confirmed: FLAG }, ['projectId']), result: BACKLOG },
      fn: async ({ projectId, itemId, action, confirmed }) => {
        requireText(action, 'roadmap item action', 40);
        const id = project(projectId);
        const item = roadmaps.findItem(roadmaps.readRoadmap(ctx.ws.backlog, id), String(itemId));
        // #395 Move on: an owner edit (kept in the history, Undo takes it back); the run keeps its gate
        if (action === 'park') {
          const before = stagesOf(id);
          await ctx.parkItem({ projectId: id, itemId });
          const refs = item ? backlog.itemIssues(item).map((i) => `#${i.number}`).join(', ') : 'an item';
          return withEdit(projectId, edited(id, before, `Moved on past ${refs} at its gate`));
        }
        if (action === 'retry' && item && !(item.runId && ctx.runAlive(item.runId))) {
          if (!confirmed) {
            const issues = backlog.itemIssues(item);
            const kept = (item.runId && ctx.keptWorkOfRun(item.runId, issues)) || ctx.keptWorkForIssues(issues);
            if (kept) return { ...current(projectId), confirm: kept.text, kept, runId: kept.runId };
          } else ctx.allowKeptWork(id, item.id);
        }
        roadmaps.itemAction(ctx.ws.backlog, id, String(itemId), String(action), { alive: ctx.runAlive });
        await ctx.dispatchRoadmaps();
        return current(projectId);
      },
    },
  ];
};
