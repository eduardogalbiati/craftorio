/* global api */
// Settings screen (Phone gates, #226: settings-phone.js): General (workspace folder, backlog defaults with the default development workflow
// (#195, default-workflow.js), voice input, the workspace index and
// its Rebuild index, src/store.js), Agents & CLIs (installed CLIs and
// their sign-in), Execution (where the engine runs (settings-engine.js), developer mode, Keep awake (keep-awake.js), notifications, concurrent runs, the Oracle's Self-healing switch (#278) and its "Apply merged fixes to this app" row (#279), daily budget and compaction threshold) and About. Registers
// itself with registerView (view-registry.js); uses app.js globals ($, esc, errMsg, state,
// applyDeveloperMode, renderHeader, renderWorkspacePaths), commandHint (command-hint.js: the install
// commands of missing CLIs) and window.BACKLOG_PLATFORMS (backlog.js). #329: its markup is
// settings-markup.js, every text from the catalog through t (src/shared/i18n.js, settings.* keys).

function showSettingsTab(tab) {
  document.querySelectorAll('.settings-tab').forEach((b) => b.classList.toggle('active', b.dataset.stab === tab));
  document.querySelectorAll('.settings-page').forEach((p) => p.classList.toggle('hidden', p.dataset.spage !== tab));
  if (tab === 'agents') renderTools();
  if (tab === 'about') renderAbout();
  if (tab === 'phone') window.PhoneGatesSettings.render();
}

// Settings › General › Time zone (#273, time-zone.js): the IANA list, the saved zone (else the
// computer's) selected, and the local time now in it
function renderTimeZone() {
  const zone = TimeZone.current();
  const sel = $('#set-time-zone');
  sel.innerHTML = TimeZone.zones(zone).map((z) => `<option value="${esc(z)}">${esc(z)}${z === TimeZone.systemZone() ? t('settings.time_zone.this_computer') : ''}</option>`).join('');
  sel.value = zone;
  $('#set-time-zone-now').textContent = t('settings.time_zone.now', { time: TimeZone.formatDateTime(Date.now(), zone), offset: TimeZone.offsetLabel(Date.now(), zone) });
}

// Control channel (#336, src/control): main's endpoint state { enabled, port, file, error, ctlPath }.
// While on, the multiagent-ctl client's path (#342) with a Copy button. The browser client (npm run
// serve) has no endpoint: the switch is disabled there.
const controlChannelAvailable = () => api.platform !== 'browser' && typeof api.controlChannelState === 'function';
function renderControlChannel(s, failure) {
  const status = $('#set-control-status');
  if (!status) return;
  const available = controlChannelAvailable();
  const box = document.querySelector('[data-setting="controlChannel"]');
  if (box) box.disabled = !available;
  const on = !!s?.enabled;
  status.textContent = !available ? t('settings.control.unavailable') : on ? t('settings.control.listening', { port: s.port, file: s.file }) : t('settings.off');
  status.title = status.textContent;
  status.className = `badge ${on ? 'cat-monitor' : ''}`;
  $('#set-control-error').textContent = failure || s?.error || '';
  const ctl = $('#set-control-ctl');
  const shown = $('#set-control-ctl-path');
  if (!ctl || !shown) return;
  const ctlPath = available && on ? s.ctlPath || '' : '';
  ctl.classList.toggle('hidden', !ctlPath);
  shown.textContent = ctlPath;
  shown.title = ctlPath;
}

async function refreshControlChannel() {
  if (!controlChannelAvailable()) return renderControlChannel(null);
  try {
    renderControlChannel(await api.controlChannelState());
  } catch (e) {
    renderControlChannel(null, errMsg(e));
  }
}

async function renderSettings() {
  state.ws = await api.getWorkspace();
  state.settings = await api.getSettings();
  const ws = state.ws;
  $('#set-ws-path').textContent = ws.root;
  $('#set-ws-registry').textContent = ws.registry || t('settings.general.registry_env');
  const folders = ['runs', 'repos', 'projects', 'skills'];
  $('#set-ws-folders').innerHTML = folders.map((k) => `
    <div class="s-row">
      <div class="s-label"><b>${k}/</b><span>${t(`settings.folders.${k}`)}</span><code>${esc(ws[k])}</code></div>
      <div class="s-ctrl"><button class="btn sm ghost" data-open="${esc(ws[k])}">${t('settings.open')}</button></div>
    </div>`).join('');
  $('#set-ws-folders').querySelectorAll('[data-open]').forEach((b) => (b.onclick = () => api.openPath(b.dataset.open)));
  renderTimeZone();
  window.LanguageSettings.render($('#set-language')); // #327, #328: settings-language.js
  window.EngineSettings.render($('#set-engine')); // this computer or a remote engine: settings-engine.js
  window.Findings?.renderList($('#set-findings-list'));
  document.querySelectorAll('[data-setting]').forEach((el) => (el.checked = !!state.settings[el.dataset.setting]));
  const platform = $('#set-backlog-platform');
  platform.innerHTML = Object.entries(window.BACKLOG_PLATFORMS || {}).map(([id, p]) => `<option value="${id}">${esc(p.label)}${p.soon ? t('settings.backlog.sync_soon') : ''}</option>`).join('');
  platform.value = state.settings.backlogPlatform || window.Platforms.DEFAULT_PLATFORM;
  $('#set-backlog-group').value = state.settings.backlogMaxGroup || 5;
  state.workflows = await api.listWorkflows();
  renderDefaultWorkflow();
  $('#set-backlog-refresh').value = String(state.settings.backlogRefreshHours ?? 24);
  $('#set-notif-retention').value = state.settings.notificationRetentionDays ?? 30;
  renderConcurrency();
  renderFallbackSettings();
  renderMemoryGuard();
  $('#set-base-check-on-red').value = { onRed: 'fix', ...(state.settings.baseCheck || {}) }.onRed;
  renderOracleSettings();
  renderSelfHealing();
  renderAppUpdate();
  renderLiveSettings();
  renderBudgetSettings();
  renderOracleWake();
  refreshKeepAwake();
  refreshControlChannel();
  renderVoice();
  renderIndexStatus();
  renderDepsCache();
  if (!document.querySelector('[data-spage="agents"]').classList.contains('hidden')) renderTools();
}

