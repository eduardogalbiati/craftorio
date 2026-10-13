/* global api */
// Settings screen (Phone gates, #226: settings-phone.js): General (workspace folder, backlog defaults with the default development workflow
// (#195, default-workflow.js), voice input, the workspace index and
// its Rebuild index, src/store.js), Agents & CLIs (installed CLIs and
// their sign-in), Execution (developer mode, Keep awake (keep-awake.js), notifications, concurrent runs, the Oracle's Self-healing switch (#278) and its "Apply merged fixes to this app" row (#279), daily budget and compaction threshold) and About. Registers
// itself with registerView (view-registry.js); uses app.js globals ($, esc, errMsg, state,
// applyDeveloperMode, renderHeader, renderWorkspacePaths), commandHint (command-hint.js: the install
// commands of missing CLIs) and window.BACKLOG_PLATFORMS (backlog.js).

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
  sel.innerHTML = TimeZone.zones(zone).map((z) => `<option value="${esc(z)}">${esc(z)}${z === TimeZone.systemZone() ? ' (this computer)' : ''}</option>`).join('');
  sel.value = zone;
  $('#set-time-zone-now').textContent = `Now ${TimeZone.formatDateTime(Date.now(), zone)} (${TimeZone.offsetLabel(Date.now(), zone)})`;
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
  status.textContent = !available ? 'Not available in the browser client' : on ? `Listening on 127.0.0.1:${s.port} · ${s.file}` : 'Off';
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
  $('#set-ws-registry').textContent = ws.registry || 'MULTIAGENT_WORKSPACE environment variable (not saved)';
  const folders = [['runs', 'Run logs (one directory per run).'], ['repos', 'Repositories cloned from git URLs.'], ['projects', 'Project registry (one .json per project).'], ['skills', 'Skills (one folder with a SKILL.md per skill).']];
  $('#set-ws-folders').innerHTML = folders.map(([k, d]) => `
    <div class="s-row">
      <div class="s-label"><b>${k}/</b><span>${esc(d)}</span><code>${esc(ws[k])}</code></div>
      <div class="s-ctrl"><button class="btn sm ghost" data-open="${esc(ws[k])}">Open</button></div>
    </div>`).join('');
  $('#set-ws-folders').querySelectorAll('[data-open]').forEach((b) => (b.onclick = () => api.openPath(b.dataset.open)));
  renderTimeZone();
  window.Findings?.renderList($('#set-findings-list'));
  document.querySelectorAll('[data-setting]').forEach((el) => (el.checked = !!state.settings[el.dataset.setting]));
  const platform = $('#set-backlog-platform');
  platform.innerHTML = Object.entries(window.BACKLOG_PLATFORMS || {}).map(([id, p]) => `<option value="${id}">${esc(p.label)}${p.soon ? ' (sync not available yet)' : ''}</option>`).join('');
  platform.value = state.settings.backlogPlatform || window.Platforms.DEFAULT_PLATFORM;
  $('#set-backlog-group').value = state.settings.backlogMaxGroup || 5;
  state.workflows = await api.listWorkflows();
  renderDefaultWorkflow();
  $('#set-backlog-refresh').value = String(state.settings.backlogRefreshHours ?? 24);
  $('#set-notif-retention').value = state.settings.notificationRetentionDays ?? 30;
  renderConcurrency();
  renderFallbackSettings();
  renderMemoryGuard();
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
  const cur = DefaultWorkflow.current();
  const sel = $('#set-default-workflow');
  sel.innerHTML = list.map((w) => `<option value="${esc(w.file)}">${esc(w.name || w.file)} (${esc(w.file)}${w.merge === 'local' ? ', local merge' : w.merge === 'remote' ? ', pushes and opens PRs' : ''})</option>`).join('');
  sel.value = cur.file;
  const note = $('#set-default-wf-note');
  note.textContent = cur.missing ? `${cur.missing} no longer exists: ${cur.file} is used instead.` : '';
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
  const hint = (name) => catalog.filter((p) => p.key !== name).map((p) => `e.g. ${p.key}:${p.models[0]}`)[0] || '';
  $('#set-fallbacks').innerHTML = names.map((name) => `<div class="s-row">
      <div class="s-label"><b>${esc(name)}</b><span>Out of credits on ${esc(name)}: try these next.</span></div>
      <div class="s-ctrl"><input type="text" class="s-fallbacks" data-fb-provider="${esc(name)}" value="${esc((providers[name]?.fallbacks || []).join(', '))}" placeholder="${esc(hint(name))}" aria-label="Fallbacks of ${esc(name)}" spellcheck="false" /></div>
    </div>`).join('');
  const models = state.settings.models || {};
  const ids = [...new Set([...catalog.flatMap((p) => p.models), ...Object.keys(models)])];
  $('#set-model-limits').innerHTML = ids.map((id) => `<div class="s-row" data-ml-model="${esc(id)}">
      <div class="s-label"><b class="mono">${esc(id)}</b></div>
      <div class="s-ctrl">
        <label class="small">Timeout × <input type="number" class="s-num" data-ml="timeout_factor" min="0.1" step="0.1" value="${esc(models[id]?.timeout_factor ?? '')}" placeholder="1" aria-label="Turn timeout factor of ${esc(id)}" /></label>
        <label class="small">Cost limit US$ <input type="number" class="s-num" data-ml="max_total_cost_usd" min="1" step="1" value="${esc(models[id]?.max_total_cost_usd ?? '')}" placeholder="workflow's" aria-label="Run cost limit with ${esc(id)}" /></label>
      </div>
    </div>`).join('');
  $('#set-fallbacks-msg').textContent = '';
}

