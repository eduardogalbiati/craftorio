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
    ? `<b>Usage unavailable</b>${u ? ' — showing the last loaded data.' : '.'} <span class="small">${esc(state.usageError)}</span>`
    : '';
  $('#usage-extra').classList.toggle('hidden', !u);
  $('#usage-live').classList.toggle('hidden', !u?.live);
  $('#usage-sub').textContent = state.usageScope === 'machine'
    ? 'Everything the Claude Code, Codex and Grok CLIs recorded on this machine, including use outside the orchestrator'
    : "Tokens and cost of the orchestrator's runs";
  $('#usage-cards').classList.toggle('stale', usageStale());
  if (!u) {
    $('#usage-cards').innerHTML = state.usageError ? '' : '<p class="muted">Loading…</p>';
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
      ? '<p class="muted small u-note">Switch to <b>This machine</b> to see the plan\'s rate limits and credits.</p>' : '';
  }
  const c = pl.credits;
  const credits = !c ? '' : c.unlimited ? 'unlimited credits' : c.balance != null ? `credit balance ${fmtNum(c.balance)}` : c.hasCredits ? 'has credits' : 'no credits';
  return `<div class="u-plan">
    <div class="u-plan-head"><b>Plan</b>${pl.planType ? `<span class="badge">${esc(pl.planType)}</span>` : ''}${credits ? `<span class="muted small">${esc(credits)}</span>` : ''}
      <span class="spacer"></span>${pl.updatedAt ? `<span class="muted small">as of ${esc(shortDate(pl.updatedAt))}</span>` : ''}</div>
    ${pl.limitReached ? `<p class="error small u-note">Limit reached: ${esc(pl.limitReached)}</p>` : ''}
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
    <div class="split-bar" title="Orchestrator share of this month's tokens"><span style="width:${pct.toFixed(1)}%"></span></div>
    <span class="small muted">of which orchestrator: <b class="mono">${fmtTok(part)} tok · ${fmtUsd(o.costUsd)}</b>${total ? ` (${pct < 1 && part ? '&lt;1' : Math.round(pct)}%)` : ''}</span>
  </div>`;
}