// Settings › General › Backlog › Default development workflow (#195, settings.defaultWorkflow): the
// workflows that take a task (no pipelines), the resolved default selected (DefaultWorkflow); a saved
// workflow that was deleted or renamed falls back, and the note says so.
function renderDefaultWorkflow() {
  const list = (state.workflows || []).filter((w) => !w.error && w.inputs?.task);
  const cur = DefaultWorkflow.current({ project: false });
  const sel = $('#set-default-workflow');
  sel.innerHTML = list.map((w) => `<option value="${esc(w.file)}">${esc(w.name || w.file)} (${esc(w.file)}${w.merge === 'local' ? t('settings.backlog.local_merge') : w.merge === 'remote' ? t('settings.backlog.remote_merge') : ''})</option>`).join('');
  sel.value = cur.file;
  const note = $('#set-default-wf-note');
  note.textContent = cur.missing ? t('settings.backlog.workflow_missing', { missing: cur.missing, file: cur.file }) : '';
  note.classList.toggle('hidden', !cur.missing);
}

// Settings › Agents & CLIs › Fallbacks and Limits per model (#262): settings.providers.<p>.fallbacks
// (the ordered "provider:model" entries a turn out of credits moves on to) and settings.models.<id>
// ({ timeout_factor, max_total_cost_usd }); every run gets them (src/service/areas/runs.js).
// One Save / Cancel for both groups.
const FALLBACK_ENTRY = /^[A-Za-z0-9_.-]+:\S+$/;
function renderFallbackSettings() {
  const providers = state.settings.providers || {};
  const catalog = Object.values(window.ChatModels?.PROVIDERS || {});
  const names = [...new Set([...catalog.map((p) => p.key), ...Object.keys(providers)])];
  const hint = (name) => catalog.filter((p) => p.key !== name).map((p) => t('settings.fallbacks.example', { entry: `${p.key}:${p.models[0]}` }))[0] || '';
  $('#set-fallbacks').innerHTML = names.map((name) => `<div class="s-row">
      <div class="s-label"><b>${esc(name)}</b><span>${t('settings.fallbacks.row', { provider: esc(name) })}</span></div>
      <div class="s-ctrl"><input type="text" class="s-fallbacks" data-fb-provider="${esc(name)}" value="${esc((providers[name]?.fallbacks || []).join(', '))}" placeholder="${esc(hint(name))}" aria-label="${t('settings.fallbacks.label', { provider: esc(name) })}" spellcheck="false" /></div>
    </div>`).join('');
  const models = state.settings.models || {};
  const ids = [...new Set([...catalog.flatMap((p) => p.models), ...Object.keys(models)])];
  $('#set-model-limits').innerHTML = ids.map((id) => `<div class="s-row" data-ml-model="${esc(id)}">
      <div class="s-label"><b class="mono">${esc(id)}</b></div>
      <div class="s-ctrl">
        <label class="small">${t('settings.limits.timeout')} <input type="number" class="s-num" data-ml="timeout_factor" min="0.1" step="0.1" value="${esc(models[id]?.timeout_factor ?? '')}" placeholder="1" aria-label="${t('settings.limits.timeout_label', { model: esc(id) })}" /></label>
        <label class="small">${t('settings.limits.cost')} <input type="number" class="s-num" data-ml="max_total_cost_usd" min="1" step="1" value="${esc(models[id]?.max_total_cost_usd ?? '')}" placeholder="${t('settings.limits.cost_placeholder')}" aria-label="${t('settings.limits.cost_label', { model: esc(id) })}" /></label>
      </div>
    </div>`).join('');
  window.AccountsSettings.render($('#set-accounts'), state.settings); // #312: settings-accounts.js
  $('#set-fallbacks-msg').textContent = '';
}

