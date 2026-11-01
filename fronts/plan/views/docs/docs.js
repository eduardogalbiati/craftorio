/* global api */
// Documents screen (#647, Plan & Design › Documents, docs/work/write-doc/spec.md R1, R8-R13): the work
// items of the header's project, read from its repository's docs/work/ (the docs: channels,
// fronts/plan/engine/channels/docs.js), each with its stage and its documents' status (and the
// write-doc runs in progress, reopened with their gate). New item starts the write-doc workflow
// (workflows/write-doc.yaml), whose worktree the service writes: the skeleton, the writer's draft,
// each request (the docs: channels take the runId); an accepted intent offers Write the spec. The editor draws the document
// in a sandboxed iframe without scripts (each block tagged with its source lines, data-src); a
// selection on the page becomes the chip above the writer's chat (AgentChat, agent-chat.js, pasted
// images too), and each request is a writer turn of the run's human_edit gate (run:request-edit)
// whose answer the service swaps into the source and its translation, one commit per request
// (docs:apply-request). The changes by request list those commits with their unreviewed queue (Mark
// reviewed, Undo this change); Send to review ends the edit; the approval gate's Accept intent / Sign
// off spec changes the front matter and commits (docs:accept) before it answers the gate. A signed-off
// spec offers Create epic and phase issues (its list row too: the Backlog's Product Owner proposes them
// with their mockup coverage, #670) and Start the Build (the Roadmap): nothing is filed or started
// before that click. A Discovery card's Write a document starts its writer here too (writeDocForCard, #649).
// #671 the screens follow the spec's mockups (docs/work/write-doc/images/): the list rows show their
// SDLC stage chain and the pill of their latest document, New item is a side panel (mock-1); the
// editor has the item's six SDLC steps, the contents with each requirement, the toolbar (Edit / Diff /
// Preview, EN / PT, Versions, Send to review) and the writer panel (Apply now or Queue, Attach image)
// (living-doc, mock-2); each change by request is a versioned card whose detail holds Undo this change
// and Mark reviewed (mock-3); the review shows its score, its rubric checks and the anchored notes with
// Apply / Edit / Dismiss (mock-4); the approval gate is the sign-off panel (mock-5). Several writers
// (AI Arena, phase 2) and Screens to capture first (captures, phase 3) are shown disabled.
// Registers itself with registerView (view-registry.js); uses app.js globals ($, esc, state, api,
// errMsg, openModal, closeModal, showToast, showView, confirmDialog), markdownHtml (artifact-render.js),
// DocModel (packages/shared/doc-model.js), CurrentProject and AgentChat.
(() => {
  const FILE = 'write-doc.yaml';
  const slugOf = (title) => String(title).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 100);
  // the status past the SDLC gate (DocModel.ACCEPTED), read when drawn: the module may load later
  const acceptedStatus = (doc) => window.DocModel?.ACCEPTED?.[doc];

  // #671 the SDLC steps of an item (living-doc.jpg), each with its document; Plan and Design are written here
  const SDLC = [
    { name: () => t('docs.step_plan'), doc: 'intent', file: 'intent.md' },
    { name: () => t('docs.step_design'), doc: 'spec', file: 'spec.md' },
    { name: () => t('docs.step_build'), doc: null, file: 'plan.md' },
    { name: () => t('docs.step_test'), doc: null, file: 'test.md' },
    { name: () => t('docs.step_deploy'), doc: null, file: 'deploy.md' },
    { name: () => t('docs.step_maintain'), doc: null, file: 'maintain.md' },
  ];
  // an item's front matter `stage` (or its latest document) → its SDLC step
  const STAGE_STEP = { intent: 0, spec: 1, design: 1, build: 2, test: 3, deploy: 4, maintain: 5 };
  const stepOfDoc = (doc) => SDLC.findIndex((s) => s.doc === doc);
  // the spec's cost estimates of a first draft (spec.md, Points of attention › Cost)
  const ESTIMATES = { intent: '$0.30–1.00', spec: '$1.00–3.00' };

  // open: the document in the editor { item, doc, data (docs:read), runId, base (the commit the
  // run started from, docs:changes'), gate (the run's waiting approval.requested), changes,
  // unreviewed, notes and checks (the reviewer's), messages, selection, requesting (a request in
  // flight), tab (edit | diff | preview), lang (en | pt), source (the markdown shown), mode (now |
  // queue), queue (the queued requests), pendingNotes (applied at the next edit gate), changeOpen }
  const docs = { projectId: null, items: [], seq: 0, open: null, chat: null, busy: false, early: [] };

  function statusLabel(status) {
    if (status === 'accepted') return t('docs.status_accepted');
    if (status === 'signed off') return t('docs.status_signed_off');
    if (status === 'draft') return t('docs.status_draft');
    return esc(status || '');
  }
  const statusBadge = (status, testid = '') => `<span class="badge${status === 'draft' ? '' : ' docs-done'}"${testid ? ` data-testid="${testid}"` : ''}>${statusLabel(status)}</span>`;
  // the lower-case state of a list pill ("spec.md · draft")
  function pillState(status) {
    if (status === 'accepted') return t('docs.pill_accepted');
    if (signedOff(status)) return t('docs.pill_signed_off');
    if (status === 'draft') return t('docs.pill_draft');
    return esc(status || '');
  }
  const projectFolder = () => (state.projects || []).find((p) => p.id === docs.projectId)?.folder || null;
  const listError = (msg) => { $('#docs-list-error').textContent = msg || ''; };
  const editorError = (msg) => { const p = $('#docs-editor-error'); if (p) p.textContent = msg || ''; };
  const fileName = (path) => String(path || '').split('/').pop();
  const docFile = (doc) => SDLC[stepOfDoc(doc)]?.file || `${doc}.md`;

  // ---- the list ---------------------------------------------------------------------------------
  async function refresh() {
    const seq = ++docs.seq;
    docs.projectId = window.CurrentProject?.get() || null;
    let items = [];
    let error = '';
    if (docs.projectId) {
      try { items = await api.listDocItems(docs.projectId); } catch (e) { error = errMsg(e); }
    }
    if (seq !== docs.seq) return; // a newer refresh answers
    docs.items = items || [];
    listError(error);
    renderList();
  }

  function itemActions(it) {
    const intent = it.docs.find((d) => d.doc === 'intent');
    const spec = it.docs.find((d) => d.doc === 'spec');
    // the document a run in progress writes opens with that run (its gate, its queue)
    const names = it.docs.map((d) => d.doc);
    if (it.runId && !names.includes(it.runDoc)) names.push(it.runDoc);
    const run = (doc) => (it.runId && it.runDoc === doc ? ` data-run="${esc(it.runId)}"` : '');
    const open = names.map((doc) => `<button type="button" class="btn sm ghost" data-docs-open="${esc(doc)}" data-item="${esc(it.item)}"${run(doc)}>${doc === 'spec' ? t('docs.open_spec') : t('docs.open_intent')}</button>`);
    if (intent?.status === 'accepted' && !spec) open.push(`<button type="button" class="btn sm primary" data-docs-write-spec data-item="${esc(it.item)}">${t('docs.write_the_spec')}</button>`);
    if (spec && signedOff(spec.status)) open.push(`<button type="button" class="btn sm primary" data-docs-issues data-item="${esc(it.item)}">${t('docs.create_epic_and_phase_issues')}</button>`);
    return open.join('');
  }

  // a spec's front matter writes its status `signed off` or `signed-off`
  const signedOff = (status) => String(status || '').replace(/-/g, ' ') === acceptedStatus('spec');

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
    return `<span class="docs-pill${tone}" data-testid="docs-item-pill" title="${esc(latest?.file || file)}">${esc(file)} · ${editing ? t('docs.pill_editing') : pillState(status)}</span>`; // i18n-ignore
  }

  // #670: the Product Owner proposes the epic and one issue per phase of a signed-off spec, each
  // screen task with its mockup, and checks that every mockup in scope has an issue (the Backlog's drawer)
  async function proposeIssues(item) {
    // the drawer plans for the Backlog's project: this item's, before the Backlog has loaded it
    window.BacklogActions?.focusProject?.(docs.projectId);
    showView('backlog');
    await window.BacklogPO?.ask(`Create the epic and one issue per phase from the signed-off spec docs/work/${item}/spec.md: every screen task names and embeds its mockup.`);
  }

  function renderList() {
    const box = $('#docs-list');
    if (!docs.projectId) {
      box.innerHTML = `<div class="empty-state"><b>${t('docs.no_project_chosen')}</b><p class="muted">${t('docs.choose_a_project_in_the_header')}</p></div>`;
      return;
    }
    if (!docs.items.length) {
      box.innerHTML = `<div class="empty-state" data-testid="docs-empty"><b>${t('docs.no_item_yet')}</b><p class="muted">${t('docs.start_with_new_item')}</p></div>`;
      return;
    }
    box.innerHTML = docs.items.map((it) => `
      <div class="docs-item" data-testid="docs-item" data-item="${esc(it.item)}">
        <div class="docs-item-main" title="${esc(`docs/work/${it.item}/`)}">
          <b class="docs-item-title">${esc(it.title || it.item)}</b>
          <span class="docs-sep muted">·</span>
          <span class="docs-item-stages muted" data-testid="docs-item-stages">${stagesHtml(it)}</span>
        </div>
        ${pillHtml(it)}
        <div class="row docs-item-actions">${itemActions(it)}</div>
      </div>`).join('');
  }

  function onListClick(e) {
    const write = e.target.closest('[data-docs-write-spec]');
    if (write) return startDoc(write.dataset.item, 'spec', null);
    const issues = e.target.closest('[data-docs-issues]');
    if (issues) return proposeIssues(issues.dataset.item);
    const open = e.target.closest('[data-docs-open]');
    if (open) return openDoc(open.dataset.item, open.dataset.docsOpen, open.dataset.run || null);
    return undefined;
  }

  // ---- New item (#671: the side panel of mock-1) -------------------------------------------------
  const estimateText = (doc) => t('docs.estimate', { cost: ESTIMATES[doc] || ESTIMATES.intent });

  function openNewItem() {
    $('#docs-new-title').value = '';
    $('#docs-new-starts').value = 'intent';
    $('#docs-new-estimate').textContent = estimateText('intent');
    $('#docs-new-error').textContent = '';
    $('#docs-new-panel').classList.remove('hidden');
    $('#docs-list-area').classList.add('docs-with-panel');
    $('#docs-new-title').focus({ preventScroll: true });
  }

  function closeNewItem() {
    $('#docs-new-panel').classList.add('hidden');
    $('#docs-list-area').classList.remove('docs-with-panel');
  }

  async function submitNewItem(e) {
    e.preventDefault();
    const title = String($('#docs-new-title').value || '').trim();
    const doc = $('#docs-new-starts').value === 'spec' ? 'spec' : 'intent';
    const item = slugOf(title);
    if (!docs.projectId) { $('#docs-new-error').textContent = t('docs.choose_a_project_in_the_header'); return; }
    if (!item) { $('#docs-new-error').textContent = t('docs.give_the_item_a_title'); return; }
    if (docs.items.some((it) => it.item === item)) { $('#docs-new-error').textContent = t('docs.an_item_with_this_name_exists', { item }); return; }
    closeNewItem();
    await startDoc(item, doc, title);
  }

  // A new document: the write-doc run that creates its skeleton in the run's worktree (the service, at
  // its first step), drafts and edits it.
  async function startDoc(item, doc, title) {
    if (docs.busy) return;
    docs.busy = true;
    listError('');
    try {
      // creating: its run writes the skeleton, the first read has nothing yet
      await openDoc(item, doc, null, { creating: true });
      docs.open.title = title || item;
      await startWriter();
      refresh();
    } catch (e) {
      listError(errMsg(e));
    } finally { docs.busy = false; }
  }

  // The write-doc run of a document → its startRun answer { runId }; folder: the project's (none: left out)
  async function runWriter(projectId, folder, { item, doc, title }) {
    const inputs = { ...(folder ? { project_path: folder } : {}), item, document: doc, title: title || item };
    // the run starts from and merges into the project's default branch (main, master, develop…)
    const hints = await api.projectInputHints?.(projectId).catch(() => null);
    if (hints?.defaultBranch) inputs.base_branch = hints.defaultBranch;
    return api.startRun({ file: FILE, inputs, mock: !!state.simulationOnly, projectId });
  }

  async function startWriter() {
    const o = docs.open;
    const folder = projectFolder();
    if (!o || !folder) { editorError(t('docs.the_project_has_no_folder')); return; }
    o.starting = true;
    docs.early = [];
    renderGate();
    try {
      const out = await runWriter(docs.projectId, folder, o);
      if (docs.open !== o) return;
      o.runId = out.runId;
      // the run's first events may arrive before startRun answers
      const early = docs.early.filter((ev) => ev.run_id === o.runId);
      docs.early = [];
      for (const ev of early) await onRunEvent(ev);
    } catch (e) {
      editorError(errMsg(e));
    } finally { o.starting = false; o.creating = false; }
    renderGate();
  }

  // ---- the editor ---------------------------------------------------------------------------------
  // runId: the write-doc run in progress on this document (the list's), its waiting gate found again
  async function openDoc(item, doc, runId, { creating = false, projectId = null } = {}) {
    docs.projectId = projectId || window.CurrentProject?.get() || docs.projectId;
    docs.open = {
      item, doc, data: null, runId: runId || null, creating, base: null, gate: null, changes: [], unreviewed: [], notes: [], checks: [], messages: [], selection: null, problems: [],
      tab: 'edit', lang: 'en', source: false, mode: 'now', queue: [], pendingNotes: [], changeOpen: null, lastAnchor: null,
    };
    $('#docs-list-area').classList.add('hidden');
    $('#docs-editor-area').classList.remove('hidden');
    $('#docs-editor').dataset.stage = doc;
    editorError('');
    docs.chat?.setMessages([]);
    if (runId) await restoreGate(docs.open);
    await reload();
  }

  async function restoreGate(o) {
    try {
      const run = (await api.listActiveRuns?.() || []).find((r) => r.runId === o.runId);
      if (docs.open !== o) return;
      if (!run) { o.runId = null; return; }
      const g = (run.gates || [])[0];
      if (g) o.gate = g.edit || g.step_id !== 'edit' ? g : { ...g, edit: { agent: 'writer' } };
    } catch (e) { editorError(errMsg(e)); }
  }

  function closeDoc() {
    docs.open = null;
    $('#docs-editor-area').classList.add('hidden');
    $('#docs-list-area').classList.remove('hidden');
    refresh();
  }

  // The document, its translation and its changes read again (after a draft, a request, an undo).
  async function reload() {
    const o = docs.open;
    if (!o) return;
    try {
      const [data, ch] = await Promise.all([
        api.readDoc(docs.projectId, o.item, o.doc, o.runId).catch((e) => {
          // a new item's run has not written its skeleton yet: the writer is working
          if (o.runId || o.starting || o.creating) return null;
          throw e;
        }),
        api.listDocChanges(docs.projectId, o.item, o.doc, o.base, o.runId),
      ]);
      if (docs.open !== o) return;
      editorError('');
      o.data = data;
      o.changes = ch.changes || [];
      o.unreviewed = ch.unreviewed || [];
      o.base = o.base || ch.base || null;
      if (!o.data?.translation && o.lang === 'pt') o.lang = 'en';
    } catch (e) { editorError(errMsg(e)); }
    renderEditor();
  }

  // the changes still in the document, oldest first; the draft is v1, each request the next version
  const liveChanges = (o) => o.changes.filter((c) => !c.undone);
  const versionOf = (o) => liveChanges(o).length + 1;
  const stepName = (doc) => SDLC[stepOfDoc(doc)]?.name() || '';

  function renderEditor() {
    const o = docs.open;
    if (!o) return;
    renderHead();
    renderToc();
    renderToolbar();
    renderReader();
    renderChip();
    renderQueue();
    renderChanges();
    renderNotes();
    renderGate();
  }

  // #671 the title bar (mock-2) and the item's SDLC steps (living-doc.jpg)
  function renderHead() {
    const o = docs.open;
    const status = o.data?.status || 'draft';
    const it = docs.items.find((i) => i.item === o.item);
    const title = it?.title || o.title || o.item;
    const current = stepOfDoc(o.doc);
    const has = (doc) => doc && (it?.docs || []).some((d) => d.doc === doc);
    const steps = SDLC.map((s, i) => {
      const cur = i === current;
      const name = `<span class="docs-step-num">${i + 1}</span><span class="docs-step-text"><b>${s.name()}</b><span class="mono small">${s.file}</span></span>${cur ? statusBadge(status, 'doc-status') : ''}`;
      const inner = !cur && has(s.doc) ? `<button type="button" class="docs-step-open" data-docs-step-open="${s.doc}">${name}</button>` : name;
      return `<li class="docs-step${cur ? ' current' : ''}${i < current ? ' done' : ''}" data-testid="doc-step"${cur ? ' aria-current="step"' : ''}>${inner}</li>`;
    }).join('<li class="docs-step-arrow" aria-hidden="true">→</li>'); // i18n-ignore
    const version = `${esc(docFile(o.doc))} · v${versionOf(o)}${o.gate?.edit ? ` · ${t('docs.pill_editing')}` : ''}`; // i18n-ignore
    const folder = `docs/work/${o.item}/`; // i18n-ignore
    $('#docs-editor-head').innerHTML = `
      <div class="docs-titlebar" data-testid="doc-titlebar">
        <button type="button" class="btn sm ghost docs-back" data-docs-back aria-label="${t('docs.back_to_the_list')}" title="${t('docs.back_to_the_list')}">←</button>
        <span class="docs-titlebar-text" title="${esc(title)}">${t('docs.documents')} · ${esc(title)}</span>
        <span class="mono muted small docs-version" data-testid="doc-version" title="${esc(o.data?.source?.file || '')}">${version}</span>
      </div>
      <div class="docs-itemhead">
        <div class="docs-itemhead-name">
          <b title="${esc(title)}">${esc(title)}</b>
          <span class="mono muted small" title="${esc(folder)}">${esc(folder)}</span>
        </div>
        <ol class="docs-stepper" data-testid="doc-stepper">${steps}</ol>
      </div>`; // i18n-ignore
  }

  // the markdown shown in the reader and the contents: the source or, in PT, its translation
  const shownMarkdown = (o) => (o.lang === 'pt' && o.data?.translation ? o.data.translation.markdown : o.data?.source?.markdown) || '';
  // a requirement's name: the bold text after its label, "**R1. Documents screen.**"
  const labelName = (row) => ((/^\*\*[RD]\d+\.\s*([^*]*?)\.?\s*\*\*/.exec(row) || [])[1] || '').trim();

  // The sections of the document with their anchors (the rule of DocModel's selection anchors:
  // <doc>-<label key> for a requirement, <doc>-<heading slug> for a heading)
  function outline(md, doc) {
    if (!window.DocModel || !md) return [];
    const rows = md.split('\n');
    return window.DocModel.sections(md).filter((s) => s.title !== null || s.label).map((s) => {
      const first = s.blocks[0];
      const label = s.label ? (rows[first.start - 1].match(/^\*\*([RD]\d+)\./) || [])[1] : null;
      const level = s.title !== null ? Math.min(6, (rows[first.start - 1].match(/^#+/) || ['##'])[0].length) : 7;
      return { ...s, id: s.label ? `${doc}-${s.key}` : `${doc}-${s.slug}`, level, text: label ? [label, labelName(rows[first.start - 1])].filter(Boolean).join(' · ') : s.title, first }; // i18n-ignore
    });
  }

  // a review note's anchor ("costs", "#spec-r2") matches a section's id, key or slug
  const noteKey = (anchor) => String(anchor || '').replace(/^#/, '');
  const matchesNote = (sec, doc, anchor) => {
    const a = noteKey(anchor);
    return a === sec.id || a === sec.key || a === sec.slug || `${doc}-${a}` === sec.id;
  };

  // #671 the contents (living-doc.jpg): the headings, each requirement as a sub-entry, the markdown
  // source last; a dot marks the section of the last change and the ones with a review note
  function renderToc() {
    const o = docs.open;
    const box = $('#docs-toc-box');
    if (!box) return;
    const list = outline(shownMarkdown(o), o.doc);
    const entry = (s) => {
      const note = o.notes.some((n) => matchesNote(s, o.doc, n.anchor));
      const cls = [s.label ? 'sub' : `h${s.level}`, o.lastAnchor === s.id ? 'changed' : '', note ? 'noted' : ''].filter(Boolean).join(' ');
      return `<li><button type="button" class="docs-toc-entry ${cls}" data-docs-toc="${esc(s.id)}" title="${esc(s.text)}">${esc(s.text)}</button></li>`;
    };
    box.innerHTML = `
      <nav class="docs-toc" data-testid="doc-toc" aria-label="${t('docs.contents')}">
        <p class="docs-kicker">${stepName(o.doc)} · ${esc(docFile(o.doc))}</p>
        <ul class="docs-toc-list">${list.map(entry).join('')}<li><button type="button" class="docs-toc-entry${o.source ? ' active' : ''}" data-docs-toc="source" aria-pressed="${o.source}">${t('docs.markdown_source')}</button></li></ul>
      </nav>
      <div class="docs-toc-legend muted small" data-testid="doc-toc-legend">
        <span><i class="docs-dot changed" aria-hidden="true"></i>${t('docs.changed_in_version', { version: versionOf(o) })}</span>
        <span><i class="docs-dot noted" aria-hidden="true"></i>${t('docs.has_a_review_note')}</span>
      </div>`; // i18n-ignore
  }

  // #671 the toolbar of mock-2: the view tabs, the language, Versions and Send to review (the edit gate)
  function renderToolbar() {
    const o = docs.open;
    const box = $('#docs-toolbar-box');
    if (!o || !box) return;
    const g = o.gate;
    const wait = o.requesting || o.answering ? ' disabled' : '';
    const tab = (id, label) => `<button type="button" role="tab" class="${o.tab === id ? 'active' : ''}" aria-selected="${o.tab === id}" data-docs-tab="${id}">${label}</button>`;
    const lang = (id, label, off) => `<button type="button" class="${o.lang === id ? 'active' : ''}" aria-pressed="${o.lang === id}" data-testid="doc-lang-${id}" data-docs-lang="${id}"${off ? ' disabled' : ''}>${label}</button>`;
    box.innerHTML = `
      <div class="docs-toolbar" data-testid="doc-toolbar">
        <div class="seg sm" role="tablist" aria-label="${t('docs.view')}">${tab('edit', t('docs.edit'))}${tab('diff', t('docs.diff'))}${tab('preview', t('docs.preview'))}</div>
        <div class="seg sm" role="group" aria-label="${t('docs.language')}">${lang('en', 'EN', false)}${lang('pt', 'PT', !o.data?.translation)}</div>
        <span class="spacer"></span>
        <button type="button" class="btn sm ghost" data-testid="doc-versions" data-docs-tab="diff" title="${t('docs.versions_help')}">${t('docs.versions')}</button>
        ${g?.edit ? `<button type="button" class="btn sm primary" data-testid="doc-send-to-review" data-docs-gate="send_to_review"${wait}>${t('docs.send_to_review')}</button>` : ''}
      </div>`; // i18n-ignore
    $('#docs-editor-body')?.classList.toggle('docs-mode-diff', o.tab === 'diff');
  }

  // The reader's page: the body's blocks as siblings, each with data-src="<start>-<end>" (its lines in
  // the source), headings without their #; no script runs in it (sandbox without allow-scripts). #671:
  // the stage and file kicker on top, each heading and requirement with its anchor id, a requirement's
  // #anchor shown beside it (not selectable); Preview leaves the kicker and the anchors out.
  function readerHtml(md, { doc = 'doc', kicker = '', preview = false, source = false } = {}) {
    const rows = String(md || '').split('\n');
    const ids = new Map(outline(md || '', doc).map((s) => [s.first.start, s]));
    const body = source ? `<pre class="src">${esc(md || '')}</pre>` : (window.DocModel ? window.DocModel.blocks(md || '') : []).map((b) => {
      const src = `${b.start}-${b.end}`;
      const sec = ids.get(b.start);
      const id = sec ? ` id="${esc(sec.id)}"` : '';
      if (b.heading !== null) {
        const level = Math.min(6, (rows[b.start - 1].match(/^#+/) || ['##'])[0].length);
        return `<h${level}${id} data-src="${src}">${esc(b.heading)}</h${level}>`;
      }
      const text = rows.slice(b.start - 1, b.end).join('\n');
      const anchor = sec?.label && !preview ? `<span class="anc" aria-hidden="true">#${esc(sec.id)}</span>` : '';
      return `${anchor}<div class="blk${sec?.label ? ' req' : ''}"${id} data-src="${src}">${typeof markdownHtml === 'function' ? markdownHtml(text) : esc(text)}</div>`;
    }).join('\n');
    let css = '';
    try {
      const v = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
      css = `body{background:${v('--panel')};color:${v('--text')};font:13px/1.55 system-ui,sans-serif;margin:16px 20px;max-width:760px}h1,h2,h3{margin:18px 0 6px}.blk>*{margin:0 0 8px}code{font-family:${v('--mono')}}::selection{background:${v('--accent')};color:${v('--bg')}}.kicker{font:11px ${v('--mono')};letter-spacing:.08em;text-transform:uppercase;color:${v('--accent')};margin:0 0 8px}.anc{float:right;font:11px ${v('--mono')};color:${v('--muted')};user-select:none;margin-left:8px}.req{border-left:2px solid ${v('--border')};padding-left:10px}.src{white-space:pre-wrap;font:12px/1.5 ${v('--mono')}}`; // i18n-ignore
    } catch { /* the default look */ }
    const top = kicker && !preview ? `<p class="kicker" aria-hidden="true">${esc(kicker)}</p>` : '';
    return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:"><style>${css}</style></head><body>${top}${body}</body></html>`; // i18n-ignore
  }

  function renderReader() {
    const frame = $('#docs-reader');
    const o = docs.open;
    if (!frame || !o) return;
    frame.srcdoc = readerHtml(shownMarkdown(o), { doc: o.doc, kicker: `${stepName(o.doc)} · ${docFile(o.doc)} · v${versionOf(o)}`, preview: o.tab === 'preview', source: o.source }); // i18n-ignore
  }

  // A selection on the page: the block it starts in (its data-src) and its text, for the chip. Only
  // the English source in the Edit tab maps back to the lines a request replaces.
  function onReaderSelect() {
    const o = docs.open;
    const doc = $('#docs-reader')?.contentDocument;
    const sel = doc?.getSelection?.();
    if (!o?.data || !sel || sel.isCollapsed || o.tab !== 'edit' || o.lang !== 'en' || o.source) return;
    const node = sel.getRangeAt(0).startContainer;
    const block = (node.nodeType === 1 ? node : node.parentElement)?.closest('[data-src]');
    if (!block) return;
    o.selection = { file: o.data.source.file, src: block.dataset.src, text: sel.toString().trim(), title: sectionTitle(block) };
    renderChip();
    docs.chat?.refresh?.();
  }

  // the heading above a block (the section the selection is in)
  function sectionTitle(block) {
    for (let el = block; el; el = el.previousElementSibling) if (/^H[1-6]$/.test(el.tagName)) return el.textContent;
    return '';
  }

  function renderChip() {
    const box = $('#docs-chip');
    const s = docs.open?.selection;
    if (!box) return;
    box.innerHTML = `<span class="muted small docs-chip-label">${t('docs.selected')}</span>${s ? `
      <span class="docs-chip" data-testid="doc-selection-chip" title="${esc(s.text)}">
        <span class="badge">${esc(s.title || t('docs.selection'))}</span>
        <span class="docs-chip-text">${esc(s.text)}</span>
        <button type="button" class="docs-chip-x" data-docs-unselect aria-label="${t('docs.clear_the_selection')}">×</button>
      </span>` : `<p class="muted small">${t('docs.select_a_passage_on_the_page')}</p>`}`;
  }

  // One request: a writer turn of the edit gate with the selection payload, its answer swapped into
  // both files as one commit. #671: in Queue mode the request waits in the queue instead.
  async function sendRequest(text, attachments) {
    const o = docs.open;
    if (o?.mode === 'queue') {
      if (!o.selection) return { ok: false, error: t('docs.select_a_passage_first') };
      o.queue = [...o.queue, { text, selection: o.selection, attachments: attachments || [] }];
      o.selection = null;
      renderChip();
      renderQueue();
      return { messages: o.messages };
    }
    if (!o?.gate?.edit || !o.runId) return { ok: false, error: t('docs.the_writer_is_not_waiting') };
    if (!o.selection) return { ok: false, error: t('docs.select_a_passage_first') };
    const payload = window.DocModel.selectionPayload({ selection: o.selection, source: o.data.source, translation: o.data.translation });
    const prompt = [
      `Request: ${text}`,
      `Selection (${payload.anchor}, lines ${payload.lines.start}-${payload.lines.end} of ${payload.file}):`,
      JSON.stringify(payload),
      'Answer source_text with the lines that replace these lines, translation_text with the same lines in Português (Brasil), reply with one sentence.',
    ].join('\n');
    o.messages = [...o.messages, { role: 'user', text, ts: new Date().toISOString() }];
    // the gate waits for this request's commit: Send to review and the approval are off until then
    o.requesting = true;
    renderGate();
    try {
      const images = await savedImages(attachments);
      const turn = await api.requestEdit(o.runId, o.gate.approval_id, prompt, images.length ? images : undefined);
      const out = turn?.output || {};
      if (typeof out.source_text !== 'string') throw new Error(t('docs.the_writer_gave_no_text'));
      const tr = o.data.translation ? window.DocModel.alignedLines(o.data.source.markdown, o.data.translation.markdown, payload.lines) : null;
      const done = await api.applyDocRequest(docs.projectId, o.item, o.doc, `req-${Date.now()}`, text, { lines: payload.lines, text: out.source_text },
        tr && typeof out.translation_text === 'string' ? { lines: tr, text: out.translation_text } : null, o.runId);
      if (docs.open !== o) return { messages: o.messages };
      o.problems = done.problems || [];
      o.selection = null;
      o.lastAnchor = payload.anchor || null;
      o.changeOpen = null;
      o.messages = [...o.messages, { role: 'agent', text: out.reply || turn.text || '', ts: new Date().toISOString() }];
      o.requesting = false;
      await reload();
      return { messages: o.messages };
    } catch (e) {
      o.messages = o.messages.slice(0, -1);
      return { ok: false, error: errMsg(e) };
    } finally {
      if (o.requesting) { o.requesting = false; renderGate(); }
    }
  }

  // The chat's pasted images ({ name, dataUrl }) saved as files (clipboard:saveImage, as PasteImage
  // does), the { path, name } run:request-edit reads
  async function savedImages(attachments) {
    const out = [];
    for (const a of attachments || []) {
      if (a?.path) { out.push({ path: a.path, name: a.name }); continue; }
      const url = String(a?.dataUrl || '');
      if (!url.includes(',')) continue;
      const saved = await api.clipboardSaveImage(url.slice(url.indexOf(',') + 1), a.name || 'image.png');
      out.push({ path: saved.path, name: saved.name || a.name });
    }
    return out;
  }

  // ---- #671 the writer panel's queue and controls (mock-2) ---------------------------------------
  function renderQueue() {
    const o = docs.open;
    const box = $('#docs-queue');
    if (!o || !box) return;
    const canApply = !!(o.gate?.edit && o.runId && !o.requesting && !o.answering);
    box.innerHTML = o.queue.length ? `
      <div class="docs-queue-head"><span class="small muted">${t('docs.queued_requests', { count: o.queue.length })}</span>
        <button type="button" class="btn sm ghost" data-docs-queue-apply${canApply ? '' : ' disabled'}>${t('docs.apply_queued')}</button></div>
      <ul class="docs-queue-list">${o.queue.map((q, i) => `
        <li><span class="docs-queue-text" title="${esc(q.text)}">“${esc(q.text)}”</span>
          <button type="button" class="docs-chip-x" data-docs-queue-remove="${i}" aria-label="${t('docs.remove_from_queue')}">×</button></li>`).join('')}</ul>` : ''; // i18n-ignore
    syncMode();
  }

  // the Apply now / Queue toggle's state
  function syncMode() {
    const o = docs.open;
    const now = $('#docs-mode-now');
    const queue = $('#docs-mode-queue');
    if (!o || !now || !queue) return;
    now.classList.toggle('active', o.mode === 'now');
    queue.classList.toggle('active', o.mode === 'queue');
    now.setAttribute('aria-pressed', String(o.mode === 'now'));
    queue.setAttribute('aria-pressed', String(o.mode === 'queue'));
  }

  // The queued requests sent one by one, from the end of the document up, so that each request's
  // lines are still where its selection found them
  async function applyQueue() {
    const o = docs.open;
    if (!o?.gate?.edit || !docs.chat) return;
    o.mode = 'now';
    const start = (q) => Number(String(q.selection?.src || '0').split('-')[0]);
    const list = [...o.queue].sort((a, b) => start(b) - start(a));
    for (const q of list) {
      if (docs.open !== o || !o.gate?.edit) break;
      o.queue = o.queue.filter((x) => x !== q);
      o.selection = q.selection;
      for (const a of q.attachments) docs.chat.addAttachment(a);
      await docs.chat.ask(q.text);
    }
    renderQueue();
  }

  function attachImages(files) {
    for (const file of [...(files || [])]) {
      const r = new FileReader();
      r.onload = () => docs.chat?.addAttachment({ name: file.name || 'image.png', type: file.type, size: file.size, dataUrl: r.result });
      r.readAsDataURL(file);
    }
  }

  // ---- the changes by request (#671: mock-3) -----------------------------------------------------
  function renderChanges() {
    const o = docs.open;
    const box = $('#docs-changes');
    if (!o || !box) return;
    const list = liveChanges(o);
    const pending = list.filter((c) => o.unreviewed.includes(c.commit)).length;
    // the change whose detail is open: the one clicked, else the newest unreviewed one
    const open = list.find((c) => c.commit === o.changeOpen) || [...list].reverse().find((c) => o.unreviewed.includes(c.commit)) || null;
    const card = (c, i) => {
      const unreviewed = o.unreviewed.includes(c.commit);
      const v = i + 2;
      const file = fileName((c.files || []).find((f) => /\.md$/.test(f) && !/\.pt-BR\.md$/.test(f)) || docFile(o.doc));
      const detail = c === open ? `
          <div class="docs-change-detail" data-testid="doc-change-detail">
            <p class="docs-change-detail-head"><b>v${v - 1} → v${v}</b> · <span class="mono">${esc(file)}</span></p>
            <p class="docs-change-request">“${esc(c.subject)}”</p>
            <div class="row docs-change-actions">
              ${o.runId ? `<button type="button" class="btn sm ghost" data-testid="doc-undo-change" data-docs-undo="${esc(c.commit)}">${t('docs.undo_this_change')}</button>` : ''}
              ${unreviewed && o.runId ? `<button type="button" class="btn sm primary" data-testid="doc-mark-reviewed" data-docs-reviewed="${esc(c.commit)}">${t('docs.mark_reviewed')}</button>` : ''}
            </div>
            <p class="muted small">${t('docs.only_the_sections_this_request_touched')}</p>
          </div>` : '';
      return `
        <li class="docs-change${unreviewed ? ' unreviewed' : ''}${c === open ? ' open' : ''}" data-testid="doc-change" data-docs-change="${esc(c.commit)}">
          <div class="docs-change-top">
            <b>v${v}</b>
            <span class="docs-pill${unreviewed ? ' editing' : ' done'}" data-testid="doc-change-state">${unreviewed ? t('docs.change_unreviewed') : t('docs.change_reviewed')}</span>
          </div>
          <span class="docs-change-text" title="${esc(c.subject)}">“${esc(c.subject)}”</span>
          <span class="mono muted small" title="${esc(c.commit)}">${esc(String(c.commit).slice(0, 8))}</span>${detail}
        </li>`; // i18n-ignore
    };
    box.innerHTML = `
      <div class="docs-section-head">
        <h3>${t('docs.changes_by_request')}</h3>
        <span class="badge${pending ? ' warn' : ''}" data-testid="doc-unreviewed-count">${t('docs.unreviewed_count', { count: pending })}</span>
      </div>
      ${list.length ? `<ol class="docs-change-list">${list.map(card).reverse().join('')}</ol>` : `<p class="muted small">${t('docs.no_change_yet')}</p>`}
      ${o.problems.length ? `<p class="small muted" title="${esc(o.problems.join('\n'))}">${t('docs.lint_problems_count', { count: o.problems.length })}</p>` : ''}`;
  }

  async function undoChange(commit) {
    const o = docs.open;
    const change = o.changes.find((c) => c.commit === commit);
    try {
      await api.undoDocChange(docs.projectId, commit, o.runId);
      o.changeOpen = null;
      await reload();
      showToast(t('docs.change_undone'), change?.subject || '');
    } catch (e) { editorError(errMsg(e)); }
  }

  async function markReviewed(commit) {
    const o = docs.open;
    if (!o?.runId) return;
    try { await api.markDocReviewed(o.runId, commit); await reload(); } catch (e) { editorError(errMsg(e)); }
  }

  // ---- the review (#671: mock-4) -------------------------------------------------------------------
  // the reviewer's score, its rubric checks and its notes, each anchored to its section
  function renderNotes() {
    const o = docs.open;
    const box = $('#docs-notes');
    if (!o || !box) return;
    const shown = o.notes.length || o.checks.length || o.score !== undefined;
    box.classList.toggle('hidden', !shown);
    const result = (r) => {
      if (r === 'pass') return `<span class="docs-pill done">${t('docs.check_pass')}</span>`;
      if (r === 'note') return `<span class="docs-pill editing">${t('docs.check_note')}</span>`;
      return `<span class="docs-pill">${esc(r || '')}</span>`;
    };
    box.innerHTML = shown ? `
      <div class="docs-section-head"><h3>${t('docs.review')}</h3>${o.score !== undefined ? `<span class="docs-pill done" data-testid="doc-review-score">${t('docs.review_score', { score: esc(o.score) })}</span>` : ''}</div>
      ${o.checks.length ? `<ul class="docs-check-list">${o.checks.map((c) => `
        <li class="docs-check" data-testid="doc-review-check"><span class="docs-check-name" title="${esc(c.name)}">${esc(c.name)}</span>${result(c.result)}</li>`).join('')}</ul>` : ''}
      <ul class="docs-note-list">${o.notes.map((n, i) => `
        <li class="docs-note${n.severity === 'major' ? ' major' : ''}" data-testid="doc-review-note" data-anchor="${esc(n.anchor)}">
          <div class="docs-note-top"><b class="mono">#${esc(noteKey(n.anchor))}</b><span class="muted small">${t('docs.reviewer')}</span></div>
          ${n.quote ? `<blockquote class="docs-note-quote">“${esc(n.quote)}”</blockquote>` : ''}
          <p class="docs-note-text">${esc(n.text)}</p>
          <div class="row docs-note-actions">
            <button type="button" class="btn sm primary" data-testid="doc-note-apply" data-docs-note-apply="${i}">${t('docs.apply')}</button>
            <button type="button" class="btn sm ghost" data-testid="doc-note-edit" data-docs-note-edit="${i}">${t('docs.edit')}</button>
            <button type="button" class="btn sm ghost" data-testid="doc-note-dismiss" data-docs-note-dismiss="${i}">${t('docs.dismiss')}</button>
          </div>
        </li>`).join('')}</ul>` : ''; // i18n-ignore
  }

  // the selection a review note points to: the first block of its section, its quote when it is there
  function noteSelection(n) {
    const o = docs.open;
    const md = o?.data?.source?.markdown;
    const sec = outline(md || '', o?.doc).find((s) => matchesNote(s, o.doc, n.anchor));
    if (!sec) return null;
    const b = sec.blocks.find((x) => x.heading === null) || sec.first;
    const text = md.split('\n').slice(b.start - 1, b.end).join('\n');
    return { file: o.data.source.file, src: `${b.start}-${b.end}`, text: n.quote && text.includes(n.quote) ? n.quote : text, title: sec.title || sec.text };
  }

  const noteRequest = (n) => `Apply the review note on #${noteKey(n.anchor)}: ${n.text}`;

  // Apply: the note as a request (at the approval gate, back to editing first, then sent); Edit: the
  // note in the text box to rework; Dismiss: the note leaves the list
  async function onNote(action, i) {
    const o = docs.open;
    const n = o?.notes[i];
    if (!n) return;
    o.notes = o.notes.filter((x) => x !== n);
    if (action === 'apply') {
      if (o.gate?.edit) await applyNote(n);
      else { o.pendingNotes.push(n); if (o.gate && !yesNoGate(o.gate)) await answerGate('revise'); }
    } else if (action === 'edit') {
      o.selection = noteSelection(n);
      if (docs.chat?.input) docs.chat.input.value = n.text;
      renderChip();
      if (o.gate && !o.gate.edit && !yesNoGate(o.gate)) await answerGate('revise');
    }
    renderNotes();
    renderToc();
  }

  async function applyNote(n) {
    const o = docs.open;
    o.mode = 'now';
    o.selection = noteSelection(n);
    renderChip();
    await docs.chat?.ask(noteRequest(n));
  }

  // ---- the gates ----------------------------------------------------------------------------------
  // #671 the sign-off panel of mock-5: the review and unreviewed pills, the front matter the gate
  // writes, the next steps (nothing starts before their own click) and its three answers
  function signoffHtml(o, g, wait) {
    const spec = o.doc === 'spec';
    const file = docFile(o.doc);
    const pending = liveChanges(o).filter((c) => o.unreviewed.includes(c.commit)).length;
    const open = o.notes.length;
    const today = new Date().toISOString().slice(0, 10);
    // the front matter's own keys, as the file spells them
    const fm = `status: ${esc(o.data?.status || 'draft')} → <span class="docs-fm-new">${esc(acceptedStatus(o.doc) || '')}</span> · approver: ${t('docs.your_git_name')} · date: ${today}`; // i18n-ignore
    const next = spec
      ? [[t('docs.create_epic_and_phase_issues'), t('docs.next_issues_help')], [t('docs.start_the_build'), t('docs.next_build_help')]]
      : [[t('docs.write_the_spec'), t('docs.next_spec_help')]];
    return `
      <section class="docs-signoff" data-testid="doc-signoff" aria-labelledby="docs-signoff-heading">
        <div class="docs-signoff-head">
          <h3 id="docs-signoff-heading">${spec ? t('docs.sign_off_required', { file }) : t('docs.acceptance_required', { file })}</h3>
          <span class="spacer"></span>
          ${o.score !== undefined ? `<span class="docs-pill done" data-testid="doc-signoff-review">${open === 1 ? t('docs.review_pill_one', { score: esc(o.score), count: open }) : t('docs.review_pill', { score: esc(o.score), count: open })}</span>` : ''}
          <span class="docs-pill${pending ? ' editing' : ' done'}" data-testid="doc-signoff-unreviewed">${pending === 1 ? t('docs.unreviewed_changes_one', { count: pending }) : t('docs.unreviewed_changes', { count: pending })}</span>
        </div>
        ${g.message ? `<p class="muted small docs-gate-message" title="${esc(g.message)}">${esc(g.message)}</p>` : ''}
        <div class="docs-signoff-fm">
          <b class="small">${spec ? t('docs.front_matter_after_sign_off') : t('docs.front_matter_after_acceptance')}</b>
          <code class="docs-signoff-fm-line" data-testid="doc-signoff-frontmatter">${fm}</code>
        </div>
        <div class="docs-signoff-next">${next.map(([title, help]) => `
          <div class="docs-next-card" data-testid="doc-signoff-next"><b>${title}</b><p class="muted small">${help}</p></div>`).join('')}</div>
        <div class="row docs-signoff-actions">
          <button type="button" class="btn primary" data-testid="doc-gate-accept" data-docs-gate="accept"${wait}>${spec ? t('docs.sign_off_spec') : t('docs.accept_intent')}</button>
          <button type="button" class="btn ghost" data-testid="doc-gate-revise" data-docs-gate="revise"${wait}>${t('docs.back_to_editing')}</button>
          <button type="button" class="btn ghost" data-testid="doc-gate-cancel" data-docs-stop${wait}>${t('docs.stop')}</button>
          <span class="spacer"></span>
          <span class="muted small mono">${t('docs.versions_count', { count: versionOf(o) })}</span>
        </div>
      </section>`; // i18n-ignore
  }

  function renderGate() {
    const o = docs.open;
    const box = $('#docs-gate');
    if (!o || !box) return;
    const status = o.data?.status;
    const g = o.gate;
    let html = '';
    // a request still in flight: its commit lands before the gate is answered
    const wait = o.requesting || o.answering ? ' disabled' : '';
    if (g?.edit) {
      html = ''; // #671: Send to review is the toolbar's
    } else if (g && yesNoGate(g)) {
      // merge_blocked: the local merge failed, a yes/no gate (try again, stop as failed)
      html = `
        <p class="muted small docs-gate-message" title="${esc(g.message || '')}">${esc(g.message || '')}</p>
        <button type="button" class="btn primary" data-testid="doc-gate-retry" data-docs-gate="yes"${wait}>${t('docs.retry_the_merge')}</button>
        <button type="button" class="btn ghost" data-testid="doc-gate-stop" data-docs-gate="no"${wait}>${t('docs.stop_as_failed')}</button>`;
    } else if (g) {
      html = signoffHtml(o, g, wait);
    } else if (o.doc === 'spec' && signedOff(status)) {
      html = `
        <button type="button" class="btn primary" data-docs-next="backlog">${t('docs.create_epic_and_phase_issues')}</button>
        <button type="button" class="btn" data-docs-next="roadmap">${t('docs.start_the_build')}</button>`;
    } else if (o.starting || o.runId) {
      html = `<p class="muted small" role="status"><span class="spinner" aria-hidden="true"></span> ${t('docs.the_writer_is_working')}</p>`;
    } else if (status !== acceptedStatus(o.doc)) {
      html = `<button type="button" class="btn primary" data-testid="docs-start-writer" data-docs-start>${t('docs.edit_with_the_writer')}</button>`;
    }
    box.innerHTML = html;
    renderToolbar();
    renderQueue();
    docs.chat?.refresh?.();
  }

  // a gate without choices answers true or false (merge_blocked); a gate restored without its
  // choices is the SDLC one only at the `approval` step
  function yesNoGate(g) {
    return Array.isArray(g.choices) ? !g.choices.length : g.step_id !== 'approval';
  }

  async function answerGate(choice) {
    const o = docs.open;
    const g = o?.gate;
    if (!g || o.answering || o.requesting) return;
    o.answering = true;
    try {
      const yesNo = yesNoGate(g);
      // the SDLC gate: the front matter changes and commits before the run hears accept
      if (choice === 'accept' && !yesNo) await api.acceptDoc(docs.projectId, o.item, o.doc, o.runId);
      await api.resolveApproval(g.approval_id, yesNo ? choice === 'yes' : choice, '', o.runId);
      if (o.gate === g) o.gate = null;
      await reload();
    } catch (e) { editorError(errMsg(e)); } finally { o.answering = false; }
  }

  // #671 Stop at the sign-off gate: the run stops after a confirmation (nothing is signed off)
  async function stopRun() {
    const o = docs.open;
    if (!o?.runId) return;
    if (!(await confirmDialog(t('docs.stop_the_run'), t('docs.stop_the_run_message'), t('docs.stop')))) return;
    try { await api.stopRun(o.runId); } catch (e) { editorError(errMsg(e)); }
  }

  function onTocClick(id) {
    const o = docs.open;
    if (id === 'source') { o.source = !o.source; renderToc(); renderReader(); return; }
    if (o.source) { o.source = false; renderToc(); renderReader(); }
    $('#docs-reader')?.contentDocument?.getElementById(id)?.scrollIntoView({ block: 'start' });
  }

  function onEditorClick(e) {
    const el = (sel) => e.target.closest(sel);
    const o = docs.open;
    if (el('[data-docs-back]')) return closeDoc();
    if (el('[data-docs-unselect]')) { o.selection = null; renderChip(); return docs.chat?.refresh?.(); }
    const undo = el('[data-docs-undo]');
    if (undo) return undoChange(undo.dataset.docsUndo);
    const reviewed = el('[data-docs-reviewed]');
    if (reviewed) return markReviewed(reviewed.dataset.docsReviewed);
    const gate = el('[data-docs-gate]');
    if (gate) return answerGate(gate.dataset.docsGate);
    if (el('[data-docs-stop]')) return stopRun();
    if (el('[data-docs-start]')) return startWriter();
    const next = el('[data-docs-next]');
    if (next?.dataset.docsNext === 'backlog') return proposeIssues(o.item);
    if (next) return showView(next.dataset.docsNext);
    const tab = el('[data-docs-tab]');
    if (tab) { o.tab = tab.dataset.docsTab; o.selection = o.tab === 'edit' ? o.selection : null; renderToolbar(); renderReader(); renderChip(); return docs.chat?.refresh?.(); }
    const lang = el('[data-docs-lang]');
    if (lang) { o.lang = lang.dataset.docsLang; renderToolbar(); renderToc(); return renderReader(); }
    const toc = el('[data-docs-toc]');
    if (toc) return onTocClick(toc.dataset.docsToc);
    const step = el('[data-docs-step-open]');
    if (step) {
      const it = docs.items.find((i) => i.item === o.item);
      const doc = step.dataset.docsStepOpen;
      return openDoc(o.item, doc, it?.runId && it.runDoc === doc ? it.runId : null);
    }
    const mode = el('[data-docs-mode]');
    if (mode) { o.mode = mode.dataset.docsMode === 'queue' ? 'queue' : 'now'; syncMode(); return docs.chat?.refresh?.(); }
    if (el('[data-docs-attach]')) return $('#docs-attach-file')?.click();
    if (el('[data-docs-queue-apply]')) return applyQueue();
    const qr = el('[data-docs-queue-remove]');
    if (qr) { o.queue = o.queue.filter((_, i) => i !== Number(qr.dataset.docsQueueRemove)); return renderQueue(); }
    for (const action of ['apply', 'edit', 'dismiss']) {
      const note = el(`[data-docs-note-${action}]`);
      if (note) return onNote(action, Number(note.getAttribute(`data-docs-note-${action}`)));
    }
    const change = el('[data-docs-change]');
    if (change) { o.changeOpen = change.dataset.docsChange; return renderChanges(); }
    return undefined;
  }

  // ---- the run's events ---------------------------------------------------------------------------
  async function onRunEvent(ev) {
    const o = docs.open;
    if (!o || !ev) return;
    if (o.starting && !o.runId) { docs.early.push(ev); return; }
    if (ev.run_id !== o.runId) return;
    if (ev.type === 'step.finished' && ev.step_id === 'draft') {
      // the service wrote the draft into the run's worktree (channels/docs.js): read it again
      if (ev.output?.reply) o.messages = [...o.messages, { role: 'agent', text: ev.output.reply }];
      docs.chat?.setMessages(o.messages);
      await reload();
    } else if (ev.type === 'step.started' && !o.data) {
      await reload(); // the new document's skeleton, written at the run's first step
    } else if (ev.type === 'step.finished' && ev.step_id === 'review' && ev.output) {
      o.notes = Array.isArray(ev.output.notes) ? ev.output.notes : [];
      o.checks = Array.isArray(ev.output.checks) ? ev.output.checks : [];
      o.score = ev.output.score;
      renderNotes();
      renderToc();
    } else if (ev.type === 'approval.requested') {
      o.gate = ev;
      renderGate();
      renderHead();
      // the review notes applied at the approval gate: sent now that the writer waits again
      if (ev.edit && o.pendingNotes.length) {
        const list = o.pendingNotes;
        o.pendingNotes = [];
        for (const n of list) await applyNote(n);
      }
    } else if (ev.type === 'approval.resolved') {
      if (o.gate?.approval_id === ev.approval_id) o.gate = null;
      renderGate();
    } else if (['workflow.finished', 'run.finished', 'run.failed', 'run.cancelled'].includes(ev.type)) {
      o.runId = null;
      o.gate = null;
      await reload();
    }
  }

  // #671 the writer panel of mock-2: the selection above the text box, Apply now or Queue and
  // Attach image beside Send
  function mountChat() {
    if (!window.AgentChat?.create) return;
    docs.chat = window.AgentChat.create($('#docs-chat'), {
      agent: t('docs.writer'),
      agentId: 'writer',
      placeholder: t('docs.say_what_to_change'),
      pasteImages: true,
      classes: { form: 'docs-chat-form' },
      send: (text, attachments) => sendRequest(text, attachments),
      canSend: () => !!(docs.open?.selection && !docs.open.answering && (docs.open.mode === 'queue' ? docs.open.data : docs.open.gate?.edit)),
      inputEnabled: () => !!(docs.open?.mode === 'queue' ? docs.open?.data : docs.open?.gate?.edit),
      emptyHtml: () => `<p class="muted small">${t('docs.the_writer_answers_here')}</p>`,
    });
    const compose = docs.chat.slot?.('compose');
    if (compose) compose.innerHTML = '<div id="docs-chip" class="docs-chip-box"></div><div id="docs-queue" class="docs-queue"></div>'; // i18n-ignore
    const actions = docs.chat.slot?.('actions');
    if (actions) {
      actions.innerHTML = `
        <div class="seg sm docs-mode" role="group" aria-label="${t('docs.when_to_apply')}">
          <button type="button" id="docs-mode-now" class="active" aria-pressed="true" data-testid="doc-apply-now" data-docs-mode="now">${t('docs.apply_now')}</button>
          <button type="button" id="docs-mode-queue" aria-pressed="false" data-testid="doc-queue" data-docs-mode="queue">${t('docs.queue')}</button>
        </div>
        <button type="button" class="btn sm ghost" data-testid="doc-attach-image" data-docs-attach>${t('docs.attach_image')}</button>
        <input type="file" id="docs-attach-file" class="hidden" accept="image/*" multiple tabindex="-1" aria-hidden="true" />`;
      $('#docs-attach-file')?.addEventListener('change', (e) => { attachImages(e.target.files); e.target.value = ''; });
    }
  }

  // One document open in the editor, and a write-doc run followed from its events so far (the
  // screenshot seed's review state, scripts/screenshot/views/docs.js; a run resumed elsewhere).
  window.DocsActions = {
    openDoc: async (item, doc) => { showView('docs'); await openDoc(item, doc, null); },
    follow: async (runId, events = []) => {
      if (!docs.open) return;
      docs.open.runId = runId;
      for (const ev of events) await onRunEvent({ run_id: runId, ...ev });
    },
  };

  // #649 "Write a document" on a Discovery card (views/discovery/discovery.js): the writer on a new
  // intent named after the card, opened in this editor; the run is the card's (DiscoveryRuns), so its
  // document comes back to the card as a version and an attachment when it ends → the run id
  window.writeDocForCard = async ({ projectId, cardId, title }) => {
    const item = slugOf(title) || 'card';
    const folder = (state.projects || []).find((p) => p.id === projectId)?.folder || null;
    const out = await runWriter(projectId, folder, { item, doc: 'intent', title });
    window.DiscoveryRuns?.started(out.runId, { projectId, cardId, source: 'write-doc', item, doc: 'intent' });
    // the editor follows the card's project, the header too (openDoc reads it)
    if (projectId && window.CurrentProject?.get() !== projectId) window.CurrentProject?.set?.(projectId, { redraw: false });
    docs.projectId = projectId || docs.projectId;
    showView('docs');
    await openDoc(item, 'intent', out.runId, { creating: true, projectId });
    if (docs.open) docs.open.title = title;
    return out.runId;
  };

  registerView({
    id: 'docs',
    nav: {
      label: 'Documents', order: 112, group: 'plan', title: 'Write the intent and the spec of a work item with the writer',
      icon: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" /><path d="M14 3v6h6" /><path d="M8 13h8M8 17h5" /></svg>',
    },
    markup: () => `
      <section id="view-docs" class="view hidden">
        <div id="docs-list-area" class="docs-list-area">
          <div class="docs-list-main">
            <div class="page-head">
              <div>
                <h1>${t('docs.documents')}</h1>
                <p class="muted small">${t('docs.proposals_rfcs_and_prds')}</p>
              </div>
              <button type="button" id="btn-docs-new" class="btn primary" data-testid="docs-new-item">${t('docs.new_item')}</button>
            </div>
            <p id="docs-list-error" class="error small"></p>
            <div id="docs-list" class="docs-list" data-testid="docs-list"></div>
          </div>
          <aside id="docs-new-panel" class="docs-new-panel hidden" data-testid="docs-new-panel" aria-labelledby="docs-new-heading">
            <form id="docs-new-form" class="docs-new-form">
              <div class="docs-new-head">
                <h2 id="docs-new-heading">${t('docs.new_item')}</h2>
                <button type="button" id="btn-docs-new-close" class="docs-chip-x" aria-label="${t('common.close')}" title="${t('common.close')}">×</button>
              </div>
              <div class="field">
                <label for="docs-new-starts">${t('docs.starts_with')}</label>
                <select id="docs-new-starts" data-testid="docs-new-starts-with">
                  ${SDLC.filter((s) => s.doc).map((s) => `<option value="${s.doc}">${s.file} (${s.name()})</option>`).join('')}
                </select>
              </div>
              <div class="field">
                <label for="docs-new-title">${t('docs.what_it_is_about')}</label>
                <textarea id="docs-new-title" data-testid="docs-new-item-title" rows="3" maxlength="200" placeholder="${t('docs.what_the_item_is_about')}"></textarea>
              </div>
              <div class="field">
                <span class="docs-new-label">${t('docs.screens_to_capture_first')}</span>
                <div class="docs-new-screens" data-testid="docs-new-screens">
                  <button type="button" class="chip" data-testid="docs-new-screen-add" disabled title="${t('docs.later_phase')}">${t('docs.add_screen')}</button>
                </div>
              </div>
              <label class="docs-new-writers" title="${t('docs.later_phase')}">
                <input type="checkbox" data-testid="docs-new-writers" disabled />
                <span><b>${t('docs.several_writers')}</b><span class="muted small">${t('docs.several_writers_help')}</span></span>
              </label>
              <p id="docs-new-error" class="error small"></p>
              <div class="docs-new-foot">
                <span id="docs-new-estimate" class="mono muted small" data-testid="docs-new-estimate">${estimateText('intent')}</span>
                <span class="spacer"></span>
                <button type="submit" class="btn primary" data-testid="docs-new-item-start">${t('docs.start')}</button>
              </div>
            </form>
          </aside>
        </div>
        <div id="docs-editor-area" class="hidden">
          <div id="docs-editor" class="docs-editor" data-testid="doc-editor" data-stage="intent">
            <div id="docs-editor-head" class="docs-editor-head"></div>
            <p id="docs-editor-error" class="error small"></p>
            <div id="docs-gate" class="row docs-gate" role="group" aria-label="${t('docs.next_step')}"></div>
            <div id="docs-editor-body" class="docs-editor-body">
              <div class="docs-left">
                <div id="docs-toc-box" class="docs-toc-box"></div>
                <section id="docs-changes" class="docs-changes" data-testid="doc-changes"></section>
              </div>
              <div id="docs-toolbar-box" class="docs-toolbar-box"></div>
              <iframe id="docs-reader" class="docs-reader" sandbox="allow-same-origin" title="${t('docs.the_document')}"></iframe>
              <aside class="docs-side">
                <section id="docs-notes" class="docs-notes hidden"></section>
                <section class="docs-writer" data-testid="doc-writer-panel">
                  <div class="docs-section-head"><h3>${t('docs.writer')}</h3></div>
                  <div id="docs-chat" class="docs-chat"></div>
                </section>
              </aside>
            </div>
          </div>
        </div>
      </section>`,
    mount() {
      $('#btn-docs-new').onclick = openNewItem;
      $('#docs-list').onclick = onListClick;
      $('#docs-new-form').onsubmit = submitNewItem;
      $('#btn-docs-new-close').onclick = closeNewItem;
      $('#docs-new-starts').onchange = (e) => { $('#docs-new-estimate').textContent = estimateText(e.target.value); };
      $('#docs-editor').addEventListener('click', onEditorClick);
      // the page has no script of its own: the selection is read from here
      $('#docs-reader').addEventListener('load', () => {
        const doc = $('#docs-reader').contentDocument;
        doc?.addEventListener('mouseup', () => setTimeout(onReaderSelect, 0));
        doc?.addEventListener('keyup', () => onReaderSelect());
      });
      document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && state.view === 'docs' && !$('#docs-new-panel').classList.contains('hidden')) closeNewItem();
      });
      mountChat();
      api.onEvent?.((ev) => { onRunEvent(ev); });
    },
    show: () => (docs.open ? reload() : refresh()),
  });
})();
