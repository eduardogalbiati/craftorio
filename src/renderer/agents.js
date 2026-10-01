// Agents screen: the list of agents (the built-in supervisor and Product Owner first) and the editor:
// the robot's look (colors, eyes, emblem) with a live preview, the prompt (what the agent is for) and
// its skills; for the Product Owner, its model and effort instead.
// The workflows' own agents follow, one section per workflow (#68): read-only (View shows their
// prompt, skills, model, capabilities and steps; only the look is saved), "Open in workflow" and
// "Duplicate as my agent". Their saved looks are shared through window.AgentLooks.
// Storage and validation are in src/agents.js. Uses app.js globals ($, esc, state, openModal,
// closeModal, confirmDialog, errMsg, dateOf, showToast, showWorkflowDefinition) and window.Robots (robots.js).
// load: after robots.js (the agents' robots)
/* global api, Robots */
(() => {
  const SUPERVISOR = 'supervisor';
  const PRODUCT_OWNER = 'product-owner';
  // Must match DEFAULT_APPEARANCE in src/agents.js (the supervisor's own look).
  const DEFAULT_LOOK = { body: '#7C5CFF', shell: '#F4F4F6', visor: '#15161A', glow: '#C9B8FF', eyes: 'dots', emblem: 'none' };
  // Must match PRODUCT_OWNER_APPEARANCE in src/agents.js.
  const PRODUCT_OWNER_LOOK = { body: '#0F9F8F', shell: '#F4F4F6', visor: '#15161A', glow: '#9FF5E6', eyes: 'arcs', emblem: 'clipboard' };
  const defaultLook = () => (ed.agent?.id === PRODUCT_OWNER ? PRODUCT_OWNER_LOOK : DEFAULT_LOOK);
  // where each built-in agent's look shows (the editor's note)
  const SHOWN_IN = { [SUPERVISOR]: 'the supervisor appears (e.g. Write & Review)', [PRODUCT_OWNER]: 'the Product Owner appears (its Backlog button and drawer)' };
  const COLORS = [
    { key: 'body', label: 'Main color', hint: 'body and shoulder plate',
      swatches: ['#7C5CFF', '#3D7BF7', '#0EA5E9', '#14B8A6', '#10B981', '#84CC16', '#F59E0B', '#F97316', '#EF4444', '#EC4899', '#64748B', '#18181B'] },
    { key: 'shell', label: 'Shell', hint: 'head and arms',
      swatches: ['#F4F4F6', '#FFFFFF', '#E2E8F0', '#FDF6E3', '#FCE7F3', '#DCFCE7', '#DBEAFE', '#52525B', '#27272A'] },
    { key: 'visor', label: 'Visor', hint: 'the face screen',
      swatches: ['#15161A', '#000000', '#0F1E45', '#1E1B4B', '#052E16', '#3B0764', '#2B2A27', '#450A0A'] },
    { key: 'glow', label: 'Glow', hint: 'eyes and antennas',
      swatches: ['#C9B8FF', '#6EE7FF', '#4ADE80', '#FACC15', '#FB923C', '#FF6B6B', '#F472B6', '#FFFFFF'] },
  ];
  const EYE_LABELS = { dots: 'Dots', bars: 'Bars', arcs: 'Arcs', slits: 'Slits' };
  const EMBLEM_LABELS = {
    none: 'Panel (no emblem)', bolt: 'Bolt', clipboard: 'Clipboard', heart: 'Heart', shield: 'Shield', leaf: 'Leaf', gear: 'Gear', code: 'Code',
    rocket: 'Rocket', eye: 'Eye', crown: 'Crown', flask: 'Flask', star5: 'Star',
  };
  const PREVIEW_STATES = [['idle', 'Idle'], ['thinking', 'Thinking'], ['writing', 'Writing'], ['done', 'Done'], ['waiting', 'Waiting'], ['error', 'Error']];

  const $a = (sel) => document.querySelector(sel);
  // `custom`: a workflow agent's look was customised (else it draws its provider's robot)
  const ed = { agent: null, look: { ...DEFAULT_LOOK }, custom: true, skills: new Set(), state: 'idle', filter: '' };
  let agents = [];
  let workflowLooks = {};

  // A workflow's agent whose look was never customised draws its provider's robot.
  const providerVariant = (a) => Robots.variantFor(a.providerType || a.provider, a.model || '');
  const variantOf = (a, name) => (a.workflow && !a.appearance ? providerVariant(a) : Robots.fromAppearance(a.appearance || a, name ?? a.name));
  const isSystem = () => !!ed.agent?.system;
  const isWorkflow = () => !!ed.agent?.workflow;
  const isReadOnly = () => isSystem() || isWorkflow();
  const isProductOwner = () => ed.agent?.id === PRODUCT_OWNER;

  // The built-in agents' saved looks replace their default robots everywhere (Write & Review, the
  // Backlog's Product Owner). The Product Owner's model and effort are read by backlog-po.js.
  // The workflow agents' saved looks are found by workflow (file name without .yaml, or its
  // metadata name) and agent: window.AgentLooks.forWorkflow (run chat, run progress, Write & Review).
  function applySupervisorLook() {
    if (!window.Robots) return;
    for (const a of agents.filter((x) => x.system)) Robots.define(a.id, a.appearance, a.name);
    window.productOwnerAgent = agents.find((a) => a.id === PRODUCT_OWNER) || null;
    const looks = {};
    for (const a of agents.filter((x) => x.workflow && x.key && x.appearance)) {
      const v = Robots.fromAppearance(a.appearance, a.name);
      looks[`${a.workflow.file.replace(/\.ya?ml$/i, '')}/${a.key}`] = v;
      looks[`${a.workflow.name}/${a.key}`] = v;
    }
    if (JSON.stringify(looks) === JSON.stringify(workflowLooks)) return;
    workflowLooks = looks;
    document.dispatchEvent(new CustomEvent('robots:changed', { detail: { name: 'workflow-agents' } }));
  }
  window.AgentLooks = { forWorkflow: (workflow, agent) => (workflow && agent ? workflowLooks[`${workflow}/${agent}`] || null : null) };

  // A workflow agent's model line: provider · model · effort, "picked at start" when the user picks
  // them when starting a run (the value shown is then the workflow's default).
  function modelLine(a) {
    const parts = [a.provider, a.model, a.effort && `effort ${a.effort}`].filter(Boolean).join(' · ') || 'no model set';
    return a.pickedAtStart?.length ? `${parts} (picked at start)` : parts;
  }

  // One agent card: avatar, name, description and skills. Shared with the builder's agent picker
  // (window.AgentCards). `actions`: the Agents screen's footer (Edit / Remove; View / Open in
  // workflow / Duplicate for a workflow's agent); `selected` marks the current pick.
  function agentCard(a, { skillIds = new Set((state.skills || []).map((s) => s.id)), actions = false, selected = false } = {}) {
    const fixed = a.system || a.workflow;
    return `
      <div class="card clickable agent-card${selected ? ' selected' : ''}" data-id="${esc(a.id)}" tabindex="0">
        <div class="agent-card-body">
          <span class="agent-avatar" aria-hidden="true">${Robots.svg(variantOf(a), 'idle', { bubble: false, plaque: '' })}</span>
          <div class="agent-card-text">
            <div class="card-head">
              <b class="card-title">${esc(a.name)}</b>
              ${a.system ? '<span class="badge">system</span>' : ''}${a.workflow ? `<span class="badge" title="Defined in the ${esc(a.workflow.name)} workflow (read-only here)">workflow</span>` : ''}${selected ? '<span class="badge">selected</span>' : ''}
            </div>
            ${a.workflow ? `<p class="muted agent-facts mono">${esc(modelLine(a))} · ${esc(a.session)}</p>
            <p class="muted agent-facts" title="Capabilities">${esc(a.capabilities || '')}</p>`
              : `<p class="muted small clamp">${esc(a.error ? `Error: ${a.error}` : a.description || (a.prompt ? a.prompt.slice(0, 160) : 'No description.'))}</p>`}
            <div class="agent-skills">${(a.skills || []).slice(0, 4).map((s) =>
              `<span class="agent-skill mono${fixed || skillIds.has(s) ? '' : ' missing'}" title="${fixed || skillIds.has(s) ? 'Skill' : 'This skill is not in the workspace'}">${esc(s)}</span>`).join('')}${
              a.skills?.length > 4 ? `<span class="muted small">+${a.skills.length - 4}</span>` : ''}</div>
          </div>
        </div>
        ${actions && a.workflow ? `<div class="card-actions">
          <span class="muted small">${esc(a.workflow.name)}</span>
          <span class="spacer"></span>
          <button class="btn sm ghost" data-act="edit">View</button>
          <button class="btn sm ghost" data-act="open-workflow">Open in workflow</button>
          <button class="btn sm ghost" data-act="duplicate">Duplicate</button>
        </div>` : actions ? `<div class="card-actions">
          <span class="muted small">${a.system ? (a.model ? `Look and model · ${esc(a.model)}` : 'Look only') : a.updatedAt ? `updated ${esc(dateOf(a.updatedAt))}` : ''}</span>
          <span class="spacer"></span>
          <button class="btn sm ghost" data-act="edit">${a.system ? 'Customize' : 'Edit'}</button>
          ${a.system ? '' : '<button class="btn sm ghost danger" data-act="remove">Remove</button>'}
        </div>` : ''}
      </div>`;
  }
  window.AgentCards = { card: agentCard };

  // The workflows' agents, one heading per workflow file; a file that doesn't load shows its error
  // once, in its heading.
  function workflowSections(list, skillIds) {
    const files = [...new Set(list.map((a) => a.workflow.file))];
    return files.map((file) => {
      const of = list.filter((a) => a.workflow.file === file);
      const broken = of.find((a) => a.workflowError);
      return `<div class="agents-group"><h3>${esc(of[0].workflow.name)}</h3><span class="muted small mono">${esc(file)}</span>${
        broken ? `<p class="error small">Could not load this workflow: ${esc(broken.error)}</p>` : ''}</div>${
        of.filter((a) => !a.workflowError).map((a) => agentCard(a, { skillIds, actions: true })).join('')}`;
    }).join('');
  }

  async function refreshAgents() {
    const box = $a('#agents-list');
    try {
      [agents, state.skills] = await Promise.all([api.listAgents(), api.listSkills()]);
    } catch (e) {
      box.innerHTML = `<div class="empty-state"><b>Could not load the agents</b><p class="muted">${esc(errMsg(e))}</p></div>`;
      return;
    }
    applySupervisorLook();
    const skillIds = new Set(state.skills.map((s) => s.id));
    const own = agents.filter((a) => !a.workflow);
    const custom = own.filter((a) => !a.system);
    const fromWorkflows = agents.filter((a) => a.workflow);
    box.innerHTML = own.map((a) => agentCard(a, { skillIds, actions: true })).join('') + (custom.length ? '' : `
      <div class="card agent-empty">
        <b>Create your first agent</b>
        <p class="muted small">Give it a look, a prompt that says what it is for and the skills it needs. Workflows will be able to use it later.</p>
        <div><button class="btn primary sm" id="empty-new-agent" type="button">New agent</button></div>
      </div>`) + workflowSections(fromWorkflows, skillIds);
    $a('#empty-new-agent')?.addEventListener('click', () => openAgentModal(null));
    box.querySelectorAll('.agent-card').forEach((c) => (c.onclick = async (e) => {
      const a = agents.find((x) => x.id === c.dataset.id);
      const act = e.target.closest('[data-act]')?.dataset.act;
      if (act === 'remove') return removeAgent(a);
      if (act === 'open-workflow') return showWorkflowDefinition(a.workflow.file);
      if (act === 'duplicate') return duplicateAgent(a);
      openAgentModal(a);
    }));
  }

  // "Duplicate as my agent": a user agent (editable) from a workflow's agent: its name, prompt,
  // skills (families) and look; then opens it in the editor.
  async function duplicateAgent(a) {
    try {
      const created = await api.createAgent({
        name: a.name,
        description: `From the ${a.workflow.name} workflow (${a.key}).`,
        prompt: a.prompt || a.description,
        skills: a.skills,
        appearance: a.appearance || undefined,
      });
      closeModal('#agent-modal');
      await refreshAgents();
      openAgentModal(agents.find((x) => x.id === created.id) || created);
    } catch (e) {
      if (!$a('#agent-modal').classList.contains('hidden')) $a('#ag-error').textContent = errMsg(e);
      else showToast('Could not duplicate the agent', errMsg(e));
    }
  }

  async function removeAgent(a) {
    if (!(await confirmDialog('Remove agent', `Move the agent "${a.name}" to the trash?`, 'Remove'))) return false;
    try { await api.removeAgent(a.id); } catch (e) { $a('#ag-error').textContent = errMsg(e); return false; }
    refreshAgents();
    return true;
  }

  // ---- editor ---------------------------------------------------------------------------
  function openAgentModal(a) {
    ed.agent = a;
    ed.look = { ...defaultLook(), ...(a?.appearance || {}) };
    ed.custom = !a?.workflow || !!a.appearance;
    ed.skills = new Set(a?.skills || []);
    ed.state = 'idle';
    ed.filter = '';
    ed.effort = a?.effort || 'high';
    const system = isReadOnly();
    const workflow = isWorkflow();
    $a('#agent-modal-title').textContent = a ? (workflow ? `${a.name} · ${a.workflow.name}` : isSystem() ? `Customize the ${a.id === SUPERVISOR ? 'supervisor' : a.name}` : `Edit ${a.name}`) : 'New agent';
    $a('#ag-system-note').classList.toggle('hidden', !isSystem());
    $a('#ag-system-where').textContent = SHOWN_IN[a?.id] || '';
    $a('#ag-workflow-note').classList.toggle('hidden', !workflow);
    $a('#ag-workflow-name').textContent = workflow ? a.workflow.name : '';
    $a('#ag-workflow-facts').classList.toggle('hidden', !workflow);
    $a('#ag-workflow-facts').innerHTML = workflow ? [
      ['Workflow', `${a.workflow.name} (${a.workflow.file}) · agent ${a.key}`],
      ['Provider', a.provider || 'none'],
      ['Model', a.model || 'CLI default'],
      ['Effort', a.effort || 'default'],
      ...(a.pickedAtStart?.length ? [['Picked at start', `${a.pickedAtStart.join(', ')}: the values above are the workflow's defaults`]] : []),
      ['Session', a.session],
      ['Capabilities', a.capabilities],
      ['Used in steps', a.steps?.join(', ') || 'none'],
    ].map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('') : '';
    $a('#btn-ag-open-workflow').classList.toggle('hidden', !workflow);
    $a('#btn-ag-duplicate').classList.toggle('hidden', !workflow);
    $a('#ag-model-row').classList.toggle('hidden', !isProductOwner());
    $a('#ag-model').value = a?.model || '';
    $a('#ag-model-list').innerHTML = (window.ChatModels?.PROVIDERS['claude-code']?.models || []).map((m) => `<option value="${esc(m)}"></option>`).join('');
    renderEffort();
    $a('#ag-name').value = a?.name || '';
    $a('#ag-description').value = a?.description || '';
    $a('#ag-prompt').value = a?.prompt || '';
    for (const sel of ['#ag-name', '#ag-description', '#ag-prompt']) $a(sel).readOnly = system;
    for (const sel of ['#ag-name-req', '#ag-prompt-req']) $a(sel).classList.toggle('hidden', system);
    $a('#ag-skill-search').value = '';
    $a('#ag-skill-search').classList.toggle('hidden', system);
    $a('#btn-ag-remove').classList.toggle('hidden', !a || system);
    $a('#ag-error').textContent = '';
    renderStates();
    renderLookControls();
    renderSkills();
    renderPreview();
    openModal('#agent-modal');
    $a('.ag-form').scrollTop = 0;
    if (system) document.activeElement?.blur(); else $a('#ag-name').focus();
  }

  function renderPreview() {
    const name = $a('#ag-name').value.trim() || (isReadOnly() ? ed.agent.name : 'New agent');
    $a('#ag-robot').innerHTML = Robots.svg(ed.custom ? variantOf(ed.look, name) : providerVariant(ed.agent), ed.state);
  }

  function renderEffort() {
    $a('#ag-effort').innerHTML = ['default', ...(window.ChatModels?.EFFORTS || ['low', 'medium', 'high', 'xhigh'])]
      .map((e) => `<button type="button" data-effort="${e}" class="${e === ed.effort ? 'active' : ''}">${e}</button>`).join('');
  }

  function renderStates() {
    $a('#ag-states').innerHTML = PREVIEW_STATES.map(([k, label]) =>
      `<button type="button" class="chip${k === ed.state ? ' active' : ''}" data-state="${k}">${label}</button>`).join('');
  }

  function renderLookControls() {
    $a('#ag-colors').innerHTML = COLORS.map((c) => `
      <div class="ag-color" data-color="${c.key}">
        <div class="ag-color-head"><b>${c.label}</b> <span class="muted">${c.hint}</span></div>
        <div class="ag-swatches">
          ${c.swatches.map((h) => `<button type="button" class="ag-swatch${h.toUpperCase() === ed.look[c.key].toUpperCase() ? ' active' : ''}" data-hex="${h}" style="background:${h}" title="${h}" aria-label="${c.label} ${h}"></button>`).join('')}
          <label class="ag-custom" title="Any color"><input type="color" value="${ed.look[c.key].toLowerCase()}" aria-label="${c.label}: any color" /><span>+</span></label>
        </div>
      </div>`).join('');
    $a('#ag-eyes').innerHTML = Robots.EYE_STYLES.map((k) =>
      `<button type="button" data-eyes="${k}" class="${k === ed.look.eyes ? 'active' : ''}">${EYE_LABELS[k] || k}</button>`).join('');
    $a('#ag-emblems').innerHTML = Robots.EMBLEMS.map((k) =>
      `<button type="button" class="ag-emblem${k === ed.look.emblem ? ' active' : ''}" data-emblem="${k}" title="${EMBLEM_LABELS[k] || k}" aria-label="${EMBLEM_LABELS[k] || k}">${
        k === 'none' ? '<span class="ag-none" aria-hidden="true"></span>' : Robots.emblem(k)}</button>`).join('');
  }

  function setLook(patch) {
    Object.assign(ed.look, patch);
    ed.custom = true;
    renderLookControls();
    renderPreview();
  }

  function shuffleLook() {
    const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
    const [body, shell, visor, glow] = COLORS.map((c) => pick(c.swatches));
    setLook({ body, shell, visor, glow, eyes: pick(Robots.EYE_STYLES), emblem: pick(Robots.EMBLEMS) });
  }

  function renderSkills() {
    const box = $a('#ag-skills');
    const all = state.skills || [];
    const known = new Set(all.map((s) => s.id));
    $a('#ag-skill-count').textContent = String(ed.skills.size);
    if (isReadOnly()) {
      const from = isWorkflow() ? 'from the workflow' : 'built in';
      box.innerHTML = [...ed.skills].map((s) => `<div class="ag-skill fixed"><span class="mono">${esc(s)}</span><span class="muted small">${from}</span></div>`).join('')
        || '<p class="muted small">No skills.</p>';
      return;
    }
    const q = ed.filter.trim().toLowerCase();
    // selected skills that are no longer in the workspace stay listed so they can be unchecked
    const missing = [...ed.skills].filter((s) => !known.has(s)).map((id) => ({ id, name: id, missing: true }));
    const rows = [...missing, ...all].filter((s) => !q || `${s.name} ${s.description || ''}`.toLowerCase().includes(q));
    // selected first, then by name
    rows.sort((a, b) => ed.skills.has(b.id) - ed.skills.has(a.id) || String(a.name).localeCompare(String(b.name)));
    box.innerHTML = rows.length ? rows.map((s) => `
      <label class="ag-skill${ed.skills.has(s.id) ? ' on' : ''}">
        <input type="checkbox" data-skill="${esc(s.id)}"${ed.skills.has(s.id) ? ' checked' : ''} />
        <span class="ag-skill-text"><span class="ag-skill-name"><b class="mono">${esc(s.name)}</b>${s.missing ? '<span class="badge warn">missing</span>' : ''}</span>
          <span class="muted small">${esc(s.missing ? 'Not in the workspace anymore.' : s.description || '')}</span></span>
      </label>`).join('') : `<p class="muted small">${all.length ? 'No skill matches the filter.' : 'No skills in the workspace yet (Skills menu).'}</p>`;
  }

  async function saveAgent(e) {
    e.preventDefault();
    const data = isProductOwner()
      ? { appearance: ed.look, model: $a('#ag-model').value.trim(), effort: ed.effort }
      : isWorkflow()
      // only the look; null = back to the provider's robot
      ? { appearance: ed.custom ? ed.look : null }
      : isSystem()
      ? { appearance: ed.look }
      : { name: $a('#ag-name').value, description: $a('#ag-description').value, prompt: $a('#ag-prompt').value, skills: [...ed.skills], appearance: ed.look };
    const btn = $a('#btn-ag-save');
    btn.disabled = true;
    try {
      if (ed.agent) await api.saveAgent(ed.agent.id, data);
      else await api.createAgent(data);
      closeModal('#agent-modal');
      refreshAgents();
    } catch (err) {
      $a('#ag-error').textContent = errMsg(err);
    } finally {
      btn.disabled = false;
    }
  }

  function init() {
    if (!$a('#view-agents')) return;
    $a('#btn-new-agent').onclick = () => openAgentModal(null);
    $a('#agent-form').onsubmit = saveAgent;
    $a('#btn-ag-cancel').onclick = () => closeModal('#agent-modal');
    $a('#btn-ag-remove').onclick = async () => {
      if (ed.agent && (await removeAgent(ed.agent))) closeModal('#agent-modal');
    };
    $a('#btn-ag-open-workflow').onclick = () => {
      const file = ed.agent?.workflow?.file;
      if (!file) return;
      closeModal('#agent-modal');
      showWorkflowDefinition(file);
    };
    $a('#btn-ag-duplicate').onclick = () => { if (ed.agent?.workflow) duplicateAgent(ed.agent); };
    $a('#btn-ag-shuffle').onclick = shuffleLook;
    // a workflow's agent goes back to its provider's robot
    $a('#btn-ag-reset').onclick = () => {
      setLook({ ...defaultLook() });
      if (isWorkflow()) { ed.custom = false; renderPreview(); }
    };
    $a('#ag-effort').onclick = (e) => { const b = e.target.closest('[data-effort]'); if (b) { ed.effort = b.dataset.effort; renderEffort(); } };
    $a('#ag-name').addEventListener('input', renderPreview);
    $a('#ag-states').onclick = (e) => {
      const b = e.target.closest('[data-state]');
      if (!b) return;
      ed.state = b.dataset.state;
      renderStates();
      renderPreview();
    };
    $a('#ag-colors').addEventListener('click', (e) => {
      const b = e.target.closest('[data-hex]');
      if (b) setLook({ [b.closest('[data-color]').dataset.color]: b.dataset.hex });
    });
    // the native picker fires `input` while dragging: update the preview only, re-render on `change`
    $a('#ag-colors').addEventListener('input', (e) => {
      if (e.target.type !== 'color') return;
      ed.look[e.target.closest('[data-color]').dataset.color] = e.target.value.toUpperCase();
      ed.custom = true;
      renderPreview();
    });
    $a('#ag-colors').addEventListener('change', (e) => { if (e.target.type === 'color') renderLookControls(); });
    $a('#ag-eyes').onclick = (e) => { const b = e.target.closest('[data-eyes]'); if (b) setLook({ eyes: b.dataset.eyes }); };
    $a('#ag-emblems').onclick = (e) => { const b = e.target.closest('[data-emblem]'); if (b) setLook({ emblem: b.dataset.emblem }); };
    $a('#ag-skill-search').oninput = (e) => { ed.filter = e.target.value; renderSkills(); };
    $a('#ag-skills').addEventListener('change', (e) => {
      const id = e.target.dataset?.skill;
      if (!id) return;
      if (e.target.checked) ed.skills.add(id); else ed.skills.delete(id);
      // no re-render: the rows would jump (selected ones are sorted first)
      e.target.closest('.ag-skill').classList.toggle('on', e.target.checked);
      $a('#ag-skill-count').textContent = String(ed.skills.size);
    });
    // the built-in agents' customized looks, for the screens that show them
    api.listAgents().then((list) => { agents = list; applySupervisorLook(); }).catch(() => {});
  }

  window.refreshAgents = refreshAgents;
  init();
})();
