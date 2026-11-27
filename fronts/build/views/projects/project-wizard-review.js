/* global api, errMsg, esc, showToast, state, t */
// The new-project wizard's last step, the review (#642, #669, mock-6), split out of project-wizard.js (its size cap).
// window.ProjectWizardReview({ active, activity, column, costs, cur, jobOf, jobReason, kindField, platformOfRepo,
// profileOf, pushNotice, render, renderSoon, retryButton, spinner }) gives the wizard, over its own state (`cur()`):
// - reviewStep(): wizard-review: the title row (the project's name, where it comes from), then two columns: the
//   project (wizard-review-project: its code, its kind as tiles, its workflows) and what the analyses found
//   (wizard-review-city with wizard-open-city, wizard-review-findings, wizard-review-backlog, the costs), then the
//   idea for the Inbox on one line (wizard-review-idea);
// - sectionState(job, read): ready, failed / skipped, later or pending;
// - createIssue(index, prioritize): #730 files the finding's issue, its row then shows the issue's link.
// Uses app.js globals (api, errMsg, esc, showToast, state, t), window.OnboardingModel and window.ArchitectureFactsView.

(function () {
  window.ProjectWizardReview = function ({ active, activity, column, costs, cur, jobOf, jobReason, kindField, platformOfRepo, profileOf, pushNotice, render, renderSoon, retryButton, spinner }) {
    const M = window.OnboardingModel;

    // a section's state: ready (its analysis and read done), failed / skipped (its analysis answered without
    // a result), later (the analyses were skipped in the wizard) or pending (still running or reading)
    function sectionState(job, read) {
      if (!job) return read ? 'ready' : 'pending';
      const s = jobOf(job).status;
      if (s === 'done') return read ? 'ready' : 'pending';
      if (s === 'failed' || s === 'skipped') return s;
      return cur().model.analyzeLater && !active.includes(cur().onboarding?.status) ? 'later' : 'pending';
    }

    // a card of the review: its head (title, then #852 the running indicator beside its action), then its body once ready; #781: `pending`:
    // a key, or its markup's function; `failure`: the markup of a read that failed, for a card with no job to say so
    function reviewSection(id, title, job, read, body, pending, action = '', failure = '') {
      const state = failure ? 'failed' : sectionState(job, read);
      const own = state === 'pending' && typeof pending === 'function';
      const words = {
        // #725: the failed job's reason, as its row of step 3 says it
        failed: () => jobReason(jobOf(job)),
        later: () => t('onboarding.review_section_later'),
        pending: () => t(pending),
        skipped: () => t('onboarding.review_section_skipped'),
      };
      const badge = state === 'pending' && !own ? `<span class="wizard-review-running" data-testid="wizard-review-running" role="status">${spinner('wizard-review-spinner')}${esc(t('onboarding.job_status_running'))}</span>` : '';
      return `<section class="card wizard-review-section" data-testid="wizard-review-${id}" data-state="${state}">
          <header class="wizard-review-head"><h3>${esc(t(title))}</h3><span class="wizard-review-badges">${badge}${action}</span></header>
          ${failure || (state === 'ready' ? body() : own ? pending() : `<p class="muted small">${esc(words[state]())}</p>`)}
        </section>`;
    }

    // mock-6's city: a bar per district (its files, the largest first), then the counts in words
    function cityBody() {
      const model = cur().review.city?.model;
      const districts = model?.districts || [];
      if (!districts.length) return `<p class="muted small">${esc(t('onboarding.review_city_empty'))}</p>`;
      // the city model's buildings (packages/shared/city-model.js), each naming its district
      const sizes = districts.map((d) => d.buildings?.length || d.files || 0);
      const files = Array.isArray(model.buildings) ? model.buildings.length : sizes.reduce((n, s) => n + s, 0);
      const top = Math.max(1, ...sizes);
      const bars = sizes.slice(0, 12).map((s, i) => `<span class="wizard-city-bar" style="height: ${Math.max(8, Math.round((s / top) * 100))}%" title="${esc(districts[i].name || districts[i].id || '')}"></span>`).join('');
      return `<div class="wizard-city-bars" aria-hidden="true">${bars}</div>
        <p class="muted small">${esc(t('onboarding.review_city', { count: districts.length, districts: districts.length, files }))}</p>`;
    }

    // #730: each finding of the Oracle's report, its severity, then Create issue / Create issue and prioritize,
    // or its issue's link once filed
    function findingsBody() {
      const findings = cur().review.report?.findings || [];
      if (!findings.length) return `<p class="muted small">${esc(t('onboarding.review_findings_empty'))}</p>`;
      const row = (f, i) => {
        const target = f.files?.[0]?.path || f.kind || '';
        const busy = cur().filing != null ? ' disabled' : '';
        const action = f.filed
          ? `<a class="small" data-testid="wizard-review-finding-issue" href="${esc(f.filed.issueUrl || '')}" target="_blank" rel="noopener">#${esc(f.filed.issue)}</a>`
          : `<button type="button" class="btn sm" data-act="create-issue" data-testid="wizard-review-create-issue" data-finding="${i}"${busy}>${esc(t('project_architecture.create_issue'))}</button>
            <button type="button" class="btn sm" data-act="create-issue" data-testid="wizard-review-create-issue-prioritize" data-finding="${i}" data-prioritize${busy}>${esc(t('project_architecture.create_issue_prioritize'))}</button>`;
        return `<li class="wizard-review-finding fit-box" data-testid="wizard-review-finding" data-finding="${i}">
            <span class="badge${f.severity === 'high' ? ' warn' : ''}">${esc(window.ArchitectureFactsView?.severityLabel(f.severity) ?? f.severity ?? '')}</span>
            <span class="text-cut" title="${esc(`${f.title} · ${target}`)}">${esc(f.title)}</span>
            <span class="wizard-review-badges">${action}</span>
          </li>`;
      };
      return `<ul class="wizard-review-list">${findings.map(row).join('')}</ul>`;
    }

    // Create issue (and prioritize) for the review's finding `index`: the row then shows the issue's link
    async function createIssue(index, prioritize) {
      const pid = cur()?.projectId;
      const reportId = cur()?.review.report?.report?.id;
      if (!pid || !reportId || cur().filing != null) return;
      const c = cur();
      c.filing = index; render();
      try {
        const { filed } = await api.createFindingIssue(pid, reportId, index, { prioritize });
        const f = c.review.report?.findings?.[index];
        if (f) f.filed = filed;
      } catch (e) {
        showToast(t('onboarding.finish_failed'), errMsg(e));
      }
      c.filing = null;
      if (cur() === c) renderSoon();
    }

    // mock-6's first card: the project, how it is worked on (what the analyses read so far; #781: the Health tab's language bar) and its workflows
    function projectCard() {
      const name = cur().model.name;
      const chips = [platformOfRepo(cur().model.repository)?.label].filter(Boolean);
      const languages = activity.languagesBlock(sectionState('facts', cur().review.facts !== undefined)); // #852, #20: from the facts job
      // #850: a new project is worked on as answered on step 2, never "read by the profile when it is done"
      const said = cur().model.source === 'new' ? t(`onboarding.new_mode_${profileOf()?.mode || cur().answers?.mode || 'local'}`) : languages ? '' : t('onboarding.review_how_pending');
      const how = chips.length ? `<div class="wizard-chips">${chips.map((c) => `<span class="wizard-chip">${esc(c)}</span>`).join('')}</div>`
        : said ? `<p class="muted small">${esc(said)}</p>` : '';
      const flows = M.suggestWorkflows(null).suggestions.map((s) => `<span class="wizard-chip accent text-cut" title="${esc(s.id)}">${esc(s.id)}</span>`).join('');
      return `<section class="wizard-review-section wizard-review-project" data-testid="wizard-review-project">
          <div class="wizard-review-well"><h4>${esc(t('onboarding.review_how', { name }))}</h4>${how}${languages}</div>
          ${kindField()}
          <div class="wizard-review-well"><h4>${esc(t('onboarding.review_workflows'))}</h4><div class="wizard-chips">${flows}</div>${column.awaitingNotice('short')}</div>
        </section>`;
    }

    // the review's title row: the project's name leads the step, where it comes from beside it
    function reviewTop() {
      const name = cur().model.name;
      const folder = (typeof state === 'object' && state?.projects?.find?.((p) => p.id === cur().projectId)?.folder) || '';
      const where = [cur().model.repository, folder].filter(Boolean).join(' · ');
      return `<header class="wizard-review-top"><h2 id="project-wizard-title" class="text-cut" title="${esc(name)}">${esc(name)}</h2>
          <span class="mono muted small text-cut" title="${esc(where)}">${esc(where)}</span></header>`;
    }

    // what the analyses found so far (each section pending until its analysis and its read are done): mock-6's
    // three cards, then the backlog and the idea for the Inbox
    function reviewStep() {
      const r = cur().review;
      const later = sectionState('projectMap', true) === 'later' && cur().model.source !== 'new' ? `<p class="muted small">${esc(t('onboarding.review_later'))}</p>` : '';
      const openCity = `<button type="button" class="btn sm" data-act="open-city" data-testid="wizard-open-city">${esc(t('onboarding.open_city'))}</button>`;
      // two columns under the title row: what the project is (its code, its kind, its workflows), then what the
      // analyses found (city, findings, backlog, costs); the idea closes the step on one line
      return `<div class="wizard-review" data-testid="wizard-review">${reviewTop()}${later}${pushNotice(cur().onboarding)}
          <div class="wizard-review-grid">
            ${projectCard()}
            <div class="wizard-review-side">
            ${reviewSection('city', 'onboarding.review_city_title', 'projectMap', r.city !== undefined, cityBody, 'onboarding.review_pending_city', openCity)}
            ${reviewSection('findings', 'onboarding.review_findings_title', 'projectMap', r.report !== undefined, findingsBody, 'onboarding.review_pending_findings', jobOf('projectMap').status === 'failed' ? retryButton('projectMap') : '')}
            ${reviewSection('backlog', 'onboarding.review_backlog_title', null, r.backlog !== undefined, activity.backlogBody, activity.backlogLine, '', activity.backlogFailure())}
            ${costs.reviewCosts()}
            </div>
          </div>
          <label class="wizard-field wizard-review-idea"><span>${esc(t('onboarding.review_idea_label'))}</span>
            <textarea id="wizard-review-idea" data-testid="wizard-review-idea" rows="1" placeholder="${esc(t('onboarding.review_idea_help'))}">${esc(cur().idea)}</textarea>
            <span class="sr-only">${esc(t('onboarding.review_idea_help'))}</span></label>
        </div>`;
    }

    return { createIssue, reviewStep, sectionState };
  };
}());
