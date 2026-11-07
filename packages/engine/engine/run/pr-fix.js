// @ts-check
// Fix rounds from the PR monitor (#811, split from transitions.js): "Ask for a fix" on the card queues a round
// (`prFixFromApp`, past MAX_FIX_ROUNDS a gate asks the owner first), the monitor's next poll sends it to the
// developer through the pr_monitor step's delegate transition and comes back (`runPrFix`, the worktree
// recreated when it was removed), and the read after it says fixed (the PR's head moved) or failed (a gate
// with the developer's report, `prFixOutcome`). transitions.js spreads `prFixMethods` into its methods.

'use strict';

const fs = require('fs');

// #811: the fix rounds a run takes from its pull request before each next one asks the owner
// (domains/run/run-pr.js re-exports it for the card's request text)
const MAX_FIX_ROUNDS = 5;

// #811: a turn's tokens (its usage: input + output), 0 when unknown
const tokensOf = (usage) => (Number(usage?.input_tokens) || 0) + (Number(usage?.output_tokens) || 0);

const prFixMethods = {
  // #811: "Ask for a fix" from the card (service/areas/runs.js askRunPrFix, which builds `prompt` with run-pr.js
  // buildFixRequest from the trusted requests the owner picked): only while the monitor waits and no fix runs.
  // Emits `pr.fix` { status: 'requested', round, ids, note, requests, by } and wakes the monitor, whose next poll
  // runs it (runPrFix). Past MAX_FIX_ROUNDS each round asks the owner first (a gate; not allowed: no turn).
  // → { queued, round?, limit?, error? }
  prFixFromApp({ prompt = '', ids = [], note = '', by = null, requests = [] } = {}) {
    const target = this.prMonitorTarget();
    if (!target) return { queued: false, error: 'the run is not waiting in its PR monitor' };
    if (this.prFix || this.prFixAsking) return { queued: false, error: 'a fix is already running' };
    if (!String(prompt).trim()) return { queued: false, error: 'nothing to send' };
    const round = (this.prFixRounds || 0) + 1;
    const ask = { prompt: String(prompt), ids: Array.isArray(ids) ? ids.map(String) : [], note: String(note || ''), by, requests: Array.isArray(requests) ? requests : [] };
    if (round <= MAX_FIX_ROUNDS) return this.queuePrFix(target, round, ask);
    this.prFixAsking = true;
    const done = (/** @type {any} */ a) => {
      this.prFixAsking = false;
      const now = this.prMonitorTarget();
      if (a?.answer === 'allow' && now) this.queuePrFix(now, round, ask);
      else this.emitEvent('log', { level: 'info', step_id: target.stepId, message: `Fix round ${round} was not sent: the run took ${MAX_FIX_ROUNDS} fix rounds and the owner did not allow another.` });
    };
    Promise.resolve(this.requestApproval({
      id: `${target.stepId}:fix_limit`, raw: true,
      message: `This run already took ${MAX_FIX_ROUNDS} fix rounds from its pull request (the limit is ${MAX_FIX_ROUNDS}).\n\nSend fix round ${round} to the developer anyway, or keep waiting for the merge without more fixes?`,
      choices: [{ id: 'allow', label: `Send fix round ${round}` }, { id: 'stop', label: 'No more fixes' }],
    })).then(done, () => { this.prFixAsking = false; });
    return { queued: false, limit: true, round, error: `the limit of ${MAX_FIX_ROUNDS} fix rounds is reached: the run asks you first` };
  },

  // #811: a fix round the next poll runs (prFixFromApp)
  queuePrFix(target, round, { prompt, ids, note, by, requests }) {
    this.prFixRounds = round;
    // what was sent, for the card's round line and the replies (the comments' text stays on the card)
    const sent = requests.map(({ id, kind, author, file, line, url, thread }) => ({ id, kind, author, file, line, url, ...(thread ? { thread } : {}) }));
    this.prFix = { round, prompt, ids, note, by, requests: sent, head: target.card?.head || null, phase: 'requested' };
    this.emitEvent('pr.fix', { step_id: target.stepId, url: target.url, round, status: 'requested', ids, note, requests: sent, by });
    if (this.prMonitorWake) this.prMonitorWake.abort();
    else this.prMonitorWakeAsked = true;
    return { queued: true, round };
  },

  // #811: the developer works on the fix: the pr_monitor transition that delegates to it and comes back
  // (`when: output.fix`, fragments/pr-pipeline.yaml), in the run's worktree (recreated on its branch when it was
  // removed while the run waited). No merge, close or other fix meanwhile (prMonitor is unset: a run slot too).
  // The next read compares the PR's head (prFixOutcome). → the step to go to: 'pr_monitor' (never 'end')
  async runPrFix(step, st, target, t0) {
    const fix = this.prFix;
    fix.phase = 'sent';
    fix.head = this.prMonitorCard?.head ?? fix.head ?? null;
    this.prMonitor = null;
    this.lastDelegation = null;
    try {
      const wt = this.worktree;
      if (wt?.dir && !fs.existsSync(wt.dir)) {
        this.emitEvent('log', { level: 'info', step_id: step.id, message: `worktree: ${wt.dir} was removed while the run waited: recreating it on its branch for fix round ${fix.round}` });
        await this.setupWorktree({ again: { dir: wt.dir, branch: wt.ref || wt.branch || this.ctx.steps?.develop?.output?.branch || null } });
      }
      const output = { state: this.prMonitorCard?.state || 'open', url: target, fix: true, fix_round: fix.round, fix_prompt: fix.prompt };
      st.output = output;
      const next = await this.finishStep(step, st, output, { ...this.ctx, output }, t0);
      if (!this.lastDelegation) throw new Error(`the ${step.id} step has no transition that sends a fix to the developer`);
      fix.report = String(this.lastDelegation.text || '');
      fix.tokens = tokensOf(this.lastDelegation.usage);
      return next && next !== 'end' ? next : step.id;
    } catch (e) {
      if (this.abort.signal.aborted) throw e;
      fix.report = `the fix could not run: ${String(e?.message || e).split('\n')[0]}`;
      return step.id;
    } finally {
      this.prMonitor = step.id;
    }
  },

  // #811: the first read after a fix: the PR's head moved → fixed (its commit, the tokens); else failed, and a gate
  // says why (the developer's report). A simulated run pushes nothing: its fix is fixed when the turn answered.
  async prFixOutcome(step, r, base) {
    const fix = this.prFix;
    this.prFix = null;
    const moved = !!r.head && r.head !== fix.head;
    const ev = { step_id: step.id, url: base.url, round: fix.round, ids: fix.ids, note: fix.note, requests: fix.requests, ...(fix.tokens ? { tokens: fix.tokens } : {}) };
    if (moved || (this.machine.simulated && !/^the fix could not run/.test(fix.report || ''))) {
      this.emitEvent('pr.fix', { ...ev, status: 'fixed', commit: r.head || null });
      return;
    }
    const reason = `no new commit on the pull request${fix.report ? `: ${fix.report}` : ''}`;
    this.emitEvent('pr.fix', { ...ev, status: 'failed', reason });
    this.setStatus(this.orchestrator, 'active');
    await this.requestApproval({
      id: `${step.id}:fix_failed`, raw: true,
      message: `Fix round ${fix.round} did not push a new commit to ${base.url}.\n\nThe developer said: ${fix.report || '(nothing)'}\n\nThe run goes back to waiting for the merge; ask for another fix from the card, or fix it by hand.`,
      choices: [{ id: 'monitor', label: 'Back to the PR monitor' }],
    });
  },
};

module.exports = {
  MAX_FIX_ROUNDS,
  prFixMethods,
};
