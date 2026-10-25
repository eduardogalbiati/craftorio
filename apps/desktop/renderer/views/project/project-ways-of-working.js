/* global api */
// The Ways of working interview of a project (#487): a right drawer opened by the project page's
// "Ways of working" button (project.js). It shows the ways-of-working analysis's cost first
// (seeds:estimate), runs it on "Analyze" (workflows:interview: the seeds/ways-of-working seed, read-only),
// then shows the inferred profile with its evidence, the questions the analysis left open (each set to
// its default from the profile), and the proposed set (workflows:compose, recomposed on every answer).
// "Edit profile" lets the owner override any inferred field (answers named after the profile's fields).
// "Open in Builder" opens the development workflow in the Builder unsaved (window.openSpecInBuilder);
// "Write to the repository" writes the set to the project's .multiagent/ (uncommitted) and reloads the
// page's Workflows block. Nothing runs before "Analyze" and nothing is written before "Write".
// The drawer is added next to the Start drawer (#drawer) and removed when it closes. Uses app.js
// globals ($, esc, errMsg, showToast).

(function () {
  // the proposed workflow's category as the owner reads it: solo / team are the development workflow
  const shownCategory = (c) => (c === 'solo' || c === 'team' ? 'development' : c);
  // an open question's label (packages/engine/domains/workflow/workflow-compose.js openQuestions ids)
  const QUESTION_LABELS = {
    budget: 'ways_of_working.q_budget',
    merge: 'ways_of_working.q_merge',
    release: 'ways_of_working.q_release',
    review: 'ways_of_working.q_review',
    screenshots: 'ways_of_working.q_screenshots',
    team: 'ways_of_working.q_team',
    validate: 'ways_of_working.q_validate',
  };
  // the profile's fields the owner may override (packages/engine/domains/workflow/workflow-compose.js PROFILE_FIELDS): a fixed list is
  // a select (an empty value keeps the inferred one), a command or a list of languages is free text
  const PROFILE_EDIT = [
    { id: 'team', label: 'ways_of_working.q_team', options: [['solo', 'ways_of_working.solo'], ['team', 'ways_of_working.team']] },
    { id: 'merge', label: 'ways_of_working.q_merge', options: [['local', 'ways_of_working.merge_local'], ['pr', 'ways_of_working.merge_pr']] },
    { id: 'release', label: 'ways_of_working.q_release', options: [['milestone'], ['per-merge'], ['train'], ['rc-stable']] },
    { id: 'ci', label: 'ways_of_working.f_ci', options: [['github-actions'], ['gitlab-ci'], ['other']] },
    { id: 'testCommand', label: 'ways_of_working.f_test_command' },
    { id: 'checkCommand', label: 'ways_of_working.f_check_command' },
    { id: 'languages', label: 'ways_of_working.f_languages' },
  ];
  let cur = null; // { project, el, backdrop, estimate, phase, error, result, answers, proposed, composing, writing, editing, seq }

  const estimateText = (e) => (e?.free ? t('ways_of_working.estimate_free')
    : e?.costUsd != null ? t('ways_of_working.estimate_cost', { cost: Number(e.costUsd).toFixed(2) })
      : t('ways_of_working.no_estimate_yet'));

  // the inferred profile with the owner's answers of the same name (as workflow-compose.js withOverrides)
  function effectiveProfile() {
    const out = { ...(cur.result?.profile || {}) };
    for (const f of PROFILE_EDIT) {
      const v = cur.answers[f.id];
      if (v == null || (typeof v === 'string' && !v.trim())) continue;
      out[f.id] = f.id === 'languages' && !Array.isArray(v) ? String(v).split(',').map((s) => s.trim()).filter(Boolean) : v;
    }
    return out;
  }

  function profileLabels(p) {
    const merge = p.merge === 'pr' ? t('ways_of_working.merge_pr') : p.merge === 'local' ? t('ways_of_working.merge_local') : t('ways_of_working.open');
    const team = p.team === 'team' ? t('ways_of_working.team') : p.team === 'solo' ? t('ways_of_working.solo') : t('ways_of_working.open');
    const out = [`${team}: ${merge}`, `${t('ways_of_working.release')}: ${p.release || t('ways_of_working.open')}`];
    if (p.testCommand) out.push(`${t('ways_of_working.tests')}: ${p.testCommand}`);
    if (p.checkCommand) out.push(`${t('ways_of_working.check')}: ${p.checkCommand}`);
    if (p.ci) out.push(`CI: ${p.ci}`);
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
      : selectMarkup({ id, 'data-wow-answer': q.id }, (q.options || []).map((o) => [o.value, o.label]), value);
    return `<div class="field" data-testid="ways-of-working-question">
      <label for="${id}">${QUESTION_LABELS[q.id] ? t(QUESTION_LABELS[q.id]) : esc(q.label)}</label>
      ${control}
      <p class="hint">${esc(q.question)}</p>
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
        <div class="row">
          <button type="submit" class="btn primary" data-testid="ways-of-working-profile-save">${t('common.save')}</button>
          <button type="button" class="btn ghost" data-wow-profile-cancel data-testid="ways-of-working-profile-cancel">${t('common.cancel')}</button>
        </div>
      </form>`;
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

  function bodyHtml() {
    const est = `<p class="small" data-testid="ways-of-working-estimate">${t('ways_of_working.analysis_cost')} ${esc(cur.estimate === undefined ? '…' : estimateText(cur.estimate))}</p>`;
    if (cur.phase === 'idle') return `<p class="muted small">${t('ways_of_working.intro')}</p>${est}`;
    if (cur.phase === 'running') return `${est}<p class="small muted" role="status">${t('ways_of_working.analyzing')}</p>`;
    if (cur.phase === 'error') return `${est}<div class="usage-unavailable" role="alert">${esc(cur.error)}</div>`;
    const r = cur.result;
    return `<section class="wow-profile" data-testid="ways-of-working-profile" aria-label="${t('ways_of_working.profile')}">
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
      return `<button type="button" class="btn primary block" data-testid="ways-of-working-analyze" data-wow-analyze ${cur.phase === 'running' ? 'disabled' : ''}>${t('ways_of_working.analyze')}</button>
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
    cur.editing = false;
    compose();
  }

  async function analyze() {
    const c = cur;
    c.phase = 'running';
    render();
    try {
      const out = await api.workflowInterview({ projectId: c.project.id });
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
    } catch (e) {
      if (cur !== c) return;
      c.phase = 'error';
      c.error = errMsg(e);
      render();
      return;
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
    cur = { project: p, el, backdrop, estimate: undefined, phase: 'idle', error: null, result: null, answers: {}, proposed: null, composing: false, writing: false, editing: false, seq: 0 };
    const c = cur;
    render();
    let estimate = null;
    try { estimate = await api.seedEstimate({ projectId: p.id, seedId: 'ways-of-working' }); } catch { /* no estimate yet */ }
    if (cur !== c) return;
    c.estimate = estimate;
    render();
  }

  window.ProjectWaysOfWorking = {
    close,
    open,
  };
})();
