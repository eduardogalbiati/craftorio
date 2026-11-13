/* global api, Terminal, FitAddon */
// The terminal dock: xterm tabs at the bottom (the processes live in the main process), opened by
// openTerminal (sessions, the Run screen, the gate panel's terminal, Sessions), resizable,
// collapsible, with copy, paste and pop out. Also the terminal buttons of the Run screen's
// sessions and the run lists ("Live terminal", "Open in CLI", ↗: termButtons, termAction).
// initTerminalDock() runs from app.js's init().

const CLI_TITLE = "Open the provider CLI resuming this conversation. Messages you send there become part of the agent's conversation.";
// #465: a deterministic step's log (`log`, its sessionId the log's path in the run folder) and the
// base check's (`base-check`, its sessionId the project) follow a file; like a live session, read-only
const LOG_KINDS = ['base-check', 'log'];
const readOnlyTerm = (kind) => kind === 'live' || LOG_KINDS.includes(kind);

// "Live terminal" / "Open in CLI" (embedded in the dock) + "↗" (external window). The ↗ button is
// disabled with the reason when the app found no terminal window to open (#318, api.externalTerminal).
function termButtons(kind, title, blocked = '') {
  const label = readOnlyTerm(kind) ? 'Live terminal' : 'Open in CLI';
  const t = blocked || title || (kind === 'cli' ? CLI_TITLE : LOG_KINDS.includes(kind) ? "Follow this step's log as it grows (read-only)" : 'Follow this session live in a terminal');
  const dis = blocked ? 'disabled' : '';
  const ext = api.externalTerminal || { available: true };
  const extBlocked = blocked || (ext.available ? '' : ext.reason || 'No terminal window available');
  return `<span class="term-btns"><button class="btn sm ghost" data-term="${kind}" ${dis} title="${esc(t)}">${label}</button><button class="btn sm ghost term-ext" data-term="${kind}" data-ext="1" ${extBlocked ? 'disabled' : ''} title="${esc(extBlocked || I18n.t('term_dock.label_in_an_external_window', { label }))}">↗</button></span>`;
}

// Runs a terminal button: embedded tab or external window. Returns the inline message.
async function termAction(btn, { sessionId, runId, label }) {
  const kind = btn.dataset.term;
  try {
    if (btn.dataset.ext) {
      await api.openSessionTerminal(sessionId, kind, runId);
      return { text: 'Terminal opened in a new window.', error: false };
    }
    await openTerminal({ kind, sessionId, runId, label });
    return { text: '', error: false };
  } catch (e) {
    return { text: errMsg(e), error: true };
  }
}

// Terminal dock (xterm tabs; the process lives in the main process)
const TERM_HEIGHT_KEY = 'multiagent.termHeight';
const IS_MAC = (api.platform || navigator.platform || '').toLowerCase().startsWith('mac') || api.platform === 'darwin';
const isOrchSession = (s) => s.id === 'orchestrator' || s.agent === 'orchestrator';
const dock = {
  tabs: [],            // { key, id, kind, runId, sessionId, title, term, fit, pane, exited, exitCode, lastPaste }
  active: null,
  collapsed: false,
  pending: new Map(),  // backend id -> [{ data } | { exitCode }] received before term:open resolved
};

function initTerminalDock() {
  let h = 280;
  try { h = Number(localStorage.getItem(TERM_HEIGHT_KEY)) || h; } catch { /* ignore */ }
  setDockHeight(h, false);
  $('#btn-term-collapse').onclick = () => setDockCollapsed(!dock.collapsed);
  $('#btn-term-popout').onclick = popOutActive;

  // drag handle
  $('#term-resize').addEventListener('mousedown', (e) => {
    e.preventDefault();
    if (dock.collapsed) setDockCollapsed(false);
    const startY = e.clientY, startH = $('#term-dock').getBoundingClientRect().height;
    document.body.classList.add('resizing-dock');
    const move = (ev) => setDockHeight(startH + (startY - ev.clientY), false);
    const up = () => {
      document.removeEventListener('mousemove', move);
      document.removeEventListener('mouseup', up);
      document.body.classList.remove('resizing-dock');
      setDockHeight($('#term-dock').getBoundingClientRect().height, true);
    };
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', up);
  });

  // terminals live in the dock or in the Sessions screen (sessions.js)
  const findTab = (id) => dock.tabs.find((x) => x.id === id) || window.SessionsView?.findTab(id);
  api.onTermData?.(({ id, data }) => {
    const t = findTab(id);
    if (t) t.term.write(data);
    else queuePending(id, { data });
  });
  api.onTermExit?.(({ id, exitCode }) => {
    const t = findTab(id);
    if (t) markExited(t, exitCode);
    else queuePending(id, { exitCode });
  });

  window.addEventListener('resize', () => { setDockHeight(dock.height, false); fitActive(); });
  if (window.ResizeObserver) new ResizeObserver(() => fitActive()).observe($('#term-body'));
}

