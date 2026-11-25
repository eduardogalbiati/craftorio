/* global api */
// Usage screen: tokens and cost per CLI for the month (orchestrator or whole-machine scope), budgets
// (the budget dialog), prices for CLIs that don't report cost, GitHub Actions minutes and the recent
// runs table. The top-bar widget, its popover, loadUsage and the scope live in app.js (app-wide).
// Registers itself with registerView (view-registry.js); uses app.js globals.

function renderUsage() {
  const u = state.usage;
  const err = $('#usage-error');
  err.classList.toggle('hidden', !state.usageError);
  err.innerHTML = state.usageError
    ? `<b>${t('usage.usage_unavailable')}</b>${u ? t('usage.showing_the_last_loaded_data') : '.'} <span class="small">${esc(state.usageError)}</span>`
    : '';
  $('#usage-extra').classList.toggle('hidden', !u);
  $('#usage-live').classList.toggle('hidden', !u?.live);
  $('#usage-sub').textContent = state.usageScope === 'machine'
    ? t('usage.everything_the_claude_code_codex_and')
    : t('usage.tokens_and_cost_of_the_orchestrator');
  $('#usage-cards').classList.toggle('stale', usageStale());
  if (!u) {
    $('#usage-cards').innerHTML = state.usageError ? '' : `<p class="muted">${t('usage.loading')}</p>`;
    return;
  }
  $('#usage-month').textContent = monthLabel(u.month);
  $('#usage-cards').innerHTML = (u.providers || []).map((p) => providerCard(p, u)).join('') + actionsCard();
  $('#usage-cards').querySelectorAll('[data-budget]').forEach((b) => (b.onclick = () => openBudgetModal(b.dataset.budget)));
  // Don't wipe prices the user is typing.
  if (!$('#usage-prices').contains(document.activeElement)) renderPrices();
  renderUsageRuns();
}

const shortDate = (iso) => new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: TimeZone.current() });

function planBlock(p, u) {
  const pl = p.plan;
  if (!pl) {
    return p.id === 'codex' && u.scope !== 'machine'
      ? `<p class="muted small u-note">${t('usage.switch_to')} <b>${t('usage.this_machine')}</b> ${t('usage.to_see_the_plan_s_rate')}</p>` : '';
  }
  const c = pl.credits;
  const credits = !c ? '' : c.unlimited ? 'unlimited credits' : c.balance != null ? `credit balance ${fmtNum(c.balance)}` : c.hasCredits ? 'has credits' : 'no credits';
  return `<div class="u-plan">
    <div class="u-plan-head"><b>${t('usage.plan')}</b>${pl.planType ? `<span class="badge">${esc(pl.planType)}</span>` : ''}${credits ? `<span class="muted small">${esc(credits)}</span>` : ''}
      <span class="spacer"></span>${pl.updatedAt ? `<span class="muted small">${t('usage.as_of')} ${esc(shortDate(pl.updatedAt))}</span>` : ''}</div>
    ${pl.limitReached ? `<p class="error small u-note">${t('usage.limit_reached')} ${esc(pl.limitReached)}</p>` : ''}
    ${(pl.windows || []).map((w) => meterRaw(w.label || 'window', w.usedPercent == null ? null : w.usedPercent / 100,
      `${w.usedPercent == null ? '—' : Math.round(w.usedPercent) + '%'}${w.resetsAt ? ' · resets ' + shortDate(w.resetsAt) : ''}`)).join('')}
  </div>`;
}

function orchestratorSplit(p) {
  const o = p.orchestrator;
  if (!o) return '';
  const total = p.month?.tokens?.total || 0;
  const part = o.tokens?.total || 0;
  const pct = total ? Math.min(100, (part / total) * 100) : 0;
  return `<div class="u-orch">
    <div class="split-bar" title="${t('usage.orchestrator_share_of_this_month_s')}"><span style="width:${pct.toFixed(1)}%"></span></div>
    <span class="small muted">${t('usage.of_which_orchestrator')} <b class="mono">${fmtTok(part)} ${t('usage.tok')} ${fmtUsd(o.costUsd, o.costApprox)}</b>${total ? ` (${pct < 1 && part ? '&lt;1' : Math.round(pct)}%)` : ''}</span>
  </div>`;
}

