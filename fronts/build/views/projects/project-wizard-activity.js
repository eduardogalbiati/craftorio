/* global api, errMsg, esc, t */
// #781: what the wizard is doing, as activity lines (packages/ui-kit/activity-line.js), split out of
// project-wizard.js (its size cap). window.ProjectWizardActivity({ cur, jobOf, loadReview, platformLabel, renderSoon }):
// - analysisPhases(): wizard-analysis-phases, step 3's lines wizard-phase-git / -files / -oracle
//   (OnboardingModel.analysisPhases over the profile job and cur().interview);
// - followAnalysis(): api.workflowInterviewState while the profile job runs: at each onboarding:changed and every
//   second, one last read when it ended, none before nor after. A failed read changes nothing;
// - backlogLine(): wizard-review-backlog-activity while the backlog is read (api.backlogProgress at the opening and
//   every second, followBacklog), backlogBody(): its summary and issues, that it is empty, or that the repository has
//   Issues turned off (#845: wizard-review-backlog-issues-disabled, a link to its settings, no Retry), and backlogFailure(): the
//   failed read's reason with wizard-review-backlog-retry (readBacklog(pid) reads it; onClick(e), before the wizard's: that Retry);
// - stop(): the timers, when the wizard closes.
// Each read draws the wizard only when a line changed; the Oracle's reading and its clock move in place, so a second's
// tick neither takes the focus from the step nor restarts the shine.
// Uses app.js globals (api, errMsg, esc, t), window.OnboardingModel, window.ActivityLine and window.AgentChat.elapsed (m:ss).

