// Monitor › Errors (#634, spec R12, mockup docs/work/first-project-onboarding/images/mock-8.jpg): the
// project's production errors, grouped with no model by the Monitor area
// (packages/engine/fronts/ai/areas/monitor.js, channels monitor:*). A row: status, title, message · where, a
// sparkline of the last hour, count · window, its state (new → Diagnose; intent in Inbox → Propose fix,
// the badge opens the card; fix run · waiting for you → the badge opens the run, stopped at its gate).
// The header lists the sources ("Sources…" adds one: Sentry with its token in the keychain, a log
// URL or a log file); the line under the list is the automation (Ask me / On / Off, a daily cap).
// "webhook" opens its dialog (on with a new key, its URL shown once; off); the daily budget comes in a
// later phase: shown disabled.
// #650 (spec R16): a new group's "no item" select ties it to a work item of docs/work (the Documents'
// items, api.listDocItems); Diagnose then also records the incident in that item's maintain.md.
(function () {
  const MODES = ['ask', 'on', 'off'];
  const CAPS = [1, 3, 5, 10, 20];
  const TYPES = ['sentry', 'log-url', 'log-file'];
  const PATH_EXAMPLE = '/var/log/api.log'; // i18n-ignore: an example path, not language
  const URL_EXAMPLE = 'https://'; // i18n-ignore: an example URL, not language
  const er = { projectId: null, data: null, error: null, busy: null, type: 'sentry', items: null, tied: {} };

  const modeLabel = (m) => ({ ask: t('errors.mode_ask'), on: t('errors.mode_on'), off: t('errors.mode_off') })[m] || m;
  const typeLabel = (k) => ({ sentry: t('errors.type_sentry'), 'log-url': t('errors.type_log_url'), 'log-file': t('errors.type_log_file') })[k] || k;
  const projectName = (id) => (state.projects || []).find((p) => p.id === id)?.name || id || '';

  // the span the count covers, first to last event: 1h, 24h, else days
  function windowOf(g) {
    const span = (Date.parse(g.lastSeen) || 0) - (Date.parse(g.firstSeen) || 0);
    if (!(span > 3600e3)) return t('errors.window_hours', { n: 1 });
    if (span <= 24 * 3600e3) return t('errors.window_hours', { n: 24 });
    return t('errors.window_days', { n: Math.ceil(span / (24 * 3600e3)) });
  }

  function sparkline(spark) {
    const bars = Array.isArray(spark) && spark.length ? spark : [0, 0, 0, 0, 0, 0];
    const max = Math.max(1, ...bars);
    return `<span class="err-spark" aria-hidden="true">${bars.map((n) => `<i style="height:${n ? Math.max(2, Math.round((n / max) * 16)) : 2}px"${n ? '' : ' class="none"'}></i>`).join('')}</span>`;
  }

  function stateBadge(g) {
    if (g.state === 'fix-run' && g.runId) return `<button type="button" class="err-state fix-run" data-testid="monitor-error-state" data-action="open-run" data-run="${esc(g.runId)}" title="${esc(t('errors.open_the_fix_run'))}">${t('errors.state_fix_run')}</button>`;
    if (g.state === 'intent' && g.cardId) return `<button type="button" class="err-state intent" data-testid="monitor-error-state" data-action="open-card" data-card="${esc(g.cardId)}" title="${esc(t('errors.open_the_intent'))}">${t('errors.state_intent')}</button>`;
    return `<span class="err-state new" data-testid="monitor-error-state">${t('errors.state_new')}</span>`;
  }

  function actionOf(g) {
    const busy = er.busy === g.fingerprint ? ' disabled' : '';
    if (g.state === 'intent') return `<button type="button" class="btn sm" data-action="propose-fix" data-fingerprint="${esc(g.fingerprint)}"${busy}>${t('errors.propose_fix')}</button>`;
    if (g.state === 'new') return `<button type="button" class="btn sm" data-action="diagnose" data-fingerprint="${esc(g.fingerprint)}"${busy}>${t('errors.diagnose')}</button>`;
    return '<span class="err-action-none"></span>';
  }

  // #650: a new group is tied to a work item of the project's docs/work (Documents' items, by title)
  // before Diagnose: the diagnosis then also records the incident in that item's maintain.md
  function itemSelect(g) {
    if (g.state !== 'new') return '<span class="err-item-none"></span>';
    const items = er.items || [];
    const chosen = er.tied[g.fingerprint] || '';
    const options = [['', t('errors.no_item')], ...items.map((it) => [it.item, it.title || it.item])];
    const attrs = `class="err-item" data-testid="monitor-item-select" data-fingerprint="${esc(g.fingerprint)}" aria-label="${esc(t('errors.tie_to_item'))}" title="${esc(t('errors.tie_to_item'))}"${er.items && items.length ? '' : ' disabled'}`;
    return window.Select.markup(attrs, options, chosen);
  }

  function row(g) {
    const detail = [g.message, g.where].filter(Boolean).join(' · ');
    return `<div class="err-row" data-testid="monitor-error-row" data-fingerprint="${esc(g.fingerprint)}">
      <span class="err-status">${esc(String(g.status ?? 'ERR'))}</span>
      <div class="err-main"><div class="err-title" title="${esc(g.title)}">${esc(g.title)}</div> <div class="err-detail" title="${esc(detail)}">${esc(detail)}</div></div>
      ${sparkline(g.spark)}
      <span class="err-count">${esc(String(g.count))} · ${esc(windowOf(g))}</span>
      <span class="err-state-cell">${stateBadge(g)}</span>
      <span class="err-item-cell">${itemSelect(g)}</span>
      <span class="err-action">${actionOf(g)}</span>
    </div>`;
  }

  function automationLine(a) {
    const auto = a || { diagnose: 'ask', fix: 'off', dailyCap: 5 };
    const mode = (key) => `<button type="button" class="err-link" data-action="mode" data-key="${key}" title="${esc(t('errors.change_mode'))}">(${modeLabel(auto[key])})</button>`;
    return `<div class="err-automation" data-testid="monitor-automation">
      ${t('errors.automation')} ${t('errors.diagnose_new_groups')} ${mode('diagnose')} · ${t('errors.fix_runs')} ${mode('fix')} ·
      <button type="button" class="err-link" data-action="cap" title="${esc(t('errors.change_daily_cap'))}">${esc(t('errors.at_most_diagnoses_a_day', { count: auto.dailyCap }))}</button> ·
      <button type="button" class="err-link" disabled title="${esc(t('errors.daily_budget_later'))}">${t('errors.daily_budget')}</button> ·
      <button type="button" class="err-link" data-action="webhook" data-testid="monitor-webhook" title="${esc(t('errors.webhook_title'))}">${t(er.data?.webhook?.enabled ? 'errors.webhook_on' : 'errors.webhook')}</button>
    </div>`;
  }

  // the Webhook… dialog: on (a new key, its URL shown this once) or off
  function showWebhook(path) {
    const on = !!er.data?.webhook?.enabled;
    $('#ew-state').textContent = on ? t('errors.webhook_state_on') : t('errors.webhook_state_off');
    $('#ew-state').className = `err-source${on ? ' ok' : ''}`;
    const base = /^https?:/.test(location.origin) ? location.origin : '';
    $('#ew-url').value = path ? `${base}${path}` : '';
    $('#ew-url-field').classList.toggle('hidden', !path);
    $('#btn-ew-on').textContent = on ? t('errors.webhook_new_key') : t('errors.webhook_turn_on');
    $('#btn-ew-off').classList.toggle('hidden', !on);
    $('#ew-error').textContent = '';
  }
  async function setWebhook(enable) {
    try {
      const res = await api.monitorWebhook({ projectId: er.projectId, enable });
      if (er.data) er.data.webhook = { enabled: !!res?.enabled };
      showWebhook(res?.path || null);
      render();
    } catch (e) {
      $('#ew-error').textContent = errMsg(e);
    }
  }

  function sourceChip(s) {
    const cls = s.error ? 'err' : s.polledAt ? 'ok' : '';
    const label = s.label || typeLabel(s.type);
    const text = s.polledAt && !s.error
      ? t('errors.source_polled', { label, ago: fmtRelative(s.polledAt) })
      : t('errors.source_every', { label, n: s.every || 5 });
    return `<span class="err-source ${cls}" title="${esc(s.error || typeLabel(s.type))}">${esc(text)}</span>`;
  }

  function render() {
    const body = $('#errors-body');
    if (!body) return;
    const lead = $('#errors-lead');
    if (lead) lead.textContent = t('errors.lead', { project: projectName(er.projectId) });
    const d = er.data;
    const chips = $('#errors-sources');
    if (chips) chips.innerHTML = (d?.sources || []).map(sourceChip).join('') || `<span class="err-source">${t('errors.no_source')}</span>`;
    if (!er.projectId) { body.innerHTML = `<p class="muted">${t('errors.choose_a_project')}</p>`; return; }
    if (er.error) { body.innerHTML = `<p class="error small">${esc(t('errors.could_not_read', { error: er.error }))}</p>`; return; }
    if (!d) { body.innerHTML = `<p class="muted small">${t('errors.loading')}</p>`; return; }
    const groups = d.groups || [];
    const list = groups.length
      ? `<div class="err-list">${groups.map(row).join('')}</div>`
      : `<div class="err-list err-empty muted">${d.sources?.length ? t('errors.no_errors_yet') : t('errors.no_source_yet')}</div>`;
    body.innerHTML = `${list}${automationLine(d.automation)}`;
  }

  async function load() {
    er.projectId = (await CurrentProject.resolve?.()) || CurrentProject.get();
    er.error = null;
    if (er.projectId) {
      try { er.data = (await api.monitorState({ projectId: er.projectId })) || { groups: [], sources: [], automation: null }; } catch (e) { er.error = errMsg(e); }
      // #650 the items an error can be tied to (the plan front's Documents may not be served: none)
      try {
        const items = await api.listDocItems?.(er.projectId);
        er.items = Array.isArray(items) ? items : [];
      } catch { er.items = []; }
    }
    render();
    refreshBadge();
  }

  function refreshBadge() {
    const badge = $('#nav-errors-badge');
    if (!badge) return;
    const fresh = (er.data?.groups || []).some((g) => g.state === 'new');
    badge.classList.toggle('hidden', !fresh);
    badge.textContent = t('errors.state_new');
  }

  async function act(btn) {
    const projectId = er.projectId;
    const { action, fingerprint } = btn.dataset;
    if (action === 'open-run') return window.showRun(btn.dataset.run);
    if (action === 'open-card') return window.InboxActions?.openCard(btn.dataset.card);
    if (action === 'webhook') { showWebhook(null); return openModal('#errors-webhook-modal'); }
    const auto = er.data?.automation || { diagnose: 'ask', fix: 'off', dailyCap: 5 };
    let res;
    try {
      if (action === 'diagnose' || action === 'propose-fix') {
        er.busy = fingerprint;
        render();
        res = action === 'diagnose'
          ? await api.monitorDiagnose({ projectId, fingerprint, item: er.tied[fingerprint] || null })
          : await api.monitorProposeFix({ projectId, fingerprint });
      } else if (action === 'mode') {
        const key = btn.dataset.key;
        const next = MODES[(MODES.indexOf(auto[key]) + 1) % MODES.length];
        res = await api.monitorAutomation({ projectId, ...auto, [key]: next });
      } else if (action === 'cap') {
        const next = CAPS.find((n) => n > auto.dailyCap) ?? CAPS[0];
        res = await api.monitorAutomation({ projectId, ...auto, dailyCap: next });
      } else return undefined;
      if (res && res.ok === false) window.showToast?.(t('errors.action_failed'), res.error || '');
      else if (action === 'propose-fix') window.showToast?.(t('errors.fix_run_started'), '', res?.runId || null);
    } catch (e) {
      window.showToast?.(t('errors.action_failed'), errMsg(e));
    } finally {
      er.busy = null;
    }
    return load();
  }

  // the Sources… dialog: the type as a segmented toggle, its own fields, the token only for Sentry
  function showType(type) {
    er.type = type;
    for (const b of document.querySelectorAll('#errors-source-type button')) b.classList.toggle('active', b.dataset.type === type);
    for (const f of document.querySelectorAll('#errors-sources-modal [data-for]')) f.classList.toggle('hidden', !f.dataset.for.split(' ').includes(type));
  }
  function openSources() {
    const list = $('#errors-sources-list');
    list.innerHTML = (er.data?.sources || []).map((s) => `<li><span>${esc(s.label || typeLabel(s.type))}</span> <span class="badge">${esc(typeLabel(s.type))}</span>${s.type === 'sentry' ? ` <span class="badge ${s.hasToken ? '' : 'warn'}">${s.hasToken ? t('errors.token_in_keychain') : t('errors.no_token')}</span>` : ''}</li>`).join('')
      || `<li class="muted">${t('errors.no_source_yet')}</li>`;
    for (const id of ['#es-label', '#es-path', '#es-url', '#es-org', '#es-project', '#es-token']) $(id).value = '';
    $('#es-error').textContent = '';
    showType(er.type);
    openModal('#errors-sources-modal');
  }
  async function saveSource(e) {
    e.preventDefault();
    const val = (id) => $(id).value.trim();
    const source = { type: er.type, label: val('#es-label') || undefined };
    if (er.type === 'log-file') source.path = val('#es-path');
    if (er.type === 'log-url') source.url = val('#es-url');
    if (er.type === 'sentry') Object.assign(source, { org: val('#es-org'), project: val('#es-project'), token: $('#es-token').value || undefined });
    try {
      const res = await api.monitorSaveSource({ projectId: er.projectId, source });
      if (res?.ok === false) { $('#es-error').textContent = res.error || t('errors.could_not_save'); return; }
      closeModal('#errors-sources-modal');
      await api.monitorPoll({ projectId: er.projectId });
    } catch (err) {
      $('#es-error').textContent = errMsg(err);
      return;
    }
    await load();
  }

  registerView({
    id: 'errors',
    nav: { label: 'Errors', group: 'monitor', order: 100, title: 'Errors: production errors, grouped; a new group becomes an intent in the Inbox', icon: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3 2 20h20L12 3z" /><path d="M12 10v4M12 17v.5" /></svg>' },
    markup: () => `
      <section id="view-errors" class="view hidden">
        <div class="page-head">
          <div>
            <h1>${t('errors.errors')}</h1>
            <p id="errors-lead" class="muted small err-lead"></p>
          </div>
          <div class="row err-head-actions">
            <div id="errors-sources" class="err-sources" data-testid="monitor-sources"></div>
            <button type="button" id="btn-errors-sources" class="btn ghost">${t('errors.sources')}</button>
          </div>
        </div>
        <div id="errors-body"></div>
      </section>`,
    modals: () => `
  <div id="errors-sources-modal" class="modal hidden" role="dialog" aria-modal="true" aria-labelledby="errors-sources-title">
    <form id="errors-sources-form" class="modal-card">
      <h3 id="errors-sources-title">${t('errors.error_sources')}</h3>
      <ul id="errors-sources-list" class="err-sources-list small"></ul>
      <div class="field">
        <label>${t('errors.add_a_source')}</label>
        <div id="errors-source-type" class="seg sm" role="group" aria-label="${t('errors.source_type')}">${TYPES.map((k) => `<button type="button" data-type="${k}">${typeLabel(k)}</button>`).join('')}</div>
      </div>
      <div class="field"><label for="es-label">${t('errors.label')}</label><input type="text" id="es-label" placeholder="${t('errors.label_placeholder')}" /></div>
      <div class="field" data-for="log-file"><label for="es-path">${t('errors.log_file')}</label><input type="text" id="es-path" class="mono" placeholder="${PATH_EXAMPLE}" /><span class="muted small">${t('errors.log_help')}</span></div>
      <div class="field" data-for="log-url"><label for="es-url">${t('errors.log_url')}</label><input type="text" id="es-url" class="mono" placeholder="${URL_EXAMPLE}" /><span class="muted small">${t('errors.log_help')}</span></div>
      <div class="err-grid" data-for="sentry">
        <div class="field"><label for="es-org">${t('errors.sentry_org')}</label><input type="text" id="es-org" /></div>
        <div class="field"><label for="es-project">${t('errors.sentry_project')}</label><input type="text" id="es-project" /></div>
      </div>
      <div class="field" data-for="sentry"><label for="es-token">${t('errors.sentry_token')}</label><input type="password" id="es-token" autocomplete="off" /><span class="muted small">${t('errors.token_help')}</span></div>
      <p id="es-error" class="error small"></p>
      <div class="modal-actions">
        <span class="spacer"></span>
        <button type="button" id="btn-es-cancel" class="btn ghost">${t('common.cancel')}</button>
        <button type="submit" class="btn primary">${t('errors.add_source')}</button>
      </div>
    </form>
  </div>
  <div id="errors-webhook-modal" class="modal hidden" role="dialog" aria-modal="true" aria-labelledby="errors-webhook-title">
    <div class="modal-card">
      <h3 id="errors-webhook-title">${t('errors.webhook_dialog')} <span id="ew-state" class="err-source"></span></h3>
      <p class="muted small">${t('errors.webhook_help')}</p>
      <div id="ew-url-field" class="field hidden"><label for="ew-url">${t('errors.webhook_url')}</label><input type="text" id="ew-url" class="mono" readonly data-testid="monitor-webhook-url" /><span class="muted small">${t('errors.webhook_url_help')}</span></div>
      <p id="ew-error" class="error small"></p>
      <div class="modal-actions">
        <button type="button" id="btn-ew-off" class="btn ghost hidden">${t('errors.webhook_turn_off')}</button>
        <span class="spacer"></span>
        <button type="button" id="btn-ew-close" class="btn ghost">${t('common.close')}</button>
        <button type="button" id="btn-ew-on" class="btn primary" data-testid="monitor-webhook-on"></button>
      </div>
    </div>
  </div>`,
    mount() {
      const item = $('nav.sidebar .nav-item[data-view="errors"]');
      item?.insertAdjacentHTML('beforeend', '<span id="nav-errors-badge" class="nav-badge err-nav-new hidden"></span>');
      $('#errors-body').addEventListener('click', async (e) => {
        const btn = e.target?.closest?.('button[data-action]');
        if (btn && !btn.disabled) await act(btn);
      });
      $('#errors-body').addEventListener('change', (e) => {
        const sel = e.target?.closest?.('select[data-testid="monitor-item-select"]');
        if (sel) er.tied[sel.dataset.fingerprint] = sel.value;
      });
      $('#btn-errors-sources').onclick = openSources;
      const seg = $('#errors-source-type');
      if (seg) seg.onclick = (e) => { const b = e.target?.closest?.('button[data-type]'); if (b) showType(b.dataset.type); };
      const form = $('#errors-sources-form');
      if (form) form.onsubmit = saveSource;
      const cancel = $('#btn-es-cancel');
      if (cancel) cancel.onclick = () => closeModal('#errors-sources-modal');
      const hook = (id, fn) => { const b = $(id); if (b) b.onclick = fn; };
      hook('#btn-ew-on', () => setWebhook(true));
      hook('#btn-ew-off', () => setWebhook(false));
      hook('#btn-ew-close', () => closeModal('#errors-webhook-modal'));
    },
    show: load,
  });
})();
