/* global api */
const $ = (sel) => document.querySelector(sel);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const fmtNum = (n) => (n || 0).toLocaleString('en-US');
const fmtCost = (n) => (n == null ? '—' : `$${Number(n).toFixed(4)}`);
function fmtDur(ms) {
  if (ms == null) return '—';
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  return h ? `${h}h${String(m).padStart(2, '0')}m` : m ? `${m}m${String(r).padStart(2, '0')}s` : `${r}s`;
}
const timeOf = (iso) => new Date(iso).toLocaleTimeString('en-US');
const dateOf = (iso) => new Date(iso).toLocaleString('en-US', { dateStyle: 'short', timeStyle: 'short' });
const LS_KEY = 'multiagent.inputs';
const USAGE_SCOPE_KEY = 'multiagent.usageScope';
const errMsg = (e) => String(e.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');

const CATEGORIES = {
  plan: 'Plan & Design',
  build: 'Code & Build',
  monitor: 'Monitor & Improve',
};
// Inputs filled with the chosen project's folder.
const isPathInput = (key) => /path|dir/i.test(key);

// ---------------------------------------------------------------------------
const state = {
  view: 'dashboard',
  ws: null,
  settings: {},
  workflows: [],
  projects: [],
  skills: [],
  wf: null,           // workflow selected in the start panel
  category: null,     // panel category filter (null = all)
  run: null,          // { id, status, startedAt, finishedAt, mock, workflow, project, inputs }
  sessions: new Map(),// id -> { ...snapshot, turnLog: Map, localOpenedAt }
  steps: new Map(),   // id -> { id, type, agent, visits, status }
  orchLog: [],
  events: [],
  selected: null,
  approval: null,
  openDetails: new Set(),
  tab: 'detail',
  pendingProject: null, // project to preselect in the panel on open
  usage: null,        // last api.getUsage() result
  usageError: null,
  usageScope: (() => { try { return localStorage.getItem(USAGE_SCOPE_KEY) === 'machine' ? 'machine' : 'orchestrator'; } catch { return 'orchestrator'; } })(),
};

// ---------------------------------------------------------------------------
// Initialization
// ---------------------------------------------------------------------------
async function init() {
  // top bar
  $('#btn-stop').onclick = stopRun;
  $('#btn-open-dir').onclick = () => api.openRunDir();
  $('#btn-quick-start').onclick = () => openDrawer();
  $('#run-meta').onclick = () => state.run && showView('run');

  // navigation
  document.querySelectorAll('.nav-item').forEach((b) => (b.onclick = () => showView(b.dataset.view)));
  document.querySelectorAll('.dash-card').forEach((b) => (b.onclick = () => openDrawer({ category: b.dataset.category })));

  // right drawer
  $('#btn-drawer-close').onclick = closeDrawer;
  $('#drawer-backdrop').onclick = closeDrawer;
  $('#wf-select').onchange = () => selectWorkflow($('#wf-select').value);
  $('#project-select').onchange = renderProjectInfo;
  $('#btn-drawer-new-project').onclick = () => openProjectModal(null, { fromDrawer: true });
  $('#btn-start').onclick = startRun;
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (!$('#usage-pop').classList.contains('hidden')) return closeUsagePopover();
    if (!$('#budget-modal').classList.contains('hidden')) return closeModal('#budget-modal');
    if (!$('#project-modal').classList.contains('hidden')) return closeModal('#project-modal');
    if (!$('#skill-modal').classList.contains('hidden')) return closeModal('#skill-modal');
    if (!$('#drawer').classList.contains('open')) return;
    closeDrawer();
  });

  // run
  $('#btn-approve').onclick = () => resolveApproval(true);
  $('#btn-reject').onclick = () => resolveApproval(false);
  document.querySelectorAll('.tab').forEach((t) => (t.onclick = () => switchTab(t.dataset.tab)));
  $('#tab-detail').addEventListener('toggle', (e) => {
    const key = e.target.dataset?.key;
    if (!key) return;
    e.target.open ? state.openDetails.add(key) : state.openDetails.delete(key);
  }, true);

  // projects
  $('#btn-new-project').onclick = () => openProjectModal(null);
  $('#btn-projects-folder').onclick = () => api.openPath(state.ws.projects);
  $('#project-form').onsubmit = saveProject;
  $('#btn-pj-cancel').onclick = () => closeModal('#project-modal');
  $('#btn-pj-pick').onclick = async () => { const d = await api.pickFolder(); if (d) $('#pj-folder').value = d; };

  // workflows
  $('#btn-workflows-folder').onclick = async () => api.openPath((await api.appInfo()).workflowsDir);

  // skills
  $('#btn-new-skill').onclick = () => openSkillModal(null);
  $('#btn-skills-folder').onclick = () => api.openPath(state.ws.skills);
  $('#skill-form').onsubmit = saveSkill;
  $('#btn-sk-cancel').onclick = () => closeModal('#skill-modal');

  // usage
  $('#usage-widget').onclick = toggleUsagePopover;
  $('#usage-pop-open').onclick = () => { closeUsagePopover(); showView('usage'); };
  document.addEventListener('mousedown', (e) => {
    if (!$('#usage-pop').classList.contains('hidden') && !e.target.closest('.usage-wrap')) closeUsagePopover();
  });
  $('#btn-usage-refresh').onclick = loadUsage;
  document.querySelectorAll('[data-scope]').forEach((b) => (b.onclick = () => setUsageScope(b.dataset.scope)));
  renderScopeToggles();
  $('#budget-form').onsubmit = saveBudget;
  $('#btn-bd-cancel').onclick = () => closeModal('#budget-modal');

  // settings
  document.querySelectorAll('.settings-tab').forEach((b) => (b.onclick = () => showSettingsTab(b.dataset.stab)));
  $('#btn-ws-open').onclick = () => api.openWorkspace();
  $('#btn-ws-change').onclick = changeWorkspace;
  $('#btn-tools-refresh').onclick = renderTools;
  document.querySelectorAll('[data-setting]').forEach((el) => (el.onchange = async () => {
    state.settings = await api.setSettings({ [el.dataset.setting]: el.checked });
  }));

  api.onEvent(onEvent);
  setInterval(renderTicking, 1000);
  loadUsage();

  state.ws = await api.getWorkspace();
  state.settings = await api.getSettings();
  [state.workflows, state.projects, state.skills] = await Promise.all([api.listWorkflows(), api.listProjects(), api.listSkills()]);
  renderWorkspacePaths();
  renderDashboard();

  const env = await api.checkEnv();
  $('#env-status').innerHTML = ['claude', 'codex'].map((k) =>
    env[k] ? `<span class="ok">✓ ${k}</span>`
           : `<span class="missing">✗ ${k} not found in PATH (use simulation mode)</span>`).join('');
}

