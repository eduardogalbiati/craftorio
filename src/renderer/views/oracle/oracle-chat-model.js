// The Oracle's chat as pure state (#171), like views/runchat/run-chat-model.js: from the history
// (oracle:history), the service state (oracle:state) and the drafts, the drawer's state (empty,
// conversation, answering, error, paused, unavailable), the unread count, whether Send is
// enabled, the pasted images, the memory form, a message's meta line and where a link goes.
// No DOM here: views/oracle/oracle.js renders it, a test feeds it plain objects.
// Browser: window.OracleChatModel; Node: module.exports.
(function (root) {
  // src/oracle.js ATTACHMENT_LIMITS (the service checks them again)
  const LIMITS = Object.freeze({ maxBytes: 5 * 1048576, maxCount: 4 });
  const IMAGE_TYPES = ['image/gif', 'image/jpeg', 'image/png', 'image/webp'];
  // a run id (20261002-003425-77147dbf), an issue (#171, not an HTML entity), a run's file
  const RUN_ID = /\b\d{8}-\d{6}-[0-9a-f]{8}\b/g;
  const ISSUE = /(^|[^\w&/#])#(\d{1,6})\b/g;
  const RUN_FILE = /[\\/]runs[\\/](\d{8}-\d{6}-[0-9a-f]{8})[\\/]/;
  const ABS_PATH = /^(?:[A-Za-z]:[\\/]|\/)[^\s]*$/;

  const isError = (m) => m?.role === 'system' && !!m.error;
  const ms = (t) => { const n = Date.parse(t || ''); return Number.isFinite(n) ? n : 0; };

  /** The Oracle's answers after the last read time (null: never read, all of them). */
  function unreadCount(messages = [], readAt = null) {
    const after = ms(readAt);
    return messages.filter((m) => m.role === 'oracle' && (!readAt || ms(m.ts) > after)).length;
  }

  /**
   * The drawer's state. `service`: oracle:state (or null before it loads); `pending`: the question
   * being sent; `error`: the last ask's thrown error; `drafts`: { text, images }.
   */
  function chatView({ messages = [], service = null, pending = null, error = null, drafts = {}, open = false } = {}) {
    const owner = service?.owner;
    const today = service?.today || null;
    let state = 'conversation';
    if (owner && !owner.self) state = 'unavailable';
    else if (pending || service?.busy) state = 'answering';
    else if (service?.paused) state = 'paused';
    else if (error || isError(messages.at(-1))) state = 'error';
    else if (!messages.length) state = 'empty';
    const blocked = state === 'unavailable' || state === 'paused';
    const ready = !blocked && state !== 'answering';
    const images = drafts.images || [];
    const lastUser = [...messages].reverse().find((m) => m.role === 'user');
    return {
      state,
      unread: open ? 0 : unreadCount(messages, service?.readAt ?? null),
      canSend: ready && (!!String(drafts.text || '').trim() || images.length > 0),
      chipsEnabled: ready,
      inputEnabled: !blocked,
      attachments: images,
      // the error state keeps the question to resend: the thrown one, or the last one asked
      resendText: state === 'error' ? (error ? drafts.text || '' : lastUser?.text || '') : '',
      errorText: state === 'error' ? error || messages.at(-1).text : '',
      owner: state === 'unavailable' ? owner : null,
      today,
    };
  }

  /**
   * Adds pasted images ({ type, size, dataUrl }) to the drafts: non-images are skipped; one image
   * over the size cap, or more than the cap in all, adds nothing and returns an error.
   */
  function addImages(images = [], files = [], nextId = () => `img-${Math.random().toString(36).slice(2, 9)}`) {
    const pics = files.filter((f) => IMAGE_TYPES.includes(f?.type));
    if (!pics.length) return { images, error: null };
    const big = pics.find((f) => Number(f.size) > LIMITS.maxBytes);
    if (big) return { images, error: `The image is over ${LIMITS.maxBytes / 1048576} MB: nothing was added.` };
    if (images.length + pics.length > LIMITS.maxCount) return { images, error: `At most ${LIMITS.maxCount} images per message: nothing was added.` };
    return { images: [...images, ...pics.map((f) => ({ id: nextId(), type: f.type, size: Number(f.size) || 0, dataUrl: f.dataUrl, name: f.name || '' }))], error: null };
  }

  const removeImage = (images = [], id) => images.filter((i) => i.id !== id);

  // ---- the memory form: { text (saved), draft, editing, saving, error } ----------------------
  const memoryForm = (text = '') => ({ text, draft: text, editing: false, saving: false, error: null });
  const editMemory = (f) => ({ ...f, editing: true, draft: f.text, error: null });
  const cancelMemory = (f) => ({ ...f, editing: false, draft: f.text, error: null });
  /** Saves the draft with `save(text)` (oracle:saveMemory): the saved text, or the error with the draft kept. */
  async function saveMemory(f, save) {
    try {
      const out = await save(f.draft);
      const text = typeof out?.text === 'string' ? out.text : f.draft;
      return { ...f, text, draft: text, editing: false, saving: false, error: null };
    } catch (e) {
      return { ...f, editing: true, saving: false, error: String(e?.message || e) };
    }
  }

  // ---- messages ------------------------------------------------------------------------------
  const tokenTotal = (tokens = {}) => Object.values(tokens || {}).reduce((s, v) => s + (Number(v) || 0), 0);

  /** An Oracle message's meta parts: time · model or "simulated" · cost · tokens. */
  function metaParts(m, { fmtTime = (t) => t, fmtCost = (n) => `$${Number(n).toFixed(4)}` } = {}) {
    const tokens = tokenTotal(m.tokens);
    return [
      m.ts ? fmtTime(m.ts) : '',
      m.simulated ? 'simulated' : m.model || '',
      fmtCost(m.costUsd || 0),
      `${tokens.toLocaleString('en-US')} tokens`,
    ].filter(Boolean);
  }

  /** Where a link goes: { kind: 'run' | 'issue' | 'file' | 'path' | 'external' | 'none', ... }. */
  function linkTarget(href = '') {
    const h = String(href || '').trim();
    let m = /^(?:run:)?(\d{8}-\d{6}-[0-9a-f]{8})$/.exec(h);
    if (m) return { kind: 'run', runId: m[1] };
    m = /^#(\d+)$/.exec(h);
    if (m) return { kind: 'issue', number: Number(m[1]) };
    // https://github.com/o/n/issues/5, https://gitlab.com/g/n/-/merge_requests/5: the repository too
    m = /^(?:https?:\/\/[^/]+\/(.+?)|.*?)(?:\/-)?\/(?:issues|pull|merge_requests)\/(\d+)\/?$/.exec(h);
    if (m) return m[1] ? { kind: 'issue', number: Number(m[2]), repo: repoSlug(m[1]) } : { kind: 'issue', number: Number(m[2]) };
    if (/^https?:\/\//i.test(h)) return { kind: 'external', url: h };
    const p = h.replace(/^file:\/\/\/?/i, '');
    m = RUN_FILE.exec(p);
    if (m && ABS_PATH.test(p)) return { kind: 'file', path: p, runId: m[1] };
    if (ABS_PATH.test(p)) return { kind: 'path', path: p };
    return { kind: 'none' };
  }

  /** Splits plain text into text and link pieces (run ids, #issues): [{ text } | { text, href }]. */
  function linkPieces(text = '') {
    const found = [];
    for (const m of text.matchAll(RUN_ID)) found.push({ at: m.index, end: m.index + m[0].length, href: m[0] });
    for (const m of text.matchAll(ISSUE)) {
      const at = m.index + m[1].length;
      found.push({ at, end: at + m[2].length + 1, href: `#${m[2]}` });
    }
    found.sort((a, b) => a.at - b.at);
    const out = [];
    let i = 0;
    for (const f of found) {
      if (f.at < i) continue;
      if (f.at > i) out.push({ text: text.slice(i, f.at) });
      out.push({ text: text.slice(f.at, f.end), href: f.href });
      i = f.end;
    }
    if (i < text.length) out.push({ text: text.slice(i) });
    return out;
  }

  /** owner/name of a repository (https://github.com/o/n.git, git@github.com:o/n, o/n), lower case. */
  function repoSlug(repo = '') {
    const m = /([^/:\s]+)\/([^/\s]+?)(?:\.git)?\/?$/.exec(String(repo || '').trim());
    return m ? `${m[1]}/${m[2]}`.toLowerCase() : '';
  }

  /**
   * The project whose Backlog a #<number> link opens: the one with the link's repository, else the
   * project of the run named in the same message (runProject: its id or name), else the only
   * project with a repository, else the current one (currentId).
   */
  function issueProject(target = {}, { projects = [], runProject = null, currentId = null } = {}) {
    const withRepo = projects.filter((p) => p.repo);
    const byRepo = target.repo && withRepo.find((p) => repoSlug(p.repo) === target.repo);
    if (byRepo) return byRepo.id;
    const byRun = runProject && projects.find((p) => p.id === runProject || p.name === runProject);
    if (byRun) return byRun.id;
    if (withRepo.length === 1) return withRepo[0].id;
    return currentId || null;
  }

  const api = {
    addImages,
    cancelMemory,
    chatView,
    editMemory,
    issueProject,
    LIMITS,
    linkPieces,
    linkTarget,
    memoryForm,
    metaParts,
    removeImage,
    repoSlug,
    saveMemory,
    tokenTotal,
    unreadCount,
  };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.OracleChatModel = api;
})(typeof window !== 'undefined' ? window : globalThis);
