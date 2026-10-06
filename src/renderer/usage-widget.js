/* global api */
// The top bar's usage widget and its popover: tokens, cost and budgets per CLI (loadUsage, and
// loadUsageThrottled while a run streams results), this orchestrator's or the whole machine's
// (setUsageScope). Also the helpers the Usage and Workflows screens and the run list share: fmtTok,
// fmtUsd, parseAmount, meterHtml, the budget status and runsTableHtml. initUsageWidget() wires it
// from app.js's init().

// Usage (tokens / cost / budgets per CLI)
function fmtTok(n) {
  n = Number(n) || 0;
  const a = Math.abs(n);
  const short = (v, s) => `${v.toFixed(v < 100 ? 1 : 0).replace(/\.0$/, '')}${s}`;
  if (a >= 1e9) return short(n / 1e9, 'B');
  if (a >= 1e6) return short(n / 1e6, 'M');
  if (a >= 1e3) return short(n / 1e3, 'K');
  return String(Math.round(n));
}
const fmtUsd = (n) => `$${(Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
// Parses "12.5", "12,5", "$50", "1.5M", "200k" (empty -> null, invalid -> NaN).
function parseAmount(v) {
  const t = String(v ?? '').trim().replace(/[\s$_]/g, '');
  if (!t) return null;
  const m = /^(\d+(?:[.,]\d+)?)([kmb])?$/i.exec(t);
  if (!m) return NaN;
  return Number(m[1].replace(',', '.')) * ({ k: 1e3, m: 1e6, b: 1e9 }[(m[2] || '').toLowerCase()] || 1);
}
const STATUS_RANK = { ok: 0, warn: 1, over: 2 };
const STATUS_TEXT = { ok: 'Within budget', warn: 'Near limit', over: 'Over limit' };
const pctStatus = (p) => (p == null ? 'ok' : p >= 1 ? 'over' : p >= 0.8 ? 'warn' : 'ok');
const worstStatus = (providers) => (providers || []).reduce((w, p) => ((STATUS_RANK[p.status] || 0) > STATUS_RANK[w] ? p.status : w), 'ok');
function monthLabel(ym) {
  const [y, m] = String(ym || '').split('-').map(Number);
  return y && m ? new Date(y, m - 1, 1).toLocaleString('en-US', { month: 'long', year: 'numeric' }) : 'this month';
}

let usageLoading = null;
let usageLastLoad = 0;
let usageTimer = null;
function loadUsage() {
  if (usageLoading) return usageLoading;
  usageLoading = (async () => {
    const scope = state.usageScope;
    try {
      const u = await api.getUsage(scope);
      if (scope === state.usageScope) { state.usage = u; state.usageError = null; }
    } catch (e) {
      if (scope === state.usageScope) state.usageError = errMsg(e);
    }
    usageLoading = null;
    usageLastLoad = Date.now();
    if (scope !== state.usageScope) return loadUsage(); // scope changed while loading
    renderUsageAll();
  })();
  return usageLoading;
}

function setUsageScope(scope) {
  if (scope !== 'machine') scope = 'orchestrator';
  if (scope === state.usageScope) return;
  state.usageScope = scope;
  try { localStorage.setItem(USAGE_SCOPE_KEY, scope); } catch { /* ignore */ }
  state.usageError = null;
  renderUsageAll();
  loadUsage();
}

function renderScopeToggles() {
  document.querySelectorAll('[data-scope]').forEach((b) => {
    const on = b.dataset.scope === state.usageScope;
    b.classList.toggle('active', on);
    b.setAttribute('aria-pressed', String(on));
  });
}

// True while the data on screen belongs to the other scope (a reload is in flight).
const usageStale = () => !!state.usage && (state.usage.scope || 'orchestrator') !== state.usageScope;

// At most one load every 5 s while a run is streaming results.
function loadUsageThrottled() {
  if (usageTimer) return;
  const wait = Math.max(0, 5000 - (Date.now() - usageLastLoad));
  usageTimer = setTimeout(() => { usageTimer = null; loadUsage(); }, wait);
}

function renderUsageAll() {
  renderScopeToggles();
  renderUsageWidget();
  if (!$('#usage-pop').classList.contains('hidden')) renderUsagePopover();
  if (state.view === 'usage') renderUsage();
}

function renderUsageWidget() {
  const u = state.usage;
  const btn = $('#usage-widget');
  btn.classList.toggle('unavailable', !u && !!state.usageError);
  if (!u) {
    $('#usage-widget-text').textContent = state.usageError ? 'Usage unavailable' : '—';
    $('#usage-widget-dot').className = 'u-dot';
    $('#usage-widget-scope').classList.add('hidden');
    return;
  }
  const m = u.totals?.month || {};
  const worst = worstStatus(u.providers);
  const machine = u.scope === 'machine';
  $('#usage-widget-text').textContent = `${fmtTok(m.tokens?.total)} tok · ${fmtUsd(m.costUsd)}`;
  $('#usage-widget-dot').className = `u-dot st-${worst}`;
  $('#usage-widget-scope').classList.toggle('hidden', !machine);
  btn.title = `${machine ? 'All CLI usage on this machine' : 'Orchestrator usage'} in ${monthLabel(u.month)}: ${fmtNum(m.tokens?.total)} tokens, ${fmtUsd(m.costUsd)} — ${STATUS_TEXT[worst]}`;
  renderSpending(u.spending);
}

// #206: today's (or tonight's, under the Night watch) spending against the budget, "$38 / $60 today":
// shown when a budget is set or something was spent today; warn at 80 %, over at 100 %.
function renderSpending(sp) {
  const el = $('#usage-widget-today');
  const p = sp?.night?.limitUsd ? sp.night : sp?.day;
  const show = !!p && (!!p.limitUsd || p.spentUsd > 0);
  el.classList.toggle('hidden', !show);
  if (!show) return;
  const pct = p.limitUsd ? p.spentUsd / p.limitUsd : 0;
  el.textContent = sp.text;
  el.className = `u-today mono${pct >= 1 ? ' st-over' : pct >= 0.8 ? ' st-warn' : ''}`;
  el.title = `${p === sp.night ? 'Spent since the Night watch started' : 'Spent today'} by real runs (live runs included)${p.limitUsd ? `, against the ${p === sp.night ? 'night' : 'daily'} budget${p.raised ? ' (raised for this period)' : ''}: the roadmaps pause before a start that would pass it` : ': no budget set (Settings › Budget)'}${p.estimated ? '. Some costs are estimated from tokens × the model prices' : ''}.`;
}

function toggleUsagePopover() {
  if ($('#usage-pop').classList.contains('hidden')) openUsagePopover();
  else closeUsagePopover();
}

function openUsagePopover() {
  $('#usage-pop').classList.remove('hidden');
  $('#usage-widget').setAttribute('aria-expanded', 'true');
  renderUsagePopover();
  loadUsage();
}

function closeUsagePopover() {
  $('#usage-pop').classList.add('hidden');
  $('#usage-widget').setAttribute('aria-expanded', 'false');
}

function meterHtml(label, pct, used, limit, compact = false) {
  return meterRaw(label, pct, `${used} / ${limit} · ${Math.round((Number(pct) || 0) * 100)}%`, compact);
}

// pct is a 0..1+ fraction (null = unknown); detail is the right-hand text.
function meterRaw(label, pct, detail, compact = false) {
  const p = Number(pct) || 0;
  const w = Math.min(100, Math.max(0, p * 100));
  return `<div class="meter st-${pctStatus(pct)}${compact ? ' compact' : ''}">
    <div class="meter-top"><span>${esc(label)}</span><span class="mono">${esc(detail)}</span></div>
    <div class="meter-bar"><span style="width:${w.toFixed(1)}%"></span></div>
  </div>`;
}

function renderUsagePopover() {
  const u = state.usage;
  $('#usage-pop-month').textContent = u ? monthLabel(u.month) : '';
  const body = $('#usage-pop-body');
  body.classList.toggle('stale', usageStale());
  if (!u) {
    body.innerHTML = `<p class="muted small up-empty">${state.usageError ? 'Usage unavailable' : 'Loading…'}</p>`;
    return;
  }
  body.innerHTML = (u.providers || []).map((p) => {
    const m = p.month || {}, b = p.budget || {};
    const bar = p.usedPctUsd != null ? meterHtml('USD budget', p.usedPctUsd, fmtUsd(m.costUsd), fmtUsd(b.monthlyUsd), true)
      : p.usedPctTokens != null ? meterHtml('Token budget', p.usedPctTokens, fmtTok(m.tokens?.total), fmtTok(b.monthlyTokens), true)
      : '<div class="muted small">no budget</div>';
    return `<div class="up-row">
      <div class="up-line">
        <b>${esc(p.name)}</b>
        <span class="u-inst ${p.installed ? 'on' : 'off'}">${p.installed ? 'installed' : 'not installed'}</span>
        ${planWorst(p) != null ? `<span class="u-plan-pct st-${pctStatus(planWorst(p) / 100)}" title="Most used plan rate-limit window">plan ${Math.round(planWorst(p))}%</span>` : ''}
        <span class="spacer"></span>
        <span class="mono small">${fmtTok(m.tokens?.total)} tok · ${fmtUsd(m.costUsd)}</span>
      </div>
      ${bar}
    </div>`;
  }).join('') || '<p class="muted small up-empty">No providers.</p>';
}

// Highest used % (0..100) across the plan's rate-limit windows, or null.
function planWorst(p) {
  const v = (p.plan?.windows || []).map((w) => w.usedPercent).filter((x) => x != null);
  return v.length ? Math.max(...v) : null;
}

// Recent runs table, shared by Usage > Recent runs and Workflows > Runs.
function runsTableHtml(u) {
  const runs = u.runs || [];
  if (!runs.length) return '<div class="s-row"><div class="s-label"><span>No runs recorded yet (simulation runs are not counted).</span></div></div>';
  const names = Object.fromEntries((u.providers || []).map((p) => [p.id, p.name]));
  return `<table class="u-table">
    <thead><tr><th>Date</th><th>Workflow</th><th>Status</th><th class="num">Tokens</th><th class="num">Cost</th><th>By provider</th></tr></thead>
    <tbody>${runs.map((r) => `<tr title="${esc(r.runId)}">
      <td class="nowrap">${r.startedAt ? esc(dateOf(r.startedAt)) : '—'}</td>
      <td>${esc(r.workflow || '—')}</td>
      <td>${r.status ? StatusPill.statusPill(r.status) : '<span class="pill pill-idle">—</span>'}</td>
      <td class="num mono">${fmtTok(r.tokens)}</td>
      <td class="num mono">${fmtUsd(r.costUsd)}</td>
      <td><div class="u-split">${Object.entries(r.byProvider || {}).map(([id, v]) =>
        `<span class="badge p-${esc(id)}" title="${esc(names[id] || id)}">${esc(id)} ${fmtTok(v.tokens)} · ${fmtUsd(v.costUsd)}</span>`).join('')}</div></td>
    </tr>`).join('')}</tbody>
  </table>`;
}

function initUsageWidget() {
  $('#usage-widget').onclick = toggleUsagePopover;
  $('#usage-pop-open').onclick = () => { closeUsagePopover(); showView('usage'); };
  document.addEventListener('mousedown', (e) => {
    if (!$('#usage-pop').classList.contains('hidden') && !e.target.closest('.usage-wrap')) closeUsagePopover();
  });
  document.querySelectorAll('[data-scope]').forEach((b) => (b.onclick = () => setUsageScope(b.dataset.scope)));
  renderScopeToggles();
}