function providerCard(p, u) {
  const m = p.month || {}, t = m.tokens || {}, b = p.budget || {};
  const meters = [];
  const approxTip = (x) => (x?.costApprox ? approxTitle() : ''); // run-list.js (#72)
  if (b.monthlyUsd != null) meters.push(meterHtml('Monthly USD budget', p.usedPctUsd, fmtUsd(m.costUsd, m.costApprox), fmtUsd(b.monthlyUsd)));
  if (b.monthlyTokens != null) meters.push(meterHtml('Monthly token budget', p.usedPctTokens, fmtTok(t.total), fmtTok(b.monthlyTokens)));
  const models = (p.models || []).filter((x) => x.month?.tokens?.total || x.month?.costUsd);
  return `
    <div class="card usage-card" data-testid="usage-provider-card" data-provider="${esc(p.id)}">
      <div class="card-head">
        <span class="card-icon p-${esc(p.id)}"><svg viewBox="0 0 24 24" aria-hidden="true"><polyline points="5 16 10 11 5 6" /><line x1="12" y1="18" x2="19" y2="18" /></svg></span>
        <b class="card-title">${esc(p.name)}</b>
        <span class="conn ${p.installed ? 'on' : 'off'}"><span class="conn-dot"></span>${p.installed ? I18n.t('usage.installed') : I18n.t('usage.not_installed')}</span>
        <span class="spacer"></span>
        ${meters.length ? `<span class="u-status st-${esc(p.status)}"><span class="u-dot st-${esc(p.status)}"></span>${esc(STATUS_TEXT[p.status] || p.status)}</span>` : ''}
      </div>
      ${p.localAvailable === false ? `<p class="muted small u-note">${I18n.t('usage.no_local_logs_found_value', { value: u.sources?.[p.id] ? ` at <span class="mono">${esc(u.sources[p.id])}</span>` : '' })}</p>` : ''}
      ${p.installed ? '' : p.installCommand
    ? `<div class="u-install"><span class="muted small">${I18n.t('usage.install_with')}</span>${commandHint(p.installCommand)}${p.installNote ? `<span class="muted small">${esc(p.installNote)}</span>` : ''}</div>`
    : `<div class="u-install"><span class="muted small">${I18n.t('usage.install_with')}</span><code>${esc(p.installHint || '')}</code></div>`}
      <div class="u-stats">
        <div class="u-stat"><label>${I18n.t('usage.month_tokens')}</label><b>${fmtTok(t.total)}</b></div>
        <div class="u-stat"><label>${I18n.t('usage.month_cost')}</label><b data-testid="usage-month-cost"${approxTip(m)}>${fmtUsd(m.costUsd, m.costApprox)}</b></div>
        <div class="u-stat"><label>${I18n.t('usage.cost_today')}</label><b${approxTip(p.today)}>${fmtUsd(p.today?.costUsd, p.today?.costApprox)}</b></div>
      </div>
      ${orchestratorSplit(p)}
      <div class="u-breakdown mono">
        <span>${I18n.t('usage.in')} <b>${fmtTok(t.input)}</b></span><span>${I18n.t('usage.out')} <b>${fmtTok(t.output)}</b></span>
        <span>${I18n.t('usage.cache_read')} <b>${fmtTok(t.cache_read)}</b></span><span>${I18n.t('usage.cache_write')} <b>${fmtTok(t.cache_write)}</b></span>
      </div>
      ${p.costReported === false ? `<p class="muted small u-note">${I18n.t('usage.this_cli_does_not_report_cost')}</p>` : ''}
      ${m.unpricedTokens > 0 ? `<p class="warn-text small u-note">${fmtTok(m.unpricedTokens)} ${I18n.t('usage.tokens_have_no_reported_cost_and')}</p>` : ''}
      ${meters.length ? `<div class="u-meters">${meters.join('')}</div>` : ''}
      ${planBlock(p, u)}
      ${models.length ? `<table class="u-table compact">
        <thead><tr><th>${I18n.t('usage.model')}</th><th class="num">${I18n.t('usage.tokens')}</th><th class="num">${I18n.t('usage.cost')}</th></tr></thead>
        <tbody>${models.map((x) => `<tr><td class="mono">${esc(x.model)}</td><td class="num mono">${fmtTok(x.month?.tokens?.total)}</td><td class="num mono"${approxTip(x.month)}>${x.month?.costApprox && !x.month.costUsd ? I18n.t('run_list.cost_unknown') : fmtUsd(x.month?.costUsd, x.month?.costApprox)}</td></tr>`).join('')}</tbody>
      </table>` : `<p class="muted small">${I18n.t('usage.no_usage_this_month')}</p>`}
      <div class="card-actions">
        <span class="muted small">${meters.length ? (b.blockOnLimit ? I18n.t('usage.runs_are_blocked_at_the_limit') : I18n.t('usage.warning_only_runs_are_not_blocked')) : I18n.t('usage.no_budget_set')}${meters.length && b.countOutside ? `<br>${I18n.t('usage.budget_counts_all_usage_on_this')}` : ''}</span>
        <span class="spacer"></span>
        <button class="btn sm ghost" data-budget="${esc(p.id)}">${I18n.t('usage.edit_budget')}</button>
      </div>
    </div>`;
}