function providerCard(p, u) {
  const m = p.month || {}, t = m.tokens || {}, b = p.budget || {};
  const meters = [];
  if (b.monthlyUsd != null) meters.push(meterHtml('Monthly USD budget', p.usedPctUsd, fmtUsd(m.costUsd), fmtUsd(b.monthlyUsd)));
  if (b.monthlyTokens != null) meters.push(meterHtml('Monthly token budget', p.usedPctTokens, fmtTok(t.total), fmtTok(b.monthlyTokens)));
  const models = (p.models || []).filter((x) => x.month?.tokens?.total || x.month?.costUsd);
  return `
    <div class="card usage-card" data-provider="${esc(p.id)}">
      <div class="card-head">
        <span class="card-icon p-${esc(p.id)}"><svg viewBox="0 0 24 24" aria-hidden="true"><polyline points="5 16 10 11 5 6" /><line x1="12" y1="18" x2="19" y2="18" /></svg></span>
        <b class="card-title">${esc(p.name)}</b>
        <span class="conn ${p.installed ? 'on' : 'off'}"><span class="conn-dot"></span>${p.installed ? 'Installed' : 'Not installed'}</span>
        <span class="spacer"></span>
        ${meters.length ? `<span class="u-status st-${esc(p.status)}"><span class="u-dot st-${esc(p.status)}"></span>${esc(STATUS_TEXT[p.status] || p.status)}</span>` : ''}
      </div>
      ${p.localAvailable === false ? `<p class="muted small u-note">No local logs found${u.sources?.[p.id] ? ` at <span class="mono">${esc(u.sources[p.id])}</span>` : ''}.</p>` : ''}
      ${p.installed ? '' : p.installCommand
    ? `<div class="u-install"><span class="muted small">Install with</span>${commandHint(p.installCommand)}${p.installNote ? `<span class="muted small">${esc(p.installNote)}</span>` : ''}</div>`
    : `<div class="u-install"><span class="muted small">Install with</span><code>${esc(p.installHint || '')}</code></div>`}
      <div class="u-stats">
        <div class="u-stat"><label>Month tokens</label><b>${fmtTok(t.total)}</b></div>
        <div class="u-stat"><label>Month cost</label><b>${fmtUsd(m.costUsd)}</b></div>
        <div class="u-stat"><label>Cost today</label><b>${fmtUsd(p.today?.costUsd)}</b></div>
      </div>
      ${orchestratorSplit(p)}
      <div class="u-breakdown mono">
        <span>in <b>${fmtTok(t.input)}</b></span><span>out <b>${fmtTok(t.output)}</b></span>
        <span>cache read <b>${fmtTok(t.cache_read)}</b></span><span>cache write <b>${fmtTok(t.cache_write)}</b></span>
      </div>
      ${p.costReported === false ? '<p class="muted small u-note">This CLI does not report cost. Set prices per model below to estimate it, or use a token budget.</p>' : ''}
      ${m.unpricedTokens > 0 ? `<p class="warn-text small u-note">${fmtTok(m.unpricedTokens)} tokens have no reported cost and no price, so the cost shown is incomplete.</p>` : ''}
      ${meters.length ? `<div class="u-meters">${meters.join('')}</div>` : ''}
      ${planBlock(p, u)}
      ${models.length ? `<table class="u-table compact">
        <thead><tr><th>Model</th><th class="num">Tokens</th><th class="num">Cost</th></tr></thead>
        <tbody>${models.map((x) => `<tr><td class="mono">${esc(x.model)}</td><td class="num mono">${fmtTok(x.month?.tokens?.total)}</td><td class="num mono">${fmtUsd(x.month?.costUsd)}</td></tr>`).join('')}</tbody>
      </table>` : '<p class="muted small">No usage this month.</p>'}
      <div class="card-actions">
        <span class="muted small">${meters.length ? (b.blockOnLimit ? 'Runs are blocked at the limit.' : 'Warning only, runs are not blocked.') : 'No budget set.'}${meters.length && b.countOutside ? '<br>Budget counts all usage on this machine.' : ''}</span>
        <span class="spacer"></span>
        <button class="btn sm ghost" data-budget="${esc(p.id)}">Edit budget</button>
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
      <b class="card-title">GitHub Actions</b>
      <span class="spacer"></span>
      ${status ? `<span class="u-status st-${esc(status)}"><span class="u-dot st-${esc(status)}"></span>${esc(ACTIONS_STATUS_TEXT[status] || status)}</span>` : ''}
    </div>`;
  if (!a) return `<div class="card usage-card" data-provider="actions">${head()}<p class="muted small">Loading…</p></div>`;
  if (a.error) {
    return `<div class="card usage-card" data-provider="actions">${head()}
      <p class="muted small u-note">Actions minutes unavailable: ${esc(a.error)}.</p>
      ${a.hint ? `<div class="u-install"><span class="muted small">Allow gh to read billing usage (optional)</span>${commandHint(a.hint)}</div>` : ''}
    </div>`;
  }
  const note = a.status === 'over'
    ? `<p class="warn-text small u-note">Quota exhausted: Actions stop until ${esc(a.resetsOn)} unless the spending limit allows more. The CI step reports it and waits at its gate.</p>`
    : a.status === 'warn' ? `<p class="warn-text small u-note">Over 80% of the included minutes: CI, previews and deploys stop when they run out (resets ${esc(a.resetsOn)}).</p>` : '';
  return `<div class="card usage-card" data-provider="actions">${head(a.status)}
      <div class="u-stats">
        <div class="u-stat"><label>Quota minutes</label><b>${fmtMin(a.usedMinutes)}</b></div>
        <div class="u-stat"><label>Runner minutes</label><b>${fmtMin(a.realMinutes)}</b></div>
        <div class="u-stat"><label>Usage value</label><b>${fmtUsd(a.grossUsd)}</b></div>
      </div>
      <div class="u-meters">${meterHtml('Included minutes', a.pct, fmtMin(a.usedMinutes), fmtMin(a.includedMinutes))}</div>
      ${note}
      ${(a.skus || []).length ? `<table class="u-table compact">
        <thead><tr><th>Runner</th><th class="num">Minutes</th><th class="num">Quota minutes</th></tr></thead>
        <tbody>${a.skus.map((s) => `<tr><td class="mono">${esc(s.sku)}</td><td class="num mono">${fmtMin(s.minutes)}</td><td class="num mono">${fmtMin(s.minutes * s.multiplier)} (×${s.multiplier})</td></tr>`).join('')}</tbody>
      </table>` : '<p class="muted small">No Actions minutes this month.</p>'}
      <div class="card-actions"><span class="muted small">Account ${esc(a.login || '')} · resets ${esc(a.resetsOn)} · included minutes: <span class="mono">actionsIncludedMinutes</span> in settings.json.</span></div>
    </div>`;
}

