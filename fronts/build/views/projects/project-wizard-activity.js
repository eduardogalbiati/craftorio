/* global api, t */
// #781: what the wizard is doing, as activity lines (packages/ui-kit/activity-line.js), split out of
// project-wizard.js (its size cap). window.ProjectWizardActivity({ cur, jobOf, platformLabel, renderSoon }):
// - analysisPhases(): wizard-analysis-phases, step 3's lines wizard-phase-git / -files / -oracle
//   (OnboardingModel.analysisPhases over the profile job and cur().interview);
// - followAnalysis(): api.workflowInterviewState while the profile job runs: at each onboarding:changed and every
//   second, one last read when it ended, none before nor after. A failed read changes nothing;
// - backlogLine(): wizard-review-backlog-activity while the backlog is read (api.backlogProgress at the opening and
//   every second, followBacklog) and backlogDone(count) with its summary, or that the backlog is empty;
// - stop(): the timers, when the wizard closes.
// Each read draws the wizard only when a line changed; the Oracle's reading and its clock move in place, so a second's
// tick neither takes the focus from the step nor restarts the shine.
// Uses app.js globals (api, t), window.OnboardingModel, window.ActivityLine and window.AgentChat.elapsed (m:ss).

(function () {
  const TICK_MS = 1000;
  // the engine's language ids (project-inputs.js detectLanguage) as people write them; any other shows as it is
  const LANGUAGE_NAMES = { csharp: 'C#', go: 'Go', java: 'Java', js: 'JavaScript', php: 'PHP', python: 'Python', ruby: 'Ruby', rust: 'Rust', ts: 'TypeScript' };

  window.ProjectWizardActivity = function ({ cur, jobOf, platformLabel, renderSoon }) {
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

    // the Backlog card's running line: from where and how far (the platform answers all at once: no count until then)
    function backlogLine() {
      const p = cur().backlogProgress;
      const source = p?.source ? platformLabel(p.source) : null;
      const read = Number(p?.read) || 0;
      const meta = read ? (p.total != null ? t('onboarding.backlog_read_of', { read, total: p.total }) : String(read)) : '';
      return Line().html({ state: 'running', testid: 'wizard-review-backlog-activity', text: source ? t('onboarding.backlog_reading_from', { source }) : t('onboarding.review_pending_backlog'), meta });
    }

    const backlogDone = (count) => Line().html({ state: 'done', testid: 'wizard-review-backlog-activity', text: t('onboarding.review_backlog_empty'), summary: count ? t('onboarding.backlog_read', { count }) : '' });

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
      backlogDone,
      backlogLine,
      followAnalysis,
      followBacklog,
      stop,
    };
  };
}());
