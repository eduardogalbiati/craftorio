/* global api */
// The Ways of working interview of a project (#487): a right drawer opened by the project page's
// "Ways of working" button (project.js). It shows the ways-of-working analysis's cost first
// (seeds:estimate), runs it on "Analyze" (workflows:interview: the seeds/ways-of-working seed, read-only),
// then shows the inferred profile with its evidence, the questions the analysis left open (each set to
// its default from the profile), and the proposed set (workflows:compose, recomposed on every answer).
// "Edit profile" lets the owner override any inferred field (answers named after the profile's fields).
// "Open in Builder" opens the development workflow in the Builder unsaved (window.openSpecInBuilder);
// "Write to the repository" writes the set to the project's .multiagent/ (uncommitted) and reloads the
// page's Workflows block. Nothing is written before "Write".
// #733: the drawer opens on the project's last analysis when it has one (workflows:interviewLast: the
// onboarding's profile job or an earlier Analyze), dated, with its cost, the project's chosen workflows as
// the current set and "Analyze again" (secondary, with the estimate); with none, on the first screen
// (intro, cost, Analyze): nothing runs before a click. While an analysis runs (this drawer's or one seen
// on reopening) a loader shows the elapsed time and the turn's last item (workflows:interviewState, polled
// every second); a failure shows its reason and Retry.
// The drawer is added next to the Start drawer (#drawer) and removed when it closes. Uses app.js
// globals ($, esc, errMsg, showToast).