async function saveFallbackSettings() {
  const msg = $('#set-fallbacks-msg');
  const providers = { ...(state.settings.providers || {}) };
  for (const el of document.querySelectorAll('#set-fallbacks [data-fb-provider]')) {
    const entries = el.value.split(/[,\s]+/).map((s) => s.trim()).filter(Boolean);
    const bad = entries.find((e) => !FALLBACK_ENTRY.test(e));
    if (bad) { msg.className = 'small error'; msg.textContent = t('settings.fallbacks.invalid', { entry: bad }); el.focus({ preventScroll: true }); return; }
    const { fallbacks: _old, ...rest } = providers[el.dataset.fbProvider] || {};
    providers[el.dataset.fbProvider] = entries.length ? { ...rest, fallbacks: entries } : rest;
    if (!Object.keys(providers[el.dataset.fbProvider]).length) delete providers[el.dataset.fbProvider];
  }
  // #312: the accounts of each provider, saved with the fallbacks
  const accounts = window.AccountsSettings.collect($('#set-accounts'));
  if (accounts.invalid) { msg.className = 'small error'; msg.textContent = t('settings.accounts.invalid'); accounts.invalid.focus({ preventScroll: true }); return; }
  for (const [p, list] of Object.entries(accounts.accounts)) {
    const { accounts: _old, ...rest } = providers[p] || {};
    providers[p] = list.length ? { ...rest, accounts: list } : rest;
  }
  const models = {};
  for (const row of document.querySelectorAll('#set-model-limits [data-ml-model]')) {
    const lim = {};
    for (const el of row.querySelectorAll('[data-ml]')) {
      const n = Number(el.value);
      el.classList.toggle('invalid', el.value !== '' && !(n > 0));
      if (el.value !== '' && !(n > 0)) { msg.className = 'small error'; msg.textContent = t('settings.limits.invalid'); el.focus({ preventScroll: true }); return; }
      if (el.value !== '') lim[el.dataset.ml] = n;
    }
    if (Object.keys(lim).length) models[row.dataset.mlModel] = lim;
  }
  state.settings = await api.setSettings({ providers, models, ...(accounts.cooldown ? { accountCooldownMinutes: accounts.cooldown } : {}) });
  renderFallbackSettings();
  msg.className = 'small muted';
  msg.textContent = t('settings.fallbacks.saved');
}

// Settings › Execution › Concurrent runs (settings.concurrentRuns) and the machine profile (#367,
// settings.machineProfile, src/domains/machine/machine-profile.js through settings:machineProfile): the maximum and
// the test workers per run follow this machine in auto; a value typed here makes them manual.
async function renderConcurrency() {
  const c = state.settings.concurrentRuns || {};
  $('#set-cr-enabled').checked = !!c.enabled;
  $('#set-cr-project').value = c.perProject || '';
  $('#set-cr-sims').checked = !!c.countSimulations;
  document.querySelectorAll('#set-concurrency .cr-opt').forEach((el) => el.classList.toggle('hidden', !c.enabled));
  const mp = state.machineProfile = await api.machineProfile().catch(() => null);
  $('#set-cr-max').value = mp?.concurrentRuns || c.max || 2;
  $('#set-mp-workers').value = mp?.testWorkers || '';
  const st = mp?.state || 'unknown';
  const badge = $('#set-mp-state');
  badge.dataset.state = st;
  badge.textContent = { auto: t('settings.machine.auto'), manual: t('settings.machine.manual'), unknown: t('settings.machine.unknown') }[st];
  badge.className = `badge${st === 'auto' ? ' live' : st === 'unknown' ? ' warn' : ''}`;
  $('#set-mp-line').textContent = mp?.line || t('settings.machine.unread');
  $('#set-mp-hint').textContent = ` ${st === 'manual' ? t('settings.machine.manual_hint', { runs: mp.concurrentRuns, workers: t('settings.machine.workers', { count: mp.testWorkers }) })
    : st === 'unknown' ? t('settings.machine.unknown_hint') : t('settings.machine.auto_hint')}`;
  // Use these values: turns concurrent runs on with the machine's values (nothing to use when unknown)
  $('#set-mp-use').classList.toggle('hidden', !mp?.proposal || (st === 'auto' && !!c.enabled));
  $('#set-mp-auto').classList.toggle('hidden', st !== 'manual');
  const s = mp?.suggestion;
  $('#set-mp-suggestion').classList.toggle('hidden', !s);
  if (s) {
    $('#set-mp-suggestion-title').textContent = t('settings.machine.suggestion', { days: s.days.length, runs: t('settings.machine.runs_at_once', { count: s.concurrentRuns }) });
    $('#set-mp-suggestion-evidence').textContent = t('settings.machine.evidence', { days: s.days.join(', '), runs: s.runs.join(', ') || t('settings.machine.none_recorded') });
  }
}

const crInt = (sel, max = 20) => { const n = Math.floor(Number($(sel).value)); return Number.isFinite(n) && n >= 1 ? Math.min(n, max) : null; };
const crSettings = (patch = {}) => ({
  enabled: $('#set-cr-enabled').checked, max: crInt('#set-cr-max') || 2,
  perProject: crInt('#set-cr-project'), countSimulations: $('#set-cr-sims').checked, ...patch,
});
async function saveMachineProfile(patch) {
  state.settings = await api.setSettings(patch);
  await renderConcurrency();
  renderHeader();
}

// a switch or the per-project field keep the profile's mode; the maximum typed here is manual
async function saveConcurrency(e) {
  const concurrentRuns = crSettings();
  const current = state.settings.machineProfile || { mode: 'auto' };
  const machineProfile = e?.target?.id === 'set-cr-max'
    ? { mode: 'manual', concurrentRuns: concurrentRuns.max, ...(current.mode === 'manual' && current.testWorkers ? { testWorkers: current.testWorkers } : {}) }
    : current;
  await saveMachineProfile({ concurrentRuns, machineProfile });
}

// the test workers typed here are manual, with the maximum shown
async function saveTestWorkers() {
  const testWorkers = crInt('#set-mp-workers', 64);
  if (!testWorkers) { $('#set-mp-workers').value = state.machineProfile?.testWorkers || ''; return; }
  const concurrentRuns = crSettings();
  await saveMachineProfile({ concurrentRuns, machineProfile: { mode: 'manual', concurrentRuns: concurrentRuns.max, testWorkers } });
}