let budgetProvider = null;
function openBudgetModal(id) {
  const p = state.usage?.providers?.find((x) => x.id === id);
  if (!p) return;
  budgetProvider = id;
  const b = p.budget || {};
  $('#budget-modal-title').textContent = `Budget — ${p.name}`;
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
      <td class="mono">${model == null ? '<input type="text" class="price-model" placeholder="model name" />' : `${esc(model)}${prices[model] ? '' : ' <span class="badge warn">no price</span>'}`}</td>
      ${PRICE_KEYS.map(([k]) => `<td class="num"><input type="text" inputmode="decimal" data-k="${k}" value="${esc(prices[model]?.[k] ?? '')}" placeholder="0.00" /></td>`).join('')}
      <td class="num"><span class="price-msg small"></span><button class="btn sm ${model == null ? '' : 'ghost'}" data-save-price>${model == null ? 'Add' : 'Save'}</button></td>
    </tr>`;
  $('#usage-prices').innerHTML = `<table class="u-table prices">
    <thead><tr><th>Model</th>${PRICE_KEYS.map(([, l]) => `<th class="num">${l}</th>`).join('')}<th></th></tr></thead>
    <tbody>${[...models].sort().map(row).join('')}${row(null)}</tbody>
  </table>`;
  $('#usage-prices').querySelectorAll('[data-save-price]').forEach((b) => (b.onclick = () => savePrice(b.closest('tr'))));
}

async function savePrice(tr) {
  const msg = tr.querySelector('.price-msg');
  const model = tr.dataset.model ?? tr.querySelector('.price-model')?.value.trim();
  msg.className = 'price-msg small';
  if (!model) { msg.classList.add('error'); msg.textContent = 'Enter a model name.'; return; }
  const price = {};
  for (const [k] of PRICE_KEYS) {
    const n = parseAmount(tr.querySelector(`[data-k="${k}"]`).value) ?? 0;
    if (!Number.isFinite(n) || n < 0) { msg.classList.add('error'); msg.textContent = 'Invalid price.'; return; }
    price[k] = n;
  }
  try {
    state.usage = await api.setPrice(model, price, state.usageScope);
    state.usageError = null;
    renderUsageAll();
    renderPrices();
    const saved = [...$('#usage-prices').querySelectorAll('tr')].find((r) => r.dataset.model === model)?.querySelector('.price-msg');
    if (saved) { saved.textContent = 'Saved'; setTimeout(() => (saved.textContent = ''), 2000); }
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
  markup: `
      <section id="view-usage" class="view hidden">
        <div class="page-head">
          <div>
            <h1>Usage</h1>
            <p class="muted small"><span id="usage-sub">Tokens and cost of the orchestrator's runs</span> — <span id="usage-month">this month</span>. <span id="usage-live" class="badge live hidden">includes the running workflow</span></p>
          </div>
          <div class="row">
            <div class="seg" role="group" aria-label="Usage scope"><button type="button" data-scope="orchestrator">Orchestrator</button><button type="button" data-scope="machine">This machine</button></div>
            <button id="btn-usage-refresh" class="btn ghost">Refresh</button>
          </div>
        </div>
        <div id="usage-error" class="usage-unavailable hidden"></div>
        <div id="usage-cards" class="usage-cards"></div>

        <div id="usage-extra" class="hidden">
          <h3 class="s-subtitle">Prices <span class="muted">(for providers that don't report cost)</span></h3>
          <p class="muted small">USD per 1M tokens, used to estimate cost when the CLI does not report it.</p>
          <div id="usage-prices" class="s-group table-wrap"></div>

          <h3 class="s-subtitle">Recent runs</h3>
          <div id="usage-runs" class="s-group table-wrap"></div>
        </div>

        <p class="muted small usage-note">Costs reported by the CLIs are API-equivalent prices. On subscription plans, treat them as a usage indicator rather than an actual bill.</p>
      </section>`,
  modals: `
  <div id="budget-modal" class="modal hidden">
    <form id="budget-form" class="modal-card">
      <h3 id="budget-modal-title">Edit budget</h3>
      <div class="field">
        <label for="bd-usd">Monthly limit (USD)</label>
        <input type="text" inputmode="decimal" id="bd-usd" placeholder="No limit" />
      </div>
      <div class="field">
        <label for="bd-tokens">Monthly limit (tokens)</label>
        <input type="text" inputmode="numeric" id="bd-tokens" placeholder="No limit" />
        <div class="hint">Leave empty for no limit. Accepts values like 500K or 1.5M. A warning is shown at 80%.</div>
      </div>
      <label class="check"><input type="checkbox" id="bd-block" /><span>Block runs when the limit is reached</span></label>
      <label class="check bd-outside"><input type="checkbox" id="bd-outside" /><span>Count usage outside the orchestrator (this machine's CLI logs) toward this budget</span></label>
      <p id="bd-error" class="error small"></p>
      <div class="modal-actions">
        <button type="button" id="btn-bd-cancel" class="btn ghost">Cancel</button>
        <button type="submit" class="btn primary">Save</button>
      </div>
    </form>
  </div>`,
  mount() {
    $('#btn-usage-refresh').onclick = () => { loadUsage(); loadActionsUsage(true); };
    $('#budget-form').onsubmit = saveBudget;
    $('#btn-bd-cancel').onclick = () => closeModal('#budget-modal');
    document.querySelectorAll('#view-usage [data-scope]').forEach((b) => (b.onclick = () => setUsageScope(b.dataset.scope)));
    renderScopeToggles();
  },
  show() { renderUsage(); loadUsage(); loadActionsUsage(); },
});
