// @ts-check
// Transitions and visits (#250, from packages/engine/engine/workflow.js): `finishStep` evaluates the goal and
// walks the step's transitions (`when`, actions, `precheck`, `merge`, `ship`, the merge queue, `set:`,
// delegation, the ending transition's `status`), with `max_visits` / `max_iterations` and
// `on_exhausted` (`applyCounters`), the /loop waits and blocked iterations (`loopWait`,
// `checkBlocked`), `wait:` probe polling between the agent's turns (`pollStep`), the recovery of a
// failed action (`recoverFromActionError`), `merge: local` and `ship:`. The actions, merges, pushes
// and probes themselves are the run's machine adapter's (`this.machine`, packages/engine/engine/machine-actions.js,
// #353): a simulated run gets the simulated one.

'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { sleep } = require('../providers');
const { parseTarget } = require('../probes');
const mergeQueue = require('../merge-queue');
const { restackOnBase, restackOnParent } = require('../worktree');
const { evalExpr, render } = require('./templates');
const { isLooping, loopConfig, parseDuration } = require('./load');
const { decisionKey, validateSchema } = require('./outputs');
const { prFixMethods } = require('./pr-fix');

// `wait:` on a /loop step: between the agent's turns the engine checks the PR/MR or the CI run
// itself (packages/engine/engine/probes.js) and calls the agent only on news. What each probe watches, for
// the agent's prompt:
const PROBE_WHAT = {
  pr_checks: 'the PR/MR checks and mergeability',
  pr_changes: 'the PR/MR (new commits, comments, reviews, checks, mergeability)',
  workflow_run: 'the CI run',
  pr_mergeable: 'whether the PR/MR can be merged',
};
// A PR/MR with no check registered yet is polled this long after the agent's last turn (the push),
// then the agent is called to find out why (`wait.grace`).
const DEFAULT_WAIT_GRACE = '10m';

// Instructions in the style of Claude Code's /goal and /loop. The engine is what actually
// repeats the step and enforces the limits; the agent only needs to know the contract.
function goalLoopInstructions(step, st, scope) {
  const lines = [];
  if (step.goal) {
    lines.push(`/goal: ${render(step.goal.description, scope)}`);
    lines.push('Your work on this step is only done when this goal is met. Do not declare success without checking the real state.');
  }
  if (isLooping(step)) {
    const cfg = loopConfig(step);
    if (step.wait) {
      lines.push(`/loop: iteration ${st.iteration}. Between your turns the orchestrator checks ${PROBE_WHAT[step.wait.probe]} itself every ${cfg.interval || '1m'} (limit: ${cfg.max_duration || 'none'}), without you, and calls you again only when something changed or needs a decision, until the /goal is met.`);
      if (st.probeNews) lines.push(`Since your last turn the orchestrator checked ${st.probeNews.polls} time(s) without you. It calls you now because: ${st.probeNews.detail}.`);
    } else {
      lines.push(`/loop: iteration ${st.iteration}. The orchestrator will call you again every ${cfg.interval || '1m'} (limit: ${cfg.max_duration || 'none'}) until the /goal is met.`);
    }
    lines.push('On each call: check the current state, take the necessary action and reply right away. Do not block waiting (no long watch/sleep).');
    lines.push(`If your tools are refused (not allowed), do not retry other forms of the same command and do not keep answering the same: after ${maxBlocked(step)} blocked iterations in a row the orchestrator stops this loop.`);
  }
  return lines.join('\n');
}

// A /loop iteration is "blocked" when the agent could not observe anything (every tool call was
// refused, or it made none) or when its tools were refused and it gave the same decision again.
// `loop.max_blocked` in a row (default 3, 0 = off) ends the loop like `max_duration` does, instead
// of polling for hours with an agent that cannot change anything.
const DEFAULT_MAX_BLOCKED = 3;
const maxBlocked = (step) => loopConfig(step).max_blocked ?? DEFAULT_MAX_BLOCKED;

