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
const { evalExpr, render } = require('./templates');
const { isLooping, loopConfig, parseDuration } = require('./load');
const { decisionKey, validateSchema } = require('./outputs');

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
      for (const [k, v] of Object.entries(t.set || {})) this.ctx.vars[k] = typeof v === 'string' ? render(v, scope).trim() : v;
      // limits first: once max_visits / loop.max_iterations is reached the flow goes to
      // on_exhausted and the delegation is skipped (nothing would check that fix any more)
      let target = this.applyCounters(step, t);
      let delegated = null;
      if (t.delegate && target === t.goto) {
        this.emitEvent('log', { level: 'info', message: `${step.id} delegated to ${t.delegate.agent}` });
        const res = await this.sendToAgent(t.delegate.agent, render(t.delegate.prompt, scope), { stepId: `${step.id}:delegate`, attachments: this.stepAttachments(t.delegate.prompt) })
          .finally(() => this.stopWorktreeProcesses(`${step.id} delegation to ${t.delegate.agent}`));
        delegated = { agent: t.delegate.agent, text: res.text };
      }
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
      this.emitEvent('step.transition', { from: step.id, to: target, when: t.when, ...(ends ? { status: t.status } : {}) });
      return target;
    }
    throw new Error(`No transition matched in step "${step.id}".`);
  },

  // ---- `wait:` deterministic checks between the agent's turns of a /loop (packages/engine/engine/probes.js) ----
  // Returns the next step (poll again, /loop limit, or the step finished by the check), or null to
  // run the agent turn: after a delegation or a supervisor note, and whenever the check has news
  // (a failure, a conflict, a change on the PR/MR, an unknown state or a check that could not run).
  async pollStep(step, st, t0) {
    const w = step.wait;
    if (st.delegate_result || st.supervisorNote || !st.output || st.output.error) return null;
    const target = render(w.target, { ...this.ctx, output: st.output }).trim();
    const stats = (this.probeStats[step.id] ??= { polls: 0, agent_calls: 0, completed: 0, errors: 0 });
    let r;
    try {
      if (!target) throw new Error(`${w.probe}: no target yet (${w.target} is empty)`);
      r = await this.probe({ probe: w.probe, target, cwd: this.ctx.worktree_dir || undefined, signal: this.abort.signal, stepId: step.id, quota: this.actionsQuota });
    } catch (e) {
      if (this.abort.signal.aborted) throw new Error('Cancelled');
      r = { state: 'error', detail: `the check could not run (${e.message})` };
      stats.errors++;
    }
    let state = r.state;
    // pr_changes: news = the PR/MR differs from what the agent saw at the end of its last turn
    if (w.probe === 'pr_changes' && r.fingerprint !== undefined && !['merged', 'closed', 'error'].includes(state)) {
      state = st.probeBaseline && r.fingerprint === st.probeBaseline ? 'unchanged' : 'changed';
      if (state === 'changed') r.detail = st.probeBaseline ? `the PR/MR changed since your last turn (${r.detail})` : `the PR/MR could not be compared with your last turn (${r.detail})`;
    }
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
    else if (state === 'none') action = Date.now() - (st.lastAgentAt || 0) < parseDuration(w.grace ?? DEFAULT_WAIT_GRACE, 600000) ? 'poll' : 'agent';
    else if (state === 'passed' && w.output) output = finishWith('output');
    // CI cannot run at all (the Actions quota ran out): no agent turn or fix round helps
    else if (state === 'quota_exhausted' && w.infra_output) output = finishWith('infra_output');
    if (output) action = 'output';
    if (state === 'none' && action === 'agent') r.detail = `${r.detail}, ${w.grace ?? DEFAULT_WAIT_GRACE} after your last turn`;
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

module.exports = {
  goalLoopInstructions,
  methods,
};