(function () {
  // the proposed workflow's category as the owner reads it: solo / team (#487) and feature (#630) are the
  // development workflow
  const shownCategory = (c) => (['feature', 'solo', 'team'].includes(c) ? 'development' : c);
  // an open question's label (packages/engine/domains/workflow/workflow-compose.js openQuestions ids)
  const QUESTION_LABELS = {
    budget: 'ways_of_working.q_budget',
    ci: 'ways_of_working.f_ci',
    mode: 'ways_of_working.q_mode',
    release: 'ways_of_working.q_release',
    review: 'ways_of_working.q_review',
    screenshots: 'ways_of_working.q_screenshots',
    tests: 'ways_of_working.tests',
    validate: 'ways_of_working.q_validate',
  };
  // #630: the ways of working's axes (team left): how changes land, what the CI runs on, the test kinds
  // #738: Fork + PR, pull requests from the owner's fork to the original repository
  const MODE_OPTIONS = [['local', 'ways_of_working.merge_local'], ['remote', 'ways_of_working.merge_pr'], ['fork', 'ways_of_working.merge_fork']];
  const CI_OPTIONS = [['none', 'ways_of_working.ci_none'], ['release', 'ways_of_working.ci_release'], ['pr+release', 'ways_of_working.ci_pr_release']];
  // #844: 'none', a repository with no test command and no test file
  const TESTS_OPTIONS = [['unit', 'ways_of_working.tests_unit'], ['unit+e2e', 'ways_of_working.tests_unit_e2e'], ['none', 'ways_of_working.tests_none']];
  const RELEASE_STYLES = ['milestone', 'per-merge', 'train', 'rc-stable'];
  // #735: the project's kind (window.OnboardingModel KIND_LABELS, packages/shared/onboarding-model.js): a backend gets no UI step
  const kindOptions = () => Object.entries(window.OnboardingModel?.KIND_LABELS || {});
  // #735: the profile's fields saved as the project's run defaults (project.runDefaults, the run dialog's inputs)
  const RUN_DEFAULT_OF = { mode: 'mode', testCommand: 'test_command', e2eCommand: 'e2e_command', checkCommand: 'check_command' };
  // #735: the run defaults that are not profile fields, edited under "Run defaults" (an empty field: what
  // the engine derives, projects:inputHints' runDefaults, shown as the placeholder)
  const RUN_DEFAULT_EDIT = [
    { id: 'base_branch', label: 'ways_of_working.f_base_branch' },
    { id: 'ui_folders', label: 'ways_of_working.f_ui_folders', list: true },
    { id: 'screenshots', label: 'ways_of_working.q_screenshots', options: [['off', 'ways_of_working.screenshots_off'], ['changed', 'ways_of_working.screenshots_changed'], ['all', 'ways_of_working.screenshots_all']] },
  ];
  // the profile's fields the owner may override (packages/engine/domains/workflow/workflow-compose.js PROFILE_FIELDS): a fixed list is
  // a select (an empty value keeps the inferred one), a command or a list of languages is free text
  const PROFILE_EDIT = [
    { id: 'kind', label: 'ways_of_working.f_kind', get options() { return kindOptions(); } },
    { id: 'mode', label: 'ways_of_working.q_mode', options: MODE_OPTIONS },
    { id: 'release', label: 'ways_of_working.q_release', options: RELEASE_STYLES.map((r) => [r]) },
    { id: 'ci', label: 'ways_of_working.f_ci', options: CI_OPTIONS },
    { id: 'tests', label: 'ways_of_working.tests', options: TESTS_OPTIONS },
    { id: 'testCommand', label: 'ways_of_working.f_test_command' },
    { id: 'e2eCommand', label: 'ways_of_working.f_e2e_command' },
    { id: 'checkCommand', label: 'ways_of_working.f_check_command' },
    { id: 'languages', label: 'ways_of_working.f_languages' },
  ];
  const optionText = (options, v) => { const o = options.find(([value]) => value === v); return o ? t(o[1]) : v || t('ways_of_working.open'); };
  let cur = null; // { project, el, backdrop, estimate, phase, error, result, answers, proposed, composing, writing, editing, seq, last, run, poll, own, startedAt }

  const estimateText = (e) => (e?.free ? t('ways_of_working.estimate_free')
    : e?.costUsd != null ? t('ways_of_working.estimate_cost', { cost: Number(e.costUsd).toFixed(2) })
      : t('ways_of_working.no_estimate_yet'));

  // #844: what the saved project chose (the wizard's Finish, #729; its run defaults, #735): the mode from
  // runDefaults.mode or the feature / fix variant's prefix, the release style from the release variant
  function savedChoices(project) {
    const wf = (name) => (project?.workflows || []).find((w) => w?.name === name)?.variant || '';
    const modes = MODE_OPTIONS.map(([m]) => m);
    const mode = [project?.runDefaults?.mode, wf('feature').split('-')[0], wf('fix').split('-')[0]].find((m) => modes.includes(m));
    const release = RELEASE_STYLES.includes(wf('release')) ? wf('release') : null;
    return { ...(mode ? { mode } : {}), ...(release ? { release } : {}) };
  }

  // the inferred profile under the saved project's choices (#844), with the owner's answers of the same
  // name (as workflow-compose.js withOverrides)
  function effectiveProfile() {
    const out = { ...(cur.result?.profile || {}), ...savedChoices(cur.project) };
    if (cur.project?.kind) out.kind = cur.project.kind;
    for (const f of PROFILE_EDIT) {
      const v = cur.answers[f.id];
      if (v == null || (typeof v === 'string' && !v.trim())) continue;
      out[f.id] = f.id === 'languages' && !Array.isArray(v) ? String(v).split(',').map((s) => s.trim()).filter(Boolean) : v;
    }
    return out;
  }

  function profileLabels(p) {
    const out = [
      ...(p.kind ? [`${t('ways_of_working.f_kind')}: ${optionText(kindOptions(), p.kind)}`] : []),
      `${t('ways_of_working.q_mode')}: ${optionText(MODE_OPTIONS, p.mode)}`,
      `${t('ways_of_working.release')}: ${p.release || t('ways_of_working.open')}`,
      `CI: ${optionText(CI_OPTIONS, p.ci)}`,
      // #844: no test command and the tests unset: no tests found, never unit tests
      `${t('ways_of_working.tests')}: ${optionText(TESTS_OPTIONS, p.tests == null && !p.testCommand ? 'none' : p.tests)}`,
    ];
    if (p.testCommand) out.push(`${t('ways_of_working.f_test_command')}: ${p.testCommand}`);
    if (p.e2eCommand) out.push(`${t('ways_of_working.f_e2e_command')}: ${p.e2eCommand}`);
    if (p.checkCommand) out.push(`${t('ways_of_working.check')}: ${p.checkCommand}`);
    if (p.languages?.length) out.push(p.languages.join(', '));
    return out;
  }

  // one line per fact behind the profile: its field, its numbers, its commits
  function evidenceHtml(evidence) {
    const rows = Object.entries(evidence || {}).map(([field, ev]) => {
      const numbers = Object.entries(ev?.numbers || {}).map(([k, v]) => `${esc(k)} ${esc(String(v))}`).join(' · ');
      const commits = (ev?.commits || []).slice(0, 3).map((c) => `<span class="mono">${esc(String(c).slice(0, 8))}</span>`).join(' ');
      return `<li class="small" data-testid="ways-of-working-evidence"><b>${esc(field)}</b> <span class="muted">${numbers || t('ways_of_working.no_numbers')}</span> ${commits}</li>`;
    });
    return rows.length ? `<ul class="wow-evidence">${rows.join('')}</ul>` : '';
  }

  // the app's select (select.js, #383) from [value, label] tuples; a page without select.js (a test's mini
  // DOM) gets the same element from the DOM
  function selectMarkup(attrs, options, value) {
    if (window.Select) return window.Select.markup(Object.entries(attrs).map(([k, v]) => `${k}="${esc(v)}"`).join(' '), options, value);
    const el = document.createElement('select');
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
    el.innerHTML = options.map(([v, l]) => `<option value="${esc(v)}"${String(v) === String(value ?? '') ? ' selected' : ''}>${esc(l)}</option>`).join('');
    return el.outerHTML;
  }

  function questionHtml(q) {
    const id = `wow-q-${esc(q.id)}`;
    const value = cur.answers[q.id];
    const control = q.type === 'number'
      ? `<input type="number" id="${id}" min="0" step="1" data-wow-answer="${esc(q.id)}" value="${esc(String(value))}" />`
      : selectMarkup({ id, 'data-wow-answer': q.id }, (q.options || []).map((o) => [o.value, t(o.label)]), value);
    // #847: the engine's label, question and options are i18n keys (an older answer's text stays as it is)
    return `<div class="field" data-testid="ways-of-working-question">
      <label for="${id}">${esc(t(QUESTION_LABELS[q.id] || q.label))}</label>
      ${control}
      <p class="hint">${esc(t(q.question))}</p>
    </div>`;
  }

  // "Edit profile": every inferred field, saved into the answers at once (Save), then recomposed
  function profileEditHtml() {
    const p = effectiveProfile();
    const fields = PROFILE_EDIT.map((f) => {
      const id = `wow-p-${f.id}`;
      const value = f.id === 'languages' ? (p.languages || []).join(', ') : (p[f.id] ?? '');
      const control = f.options
        ? selectMarkup({ id, 'data-wow-profile-field': f.id }, [['', t('ways_of_working.open')], ...f.options.map(([v, l]) => [v, l ? t(l) : v])], value)
        : `<input type="text" id="${id}" data-wow-profile-field="${f.id}" value="${esc(String(value))}" />`;
      return `<div class="field"><label for="${id}">${t(f.label)}</label>${control}</div>`;
    }).join('');
    return `<form class="wow-profile-edit" data-wow-profile data-testid="ways-of-working-profile-edit" aria-label="${t('ways_of_working.edit_profile')}">
        ${fields}
        ${runDefaultsEditHtml()}
        <div class="row">
          <button type="submit" class="btn primary" data-testid="ways-of-working-profile-save">${t('common.save')}</button>
          <button type="button" class="btn ghost" data-wow-profile-cancel data-testid="ways-of-working-profile-cancel">${t('common.cancel')}</button>
        </div>
      </form>`;
  }

  // #735: "Run defaults" in the profile's edit form: the project's own value, else empty with what the
  // engine derives as the placeholder (a select's empty option names it)
  function runDefaultsEditHtml() {
    const own = cur.project?.runDefaults || {};
    const derived = cur.derived || {};
    const text = (v) => (Array.isArray(v) ? v.join(', ') : v == null ? '' : String(v));
    const fields = RUN_DEFAULT_EDIT.map((f) => {
      const id = `wow-r-${f.id}`;
      const value = text(own[f.id]);
      const auto = text(derived[f.id]);
      const control = f.options
        ? selectMarkup({ id, 'data-wow-run-default': f.id }, [['', auto ? `${t('ways_of_working.open')} (${t(f.options.find(([v]) => v === auto)?.[1] || auto)})` : t('ways_of_working.open')], ...f.options.map(([v, l]) => [v, t(l)])], value)
        : `<input type="text" id="${id}" data-wow-run-default="${f.id}" value="${esc(value)}" placeholder="${esc(auto)}" />`;
      return `<div class="field"><label for="${id}">${t(f.label)}</label>${control}</div>`;
    }).join('');
    return `<fieldset class="wow-run-defaults" data-testid="ways-of-working-run-defaults">
        <legend class="arch-sub">${t('ways_of_working.run_defaults')}</legend>
        <p class="hint">${t('ways_of_working.run_defaults_hint')}</p>
        ${fields}
      </fieldset>`;
  }

  function proposedHtml() {
    if (cur.composing && !cur.proposed) return `<p class="small muted" role="status">${t('ways_of_working.composing')}</p>`;
    if (!cur.proposed) return '';
    return `<section data-testid="ways-of-working-proposed" aria-label="${t('ways_of_working.proposed')}">
      <h3 class="arch-sub">${t('ways_of_working.proposed')}</h3>
      <ul class="wow-proposed">${cur.proposed.workflows.map((w) => `<li class="row small" data-testid="ways-of-working-proposed-workflow" data-category="${esc(shownCategory(w.category))}" data-name="${esc(w.name)}">
        <span class="badge">${esc(shownCategory(w.category))}</span><b>${esc(w.name)}</b><span class="muted mono" title="${esc(w.path)}">${esc(w.path)}</span></li>`).join('')}</ul>
    </section>`;
  }

  // #733: m:ss since an ISO date (the running seed's `since`) or a local start
  function elapsedText(since) {
    const s = Math.max(0, Math.floor((Date.now() - (Date.parse(since) || Date.now())) / 1000));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  }

  // #733: the running analysis, as the Product Owner / Oracle chats' working line (agent-chat.js): a
  // spinner, what runs, the elapsed time and the turn's last item (seed-runs.js runState)
  function loaderHtml() {
    const run = cur.run || {};
    return `<div class="agent-chat-working small" data-testid="ways-of-working-loader" role="status" aria-live="polite">
        <span class="spinner" aria-hidden="true"></span>
        <span>${t('ways_of_working.analyzing_repository')} <span class="mono" data-testid="ways-of-working-elapsed">${elapsedText(run.since || cur.startedAt)}</span></span>
      </div>
      <p class="small muted" data-testid="ways-of-working-activity">${esc(run.last || t('ways_of_working.analyzing'))}</p>`;
  }

  // #733: when the shown analysis ran and what it cost, with "Analyze again" (secondary) and its estimate
  function analyzedHtml() {
    const l = cur.last;
    const cost = l && Number(l.costUsd) > 0 ? t('ways_of_working.spent_cost', { cost: Number(l.costUsd).toFixed(2) }) : t('ways_of_working.estimate_free');
    const on = l?.date ? `<span data-testid="ways-of-working-analyzed-on">${esc(t('ways_of_working.analyzed_on', { date: String(l.date).slice(0, 10), cost }))}</span>` : '';
    const est = cur.estimate === undefined ? '…' : estimateText(cur.estimate);
    return `<div class="row small wow-analyzed">${on}
        <button type="button" class="btn ghost small" data-testid="ways-of-working-analyze-again" data-wow-analyze>${t('ways_of_working.analyze_again')}</button>
        <span class="muted" title="${esc(t('ways_of_working.estimate_hint'))}">${esc(est)}</span>
      </div>`;
  }

  // #733: the project's chosen workflows (saved on the project by the wizard, #729) as the current set
  function currentSetHtml() {
    const list = cur.project.workflows || [];
    if (!list.length) return '';
    return `<section data-testid="ways-of-working-current-set" aria-label="${t('ways_of_working.current_set')}">
      <h3 class="arch-sub">${t('ways_of_working.current_set')}</h3>
      <ul class="wow-proposed">${list.map((w) => `<li class="row small" data-testid="ways-of-working-current-workflow" data-name="${esc(w.name)}">
        ${w.category ? `<span class="badge">${esc(shownCategory(w.category))}</span>` : ''}<b>${esc(w.name)}</b></li>`).join('')}</ul>
    </section>`;
  }

  function bodyHtml() {
    const est = `<p class="small" data-testid="ways-of-working-estimate" title="${esc(t('ways_of_working.estimate_hint'))}">${t('ways_of_working.analysis_cost')} ${esc(cur.estimate === undefined ? '…' : estimateText(cur.estimate))}</p>`;
    if (cur.phase === 'idle') return `<p class="muted small" data-testid="ways-of-working-intro">${t('ways_of_working.intro')}</p>${est}<p class="hint">${t('ways_of_working.estimate_hint')}</p>`;
    if (cur.phase === 'running') return loaderHtml();
    if (cur.phase === 'error') {
      return `${est}<div class="usage-unavailable" role="alert" data-testid="ways-of-working-error">${esc(cur.error)}</div>
        <button type="button" class="btn small" data-testid="ways-of-working-retry" data-wow-analyze>${t('ways_of_working.retry')}</button>`;
    }
    const r = cur.result;
    return `${analyzedHtml()}${currentSetHtml()}
      <section class="wow-profile" data-testid="ways-of-working-profile" aria-label="${t('ways_of_working.profile')}">
        <h3 class="arch-sub">${t('ways_of_working.profile')}${r.simulated ? ` <span class="badge">${t('ways_of_working.simulated')}</span>` : ''}</h3>
        <div class="row">${profileLabels(effectiveProfile()).map((l) => `<span class="badge cat-monitor">${esc(l)}</span>`).join('')}
          ${cur.editing ? '' : `<button type="button" class="btn ghost small" data-wow-edit-profile data-testid="ways-of-working-edit-profile">${t('ways_of_working.edit_profile')}</button>`}</div>
        ${cur.editing ? profileEditHtml() : ''}
        ${evidenceHtml(r.evidence)}
      </section>
      <section aria-label="${t('ways_of_working.questions')}">
        <h3 class="arch-sub">${t('ways_of_working.questions')}</h3>
        ${(r.questions || []).map(questionHtml).join('')}
      </section>
      ${proposedHtml()}
      ${cur.error ? `<div class="usage-unavailable" role="alert">${esc(cur.error)}</div>` : ''}`;
  }

  function footHtml() {
    if (cur.phase !== 'ready') {
      // #733: on an error the body's Retry is the one way to run it again
      return `${cur.phase === 'error' ? '' : `<button type="button" class="btn primary block" data-testid="ways-of-working-analyze" data-wow-analyze ${cur.phase === 'running' ? 'disabled' : ''}>${t('ways_of_working.analyze')}</button>`}
        <button type="button" class="btn ghost block" data-testid="ways-of-working-cancel" data-wow-close>${t('common.cancel')}</button>`;
    }
    const busy = !cur.proposed || cur.composing || cur.writing;
    return `<button type="button" class="btn primary block" data-testid="ways-of-working-write" data-wow-write ${busy ? 'disabled' : ''}>${t('ways_of_working.write')}</button>
      <button type="button" class="btn block" data-testid="ways-of-working-open-builder" data-wow-builder ${busy ? 'disabled' : ''}>${t('ways_of_working.open_builder')}</button>`;
  }

  function render() {
    if (!cur?.el) return;
    cur.el.querySelector('.drawer-body').innerHTML = bodyHtml();
    cur.el.querySelector('.drawer-foot').innerHTML = footHtml();
  }

  // only the latest call's answer is shown: an earlier one arriving last would show stale answers
  async function compose({ write = false } = {}) {
    const c = cur;
    const seq = ++c.seq;
    c.composing = !write;
    c.writing = write;
    c.error = null;
    render();
    try {
      const out = await api.workflowCompose({ projectId: c.project.id, answers: { ...c.answers }, write });
      if (cur !== c) return null;
      if (seq !== c.seq) return write ? out : null;
      c.proposed = out;
      return out;
    } catch (e) {
      if (cur === c && seq === c.seq) c.error = errMsg(e);
      return null;
    } finally {
      if (seq === c.seq) {
        c.composing = false;
        c.writing = false;
        if (cur === c) render();
      }
    }
  }

  function saveProfile(form) {
    for (const input of form.querySelectorAll('[data-wow-profile-field]')) {
      const id = input.getAttribute('data-wow-profile-field');
      const value = input.value.trim();
      const question = cur.result?.questions?.find((q) => q.id === id);
      if (value) cur.answers[id] = value;
      else if (question) cur.answers[id] = question.default;
      else delete cur.answers[id];
    }
    const own = {};
    for (const input of form.querySelectorAll('[data-wow-run-default]')) {
      const id = input.getAttribute('data-wow-run-default');
      const value = input.value.trim();
      const f = RUN_DEFAULT_EDIT.find((x) => x.id === id);
      own[id] = !value ? null : f?.list ? value.split(',').map((s) => s.trim()).filter(Boolean) : value;
    }
    cur.editing = false;
    compose();
    saveRunDefaults(own);
  }

  // #735: the edited profile becomes the project's kind and run defaults (projects:update), so the run
  // dialog, the roadmap and the CLI start from it. Each field is written or null (projects.js drops a
  // null: a field left open, or cleared, takes what the engine derives again); `own`: the "Run
  // defaults" fields (base_branch, ui_folders, screenshots), the others kept as they were
  async function saveRunDefaults(own = {}) {
    const c = cur;
    const p = effectiveProfile();
    const runDefaults = { ...(c.project.runDefaults || {}), ...own };
    for (const [field, input] of Object.entries(RUN_DEFAULT_OF)) {
      runDefaults[input] = typeof p[field] === 'string' && p[field].trim() ? p[field].trim() : null;
    }
    runDefaults.e2e_tests = p.tests === 'unit' ? 'off' : null;
    if (p.tests === 'unit') runDefaults.e2e_command = null;
    const patch = { runDefaults };
    if (kindOptions().some(([k]) => k === c.answers.kind)) patch.kind = c.answers.kind;
    try {
      const saved = await api.updateProject(c.project.id, patch);
      c.project = { ...c.project, ...(saved || patch) };
      if (cur === c) showToast(t('ways_of_working.run_defaults_saved'));
    } catch (e) {
      if (cur === c) { c.error = errMsg(e); render(); }
    }
  }

  // #733: a call the service may lack (an older engine, a test's fake api) answers null
  async function maybe(method, args) {
    try { return typeof api[method] === 'function' ? await api[method](args) : null; } catch { return null; }
  }

  // #733: shows the saved analysis `last` ({ profile, evidence, questions, simulated, date, costUsd }) and composes its set
  async function showLast(c, last) {
    c.result = { profile: last.profile, evidence: last.evidence, questions: last.questions || [], simulated: last.simulated };
    c.last = { date: last.date, costUsd: last.costUsd };
    c.answers = Object.fromEntries((c.result.questions).map((q) => [q.id, q.default]));
    c.phase = 'ready';
    await compose();
  }

  function stopPoll(c) {
    if (c?.poll) clearInterval(c.poll);
    if (c) c.poll = null;
  }

  // #733: the loader follows the service's run state (workflows:interviewState) every second; a run this
  // drawer did not start (reopened during it) ends when the state does: the saved analysis is then shown
  function startPoll(c) {
    stopPoll(c);
    // no state to follow (an older engine, a page without timers): the loader stays as drawn
    if (typeof api.workflowInterviewState !== 'function' || typeof setInterval !== 'function') return;
    const tick = async () => {
      const s = await maybe('workflowInterviewState', { projectId: c.project.id });
      if (cur !== c || c.phase !== 'running') return;
      if (s?.running) c.run = s.running;
      else if (!c.own) {
        stopPoll(c);
        const last = await maybe('workflowInterviewLast', { projectId: c.project.id });
        if (cur !== c) return;
        if (last) { await showLast(c, last); return; }
        c.phase = s?.error ? 'error' : 'idle';
        c.error = s?.error || null;
      }
      render();
    };
    c.poll = setInterval(tick, 1000);
    tick();
  }

  async function analyze() {
    const c = cur;
    c.phase = 'running';
    c.own = true;
    c.error = null;
    c.startedAt = new Date().toISOString();
    c.run = null;
    render();
    startPoll(c);
    try {
      const out = await api.workflowInterview({ projectId: c.project.id });
      stopPoll(c);
      if (cur !== c) return;
      if (out?.refused) {
        c.phase = 'error';
        c.error = out.refused.text || t('ways_of_working.refused', { reason: out.refused.reason });
        render();
        return;
      }
      c.result = out;
      c.answers = Object.fromEntries((out.questions || []).map((q) => [q.id, q.default]));
      c.phase = 'ready';
      const last = await maybe('workflowInterviewLast', { projectId: c.project.id });
      if (cur !== c) return;
      c.last = last ? { date: last.date, costUsd: last.costUsd } : null;
    } catch (e) {
      stopPoll(c);
      if (cur !== c) return;
      c.phase = 'error';
      c.error = errMsg(e);
      render();
      return;
    } finally {
      c.own = false;
    }
    await compose();
  }

  function openBuilder() {
    const dev = cur.proposed?.workflows.find((w) => shownCategory(w.category) === 'development');
    if (!dev || typeof window.openSpecInBuilder !== 'function') return;
    close();
    window.openSpecInBuilder({ spec: dev.spec, mode: dev.mode, yaml: dev.yaml });
  }

  async function write() {
    const c = cur;
    const out = await compose({ write: true });
    if (!out?.written) return;
    showToast(t('ways_of_working.written', { count: out.workflows.length }));
    const box = document.querySelector('#project-workflows');
    if (box && window.ProjectWorkflows?.showPage) window.ProjectWorkflows.showPage(out.project || c.project, box);
  }

  function close() {
    if (!cur) return;
    stopPoll(cur);
    cur.el.remove();
    cur.backdrop.remove();
    document.removeEventListener('keydown', onKey, true);
    cur = null;
  }

  function onKey(e) {
    if (e.key !== 'Escape' || !cur) return;
    e.stopPropagation();
    close();
  }

  function onClick(e) {
    const el = e.target;
    if (el.closest('[data-wow-close]')) close();
    else if (el.closest('[data-wow-analyze]')) analyze();
    else if (el.closest('[data-wow-builder]')) openBuilder();
    else if (el.closest('[data-wow-write]')) write();
    else if (el.closest('[data-wow-edit-profile]') || el.closest('[data-wow-profile-cancel]')) {
      cur.editing = !!el.closest('[data-wow-edit-profile]');
      render();
    }
  }

  function onSubmit(e) {
    const form = e.target.closest('[data-wow-profile]');
    if (!form || !cur) return;
    e.preventDefault();
    saveProfile(form);
  }

  function onChange(e) {
    const id = e.target.getAttribute('data-wow-answer');
    if (!id || !cur) return;
    cur.answers[id] = e.target.type === 'number' ? Number(e.target.value) : e.target.value;
    compose();
  }

  /** Opens the interview of project `p` ({ id, name, folder }). */
  async function open(p) {
    close();
    const host = document.querySelector('#drawer')?.parentElement || document.body;
    const backdrop = document.createElement('div');
    backdrop.className = 'drawer-backdrop';
    const el = document.createElement('aside');
    el.className = 'drawer open wow-drawer';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-modal', 'true');
    el.setAttribute('aria-labelledby', 'wow-title');
    el.setAttribute('data-testid', 'ways-of-working-drawer');
    el.innerHTML = `<div class="drawer-head">
        <h2 class="drawer-title" id="wow-title">${t('ways_of_working.title', { name: esc(p.name || p.id) })}</h2>
        <button type="button" class="icon-btn" data-wow-close data-testid="ways-of-working-close" aria-label="${t('common.close')}" title="${t('common.close')}">
          <svg viewBox="0 0 24 24" aria-hidden="true"><line x1="6" y1="6" x2="18" y2="18" /><line x1="18" y1="6" x2="6" y2="18" /></svg>
        </button>
      </div>
      <div class="drawer-body"></div>
      <div class="drawer-foot"></div>`;
    host.append(backdrop, el);
    backdrop.onclick = close;
    el.addEventListener('click', onClick);
    el.addEventListener('change', onChange);
    el.addEventListener('submit', onSubmit);
    document.addEventListener('keydown', onKey, true);
    cur = { project: p, el, backdrop, estimate: undefined, phase: 'idle', error: null, result: null, answers: {}, proposed: null, composing: false, writing: false, editing: false, seq: 0, last: null, run: null, poll: null, own: false, startedAt: null, derived: null };
    const c = cur;
    render();
    // #735: what the engine derives for the run defaults (the "Run defaults" fields' placeholders)
    if (typeof api.projectInputHints === 'function') api.projectInputHints(p.id).then((h) => { if (cur === c) c.derived = h?.runDefaults || null; }, () => {});
    // #733: the cost, the last saved analysis and a run in progress, none of which runs anything
    const [estimate, last, state] = await Promise.all([
      maybe('seedEstimate', { projectId: p.id, seedId: 'ways-of-working' }),
      maybe('workflowInterviewLast', { projectId: p.id }),
      maybe('workflowInterviewState', { projectId: p.id }),
    ]);
    if (cur !== c) return;
    c.estimate = estimate;
    if (c.phase !== 'idle') { render(); return; } // Analyze was clicked meanwhile
    if (state?.running) {
      c.phase = 'running';
      c.run = state.running;
      render();
      startPoll(c);
    } else if (last) await showLast(c, last);
    else render();
  }

  window.ProjectWaysOfWorking = {
    close,
    open,
  };
})();