const methods = {
  // step.finished, the /goal check and the transitions of a step that has its output.
  async finishStep(step, st, output, scope, t0, extra = {}) {
    this.emitEvent('step.finished', { step_id: step.id, visit: st.visits, iteration: st.iteration, output, duration_ms: Date.now() - t0, ...extra });
    st.outputs?.push(output);
    this.notePreexistingFailures(step.id, output);
    this.recordEvidence(step, st, output);
    this.saveScenarios(step, output);

    if (step.goal) {
      const met = evalExpr(step.goal.until, scope);
      this.emitEvent('step.goal', { step_id: step.id, goal: render(step.goal.description, scope), met, iteration: st.iteration });
    }

    if (!step.transitions?.length) {
      const i = this.wf.steps.indexOf(step);
      const next = this.wf.steps[i + 1]?.id || 'end';
      this.emitEvent('step.transition', { from: step.id, to: next, when: '(sequential)' });
      return next;
    }

    for (const t of step.transitions) {
      if (!evalExpr(t.when, scope)) continue;
      // an action that renders empty (a conditional one whose condition is false) runs nothing
      const action = t.action ? render(t.action, scope).trim() : '';
      // `precheck:` the PR/MR is checked right before the action (`true` = the gate's own `check:`)
      const precheck = t.precheck === true ? step.check : t.precheck || null;
      const act = async () => {
        // `ship:` (#260): refused before anything happens (its merge included) unless the owner answered
        if (t.ship) this.shipGuard(step);
        if (precheck) await this.runCheck(precheck, step, 'precheck', scope, { failIfNot: true });
        // simulation: mockSequences.action_errors: { step: n } fails the first n actions/merges of that step
        if (action || t.merge === 'local' || t.ship) this.machine.transitionFault({ stepId: step.id, action, merge: t.merge === 'local' });
        if (action) await this.runAction(action);
        // `merge: local`: the engine merges the run's branch into the local base (no push, no PR)
        if (t.merge === 'local') await this.mergeWorktreeLocally();
        // `ship: { tag }` (#260): the local base is pushed and tagged, after the merge when there is one
        if (t.ship) await this.shipRelease(step, t.ship, scope);
      };
      try {
        // a merge (checked, or local) and a ship wait for the other runs' merges into the same repository
        if (precheck || t.merge === 'local' || t.ship) {
          const key = this.mergeKey(precheck, scope);
          await mergeQueue.serialize(key, act);
          mergeQueue.notifyMerged({ key, runId: this.runId });
        } else await act();
      } catch (e) {
        // `on_error: <step>` on the transition: a failed check, action or merge goes there (the error
        // is in the template context as `action_error`) instead of ending the run; with `recover:`
        // the supervisor decides first whether to go back to one of those steps
        // (`fatal`: a ship nobody may retry, e.g. the gate was not answered by the owner)
        if (!t.on_error || this.abort.signal.aborted || e.fatal) throw e;
        return this.recoverFromActionError(step, { on_error: t.on_error, recover: t.recover }, e);
      }
      // `set:` run variables for the next steps' templates (`vars.<name>`)
      // (#606: recorded on step.transition as `set`, so the run's vars are a function of its log)
      const set = t.set ? Object.fromEntries(Object.entries(t.set).map(([k, v]) => [k, typeof v === 'string' ? render(v, scope).trim() : v])) : null;
      Object.assign(this.ctx.vars, set || {});
      // limits first: once max_visits / loop.max_iterations is reached the flow goes to
      // on_exhausted and the delegation is skipped (nothing would check that fix any more)
      let target = this.applyCounters(step, t);
      const delegated = t.delegate && target === t.goto ? await this.delegateTurn(step, t.delegate, scope) : null;
      if (delegated) st.blocked = null; // another agent acted: the next check is a fresh start
      if (target === step.id && isLooping(step)) target = await this.loopWait(step, output, { probed: !!extra.probe });
      // a loop ran out: the supervisor on call first (a gate target: when the gate runs, runStep)
      if (this.exhausted?.target === target && this.wf.steps.find((s) => s.id === target)?.type !== 'human_approval') {
        target = await this.superviseExhausted(step, st, target);
      }
      // the delegation result goes to the next step (e.g. babysitter replies on the PR with the hash)
      if (delegated && this.ctx.steps[target]) this.ctx.steps[target].delegate_result = delegated;
      const ends = target === 'end' && t.status && t.status !== 'success';
      if (ends) this.endStatus = { status: t.status, message: `Run ended as ${t.status} at step "${step.id}" (${t.when}).` };
      this.emitEvent('step.transition', { from: step.id, to: target, when: t.when, ...(ends ? { status: t.status } : {}), ...(set ? { set } : {}) });
      return target;
    }
    throw new Error(`No transition matched in step "${step.id}".`);
  },

  // a transition's `delegate:` (finishStep): the agent's turn on the rendered prompt → { agent, text }
  async delegateTurn(step, delegate, scope) {
    this.emitEvent('log', { level: 'info', message: `${step.id} delegated to ${delegate.agent}` });
    const res = await this.sendToAgent(delegate.agent, render(delegate.prompt, scope), { stepId: `${step.id}:delegate`, attachments: this.stepAttachments(delegate.prompt) })
      .finally(() => this.stopWorktreeProcesses(`${step.id} delegation to ${delegate.agent}`));
    const delegated = { agent: delegate.agent, text: res.text };
    // #811: what a fix from the PR monitor spent and answered (pr-fix.js runPrFix)
    this.lastDelegation = { ...delegated, usage: res.usage || null };
    return delegated;
  },

  // ---- `wait:` deterministic checks between the agent's turns of a /loop (packages/engine/engine/probes.js) ----
  // Returns the next step (poll again, /loop limit, or the step finished by the check), or null to
  // run the agent turn: after a delegation or a supervisor note, and whenever the check has news
  // (a failure, a conflict, a change on the PR/MR, an unknown state or a check that could not run).
  async pollStep(step, st, t0) {
    const w = step.wait;
    if (st.delegate_result || st.supervisorNote || !st.output || st.output.error) return null;
    const stats = (this.probeStats[step.id] ??= { polls: 0, agent_calls: 0, completed: 0, errors: 0 });
    const early = await this.parentStep(step, st, stats);
    if (early !== undefined) return early;
    const target = render(w.target, { ...this.ctx, output: st.output }).trim();
    const r = await this.probeOrError(step, stats, { probe: w.probe, target, quota: this.actionsQuota }, 'the check could not run', target ? '' : `${w.probe}: no target yet (${w.target} is empty)`);
    const state = this.comparedWithLastTurn(w, st, r);
    const grace = w.grace ?? DEFAULT_WAIT_GRACE;
    let action = 'agent';
    let output = null;
    // the agent's last output with the given fields over it (templates see `probe`: { state, detail })
    const finishWith = (key) => {
      const scope = { ...this.ctx, output: st.output, probe: { state, detail: r.detail || state } };
      const out = { ...st.output, ...Object.fromEntries(Object.entries(w[key]).map(([k, v]) => [k, typeof v === 'string' ? render(v, scope) : v])) };
      const errs = validateSchema(out, step.output_schema);
      if (!errs.length) return out;
      this.emitEvent('log', { level: 'warn', message: `${step.id}: wait.${key} does not match the output schema (${errs.join('; ')}); calling the agent` });
      return null;
    };
    if (state === 'pending' || state === 'unchanged') action = 'poll';
    else if (state === 'none') action = Date.now() - (st.lastAgentAt || 0) < parseDuration(grace, 600000) ? 'poll' : 'agent';
    else if (state === 'passed' && w.output) output = finishWith('output');
    // CI cannot run at all (the Actions quota ran out): no agent turn or fix round helps
    else if (state === 'quota_exhausted' && w.infra_output) output = finishWith('infra_output');
    if (output) action = 'output';
    action = this.afterRestack(st, this.holdForStackParent(step, st, action, r), r, state);
    if (state === 'none' && action === 'agent') r.detail = `${r.detail}, ${grace} after your last turn`;
    st.probePolls = (st.probePolls || 0) + 1;
    this.emitEvent('step.probe', {
      step_id: step.id, probe: w.probe, target, state, detail: r.detail || state, action, iteration: st.iteration, polls: st.probePolls,
    });
    if (state === 'error') this.emitEvent('log', { level: 'warn', kind: 'probe_error', step_id: step.id, message: `${step.id}: ${r.detail}; calling the agent instead` });

    if (action === 'poll') {
      stats.polls++;
      let next = await this.loopWait(step, st.output, { probed: true });
      if (this.exhausted?.target === next && this.wf.steps.find((s) => s.id === next)?.type !== 'human_approval') next = await this.superviseExhausted(step, st, next);
      if (next !== step.id) this.emitEvent('step.transition', { from: step.id, to: next, when: `/loop limit (${loopConfig(step).max_duration})` });
      return next;
    }
    if (action === 'output') {
      stats.completed++;
      this.logDecisions('orchestrator', step.id, [['wait', `finished ${step.id} without an agent turn`, `${w.probe}: ${r.detail}`, target, JSON.stringify(state === 'passed' ? w.output : w.infra_output)]]);
      st.output = output;
      return this.finishStep(step, st, output, { ...this.ctx, output, iteration: st.iteration }, t0, { probe: w.probe });
    }
    stats.agent_calls++;
    st.probeNews = { detail: r.detail || state, polls: st.probePolls };
    return null;
  },

  // #738 / #807: what pollStep does before its own probe when the step waits for a parent PR/MR
  // (wait.parent): a split implementation waits for it; a stacked run follows it. undefined: go on to the probe.
  async parentStep(step, st, stats) {
    const parent = this.parentToWaitFor(step.wait, st);
    if (!parent) return undefined;
    if (!this.stackedRun()) return this.pollParent(step, st, parent, stats);
    return this.followStackParent(step, st, parent, stats);
  },

  // #807: a stacked run whose parent is still open never ends its wait step (ci, stack_follow): its PR
  // targets the parent's branch, so its own checks or merge are not the end of the work. It keeps
  // following the parent (restack, merge, close), outside the /loop's max_duration, as pollParent does.
  // `stackHold` (the step's id while it holds, else null): the service reads it as a wait for this run's
  // own merge (areas/roadmap.js mergeGateOf, the next stage may stack on it) that holds no run slot (parkedRun).
  holdForStackParent(step, st, action, r) {
    const hold = action === 'output' && this.stackedRun() && !!this.parentToWaitFor(step.wait, st);
    this.stackHold = hold ? step.id : null;
    if (!hold) return action;
    st.loopStartedAt = Date.now();
    r.detail = `${r.detail || 'passed'}; following the parent PR/MR until it merges`;
    return 'poll';
  },

  // #807: the engine rebased the stacked branch onto its parent's new commits: the agent pushes it
  afterRestack(st, action, r, state) {
    const news = st.restacked;
    st.restacked = null;
    if (!news || action === 'output') return action;
    this.stackHold = null; // an agent turn pushes the rebased branch: it holds its slot again
    r.detail = `${news}; ${r.detail || state}`;
    return 'agent';
  },

  // #809 `type: pr_monitor`: the run waits for its PR/MR's merge with no agent, no gate and no action (it
  // never touches the PR/MR: Stop only aborts the wait). Reads it every prMonitorIntervalMs until a read
  // says merged (the step's transitions: end, success) or closed (end, failed).
  async runPrMonitor(step, st, t0) {
    for (;;) {
      const next = await this.pollPrMonitor(step, st, t0);
      if (next) return next;
      // simulation: at most 3s, scaled like the mock's delays (as loopWait)
      const pace = prMonitorIntervalMs(Date.now() - (this.prMonitorChangedAt || Date.now()));
      const interval = Math.min(pace, this.machine.simulated ? 3000 * +(process.env.MULTIAGENT_MOCK_DELAY_SCALE ?? 1) : Infinity);
      if (interval !== this.prMonitorWait) this.emitEvent('step.waiting', { step_id: step.id, until: new Date(Date.now() + interval).toISOString(), interval_ms: interval });
      this.prMonitorWait = interval;
      this.setStatus(this.orchestrator, 'waiting');
      // #810: a merge or close from the app wakes the wait (prActedFromApp): the next read sees it at once; one
      // asked during a read (no wait to abort yet: prMonitorWakeAsked) skips the next wait
      const wake = (this.prMonitorWake = new AbortController());
      if (this.prMonitorWakeAsked) wake.abort();
      this.prMonitorWakeAsked = false;
      await sleep(interval, AbortSignal.any([this.abort.signal, wake.signal])).catch((e) => {
        if (this.abort.signal.aborted || !wake.signal.aborted) throw e;
      });
      this.prMonitorWake = null;
      this.setStatus(this.orchestrator, 'active');
    }
  },

  // #810: what a merge or close from the app acts on while the monitor waits → { stepId, url, card } or null
  prMonitorTarget() {
    return this.prMonitor && this.prMonitorUrl ? { stepId: this.prMonitor, url: this.prMonitorUrl, card: this.prMonitorCard || null } : null;
  },

  // #810: a merge or close tried from the app (service/areas/runs.js mergeRunPr / closeRunPr). A merge gives
  // `pr.merge` { merged, commit | error, admin, by }; one that did not land keeps the card and the run as they
  // were and shows the platform's message on the card (merge_error; a close that failed: close_error) until the
  // next try. A close that landed ends the run as failed, saying who closed it (endPrMonitor). Either wakes the
  // monitor to read the PR/MR (during a read: right after it, prMonitorWakeAsked).
  prActedFromApp({ action, admin = false, by = null, merged = false, closed = false, commit = null, error = null }) {
    const target = this.prMonitorTarget();
    if (!target) return;
    const base = { step_id: target.stepId, url: target.url, number: parseTarget(target.url)?.id ?? null, by };
    let failed = false;
    if (action === 'merge') {
      this.emitEvent('pr.merge', { ...base, admin: !!admin, merged: !!merged, ...(merged ? (commit ? { commit } : {}) : { error: String(error || 'the merge failed') }) });
      this.prMergeError = merged ? null : String(error || 'the merge failed');
      this.prCloseError = null;
      failed = !merged;
    } else if (closed) {
      this.prClosedBy = by || 'the app';
      this.prCloseError = null;
      this.emitEvent('log', { level: 'warn', step_id: target.stepId, message: `The pull/merge request ${target.url} was closed from the app${by ? ` by ${by}` : ''}.` });
    } else {
      this.prCloseError = String(error || 'the close failed');
      failed = true;
    }
    if (failed) this.emitEvent('pr.monitor', { ...base, fork: this.ctx.inputs?.mode === 'fork', ...(target.card || {}), ...this.prActionErrors() });
    if (this.prMonitorWake) this.prMonitorWake.abort();
    else this.prMonitorWakeAsked = true;
  },

  // #810: the last merge's and close's messages from the app that did not land, as a pr.monitor event's fields
  prActionErrors() {
    return { ...(this.prMergeError ? { merge_error: this.prMergeError } : {}), ...(this.prCloseError ? { close_error: this.prCloseError } : {}) };
  },

  // #809: ONE read of the monitor's PR/MR → the next step once it merged or closed, else null (wait and
  // read again). Each read that changes the card emits `pr.monitor` (else one every 10 minutes); a read
  // that fails keeps the last card (its state and checked_at) with the error and never ends the run.
  // `prMonitor` (the step's id while it waits): the service counts no run slot for it and shows its
  // roadmap item waiting for the merge. Nothing is kept in `st`: a restarted run reads the PR/MR afresh
  // (prMonitorSeed gives it its last card). The read needs no worktree (gh/glab read the URL); the
  // worktree stays until the run ends, and the run says why once.
  async pollPrMonitor(step, st, t0 = Date.now()) {
    if (this.abort.signal.aborted) throw new Error('Cancelled');
    const target = (step.target ? render(step.target, this.ctx).trim() : '')
      || this.ctx.steps?.ci?.output?.pr_url || this.ctx.steps?.pr_open?.output?.pr_url || '';
    this.prMonitor = step.id;
    this.prMonitorUrl = target; // #810: what a merge or close from the app acts on
    this.sayPrMonitorWorktreeKept(step);
    const base = { step_id: step.id, url: target, number: parseTarget(target)?.id ?? null, fork: this.ctx.inputs?.mode === 'fork', ...this.prActionErrors() };
    // #811: a fix the owner asked for runs before the next read (which then tells whether it pushed)
    if (target && this.prFix?.phase === 'requested') return this.runPrFix(step, st, target, t0);
    let r;
    try {
      if (!target) throw new Error('no pull/merge request URL yet');
      r = await this.probe({ probe: 'pr_monitor', target, signal: this.abort.signal, stepId: step.id });
    } catch (e) {
      if (this.abort.signal.aborted) throw new Error('Cancelled');
      this.prMonitorError = e.message;
      this.emitEvent('pr.monitor', { ...base, ...(this.prMonitorCard || {}), error: e.message });
      return null;
    }
    this.prMonitorError = null;
    const card = this.notePrMonitorRead(r, base);
    if (this.prFix?.phase === 'sent') await this.prFixOutcome(step, r, base);
    if (r.state !== 'merged' && r.state !== 'closed') return null;
    return this.endPrMonitor(step, st, r, card, target, t0);
  },

  // #809: a read that worked → the card it gives, emitted as `pr.monitor` when it changed (else every 10 minutes)
  notePrMonitorRead(r, base) {
    const card = { ...(this.prMonitorCard || {}), state: r.state, detail: r.detail || r.state, checked_at: new Date().toISOString() };
    // #810: merge_options, the merge choices of the card (the service's probe adds them: run-pr.js mergeOptions)
    // #811: head (the PR's head commit) and requests (what the PR asks for, the card's "Ask for a fix")
    for (const k of ['ci', 'review', 'conflicts', 'comments', 'result', 'merge_options', 'head', 'requests']) if (r[k]) card[k] = r[k];
    if (r.state === 'merged' || r.state === 'closed') { delete card.merge_options; delete card.requests; }
    const seen = monitorSeen(r);
    const changed = seen !== this.prMonitorSeen;
    if (changed) this.prMonitorChangedAt = Date.now();
    if (changed || Date.now() - (this.prMonitorEmittedAt || 0) >= 10 * 60e3) {
      this.emitEvent('pr.monitor', { ...base, ...card });
      this.prMonitorEmittedAt = Date.now();
    }
    this.prMonitorSeen = seen;
    this.prMonitorCard = card;
    return card;
  },

  // #809: once, the log line saying why the run keeps its worktree while it waits in the monitor
  sayPrMonitorWorktreeKept(step) {
    if (!this.worktree?.dir || this.prMonitorKeptSaid) return;
    this.prMonitorKeptSaid = true;
    this.emitEvent('log', { level: 'info', step_id: step.id, message: `worktree: ${this.worktree.dir} is kept while the run waits for the merge, unused (no agent, no run slot): the end of the run removes it, deleting its branch once merged, or keeps the work on its branch if the pull/merge request closes.` });
  },

  // #809: the PR/MR merged (success) or closed without merging (failed, saying so): the monitor step ends
  async endPrMonitor(step, st, r, card, target, t0) {
    this.prMonitor = null;
    const closed = r.state === 'closed';
    // #810: closed from the app says who closed it
    const said = `The pull/merge request ${target} was closed without merging${this.prClosedBy ? `: closed from the app (${this.prClosedBy})` : ''}.`;
    if (closed) this.emitEvent('log', { level: 'warn', step_id: step.id, message: said });
    const output = { state: r.state, detail: card.detail, url: target, ...(closed && this.prClosedBy ? { closed_by: this.prClosedBy } : {}) };
    st.output = output;
    const next = await this.finishStep(step, st, output, { ...this.ctx, output }, t0);
    if (closed && this.endStatus?.status === 'failed') this.endStatus.message = said;
    return next;
  },

  // A probe call of pollStep / pollParent; a check that cannot run (or `missing`: why it cannot start)
  // becomes the `error` state, "<what> (<reason>)", so the agent is called instead.
  async probeOrError(step, stats, args, what, missing) {
    try {
      if (missing) throw new Error(missing);
      return await this.probe({ ...args, cwd: this.ctx.worktree_dir || undefined, signal: this.abort.signal, stepId: step.id });
    } catch (e) {
      if (this.abort.signal.aborted) throw new Error('Cancelled');
      stats.errors++;
      return { state: 'error', detail: `${what} (${e.message})` };
    }
  },

  // pr_changes: news = the PR/MR differs from what the agent saw at the end of its last turn
  comparedWithLastTurn(w, st, r) {
    if (w.probe !== 'pr_changes' || r.fingerprint === undefined || ['merged', 'closed', 'error'].includes(r.state)) return r.state;
    if (st.probeBaseline && r.fingerprint === st.probeBaseline) return 'unchanged';
    r.detail = st.probeBaseline ? `the PR/MR changed since your last turn (${r.detail})` : `the PR/MR could not be compared with your last turn (${r.detail})`;
    return 'changed';
  },

  // #738 the parent PR/MR pollStep waits for first (wait.parent), '' once it merged or when none
  parentToWaitFor(w, st) {
    return w.parent && !st.parentMerged ? render(w.parent, { ...this.ctx, output: st.output }).trim() : '';
  },

  // #738 `wait.parent` (a split implementation's parent PR/MR, "wait and rebase"): before the step's own
  // probe, the engine checks the parent itself. Not merged yet → poll again, without the agent, and the
  // wait is not counted in the /loop's max_duration (a maintainer may take days); merged → the agent is
  // called once to rebase and open its PR/MR (st.parentMerged: then the step's own probe runs); closed
  // or unreadable → the agent is called to say what to do.
  async pollParent(step, st, parent, stats) {
    const r = await this.probeOrError(step, stats, { probe: 'pr_checks', target: parent }, 'the parent PR/MR could not be read');
    const waiting = !['merged', 'closed', 'error'].includes(r.state);
    st.probePolls = (st.probePolls || 0) + 1;
    this.emitEvent('step.probe', {
      step_id: step.id, probe: 'parent', target: parent, state: r.state, detail: r.detail || r.state, action: waiting ? 'poll' : 'agent', iteration: st.iteration, polls: st.probePolls,
    });
    if (waiting) {
      stats.polls++;
      st.loopStartedAt = Date.now();
      return this.loopWait(step, st.output, { probed: true });
    }
    if (r.state === 'merged') st.parentMerged = true;
    stats.agent_calls++;
    const news = r.state === 'merged' ? await this.restackAfterParent(step, parent) : `the parent PR/MR ${parent}: ${r.detail || r.state}`;
    st.probeNews = { detail: news, polls: st.probePolls };
    return null;
  },

  // #738 the parent merged: the engine rebases the run's branch onto the synced upstream base itself
  // (worktree.js restackOnBase, the commits after origin/<inputs.parent_branch>); the agent pushes it to
  // origin and opens its PR/MR. A conflict leaves the branch as it was and the agent rebases it by hand.
  async restackAfterParent(step, parent) {
    const wt = this.worktree;
    const then = 'push it to origin (`git push --force-with-lease origin HEAD`, never to upstream) and open its PR/MR now';
    if (!wt?.dir) return `the parent PR/MR ${parent} merged: rebase the branch onto the synced base, ${then}`;
    const log = (level, message) => this.emitEvent('log', { level, step_id: step.id, message });
    try {
      const r = await restackOnBase({ repo: wt.repo, dir: wt.workDir || wt.dir, base: this.ctx.inputs?.base_branch || wt.base, parentBranch: this.ctx.inputs?.parent_branch, fork: true, log });
      return `the parent PR/MR ${parent} merged: the engine rebased the branch onto ${r.base} (now at ${r.commit.slice(0, 8)}); ${then}`;
    } catch (e) {
      return `the parent PR/MR ${parent} merged, but the engine could not rebase the branch (${String(e?.message || e).split('\n')[0]}): rebase it onto the synced base yourself, then ${then}`;
    }
  },

  // #807 a stacked run (a roadmap item stacked on the stage before: inputs.parent_branch outside Fork + PR):
  // its PR targets the parent's branch, so it never waits for the parent's merge to open it
  stackedRun() {
    const inputs = this.ctx.inputs || {};
    return !!String(inputs.parent_branch ?? '').trim() && inputs.mode !== 'fork';
  },

  // #807 wait.parent of a stacked run, before its own probe: parent open (or unreadable) → the branch is
  // rebased onto the parent's new commits (st.restacked: the agent pushes it), undefined; a conflict →
  // a gate (continue by hand, or stop). Parent merged → rebased onto origin/<base> and the agent moves
  // its PR's base there (null). Parent closed without merge → a gate: rebase onto the base, or stop.
  async followStackParent(step, st, parent, stats) {
    const r = await this.probeOrError(step, stats, { probe: 'pr_checks', target: parent }, 'the parent PR/MR could not be read');
    const ended = ['merged', 'closed'].includes(r.state);
    if (ended) this.stackHold = null; // the run works (or asks) again: it waits for its own merge no more
    st.probePolls = (st.probePolls || 0) + 1;
    this.emitEvent('step.probe', {
      step_id: step.id, probe: 'parent', target: parent, state: r.state, detail: r.detail || r.state, action: ended ? (r.state === 'merged' ? 'agent' : 'gate') : 'follow', iteration: st.iteration, polls: st.probePolls,
    });
    const inputs = this.ctx.inputs || {};
    const base = inputs.base_branch || this.worktree?.base || 'main';
    const parentBranch = String(inputs.parent_branch).trim();
    const wt = this.worktree;
    const log = (level, message) => this.emitEvent('log', { level, step_id: step.id, message });
    const own = String(st.output?.pr_url || st.output?.pr_number || '').trim();
    const retarget = `move its PR/MR's base to ${base} (\`gh pr edit ${own || '<its PR>'} --base ${base}\`, \`glab mr update ${own || '<its MR>'} --target-branch ${base}\`) and push the branch (\`git push --force-with-lease origin HEAD\`)`;
    const onBase = async (why) => {
      st.parentMerged = true;
      stats.agent_calls++;
      let done = `rebase the branch onto origin/${base} yourself (only the commits after origin/${parentBranch})`;
      if (wt?.dir) {
        try {
          const moved = await restackOnBase({ repo: wt.repo, dir: wt.workDir || wt.dir, base, parentBranch, fork: false, log });
          done = `the engine rebased the branch onto ${moved.base} (now at ${moved.commit.slice(0, 8)})`;
        } catch (e) { done = `the engine could not rebase the branch (${String(e?.message || e).split('\n')[0]}): ${done}`; }
      }
      st.probeNews = { detail: `${why}: ${done}; ${retarget}`, polls: st.probePolls };
      return null;
    };
    if (r.state === 'merged') return onBase(`the parent PR/MR ${parent} merged into ${base}`);
    if (r.state === 'closed') {
      const { answer } = await this.requestApproval({
        id: `${step.id}:parent_closed`, raw: true,
        message: `The parent PR/MR ${parent} was closed without merging: this stacked run does not go on on its branch (${parentBranch}).\n\nRebase onto ${base} (its PR/MR then targets ${base}), or stop the run (its branch keeps the work).`,
        choices: [{ id: 'rebase_onto_base', label: `Rebase onto ${base}` }, { id: 'stop', label: 'Stop the run' }],
      });
      if (answer === 'rebase_onto_base') return onBase(`the parent PR/MR ${parent} was closed and you chose to rebase onto ${base}`);
      return this.stopStacked('the parent PR/MR was closed');
    }
    if (!wt?.dir) return undefined;
    try {
      const moved = await restackOnParent({ repo: wt.repo, dir: wt.workDir || wt.dir, parentBranch, log });
      if (moved.moved) st.restacked = `the parent branch ${parentBranch} got new commits: the engine rebased the branch onto ${moved.base} (now at ${moved.commit.slice(0, 8)}); push it (\`git push --force-with-lease origin HEAD\`)`;
    } catch (e) {
      this.stackHold = null;
      const why = String(e?.message || e).split('\n')[0];
      const { answer } = await this.requestApproval({
        id: `${step.id}:restack_conflict`, raw: true,
        message: `This stacked run could not rebase its branch onto the new commits of ${parentBranch} (${parent}): ${why}\n\nContinue to let the agent rebase it by hand, or stop the run (its branch keeps the work).`,
        choices: [{ id: 'continue', label: 'Continue (the agent rebases)' }, { id: 'stop', label: 'Stop the run' }],
      });
      if (answer !== 'continue') return this.stopStacked('its branch could not be rebased onto its parent');
      stats.agent_calls++;
      st.probeNews = { detail: `the engine could not rebase the branch onto origin/${parentBranch} (${why}): rebase it yourself, resolve the conflicts and push it`, polls: st.probePolls };
      return null;
    }
    return undefined;
  },

  // #807: a stacked run stopped at its gate: cancelled, its branch keeps the work (as costs.js contextGate)
  stopStacked(why) {
    this.emitEvent('log', { level: 'info', message: `stack: stopped (${why})` });
    this.stop?.();
    throw new Error('Cancelled');
  },

  // After an agent turn of a `wait:` step: the grace period for "no check yet" starts again, and
  // pr_changes records what the agent saw, so only a later change calls it again.
  async afterAgentTurn(step, st) {
    st.lastAgentAt = Date.now();
    st.probePolls = 0;
    st.probeBaseline = null;
    if (step.wait.probe !== 'pr_changes') return;
    const target = render(step.wait.target, { ...this.ctx, output: st.output }).trim();
    if (!target) return;
    try {
      const r = await this.probe({ probe: step.wait.probe, target, cwd: this.ctx.worktree_dir || undefined, signal: this.abort.signal, stepId: step.id, baseline: true });
      st.probeBaseline = r?.fingerprint ?? null;
    } catch { /* no baseline: the next check calls the agent */ }
  },

  // ---- merge checks and the recovery route of a failed action (#69) ------------------------------
  // `check:` / `precheck:` { probe, target }: one deterministic probe (no agent, no tokens). Its
  // result is `check` in the template context ({ state, detail, target, checked_at }); a probe that
  // cannot run is state `error`. failIfNot: anything but `passed` throws (with `check` on the error).
  async runCheck(c, step, kind, scope, { failIfNot = false } = {}) {
    const target = render(c.target, scope).trim();
    let r;
    try {
      if (!target) throw new Error(`${c.probe}: no target (${c.target} is empty)`);
      r = await this.probe({ probe: c.probe, target, cwd: this.ctx.worktree_dir || undefined, signal: this.abort.signal, stepId: `${step.id}:${kind}` });
    } catch (e) {
      r = { state: 'error', detail: e.message };
    }
    const check = { state: r.state, detail: r.detail || r.state, target, checked_at: new Date().toISOString() };
    this.ctx.check = check;
    this.emitEvent('step.probe', { step_id: step.id, probe: c.probe, target, state: check.state, detail: check.detail, action: kind });
    if (failIfNot && check.state !== 'passed') {
      throw Object.assign(new Error(`${target} cannot be merged right now (${check.state}): ${check.detail}. The merge was not attempted.`), { check });
    }
    return check;
  },

  // The merge queue's key: the PR/MR's repository, else the run's local repository.
  mergeKey(c, scope) {
    const t = c && parseTarget(render(c.target, scope).trim());
    if (t) return `${t.host}/${t.repo}`.toLowerCase();
    return this.worktree?.repo ? path.resolve(this.worktree.repo).toLowerCase() : 'default';
  },

  // A failed transition action / merge / check with an error route. `action_error` in the template
  // context: { step, message, at, check?, head?, supervisor?, diagnosis? }. With `recover:`, the
  // supervisor decides first (superviseActionError): back to one of those steps, with its record in
  // `action_error.supervisor`, or the failure route (`on_error` / `check.on_fail`, a gate) with its
  // diagnosis. Without a supervisor (or interventions left) the failure route is taken.
  async recoverFromActionError(step, route, e) {
    /** @type {{ step: string, message: string, at: string, check?: any, head?: string, supervisor?: object, diagnosis?: string }} */
    const err = { step: step.id, message: e.message, at: new Date().toISOString(), ...(e.check ? { check: e.check } : {}) };
    // the branch head the failure left (a failed local merge leaves the branch as it was): the last
    // checked commit, so the next review can cover only what the resolution changes
    if (this.worktree) {
      const head = await this.machine.git(['rev-parse', 'HEAD'], this.worktree.dir).catch(() => null);
      if (head) err.head = head;
    }
    this.ctx.action_error = err;
    let target = route.on_error;
    const d = route.recover?.length ? await this.superviseActionError(step, route, e) : null;
    if (d?.action === 'goto') {
      target = d.goto;
      err.supervisor = { goto: d.goto, explanation: d.explanation, instruction: d.instruction || '', record: d.record };
    } else if (d) {
      err.diagnosis = d.explanation;
    }
    this.emitEvent('log', { level: 'warn', message: `${step.id}: ${e.message} → ${target}` });
    this.emitEvent('step.transition', { from: step.id, to: target, when: d?.action === 'goto' ? 'supervisor: goto' : 'on_error' });
    return target;
  },

  applyCounters(step, t) {
    let target = t.goto;
    // limits can be templates over the inputs (max_iterations: "{{ inputs.max_rounds }}")
    const limit = (v) => +render(String(v), this.ctx);
    if (t.max_visits) {
      const key = `${step.id}->${t.goto}`;
      this.counters[key] = (this.counters[key] || 0) + 1;
      if (this.counters[key] > limit(t.max_visits)) {
        target = t.on_exhausted || 'fail';
        this.emitEvent('log', { level: 'warn', message: `max_visits (${t.max_visits}) reached at ${key} → ${target}` });
        this.noteExhausted(step, target, `max_visits (${t.max_visits}) reached at ${key}`, () => { this.counters[key]--; });
      }
    }
    if (t.loop) {
      const name = t.loop.name || `${step.id}->${t.goto}`;
      this.loops[name] = (this.loops[name] || 0) + 1;
      if (this.loops[name] > limit(t.loop.max_iterations)) {
        target = t.loop.on_exhausted || 'fail';
        this.emitEvent('log', { level: 'warn', message: `loop "${name}" reached ${t.loop.max_iterations} iterations → ${target}` });
        this.noteExhausted(step, target, `loop "${name}" reached ${t.loop.max_iterations} iterations`, () => { this.loops[name]--; });
      } else {
        this.ctx.loop = { name, iteration: this.loops[name] };
      }
    }
    return target;
  },

  // A transition goes to an on_exhausted target: the supervisor on call is asked before the run goes
  // there (superviseExhausted, or superviseEscalation at a gate). refund(): one more round, when it
  // sends the run back to the agents.
  noteExhausted(step, target, detail, refund) {
    this.exhausted = { from: step.id, target, detail, refund };
    this.recordStall(step.id, { kind: 'loop_exhausted', detail: `${detail} → ${target}` }, { quiet: true });
  },

  // probed: the iteration was the engine's own check (`wait:`), not an agent turn, so it cannot be "blocked"
  async loopWait(step, output, { probed = false } = {}) {
    const st = this.ctx.steps[step.id];
    const cfg = loopConfig(step);
    const exhausted = step.goal?.on_exhausted || cfg.on_exhausted || 'fail';
    // the supervisor sent the run back to the /loop: a fresh start (duration, blocked check)
    const refund = () => { st.loopStartedAt = Date.now(); st.blocked = null; };
    const maxDur = parseDuration(cfg.max_duration, null);
    if (maxDur && Date.now() - st.loopStartedAt > maxDur) {
      this.emitEvent('log', { level: 'warn', message: `/loop of ${step.id} exceeded ${cfg.max_duration} without meeting the /goal → ${exhausted}` });
      this.noteExhausted(step, exhausted, `/loop exceeded ${cfg.max_duration} without meeting the /goal`, refund);
      return exhausted;
    }
    const stop = probed ? null : this.checkBlocked(step, st, output);
    if (stop) {
      this.emitEvent('log', { level: 'warn', kind: 'loop_blocked', step_id: step.id, message: `/loop of ${step.id} stopped: ${stop} → ${exhausted}` });
      this.recordStall(step.id, { kind: 'loop_blocked', detail: stop }, { quiet: true });
      this.noteExhausted(step, exhausted, `/loop stopped: ${stop}`, refund);
      this.logDecisions('orchestrator', step.id, [[
        'loop', `stopped the /loop of ${step.id} → ${exhausted}`,
        `${stop}; polling again (every ${cfg.interval || '1m'}, up to ${cfg.max_duration || 'no limit'}) could not change anything`,
        `refused: ${st.blocked.denied.slice(-3).join(' · ') || '(no tool call)'}; answer: ${JSON.stringify(output).slice(0, 200)}`,
        exhausted,
      ]]);
      return exhausted;
    }
    // simulation: at most 3s, scaled like the mock's delays (tests run with a small scale)
    const interval = Math.min(parseDuration(cfg.interval, 60000), this.machine.simulated ? 3000 * +(process.env.MULTIAGENT_MOCK_DELAY_SCALE ?? 1) : Infinity);
    this.emitEvent('step.waiting', { step_id: step.id, until: new Date(Date.now() + interval).toISOString(), interval_ms: interval });
    this.setStatus(this.orchestrator, 'waiting');
    await sleep(interval, this.abort.signal);
    this.setStatus(this.orchestrator, 'active');
    return step.id;
  },

  // Counts blocked /loop iterations in a row (see DEFAULT_MAX_BLOCKED); returns why the loop
  // must stop once `loop.max_blocked` is reached, else null.
  checkBlocked(step, st, output) {
    const max = +render(String(maxBlocked(step)), this.ctx);
    const tools = st.tools || { ran: 0, denials: 0, denied: [] };
    const key = decisionKey(output, step.output_schema);
    const prev = st.blocked;
    const blind = tools.ran === 0; // everything refused, or no tool call at all
    const repeated = tools.denials > 0 && (!prev || prev.key === key);
    if (!blind && !repeated) { st.blocked = null; return null; }
    st.blocked = { count: (prev?.count || 0) + 1, key, denied: [...(prev?.denied || []), ...tools.denied].slice(-10) };
    for (const rec of st.turnRecs || []) rec.waste ??= 'blocked'; // tokens spent on an iteration that could not progress
    if (!max || st.blocked.count < max) return null;
    const why = blind && !tools.denials ? 'made no tool call' : blind ? 'had every tool call refused' : 'had tool calls refused and gave the same answer';
    return `${st.blocked.count} iterations in a row blocked (the agent ${why}, ${tools.denials} refused in the last one)`;
  },

  // What a `ship:` transition needs before it does anything, its `merge: local` included (#260). Only
  // the owner's own answer ships: a gate answered by anything else (the supervisor, a timeout,
  // --auto-approve) ends the run as failed (`fatal`: no `on_error` gate to try it again). And the
  // local base must still be what the suites ran on: when it moved (another run merged meanwhile), the
  // release would hold commits nobody checked, so the transition fails (to its `on_error`).
  // A simulated run (its machine adapter) has no guard: nothing ships.
  shipGuard(step) {
    this.machine.guardShip(() => {
      const by = this.ctx.steps[step.id]?.answeredBy;
      if (by !== 'user') throw Object.assign(new Error(`ship: only the owner's own answer at the gate ships a release (${step.id} was answered by ${by || 'nobody'}); nothing was merged or pushed.`), { fatal: true });
      const wt = this.worktree;
      if (!wt) throw new Error('ship needs the run\'s git worktree (orchestrator.worktree on a git repository).');
      try {
        execFileSync('git', ['merge-base', '--is-ancestor', `refs/heads/${wt.base}`, 'HEAD'], { cwd: wt.workDir || wt.dir, windowsHide: true, timeout: 10000, stdio: 'ignore' });
      } catch {
        throw new Error(`ship: the local ${wt.base} has commits this run did not check (it moved since the suites ran). Stop this run and check the release again; nothing was merged or pushed.`);
      }
    });
  },

  // The `ship: { tag, build? }` transition (#260, the release workflow's Ship), after `shipGuard` and
  // the transition's merge: pushes the local base to origin, never forced, and tags that commit
  // (shipRelease in packages/engine/domains/releases/releases.js), which must be the worktree's (what the suites ran on). A
  // simulation pushes nothing. A failure (origin moved, the tag exists elsewhere) goes to the
  // transition's `on_error`, like a failed merge.
  async shipRelease(step, ship, scope) {
    const tag = render(String(ship.tag), scope).trim();
    const wt = this.worktree;
    const r = await this.machine.ship({ repo: wt?.repo, base: wt?.base, tag, expect: this.worktreeHead() });
    if (r.skipped) {
      this.emitEvent('action.executed', { command: `ship: ${tag}`, skipped: true, output: r.output });
      this.ctx.release = { tag, simulated: true };
      return;
    }
    this.emitEvent('release.shipped', { tag: r.tag, base: r.base, commit: r.commit, pushed: r.pushed, commits: r.commits.length, issues: r.issues });
    this.ctx.release = { tag: r.tag, base: r.base, commit: r.commit, pushed: r.pushed, issues: r.issues };
    // `build:` an optional command run once the release is out (a template; empty: none)
    const build = ship.build ? render(String(ship.build), scope).trim() : '';
    if (build) await this.runAction(build);
  },

  // The `merge: local` transition (local workflows): fast-forwards the local base to the run's
  // branch, rebasing it first when the base moved; see mergeLocally in packages/engine/engine/worktree.js.
  // A failure (conflict, uncommitted changes where the base is checked out) fails the run with
  // the reason; its branch keeps the work, so the run can be resumed after fixing it.
  async mergeWorktreeLocally() {
    const wt = this.worktree;
    const log = (level, message) => this.emitEvent('log', { level, message });
    // base_commit (#289): the base's tip before the merge, so run:diff can list the run's commits once
    // its branch is deleted, even after a rebase (ready.commit is then below the base's own commits)
    const { base_commit: baseCommit, ...r } = await this.machine.mergeLocal({ repo: wt?.repo, dir: wt?.dir, base: wt?.base, log });
    if (r.skipped) {
      this.emitEvent('action.executed', { command: 'merge: local', skipped: true, output: r.output });
      return;
    }
    // tested: 'not green' when the run merges a change its suite did not pass (#396): the base check runs at once (#405)
    this.emitEvent('worktree.merged', { branch: r.branch, base: r.base, commit: r.commit, checkout: r.checkout, rebased: r.rebased, base_commit: baseCommit, tested: this.ctx.vars?.tested || null });
    this.ctx.local_merge = r;
  },

  async runAction(cmd) {
    // in the run's worktree when there is one (the feature branch is checked out there)
    const cwd = [this.ctx.worktree_dir, this.inputs.repo_path].find((d) => d && fs.existsSync(d)) || process.cwd();
    const r = await this.withLiveCommand(cmd, () => this.machine.runAction(cmd, { cwd, passthrough: this.envPassthrough() }));
    if (r.skipped) {
      this.emitEvent('action.executed', { command: cmd, skipped: true, output: r.output });
      return;
    }
    this.emitEvent('action.executed', { command: cmd, exit_code: r.exit_code, output: r.output });
    if (r.exit_code) throw new Error(`Action failed (exit ${r.exit_code}): ${cmd}
${r.stderr || r.stdout}`.slice(0, 1500));
  },
};
// #811: the fix rounds from the PR monitor live in pr-fix.js (after the literal: `this` stays the run's in each)
Object.assign(methods, prFixMethods);