function queuePending(id, item) {
  if (!dock.pending.has(id)) dock.pending.set(id, []);
  dock.pending.get(id).push(item);
  if (dock.pending.size > 50) dock.pending.delete(dock.pending.keys().next().value);
}

function setDockHeight(h, persist) {
  const max = Math.round(window.innerHeight * 0.7);
  dock.height = Math.max(120, Math.min(max, Math.round(h)));
  $('#term-dock').style.height = dock.collapsed ? '' : `${dock.height}px`;
  if (persist) { try { localStorage.setItem(TERM_HEIGHT_KEY, String(dock.height)); } catch { /* ignore */ } }
}

function setDockCollapsed(c) {
  dock.collapsed = c;
  $('#term-dock').classList.toggle('collapsed', c);
  $('#btn-term-collapse').title = c ? t('term_dock.expand_the_terminal_panel') : t('term_dock.collapse_the_terminal_panel');
  setDockHeight(dock.height, false);
  if (!c) requestAnimationFrame(() => { fitActive(); dock.active?.term.focus(); });
}

function xtermTheme() {
  const css = getComputedStyle(document.documentElement);
  const v = (name, fb) => css.getPropertyValue(name).trim() || fb;
  const accent = v('--accent', '#7c9cff');
  const m = /^#([0-9a-f]{6})$/i.exec(accent);
  const sel = m ? `rgba(${parseInt(m[1].slice(0, 2), 16)},${parseInt(m[1].slice(2, 4), 16)},${parseInt(m[1].slice(4, 6), 16)},0.35)` : 'rgba(124,156,255,0.35)';
  return {
    background: v('--bg', '#0e1014'),
    foreground: v('--text', '#e6e8ee'),
    cursor: accent,
    cursorAccent: v('--bg', '#0e1014'),
    selectionBackground: sel,
    // xterm draws its own scrollbar: the same colours as the app's (style.css :root)
    scrollbarSliderBackground: v('--scrollbar-thumb', 'rgba(138,145,163,0.3)'),
    scrollbarSliderHoverBackground: v('--scrollbar-thumb-hover', 'rgba(138,145,163,0.5)'),
    scrollbarSliderActiveBackground: v('--scrollbar-thumb-active', 'rgba(138,145,163,0.7)'),
  };
}

// Opens (or focuses) an embedded terminal. Throws with a readable message on failure.
// open(cols, rows): starts it another way than term:open (e.g. a gate's local preview).
async function openTerminal({ kind, sessionId, runId, label, open }) {
  if (typeof Terminal === 'undefined') throw new Error('The terminal component failed to load.');
  runId = runId || state.run?.id;
  const key = `${kind}:${runId || 'current'}:${sessionId}`;
  const existing = dock.tabs.find((t) => t.key === key);
  // a finished program started another way (a local preview that stopped) starts again in a fresh tab
  if (existing && open && existing.exited) closeTab(existing, { kill: false });
  else if (existing) { showDock(); activateTab(existing); return existing; }

  const pane = document.createElement('div');
  pane.className = 'term-pane';
  pane.dataset.testid = 'term-pane';
  $('#term-body').appendChild(pane);
  const { term, fit } = createXterm(kind);
  const tab = { key, id: null, kind, runId, sessionId, title: `${label || sessionId} · ${LOG_KINDS.includes(kind) ? 'log' : kind}`, term, fit, pane, exited: false, lastPaste: 0, sent: 0 };
  dock.tabs.push(tab);
  showDock();
  term.open(pane);
  wireTerminal(tab);
  activateTab(tab);

  try {
    const res = await (open ? open(term.cols, term.rows) : api.termOpen({ kind, runId, sessionId, cols: term.cols, rows: term.rows }));
    tab.id = res.id;
    if (res.windowsPty) term.options.windowsPty = res.windowsPty;
    if (res.title && !(label && LOG_KINDS.includes(kind))) tab.title = res.title;
    renderTermTabs();
    replayPending(tab);
    fitActive();
    return tab;
  } catch (e) {
    closeTab(tab, { kill: false });
    throw e;
  }
}

