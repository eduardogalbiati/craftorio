// Documents screen (#647, #671, #650, views/docs/docs.js): the item's SDLC steps with their documents
// and the markup of the list area: the Items rows (their stage chain, the pill of their latest
// document, their actions, #671 mock-1) and the Intents tab (#650, spec R16: every
// docs/work/<item>/intent.md with its status and its link back to the maintain.md that opened it).
// Markup only, from the values docs.js passes; the clicks are docs.js's (data-docs-*). Uses app.js
// globals (esc, t), DocsPanels.openLabel and DocModel.ACCEPTED. Browser: window.DocsList.
(() => {
  // #671 the SDLC steps of an item (living-doc.jpg), each with its document; Plan and Design are written here
  const SDLC = [
    { name: () => t('docs.step_plan'), doc: 'intent', file: 'intent.md' },
    { name: () => t('docs.step_design'), doc: 'spec', file: 'spec.md' },
    { name: () => t('docs.step_build'), doc: 'plan', file: 'plan.md' },
    { name: () => t('docs.step_test'), doc: null, file: 'test.md' },
    { name: () => t('docs.step_deploy'), doc: null, file: 'deploy.md' },
    // #650 maintain.md: the Monitor's and the Night watch's incidents, read here (no writer, no gate)
    { name: () => t('docs.step_maintain'), doc: 'maintain', file: 'maintain.md' },
  ];
  // an item's front matter `stage` (or its latest document) → its SDLC step
  const STAGE_STEP = { intent: 0, spec: 1, design: 1, plan: 2, build: 2, test: 3, deploy: 4, maintain: 5 };
  const stepOfDoc = (doc) => SDLC.findIndex((s) => s.doc === doc);
  const fileName = (path) => String(path || '').split('/').pop();
  const docFile = (doc) => SDLC[stepOfDoc(doc)]?.file || `${doc}.md`;
  // the status past the SDLC gate (DocModel.ACCEPTED), read when drawn: the module may load later
  const acceptedStatus = (doc) => window.DocModel?.ACCEPTED?.[doc];
  // a spec's front matter writes its status `signed off` or `signed-off`
  const signedOff = (status) => String(status || '').replace(/-/g, ' ') === acceptedStatus('spec');

  function statusLabel(status) {
    if (status === 'accepted') return t('docs.status_accepted');
    if (status === 'signed off') return t('docs.status_signed_off');
    if (status === 'draft') return t('docs.status_draft');
    return esc(status || '');
  }
  const statusBadge = (status, testid = '') => `<span class="badge${status === 'draft' ? '' : ' docs-done'}"${testid ? ` data-testid="${testid}"` : ''}>${statusLabel(status)}</span>`;

  function itemActions(it) {
    const intent = it.docs.find((d) => d.doc === 'intent');
    const spec = it.docs.find((d) => d.doc === 'spec');
    // the document a run in progress writes opens with that run (its gate, its queue)
    const names = it.docs.map((d) => d.doc);
    if (it.runId && !names.includes(it.runDoc)) names.push(it.runDoc);
    const run = (doc) => (it.runId && it.runDoc === doc ? ` data-run="${esc(it.runId)}"` : '');
    const open = names.map((doc) => `<button type="button" class="btn sm ghost" data-docs-open="${esc(doc)}" data-item="${esc(it.item)}"${run(doc)}>${DocsPanels.openLabel(doc)}</button>`);
    if (intent?.status === 'accepted' && !spec) open.push(`<button type="button" class="btn sm primary" data-docs-write-spec data-item="${esc(it.item)}">${t('docs.write_the_spec')}</button>`);
    // #633 the plan (plan.md) is written from the signed-off spec, at its own gate
    if (spec && signedOff(spec.status) && !names.includes('plan')) open.push(`<button type="button" class="btn sm" data-testid="docs-write-plan" data-docs-write-plan data-item="${esc(it.item)}">${t('docs.write_the_plan')}</button>`);
    if (spec && signedOff(spec.status)) open.push(`<button type="button" class="btn sm primary" data-docs-issues data-item="${esc(it.item)}">${t('docs.create_epic_and_phase_issues')}</button>`);
    return open.join('');
  }

  // #671 the stage chain of a row, "Plan ✓ · Design": the steps up to the item's, done ones checked
  function stagesHtml(it) {
    const latest = it.docs[it.docs.length - 1];
    const at = STAGE_STEP[it.stage] ?? Math.max(0, stepOfDoc(latest?.doc));
    const current = it.docs.find((d) => d.doc === SDLC[at].doc);
    const done = (i) => i < at || (i === at && !!current && (current.status === acceptedStatus(current.doc) || signedOff(current.status)));
    return SDLC.slice(0, at + 1).map((s, i) => `<span class="docs-stage${done(i) ? ' done' : ''}">${s.name()}${done(i) ? ' ✓' : ''}</span>`).join('<span class="docs-sep">·</span>'); // i18n-ignore
  }

  // #671 the pill of the latest document: "<file> · <state>", "editing" while a writer run has it
  function pillHtml(it) {
    const latest = it.docs[it.docs.length - 1];
    const editing = it.runId && it.runDoc;
    const doc = editing ? it.runDoc : latest?.doc;
    if (!doc) return '';
    const status = editing ? null : latest.status;
    const tone = editing ? ' editing' : status === 'draft' ? '' : ' done';
    const file = editing ? docFile(doc) : fileName(latest.file) || docFile(doc);
    return `<span class="docs-pill${tone}" data-testid="docs-item-pill" title="${esc(latest?.file || file)}">${esc(file)} · ${editing ? t('docs.pill_editing') : statusLabel(status).toLowerCase()}</span>`; // i18n-ignore
  }

  const noProject = () => `<div class="empty-state"><b>${t('docs.no_project_chosen')}</b><p class="muted">${t('docs.choose_a_project_in_the_header')}</p></div>`;

  // the Items tab: one row per docs/work/<item>/
  function itemsHtml(items, projectId) {
    if (!projectId) return noProject();
    if (!items.length) return `<div class="empty-state" data-testid="docs-empty"><b>${t('docs.no_item_yet')}</b><p class="muted">${t('docs.start_with_new_item')}</p></div>`;
    return items.map((it) => `
      <div class="docs-item" data-testid="docs-item" data-item="${esc(it.item)}">
        <div class="docs-item-main" title="${esc(`docs/work/${it.item}/`)}">
          <b class="docs-item-title" data-testid="docs-item-title" title="${esc(it.title || it.item)}">${esc(it.title || it.item)}</b>
          <span class="docs-sep muted">·</span>
          <span class="docs-item-stages muted" data-testid="docs-item-stages">${stagesHtml(it)}</span>
        </div>
        ${pillHtml(it)}
        <div class="row docs-item-actions">${itemActions(it)}</div>
      </div>`).join('');
  }

  // "checkout" of `../checkout/maintain.md`
  const fromItem = (from) => String(from || '').split('/').filter((s) => s && s !== '..')[0] || from;

  // #650 the Intents tab: every item's intent, its status and its link back
  function intentsHtml(intents, projectId) {
    if (!projectId) return noProject();
    if (!intents.length) return `<div class="empty-state" data-testid="docs-intents-empty"><b>${t('docs.no_intent_yet')}</b><p class="muted">${t('docs.no_intent_yet_help')}</p></div>`;
    return intents.map((i) => {
      const back = i.from ? `<span class="docs-intent-from muted small" title="${esc(i.from)}">${esc(t('docs.links_back', { item: fromItem(i.from) }))}</span>` : '';
      const hint = i.status === 'draft' ? esc(t('docs.open_to_validate')) : esc(i.file);
      return `
      <button type="button" class="docs-item docs-intent-row" data-testid="docs-intent-row" data-docs-intent="${esc(i.item)}" title="${hint}">
        <span class="docs-item-main">
          <b class="docs-item-title">${esc(i.title || i.item)}</b>
          <span class="mono muted small docs-intent-file">${esc(i.file)}</span>
        </span>
        ${back}
        ${statusBadge(i.status)}
      </button>`;
    }).join('');
  }

  // #650 the list's tabs (Items | Intents) and their panels
  function tabsHtml() {
    return `
            <div id="docs-views" class="seg sm docs-views" role="tablist" aria-label="${t('docs.documents')}">
              <button type="button" role="tab" class="active" aria-selected="true" aria-controls="docs-list" data-testid="docs-view-items" data-docs-view="items">${t('docs.items')}</button>
              <button type="button" role="tab" aria-selected="false" tabindex="-1" aria-controls="docs-intents" data-testid="docs-view-intents" data-docs-view="intents">${t('docs.intents')}</button>
            </div>`;
  }

  // shows the panel of `view` (items | intents) and marks its tab
  function applyView(view) {
    for (const tab of document.querySelectorAll('#docs-views [data-docs-view]')) {
      const on = tab.dataset.docsView === view;
      tab.classList.toggle('active', on);
      tab.setAttribute('aria-selected', String(on));
      tab.tabIndex = on ? 0 : -1;
    }
    document.querySelector('#docs-list')?.classList.toggle('hidden', view !== 'items');
    document.querySelector('#docs-intents')?.classList.toggle('hidden', view !== 'intents');
  }

  window.DocsList = {
    SDLC,
    STAGE_STEP,
    acceptedStatus,
    applyView,
    docFile,
    fileName,
    intentsHtml,
    itemsHtml,
    signedOff,
    statusBadge,
    statusLabel,
    stepOfDoc,
    tabsHtml,
  };
})();
