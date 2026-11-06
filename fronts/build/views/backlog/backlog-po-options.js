// Backlog › Product Owner drawer: a recommendation's decisions (#785), on its card (backlog-po.js
// groupHtml). The PO chose the workflow and only the inputs that matter (normalizeAnswer); the card shows
// what the run gets, grouped, each line a plain label and value with its source (WorkflowInputs.resolved:
// "do projeto", "do workflow", "neste item") and the PO's one-line reason:
// - How it runs, Tests and Agents; the other inputs (folders, commands, the Git platform...) behind "Mais";
// - "Editar" expands the card into the inputs form (WorkflowInputs.formHtml's `groups`, the controls of
//   every other form, with the workflow's select); the changes stay in the drawer's po.edits until
//   "Colocar no roadmap" and, collapsed, the summary marks them (data-changed).
// withEdits gives the group as it goes to the roadmap: the PO's inputs and the owner's changes, never
// a value equal to the one shown anyway, so the project's configuration still reaches the run.
// #791: an edit with a `kind` (Feature / Fix chosen on the card) starts from that kind's inputs
// (`kindInputs`, the project's) instead of the PO's.
// valueChanged keeps what the form changed; workflowTitle and filesHtml: how the card names a workflow and
// its files.
// "Show more options" (wf-more-toggle) in the form is the viewer's choice (localStorage, not per project).
/* global esc, t */
(() => {
  const MORE = 'po.wfOptions.more';
  const memory = {}; // when localStorage is not available
  const remembered = (key) => {
    try { return localStorage.getItem(key) === '1'; } catch { return memory[key] === true; }
  };
  const remember = (key, on) => {
    memory[key] = on;
    try { localStorage.setItem(key, on ? '1' : '0'); } catch { /* this session only */ }
  };

  // what the Backlog sets per run: the task, the issues, the repository, its branch and paths
  const SKIP_INPUTS = [
    'base_branch',
    'issue',
    'issues',
    'repo_path',
    'task',
  ];
  const GROUPS = [
    { id: 'run', testId: 'po-decision-group-run', title: 'backlog_po.decisions_how_it_runs', keys: ['workflow', 'mode', 'validation', 'review'] },
    { id: 'tests', testId: 'po-decision-group-tests', title: 'backlog_po.decisions_tests', keys: ['test_order', 'unit_tests', 'e2e_tests', 'screenshots'] },
    { id: 'agents', testId: 'po-decision-group-agents', title: 'backlog_po.decisions_agents', keys: ['developer_model', 'developer_effort'] },
  ];
  const GROUPED = GROUPS.flatMap((g) => g.keys);
  const optionDefs = (wf) => Object.fromEntries(Object.entries(wf?.inputs || {}).filter(([k]) => !SKIP_INPUTS.includes(k) && !/path|dir/i.test(k)));

  /**
   * The group `g` with the owner's `edit` ({ workflow, values }), if any: `wf` is the workflow it ends up
   * on. An answer recorded before #785 (no `inputsChosen`) carries every input at the workflow's default:
   * those go too, so only what was chosen stays, and what the Cost step set on purpose (#205).
   * No `runDefaults` (the hints failed or have not arrived): what the project gives is unknown, so a value
   * equal to the workflow's default may still differ from it, and a chosen one stays.
   */
  function withEdits(g, edit, wf, runDefaults) {
    const { blank, chosen, sameValue, shownDefault } = window.RunInputs;
    const defs = wf?.inputs || {};
    const fromPo = edit?.kindInputs ? edit.kindInputs : g.inputsChosen ? g.inputs : chosen(g.inputs, defs);
    const inputs = { ...(runDefaults ? chosen(fromPo, defs, runDefaults) : fromPo), ...g.cost?.inputs };
    for (const [k, v] of Object.entries(edit?.values || {})) {
      if (blank(v) || (runDefaults && sameValue(v, shownDefault(k, defs[k], runDefaults)))) delete inputs[k];
      else inputs[k] = v;
    }
    // another workflow: what the new one does not declare has no meaning there
    if (edit?.workflow) for (const k of Object.keys(inputs)) if (!defs[k]) delete inputs[k];
    return { ...g, workflow: edit?.workflow || g.workflow, inputs };
  }

  // one line of the summary: label, value, source and the PO's reason
  function lineHtml({ key, name, value, source, reason, changed }) {
    const from = source ? `<span class="po-decision-source">${esc(source)}</span>` : '';
    const why = reason ? `<span class="po-decision-reason">${esc(reason)}</span>` : '';
    return `<div class="po-decision" data-testid="po-decision-${esc(key)}"${changed ? ' data-changed="true"' : ''}><span class="po-decision-label">${esc(name)}</span><span class="po-decision-value">${esc(value) || '—'}</span>${from}${why}</div>`;
  }

  /**
   * The decisions of a recommendation. g: its group; key: its id in the drawer; edit: the owner's changes
   * ({ workflow, values, open, more }); wf / workflows: the workflow it is on and the plan's list
   * (backlog-po.js planWorkflows); title(wf, file): a workflow as people read it; done: already applied.
   */
  function decisionsHtml({ g, key, edit = {}, wf, workflows, title, runDefaults, done }) {
    const WI = window.WorkflowInputs;
    const shown = withEdits(g, edit, wf, runDefaults);
    // an input the workflow does not declare (or a workflow no longer installed) still shows what was saved
    const defs = { ...Object.fromEntries(Object.keys(shown.inputs || {}).map((k) => [k, {}])), ...optionDefs(wf) };
    const { values, sources } = WI.resolved(defs, shown.inputs, runDefaults);
    const changed = (k) => Object.prototype.hasOwnProperty.call(edit.values || {}, k);
    const line = (k) => {
      if (k === 'workflow') return lineHtml({ key: k, name: t('backlog_po.decisions_workflow'), value: title(wf, shown.workflow), source: edit.workflow ? WI.sourceText('roadmap') : '', reason: g.inputReasons?.workflow, changed: !!edit.workflow });
      const def = defs[k];
      if (!def || !WI.evalCondition(def.show_if, values)) return '';
      return lineHtml({ key: k, name: WI.label(k, def), value: WI.valueText(def, values[k]), source: WI.sourceText(sources[k]), reason: g.inputReasons?.[k], changed: changed(k) });
    };
    const groups = GROUPS.map((x) => `<div class="po-decision-group" data-testid="${x.testId}"><div class="po-decision-title">${t(x.title)}</div>${x.keys.map(line).join('')}</div>`).join('');
    const advanced = Object.keys(defs).filter((k) => !GROUPED.includes(k)).map(line).join('');
    const more = advanced ? `<button class="link-btn small" type="button" data-testid="po-decisions-more" aria-expanded="${!!edit.more}">${t('backlog_po.decisions_more')}</button>` : '';
    const editBtn = done ? '' : `<button class="link-btn small" type="button" data-testid="po-decisions-edit" aria-expanded="${!!edit.open}">${t(edit.open ? 'backlog_po.decisions_done' : 'backlog_po.decisions_edit')}</button>`;
    const list = (workflows || []).some((w) => w.file === shown.workflow) ? workflows : [{ file: shown.workflow, name: shown.workflow }, ...(workflows || [])];
    const form = `<div class="po-decisions-form po-wf-fields" data-testid="po-decisions-form"${WI.scopeAttrs()}>
      <label class="po-decisions-pick small"><span class="muted">${t('backlog_po.decisions_workflow')}</span> ${window.Select.markup('class="po-wf" data-testid="po-decisions-workflow"', list.map((w) => [w.file, title(w, w.file)]), shown.workflow)}</label>
      ${WI.formHtml(defs, { values, sources, groups: true, moreOpen: remembered(MORE), id: (k) => `po-wi-${key}-${k}` })}</div>`;
    return `<div class="po-decisions" data-testid="po-recommendation-decisions">
      ${edit.open && !done ? form : `${groups}<div class="po-decision-group" data-testid="po-decisions-advanced"${edit.more ? '' : ' hidden'}>${advanced}</div>`}
      <div class="row po-decisions-actions">${edit.open && !done ? '' : more}${editBtn}</div></div>`;
  }

  // a control of the form: a value back at what the card showed is no change
  function valueChanged(el, edit, g, wf, runDefaults) {
    const WI = window.WorkflowInputs;
    const k = el.dataset.wiInput;
    if (!k) return;
    const value = WI.read(el.closest('.wi-field'), { all: true })[k];
    const shown = withEdits(g, { ...edit, values: {} }, wf, runDefaults).inputs[k] ?? WI.shownDefault(k, wf?.inputs?.[k], runDefaults);
    if (WI.sameValue(value, shown)) delete edit.values[k];
    else edit.values[k] = value;
  }

  // #216: the files a group touches, as code paths (the first FILES_SHOWN, the rest folded)
  const FILES_SHOWN = 3;
  const filesHtml = (files) => {
    const li = (f) => `<li><code>${esc(f)}</code></li>`;
    const rest = files.slice(FILES_SHOWN);
    return `<ul class="po-files">${files.slice(0, FILES_SHOWN).map(li).join('')}</ul>${rest.length
      ? `<details class="po-files-more"><summary class="small muted">${t('backlog_po.length_more', { length: rest.length })}</summary><ul class="po-files">${rest.map(li).join('')}</ul></details>` : ''}`;
  };

  // A workflow as people read it: software-development-local-hero → "Software development, local
  // hero" (the variant of another workflow after a comma), ai-development → "AI development".
  const VARIANTS = [
    'local-hero',
  ];
  const words = (slug) => window.WorkflowInputs.humanize(slug).replace(/\b(ai|ci|e2e|pr|ui)\b/gi, (m) => m.toUpperCase());
  function workflowTitle(wf, file, workflows) {
    const slug = String(wf?.name || file || '').replace(/\.ya?ml$/i, '');
    // a known variant names its base even when the base workflow is not installed (#235: AI Development, local hero)
    const variant = VARIANTS.find((v) => slug.endsWith(`-${v}`));
    const base = (workflows || []).map((w) => w.name).filter((s) => s && slug.startsWith(`${s}-`)).sort((a, b) => b.length - a.length)[0]
      || (variant ? slug.slice(0, -variant.length - 1) : '');
    return base ? `${words(base)}, ${words(slug.slice(base.length + 1)).replace(/^\w/, (c) => c.toLowerCase())}` : words(slug);
  }

  document.addEventListener('click', (e) => {
    const link = e.target?.closest?.('[data-testid="wf-more-toggle"]');
    const box = link?.closest('[data-testid="po-decisions-form"]');
    if (box) remember(MORE, window.WorkflowInputs.toggleMore(box));
  });

  window.BacklogPoOptions = {
    decisionsHtml,
    filesHtml,
    optionDefs,
    valueChanged,
    withEdits,
    workflowTitle,
  };
})();