// What arrived for a terminal before term:open answered with its id.
function replayPending(tab) {
  for (const item of dock.pending.get(tab.id) || []) {
    if ('data' in item) tab.term.write(item.data);
    else markExited(tab, item.exitCode);
  }
  dock.pending.delete(tab.id);
}

// An xterm with the app's theme and a fit addon (not opened yet). Live terminals are read-only.
function createXterm(kind) {
  const css = getComputedStyle(document.documentElement);
  const term = new Terminal({
    theme: xtermTheme(),
    fontFamily: css.getPropertyValue('--mono').trim() || 'Consolas, monospace',
    fontSize: 12,
    lineHeight: 1.2,
    cursorBlink: !readOnlyTerm(kind),
    cursorStyle: readOnlyTerm(kind) ? 'underline' : 'block',
    cursorInactiveStyle: 'none',
    scrollback: 5000,
    convertEol: false,
    allowProposedApi: false,
  });
  const fit = new FitAddon.FitAddon();
  term.loadAddon(fit);
  return { term, fit };
}

function wireTerminal(tab) {
  const { term, pane } = tab;
  term.onData((d) => {
    if (readOnlyTerm(tab.kind) || tab.exited || !tab.id) return; // live and log tabs are read-only
    tab.sent++;
    api.termInput(tab.id, d);
  });
  // One resize after the size settles: every resize makes a full-screen CLI redraw, and dragging
  // the window or the dock produces dozens.
  let resizeTimer = null;
  term.onResize(({ cols, rows }) => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => { if (tab.id && !tab.exited) api.termResize(tab.id, cols, rows); }, 120);
  });
  term.attachCustomKeyEventHandler((e) => {
    if (e.type !== 'keydown') return true;
    const mod = IS_MAC ? e.metaKey : e.ctrlKey;
    const k = e.key.toLowerCase();
    if (mod && k === 'c' && (e.shiftKey || term.hasSelection())) {
      e.preventDefault();
      copyFromTerm(tab);
      return false;
    }
    // xterm must not send ^V, but the browser's native paste event goes through: it carries the
    // clipboard text with no clipboard-read permission (a browser tab, the remote window, #746)
    if ((mod && k === 'v') || (e.shiftKey && e.key === 'Insert')) return false;
    return true;
  });
  // The paste of Ctrl+V / Cmd+V / Shift+Insert and of an Edit menu (#746): read from the event, then
  // stop it so xterm's own listener never pastes a second time. A paste right after the context
  // menu's clipboard read is the same one.
  pane.addEventListener('paste', (e) => {
    e.preventDefault();
    e.stopImmediatePropagation();
    if (Date.now() - tab.lastPaste < 800) return;
    const text = e.clipboardData?.getData('text/plain');
    if (!text) return;
    if (readOnlyTerm(tab.kind)) { (tab.flash || flashTermMsg)(t('term_dock.this_terminal_is_read_only')); return; }
    term.paste(text);
  }, true);
  pane.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    if (term.hasSelection()) copyFromTerm(tab);
    else pasteIntoTerm(tab);
  });
  pane.addEventListener('mousedown', () => (tab.onFocus ? tab.onFocus() : activateTab(tab)));
}

async function copyFromTerm(tab) {
  const text = tab.term.getSelection();
  if (!text) return;
  tab.term.clearSelection();
  const flash = tab.flash || flashTermMsg;
  try { await api.clipboardWrite(text); flash(t('term_dock.copied')); } catch (e) { flash(errMsg(e), true); }
}

