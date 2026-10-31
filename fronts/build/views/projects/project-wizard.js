/* global api */
// The new-project wizard (#641, onboarding step 4 of docs/work/first-project-onboarding/plan.md; spec
// R1-R3, R5): a modal over the page with the steps of OnboardingModel (packages/shared/onboarding-model.js),
// and the onboarding's progress tray. Not wired to Projects yet (step 6): window.ProjectWizard = { open(), close() }
// opens it (the checks, the screenshots); Projects › New project still opens the old dialog (projects.js).
// - #project-wizard (data-testid="project-wizard", role="dialog"): the indicator (one data-step="<id>" per
//   step, the current one aria-current="step"), then the step: start (wizard-source-import / wizard-source-new),
//   repository (#wizard-repo, #wizard-name, #wizard-provider read from the URL, wizard-import-status once
//   api.startOnboarding answered), analysis (the jobs, wizard-cost with wizard-cost-total and the paid parts
//   data-part="projectMap" | "ranking" before the click, wizard-analyze, wizard-skip) and review (#642, spec
//   R10): wizard-review with wizard-review-city / -backlog / -refactors, each data-state="ready" | "pending"
//   (its analysis still running: words say so) | "failed" | "skipped" (its analysis answered without a result)
//   | "later" (the analyses were skipped), one wizard-review-refactor data-refactor="<id>" per proposal
//   with its file's score and quadrant and an unchecked wizard-review-refactor-pick, and the idea field
//   wizard-review-idea (an answer arriving while it has the focus renders at its blur). Navigation:
//   wizard-back, wizard-next, wizard-close (Esc too), and on the review
//   wizard-finish (never disabled, never waits): it closes the wizard on the project's page with its Next steps
//   card (openProject with nextSteps, project.js), then sends the picked refactors to the roadmap as planned
//   items (refactor:addToRoadmap with `file`: filed as issues first) and the idea to the Inbox; an analysis
//   still running at Finish shows a toast when it ends.
// - errors: wizard-error data-error="no-access" | "clone-failed" with the engine's reason and Retry
//   (api.retryOnboarding); no-access also offers Edit the URL (wizard-edit-repo: the fields open again for a new
//   import, the failed one stays in the tray); the gh / glab warning wizard-cli-warning data-error="cli-missing" |
//   "cli-signed-out" (the import goes on) with Open Setup, on the repository and the analysis steps.
// - the provider (its label, its CLI) is the adapter of window.Platforms.platformOfRepoUrl, the engine's rule too;
//   amounts go through I18n.formatCost (the interface's language). Tab stays in the dialog; close() gives the focus
//   back to what opened it.
// - #onboarding-tray (data-testid="onboarding-tray"): one tray-item per imported project (data-project,
//   data-status = the engine's status), its name, and when failed the reason and Retry; it follows
//   onboarding:changed (api.onOnboardingChanged, subscribed when the script loads) and stays when the wizard closes.
// Channels: onboarding:start / analyze / retry (packages/engine/service/channels/onboarding.js),
// architecture:estimate (the project map's cost; the ranking has no estimate yet: not known), and for the
// review architecture:city / facts, refactor:proposals, the backlog, the refactor's roadmap item
// (api.addRefactorToRoadmap, never runNow) and the discovery card (api.createDiscoveryCard, an Inbox idea).
// Uses app.js globals (esc, t, showToast, errMsg), window.Actions and window.Setup (packages/ui-kit/setup.js).

