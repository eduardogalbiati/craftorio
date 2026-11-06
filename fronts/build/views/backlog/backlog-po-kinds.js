// Backlog › Product Owner drawer: the kinds of a plan (#791), on its cards (backlog-po.js groupHtml and
// answerHtml). Each recommendation shows its kind (po-kind-badge: an icon and the kind's name, data-kind,
// never colour alone), the plan is summed up (po-kind-summary, "3 Features · 2 Fixes") and grouped by kind
// (po-kind-group-<kind>), and a Feature | Fix | Outro control (po-kind-control, aria-pressed) replaces the
// long select: Feature / Fix swap the workflow and inputs for the project's of that kind
// (DefaultWorkflow.kindEntry over the header project's record and its manifest; the edit's kind / kindInputs,
// which backlog-po-options.js withEdits starts from), Outro opens the select of every workflow that takes a
// task (po-kind-other-select), a choice saved on that item, as a workflow picked in the card's form is
// (pickForm). po-kind-reason: why each issue is of its kind. An answer recorded before has no kinds: a plain list.
/* global DefaultWorkflow, esc, t */
(() => {
  const CHOICES = ['feature', 'fix', 'other'];
  const GLYPHS = { feature: '✦', fix: '⚒', refactor: '↻', other: '…' };

  const shown = (g, edit) => edit?.kind || g.kind || null;
  const badge = (kind) => (kind ? `<span class="badge po-kind-badge" data-testid="po-kind-badge" data-kind="${esc(kind)}"><span class="po-kind-icon" aria-hidden="true">${GLYPHS[kind] || ''}</span>${esc(t(`po.kind.${kind}`))}</span>` : '');

  /** Feature | Fix | Outro with the recommendation's kind pressed. `workflows`: every one that takes a task; title(wf, file): a workflow as people read it. */
  function controlHtml({ g, edit, done, workflows, title }) {
    const kind = shown(g, edit);
    const choice = (c) => `<button type="button" class="${kind === c ? 'active' : ''}" data-po-kind="${c}" data-testid="po-kind-choice-${c}" aria-pressed="${kind === c}"${done ? ' disabled' : ''}>${esc(t(`po.kind.${c}`))}</button>`;
    const current = edit?.workflow || g.workflow;
    const list = workflows.some((w) => w.file === current) ? workflows : [{ file: current, name: current }, ...workflows];
    const other = window.Select.markup(`class="po-wf" data-po-kind-other data-testid="po-kind-other-select" aria-label="${esc(t('backlog_po.decisions_workflow'))}"${done ? ' disabled' : ''}`, list.map((w) => [w.file, title(w, w.file)]), current);
    return `<div class="po-kind-row"><div class="seg sm po-kind-control" data-testid="po-kind-control" role="group" aria-label="${esc(t('po.kind.reason'))}">${CHOICES.map(choice).join('')}</div><span class="po-kind-other"${kind === 'other' ? '' : ' hidden'}>${other}</span></div>`;
  }

  // why each issue is of its kind: a reason of the engine's by its i18n key, the model's as written; one
  // line when they all say the same, else one per issue; an answer recorded before has only `kindReason`
  function reasonHtml(g) {
    const list = g.kindReasons?.length ? g.kindReasons : g.kindReason ? [{ reason: g.kindReason }] : [];
    if (!list.length) return '';
    const text = (r) => (r.reasonKey ? t(r.reasonKey) : r.reason);
    const body = new Set(list.map(text)).size === 1 ? esc(text(list[0])) : list.map((r) => `<div>#${esc(r.issue)} ${esc(text(r))}</div>`).join('');
    return `<dt>${t('po.kind.reason')}</dt><dd data-testid="po-kind-reason">${body}</dd>`;
  }

  /**
   * The owner's choice of a kind on a recommendation: that kind's workflow and inputs replace the PO's
   * (the PO's own kind again: no change); Outro keeps the workflow until one is picked in its select.
   * `project`: the header project's record, its `manifest` (projects:list) the repository's map.
   */
  function choose(edit, g, kind, { project, workflows }) {
    edit.values = {};
    if (kind === g.kind || (kind === 'other' && !g.kind)) { delete edit.kind; edit.workflow = null; edit.kindInputs = null; return; }
    edit.kind = kind;
    if (kind === 'other') { edit.workflow = edit.workflow || g.workflow; edit.kindInputs = null; return; }
    const entry = DefaultWorkflow.kindEntry(project, project?.manifest, kind);
    const { file, inputs } = DefaultWorkflow.kindTarget(entry, workflows.map((w) => w.file));
    edit.workflow = file || `${entry.name}.yaml`;
    edit.kindInputs = inputs;
  }

  /** A workflow picked in Outro: that item's choice, Outro pressed. */
  const pickOther = (edit, file) => Object.assign(edit, { kind: 'other', workflow: file, kindInputs: null, values: {} });

  /** A workflow picked in the card's form: a choice like Outro's, the values changed so far kept; the PO's own again: no choice. */
  function pickForm(edit, g, file) {
    const back = file === g.workflow;
    Object.assign(edit, { workflow: back ? null : file, kindInputs: null });
    if (back || !g.kind) delete edit.kind;
    else edit.kind = 'other';
  }

  // the plan's groups by the kind each shows, KINDS order, the ones without a kind last ("other"); [] when none has a kind
  function byKind(groups, kindOf) {
    if (!groups.some((g) => g.kind)) return [];
    return [...DefaultWorkflow.KINDS, 'other'].map((kind) => ({ kind, items: groups.map((g, n) => ({ g, n })).filter(({ g, n }) => (kindOf(g, n) || 'other') === kind) })).filter((x) => x.items.length);
  }

  /** The plan's runs: the summary and the cards grouped by kind. card(g, n): a recommendation's markup; kindOf(g, n): the kind it shows, the owner's choice included. */
  function planHtml(groups, card, kindOf = (g) => g.kind) {
    const kinds = byKind(groups, kindOf);
    if (!kinds.length) return groups.map(card).join('');
    const summary = kinds.map(({ kind, items }) => esc(t(`po.kind.count_${kind}`, { count: items.length }))).join(' · ');
    return `<div class="small muted po-kind-summary" data-testid="po-kind-summary">${summary}</div>${kinds.map(({ kind, items }) => `<div class="po-kind-group" data-testid="po-kind-group-${esc(kind)}">${items.map(({ g, n }) => card(g, n)).join('')}</div>`).join('')}`;
  }

  window.BacklogPoKinds = {
    badge,
    choose,
    controlHtml,
    pickForm,
    pickOther,
    planHtml,
    reasonHtml,
    shown,
  };
})();
