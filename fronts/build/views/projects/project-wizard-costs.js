/* global api, esc, loadUsageThrottled, t */
// #74: what the import's analyses cost, split out of project-wizard.js (its size cap). window.ProjectWizardCosts({
// column, cur, jobOf, jobs, paid, money, renderSoon, retryButton }) gives the wizard, over its own state (`cur()`: the onboarding,
// estimate and profileEstimate):
// - costBlock(started): step 3's wizard-cost: one row per job from the clone on (its status, what it reads, its
//   wizard-amount; data-part on the analyses that may cost: profile, projectMap), then wizard-cost-total with
//   wizard-skip before the click (hidden once Analyze was asked during the clone, the engine's `wanted`);
// - an amount: before it ran its estimate ("Not known yet" without one), "free" only when no model is called (the
//   engine's estimate says so, or the job ended simulated); once done its record's cost (jobs.<id>.costUsd); "—" failed;
// - estimateText(): the two analyses' estimate beside Analyze the repository ('' when not read yet or free);
// - readEstimates(): api.seedEstimate (the profile's) and api.architectureEstimate (the project map's, from the other
//   projects when this one has none), read at step 3 and again once the clone is there (git says then whether the
//   profile needs a model);
// - reviewCosts(): wizard-review-costs, what each analysis that ran cost (data-part, wizard-amount) and
//   wizard-review-cost-total, from the onboarding's records; '' when skipped and for a new project;
// - onState(before, state): the header's cost is read again when one of the analyses ended.
// Uses app.js globals (api, esc, t), window.OnboardingModel and usage-widget.js's loadUsageThrottled.