// "Use these values": concurrent runs on, the maximum and the workers following this machine
async function useMachineValues() {
  const p = state.machineProfile?.proposal;
  if (!p) return;
  await saveMachineProfile({ concurrentRuns: crSettings({ enabled: true, max: p.concurrentRuns }), machineProfile: { mode: 'auto' } });
}

// "back to auto": the machine's values again; the owner's manual values are dropped
async function machineProfileToAuto() {
  const p = state.machineProfile?.proposal;
  await saveMachineProfile({ concurrentRuns: crSettings(p ? { max: p.concurrentRuns } : {}), machineProfile: { mode: 'auto' } });
}

// the memory guard's suggestion (#367): applied on this click only, as the owner's manual maximum
async function applyMachineSuggestion() {
  const s = state.machineProfile?.suggestion;
  if (!s) return;
  const before = { concurrentRuns: state.settings.concurrentRuns, machineProfile: state.settings.machineProfile };
  const workers = state.machineProfile.state === 'manual' ? state.settings.machineProfile?.testWorkers : null;
  await saveMachineProfile({
    concurrentRuns: crSettings({ max: s.concurrentRuns }),
    machineProfile: { mode: 'manual', concurrentRuns: s.concurrentRuns, ...(workers ? { testWorkers: workers } : {}) },
  });
  window.showToast?.(t('settings.machine.lowered', { runs: t('settings.machine.runs_at_once', { count: s.concurrentRuns }) }), t('settings.machine.lowered_where'), null, null, {
    action: { label: t('common.undo'), run: () => saveMachineProfile(before) },
  });
}

// Settings › Execution › Memory guard (settings.memoryGuard, #276, src/engine/memory-guard.js): the
// hint gives the limit in GB for this machine (app:info totalMemoryBytes, binary GB like Task Manager).
async function renderMemoryGuard() {
  const g = { enabled: true, limitPercent: 25, floorPercent: 10, ...(state.settings.memoryGuard || {}) };
  $('#set-mg-enabled').checked = g.enabled !== false;
  $('#set-mg-limit').value = g.limitPercent;
  $('#set-mg-floor').value = g.floorPercent;
  for (const sel of ['#set-mg-limit', '#set-mg-floor']) { $(sel).classList.remove('invalid'); $(sel).removeAttribute('aria-invalid'); }
  document.querySelectorAll('#set-memory-guard .mg-opt').forEach((el) => el.classList.toggle('hidden', g.enabled === false));
  if (!state.totalMemoryBytes) state.totalMemoryBytes = (await api.appInfo().catch(() => null))?.totalMemoryBytes || null;
  const total = Number(state.totalMemoryBytes);
  const gb = total > 0 ? ((total * g.limitPercent) / 100 / 1024 ** 3).toFixed(1) : null;
  $('#set-mg-limit-hint').textContent = `${gb ? t('settings.memory.on_machine', { gb: I18n.formatNumber(Number(gb), undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 }) }) : ''}${t('settings.memory.limit_hint')}`;
}

// Saves the group when a field changes; a value out of its range shows the field's error state and nothing is saved.
async function saveMemoryGuard() {
  const field = (sel, min, max) => {
    const el = $(sel);
    const raw = String(el.value ?? '').trim();
    const n = Number(raw);
    const ok = raw !== '' && Number.isFinite(n) && n >= min && n <= max;
    el.classList.toggle('invalid', !ok);
    if (ok) el.removeAttribute('aria-invalid'); else el.setAttribute('aria-invalid', 'true');
    el.title = ok ? '' : t('settings.memory.out_of_range', { min, max });
    return ok ? n : null;
  };
  const limitPercent = field('#set-mg-limit', 5, 90);
  const floorPercent = field('#set-mg-floor', 0, 50);
  if (limitPercent == null || floorPercent == null) return;
  state.settings = await api.setSettings({ memoryGuard: { enabled: $('#set-mg-enabled').checked, limitPercent, floorPercent } });
  await renderMemoryGuard();
}

// Settings › General › Live roadmap (settings.liveRoadmap, read by src/live-roadmap.js, #164): every
// field is saved together, since setSettings replaces the whole object.
function renderLiveSettings() {
  const l = state.settings.liveRoadmap || {};
  $('#set-live-cap').value = l.complexityCap ?? 2;
  $('#set-live-stages').value = l.maxStages ?? 3;
  $('#set-live-budget').value = l.dailyBudgetUsd ?? 50;
  $('#set-live-refresh').checked = l.refreshFirst !== false;
}

async function saveLiveSettings() {
  const prev = state.settings.liveRoadmap || {};
  const int = (sel, min, max, fallback) => {
    const n = Math.floor(Number($(sel).value));
    return $(sel).value !== '' && Number.isFinite(n) && n >= min ? Math.min(n, max) : fallback;
  };
  const budget = Number($('#set-live-budget').value);
  const liveRoadmap = {
    ...prev,
    complexityCap: int('#set-live-cap', 1, 10, prev.complexityCap ?? 2),
    maxStages: int('#set-live-stages', 1, 10, prev.maxStages ?? 3),
    dailyBudgetUsd: $('#set-live-budget').value !== '' && Number.isFinite(budget) && budget >= 0 ? Math.min(budget, 10000) : (prev.dailyBudgetUsd ?? 50),
    refreshFirst: $('#set-live-refresh').checked,
  };
  state.settings = await api.setSettings({ liveRoadmap });
  renderLiveSettings();
}

