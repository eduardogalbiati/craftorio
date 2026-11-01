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
// Registers itself with registerView (view-registry.js); uses app.js globals ($, esc, state, api,
// errMsg, openModal, closeModal, showToast, showView), markdownHtml (artifact-render.js), DocModel
// (packages/shared/doc-model.js), CurrentProject and AgentChat.
(() => {
  const FILE = 'write-doc.yaml';
  const slugOf = (title) => String(title).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 100);
  // the status past the SDLC gate (DocModel.ACCEPTED), read when drawn: the module may load later
  const acceptedStatus = (doc) => window.DocModel?.ACCEPTED?.[doc];

  // open: the document in the editor { item, doc, data (docs:read), runId, base (the commit the
  // run started from, docs:changes'), gate (the run's waiting approval.requested), changes,
  // unreviewed, notes (the reviewer's), messages, selection, requesting (a request in flight) }
  const docs = { projectId: null, items: [], seq: 0, open: null, chat: null, busy: false, early: [] };

  const docLabel = (doc) => (doc === 'spec' ? t('docs.spec') : t('docs.intent'));
  function statusLabel(status) {
    if (status === 'accepted') return t('docs.status_accepted');
    if (status === 'signed off') return t('docs.status_signed_off');
    if (status === 'draft') return t('docs.status_draft');
    return esc(status || '');
  }
  const statusBadge = (status, testid = '') => `<span class="badge${status === 'draft' ? '' : ' docs-done'}"${testid ? ` data-testid="${testid}"` : ''}>${statusLabel(status)}</span>`;
  const projectFolder = () => (state.projects || []).find((p) => p.id === docs.projectId)?.folder || null;
  const listError = (msg) => { $('#docs-list-error').textContent = msg || ''; };
  const editorError = (msg) => { const p = $('#docs-editor-error'); if (p) p.textContent = msg || ''; };

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
        <div class="docs-item-main">
          <b class="docs-item-title" title="${esc(it.title || it.item)}">${esc(it.title || it.item)}</b>
          <span class="docs-item-meta muted small">
            ${it.title ? `<span class="mono" title="${esc(`docs/work/${it.item}`)}">${esc(it.item)}</span>` : ''}
            <span class="badge" title="${t('docs.the_item_s_stage')}">${esc(it.stage || '')}</span>
            ${it.docs.map((d) => `<span class="docs-item-doc" title="${esc(d.file)}">${docLabel(d.doc)} ${statusBadge(d.status)}</span>`).join('')}
          </span>
        </div>
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

  // ---- New item ---------------------------------------------------------------------------------
  function openNewItem() {
    $('#docs-new-title').value = '';
    $('#docs-new-error').textContent = '';
    openModal('#docs-new-modal');
    $('#docs-new-title').focus({ preventScroll: true });
  }

  async function submitNewItem(e) {
    e.preventDefault();
    const title = String($('#docs-new-title').value || '').trim();
    const item = slugOf(title);
    if (!docs.projectId) { $('#docs-new-error').textContent = t('docs.choose_a_project_in_the_header'); return; }
    if (!item) { $('#docs-new-error').textContent = t('docs.give_the_item_a_title'); return; }
    if (docs.items.some((it) => it.item === item)) { $('#docs-new-error').textContent = t('docs.an_item_with_this_name_exists', { item }); return; }
    closeModal('#docs-new-modal');
    await startDoc(item, 'intent', title);
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
    docs.open = { item, doc, data: null, runId: runId || null, creating, base: null, gate: null, changes: [], unreviewed: [], notes: [], messages: [], selection: null, problems: [] };
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
    } catch (e) { editorError(errMsg(e)); }
    renderEditor();
  }

  function renderEditor() {
    const o = docs.open;
    if (!o) return;
    const status = o.data?.status || 'draft';
    $('#docs-editor-head').innerHTML = `
      <button type="button" class="btn sm ghost" data-docs-back>${t('docs.back_to_the_list')}</button>
      <h2 class="docs-editor-title" title="${esc(o.data?.source?.file || '')}">${esc(o.item)} <span class="muted">· ${docLabel(o.doc)}</span></h2>
      ${statusBadge(status, 'doc-status')}
      <span class="mono muted small" title="${esc(o.data?.source?.file || '')}">${esc(o.data?.source?.file || '')}</span>`;
    renderReader();
    renderChip();
    renderChanges();
    renderNotes();
    renderGate();
  }

  // The reader's page: the body's blocks as siblings, each with data-src="<start>-<end>" (its lines in
  // the source), headings without their #; no script runs in it (sandbox without allow-scripts).
  function readerHtml(md) {
    const rows = String(md || '').split('\n');
    const body = (window.DocModel ? window.DocModel.blocks(md || '') : []).map((b) => {
      const src = `${b.start}-${b.end}`;
      if (b.heading !== null) {
        const level = Math.min(6, (rows[b.start - 1].match(/^#+/) || ['##'])[0].length);
        return `<h${level} data-src="${src}">${esc(b.heading)}</h${level}>`;
      }
      const text = rows.slice(b.start - 1, b.end).join('\n');
      return `<div class="blk" data-src="${src}">${typeof markdownHtml === 'function' ? markdownHtml(text) : esc(text)}</div>`;
    }).join('\n');
    let css = '';
    try {
      const v = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
      css = `body{background:${v('--panel')};color:${v('--text')};font:13px/1.55 system-ui,sans-serif;margin:16px 20px;max-width:760px}h1,h2,h3{margin:18px 0 6px}.blk>*{margin:0 0 8px}code{font-family:${v('--mono')}}::selection{background:${v('--accent')};color:${v('--bg')}}`; // i18n-ignore
    } catch { /* the default look */ }
    return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:"><style>${css}</style></head><body>${body}</body></html>`; // i18n-ignore
  }

  function renderReader() {
    const frame = $('#docs-reader');
    if (!frame) return;
    frame.srcdoc = readerHtml(docs.open?.data?.source?.markdown);
  }

  // A selection on the page: the block it starts in (its data-src) and its text, for the chip.
  function onReaderSelect() {
    const o = docs.open;
    const doc = $('#docs-reader')?.contentDocument;
    const sel = doc?.getSelection?.();
    if (!o?.data || !sel || sel.isCollapsed) return;
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
    box.innerHTML = s ? `
      <span class="docs-chip" data-testid="doc-selection-chip" title="${esc(s.text)}">
        <span class="badge">${esc(s.title || t('docs.selection'))}</span>
        <span class="docs-chip-text">${esc(s.text)}</span>
        <button type="button" class="docs-chip-x" data-docs-unselect aria-label="${t('docs.clear_the_selection')}">×</button>
      </span>` : `<p class="muted small">${t('docs.select_a_passage_on_the_page')}</p>`;
  }

  // One request: a writer turn of the edit gate with the selection payload, its answer swapped into
  // both files as one commit.
  async function sendRequest(text, attachments) {
    const o = docs.open;
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

  // ---- the changes by request ---------------------------------------------------------------------
  function renderChanges() {
    const o = docs.open;
    const box = $('#docs-changes');
    if (!o || !box) return;
    const list = o.changes.filter((c) => !c.undone);
    const pending = list.filter((c) => o.unreviewed.includes(c.commit)).length;
    box.innerHTML = `
      <div class="docs-section-head">
        <h3>${t('docs.changes_by_request')}</h3>
        <span class="badge${pending ? ' warn' : ''}" data-testid="doc-unreviewed-count">${t('docs.unreviewed_count', { count: pending })}</span>
      </div>
      ${list.length ? `<ol class="docs-change-list">${list.map((c) => {
    const open = o.unreviewed.includes(c.commit);
    return `
        <li class="docs-change${open ? ' unreviewed' : ''}" data-testid="doc-change">
          <span class="docs-change-text" title="${esc(c.subject)}">${esc(c.subject)}</span>
          <span class="mono muted small" title="${esc(c.commit)}">${esc(String(c.commit).slice(0, 8))}</span>
          ${open ? `<button type="button" class="btn sm ghost" data-testid="doc-mark-reviewed" data-docs-reviewed="${esc(c.commit)}">${t('docs.mark_reviewed')}</button>` : ''}
          ${o.runId ? `<button type="button" class="btn sm ghost danger" data-testid="doc-undo-change" data-docs-undo="${esc(c.commit)}" aria-label="${t('docs.undo_this_change')}" title="${t('docs.undo_this_change')}">${t('common.undo')}</button>` : ''}
        </li>`;
  }).join('')}</ol>` : `<p class="muted small">${t('docs.no_change_yet')}</p>`}
      ${o.problems.length ? `<p class="small muted" title="${esc(o.problems.join('\n'))}">${t('docs.lint_problems_count', { count: o.problems.length })}</p>` : ''}`;
  }

  async function undoChange(commit) {
    const o = docs.open;
    const change = o.changes.find((c) => c.commit === commit);
    try {
      await api.undoDocChange(docs.projectId, commit, o.runId);
      await reload();
      showToast(t('docs.change_undone'), change?.subject || '');
    } catch (e) { editorError(errMsg(e)); }
  }

  async function markReviewed(commit) {
    const o = docs.open;
    if (!o?.runId) return;
    try { await api.markDocReviewed(o.runId, commit); await reload(); } catch (e) { editorError(errMsg(e)); }
  }

  // the reviewer's notes, each anchored to its section
  function renderNotes() {
    const o = docs.open;
    const box = $('#docs-notes');
    if (!o || !box) return;
    box.classList.toggle('hidden', !o.notes.length);
    box.innerHTML = o.notes.length ? `
      <div class="docs-section-head"><h3>${t('docs.review_notes')}</h3>${o.score !== undefined ? `<span class="badge">${esc(o.score)}/10</span>` : ''}</div>
      <ul class="docs-note-list">${o.notes.map((n) => `
        <li class="docs-note" data-testid="doc-review-note" data-anchor="${esc(n.anchor)}">
          <span class="badge${n.severity === 'major' ? ' warn' : ''}">${n.severity === 'major' ? t('docs.major') : t('docs.minor')}</span>
          <span class="mono small">${esc(n.anchor)}</span>
          <span class="docs-note-text">${esc(n.text)}</span>
        </li>`).join('')}</ul>` : '';
  }

  // ---- the gates ----------------------------------------------------------------------------------
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
      html = `<button type="button" class="btn primary" data-testid="doc-send-to-review" data-docs-gate="send_to_review"${wait}>${t('docs.send_to_review')}</button>`;
    } else if (g && yesNoGate(g)) {
      // merge_blocked: the local merge failed, a yes/no gate (try again, stop as failed)
      html = `
        <p class="muted small docs-gate-message" title="${esc(g.message || '')}">${esc(g.message || '')}</p>
        <button type="button" class="btn primary" data-testid="doc-gate-retry" data-docs-gate="yes"${wait}>${t('docs.retry_the_merge')}</button>
        <button type="button" class="btn ghost" data-testid="doc-gate-stop" data-docs-gate="no"${wait}>${t('docs.stop_as_failed')}</button>`;
    } else if (g) {
      html = `
        <p class="muted small docs-gate-message" title="${esc(g.message || '')}">${esc(g.message || '')}</p>
        <button type="button" class="btn primary" data-testid="doc-gate-accept" data-docs-gate="accept"${wait}>${o.doc === 'spec' ? t('docs.sign_off_spec') : t('docs.accept_intent')}</button>
        <button type="button" class="btn ghost" data-docs-gate="revise"${wait}>${t('docs.back_to_the_edit')}</button>`;
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

  function onEditorClick(e) {
    const el = (sel) => e.target.closest(sel);
    if (el('[data-docs-back]')) return closeDoc();
    if (el('[data-docs-unselect]')) { docs.open.selection = null; renderChip(); return docs.chat?.refresh?.(); }
    const undo = el('[data-docs-undo]');
    if (undo) return undoChange(undo.dataset.docsUndo);
    const reviewed = el('[data-docs-reviewed]');
    if (reviewed) return markReviewed(reviewed.dataset.docsReviewed);
    const gate = el('[data-docs-gate]');
    if (gate) return answerGate(gate.dataset.docsGate);
    if (el('[data-docs-start]')) return startWriter();
    const next = el('[data-docs-next]');
    if (next?.dataset.docsNext === 'backlog') return proposeIssues(docs.open.item);
    if (next) return showView(next.dataset.docsNext);
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
      o.score = ev.output.score;
      renderNotes();
    } else if (ev.type === 'approval.requested') {
      o.gate = ev;
      renderGate();
    } else if (ev.type === 'approval.resolved') {
      if (o.gate?.approval_id === ev.approval_id) o.gate = null;
      renderGate();
    } else if (['workflow.finished', 'run.finished', 'run.failed', 'run.cancelled'].includes(ev.type)) {
      o.runId = null;
      o.gate = null;
      await reload();
    }
  }

  function mountChat() {
    if (!window.AgentChat?.create) return;
    docs.chat = window.AgentChat.create($('#docs-chat'), {
      agent: t('docs.writer'),
      agentId: 'writer',
      placeholder: t('docs.ask_the_writer_for_a_change'),
      pasteImages: true,
      send: (text, attachments) => sendRequest(text, attachments),
      canSend: () => !!(docs.open?.gate?.edit && docs.open.selection && !docs.open.answering),
      inputEnabled: () => !!docs.open?.gate?.edit,
      emptyHtml: () => `<p class="muted small">${t('docs.the_writer_answers_here')}</p>`,
    });
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
        <div id="docs-list-area">
          <div class="page-head">
            <div>
              <h1>${t('docs.documents')}</h1>
              <p class="muted small">${t('docs.the_work_items_of_the_project')}</p>
            </div>
            <button type="button" id="btn-docs-new" class="btn primary" data-testid="docs-new-item">${t('docs.new_item')}</button>
          </div>
          <p id="docs-list-error" class="error small"></p>
          <div id="docs-list" class="docs-list" data-testid="docs-list"></div>
        </div>
        <div id="docs-editor-area" class="hidden">
          <div id="docs-editor" class="docs-editor" data-testid="doc-editor" data-stage="intent">
            <div id="docs-editor-head" class="docs-editor-head"></div>
            <p id="docs-editor-error" class="error small"></p>
            <div class="docs-editor-body">
              <iframe id="docs-reader" class="docs-reader" sandbox="allow-same-origin" title="${t('docs.the_document')}"></iframe>
              <aside class="docs-side">
                <div id="docs-gate" class="row docs-gate" role="group" aria-label="${t('docs.next_step')}"></div>
                <div id="docs-chip" class="docs-chip-box"></div>
                <div id="docs-chat" class="docs-chat"></div>
                <section id="docs-changes" class="docs-changes" data-testid="doc-changes"></section>
                <section id="docs-notes" class="docs-notes hidden"></section>
              </aside>
            </div>
          </div>
        </div>
      </section>`,
    modals: () => `
  <div id="docs-new-modal" class="modal hidden" role="dialog" aria-modal="true" aria-labelledby="docs-new-heading">
    <form id="docs-new-form" class="modal-card">
      <h3 id="docs-new-heading">${t('docs.new_item')}</h3>
      <p class="muted small">${t('docs.a_new_item_starts_with_its_intent')}</p>
      <div class="field">
        <label for="docs-new-title">${t('docs.title')} <span class="req">*</span></label>
        <input type="text" id="docs-new-title" data-testid="docs-new-item-title" maxlength="100" autocomplete="off" placeholder="${t('docs.what_the_item_is_about')}" />
      </div>
      <p id="docs-new-error" class="error small"></p>
      <div class="modal-actions">
        <span class="spacer"></span>
        <button type="button" id="btn-docs-new-cancel" class="btn ghost">${t('common.cancel')}</button>
        <button type="submit" class="btn primary" data-testid="docs-new-item-start">${t('docs.write_the_intent')}</button>
      </div>
    </form>
  </div>`,
    mount() {
      $('#btn-docs-new').onclick = openNewItem;
      $('#docs-list').onclick = onListClick;
      $('#docs-new-form').onsubmit = submitNewItem;
      $('#btn-docs-new-cancel').onclick = () => closeModal('#docs-new-modal');
      $('#docs-editor').addEventListener('click', onEditorClick);
      // the page has no script of its own: the selection is read from here
      $('#docs-reader').addEventListener('load', () => {
        const doc = $('#docs-reader').contentDocument;
        doc?.addEventListener('mouseup', () => setTimeout(onReaderSelect, 0));
        doc?.addEventListener('keyup', () => onReaderSelect());
      });
      document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && state.view === 'docs' && !$('#docs-new-modal').classList.contains('hidden')) closeModal('#docs-new-modal');
      });
      mountChat();
      api.onEvent?.((ev) => { onRunEvent(ev); });
    },
    show: () => (docs.open ? reload() : refresh()),
  });
})();
