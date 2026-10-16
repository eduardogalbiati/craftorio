/* global api */
// Diff viewer (#118): a run's changed files reviewed like GitHub's "Files changed", near full
// screen over the screen, which does not change (a gate keeps its choice and its feedback text).
// Opened from a gate's Show the diff and Changed files entries (gate-panel.js, scrolled to that
// file) and from the Run screen's Review changes (any run with a worktree or reported files).
// - left: the changed files grouped by folder, an added / modified / deleted / renamed icon, +n −m,
//   a filter box, Viewed marks remembered per run (localStorage multiagent.diffViewed.<runId>) and
//   "n of m viewed"; ↑ / ↓ or j / k move between files;
// - middle: the selected file's diff, Split (before | after, aligned, line numbers on both sides) or
//   Unified, remembered (multiagent.diffMode), with syntax highlighting, word-level highlights,
//   collapsed unchanged regions (↑ / ↓ 20 lines or all, from both sides' contents) and wrap on/off
//   (multiagent.diffWrap); a binary file says so (an image shows before / after previews, opened in
//   ImageViewer on click), a huge one is collapsed with "Load diff";
// - top: the commit picker (all the branch's changes or one commit), the mode, wrap, close (Esc).
// A simulated run, or one without a worktree, lists the files the developer reported with a note.
// Data: api.runDiff / api.runDiffFile (src/service/areas/diff.js); the pure part is
// diff-viewer-model.js. DiffViewer.open({ runId, approvalId?, file?, title? }).
(() => {
  const M = window.DiffViewerModel;
  const MODE_KEY = 'multiagent.diffMode';
  const WRAP_KEY = 'multiagent.diffWrap';
  const viewedKey = (runId) => `multiagent.diffViewed.${runId}`;
  const stored = (k, fallback) => { try { return localStorage.getItem(k) ?? fallback; } catch { return fallback; } };
  const store = (k, v) => { try { localStorage.setItem(k, v); } catch { /* storage unavailable */ } };
  const readViewed = (runId) => { try { return new Set(JSON.parse(localStorage.getItem(viewedKey(runId)) || '[]')); } catch { return new Set(); } };
  let cur = null;

  function open(opts = {}) {
    close();
    const el = document.createElement('div');
    el.className = 'dv';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-modal', 'true');
    el.setAttribute('aria-label', t('diff_viewer.changes'));
    el.innerHTML = `<div class="dv-card">
        <div class="dv-bar">
          <div class="dv-title"><b>${t('diff_viewer.changes')}</b>${opts.title ? ` <span class="dv-run" title="${esc(opts.title)}">${esc(opts.title)}</span>` : ''}<span class="dv-range muted small mono" data-dv-range></span></div>
          <label class="dv-commit small hidden" title="${t('diff_viewer.all_the_branch_s_changes_or')}">${t('diff_viewer.commits')} <select data-dv-commit></select></label>
          <div class="seg sm" role="group" aria-label="${t('diff_viewer.diff_layout')}">
            <button type="button" data-dv-mode="split" title="${t('diff_viewer.before_on_the_left_after_on')}">${t('diff_viewer.split')}</button>
            <button type="button" data-dv-mode="unified" title="${t('diff_viewer.one_column_removed_and_added_lines')}">${t('diff_viewer.unified')}</button>
          </div>
          <label class="small dv-wrap"><input type="checkbox" data-dv-wrap> ${t('diff_viewer.wrap_lines')}</label>
          <span class="badge" data-dv-viewed></span>
          <button type="button" class="btn sm ghost" data-dv-close title="${t('diff_viewer.close_esc')}" aria-label="${t('common.close')}">✕</button>
        </div>
        <div class="dv-note small hidden" data-dv-note></div>
        <div class="dv-body">
          <aside class="dv-files">
            <input type="text" class="dv-filter" data-dv-filter placeholder="${t('diff_viewer.filter_files')}" spellcheck="false" aria-label="${t('diff_viewer.filter_files_2')}">
            <div class="dv-list" data-dv-list role="listbox" tabindex="0" aria-label="${t('diff_viewer.changed_files_or_j_k')}"></div>
            <div class="dv-totals small muted" data-dv-totals></div>
          </aside>
          <section class="dv-main" data-dv-main></section>
        </div>
      </div>`;
    document.body.appendChild(el);
    cur = {
      el, runId: String(opts.runId || ''), approvalId: opts.approvalId || null, want: opts.file || null,
      // commit (#289): open on one of the branch's commits (the Commits select set to it)
      data: null, error: null, commit: opts.commit ? String(opts.commit) : null, selected: null, filter: '', files: new Map(), seq: 0,
      mode: stored(MODE_KEY, 'split') === 'unified' ? 'unified' : 'split', wrap: stored(WRAP_KEY, '0') === '1',
      viewed: readViewed(opts.runId), opener: document.activeElement,
    };
    el.addEventListener('click', onClick);
    el.addEventListener('change', onChange);
    el.querySelector('[data-dv-filter]').addEventListener('input', (e) => { cur.filter = e.target.value; paintList(); });
    window.addEventListener('keydown', onKey, true);
    paintBar();
    load();
    el.querySelector('[data-dv-list]').focus({ preventScroll: true });
  }

  function close() {
    if (!cur) return;
    const { el, opener } = cur;
    cur = null;
    window.removeEventListener('keydown', onKey, true);
    el.remove();
    if (opener?.isConnected && typeof opener.focus === 'function') opener.focus({ preventScroll: true });
  }

  // The run's files (all changes or cur.commit's), then the file asked for (or the first one).
  async function load() {
    const seq = ++cur.seq;
    cur.data = null;
    cur.error = null;
    cur.files = new Map();
    paintList();
    paintMain();
    try {
      const data = await api.runDiff(cur.runId, cur.approvalId, cur.commit);
      if (!cur || seq !== cur.seq) return;
      cur.data = data || { files: [], commits: [] };
    } catch (e) {
      if (!cur || seq !== cur.seq) return;
      cur.error = errMsg(e);
    }
    const files = cur.data?.files || [];
    const want = files.find((f) => f.file === cur.want || f.file === cur.selected) || files[0];
    cur.want = null;
    cur.selected = want ? want.file : null;
    paintBar();
    paintList();
    paintMain();
  }

  const fileOf = (path) => cur.data?.files.find((f) => f.file === path) || null;
  // per file: { contents: { before, after } | null, patch (a loaded huge one), expanded, loading, error }
  const fileState = (path) => {
    if (!cur.files.has(path)) cur.files.set(path, { contents: null, patch: null, expanded: {}, loading: false, error: null });
    return cur.files.get(path);
  };
  const visibleFiles = () => {
    const q = cur.filter.trim().toLowerCase();
    return (cur.data?.files || []).filter((f) => !q || f.file.toLowerCase().includes(q) || (f.oldFile || '').toLowerCase().includes(q));
  };
  // the list's order (by folder), the one j / k walk
  const orderedFiles = () => M.groupByFolder(visibleFiles()).flatMap((g) => g.files);

  function paintBar() {
    const { el, data } = cur;
    el.querySelectorAll('[data-dv-mode]').forEach((b) => {
      const on = b.dataset.dvMode === cur.mode;
      b.classList.toggle('active', on);
      b.setAttribute('aria-pressed', String(on));
    });
    el.querySelector('[data-dv-wrap]').checked = cur.wrap;
    const commits = data?.commits || [];
    const pick = el.querySelector('[data-dv-commit]');
    pick.closest('.dv-commit').classList.toggle('hidden', !commits.length);
    pick.innerHTML = `<option value="">${t('diff_viewer.all_changes_length_commit_value', { length: commits.length, value: commits.length === 1 ? '' : 's' })}</option>${commits.map((c) => `<option value="${esc(c.sha)}" title="${esc(`${c.subject} · ${c.author} · ${c.date}`)}">${esc(c.short)} ${esc(c.subject.length > 60 ? `${c.subject.slice(0, 59)}…` : c.subject)}</option>`).join('')}`;
    pick.value = cur.commit || '';
    const range = el.querySelector('[data-dv-range]');
    range.textContent = data?.base ? (cur.commit ? `commit ${cur.commit.slice(0, 7)}` : `${data.base}...HEAD`) : '';
    range.title = data?.base ? (cur.commit ? t('diff_viewer.only_this_commit_s_changes_against') : t('diff_viewer.git_diff_find_renames_base_head', { base: data.base, base2: data.base })) : '';
    const note = el.querySelector('[data-dv-note]');
    const why = data?.simulated ? 'Simulated: no diff. These are the files the developer reported.'
      : data?.unavailable ? `No diff: ${data.unavailable} These are the files the developer reported.` : '';
    note.textContent = why;
    note.classList.toggle('hidden', !why);
    paintViewed();
  }

  function paintViewed() {
    const files = cur.data?.files || [];
    const n = files.filter((f) => cur.viewed.has(f.file)).length;
    const badge = cur.el.querySelector('[data-dv-viewed]');
    badge.textContent = files.length ? t('diff_viewer.n_of_length_viewed', { n, length: files.length }) : '';
    badge.classList.toggle('hidden', !files.length);
    badge.classList.toggle('ok', !!files.length && n === files.length);
  }

  const counts = (f) => (f.added == null && f.deleted == null ? '' : `<span class="dv-add">+${f.added ?? 0}</span> <span class="dv-del">−${f.deleted ?? 0}</span>`);

  function paintList() {
    const list = cur.el.querySelector('[data-dv-list]');
    const totals = cur.el.querySelector('[data-dv-totals]');
    if (!cur.data) {
      list.innerHTML = `<p class="muted small dv-empty">${cur.error ? t('diff_viewer.could_not_load_the_files') : t('diff_viewer.loading')}</p>`;
      totals.textContent = '';
      return;
    }
    const groups = M.groupByFolder(visibleFiles());
    list.innerHTML = groups.length ? groups.map((g) => `<div class="dv-folder small muted" title="${esc(g.folder || t('diff_viewer.the_repository_s_root'))}">${esc(g.folder || '/')}</div>
      ${g.files.map((f) => {
        const [icon, label] = M.fileIcon(f.status);
        const name = f.file.split('/').pop();
        const sel = f.file === cur.selected;
        return `<div class="dv-item${sel ? ' active' : ''}${cur.viewed.has(f.file) ? ' viewed' : ''}" role="option" aria-selected="${sel}" data-dv-file="${esc(f.file)}" title="${esc(f.oldFile ? `${f.oldFile} → ${f.file}` : f.file)}">
          <span class="dv-icon st-${esc(f.status)}" title="${esc(label)}" aria-label="${esc(label)}">${icon}</span>
          <span class="dv-name">${esc(name)}</span>
          <span class="dv-counts small mono">${counts(f)}</span>
          ${cur.viewed.has(f.file) ? `<span class="dv-seen" title="${t('diff_viewer.viewed')}">✓</span>` : ''}
        </div>`;
      }).join('')}`).join('') : `<p class="muted small dv-empty">${cur.data.files.length ? t('diff_viewer.no_file_matches_the_filter') : t('diff_viewer.no_changed_files')}</p>`;
    const files = cur.data.files;
    const sum = (k) => files.reduce((s, f) => s + (f[k] || 0), 0);
    totals.innerHTML = files.length ? `${files.length} file${files.length === 1 ? '' : 's'}${files.some((f) => f.added != null) ? ` · ${counts({ added: sum('added'), deleted: sum('deleted') })}` : ''}` : '';
  }

  function select(path) {
    if (!path || path === cur.selected) return;
    cur.selected = path;
    paintList();
    paintMain();
    cur.el.querySelector(`[data-dv-file="${CSS.escape(path)}"]`)?.scrollIntoView({ block: 'nearest' });
    cur.el.querySelector('.dv-scroll')?.scrollTo(0, 0);
  }

  function move(step) {
    const files = orderedFiles();
    if (!files.length) return;
    const i = files.findIndex((f) => f.file === cur.selected);
    select(files[Math.min(files.length - 1, Math.max(0, i < 0 ? 0 : i + step))].file);
  }

  function toggleViewed(path) {
    if (cur.viewed.has(path)) cur.viewed.delete(path);
    else cur.viewed.add(path);
    store(viewedKey(cur.runId), JSON.stringify([...cur.viewed]));
    paintViewed();
    paintList();
    paintMain();
  }

  // The file's patch, both sides' contents and image previews, once (api.runDiffFile).
  async function loadFile(path) {
    const f = fileOf(path);
    const st = fileState(path);
    if (!f || st.loading || st.contents) return;
    st.loading = true;
    st.error = null;
    paintMain();
    const seq = cur.seq;
    try {
      const r = await api.runDiffFile(cur.runId, cur.approvalId, cur.commit, f.file, f.oldFile);
      if (!cur || seq !== cur.seq) return;
      st.contents = { before: r?.before ?? null, after: r?.after ?? null };
      st.patch = r?.patch || null;
    } catch (e) {
      if (!cur || seq !== cur.seq) return;
      st.error = errMsg(e);
    }
    st.loading = false;
    if (path === cur.selected) paintMain();
  }

  function paintMain() {
    const main = cur.el.querySelector('[data-dv-main]');
    if (!cur.data) {
      main.innerHTML = cur.error ? `<div class="dv-msg"><p class="error">${t('diff_viewer.could_not_load_the_changes')} ${esc(cur.error)}</p><button type="button" class="btn sm" data-dv-retry>${t('diff_viewer.retry')}</button></div>`
        : `<div class="dv-msg muted">${t('diff_viewer.loading_the_changes')}</div>`;
      return;
    }
    const f = fileOf(cur.selected);
    if (!f) {
      main.innerHTML = `<div class="dv-msg muted">${cur.data.files.length ? t('diff_viewer.pick_a_file_on_the_left') : t('diff_viewer.this_branch_changes_no_file')}</div>`;
      return;
    }
    const [icon, label] = M.fileIcon(f.status);
    const seen = cur.viewed.has(f.file);
    const head = `<div class="dv-file-head">
        <span class="badge dv-status st-${esc(f.status)}" title="${esc(label)}">${icon} ${esc(label.split(' ')[0].toLowerCase())}</span>
        <span class="dv-path mono" title="${esc(f.file)}">${f.oldFile ? `<span class="muted">${esc(f.oldFile)} → </span>` : ''}${esc(f.file)}</span>
        <span class="dv-counts small mono">${counts(f)}</span>
        <label class="small dv-viewed-box${seen ? ' on' : ''}"><input type="checkbox" data-dv-viewed-file="${esc(f.file)}"${seen ? ' checked' : ''}> ${t('diff_viewer.viewed')}</label>
      </div>`;
    const scroll = main.querySelector('.dv-scroll');
    const keep = scroll && main.dataset.file === f.file ? scroll.scrollTop : 0;
    main.dataset.file = f.file;
    main.innerHTML = `${head}<div class="dv-scroll${cur.wrap ? ' wrap' : ''}">${bodyHtml(f)}</div>`;
    main.querySelector('.dv-scroll').scrollTop = keep;
  }

  function bodyHtml(f) {
    const st = fileState(f.file);
    const msg = (text, extra = '') => `<div class="dv-msg muted">${text}${extra}</div>`;
    if (f.status === 'reported') return msg(cur.data.simulated ? 'Simulated: no diff for this file.' : 'No diff: the run\'s worktree could not be read.');
    if (st.error) return msg(`<span class="error">${t('diff_viewer.could_not_load_this_file')} ${esc(st.error)}</span>`, ` <button type="button" class="btn sm" data-dv-load>${t('diff_viewer.retry')}</button>`);
    if (f.binary && f.image) {
      if (!st.contents) { loadFile(f.file); return msg('Loading the previews…'); }
      const pane = (src, label) => `<figure class="dv-img"><figcaption class="small muted">${label}</figcaption>${src ? `<img src="${esc(src)}" alt="${label}" tabindex="0" role="button" title="${t('diff_viewer.click_to_enlarge')}" data-dv-image="${label}">` : `<div class="dv-img-none muted small">${t('diff_viewer.none')}</div>`}</figure>`;
      return `<div class="dv-images">${pane(st.contents.before, 'Before')}${pane(st.contents.after, 'After')}</div>`;
    }
    if (f.binary) return msg('Binary file changed.');
    const patch = f.patch || st.patch;
    if (!patch) {
      if (f.large) {
        if (st.loading) return msg('Loading the diff…');
        return msg(`This diff is large (${(f.added || 0) + (f.deleted || 0)} lines changed): collapsed.`, ` <button type="button" class="btn sm" data-dv-load>${t('diff_viewer.load_diff')}</button>`);
      }
      return msg('No diff for this file.');
    }
    const parsed = M.parsePatch(patch);
    if (parsed.binary) return msg('Binary file changed.');
    if (!parsed.hunks.length) return msg(f.status === 'renamed' ? 'File renamed without changes.' : 'No content changes (empty file or mode change).');
    const list = M.rows(parsed, st.contents, st.expanded);
    return cur.mode === 'split' ? splitHtml(list, f.file, st) : unifiedHtml(list, f.file, st);
  }

  // The changed ranges of a removed/added line (its partner in the same block), else none.
  function rangesOf(pairs, row) {
    const other = pairs.get(row);
    if (!other) return [];
    const w = row.type === '-' ? M.wordDiff(row.text, other.text) : M.wordDiff(other.text, row.text);
    return row.type === '-' ? w.a : w.b;
  }

  function gapHtml(g, cols, st) {
    const n = g.hidden == null ? 'More unchanged lines' : `${g.hidden} unchanged line${g.hidden === 1 ? '' : 's'}`;
    const busy = st.loading ? ' disabled' : '';
    const b = (dir, text, title) => `<button type="button" class="btn sm ghost" data-dv-expand="${dir}" data-gap="${g.index}" title="${title}"${busy}>${text}</button>`;
    return `<tr class="dv-gap"><td colspan="${cols}">
      ${g.down ? b('down', `↓ ${M.EXPAND_STEP}`, `Show ${M.EXPAND_STEP} more lines below`) : ''}
      ${g.up ? b('up', `↑ ${M.EXPAND_STEP}`, `Show ${M.EXPAND_STEP} more lines above`) : ''}
      ${b('all', 'Expand all', 'Show every unchanged line here')}
      <span class="small muted">${n}</span></td></tr>`;
  }

  const hunkHtml = (r, cols) => `<tr class="dv-hunk"><td colspan="${cols}" class="mono small" title="${esc(r.header)}">${esc(r.header)}</td></tr>`;
  const num = (n) => (n == null ? '' : n);
  const cls = (r) => (r.type === '-' ? 'del' : r.type === '+' ? 'add' : r.expanded ? 'ctx exp' : 'ctx');

  function unifiedHtml(list, file, st) {
    const pairs = M.partners(list);
    const body = list.map((r) => {
      if (r.kind === 'gap') return gapHtml(r, 3, st);
      if (r.kind === 'hunk') return hunkHtml(r, 3);
      return `<tr class="dv-line ${cls(r)}"><td class="dv-no">${num(r.oldNo)}</td><td class="dv-no">${num(r.newNo)}</td><td class="dv-code"><span class="dv-sign">${r.type === ' ' ? ' ' : r.type === '-' ? '−' : '+'}</span>${M.highlightHtml(r.text, file, rangesOf(pairs, r))}</td></tr>`;
    }).join('');
    return `<table class="dv-table unified"><colgroup><col class="dv-no-col"><col class="dv-no-col"><col></colgroup><tbody>${body}</tbody></table>`;
  }

  function splitHtml(list, file, st) {
    const pairs = M.partners(list);
    const side = (r, no) => (r ? `<td class="dv-no ${cls(r)}">${num(r[no])}</td><td class="dv-code ${cls(r)}">${M.highlightHtml(r.text, file, r.type === ' ' ? [] : rangesOf(pairs, r))}</td>` : '<td class="dv-no blank"></td><td class="dv-code blank"></td>');
    const body = M.splitRows(list).map((p) => {
      if (p.kind === 'gap') return gapHtml(p, 4, st);
      if (p.kind === 'hunk') return hunkHtml(p, 4);
      return `<tr class="dv-line">${side(p.left, 'oldNo')}${side(p.right, 'newNo')}</tr>`;
    }).join('');
    return `<table class="dv-table split"><colgroup><col class="dv-no-col"><col><col class="dv-no-col"><col></colgroup><tbody>${body}</tbody></table>`;
  }

  async function onExpand(b) {
    const path = cur.selected;
    const st = fileState(path);
    if (!st.contents) await loadFile(path);
    if (!cur || !st.contents) return;
    st.expanded = M.expand(st.expanded, +b.dataset.gap, b.dataset.dvExpand);
    paintMain();
  }

  // The viewer with every changed image of the list (#182), in its order, each before/after pair one
  // item, at the selected file's side
  async function openImages(label) {
    if (!window.ImageViewer) return;
    const selected = cur.selected;
    const changed = orderedFiles().filter((f) => f.binary && f.image);
    await Promise.all(changed.map((f) => loadFile(f.file)));
    if (!cur || cur.selected !== selected) return;
    const itemOf = (path) => {
      const st = fileState(path);
      const images = [['Before', st.contents?.before], ['After', st.contents?.after]].filter(([, src]) => src).map(([l, src]) => ({ src, label: l, caption: path }));
      return images.length ? { title: path, images } : null;
    };
    const paths = changed.some((f) => f.file === selected) ? changed.map((f) => f.file) : [selected];
    const items = paths.map((p) => (p === selected || fileState(p).contents ? itemOf(p) : null)).filter(Boolean);
    const index = items.findIndex((it) => it.title === selected);
    if (index < 0) return;
    ImageViewer.open({ title: selected, items, index, imageIndex: Math.max(0, items[index].images.findIndex((im) => im.label === label)) });
  }

  function onClick(e) {
    const t = e.target;
    if (t.closest('[data-dv-close]')) { close(); return; }
    if (t.closest('[data-dv-retry]')) { load(); return; }
    const mode = t.closest('[data-dv-mode]');
    if (mode) { cur.mode = mode.dataset.dvMode; store(MODE_KEY, cur.mode); paintBar(); paintMain(); return; }
    const item = t.closest('[data-dv-file]');
    if (item) { select(item.dataset.dvFile); return; }
    const exp = t.closest('[data-dv-expand]');
    if (exp) { onExpand(exp); return; }
    if (t.closest('[data-dv-load]')) { const st = fileState(cur.selected); st.error = null; loadFile(cur.selected); return; }
    const img = t.closest('[data-dv-image]');
    if (img) { openImages(img.dataset.dvImage); return; }
    if (t === cur.el) close(); // the overlay around the card
  }

  function onChange(e) {
    const t = e.target;
    if (t.matches('[data-dv-wrap]')) { cur.wrap = t.checked; store(WRAP_KEY, cur.wrap ? '1' : '0'); paintMain(); }
    else if (t.matches('[data-dv-commit]')) { cur.commit = t.value || null; load(); }
    else if (t.matches('[data-dv-viewed-file]')) toggleViewed(t.dataset.dvViewedFile);
  }

  function onKey(e) {
    if (!cur || window.ImageViewer?.isOpen?.()) return; // the image viewer above handles its keys
    const typing = e.target?.matches?.('input[type="text"], select, textarea');
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation(); // the screen behind never sees it (Esc closes only the viewer)
      if (e.target?.matches?.('[data-dv-filter]') && cur.filter) { e.target.value = ''; cur.filter = ''; paintList(); return; } // clears the filter first
      close();
      return;
    }
    if (e.key === 'Tab') { trapFocus(e); return; }
    if (e.key === 'Enter' && e.target?.matches?.('[data-dv-image]')) { e.preventDefault(); openImages(e.target.dataset.dvImage); return; }
    if (typing || e.ctrlKey || e.metaKey || e.altKey) return;
    const step = { ArrowDown: 1, j: 1, ArrowUp: -1, k: -1 }[e.key];
    if (!step || (e.key.startsWith('Arrow') && !e.target?.closest?.('[data-dv-list]'))) return;
    e.preventDefault();
    e.stopPropagation();
    move(step);
  }

  // Tab stays inside the viewer
  function trapFocus(e) {
    const list = [...cur.el.querySelectorAll('button:not([disabled]), input, select, [tabindex="0"]')].filter((x) => x.offsetParent !== null);
    if (!list.length) return;
    const i = list.indexOf(document.activeElement);
    const next = e.shiftKey ? (i <= 0 ? list.length - 1 : i - 1) : (i + 1) % list.length;
    e.preventDefault();
    list[next].focus({ preventScroll: true });
  }

  window.DiffViewer = { close, isOpen: () => !!cur, open };
})();