async function saveFallbackSettings() {
  const msg = $('#set-fallbacks-msg');
  const providers = { ...(state.settings.providers || {}) };
  for (const el of document.querySelectorAll('#set-fallbacks [data-fb-provider]')) {
    const entries = el.value.split(/[,\s]+/).map((s) => s.trim()).filter(Boolean);
    const bad = entries.find((e) => !FALLBACK_ENTRY.test(e));
    if (bad) { msg.className = 'small error'; msg.textContent = `"${bad}" is not provider:model (e.g. codex:gpt-6-luna).`; el.focus({ preventScroll: true }); return; }
    const { fallbacks: _old, ...rest } = providers[el.dataset.fbProvider] || {};
    providers[el.dataset.fbProvider] = entries.length ? { ...rest, fallbacks: entries } : rest;
    if (!Object.keys(providers[el.dataset.fbProvider]).length) delete providers[el.dataset.fbProvider];
  }
  const models = {};
  for (const row of document.querySelectorAll('#set-model-limits [data-ml-model]')) {
    const lim = {};
    for (const el of row.querySelectorAll('[data-ml]')) {
      const n = Number(el.value);
      el.classList.toggle('invalid', el.value !== '' && !(n > 0));
      if (el.value !== '' && !(n > 0)) { msg.className = 'small error'; msg.textContent = 'A factor or a cost limit is a positive number.'; el.focus({ preventScroll: true }); return; }
      if (el.value !== '') lim[el.dataset.ml] = n;
    }
    if (Object.keys(lim).length) models[row.dataset.mlModel] = lim;
  }
  state.settings = await api.setSettings({ providers, models });
  renderFallbackSettings();
  msg.className = 'small muted';
  msg.textContent = 'Saved: the next runs use them.';
}