// Settings › General › Budget (settings.budget, src/budget.js, #206): the daily and nightly caps in
// USD (empty or 0: no cap), saved together; a "Raise for today" (`raised`) is kept.
function renderBudgetSettings() {
  const b = state.settings.budget || {};
  $('#set-budget-day').value = b.dailyUsd || '';
  $('#set-budget-night').value = b.nightlyUsd || '';
}

async function saveBudgetSettings() {
  const cap = (sel) => {
    const n = Number($(sel).value);
    return $(sel).value !== '' && Number.isFinite(n) && n > 0 ? Math.min(n, 100000) : null;
  };
  const budget = { ...(state.settings.budget || {}), dailyUsd: cap('#set-budget-day'), nightlyUsd: cap('#set-budget-night') };
  state.settings = await api.setSettings({ budget });
  renderBudgetSettings();
}

// Settings › Execution › Oracle (settings.oracle, read by src/domains/oracle/oracle.js): both fields are saved
// together, since setSettings replaces the whole object.
function renderOracleSettings() {
  const o = state.settings.oracle || {};
  $('#set-oracle-budget').value = o.dailyBudgetUsd ?? 20;
  $('#set-oracle-compact').value = o.compactAtTokens || 150000;
  const park = $('#set-oracle-park');
  if (park) park.value = o.parkAfterMinutes ?? 15;
  const healing = $('#set-oracle-self-healing');
  if (healing) healing.checked = o.selfHealing === true;
}

async function saveOracleSettings() {
  const budget = Number($('#set-oracle-budget').value);
  const compact = Math.floor(Number($('#set-oracle-compact').value));
  const park = Math.floor(Number($('#set-oracle-park')?.value));
  const prev = state.settings.oracle || {};
  const healing = $('#set-oracle-self-healing');
  const oracle = {
    ...prev,
    dailyBudgetUsd: $('#set-oracle-budget').value !== '' && Number.isFinite(budget) && budget >= 0 ? Math.min(budget, 10000) : (prev.dailyBudgetUsd ?? 20),
    compactAtTokens: Number.isFinite(compact) && compact >= 10000 ? Math.min(compact, 1000000) : (prev.compactAtTokens || 150000),
    // #395: the Night watch's Move on past a gate (an empty or invalid field keeps what was saved)
    ...(Number.isFinite(park) && park >= 1 ? { parkAfterMinutes: Math.min(park, 1440) } : {}),
    ...(healing ? { selfHealing: !!healing.checked } : {}),
  };
  state.settings = await api.setSettings({ oracle });
  renderOracleSettings();
}

// Self-healing (#278, settings.oracle.selfHealing): the Oracle section's first row. `o`: settings.oracle;
// `nw`: the nightwatch:state result (null until it is read): its permissions give "N of M", and an
// Oracle that cannot start in this workspace (nw.oracle false) disables the switch, with the reason.
function selfHealingHtml(o, nw) {
  const p = nw && nw.permissions;
  const count = p ? t('settings.healing.count', { allowed: p.allowed.length, total: p.catalog.length }) : '';
  const on = !!o && o.selfHealing === true;
  // it can always be turned off: only turning it on needs the Oracle
  const unavailable = !!nw && !nw.oracle && !on;
  return `<div class="s-label"><b>${t('settings.healing.title')}</b>
      <span>${t('settings.healing.help')}</span>
      <span><button type="button" class="link-btn" id="set-oracle-self-healing-perms" data-testid="self-healing-permissions" title="${t('settings.healing.perms_title')}">${t('settings.healing.perms')}${esc(count)} ›</button></span>
      ${unavailable ? `<span class="error small" data-testid="self-healing-unavailable">${t('settings.healing.unavailable')}</span>` : ''}
    </div>
    <label class="switch"${unavailable ? ` title="${t('settings.healing.unavailable_short')}"` : ''}><input type="checkbox" id="set-oracle-self-healing" data-testid="oracle-self-healing" aria-label="${t('settings.healing.title')}"${on ? ' checked' : ''}${unavailable ? ' disabled' : ''} /><span></span></label>`;
}

// Draws the Self-healing row again with the permissions' count and whether the Oracle can start
// here; the switch saves with the Oracle's other fields (saveOracleSettings).
async function renderSelfHealing() {
  const row = $('#set-oracle-self-healing-row');
  if (!row) return;
  let nw = null;
  try { nw = await api.nightWatchState(); } catch { nw = null; }
  // a click made while the state was read is kept
  const checked = $('#set-oracle-self-healing')?.checked ?? (state.settings.oracle || {}).selfHealing === true;
  row.innerHTML = selfHealingHtml({ selfHealing: checked }, nw);
  // the app update row below needs Self-healing: drawn again with the saved switch
  $('#set-oracle-self-healing').onchange = async () => { await saveOracleSettings(); renderAppUpdate(false); };
  $('#set-oracle-self-healing-perms').onclick = () => showView('nightwatch');
}