(function () {
  const TICK_MS = 1000;
  // the engine's language ids (project-inputs.js detectLanguage) as people write them; any other shows as it is
  const LANGUAGE_NAMES = { csharp: 'C#', go: 'Go', java: 'Java', js: 'JavaScript', php: 'PHP', python: 'Python', ruby: 'Ruby', rust: 'Rust', ts: 'TypeScript' };
  // the engine's words (backlog.js syncBacklog, issues.js fetchIssues) for a project with no platform to read issues from
  const NO_TRACKER = /no repository|not a recognizable git URL/i;

  window.ProjectWizardActivity = function ({ cur, jobOf, loadReview, platformLabel, renderSoon }) {
    const M = window.OnboardingModel;
    const Line = () => window.ActivityLine;
    let analysisTimer = null;
    let backlogTimer = null;
    let reads = 0; // only the latest read applies: an older answer arriving late never wins

    const commitsText = ({ commits, merges, tags }) => [
      t('onboarding.phase_git_commits', { count: commits }), t('onboarding.phase_git_merges', { count: merges }), t('onboarding.phase_git_tags', { count: tags }),
    ].join(' · ');
    const filesText = ({ languages, testCommand, ci }) => [
      (languages || []).map((l) => LANGUAGE_NAMES[l] || l).join(', '), testCommand, M.PROFILE_LABELS.ci[ci] && t(M.PROFILE_LABELS.ci[ci]),
    ].filter(Boolean).join(' · ');

    const oracleClock = (since) => {
      const at = Date.parse(since);
      return Number.isFinite(at) ? window.AgentChat.elapsed(Date.now() - at) : '';
    };

    // a phase as ActivityLine's options
    function lineOf(p) {
      const base = { state: p.state, testid: `wizard-phase-${p.id}`, text: t(`onboarding.phase_${p.id}${p.state === 'done' ? '_done' : ''}`) };
      if (p.id === 'git' && p.found) return { ...base, summary: commitsText(p.found) };
      if (p.id === 'files' && p.found) return { ...base, summary: filesText(p.found) };
      if (p.id !== 'oracle') return base;
      if (p.state === 'skipped') return { ...base, summary: t('onboarding.phase_oracle_not_needed') };
      if (p.state !== 'running') return base;
      return { ...base, text: p.reading ? t('onboarding.phase_oracle_reading', { reading: p.reading }) : t('onboarding.phase_oracle_running'), meta: oracleClock(p.since) };
    }

    const phases = () => M.analysisPhases({ job: jobOf('profile'), interview: cur()?.interview || null });
    const lineHtml = (p) => `<div data-wizard-phase="${p.id}">${Line().html(lineOf(p))}</div>`;
    const analysisPhases = () => `<div class="wizard-analysis-phases" data-testid="wizard-analysis-phases">${phases().map(lineHtml).join('')}</div>`;

    // what a redraw would change: the lines but for the Oracle's reading and clock
    const shape = () => JSON.stringify(phases().map(({ id, state, found }) => [id, state, found]));

    // an answer in: a new line state draws the step, the rest moves in place
    function onInterview(interview) {
      const before = shape();
      cur().interview = interview;
      if (shape() !== before) { renderSoon(); return; }
      const oracle = phases().find((p) => p.id === 'oracle');
      if (oracle.state === 'running') Line().paint(document.querySelector('[data-wizard-phase="oracle"]'), lineOf(oracle));
    }

    function readInterview() {
      const c = cur();
      const projectId = c?.projectId;
      if (!projectId) return;
      const read = ++reads;
      Promise.resolve().then(() => api.workflowInterviewState?.({ projectId }))
        .then((answer) => { if (answer && read === reads && cur() === c && c.projectId === projectId) onInterview(answer); })
        .catch(() => {}); // the lines stay as they are, the next read tells
    }

    function stopAnalysis() {
      clearInterval(analysisTimer);
      analysisTimer = null;
    }

    function followAnalysis() {
      const c = cur();
      if (!c) { stopAnalysis(); return; }
      if (jobOf('profile').status === 'running') {
        c.followingInterview = true;
        readInterview();
        analysisTimer ||= setInterval(followAnalysis, TICK_MS);
      } else if (c.followingInterview) {
        c.followingInterview = false;
        stopAnalysis();
        readInterview(); // how it ended
      }
    }

    // the Backlog card's running line: from where and how far (the count grows with each step of the read)
    function backlogLine() {
      const p = cur().backlogProgress;
      const source = p?.source ? platformLabel(p.source) : null;
      const read = Number(p?.read) || 0;
      const meta = read ? (p.total != null ? t('onboarding.backlog_read_of', { read, total: p.total }) : String(read)) : '';
      return Line().html({ state: 'running', testid: 'wizard-review-backlog-activity', text: source ? t('onboarding.backlog_reading_from', { source }) : t('onboarding.review_pending_backlog'), meta });
    }

    const backlogDone = (count) => Line().html({ state: 'done', testid: 'wizard-review-backlog-activity', text: t('onboarding.review_backlog_empty'), summary: count ? t('onboarding.backlog_read', { count }) : '' });

    // the Backlog card of a failed read: its reason with its Retry; '' with none
    function backlogFailure() {
      const reason = cur().backlogError;
      return reason ? Line().html({ state: 'failed', testid: 'wizard-review-backlog-activity', reason, retry: { label: t('onboarding.retry'), attrs: 'data-act="retry-backlog" data-testid="wizard-review-backlog-retry"' } }) : '';
    }

    // #845: the repository has Issues turned off: a state, not a failure (no Retry), with a link to its settings
    function issuesDisabledBody(data) {
      const P = window.Platforms;
      const parsed = P?.parseRepoUrl(data.repo);
      const url = parsed ? P.findPlatform(data.platform)?.settingsUrl?.(parsed) : null;
      const link = url ? `<a class="small" data-testid="wizard-review-backlog-settings-link" href="${esc(url)}" target="_blank" rel="noopener">${esc(t('backlog.repository_settings'))}</a>` : '';
      return `<div data-testid="wizard-review-backlog-issues-disabled">${Line().html({ state: 'done', testid: 'wizard-review-backlog-activity', text: t('backlog.issues_disabled') })}${link}</div>`;
    }

    // the Backlog card once read: the summary and the issues, or that it is empty
    function backlogBody() {
      if (cur().review.backlog?.issuesDisabled) return issuesDisabledBody(cur().review.backlog);
      const issues = cur().review.backlog?.issues || [];
      if (!issues.length) return backlogDone(0);
      return `${backlogDone(issues.length)}<ul class="wizard-review-list">${issues.map((i) => `<li class="fit-box"><span class="mono muted">#${esc(i.number)}</span> <span class="text-cut" title="${esc(i.title)}">${esc(i.title)}</span></li>`).join('')}</ul>`;
    }

    // the review's read: the cache, synced when it was never read (followed: this card shows the count). Nowhere to read
    // from is an empty backlog; any other failure (not signed in, no network) is kept for the card, which answers null either way
    function readBacklog(pid) {
      const c = cur();
      return Promise.resolve(api.getBacklog?.(pid)).then((data) => data || api.syncBacklog?.(pid, null, true)).catch((e) => {
        if (!NO_TRACKER.test(errMsg(e))) c.backlogError = errMsg(e);
        return null;
      });
    }

    // the wizard's clicks, before its own handler: the Backlog's Retry puts the card back to reading; true when handled
    function onClick(e) {
      const c = cur();
      if (!c || e.target?.closest?.('[data-act]')?.dataset.act !== 'retry-backlog') return false;
      c.backlogError = null;
      c.backlogProgress = null;
      delete c.review.backlog;
      loadReview();
      renderSoon();
      return true;
    }

    function stopBacklog() {
      clearInterval(backlogTimer);
      backlogTimer = null;
    }

    function followBacklog() {
      const c = cur();
      if (!c?.projectId || c.review.backlog !== undefined) { stopBacklog(); return; }
      const pid = c.projectId;
      backlogTimer ||= setInterval(followBacklog, TICK_MS);
      Promise.resolve().then(() => api.backlogProgress?.(pid)).then((progress) => {
        if (cur() !== c || c.review.backlog !== undefined) return;
        const changed = JSON.stringify(progress ?? null) !== JSON.stringify(c.backlogProgress ?? null);
        c.backlogProgress = progress ?? null;
        if (changed) renderSoon();
      }).catch(() => {}); // the line stays as it is
    }

    function stop() {
      stopAnalysis();
      stopBacklog();
    }

    return {
      analysisPhases,
      backlogBody,
      backlogFailure,
      backlogLine,
      followAnalysis,
      followBacklog,
      onClick,
      readBacklog,
      stop,
    };
  };
}());
