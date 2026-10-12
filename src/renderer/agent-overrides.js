// The "Agents" section of a run's options (#262): each agent of the workflow with the provider, model
// and effort it runs on, the workflow's values as defaults (listWorkflows' agents.<name>.runs_on, the
// templates resolved with the inputs' defaults); a change applies to that run only (run:start's
// agentOverrides, recorded in workflow.started). Used by the Start drawer, the Backlog's Assign dialog
// and a roadmap item's Edit.
// window.AgentOverrides:
//   html(wf, { prefix, values })  the section: a <fieldset> "Agents" with one <fieldset> per agent (its
//                                 readable name), the selects Provider and Effort and the Model input
//                                 (a datalist of the provider's models); `values` an earlier choice
//   read(container)               { <agent>: { provider?, model?, effort? } }: only what differs from
//                                 the workflow's values ({} when nothing changed)
// A provider change offers that provider's models (window.ChatModels) and picks its first one when the
// model typed is not one of them; a changed agent is marked "changed for this run".
(() => {
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const EFFORTS = [['', 'Default'], ['low', 'Low'], ['medium', 'Medium'], ['high', 'High'], ['xhigh', 'Extra high']];
  const modelsOf = (type) => window.ChatModels?.PROVIDERS?.[type]?.models || [];
  const nameOf = (key, a) => a.display || (typeof displayName === 'function' ? displayName(key) : key);
  const option = (value, label, selected) => `<option value="${esc(value)}"${selected ? ' selected' : ''}>${esc(label)}</option>`;
  const datalist = (models) => models.map((m) => `<option value="${esc(m)}"></option>`).join('');

  function agentHtml(wf, key, a, prefix, value = {}) {
    const def = { provider: '', model: '', effort: '', ...(a.runs_on || { provider: a.provider, model: a.model }) };
    def.effort ||= '';
    const v = { ...def, ...value };
    const providers = Object.keys(wf.providers || {});
    if (v.provider && !providers.includes(v.provider)) providers.unshift(v.provider);
    const type = (p) => wf.providers?.[p] || '';
    const efforts = EFFORTS.some(([e]) => e === v.effort) ? EFFORTS : [...EFFORTS, [v.effort, v.effort]];
    const id = `${prefix}-${key}`;
    const changed = ['provider', 'model', 'effort'].some((k) => (v[k] || '') !== (def[k] || ''));
    const caps = [`session: ${a.session || 'persistent'}${a.max_context && (a.session || 'persistent') === 'persistent' ? ` (max ${a.max_context})` : ''}`,
      a.capabilities, a.isolated === false ? 'not isolated' : '', a.fallbacks?.length ? `fallbacks: ${a.fallbacks.join(', ')}` : ''].filter(Boolean).join(' · ');
    return `<fieldset class="ao-agent${changed ? ' changed' : ''}" data-ao-agent="${esc(key)}" data-testid="agent-override">
      <legend title="${esc(key)}">${esc(nameOf(key, a))}</legend>
      <span class="ao-changed badge">changed for this run</span>
      <div class="ao-fields">
        <div class="field"><label for="${id}-provider">Provider</label>
          <select id="${id}-provider" data-ao="provider" data-ao-default="${esc(def.provider)}">${providers.map((p) => `<option value="${esc(p)}" data-type="${esc(type(p))}"${p === v.provider ? ' selected' : ''}>${esc(p)}</option>`).join('')}</select></div>
        <div class="field"><label for="${id}-model">Model</label>
          <input id="${id}-model" data-ao="model" data-ao-default="${esc(def.model)}" value="${esc(v.model)}" list="${id}-models" spellcheck="false" autocomplete="off">
          <datalist id="${id}-models">${datalist([...new Set([v.model, ...modelsOf(type(v.provider))].filter(Boolean))])}</datalist></div>
        <div class="field"><label for="${id}-effort">Effort</label>
          <select id="${id}-effort" data-ao="effort" data-ao-default="${esc(def.effort)}">${efforts.map(([e, label]) => option(e, label, e === v.effort)).join('')}</select></div>
      </div>
      ${caps ? `<div class="agent-caps">${esc(caps)}</div>` : ''}
    </fieldset>`;
  }

  function html(wf, { prefix = 'ao', values = {} } = {}) {
    const agents = Object.entries(wf?.agents || {});
    if (!agents.length) return '';
    return `<fieldset class="ao" data-testid="agent-overrides"><legend>Agents</legend>
      <div class="hint">The provider, model and effort of each agent for this run only; the workflow keeps its own.</div>
      ${agents.map(([key, a]) => agentHtml(wf, key, a, prefix, values?.[key])).join('')}
    </fieldset>`;
  }

  function read(container) {
    const out = {};
    const rows = container?.querySelectorAll?.('[data-ao-agent]') || [];
    for (const row of rows) {
      const changed = {};
      for (const k of ['provider', 'model', 'effort']) {
        const el = row.querySelector(`[data-ao="${k}"]`);
        const value = String(el?.value ?? '').trim();
        if (el && value !== (el.dataset.aoDefault || '') && (value || k === 'effort')) changed[k] = value;
      }
      if (Object.keys(changed).length) out[row.dataset.aoAgent] = changed;
    }
    return out;
  }

  // a changed provider offers its models; the model follows it when it is not one of them
  function onChange(e) {
    const row = e.target?.closest?.('[data-ao-agent]');
    if (!row) return;
    if (e.target.dataset.ao === 'provider') {
      const sel = e.target;
      const model = row.querySelector('[data-ao="model"]');
      const list = row.querySelector('datalist');
      const back = sel.value === sel.dataset.aoDefault ? model.dataset.aoDefault : '';
      const models = [...new Set([back, ...modelsOf(sel.selectedOptions[0]?.dataset.type)].filter(Boolean))];
      if (!models.includes(model.value)) model.value = models[0] || '';
      if (list) list.innerHTML = datalist(models);
    }
    const changed = [...row.querySelectorAll('[data-ao]')].some((el) => String(el.value).trim() !== (el.dataset.aoDefault || ''));
    row.classList.toggle('changed', changed);
  }
  document.addEventListener('change', onChange);
  document.addEventListener('input', (e) => { if (e.target?.dataset?.ao === 'model') onChange(e); });

  window.AgentOverrides = { html, read };
})();