// "Apply merged fixes to this app" (#279, settings.oracle.appUpdate, src/app-update.js):
// the row under Self-healing. `o`: settings.oracle; `info`: the app-update:state result (null while it
// is read): { applies, reason } or { applies, project, short, behind }. Off and disabled, with the
// reason, when it does not apply or Self-healing is off; the source line otherwise. One trigger (#285):
// a roadmap stage that ended; a stored oracle.appUpdateWhen is ignored.
function appUpdateHtml(o, info) {
  const healing = !!o && o.selfHealing === true;
  const applies = !!info && info.applies === true;
  const why = !info ? t('settings.app_update.checking')
    : !applies ? t('settings.app_update.unavailable', { reason: info.reason })
      : !healing ? t('settings.app_update.healing_first') : '';
  const on = applies && healing && o.appUpdate === true;
  const behind = applies ? (info.behind > 0 ? t('settings.app_update.behind', { count: info.behind }) : t('settings.app_update.up_to_date')) : '';
  return `<div class="s-label"><b>${t('settings.app_update.title')}</b>
      <span>${t('settings.app_update.help')}</span>
      ${applies ? `<span data-testid="app-update-source">${t('settings.app_update.source', { project: esc(info.project?.name || info.project?.id || ''), short: esc(info.short), behind: esc(behind) })}</span>` : ''}
      ${why ? `<span class="muted small" data-testid="app-update-reason">${esc(why)}</span>` : ''}
    </div>
    <label class="switch"><input type="checkbox" id="set-app-update" data-testid="app-update-switch" aria-label="${t('settings.app_update.title')}"${on ? ' checked' : ''}${applies && healing ? '' : ' disabled'} /><span></span></label>`;
}

// Draws the row; `fresh` reads where it applies again (when the screen opens), else the last answer.
let appUpdateInfo = null;
async function renderAppUpdate(fresh = true) {
  const row = $('#set-app-update-row');
  if (!row) return;
  if (fresh || !appUpdateInfo) {
    try { appUpdateInfo = await api.appUpdateState(true); } catch (e) { appUpdateInfo = { applies: false, reason: errMsg(e) }; }
  }
  row.innerHTML = appUpdateHtml(state.settings.oracle || {}, appUpdateInfo);
  const save = async (patch) => {
    state.settings = await api.setSettings({ oracle: { ...(state.settings.oracle || {}), ...patch } });
    renderAppUpdate(false);
  };
  $('#set-app-update').onchange = (e) => save({ appUpdate: !!e.target.checked });
}

// The Oracle's wake-ups (#123, src/domains/oracle/oracle-wake.js): which runs wake it and on which events, saved
// with the rest of settings.oracle. The kinds (oracle-wake.js WAKE_KINDS), in display order.
const ORACLE_WAKE_KINDS = [
  ['gate', () => t('settings.wake.gate')],
  ['finished', () => t('settings.wake.finished')],
  ['merge', () => t('settings.wake.merge')],
  ['limit', () => t('settings.wake.limit')],
  ['stall', () => t('settings.wake.stall')],
  ['invalid', () => t('settings.wake.invalid')],
  ['interrupted', () => t('settings.wake.interrupted')],
];
function renderOracleWake() {
  const o = state.settings.oracle || {};
  const scope = ['all', 'watched', 'off'].includes(o.wakeScope) ? o.wakeScope : 'all';
  $('#set-oracle-wake').value = scope;
  const on = Array.isArray(o.wakeOn) ? o.wakeOn : ORACLE_WAKE_KINDS.map(([k]) => k);
  $('#set-oracle-wake-on').innerHTML = ORACLE_WAKE_KINDS.map(([k, label]) => `<label class="check small"><input type="checkbox" data-oracle-wake-kind="${k}"${on.includes(k) ? ' checked' : ''}${scope === 'off' ? ' disabled' : ''} /> ${esc(label())}</label>`).join('');
  $('#set-oracle-wake-on').querySelectorAll('[data-oracle-wake-kind]').forEach((el) => (el.onchange = saveOracleWake));
}

async function saveOracleWake() {
  const oracle = {
    ...(state.settings.oracle || {}),
    wakeScope: $('#set-oracle-wake').value || 'all',
    wakeOn: [...$('#set-oracle-wake-on').querySelectorAll('[data-oracle-wake-kind]')].filter((el) => el.checked).map((el) => el.dataset.oracleWakeKind),
  };
  state.settings = await api.setSettings({ oracle });
  renderOracleWake();
}

// Settings › General › Voice input (#82): the whisper.cpp CLI, the model and the language (src/domains/chat/speech.js).
const VOICE_LANGUAGES = ['auto', 'de', 'en', 'es', 'fr', 'it', 'pt'];
async function renderVoice(st) {
  try {
    st = st || await api.speechStatus();
  } catch (e) {
    $('#set-voice-cli').textContent = errMsg(e);
    return;
  }
  $('#set-voice-command').value = state.settings.voiceCommand || '';
  $('#set-voice-cli').innerHTML = st.path
    ? t('settings.voice.found', { path: esc(st.path) })
    : t('settings.voice.not_found', { command: esc(st.command), install: st.installCommand ? commandHint(st.installCommand) : esc(st.installHint) });
  const known = st.models.some((m) => m.id === st.model);
  $('#set-voice-model').innerHTML = st.models.map((m) =>
    `<option value="${esc(m.id)}">${esc(m.label)} · ${esc(m.size)} · ${esc(m.note)}${m.downloaded ? ' ✓' : ''}</option>`).join('')
    + (known ? '' : `<option value="${esc(st.model)}">${esc(st.model)}</option>`);
  $('#set-voice-model').value = st.model;
  const btn = $('#btn-voice-download');
  btn.classList.toggle('hidden', !known || st.modelReady);
  btn.disabled = false;
  btn.textContent = t('settings.voice.download');
  $('#set-voice-model-info').textContent = st.modelReady
    ? t('settings.voice.ready', { dir: st.modelsDir })
    : known ? t('settings.voice.not_downloaded', { dir: st.modelsDir }) : t('settings.voice.model_missing');
  $('#set-voice-language').innerHTML = st.languages.map((l) => `<option value="${esc(l)}">${esc(VOICE_LANGUAGES.includes(l) ? t(`settings.voice.lang.${l}`) : l)}</option>`).join('');
  $('#set-voice-language').value = st.language;
}