// ---------------------------------------------------------------------------
// Navigation
// ---------------------------------------------------------------------------
function showView(view) {
  state.view = view;
  document.querySelectorAll('.view').forEach((v) => v.classList.toggle('hidden', v.id !== `view-${view}`));
  document.querySelectorAll('.nav-item').forEach((b) => b.classList.toggle('active', b.dataset.view === view));
  if (view === 'dashboard') renderDashboard();
  if (view === 'projects') refreshProjects();
  if (view === 'workflows') refreshWorkflows();
  if (view === 'skills') refreshSkills();
  if (view === 'usage') { renderUsage(); loadUsage(); }
  if (view === 'settings') renderSettings();
  if (view === 'run') scheduleRender();
}

function openModal(sel) { $(sel).classList.remove('hidden'); }
function closeModal(sel) { $(sel).classList.add('hidden'); }

function confirmDialog(title, message, yes = 'Confirm') {
  $('#confirm-title').textContent = title;
  $('#confirm-message').textContent = message;
  $('#btn-confirm-yes').textContent = yes;
  openModal('#confirm-modal');
  return new Promise((resolve) => {
    $('#btn-confirm-yes').onclick = () => { closeModal('#confirm-modal'); resolve(true); };
    $('#btn-confirm-no').onclick = () => { closeModal('#confirm-modal'); resolve(false); };
  });
}

function renderWorkspacePaths() {
  const ws = state.ws;
  $('#projects-dir').textContent = ws.projects;
  $('#skills-dir').textContent = ws.skills;
  api.appInfo().then((i) => ($('#workflows-dir').textContent = i.workflowsDir));
}

// ---------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------
function renderDashboard() {
  document.querySelectorAll('[data-count]').forEach((el) => {
    const n = state.workflows.filter((w) => w.category === el.dataset.count).length;
    el.textContent = n ? `${n} workflow${n > 1 ? 's' : ''}` : 'no workflows yet';
    el.classList.toggle('none', !n);
  });
  const r = state.run;
  const box = $('#dash-run');
  box.classList.toggle('hidden', !r);
  if (r) {
    box.innerHTML = `<span class="status st-${esc(runSessionStatus(r.status))}"><span class="status-dot"></span></span>
      <span><b>${esc(r.workflow || 'workflow')}</b>${r.project ? ` · ${esc(r.project)}` : ''} <span class="muted">— ${esc(statusLabel(r))}</span></span>
      <button class="btn sm ghost" id="dash-run-open">View run</button>`;
    $('#dash-run-open').onclick = () => showView('run');
  }
}

const runSessionStatus = (st) => ({ running: 'active', success: 'success', failed: 'failed', cancelled: 'cancelled' })[st] || 'idle';
const statusLabel = (r) => ({ idle: 'idle', running: r?.mock ? 'running (simulation)' : 'running', success: 'completed', failed: 'failed', cancelled: 'cancelled' })[r?.status || 'idle'] || r.status;

// ---------------------------------------------------------------------------
// Right drawer: start workflow
// ---------------------------------------------------------------------------
async function openDrawer({ category = null, workflow = null, project = null } = {}) {
  state.category = category;
  state.pendingProject = project;
  [state.workflows, state.projects, state.settings] = await Promise.all([api.listWorkflows(), api.listProjects(), api.getSettings()]);
  $('#mock-toggle').checked = !!state.settings.mockByDefault;
  $('#start-error').textContent = '';
  renderDrawerCategories();
  renderWorkflowOptions(workflow || state.settings.lastWorkflow);
  renderProjectOptions(project || state.settings.lastProject);
  $('#drawer').classList.add('open');
  $('#drawer').setAttribute('aria-hidden', 'false');
  $('#drawer-backdrop').classList.remove('hidden');
  setTimeout(() => ($('#in-task') || $('#wf-select')).focus(), 200);
}

function closeDrawer() {
  $('#drawer').classList.remove('open');
  $('#drawer').setAttribute('aria-hidden', 'true');
  $('#drawer-backdrop').classList.add('hidden');
}

function renderDrawerCategories() {
  const chips = [[null, 'All'], ...Object.entries(CATEGORIES)];
  $('#drawer-categories').innerHTML = chips.map(([id, label]) =>
    `<button type="button" class="chip ${state.category === id ? 'active' : ''}" data-cat="${id ?? ''}">${esc(label)}</button>`).join('');
  $('#drawer-categories').querySelectorAll('.chip').forEach((c) => (c.onclick = () => {
    state.category = c.dataset.cat || null;
    renderDrawerCategories();
    renderWorkflowOptions(state.wf?.file);
  }));
}

function renderWorkflowOptions(preferred) {
  const list = state.workflows.filter((w) => !state.category || w.category === state.category);
  const sel = $('#wf-select');
  sel.disabled = !list.length;
  sel.innerHTML = list.map((w) => `<option value="${esc(w.file)}">${esc(w.name)}${w.version ? ' v' + esc(w.version) : ''}${w.error ? ' (error)' : ''}</option>`).join('');
  if (!list.length) {
    state.wf = null;
    $('#wf-desc').textContent = state.category
      ? `No ${CATEGORIES[state.category]} workflows yet. Add a .yaml with "category: ${state.category}" to workflows/.`
      : 'No .yaml files found in workflows/.';
    $('#wf-steps-mini').innerHTML = '';
    $('#inputs-form').innerHTML = '';
    $('#adv-form').innerHTML = '';
    $('#wf-agents').innerHTML = '';
    $('#btn-start').disabled = true;
    return;
  }
  const pick = list.find((w) => w.file === preferred) || list[0];
  sel.value = pick.file;
  selectWorkflow(pick.file);
}

