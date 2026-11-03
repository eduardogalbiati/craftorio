// Findings button (#361), after the `sightline` seed of Kent Beck's ToolSeeds: a tool for the people
// building this app. The sidebar's Findings entry (or Ctrl+Shift+F) freezes the view: the window's
// real pixels (api.captureWindow: window:capture in the local desktop app; in the remote engine's window
// and in a browser tab, apps/web/renderer/api-http.js's native capture or DOM drawing, #751) fill an
// overlay that stays until Save / File as issue / Cancel, so nothing updates under the marks. A capture
// that fails says so in the interface language and the marks go on a blank picture. When it shows: FindingsModel.buttonVisible (from source, or
// Settings › General › "Findings button"; never in a scripts/screenshot.js capture unless asked).
// - Marks: numbered pins (each resolved to the element under it: its data-testid, the view and tab,
//   the ids it carries, its box; FindingsModel.resolvePin), circle, box, arrow and freehand, each with
//   an optional note in the side list; a note for the finding. Ctrl+Z removes the last mark.
// - Save: findings:save with the capture, the capture with the marks drawn (marked.png), the marks
//   and the context: view and tab, project, the run ids on screen, window size, theme and the last
//   50 UI actions recorded here (navigation, clicks with their data-* targets); the service adds its
//   channel calls, the main log and the app's version and commit (packages/engine/service/channels/findings.js).
//   Saved: the path and "Open folder".
// - File as issue: saves first, then findings:file to the current project's Product Owner: "Filed"
//   with the issue link, or "Sent" while the request waits for the owner's click in its drawer.
// - Esc or Cancel closes it; nothing is saved unless Save or File as issue was clicked.
// Findings.renderList(el): Settings › General's list of saved findings with their status.
// Uses app.js's globals at call time (api, esc, errMsg, state) and window.CurrentProject; reads
// window.FindingsModel (packages/shared/findings-model.js, loaded before the renderer's files) as it loads.
(() => {
  const M = window.FindingsModel;
  // the labels are read when shown (#751), so they follow the interface language
  const TOOLS = ['pin', 'circle', 'box', 'arrow', 'freehand'];
  const toolLabel = (k) => t(`findings.tool_${k}`);
  const STATUS = { saved: 'findings.status_saved', sent: 'findings.status_sent', filed: 'findings.filed' };
  const COLOR = '#f43f5e';
  const actions = [];
  let last = null;
  let info = null;
  let visible = false;
  let button = null;
  let cur = null;

  const g = () => (typeof state !== 'undefined' ? state : {});
  const cut = (s, n) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

  // ---- where the owner is, and what they did ---------------------------------------------------
  function currentTab() {
    const s = g();
    if (s.view === 'run') return s.tab || null;
    if (s.view === 'workflows') return s.workflowsTab || null;
    if (s.view === 'settings') return document.querySelector('.settings-tab.active')?.dataset.stab || null;
    const tab = document.querySelector('.view:not(.hidden) [role="tab"][aria-selected="true"]');
    return tab ? cut(tab.textContent.trim(), 40) || null : null;
  }

  const where = () => ({ view: g().view || null, tab: currentTab() });

  function noteNavigation() {
    const now = where();
    if (last && now.view === last.view && now.tab === last.tab) return;
    if (last) M.remember(actions, { type: 'navigate', from: last, to: now, at: Date.now() });
    last = now;
  }

  // a click's target: the control clicked, its data-testid and data-* ids, never a field's value
  function onAppClick(e) {
    if (cur?.el.contains(e.target)) return;
    const el = e.target.closest?.('[data-testid], button, a, [role="button"], [role="tab"], [data-view]') || e.target;
    if (!el || el.nodeType !== 1) return;
    const pin = M.resolvePin(el, {});
    const target = { tag: el.localName, testid: pin.testid || null, ...(pin.ids || {}) };
    if (el.dataset?.view) target.dataView = el.dataset.view;
    if (/^(button|a)$/.test(el.localName) || el.getAttribute('role')) target.text = cut((el.getAttribute('aria-label') || el.textContent || '').trim().replace(/\s+/g, ' '), 60);
    M.remember(actions, { type: 'click', target, ...where(), at: Date.now() });
    setTimeout(noteNavigation, 50);
  }

  // ---- the button ----------------------------------------------------------------------------
  function mountButton() {
    if (button) return;
    button = document.createElement('button');
    button.type = 'button';
    button.className = 'nav-item nav-findings hidden';
    button.dataset.testid = 'findings-button';
    button.title = t('findings.findings_freeze_this_view_mark_what', { SHORTCUT: M.SHORTCUT });
    button.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8" /><circle cx="12" cy="12" r="2.5" /><line x1="12" y1="1.5" x2="12" y2="5" /><line x1="12" y1="19" x2="12" y2="22.5" /><line x1="1.5" y1="12" x2="5" y2="12" /><line x1="19" y1="12" x2="22.5" y2="12" /></svg><span>${t('findings.findings')}</span>`;
    // not a screen of the sidebar: app.js's navigation never sees this click
    button.addEventListener('click', (e) => { e.stopPropagation(); open(); });
    // #411 at the menu's end: entries registered later go before the highest order (view-registry.js)
    button.dataset.order = '9999';
    const menu = document.querySelector('nav.sidebar .sidebar-menu');
    if (menu) menu.append(button);
    else document.body.appendChild(button);
  }

  async function refresh() {
    try {
      info = info || await api.appInfo();
      visible = M.buttonVisible({ isPackaged: info.isPackaged, settings: await api.getSettings(), screenshot: info.screenshot });
    } catch {
      visible = false;
    }
    mountButton();
    button.classList.toggle('hidden', !visible);
    return visible;
  }

  // ---- the overlay -----------------------------------------------------------------------------
  async function open() {
    if (cur) return;
    noteNavigation();
    const at = where();
    const size = { width: window.innerWidth, height: window.innerHeight };
    const context = contextOf(at, size);
    let image = null;
    let reason = null;
    try {
      image = typeof api.captureWindow === 'function' ? await api.captureWindow() : null;
      if (!image) reason = 'no picture';
    } catch (e) {
      reason = errMsg(e);
    }
    if (cur) return;
    build({ at, size, context, image });
    // #751 the catalog's words only (the reason is often English): the reason on hover and in the console
    if (reason) {
      console.warn(`Findings: the capture failed: ${reason}`);
      setStatus('error', t('findings.capture_failed'), '', 'findings-capture-error');
      cur.el.querySelector('[data-testid="findings-capture-error"]')?.setAttribute('title', reason);
    }
  }

  function build({ at, size, context, image }) {
    const el = document.createElement('div');
    el.className = 'fd';
    el.tabIndex = -1;
    el.dataset.testid = 'findings-overlay';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-modal', 'true');
    el.setAttribute('aria-label', t('findings.findings'));
    el.innerHTML = `
      <div class="fd-bar" data-testid="findings-toolbar" role="toolbar" aria-label="${t('findings.marking_tools')}">
        <div class="seg sm fd-tools">${TOOLS.map((k) => `<button type="button" data-fd-tool="${k}" data-testid="findings-tool-${k}" aria-pressed="false">${toolLabel(k)}</button>`).join('')}</div>
        <button type="button" class="btn sm ghost" data-fd-undo data-testid="findings-undo" title="${t('findings.remove_the_last_mark_ctrl_z')}">${t('findings.undo_mark')}</button>
        <span class="fd-spacer"></span>
        <span class="fd-status small" data-testid="findings-status" role="status" aria-live="polite"><span class="fd-status-text">${t('findings.marking_click_the_frozen_view_to')}</span></span>
        <button type="button" class="btn sm primary" data-fd-save data-testid="findings-save">${t('common.save')}</button>
        <button type="button" class="btn sm" data-fd-file data-testid="findings-file-issue" title="${t('findings.send_it_to_the_product_owner')}">${t('findings.file_as_issue')}</button>
        <button type="button" class="btn sm ghost" data-fd-cancel data-testid="findings-cancel" title="${t('findings.close_without_saving_esc')}">${t('common.cancel')}</button>
      </div>
      <div class="fd-main">
        <div class="fd-stage">
          <div class="fd-frame" data-testid="findings-frame">
            <span class="fd-frame-label" data-testid="findings-frame-label">${t('findings.frozen_view_width', { width: size.width })}${size.height}</span>
            ${image ? `<img class="fd-img" data-testid="findings-frozen-image" alt="${t('findings.the_frozen_view')}" draggable="false" />` : '<div class="fd-img fd-blank"></div>'}
            <canvas class="fd-canvas" data-testid="findings-canvas" aria-label="${t('findings.the_frozen_view_click_or_drag')}"></canvas>
            <div class="fd-pins"></div>
          </div>
        </div>
        <aside class="fd-side">
          <label class="fd-field"><span>${t('findings.note')}</span><textarea data-testid="findings-note" rows="5" placeholder="${t('findings.what_is_wrong_on_this_screen')}"></textarea></label>
          <div class="fd-field"><span>${t('findings.marks')}</span><ol class="fd-marks" data-testid="findings-marks" data-empty="${t('findings.no_marks_yet')}"></ol></div>
          <p class="muted small">${esc(at.view || '?')}${at.tab ? ` › ${esc(at.tab)}` : ''} · ${size.width}×${size.height}</p>
        </aside>
      </div>`;
    document.body.appendChild(el);
    cur = { el, at, size, context, image, marks: [], tool: 'pin', drawing: null, saved: null, busy: false, opener: document.activeElement };
    if (image) el.querySelector('.fd-img').setAttribute('src', image);
    const canvas = el.querySelector('.fd-canvas');
    canvas.addEventListener('click', onCanvasClick);
    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerup', onPointerUp);
    el.querySelector('.fd-tools').addEventListener('click', (e) => { const b = e.target.closest('[data-fd-tool]'); if (b) pickTool(b.dataset.fdTool); });
    el.querySelector('[data-fd-undo]').onclick = undoMark;
    el.querySelector('[data-fd-save]').onclick = () => save().catch(() => {});
    el.querySelector('[data-fd-file]').onclick = fileIssue;
    el.querySelector('[data-fd-cancel]').onclick = close;
    el.querySelector('.fd-marks').addEventListener('input', (e) => { const i = Number(e.target.dataset.fdNote); if (cur.marks[i]) cur.marks[i].note = e.target.value; });
    el.querySelector('.fd-marks').addEventListener('click', (e) => { const b = e.target.closest('[data-fd-remove]'); if (b) removeMark(Number(b.dataset.fdRemove)); });
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('resize', layout);
    pickTool('pin');
    layout();
    el.focus({ preventScroll: true });
  }

  function close() {
    if (!cur) return;
    const { el, opener } = cur;
    cur = null;
    window.removeEventListener('keydown', onKey, true);
    window.removeEventListener('resize', layout);
    el.remove();
    if (opener?.isConnected && typeof opener.focus === 'function') opener.focus({ preventScroll: true });
  }

  function onKey(e) {
    if (!cur) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      close();
    } else if (e.ctrlKey && !e.shiftKey && e.key.toLowerCase() === 'z' && e.target.localName !== 'textarea' && e.target.localName !== 'input') {
      e.preventDefault();
      undoMark();
    }
  }

  function pickTool(tool) {
    cur.tool = tool;
    cur.el.querySelectorAll('[data-fd-tool]').forEach((b) => {
      b.classList.toggle('active', b.dataset.fdTool === tool);
      b.setAttribute('aria-pressed', String(b.dataset.fdTool === tool));
    });
    cur.el.querySelector('.fd-canvas').dataset.tool = tool;
  }

  // the frame shows the window scaled to fit the stage's content box, centred; marks are kept in the window's coordinates
  function layout() {
    if (!cur) return;
    const stageEl = cur.el.querySelector('.fd-stage');
    const pad = getComputedStyle(stageEl);
    const room = {
      width: stageEl.clientWidth - parseFloat(pad.paddingLeft) - parseFloat(pad.paddingRight),
      height: stageEl.clientHeight - parseFloat(pad.paddingTop) - parseFloat(pad.paddingBottom),
    };
    const scale = Math.min(1, room.width / cur.size.width, room.height / cur.size.height) || 1;
    const w = Math.max(1, Math.round(cur.size.width * scale));
    const h = Math.max(1, Math.round(cur.size.height * scale));
    const frame = cur.el.querySelector('.fd-frame');
    frame.style.width = `${w}px`;
    frame.style.height = `${h}px`;
    const canvas = cur.el.querySelector('.fd-canvas');
    canvas.width = w;
    canvas.height = h;
    cur.scale = scale;
    renderPins();
    draw();
  }

  const toApp = (e) => {
    const r = cur.el.querySelector('.fd-canvas').getBoundingClientRect();
    return { x: Math.round((e.clientX - r.left) / cur.scale), y: Math.round((e.clientY - r.top) / cur.scale) };
  };

  // the element of the live page under a point of the window (the overlay left out)
  function elementAt(x, y) {
    const list = typeof document.elementsFromPoint === 'function' ? document.elementsFromPoint(x, y) : [];
    return list.find((el) => !cur.el.contains(el) && el !== cur.el) || null;
  }

  function onCanvasClick(e) {
    if (!cur || cur.tool !== 'pin') return;
    const p = toApp(e);
    const n = cur.marks.filter((m) => m.type === 'pin').length + 1;
    const element = M.resolvePin(elementAt(p.x, p.y), { x: p.x, y: p.y, view: cur.at.view, tab: cur.at.tab });
    addMark({ type: 'pin', n, x: p.x, y: p.y, note: '', element });
  }

  function onPointerDown(e) {
    if (!cur || cur.tool === 'pin' || e.button !== 0) return;
    const p = toApp(e);
    e.currentTarget.setPointerCapture?.(e.pointerId);
    cur.drawing = cur.tool === 'freehand' ? { type: 'freehand', points: [p] } : { type: cur.tool, from: p, to: p };
  }

  function onPointerMove(e) {
    if (!cur?.drawing) return;
    const p = toApp(e);
    if (cur.drawing.type === 'freehand') cur.drawing.points.push(p);
    else cur.drawing.to = p;
    draw();
  }

  function onPointerUp() {
    const d = cur?.drawing;
    if (!d) return;
    cur.drawing = null;
    const mark = shapeOf(d);
    if (mark) addMark(mark);
    else draw();
  }

  // a drag → the mark saved (circle: centre and radius; box: corner and size; arrow: from → to)
  function shapeOf(d) {
    if (d.type === 'freehand') return d.points.length > 2 ? { type: 'freehand', points: d.points, note: '' } : null;
    const dx = d.to.x - d.from.x;
    const dy = d.to.y - d.from.y;
    if (Math.hypot(dx, dy) < 4) return null;
    if (d.type === 'circle') return { type: 'circle', x: Math.round(d.from.x + dx / 2), y: Math.round(d.from.y + dy / 2), r: Math.round(Math.hypot(dx, dy) / 2), note: '' };
    if (d.type === 'box') return { type: 'box', x: Math.min(d.from.x, d.to.x), y: Math.min(d.from.y, d.to.y), width: Math.abs(dx), height: Math.abs(dy), note: '' };
    return { type: 'arrow', from: d.from, to: d.to, note: '' };
  }

  function addMark(mark) {
    cur.marks.push(mark);
    marksChanged();
  }

  function removeMark(i) {
    cur.marks.splice(i, 1);
    // pins keep 1..n with no gap
    let n = 0;
    for (const m of cur.marks) if (m.type === 'pin') m.n = ++n;
    marksChanged();
  }

  function undoMark() {
    if (cur?.marks.length) removeMark(cur.marks.length - 1);
  }

  function marksChanged() {
    cur.saved = null;
    cur.el.querySelector('[data-fd-save]').disabled = false;
    renderMarks();
    draw();
  }

  const markLabel = (m) => {
    if (m.type !== 'pin') return toolLabel(m.type);
    if (m.element?.empty) return t('findings.pin_n_empty_space', { n: m.n });
    return t('findings.pin_n_target', { n: m.n, target: m.element?.testid || m.element?.ids?.run || t('findings.no_data_testid') });
  };

  function renderMarks() {
    const list = cur.el.querySelector('.fd-marks');
    list.innerHTML = cur.marks.map((m, i) => `
      <li class="fd-mark">
        <span class="fd-mark-name" title="${esc(markLabel(m))}">${esc(markLabel(m))}</span>
        <input type="text" data-fd-note="${i}" value="${esc(m.note || '')}" placeholder="${t('findings.note_optional')}" aria-label="${t('findings.note_for_m', { m: esc(markLabel(m)) })}" />
        <button type="button" class="link-btn" data-fd-remove="${i}" aria-label="${t('findings.remove_m', { m: esc(markLabel(m)) })}" title="${t('findings.remove_this_mark')}">✕</button>
      </li>`).join('');
    renderPins();
  }

  // the pins sit on the frame at the current scale (re-placed on resize; the note inputs are left alone)
  function renderPins() {
    cur.el.querySelector('.fd-pins').innerHTML = cur.marks.filter((m) => m.type === 'pin').map((m) => `
      <span class="fd-pin" data-testid="findings-pin" style="left:${Math.round(m.x * cur.scale)}px;top:${Math.round(m.y * cur.scale)}px" title="${esc(markLabel(m))}">${m.n}</span>`).join('');
  }

  // ---- drawing (the overlay's canvas, and the marked PNG at the capture's resolution) --------------
  function paintShape(c, m, k) {
    c.beginPath();
    if (m.type === 'circle') c.arc(m.x * k, m.y * k, Math.max(1, m.r * k), 0, Math.PI * 2);
    else if (m.type === 'box') c.rect(m.x * k, m.y * k, m.width * k, m.height * k);
    else if (m.type === 'freehand') m.points.forEach((p, i) => (i ? c.lineTo(p.x * k, p.y * k) : c.moveTo(p.x * k, p.y * k)));
    else if (m.type === 'arrow') {
      const [x1, y1, x2, y2] = [m.from.x * k, m.from.y * k, m.to.x * k, m.to.y * k];
      const a = Math.atan2(y2 - y1, x2 - x1);
      const head = 12 * Math.max(1, k);
      c.moveTo(x1, y1);
      c.lineTo(x2, y2);
      c.moveTo(x2, y2);
      c.lineTo(x2 - head * Math.cos(a - 0.45), y2 - head * Math.sin(a - 0.45));
      c.moveTo(x2, y2);
      c.lineTo(x2 - head * Math.cos(a + 0.45), y2 - head * Math.sin(a + 0.45));
    }
    c.stroke();
  }

  function paintPin(c, m, k) {
    const r = 11 * Math.max(1, k);
    c.beginPath();
    c.arc(m.x * k, m.y * k, r, 0, Math.PI * 2);
    c.fillStyle = COLOR;
    c.fill();
    c.fillStyle = '#fff';
    c.font = `bold ${Math.round(12 * Math.max(1, k))}px sans-serif`;
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillText(String(m.n), m.x * k, m.y * k);
  }

  function paint(c, marks, k, { pins }) {
    c.strokeStyle = COLOR;
    c.lineWidth = 3 * Math.max(1, k);
    c.lineJoin = 'round';
    c.lineCap = 'round';
    for (const m of marks) if (m.type !== 'pin') paintShape(c, m, k);
    if (pins) for (const m of marks) if (m.type === 'pin') paintPin(c, m, k);
  }

  function draw() {
    if (!cur) return;
    const canvas = cur.el.querySelector('.fd-canvas');
    const c = canvas.getContext('2d');
    if (!c) return;
    c.clearRect(0, 0, canvas.width, canvas.height);
    const live = cur.drawing ? shapeOf(cur.drawing) : null;
    // pins are DOM elements over the canvas (numbered, located by the tests)
    paint(c, live ? [...cur.marks, live] : cur.marks, cur.scale, { pins: false });
  }

  const loadImage = (src) => new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('the capture did not load'));
    img.src = src;
  });

  // the capture (or a blank picture of the window's size) and the same with the marks drawn
  async function pictures() {
    const img = cur.image ? await loadImage(cur.image) : null;
    const w = img ? img.naturalWidth : cur.size.width;
    const h = img ? img.naturalHeight : cur.size.height;
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const g2 = c.getContext('2d');
    if (img) g2.drawImage(img, 0, 0);
    else { g2.fillStyle = '#111827'; g2.fillRect(0, 0, w, h); }
    const image = img ? cur.image : c.toDataURL('image/png');
    paint(g2, cur.marks, w / cur.size.width, { pins: true });
    return { image, marked: c.toDataURL('image/png') };
  }

  // ---- context, save, file -------------------------------------------------------------------------
  function contextOf(at, size) {
    const shown = (el) => el.getClientRects().length > 0;
    const runIds = [...document.querySelectorAll('[data-run], [data-run-id]')].filter(shown).map((el) => el.dataset.run || el.dataset.runId).filter(Boolean);
    if (g().runId) runIds.unshift(g().runId);
    const dark = document.documentElement.dataset.theme || (window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    return {
      view: at.view,
      tab: at.tab,
      project: window.CurrentProject?.get?.() || null,
      runIds: [...new Set(runIds)].slice(0, 50),
      window: size,
      theme: dark,
      actions: actions.slice(),
    };
  }

  // testid: the text's own data-testid (findings-capture-error, #751), gone with the next status
  function setStatus(kind, text, extra = '', testid = '') {
    if (!cur) return;
    const box = cur.el.querySelector('[data-testid="findings-status"]');
    box.className = `fd-status small fd-${kind}`;
    box.innerHTML = `<span class="fd-status-text"${testid ? ` data-testid="${esc(testid)}"` : ''}>${esc(text)}</span>${extra}`;
    box.querySelector('[data-fd-open]')?.addEventListener('click', () => api.openPath(box.querySelector('[data-fd-open]').dataset.fdOpen).catch(() => {}));
  }

  const busy = (on) => {
    cur.busy = on;
    for (const sel of ['[data-fd-save]', '[data-fd-file]']) cur.el.querySelector(sel).disabled = on || (sel === '[data-fd-save]' && !!cur.saved);
  };

  async function save() {
    if (!cur) throw new Error('closed');
    if (cur.saved) return cur.saved;
    const mine = cur;
    busy(true);
    setStatus('busy', t('findings.saving'));
    try {
      const { image, marked } = await pictures();
      const marks = JSON.parse(JSON.stringify(mine.marks));
      const note = mine.el.querySelector('[data-testid="findings-note"]').value.trim();
      const saved = await api.saveFinding({ image, marked, marks, note, context: mine.context });
      mine.saved = saved;
      if (cur !== mine) return saved;
      setStatus('saved', t('findings.saved_to_findings_id', { id: saved.id }), `<button type="button" class="btn sm ghost" data-fd-open="${esc(saved.dir)}">${t('findings.open_folder')}</button>`);
      return saved;
    } catch (e) {
      if (cur === mine) setStatus('error', t('findings.not_saved_e', { e: errMsg(e) }));
      throw e;
    } finally {
      if (cur === mine) busy(false);
    }
  }

  async function projectOf() {
    const id = window.CurrentProject?.get?.();
    if (id) return id;
    const list = await api.listProjects().catch(() => []);
    return list[0]?.id || null;
  }

  async function fileIssue() {
    if (!cur || cur.busy) return;
    const mine = cur;
    let saved;
    try {
      saved = await save();
    } catch {
      return;
    }
    const projectId = await projectOf();
    if (cur !== mine) return;
    if (!projectId) { setStatus('error', t('findings.saved_not_filed_pick_a_project')); return; }
    busy(true);
    setStatus('busy', t('findings.sending_it_to_the_product_owner'));
    try {
      const out = await api.fileFinding(saved.id, projectId);
      if (cur !== mine) return;
      if (!out.ok) setStatus('error', t('findings.saved_not_filed_value', { value: out.error || out.text || 'the Product Owner refused it' }));
      else if (out.status === 'sent') setStatus('sent', t('findings.sent_to_the_product_owner_it'));
      else setStatus('filed', t('findings.filed'), out.issueUrl ? ` <a href="${esc(out.issueUrl)}" target="_blank" rel="noopener">${esc(out.issueUrl)}</a>` : ` <span class="muted">${esc(cut(String(out.text || ''), 120))}</span>`);
    } catch (e) {
      if (cur === mine) setStatus('error', t('findings.saved_not_filed_e', { e: errMsg(e) }));
    } finally {
      if (cur === mine) busy(false);
    }
  }

  // ---- Settings › General › Findings -------------------------------------------------------------
  async function renderList(el) {
    if (!el) return;
    let list = [];
    try {
      list = await api.listFindings();
    } catch (e) {
      el.innerHTML = '';
      el.dataset.empty = t('findings.could_not_read_the_findings_e', { e: errMsg(e) });
      return;
    }
    el.dataset.empty = t('findings.no_findings_yet');
    el.innerHTML = list.map((f) => `
      <li class="fd-item" data-testid="settings-finding">
        <span class="fd-item-note" title="${esc(f.note || '')}">${esc(f.note || t('findings.no_note'))}</span>
        <span class="badge fd-badge-${esc(f.status)}">${esc(STATUS[f.status] ? t(STATUS[f.status]) : f.status)}</span>
        ${f.issueUrl ? `<a class="small" href="${esc(f.issueUrl)}" target="_blank" rel="noopener">${t('findings.issue')}</a>` : ''}
        <span class="muted small mono" title="${esc(f.dir)}">${esc(f.id)}</span>
        <button type="button" class="btn sm ghost" data-fd-open="${esc(f.dir)}">${t('findings.open_folder')}</button>
      </li>`).join('');
    el.querySelectorAll('[data-fd-open]').forEach((b) => (b.onclick = () => api.openPath(b.dataset.fdOpen).catch(() => {})));
  }

  // ---- start -------------------------------------------------------------------------------------
  document.addEventListener('click', onAppClick, true);
  document.addEventListener('keydown', (e) => {
    if (!cur && visible && M.isShortcut(e)) { e.preventDefault(); open(); }
  });
  refresh();

  window.Findings = { close, isOpen: () => !!cur, open, refresh, renderList };
})();
