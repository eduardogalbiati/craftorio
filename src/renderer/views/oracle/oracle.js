// The Oracle's chat (#171; the service is #122, src/oracle.js): one conversation in two places.
// - the dock (#oracle-dock): docked on the Dashboard, open there;
// - the drawer (#oracle-drawer): an overlay opened on any other screen from the sidebar's Oracle
//   button (#nav-oracle, at the bottom left below the runs list; on the Dashboard it focuses the
//   dock). Esc and the backdrop close it. The button's .nav-badge counts the answers that arrived
//   while neither was in view (oracle:state readAt, saved by oracle:markRead: survives a reload).
// The state (empty, conversation, answering, error, paused by budget, unavailable in another app
// process), Send, the pasted images and the memory form come from OracleChatModel
// (oracle-chat-model.js). Messages reuse .sup-wmsg and markdownHtml; run ids, #issues and run
// files in an answer open in the app, other paths are copyable. Developer mode asks the simulated
// Oracle (no model call). Exposes window.OracleChat (open, ask, attach, reload) for the screenshot script.
// Part 2 (#123): an action card (what changes, where, the backup, who asked) runs only on its
// "Do it" (oracle:act), Dismiss drops it, Undo puts its backup back; a wake-up shows its run events
// folded, with Mute per run; a delegation shows the agent asked and its cost. The head's Night
// watch opens its form (end time, Start / Cancel); while on, a strip shows it with Turn off, and the
// runs or roadmaps watched and the runs muted (Unwatch, Unmute). oracle:changed reloads the chat.
// Live progress (#180, window.LiveTurn, live-turn.js): while it answers, what the Oracle does and its
// answer as it is written (chat:progress 'oracle'); Stop (api.cancelChatTurn) keeps what was written.
// Uses app.js globals ($, esc, state, api, errMsg, devMode, fmtCost, markdownHtml, confirmDialog,
// selectRun, showView, openArtifactsAt, showSettingsTab, registerView, viewRegistry, Robots).
(() => {
  const M = window.OracleChatModel;
  const or = {
    messages: [], service: null, pending: null, error: null, loaded: false, drawer: false,
    drafts: { text: '', images: [] }, pasteError: null, memory: M.memoryForm(''), memoryOpen: false, refilledFor: null,
    wake: null, nightForm: null, acting: new Set(), live: null,
  };
  const SURFACES = ['dock', 'drawer'];
  const SUGGESTIONS = [
    'What happened overnight?',
    'Which runs failed this week, and why?',
    'Where do my tokens go?',
    'What should I work on next?',
  ];
  const attachmentCache = new Map(); // a stored image's name → data: URL (or a pending promise)
  const avatar = (cls = '') => `<span class="oracle-avatar ${cls}" aria-hidden="true">${Robots.svg('oracle', 'idle', { bubble: false, plaque: '' })}</span>`;
  const onDashboard = () => state.view === 'dashboard';
  const inView = () => or.drawer || onDashboard();
  const view = () => M.chatView({ messages: or.messages, service: or.service, pending: or.pending, error: or.error, drafts: or.drafts, open: inView() });
  const money = (n) => `$${(Number(n) || 0).toFixed(2)}`;
  const screen = () => (window.supervisorScreenContext ? window.supervisorScreenContext() : state.view || '');

  async function load() {
    try {
      [or.messages, or.service, or.wake] = await Promise.all([api.oracleHistory(), api.oracleState(), api.oracleWakeState().catch(() => null)]);
      or.loaded = true;
    } catch (e) { or.error = errMsg(e); }
    render();
  }
  // a wake-up, a card or a result arrived (oracle:changed): reload once the burst is over
  let reloadTimer = null;
  function reloadSoon() {
    clearTimeout(reloadTimer);
    reloadTimer = setTimeout(() => { if (!or.pending) load(); }, 300);
  }

  // ---- action cards, the Night watch, watches and mutes (#123) --------------------------------
  // the result of a card's button: the conversation and the state come back
  async function cardAction(id, call) {
    or.acting.add(id);
    render();
    try {
      const out = await call();
      if (out?.messages) or.messages = out.messages;
      if (out?.state) or.service = out.state;
      or.error = null;
    } catch (e) { or.error = errMsg(e); }
    or.acting.delete(id);
    await load();
  }
  const doAction = (id) => cardAction(id, () => api.oracleAct({ actionId: id, mock: devMode() }));
  const dismissAction = (id) => cardAction(id, () => api.oracleDismiss({ actionId: id }));
  async function undoAction(id) {
    if (!await confirmDialog('Undo this action', 'The backup taken before the action is put back.', 'Undo')) return;
    cardAction(id, () => api.oracleUndo({ actionId: id }));
  }
  async function startNightWatch() {
    const f = or.nightForm;
    const until = f.until ? new Date(f.until) : null;
    if (!until || !(until > new Date())) { or.nightForm = { ...f, error: 'Pick an end time in the future.' }; render(); return; }
    or.nightForm = { ...f, saving: true, error: null };
    render();
    try {
      const out = await api.setOracleNightWatch({ on: true, until: until.toISOString(), from: 'the Oracle drawer' });
      or.messages = out.messages;
      or.service = out.state;
      or.nightForm = null;
    } catch (e) { or.nightForm = { ...f, saving: false, error: errMsg(e) }; }
    render();
  }
  async function stopNightWatch() {
    try {
      const out = await api.setOracleNightWatch({ on: false });
      or.messages = out.messages;
      or.service = out.state;
    } catch (e) { or.error = errMsg(e); }
    render();
  }
  async function setWatch(call) {
    try { or.wake = { ...or.wake, ...(await call()) }; } catch (e) { or.error = errMsg(e); }
    render();
  }

  // the conversation is in view: its answers so far are read
  function markRead() {
    if (!inView()) return;
    const last = or.messages.filter((m) => m.role === 'oracle').at(-1);
    if (!last || (or.service?.readAt && or.service.readAt >= last.ts)) return;
    if (or.service) or.service = { ...or.service, readAt: last.ts };
    api.markOracleRead({ at: last.ts }).catch(() => {});
  }

  async function ask(question) {
    const q = String(question ?? or.drafts.text).trim();
    const images = or.drafts.images;
    const v = view();
    if ((!q && !images.length) || !v.chipsEnabled) return;
    Object.assign(or, { pending: q || `(${images.length} image${images.length > 1 ? 's' : ''})`, error: null, pasteError: null, live: window.LiveTurn.create({ agent: 'Oracle' }) });
    render();
    // #180: the timer and "Still working" move even when no item arrives
    const tick = setInterval(renderLive, 1000);
    try {
      const out = await api.askOracle({ question: q, screen: screen(), images: images.map((i) => ({ dataUrl: i.dataUrl })), mock: devMode() });
      or.messages = out.messages;
      or.service = out.state;
      // a daily budget shows as the paused state; a monthly one as an error
      if (out.refused && out.refused.reason !== 'daily-budget') or.error = out.refused.text;
      if (!out.refused) {
        if (or.drafts.text.trim() === q) setDraftText('');
        or.drafts.images = [];
      }
    } catch (e) {
      or.error = errMsg(e); // the question stays in the input, to resend
    } finally {
      clearInterval(tick);
      Object.assign(or, { pending: null, live: null });
      render();
    }
  }

  // #180: only the live turn is redrawn on each event and each second
  function renderLive() {
    if (!or.live) return;
    document.querySelectorAll('.oracle-live').forEach((el) => {
      el.innerHTML = window.LiveTurn.html(or.live);
      const log = el.parentElement;
      if (log) log.scrollTop = log.scrollHeight;
    });
  }

  async function reset() {
    if (!await confirmDialog('New session', 'The Oracle starts a new session from a handoff note it writes now. The conversation and its memory are kept.', 'New session')) return;
    try {
      const out = await api.resetOracle({ mock: devMode() });
      or.messages = out.messages;
      or.service = out.state;
      or.error = null;
    } catch (e) { or.error = errMsg(e); }
    render();
  }

  // ---- the memory form ---------------------------------------------------------------------
  async function openMemory() {
    or.memoryOpen = true;
    try { or.memory = M.editMemory(M.memoryForm((await api.oracleMemory()).text)); } catch (e) { or.memory = { ...M.editMemory(M.memoryForm('')), error: errMsg(e) }; }
    render();
    document.querySelector(`#oracle-mem-${or.drawer ? 'drawer' : 'dock'}`)?.focus();
  }
  async function saveMemory() {
    or.memory = { ...or.memory, saving: true };
    render();
    or.memory = await M.saveMemory(or.memory, (text) => api.saveOracleMemory(text));
    render();
  }

  // ---- drafts and pasted images ------------------------------------------------------------
  function setDraftText(text) {
    or.drafts.text = text;
    SURFACES.forEach((w) => { const el = $(`#oracle-q-${w}`); if (el && el.value !== text) el.value = text; });
  }
  const readFile = (file) => new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve({ type: file.type, size: file.size, name: file.name || '', dataUrl: r.result });
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
  // images given as { type, size, dataUrl } (the paste handler, or the screenshot script)
  function attach(files) {
    const out = M.addImages(or.drafts.images, files);
    or.drafts.images = out.images;
    or.pasteError = out.error;
    render();
  }
  async function onPaste(e) {
    const files = [...(e.clipboardData?.items || [])].filter((i) => i.kind === 'file' && i.type.startsWith('image/')).map((i) => i.getAsFile()).filter(Boolean);
    if (!files.length) return; // text: the textarea's own paste
    e.preventDefault();
    attach(await Promise.all(files.map(readFile)));
  }

  // ---- links in the answers ----------------------------------------------------------------
  function follow(target) {
    if (target.kind === 'run') { closeDrawer(); selectRun(target.runId); }
    else if (target.kind === 'issue') {
      closeDrawer();
      // the issue's own project: the link's repository, or the run named in the same answer
      const projectId = M.issueProject(target, {
        projects: state.projects || [],
        runProject: target.runId ? state.runs.get(target.runId)?.run?.project : null,
        currentId: window.BacklogActions?.projectId?.(),
      });
      window.BacklogActions?.focusProject?.(projectId);
      window.BacklogActions?.focusIssue?.(target.number);
      showView('backlog');
    } else if (target.kind === 'file') {
      closeDrawer();
      openArtifactsAt({ projectId: '', path: target.path, mock: !!state.runs.get(target.runId)?.run?.mock });
    }
  }
  // run ids and #issues in the text become links; links and absolute paths get their target
  function decorate(box) {
    const walker = document.createTreeWalker(box, NodeFilter.SHOW_TEXT, { acceptNode: (n) => (n.parentElement.closest('a, pre') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT) });
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    for (const node of nodes) {
      const pieces = M.linkPieces(node.nodeValue);
      if (!pieces.some((p) => p.href)) continue;
      const frag = document.createDocumentFragment();
      for (const p of pieces) {
        if (!p.href) { frag.append(p.text); continue; }
        const a = document.createElement('a');
        a.href = p.href;
        a.textContent = p.text;
        frag.append(a);
      }
      node.replaceWith(frag);
    }
    // a #<number> without a repository belongs to the project of the first run the answer names
    const contextRun = box.textContent.match(/\b\d{8}-\d{6}-[0-9a-f]{8}\b/)?.[0];
    box.querySelectorAll('a[href]').forEach((a) => {
      const t = M.linkTarget(a.getAttribute('href'));
      if (t.kind === 'issue' && !t.repo && contextRun) t.runId = contextRun;
      if (t.kind === 'external') { a.target = '_blank'; a.rel = 'noopener'; return; }
      if (t.kind === 'none' || t.kind === 'path') return;
      a.classList.add('oracle-link');
      a.dataset.oracleLink = JSON.stringify(t);
      a.title = t.kind === 'run' ? `Open run ${t.runId}` : t.kind === 'issue' ? `Open #${t.number} in the Backlog` : `Open ${t.path} in Artifacts`;
    });
    box.querySelectorAll('code').forEach((c) => {
      if (c.closest('a')) return;
      const t = M.linkTarget(c.textContent);
      if (t.kind === 'file') {
        c.classList.add('oracle-link');
        c.dataset.oracleLink = JSON.stringify(t);
        c.title = `Open ${t.path} in Artifacts`;
      } else if (t.kind === 'path') {
        c.classList.add('oracle-path');
        c.dataset.oracleCopy = t.path;
        c.title = `${t.path} (click to copy)`;
      }
    });
  }

  // ---- rendering ---------------------------------------------------------------------------
  const time = (t) => (t ? new Date(t).toLocaleString() : '');
  function thumbsHtml(names = []) {
    if (!names.length) return '';
    return `<div class="oracle-thumbs">${names.map((n) => {
      const url = attachmentCache.get(n);
      return `<span class="oracle-thumb" title="${esc(n)}">${typeof url === 'string' ? `<img src="${esc(url)}" alt="Pasted image ${esc(n)}" />` : '<span class="muted small">image</span>'}</span>`;
    }).join('')}</div>`;
  }
  function loadAttachments(names = []) {
    for (const n of names) {
      if (attachmentCache.has(n)) continue;
      attachmentCache.set(n, api.oracleAttachment(n).then((url) => { attachmentCache.set(n, url || ''); render(); }).catch(() => attachmentCache.set(n, '')));
    }
  }
  function messageHtml(m) {
    if (m.role === 'user') {
      loadAttachments(m.attachments);
      return `<div class="sup-wmsg user"><div class="sup-wmsg-meta oracle-meta">You · ${esc(time(m.ts))}${m.screen ? ` · <span class="oracle-cut" title="${esc(m.screen)}">${esc(m.screen)}</span>` : ''}${m.unanswered ? ' · <span class="badge warn">no answer</span>' : ''}</div><div class="oracle-text">${esc(m.text)}</div>${thumbsHtml(m.attachments)}</div>`;
    }
    if (m.kind === 'action' && m.action) return cardHtml(m);
    if (m.kind === 'delegation') {
      return `<div class="sup-wmsg system oracle-delegation${m.failed ? ' error' : ''}"><div class="sup-wmsg-meta oracle-meta">${M.delegationParts(m, { fmtTime: time, fmtCost }).map(esc).join(' · ')}${m.failed ? ' · <span class="pill pill-failed">Failed</span>' : ''}</div>
        <div class="oracle-cut small" title="${esc(m.question)}">${esc(m.question)}</div>
        <details class="oracle-fold"><summary>Answer${m.ref ? ` <span class="muted small">(${esc(m.ref)})</span>` : ''}</summary><div class="md md-compact oracle-md">${markdownHtml(m.text || '')}</div></details></div>`;
    }
    if (m.kind === 'wake') {
      const mutes = (m.runIds || []).map((id) => {
        const muted = (or.wake?.muted || []).includes(id);
        return `<button class="btn ghost sm" type="button" data-oracle-mute="${esc(id)}" data-on="${muted ? '0' : '1'}" title="${muted ? 'Its events wake the Oracle again' : 'Its events no longer wake the Oracle'}">${muted ? 'Unmute' : 'Mute'} ${esc(id)}</button>`;
      }).join('');
      return `<div class="sup-wmsg system oracle-wake"><details class="oracle-fold"><summary><span class="sup-wmsg-meta">${esc(time(m.ts))}</span> ${esc(m.text)}</summary>
        <ul class="oracle-events small">${(m.events || []).map((l) => `<li>${esc(l)}</li>`).join('')}</ul>${mutes ? `<div class="row oracle-card-actions">${mutes}</div>` : ''}</details></div>`;
    }
    if (m.role === 'system') return `<div class="sup-wmsg system${m.error ? ' error' : ''}"><div class="sup-wmsg-meta">${esc(time(m.ts))}</div><div>${esc(m.text)}</div></div>`;
    const meta = M.metaParts(m, { fmtTime: time, fmtCost }).map(esc).join(' · ');
    const tag = m.wake ? ' · <span class="badge">wake-up</span>' : m.kind === 'night-summary' ? ' · <span class="badge warn">Night watch</span>' : m.stopped ? ' · <span class="badge warn" title="You stopped this turn: the answer is what was written until then">Stopped</span>' : '';
    return `<div class="sup-wmsg oracle-msg"><div class="sup-wmsg-meta oracle-meta">${avatar('xs')} Oracle · ${meta}${tag}</div><div class="md md-compact oracle-md">${markdownHtml(m.text || '')}</div>${m.kind === 'night-summary' ? summaryUndoHtml(m) : ''}</div>`;
  }
  // a card: the title leads; what changes, where, the backup and why; who asked; its buttons
  function cardHtml(m) {
    const a = m.action;
    const v = M.actionView({ ...a, status: or.acting.has(a.id) ? 'running' : a.status }, { unavailable: view().state === 'unavailable' });
    const field = (label, value) => (value ? `<dt>${label}</dt><dd>${esc(value)}</dd>` : '');
    return `<div class="sup-wmsg oracle-msg oracle-card${v.fromContent ? ' from-content' : ''}" data-oracle-card="${esc(a.id)}">
      <div class="sup-wmsg-meta oracle-meta">${avatar('xs')} Oracle · ${esc(time(m.ts))}</div>
      <div class="oracle-card-head"><span class="oracle-card-title" title="${esc(a.title)}">${esc(a.title)}</span><span class="pill pill-${esc(v.pill)}">${esc(v.label)}</span></div>
      <dl class="oracle-card-fields small">${field('Change', a.change)}${field('Where', a.where)}${field('Backup', a.backup)}${field('Why', a.why)}</dl>
      <div class="oracle-card-from small${v.fromContent ? ' warn' : ' muted'}">${v.auto ? '<span class="badge warn">Night watch</span> Done without asking. ' : ''}${esc(v.requester)}</div>
      ${a.result ? `<div class="oracle-card-result small${a.result.ok ? '' : ' error'}">${esc(a.result.text)}</div>` : ''}
      ${v.canDo || v.canUndo ? `<div class="row oracle-card-actions">
        ${v.canDo ? `<button class="btn primary sm" type="button" data-oracle-act="${esc(a.id)}">Do it</button><button class="btn ghost sm" type="button" data-oracle-dismiss="${esc(a.id)}">Dismiss</button>` : ''}
        ${v.canUndo ? `<button class="btn ghost sm" type="button" data-oracle-undo="${esc(a.id)}" title="Put back the backup taken before the action">Undo</button>` : ''}
      </div>` : ''}
    </div>`;
  }
  // the morning summary's Undo buttons, for the actions that can still be undone
  function summaryUndoHtml(m) {
    const cards = or.messages.filter((x) => x.kind === 'action' && (m.actions || []).includes(x.action?.id) && x.action.result?.undoable);
    return cards.length ? `<div class="row oracle-card-actions">${cards.map((x) => `<button class="btn ghost sm oracle-cut" type="button" data-oracle-undo="${esc(x.action.id)}" title="Undo: ${esc(x.action.title)}">Undo: ${esc(x.action.title)}</button>`).join('')}</div>` : '';
  }
  // the Night watch (its form, or its strip while on) and the runs watched or muted
  function opsHtml(w) {
    const nw = M.nightWatchView(or.service?.nightWatch, { fmtTime: time });
    const parts = [];
    if (or.nightForm) {
      const f = or.nightForm;
      parts.push(`<form class="oracle-night-form" data-oracle-night-form>
        <div class="field">
          <label for="oracle-night-until-${w}">Night watch until</label>
          <input type="datetime-local" id="oracle-night-until-${w}" class="oracle-night-until" value="${esc(f.until || '')}"${f.saving ? ' disabled' : ''} />
          <div class="hint">Until then the Oracle fixes what stops the roadmap without asking, but only with the permissions you chose on the Night watch screen (by default: retry a failed item and refresh issue text). Each action is logged with its backup and sent as a notification. Gates stay yours; it never closes issues or pushes.</div>
          ${f.error ? `<p class="error small">${esc(f.error)}</p>` : ''}
        </div>
        <div class="row"><button class="btn primary sm" type="submit"${f.saving ? ' disabled' : ''}>Start</button><button class="btn ghost sm" type="button" data-oracle-night-cancel>Cancel</button></div>
      </form>`);
    } else if (nw.active) {
      parts.push(`<div class="row oracle-ops-row"><span class="badge warn" title="Repairs that keep the roadmap going run without asking; everything else waits for you">${esc(nw.label)}</span><span class="spacer"></span><button class="btn ghost sm" type="button" data-oracle-night-off>Turn off</button></div>`);
    }
    // the runs and roadmaps watched, the runs muted: one compact row (the full id on hover)
    const watching = (or.wake?.watching || []).map((x) => {
      const name = x.runId ? x.runId : `roadmap of ${x.projectId}`;
      return `<button class="btn ghost sm oracle-cut" type="button" data-oracle-unwatch="${esc(JSON.stringify(x.runId ? { runId: x.runId } : { projectId: x.projectId }))}" title="Watching ${esc(name)}: its events wake the Oracle until it ends. Click to stop watching.">${esc(name)} ×</button>`;
    });
    const muted = (or.wake?.muted || []).map((id) => `<button class="btn ghost sm oracle-cut" type="button" data-oracle-mute="${esc(id)}" data-on="0" title="Muted: ${esc(id)}'s events do not wake the Oracle. Click to unmute.">${esc(id)} ×</button>`);
    if (watching.length || muted.length) {
      parts.push(`<div class="row oracle-ops-row small">${watching.length ? `<span class="muted">Watching</span>${watching.join('')}` : ''}${muted.length ? `<span class="muted">Muted</span>${muted.join('')}` : ''}</div>`);
    }
    if (or.wake?.wakeScope === 'off') parts.push('<div class="muted small">Run events do not wake the Oracle (Settings › Execution › Oracle).</div>');
    return parts.join('');
  }
  function logHtml(v) {
    return (v.state === 'empty' ? '<div class="svc-empty muted small">The Oracle keeps one conversation for the whole app. It reads your runs (events, sessions, decisions, costs), the roadmaps and the Backlog, the workflows and skills, and your projects\' repositories, read-only. Ask it why a run failed, where the tokens go or what to do next. Run events wake it when they need you. It changes nothing on its own: each change is a card you confirm with Do it.</div>' : '')
      + or.messages.map(messageHtml).join('')
      + (or.pending ? `<div class="sup-wmsg user"><div class="sup-wmsg-meta">You</div><div class="oracle-text">${esc(or.pending)}</div>${or.drafts.images.length ? `<div class="oracle-thumbs">${or.drafts.images.map((i) => `<span class="oracle-thumb"><img src="${esc(i.dataUrl)}" alt="" /></span>`).join('')}</div>` : ''}</div>` : '')
      + (or.live ? `<div class="oracle-live">${window.LiveTurn.html(or.live)}</div>` : v.state === 'answering' ? '<div class="sup-loading"><span class="spinner"></span><span>The Oracle is reading…</span></div>' : '')
      + (or.error ? `<div class="sup-wmsg system error"><div class="sup-wmsg-meta">now</div><div>${esc(or.error)}</div></div>` : '');
  }
  function noticeHtml(v) {
    if (v.state === 'paused') {
      const t = v.today || {};
      return `<div class="oracle-notice-box"><span class="badge warn">Paused by budget</span> <span>Spent ${esc(money(t.spentUsd))} of ${esc(money(t.limitUsd))} today. <a href="#" data-oracle-settings>Raise it in Settings</a>, or it resumes tomorrow.</span></div>`;
    }
    if (v.state === 'unavailable') {
      const o = v.owner;
      return `<div class="oracle-notice-box"><span class="badge">Unavailable</span> <span>The Oracle answers in another app process (pid ${esc(String(o.pid))} on ${esc(o.host || '?')}${o.since ? `, since ${esc(time(o.since))}` : ''}). Ask it there, or close that window.</span></div>`;
    }
    return '';
  }
  function memoryHtml(w) {
    const f = or.memory;
    if (!or.memoryOpen) return '';
    if (!f.editing) {
      return `<div class="oracle-memory-view"><div class="row oracle-memory-head"><b>Memory</b><span class="badge">saved</span><span class="spacer"></span><button class="btn ghost sm" type="button" data-oracle-mem-edit>Edit</button><button class="btn ghost sm" type="button" data-oracle-mem-close>Close</button></div>
        <div class="oracle-memory-text small">${f.text.trim() ? esc(f.text) : '<span class="muted">Empty.</span>'}</div></div>`;
    }
    return `<form class="oracle-memory-form" data-oracle-mem-form>
      <div class="field">
        <label for="oracle-mem-${w}">Memory</label>
        <textarea id="oracle-mem-${w}" class="oracle-mem-input" rows="8"${f.saving ? ' disabled' : ''}>${esc(f.draft)}</textarea>
        <div class="hint">Your standing decisions (e.g. "UI issues need UI criteria", "reply in Portuguese"). The Oracle reads them at every session start; only you change them.</div>
        ${f.error ? `<p class="error small oracle-mem-error">${esc(f.error)}</p>` : ''}
      </div>
      <div class="row"><button class="btn primary sm" type="submit"${f.saving ? ' disabled' : ''}>Save</button><button class="btn ghost sm" type="button" data-oracle-mem-cancel>Cancel</button></div>
    </form>`;
  }
  function footHtml(v) {
    const t = v.today;
    const budget = !t ? '' : t.limitUsd ? `Today ${money(t.spentUsd)} of ${money(t.limitUsd)} daily budget.` : `Today ${money(t.spentUsd)} (no daily cap).`;
    return `${budget} ${devMode() ? 'Simulated (developer mode): no model is called and nothing is spent.' : 'Each message is one call to the model.'}`;
  }

  function render() {
    const v = view();
    // a failed answer keeps its question in the input, once
    const last = or.messages.at(-1);
    if (v.state === 'error' && v.resendText && !or.drafts.text && last && or.refilledFor !== last.id) { or.refilledFor = last.id; setDraftText(v.resendText); }
    const where = screen();
    for (const w of SURFACES) {
      if (w === 'drawer' ? !or.drawer : !onDashboard()) continue;
      const log = $(`#oracle-log-${w}`);
      log.innerHTML = logHtml(v);
      log.querySelectorAll('.oracle-md').forEach(decorate);
      log.scrollTop = log.scrollHeight;
      const memBox = $(`#oracle-memory-${w}`);
      const editingHere = memBox.querySelector('textarea');
      // the form is redrawn on its own changes only, never while typing
      if (!editingHere || !or.memory.editing || or.memory.saving || or.memory.error !== memBox.dataset.error) {
        memBox.innerHTML = memoryHtml(w);
        memBox.dataset.error = or.memory.error || '';
      }
      memBox.classList.toggle('hidden', !or.memoryOpen);
      // the Night watch form is redrawn on its own changes only, never while picking the time
      const ops = $(`#oracle-ops-${w}`);
      const nf = or.nightForm;
      const key = nf ? `form:${nf.saving ? 1 : 0}:${nf.error || ''}` : 'strip';
      if (!nf || !(ops.querySelector('[data-oracle-night-form]') && ops.dataset.key === key)) ops.innerHTML = opsHtml(w);
      ops.dataset.key = key;
      ops.classList.toggle('hidden', !ops.innerHTML.trim());
      // while on, the strip's Turn off is the control
      const nightOn = M.nightWatchView(or.service?.nightWatch).active;
      document.querySelectorAll('[data-oracle-night]').forEach((b) => (b.disabled = nightOn || v.state === 'unavailable'));
      $(`#oracle-screen-${w}`).textContent = where;
      $(`#oracle-screen-${w}`).title = where;
      $(`#oracle-notice-${w}`).innerHTML = noticeHtml(v);
      $(`#oracle-chips-${w}`).innerHTML = v.state === 'empty' || (v.state === 'answering' && !or.messages.length)
        ? SUGGESTIONS.map((q) => `<button class="chip" type="button" data-oracle-q="${esc(q)}"${v.chipsEnabled ? '' : ' disabled'}>${esc(q)}</button>`).join('') : '';
      $(`#oracle-thumbs-${w}`).innerHTML = v.attachments.map((i) => `<span class="oracle-thumb draft" title="${esc(i.name || 'Pasted image')}"><img src="${esc(i.dataUrl)}" alt="Pasted image" /><button class="icon-btn" type="button" data-oracle-unpaste="${esc(i.id)}" title="Remove this image" aria-label="Remove this image"><svg viewBox="0 0 24 24" aria-hidden="true"><line x1="6" y1="6" x2="18" y2="18" /><line x1="18" y1="6" x2="6" y2="18" /></svg></button></span>`).join('');
      const form = $(`[data-oracle-form="${w}"]`);
      form.classList.toggle('hidden', v.state === 'unavailable');
      form.querySelector('textarea').disabled = !v.inputEnabled;
      form.querySelector('.oracle-send').disabled = !v.canSend;
      const pe = $(`#oracle-paste-error-${w}`);
      pe.textContent = or.pasteError || '';
      pe.classList.toggle('hidden', !or.pasteError);
      $(`#oracle-foot-${w}`).textContent = footHtml(v);
      document.querySelectorAll('[data-oracle-reset]').forEach((b) => (b.disabled = v.state === 'answering' || v.state === 'unavailable'));
    }
    const badge = $('#nav-oracle-count');
    badge.textContent = String(v.unread);
    badge.classList.toggle('hidden', !v.unread);
    badge.title = `${v.unread} new answer${v.unread === 1 ? '' : 's'} from the Oracle`;
    markRead();
  }

  // ---- the drawer and the dock -------------------------------------------------------------
  function openDrawer() {
    if (onDashboard()) { $('#oracle-q-dock')?.focus(); return; }
    or.drawer = true;
    $('#oracle-drawer').classList.add('open');
    $('#oracle-drawer').setAttribute('aria-hidden', 'false');
    $('#oracle-backdrop').classList.remove('hidden');
    render();
    load();
    setTimeout(() => $('#oracle-q-drawer')?.focus(), 200);
  }
  function closeDrawer() {
    if (!or.drawer) return;
    or.drawer = false;
    $('#oracle-drawer').classList.remove('open');
    $('#oracle-drawer').setAttribute('aria-hidden', 'true');
    $('#oracle-backdrop').classList.add('hidden');
    render();
  }

  const surfaceHtml = (w) => `
    <div class="drawer-head oracle-head">
      <div class="oracle-who">${avatar()}
        <div class="sup-head">
          <h2 class="drawer-title">Oracle</h2>
          <div class="muted small oracle-cut">On: <span id="oracle-screen-${w}"></span></div>
        </div>
      </div>
      <div class="row">
        <button class="btn ghost sm" type="button" data-oracle-night title="Let the Oracle fix what stops the roadmap without asking, until a time you choose">Night watch</button>
        <button class="btn ghost sm" type="button" data-oracle-memory title="The owner's standing decisions, read at every session start">Memory</button>
        <button class="btn ghost sm" type="button" data-oracle-reset title="A new session from a handoff note; the conversation and the memory are kept">New session</button>
        ${w === 'drawer' ? '<button id="btn-oracle-close" class="icon-btn" type="button" title="Close (Esc)"><svg viewBox="0 0 24 24" aria-hidden="true"><line x1="6" y1="6" x2="18" y2="18" /><line x1="18" y1="6" x2="6" y2="18" /></svg></button>' : ''}
      </div>
    </div>
    <div class="drawer-body svc-body oracle-body">
      <div id="oracle-memory-${w}" class="oracle-memory hidden"></div>
      <div id="oracle-ops-${w}" class="oracle-ops hidden"></div>
      <div id="oracle-log-${w}" class="svc-log oracle-log"></div>
      <div id="oracle-notice-${w}" class="oracle-notice"></div>
      <div id="oracle-chips-${w}" class="svc-chips"></div>
      <div id="oracle-thumbs-${w}" class="oracle-thumbs"></div>
      <form class="svc-form" data-oracle-form="${w}">
        <textarea id="oracle-q-${w}" class="svc-input oracle-input" rows="2" placeholder="Ask the Oracle… (Enter to send, Shift+Enter for a new line; paste a screenshot)"></textarea>
        <button class="btn primary oracle-send" type="submit">Send</button>
      </form>
      <p id="oracle-paste-error-${w}" class="error small oracle-paste-error hidden"></p>
      <p id="oracle-foot-${w}" class="muted small svc-note"></p>
    </div>`;

  registerView({
    id: 'oracle',
    modals: `
  <div id="oracle-backdrop" class="drawer-backdrop sup-backdrop hidden"></div>
  <aside id="oracle-drawer" class="drawer sup-drawer oracle-drawer" aria-hidden="true" aria-label="Oracle">${surfaceHtml('drawer')}</aside>`,
    mount() {
      // the dock on the Dashboard (its section is in place: views load in path order)
      const dash = $('#view-dashboard');
      dash.classList.add('oracle-docked');
      dash.insertAdjacentHTML('beforeend', `<aside id="oracle-dock" class="card oracle-dock" aria-label="Oracle">${surfaceHtml('dock')}</aside>`);
      // the sidebar's button, below the runs list
      const btn = document.createElement('button');
      btn.id = 'nav-oracle';
      btn.type = 'button';
      btn.className = 'nav-item nav-oracle';
      btn.title = 'Talk to the Oracle (on the Dashboard: its panel)';
      btn.innerHTML = `${avatar('nav')}<span>Oracle</span><span id="nav-oracle-count" class="nav-badge oracle-unread hidden"></span>`;
      // its own action: not a screen of the sidebar's navigation
      btn.onclick = (e) => { e.stopPropagation(); if (or.drawer) closeDrawer(); else openDrawer(); };
      $('nav.sidebar').append(btn);
      // the Dashboard shows the dock: the drawer closes there
      const dashView = viewRegistry.get('dashboard');
      const showDash = dashView.show;
      dashView.show = () => { showDash(); closeDrawer(); render(); };

      $('#btn-oracle-close').onclick = closeDrawer;
      $('#oracle-backdrop').onclick = closeDrawer;
      document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && or.drawer) closeDrawer(); });
      document.querySelectorAll('[data-oracle-reset]').forEach((b) => (b.onclick = reset));
      document.querySelectorAll('[data-oracle-memory]').forEach((b) => (b.onclick = () => (or.memoryOpen && or.memory.editing ? null : openMemory())));
      document.querySelectorAll('[data-oracle-form]').forEach((form) => {
        const input = form.querySelector('textarea');
        form.onsubmit = (e) => { e.preventDefault(); ask(); };
        // typing only changes Send (the log is not redrawn on every key)
        input.addEventListener('input', () => {
          setDraftText(input.value);
          const canSend = view().canSend;
          document.querySelectorAll('.oracle-send').forEach((b) => (b.disabled = !canSend));
        });
        input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); ask(); } });
        input.addEventListener('paste', onPaste);
      });
      document.querySelectorAll('[data-oracle-night]').forEach((b) => (b.onclick = () => {
        if (M.nightWatchView(or.service?.nightWatch).active) return;
        or.nightForm = or.nightForm ? null : { until: M.defaultNightEnd(), saving: false, error: null };
        render();
        if (or.nightForm) document.querySelector(`#oracle-night-until-${or.drawer ? 'drawer' : 'dock'}`)?.focus();
      }));
      document.addEventListener('input', (e) => {
        if (e.target.classList?.contains('oracle-mem-input')) or.memory = { ...or.memory, draft: e.target.value };
        if (e.target.classList?.contains('oracle-night-until') && or.nightForm) or.nightForm = { ...or.nightForm, until: e.target.value };
      });
      document.addEventListener('submit', (e) => {
        if (e.target.matches?.('[data-oracle-mem-form]')) { e.preventDefault(); saveMemory(); }
        if (e.target.matches?.('[data-oracle-night-form]')) { e.preventDefault(); startNightWatch(); }
      });
      api.onOracleChanged?.(reloadSoon);
      // #180: the question in flight, as the service reports it
      api.onChatProgress?.((p) => {
        if (p?.chat !== 'oracle' || !or.live) return;
        window.LiveTurn.apply(or.live, p);
        renderLive();
      });
      document.addEventListener('click', (e) => {
        const t = e.target;
        // #180: the live turn's Stop and its steps' toggle
        if (t.closest('.oracle-live') && window.LiveTurn.onClick(e, or.live, { onStop: () => api.cancelChatTurn('oracle', '').catch((err) => { or.error = errMsg(err); render(); }), render: renderLive })) return;
        const chip = t.closest('[data-oracle-q]');
        if (chip) { ask(chip.dataset.oracleQ); return; }
        const un = t.closest('[data-oracle-unpaste]');
        if (un) { or.drafts.images = M.removeImage(or.drafts.images, un.dataset.oracleUnpaste); or.pasteError = null; render(); return; }
        if (t.closest('[data-oracle-mem-cancel]')) { or.memory = M.cancelMemory(or.memory); or.memoryOpen = false; render(); return; }
        if (t.closest('[data-oracle-mem-close]')) { or.memoryOpen = false; render(); return; }
        if (t.closest('[data-oracle-mem-edit]')) { or.memory = M.editMemory(or.memory); render(); return; }
        const act = t.closest('[data-oracle-act]');
        if (act) { act.disabled = true; doAction(act.dataset.oracleAct); return; }
        const dismiss = t.closest('[data-oracle-dismiss]');
        if (dismiss) { dismissAction(dismiss.dataset.oracleDismiss); return; }
        const undoBtn = t.closest('[data-oracle-undo]');
        if (undoBtn) { undoAction(undoBtn.dataset.oracleUndo); return; }
        const mute = t.closest('[data-oracle-mute]');
        if (mute) { setWatch(() => api.muteOracleRun({ runId: mute.dataset.oracleMute, on: mute.dataset.on === '1' })); return; }
        const unwatch = t.closest('[data-oracle-unwatch]');
        if (unwatch) { setWatch(() => api.oracleWatch({ ...JSON.parse(unwatch.dataset.oracleUnwatch), on: false })); return; }
        if (t.closest('[data-oracle-night-cancel]')) { or.nightForm = null; render(); return; }
        if (t.closest('[data-oracle-night-off]')) { stopNightWatch(); return; }
        if (t.closest('[data-oracle-settings]')) {
          e.preventDefault();
          closeDrawer();
          showView('settings');
          showSettingsTab('execution');
          setTimeout(() => { $('#set-oracle-budget')?.focus(); $('#set-oracle')?.scrollIntoView({ block: 'center' }); }, 100);
          return;
        }
        const link = t.closest('[data-oracle-link]');
        if (link) { e.preventDefault(); follow(JSON.parse(link.dataset.oracleLink)); return; }
        const copy = t.closest('[data-oracle-copy]');
        if (copy) { api.clipboardWrite(copy.dataset.oracleCopy).then(() => { copy.title = 'Copied'; }).catch(() => {}); return; }
        // any other link in an answer: not a navigation of the app's page
        const a = t.closest('.oracle-md a[href]');
        if (a && !a.target) e.preventDefault();
      });
      load();
    },
  });

  window.OracleChat = { ask, attach, open: openDrawer, close: closeDrawer, reload: load };
})();
