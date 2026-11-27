// Documents screen (#647, #671, #650, views/docs/docs.js): the item's SDLC steps with their documents
// and the markup of the list area: the Items rows (their stage chain, the pill of their latest
// document, their actions, #671 mock-1; #12 the link to the issue their documents name in `issue:`
// instead of "Create epic", no "Write the plan" once its issues are all closed, and a Done badge, the row
// last, once the plan is built and the test passed or its epic is closed: the item's issueState/epicState
// docs:list reads from the Backlog's synced issues) and the Intents tab (#650, spec R16: every
// docs/work/<item>/intent.md with its status and its link back to the maintain.md that opened it).
// Markup only, from the values docs.js passes; the clicks are docs.js's (data-docs-*). Uses app.js
// globals (esc, t), DocsPanels.openLabel, DocModel.ACCEPTED and DocModel.issueRef, and window.Platforms
// (parseRepoUrl, projectPlatform, findPlatform) for the issue links. Browser: window.DocsList.
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
    // #12 nor once the item's issues are all closed (built without a plan.md)
    if (spec && signedOff(spec.status) && !names.includes('plan') && !issuesClosed(it) && !isDone(it)) open.push(`<button type="button" class="btn sm" data-testid="docs-write-plan" data-docs-write-plan data-item="${esc(it.item)}">${t('docs.write_the_plan')}</button>`);
    // #12 an item whose documents name its issue already has it: no second epic
    if (spec && signedOff(spec.status) && !issueOf(it)) open.push(`<button type="button" class="btn sm primary" data-docs-issues data-item="${esc(it.item)}">${t('docs.create_epic_and_phase_issues')}</button>`);
    return open.join('');
  }

  // #12 the item's issue from its documents' `issue:` field (DocModel.issueRef), null without one
  const issueOf = (it) => (it.issue ? window.DocModel?.issueRef?.(it.issue) || null : null);
  // #12 a ref's page: its URL when the `issue:` gave one, owner/repo#N on the project's host (the default
  // platform's without one), #N in the project's repository
  function issueHref(ref, project) {
    if (ref.url) return ref.url;
    const P = window.Platforms;
    const repo = P?.parseRepoUrl?.(project?.repo);
    const path = ref.repo || repo?.path;
    if (!P || !path) return '';
    const platform = (repo && P.projectPlatform?.(project)) || P.platformOrDefault?.();
    return platform?.issueUrl?.(`https://${repo?.host || platform.host}/${path}`, ref.number) || '';
  }
  // #12 the row's link to its issue, "Epic owner/repo#628 · #629" for an epic's phase, opening the epic
  function issueLink(it, project) {
    const ref = issueOf(it);
    if (!ref) return '';
    const name = (r) => `${r.repo || ''}#${r.number}`;
    // "epic #628" alone: the epic is the item's own ref, named once
    const own = ref.epic && name(ref.epic) === name(ref) ? '' : ` · ${name(ref)}`;
    const label = ref.epic ? `${t('docs.item_epic', { ref: name(ref.epic) })}${own}` : t('docs.item_issue', { ref: name(ref) }); // i18n-ignore
    const href = ref.epic ? issueHref(ref.epic, project) : issueHref(ref, project);
    return `<a class="docs-item-issue small" data-testid="docs-item-issue-link"${href ? ` href="${esc(href)}" target="_blank" rel="noopener"` : ''} title="${esc(ref.text)}">${esc(label)}</a>`;
  }

  // #12 the platform states docs:list adds from the Backlog's synced issues (issueState, epicState), unknown: open
  const closed = (state) => state === 'closed';
  // every issue the item names (its issue and the epic it names) is closed
  const issuesClosed = (it) => {
    const ref = issueOf(it);
    return !!ref && closed(it.issueState) && (!ref.epic || closed(it.epicState));
  };
  // its epic is closed: the epic it names, else its issue (an item's own issue is its epic, "#625")
  const epicClosed = (it) => {
    const ref = issueOf(it);
    return !!ref && closed(ref.epic ? it.epicState : it.issueState);
  };
  // #12 a built plan whose test passed, or a closed epic: the item is done
  const isDone = (it) => epicClosed(it) || (it.docs.some((d) => d.doc === 'plan' && d.status === 'built') && it.docs.some((d) => d.doc === 'test' && d.status === 'passed'));

  // #671 the stage chain of a row, "Plan ✓ · Design": the steps up to the item's, done ones checked
  function stagesHtml(it) {
    const latest = it.docs[it.docs.length - 1];
    // #12 a done item's chain reaches Test, every step checked
    const finished = isDone(it);
    const at = Math.max(STAGE_STEP[it.stage] ?? Math.max(0, stepOfDoc(latest?.doc)), finished ? STAGE_STEP.test : 0);
    const current = it.docs.find((d) => d.doc === SDLC[at].doc);
    const done = (i) => finished || i < at || (i === at && !!current && (current.status === acceptedStatus(current.doc) || signedOff(current.status)));
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
  // #12 project: the project's { repo, platform } for the issue links (optional); done items come last
  function itemsHtml(items, projectId, project = null) {
    if (!projectId) return noProject();
    if (!items.length) return `<div class="empty-state" data-testid="docs-empty"><b>${t('docs.no_item_yet')}</b><p class="muted">${t('docs.start_with_new_item')}</p></div>`;
    const ordered = [...items].sort((a, b) => Number(isDone(a)) - Number(isDone(b)));
    return ordered.map((it) => `
      <div class="docs-item" data-testid="docs-item" data-item="${esc(it.item)}">
        <div class="docs-item-main" title="${esc(`docs/work/${it.item}/`)}">
          <b class="docs-item-title" data-testid="docs-item-title" title="${esc(it.title || it.item)}">${esc(it.title || it.item)}</b>
          <span class="docs-sep muted">·</span>
          <span class="docs-item-stages muted" data-testid="docs-item-stages">${stagesHtml(it)}</span>
        </div>
        ${issueLink(it, project)}
        ${isDone(it) ? `<span class="badge docs-done" data-testid="docs-item-done">${t('docs.item_done')}</span>` : ''}
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
    isDone,
    itemsHtml,
    signedOff,
    statusBadge,
    statusLabel,
    stepOfDoc,
    tabsHtml,
  };
})();