// Settings › Execution › Concurrent runs (settings.concurrentRuns) and the machine profile (#367,
// settings.machineProfile, src/machine-profile.js through settings:machineProfile): the maximum and
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
  badge.textContent = { auto: 'Auto', manual: 'Manual', unknown: 'Unknown' }[st];
  badge.className = `badge${st === 'auto' ? ' live' : st === 'unknown' ? ' warn' : ''}`;
  $('#set-mp-line').textContent = mp?.line || "This machine's threads and memory couldn't be read.";
  $('#set-mp-hint').textContent = st === 'manual' ? ` Your values: ${mp.concurrentRuns} at once, ${mp.testWorkers} test worker${mp.testWorkers === 1 ? '' : 's'} per run; they stay as they are on any machine.`
    : st === 'unknown' ? ' Today\'s defaults apply; type values below to set your own.' : ' The values below follow this machine.';
  // Use these values: turns concurrent runs on with the machine's values (nothing to use when unknown)
  $('#set-mp-use').classList.toggle('hidden', !mp?.proposal || (st === 'auto' && !!c.enabled));
  $('#set-mp-auto').classList.toggle('hidden', st !== 'manual');
  const s = mp?.suggestion;
  $('#set-mp-suggestion').classList.toggle('hidden', !s);
  if (s) {
    $('#set-mp-suggestion-title').textContent = `The memory guard stepped in on ${s.days.length} days this week: lower to ${s.concurrentRuns} run${s.concurrentRuns === 1 ? '' : 's'} at once?`;
    $('#set-mp-suggestion-evidence').textContent = `Days: ${s.days.join(', ')}. Runs held or stopped: ${s.runs.join(', ') || 'none recorded'}. Nothing changes until you apply it.`;
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
  window.showToast?.(`Lowered to ${s.concurrentRuns} runs at once`, 'Settings › Execution › Concurrent runs', null, null, {
    action: { label: 'Undo', run: () => saveMachineProfile(before) },
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
  $('#set-mg-limit-hint').textContent = `${gb ? `${gb} GB on this machine. ` : ''}Between 5 and 90. Measured as committed memory on Windows, resident memory elsewhere.`;
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
    el.title = ok ? '' : `Between ${min} and ${max}: not saved.`;
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

// Settings › Execution › Oracle (settings.oracle, read by src/oracle.js): both fields are saved
// together, since setSettings replaces the whole object.
function renderOracleSettings() {
  const o = state.settings.oracle || {};
  $('#set-oracle-budget').value = o.dailyBudgetUsd ?? 20;
  $('#set-oracle-compact').value = o.compactAtTokens || 150000;
  const healing = $('#set-oracle-self-healing');
  if (healing) healing.checked = o.selfHealing === true;
}

async function saveOracleSettings() {
  const budget = Number($('#set-oracle-budget').value);
  const compact = Math.floor(Number($('#set-oracle-compact').value));
  const prev = state.settings.oracle || {};
  const healing = $('#set-oracle-self-healing');
  const oracle = {
    ...prev,
    dailyBudgetUsd: $('#set-oracle-budget').value !== '' && Number.isFinite(budget) && budget >= 0 ? Math.min(budget, 10000) : (prev.dailyBudgetUsd ?? 20),
    compactAtTokens: Number.isFinite(compact) && compact >= 10000 ? Math.min(compact, 1000000) : (prev.compactAtTokens || 150000),
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
  const count = p ? ` (${p.allowed.length} of ${p.catalog.length})` : '';
  const on = !!o && o.selfHealing === true;
  // it can always be turned off: only turning it on needs the Oracle
  const unavailable = !!nw && !nw.oracle && !on;
  return `<div class="s-label"><b>Self-healing</b>
      <span>The Oracle watches every run and roadmap, day and night, and repairs what its permissions allow. It never answers a gate, pushes, closes an issue or deletes data.</span>
      <span><button type="button" class="link-btn" id="set-oracle-self-healing-perms" data-testid="self-healing-permissions" title="Opens the Night watch's checklist: one list for both">What it may do alone${esc(count)} ›</button></span>
      ${unavailable ? '<span class="error small" data-testid="self-healing-unavailable">The Oracle cannot start in this workspace, so Self-healing cannot be turned on.</span>' : ''}
    </div>
    <label class="switch"${unavailable ? ' title="The Oracle cannot start in this workspace"' : ''}><input type="checkbox" id="set-oracle-self-healing" data-testid="oracle-self-healing" aria-label="Self-healing"${on ? ' checked' : ''}${unavailable ? ' disabled' : ''} /><span></span></label>`;
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
  const why = !info ? 'Checking whether this app runs from a project of this workspace…'
    : !applies ? `Unavailable: ${info.reason}.`
      : !healing ? 'Turn Self-healing on first.' : '';
  const on = applies && healing && o.appUpdate === true;
  const behind = applies ? (info.behind > 0 ? `${info.behind} commit${info.behind === 1 ? '' : 's'} ahead of this app` : 'the app is up to date') : '';
  return `<div class="s-label"><b>Apply merged fixes to this app</b>
      <span>After a roadmap stage ends, the app updates itself from the local main of the project that is its repository: it pauses the roadmap, waits for the runs in progress (a gate is never answered), fast-forwards, restarts and resumes the roadmap. It never pushes.</span>
      ${applies ? `<span data-testid="app-update-source">Source: <b>${esc(info.project?.name || info.project?.id || '')}</b>, local main (<code>${esc(info.short)}</code>, ${esc(behind)})</span>` : ''}
      ${why ? `<span class="muted small" data-testid="app-update-reason">${esc(why)}</span>` : ''}
    </div>
    <label class="switch"><input type="checkbox" id="set-app-update" data-testid="app-update-switch" aria-label="Apply merged fixes to this app"${on ? ' checked' : ''}${applies && healing ? '' : ' disabled'} /><span></span></label>`;
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

// The Oracle's wake-ups (#123, src/oracle-wake.js): which runs wake it and on which events, saved
// with the rest of settings.oracle. The kinds (oracle-wake.js WAKE_KINDS), in display order.
const ORACLE_WAKE_KINDS = [
  ['gate', 'Human gates waiting'],
  ['finished', 'Runs that finish'],
  ['merge', 'Merge conflicts'],
  ['limit', 'Limits and budgets'],
  ['stall', 'Stalls, supervisor decisions'],
  ['invalid', 'Repeated invalid outputs'],
  ['interrupted', 'Interrupted runs'],
];
function renderOracleWake() {
  const o = state.settings.oracle || {};
  const scope = ['all', 'watched', 'off'].includes(o.wakeScope) ? o.wakeScope : 'all';
  $('#set-oracle-wake').value = scope;
  const on = Array.isArray(o.wakeOn) ? o.wakeOn : ORACLE_WAKE_KINDS.map(([k]) => k);
  $('#set-oracle-wake-on').innerHTML = ORACLE_WAKE_KINDS.map(([k, label]) => `<label class="check small"><input type="checkbox" data-oracle-wake-kind="${k}"${on.includes(k) ? ' checked' : ''}${scope === 'off' ? ' disabled' : ''} /> ${esc(label)}</label>`).join('');
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

// Settings › General › Voice input (#82): the whisper.cpp CLI, the model and the language (src/speech.js).
const VOICE_LANGUAGES = { auto: 'Auto-detect', pt: 'Portuguese', en: 'English', es: 'Spanish', fr: 'French', de: 'German', it: 'Italian' };
async function renderVoice(st) {
  try {
    st = st || await api.speechStatus();
  } catch (e) {
    $('#set-voice-cli').textContent = errMsg(e);
    return;
  }
  $('#set-voice-command').value = state.settings.voiceCommand || '';
  $('#set-voice-cli').innerHTML = st.path
    ? `Found: <code>${esc(st.path)}</code>`
    : `Not found (command "${esc(st.command)}"). Install: ${st.installCommand ? commandHint(st.installCommand) : esc(st.installHint)}`;
  const known = st.models.some((m) => m.id === st.model);
  $('#set-voice-model').innerHTML = st.models.map((m) =>
    `<option value="${esc(m.id)}">${esc(m.label)} · ${esc(m.size)} · ${esc(m.note)}${m.downloaded ? ' ✓' : ''}</option>`).join('')
    + (known ? '' : `<option value="${esc(st.model)}">${esc(st.model)}</option>`);
  $('#set-voice-model').value = st.model;
  const btn = $('#btn-voice-download');
  btn.classList.toggle('hidden', !known || st.modelReady);
  btn.disabled = false;
  btn.textContent = 'Download';
  $('#set-voice-model-info').textContent = st.modelReady
    ? `Ready. Stored in ${st.modelsDir}.`
    : known ? `Not downloaded yet. It goes to ${st.modelsDir}.` : 'Model file not found.';
  $('#set-voice-language').innerHTML = st.languages.map((l) => `<option value="${esc(l)}">${esc(VOICE_LANGUAGES[l] || l)}</option>`).join('');
  $('#set-voice-language').value = st.language;
}

async function downloadVoiceModel() {
  const btn = $('#btn-voice-download');
  btn.disabled = true;
  btn.textContent = 'Downloading…';
  try {
    await renderVoice(await api.downloadSpeechModel($('#set-voice-model').value));
  } catch (e) {
    btn.disabled = false;
    btn.textContent = 'Download';
    $('#set-voice-model-info').textContent = errMsg(e);
  }
}

// Settings › General › Index: where index.db is, how many runs it holds, and Rebuild index.
async function renderIndexStatus(note = '') {
  const el = $('#set-index-status');
  try {
    const st = await api.indexStatus();
    $('#set-index-path').textContent = st.path;
    el.textContent = note || (st.open ? `${st.runs} run${st.runs === 1 ? '' : 's'} indexed.` : `Not available: ${st.error || 'unknown error'}. Everything still works from the files.`);
    $('#btn-index-rebuild').disabled = !st.open;
  } catch (e) { el.textContent = errMsg(e); }
}

async function rebuildIndex() {
  const btn = $('#btn-index-rebuild');
  btn.disabled = true;
  $('#set-index-status').textContent = 'Rebuilding from runs/…';
  try {
    const r = await api.rebuildIndex();
    await renderIndexStatus(`Rebuilt: ${r.runs} run${r.runs === 1 ? '' : 's'} read from runs/.`);
  } catch (e) {
    $('#set-index-status').textContent = errMsg(e);
  } finally { btn.disabled = false; }
}

// The dependency cache (#198): size, entries, and Clear (the entries a worktree links stay)
const fmtCacheSize = (n) => (n >= 1024 ** 3 ? `${(n / 1024 ** 3).toFixed(1)} GB` : `${Math.round(n / 1024 ** 2)} MB`);
async function renderDepsCache(note) {
  const el = $('#set-deps-status');
  try {
    const c = await api.depsCacheInfo();
    $('#set-deps-path').textContent = c.dir;
    $('#set-deps-size').textContent = c.entries ? fmtCacheSize(c.bytes) : 'Empty';
    el.textContent = note || (c.entries ? `${c.entries} entr${c.entries === 1 ? 'y' : 'ies'}, ${c.linked} in use by a worktree.` : 'Nothing cached yet: the first run of a project installs once.');
    $('#btn-deps-clear').disabled = !c.entries;
  } catch (e) { el.textContent = errMsg(e); }
}

async function clearDepsCache() {
  const btn = $('#btn-deps-clear');
  btn.disabled = true;
  $('#set-deps-status').textContent = 'Clearing…';
  try {
    const r = await api.clearDepsCache();
    await renderDepsCache(`Cleared ${r.removed} entr${r.removed === 1 ? 'y' : 'ies'} (${fmtCacheSize(r.freedBytes)})${r.kept ? `; ${r.kept} kept: in use by a worktree or an install` : ''}.`);
  } catch (e) {
    $('#set-deps-status').textContent = errMsg(e);
    btn.disabled = false;
  }
}

async function renderTools() {
  const box = $('#set-tools');
  box.innerHTML = '<div class="s-row"><div class="s-label"><span>Checking…</span></div></div>';
  const tools = await api.envDetails();
  if (typeof setCliStates === 'function') setCliStates(tools); // the Start panel's missing CLIs follow (#319)
  box.innerHTML = tools.map((t) => `
    <div class="s-row">
      <div class="s-label">
        <b>${esc(t.name)}</b>
        <span>${t.path ? esc(t.version || 'unknown version') : 'Not found in PATH.'}${t.account ? ` · account <b>${esc(t.account)}</b>` : ''}</span>
        ${t.path ? `<code>${esc(t.path)}</code>` : t.installCommand ? commandHint(t.installCommand) : t.installHint ? `<span>Install: ${esc(t.installHint)}</span>` : ''}
        ${t.path && !t.connected && t.auth && t.signInCommand ? commandHint(t.signInCommand, { signIn: true }) : ''}
        ${t.path && !t.connected && t.output ? `<pre class="small muted">${esc(t.output)}</pre>` : ''}
      </div>
      <div class="s-ctrl"><span class="conn ${t.connected ? 'on' : 'off'}"><span class="conn-dot"></span>${t.connected ? 'Connected' : t.path ? (t.auth ? 'Not signed in' : 'Error') : 'Not installed'}</span></div>
    </div>`).join('');
}

async function renderAbout() {
  const i = await api.appInfo();
  $('#set-about').innerHTML = [['App version', i.version], ['Electron', i.electron], ['Node', i.node], ['Workflows folder', i.workflowsDir]].map(([k, v]) =>
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

registerView({
  id: 'settings',
  nav: { label: 'Settings', order: 110, icon: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" /></svg>' },
  markup: `
      <section id="view-settings" class="view hidden">
        <div class="settings">
          <aside class="settings-nav" data-testid="settings-tabs">
            <h1>Settings</h1>
            <button class="settings-tab active" data-stab="general">General</button>
            <button class="settings-tab" data-stab="agents">Agents &amp; CLIs</button>
            <button class="settings-tab" data-stab="execution">Execution</button>
            <button class="settings-tab" data-stab="phone">Phone gates</button>
            <button class="settings-tab" data-stab="about">About</button>
          </aside>
          <div class="settings-body">
            <div class="settings-page" data-spage="general">
              <h2 class="settings-title">General</h2>
              <div class="s-group">
                <div class="s-row">
                  <div class="s-label"><b>Workspace folder</b><span>Where runs, repos, projects, skills and settings.json live.</span><code id="set-ws-path"></code></div>
                  <div class="s-ctrl row"><button id="btn-ws-open" class="btn sm ghost">Open</button><button id="btn-ws-change" class="btn sm">Change…</button></div>
                </div>
                <div class="s-row">
                  <div class="s-label"><b>Path registry entry</b><span>The workspace path is loaded from here the next time the app opens.</span><code id="set-ws-registry"></code></div>
                </div>
                <div class="s-row">
                  <div class="s-label"><b>Time zone</b><span>Times on every screen, where days, nights and months start (Analytics, Usage, budgets, the Oracle's daily limit) and the times the agents report. Until one is chosen: this computer's.</span><span id="set-time-zone-now" class="muted small"></span></div>
                  <div class="s-ctrl"><select id="set-time-zone" aria-label="Time zone" data-testid="settings-time-zone"></select></div>
                </div>
              </div>
              <p id="ws-error" class="error small"></p>
              <h3 class="s-subtitle">Backlog</h3>
              <div class="s-group">
                <div class="s-row">
                  <div class="s-label"><b>Default platform</b><span>Where the Backlog screen syncs a project's issues from. It can be changed on the Backlog screen too. GitHub uses the gh CLI and GitLab the glab CLI; Bitbucket sync is not available yet.</span></div>
                  <div class="s-ctrl"><select id="set-backlog-platform" aria-label="Default backlog platform"></select></div>
                </div>
                <div class="s-row">
                  <div class="s-label"><b>Default development workflow</b><span>Used wherever a workflow is not picked by hand: the Product Owner's plans, Split + roadmap, Create + roadmap, the Assign dialog with nothing remembered. Unset: the local workflow (no push, no PR, no CI) when the workspace has it.</span><span id="set-default-wf-note" class="warn-text hidden"></span></div>
                  <div class="s-ctrl"><select id="set-default-workflow" aria-label="Default development workflow" data-testid="settings-default-workflow"></select></div>
                </div>
                <div class="s-row">
                  <div class="s-label"><b>Issues per run</b><span>The most issues Assign workflow sends as one run (one branch, one PR/MR that closes all of them).</span></div>
                  <div class="s-ctrl"><input type="number" id="set-backlog-group" min="2" max="20" aria-label="Most issues in one run" /></div>
                </div>
                <div class="s-row">
                  <div class="s-label"><b>Suggest a backlog refresh every</b><span>The Backlog offers to run Backlog Refresh (it updates the issues' paths, lines and done tasks) when the last refresh is older than this and the base branch got merges since. It never starts a run by itself.</span></div>
                  <div class="s-ctrl"><select id="set-backlog-refresh" aria-label="Suggest a backlog refresh every">
                    <option value="12">12 hours</option>
                    <option value="24">24 hours</option>
                    <option value="48">2 days</option>
                    <option value="168">7 days</option>
                    <option value="0">Off</option>
                  </select></div>
                </div>
              </div>
              <h3 class="s-subtitle">Live roadmap</h3>
              <div id="set-live" class="s-group">
                <div class="s-row">
                  <div class="s-label"><b>Highest complexity</b><span>A refill picks open issues with a complexity:n label up to this value, lowest first; issues without one are left out.</span></div>
                  <div class="s-ctrl"><input type="number" id="set-live-cap" min="1" max="10" class="s-num" aria-label="Highest complexity a refill picks" /></div>
                </div>
                <div class="s-row">
                  <div class="s-label"><b>Stages per refill</b><span>The most stages the Product Owner adds each time the roadmap's last stage ends.</span></div>
                  <div class="s-ctrl"><input type="number" id="set-live-stages" min="1" max="10" class="s-num" aria-label="Most stages per refill" /></div>
                </div>
                <div class="s-row">
                  <div class="s-label"><b>Daily budget (USD)</b><span>The live roadmap's runs and refills over the last 24 hours; once reached, it ends after its current stages and adds nothing more. 0: no cap.</span></div>
                  <div class="s-ctrl"><input type="number" id="set-live-budget" min="0" max="10000" step="1" class="s-num" aria-label="Live roadmap daily budget in USD" /></div>
                </div>
                <div class="s-row">
                  <div class="s-label"><b>Sync before a refill</b><span>Sync the backlog from its platform before the Product Owner reads it, so it picks from current issues.</span></div>
                  <div class="s-ctrl"><label class="switch"><input type="checkbox" role="switch" id="set-live-refresh" aria-label="Sync the backlog before a refill" /><span></span></label></div>
                </div>
              </div>
              <h3 class="s-subtitle">Budget</h3>
              <p class="muted small">What real runs spend (live runs included; Codex runs priced from tokens × the model prices of Usage). When the next roadmap item's estimate would pass a budget, the roadmap pauses before starting it and tells you: raise it for today, or resume anyway. A run already started finishes; no gate is answered. The top bar shows today's spending against it.</p>
              <div id="set-budget" class="s-group">
                <div class="s-row">
                  <div class="s-label"><b>Daily budget (USD)</b><span>Per calendar day, every roadmap, the live roadmap's refills and the Night watch included. Empty: no cap.</span></div>
                  <div class="s-ctrl"><input type="number" id="set-budget-day" min="0" max="100000" step="1" class="s-num" placeholder="no cap" aria-label="Daily budget in USD" /></div>
                </div>
                <div class="s-row">
                  <div class="s-label"><b>Nightly budget (USD)</b><span>While the Night watch is on, from its start. Empty: no cap (the daily one still applies).</span></div>
                  <div class="s-ctrl"><input type="number" id="set-budget-night" min="0" max="100000" step="1" class="s-num" placeholder="no cap" aria-label="Nightly budget in USD" /></div>
                </div>
              </div>
              <h3 class="s-subtitle">Voice input</h3>
              <p class="muted small">Dictate into any field with the OS: <b>Win+H</b> on Windows, <b>Dictation</b> on macOS (press Fn twice). Or use the mic button on the long text fields (or Ctrl+Shift+M): the recording is transcribed on this machine by whisper.cpp, inserted at the cursor for review, and deleted right after. Nothing leaves the machine.</p>
              <div id="set-voice" class="s-group">
                <div class="s-row">
                  <div class="s-label"><b>Speech-to-text CLI</b><span id="set-voice-cli">Checking…</span></div>
                  <div class="s-ctrl"><input type="text" id="set-voice-command" spellcheck="false" placeholder="whisper-cli" aria-label="Speech-to-text command or path" /></div>
                </div>
                <div class="s-row">
                  <div class="s-label"><b>Model</b><span id="set-voice-model-info">Bigger models transcribe better and slower. Downloaded once into the app's data folder.</span></div>
                  <div class="s-ctrl row"><select id="set-voice-model" aria-label="Speech model"></select><button id="btn-voice-download" class="btn sm">Download</button></div>
                </div>
                <div class="s-row">
                  <div class="s-label"><b>Language</b><span>The language you speak. Auto detects it on each recording (less reliable on short ones).</span></div>
                  <div class="s-ctrl"><select id="set-voice-language" aria-label="Spoken language"></select></div>
                </div>
              </div>
              <h3 class="s-subtitle">Folders</h3>
              <div id="set-ws-folders" class="s-group"></div>
              <h3 class="s-subtitle">Index</h3>
              <div class="s-group">
                <div class="s-row">
                  <div class="s-label"><b>index.db</b><span>A SQLite index next to the files: the runs list cache, the Backlog queues, the gates waiting for you and the notifications. The files stay the source of truth: rebuilding reads every run again from runs/. <span id="set-index-status"></span></span><code id="set-index-path"></code></div>
                  <div class="s-ctrl"><button id="btn-index-rebuild" class="btn sm">Rebuild index</button></div>
                </div>
              </div>
              <h3 class="s-subtitle">Dependency cache</h3>
              <div class="s-group">
                <div class="s-row">
                  <div class="s-label"><b>Dependencies <span id="set-deps-size" class="badge">…</span></b><span>Each project's dependencies are installed once per lockfile and linked into the runs' worktrees. Entries no worktree uses are removed after 14 days or above 20 GB; clearing keeps the ones in use. <span id="set-deps-status"></span></span><code id="set-deps-path"></code></div>
                  <div class="s-ctrl"><button id="btn-deps-clear" class="btn sm">Clear dependency cache</button></div>
                </div>
              </div>
              <h3 class="s-subtitle">Findings</h3>
              <div class="s-group">
                <div class="s-row">
                  <div class="s-label"><b>Findings button</b><span>For the people building this app: freeze the view, mark what is wrong and save it with the state behind it, or file it as an issue (Ctrl+Shift+F). Always shown when the app runs from source.</span></div>
                  <label class="switch"><input type="checkbox" data-setting="findingsButton" data-testid="settings-findings-button" aria-label="Findings button" /><span></span></label>
                </div>
                <div class="s-row fd-list-row">
                  <div class="s-label"><b>Saved findings</b><span>In the workspace's findings/ folder, newest first.</span>
                    <ul id="set-findings-list" class="fd-list" data-testid="settings-findings-list" aria-label="Saved findings" data-empty="No findings yet: the Findings button saves them here."></ul>
                  </div>
                </div>
              </div>
            </div>

            <div class="settings-page hidden" data-spage="agents">
              <h2 class="settings-title">Agents &amp; CLIs</h2>
              <p class="muted small">Agent sessions are opened with these CLIs. A CLI that is not signed in shows its sign-in command; <b>Run setup again</b> walks through installing and signing in to each one.</p>
              <div id="set-tools" class="s-group"><div class="s-row"><div class="s-label"><span>Checking…</span></div></div></div>
              <div class="row">
                <button id="btn-tools-refresh" class="btn sm ghost">Check again</button>
                <button id="btn-setup-again" class="btn sm ghost" data-testid="setup-again">Run setup again</button>
              </div>
              <h3 class="s-subtitle">Fallbacks</h3>
              <p class="muted small">When an agent's provider runs out of credits or hits its usage limit, its turn moves on to the next entry, in order (<code>provider:model</code>, e.g. <code>codex:gpt-6-luna</code>), for the rest of the run. Used for an agent whose workflow declares no <code>fallbacks</code>.</p>
              <div id="set-fallbacks" class="s-group" data-testid="settings-fallbacks"></div>
              <h3 class="s-subtitle">Limits per model</h3>
              <p class="muted small">An agent on this model gets its turn timeout multiplied by the factor; a run with an agent on it may spend up to the cost limit (when it is above the workflow's). A workflow's own <code>models</code> win.</p>
              <div id="set-model-limits" class="s-group" data-testid="settings-model-limits"></div>
              <div class="row">
                <span id="set-fallbacks-msg" class="small"></span>
                <span class="spacer"></span>
                <button id="btn-fallbacks-cancel" class="btn sm ghost" type="button">Cancel</button>
                <button id="btn-fallbacks-save" class="btn sm primary" type="button" data-testid="settings-fallbacks-save">Save</button>
              </div>
            </div>

            <div class="settings-page hidden" data-spage="execution">
              <h2 class="settings-title">Execution</h2>
              <div class="s-group">
                <div class="s-row">
                  <div class="s-label"><b>Developer mode</b><span>Shows the "Simulation" checkboxes, checked by default, and the simulation scenarios of Write &amp; Review. Simulated runs call no CLI and cost nothing. Off: every run is real.</span></div>
                  <label class="switch"><input type="checkbox" data-setting="developerMode" /><span></span></label>
                </div>
                <div class="s-row">
                  <div class="s-label"><b>Open the run on start</b><span>Switch to the sessions screen as soon as a workflow starts.</span></div>
                  <label class="switch"><input type="checkbox" data-setting="openRunOnStart" /><span></span></label>
                </div>
                <div class="s-row">
                  <div class="s-label"><b>Confirm before stopping</b><span>Ask for confirmation when clicking Stop.</span></div>
                  <label class="switch"><input type="checkbox" data-setting="confirmStop" /><span></span></label>
                </div>
                <div class="s-row">
                  <div class="s-label"><b>24/7 chip in the top bar</b><span>Shows the share of the last 24 h with at least one run active (green from 90%, amber from 60%, red below). A click opens Analytics › 24/7.</span></div>
                  <label class="switch"><input type="checkbox" data-setting="showOccupancyChip" data-testid="setting-occupancy-chip" /><span></span></label>
                </div>
                <div class="s-row">
                  <div class="s-label"><b>Keep awake</b><span>Keeps this computer from sleeping while runs or a roadmap are active (this workspace; also on the Workflows screen). The display may still turn off; choosing Sleep, closing the lid and the Windows power plan still apply.</span>
                    <span class="keep-awake-line"><span class="badge keep-awake-status" data-keep-awake-status></span><span class="error small" data-keep-awake-error></span></span></div>
                  <label class="switch"><input type="checkbox" data-keep-awake-toggle aria-label="Keep awake" /><span></span></label>
                </div>
                <div class="s-row">
                  <div class="s-label"><b>Allow outside sessions to control this app</b><span>A terminal or another agent on this computer can read runs, the backlog and settings and act on roadmaps through a local endpoint (control/endpoint.json) with the multiagent-ctl client. Human gates stay closed to it.</span>
                    <span class="keep-awake-line"><span class="badge" data-testid="control-channel-status" id="set-control-status"></span><span class="error small" id="set-control-error"></span></span>
                    <span class="keep-awake-line hidden" id="set-control-ctl"><span class="muted small">Client:</span><code class="small" data-testid="control-ctl-path" id="set-control-ctl-path"></code><button type="button" class="btn sm ghost" data-testid="control-ctl-copy" id="btn-control-ctl-copy" aria-label="Copy the multiagent-ctl path">Copy</button></span></div>
                  <label class="switch"><input type="checkbox" data-setting="controlChannel" data-testid="setting-control-channel" aria-label="Allow outside sessions to control this app" /><span></span></label>
                </div>
              </div>
              <div class="s-group">
                <div class="s-row">
                  <div class="s-label"><b>Notify on run status changes</b><span>A desktop notification when a run starts, waits for you at a gate, succeeds, fails, is cancelled or was interrupted. Not shown while this window is focused on that run.</span></div>
                  <label class="switch"><input type="checkbox" data-setting="notifyRuns" /><span></span></label>
                </div>
                <div class="s-row">
                  <div class="s-label"><b>Notify when a session waits for you</b><span>A desktop notification when a CLI in a Sessions terminal stops and waits for your answer (a question, a permission prompt, the end of its turn). Not shown while this window is focused on that terminal.</span></div>
                  <label class="switch"><input type="checkbox" data-setting="notifySessions" /><span></span></label>
                </div>
                <div class="s-row">
                  <div class="s-label"><b>Notify when the Product Owner answers</b><span>A desktop notification when the Backlog's Product Owner answers a question. Not shown while this window shows its drawer for that project.</span></div>
                  <label class="switch"><input type="checkbox" data-setting="notifyPO" /><span></span></label>
                </div>
                <div class="s-row">
                  <div class="s-label"><b>Notify when the Oracle acts under Night watch</b><span>A desktop notification for each repair the Oracle makes without asking while its Night watch is on.</span></div>
                  <label class="switch"><input type="checkbox" data-setting="notifyOracle" /><span></span></label>
                </div>
                <div class="s-row">
                  <div class="s-label"><b>Keep notifications</b><span>Days the notification center (the bell at the top right) keeps notifications; older ones are deleted. 0: keep them all.</span></div>
                  <div class="s-ctrl"><input type="number" id="set-notif-retention" min="0" max="3650" step="1" class="s-num" aria-label="Days to keep notifications" /></div>
                </div>
              </div>
              <h3 class="s-subtitle">Concurrent runs</h3>
              <div id="set-concurrency" class="s-group">
                <div class="s-row">
                  <div class="s-label"><b>Allow several workflows at the same time</b><span>Off: one run at a time. On: runs start while there are free slots, and the Backlog queues fill them. Each run works in its own git worktree.</span></div>
                  <label class="switch"><input type="checkbox" id="set-cr-enabled" /><span></span></label>
                </div>
                <div class="s-row" id="set-mp-row">
                  <div class="s-label"><b>This machine <span class="badge" id="set-mp-state" data-testid="machine-profile-state"></span></b><span id="set-mp-line" data-testid="machine-profile-line"></span><span id="set-mp-hint" class="muted small"></span></div>
                  <div class="s-ctrl">
                    <button type="button" class="btn sm" id="set-mp-use" data-testid="machine-profile-use">Use these values</button>
                    <button type="button" class="link-btn" id="set-mp-auto" data-testid="machine-profile-back-to-auto">back to auto</button>
                  </div>
                </div>
                <div class="s-row hidden" id="set-mp-suggestion" data-testid="machine-profile-suggestion">
                  <div class="s-label"><b id="set-mp-suggestion-title"></b><span id="set-mp-suggestion-evidence"></span></div>
                  <div class="s-ctrl"><button type="button" class="btn sm" id="set-mp-apply" data-testid="machine-profile-apply">Apply</button></div>
                </div>
                <div class="s-row">
                  <div class="s-label"><b>Maximum concurrent runs</b><span>A new run is refused while this many are in progress (when several workflows are allowed). A value you set is kept, on any machine.</span></div>
                  <div class="s-ctrl"><input type="number" id="set-cr-max" min="1" max="20" step="1" class="s-num" aria-label="Maximum concurrent runs" /></div>
                </div>
                <div class="s-row">
                  <div class="s-label"><b>Test workers per run</b><span>Each run's agents and suite get it as MULTIAGENT_TEST_WORKERS and pass it to the test runner (--workers, --maxWorkers, -n).</span></div>
                  <div class="s-ctrl"><input type="number" id="set-mp-workers" data-testid="machine-profile-test-workers" min="1" max="64" step="1" class="s-num" aria-label="Test workers per run" /></div>
                </div>
                <div class="s-row cr-opt">
                  <div class="s-label"><b>Maximum per project</b><span>So one project's queue can't take every slot. Empty: no limit per project.</span></div>
                  <div class="s-ctrl"><input type="number" id="set-cr-project" min="1" max="20" step="1" class="s-num" placeholder="no limit" aria-label="Maximum concurrent runs per project" /></div>
                </div>
                <div class="s-row cr-opt">
                  <div class="s-label"><b>Simulations count toward the limits</b><span>Off: simulated runs (no CLI, no cost) start even when the real runs use every slot.</span></div>
                  <label class="switch"><input type="checkbox" id="set-cr-sims" /><span></span></label>
                </div>
              </div>
              <h3 class="s-subtitle">Memory guard</h3>
              <div id="set-memory-guard" class="s-group">
                <div class="s-row">
                  <div class="s-label"><b>Stop a run's runaway process</b><span>A test, a build or a script a real run started that passes the limit below is stopped with its children, before it exhausts the machine. The agent CLI itself, the app and your other programs are never stopped.</span></div>
                  <label class="switch"><input type="checkbox" id="set-mg-enabled" data-testid="memory-guard-enabled" aria-label="Memory guard on" /><span></span></label>
                </div>
                <div class="s-row mg-opt">
                  <div class="s-label"><b>Stop a process over (% of the RAM)</b><span id="set-mg-limit-hint" data-testid="memory-guard-limit-hint"></span></div>
                  <div class="s-ctrl"><input type="number" id="set-mg-limit" data-testid="memory-guard-limit" min="5" max="90" step="1" class="s-num" aria-label="Memory limit per process, percent of the RAM" /></div>
                </div>
                <div class="s-row mg-opt">
                  <div class="s-label"><b>Hold while free memory is under (%)</b><span>Suites and new runs wait while less than this share of the memory is free (a suite at most 10 minutes). 0: never hold. Between 0 and 50.</span></div>
                  <div class="s-ctrl"><input type="number" id="set-mg-floor" data-testid="memory-guard-floor" min="0" max="50" step="1" class="s-num" aria-label="Free memory floor, percent" /></div>
                </div>
              </div>
              <h3 class="s-subtitle">Oracle</h3>
              <div id="set-oracle" class="s-group">
                <div class="s-row" id="set-oracle-self-healing-row">${selfHealingHtml({}, null)}</div>
                <div class="s-row" id="set-app-update-row" data-testid="app-update-row">${appUpdateHtml({}, null)}</div>
                <div class="s-row">
                  <div class="s-label"><b>Daily budget (USD)</b><span>Once today's Oracle spend reaches it, questions are refused until tomorrow (UTC); an answer already running is not cut. It also counts in the monthly Claude Code budget. 0: no cap.</span></div>
                  <div class="s-ctrl"><input type="number" id="set-oracle-budget" min="0" max="10000" step="0.5" class="s-num" aria-label="Oracle daily budget in USD" /></div>
                </div>
                <div class="s-row">
                  <div class="s-label"><b>Compact past (tokens)</b><span>When a turn's context passes this size, the next question starts a new session from the skill, the memory and a handoff note. The history is kept.</span></div>
                  <div class="s-ctrl"><input type="number" id="set-oracle-compact" min="10000" max="1000000" step="10000" class="s-num" aria-label="Oracle compaction threshold in tokens" /></div>
                </div>
                <div class="s-row">
                  <div class="s-label"><b>Wake on run events</b><span>Which runs' events wake the Oracle: every run (except the runs you mute from its chat), only the runs and roadmaps it watches, or none. Each wake-up is one short model call, batched over 30 seconds.</span></div>
                  <div class="s-ctrl"><select id="set-oracle-wake" aria-label="Which runs wake the Oracle"><option value="all">Every run</option><option value="watched">Watched runs only</option><option value="off">Off</option></select></div>
                </div>
                <div class="s-row">
                  <div class="s-label"><b>Events that wake it</b><span>Routine events (agent output, tool calls, steps starting) never wake it.</span></div>
                  <div class="s-ctrl oracle-wake-kinds" id="set-oracle-wake-on"></div>
                </div>
              </div>
            </div>

            <!-- #226: answering the human gates from a paired phone (settings-phone.js) -->
            <div class="settings-page hidden" data-spage="phone">
              <h2 class="settings-title">Phone gates</h2>
              <div id="set-phone" data-testid="phone-gates"></div>
            </div>

            <div class="settings-page hidden" data-spage="about">
              <h2 class="settings-title">About</h2>
              <div id="set-about" class="s-group"></div>
            </div>
          </div>
        </div>
      </section>`,
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
    api.onControlChannelChange?.(renderControlChannel);
    $('#btn-control-ctl-copy').onclick = async (e) => {
      const btn = e.currentTarget;
      try {
        await api.clipboardWrite($('#set-control-ctl-path').textContent);
        btn.textContent = 'Copied';
        setTimeout(() => { btn.textContent = 'Copy'; }, 1500);
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
    for (const sel of ['#set-oracle-budget', '#set-oracle-compact', '#set-oracle-self-healing']) $(sel).onchange = saveOracleSettings;
    $('#set-oracle-self-healing-perms').onclick = () => showView('nightwatch');
    for (const sel of ['#set-live-cap', '#set-live-stages', '#set-live-budget', '#set-live-refresh']) $(sel).onchange = saveLiveSettings;
    for (const sel of ['#set-budget-day', '#set-budget-night']) $(sel).onchange = saveBudgetSettings;
    $('#set-oracle-wake').onchange = saveOracleWake;
  },
  show: () => renderSettings(),
});