// GitHub Actions minutes of the month (private repos: Windows counts x2, macOS x10). When the quota
// runs out, Actions stop until the month resets: warn at 80%.
let actionsLoading = null;
function loadActionsUsage(force = false) {
  if (actionsLoading) return actionsLoading;
  actionsLoading = (async () => {
    try { state.actionsUsage = await api.getActionsUsage(force); } catch (e) { state.actionsUsage = { error: errMsg(e) }; }
    actionsLoading = null;
    if (state.view === 'usage') renderUsage();
  })();
  return actionsLoading;
}

const ACTIONS_STATUS_TEXT = { ok: 'Within quota', warn: 'Near quota', over: 'Quota exhausted' };
function actionsCard() {
  const a = state.actionsUsage;
  const fmtMin = (n) => Math.round(Number(n) || 0).toLocaleString('en-US');
  const head = (status) => `<div class="card-head">
      <span class="card-icon"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9" /><polyline points="12 7 12 12 15 14" /></svg></span>
      <b class="card-title">${t('usage.github_actions')}</b>
      <span class="spacer"></span>
      ${status ? `<span class="u-status st-${esc(status)}"><span class="u-dot st-${esc(status)}"></span>${esc(ACTIONS_STATUS_TEXT[status] || status)}</span>` : ''}
    </div>`;
  if (!a) return `<div class="card usage-card" data-provider="actions">${head()}<p class="muted small">${t('usage.loading')}</p></div>`;
  if (a.error) {
    return `<div class="card usage-card" data-provider="actions">${head()}
      <p class="muted small u-note">${t('usage.actions_minutes_unavailable_error', { error: esc(a.error) })}</p>
      ${a.hint ? `<div class="u-install"><span class="muted small">${t('usage.allow_gh_to_read_billing_usage')}</span>${commandHint(a.hint)}</div>` : ''}
    </div>`;
  }
  const note = a.status === 'over'
    ? `<p class="warn-text small u-note">${t('usage.quota_exhausted_actions_stop_until_resetson', { resetsOn: esc(a.resetsOn) })}</p>`
    : a.status === 'warn' ? `<p class="warn-text small u-note">${t('usage.over_80_of_the_included_minutes', { resetsOn: esc(a.resetsOn) })}</p>` : '';
  return `<div class="card usage-card" data-provider="actions">${head(a.status)}
      <div class="u-stats">
        <div class="u-stat"><label>${t('usage.quota_minutes')}</label><b>${fmtMin(a.usedMinutes)}</b></div>
        <div class="u-stat"><label>${t('usage.runner_minutes')}</label><b>${fmtMin(a.realMinutes)}</b></div>
        <div class="u-stat"><label>${t('usage.usage_value')}</label><b>${fmtUsd(a.grossUsd)}</b></div>
      </div>
      <div class="u-meters">${meterHtml('Included minutes', a.pct, fmtMin(a.usedMinutes), fmtMin(a.includedMinutes))}</div>
      ${note}
      ${(a.skus || []).length ? `<table class="u-table compact">
        <thead><tr><th>${t('usage.runner')}</th><th class="num">${t('usage.minutes')}</th><th class="num">${t('usage.quota_minutes')}</th></tr></thead>
        <tbody>${a.skus.map((s) => `<tr><td class="mono">${esc(s.sku)}</td><td class="num mono">${fmtMin(s.minutes)}</td><td class="num mono">${fmtMin(s.minutes * s.multiplier)} (×${s.multiplier})</td></tr>`).join('')}</tbody>
      </table>` : `<p class="muted small">${t('usage.no_actions_minutes_this_month')}</p>`}
      <div class="card-actions"><span class="muted small">${t('usage.account_value_resets_resetson_included_minutes', { value: esc(a.login || ''), resetsOn: esc(a.resetsOn) })} <span class="mono">${t('usage.actionsincludedminutes')}</span> ${t('usage.in_settings_json')}</span></div>
    </div>`;
}