(function () {
  // the analyses that may call a model
  const COSTED = ['profile', 'projectMap'];
  const ENDED = ['done', 'failed'];

  window.ProjectWizardCosts = function ({ column, cur, jobOf, jobs, money, paid, renderSoon, retryButton }) {
    const M = window.OnboardingModel;
    const costText = (n) => (n == null ? t('onboarding.cost_not_known') : money(n));
    const isNew = () => cur().model.source === 'new';
    // #850 (#21: facts too): a new project's jobs left for later
    const later = (id) => ['facts', ...paid].includes(id) && isNew() && !!cur().model.analyzeLater;
    const loading = () => cur().estimate === undefined || (!isNew() && cur().profileEstimate === undefined);

    // whether a job calls no model
    function isFree(id) {
      const job = jobOf(id);
      if (!COSTED.includes(id) || (id === 'profile' && isNew())) return true;
      if (job.status === 'done') return job.simulated === true || job.costUsd === 0;
      return id === 'profile' && cur().profileEstimate?.free === true;
    }
    const estimateOf = (id) => (id === 'profile' ? cur().profileEstimate?.usd ?? null : cur().estimate);
    const costOf = (id) => (Number.isFinite(jobOf(id).costUsd) ? jobOf(id).costUsd : null);
    const spentOrEstimate = (id) => (jobOf(id).status === 'done' ? costOf(id) ?? estimateOf(id) : estimateOf(id));
    const parts = () => COSTED.filter((id) => !isFree(id));
    const summary = () => M.costSummary(parts().map((id) => ({ id, estimate: spentOrEstimate(id), checked: true })));

    // #725: a failed job has no amount ("—"), nor a done one whose cost is not known (#850: or left for later)
    function amount(id) {
      const { status } = jobOf(id);
      if (status === 'failed' || later(id)) return '—';
      if (isFree(id)) return t('onboarding.cost_free');
      const n = spentOrEstimate(id);
      if (status === 'done') return Number.isFinite(n) ? money(n) : '—';
      return loading() ? t('onboarding.estimating') : costText(n);
    }

    function row(id) {
      const job = jobOf(id);
      const s = job.status || 'waiting';
      // #630 (mock-4): the profile row says the ways of working it found (#726: keys, in the interface's language)
      const found = id === 'profile' && column.textOf(M.profileLine(column.profileOf()));
      const line = id === 'clone' ? cur().model.repository : found ? t(column.profileSourceKey(), { profile: found }) : t(`onboarding.job_${id}_${later(id) ? 'later_new' : 'text'}`);
      const testid = id === 'profile' ? ' data-testid="wizard-profile"' : later(id) ? ` data-testid="wizard-job-later-${id}"` : '';
      // mock-4's pick of a paid analysis (shown checked, disabled; #850 unchecked when left for later)
      const pick = paid.includes(id) ? `<input type="checkbox"${later(id) ? '' : ' checked'} disabled aria-label="${esc(t(`onboarding.job_${id}`))}">` : '';
      // #725: a failed job says why under its title (the full error on hover), with its Retry
      const failed = s === 'failed' && id !== 'clone'
        ? `<span class="small wizard-job-error" data-testid="wizard-job-error-${id}" title="${esc(job.error || job.reason || '')}">${esc(column.jobReason(job))}</span>` : '';
      return `<li class="wizard-job"${COSTED.includes(id) ? ` data-part="${id}"` : ''}>
          <span class="${s === 'running' ? 'spinner wizard-job-spinner' : 'wizard-dot'} job-${esc(s)}" role="img" aria-label="${esc(t(`onboarding.job_status_${s}`))}" title="${esc(t(`onboarding.job_status_${s}`))}"></span>
          <span class="wizard-job-text"><strong class="wizard-job-title">${pick}${esc(t(`onboarding.job_${id}`))}</strong><span class="muted small text-cut"${testid} title="${esc(line)}">${esc(line)}</span>${failed}</span>
          <span class="wizard-amount muted">${esc(amount(id))}</span>${failed ? retryButton(id) : ''}
        </li>`;
    }

    // the total's text: free only when no analysis calls a model
    function totalText() {
      if (paid.every(later) || !parts().length) return t('onboarding.cost_free');
      return loading() ? t('onboarding.estimating') : costText(summary().total);
    }

    // under the total: no estimate at all, or a total that leaves an analysis out
    function unknownNote() {
      if (loading() || paid.every(later)) return '';
      const { total, unknown } = summary();
      const left = unknown.filter((id) => !ENDED.includes(jobOf(id).status));
      if (!left.length) return '';
      return `<span class="muted small" data-testid="wizard-cost-unknown">${esc(t(total == null ? 'onboarding.cost_unknown' : 'onboarding.cost_partial'))}</span>`;
    }

    function costBlock(started) {
      const skip = started || paid.every(later) || cur().onboarding?.wanted ? '' : `<button type="button" class="btn sm" data-act="skip" data-testid="wizard-skip">${esc(t('onboarding.skip'))}</button>`;
      return `<div class="wizard-cost" data-testid="wizard-cost">
        <ul class="wizard-jobs">${(isNew() ? jobs : ['clone', ...jobs]).map(row).join('')}</ul>
        <div class="card wizard-cost-total-row"><span>${esc(t('onboarding.cost_real_models'))}</span>
          <strong class="wizard-amount" data-testid="wizard-cost-total">${esc(totalText())}</strong>${skip}</div>
        ${unknownNote()}
      </div>`;
    }

    const estimateText = () => (isNew() || loading() || !parts().length ? '' : t('onboarding.workflows_choice_cost', { cost: totalText() }));

    // each estimate on its own, a failed read is not known; one provisional until the clone is there
    function readEstimates() {
      const c = cur();
      const pid = c?.projectId;
      const cloned = !['cloning', 'failed'].includes(c?.onboarding?.status);
      if (!pid || c.estimatedAt === (cloned ? 'cloned' : 'cloning') || c.estimatedAt === 'cloned') return;
      c.estimatedAt = cloned ? 'cloned' : 'cloning';
      const at = c.estimatedAt;
      const read = (call, apply) => {
        const answer = (r) => {
          if (cur() !== c || c.projectId !== pid || c.estimatedAt !== at) return;
          apply(r);
          renderSoon();
        };
        Promise.resolve().then(call).then(answer, () => answer(null));
      };
      read(() => api.architectureEstimate?.(pid, { others: true }), (r) => { c.estimate = Number.isFinite(r?.estimate?.usd) ? r.estimate.usd : null; });
      if (isNew()) return; // its profile is its own answers
      read(() => api.seedEstimate?.({ projectId: pid, seedId: 'ways-of-working' }), (r) => {
        c.profileEstimate = { free: r?.free === true, usd: Number.isFinite(r?.costUsd) ? r.costUsd : null };
      });
    }

    // an analysis' cost on the review: its record's, "not reported" for one that may have spent without saying
    // how much (failed, or the CLI gave no cost), its status while it runs
    function reviewAmount(id) {
      const { status } = jobOf(id);
      if (!ENDED.includes(status)) return t(`onboarding.job_status_${status || 'waiting'}`);
      if (status === 'done' && isFree(id)) return t('onboarding.cost_free');
      return costOf(id) == null ? t('onboarding.review_cost_unknown') : money(costOf(id));
    }

    function reviewCosts() {
      if (isNew() || !['analyzing', 'analyzed'].includes(cur().onboarding?.status)) return '';
      const charged = parts();
      const { total, unknown } = M.costSummary(charged.map((id) => ({ id, estimate: costOf(id), checked: true })));
      const running = COSTED.some((id) => !ENDED.includes(jobOf(id).status));
      const sum = !charged.length ? t('onboarding.cost_free') : total == null ? (running ? '—' : t('onboarding.review_cost_unknown')) : money(total);
      const partial = !running && total != null && unknown.length ? `<p class="muted small">${esc(t('onboarding.review_cost_partial'))}</p>` : '';
      const line = (id) => `<li class="wizard-review-cost" data-part="${id}"><span class="text-cut">${esc(t(`onboarding.job_${id}`))}</span><span class="wizard-amount muted">${esc(reviewAmount(id))}</span></li>`;
      return `<section class="card wizard-review-section" data-testid="wizard-review-costs">
          <h3>${esc(t('onboarding.review_cost_title'))}</h3>
          <ul class="wizard-review-list">${COSTED.map(line).join('')}
            <li class="wizard-review-cost wizard-review-cost-total"><strong>${esc(t(running ? 'onboarding.review_cost_so_far' : 'onboarding.review_cost_total'))}</strong><strong class="wizard-amount" data-testid="wizard-review-cost-total">${esc(sum)}</strong></li></ul>
          ${partial}
        </section>`;
    }

    function onState(before, state) {
      const ended = (id) => ENDED.includes(state.jobs?.[id]?.status) && before?.jobs?.[id] && !ENDED.includes(before.jobs[id].status);
      if (COSTED.some(ended)) loadUsageThrottled();
    }

    return {
      costBlock,
      estimateText,
      onState,
      readEstimates,
      reviewCosts,
    };
  };
}());