async function downloadVoiceModel() {
  const btn = $('#btn-voice-download');
  btn.disabled = true;
  btn.textContent = t('settings.voice.downloading');
  try {
    await renderVoice(await api.downloadSpeechModel($('#set-voice-model').value));
  } catch (e) {
    btn.disabled = false;
    btn.textContent = t('settings.voice.download');
    $('#set-voice-model-info').textContent = errMsg(e);
  }
}

// Settings › General › Index: where index.db is, how many runs it holds, and Rebuild index.
async function renderIndexStatus(note = '') {
  const el = $('#set-index-status');
  try {
    const st = await api.indexStatus();
    $('#set-index-path').textContent = st.path;
    el.textContent = note || (st.open ? t('settings.index.indexed', { count: st.runs }) : t('settings.index.unavailable', { error: st.error || t('settings.index.unknown_error') }));
    $('#btn-index-rebuild').disabled = !st.open;
  } catch (e) { el.textContent = errMsg(e); }
}

async function rebuildIndex() {
  const btn = $('#btn-index-rebuild');
  btn.disabled = true;
  $('#set-index-status').textContent = t('settings.index.rebuilding');
  try {
    const r = await api.rebuildIndex();
    await renderIndexStatus(t('settings.index.rebuilt', { count: r.runs }));
  } catch (e) {
    $('#set-index-status').textContent = errMsg(e);
  } finally { btn.disabled = false; }
}

// The dependency cache (#198): size, entries, and Clear (the entries a worktree links stay)
const fmtCacheSize = (n) => (n >= 1024 ** 3
  ? `${I18n.formatNumber(n / 1024 ** 3, undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })} GB`
  : `${I18n.formatNumber(Math.round(n / 1024 ** 2))} MB`);
async function renderDepsCache(note) {
  const el = $('#set-deps-status');
  try {
    const c = await api.depsCacheInfo();
    $('#set-deps-path').textContent = c.dir;
    $('#set-deps-size').textContent = c.entries ? fmtCacheSize(c.bytes) : t('settings.deps.empty');
    el.textContent = note || (c.entries ? t('settings.deps.entries', { entries: t('settings.deps.count', { count: c.entries }), linked: c.linked }) : t('settings.deps.nothing'));
    $('#btn-deps-clear').disabled = !c.entries;
  } catch (e) { el.textContent = errMsg(e); }
}

async function clearDepsCache() {
  const btn = $('#btn-deps-clear');
  btn.disabled = true;
  $('#set-deps-status').textContent = t('settings.deps.clearing');
  try {
    const r = await api.clearDepsCache();
    const kept = r.kept ? t('settings.deps.kept', { count: r.kept }) : '';
    await renderDepsCache(t('settings.deps.cleared', { entries: t('settings.deps.count', { count: r.removed }), size: fmtCacheSize(r.freedBytes), kept }));
  } catch (e) {
    $('#set-deps-status').textContent = errMsg(e);
    btn.disabled = false;
  }
}

async function renderTools() {
  const box = $('#set-tools');
  box.innerHTML = `<div class="s-row"><div class="s-label"><span>${t('settings.checking')}</span></div></div>`;
  const tools = await api.envDetails();
  if (typeof setCliStates === 'function') setCliStates(tools); // the Start panel's missing CLIs follow (#319)
  box.innerHTML = tools.map((tool) => `
    <div class="s-row">
      <div class="s-label">
        <b>${esc(tool.name)}</b>
        <span>${tool.path ? esc(tool.version || t('settings.tools.unknown_version')) : t('settings.tools.not_in_path')}${tool.account ? t('settings.tools.account', { account: esc(tool.account) }) : ''}</span>
        ${tool.path ? `<code>${esc(tool.path)}</code>` : tool.installCommand ? commandHint(tool.installCommand) : tool.installHint ? `<span>${t('settings.tools.install', { hint: esc(tool.installHint) })}</span>` : ''}
        ${tool.path && !tool.connected && tool.auth && tool.signInCommand ? commandHint(tool.signInCommand, { signIn: true }) : ''}
        ${tool.path && !tool.connected && tool.output ? `<pre class="small muted">${esc(tool.output)}</pre>` : ''}
      </div>
      <div class="s-ctrl"><span class="conn ${tool.connected ? 'on' : 'off'}"><span class="conn-dot"></span>${tool.connected ? t('settings.tools.connected') : tool.path ? (tool.auth ? t('setup.status.signed_out') : t('settings.tools.error')) : t('setup.status.missing')}</span></div>
    </div>`).join('');
}

async function renderAbout() {
  const i = await api.appInfo();
  // started by the Linux AppImage without Chromium's sandbox (#476): say so, with the alternative
  const sandbox = i.noSandbox
    ? `<div class="page-alerts"><div class="alert alert-warning" role="alert" data-testid="settings-sandbox-warning"><div class="alert-body">${esc(t('settings.about.sandbox_warning'))}</div></div></div>`
    : '';
  $('#set-about').innerHTML = sandbox + [[t('settings.about.version'), i.version], ['Electron', i.electron], ['Node', i.node], [t('settings.about.workflows'), i.workflowsDir]].map(([k, v]) =>
    `<div class="s-row"><div class="s-label"><b>${esc(k)}</b></div><div class="s-ctrl mono small">${esc(v)}</div></div>`).join('');
}