let budgetProvider = null;
function openBudgetModal(id) {
  const p = state.usage?.providers?.find((x) => x.id === id);
  if (!p) return;
  budgetProvider = id;
  const b = p.budget || {};
  $('#budget-modal-title').textContent = t('usage.budget_name', { name: p.name });
  $('#bd-usd').value = b.monthlyUsd ?? '';
  $('#bd-tokens').value = b.monthlyTokens == null ? '' : parseAmount(fmtTok(b.monthlyTokens)) === b.monthlyTokens ? fmtTok(b.monthlyTokens) : b.monthlyTokens;
  $('#bd-block').checked = !!b.blockOnLimit;
  $('#bd-outside').checked = !!b.countOutside;
  $('#bd-error').textContent = '';
  openModal('#budget-modal');
  $('#bd-usd').focus({ preventScroll: true });
}

async function saveBudget(e) {
  e.preventDefault();
  const num = (sel) => {
    const n = parseAmount($(sel).value);
    if (n === null) return null;
    if (!Number.isFinite(n) || n < 0) throw new Error('Limits must be positive numbers (or empty for no limit).');
    return n;
  };
  $('#bd-error').textContent = '';
  try {
    const budget = { monthlyUsd: num('#bd-usd'), monthlyTokens: num('#bd-tokens'), blockOnLimit: $('#bd-block').checked, countOutside: $('#bd-outside').checked };
    if (budget.monthlyTokens != null) budget.monthlyTokens = Math.round(budget.monthlyTokens);
    state.usage = await api.setBudget(budgetProvider, budget, state.usageScope);
    state.usageError = null;
    closeModal('#budget-modal');
    renderUsageAll();
  } catch (err) {
    $('#bd-error').textContent = errMsg(err);
  }
}

const PRICE_KEYS = [['input', 'Input'], ['output', 'Output'], ['cache_read', 'Cache read']];
function renderPrices() {
  const u = state.usage;
  const prices = u.prices || {};
  const models = new Set(Object.keys(prices));
  (u.providers || []).filter((p) => p.costReported === false).forEach((p) => (p.models || []).forEach((m) => models.add(m.model)));
  const row = (model) => `
    <tr data-model="${esc(model)}">
      <td class="mono">${model == null ? `<input type="text" class="price-model" placeholder="${t('usage.model_name')}" />` : `${esc(model)}${prices[model] ? '' : ` <span class="badge warn">${t('usage.no_price')}</span>`}`}</td>
      ${PRICE_KEYS.map(([k]) => `<td class="num"><input type="text" inputmode="decimal" data-k="${k}" value="${esc(prices[model]?.[k] ?? '')}" placeholder="0.00" /></td>`).join('')}
      <td class="num"><span class="price-msg small"></span><button class="btn sm ${model == null ? '' : 'ghost'}" data-save-price>${model == null ? t('usage.add') : t('common.save')}</button></td>
    </tr>`;
  $('#usage-prices').innerHTML = `<table class="u-table prices">
    <thead><tr><th>${t('usage.model')}</th>${PRICE_KEYS.map(([, l]) => `<th class="num">${l}</th>`).join('')}<th></th></tr></thead>
    <tbody>${[...models].sort().map(row).join('')}${row(null)}</tbody>
  </table>`;
  $('#usage-prices').querySelectorAll('[data-save-price]').forEach((b) => (b.onclick = () => savePrice(b.closest('tr'))));
}

async function savePrice(tr) {
  const msg = tr.querySelector('.price-msg');
  const model = tr.dataset.model ?? tr.querySelector('.price-model')?.value.trim();
  msg.className = 'price-msg small';
  if (!model) { msg.classList.add('error'); msg.textContent = t('usage.enter_a_model_name'); return; }
  const price = {};
  for (const [k] of PRICE_KEYS) {
    const n = parseAmount(tr.querySelector(`[data-k="${k}"]`).value) ?? 0;
    if (!Number.isFinite(n) || n < 0) { msg.classList.add('error'); msg.textContent = t('usage.invalid_price'); return; }
    price[k] = n;
  }
  try {
    state.usage = await api.setPrice(model, price, state.usageScope);
    state.usageError = null;
    renderUsageAll();
    renderPrices();
    const saved = [...$('#usage-prices').querySelectorAll('tr')].find((r) => r.dataset.model === model)?.querySelector('.price-msg');
    if (saved) { saved.textContent = t('usage.saved'); setTimeout(() => (saved.textContent = ''), 2000); }
  } catch (e) {
    msg.classList.add('error');
    msg.textContent = errMsg(e);
  }
}