function renderProjectOptions(preferred) {
  const sel = $('#project-select');
  sel.innerHTML = state.projects.length
    ? `<option value="">— select a project —</option>${state.projects.map((p) => `<option value="${esc(p.id)}">${esc(p.name)}${p.exists ? '' : ' (folder not found)'}</option>`).join('')}`
    : '<option value="">No projects — click +</option>';
  if (state.projects.some((p) => p.id === preferred)) sel.value = preferred;
  renderProjectInfo();
}

function renderProjectInfo() {
  const p = state.projects.find((x) => x.id === $('#project-select').value);
  $('#project-info').textContent = p ? `${p.folder}${p.repo ? `\n${p.repo}` : ''}` : '';
}

function selectWorkflow(file) {
  const wf = state.workflows.find((w) => w.file === file);
  state.wf = wf;
  $('#wf-desc').textContent = wf.error ? `Error: ${wf.error}` : wf.description || '';
  $('#wf-steps-mini').innerHTML = (wf.steps || []).map((s) =>
    `<span class="step-chip ${s.type === 'human_approval' ? 'human' : ''}" title="${esc(s.type === 'human_approval' ? 'human approval' : s.agent)}">${esc(s.id)}</span>`).join('<span class="arrow">›</span>');
  $('#wf-agents').innerHTML = Object.entries(wf.agents || {}).map(([name, a]) =>
    `<div class="agent-row"><span>${esc(name)}</span><span class="model">${esc(a.provider)} · ${esc(a.model)}</span></div>`).join('');

  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(`${LS_KEY}.${wf.file}`) || '{}'); } catch { /* ignore */ }

  const entries = Object.entries(wf.inputs || {}).filter(([key]) => !isPathInput(key));
  const mainKey = entries.find(([k]) => k === 'task')?.[0] || entries.find(([, d]) => d.required)?.[0] || entries[0]?.[0];
  const field = ([key, def], main) => {
    const val = saved[key] ?? def.default ?? '';
    const label = `<label for="in-${key}">${main ? 'Input' : esc(key)} ${def.required ? '<span class="req">*</span>' : ''}</label>`;
    const hint = def.description ? `<div class="hint">${esc(def.description)}</div>` : '';
    let control;
    if (def.enum) {
      control = `<select id="in-${key}" name="${key}">${def.enum.map((o) => `<option ${o === val ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select>`;
    } else if (main || def.multiline) {
      control = `<textarea id="in-${key}" name="${key}" rows="${main ? 7 : 4}" placeholder="${main ? 'Describe what needs to be done…' : ''}">${esc(val)}</textarea>`;
    } else {
      control = `<input type="text" id="in-${key}" name="${key}" value="${esc(val)}" />`;
    }
    return `<div class="field">${label}${control}${hint}</div>`;
  };
  $('#inputs-form').innerHTML = entries.filter(([k]) => k === mainKey).map((e) => field(e, true)).join('');
  $('#adv-form').innerHTML = entries.filter(([k]) => k !== mainKey).map((e) => field(e, false)).join('');

  const needsProject = Object.keys(wf.inputs || {}).some(isPathInput);
  $('#project-req').classList.toggle('hidden', !needsProject);
  $('#btn-start').disabled = !!wf.error || state.run?.status === 'running';
}

function readInputs() {
  const out = {};
  for (const form of ['#inputs-form', '#adv-form']) new FormData($(form)).forEach((v, k) => (out[k] = String(v).trim()));
  return out;
}

async function startRun() {
  $('#start-error').textContent = '';
  const wf = state.wf;
  if (!wf) return;
  const project = state.projects.find((p) => p.id === $('#project-select').value);
  const pathKeys = Object.keys(wf.inputs || {}).filter(isPathInput);
  if (pathKeys.length && !project) return ($('#start-error').textContent = 'Select a project: its folder is used as the workflow repository.');
  if (project && !project.exists) return ($('#start-error').textContent = `The project folder does not exist: ${project.folder}`);

  const inputs = readInputs();
  try { localStorage.setItem(`${LS_KEY}.${wf.file}`, JSON.stringify(inputs)); } catch { /* ignore */ }
  for (const k of pathKeys) inputs[k] = project.folder;

  $('#btn-start').disabled = true;
  try {
    await api.startRun({ file: wf.file, inputs, mock: $('#mock-toggle').checked });
    state.settings = await api.setSettings({ lastWorkflow: wf.file, lastProject: project?.id || null });
    if (state.run) state.run.project = project?.name || null;
    closeDrawer();
    if (state.settings.openRunOnStart) showView('run');
  } catch (e) {
    $('#start-error').textContent = errMsg(e);
  } finally {
    renderHeader();
  }
}

async function stopRun() {
  if (state.settings.confirmStop && !(await confirmDialog('Stop workflow', 'Running sessions will be closed. Stop the workflow?', 'Stop'))) return;
  api.stopRun();
}

// ---------------------------------------------------------------------------
// Projects
// ---------------------------------------------------------------------------
async function refreshProjects() {
  state.projects = await api.listProjects();
  const box = $('#projects-list');
  if (!state.projects.length) {
    box.innerHTML = `<div class="empty-state"><b>No projects yet</b><p class="muted">Create a project that points to a local folder or a git repository.</p><button class="btn primary" id="empty-new-project">New project</button></div>`;
    $('#empty-new-project').onclick = () => openProjectModal(null);
    return;
  }
  box.innerHTML = state.projects.map((p) => `
    <div class="card" data-id="${esc(p.id)}">
      <div class="card-head">
        <span class="card-icon"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /></svg></span>
        <b class="card-title">${esc(p.name)}</b>
        ${p.error ? '<span class="badge warn">error</span>' : p.isGit ? '<span class="badge">git</span>' : ''}
      </div>
      ${p.description ? `<p class="muted small">${esc(p.description)}</p>` : ''}
      <dl class="kv">
        <dt>folder</dt><dd class="${p.exists ? '' : 'warn-text'}">${esc(p.folder || '—')}${p.exists ? '' : ' (not found)'}</dd>
        <dt>repository</dt><dd>${esc(p.repo || '—')}</dd>
      </dl>
      <div class="card-actions">
        <button class="btn sm primary" data-act="run">Start workflow</button>
        <button class="btn sm ghost" data-act="open" ${p.exists ? '' : 'disabled'}>Open folder</button>
        <span class="spacer"></span>
        <button class="btn sm ghost" data-act="edit">Edit</button>
        <button class="btn sm ghost danger" data-act="remove">Remove</button>
      </div>
    </div>`).join('');
  box.querySelectorAll('[data-act]').forEach((b) => (b.onclick = async () => {
    const p = state.projects.find((x) => x.id === b.closest('.card').dataset.id);
    if (b.dataset.act === 'run') openDrawer({ project: p.id });
    if (b.dataset.act === 'open') api.openPath(p.folder);
    if (b.dataset.act === 'edit') openProjectModal(p);
    if (b.dataset.act === 'remove' && await confirmDialog('Remove project', `Remove "${p.name}" from the list? The folder ${p.folder} is not deleted.`, 'Remove')) {
      await api.removeProject(p.id);
      refreshProjects();
    }
  }));
}

let editingProject = null;
let projectFromDrawer = false;
function openProjectModal(p, { fromDrawer = false } = {}) {
  editingProject = p;
  projectFromDrawer = fromDrawer;
  $('#project-modal-title').textContent = p ? 'Edit project' : 'New project';
  $('#btn-pj-save').textContent = p ? 'Save' : 'Create project';
  $('#pj-name').value = p?.name || '';
  $('#pj-description').value = p?.description || '';
  $('#pj-repo').value = p?.repo || '';
  $('#pj-folder').value = p?.folder || '';
  $('#pj-folder').required = !!p;
  $('#pj-folder-hint').classList.toggle('hidden', !!p);
  $('#pj-error').textContent = '';
  openModal('#project-modal');
  $('#pj-name').focus();
}

async function saveProject(e) {
  e.preventDefault();
  const data = Object.fromEntries(new FormData($('#project-form')));
  const btn = $('#btn-pj-save');
  $('#pj-error').textContent = '';
  btn.disabled = true;
  const label = btn.textContent;
  if (!editingProject && data.repo) btn.textContent = 'Cloning…';
  try {
    const p = editingProject ? await api.updateProject(editingProject.id, data) : await api.createProject(data);
    closeModal('#project-modal');
    state.projects = await api.listProjects();
    if (projectFromDrawer) renderProjectOptions(p.id);
    if (state.view === 'projects') refreshProjects();
  } catch (err) {
    $('#pj-error').textContent = errMsg(err);
  } finally {
    btn.disabled = false;
    btn.textContent = label;
  }
}

// ---------------------------------------------------------------------------
// Workflows
// ---------------------------------------------------------------------------
async function refreshWorkflows() {
  state.workflows = await api.listWorkflows();
  const box = $('#workflows-list');
  if (!state.workflows.length) {
    box.innerHTML = '<div class="empty-state"><b>No workflows</b><p class="muted">Add .yaml files to the workflows folder.</p></div>';
    return;
  }
  box.innerHTML = state.workflows.map((w) => {
    const steps = (w.steps || []).map((s, i) => {
      const human = s.type === 'human_approval';
      const names = s.agents || [s.agent];
      const who = names.map((n) => `${esc(n)}${w.agents?.[n] ? ` · <span class="mono">${esc(w.agents[n].model)}</span>` : ''}`).join(s.agents ? '<br>' : '');
      const skillNames = [...new Set([...(s.skills || []), ...names.flatMap((n) => w.agents?.[n]?.skills || [])])];
      const others = s.next.filter((n) => n !== w.steps[i + 1]?.id);
      return `<li class="wf-step ${human ? 'human' : ''}">
        <span class="wf-step-n">${i + 1}</span>
        <div class="wf-step-body">
          <div class="wf-step-head"><b>${esc(s.id)}</b>
            ${s.agents ? '<span class="badge">parallel</span>' : ''}${s.goal ? '<span class="badge">/goal</span>' : ''}${s.loop ? '<span class="badge">/loop</span>' : ''}
            ${skillNames.map((k) => `<span class="badge" title="skill">⚡ ${esc(k.replace(/\{\{\s*inputs\.(\w+)\s*\}\}/g, '‹$1›'))}</span>`).join('')}</div>
          <div class="muted small">${human ? 'human approval' : who}</div>
          ${others.length ? `<div class="wf-step-next small">↳ ${others.map((n) => `<span class="mono">${esc(n)}</span>`).join(', ')}</div>` : ''}
        </div>
      </li>`;
    }).join('');
    return `
    <article class="wf-card" data-file="${esc(w.file)}">
      <div class="wf-card-head">
        <div>
          <h3>${esc(w.name)} ${w.version ? `<span class="muted small">v${esc(w.version)}</span>` : ''}</h3>
          <p class="muted small">${esc(w.error ? `Error: ${w.error}` : w.description || '')}</p>
          <div class="badges">
            <span class="badge cat-${esc(w.category)}">${esc(CATEGORIES[w.category] || w.category)}</span>
            <span class="badge">${(w.steps || []).length} steps</span>
            <span class="badge">${Object.keys(w.agents || {}).length} agents</span>
            <span class="badge mono">${esc(w.file)}</span>
          </div>
        </div>
        <button class="btn primary sm" data-run ${w.error ? 'disabled' : ''}>Run</button>
      </div>
      <ol class="wf-steps">${steps}</ol>
    </article>`;
  }).join('');
  box.querySelectorAll('[data-run]').forEach((b) => (b.onclick = () => openDrawer({ workflow: b.closest('.wf-card').dataset.file })));
}

// ---------------------------------------------------------------------------
// Skills
// ---------------------------------------------------------------------------
async function refreshSkills() {
  state.skills = await api.listSkills();
  const box = $('#skills-list');
  if (!state.skills.length) {
    box.innerHTML = `<div class="empty-state"><b>No skills yet</b><p class="muted">Skills are reusable instructions (SKILL.md) that agents can follow.</p><button class="btn primary" id="empty-new-skill">New skill</button></div>`;
    $('#empty-new-skill').onclick = () => openSkillModal(null);
    return;
  }
  box.innerHTML = state.skills.map((s) => `
    <div class="card clickable" data-id="${esc(s.id)}">
      <div class="card-head">
        <span class="card-icon bolt"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M13 2 4 14h7l-1 8 9-12h-7z" /></svg></span>
        <b class="card-title mono">${esc(s.name)}</b>
      </div>
      <p class="muted small clamp">${esc(s.error ? `Error: ${s.error}` : s.description || 'No description.')}</p>
      <div class="card-actions">
        <span class="muted small">${s.updatedAt ? `updated ${esc(dateOf(s.updatedAt))}` : ''}${s.files?.length ? ` · +${s.files.length} file(s)` : ''}</span>
        <span class="spacer"></span>
        <button class="btn sm ghost" data-act="open">Folder</button>
        <button class="btn sm ghost danger" data-act="remove">Remove</button>
      </div>
    </div>`).join('');
  box.querySelectorAll('.card').forEach((c) => (c.onclick = async (e) => {
    const s = state.skills.find((x) => x.id === c.dataset.id);
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'open') return api.openPath(s.path);
    if (act === 'remove') {
      if (await confirmDialog('Remove skill', `Move the skill "${s.name}" to the trash?`, 'Remove')) { await api.removeSkill(s.id); refreshSkills(); }
      return;
    }
    openSkillModal(s);
  }));
}

let editingSkill = null;
function openSkillModal(s) {
  editingSkill = s;
  $('#skill-modal-title').textContent = s ? s.name : 'New skill';
  $('#sk-name-field').classList.toggle('hidden', !!s);
  $('#sk-name').value = '';
  $('#sk-description').value = s?.description || '';
  $('#sk-body').value = s?.body ?? '# Instructions\n\n- \n';
  $('#btn-sk-folder').classList.toggle('hidden', !s);
  $('#btn-sk-folder').onclick = () => s && api.openPath(s.path);
  $('#sk-error').textContent = '';
  openModal('#skill-modal');
  (s ? $('#sk-description') : $('#sk-name')).focus();
}

async function saveSkill(e) {
  e.preventDefault();
  const data = { name: $('#sk-name').value, description: $('#sk-description').value, body: $('#sk-body').value };
  try {
    if (editingSkill) await api.saveSkill(editingSkill.id, data);
    else await api.createSkill(data);
    closeModal('#skill-modal');
    refreshSkills();
  } catch (err) {
    $('#sk-error').textContent = errMsg(err);
  }
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------
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
  if (!document.querySelector('[data-spage="agents"]').classList.contains('hidden')) renderTools();
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

// ---------------------------------------------------------------------------
// Usage (tokens / cost / budgets per CLI)
// ---------------------------------------------------------------------------
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
  $('#usage-cards').innerHTML = (u.providers || []).map((p) => providerCard(p, u)).join('');
  $('#usage-cards').querySelectorAll('[data-budget]').forEach((b) => (b.onclick = () => openBudgetModal(b.dataset.budget)));
  // Don't wipe prices the user is typing.
  if (!$('#usage-prices').contains(document.activeElement)) renderPrices();
  renderUsageRuns();
}

// Highest used % (0..100) across the plan's rate-limit windows, or null.
function planWorst(p) {
  const v = (p.plan?.windows || []).map((w) => w.usedPercent).filter((x) => x != null);
  return v.length ? Math.max(...v) : null;
}

const shortDate = (iso) => new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

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
      ${p.installed ? '' : `<div class="u-install"><span class="muted small">Install with</span><code>${esc(p.installHint || '')}</code></div>`}
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
  $('#bd-usd').focus();
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
  const u = state.usage;
  const runs = u.runs || [];
  if (!runs.length) {
    $('#usage-runs').innerHTML = '<div class="s-row"><div class="s-label"><span>No runs recorded yet (simulation runs are not counted).</span></div></div>';
    return;
  }
  const names = Object.fromEntries((u.providers || []).map((p) => [p.id, p.name]));
  $('#usage-runs').innerHTML = `<table class="u-table">
    <thead><tr><th>Date</th><th>Workflow</th><th>Status</th><th class="num">Tokens</th><th class="num">Cost</th><th>By provider</th></tr></thead>
    <tbody>${runs.map((r) => `<tr title="${esc(r.runId)}">
      <td class="nowrap">${r.startedAt ? esc(dateOf(r.startedAt)) : '—'}</td>
      <td>${esc(r.workflow || '—')}</td>
      <td><span class="pill pill-${esc(r.status)}">${esc(r.status || '—')}</span></td>
      <td class="num mono">${fmtTok(r.tokens)}</td>
      <td class="num mono">${fmtUsd(r.costUsd)}</td>
      <td><div class="u-split">${Object.entries(r.byProvider || {}).map(([id, v]) =>
        `<span class="badge p-${esc(id)}" title="${esc(names[id] || id)}">${esc(id)} ${fmtTok(v.tokens)} · ${fmtUsd(v.costUsd)}</span>`).join('')}</div></td>
    </tr>`).join('')}</tbody>
  </table>`;
}

// answer: true/false or a choice id
function resolveApproval(answer) {
  if (!state.approval) return;
  api.resolveApproval(state.approval.approval_id, answer);
  closeApproval();
}

function closeApproval() {
  state.approval = null;
  $('#approval-modal').classList.add('hidden');
}

function switchTab(tab) {
  state.tab = tab;
  document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === tab));
  $('#tab-detail').classList.toggle('hidden', tab !== 'detail');
  $('#tab-events').classList.toggle('hidden', tab !== 'events');
  scheduleRender();
}

// ---------------------------------------------------------------------------
// Engine events
// ---------------------------------------------------------------------------
function resetSteps(steps) {
  state.steps = new Map(steps.map((s) => [s.id, { ...s, visits: 0, status: 'pending' }]));
}

function getTurn(sess, n) {
  if (!sess.turnLog.has(n)) sess.turnLog.set(n, { n, items: [], prompt: null, result: null, stepId: null, startedAt: null });
  return sess.turnLog.get(n);
}

function onEvent(ev) {
  state.events.push(ev);
  const sess = ev.session_id ? state.sessions.get(ev.session_id) : null;

  switch (ev.type) {
    case 'workflow.started':
      state.run = { id: ev.run_id, status: 'running', startedAt: Date.parse(ev.ts), mock: ev.mock, workflow: ev.workflow, version: ev.version, inputs: ev.inputs || {}, project: state.projects.find((p) => Object.values(ev.inputs || {}).includes(p.folder))?.name || null };
      state.sessions.clear();
      state.orchLog = [];
      state.events = [ev];
      state.selected = null;
      state.openDetails.clear();
      resetSteps(ev.steps);
      orch(ev, `workflow "${ev.workflow}" started ${ev.mock ? '(simulation)' : ''}`);
      break;

    case 'workflow.finished':
      state.run.status = ev.status;
      state.run.finishedAt = Date.parse(ev.ts);
      state.steps.forEach((s) => { if (s.status !== 'pending') s.status = 'done'; });
      orch(ev, `workflow finished: ${ev.status}${ev.error ? ' — ' + ev.error : ''}`, ev.status === 'success' ? 'transition' : 'error');
      if (state.approval) closeApproval();
      loadUsage();
      break;

    case 'session.opened':
      state.sessions.set(ev.session_id, { ...ev.session, turnLog: new Map(), localOpenedAt: Date.parse(ev.ts) });
      if (!state.selected) state.selected = ev.session_id;
      if (ev.session_id !== 'orchestrator') orch(ev, `session ${ev.session_id} opened: ${ev.session.agent} (${ev.session.provider} · ${ev.session.model})`);
      break;

    case 'session.status':
      if (sess) sess.status = ev.status;
      break;

    case 'session.closed':
      if (sess) Object.assign(sess, ev.session);
      if (ev.session_id !== 'orchestrator') orch(ev, `session ${ev.session_id} closed (${ev.status})`);
      break;

    case 'session.message_sent':
      if (sess) {
        const t = getTurn(sess, ev.turn);
        t.prompt = ev.prompt; t.stepId = ev.step_id; t.startedAt = Date.parse(ev.ts);
        sess.turns_count = ev.turn;
        orch(ev, `→ ${ev.session_id} turn ${ev.turn} (${ev.step_id})`);
      }
      break;

    case 'session.stream':
      if (sess) {
        if (ev.item.kind === 'session' && ev.item.sessionId) sess.provider_session_id = ev.item.sessionId;
        if (ev.item.kind !== 'usage' && ev.item.kind !== 'session') getTurn(sess, ev.turn).items.push(ev.item);
      }
      break;

    case 'session.message_received':
      if (sess) {
        getTurn(sess, ev.turn).result = { usage: ev.usage, cost: ev.cost_usd, duration: ev.duration_ms };
        Object.assign(sess, ev.session);
        orch(ev, `← ${ev.session_id} replied in ${fmtDur(ev.duration_ms)}`);
      }
      if (state.run?.status === 'running') loadUsageThrottled();
      break;

    case 'step.started': {
      const s = state.steps.get(ev.step_id);
      if (s) { s.status = 'running'; s.visits = ev.visit; }
      orch(ev, `▶ step ${ev.step_id} (visit ${ev.visit})`, 'transition');
      break;
    }
    case 'step.finished': {
      const s = state.steps.get(ev.step_id);
      if (s) s.status = 'done';
      break;
    }
    case 'step.waiting': {
      const s = state.steps.get(ev.step_id);
      if (s) s.status = 'waiting';
      orch(ev, `⏳ ${ev.step_id}: /loop, next check in ${fmtDur(ev.interval_ms)}`);
      break;
    }
    case 'step.goal':
      orch(ev, `🎯 /goal ${ev.met ? 'met' : 'pending'}: ${ev.goal} (iteration ${ev.iteration})`, ev.met ? 'transition' : '');
      break;
    case 'step.transition':
      orch(ev, `${ev.from} → ${ev.to}   [${ev.when}]`, 'transition');
      break;

    case 'approval.requested':
      state.approval = ev;
      $('#approval-step').textContent = `step: ${ev.step_id}`;
      $('#approval-message').textContent = ev.message;
      $('#approval-binary').classList.toggle('hidden', !!ev.choices);
      $('#approval-choices').classList.toggle('hidden', !ev.choices);
      $('#approval-choices').innerHTML = (ev.choices || []).map((c, i) =>
        `<button class="btn ${i === 0 ? 'primary' : 'ghost'}" data-choice="${esc(c.id)}">${esc(c.label)}</button>`).join('');
      $('#approval-choices').querySelectorAll('[data-choice]').forEach((b) => (b.onclick = () => resolveApproval(b.dataset.choice)));
      $('#approval-modal').classList.remove('hidden');
      orch(ev, `? approval requested at ${ev.step_id}`, 'warn');
      break;

    case 'approval.resolved':
      if (state.approval?.approval_id === ev.approval_id) closeApproval();
      if (ev.choice !== undefined) orch(ev, `human decision: ${ev.choice} (${ev.by})`, 'transition');
      else orch(ev, `approval ${ev.approved ? 'granted' : 'denied'} (${ev.by})`, ev.approved ? 'transition' : 'warn');
      break;

    case 'action.executed':
      orch(ev, `$ ${ev.command} ${ev.skipped ? '(not executed — simulation)' : `→ exit ${ev.exit_code}`}`);
      break;

    case 'limit.exceeded':
      orch(ev, `limit exceeded: ${ev.limit}`, 'error');
      break;

    case 'file.saved':
      orch(ev, `💾 ${ev.step_id}${ev.agent ? ` (${ev.agent})` : ''} saved to ${ev.path}`);
      break;

    case 'budget.exceeded':
      orch(ev, `💸 ${ev.provider} reached its monthly budget${ev.blocked ? ': turn blocked' : ' (not blocking)'}`, ev.blocked ? 'error' : 'warn');
      break;

    case 'decision.logged':
      orch(ev, `📝 ${ev.agent} logged ${ev.count} decision(s) in ${ev.path}`);
      break;

    case 'log':
      orch(ev, ev.message, ev.level);
      break;
  }
  scheduleRender();
}

function orch(ev, text, level = '') {
  state.orchLog.push({ ts: ev.ts, text, level });
}

// ---------------------------------------------------------------------------
// Render
// ---------------------------------------------------------------------------
let rafPending = false;
function scheduleRender() {
  if (rafPending) return;
  rafPending = true;
  requestAnimationFrame(() => { rafPending = false; render(); });
}

function render() {
  renderHeader();
  if (state.view !== 'run') return;
  renderRunSummary();
  renderSteps();
  renderSessions();
  if (state.tab === 'detail') renderDetail();
  else renderEvents();
}

function renderTicking() {
  if (state.run?.status === 'running') { renderHeader(); renderSessions(); }
}

function liveDuration(s) {
  if (s.closed_at) return s.duration_ms;
  return Date.now() - (s.localOpenedAt || Date.parse(s.opened_at));
}

function totals() {
  const t = { input: 0, output: 0, cache_read: 0, cache_write: 0, reasoning: 0, cost: 0 };
  state.sessions.forEach((s) => {
    for (const k of ['input', 'output', 'cache_read', 'cache_write', 'reasoning']) t[k] += s.tokens?.[k] || 0;
    t.cost += s.cost_usd || 0;
  });
  return t;
}

function renderHeader() {
  const r = state.run;
  const pill = $('#run-status');
  const st = r?.status || 'idle';
  pill.className = `pill pill-${st}`;
  pill.textContent = statusLabel(r);
  $('#run-meta').classList.toggle('clickable', !!r);
  $('#nav-run-dot').parentElement.className = `nav-item nav-run st-${runSessionStatus(st)}${state.view === 'run' ? ' active' : ''}${r ? '' : ' hidden'}`;
  $('#run-id').textContent = r?.id || '';
  $('#kpi-time').textContent = r ? fmtDur((r.finishedAt || Date.now()) - r.startedAt) : '—';
  $('#kpi-sessions').textContent = String([...state.sessions.keys()].filter((k) => k !== 'orchestrator').length);
  const t = totals();
  $('#kpi-tokens').textContent = `${fmtNum(t.input + t.cache_read)} / ${fmtNum(t.output)}`;
  $('#kpi-reasoning').textContent = fmtNum(t.reasoning);
  $('#kpi-cost').textContent = `$${t.cost.toFixed(4)}`;
  $('#btn-stop').disabled = st !== 'running';
  $('#btn-start').disabled = st === 'running' || !state.wf || !!state.wf.error;
  $('#btn-start').textContent = st === 'running' ? 'A workflow is already running' : 'Start workflow';
  if (state.view === 'dashboard') renderDashboard();
}

function renderRunSummary() {
  const r = state.run;
  if (!r) return;
  const inputs = Object.entries(r.inputs || {}).filter(([, v]) => v !== undefined && v !== '');
  $('#run-summary').innerHTML = `
    <div class="run-summary-name"><b>${esc(r.workflow || '')}</b>${r.version ? ` <span class="muted small">v${esc(r.version)}</span>` : ''}</div>
    ${r.project ? `<div class="small">Project: <b>${esc(r.project)}</b></div>` : ''}
    <dl class="kv">${inputs.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(String(v).length > 160 ? String(v).slice(0, 160) + '…' : v)}</dd>`).join('')}</dl>`;
}

function renderSteps() {
  $('#steps').innerHTML = [...state.steps.values()].map((s) => `
    <li class="${s.status}">
      <span class="dot"></span>
      <span>${esc(s.id)}<br><span class="kind">${s.type === 'human_approval' ? 'human approval' : esc(s.agent)}</span></span>
      <span class="visits">${s.visits ? '×' + s.visits : ''}</span>
    </li>`).join('');
}

function renderSessions() {
  const box = $('#sessions');
  if (!state.sessions.size) return;
  const list = [...state.sessions.values()];
  box.innerHTML = list.map((s) => {
    const isOrch = s.id === 'orchestrator';
    const t = s.tokens || {};
    return `
    <div class="session-card ${isOrch ? '' : 'child'} ${state.selected === s.id ? 'selected' : ''}" data-id="${esc(s.id)}">
      <div class="sc-head">
        <span class="name">${esc(s.agent)}</span>
        <span class="id">${esc(s.id)}</span>
        <span class="status st-${esc(s.status)}"><span class="status-dot"></span>${esc(s.status)}</span>
      </div>
      <div class="badges">
        <span class="badge p-${esc(s.provider)}">${esc(s.provider)}</span>
        <span class="badge">${esc(s.model)}</span>
        ${isOrch ? '' : `<span class="badge">${s.turns || 0} turn(s)</span>`}
      </div>
      <div class="metrics">
        <div class="metric"><label>open</label><b>${fmtDur(liveDuration(s))}</b></div>
        ${isOrch ? `
        <div class="metric"><label>steps</label><b>${[...state.steps.values()].reduce((a, x) => a + x.visits, 0)}</b></div>
        <div class="metric"><label>child sessions</label><b>${list.length - 1}</b></div>
        <div class="metric"><label>total cost</label><b>${fmtCost(totals().cost)}</b></div>` : `
        <div class="metric"><label>active</label><b>${fmtDur(s.active_ms)}</b></div>
        <div class="metric"><label>in / out</label><b>${fmtNum((t.input || 0) + (t.cache_read || 0))} / ${fmtNum(t.output)}</b></div>
        <div class="metric"><label>cost</label><b>${fmtCost(s.cost_usd)}</b></div>`}
      </div>
    </div>`;
  }).join('');
  box.querySelectorAll('.session-card').forEach((el) => (el.onclick = () => {
    state.selected = el.dataset.id;
    if (state.tab !== 'detail') switchTab('detail'); else scheduleRender();
  }));
}

function detailsBlock(key, cls, label, body) {
  const open = state.openDetails.has(key);
  return `<details class="item ${cls}" data-key="${esc(key)}" ${open ? 'open' : ''}>
    <summary><div class="label">${label}</div></summary><pre>${esc(body)}</pre></details>`;
}

function renderItem(sid, turn, item, i) {
  const key = `${sid}:${turn}:${i}`;
  switch (item.kind) {
    case 'thinking': return detailsBlock(key, 'thinking', 'thinking', item.text);
    case 'text': return `<div class="item text"><div class="label">output</div><pre>${esc(item.text)}</pre></div>`;
    case 'tool_call': return `<div class="item tool_call"><div class="label">tool · ${esc(item.name)}</div><pre>${esc(typeof item.input === 'string' ? item.input : JSON.stringify(item.input, null, 2))}</pre></div>`;
    case 'tool_result': return detailsBlock(key, 'tool_result', `result${item.is_error ? ' (error)' : ''}`, item.output);
    case 'stderr': return `<div class="item stderr"><div class="label">stderr</div><pre>${esc(item.text)}</pre></div>`;
    case 'spawn': return `<div class="item spawn"><div class="label">process</div><pre>${esc(item.command)} ${esc(item.args.join(' '))}\ncwd: ${esc(item.cwd)}</pre></div>`;
    default: return `<div class="item raw"><div class="label">event</div><pre>${esc(item.text || JSON.stringify(item.event))}</pre></div>`;
  }
}

function renderDetail() {
  const box = $('#tab-detail');
  const s = state.sessions.get(state.selected);
  if (!s) return;
  const atBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 40;

  let html = `
    <div class="detail-head">
      <h3>${esc(s.agent)} <span class="badge p-${esc(s.provider)}">${esc(s.provider)}</span> <span class="badge">${esc(s.model)}</span></h3>
      <dl class="kv">
        <dt>session</dt><dd>${esc(s.id)}</dd>
        <dt>provider session</dt><dd>${esc(s.provider_session_id || '—')}</dd>
        <dt>status</dt><dd>${esc(s.status)}</dd>
        <dt>opened at</dt><dd>${esc(timeOf(s.opened_at))}${s.closed_at ? ' → ' + esc(timeOf(s.closed_at)) : ''}</dd>
        <dt>duration / active / idle</dt><dd>${fmtDur(liveDuration(s))} / ${fmtDur(s.active_ms)} / ${fmtDur(s.idle_ms)}</dd>
        <dt>tokens</dt><dd>in ${fmtNum(s.tokens?.input)} · cache r/w ${fmtNum(s.tokens?.cache_read)}/${fmtNum(s.tokens?.cache_write)} · out ${fmtNum(s.tokens?.output)} · reasoning ${fmtNum(s.tokens?.reasoning)}</dd>
        <dt>cost</dt><dd>${fmtCost(s.cost_usd)}</dd>
      </dl>
    </div>`;

  if (s.id === 'orchestrator') {
    html += `<div class="orch-log">${state.orchLog.map((l) =>
      `<div class="line ${esc(l.level)}"><span class="ts">${esc(timeOf(l.ts))}</span><span>${esc(l.text)}</span></div>`).join('')}</div>`;
  } else {
    html += [...s.turnLog.values()].map((t) => `
      <div class="turn">
        <div class="turn-head">
          <span class="t">Turn ${t.n}</span><span class="muted">${esc(t.stepId || '')}</span>
          <span class="meta">${t.result ? `${fmtDur(t.result.duration)} · in ${fmtNum((t.result.usage?.input || 0) + (t.result.usage?.cache_read || 0))} · out ${fmtNum(t.result.usage?.output)} · ${fmtCost(t.result.cost)}` : 'in progress…'}</span>
        </div>
        <div class="turn-body">
          ${t.prompt != null ? detailsBlock(`${s.id}:${t.n}:prompt`, 'prompt', 'prompt sent', t.prompt) : ''}
          ${t.items.map((it, i) => renderItem(s.id, t.n, it, i)).join('')}
          ${t.result ? `<div class="usage-row">
              <span>input ${fmtNum(t.result.usage?.input)}</span><span>cache read ${fmtNum(t.result.usage?.cache_read)}</span>
              <span>cache write ${fmtNum(t.result.usage?.cache_write)}</span><span>output ${fmtNum(t.result.usage?.output)}</span>
              <span>reasoning ${fmtNum(t.result.usage?.reasoning)}</span></div>` : ''}
        </div>
      </div>`).join('') || '<p class="empty muted">Waiting for the first turn…</p>';
  }

  box.innerHTML = html;
  if (atBottom) box.scrollTop = box.scrollHeight;
}

function renderEvents() {
  const box = $('#tab-events');
  const atBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 40;
  box.innerHTML = state.events.slice(-400).map((ev) => {
    const { seq, ts, type, run_id, ...rest } = ev;
    return `<div class="ev"><div class="ev-head"><span class="muted">#${seq}</span><span class="muted">${esc(timeOf(ts))}</span><span class="ev-type">${esc(type)}</span></div>
      <pre>${esc(JSON.stringify(rest, null, 1)).slice(0, 2000)}</pre></div>`;
  }).join('');
  if (atBottom) box.scrollTop = box.scrollHeight;
}

init();
