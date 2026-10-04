/* global api */
// Settings screen (Phone gates, #226: settings-phone.js): General (workspace folder, backlog defaults with the default development workflow
// (#195, default-workflow.js), voice input, the workspace index and
// its Rebuild index, src/store.js), Agents & CLIs (installed CLIs and
// their sign-in), Execution (developer mode, Keep awake (keep-awake.js), notifications, concurrent runs, the Oracle's Self-healing switch (#278), daily budget and compaction threshold) and About. Registers
// itself with registerView (view-registry.js); uses app.js globals ($, esc, errMsg, state,
// applyDeveloperMode, renderHeader, renderWorkspacePaths), refreshProjects (views/projects/projects.js: the Projects tab, #254), commandHint (command-hint.js: the install
// commands of missing CLIs) and window.BACKLOG_PLATFORMS (backlog.js).

let settingsTab = 'general';
function showSettingsTab(tab) {
  settingsTab = tab;
  document.querySelectorAll('.settings-tab').forEach((b) => b.classList.toggle('active', b.dataset.stab === tab));
  document.querySelectorAll('.settings-page').forEach((p) => p.classList.toggle('hidden', p.dataset.spage !== tab));
  // #254: the projects live here (views/projects/projects.js draws them; from another screen, show() reads them)
  if (tab === 'projects' && state.view === 'settings') refreshProjects();
  if (tab === 'agents') renderTools();
  if (tab === 'about') renderAbout();
  if (tab === 'phone') window.PhoneGatesSettings.render();
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
  document.querySelectorAll('[data-setting]').forEach((el) => (el.checked = !!state.settings[el.dataset.setting]));
  const platform = $('#set-backlog-platform');
  platform.innerHTML = Object.entries(window.BACKLOG_PLATFORMS || {}).map(([id, p]) => `<option value="${id}">${esc(p.label)}${p.soon ? ' (sync not available yet)' : ''}</option>`).join('');
  platform.value = state.settings.backlogPlatform || 'github';
  $('#set-backlog-group').value = state.settings.backlogMaxGroup || 5;
  state.workflows = await api.listWorkflows();
  renderDefaultWorkflow();
  $('#set-backlog-refresh').value = String(state.settings.backlogRefreshHours ?? 24);
  $('#set-notif-retention').value = state.settings.notificationRetentionDays ?? 30;
  renderConcurrency();
  renderMemoryGuard();
  renderOracleSettings();
  renderSelfHealing();
  renderLiveSettings();
  renderBudgetSettings();
  renderOracleWake();
  refreshKeepAwake();
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

// Settings › Execution › Concurrent runs (settings.concurrentRuns).
function renderConcurrency() {
  const c = state.settings.concurrentRuns || {};
  $('#set-cr-enabled').checked = !!c.enabled;
  $('#set-cr-max').value = c.max || 2;
  $('#set-cr-project').value = c.perProject || '';
  $('#set-cr-sims').checked = !!c.countSimulations;
  document.querySelectorAll('#set-concurrency .cr-opt').forEach((el) => el.classList.toggle('hidden', !c.enabled));
}

async function saveConcurrency() {
  const int = (sel) => { const n = Math.floor(Number($(sel).value)); return Number.isFinite(n) && n >= 1 ? Math.min(n, 20) : null; };
  const concurrentRuns = {
    enabled: $('#set-cr-enabled').checked, max: int('#set-cr-max') || 2,
    perProject: int('#set-cr-project'), countSimulations: $('#set-cr-sims').checked,
  };
  state.settings = await api.setSettings({ concurrentRuns });
  renderConcurrency();
  renderHeader();
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
  const unavailable = !!nw && !nw.oracle;
  return `<div class="s-label"><b>Self-healing</b>
      <span>The Oracle watches every run and roadmap, day and night, and repairs what its permissions allow. It never answers a gate, pushes, closes an issue or deletes data.</span>
      <span><button type="button" class="link-btn" id="set-oracle-self-healing-perms" data-testid="self-healing-permissions" title="Opens the Night watch's checklist: one list for both">What it may do alone${esc(count)} ›</button></span>
      ${unavailable ? '<span class="error small" data-testid="self-healing-unavailable">The Oracle cannot start in this workspace, so Self-healing cannot be turned on.</span>' : ''}
    </div>
    <label class="switch"${unavailable ? ' title="The Oracle cannot start in this workspace"' : ''}><input type="checkbox" id="set-oracle-self-healing" data-testid="oracle-self-healing" aria-label="Self-healing"${o && o.selfHealing === true ? ' checked' : ''}${unavailable ? ' disabled' : ''} /><span></span></label>`;
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
  $('#set-oracle-self-healing').onchange = saveOracleSettings;
  $('#set-oracle-self-healing-perms').onclick = () => showView('nightwatch');
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
  box.innerHTML = tools.map((t) => `
    <div class="s-row">
      <div class="s-label">
        <b>${esc(t.name)}</b>
        <span>${t.path ? esc(t.version || 'unknown version') : 'Not found in PATH.'}${t.account ? ` · account <b>${esc(t.account)}</b>` : ''}</span>
        ${t.path ? `<code>${esc(t.path)}</code>` : t.installCommand ? commandHint(t.installCommand) : t.installHint ? `<span>Install: ${esc(t.installHint)}</span>` : ''}
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
          <aside class="settings-nav">
            <h1>Settings</h1>
            <button class="settings-tab active" data-stab="general">General</button>
            <button class="settings-tab" data-stab="projects">Projects</button>
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
            </div>

            <div class="settings-page hidden" data-spage="agents">
              <h2 class="settings-title">Agents &amp; CLIs</h2>
              <p class="muted small">Agent sessions are opened with these CLIs. Sign in from the terminal (<span class="mono">claude</span>, <span class="mono">codex login</span>, <span class="mono">gh auth login</span>).</p>
              <div id="set-tools" class="s-group"><div class="s-row"><div class="s-label"><span>Checking…</span></div></div></div>
              <button id="btn-tools-refresh" class="btn sm ghost">Check again</button>
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
                <div class="s-row cr-opt">
                  <div class="s-label"><b>Maximum concurrent runs</b><span>A new run is refused while this many are in progress.</span></div>
                  <div class="s-ctrl"><input type="number" id="set-cr-max" min="1" max="20" step="1" class="s-num" aria-label="Maximum concurrent runs" /></div>
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

            <!-- #254: the projects (create, edit, folders, repository), drawn by views/projects/projects.js -->
            <div class="settings-page hidden" data-spage="projects" id="settings-projects"></div>

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
    document.querySelectorAll('[data-setting]').forEach((el) => (el.onchange = async () => {
      state.settings = await api.setSettings({ [el.dataset.setting]: el.checked });
      if (el.dataset.setting === 'developerMode') applyDeveloperMode();
    }));
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
    for (const sel of ['#set-mg-enabled', '#set-mg-limit', '#set-mg-floor']) $(sel).onchange = saveMemoryGuard;
    for (const sel of ['#set-oracle-budget', '#set-oracle-compact', '#set-oracle-self-healing']) $(sel).onchange = saveOracleSettings;
    $('#set-oracle-self-healing-perms').onclick = () => showView('nightwatch');
    for (const sel of ['#set-live-cap', '#set-live-stages', '#set-live-budget', '#set-live-refresh']) $(sel).onchange = saveLiveSettings;
    for (const sel of ['#set-budget-day', '#set-budget-night']) $(sel).onchange = saveBudgetSettings;
    $('#set-oracle-wake').onchange = saveOracleWake;
  },
  // the Projects tab's cards are read again each time the screen opens on it
  show: () => { renderSettings(); if (settingsTab === 'projects') refreshProjects(); },
});