// The context menu's paste reads the clipboard; a refused read (a browser, a remote window over
// plain http) says to use Ctrl+V, whose paste event needs no permission (#746).
async function pasteIntoTerm(tab) {
  tab.lastPaste = Date.now();
  const flash = tab.flash || flashTermMsg;
  let text;
  try { text = await api.clipboardRead(); } catch {
    // nothing was pasted: the Ctrl+V the message asks for must go through at once
    tab.lastPaste = 0;
    flash(t('term_dock.use_ctrl_v_to_paste'), true);
    return;
  }
  tab.lastPaste = Date.now();
  if (!text) return;
  if (readOnlyTerm(tab.kind)) { flash(t('term_dock.this_terminal_is_read_only')); return; }
  tab.term.paste(text);
}

let termMsgTimer = null;
function flashTermMsg(text, error = false) {
  const el = $('#term-msg');
  el.textContent = text;
  el.classList.toggle('error', error);
  clearTimeout(termMsgTimer);
  termMsgTimer = setTimeout(() => (el.textContent = ''), 2500);
}

function markExited(tab, exitCode) {
  if (tab.exited) return;
  tab.exited = true;
  tab.exitCode = exitCode; // #783: a suggested command's listeners read it (command-hint.js)
  tab.term.write(`\r\n\x1b[90m[process exited with code ${exitCode ?? '?'}]\x1b[0m\r\n`);
  if (tab.onChange) tab.onChange();
  else renderTermTabs();
}

function showDock() {
  $('#term-dock').classList.remove('hidden');
  if (dock.collapsed) setDockCollapsed(false);
}

function activateTab(tab) {
  if (dock.active === tab && tab.pane.classList.contains('active')) return;
  dock.active = tab;
  dock.tabs.forEach((t) => t.pane.classList.toggle('active', t === tab));
  renderTermTabs();
  requestAnimationFrame(() => { fitActive(); tab.term.focus(); });
}

function fitActive() {
  const t = dock.active;
  if (!t || dock.collapsed || $('#term-dock').classList.contains('hidden')) return;
  try { t.fit.fit(); } catch { /* not visible yet */ }
}

function closeTab(tab, { kill = true } = {}) {
  const i = dock.tabs.indexOf(tab);
  if (i < 0) return;
  if (kill && tab.id && !tab.exited) api.termKill(tab.id).catch(() => {});
  dock.tabs.splice(i, 1);
  tab.term.dispose();
  tab.pane.remove();
  if (dock.active === tab) {
    dock.active = null;
    const next = dock.tabs[i] || dock.tabs[i - 1];
    if (next) activateTab(next);
  }
  if (!dock.tabs.length) $('#term-dock').classList.add('hidden');
  renderTermTabs();
}

function renderTermTabs() {
  const box = $('#term-tabs');
  box.innerHTML = dock.tabs.map((t, i) => `
    <div class="term-tab ${t === dock.active ? 'active' : ''}" data-i="${i}" role="tab" aria-selected="${t === dock.active}" title="${esc(t.title)}${readOnlyTerm(t.kind) ? ' (read-only)' : ''}">
      <span class="term-dot ${t.exited ? 'exited' : t.id ? 'running' : 'starting'}"></span>
      <span class="term-title">${esc(t.title)}</span>
      <button class="term-close" data-close="${i}" title="${I18n.t('term_dock.close_ends_the_process')}" aria-label="${I18n.t('common.close')}">×</button>
    </div>`).join('');
  box.querySelectorAll('.term-tab').forEach((el) => (el.onclick = (e) => {
    const t = dock.tabs[Number(el.dataset.i)];
    if (e.target.closest('[data-close]')) closeTab(t);
    else activateTab(t);
  }));
  box.querySelectorAll('.term-tab').forEach((el) => (el.onauxclick = (e) => { if (e.button === 1) closeTab(dock.tabs[Number(el.dataset.i)]); }));
  $('#btn-term-popout').disabled = !dock.active || dock.active.kind === 'supervisor';
}

async function popOutActive() {
  const t = dock.active;
  if (!t) return;
  try {
    await api.openSessionTerminal(t.sessionId, t.kind, t.runId);
    flashTermMsg(I18n.t('term_dock.opened_in_an_external_window'));
  } catch (e) {
    flashTermMsg(errMsg(e), true);
  }
}