function renderUsageRuns() {
  $('#usage-runs').innerHTML = runsTableHtml(state.usage);
}

registerView({
  id: 'usage',
  nav: { label: 'Usage', order: 90, group: 'ai', icon: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3.5 17a9 9 0 1 1 17 0" /><path d="m12 14 4-5" /><circle cx="12" cy="14.5" r="1.3" /></svg>' },
  markup: () => `
      <section id="view-usage" class="view hidden">
        <div class="page-head">
          <div>
            <h1>${t('usage.usage')}</h1>
            <p class="muted small"><span id="usage-sub">${t('usage.tokens_and_cost_of_the_orchestrator')}</span> — <span id="usage-month">${t('usage.this_month')}</span>. <span id="usage-live" class="badge live hidden">${t('usage.includes_the_running_workflow')}</span></p>
          </div>
          <div class="row">
            <div class="seg" role="group" aria-label="${t('usage.usage_scope')}"><button type="button" data-scope="orchestrator">${t('usage.orchestrator')}</button><button type="button" data-scope="machine">${t('usage.this_machine')}</button></div>
            <button id="btn-usage-refresh" class="btn ghost">${t('usage.refresh')}</button>
          </div>
        </div>
        <div id="usage-error" class="usage-unavailable hidden"></div>
        <div id="usage-cards" class="usage-cards"></div>

        <div id="usage-extra" class="hidden">
          <h3 class="s-subtitle">${t('usage.prices')} <span class="muted">${t('usage.for_providers_that_don_t_report')}</span></h3>
          <p class="muted small">${t('usage.usd_per_1m_tokens_used_to')}</p>
          <div id="usage-prices" class="s-group table-wrap"></div>

          <h3 class="s-subtitle">${t('usage.recent_runs')}</h3>
          <div id="usage-runs" class="s-group table-wrap"></div>
        </div>

        <p class="muted small usage-note">${t('usage.costs_reported_by_the_clis_are')} ${t('usage.what_the_total_counts')}</p>
      </section>`,
  modals: () => `
  <div id="budget-modal" class="modal hidden">
    <form id="budget-form" class="modal-card">
      <h3 id="budget-modal-title">${t('usage.edit_budget')}</h3>
      <div class="field">
        <label for="bd-usd">${t('usage.monthly_limit_usd')}</label>
        <input type="text" inputmode="decimal" id="bd-usd" placeholder="${t('usage.no_limit')}" />
      </div>
      <div class="field">
        <label for="bd-tokens">${t('usage.monthly_limit_tokens')}</label>
        <input type="text" inputmode="numeric" id="bd-tokens" placeholder="${t('usage.no_limit')}" />
        <div class="hint">${t('usage.leave_empty_for_no_limit_accepts')}</div>
      </div>
      <label class="check"><input type="checkbox" id="bd-block" /><span>${t('usage.block_runs_when_the_limit_is')}</span></label>
      <label class="check bd-outside"><input type="checkbox" id="bd-outside" /><span>${t('usage.count_usage_outside_the_orchestrator_this')}</span></label>
      <p id="bd-error" class="error small"></p>
      <div class="modal-actions">
        <button type="button" id="btn-bd-cancel" class="btn ghost">${t('common.cancel')}</button>
        <button type="submit" class="btn primary">${t('common.save')}</button>
      </div>
    </form>
  </div>`,
  mount() {
    $('#btn-usage-refresh').onclick = () => { loadUsage(); loadActionsUsage(true); };
    $('#budget-form').onsubmit = saveBudget;
    $('#btn-bd-cancel').onclick = () => closeModal('#budget-modal');
    document.querySelectorAll('#view-usage [data-scope]').forEach((b) => (b.onclick = () => setUsageScope(b.dataset.scope)));
    renderScopeToggles();
    // #783: the scope hint's terminal (gh auth refresh -s user) exiting with 0 re-reads the Actions minutes
    if (typeof onSuggestedCommandExit === 'function') {
      onSuggestedCommandExit(({ command, exitCode }) => {
        if (exitCode === 0 && command === state.actionsUsage?.hint) loadActionsUsage(true);
      });
    }
  },
  show() { renderUsage(); loadUsage(); loadActionsUsage(); },
});
