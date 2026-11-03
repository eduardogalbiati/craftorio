/* global api, ChainModel, WorkflowInputs */
// "When it finishes" (#134): the optional chain of a run, in the Start drawer, the Backlog's Assign
// dialog, the roadmap item's Edit form and the Run screen's chain editor. A select of what happens
// with the result (Nothing, Start a workflow, Ask the Product Owner, Plan the issues in the roadmap); for a
// workflow, which of the previous run's outputs feeds each of its inputs (proposed by
// ChainModel.defaultMap, editable) and its own short inputs (mode…) drawn by WorkflowInputs; for the
// roadmap (the action id stays 'queue', #446), the workflow the issues are planned for. Under it, the workflows that will run and a rough
// cost from past runs (api.chainEstimate), marked as an estimate.
//   const picker = ChainPicker.mount(el, { workflows: () => list, source: () => wf, value, onChange })
//   picker.value() → the then (ChainModel.normalizeThen form) or null; picker.refresh() after the
//   first workflow changed; picker.set(then).
// Any load order: used only when a dialog opens.
(function (root) {
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const isPath = (k) => /path|dir/i.test(k);
  // short inputs of the next workflow the owner sets here; the paths, branch, language and platform
  // come from the previous run (ChainModel.nextInputs)
  const ownInput = (k, def) => !isPath(k) && !/branch|language|platform/i.test(k) && (def?.enum || def?.type === 'boolean');
  // inputs a previous run's output can feed
  const mappable = (k, def) => !isPath(k) && !ownInput(k, def) && !/branch|language|platform/i.test(k);
  const label = (k, def) => WorkflowInputs.label(k, def || {});
  let seq = 0;

  // value: the chain to show first (the inner value() reads it back)
  function mount(el, { workflows = () => [], source = () => null, value: initial = null, onChange = null } = {}) {
    const id = `cp${++seq}`;
    let then = ChainModel.normalizeThen(initial);
    let timer = null;

    const list = () => (workflows() || []).filter((w) => !w.error);
    const byFile = (f) => list().find((w) => w.file === f) || null;
    const outputsOf = () => source()?.outputs || {};
    const producesIssues = () => !!(outputsOf().issues || outputsOf().issue);

    function draw() {
      const src = source();
      const outs = outputsOf();
      const action = then?.action || 'none';
      const issuesTip = producesIssues() ? '' : ` (${esc(src?.name || 'this workflow')} produces no issues)`;
      const opt = (a, disabled = false, tip = '') => `<option value="${a}"${a === action ? ' selected' : ''}${disabled ? ' disabled' : ''}>${esc(ChainModel.ACTION_LABELS[a])}${tip}</option>`;
      let body = '';
      if (action === 'workflow') {
        const next = byFile(then.workflow);
        const defs = next?.inputs || {};
        const rows = Object.entries(defs).filter(([k, d]) => mappable(k, d));
        const srcOptions = (k) => {
          const cur = then.map?.[k] || '';
          const o = [`<option value=""${!cur ? ' selected' : ''}>${t('chain_picker.not_mapped_its_default')}</option>`];
          for (const [name, d] of Object.entries(outs)) o.push(`<option value="${esc(name)}"${cur === name ? ' selected' : ''} title="${esc(d?.description || '')}">${t('chain_picker.output')} ${esc(name)}</option>`);
          o.push(`<option value="${ChainModel.RUN_SOURCE}"${cur === ChainModel.RUN_SOURCE ? ' selected' : ''}>${t('chain_picker.the_previous_run_itself')}</option>`);
          return o.join('');
        };
        const own = Object.fromEntries(Object.entries(defs).filter(([k, d]) => ownInput(k, d)));
        body = `<div class="field"><label for="${id}-wf">${t('chain_picker.next_workflow')}</label><select id="${id}-wf" data-cp-wf>${list().map((w) => `<option value="${esc(w.file)}"${w.file === then.workflow ? ' selected' : ''}>${esc(w.name)}</option>`).join('')}</select></div>`
          + (rows.length ? `<div class="cp-map wi-grid">${rows.map(([k, d]) => `<div class="field"><label for="${id}-m-${esc(k)}">${esc(label(k, d))} ←</label><select id="${id}-m-${esc(k)}" data-cp-map="${esc(k)}">${srcOptions(k)}</select>${d.description ? `<div class="hint">${esc(d.description)}</div>` : ''}</div>`).join('')}</div>` : '')
          + (Object.keys(own).length ? `<div class="cp-own wi-grid" data-wi-scope>${WorkflowInputs.formHtml(own, { values: then.inputs || {}, id: (k) => `${id}-in-${k}`, attrs: (k) => `data-cp-input="${esc(k)}"` })}</div>` : '')
          + `<p class="hint">${t('chain_picker.its_folder_branch_and_language_come')}</p>`;
      } else if (action === 'queue') {
        const targets = list().filter((w) => w.inputs?.task);
        body = `<div class="field"><label for="${id}-wf">${t('chain_picker.queue_for')}</label><select id="${id}-wf" data-cp-wf>${targets.map((w) => `<option value="${esc(w.file)}"${w.file === then.workflow ? ' selected' : ''}>${esc(w.name)}</option>`).join('')}</select>`
          + `<div class="hint">${t('chain_picker.the_produced_issues_go_to_the')}</div></div>`;
      } else if (action === 'product_owner') {
        body = `<p class="hint">${t('chain_picker.the_product_owner_proposes_where_the')}</p>`;
      }
      el.innerHTML = `<div class="chain-picker">
        <div class="field"><label for="${id}-action">${t('chain_picker.when_it_finishes')}</label>
          <select id="${id}-action" data-cp-action>${opt('none')}${opt('workflow')}${opt('product_owner', !producesIssues(), issuesTip)}${opt('queue', !producesIssues(), issuesTip)}</select>
          ${action === 'none' ? `<div class="hint">${t('chain_picker.optional_hand_this_run_s_result')}</div>` : ''}
        </div>
        ${body}
        ${action === 'none' ? '' : '<p class="hint cp-estimate" data-cp-estimate></p>'}
      </div>`;
      wire();
      estimate();
    }

    function wire() {
      el.querySelector('[data-cp-action]').onchange = (e) => {
        const action = e.target.value;
        if (action === 'none') then = null;
        else if (action === 'product_owner') then = { action };
        else {
          const first = action === 'queue' ? list().find((w) => w.inputs?.task) : list().find((w) => w.file !== source()?.file) || list()[0];
          then = action === 'queue' ? { action, workflow: first?.file || '', inputs: {} } : withDefaults({ action, workflow: first?.file || '' });
        }
        changed();
      };
      const wf = el.querySelector('[data-cp-wf]');
      if (wf) wf.onchange = () => {
        then = then.action === 'workflow' ? withDefaults({ action: 'workflow', workflow: wf.value }) : { ...then, workflow: wf.value };
        changed();
      };
      for (const s of el.querySelectorAll('[data-cp-map]')) s.onchange = () => { then = { ...then, map: { ...then.map, [s.dataset.cpMap]: s.value } }; changed(false); };
      const own = el.querySelector('.cp-own');
      // pills and switches change on click: value() reads them again anyway
      if (own) own.addEventListener('change', () => { then = { ...then, inputs: WorkflowInputs.read(own, { all: true }) }; changed(false); });
    }

    // the mapping proposed for this pair of workflows (editable afterwards)
    function withDefaults(t) {
      const next = byFile(t.workflow);
      return { ...t, map: ChainModel.defaultMap(outputsOf(), next?.inputs || {}), inputs: {} };
    }

    function changed(redraw = true) {
      if (redraw) draw(); else estimate();
      onChange?.(value());
    }

    // the workflows that will run and their rough cost (debounced: the owner may be clicking through)
    function estimate() {
      clearTimeout(timer);
      const box = el.querySelector('[data-cp-estimate]');
      const src = source();
      if (!box || !src || typeof api?.chainEstimate !== 'function') return;
      timer = setTimeout(async () => {
        try {
          const est = await api.chainEstimate(src.file, value());
          const names = est.items.map((i) => i.workflow.replace(/\.ya?ml$/i, '')).join(' → ');
          box.textContent = t('chain_picker.runs_names_value_estimate_from_past', { names, value: est.productOwner ? ' → Product Owner (roadmap proposal)' : '', text: est.text });
        } catch (e) { box.textContent = ''; }
      }, 250);
    }

    function value() {
      if (!then) return null;
      const own = el.querySelector('.cp-own');
      const t = own ? { ...then, inputs: WorkflowInputs.read(own, { all: true }) } : then;
      try { return ChainModel.normalizeThen(t); } catch { return null; }
    }

    draw();
    return {
      value,
      refresh() {
        // a chain to Product Owner / queue needs issues: a first workflow without them falls back to nothing
        if (then && then.action !== 'workflow' && !producesIssues()) then = null;
        draw();
      },
      set(t) { then = ChainModel.normalizeThen(t); draw(); },
    };
  }

  root.ChainPicker = { mount };
})(window);
