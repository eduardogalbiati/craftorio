/* global api */
// Night watch screen (#172): the switch with its required end time, the owner's permissions (what
// the Oracle may do without asking at night; the never-allowed actions locked), and each night's
// metrics from the Oracle's night log (packages/engine/domains/night/night-watch.js, channels nightwatch:*): the summary
// cards, a timeline of the window, the actions with their permission, backup and Undo, and a
// table to compare nights (and the baseline night). The sidebar entry shows a moon and the runs
// it watches while the watch is on; Home shows the morning summary (renderMorning).
// #278: under Self-healing (Settings › Execution › Oracle) the watch has no end time: the screen says
// "Self-healing is on" where the end time was, its switch is the setting, and each Self-healing day is
// a window of the report with its own counts (detected, repaired alone, waiting for you, cost).
// #337: the turn-on form's "Limits tonight" group (Expand all limits, a multiplier, Customize rows),
// the limits in force while the watch is on (nightwatch:limits), and the morning's runs past a day limit.
// Registers itself with registerView (view-registry.js); uses app.js globals ($, esc, state, api,
// errMsg, fmtDur, dateOf, confirmDialog, showView).

(() => {
  const nw = { state: null, report: null, error: null, form: null, perms: null, limits: null, night: 0, busy: false };
  const PRESET_HOURS = 8;
  // #273: times, days and the end-time field in the owner's zone (time-zone.js)
  const zone = () => (typeof TimeZone !== 'undefined' ? TimeZone.current() : undefined);
  const hm = (iso) => (iso ? new Date(iso).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: zone() }) : '—');
  const day = (iso) => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: zone() });
  const pct = (x) => (x == null ? '—' : `${Math.round(x * 100)}%`);
  const usd = (n) => (n == null ? '—' : `$${Number(n).toFixed(2)}`);
  const hours = (h) => (h == null ? '—' : `${Number(h).toFixed(1)} h`);
  const dur = (msv) => (msv == null ? '—' : fmtDur(Math.round(msv)));
  const localValue = (d) => TimeZone.inputValue(d, TimeZone.current());
  const defaultEnd = () => localValue(TimeZone.nextAt(7, 30, TimeZone.current()));
  const stat = (label, value, title = '', cls = '') => `<div class="u-stat${cls ? ` ${cls}` : ''}"${title ? ` title="${esc(title)}"` : ''}><label>${esc(label)}</label><b>${value}</b></div>`;
  const KIND = {
    'cost-gap': 'Cost gap', 'dispatch-idle': 'Dispatch idle', environment: 'Environment', failed: 'Failed run', interrupted: 'Interrupted', limit: 'Limit pause', memory: 'Memory guard',
    regression: 'Regression', repeat: 'Repeated failure', 'roadmap-empty': 'Roadmap empty', 'roadmap-paused': 'Roadmap paused', stalled: 'Stalled',
  };
  // #278: Self-healing (Settings › Execution › Oracle) keeps the watch on with no end time
  const healing = (w) => !!(w?.active && w.selfHealing);
  const openExecutionSettings = () => { showView('settings'); if (typeof showSettingsTab === 'function') showSettingsTab('execution'); };

  // ---- Limits tonight (#337): every run limit expanded while the Night watch is on -----------
  // nightwatch:state `limits` { day: { context, cost, duration, budget }, tonight: { multiplier } | { values } | null }
  const MULTIPLIERS = [1.5, 2, 3];
  const tokM = (n) => `${+(n / 1e6).toFixed(1)}M`;
  const dollars = (n) => `US$ ${+Number(n).toFixed(2)}`;
  const hrs = (msv) => `${+(msv / 3600e3).toFixed(1)}h`;
  // tonight's values from the settings ({ multiplier } | { values }): never below the day's; a limit the day does not set stays unset
  function tonightValues(day, t) {
    const m = Number(t?.multiplier) || 0;
    const v = t?.values || {};
    const pick = (k) => (day[k] ? Math.max(day[k], m ? day[k] * m : Number(v[k]) || 0) : 0);
    return { context: pick('context'), cost: pick('cost'), duration: pick('duration'), turns: Math.max(1, m || Number(v.turns) || 1), budget: pick('budget') };
  }
  // "×2 tonight: context 80M, cost US$ 240, duration 16h, turns ×2; nightly budget US$ 150"
  function limitsSummary(day, t) {
    if (!t) return 'Runs keep each workflow\'s limits';
    const x = tonightValues(day, t);
    const parts = [x.context && `context ${tokM(x.context)}`, x.cost && `cost ${dollars(x.cost)}`, x.duration && `duration ${hrs(x.duration)}`, `turns ×${x.turns}`].filter(Boolean);
    return `${t.multiplier ? `×${t.multiplier}` : 'Custom'} tonight: ${parts.join(', ')}${x.budget ? `; nightly budget ${dollars(x.budget)}` : ''}`;
  }
  const multiplierSelect = (value, placeholder = '') => `<select id="nw-limits-multiplier" data-testid="nw-limits-multiplier" aria-label="${t('nightwatch.multiplier_of_every_limit')}"${nw.limits?.saving || nw.form?.saving ? ' disabled' : ''}>
      ${placeholder ? `<option value="" selected disabled>${esc(placeholder)}</option>` : ''}${MULTIPLIERS.map((m) => `<option value="${m}"${!placeholder && Number(value) === m ? ' selected' : ''}>×${m}</option>`).join('')}
    </select>`;
  // Customize: one row per limit, the day value and tonight's (in M tokens, US$, hours, a factor, US$)
  const LIMIT_ROWS = [
    { id: 'context', label: 'Context per run', unit: 'M tokens', day: (d) => (d.context ? tokM(d.context) : 'no limit'), shown: (x) => x.context / 1e6, sent: (n) => n * 1e6 },
    { id: 'cost', label: 'Cost per run', unit: 'US$', day: (d) => (d.cost ? dollars(d.cost) : 'no limit'), shown: (x) => x.cost, sent: (n) => n },
    { id: 'duration', label: 'Duration per run', unit: 'hours', day: (d) => (d.duration ? hrs(d.duration) : 'no limit'), shown: (x) => x.duration / 3600e3, sent: (n) => n * 3600e3 },
    { id: 'turns', label: 'Agent turn timeouts', unit: '× each agent\'s own', day: () => '×1', shown: (x) => x.turns, sent: (n) => n },
    { id: 'budget', label: 'Nightly budget', unit: 'US$', day: (d) => (d.budget ? dollars(d.budget) : 'none'), shown: (x) => x.budget || '', sent: (n) => n },
  ];
  function limitRowsHtml(day, values, disabled) {
    const x = tonightValues(day, { values });
    return `<div class="nw-limit-rows">${LIMIT_ROWS.map((r) => `<div class="nw-limit-row" data-testid="nw-limits-row-${r.id}">
        <label for="nw-lim-${r.id}">${esc(r.label)}</label><span class="muted small">${t('nightwatch.day')} ${esc(r.day(day))}</span>
        <span class="row"><input type="number" class="s-num" id="nw-lim-${r.id}" data-nw-lim="${r.id}" min="0" step="any" value="${esc(r.shown(x) ? +Number(r.shown(x)).toFixed(2) : '')}"${disabled ? ' disabled' : ''} /><span class="muted small">${esc(r.unit)}</span></span>
      </div>`).join('')}</div>`;
  }
  // the custom values from the rows' inputs (renderer units → tokens, US$, ms, factor, US$)
  function readLimitRows(values) {
    const out = { ...values };
    document.querySelectorAll('[data-nw-lim]').forEach((input) => {
      const r = LIMIT_ROWS.find((x) => x.id === input.dataset.nwLim);
      const n = Number(input.value);
      if (r && Number.isFinite(n) && n > 0) out[r.id] = r.sent(n); else if (r) delete out[r.id];
    });
    return out;
  }
  // the turn-on form's group: the switch, the multiplier, Customize, the summary and the warning
  function limitsFormHtml(day, l, saving) {
    const t = !l.expand ? null : l.custom ? { values: l.values } : { multiplier: l.multiplier };
    return `<fieldset class="nw-limits" data-testid="nw-limits">
        <legend>${I18n.t('nightwatch.limits_tonight')}</legend>
        <div class="row">
          <label class="switch" title="${I18n.t('nightwatch.expand_every_run_limit_while_the')}"><input type="checkbox" id="nw-limits-expand" data-testid="nw-limits-expand" aria-label="${I18n.t('nightwatch.expand_all_limits')}"${l.expand ? ' checked' : ''}${saving ? ' disabled' : ''} /><span></span></label>
          <span>${I18n.t('nightwatch.expand_all_limits')}</span>
          ${l.expand && !l.custom ? multiplierSelect(l.multiplier) : ''}
          ${l.expand ? `<button type="button" class="link-btn" id="nw-limits-customize" data-testid="nw-limits-customize">${l.custom ? I18n.t('nightwatch.use_a_multiplier') : I18n.t('nightwatch.customize')}</button>` : ''}
        </div>
        <div class="muted small nw-limits-line" data-testid="nw-limits-summary">${esc(limitsSummary(day, t))}</div>
        ${l.expand && !day.budget ? `<p class="warn-text small nw-limits-warning" data-testid="nw-limits-warning">${I18n.t('nightwatch.no_nightly_budget_nothing_caps_tonight')}</p>` : ''}
        ${l.expand && l.custom ? limitRowsHtml(day, l.values, saving) : ''}
      </fieldset>`;
  }
  // while the watch is on: the limits in force, the multiplier saved at once, Customize with Save / Cancel
  function activeLimitsHtml(lim) {
    const t = lim.tonight;
    const edit = nw.limits;
    return `<div class="nw-active-limits" data-testid="nw-active-limits">
        <div class="row"><b class="small">${I18n.t('nightwatch.limits_tonight')}</b>
          ${multiplierSelect(t?.multiplier, t?.multiplier ? '' : t ? 'Custom' : 'Not expanded')}
          ${edit?.custom ? '' : `<button type="button" class="link-btn" id="nw-active-customize" data-testid="nw-limits-customize">${I18n.t('nightwatch.customize')}</button>`}</div>
        <div class="small nw-limits-line">${esc(limitsSummary(lim.day, t))}</div>
        ${!lim.day.budget ? `<p class="warn-text small nw-limits-warning" data-testid="nw-limits-warning">${I18n.t('nightwatch.no_nightly_budget_nothing_caps_tonight')}</p>` : ''}
        ${edit?.custom ? `${limitRowsHtml(lim.day, edit.values, edit.saving)}<div class="row">${edit.error ? `<p class="error small">${esc(edit.error)}</p>` : ''}<span class="spacer"></span><button class="btn ghost sm" type="button" id="nw-limits-cancel">${I18n.t('common.cancel')}</button><button class="btn primary sm" type="button" id="nw-limits-save"${edit.saving ? ' disabled' : ''}>${I18n.t('common.save')}</button></div>` : ''}
      </div>`;
  }
  async function saveLimits(limits) {
    nw.limits = { ...(nw.limits || {}), saving: true, error: null };
    render();
    try {
      nw.state = await api.setNightWatchLimits(limits);
      nw.limits = null;
    } catch (e) {
      // the rows keep what was typed, with the error; a multiplier refused shows on the screen
      if (nw.limits.custom) nw.limits = { ...nw.limits, saving: false, error: errMsg(e) };
      else { nw.limits = null; nw.error = errMsg(e); }
    }
    render();
  }
  function wireLimits() {
    const l = nw.form?.limits;
    if (l) {
      if ($('#nw-limits-expand')) $('#nw-limits-expand').onchange = (e) => { l.expand = !!e.target.checked; render(); };
      if ($('#nw-limits-multiplier')) $('#nw-limits-multiplier').onchange = (e) => { l.multiplier = Number(e.target.value) || 2; render(); };
      if ($('#nw-limits-customize')) {
        $('#nw-limits-customize').onclick = () => {
          if (!l.custom) l.values = { ...tonightValues(nw.state.limits.day, { multiplier: l.multiplier }) };
          l.custom = !l.custom;
          render();
        };
      }
      document.querySelectorAll('[data-nw-lim]').forEach((input) => { input.onchange = () => { l.values = readLimitRows(l.values); render(); }; });
      return;
    }
    if (!$('[data-testid="nw-active-limits"]')) return;
    if ($('#nw-limits-multiplier')) $('#nw-limits-multiplier').onchange = (e) => { if (Number(e.target.value)) saveLimits({ multiplier: Number(e.target.value) }); };
    if ($('#nw-active-customize')) $('#nw-active-customize').onclick = () => { nw.limits = { custom: true, values: { ...tonightValues(nw.state.limits.day, nw.state.limits.tonight) }, saving: false, error: null }; render(); };
    if ($('#nw-limits-cancel')) $('#nw-limits-cancel').onclick = () => { nw.limits = null; render(); };
    if ($('#nw-limits-save')) $('#nw-limits-save').onclick = () => saveLimits({ values: readLimitRows(nw.limits.values) });
  }

  async function load() {
    try {
      const [s, r] = await Promise.all([api.nightWatchState(), api.nightWatchReport()]);
      nw.state = s;
      nw.report = r;
      nw.error = null;
      // a night asked for by another screen (Analytics › 24/7, #188): its window's start
      if (nw.open) {
        const i = (r?.nights || []).findIndex((m) => Date.parse(m.window?.from) === Date.parse(nw.open));
        if (i >= 0) nw.night = i;
        nw.open = null;
      }
    } catch (e) { nw.error = errMsg(e); }
    render();
    renderBadge();
  }

  // ---- the sidebar entry's moon --------------------------------------------------------------
  function renderBadge() {
    const b = $('#nav-nightwatch-badge');
    if (!b) return;
    const w = nw.state?.watch;
    b.classList.toggle('hidden', !w?.active);
    if (w?.active) {
      const n = nw.state.runs?.active || 0;
      b.textContent = `☾ ${n}`;
      b.title = `${healing(w) ? t('nightwatch.self_healing_is_on') : t('nightwatch.night_watch_on_until', { until: hm(w.until) })}: ${t('nightwatch.watching_runs', { count: n })}`;
    }
  }
  async function refreshBadge() {
    try { nw.state = await api.nightWatchState(); } catch { return; }
    renderBadge();
    if (state.view === 'nightwatch' && !nw.form && !nw.perms && !nw.limits) render();
  }

  // ---- (1) the switch and the permissions ----------------------------------------------------
  function switchHtml(s) {
    const w = s.watch || {};
    const f = nw.form;
    // under Self-healing the watch has no end time and its switch is the setting
    const standing = healing(w);
    const watching = `${t('nightwatch.watching_runs', { count: s.runs.active })}${s.runs.waiting ? t('nightwatch.at_a_gate_count', { count: s.runs.waiting }) : ''}`;
    const switchTitle = t(standing ? 'nightwatch.self_healing_keeps_the_watch_on' : w.active ? 'nightwatch.turn_the_night_watch_off' : 'nightwatch.turn_the_night_watch_on_end_time');
    const headline = standing ? `<b data-testid="nightwatch-self-healing">${t('nightwatch.self_healing_is_on')}</b>` : `<b>${w.active ? t('nightwatch.on_until_until', { until: esc(hm(w.until)) }) : t('nightwatch.off')}</b>`;
    const head = `<div class="row nw-switch-row">
        <label class="switch" title="${switchTitle}"><input type="checkbox" id="nw-switch" data-testid="nightwatch-switch" aria-label="${t('nightwatch.night_watch')}"${w.active || f ? ' checked' : ''}${nw.busy || standing ? ' disabled' : ''} /><span></span></label>
        <div class="nw-switch-state">
          <div class="row nw-headline">${headline}${w.active ? `<span class="badge live">${t('nightwatch.watching')}</span>` : ''}</div>
          <div class="muted small">${standing
            ? `${t('nightwatch.day_and_night_no_end_time')}${w.startedAt ? t('nightwatch.since_startedat', { startedAt: esc(dateOf(w.startedAt)) }) : ''} · ${watching} · <button type="button" class="link-btn" id="nw-open-settings" title="${t('nightwatch.self_healing_is_a_switch_in')}">${t('nightwatch.turn_it_off_in_settings')}</button>`
            : w.active
              ? t('nightwatch.turned_on_by_at', { by: w.by ? esc(w.by) : t('nightwatch.the_owner'), startedAt: esc(hm(w.startedAt)), watching })
              : w.startedAt ? t(w.by ? 'nightwatch.last_on_by' : 'nightwatch.last_on', { date: esc(dateOf(w.startedAt)), by: esc(w.by) }) : t('nightwatch.never_turned_on_in_this_workspace')}</div>
        </div>
      </div>${w.active && !standing && s.limits ? activeLimitsHtml(s.limits) : ''}`;
    const form = f ? `<form class="nw-form" id="nw-form">
        <div class="field">
          <label for="nw-until">${t('nightwatch.until')}</label>
          <div class="row"><input type="datetime-local" id="nw-until" value="${esc(f.until)}"${f.saving ? ' disabled' : ''} /><button class="btn ghost sm" type="button" id="nw-preset">${t('nightwatch.until_preset_hours_h_from_now', { PRESET_HOURS })}</button></div>
          <div class="hint">${t('nightwatch.an_end_time_is_required_at')}</div>
          ${f.error ? `<p class="error small">${esc(f.error)}</p>` : ''}
        </div>
        ${s.limits && f.limits ? limitsFormHtml(s.limits.day, f.limits, f.saving) : ''}
        <div class="row"><button class="btn primary sm" type="submit"${f.saving ? ' disabled' : ''}>${t('nightwatch.turn_on')}</button><button class="btn ghost sm" type="button" id="nw-form-cancel">${t('common.cancel')}</button></div>
      </form>` : '';
    return `<div class="card nw-card">${head}${form}</div>`;
  }

  function permissionsHtml(s) {
    const p = s.permissions;
    const edit = nw.perms;
    const allowed = new Set(edit ? edit.allowed : p.allowed);
    const rows = p.catalog.map((x) => `<label class="s-row nw-perm">
        <div class="nw-perm-text"><b>${esc(x.label)}</b><div class="muted small nw-cut" title="${esc(`${x.does} ${x.undo}`)}">${esc(x.does)}</div><div class="muted small nw-cut nw-undo" title="${esc(x.undo)}">↶ ${esc(x.undo)}</div></div>
        <input type="checkbox" class="nw-perm-check" data-perm="${esc(x.id)}"${allowed.has(x.id) ? ' checked' : ''}${edit?.saving ? ' disabled' : ''} />
      </label>`).join('');
    const never = p.never.map((x) => `<span class="badge nw-never" title="${t('nightwatch.never_allowed_under_the_night_watch')}">🔒 ${esc(x.label)}</span>`).join('');
    const saved = p.defaults ? 'Defaults: retry and refresh only.' : `Saved ${esc(dateOf(p.updatedAt))}.`;
    return `<div class="card nw-card" data-testid="nw-permissions">
      <div class="row nw-card-head"><h3>${t('nightwatch.what_the_oracle_may_do_without')}</h3><span class="muted small" title="${t('nightwatch.one_checklist_for_the_night_watch')}">${saved} ${t('nightwatch.an_item_gets_at_most_loopcap', { loopCap: s.loopCap })}</span></div>
      <div class="s-group nw-perms">${rows}</div>
      ${edit ? `<div class="row nw-perm-actions">${edit.error ? `<p class="error small">${esc(edit.error)}</p>` : ''}<span class="spacer"></span><button class="btn ghost sm" type="button" id="nw-perm-cancel">${t('common.cancel')}</button><button class="btn primary sm" type="button" id="nw-perm-save"${edit.saving ? ' disabled' : ''}>${t('common.save')}</button></div>` : ''}
      <h4 class="muted small nw-never-title">${t('nightwatch.never_allowed')}</h4>
      <div class="row nw-never-list" data-testid="nw-never-allowed">${never}</div>
    </div>`;
  }

  // ---- (2) the night's summary cards ---------------------------------------------------------
  function summaryHtml(m) {
    const s = m.safety;
    const idle = m.idleHours;
    const kinds = Object.entries(m.incidents.byKind).filter(([, n]) => n).map(([k, n]) => `${esc(KIND[k] || k)} <b>${n}</b>`).join('<span>·</span>') || t('nightwatch.none'); // i18n-ignore
    // #278: a Self-healing day (a UTC day of the standing watch) leads with its own counts
    const sh = m.selfHealing;
    const title = sh ? `Self-healing · ${m.window.ongoing ? 'today so far' : 'day'}` : m.window.ongoing ? 'Tonight so far' : 'Night';
    return `<div class="card nw-card">
      <div class="row nw-card-head"><h3>${title} · ${esc(day(m.window.from))} ${esc(hm(m.window.from))} → ${esc(hm(m.window.to))}</h3><span class="muted small">${hours(m.window.hours)} · ${sh ? t('nightwatch.the_utc_day_day', { day: esc(sh.day) }) : t('nightwatch.turned_on_by', { by: m.window.by ? esc(m.window.by) : t('nightwatch.the_owner') })}</span></div>
      ${s.alarm ? `<div class="nw-alarm" role="alert"><b>${t('nightwatch.safety_alarm')}</b> ${esc(m.summary.safety)}</div>` : ''}
      ${sh ? `<div class="an-totals nw-totals" data-testid="nw-self-healing-day">
        ${stat(t('nightwatch.detected'), String(sh.detected), t('nightwatch.what_the_watch_and_its_detectors'))}
        ${stat(t('nightwatch.repaired_alone'), String(sh.repaired), t('nightwatch.actions_the_oracle_took_without_asking'))}
        ${stat(t('nightwatch.waiting_for_you'), String(sh.waiting), t('nightwatch.left_for_you_outside_the_permissions'))}
        ${stat(t('nightwatch.oracle_cost'), usd(sh.costUsd), t('nightwatch.value_tokens_that_day', { value: sh.tokens.toLocaleString('en-US') }))}
      </div>` : ''}
      <div class="an-totals nw-totals">
        ${stat(t('nightwatch.incidents'), String(m.incidents.count))}
        ${stat(t('nightwatch.autonomy'), pct(m.autonomy), t('nightwatch.actions_the_watch_took_without_asking'))}
        ${stat(t('nightwatch.escalated'), pct(m.escalation), t('nightwatch.incidents_left_for_you_with_a'))}
        ${stat(t('nightwatch.resolved'), pct(m.resolution), t('nightwatch.resolved_without_a_person_the_item'))}
        ${stat(t('nightwatch.ttd_median'), dur(m.ttd.median), t('nightwatch.time_to_detect_p90_p90_the', { p90: dur(m.ttd.p90), ttdMs: dur(nw.report.baseline.ttdMs) }))}
        ${stat(t('nightwatch.ttr_median'), dur(m.ttr.median), t('nightwatch.time_to_resume_after_detection_whoever', { p90: dur(m.ttr.p90), ttrMs: dur(nw.report.baseline.ttrMs) }))}
        ${stat(t('nightwatch.hours_saved_est'), hours(m.hoursSaved), t('nightwatch.estimate_without_the_watch_each_block'))}
        ${stat(t('nightwatch.watch_cost'), usd(m.cost.watchUsd), t('nightwatch.value_tokens_perresolved_per_resolved_incident', { value: m.cost.watchTokens.toLocaleString('en-US'), perResolved: usd(m.cost.perResolved), runsUsd: usd(m.cost.runsUsd) }))}
        ${stat(t('nightwatch.safety'), s.alarm ? 'ALARM' : 'OK', m.summary.safety, s.alarm ? 'nw-bad' : 'nw-good')}
      </div>
      <div class="u-breakdown nw-facts">
        <span>${t('nightwatch.by_kind')} ${kinds}</span>
        <span>${t('nightwatch.idle')} <b>${hours(idle.total)}</b>${t('nightwatch.no_work_nowork_blocked_blocked_at', { noWork: hours(idle.noWork), blocked: hours(idle.blocked), gate: hours(idle.gate) })} ${hours(idle.other)}</span>
        <span>${t('nightwatch.occupancy')} <b>${pct(m.yield.occupancy)}</b> ${t('nightwatch.without_the_watch_occupancywithoutwatch', { occupancyWithoutWatch: pct(m.yield.occupancyWithoutWatch) })}</span>
        <span>${t('nightwatch.issues_delivered')} <b>${m.yield.issues}</b></span>
        <span>${t('nightwatch.unblocked')} <b>${m.unblocked.issues}</b> ${t('nightwatch.issue_s_value_lines', { value: m.unblocked.lines == null ? '—' : m.unblocked.lines.toLocaleString('en-US') })} ${usd(m.unblocked.usd)}</span>
        <span>${t('nightwatch.gates')} <b>${m.gates.count}</b>${t('nightwatch.waited')} ${dur(m.gates.waitMs)}${m.gates.count ? t('nightwatch.schedule_gated_items_in_the_day') : ''}</span>
        <span>${t('nightwatch.precision')} <b>${pct(m.precision)}</b> ${t('nightwatch.undone_undone_worse_ended_worse', { undone: m.actions.undone, worse: m.actions.worse })}</span>
        <span>${t('nightwatch.false_alarms')} <b>${pct(m.falseAlarms)}</b></span>
        <span>${t('nightwatch.loops')} <b>${m.loops.length}</b>${m.loops.length ? ` (${m.loops.map((l) => `${esc(l.target)} ×${l.count}`).join(', ')})` : ''}</span>
        <span>${t('nightwatch.blocked_outside_permissions')} <b>${s.blockedOutsidePermissions}</b></span>
        <span>${t('nightwatch.content_instructions_refused')} <b>${s.contentRefused}</b></span>
      </div>
      <div class="nw-morning muted small"><b>${t('nightwatch.morning_summary')}</b> ${m.summary.selfHealing ? `${esc(m.summary.selfHealing)} ` : ''}${esc(m.summary.ran)} ${esc(m.summary.did)} ${esc(m.summary.waits)}</div>
    </div>`;
  }

  // ---- (3) the timeline of the window ----------------------------------------------------------
  function timelineHtml(m) {
    const a = Date.parse(m.window.from);
    const span = Math.max(1, Date.parse(m.window.to) - a);
    const x = (iso) => Math.min(100, Math.max(0, ((Date.parse(iso) - a) / span) * 100));
    const runs = m.timeline.runs.map((r) => `<div class="nw-tl-run st-${esc(r.status)}" style="left:${x(r.from)}%;width:${Math.max(0.4, x(r.to) - x(r.from))}%" title="${esc(r.runId)}: ${esc(hm(r.from))} → ${esc(hm(r.to))} (${esc(r.status)})"></div>`);
    const lanes = [];
    // stack overlapping runs in lanes
    m.timeline.runs.forEach((r, i) => {
      const lane = lanes.findIndex((l) => l.end <= Date.parse(r.from));
      if (lane < 0) lanes.push({ end: Date.parse(r.to), items: [runs[i]] });
      else { lanes[lane].end = Date.parse(r.to); lanes[lane].items.push(runs[i]); }
    });
    const marks = (list, cls, label) => list.map((e) => `<span class="nw-tl-mark ${cls}${e.resolved || e.ok === false ? ` ${e.resolved ? 'ok' : 'bad'}` : ''}" style="left:${x(e.at)}%" title="${esc(hm(e.at))} ${esc(label(e))}"></span>`).join('');
    return `<div class="card nw-card">
      <div class="row nw-card-head"><h3>${t('nightwatch.timeline')}</h3><div class="an-legend nw-legend"><span><i class="nw-l-run"></i>${t('nightwatch.run_active')}</span><span><i class="nw-l-inc"></i>${t('nightwatch.incident')}</span><span><i class="nw-l-act"></i>${t('nightwatch.watch_action')}</span></div></div>
      <div class="nw-tl">
        ${lanes.map((l) => `<div class="nw-tl-lane">${l.items.join('')}</div>`).join('') || `<div class="nw-tl-lane muted small">${t('nightwatch.no_run_in_this_window')}</div>`}
        <div class="nw-tl-lane nw-tl-marks">${marks(m.timeline.incidents, 'inc', (e) => `${KIND[e.kind] || e.kind}: ${e.target}${e.resolved ? ' (resolved)' : ''}`)}</div>
        <div class="nw-tl-lane nw-tl-marks">${marks(m.timeline.actions, 'act', (e) => `${e.title}${e.auto ? '' : ' (your click)'}`)}</div>
      </div>
      <div class="row nw-tl-axis muted small"><span>${esc(hm(m.window.from))}</span><span>${esc(hm(new Date(a + span / 2).toISOString()))}</span><span>${esc(hm(m.window.to))}</span></div>
    </div>`;
  }

  // ---- (4) the actions ---------------------------------------------------------------------
  function actionsHtml(m) {
    const rows = m.actionList.map((a) => `<tr>
        <td class="nowrap">${esc(hm(a.at))}</td>
        <td class="nw-cut" title="${esc(a.title)}"><b>${esc(a.title)}</b><div class="muted small nw-cut" title="${esc(a.result)}">${esc(a.result)}</div></td>
        <td>${a.auto ? `<span class="badge">${esc(a.permission || '?')}</span>` : `<span class="badge" title="${t('nightwatch.you_clicked_do_it')}">${t('nightwatch.your_click')}</span>`}</td>
        <td class="muted small nw-cut" title="${esc(a.backup || '')}">${esc(a.backup || '—')}</td>
        <td><span class="pill pill-${a.undone ? 'cancelled' : a.ok ? 'success' : 'failed'}">${a.undone ? 'undone' : a.ok ? 'done' : 'failed'}</span></td>
        <td class="num">${a.undoable ? `<button class="btn ghost sm" type="button" data-nw-undo="${esc(a.actionId)}" title="${t('nightwatch.put_the_backup_back')}">${t('common.undo')}</button>`
    : a.from ? `<button class="btn ghost sm" type="button" data-nw-app-back="${esc(a.from)}" data-testid="app-update-back" title="${t('nightwatch.the_same_cycle_as_the_update')}">${t('nightwatch.go_back_to')} ${esc(String(a.from).slice(0, 7))}</button>` : ''}</td>
      </tr>`).join('');
    return `<div class="card nw-card">
      <div class="row nw-card-head"><h3>${t('nightwatch.actions')}</h3><span class="muted small">${m.actions.auto} ${t('nightwatch.without_asking')}${m.actions.undone ? t('nightwatch.undone_undone', { undone: m.actions.undone }) : ''}</span></div>
      ${rows ? `<table class="u-table nw-actions"><thead><tr><th>${t('nightwatch.time')}</th><th>${t('nightwatch.action')}</th><th>${t('nightwatch.permission')}</th><th>${t('nightwatch.backup')}</th><th>${t('nightwatch.result')}</th><th></th></tr></thead><tbody>${rows}</tbody></table>` : `<p class="muted small">${t('nightwatch.the_watch_took_no_action_this')}</p>`}
    </div>`;
  }

  // ---- (5) the nights ----------------------------------------------------------------------
  function nightsHtml(r) {
    const b = r.baseline;
    const rows = r.nights.map((m, i) => `<tr class="nw-night${i === nw.night ? ' selected' : ''}" data-nw-night="${i}" tabindex="0" title="${t('nightwatch.show_this_night_above')}">
        <td class="nowrap">${esc(day(m.window.from))} ${esc(hm(m.window.from))} → ${esc(hm(m.window.to))}${m.selfHealing ? ` <span class="badge" title="${t('nightwatch.a_self_healing_day_utc_day', { day: esc(m.selfHealing.day), detected: m.selfHealing.detected, repaired: m.selfHealing.repaired, waiting: m.selfHealing.waiting })}">${t('nightwatch.self_healing')}</span>` : ''}</td>
        <td class="num">${hours(m.window.hours)}</td><td class="num">${pct(m.yield.occupancy)}</td><td class="num">${hours(m.idleHours.total)}</td><td class="num">${hours(m.idleHours.noWork)}</td>
        <td class="num">${m.incidents.count}</td><td class="num">${pct(m.resolution)}</td><td class="num">${dur(m.ttd.median)}</td><td class="num">${dur(m.ttr.median)}</td>
        <td class="num">${hours(m.hoursSaved)}</td><td class="num">${usd(m.cost.watchUsd)}</td>
        <td>${m.safety.alarm ? `<span class="pill pill-failed">${t('nightwatch.alarm')}</span>` : `<span class="pill pill-success">${t('nightwatch.ok')}</span>`}</td>
      </tr>`).join('');
    return `<div class="card nw-card">
      <div class="row nw-card-head"><h3>${t('nightwatch.nights')}</h3><span class="muted small">${t('nightwatch.click_a_night_or_a_self')}</span></div>
      <table class="u-table nw-nights"><thead><tr><th>${t('nightwatch.window')}</th><th class="num">${t('nightwatch.hours')}</th><th class="num">${t('nightwatch.occupancy_2')}</th><th class="num">${t('nightwatch.idle_2')}</th><th class="num">${t('nightwatch.no_work')}</th><th class="num">${t('nightwatch.incidents')}</th><th class="num">${t('nightwatch.resolved')}</th><th class="num">${t('nightwatch.ttd')}</th><th class="num">${t('nightwatch.ttr')}</th><th class="num">${t('nightwatch.saved_est')}</th><th class="num">${t('nightwatch.watch')}</th><th>${t('nightwatch.safety')}</th></tr></thead>
      <tbody>${rows}
        <tr class="nw-baseline" title="${t('nightwatch.diario_do_orchestrator_the_night_before')}"><td>${esc(b.label)}</td><td class="num">${hours(b.hours)}</td><td class="num">${pct(b.activeHours / b.hours)}</td><td class="num">${hours(b.idleHours)}</td><td class="num">${hours(b.idleNoWorkHours)}</td><td class="num">—</td><td class="num">—</td><td class="num">${dur(b.ttdMs)}</td><td class="num">${dur(b.ttrMs)}</td><td class="num">—</td><td class="num">—</td><td>—</td></tr>
      </tbody></table>
    </div>`;
  }

  function render() {
    const box = $('#nw-body');
    if (!box) return;
    $('#btn-nw-replay').classList.toggle('hidden', !nw.state?.simulation);
    if (nw.error && !nw.state) { box.innerHTML = `<div class="empty-state"><b>${t('nightwatch.the_night_watch_could_not_load')}</b><p class="error small">${esc(nw.error)}</p><button class="btn ghost" id="nw-retry">${t('nightwatch.try_again')}</button></div>`; $('#nw-retry').onclick = load; return; }
    if (!nw.state) { box.innerHTML = `<p class="muted">${t('nightwatch.loading')}</p>`; return; }
    if (!nw.state.oracle) { box.innerHTML = `<div class="empty-state"><b>${t('nightwatch.night_watch_needs_the_oracle_122')}</b><p class="muted">${t('nightwatch.the_oracle_watches_the_runs_and')}</p></div>`; return; }
    const r = nw.report || { nights: [] };
    const m = r.nights[nw.night] || r.nights[0];
    box.innerHTML = `
      ${nw.error ? `<p class="error small">${esc(nw.error)}</p>` : ''}
      <div class="nw-top">${switchHtml(nw.state)}${permissionsHtml(nw.state)}</div>
      ${m ? `${summaryHtml(m)}${timelineHtml(m)}${actionsHtml(m)}${nightsHtml(r)}`
        : `<div class="empty-state"><b>${t('nightwatch.no_night_yet')}</b><p class="muted">${t('nightwatch.turn_the_watch_on_before_you')}</p></div>`}`;
    wire();
  }

  function wire() {
    const sw = $('#nw-switch');
    sw.onchange = async () => {
      if (nw.state.watch?.active) {
        sw.checked = true;
        if (!await confirmDialog(t('nightwatch.turn_the_night_watch_off'), t('nightwatch.the_oracle_stops_acting_without_asking'), t('nightwatch.turn_off'))) return;
        nw.busy = true;
        try { await api.setOracleNightWatch({ on: false, from: 'the Night watch screen' }); } catch (e) { nw.error = errMsg(e); }
        nw.busy = false;
        await load();
        return;
      }
      nw.form = sw.checked ? { until: defaultEnd(), error: null, saving: false, limits: { expand: false, multiplier: 2, custom: false, values: {} } } : null;
      render();
    };
    wireLimits();
    if ($('#nw-open-settings')) $('#nw-open-settings').onclick = openExecutionSettings;
    if (nw.form) {
      $('#nw-preset').onclick = () => { nw.form = { ...nw.form, until: localValue(new Date(Date.now() + PRESET_HOURS * 3600e3)), error: null }; render(); };
      $('#nw-form-cancel').onclick = () => { nw.form = null; render(); };
      $('#nw-until').onchange = (e) => { nw.form.until = e.target.value; };
      $('#nw-form').onsubmit = async (e) => {
        e.preventDefault();
        const until = nw.form.until ? new Date(TimeZone.parseInput(nw.form.until, TimeZone.current())) : null;
        if (!until || !(until > new Date())) { nw.form = { ...nw.form, error: 'Pick an end time in the future.' }; render(); return; }
        nw.form = { ...nw.form, saving: true, error: null };
        render();
        const l = nw.form.limits;
        try {
          await api.setOracleNightWatch({ on: true, until: until.toISOString(), from: 'the Night watch screen' });
          nw.form = null;
        } catch (err) { nw.form = { ...nw.form, saving: false, error: errMsg(err) }; }
        // #337: the watch is on: tonight's limits, when expanded (a refusal shows on the screen; the watch stays on)
        if (!nw.form && l?.expand) {
          try { await api.setNightWatchLimits(l.custom ? { values: l.values } : { multiplier: l.multiplier }); } catch (err) { nw.error = `Limits tonight: ${errMsg(err)}`; }
        }
        await load();
      };
    }
    document.querySelectorAll('.nw-perm-check').forEach((c) => {
      c.onchange = () => {
        const set = new Set(nw.perms ? nw.perms.allowed : nw.state.permissions.allowed);
        if (c.checked) set.add(c.dataset.perm); else set.delete(c.dataset.perm);
        nw.perms = { allowed: [...set], error: null, saving: false };
        render();
      };
    });
    if (nw.perms) {
      $('#nw-perm-cancel').onclick = () => { nw.perms = null; render(); };
      $('#nw-perm-save').onclick = async () => {
        nw.perms = { ...nw.perms, saving: true };
        render();
        try { nw.state = await api.saveNightWatchPermissions(nw.perms.allowed); nw.perms = null; } catch (e) { nw.perms = { ...nw.perms, saving: false, error: errMsg(e) }; }
        render();
      };
    }
    document.querySelectorAll('[data-nw-undo]').forEach((b) => {
      b.onclick = async () => {
        if (!await confirmDialog(t('nightwatch.undo_this_action'), t('nightwatch.the_backup_taken_before_the_action'), t('common.undo'))) return;
        try { await api.oracleUndo({ actionId: b.dataset.nwUndo }); nw.error = null; } catch (e) { nw.error = errMsg(e); }
        await load();
      };
    });
    document.querySelectorAll('[data-nw-app-back]').forEach((b) => {
      b.onclick = async () => {
        const to = b.dataset.nwAppBack;
        if (!await confirmDialog(t('nightwatch.go_back_to_value', { value: to.slice(0, 7) }), t('nightwatch.the_roadmap_pauses_the_runs_in'), t('nightwatch.go_back'))) return;
        try { await api.appUpdateBack(to); nw.error = null; } catch (e) { nw.error = errMsg(e); }
        await load();
      };
    });
    document.querySelectorAll('[data-nw-night]').forEach((row) => {
      const pick = () => { nw.night = Number(row.dataset.nwNight); render(); };
      row.onclick = pick;
      row.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(); } };
    });
  }

  // ---- Home's morning summary ----------------------------------------------------------------
  // renderDashboard runs on every run event: the summary is fetched at most once a minute.
  // Answers the summary shown ({ window, summary }, #255: Home dates "Cost last night" by its window) or null.
  const morning = { at: 0, value: null };
  async function renderMorning(box) {
    if (!box || !api.nightWatchMorning) return null;
    if (Date.now() - morning.at > 60e3) {
      morning.at = Date.now();
      try { morning.value = await api.nightWatchMorning(); } catch { morning.value = null; }
    }
    const m = morning.value;
    box.classList.toggle('hidden', !m);
    if (!m) { box.innerHTML = ''; return null; }
    const s = m.summary;
    // #278: a Self-healing day leads with its line (detected, repaired alone, waiting, cost with tokens)
    box.innerHTML = `<div class="dash-gates-title"><b>☾ ${m.window.selfHealing ? t('nightwatch.self_healing') : t('nightwatch.night_watch')} · ${esc(hm(m.window.from))} → ${esc(hm(m.window.to))}</b>${s.alarm ? ` <span class="pill pill-failed">${t('nightwatch.safety_alarm_2')}</span>` : ''}</div>
      <div class="nw-dash-lines small">${s.selfHealing ? `<div data-testid="dash-self-healing">${esc(s.selfHealing)}</div>` : ''}<div>${esc(s.ran)}</div><div>${esc(s.did)}</div><div>${esc(s.waits)}</div><div class="${s.alarm ? 'error' : 'muted'}">${esc(s.safety)}</div>${regressionLines(s)}${limitLines(s)}</div>
      <div class="row"><span class="spacer"></span><button class="btn sm ghost" type="button" id="dash-nw-open">${t('nightwatch.open_night_watch')}</button></div>`;
    $('#dash-nw-open').onclick = () => showView('nightwatch');
    box.querySelectorAll('[data-testid="nw-regression-run"]').forEach((b) => { b.onclick = () => window.showRun(b.dataset.run); });
    return m;
  }
  // #335: one line per step whose cost or minutes regressed (led by the step and the rise), with a
  // link to each run behind it (its recent window); none: nothing. Report only: no other control.
  const runLabel = (id) => {
    const t = String(id).match(/^(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})/);
    return t ? `${t[2]}/${t[3]} ${t[4]}:${t[5]}` : String(id);
  };
  function regressionLines(s) {
    return (s.regressions || []).map((line, i) => `<div class="nw-regression" data-testid="nw-regression">${esc(line)} <span class="pill pill-cancelled">${t('nightwatch.regression')}</span>${(s.regressionRuns?.[i] || []).map((id) => ` <button class="btn sm ghost" type="button" data-testid="nw-regression-run" data-run="${esc(id)}" title="${t('nightwatch.open_run_id', { id: esc(id) })}" aria-label="${t('nightwatch.open_run_id', { id: esc(id) })}">${esc(runLabel(id))}</button>`).join('')}</div>`).join('');
  }
  // #337: one line per run that went past a day limit under tonight's limits, then what the night
  // spent above the day cost limits
  function limitLines(s) {
    if (!s.limits?.length) return '';
    return `${s.limits.map((line) => `<div class="nw-past-limit" data-testid="nw-past-limit">${esc(line)} <span class="badge warn">${t('nightwatch.past_a_day_limit')}</span></div>`).join('')}${s.overDayUsd ? `<div class="muted" data-testid="nw-over-day">${esc(t('nightwatch.spent_above_the_day_limits_overdayusd', { overDayUsd: dollars(s.overDayUsd) }))}</div>` : ''}`;
  }
  // opens the view on the night that started at `startedAt` (ISO)
  function openNight(startedAt) {
    nw.open = startedAt || null;
    showView('nightwatch');
  }
  window.NightWatchView = {
    openNight,
    renderMorning,
  };

  registerView({
    id: 'nightwatch',
    nav: { label: 'Night watch', order: 105, title: 'Night watch: what the Oracle may do while you are away, and how each night went', icon: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" /></svg>' },
    markup: () => `
      <section id="view-nightwatch" class="view hidden">
        <div class="page-head">
          <div>
            <h1>${t('nightwatch.night_watch')}</h1>
            <p class="muted small">${t('nightwatch.while_you_are_away_the_oracle')}</p>
          </div>
          <div class="row"><button id="btn-nw-replay" class="btn ghost hidden" title="${t('nightwatch.simulated_mode_writes_two_demo_nights')}">${t('nightwatch.replay_a_sample_night')}</button></div>
        </div>
        <div id="nw-body"></div>
      </section>`,
    mount() {
      const item = $('nav.sidebar .nav-item[data-view="nightwatch"]');
      item?.insertAdjacentHTML('beforeend', '<span id="nav-nightwatch-badge" class="nav-badge nw-moon hidden"></span>');
      $('#btn-nw-replay').onclick = async () => {
        try { nw.report = await api.replayNightWatch(); nw.night = 0; nw.error = null; } catch (e) { nw.error = errMsg(e); }
        await load();
      };
      api.onOracleChanged?.(refreshBadge);
      setInterval(refreshBadge, 30e3);
      refreshBadge();
    },
    show: load,
  });
})();
