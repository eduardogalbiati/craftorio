/* global api */
// Inbox screen (#256, Plan & Design › Inbox): the raw ideas of the header's project, kept as private
// discovery cards in the workspace (src/discovery.js, the discovery: channels), never on the git
// platform. A quick capture box (title + text; pasted, dropped or picked files; voice on the text,
// voice.js) creates an `idea` card; the list shows the Inbox cards newest first with author, age and
// attachment count; a card opens next to the list with its document (Edit: Save / Cancel), its
// attachments and its thread, and the triage actions: Accept (to Discovery › Triage), Merge into…
// another card, Discard (archived with a reason). Enter captures, Esc closes the open card.
// Import… (#322, src/discovery-import.js) opens a panel that takes a .md/.txt file (chosen or
// dropped on it) or pasted text and previews the items the document is cut into (one per top-level
// heading or list item; its `- [ ]` lines its criteria): title (Rename: Save / Cancel), first lines,
// number of criteria, the clarity score the card gets, a duplicate of an open card or open synced
// issue (keep, skip, or merge into that card); Drop, Merge into… and Nest under… with Undo of the
// last edit. Nothing is written until the confirm button, which creates the cards all or none, in
// the document's order (more than 200 asks first); Cancel and Esc close it with nothing written.
// Registers itself with registerView (view-registry.js); uses app.js globals ($, esc, state, api,
// errMsg, dateOf, openModal, closeModal, confirmDialog, selectRun), ncAgo (notification-center.js),
// markdownHtml (artifact-render.js), CurrentProject and ImageViewer. Shares how a card's files and
// thread are read and drawn with the Discovery board (window.DiscoveryCardParts, views/discovery/).
(() => {
  const MAX_BYTES = 50 * 1024 * 1024; // the store's limit (discovery.MAX_ATTACHMENT_BYTES)
  const IMAGE = /\.(png|jpe?g|gif|webp)$/i;
  const CLIP = '<svg class="inbox-clip" viewBox="0 0 24 24" aria-hidden="true"><path d="m21 11-8.6 8.6a5.5 5.5 0 0 1-7.8-7.8l8.6-8.6a3.7 3.7 0 0 1 5.2 5.2l-8.6 8.6a1.8 1.8 0 0 1-2.6-2.6l8-8" /></svg>';

  // files: staged for the next capture ({ name, size, data }); open: the opened card with its thread;
  // previews: "<card id>/<name>" → what discovery:attachment returned (an image's data: URL)
  const inbox = { projectId: null, cards: [], files: [], busy: false, open: null, thread: [], editing: false, previews: new Map(), seq: 0, openSeq: 0, acting: false, importing: null };

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
    const before = inbox.projectId;
    inbox.projectId = window.CurrentProject?.get() || null;
    // an import previewed for another project is not written into this one
    if (inbox.importing && before !== inbox.projectId) { inbox.importing = null; importBox().innerHTML = ''; importBox().classList.add('hidden'); }
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
      box.innerHTML = `<div class="empty-state"><b>${t('inbox.no_project_chosen')}</b><p class="muted">${t('inbox.choose_a_project_in_the_header')}</p></div>`;
      return;
    }
    if (!inbox.cards.length) {
      box.innerHTML = `<div class="empty-state" data-testid="inbox-empty"><b>${t('inbox.the_inbox_is_empty')}</b><p class="muted">${t('inbox.capture_an_idea_above_a_title')}</p></div>`;
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
        <button type="button" class="btn sm ghost" data-action="accept" data-card="${esc(c.id)}" title="${t('inbox.move_to_discovery_triage')}">${t('inbox.accept')}</button>
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
        <button type="button" class="inbox-file-x" data-unstage="${i}" aria-label="${t('inbox.remove_name', { name: esc(f.name) })}">×</button>
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

  // ---- import a backlog document (#322) -----------------------------------------------------------
  // inbox.importing: null (closed), or { name (the file, '' when pasted), text, items (previewed:
  // clarity, duplicate; a duplicate's `action`), note, message, picking: { op, index } (a Merge into… /
  // Nest under… choosing its target), renaming: the index being renamed, undo: { items, what } (the
  // last edit), busy }
  const MAX_IMPORT = 200; // discovery-import.MAX_IMPORT_ITEMS: more cards ask first
  const IMPORT_TYPES = /\.(md|markdown|txt)$/i;
  const IMPORT_EDITS = { merge: 'Merge into', nest: 'Nest under' };
  const importBox = () => $('#inbox-import-panel');
  const firstLines = (text) => String(text || '').split('\n').map((l) => l.trim()).filter(Boolean).slice(0, 2).join(' · ');
  const clarityBadge = (n) => `<span class="badge ${n >= 85 ? 'inbox-import-clear' : n >= 50 ? 'warn' : 'muted'}" title="${t('inbox.the_clarity_score_the_card_gets', { n })}">${t('inbox.clarity_n', { n })}</span>`;
  // what an item becomes: a duplicate may be skipped or merged into its card; anything else is a new card
  const actionOf = (it) => (it.duplicate && (it.action === 'skip' || (it.action === 'merge' && it.duplicate.kind === 'card')) ? it.action : 'keep');
  const importCounts = (items) => ({
    create: items.filter((it) => actionOf(it) === 'keep').length,
    merge: items.filter((it) => actionOf(it) === 'merge').length,
  });

  function openImport() {
    if (inbox.importing) { importBox().querySelector('button')?.focus({ preventScroll: true }); return; }
    inbox.importing = { name: '', text: '', items: null, note: '', message: inbox.projectId ? '' : 'Choose a project in the header first.', picking: null, renaming: null, undo: null, busy: false };
    renderImport();
    $('#btn-inbox-import-pick')?.focus({ preventScroll: true });
  }

  function closeImport() {
    inbox.importing = null;
    importBox().innerHTML = '';
    importBox().classList.add('hidden');
    $('#btn-inbox-import').focus({ preventScroll: true });
  }

  function duplicateHtml(it, i) {
    const d = it.duplicate;
    if (!d) return '';
    const link = d.kind === 'card'
      ? `<button type="button" class="link-btn small" data-import-card="${esc(d.id)}" title="${t('inbox.open_the_card')}">${esc(d.title)}</button>`
      : `<a class="small" href="${esc(d.url || '#')}" target="_blank" rel="noopener" title="${t('inbox.open_the_issue')}">#${esc(d.number)} ${esc(d.title)}</a>`;
    const options = [['keep', 'Keep as a new card'], ['skip', 'Skip it'], ...(d.kind === 'card' ? [['merge', 'Merge into that card']] : [])];
    return `
      <span class="inbox-import-dup" data-testid="inbox-import-duplicate">
        <span class="badge warn">${t('inbox.duplicate_of')} ${d.kind === 'card' ? 'a card' : 'an open issue'}</span> ${link}
        <select data-import-action="${i}" aria-label="${t('inbox.what_to_do_with_the_duplicate', { title: esc(d.title) })}">
          ${options.map(([v, label]) => `<option value="${v}"${actionOf(it) === v ? ' selected' : ''}>${label}</option>`).join('')}
        </select>
      </span>`;
  }

  function importItemHtml(it, i, items) {
    const n = (it.acceptance || []).length;
    const pick = inbox.importing.picking?.index === i ? inbox.importing.picking : null;
    const others = items.map((o, k) => [o, k]).filter(([, k]) => k !== i);
    return `
      <li class="inbox-import-item${actionOf(it) === 'skip' ? ' skipped' : ''}" data-testid="inbox-import-item">
        <span class="inbox-import-num muted small">${i + 1}</span>
        <div class="inbox-import-main">
          ${inbox.importing.renaming === i ? `
          <div class="row inbox-import-rename">
            <input type="text" id="inbox-import-rename" maxlength="200" value="${esc(it.title)}" aria-label="${t('inbox.new_title_of_item_value', { value: i + 1 })}" />
            <button type="button" class="btn sm primary" data-import-op="rename-save" data-index="${i}">${t('common.save')}</button>
            <button type="button" class="btn sm ghost" data-import-op="rename-cancel" data-index="${i}">${t('common.cancel')}</button>
          </div>` : `<b class="inbox-import-title" title="${esc(it.title)}">${esc(it.title)}</b>`}
          <span class="inbox-card-meta muted small">
            <span class="badge" data-testid="inbox-import-criteria" title="${t('inbox.its_lines_the_card_s_acceptance')}">${n} ${n === 1 ? 'criterion' : 'criteria'}</span>
            ${clarityBadge(it.clarity)}
            <span class="inbox-import-lines" title="${esc(it.text || '')}">${esc(firstLines(it.text)) || 'No text: a title only.'}</span>
          </span>
          ${duplicateHtml(it, i)}
          ${pick ? `
          <div class="row inbox-import-pick" role="group" aria-label="${esc(IMPORT_EDITS[pick.op])}">
            <label class="small" for="inbox-import-target">${esc(IMPORT_EDITS[pick.op])}</label>
            <select id="inbox-import-target">${others.map(([o, k]) => `<option value="${k}">${k + 1}. ${esc(o.title)}</option>`).join('')}</select>
            <button type="button" class="btn sm primary" data-import-op="apply" data-index="${i}">${pick.op === 'merge' ? 'Merge' : 'Nest'}</button>
            <button type="button" class="btn sm ghost" data-import-op="unpick" data-index="${i}">${t('common.cancel')}</button>
          </div>` : ''}
        </div>
        <div class="row inbox-import-actions">
          <button type="button" class="btn sm ghost" data-import-op="rename" data-index="${i}" aria-label="${t('inbox.rename_title', { title: esc(it.title) })}">${t('inbox.rename')}</button>
          ${others.length ? `<button type="button" class="btn sm ghost" data-import-op="merge" data-index="${i}" title="${t('inbox.join_its_text_and_criteria_into')}">${t('inbox.merge_into')}</button>
          <button type="button" class="btn sm ghost" data-import-op="nest" data-index="${i}" title="${t('inbox.make_it_a_section_of_another')}">${t('inbox.nest_under')}</button>` : ''}
          <button type="button" class="btn sm ghost danger" data-import-op="drop" data-index="${i}" aria-label="${t('inbox.drop_title', { title: esc(it.title) })}">${t('inbox.drop')}</button>
        </div>
      </li>`;
  }

  function renderImport() {
    const st = inbox.importing;
    const box = importBox();
    if (!st) return;
    box.classList.remove('hidden');
    const message = `<p class="error small" data-testid="inbox-import-message" role="status">${esc(st.message || '')}</p>`;
    if (!st.items) {
      box.innerHTML = `
        <div class="inbox-import-head"><h2>${t('inbox.import_a_backlog_document')}</h2></div>
        <p class="muted small">A <span class="mono">${t('inbox.md')}</span> ${t('inbox.or')} <span class="mono">${t('inbox.txt')}</span> ${t('inbox.file_choose_it_or_drop_it')} <span class="mono">- [ ]</span> ${t('inbox.lines_its_acceptance_criteria_nothing_is')}</p>
        <div class="row">
          <button type="button" id="btn-inbox-import-pick" class="btn sm" data-import-op="pick">${t('inbox.choose_a_file')}</button>
          <input type="file" id="inbox-import-file" data-testid="inbox-import-file" class="hidden" accept=".md,.markdown,.txt,text/markdown,text/plain" aria-label="${t('inbox.backlog_document_to_import')}" />
          <span class="muted small">${t('inbox.or_drop_it_on_this_panel')}</span>
        </div>
        <div class="field">
          <label for="inbox-import-text">${t('inbox.or_paste_the_text')}</label>
          <textarea id="inbox-import-text" rows="5" class="mono" placeholder="${t('inbox.first_idea_what_it_is_about')}"></textarea>
        </div>
        ${message}
        <div class="row">
          <span class="spacer"></span>
          <button type="button" class="btn ghost" data-import-op="cancel">${t('common.cancel')}</button>
          <button type="button" class="btn primary" data-import-op="paste"${st.busy ? ' disabled' : ''}>${t('inbox.preview')}</button>
        </div>`;
      return;
    }
    const { create, merge } = importCounts(st.items);
    const confirm = [create ? `Create ${plural(create, 'card')}` : '', merge ? `merge ${merge}` : ''].filter(Boolean).join(', ') || 'Nothing to create';
    box.innerHTML = `
      <div data-testid="inbox-import-preview" class="inbox-import-preview">
        <div class="inbox-import-head">
          <h2>${t('inbox.preview_2')} ${esc(plural(st.items.length, 'item'))}</h2>
          <span class="badge" title="${esc(st.name || 'pasted text')}">${esc(st.name || 'pasted')}</span>
        </div>
        <p class="muted small">${esc(st.note)} ${t('inbox.nothing_is_written_yet_rename_drop')}</p>
        ${st.undo ? `<p class="small inbox-import-undo">${esc(st.undo.what)} <button type="button" class="link-btn small" data-import-op="undo">${t('common.undo')}</button></p>` : ''}
        <ol class="inbox-import-list">${st.items.map((it, i) => importItemHtml(it, i, st.items)).join('')}</ol>
        ${message}
        <div class="row">
          <span class="spacer"></span>
          <button type="button" class="btn ghost" data-testid="inbox-import-cancel" data-import-op="cancel">${t('common.cancel')}</button>
          <button type="button" class="btn primary" data-testid="inbox-import-confirm" data-import-op="confirm"${create + merge && !st.busy ? '' : ' disabled'}>${esc(confirm)}</button>
        </div>
      </div>`;
  }

  // The document's text, cut into items and previewed by the store (nothing written).
  async function previewText(text, name) {
    const st = inbox.importing;
    if (!st || st.busy) return;
    if (!inbox.projectId) { st.message = 'Choose a project in the header first.'; return renderImport(); }
    st.busy = true;
    try {
      const split = await api.splitDiscoveryImport(inbox.projectId, text, name || undefined);
      if (inbox.importing !== st) return;
      Object.assign(st, { name: name || '', text, note: split.note, undo: null, picking: null, renaming: null, message: split.items.length ? '' : split.note, items: split.items.length ? split.items : null });
    } catch (e) {
      st.message = errMsg(e);
    } finally { st.busy = false; }
    if (inbox.importing === st) renderImport();
  }

  // A picked or dropped file: a .md or .txt file of text, read here.
  async function importFile(file) {
    const st = inbox.importing;
    if (!st || !file) return;
    const fail = (msg) => { st.items = null; st.message = msg; renderImport(); };
    if (!IMPORT_TYPES.test(file.name)) return fail(`${file.name} cannot be imported: choose a .md or .txt file.`);
    if (file.size > MAX_BYTES) return fail(`${file.name} is too large (${formatSize(file.size)}, the limit is 50 MB).`);
    let text;
    try { text = await file.text(); } catch (e) { return fail(`${file.name} could not be read: ${errMsg(e)}`); }
    if (text.includes('\u0000')) return fail(`${file.name} is not a text file.`);
    return previewText(text, file.name);
  }

  // A preview edit (rename, drop, merge, nest) through the store, which previews the items again.
  async function editImport(edit, what) {
    const st = inbox.importing;
    if (!st?.items || st.busy) return;
    st.busy = true;
    const before = st.items;
    try {
      const items = await api.editDiscoveryImport(inbox.projectId, before, edit);
      if (inbox.importing !== st) return;
      // a duplicate keeps its choice while it stays one
      st.items = items.map((it) => (it.duplicate ? it : { ...it, action: undefined }));
      st.undo = what ? { items: before, what } : null;
      st.picking = null;
      st.renaming = null;
      st.message = '';
    } catch (e) {
      st.message = errMsg(e);
    } finally { st.busy = false; }
    if (inbox.importing === st) renderImport();
  }

  async function confirmImport() {
    const st = inbox.importing;
    if (!st?.items || st.busy) return;
    const { create } = importCounts(st.items);
    let confirmLarge = false;
    if (create > MAX_IMPORT) {
      if (!(await confirmDialog('Large import', `This import creates ${create} cards in the Inbox, more than ${MAX_IMPORT}. Create them all?`, `Create ${create} cards`))) return;
      confirmLarge = true;
    }
    const items = st.items.map((it) => ({ title: it.title, text: it.text, acceptance: it.acceptance, action: actionOf(it), ...(actionOf(it) === 'merge' ? { into: it.duplicate.id } : {}) }));
    st.busy = true;
    renderImport();
    try {
      const done = await api.importDiscoveryItems(inbox.projectId, items, st.name ? { name: st.name, text: st.text } : { pasted: true }, confirmLarge);
      closeImport();
      const parts = [`${plural(done.created.length, 'card')} created`, done.merged.length ? `${done.merged.length} merged` : '', done.skipped ? `${done.skipped} skipped` : ''].filter(Boolean);
      showToast(`Imported ${st.name || 'the pasted text'}`, `${parts.join(', ')} in the Inbox.`);
    } catch (e) {
      st.busy = false;
      st.message = errMsg(e);
      renderImport();
    }
    await refresh();
  }

  function onImportClick(e) {
    const st = inbox.importing;
    const card = e.target.closest('[data-import-card]');
    if (card) return openCard(card.dataset.importCard);
    const b = e.target.closest('[data-import-op]');
    if (!b || !st) return undefined;
    const op = b.dataset.importOp;
    const i = Number(b.dataset.index);
    const title = st.items?.[i]?.title;
    if (op === 'cancel') return closeImport();
    if (op === 'pick') return $('#inbox-import-file').click();
    if (op === 'paste') {
      const text = String($('#inbox-import-text')?.value || '');
      if (!text.trim()) { st.message = 'Paste the text first, or choose a file.'; return renderImport(); }
      return previewText(text, '');
    }
    if (op === 'confirm') return confirmImport();
    if (op === 'undo') { st.items = st.undo.items; st.undo = null; st.picking = null; st.renaming = null; return renderImport(); }
    if (op === 'drop') return editImport({ op: 'drop', index: i }, `Dropped "${title}".`);
    if (op === 'merge' || op === 'nest') { st.picking = { op, index: i }; renderImport(); return $('#inbox-import-target')?.focus({ preventScroll: true }); }
    if (op === 'unpick') { st.picking = null; return renderImport(); }
    if (op === 'rename') { st.renaming = i; renderImport(); return $('#inbox-import-rename')?.select(); }
    if (op === 'rename-cancel') { st.renaming = null; return renderImport(); }
    if (op === 'rename-save') return saveRename(i);
    if (op === 'apply') {
      const to = Number($('#inbox-import-target').value);
      const verb = st.picking.op === 'merge' ? 'Merged' : 'Nested';
      return editImport({ op: st.picking.op, index: i, to }, `${verb} "${title}" ${st.picking.op === 'merge' ? 'into' : 'under'} "${st.items[to]?.title}".`);
    }
    return undefined;
  }

  // Save of a rename: an empty title is refused, the same one just closes the field.
  function saveRename(i) {
    const st = inbox.importing;
    const title = String($('#inbox-import-rename')?.value || '').trim();
    if (!title) { st.message = 'An item needs a title.'; renderImport(); return undefined; }
    if (title === st.items[i].title) { st.renaming = null; return renderImport(); }
    return editImport({ op: 'rename', index: i, title }, `Renamed "${st.items[i].title}" to "${title}".`);
  }

  function onImportChange(e) {
    const st = inbox.importing;
    if (e.target.id === 'inbox-import-file') { importFile(e.target.files?.[0]); e.target.value = ''; return; }
    if (!st?.items || e.target.dataset.importAction === undefined) return;
    const i = Number(e.target.dataset.importAction);
    st.items = st.items.map((it, k) => (k === i ? { ...it, action: e.target.value } : it));
    renderImport();
  }

  // In the rename field: Enter saves, Esc cancels (and leaves the preview open).
  function onImportKey(e) {
    const st = inbox.importing;
    if (e.target.id !== 'inbox-import-rename' || !st || e.isComposing) return;
    if (e.key === 'Enter') { e.preventDefault(); saveRename(st.renaming); }
    else if (e.key === 'Escape') { e.preventDefault(); st.renaming = null; renderImport(); }
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
            <label for="inbox-edit-title">${t('inbox.title')} <span class="req">*</span></label>
            <input type="text" id="inbox-edit-title" maxlength="200" value="${esc(c.title)}" />
          </div>
          <div class="field">
            <label for="inbox-edit-doc">${t('inbox.document_markdown')}</label>
            <textarea id="inbox-edit-doc" rows="12" class="mono">${esc(c.document)}</textarea>
          </div>
          <div class="row">
            <span class="spacer"></span>
            <button type="button" class="btn sm ghost" data-detail="cancel-edit">${t('common.cancel')}</button>
            <button type="button" class="btn sm primary" data-detail="save">${t('common.save')}</button>
          </div>
        </div>`;
    }
    return String(c.document || '').trim()
      ? `<article class="md md-compact inbox-doc">${markdownHtml(c.document)}</article>`
      : `<p class="muted small">${t('inbox.no_document_yet_edit_the_card')}</p>`;
  }

  function renderDetail() {
    const c = inbox.open;
    if (!c) return;
    $('#inbox-layout').classList.add('with-detail');
    $('#inbox-detail').innerHTML = `
      <aside class="inbox-detail" data-testid="inbox-card-detail" aria-label="${t('inbox.card_title', { title: esc(c.title) })}">
        <div class="inbox-detail-head">
          <h2 data-testid="card-document-title" title="${esc(c.title)}">${esc(c.title)}</h2>
          <button type="button" class="btn sm ghost" data-detail="close" title="${t('inbox.close_esc')}">${t('common.close')}</button>
        </div>
        <p class="inbox-card-meta muted small">
          <span class="badge">${esc(c.type)}</span>
          <span>${esc(c.author)}</span>
          <span>${esc(dateOf(c.created))}</span>
          <span class="mono" title="${t('inbox.the_card_s_folder_in_the')}">${esc(c.id)}</span>
        </p>
        <div class="row inbox-triage" role="group" aria-label="${t('inbox.triage')}">
          <button type="button" class="btn sm primary" data-testid="card-accept" data-detail="accept" title="${t('inbox.move_to_discovery_triage')}">${t('inbox.accept')}</button>
          <button type="button" class="btn sm ghost" data-testid="card-merge" data-detail="merge" title="${t('inbox.join_this_card_s_document_and')}">${t('inbox.merge_into')}</button>
          <button type="button" class="btn sm ghost danger" data-testid="card-discard" data-detail="discard" title="${t('inbox.archive_with_a_reason')}">${t('inbox.discard')}</button>
        </div>
        <p id="inbox-detail-error" class="error small"></p>
        <section class="inbox-section">
          <div class="inbox-section-head">
            <h3>${t('inbox.document')}</h3>
            ${inbox.editing ? '' : `<button type="button" class="btn sm ghost" data-detail="edit">${t('inbox.edit')}</button>`}
          </div>
          ${documentHtml(c)}
        </section>
        <section class="inbox-section">
          <div class="inbox-section-head">
            <h3>${t('inbox.attachments')}</h3>
            <button type="button" class="btn sm ghost" data-detail="attach">${t('inbox.attach_files')}</button>
            <input type="file" id="inbox-detail-file" class="hidden" multiple aria-label="${t('inbox.attach_files_to_the_card')}" />
          </div>
          <div id="inbox-detail-files" class="inbox-files"></div>
        </section>
        <section class="inbox-section">
          <div class="inbox-section-head"><h3>${t('inbox.thread')}</h3></div>
          <div id="inbox-detail-thread" class="inbox-thread"></div>
          <div class="inbox-note">
            <textarea id="inbox-note" rows="2" placeholder="${t('inbox.add_a_note_enter_sends')}" aria-label="${t('inbox.add_a_note')}"></textarea>
            <button type="button" class="btn sm" data-detail="note">${t('inbox.add_note')}</button>
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
    if (!c.attachments.length) return `<p class="muted small">${t('inbox.no_attachment_paste_or_drop_images')}</p>`;
    return c.attachments.map((name) => {
      const url = previews.get(`${c.id}/${name}`)?.dataUrl;
      return `
      <span class="inbox-file${url ? ' image' : ''}" title="${esc(name)}">
        ${url ? `<img class="inbox-thumb" ${window.ImageViewer?.THUMB || 'tabindex="0" role="button"'} src="${esc(url)}" alt="${esc(name)}" data-detail="view" data-name="${esc(name)}" />` : ''}
        <button type="button" class="link-btn inbox-file-name" data-detail="view" data-name="${esc(name)}">${esc(name)}</button>
        <button type="button" class="inbox-file-x" data-detail="unattach" data-name="${esc(name)}" aria-label="${t('inbox.remove_name', { name: esc(name) })}">×</button>
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
        ${m.runId ? `<div class="muted small inbox-entry-run"><button type="button" class="link-btn small" data-open-run="${esc(m.runId)}" data-testid="thread-run" title="${t('inbox.open_the_run')}">${t('inbox.run')} ${esc(m.runId)}</button>${typeof m.costUsd === 'number' ? ` · <span data-testid="thread-run-cost">$${esc(m.costUsd.toFixed(2))}</span>` : ''}</div>` : ''}
      </div>`).join('') : `<p class="muted small">${t('inbox.no_note_yet')}</p>`);

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
    // a thread entry's run (a result that came back to the card) opens on the Run screen
    const run = e.target.closest('[data-open-run]');
    if (run) { selectRun(run.dataset.openRun); return; }
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
    // the import's preview closes before the open card, writing nothing (#322)
    if (inbox.importing && !document.querySelector('.modal:not(.hidden)')) return closeImport();
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
            <h1>${t('inbox.inbox')}</h1>
            <p class="muted small">${t('inbox.raw_ideas_of_the_project_chosen')}<span class="mono">${t('inbox.discovery')}</span>${t('inbox.never_on_the_git_platform_accept')}</p>
          </div>
          <button type="button" id="btn-inbox-import" class="btn" data-testid="inbox-import" title="${t('inbox.import_a_backlog_document_md_txt')}">${t('inbox.import')}</button>
        </div>
        <div id="inbox-import-panel" class="inbox-import hidden" role="region" aria-label="${t('inbox.import_a_backlog_document')}"></div>
        <div id="inbox-capture-box" class="inbox-capture" role="group" aria-label="${t('inbox.quick_capture')}">
          <div class="field">
            <label for="inbox-title">${t('inbox.idea')} <span class="req">*</span></label>
            <input type="text" id="inbox-title" data-testid="inbox-capture-title" maxlength="200" placeholder="${t('inbox.a_title_for_the_idea')}" autocomplete="off" />
          </div>
          <div class="field">
            <label for="inbox-text">${t('inbox.details')}</label>
            <textarea id="inbox-text" data-testid="inbox-capture-text" rows="3" placeholder="${t('inbox.what_is_it_about_paste_or')}"></textarea>
            <p class="hint">${t('inbox.enter_captures_shift_enter_adds_a')}</p>
          </div>
          <div id="inbox-files" class="inbox-files"></div>
          <p id="inbox-capture-error" class="error small"></p>
          <div class="row">
            <button type="button" id="btn-inbox-attach" class="btn sm ghost">${t('inbox.attach_files')}</button>
            <input type="file" id="inbox-file-input" class="hidden" multiple aria-label="${t('inbox.attach_files_to_the_idea')}" />
            <span class="spacer"></span>
            <button type="button" id="inbox-capture" class="btn primary">${t('inbox.capture')}</button>
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
      <h3>${t('inbox.discard_card')}</h3>
      <p id="inbox-discard-what" class="muted small"></p>
      <div class="field">
        <label for="inbox-discard-reason">${t('inbox.reason')} <span class="req">*</span></label>
        <textarea id="inbox-discard-reason" data-testid="discard-reason" rows="3" placeholder="${t('inbox.why_is_it_discarded_kept_with')}"></textarea>
      </div>
      <p id="inbox-discard-error" class="error small"></p>
      <div class="modal-actions">
        <span class="spacer"></span>
        <button type="button" id="btn-inbox-discard-cancel" class="btn ghost">${t('common.cancel')}</button>
        <button type="submit" class="btn danger-solid" data-testid="discard-confirm">${t('inbox.discard')}</button>
      </div>
    </form>
  </div>
  <div id="inbox-merge-modal" class="modal hidden">
    <form id="inbox-merge-form" class="modal-card">
      <h3>${t('inbox.merge_into')}</h3>
      <p id="inbox-merge-what" class="muted small"></p>
      <div class="field">
        <label for="inbox-merge-target">${t('inbox.card')}</label>
        <select id="inbox-merge-target" data-testid="merge-target"></select>
      </div>
      <p id="inbox-merge-error" class="error small"></p>
      <div class="modal-actions">
        <span class="spacer"></span>
        <button type="button" id="btn-inbox-merge-cancel" class="btn ghost">${t('common.cancel')}</button>
        <button type="submit" id="btn-inbox-merge" class="btn primary" data-testid="merge-confirm">${t('inbox.merge')}</button>
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

      $('#btn-inbox-import').onclick = openImport;
      const imp = importBox();
      imp.onclick = onImportClick;
      imp.addEventListener('change', onImportChange);
      imp.addEventListener('keydown', onImportKey);
      imp.addEventListener('dragover', (e) => { if (hasFiles(e)) { e.preventDefault(); imp.classList.add('dropping'); } });
      imp.addEventListener('dragleave', () => imp.classList.remove('dropping'));
      imp.addEventListener('drop', (e) => {
        imp.classList.remove('dropping');
        if (!e.dataTransfer?.files?.length) return;
        e.preventDefault();
        importFile(e.dataTransfer.files[0]);
      });

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