(function () {
  const M = window.OnboardingModel;
  const JOBS = ['facts', 'profile', 'projectMap', 'ranking'];
  const PAID = ['projectMap', 'ranking'];
  // the engine's statuses past the clone: the repository step goes on to the analysis by itself
  const CLONED = ['ready', 'analyzing', 'analyzed'];
  const ACTIVE = ['cloning', 'analyzing'];

  let root = null;
  let tray = null;
  // { model: OnboardingModel state, projectId, onboarding: the engine's state, estimate, busy, and the
  // review's: review { backlog, city, facts, proposals } (undefined: not read yet), reading, picked, idea }
  let cur = null;
  const freshReview = () => ({ review: {}, reading: new Set(), picked: new Set(), idea: '' });
  let opener = null; // the element that had the focus when the wizard opened
  const names = new Map(); // projectId → the name typed in the wizard (the event carries no name)
  const states = new Map(); // projectId → the engine's last state, in arrival order
  const finished = new Set(); // projectIds finished in the wizard with an analysis still running

  const platformOfRepo = (url) => window.Platforms?.platformOfRepoUrl?.(url) || null;
  const platformById = (id) => window.Platforms?.findPlatform?.(id) || null;
  const usd = (n) => (window.I18n?.formatCost ? window.I18n.formatCost(n) : `$${Number(n).toFixed(2)}`);
  const money = (n) => (n > 0 && n < 0.01 ? `< ${usd(0.01)}` : usd(n));
  const costText = (n) => (n == null ? t('onboarding.cost_not_known') : money(n));
  const statusText = (s) => t(`onboarding.status_${s}`);
  const canNext = () => M.canGoNext(cur.model) && cur.onboarding?.status !== 'failed' && !cur.busy;

  function stepper() {
    const at = M.STEPS.findIndex((s) => s.id === cur.model.step);
    return `<ol class="wizard-steps">${M.STEPS.map((s, i) => `<li data-step="${s.id}" class="${i < at ? 'done' : ''}"${i === at ? ' aria-current="step"' : ''}>${esc(t(`onboarding.step_${s.id}`))}</li>`).join('')}</ol>`;
  }

  function startStep() {
    const picked = (s) => (cur.model.source === s ? ' selected' : '');
    return `<p class="muted">${esc(t('onboarding.start_intro'))}</p>
      <div class="wizard-sources">
        <button type="button" class="card wizard-source${picked('import')}" data-act="source-import" data-testid="wizard-source-import" aria-pressed="${cur.model.source === 'import'}">
          <strong>${esc(t('onboarding.import_title'))}</strong>
          <span class="muted small">${esc(t('onboarding.import_text'))}</span>
        </button>
        <button type="button" class="card wizard-source" data-act="source-new" data-testid="wizard-source-new" aria-disabled="true" disabled>
          <strong>${esc(t('onboarding.new_title'))} <span class="badge">${esc(t('onboarding.soon'))}</span></strong>
          <span class="muted small">${esc(t('onboarding.new_text'))}</span>
        </button>
      </div>`;
  }

  function errorBlock(o) {
    const code = o.code || 'failed';
    const provider = (platformById(o.cli?.provider) || platformOfRepo(cur.model.repository))?.label || '';
    const signIn = code === 'no-access' && provider
      ? `<button type="button" class="btn" data-act="setup">${esc(t('onboarding.sign_in', { provider }))}</button>` : '';
    const edit = code === 'no-access' && cur.model.step === 'repository'
      ? `<button type="button" class="btn ghost" data-act="edit-repo" data-testid="wizard-edit-repo">${esc(t('onboarding.edit_repo'))}</button>` : '';
    return `<div class="wizard-alert error" role="alert" data-testid="wizard-error" data-error="${esc(code)}">
        <strong>${esc(t(code === 'no-access' ? 'onboarding.no_access' : code === 'clone-failed' ? 'onboarding.clone_failed' : 'onboarding.failed'))}</strong>
        <p>${esc(o.reason || t('onboarding.no_reason'))}</p>
        <p class="muted small">${esc(t(code === 'no-access' ? 'onboarding.no_access_hint' : 'onboarding.failed_hint'))}</p>
        <div class="wizard-actions"><button type="button" class="btn primary" data-act="retry">${esc(t('onboarding.retry'))}</button>${signIn}${edit}</div>
      </div>`;
  }

  function cliWarning(cli) {
    if (!cli || !['missing', 'signed-out'].includes(cli.status)) return '';
    const name = platformById(cli.provider)?.cli || cli.provider || '';
    return `<div class="wizard-alert warn" data-testid="wizard-cli-warning" data-error="cli-${esc(cli.status)}">
        <strong>${esc(t(cli.status === 'missing' ? 'onboarding.cli_missing' : 'onboarding.cli_signed_out', { cli: name }))}</strong>
        <p>${esc(cli.reason || '')}</p>
        <p class="muted small">${esc(t('onboarding.cli_hint'))}</p>
        <div class="wizard-actions"><button type="button" class="btn" data-act="setup">${esc(t('onboarding.open_setup'))}</button></div>
      </div>`;
  }

  function repositoryStep() {
    const o = cur.onboarding;
    const locked = cur.projectId ? ' readonly' : '';
    const provider = platformOfRepo(cur.model.repository)?.label || '';
    const status = o ? `<div class="card wizard-import" data-testid="wizard-import-status">
        <div class="wizard-import-head"><strong>${esc(cur.model.name)}</strong><span class="badge status-${esc(o.status)}">${esc(statusText(o.status))}</span></div>
        <span class="muted small wizard-url" title="${esc(cur.model.repository)}">${esc(cur.model.repository)}</span>
        <span class="small">${esc(t(o.status === 'cloning' ? 'onboarding.import_cloning' : o.status === 'failed' ? 'onboarding.import_failed' : 'onboarding.import_cloned'))}</span>
      </div>` : '';
    return `<div class="wizard-fields">
        <label class="wizard-field"><span>${esc(t('onboarding.repo_label'))} <span class="badge" id="wizard-provider" data-testid="wizard-provider">${esc(provider)}</span></span>
          <input id="wizard-repo" data-testid="wizard-repo" type="text" spellcheck="false" value="${esc(cur.model.repository)}"${locked}>
          <span class="muted small">${esc(t('onboarding.repo_help'))}</span></label>
        <label class="wizard-field"><span>${esc(t('onboarding.name_label'))}</span>
          <input id="wizard-name" data-testid="wizard-name" type="text" value="${esc(cur.model.name)}"${locked}></label>
      </div>
      ${status}
      ${o?.status === 'failed' ? errorBlock(o) : ''}
      ${o ? cliWarning(o.cli) : ''}`;
  }

  function costBlock() {
    const loading = cur.estimate === undefined;
    const sum = M.costSummary(PAID.map((id) => ({ id, estimate: id === 'projectMap' ? cur.estimate : null, checked: true })));
    const part = (p) => `<li data-part="${p.id}"><span>${esc(t(`onboarding.job_${p.id}`))}</span><span class="wizard-amount">${esc(loading ? t('onboarding.estimating') : costText(p.estimate))}</span></li>`;
    const unknown = !loading && sum.total != null && sum.unknown.length
      ? `<span class="muted small">${esc(t('onboarding.cost_partial'))}</span>` : '';
    return `<div class="card wizard-cost" data-testid="wizard-cost">
        <ul class="wizard-cost-parts">
          <li class="free"><span>${esc(t('onboarding.job_profile'))}</span><span class="badge">${esc(t('onboarding.cost_free'))}</span></li>
          ${sum.parts.map(part).join('')}
        </ul>
        <div class="wizard-cost-total-row"><strong>${esc(t('onboarding.cost_total'))}</strong>
          <strong data-testid="wizard-cost-total">${esc(loading ? t('onboarding.estimating') : costText(sum.total))}</strong></div>
        ${unknown}
      </div>`;
  }

  function analysisStep() {
    const o = cur.onboarding || {};
    const jobs = o.jobs || {};
    const started = ['analyzing', 'analyzed'].includes(o.status);
    const rows = JOBS.map((id) => {
      const s = jobs[id]?.status || 'waiting';
      return `<li><span>${esc(t(`onboarding.job_${id}`))}</span><span class="badge job-${esc(s)}">${esc(t(`onboarding.job_status_${s}`))}</span></li>`;
    }).join('');
    const actions = started ? `<p class="muted small">${esc(t(o.status === 'analyzed' ? 'onboarding.analysis_done' : 'onboarding.analysis_running'))}</p>`
      : `<div class="wizard-actions">
          <button type="button" class="btn primary" data-act="analyze" data-testid="wizard-analyze"${cur.busy ? ' disabled' : ''}>${esc(t('onboarding.start_analysis'))}</button>
          <button type="button" class="btn ghost" data-act="skip" data-testid="wizard-skip">${esc(t('onboarding.skip'))}</button>
        </div>`;
    return `<p class="muted">${esc(t('onboarding.analysis_intro'))}</p>
      <ul class="wizard-jobs">${rows}</ul>
      ${started ? '' : costBlock()}
      ${o.status === 'failed' ? errorBlock(o) : ''}
      ${cliWarning(o.cli)}
      ${actions}`;
  }

  const jobOf = (id) => cur.onboarding?.jobs?.[id] || {};
  const jobDone = (id) => jobOf(id).status === 'done';

  // a section's state: ready (its analysis and read done), failed / skipped (its analysis answered without
  // a result), later (the analyses were skipped in the wizard) or pending (still running or reading)
  function sectionState(job, read) {
    if (!job) return read ? 'ready' : 'pending';
    const s = jobOf(job).status;
    if (s === 'done') return read ? 'ready' : 'pending';
    if (s === 'failed' || s === 'skipped') return s;
    return cur.model.analyzeLater && !ACTIVE.includes(cur.onboarding?.status) ? 'later' : 'pending';
  }

  function reviewSection(id, title, job, read, body, pendingKey) {
    const state = sectionState(job, read);
    const words = {
      failed: () => t('onboarding.review_section_failed', { error: jobOf(job).error || t('onboarding.no_reason') }),
      later: () => t('onboarding.review_section_later'),
      pending: () => t(pendingKey),
      skipped: () => t('onboarding.review_section_skipped'),
    };
    return `<section class="card wizard-review-section" data-testid="wizard-review-${id}" data-state="${state}">
        <h3>${esc(t(title))}</h3>
        ${state === 'ready' ? body() : `<p class="muted small">${esc(words[state]())}</p>`}
      </section>`;
  }

  function cityBody() {
    const model = cur.review.city?.model;
    const districts = model?.districts || [];
    if (!districts.length) return `<p class="muted small">${esc(t('onboarding.review_city_empty'))}</p>`;
    // the city model's buildings (packages/shared/city-model.js), each naming its district
    const files = Array.isArray(model.buildings) ? model.buildings.length : districts.reduce((n, d) => n + (d.buildings?.length || d.files || 0), 0);
    return `<p>${esc(t('onboarding.review_city', { districts: districts.length, files }))}</p>`;
  }

  function backlogBody() {
    const issues = cur.review.backlog?.issues || [];
    if (!issues.length) return `<p class="muted small">${esc(t('onboarding.review_backlog_empty'))}</p>`;
    return `<ul class="wizard-review-list">${issues.map((i) => `<li class="fit-box"><span class="mono muted">#${esc(i.number)}</span> <span class="text-cut" title="${esc(i.title)}">${esc(i.title)}</span></li>`).join('')}</ul>`;
  }

  // each proposal with its file's score and quadrant (the Facts view's), and its pick for the roadmap
  function refactorsBody() {
    const proposals = cur.review.proposals || [];
    if (!proposals.length) return `<p class="muted small">${esc(t('onboarding.review_refactors_empty'))}</p>`;
    const files = cur.review.facts?.model?.files || [];
    const row = (p) => {
      const target = p.target || p.targetFiles?.[0] || '';
      const f = files.find((x) => x.file === target);
      const score = Number.isFinite(f?.score) ? `<span class="badge">${esc(t('onboarding.review_score', { score: f.score }))}</span>` : '';
      const quadrant = f?.quadrant ? `<span class="${window.ArchitectureModel.quadrantBadge(f.quadrant)}">${esc(f.quadrant)}</span>` : '';
      return `<li class="wizard-review-refactor fit-box" data-testid="wizard-review-refactor" data-refactor="${esc(p.id)}">
          <label class="check small"><input type="checkbox" data-testid="wizard-review-refactor-pick" data-refactor="${esc(p.id)}" aria-label="${esc(p.title)}"${cur.picked.has(p.id) ? ' checked' : ''}>
            <span class="text-cut" title="${esc(p.title)}">${esc(p.title)}</span></label>
          <span class="mono muted small text-cut" title="${esc(target)}">${esc(target)}</span>
          <span class="wizard-review-badges">${score}${quadrant}</span>
        </li>`;
    };
    return `<ul class="wizard-review-list">${proposals.map(row).join('')}</ul>`;
  }

  // what the analyses found so far (each section pending until its analysis and its read are done)
  function reviewStep() {
    const r = cur.review;
    const later = cur.model.analyzeLater ? `<p class="muted small">${esc(t('onboarding.review_later'))}</p>` : '';
    return `<div class="wizard-review" data-testid="wizard-review">
        <p class="muted"><strong>${esc(t('onboarding.review_title', { name: cur.model.name }))}</strong> ${esc(t('onboarding.review_text'))}</p>${later}
        ${reviewSection('city', 'onboarding.review_city_title', 'projectMap', r.city !== undefined, cityBody, 'onboarding.review_pending_city')}
        ${reviewSection('backlog', 'onboarding.review_backlog_title', null, r.backlog !== undefined, backlogBody, 'onboarding.review_pending_backlog')}
        ${reviewSection('refactors', 'onboarding.review_refactors_title', 'ranking', r.proposals !== undefined && r.facts !== undefined, refactorsBody, 'onboarding.review_pending_refactors')}
        <label class="wizard-field"><span>${esc(t('onboarding.review_idea_label'))}</span>
          <textarea id="wizard-review-idea" data-testid="wizard-review-idea" rows="2">${esc(cur.idea)}</textarea>
          <span class="muted small">${esc(t('onboarding.review_idea_help'))}</span></label>
      </div>`;
  }

  const BODY = { analysis: analysisStep, repository: repositoryStep, review: reviewStep, start: startStep };

  function render() {
    if (!root || !cur) return;
    const step = cur.model.step;
    // the analysis step has its own buttons until the analysis started; review is the last step
    const showNext = step === 'start' || step === 'repository'
      || (step === 'analysis' && ['analyzing', 'analyzed'].includes(cur.onboarding?.status));
    const next = showNext ? `<button type="button" class="btn primary" id="wizard-next" data-act="next" data-testid="wizard-next"${canNext() ? '' : ' disabled'}>${esc(t('onboarding.next'))}</button>` : '';
    const back = step === 'start' ? '' : `<button type="button" class="btn ghost" data-act="back" data-testid="wizard-back">${esc(t('onboarding.back'))}</button>`;
    // Finish never waits: not disabled by an analysis still running nor by a call in flight
    const finish = step === 'review' ? `<button type="button" class="btn primary" data-act="finish" data-testid="wizard-finish">${esc(t('onboarding.finish'))}</button>` : '';
    root.innerHTML = `<div class="wizard-panel" tabindex="-1">
        <header class="wizard-head">
          <h2 id="project-wizard-title">${esc(t('onboarding.title'))}</h2>
          <button type="button" class="btn ghost wizard-close" data-act="close" data-testid="wizard-close" aria-label="${esc(t('common.close'))}">×</button>
        </header>
        ${stepper()}
        <section class="wizard-body">${BODY[step]()}</section>
        <footer class="wizard-foot">${back}<span class="wizard-spacer"></span>${next}${finish}</footer>
      </div>`;
  }

  // ---- the engine's state ----------------------------------------------------------------------

  // a render from an answer or an event waits while the owner types the idea (the caret stays): the
  // idea field's blur renders what arrived meanwhile
  function renderSoon() {
    if (cur && document.activeElement?.id === 'wizard-review-idea') { cur.stale = true; return; }
    render();
  }

  function remember(state) {
    if (!state?.projectId) return;
    states.delete(state.projectId);
    states.set(state.projectId, state);
    renderTray();
    // spec R10: what was left at Finish arrives on the project's page with a notification
    if (finished.has(state.projectId) && ['analyzed', 'failed'].includes(state.status)) {
      finished.delete(state.projectId);
      const name = names.get(state.projectId) || state.projectId;
      showToast(t(state.status === 'analyzed' ? 'onboarding.finished_analyzed' : 'onboarding.finished_failed', { name }));
    }
    if (cur && cur.projectId === state.projectId) {
      cur.onboarding = state;
      if (cur.model.step === 'repository' && CLONED.includes(state.status)) toAnalysis();
      if (cur.model.step === 'review') loadReview(); // an analysis done meanwhile: read what it made
      renderSoon();
    }
  }

  // The review's reads, without waiting: each one once its analysis is done (the backlog at once, synced
  // when it was never read: a project just imported has no cache); a failed read counts as answered with nothing
  function loadReview() {
    const pid = cur.projectId;
    if (!pid) return;
    const backlogRead = () => Promise.resolve(api.getBacklog?.(pid)).then((data) => data || api.syncBacklog?.(pid));
    const reads = [['backlog', backlogRead, true], ['city', () => api.architectureCity?.(pid), jobDone('projectMap')],
      ['facts', () => api.architectureFacts?.(pid), jobDone('ranking')], ['proposals', () => api.refactorProposals?.(pid), jobDone('ranking')]];
    for (const [key, read, due] of reads) {
      if (!due || cur.review[key] !== undefined || cur.reading.has(key)) continue;
      cur.reading.add(key);
      const answer = (value) => {
        if (!cur || cur.projectId !== pid) return;
        cur.reading.delete(key);
        cur.review[key] = value ?? null;
        renderSoon();
      };
      new Promise((resolve) => resolve(read())).then(answer, () => answer(null));
    }
  }

  // Finish: the project's page at once (with its Next steps card), then the chosen refactors to the
  // roadmap as planned items (filed as issues first, no runNow: nothing starts) and the idea to the
  // Inbox, in the background; an analysis still running notifies when it ends (remember)
  function finish() {
    const pid = cur.projectId;
    const picked = [...cur.picked];
    const idea = cur.idea.trim();
    const running = ACTIVE.includes(cur.onboarding?.status);
    close();
    if (!pid) return;
    if (running) finished.add(pid);
    window.Actions.call('openProject', pid, { nextSteps: true });
    const failed = (e) => showToast(t('onboarding.finish_failed'), errMsg(e));
    for (const id of picked) Promise.resolve(api.addRefactorToRoadmap(pid, id, { file: true })).catch(failed);
    if (idea) Promise.resolve(api.createDiscoveryCard(pid, idea.slice(0, 200), idea, 'idea')).catch(failed);
  }

  function toAnalysis() {
    cur.model = { ...cur.model, step: 'analysis' };
    if (cur.estimate !== undefined) return;
    const pid = cur.projectId;
    Promise.resolve(api.architectureEstimate?.(pid)).then((r) => {
      if (!cur || cur.projectId !== pid) return;
      cur.estimate = Number.isFinite(r?.estimate?.usd) ? r.estimate.usd : null;
      render();
    }).catch(() => { if (cur?.projectId === pid) { cur.estimate = null; render(); } });
  }

  async function call(fn) {
    cur.busy = true;
    render();
    try {
      remember(await fn());
    } catch (e) {
      showToast(t('onboarding.action_failed'), errMsg(e));
    } finally {
      if (cur) { cur.busy = false; render(); }
    }
  }

  async function next() {
    if (!canNext()) return;
    if (cur.model.step === 'repository' && !cur.projectId) {
      const name = cur.model.name.trim();
      const repo = cur.model.repository.trim();
      cur.busy = true;
      render();
      try {
        const state = await api.startOnboarding({ name, repo });
        cur.projectId = state?.projectId || null;
        if (cur.projectId) names.set(cur.projectId, name);
        remember(state);
      } catch (e) {
        showToast(t('onboarding.start_failed'), errMsg(e));
      } finally {
        cur.busy = false;
        render();
      }
      return;
    }
    if (cur.model.step === 'repository') toAnalysis();
    else cur.model = M.next(cur.model);
    if (cur.model.step === 'review') loadReview();
    render();
  }

  function openSetup() {
    close();
    if (window.Setup?.open) window.Setup.open();
  }

  async function onClick(e) {
    const act = e.target?.closest?.('[data-act]')?.dataset.act;
    if (!act || !cur) return;
    if (act === 'close') close();
    else if (act === 'source-import') { cur.model = { ...cur.model, source: 'import' }; render(); }
    else if (act === 'next') await next();
    else if (act === 'back') { cur.model = M.back(cur.model); render(); }
    else if (act === 'retry' && cur.projectId) await call(() => api.retryOnboarding(cur.projectId));
    else if (act === 'analyze' && cur.projectId) await call(() => api.analyzeOnboarding(cur.projectId));
    else if (act === 'skip') { cur.model = M.skipAnalysis(cur.model); loadReview(); render(); }
    else if (act === 'finish') finish();
    else if (act === 'edit-repo') {
      // a new import from the same fields; the failed one stays in the tray with its Retry
      cur = { ...cur, projectId: null, onboarding: null, estimate: undefined, ...freshReview() };
      render();
      document.getElementById('wizard-repo')?.focus?.();
    }
    else if (act === 'setup') openSetup();
  }

  // typing updates the model and the parts that depend on it, never the whole markup (the caret stays)
  function onInput(e) {
    const id = e.target?.id || e.target?.dataset?.testid;
    if (!cur) return;
    if (e.target?.dataset?.testid === 'wizard-review-refactor-pick') {
      const pick = e.target.dataset.refactor;
      if (e.target.checked) cur.picked.add(pick); else cur.picked.delete(pick);
      return;
    }
    if (id === 'wizard-review-idea') { cur.idea = String(e.target.value || ''); return; }
    if (id !== 'wizard-repo' && id !== 'wizard-name') return;
    cur.model = { ...cur.model, [id === 'wizard-repo' ? 'repository' : 'name']: String(e.target.value || '') };
    const provider = document.getElementById('wizard-provider');
    if (provider) provider.textContent = platformOfRepo(cur.model.repository)?.label || '';
    const nextBtn = document.getElementById('wizard-next');
    if (nextBtn) nextBtn.disabled = !canNext();
  }

  // Tab stays inside the dialog (diff-viewer.js's trapFocus)
  function trapFocus(e) {
    const list = [...(root.querySelectorAll?.('button:not([disabled]), input, select, textarea, [tabindex="0"]') || [])].filter((x) => x.offsetParent !== null);
    if (!list.length) return;
    const i = list.indexOf(document.activeElement);
    const to = e.shiftKey ? (i <= 0 ? list.length - 1 : i - 1) : (i + 1) % list.length;
    e.preventDefault();
    list[to].focus({ preventScroll: true });
  }

  function onKey(e) {
    if (e.key === 'Escape') close();
    else if (e.key === 'Tab') trapFocus(e);
    else if (e.key === 'Enter' && e.target?.tagName === 'INPUT') next();
  }

  function open() {
    opener = document.activeElement || null;
    if (!root) {
      root = document.createElement('div');
      root.setAttribute('id', 'project-wizard');
      root.setAttribute('data-testid', 'project-wizard');
      root.setAttribute('role', 'dialog');
      root.setAttribute('aria-modal', 'true');
      root.setAttribute('aria-labelledby', 'project-wizard-title');
      root.className = 'project-wizard';
      root.addEventListener('click', onClick);
      root.addEventListener('input', onInput);
      root.addEventListener('change', onInput);
      root.addEventListener('keydown', onKey);
      root.addEventListener('focusout', (e) => { if (cur?.stale && e.target?.id === 'wizard-review-idea') { cur.stale = false; render(); } });
      document.body.appendChild(root);
    }
    cur = { model: M.initialState(), projectId: null, onboarding: null, estimate: undefined, busy: false, ...freshReview() };
    root.hidden = false;
    render();
    root.querySelector('.wizard-panel')?.focus?.();
  }

  function close() {
    cur = null;
    if (!root) return;
    root.hidden = true;
    root.innerHTML = '';
    const back = opener;
    opener = null;
    if (back?.isConnected !== false) back?.focus?.();
  }

  // ---- the progress tray -----------------------------------------------------------------------

  function renderTray() {
    if (!tray) {
      tray = document.createElement('aside');
      tray.setAttribute('id', 'onboarding-tray');
      tray.setAttribute('data-testid', 'onboarding-tray');
      tray.setAttribute('aria-live', 'polite');
      tray.setAttribute('aria-label', t('onboarding.tray_title'));
      tray.className = 'onboarding-tray';
      tray.addEventListener('click', onTrayClick);
      document.body.appendChild(tray);
    }
    tray.hidden = states.size === 0;
    const item = (s) => {
      const name = names.get(s.projectId) || s.projectId;
      const failed = s.status === 'failed'
        ? `<p class="small tray-reason">${esc(s.reason || t('onboarding.no_reason'))}</p>
           <button type="button" class="btn small" data-act="retry" data-project="${esc(s.projectId)}">${esc(t('onboarding.retry'))}</button>` : '';
      const dismiss = ACTIVE.includes(s.status) ? ''
        : `<button type="button" class="btn ghost small tray-dismiss" data-act="dismiss" data-project="${esc(s.projectId)}" aria-label="${esc(t('onboarding.dismiss', { name }))}">×</button>`;
      return `<li class="tray-item" data-testid="tray-item" data-project="${esc(s.projectId)}" data-status="${esc(s.status)}">
          <div class="tray-head"><strong class="tray-name" title="${esc(name)}">${esc(name)}</strong><span class="badge status-${esc(s.status)}">${esc(statusText(s.status))}</span>${dismiss}</div>
          ${failed}
        </li>`;
    };
    tray.innerHTML = `<h3 class="tray-title">${esc(t('onboarding.tray_title'))}</h3>
      <ul class="tray-items">${[...states.values()].reverse().map(item).join('')}</ul>`;
  }

  async function onTrayClick(e) {
    const btn = e.target?.closest?.('[data-act]');
    const id = btn?.dataset.project;
    if (!id) return;
    if (btn.dataset.act === 'dismiss') { states.delete(id); renderTray(); return; }
    if (btn.dataset.act !== 'retry') return;
    try {
      remember(await api.retryOnboarding(id));
    } catch (err) {
      showToast(t('onboarding.action_failed'), errMsg(err));
    }
  }

  if (typeof window.api?.onOnboardingChanged === 'function') window.api.onOnboardingChanged(remember);

  window.ProjectWizard = {
    close,
    open,
  };
})();
