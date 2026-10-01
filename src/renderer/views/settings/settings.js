/* global api */
// Settings screen: General (workspace folder, backlog defaults), Agents & CLIs (installed CLIs and
// their sign-in), Execution (developer mode, notifications, concurrent runs) and About. Registers
// itself with registerView (view-registry.js); uses app.js globals ($, esc, errMsg, state,
// applyDeveloperMode, renderHeader, renderWorkspacePaths) and window.BACKLOG_PLATFORMS (backlog.js).

function showSettingsTab(tab) {
  document.querySelectorAll('.settings-tab').forEach((b) => b.classList.toggle('active', b.dataset.stab === tab));
  document.querySelectorAll('.settings-page').forEach((p) => p.classList.toggle('hidden', p.dataset.spage !== tab));
  if (tab === 'agents') renderTools();
  if (tab === 'about') renderAbout();
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
  renderConcurrency();
  if (!document.querySelector('[data-spage="agents"]').classList.contains('hidden')) renderTools();
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

async function renderTools() {
  const box = $('#set-tools');
  box.innerHTML = '<div class="s-row"><div class="s-label"><span>Checking…</span></div></div>';
  const tools = await api.envDetails();
  box.innerHTML = tools.map((t) => `
    <div class="s-row">
      <div class="s-label">
        <b>${esc(t.name)}</b>
        <span>${t.path ? esc(t.version || 'unknown version') : 'Not found in PATH.'}${t.account ? ` · account <b>${esc(t.account)}</b>` : ''}</span>
        ${t.path ? `<code>${esc(t.path)}</code>` : ''}
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
            <button class="settings-tab" data-stab="agents">Agents &amp; CLIs</button>
            <button class="settings-tab" data-stab="execution">Execution</button>
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
                  <div class="s-label"><b>Issues per run</b><span>The most issues Assign workflow sends as one run (one branch, one PR/MR that closes all of them).</span></div>
                  <div class="s-ctrl"><input type="number" id="set-backlog-group" min="2" max="20" aria-label="Most issues in one run" /></div>
                </div>
              </div>
              <h3 class="s-subtitle">Folders</h3>
              <div id="set-ws-folders" class="s-group"></div>
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
    $('#set-backlog-group').onchange = async (e) => {
      const n = Math.floor(Number(e.target.value));
      state.settings = await api.setSettings({ backlogMaxGroup: Number.isFinite(n) && n >= 2 ? Math.min(n, 20) : 5 });
      e.target.value = state.settings.backlogMaxGroup;
    };
    for (const sel of ['#set-cr-enabled', '#set-cr-max', '#set-cr-project', '#set-cr-sims']) $(sel).onchange = saveConcurrency;
  },
  show: renderSettings,
});
