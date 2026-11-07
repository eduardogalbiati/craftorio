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
// before that click. A Discovery card's Write a document (#649) and a Backlog issue's Enrich (#648) start their writer here too (writeDocForCard).
// #671 the screens follow the spec's mockups (docs/work/write-doc/images/): the list rows show their
// SDLC stage chain and the pill of their latest document, New item is a side panel (mock-1); the
// editor has the item's six SDLC steps, the contents with each requirement, the toolbar (Edit / Diff /
// Preview, EN / PT, Versions, Send to review) and the writer panel (Apply now or Queue, Attach image)
// (living-doc, mock-2); each change by request is a versioned card whose detail holds Undo this change
// and Mark reviewed (mock-3); the review shows its score, its rubric checks and the anchored notes with
// Apply / Edit / Dismiss (mock-4); the approval gate is the sign-off panel (mock-5). Several writers is
// write-doc's Arena mode (#648); Screens to capture first (captures, phase 3) is shown disabled. The New item
// panel, the toolbar, the review and the sign-off markup live in docs-panels.js (DocsPanels); the Diff tab's page of a
// change (its touched sections, docs:read-at) in docs-diff.js (DocsDiff); the sections with their
// anchors and the reader's page in docs-page.js (DocsPage); the SDLC steps and the list's rows in
// docs-list.js (DocsList).
// #650 (spec R16) the list has two tabs: Items and Intents (docs:intents, every docs/work/<item>/intent.md
// with its status and its link back to the maintain.md that opened it); a draft intent opens with its
// writer. The Maintain step reads the item's maintain.md (the incidents the Monitor and the Night watch
// record, the post-mortems) and never starts a writer; the document's mocks run in an opaque-origin
// iframe (DocsPage.mockFrame: sandbox allow-scripts, a CSP without network).
// Registers itself with registerView (view-registry.js); uses app.js globals ($, esc, state, api,
// errMsg, openModal, closeModal, showToast, showView, confirmDialog), markdownHtml (artifact-render.js),
// DocModel (packages/shared/doc-model.js), CurrentProject and AgentChat.
(() => {
  const FILE = 'write-doc.yaml';
  const slugOf = (title) => window.DocModel.itemName(title); // read when called: the module may load later
  const { SDLC, acceptedStatus, docFile, fileName, signedOff, statusBadge, statusLabel, stepOfDoc } = window.DocsList;
  const WRITTEN = SDLC.filter((s) => s.doc && s.doc !== 'maintain'); // the documents New item can start
  // the spec's cost estimates of a first draft (spec.md, Points of attention › Cost)
  const ESTIMATES = { intent: '$0.30–1.00', spec: '$1.00–3.00' };

  // open: the document in the editor { item, doc, data (docs:read), runId, base (the commit the
  // run started from, docs:changes'), gate (the run's waiting approval.requested), changes,
  // unreviewed, notes and checks (the reviewer's), messages, selection, requesting (a request in
  // flight), tab (edit | diff | preview), lang (en | pt), source (the markdown shown), mode (now |
  // queue), queue (the queued requests), pendingNotes (applied at the next edit gate), changeOpen }
  // #650 view: the list's tab (items | intents), intents: docs:intents' rows
  const docs = { projectId: null, items: [], intents: [], view: 'items', seq: 0, open: null, chat: null, busy: false, early: [] };

  const projectFolder = () => (state.projects || []).find((p) => p.id === docs.projectId)?.folder || null;
  const listError = (msg) => { $('#docs-list-error').textContent = msg || ''; };
  const editorError = (msg) => { const p = $('#docs-editor-error'); if (p) p.textContent = msg || ''; };

  // #671 the header's project, also before the app's start has listed the projects
  const currentProjectId = async () => (await (window.CurrentProject?.resolve?.() ?? window.CurrentProject?.get?.())) || null;

  // ---- the list ---------------------------------------------------------------------------------
  async function refresh() {
    const seq = ++docs.seq;
    docs.projectId = await currentProjectId();
    let items = [];
    let intents = [];
    let error = '';
    if (docs.projectId) {
      try {
        [items, intents] = await Promise.all([api.listDocItems(docs.projectId), api.listDocIntents?.(docs.projectId) ?? []]);
      } catch (e) { error = errMsg(e); }
    }
    if (seq !== docs.seq) return; // a newer refresh answers
    docs.items = items || [];
    docs.intents = Array.isArray(intents) ? intents : [];
    listError(error);
    renderList();
    const box = $('#docs-intents');
    if (box) box.innerHTML = DocsList.intentsHtml(docs.intents, docs.projectId);
    DocsList.applyView(docs.view);
  }

  // #650 a draft intent opens with the writer (its review and its Accept gate: the intent is validated
  // there); one a write-doc run has opens with that run
  async function openIntent(item) {
    if (docs.busy) return;
    const row = docs.intents.find((i) => i.item === item);
    const it = docs.items.find((i) => i.item === item);
    const runId = it?.runId && it.runDoc === 'intent' ? it.runId : null;
    docs.busy = true;
    try {
      await openDoc(item, 'intent', runId);
      const o = docs.open;
      if (!o || o.item !== item) return;
      o.title = row?.title || it?.title || item;
      // validating a draft is the writer's review and Accept gate: the toast says a run started
      if (!runId && (o.data?.status || row?.status) === 'draft') {
        await startWriter();
        if (docs.open === o && o.runId) showToast(t('docs.writer_started_for_intent'), o.title);
      }
    } catch (e) {
      editorError(errMsg(e));
    } finally { docs.busy = false; }
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
    $('#docs-list').innerHTML = DocsList.itemsHtml(docs.items, docs.projectId);
  }

  function onListClick(e) {
    const write = e.target.closest('[data-docs-write-spec], [data-docs-write-plan]');
    if (write) return startDoc(write.dataset.item, 'docsWritePlan' in write.dataset ? 'plan' : 'spec', null);
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
    DocsPanels.newItemWriters(false);
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
    await startDoc(item, doc, title, DocsPanels.newItemWriters());
  }

  // A new document: its write-doc run creates the skeleton in the run's worktree, drafts and edits it; `writers`: Arena mode (#648)
  async function startDoc(item, doc, title, writers = null) {
    if (docs.busy) return;
    docs.busy = true;
    listError('');
    try {
      // creating: its run writes the skeleton, the first read has nothing yet
      await openDoc(item, doc, null, { creating: true });
      Object.assign(docs.open, { title: title || item, writers });
      await startWriter();
      refresh();
    } catch (e) {
      listError(errMsg(e));
    } finally { docs.busy = false; }
  }

  // The write-doc run of a document → its startRun answer { runId }; folder: the project's (none: left out)
  async function runWriter(projectId, folder, { item, doc, title, writers, prompt, issue }) {
    const inputs = { ...(folder ? { project_path: folder } : {}), item, document: doc, title: title || item, ...(writers ? { writers } : {}), ...(prompt ? { prompt } : {}) };
    // the run starts from and merges into the project's default branch (main, master, develop…)
    const hints = await api.projectInputHints?.(projectId).catch(() => null);
    if (hints?.defaultBranch) inputs.base_branch = hints.defaultBranch; // an issue's run records it (run.issues)
    // #805 baseChoice: this screen does not ask about a local base behind origin: a toast and the run's log say it
    const payload = { file: FILE, inputs, mock: !!state.simulationOnly, projectId, baseChoice: 'continue', ...(issue ? { issues: [issue] } : {}) };
    const out = await api.startRun(payload); // an ended run of the issue kept commits (#112, #170): from scratch or nothing (null)
    const run = !out?.kept ? out : (await keptWorkDialog(out.kept) === 'scratch' ? await api.startRun({ ...payload, confirmed: true }) : null);
    if (run?.baseCheck) baseStartedToast(run.baseCheck);
    return run;
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
      if (docs.open !== o || !out) return; // no out: the owner kept the ended run's work
      o.runId = out.runId;
      const early = docs.early.splice(0).filter((ev) => ev.run_id === o.runId); // first events may come before startRun answers
      for (const ev of early) await onRunEvent(ev);
    } catch (e) {
      editorError(errMsg(e));
    } finally { o.starting = false; o.creating = false; }
    renderGate();
  }

  // ---- the editor ---------------------------------------------------------------------------------
  // runId: the write-doc run in progress on this document (the list's), its waiting gate found again
  async function openDoc(item, doc, runId, { creating = false, projectId = null } = {}) {
    docs.projectId = projectId || (await currentProjectId()) || docs.projectId;
    // opened before the list was read (DocsActions); the writer panel drawn in the saved language
    if (!docs.items.length && docs.projectId) docs.items = (await api.listDocItems(docs.projectId).catch(() => [])) || [];
    if (!docs.chat) mountChat();
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
    const has = (doc) => doc && (doc === 'maintain' ? !!it?.maintain : (it?.docs || []).some((d) => d.doc === doc));
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
  // the sections of the document with their anchors (docs-page.js)
  const outline = (md, doc) => DocsPage.outline(md, doc);

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
    // #696 Send to review is disabled until the edit gate is open and while a request's commit is pending
    box.innerHTML = window.DocsPanels.toolbar({ tab: o.tab, lang: o.lang, translation: !!o.data?.translation, wait: !o.gate?.edit || !!o.requesting || !!o.answering });
    $('#docs-editor-body')?.classList.toggle('docs-mode-diff', o.tab === 'diff');
  }

  // the reader's page (docs-page.js), in a sandboxed iframe without scripts
  function renderReader() {
    const frame = $('#docs-reader');
    const o = docs.open;
    if (!frame || !o) return;
    frame.srcdoc = DocsPage.html(shownMarkdown(o), { doc: o.doc, kicker: `${stepName(o.doc)} · ${docFile(o.doc)} · v${versionOf(o)}`, preview: o.tab === 'preview', source: o.source }); // i18n-ignore
    renderMocks();
  }

  // #650 the document's ```html mock blocks, each running in its own opaque-origin frame (DocsPage.mockFrame)
  function renderMocks() {
    const box = $('#docs-mocks');
    const o = docs.open;
    if (!box || !o) return;
    const list = o.source ? [] : DocsPage.mocks(shownMarkdown(o));
    box.classList.toggle('hidden', !list.length);
    DocsPage.mountMocks(box, list.length
      ? `<div class="docs-section-head"><h3>${t('docs.mocks')}</h3><span class="muted small">${t('docs.mocks_help')}</span></div>${list.map((m) => DocsPage.mockFrame(m.html, { title: t('docs.mock_title', { title: m.title }) })).join('')}`
      : '');
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
          ${q.error ? `<span class="error small docs-queue-error" title="${esc(q.error)}">${esc(q.error)}</span>` : ''}
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

  // A request sent without the text box (a queued one, a review note), drawn in the writer's chat;
  // its answer ({ ok: false, error } on a failure) says whether it was applied
  async function sendFromView(text, attachments) {
    const o = docs.open;
    docs.chat?.update?.({ busy: true });
    const res = await sendRequest(text, attachments);
    docs.chat?.update?.({ busy: false, messages: o.messages, error: res?.ok === false ? res.error : '' });
    return res;
  }

  // The queued requests sent one by one, from the end of the document up, so that each request's
  // lines are still where its selection found them; one that fails stays queued with its error
  async function applyQueue() {
    const o = docs.open;
    if (!o?.gate?.edit) return;
    o.mode = 'now';
    const start = (q) => Number(String(q.selection?.src || '0').split('-')[0]);
    const list = [...o.queue].sort((a, b) => start(b) - start(a));
    for (const q of list) {
      if (docs.open !== o || !o.gate?.edit) break;
      o.selection = q.selection;
      const res = await sendFromView(q.text, q.attachments);
      if (res?.ok === false) q.error = res.error;
      else o.queue = o.queue.filter((x) => x !== q);
    }
    o.selection = null;
    renderChip();
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
  // the change whose page is open: the one clicked, else the newest unreviewed one, else the newest
  function openChange(o) {
    const list = liveChanges(o);
    return list.find((c) => c.commit === o.changeOpen) || [...list].reverse().find((c) => o.unreviewed.includes(c.commit)) || list[list.length - 1] || null;
  }

  function renderChanges() {
    const o = docs.open;
    const box = $('#docs-changes');
    if (!o || !box) return;
    box.innerHTML = DocsDiff.cards({ list: liveChanges(o), open: openChange(o), unreviewed: o.unreviewed, problems: o.problems });
    renderDiff();
  }

  // The Diff tab's page (mock-3): the open change's head and actions, the sections it touched (read
  // at the change and its parent, docs:read-at, once per change) and the footnote
  function renderDiff() {
    const o = docs.open;
    const box = $('#docs-diff');
    if (!o || !box) return;
    const c = openChange(o);
    if (!c) { box.innerHTML = `<p class="muted small">${t('docs.no_change_yet')}</p>`; return; }
    o.diffs = o.diffs || {};
    if (o.tab === 'diff' && !o.diffs[c.commit] && api.readDocAt) {
      o.diffs[c.commit] = { loading: true };
      api.readDocAt(docs.projectId, o.item, o.doc, c.commit, o.runId).then(
        (r) => ({ sections: DocsDiff.compare(r.before, r.after) }),
        (e) => ({ error: errMsg(e) }),
      ).then((d) => { o.diffs[c.commit] = d; if (docs.open === o) renderDiff(); });
    }
    const v = liveChanges(o).indexOf(c) + 2;
    box.innerHTML = DocsDiff.panel({
      doc: o.doc,
      from: v - 1,
      to: v,
      file: fileName((c.files || []).find((f) => /\.md$/.test(f) && !/\.pt-BR\.md$/.test(f)) || docFile(o.doc)),
      subject: c.subject,
      commit: c.commit,
      canUndo: !!o.runId,
      unreviewed: o.unreviewed.includes(c.commit),
      diff: o.diffs[c.commit],
    });
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
    const html = DocsPanels.review({ score: o.score, checks: o.checks, notes: o.notes, key: noteKey, canApply: !!o.runId });
    box.classList.toggle('hidden', !html);
    box.innerHTML = html;
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

  // the list of notes redrawn, and the sign-off's open notes pill with it
  function notesChanged() {
    renderNotes();
    renderToc();
    if (docs.open?.gate) renderGate();
  }

  // Apply: the note as a request (at the approval gate, back to editing first: the note stays, queued,
  // until the writer has answered it); Edit: the note in the text box to rework; Dismiss: the note
  // leaves the list
  async function onNote(action, i) {
    const o = docs.open;
    const n = o?.notes[i];
    if (!n || n.queued) return;
    if (action === 'apply') {
      if (o.gate?.edit) return applyNote(n);
      if (!o.runId) return undefined;
      n.queued = true;
      o.pendingNotes.push(n);
      notesChanged();
      if (o.gate && !yesNoGate(o.gate)) await answerGate('revise');
      return undefined;
    }
    o.notes = o.notes.filter((x) => x !== n);
    if (action === 'edit') {
      o.selection = noteSelection(n);
      if (docs.chat?.input) docs.chat.input.value = n.text;
      renderChip();
      if (o.gate && !o.gate.edit && !yesNoGate(o.gate)) await answerGate('revise');
    }
    return notesChanged();
  }

  // a note sent as a request: it leaves the list once the writer's change is in, else it stays with the error
  async function applyNote(n) {
    const o = docs.open;
    o.mode = 'now';
    o.selection = noteSelection(n);
    renderChip();
    const res = await sendFromView(noteRequest(n));
    n.queued = false;
    if (res?.ok === false) editorError(res.error);
    else o.notes = o.notes.filter((x) => x !== n);
    notesChanged();
  }

  // ---- the gates ----------------------------------------------------------------------------------
  // #671 the sign-off panel of mock-5: the review and unreviewed pills, the front matter the gate
  // writes, the next steps (nothing starts before their own click) and its three answers
  function signoffHtml(o, g, wait) {
    return DocsPanels.signoff({
      doc: o.doc,
      file: docFile(o.doc),
      from: o.data?.status,
      to: acceptedStatus(o.doc),
      score: o.score,
      open: o.notes.length,
      pending: liveChanges(o).filter((c) => o.unreviewed.includes(c.commit)).length,
      message: g.message,
      versions: versionOf(o),
      wait,
    });
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
    } else if (o.doc === 'maintain') {
      html = ''; // #650 the Monitor and the Night watch write it, no writer run
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
    if (tab) { o.tab = tab.dataset.docsTab; o.selection = o.tab === 'edit' ? o.selection : null; renderToolbar(); renderReader(); renderDiff(); renderChip(); return docs.chat?.refresh?.(); }
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
    if (change) { o.changeOpen = change.dataset.docsChange; o.tab = 'diff'; o.selection = null; renderToolbar(); renderChip(); return renderChanges(); }
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

  // #671 the writer panel of mock-2: the selection, Apply now or Queue and Attach image beside Send
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

  // #649 "Write a document" on a Discovery card (views/discovery/discovery.js): the writer on a new intent named after the
  // card, in this editor; the run is the card's (DiscoveryRuns), its document comes back as a version → the run id.
  // #648 Enrich on a Backlog issue (views/backlog/backlog.js, `issue` { number, url, title }, `prompt`): the issue's spec
  window.writeDocForCard = async ({ projectId, cardId, title, issue = null, prompt = '' }) => {
    const item = slugOf(issue ? `issue-${issue.number}-${title}` : title) || 'card', doc = issue ? 'spec' : 'intent';
    const folder = (state.projects || []).find((p) => p.id === projectId)?.folder || null;
    const out = await runWriter(projectId, folder, { item, doc, title, prompt, issue });
    if (!out?.runId) return null; // the owner kept the ended run's work: no writer, no editor
    if (cardId) window.DiscoveryRuns?.started(out.runId, { projectId, cardId, source: 'write-doc', item, doc });
    if (projectId && window.CurrentProject?.get() !== projectId) window.CurrentProject?.set?.(projectId, { redraw: false }); // the header follows
    docs.projectId = projectId || docs.projectId;
    showView('docs');
    await openDoc(item, doc, out.runId, { creating: true, projectId });
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
            ${DocsList.tabsHtml()}
            <p id="docs-list-error" class="error small"></p>
            <div id="docs-list" class="docs-list" data-testid="docs-list" role="tabpanel"></div>
            <div id="docs-intents" class="docs-list hidden" data-testid="docs-intents" role="tabpanel"></div>
          </div>
          ${DocsPanels.newItemPanel(WRITTEN, estimateText('intent'))}
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
              <section id="docs-diff" class="docs-diff" data-testid="doc-diff" aria-label="${t('docs.diff')}"></section>
              <section id="docs-mocks" class="docs-mocks hidden" data-testid="doc-mocks" aria-label="${t('docs.mocks')}"></section>
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
      $('#docs-intents').onclick = (e) => { const row = e.target.closest('[data-docs-intent]'); if (row) openIntent(row.dataset.docsIntent); };
      $('#docs-views').onclick = (e) => {
        const tab = e.target.closest('[data-docs-view]');
        if (!tab) return;
        docs.view = tab.dataset.docsView === 'intents' ? 'intents' : 'items';
        DocsList.applyView(docs.view);
      };
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
      api.onEvent?.((ev) => { onRunEvent(ev); });
    },
    // the menu's Documents entry goes back to the list (with its Items/Intents tabs) from an open document
    fromMenu() {
      if (!docs.open) return;
      docs.open = null;
      $('#docs-editor-area').classList.add('hidden');
      $('#docs-list-area').classList.remove('hidden');
    },
    show: () => (docs.open ? reload() : refresh()),
  });
})();
