// Service area: resuming a run from a step (Resume from step…, the supervisor's recommendations)
// and the work an ended run kept (#112): the commits of its kept worktree and the kept-work question
// (#170: its own commits, on its branch once the folder is gone (#202), how stale they are, Resume the old run / Start from scratch), and whether
// the owner may confirm a human gate's earlier approval. Never goes past a human gate on its own.

const fs = require('fs');
const path = require('path');
const { loadWorkflow } = require('../../engine/workflow');
const { displayName } = require('../../shared/display-name');
const runs = require('../../runs');
const sessionCache = require('../../shared/session-cache');
const supervisor = require('../../supervisor');
const { gitOut } = require('../common');

module.exports = (ctx) => {
  // The work a run's worktree holds (#170), or null when neither its folder nor its branch is left
  // (#202: an ended run keeps its branch, not its folder; the branch is then read in the repository):
  // commits: the run's own commits, i.e. not reachable from the local base branch, its remote one or
  // the commit the worktree started from (merged or unpushed commits of the base are not the run's);
  // behind: how many commits the local base has gained since the run's fork point;
  // changed: the files the run changed since its fork point;
  // conflicts: the files the run changed that the base changed too since then.
  function runWorktreeWork(runId) {
    const events = supervisor.readEvents(ctx.runFolder(runId));
    const ready = events.find((e) => e.type === 'worktree.ready');
    if (!ready?.dir) return null;
    let dir = ready.dir;
    let head = 'HEAD';
    const exists = (ref) => gitOut(dir, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]) !== null;
    if (!fs.existsSync(dir)) {
      const branch = events.filter((e) => e.type === 'worktree.removed' || e.type === 'worktree.kept').pop()?.branch;
      if (!branch || !ready.repo || !fs.existsSync(ready.repo)) return null;
      dir = ready.repo;
      head = `refs/heads/${branch}`;
      if (!exists(head)) return null;
    }
    const name = String(ready.base || '').replace(/^origin\//, '');
    const local = name && exists(`refs/heads/${name}`) ? `refs/heads/${name}` : null;
    const exclude = [local, name && `refs/remotes/origin/${name}`, !ready.reused && ready.commit].filter((ref) => ref && exists(ref));
    if (!exclude.length) return null;
    const commits = Number(gitOut(dir, ['rev-list', '--count', head, '--not', ...exclude])) || 0;
    const fork = local ? gitOut(dir, ['merge-base', head, local]) : null;
    if (!fork) return { commits, base: name || 'main', behind: 0, changed: [], conflicts: [] };
    const files = (args) => (gitOut(dir, ['diff', '--name-only', ...args]) || '').split('\n').filter(Boolean);
    const behind = Number(gitOut(dir, ['rev-list', '--count', `${fork}..${local}`])) || 0;
    const onBase = behind ? new Set(files([fork, local])) : new Set();
    const changed = files([fork, head]);
    return { commits, base: name, behind, changed, conflicts: changed.filter((f) => onBase.has(f)) };
  }

  // The commits a run made itself in its kept worktree (0: none, or no worktree left).
  function runWorktreeCommits(runId) {
    return runWorktreeWork(runId)?.commits || 0;
  }

  // When a run started, from its id (YYYYMMDD-HHMMSS-…): "10:38" today, "2026-09-30 10:38" before.
  function runTime(runId) {
    const m = String(runId).match(/^(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})/);
    if (!m) return null;
    const now = new Date();
    const today = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
    return `${m[1] + m[2] + m[3] === today ? '' : `${m[1]}-${m[2]}-${m[3]} `}${m[4]}:${m[5]}`;
  }

  // Where and why an ended run stopped, from its events (#288): the step it stopped at, the steps it
  // finished, a human gate left waiting, a limit that stopped it.
  function runStop(runId) {
    let stoppedAt = null;
    let gate = null;
    let limit = null;
    const done = new Set();
    const events = supervisor.readEvents(ctx.runFolder(runId));
    const ts = events.map((e) => Date.parse(e.ts)).filter(Number.isFinite);
    for (const ev of events) {
      if (ev.type === 'step.started') { stoppedAt = ev.step_id; gate = null; }
      else if (ev.type === 'step.finished' && !ev.error) { done.add(ev.step_id); limit = null; }
      else if (ev.type === 'approval.requested') gate = { id: ev.approval_id, step: ev.step_id || stoppedAt };
      else if (ev.type === 'approval.resolved') { gate = null; limit = null; }
      else if (ev.type === 'limit.exceeded') limit = ev.limit || 'a limit';
    }
    // an interrupted run has no summary: its time is its events' span, not the time since it started
    return { stoppedAt: gate?.step || stoppedAt, gate, limit, done, spanMs: ts.length ? Math.max(...ts) - Math.min(...ts) : 0 };
  }

  const money = (n) => `US$${(Number(n) || 0).toFixed(2)}`;
  const spentTime = (ms) => {
    const min = Math.floor((Number(ms) || 0) / 60000);
    return min >= 60 ? `${Math.floor(min / 60)} h ${min % 60} min` : `${min} min`;
  };

  // The kept-work question for a run (#170, redone in #288), the same wherever a start would redo its
  // work (roadmap Retry and pause, the queue, Start on an issue): why and where the old run stopped,
  // what it did, what is left and what it cost; the commit counts and file names in `details`.
  // Resume (at `stoppedAt`, at once) is the primary choice when the old run has commits of its own,
  // Start over (with what it spends again) only when it has none.
  // { runId, stoppedAt, commits, issues, title, message, details, choices: [{ id, label, line, title, primary }], recommended, text }
  function keptWorkQuestion(r, asked, work) {
    const numbers = asked.map((i) => Number(i?.number ?? i)).filter(Boolean);
    const own = new Set((r.issues || []).map((i) => Number(i.number)));
    const names = (list) => list.map((n) => `#${n}`).join(' + ');
    const covered = numbers.filter((n) => own.has(n));
    const missing = numbers.filter((n) => !own.has(n));
    const when = runTime(r.runId);
    const { commits, base, behind, changed = [], conflicts } = work;
    const stop = runStop(r.runId);
    let wfSteps = [];
    try { if (r.file) wfSteps = loadWorkflow(ctx.workflowPath(r.file).file).steps; } catch { /* the workflow is gone: the facts without its steps */ }
    const stepName = (id) => wfSteps.find((s) => s.id === id)?.name || displayName(id);
    const at = stepName(stop.stoppedAt) || 'its first step';
    const firstLine = String(r.error || '').split('\n')[0].trim();
    const reason = stop.limit ? `Stopped by a limit (${stop.limit}) at ${at}${r.status === 'interrupted' ? ', then the app closed' : ''}.`
      : r.status === 'interrupted' ? (stop.gate ? `Stopped at a human gate (${stepName(stop.gate.step)}) when the app closed.` : `The app closed while it ran ${at}.`)
        : r.status === 'cancelled' ? `Cancelled by the owner at ${at}.`
          : r.status === 'failed' ? `Failed at ${at}${firstLine ? `: ${firstLine.replace(/\.$/, '')}` : ''}.`
            : `Ended (${r.status}) at ${at}.`;
    const stoppedIdx = wfSteps.findIndex((s) => s.id === stop.stoppedAt);
    const doneSteps = wfSteps.filter((s) => stop.done.has(s.id) && s.id !== stop.stoppedAt).map((s) => stepName(s.id));
    const left = stoppedIdx >= 0 ? wfSteps.slice(stoppedIdx).map((s) => stepName(s.id)) : [];
    const message = [
      reason,
      doneSteps.length ? `Done: ${doneSteps.join(', ')}.` : 'Done: nothing yet.',
      left.length ? `Left: ${left.join(', ')}.` : '',
      `Spent ${money(r.costUsd)} in ${spentTime(stop.spanMs)}.`,
      behind ? `${base} moved ${behind} commit${behind === 1 ? '' : 's'} since: the run merges it at the end.` : '',
      missing.length && covered.length ? `The old run only covers ${names(covered)}: resuming it leaves ${names(missing)} out.` : '',
    ].filter(Boolean).join(' ');
    const list = (files) => `${files.slice(0, 5).join(', ')}${files.length > 5 ? `, +${files.length - 5} more` : ''}`;
    const details = [
      `${commits} commit${commits === 1 ? '' : 's'} of its own on its branch (run ${r.runId}${when ? `, ${when}` : ''})`,
      behind ? `Based on ${base}${when ? ` from ${when}` : ''}, ${behind} commit${behind === 1 ? '' : 's'} behind today's ${base}` : `Based on today's ${base}`,
      changed.length ? `Files it changed: ${list(changed)}` : '',
      conflicts.length ? `${conflicts.length} of them changed on ${base} too (${list(conflicts)}): the merge at the end may need a fix` : '',
    ].filter(Boolean);
    const recommended = commits > 0 ? 'resume' : 'scratch';
    const choices = [
      { id: 'scratch', label: 'Start over', line: `Start over: a new run from today's ${base}; spends about $${(Number(r.costUsd) || 0).toFixed(2)} again.`, title: 'The old commits stay in their branch' },
      { id: 'resume', label: 'Resume', line: `Resume: goes on at ${at} with the old commits.` },
    ].map((c) => ({ ...c, primary: c.id === recommended }));
    return {
      runId: r.runId, stoppedAt: stop.stoppedAt, commits, issues: r.issues, recommended, choices, message, details,
      title: `${names(numbers)}: a run stopped at ${at}`,
      // the one-line form (a roadmap item's error, a confirm without the dialog): with the commit count
      text: [message, `${details[0]}.`, ...choices.map((c) => c.line)].join(' '),
    };
  }

  // The kept-work question for this run when its worktree still holds commits of its own, else null.
  function keptWorkOfRun(runId, issues) {
    const r = ctx.ws && runs.listRuns(ctx.ws.runs).find((x) => x.runId === runId);
    const work = r && runWorktreeWork(runId);
    return work?.commits ? keptWorkQuestion(r, issues || r.issues || [], work) : null;
  }

  // The newest ended run of one of these issues whose kept worktree still has commits of its own, as
  // its kept-work question (keptWorkQuestion), or null (#112: starting the same issues again would
  // redo that work; resuming that run keeps it).
  function keptWorkForIssues(issues) {
    const numbers = new Set((issues || []).map((i) => Number(i?.number ?? i)).filter(Boolean));
    if (!numbers.size || !ctx.ws) return null;
    const ended = runs.listRuns(ctx.ws.runs)
      .filter((r) => r.status !== 'running' && !ctx.runAlive(r.runId) && (r.issues || []).some((i) => numbers.has(Number(i.number))))
      .sort((a, b) => String(b.runId).localeCompare(String(a.runId)));
    for (const r of ended) {
      const work = runWorktreeWork(r.runId);
      if (work?.commits) return keptWorkQuestion(r, issues, work);
    }
    return null;
  }

  // Whether the owner may confirm, at resume, the decision a run took at a human gate (#112): only
  // an approval (approved: true, or the gate's first choice, its forward one by the workflows'
  // convention, e.g. `approve`; never `changes` or `stop`), and only while the branch is still at
  // the commit approved there (a simulation has no branch: nothing can have changed).
  // { ok, approvedCommit, currentCommit, reason }
  function gateConfirmation(runDir, gate, spec, wf) {
    const evs = supervisor.readEvents(runDir);
    const requested = new Map(evs.filter((e) => e.type === 'approval.requested').map((e) => [e.approval_id, e]));
    const decided = evs.filter((e) => e.type === 'approval.resolved' && !e.withdrawn && (e.step_id || requested.get(e.approval_id)?.step_id) === gate).pop();
    const out = spec.steps[gate]?.output || {};
    if (!decided && !spec.steps[gate]) return { ok: false, reason: `the previous run has no decision at ${gate}` };
    const choices = (decided && requested.get(decided.approval_id)?.choices) || wf?.steps.find((s) => s.id === gate)?.choices || null;
    const choice = decided ? decided.choice : out.choice;
    const approval = choice !== undefined && choice !== null
      ? !!choices?.length && String(choices[0].id) === String(choice) && !choices[0].feedback_required
      : (decided ? decided.approved === true : out.approved !== false);
    if (!approval) return { ok: false, reason: `the decision at ${gate} was ${choice ?? 'a rejection'}, not an approval` };
    const approvedCommit = decided?.commit || null;
    const wt = spec.worktree;
    // the folder of an ended run is gone (#202): its branch tip, read in the repository (a WIP
    // commit there is work made after the approval, so it counts as a change)
    const repo = evs.find((e) => e.type === 'worktree.ready')?.repo;
    const currentCommit = wt?.dir && fs.existsSync(wt.dir) ? gitOut(wt.dir, ['rev-parse', 'HEAD'])
      : wt?.branch && repo && fs.existsSync(repo) ? gitOut(repo, ['rev-parse', '--verify', '--quiet', `refs/heads/${wt.branch}`]) : null;
    if (!wt) return { ok: true, approvedCommit, currentCommit };
    if (!approvedCommit) return { ok: false, approvedCommit, currentCommit, reason: `the run did not record the commit approved at ${gate}` };
    if (!currentCommit) return { ok: false, approvedCommit, currentCommit, reason: 'the run\'s worktree is gone' };
    if (currentCommit !== approvedCommit) return { ok: false, approvedCommit, currentCommit, reason: `the branch changed after the approval at ${gate}` };
    return { ok: true, approvedCommit, currentCommit };
  }

  // Continues a run from a step: a new run with the previous outputs, agent conversations and an
  // instruction. Called by the owner directly (Resume from step…) and by the supervisor's
  // recommendations; no LLM call. It never goes past a human gate on an earlier decision: a step
  // after a gate the previous run decided is refused, and every gate reached again asks again.
  // Only the owner, in the dialog, may confirm that decision (`confirmGate`, the gate's id, #112)
  // while the branch is still at the approved commit; it is recorded as their approval.
  // mock: true resumes as a simulation (a simulated run always resumes as one).
  // images: pictures pasted into the instruction (#130), for the first resumed agent step
  // child: { parent, onFinished, notices, signal, onSlotWait } when a resumed parent resumes its child
  // run (#175, startChildRun); never from a channel. The run's own child runs go with `childRuns`.
  // A paused run (#368) without a step continues where it paused: the step after its last finished
  // turn (the gate it waited at asks again), every step it finished seeded as the run had it (its
  // summary, the steps a resumed run carried included), the gates the owner answered before the pause
  // kept: it is the same work going on, not a run sent back to a step.
  function resumeRun({ runId, step, instruction, mock, confirmGate = null, images = [] }, child = null) {
    const runDir = ctx.runFolder(runId);
    if (ctx.runIsLive(path.basename(runDir))) throw new Error('The run is still active: wait for it to end (or stop it) before resuming it.');
    if (ctx.runAlive(path.basename(runDir))) throw new Error(`Run ${path.basename(runDir)} is still running in another app window: resume it there, or stop it first.`);
    const spec = supervisor.resumeSpec(runDir, step);
    if (!spec.file) throw new Error('The run does not record its workflow file.');
    const wf = loadWorkflow(ctx.workflowPath(spec.file).file);
    const pausedAt = step ? null : pausedStep(runDir);
    const fromStep = step || pausedAt?.step || wf.steps[0].id;
    if (!wf.steps.some((s) => s.id === fromStep)) throw new Error(`Cannot resume: step "${fromStep}" does not exist in the current version of the workflow.`);
    const gate = pausedAt ? null : supervisor.skippedGate(wf, fromStep, spec.steps);
    let confirmedGate = null;
    if (gate) {
      if (confirmGate !== gate) throw new Error(`Cannot resume from "${fromStep}": it would go past the human gate "${gate}" on the previous run's decision. Resume from "${gate}" instead: it asks again.`);
      const check = gateConfirmation(runDir, gate, spec, wf);
      if (!check.ok) throw new Error(`Cannot confirm ${gate} again: ${check.reason}. Resume from "${gate}" instead: it asks again.`);
      confirmedGate = { step: gate, commit: check.currentCommit };
    }
    const steps = pausedAt ? pausedAt.steps : supervisor.withoutGateDecisions(wf, spec.steps);
    if (confirmedGate) steps[gate] = spec.steps[gate];
    return ctx.startWorkflowRun({
      file: spec.file, inputs: spec.inputs, attachments: spec.attachments, mock: spec.mock || mock === true, projectId: spec.projectId, issues: spec.issues, agentOverrides: spec.agentOverrides,
      resume: { runId: spec.runId, fromStep, steps, sessions: spec.sessions, cliTotals: spec.cliTotals, handoffs: spec.handoffs, instruction: instruction || null, images: Array.isArray(images) ? images : [], worktree: spec.worktree, confirmedGate, childRuns: spec.childRuns, ...(pausedAt ? { paused: true } : {}) },
      ...(child ? { parent: child.parent, onFinished: child.onFinished, notices: child.notices, signal: child.signal, onSlotWait: child.onSlotWait } : {}),
    });
  }

  // A paused run's resume point (#368): { step, next, at, steps, turns } from its summary.json (steps:
  // the ones it visited, { output, visits }; turns: what each agent's next turn re-reads, #320, its
  // sessions taken as open again: a cold cache shows its cold_resume_usd), or null when the run did
  // not end paused. The summary, not the step.finished events resumeSpec reads: it carries the
  // engine's visit counters after endOfError uncounted the visit the pause left unfinished, and each
  // step's last output, an on_error one included, exactly as the paused run would have routed it.
  function pausedStep(runDir) {
    let summary = null;
    try { summary = JSON.parse(fs.readFileSync(path.join(runDir, 'summary.json'), 'utf8')); } catch { return null; }
    if (summary?.status !== 'paused' || !summary.paused?.step) return null;
    const steps = Object.fromEntries(Object.entries(summary.steps || {}).filter(([, v]) => v?.visits > 0).map(([id, v]) => [id, { output: v.output ?? null, visits: v.visits }]));
    const turns = sessionCache.agentNextTurns((summary.sessions || []).map((s) => ({ ...s, closed_at: null })));
    return { ...summary.paused, steps, turns };
  }

  // Whether automation may resume this run (#368): never a paused one, only the owner resumes it
  // (the Oracle, the supervisor and the Night watch are refused).
  function refusePausedResume(runId) {
    if (pausedStep(ctx.runFolder(runId))) throw new Error(`Run ${path.basename(String(runId))} is paused: only the owner resumes a paused run.`);
  }

  // What the Resume from step… dialog shows: the workflow's steps in order (reached, where the run
  // stopped, the steps a decided gate keeps out of reach), the suggested step and what is kept.
  function resumeOptions({ runId }) {
    const runDir = ctx.runFolder(runId);
    const id = path.basename(runDir);
    const spec = supervisor.resumeSpec(runDir, null);
    if (!spec.file) throw new Error('The run does not record its workflow file.');
    let wf;
    try { wf = loadWorkflow(ctx.workflowPath(spec.file).file); } catch (e) { throw new Error(`The run's workflow (${spec.file}) cannot be loaded: ${e.message}`); }
    const visits = {};
    let stoppedAt = null;
    let failedStep = null;
    for (const ev of supervisor.readEvents(runDir)) {
      if (ev.type === 'step.started') { visits[ev.step_id] = (visits[ev.step_id] || 0) + 1; stoppedAt = ev.step_id; }
      if (ev.type === 'step.finished' && ev.error) failedStep = ev.step_id;
    }
    const status = ctx.runIsLive(id) ? 'running' : runs.readRun(ctx.ws.runs, id)?.status || 'interrupted';
    // a limit that stopped it (#288): the dialog says the resumed run counts it from zero
    const { limit } = runStop(id);
    // a step after a decided gate: allowed when the owner confirms that gate again (#112), see gateConfirmation
    const confirmations = new Map();
    const confirmationOf = (gate) => {
      if (!confirmations.has(gate)) confirmations.set(gate, gateConfirmation(runDir, gate, spec, wf));
      return confirmations.get(gate);
    };
    const steps = wf.steps.map((s) => {
      const blockedBy = supervisor.skippedGate(wf, s.id, spec.steps);
      return {
        id: s.id, type: s.type || 'agent', gate: s.type === 'human_approval', visits: visits[s.id] || 0,
        blockedBy, confirm: blockedBy ? confirmationOf(blockedBy) : null,
      };
    });
    const allowed = (x) => steps.some((s) => s.id === x && (!s.blockedBy || s.confirm?.ok));
    // where the run stopped, else the nearest allowed step before it; never the first step by default
    const stoppedIdx = steps.findIndex((s) => s.id === stoppedAt);
    const before = stoppedIdx > 0 ? steps.slice(0, stoppedIdx).reverse().find((s) => allowed(s.id))?.id : null;
    const paused = status === 'paused' ? pausedStep(runDir) : null;
    const suggested = [paused?.step, status === 'failed' ? failedStep : null, stoppedAt, failedStep, before].find(allowed) || steps.find((s) => !s.blockedBy)?.id || null;
    const wt = spec.worktree;
    return {
      runId: id, workflow: wf.metadata?.name || spec.file, file: spec.file, status, active: status === 'running', mock: spec.mock,
      steps, stoppedAt, failedStep, suggested, limit: status === 'running' ? null : limit,
      worktree: wt ? { dir: wt.dir, branch: wt.branch, exists: fs.existsSync(wt.dir) } : null,
      sessions: Object.keys(spec.sessions), handoffs: Object.keys(spec.handoffs),
      // #368: a paused run's { step, next, at, turns } (Resume without a step continues there)
      paused: paused ? { step: paused.step, next: paused.next || null, at: paused.at || null, turns: paused.turns } : null,
    };
  }

  return {
    keptWorkForIssues,
    keptWorkOfRun,
    refusePausedResume,
    resumeOptions,
    resumeRun,
    runWorktreeCommits,
  };
};
