/* global api */
// Inbox screen (#256, Plan & Design › Inbox): the raw ideas of the header's project, kept as private
// discovery cards in the workspace (src/discovery.js, the discovery: channels), never on the git
// platform. A quick capture box (title + text; pasted, dropped or picked files; voice on the text,
// voice.js) creates an `idea` card; the list shows the Inbox cards newest first with author, age and
// attachment count; a card opens next to the list with its document (Edit: Save / Cancel), its
// attachments and its thread, and the triage actions: Accept (to Discovery › Triage), Merge into…
// another card, Discard (archived with a reason). Enter captures, Esc closes the open card.
// Registers itself with registerView (view-registry.js); uses app.js globals ($, esc, state, api,
// errMsg, dateOf, openModal, closeModal, confirmDialog), ncAgo (notification-center.js),
// markdownHtml (artifact-render.js), CurrentProject and ImageViewer. Shares how a card's files and
// thread are read and drawn with the Discovery board (window.DiscoveryCardParts, views/discovery/).
(() => {
  const MAX_BYTES = 50 * 1024 * 1024; // the store's limit (discovery.MAX_ATTACHMENT_BYTES)
  const IMAGE = /\.(png|jpe?g|gif|webp)$/i;
  const CLIP = '<svg class="inbox-clip" viewBox="0 0 24 24" aria-hidden="true"><path d="m21 11-8.6 8.6a5.5 5.5 0 0 1-7.8-7.8l8.6-8.6a3.7 3.7 0 0 1 5.2 5.2l-8.6 8.6a1.8 1.8 0 0 1-2.6-2.6l8-8" /></svg>';

  // files: staged for the next capture ({ name, size, data }); open: the opened card with its thread;
  // previews: "<card id>/<name>" → what discovery:attachment returned (an image's data: URL)
  const inbox = { projectId: null, cards: [], files: [], busy: false, open: null, thread: [], editing: false, previews: new Map(), seq: 0, openSeq: 0, acting: false };

  const formatSize = (n) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
  const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
  const toBase64 = (file) => new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).replace(/^data:[^,]*,/, ''));
    r.onerror = () => reject(r.error || new Error(`Could not read ${file.name}`));
    r.readAsDataURL(file);
  });
  // Dropped, pasted or picked files as { name, size, data (base64) }; a file over the limit is named in `errors`.
  async function readFiles(list) {
    const files = [];
    const errors = [];
    for (const f of [...(list || [])]) {
      const name = f.name || 'pasted.png';
      if (f.size > MAX_BYTES) { errors.push(`${name}: too large (${formatSize(f.size)}, the limit is 50 MB)`); continue; }
      try { files.push({ name, size: f.size, data: await toBase64(f) }); } catch (e) { errors.push(`${name}: ${errMsg(e)}`); }
    }
    return { files, errors };
  }
  const hasFiles = (e) => [...(e.dataTransfer?.types || [])].includes('Files');

  // ---- the list ---------------------------------------------------------------------------------
  async function refresh() {
    const seq = ++inbox.seq;
    inbox.projectId = window.CurrentProject?.get() || null;
    let cards = [];
    let error = '';
    if (inbox.projectId) {
      try { cards = await api.listDiscoveryCards(inbox.projectId, 'inbox'); } catch (e) { error = errMsg(e); }
    }
    if (seq !== inbox.seq) return; // a newer refresh answers
    // newest first, whatever order the cards come in
    inbox.cards = [...cards].sort((a, b) => String(b.created).localeCompare(String(a.created)));
    $('#inbox-list-error').textContent = error;
    // the open card left the Inbox (accepted, merged, discarded, another project)
    if (inbox.open && !cards.some((c) => c.id === inbox.open.id)) closeCard();
    else renderList();
  }

  function renderList() {
    const box = $('#inbox-list');
    if (!inbox.projectId) {
      box.innerHTML = '<div class="empty-state"><b>No project chosen</b><p class="muted">Choose a project in the header: each project has its own Inbox.</p></div>';
      return;
    }
    if (!inbox.cards.length) {
      box.innerHTML = '<div class="empty-state" data-testid="inbox-empty"><b>The Inbox is empty</b><p class="muted">Capture an idea above: a title is enough. It stays private to this workspace.</p></div>';
      return;
    }
    box.innerHTML = inbox.cards.map((c) => {
      const n = c.attachments?.length || 0;
      return `
      <div class="inbox-card${inbox.open?.id === c.id ? ' active' : ''}" data-testid="inbox-card" data-card="${esc(c.id)}">
        <div class="inbox-card-main">
          <button type="button" class="inbox-card-title" data-action="open" data-card="${esc(c.id)}" title="${esc(c.title)}">${esc(c.title)}</button>
          <span class="inbox-card-meta muted small">
            <span class="badge">${esc(c.type)}</span>
            <span data-testid="inbox-card-author">${esc(c.author)}</span>
            <span data-testid="inbox-card-age" title="${esc(dateOf(c.created))}">${esc(ncAgo(c.created))}</span>
            <span class="inbox-card-files" data-testid="inbox-card-attachments" title="${esc(plural(n, 'attachment'))}">${CLIP} ${n}</span>
          </span>
        </div>
        <button type="button" class="btn sm ghost" data-action="accept" data-card="${esc(c.id)}" title="Move to Discovery › Triage">Accept</button>
      </div>`;
    }).join('');
  }

  async function onListClick(e) {
    const act = e.target.closest('[data-action]');
    if (act?.dataset.action === 'accept') return accept(act.dataset.card);
    const row = act || e.target.closest('[data-card]');
    if (row?.dataset.card) openCard(row.dataset.card);
  }

  // ---- quick capture ------------------------------------------------------------------------------
  function renderFiles() {
    $('#inbox-files').innerHTML = inbox.files.map((f, i) => `
      <span class="inbox-file" title="${esc(f.name)}">
        <span class="inbox-file-name">${esc(f.name)}</span>
        <span class="muted small">${esc(formatSize(f.size))}</span>
        <button type="button" class="inbox-file-x" data-unstage="${i}" aria-label="Remove ${esc(f.name)}">×</button>
      </span>`).join('');
  }

  async function stage(list) {
    const { files, errors } = await readFiles(list);
    inbox.files.push(...files);
    $('#inbox-capture-error').textContent = errors.join('; ');
    renderFiles();
  }

  async function capture() {
    if (inbox.busy) return;
    const error = $('#inbox-capture-error');
    const title = String($('#inbox-title').value || '').trim();
    if (!inbox.projectId) { error.textContent = 'Choose a project in the header first.'; return; }
    if (!title) { error.textContent = 'Give the idea a title.'; $('#inbox-title').focus({ preventScroll: true }); return; }
    inbox.busy = true;
    $('#inbox-capture').disabled = true;
    error.textContent = '';
    try {
      const card = await api.createDiscoveryCard(inbox.projectId, title, String($('#inbox-text').value || ''));
      const failed = [];
      for (const f of inbox.files) {
        try { await api.addDiscoveryAttachment(inbox.projectId, card.id, undefined, f.name, f.data); } catch (e) { failed.push(`${f.name}: ${errMsg(e)}`); }
      }
      $('#inbox-title').value = '';
      $('#inbox-text').value = '';
      inbox.files = [];
      renderFiles();
      if (failed.length) error.textContent = `Captured, but not attached: ${failed.join('; ')}`;
    } catch (e) {
      error.textContent = errMsg(e);
    } finally {
      inbox.busy = false;
      $('#inbox-capture').disabled = false;
    }
    await refresh();
    $('#inbox-title').focus({ preventScroll: true });
  }

  // Enter captures (Shift+Enter: a new line); an Enter that ends an IME composition does not.
  function onCaptureKey(e) {
    if (e.key !== 'Enter' || e.shiftKey || e.isComposing) return;
    e.preventDefault();
    capture();
  }
  // Pasted files become attachments; pasted text pastes as usual.
  function onCapturePaste(e) {
    const files = [...(e.clipboardData?.files || [])];
    if (!files.length) return;
    e.preventDefault();
    stage(files);
  }

  // ---- the open card ------------------------------------------------------------------------------
  const detailError = (msg) => { const p = $('#inbox-detail-error'); if (p) p.textContent = msg || ''; };

  // One request of the open card at a time: a second Enter or click while one is in flight does nothing.
  async function once(fn) {
    if (inbox.acting) return;
    inbox.acting = true;
    try { await fn(); } finally { inbox.acting = false; }
  }

  // An edit with changes is never dropped by another action: Save or Cancel first.
  function editBlocks() {
    if (!editIsDirty()) return false;
    detailError('Save or cancel the edit first.');
    return true;
  }

  async function openCard(id) {
    if (editBlocks()) return;
    const seq = ++inbox.openSeq;
    let card;
    let thread;
    try {
      [card, thread] = await Promise.all([api.getDiscoveryCard(inbox.projectId, id), api.discoveryConversation(inbox.projectId, id)]);
    } catch (e) {
      $('#inbox-list-error').textContent = errMsg(e);
      return refresh();
    }
    if (seq !== inbox.openSeq) return; // another card was opened, or this one closed, meanwhile
    inbox.open = card;
    inbox.thread = thread;
    inbox.editing = false;
    renderList();
    renderDetail();
  }

  function closeCard() {
    inbox.openSeq++;
    inbox.open = null;
    inbox.editing = false;
    inbox.previews.clear();
    $('#inbox-detail').innerHTML = '';
    $('#inbox-layout').classList.remove('with-detail');
    renderList();
  }

  // Reads the open card again (after a save, an attachment, a note) and redraws it.
  async function reloadCard() {
    const id = inbox.open?.id;
    if (!id) return;
    const [card, thread] = await Promise.all([api.getDiscoveryCard(inbox.projectId, id), api.discoveryConversation(inbox.projectId, id)]);
    if (inbox.open?.id !== id) return;
    inbox.open = card;
    inbox.thread = thread;
    renderDetail();
    refresh();
  }

  function documentHtml(c) {
    if (inbox.editing) {
      return `
        <div class="inbox-edit">
          <div class="field">
            <label for="inbox-edit-title">Title <span class="req">*</span></label>
            <input type="text" id="inbox-edit-title" maxlength="200" value="${esc(c.title)}" />
          </div>
          <div class="field">
            <label for="inbox-edit-doc">Document (Markdown)</label>
            <textarea id="inbox-edit-doc" rows="12" class="mono">${esc(c.document)}</textarea>
          </div>
          <div class="row">
            <span class="spacer"></span>
            <button type="button" class="btn sm ghost" data-detail="cancel-edit">Cancel</button>
            <button type="button" class="btn sm primary" data-detail="save">Save</button>
          </div>
        </div>`;
    }
    return String(c.document || '').trim()
      ? `<article class="md md-compact inbox-doc">${markdownHtml(c.document)}</article>`
      : '<p class="muted small">No document yet. Edit the card to write it.</p>';
  }

  function renderDetail() {
    const c = inbox.open;
    if (!c) return;
    $('#inbox-layout').classList.add('with-detail');
    $('#inbox-detail').innerHTML = `
      <aside class="inbox-detail" data-testid="inbox-card-detail" aria-label="Card: ${esc(c.title)}">
        <div class="inbox-detail-head">
          <h2 data-testid="card-document-title" title="${esc(c.title)}">${esc(c.title)}</h2>
          <button type="button" class="btn sm ghost" data-detail="close" title="Close (Esc)">Close</button>
        </div>
        <p class="inbox-card-meta muted small">
          <span class="badge">${esc(c.type)}</span>
          <span>${esc(c.author)}</span>
          <span>${esc(dateOf(c.created))}</span>
          <span class="mono" title="The card's folder in the workspace's discovery/">${esc(c.id)}</span>
        </p>
        <div class="row inbox-triage" role="group" aria-label="Triage">
          <button type="button" class="btn sm primary" data-testid="card-accept" data-detail="accept" title="Move to Discovery › Triage">Accept</button>
          <button type="button" class="btn sm ghost" data-testid="card-merge" data-detail="merge" title="Join this card's document and attachments into another card">Merge into…</button>
          <button type="button" class="btn sm ghost danger" data-testid="card-discard" data-detail="discard" title="Archive with a reason">Discard</button>
        </div>
        <p id="inbox-detail-error" class="error small"></p>
        <section class="inbox-section">
          <div class="inbox-section-head">
            <h3>Document</h3>
            ${inbox.editing ? '' : '<button type="button" class="btn sm ghost" data-detail="edit">Edit</button>'}
          </div>
          ${documentHtml(c)}
        </section>
        <section class="inbox-section">
          <div class="inbox-section-head">
            <h3>Attachments</h3>
            <button type="button" class="btn sm ghost" data-detail="attach">Attach files</button>
            <input type="file" id="inbox-detail-file" class="hidden" multiple aria-label="Attach files to the card" />
          </div>
          <div id="inbox-detail-files" class="inbox-files"></div>
        </section>
        <section class="inbox-section">
          <div class="inbox-section-head"><h3>Thread</h3></div>
          <div id="inbox-detail-thread" class="inbox-thread"></div>
          <div class="inbox-note">
            <textarea id="inbox-note" rows="2" placeholder="Add a note (Enter sends)" aria-label="Add a note"></textarea>
            <button type="button" class="btn sm" data-detail="note">Add note</button>
          </div>
        </section>
      </aside>`;
    renderAttachments();
    renderThread();
    loadPreviews();
  }

  // A card's attachments (`previews`: "<card id>/<name>" → discovery:attachment's answer): each
  // with data-detail="view" / "unattach" and data-name, for the panel's click handler.
  function attachmentsHtml(c, previews) {
    if (!c.attachments.length) return '<p class="muted small">No attachment. Paste or drop images and files on this card.</p>';
    return c.attachments.map((name) => {
      const url = previews.get(`${c.id}/${name}`)?.dataUrl;
      return `
      <span class="inbox-file${url ? ' image' : ''}" title="${esc(name)}">
        ${url ? `<img class="inbox-thumb" ${window.ImageViewer?.THUMB || 'tabindex="0" role="button"'} src="${esc(url)}" alt="${esc(name)}" data-detail="view" data-name="${esc(name)}" />` : ''}
        <button type="button" class="link-btn inbox-file-name" data-detail="view" data-name="${esc(name)}">${esc(name)}</button>
        <button type="button" class="inbox-file-x" data-detail="unattach" data-name="${esc(name)}" aria-label="Remove ${esc(name)}">×</button>
      </span>`;
    }).join('');
  }

  function renderAttachments() {
    const c = inbox.open;
    const box = $('#inbox-detail-files');
    if (!c || !box) return;
    box.innerHTML = attachmentsHtml(c, inbox.previews);
  }

  // The images' thumbnails, read once per card and name.
  async function loadPreviews() {
    const c = inbox.open;
    const missing = c.attachments.filter((n) => IMAGE.test(n) && !inbox.previews.has(`${c.id}/${n}`));
    if (!missing.length) return;
    await Promise.all(missing.map(async (n) => {
      try { inbox.previews.set(`${c.id}/${n}`, await api.discoveryAttachment(inbox.projectId, c.id, n)); } catch { /* shown by its name only */ }
    }));
    if (inbox.open?.id === c.id) renderAttachments();
  }

  // A card's thread, oldest first: who, when, the entry's kind when it is not a note, its text; an
  // entry about a run (a result, an automation's, #259) links the run and shows its cost.
  const threadHtml = (thread) => (thread.length ? thread.map((m) => `
      <div class="inbox-entry">
        <div class="muted small"><b>${esc(m.author || 'unknown')}</b> <span title="${esc(m.ts ? dateOf(m.ts) : '')}">${esc(m.ts ? ncAgo(m.ts) : '')}</span>${m.kind && m.kind !== 'note' ? ` <span class="badge">${esc(m.kind)}</span>` : ''}</div>
        <div class="inbox-entry-text">${esc(m.text || '')}</div>
        ${m.runId ? `<div class="muted small inbox-entry-run"><button type="button" class="link-btn small" data-open-run="${esc(m.runId)}" data-testid="thread-run" title="Open the run">run ${esc(m.runId)}</button>${typeof m.costUsd === 'number' ? ` · <span data-testid="thread-run-cost">$${esc(m.costUsd.toFixed(2))}</span>` : ''}</div>` : ''}
      </div>`).join('') : '<p class="muted small">No note yet.</p>');

  function renderThread() {
    const box = $('#inbox-detail-thread');
    if (!box) return;
    box.innerHTML = threadHtml(inbox.thread);
  }

  const editIsDirty = () => inbox.editing && ($('#inbox-edit-title')?.value !== inbox.open.title || $('#inbox-edit-doc')?.value !== inbox.open.document);

  const saveEdit = () => once(async () => {
    const id = inbox.open?.id;
    if (!id) return;
    try {
      await api.updateDiscoveryCard(inbox.projectId, id, { title: $('#inbox-edit-title').value, document: $('#inbox-edit-doc').value });
      if (inbox.open?.id !== id) return;
      inbox.editing = false;
      await reloadCard();
    } catch (e) { detailError(errMsg(e)); }
  });

  async function attachToCard(list) {
    const id = inbox.open?.id;
    if (!id) return;
    const { files, errors } = await readFiles(list);
    for (const f of files) {
      try { await api.addDiscoveryAttachment(inbox.projectId, id, undefined, f.name, f.data); } catch (e) { errors.push(`${f.name}: ${errMsg(e)}`); }
    }
    if (inbox.open?.id !== id) return;
    // only the attachments are redrawn: an edit in progress keeps its text
    try { inbox.open.attachments = (await api.getDiscoveryCard(inbox.projectId, id)).attachments; } catch (e) { errors.push(errMsg(e)); }
    renderAttachments();
    loadPreviews();
    detailError(errors.join('; '));
    refresh();
  }

  async function viewAttachment(name) {
    const c = inbox.open;
    try {
      const key = `${c.id}/${name}`;
      if (!inbox.previews.has(key)) inbox.previews.set(key, await api.discoveryAttachment(inbox.projectId, c.id, name));
      const a = inbox.previews.get(key);
      if (a.dataUrl && window.ImageViewer) window.ImageViewer.open({ title: c.title, images: [{ src: a.dataUrl, label: name }] });
      // another file is never opened from here (it could be a program): its folder is
      else await api.openPath(a.folder);
    } catch (e) { detailError(errMsg(e)); }
  }

  async function removeAttachment(name) {
    const id = inbox.open.id;
    if (!(await confirmDialog('Remove attachment', `Delete "${name}" from this card?`, 'Remove'))) return;
    try {
      await api.removeDiscoveryAttachment(inbox.projectId, id, name);
      inbox.previews.delete(`${id}/${name}`);
      if (inbox.open?.id !== id) return;
      inbox.open.attachments = inbox.open.attachments.filter((n) => n !== name);
      renderAttachments();
      refresh();
    } catch (e) { detailError(errMsg(e)); }
  }

  const addNote = () => once(async () => {
    const id = inbox.open?.id;
    const box = $('#inbox-note');
    const text = String(box?.value || '').trim();
    if (!id || !text) return;
    try {
      await api.appendDiscoveryConversation(inbox.projectId, id, { text });
      const thread = await api.discoveryConversation(inbox.projectId, id);
      if (inbox.open?.id !== id) return;
      box.value = '';
      inbox.thread = thread;
      renderThread();
    } catch (e) { detailError(errMsg(e)); }
  });

  // ---- triage -------------------------------------------------------------------------------------
  async function accept(id) {
    if (inbox.open?.id === id && editBlocks()) return;
    try {
      await api.moveDiscoveryCard(inbox.projectId, id, 'triage');
      if (inbox.open?.id === id) closeCard();
    } catch (e) {
      $('#inbox-list-error').textContent = errMsg(e);
    }
    await refresh();
  }

  function openDiscard() {
    if (editBlocks()) return;
    $('#inbox-discard-what').textContent = `"${inbox.open.title}" moves to the archive with this reason.`;
    $('#inbox-discard-reason').value = '';
    $('#inbox-discard-error').textContent = '';
    openModal('#inbox-discard-modal');
    $('#inbox-discard-reason').focus({ preventScroll: true });
  }

  function discard(e) {
    e.preventDefault();
    const id = inbox.open?.id;
    if (!id) return closeModal('#inbox-discard-modal');
    const reason = String($('#inbox-discard-reason').value || '').trim();
    if (!reason) { $('#inbox-discard-error').textContent = 'Say why the card is discarded.'; return undefined; }
    return once(async () => {
      try {
        await api.archiveDiscoveryCard(inbox.projectId, id, reason);
        closeModal('#inbox-discard-modal');
        if (inbox.open?.id === id) closeCard();
        await refresh();
      } catch (err) { $('#inbox-discard-error').textContent = errMsg(err); }
    });
  }

  async function openMerge() {
    if (editBlocks()) return;
    const id = inbox.open.id;
    let others = [];
    // (a committed card takes no merge, #258)
    try { others = (await api.listDiscoveryCards(inbox.projectId)).filter((c) => c.id !== id && c.column !== 'committed'); } catch (e) { return detailError(errMsg(e)); }
    if (inbox.open?.id !== id) return;
    $('#inbox-merge-what').textContent = `The document and the attachments of "${inbox.open.title}" join the card chosen here; this card is archived with a link to it.`;
    $('#inbox-merge-target').innerHTML = others.map((c) => `<option value="${esc(c.id)}">${esc(c.title)} (${esc(c.column)})</option>`).join('');
    $('#inbox-merge-error').textContent = others.length ? '' : 'There is no other card to merge into.';
    $('#btn-inbox-merge').disabled = !others.length;
    openModal('#inbox-merge-modal');
    $('#inbox-merge-target').focus({ preventScroll: true });
  }

  function merge(e) {
    e.preventDefault();
    const id = inbox.open?.id;
    if (!id) return closeModal('#inbox-merge-modal');
    const intoId = $('#inbox-merge-target').value;
    if (!intoId) return undefined;
    return once(async () => {
      try {
        await api.mergeDiscoveryCard(inbox.projectId, id, intoId);
        closeModal('#inbox-merge-modal');
        if (inbox.open?.id === id) closeCard();
        await refresh();
      } catch (err) { $('#inbox-merge-error').textContent = errMsg(err); }
    });
  }

  function onDetailClick(e) {
    const b = e.target.closest('[data-detail]');
    if (!b || !inbox.open) return;
    const act = b.dataset.detail;
    if (act === 'close') { if (!editBlocks()) closeCard(); }
    else if (act === 'accept') accept(inbox.open.id);
    else if (act === 'merge') openMerge();
    else if (act === 'discard') openDiscard();
    else if (act === 'edit') { inbox.editing = true; renderDetail(); $('#inbox-edit-doc').focus({ preventScroll: true }); }
    else if (act === 'cancel-edit') { inbox.editing = false; renderDetail(); }
    else if (act === 'save') saveEdit();
    else if (act === 'attach') $('#inbox-detail-file').click();
    else if (act === 'view') viewAttachment(b.dataset.name);
    else if (act === 'unattach') removeAttachment(b.dataset.name);
    else if (act === 'note') addNote();
  }

  // Esc: a dialog of this screen first, then a clean edit, then the open card. An edit with changes
  // stays (Cancel drops it), and another dialog or the image viewer on top closes by itself (the
  // viewer takes its Esc: defaultPrevented).
  function onEscape(e) {
    if (e.key !== 'Escape' || e.defaultPrevented || state.view !== 'inbox') return;
    for (const sel of ['#inbox-discard-modal', '#inbox-merge-modal']) {
      if (!$(sel).classList.contains('hidden')) return closeModal(sel);
    }
    if (!inbox.open || window.ImageViewer?.isOpen() || document.querySelector('.modal:not(.hidden)')) return;
    if (inbox.editing) {
      if (!editIsDirty()) { inbox.editing = false; renderDetail(); }
      return;
    }
    closeCard();
  }

  // Home's "What needs you" (#255): the Inbox with one card open, to answer its question in the thread
  window.InboxActions = {
    openCard: (id) => { showView('inbox'); return openCard(id); },
  };

  // a card's files and thread, drawn the same way in the Discovery board's card panel (#257)
  window.DiscoveryCardParts = {
    attachmentsHtml,
    CLIP,
    hasFiles,
    IMAGE,
    readFiles,
    threadHtml,
  };

  registerView({
    id: 'inbox',
    nav: {
      label: 'Inbox', order: 110, group: 'plan', title: 'Capture raw ideas privately and triage them',
      icon: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M22 12h-6l-2 3h-4l-2-3H2" /><path d="M5.5 5h13L22 12v6a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-6z" /></svg>',
    },
    markup: `
      <section id="view-inbox" class="view hidden">
        <div class="page-head">
          <div>
            <h1>Inbox</h1>
            <p class="muted small">Raw ideas of the project chosen in the header, kept privately in this workspace (<span class="mono">discovery/</span>), never on the git platform. Accept one to start its discovery.</p>
          </div>
        </div>
        <div id="inbox-capture-box" class="inbox-capture" role="group" aria-label="Quick capture">
          <div class="field">
            <label for="inbox-title">Idea <span class="req">*</span></label>
            <input type="text" id="inbox-title" data-testid="inbox-capture-title" maxlength="200" placeholder="A title for the idea" autocomplete="off" />
          </div>
          <div class="field">
            <label for="inbox-text">Details</label>
            <textarea id="inbox-text" data-testid="inbox-capture-text" rows="3" placeholder="What is it about? Paste or drop images and files here."></textarea>
            <p class="hint">Enter captures · Shift+Enter adds a line</p>
          </div>
          <div id="inbox-files" class="inbox-files"></div>
          <p id="inbox-capture-error" class="error small"></p>
          <div class="row">
            <button type="button" id="btn-inbox-attach" class="btn sm ghost">Attach files</button>
            <input type="file" id="inbox-file-input" class="hidden" multiple aria-label="Attach files to the idea" />
            <span class="spacer"></span>
            <button type="button" id="inbox-capture" class="btn primary">Capture</button>
          </div>
        </div>
        <p id="inbox-list-error" class="error small"></p>
        <div id="inbox-layout" class="inbox-layout">
          <div id="inbox-list" class="inbox-list" data-testid="inbox-list"></div>
          <div id="inbox-detail"></div>
        </div>
      </section>`,
    modals: `
  <div id="inbox-discard-modal" class="modal hidden">
    <form id="inbox-discard-form" class="modal-card">
      <h3>Discard card</h3>
      <p id="inbox-discard-what" class="muted small"></p>
      <div class="field">
        <label for="inbox-discard-reason">Reason <span class="req">*</span></label>
        <textarea id="inbox-discard-reason" data-testid="discard-reason" rows="3" placeholder="Why is it discarded? Kept with the archived card."></textarea>
      </div>
      <p id="inbox-discard-error" class="error small"></p>
      <div class="modal-actions">
        <span class="spacer"></span>
        <button type="button" id="btn-inbox-discard-cancel" class="btn ghost">Cancel</button>
        <button type="submit" class="btn danger-solid" data-testid="discard-confirm">Discard</button>
      </div>
    </form>
  </div>
  <div id="inbox-merge-modal" class="modal hidden">
    <form id="inbox-merge-form" class="modal-card">
      <h3>Merge into…</h3>
      <p id="inbox-merge-what" class="muted small"></p>
      <div class="field">
        <label for="inbox-merge-target">Card</label>
        <select id="inbox-merge-target" data-testid="merge-target"></select>
      </div>
      <p id="inbox-merge-error" class="error small"></p>
      <div class="modal-actions">
        <span class="spacer"></span>
        <button type="button" id="btn-inbox-merge-cancel" class="btn ghost">Cancel</button>
        <button type="submit" id="btn-inbox-merge" class="btn primary" data-testid="merge-confirm">Merge</button>
      </div>
    </form>
  </div>`,
    mount() {
      $('#inbox-capture').onclick = capture;
      for (const sel of ['#inbox-title', '#inbox-text']) {
        $(sel).addEventListener('keydown', onCaptureKey);
        $(sel).addEventListener('paste', onCapturePaste);
      }
      const box = $('#inbox-capture-box');
      box.addEventListener('dragover', (e) => { if (hasFiles(e)) { e.preventDefault(); box.classList.add('dropping'); } });
      box.addEventListener('dragleave', () => box.classList.remove('dropping'));
      box.addEventListener('drop', (e) => {
        box.classList.remove('dropping');
        if (!e.dataTransfer?.files?.length) return;
        e.preventDefault();
        stage(e.dataTransfer.files);
      });
      $('#btn-inbox-attach').onclick = () => $('#inbox-file-input').click();
      $('#inbox-file-input').onchange = (e) => { stage(e.target.files); e.target.value = ''; };
      $('#inbox-files').onclick = (e) => {
        const b = e.target.closest('[data-unstage]');
        if (!b) return;
        inbox.files.splice(Number(b.dataset.unstage), 1);
        renderFiles();
      };
      $('#inbox-list').onclick = onListClick;

      const detail = $('#inbox-detail');
      detail.onclick = onDetailClick;
      detail.addEventListener('change', (e) => { if (e.target.id === 'inbox-detail-file') { attachToCard(e.target.files); e.target.value = ''; } });
      detail.addEventListener('keydown', (e) => {
        if (e.target.id !== 'inbox-note' || e.key !== 'Enter' || e.shiftKey || e.isComposing) return;
        e.preventDefault();
        addNote();
      });
      detail.addEventListener('paste', (e) => {
        const files = [...(e.clipboardData?.files || [])];
        if (!files.length || !inbox.open) return;
        e.preventDefault();
        attachToCard(files);
      });
      detail.addEventListener('dragover', (e) => { if (inbox.open && hasFiles(e)) e.preventDefault(); });
      detail.addEventListener('drop', (e) => {
        if (!inbox.open || !e.dataTransfer?.files?.length) return;
        e.preventDefault();
        attachToCard(e.dataTransfer.files);
      });

      $('#inbox-discard-form').onsubmit = discard;
      $('#btn-inbox-discard-cancel').onclick = () => closeModal('#inbox-discard-modal');
      $('#inbox-merge-form').onsubmit = merge;
      $('#btn-inbox-merge-cancel').onclick = () => closeModal('#inbox-merge-modal');
      document.addEventListener('keydown', onEscape);
    },
    show: refresh,
  });
})();