async function changeWorkspace() {
  $('#ws-error').textContent = '';
  try {
    state.ws = await api.changeWorkspace();
    renderWorkspacePaths();
    renderSettings();
  } catch (e) {
    $('#ws-error').textContent = errMsg(e);
  }
}

let settingsWatching = false;
registerView({
  id: 'settings',
  nav: { label: 'Settings', order: 110, icon: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" /></svg>' },
  markup: () => window.SettingsMarkup(),
  mount() {
    document.querySelectorAll('.settings-tab').forEach((b) => (b.onclick = () => showSettingsTab(b.dataset.stab)));
    $('#btn-ws-open').onclick = () => api.openWorkspace();
    $('#btn-ws-change').onclick = changeWorkspace;
    $('#btn-tools-refresh').onclick = renderTools;
    $('#btn-fallbacks-save').onclick = () => saveFallbackSettings().catch((e) => { $('#set-fallbacks-msg').className = 'small error'; $('#set-fallbacks-msg').textContent = e.message; });
    $('#btn-fallbacks-cancel').onclick = renderFallbackSettings;
    $('#btn-setup-again').onclick = () => window.Setup.open();
    document.querySelectorAll('[data-setting]').forEach((el) => (el.onchange = async () => {
      state.settings = await api.setSettings({ [el.dataset.setting]: el.checked });
      if (el.dataset.setting === 'developerMode') applyDeveloperMode();
      if (el.dataset.setting === 'controlChannel') refreshControlChannel();
      if (el.dataset.setting === 'findingsButton') window.Findings?.refresh();
    }));
    // mount runs again when the interface language redraws the markup (#329): subscribe once
    if (!settingsWatching) api.onControlChannelChange?.(renderControlChannel);
    settingsWatching = true;
    $('#btn-control-ctl-copy').onclick = async (e) => {
      const btn = e.currentTarget;
      try {
        await api.clipboardWrite($('#set-control-ctl-path').textContent);
        btn.textContent = t('settings.execution.copied');
        setTimeout(() => { btn.textContent = t('settings.execution.copy'); }, 1500);
      } catch (err) {
        $('#set-control-error').textContent = errMsg(err);
      }
    };
    $('#set-time-zone').onchange = async (e) => { state.settings = await api.setSettings({ timeZone: e.target.value }); renderTimeZone(); TimeZone.notify(); };
    $('#set-backlog-platform').onchange = async (e) => { state.settings = await api.setSettings({ backlogPlatform: e.target.value }); };
    $('#set-default-workflow').onchange = async (e) => { state.settings = await api.setSettings({ defaultWorkflow: e.target.value || null }); renderDefaultWorkflow(); };
    $('#set-backlog-refresh').onchange = async (e) => { state.settings = await api.setSettings({ backlogRefreshHours: Number(e.target.value) || 0 }); };
    $('#set-backlog-group').onchange = async (e) => {
      const n = Math.floor(Number(e.target.value));
      state.settings = await api.setSettings({ backlogMaxGroup: Number.isFinite(n) && n >= 2 ? Math.min(n, 20) : 5 });
      e.target.value = state.settings.backlogMaxGroup;
    };
    $('#set-voice-command').onchange = async (e) => {
      state.settings = await api.setSettings({ voiceCommand: e.target.value.trim() || 'whisper-cli' });
      renderVoice();
    };
    $('#set-voice-model').onchange = async (e) => { state.settings = await api.setSettings({ voiceModel: e.target.value }); renderVoice(); };
    $('#set-voice-language').onchange = async (e) => { state.settings = await api.setSettings({ voiceLanguage: e.target.value }); };
    $('#btn-voice-download').onclick = downloadVoiceModel;
    $('#btn-index-rebuild').onclick = rebuildIndex;
    $('#btn-deps-clear').onclick = clearDepsCache;
    $('#set-notif-retention').onchange = async (e) => {
      const n = Math.floor(Number(e.target.value));
      state.settings = await api.setSettings({ notificationRetentionDays: Number.isFinite(n) && n >= 0 ? Math.min(n, 3650) : 30 });
      e.target.value = state.settings.notificationRetentionDays;
    };
    for (const sel of ['#set-cr-enabled', '#set-cr-max', '#set-cr-project', '#set-cr-sims']) $(sel).onchange = saveConcurrency;
    $('#set-mp-workers').onchange = saveTestWorkers;
    $('#set-mp-use').onclick = useMachineValues;
    $('#set-mp-auto').onclick = machineProfileToAuto;
    $('#set-mp-apply').onclick = applyMachineSuggestion;
    for (const sel of ['#set-mg-enabled', '#set-mg-limit', '#set-mg-floor']) $(sel).onchange = saveMemoryGuard;
    $('#set-base-check-on-red').onchange = async (e) => { state.settings = await api.setSettings({ baseCheck: { onRed: e.target.value } }); };
    for (const sel of ['#set-oracle-budget', '#set-oracle-compact', '#set-oracle-park', '#set-oracle-self-healing']) $(sel).onchange = saveOracleSettings;
    $('#set-oracle-self-healing-perms').onclick = () => showView('nightwatch');
    for (const sel of ['#set-live-cap', '#set-live-stages', '#set-live-budget', '#set-live-refresh']) $(sel).onchange = saveLiveSettings;
    for (const sel of ['#set-budget-day', '#set-budget-night']) $(sel).onchange = saveBudgetSettings;
    $('#set-oracle-wake').onchange = saveOracleWake;
  },
  show: () => renderSettings(),
});
