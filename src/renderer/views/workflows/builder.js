/* global api, Robots, ChatModels, $, esc, errMsg, state, showToast, confirmDialog, openDrawer, showWorkflowsTab, showView, openModal, closeModal */
// Workflows > Builder: a workflow drawn as desks in a line, each with an agent seated at it (the
// robots of robots.js), plus approval gates. Saved as a regular workflow YAML in the workspace
// (src/workflow-builder.js converts both ways; the engine runs it unchanged).
// Modes (from builder:load): 'full' = made with the builder, everything editable; 'fixed' = uses
// what the builder doesn't draw (loops, fan-outs...): agents and prompts editable, steps fixed;
// 'readonly' = bundled with the app: clone it to change it.
// window.ChatModels is read as it loads: chat-models.js, a top-level file, loads before the views.
(() => {
  const PROVIDERS = ChatModels.PROVIDERS; // by CLI type: { label, key, models }
  const TYPE_OF = Object.fromEntries(Object.entries(PROVIDERS).map(([type, p]) => [p.key, type]));
  const EFFORTS = ['default', ...ChatModels.EFFORTS]; // default = the CLI's own (no effort flag)
  const CATS = { plan: 'Plan & Design', build: 'Code & Build', monitor: 'Monitor & Improve' };

  const b = {
    file: null,     // the workflow file being edited (null = new)
    mode: 'full',
    problems: [],   // what the builder can't draw (fixed / readonly)
    spec: null,
    sel: 0,         // selected desk
    dirty: false,
    agents: [],     // Agents menu, for "import an agent"
  };
  const editable = () => b.mode !== 'readonly';
  const structural = () => b.mode === 'full';

  const newSpec = () => ({ name: '', description: '', category: 'build', steps: [agentDesk('step_1')] });
  function agentDesk(id) {
    return {
      id, kind: 'agent', brief: '', context: true, access: 'read',
      agent: { source: 'custom', agentId: null, name: '', appearance: null, provider: 'claude', model: ChatModels.models('claude')[0], effort: 'default', system_prompt: '', skills: [] },
    };
  }
  const freeId = (base) => {
    const ids = new Set(b.spec.steps.map((s) => s.id));
    for (let i = 1; ; i++) if (!ids.has(`${base}_${i}`)) return `${base}_${i}`;
  };
  // The agent a desk shows: its own (full spec) or the one picked among the step's agents (fixed).
  const agentName = (s) => (b.spec.fixed ? s.agentNames?.[s.pick || 0] : null);
  const agentOf = (s) => (b.spec.fixed ? b.spec.agents[agentName(s)] : s.agent);

  // ---------- drawing ----------
  function robotOf(a) {
    if (!a || a.source === 'random') return 'vanilla';
    if (a.appearance) return Robots.fromAppearance(a.appearance, a.name);
    return a.provider ? Robots.variantFor(TYPE_OF[a.provider] || '', a.model) : 'vanilla';
  }
  function deskSvg(s) {
    if (s.kind === 'gate') return Robots.gate({ reviewer: s.reviewer, robot: s.reviewer === 'ai' ? robotOf(s.agent) : null });
    const a = agentOf(s);
    if (!a) return Robots.desk(null, { label: s.id });
    const who = a.source === 'random' ? 'random agent' : a.source === 'agent' ? (a.name || a.agentId)
      : a.templated?.model ? 'model from inputs' : Robots.plaqueFor(a.model);
    return Robots.desk(robotOf(a), { label: s.id, sub: `${who} · ${a.templated?.effort ? 'effort from inputs' : a.effort}` });
  }

  function render() {
    if (!$('#wb') || !b.spec) return;
    $('#wb-name').value = b.spec.name;
    $('#wb-description').value = b.spec.description;
    $('#wb-category').value = b.spec.category;
    for (const sel of ['#wb-name', '#wb-description', '#wb-category']) $(sel).disabled = !editable();
    $('#wb-file').textContent = b.file ? b.file : 'new workflow (not saved yet)';
    $('#wb-dirty').classList.toggle('hidden', !b.dirty);
    $('#wb-save').classList.toggle('hidden', !editable());
    $('#wb-clone').classList.toggle('hidden', !b.file);
    $('#wb-add-desk').classList.toggle('hidden', !structural());
    $('#wb-add-gate').classList.toggle('hidden', !structural());
    const banner = $('#wb-banner');
    const why = b.problems.length ? ` Not drawn by the builder yet: ${b.problems.slice(0, 4).join(', ')}${b.problems.length > 4 ? ` and ${b.problems.length - 4} more` : ''}.` : '';
    banner.textContent = b.mode === 'readonly'
      ? `Bundled with the app: read-only. Clone it to make your own copy you can change.${why}`
      : b.mode === 'fixed' ? `You can change its agents and prompts here; its steps, loops and branches are edited in the YAML.${why}` : '';
    banner.classList.toggle('hidden', b.mode === 'full');
    renderOpenList();
    renderCanvas();
    renderPanel();
  }

  function renderOpenList() {
    const sel = $('#wb-open');
    const list = (state.workflows || []).filter((w) => !w.error);
    sel.innerHTML = `<option value="">${t('builder.open')}</option>${list.map((w) => `<option value="${esc(w.file)}">${esc(w.name)}${w.origin === 'custom' ? '' : ' (read-only)'}</option>`).join('')}`;
    sel.value = '';
  }

  const ARROW = '<div class="wb-arrow" aria-hidden="true"><svg viewBox="0 0 16 34"><path d="M8 2v28M3 25l5 6 5-6"/></svg></div>';
  function renderCanvas() {
    const steps = b.spec.steps;
    const sub = (s) => {
      if (s.kind === 'gate') return s.reviewer === 'ai' && s.agent ? `AI check · ${PROVIDERS[TYPE_OF[s.agent.provider]]?.label || s.agent.provider} · ${s.agent.source === 'agent' ? s.agent.name : Robots.plaqueFor(s.agent.model)}` : 'approval by a person';
      const a = agentOf(s);
      if (!a) return s.kind;
      const cli = a.templated?.provider ? 'CLI from inputs' : PROVIDERS[TYPE_OF[a.provider]]?.label || a.provider || '?';
      return b.spec.fixed ? `${cli} · ${agentName(s)}` : `${cli} · ${s.access === 'edit' ? 'can edit files' : 'read-only'}`;
    };
    const back = (s) => (s.kind === 'gate' && s.onReject && s.onReject !== 'stop' ? ` <span class="wb-back" title="${t('builder.if_rejected_the_run_goes_back')}">↩ ${esc(s.onReject)}</span>` : '');
    const extras = (s) => [
      ...(s.badges || []).map((x) => `<span class="badge">${esc(x)}</span>`),
      ...(s.branches?.length ? [`<span class="wb-branch" title="${t('builder.can_also_go_to')}">↳ ${s.branches.map(esc).join(', ')}</span>`] : []),
    ].join('');
    // after each arrow, + Desk and + Approval gate insert right there (only when the steps can change)
    const slot = (at) => ARROW + (structural() ? `<div class="wb-insert" data-at="${at}">
        <button type="button" class="btn ghost sm" data-add="agent" title="${t('builder.add_an_agent_desk_here')}">${t('builder.desk')}</button>
        <button type="button" class="btn ghost sm" data-add="gate" title="${t('builder.add_an_approval_gate_here')}">${t('builder.approval_gate')}</button>
      </div>${ARROW}` : '');
    const text = (x) => (x.kind === 'gate' ? x.message : x.brief) || '';
    $('#wb-canvas').innerHTML = `<div class="wb-endpoint" title="${t('builder.the_run_starts_here')}">${t('builder.start')}</div>` + steps.map((s, i) => `
      ${slot(i)}
      <button type="button" class="wb-desk${i === b.sel ? ' active' : ''}${s.kind === 'gate' ? ` gate ${s.reviewer === 'ai' ? 'gate-ai' : 'gate-human'}` : ''}" data-i="${i}" title="${esc(s.kind === 'gate' ? (s.reviewer === 'ai' ? 'AI check: an agent approves or sends the work back' : 'Human approval: a person approves or rejects') : 'Agent desk')}">
        <span class="wb-art">${deskSvg(s)}</span>
        <span class="wb-info">
          <span class="wb-cap"><b title="${esc(s.id)}">${esc(s.display || readable(s.id))}</b>${back(s)}</span>
          <span class="wb-sub muted small">${esc(sub(s))}</span>
          ${text(s) ? `<span class="wb-brief small">${esc(String(text(s)).slice(0, 240))}</span>` : ''}
          ${extras(s) ? `<span class="wb-extras">${extras(s)}</span>` : ''}
        </span>
      </button>`).join('') + slot(steps.length) + `<div class="wb-endpoint" title="${t('builder.the_run_ends_here')}">${t('builder.end')}</div>`;
    $('#wb-canvas').querySelectorAll('.wb-insert [data-add]').forEach((el) => (el.onclick = () => addStep(el.dataset.add, +el.parentElement.dataset.at)));
    $('#wb-canvas').querySelectorAll('.wb-desk').forEach((el) => (el.onclick = () => { b.sel = +el.dataset.i; renderCanvas(); renderPanel(); }));
  }

  const opt = (v, label, cur) => `<option value="${esc(v)}"${v === cur ? ' selected' : ''}>${esc(label)}</option>`;
  // #245: the optional name the screens show instead of a step's id or an agent's key (YAML `display`)
  const readable = (id) => (typeof displayName === 'function' ? displayName(id) : String(id || ''));
  const displayField = (id, label, value, key) => `<div class="field"><label for="${id}">${label} <span class="muted small">${t('builder.optional')}</span></label>
      <input type="text" id="${id}" data-testid="${id}" maxlength="40" value="${esc(value || '')}" placeholder="${esc(readable(key))}" spellcheck="false" />
      <div class="hint">${t('builder.what_the_screens_show_instead_of')} <span class="mono">${esc(key)}</span>${t('builder.empty_key', { key: esc(readable(key)) })}</div></div>`;
  const fixedText = (label, value) => `<div class="field"><label>${label}</label><div class="wb-fixed mono small" title="${t('builder.set_from_the_run_s_inputs')}">${esc(value)}</div></div>`;

  // The agent's fields (who it is, skills, CLI, model, effort), shared by desks and AI gates.
  function agentFields(a, { sources, name = null, sharedWith = [] }) {
    const t = a.templated || {};
    const type = TYPE_OF[a.provider] || ChatModels.typeOf('claude');
    const models = [...new Set([...(PROVIDERS[type]?.models || []), a.model].filter(Boolean))];
    return `
        <div class="field"><label>${I18n.t('builder.agent')}${name ? ` <span class="muted mono">${esc(name)}</span>` : ''}${a.optional ? ` <span class="badge">${I18n.t('builder.optional_2')}</span>` : ''}</label>
          <div class="seg sm" id="wb-source">${sources.map(([k, l]) => `<button type="button" data-src="${k}" class="${a.source === k ? 'active' : ''}">${l}</button>`).join('')}</div>
          ${sharedWith.length ? `<div class="hint">${I18n.t('builder.also_sits_at_value_changes_apply', { value: sharedWith.map(esc).join(', ') })}</div>` : ''}</div>
        ${b.spec.fixed && name ? displayField('wb-agent-display', 'Agent display name', a.display, name) : ''}
        ${a.source === 'agent' ? `<div class="field"><label>${I18n.t('builder.imported_agent')}</label>
          <div class="wb-imported">${a.agentId ? `<span class="wb-imported-avatar" aria-hidden="true">${Robots.svg(robotOf(a), 'idle', { bubble: false, plaque: '' })}</span><b>${esc(a.name || a.agentId)}</b>` : `<span class="muted small">${I18n.t('builder.none_yet')}</span>`}
            <span class="spacer"></span><button type="button" class="btn ghost sm" id="wb-agent-btn">${a.agentId ? 'Change…' : 'Choose an agent…'}</button></div>
          <div class="hint">${I18n.t('builder.its_look_prompt_and_skills_were')}</div></div>` : ''}
        ${a.source === 'random' ? `<p class="muted small">${I18n.t('builder.one_of_your_agents_agents_menu')}</p>` : ''}
        <div class="field"><label for="wb-system">${a.source === 'random' ? 'Extra instructions (optional)' : 'Who the agent is (its prompt)'}</label>
          <textarea id="wb-system" rows="4" placeholder="${I18n.t('builder.e_g_you_are_a_senior')}">${esc(a.system_prompt)}</textarea></div>
        <div class="field"><label>${I18n.t('builder.skills')}</label>
          <div class="wb-skills">${(a.skills || []).map((k) => `<span class="badge mono">${esc(k)}</span>`).join('') || `<span class="muted small">${I18n.t('builder.none')}</span>`}</div>
          <button type="button" class="btn ghost sm" id="wb-skills-btn">${I18n.t('builder.choose_skills')}</button></div>
        ${t.provider ? fixedText('CLI', t.provider) : ''}${t.model ? fixedText('Model', t.model) : ''}
        ${t.provider && t.model ? '' : `<div class="wb-grid">
          ${t.provider ? '' : `<div class="field"><label for="wb-provider">${I18n.t('builder.cli')}</label><select id="wb-provider">${Object.values(PROVIDERS).map((p) => opt(p.key, p.label, a.provider)).join('')}</select></div>`}
          ${t.model ? '' : `<div class="field"><label for="wb-model">${I18n.t('builder.model')}</label><select id="wb-model">${models.map((m) => opt(m, m, a.model)).join('')}</select></div>`}
        </div>`}
        ${t.effort ? fixedText('Effort', t.effort) : `<div class="field"><label>${I18n.t('builder.effort')}</label><div class="seg sm" id="wb-effort">${EFFORTS.map((e) => `<button type="button" data-effort="${e}" class="${(a.effort || 'default') === e ? 'active' : ''}" title="${e === 'default' ? 'The CLI\'s own default: no effort flag' : ''}">${e}</button>`).join('')}</div></div>`}`;
  }
  function bindAgentFields(a) {
    const box = $('#wb-panel');
    bind('#wb-system', 'input', (e) => { a.system_prompt = e.target.value; });
    bind('#wb-agent-display', 'input', (e) => { a.display = e.target.value; });
    bind('#wb-provider', 'change', (e) => { a.provider = e.target.value; a.model = PROVIDERS[TYPE_OF[a.provider]].models[0]; redraw(); });
    bind('#wb-model', 'change', (e) => { a.model = e.target.value; renderCanvas(); });
    const agentBtn = $('#wb-panel #wb-agent-btn');
    if (agentBtn) agentBtn.onclick = () => pickAgent(a);
    $('#wb-panel #wb-skills-btn').onclick = async () => {
      const chosen = await chooseSkills(a.skills || []);
      if (chosen) { a.skills = chosen; touch(); renderPanel(); }
    };
    box.querySelectorAll('#wb-source [data-src]').forEach((el) => (el.onclick = () => {
      // "Import an agent" opens the list; cancelling it keeps the agent as it was
      if (el.dataset.src === 'agent') return pickAgent(a);
      a.source = el.dataset.src;
      a.agentId = null; a.name = ''; a.appearance = null;
      touch(); redraw();
    }));
    box.querySelectorAll('#wb-effort [data-effort]').forEach((el) => (el.onclick = () => { a.effort = el.dataset.effort; touch(); redraw(); }));
  }

  // The reviewer of a new AI gate: a strict, read-only checker.
  const checkerAgent = () => ({
    ...agentDesk('x').agent,
    effort: 'high',
    system_prompt: 'You are a strict reviewer. You judge the work against the criteria you are given, never rewrite it, and say exactly what must change.',
  });

  function renderPanel() {
    const s = b.spec.steps[b.sel];
    const box = $('#wb-panel');
    if (!s) { box.innerHTML = `<p class="muted small">${t('builder.select_a_desk')}</p>`; return; }
    const i = b.sel, last = b.spec.steps.length - 1;
    const tools = structural() ? `<div class="row wb-tools">
        <button type="button" class="btn sm ghost" data-act="left" ${i ? '' : 'disabled'} title="${t('builder.move_before_the_previous_desk')}">${t('builder.move_up')}</button>
        <button type="button" class="btn sm ghost" data-act="right" ${i < last ? '' : 'disabled'} title="${t('builder.move_after_the_next_desk')}">${t('builder.move_down')}</button>
        <span class="spacer"></span>
        <button type="button" class="btn sm ghost danger" data-act="remove" ${last ? '' : 'disabled'}>${t('builder.remove')}</button>
      </div>` : '';
    const idField = `<div class="field"><label for="wb-id">${t('builder.id')}</label><input type="text" id="wb-id" class="mono" value="${esc(s.id)}" spellcheck="false" ${structural() ? '' : 'disabled'} />
      ${structural() ? `<div class="hint">${t('builder.lowercase_letters_digits_and_used_in')}</div>` : ''}</div>
      ${displayField('wb-display', 'Display name', s.display, s.id)}`;
    const flow = (s.badges?.length || s.branches?.length) ? `<p class="muted small">${[...(s.badges || []), ...(s.branches?.length ? [`can go to ${s.branches.join(', ')}`] : [])].map(esc).join(' · ')}</p>` : '';
    if (s.kind === 'gate') {
      const ai = s.reviewer === 'ai';
      const targets = b.spec.steps.slice(0, i).filter((x) => x.kind === 'agent');
      const who = structural() ? `<div class="field"><label>${t('builder.who_approves')}</label><div class="seg sm" id="wb-reviewer">${[['human', 'A person'], ['ai', 'An AI agent']].map(([k, l]) => `<button type="button" data-reviewer="${k}" class="${(s.reviewer || 'human') === k ? 'active' : ''}">${l}</button>`).join('')}</div></div>` : '';
      box.innerHTML = `<h3>${ai ? 'AI check' : 'Human approval'}</h3>
        <p class="muted small">${ai
          ? 'An agent checks the previous desk\'s answer against your criteria and answers approved or not, with notes. It runs on its own: no one is asked.'
          : 'The run waits here until a person approves. Nothing automatic crosses it, the supervisor included.'}</p>
        ${idField}${flow}${who}
        <div class="field"><label for="wb-message">${ai ? 'What the agent checks (its criteria)' : 'What the approver should check'}</label><textarea id="wb-message" rows="5" placeholder="${ai ? 'e.g. The change has tests for the new behavior and no TODOs are left.' : ''}">${esc(s.message)}</textarea></div>
        ${structural() ? `<div class="field"><label for="wb-reject">${t('builder.if_rejected')}</label><select id="wb-reject">${opt('stop', ai ? 'Stop the run (failed)' : 'Stop the run (cancelled)', s.onReject)}${targets.map((t) => opt(t.id, `Send back to "${t.id}" with the ${ai ? 'agent\'s' : 'approver\'s'} notes`, s.onReject)).join('')}</select></div>` : ''}
        ${ai && structural() && s.onReject && s.onReject !== 'stop' ? `<div class="field"><label for="wb-rounds">${t('builder.rounds')}</label><input type="number" id="wb-rounds" min="1" max="20" value="${esc(s.maxRounds ?? 3)}" />
          <div class="hint">${t('builder.how_many_times_it_can_send')}</div></div>` : ''}
        ${ai && s.agent ? `<h4 class="wb-section">${t('builder.the_agent_that_checks')}</h4>${agentFields(s.agent, { sources: [['custom', 'Custom'], ['agent', 'Import an agent']] })}` : ''}
        ${tools}`;
      bind('#wb-message', 'input', (e) => { s.message = e.target.value; renderCanvas(); });
      bind('#wb-reject', 'change', (e) => { s.onReject = e.target.value; redraw(); });
      bind('#wb-rounds', 'change', (e) => { s.maxRounds = Math.max(1, Math.min(20, Math.round(+e.target.value || 3))); });
      box.querySelectorAll('#wb-reviewer [data-reviewer]').forEach((el) => (el.onclick = () => {
        s.reviewer = el.dataset.reviewer;
        if (s.reviewer === 'ai') { s.agent ||= checkerAgent(); s.maxRounds ??= 3; }
        touch(); redraw();
      }));
      if (ai && s.agent) bindAgentFields(s.agent);
    } else if (!agentOf(s)) {
      box.innerHTML = `<h3>${t('builder.step')}</h3>${idField}${flow}<p class="muted small">${t('builder.this_step_has_no_agent_kind', { kind: esc(s.kind) })}</p>`;
    } else {
      const a = agentOf(s);
      const sources = [['custom', 'Custom'], ['agent', 'Import an agent'], ...(structural() ? [['random', 'Random agent']] : [])];
      const name = agentName(s);
      const sharedWith = b.spec.fixed ? b.spec.steps.filter((x) => x !== s && x.agentNames?.includes(name)).map((x) => x.id) : [];
      box.innerHTML = `<h3>${t('builder.desk_2')}</h3>
        ${idField}${flow}
        <div class="field"><label for="wb-brief">${structural() ? 'What the agent does in this step' : 'Step prompt'}</label><textarea id="wb-brief" rows="${structural() ? 4 : 8}" class="${structural() ? '' : 'mono small'}" placeholder="${t('builder.e_g_read_the_task_and')}">${esc(s.brief)}</textarea>
          ${structural() ? `<label class="check small wb-ctx"><input type="checkbox" id="wb-context" ${s.context !== false ? 'checked' : ''} /><span>${t('builder.also_give_it_the_run_s')}</span></label>` : ''}</div>
        ${s.agentNames?.length > 1 ? `<div class="field"><label for="wb-pick">${t('builder.agent_length_in_parallel', { length: s.agentNames.length })}</label><select id="wb-pick">${s.agentNames.map((n, k) => opt(String(k), n, String(s.pick || 0))).join('')}</select></div>` : ''}
        ${agentFields(a, { sources, name, sharedWith })}
        ${structural() ? `<div class="field"><label>${t('builder.access_to_the_project_folder')}</label><div class="seg sm" id="wb-access">${[['read', 'Read-only'], ['edit', 'Can edit files and run commands']].map(([k, l]) => `<button type="button" data-access="${k}" class="${(s.access || 'read') === k ? 'active' : ''}">${l}</button>`).join('')}</div></div>` : ''}
        ${tools}`;
      bind('#wb-brief', 'input', (e) => { s.brief = e.target.value; renderCanvas(); });
      bind('#wb-context', 'change', (e) => { s.context = e.target.checked; });
      const pick = $('#wb-panel #wb-pick');
      if (pick) pick.onchange = (e) => { s.pick = +e.target.value; redraw(); };
      bindAgentFields(a);
      box.querySelectorAll('#wb-access [data-access]').forEach((el) => (el.onclick = () => { s.access = el.dataset.access; touch(); redraw(); }));
    }
    bind('#wb-id', 'change', (e) => renameStep(s, e.target.value.trim()));
    bind('#wb-display', 'input', (e) => { s.display = e.target.value; });
    bind('#wb-display', 'change', () => renderCanvas());
    box.querySelectorAll('.wb-tools [data-act]').forEach((el) => (el.onclick = () => deskAction(el.dataset.act)));
    // read-only: everything is shown, nothing can change (the parallel agents can still be browsed)
    if (!editable()) box.querySelectorAll('input, textarea, select, button').forEach((el) => { if (el.id !== 'wb-pick') el.disabled = true; });
  }

  // Every edit marks the workflow as unsaved.
  function bind(sel, ev, fn) {
    const el = $(`#wb-panel ${sel}`);
    if (el) el.addEventListener(ev, (e) => { fn(e); touch(); });
  }
  function touch() { b.dirty = true; $('#wb-dirty').classList.remove('hidden'); $('#wb-error').textContent = ''; }
  function redraw() { renderCanvas(); renderPanel(); }

  // Import an agent: its look, prompt and skills are copied into the desk.
  async function pickAgent(a) {
    const x = await chooseAgent(a.agentId);
    if (!x) return;
    Object.assign(a, { source: 'agent', agentId: x.id, name: x.name, appearance: x.appearance, system_prompt: x.prompt, skills: [...(x.skills || [])] });
    touch();
    redraw();
  }

  // The Agents menu's cards (agents.js), in a modal; resolves with the agent clicked, or null.
  async function chooseAgent(currentId) {
    try { b.agents = await api.listAgents(); } catch { /* keep the last list */ }
    // the user's agents only: a workflow's agent comes in through "Duplicate as my agent" (Agents menu)
    const list = b.agents.filter((x) => !x.system && !x.workflow && !x.error);
    const box = $('#wb-agents-list');
    box.innerHTML = list.length
      ? list.map((x) => window.AgentCards.card(x, { selected: x.id === currentId })).join('')
      : `<div class="empty-state"><b>${t('builder.no_agents_yet')}</b><p class="muted">${t('builder.create_one_in_the_agents_menu')}</p></div>`;
    openModal('#wb-agents-modal');
    return new Promise((resolve) => {
      const done = (v) => { closeModal('#wb-agents-modal'); resolve(v); };
      box.querySelectorAll('.agent-card').forEach((c) => {
        c.onclick = () => done(list.find((x) => x.id === c.dataset.id));
        c.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); c.click(); } };
      });
      $('#btn-wb-agents-cancel').onclick = () => done(null);
      $('#btn-wb-agents-manage').onclick = () => { done(null); showView('agents'); };
    });
  }

  // ---------- skills: a modal with the workspace's skills, checked one by one ----------
  function chooseSkills(current) {
    const picked = new Set(current);
    const all = state.skills || [];
    const known = new Set(all.map((s) => s.id));
    let q = '';
    const draw = () => {
      // skills that are not in the workspace (or templates like "code-review-{{ inputs.language }}") stay listed
      const extra = [...picked].filter((k) => !known.has(k)).map((id) => ({ id, name: id, missing: true }));
      const rows = [...extra, ...all].filter((s) => !q || `${s.name} ${s.description || ''}`.toLowerCase().includes(q));
      rows.sort((x, y) => picked.has(y.id) - picked.has(x.id) || String(x.name).localeCompare(String(y.name)));
      $('#wb-skill-count').textContent = `${picked.size} selected`;
      $('#wb-skill-list').innerHTML = rows.length ? rows.map((s) => `
        <label class="ag-skill${picked.has(s.id) ? ' on' : ''}">
          <input type="checkbox" data-skill="${esc(s.id)}"${picked.has(s.id) ? ' checked' : ''} />
          <span class="ag-skill-text"><span class="ag-skill-name"><b class="mono">${esc(s.name)}</b>${s.missing ? `<span class="badge warn">${s.id.includes('{{') ? 'template' : 'missing'}</span>` : ''}</span>
            <span class="muted small">${esc(s.missing ? (s.id.includes('{{') ? 'Chosen from the run\'s inputs.' : 'Not in the workspace.') : s.description || '')}</span></span>
        </label>`).join('') : `<p class="muted small">${all.length ? 'No skill matches the filter.' : 'No skills in the workspace yet (Skills menu).'}</p>`;
    };
    $('#wb-skill-search').value = '';
    $('#wb-skill-search').oninput = (e) => { q = e.target.value.trim().toLowerCase(); draw(); };
    $('#wb-skill-list').onchange = (e) => {
      const id = e.target.dataset?.skill;
      if (!id) return;
      if (e.target.checked) picked.add(id); else picked.delete(id);
      draw();
    };
    draw();
    openModal('#wb-skills-modal');
    setTimeout(() => $('#wb-skill-search').focus({ preventScroll: true }), 50);
    return new Promise((resolve) => {
      const done = (v) => { closeModal('#wb-skills-modal'); resolve(v); };
      $('#btn-wb-skills-ok').onclick = () => done([...picked]);
      $('#btn-wb-skills-cancel').onclick = () => done(null);
    });
  }

  function renameStep(s, id) {
    const old = s.id;
    if (!id || id === old) return;
    s.id = id;
    // gates that sent rejections back to this desk follow the rename
    for (const g of b.spec.steps) if (g.kind === 'gate' && g.onReject === old) g.onReject = id;
    redraw();
  }

  function deskAction(act) {
    const steps = b.spec.steps, i = b.sel;
    if (act === 'remove') {
      const [gone] = steps.splice(i, 1);
      for (const g of steps) if (g.kind === 'gate' && g.onReject === gone.id) g.onReject = 'stop';
      b.sel = Math.min(i, steps.length - 1);
    } else {
      const j = act === 'left' ? i - 1 : i + 1;
      [steps[i], steps[j]] = [steps[j], steps[i]];
      b.sel = j;
      // a gate can only send work back to a desk before it
      steps.forEach((g, k) => {
        if (g.kind === 'gate' && g.onReject !== 'stop' && !steps.slice(0, k).some((x) => x.id === g.onReject)) g.onReject = 'stop';
      });
    }
    touch();
    redraw();
  }

  function addStep(kind, at = b.sel + 1) {
    const s = kind === 'gate'
      ? { id: freeId('approve'), kind: 'gate', reviewer: 'human', message: 'Check the previous desk\'s answer before the run goes on.', onReject: 'stop' }
      : agentDesk(freeId('step'));
    b.spec.steps.splice(at, 0, s);
    b.sel = at;
    // a gate can only send work back to a desk before it
    b.spec.steps.forEach((g, k) => {
      if (g.kind === 'gate' && g.onReject && g.onReject !== 'stop' && !b.spec.steps.slice(0, k).some((x) => x.id === g.onReject)) g.onReject = 'stop';
    });
    touch();
    redraw();
    $('#wb-canvas .wb-desk.active')?.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
  }

  // ---------- open / new / save / clone ----------
  async function leaveOk() {
    return !b.dirty || confirmDialog('Unsaved changes', 'Discard the changes to this workflow?', 'Discard');
  }

  async function startNew() {
    if (!(await leaveOk())) return;
    Object.assign(b, { file: null, mode: 'full', problems: [], spec: newSpec(), sel: 0, dirty: false });
    render();
  }

  async function open(file, { force = false } = {}) {
    if (!file || (!force && !(await leaveOk()))) { renderOpenList(); return; }
    try {
      const r = await api.loadBuilderWorkflow(file);
      Object.assign(b, { file: r.file, mode: r.mode, problems: r.problems || [], spec: r.spec, sel: 0, dirty: false });
      render();
    } catch (e) {
      showToast('Cannot open in the builder', errMsg(e));
      renderOpenList();
    }
  }

  async function save() {
    if (!editable()) return false;
    // a field still focused may not have fired "change" yet
    document.activeElement?.blur?.();
    const btn = $('#wb-save');
    btn.disabled = true;
    try {
      const r = await api.saveBuilderWorkflow(b.file, b.spec);
      b.file = r.file;
      b.dirty = false;
      state.workflows = await api.listWorkflows();
      render();
      showToast('Workflow saved', `${r.file} in the workflows folder`);
      return true;
    } catch (e) {
      $('#wb-error').textContent = errMsg(e);
      return false;
    } finally {
      btn.disabled = false;
    }
  }

  async function clone() {
    if (!b.file || !(await leaveOk())) return;
    try {
      const r = await api.cloneWorkflow(b.file);
      state.workflows = await api.listWorkflows();
      await open(r.file, { force: true });
      showToast('Workflow cloned', `${r.file}: your own copy, you can change it`);
    } catch (e) {
      $('#wb-error').textContent = errMsg(e);
    }
  }

  async function run() {
    if (editable() && (b.dirty || !b.file) && !(await save())) return;
    openDrawer({ workflow: b.file });
  }

  // ---------- entry points ----------
  let wired = false;
  function wire() {
    if (wired) return;
    wired = true;
    $('#wb-name').oninput = (e) => { b.spec.name = e.target.value; touch(); };
    $('#wb-description').oninput = (e) => { b.spec.description = e.target.value; touch(); };
    $('#wb-category').innerHTML = Object.entries(CATS).map(([k, l]) => opt(k, l)).join('');
    $('#wb-category').onchange = (e) => { b.spec.category = e.target.value; touch(); };
    $('#wb-new').onclick = startNew;
    $('#wb-open').onchange = (e) => open(e.target.value);
    $('#wb-add-desk').onclick = () => addStep('agent');
    $('#wb-add-gate').onclick = () => addStep('gate');
    $('#wb-save').onclick = save;
    $('#wb-clone').onclick = clone;
    $('#wb-run').onclick = run;
    window.addEventListener('beforeunload', (e) => { if (b.dirty) e.preventDefault(); });
  }

  // Called when Workflows > Builder is shown.
  window.showBuilder = async () => {
    wire();
    if (!b.spec) b.spec = newSpec();
    render();
    try {
      [b.agents, state.workflows, state.skills] = await Promise.all([api.listAgents(), api.listWorkflows(), api.listSkills()]);
    } catch { /* the lists stay as they were */ }
    render();
  };

  // "Send to builder" from Workflows > Definitions.
  window.openInBuilder = async (file) => {
    showWorkflowsTab('builder');
    await open(file);
  };

  // What the Supervisor is told about this screen (supervisor-chat.js).
  window.builderContext = () => {
    const desk = b.spec?.steps?.[b.sel];
    const what = b.file ? `editing workflow ${b.file}${b.spec?.name ? ` ("${b.spec.name}")` : ''}` : 'drawing a new workflow';
    return [what, `mode ${b.mode}`, desk ? `desk ${desk.id} selected` : '', b.dirty ? 'unsaved changes' : ''].filter(Boolean).join(', ');
  };
})();
