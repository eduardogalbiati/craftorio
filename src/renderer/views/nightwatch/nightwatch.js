/* global api */
// Night watch screen (#172): the switch with its required end time, the owner's permissions (what
// the Oracle may do without asking at night; the never-allowed actions locked), and each night's
// metrics from the Oracle's night log (src/night-watch.js, channels nightwatch:*): the summary
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
    return { context: pick('context'), cost: pick('cost'), duration: pick('duration'), turns: Math.max(1, m || Number(v.turns) || 1), budget: day.budget ? Math.max(day.budget, m ? day.budget * m : Number(v.budget) || 0) : Number(v.budget) || 0 };
  }
  // "×2 tonight: context 80M, cost US$ 240, duration 16h, turns ×2; nightly budget US$ 150"
  function limitsSummary(day, t) {
    if (!t) return 'Runs keep each workflow\'s limits';
    const x = tonightValues(day, t);
    const parts = [x.context && `context ${tokM(x.context)}`, x.cost && `cost ${dollars(x.cost)}`, x.duration && `duration ${hrs(x.duration)}`, `turns ×${x.turns}`].filter(Boolean);
    return `${t.multiplier ? `×${t.multiplier}` : 'Custom'} tonight: ${parts.join(', ')}${x.budget ? `; nightly budget ${dollars(x.budget)}` : ''}`;
  }
  const multiplierSelect = (value, placeholder = '') => `<select id="nw-limits-multiplier" data-testid="nw-limits-multiplier" aria-label="Multiplier of every limit"${nw.limits?.saving || nw.form?.saving ? ' disabled' : ''}>
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
        <label for="nw-lim-${r.id}">${esc(r.label)}</label><span class="muted small">Day ${esc(r.day(day))}</span>
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
        <legend>Limits tonight</legend>
        <div class="row">
          <label class="switch" title="Expand every run limit while the watch is on"><input type="checkbox" id="nw-limits-expand" data-testid="nw-limits-expand" aria-label="Expand all limits"${l.expand ? ' checked' : ''}${saving ? ' disabled' : ''} /><span></span></label>
          <span>Expand all limits</span>
          ${l.expand && !l.custom ? multiplierSelect(l.multiplier) : ''}
          ${l.expand ? `<button type="button" class="link-btn" id="nw-limits-customize" data-testid="nw-limits-customize">${l.custom ? 'Use a multiplier' : 'Customize'}</button>` : ''}
        </div>
        <div class="muted small nw-cut" data-testid="nw-limits-summary" title="${esc(limitsSummary(day, t))}">${esc(limitsSummary(day, t))}</div>
        ${l.expand && !day.budget ? '<p class="warn-text small nw-limits-warning" data-testid="nw-limits-warning">No nightly budget: nothing caps tonight\'s spending</p>' : ''}
        ${l.expand && l.custom ? limitRowsHtml(day, l.values, saving) : ''}
      </fieldset>`;
  }
  // while the watch is on: the limits in force, the multiplier saved at once, Customize with Save / Cancel
  function activeLimitsHtml(lim) {
    const t = lim.tonight;
    const edit = nw.limits;
    return `<div class="nw-active-limits" data-testid="nw-active-limits">
        <div class="row"><span class="small"><b>Limits tonight</b> · <span class="nw-cut" title="${esc(limitsSummary(lim.day, t))}">${esc(limitsSummary(lim.day, t))}</span></span>
          ${multiplierSelect(t?.multiplier, t?.multiplier ? '' : t ? 'Custom' : 'Not expanded')}
          ${edit?.custom ? '' : '<button type="button" class="link-btn" id="nw-active-customize" data-testid="nw-limits-customize">Customize</button>'}</div>
        ${!lim.day.budget ? '<p class="warn-text small nw-limits-warning" data-testid="nw-limits-warning">No nightly budget: nothing caps tonight\'s spending</p>' : ''}
        ${edit?.custom ? `${limitRowsHtml(lim.day, edit.values, edit.saving)}<div class="row">${edit.error ? `<p class="error small">${esc(edit.error)}</p>` : ''}<span class="spacer"></span><button class="btn ghost sm" type="button" id="nw-limits-cancel">Cancel</button><button class="btn primary sm" type="button" id="nw-limits-save"${edit.saving ? ' disabled' : ''}>Save</button></div>` : ''}
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
      b.title = `${healing(w) ? 'Self-healing is on' : `Night watch on until ${hm(w.until)}`}: watching ${n} run${n === 1 ? '' : 's'}`;
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
    const watching = `watching ${s.runs.active} run${s.runs.active === 1 ? '' : 's'}${s.runs.waiting ? `, ${s.runs.waiting} at a gate` : ''}`;
    const switchTitle = standing ? 'Self-healing keeps the watch on: turn it off in Settings › Execution › Oracle' : w.active ? 'Turn the Night watch off' : 'Turn the Night watch on (an end time is required)';
    const headline = standing ? '<b data-testid="nightwatch-self-healing">Self-healing is on</b>' : `<b>${w.active ? `On until ${esc(hm(w.until))}` : 'Off'}</b>`;
    const head = `<div class="row nw-switch-row">
        <label class="switch" title="${switchTitle}"><input type="checkbox" id="nw-switch" data-testid="nightwatch-switch" aria-label="Night watch"${w.active || f ? ' checked' : ''}${nw.busy || standing ? ' disabled' : ''} /><span></span></label>
        <div class="nw-switch-state">
          <div class="row nw-headline">${headline}${w.active ? '<span class="badge live">☾ watching</span>' : ''}</div>
          <div class="muted small">${standing
            ? `Day and night, with no end time${w.startedAt ? `, since ${esc(dateOf(w.startedAt))}` : ''} · ${watching} · <button type="button" class="link-btn" id="nw-open-settings" title="Self-healing is a switch in Settings › Execution › Oracle">Turn it off in Settings</button>`
            : w.active
              ? `Turned on by ${esc(w.by || 'the owner')} at ${esc(hm(w.startedAt))} · ${watching}`
              : w.startedAt ? `Last on ${esc(dateOf(w.startedAt))}${w.by ? ` by ${esc(w.by)}` : ''}` : 'Never turned on in this workspace'}</div>
        </div>
      </div>${w.active && !standing && s.limits ? activeLimitsHtml(s.limits) : ''}`;
    const form = f ? `<form class="nw-form" id="nw-form">
        <div class="field">
          <label for="nw-until">Until</label>
          <div class="row"><input type="datetime-local" id="nw-until" value="${esc(f.until)}"${f.saving ? ' disabled' : ''} /><button class="btn ghost sm" type="button" id="nw-preset">Until ${PRESET_HOURS} h from now</button></div>
          <div class="hint">An end time is required (at most 24 hours). Until then the Oracle does only what the permissions below allow; everything else waits for your click.</div>
          ${f.error ? `<p class="error small">${esc(f.error)}</p>` : ''}
        </div>
        ${s.limits && f.limits ? limitsFormHtml(s.limits.day, f.limits, f.saving) : ''}
        <div class="row"><button class="btn primary sm" type="submit"${f.saving ? ' disabled' : ''}>Turn on</button><button class="btn ghost sm" type="button" id="nw-form-cancel">Cancel</button></div>
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
    const never = p.never.map((x) => `<span class="badge nw-never" title="Never allowed, under the Night watch or Self-healing: it always needs you">🔒 ${esc(x.label)}</span>`).join('');
    const saved = p.defaults ? 'Defaults: retry and refresh only.' : `Saved ${esc(dateOf(p.updatedAt))}.`;
    return `<div class="card nw-card" data-testid="nw-permissions">
      <div class="row nw-card-head"><h3>What the Oracle may do without asking</h3><span class="muted small" title="One checklist for the Night watch and for Self-healing (Settings › Execution › Oracle)">${saved} An item gets at most ${s.loopCap} watch actions a night (a day under Self-healing); the next one is left for you.</span></div>
      <div class="s-group nw-perms">${rows}</div>
      ${edit ? `<div class="row nw-perm-actions">${edit.error ? `<p class="error small">${esc(edit.error)}</p>` : ''}<span class="spacer"></span><button class="btn ghost sm" type="button" id="nw-perm-cancel">Cancel</button><button class="btn primary sm" type="button" id="nw-perm-save"${edit.saving ? ' disabled' : ''}>Save</button></div>` : ''}
      <h4 class="muted small nw-never-title">Never allowed</h4>
      <div class="row nw-never-list" data-testid="nw-never-allowed">${never}</div>
    </div>`;
  }

  // ---- (2) the night's summary cards ---------------------------------------------------------
  function summaryHtml(m) {
    const s = m.safety;
    const idle = m.idleHours;
    const kinds = Object.entries(m.incidents.byKind).filter(([, n]) => n).map(([k, n]) => `${esc(KIND[k] || k)} <b>${n}</b>`).join('<span>·</span>') || 'none';
    // #278: a Self-healing day (a UTC day of the standing watch) leads with its own counts
    const sh = m.selfHealing;
    const title = sh ? `Self-healing · ${m.window.ongoing ? 'today so far' : 'day'}` : m.window.ongoing ? 'Tonight so far' : 'Night';
    return `<div class="card nw-card">
      <div class="row nw-card-head"><h3>${title} · ${esc(day(m.window.from))} ${esc(hm(m.window.from))} → ${esc(hm(m.window.to))}</h3><span class="muted small">${hours(m.window.hours)} · ${sh ? `the UTC day ${esc(sh.day)}` : `turned on by ${esc(m.window.by || 'the owner')}`}</span></div>
      ${s.alarm ? `<div class="nw-alarm" role="alert"><b>Safety alarm.</b> ${esc(m.summary.safety)}</div>` : ''}
      ${sh ? `<div class="an-totals nw-totals" data-testid="nw-self-healing-day">
        ${stat('Detected', String(sh.detected), 'what the watch and its detectors found that day')}
        ${stat('Repaired alone', String(sh.repaired), 'actions the Oracle took without asking, under your permissions, that did not fail')}
        ${stat('Waiting for you', String(sh.waiting), 'left for you: outside the permissions, asked by content, past the loop cap, or a human gate')}
        ${stat('Oracle cost', usd(sh.costUsd), `${sh.tokens.toLocaleString('en-US')} tokens that day`)}
      </div>` : ''}
      <div class="an-totals nw-totals">
        ${stat('Incidents', String(m.incidents.count))}
        ${stat('Autonomy', pct(m.autonomy), 'actions the watch took without asking / incidents (can pass 100% when one incident needed several actions)')}
        ${stat('Escalated', pct(m.escalation), 'incidents left for you with a recommendation / incidents')}
        ${stat('Resolved', pct(m.resolution), 'resolved without a person: the item progressed again within 30 min of the action and did not fail')}
        ${stat('TTD median', dur(m.ttd.median), `time to detect: p90 ${dur(m.ttd.p90)} (the human reference: ${dur(nw.report.baseline.ttdMs)})`)}
        ${stat('TTR median', dur(m.ttr.median), `time to resume after detection, whoever unblocked it: p90 ${dur(m.ttr.p90)} (the human reference: ${dur(nw.report.baseline.ttrMs)})`)}
        ${stat('Hours saved (est.)', hours(m.hoursSaved), 'Estimate: without the watch, each block would last until the owner wakes up (the end of the window)')}
        ${stat('Watch cost', usd(m.cost.watchUsd), `${m.cost.watchTokens.toLocaleString('en-US')} tokens; ${usd(m.cost.perResolved)} per resolved incident; the runs cost ${usd(m.cost.runsUsd)} that night`)}
        ${stat('Safety', s.alarm ? 'ALARM' : 'OK', m.summary.safety, s.alarm ? 'nw-bad' : 'nw-good')}
      </div>
      <div class="u-breakdown nw-facts">
        <span>by kind: ${kinds}</span>
        <span>idle <b>${hours(idle.total)}</b>: no work ${hours(idle.noWork)}, blocked ${hours(idle.blocked)}, at a gate ${hours(idle.gate)}, other ${hours(idle.other)}</span>
        <span>occupancy <b>${pct(m.yield.occupancy)}</b> (without the watch ${pct(m.yield.occupancyWithoutWatch)})</span>
        <span>issues delivered <b>${m.yield.issues}</b></span>
        <span>unblocked <b>${m.unblocked.issues}</b> issue(s), ${m.unblocked.lines == null ? '—' : m.unblocked.lines.toLocaleString('en-US')} lines, ${usd(m.unblocked.usd)}</span>
        <span>gates <b>${m.gates.count}</b>, waited ${dur(m.gates.waitMs)}${m.gates.count ? ' (schedule gated items in the day)' : ''}</span>
        <span>precision <b>${pct(m.precision)}</b> (${m.actions.undone} undone, ${m.actions.worse} ended worse)</span>
        <span>false alarms <b>${pct(m.falseAlarms)}</b></span>
        <span>loops <b>${m.loops.length}</b>${m.loops.length ? ` (${m.loops.map((l) => `${esc(l.target)} ×${l.count}`).join(', ')})` : ''}</span>
        <span>blocked outside permissions <b>${s.blockedOutsidePermissions}</b></span>
        <span>content instructions refused <b>${s.contentRefused}</b></span>
      </div>
      <div class="nw-morning muted small"><b>Morning summary.</b> ${m.summary.selfHealing ? `${esc(m.summary.selfHealing)} ` : ''}${esc(m.summary.ran)} ${esc(m.summary.did)} ${esc(m.summary.waits)}</div>
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
      <div class="row nw-card-head"><h3>Timeline</h3><div class="an-legend nw-legend"><span><i class="nw-l-run"></i>run active</span><span><i class="nw-l-inc"></i>incident</span><span><i class="nw-l-act"></i>watch action</span></div></div>
      <div class="nw-tl">
        ${lanes.map((l) => `<div class="nw-tl-lane">${l.items.join('')}</div>`).join('') || '<div class="nw-tl-lane muted small">No run in this window.</div>'}
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
        <td>${a.auto ? `<span class="badge">${esc(a.permission || '?')}</span>` : '<span class="badge" title="You clicked Do it">your click</span>'}</td>
        <td class="muted small nw-cut" title="${esc(a.backup || '')}">${esc(a.backup || '—')}</td>
        <td><span class="pill pill-${a.undone ? 'cancelled' : a.ok ? 'success' : 'failed'}">${a.undone ? 'undone' : a.ok ? 'done' : 'failed'}</span></td>
        <td class="num">${a.undoable ? `<button class="btn ghost sm" type="button" data-nw-undo="${esc(a.actionId)}" title="Put the backup back">Undo</button>`
    : a.from ? `<button class="btn ghost sm" type="button" data-nw-app-back="${esc(a.from)}" data-testid="app-update-back" title="The same cycle as the update: pause, wait for the runs, move the app folder back, restart">Go back to ${esc(String(a.from).slice(0, 7))}</button>` : ''}</td>
      </tr>`).join('');
    return `<div class="card nw-card">
      <div class="row nw-card-head"><h3>Actions</h3><span class="muted small">${m.actions.auto} without asking${m.actions.undone ? `, ${m.actions.undone} undone` : ''}</span></div>
      ${rows ? `<table class="u-table nw-actions"><thead><tr><th>Time</th><th>Action</th><th>Permission</th><th>Backup</th><th>Result</th><th></th></tr></thead><tbody>${rows}</tbody></table>` : '<p class="muted small">The watch took no action this night.</p>'}
    </div>`;
  }

  // ---- (5) the nights ----------------------------------------------------------------------
  function nightsHtml(r) {
    const b = r.baseline;
    const rows = r.nights.map((m, i) => `<tr class="nw-night${i === nw.night ? ' selected' : ''}" data-nw-night="${i}" tabindex="0" title="Show this night above">
        <td class="nowrap">${esc(day(m.window.from))} ${esc(hm(m.window.from))} → ${esc(hm(m.window.to))}${m.selfHealing ? ` <span class="badge" title="A Self-healing day (UTC ${esc(m.selfHealing.day)}): ${m.selfHealing.detected} detected, ${m.selfHealing.repaired} repaired alone, ${m.selfHealing.waiting} waiting for you">Self-healing</span>` : ''}</td>
        <td class="num">${hours(m.window.hours)}</td><td class="num">${pct(m.yield.occupancy)}</td><td class="num">${hours(m.idleHours.total)}</td><td class="num">${hours(m.idleHours.noWork)}</td>
        <td class="num">${m.incidents.count}</td><td class="num">${pct(m.resolution)}</td><td class="num">${dur(m.ttd.median)}</td><td class="num">${dur(m.ttr.median)}</td>
        <td class="num">${hours(m.hoursSaved)}</td><td class="num">${usd(m.cost.watchUsd)}</td>
        <td>${m.safety.alarm ? '<span class="pill pill-failed">alarm</span>' : '<span class="pill pill-success">ok</span>'}</td>
      </tr>`).join('');
    return `<div class="card nw-card">
      <div class="row nw-card-head"><h3>Nights</h3><span class="muted small">Click a night, or a Self-healing day, to show it above</span></div>
      <table class="u-table nw-nights"><thead><tr><th>Window</th><th class="num">Hours</th><th class="num">Occupancy</th><th class="num">Idle</th><th class="num">No work</th><th class="num">Incidents</th><th class="num">Resolved</th><th class="num">TTD</th><th class="num">TTR</th><th class="num">Saved (est.)</th><th class="num">Watch $</th><th>Safety</th></tr></thead>
      <tbody>${rows}
        <tr class="nw-baseline" title="Diário do Orchestrator: the night before the watch; TTD and TTR are the #112 incident's human reference"><td>${esc(b.label)}</td><td class="num">${hours(b.hours)}</td><td class="num">${pct(b.activeHours / b.hours)}</td><td class="num">${hours(b.idleHours)}</td><td class="num">${hours(b.idleNoWorkHours)}</td><td class="num">—</td><td class="num">—</td><td class="num">${dur(b.ttdMs)}</td><td class="num">${dur(b.ttrMs)}</td><td class="num">—</td><td class="num">—</td><td>—</td></tr>
      </tbody></table>
    </div>`;
  }

  function render() {
    const box = $('#nw-body');
    if (!box) return;
    $('#btn-nw-replay').classList.toggle('hidden', !nw.state?.simulation);
    if (nw.error && !nw.state) { box.innerHTML = `<div class="empty-state"><b>The Night watch could not load</b><p class="error small">${esc(nw.error)}</p><button class="btn ghost" id="nw-retry">Try again</button></div>`; $('#nw-retry').onclick = load; return; }
    if (!nw.state) { box.innerHTML = '<p class="muted">Loading…</p>'; return; }
    if (!nw.state.oracle) { box.innerHTML = '<div class="empty-state"><b>Night watch needs the Oracle (#122, #123)</b><p class="muted">The Oracle watches the runs and acts for you at night; it is not available in this app.</p></div>'; return; }
    const r = nw.report || { nights: [] };
    const m = r.nights[nw.night] || r.nights[0];
    box.innerHTML = `
      ${nw.error ? `<p class="error small">${esc(nw.error)}</p>` : ''}
      <div class="nw-top">${switchHtml(nw.state)}${permissionsHtml(nw.state)}</div>
      ${m ? `${summaryHtml(m)}${timelineHtml(m)}${actionsHtml(m)}${nightsHtml(r)}`
        : '<div class="empty-state"><b>No night yet</b><p class="muted">Turn the watch on before you leave: each night\'s incidents, actions and metrics show here the next morning.</p></div>'}`;
    wire();
  }

  function wire() {
    const sw = $('#nw-switch');
    sw.onchange = async () => {
      if (nw.state.watch?.active) {
        sw.checked = true;
        if (!await confirmDialog('Turn the Night watch off', 'The Oracle stops acting without asking at once; its summary is posted.', 'Turn off')) return;
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
        if (!await confirmDialog('Undo this action', 'The backup taken before the action is put back.', 'Undo')) return;
        try { await api.oracleUndo({ actionId: b.dataset.nwUndo }); nw.error = null; } catch (e) { nw.error = errMsg(e); }
        await load();
      };
    });
    document.querySelectorAll('[data-nw-app-back]').forEach((b) => {
      b.onclick = async () => {
        const to = b.dataset.nwAppBack;
        if (!await confirmDialog(`Go back to ${to.slice(0, 7)}`, 'The roadmap pauses, the runs in progress finish, the app folder goes back to that commit and the app restarts.', 'Go back')) return;
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
    box.innerHTML = `<div class="dash-gates-title"><b>☾ ${m.window.selfHealing ? 'Self-healing' : 'Night watch'} · ${esc(hm(m.window.from))} → ${esc(hm(m.window.to))}</b>${s.alarm ? ' <span class="pill pill-failed">safety alarm</span>' : ''}</div>
      <div class="nw-dash-lines small">${s.selfHealing ? `<div data-testid="dash-self-healing">${esc(s.selfHealing)}</div>` : ''}<div>${esc(s.ran)}</div><div>${esc(s.did)}</div><div>${esc(s.waits)}</div><div class="${s.alarm ? 'error' : 'muted'}">${esc(s.safety)}</div>${regressionLines(s)}${limitLines(s)}</div>
      <div class="row"><span class="spacer"></span><button class="btn sm ghost" type="button" id="dash-nw-open">Open Night watch</button></div>`;
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
    return (s.regressions || []).map((line, i) => `<div class="nw-regression" data-testid="nw-regression">${esc(line)} <span class="pill pill-cancelled">regression</span>${(s.regressionRuns?.[i] || []).map((id) => ` <button class="btn sm ghost" type="button" data-testid="nw-regression-run" data-run="${esc(id)}" title="Open run ${esc(id)}" aria-label="Open run ${esc(id)}">${esc(runLabel(id))}</button>`).join('')}</div>`).join('');
  }
  // #337: one line per run that went past a day limit under tonight's limits, then what the night
  // spent above the day cost limits
  function limitLines(s) {
    if (!s.limits?.length) return '';
    return `${s.limits.map((line) => `<div class="nw-past-limit" data-testid="nw-past-limit">${esc(line)} <span class="badge warn">past a day limit</span></div>`).join('')}${s.overDayUsd ? `<div class="muted" data-testid="nw-over-day">${esc(`Spent above the day limits: ${dollars(s.overDayUsd)}`)}</div>` : ''}`;
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
    markup: `
      <section id="view-nightwatch" class="view hidden">
        <div class="page-head">
          <div>
            <h1>Night watch</h1>
            <p class="muted small">While you are away the Oracle keeps the roadmap producing: it does only what you allow, logs every action with its backup, and leaves gates to you.</p>
          </div>
          <div class="row"><button id="btn-nw-replay" class="btn ghost hidden" title="Simulated mode: writes two demo nights into this workspace">Replay a sample night</button></div>
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