// #809: how often the PR monitor reads its PR/MR: about once a minute, every 5 minutes once nothing
// changed for a day (a PR waiting for days is not read 1440 times a day)
function prMonitorIntervalMs(sinceChangeMs) {
  return sinceChangeMs > 24 * 36e5 ? 5 * 60e3 : 60e3;
}

// #809: a read's fingerprint (pollPrMonitor): a change of it is a change of the card
// (#811: with the head commit and the requests, what the card's "Ask for a fix" lists)
const monitorSeen = (r) => JSON.stringify([r.state, r.ci, r.review, r.conflicts, r.comments, r.result, r.head || null, (r.requests || []).map((q) => [q.id, q.trusted])]);

// #809: what a run recovered in its PR monitor (resume.js seedRecovery) knows before its first read, from
// its log's `pr.monitor` events: it waits in the monitor (no run slot, areas/runs.js slotProblem), its last
// card, and when the card last changed (the slower pace after a day survives a restart)
function prMonitorSeed(events, stepId) {
  /** @type {{ prMonitor: string, prMonitorCard: object | null, prMonitorSeen: string | undefined, prMonitorChangedAt: number | undefined, prFixRounds: number }} */
  const seed = { prMonitor: stepId, prMonitorCard: null, prMonitorSeen: undefined, prMonitorChangedAt: undefined, prFixRounds: 0 };
  for (const ev of events || []) {
    // #811: the fix rounds taken count towards the limit after a restart
    if (ev.type === 'pr.fix' && ev.step_id === stepId) seed.prFixRounds = Math.max(seed.prFixRounds, Number(ev.round) || 0);
    if (ev.type !== 'pr.monitor' || ev.step_id !== stepId || ev.error) continue;
    const seen = monitorSeen(ev);
    if (seen !== seed.prMonitorSeen) seed.prMonitorChangedAt = Date.parse(ev.ts) || undefined;
    seed.prMonitorSeen = seen;
    const { state, detail, checked_at: checkedAt, ci, review, conflicts, comments, result, merge_options: mergeOptions, head, requests } = ev;
    seed.prMonitorCard = { state, detail, checked_at: checkedAt, ci, review, conflicts, comments, result, ...(mergeOptions ? { merge_options: mergeOptions } : {}), ...(head ? { head } : {}), ...(requests ? { requests } : {}) };
  }
  return seed;
}

module.exports = {
  goalLoopInstructions,
  methods,
  prMonitorIntervalMs,
  prMonitorSeed,
};
