// The run's 3D view: a full-screen overlay over the whole app (top bar, sidebar, drawers, terminal
// dock), opened by the 3D button beside Chat on the Run screen (#run-mode-3d) and in the run chat's
// header (#rc-3d). It shows the run as it happens: the recorded events first (runs:events with
// `activity: true`), then the live run:event, both into a Run3DPlayer (run3d-replay.js), which folds
// them into a Run3DModel (run3d-model.js) and can replay them: a finished run opens on its final
// state, a live run opens live, and either can be replayed from the pipeline card (the live events
// keep arriving and are kept while a past moment is shown). It only reads the run: it writes
// nothing, and it never answers a human gate: "Open the gate" closes it and opens the run where the
// app answers gates (showRun: the chat or the Run screen's gate cards).
// Its theme (run3d-theme.js) is dark by default, as the app, or the light one of the proof of
// concept: `data-theme` on the overlay (run3d.css), remembered across openings and restarts.
// The scene itself (React + React Three Fiber + three) is one prebuilt bundle,
// generated/run3d-scene.js (scripts/build-3d.js), loaded with a plain <script src> on the first
// click, so the app's start does not change. The buttons are disabled, with the reason in their
// tooltip, when WebGL is not available or the bundle is missing (checked when the app is idle).
// Close (its button or Esc) unmounts the scene: the WebGL context, textures, geometries, the clock
// and the run:event listener are released. While the window is hidden or minimised the scene stops
// drawing (its Canvas' loop is 'never', run3d/main.jsx) and the HUD's clock skips its ticks (#388). Exposes window.Run3D = { open(runId), close(), isOpen() }.
(() => {
  const BUNDLE = '../../generated/run3d-scene.js';
  const MISSING = 'The 3D view is not built: run `npm run build:3d` (or `npm install`) and reload.';
  const TICK_MS = 500; // the clock of the HUD (elapsed time, a robot's `done` that turns `idle`)
  let current = null; // the open overlay: { runId, el, player, handle, off, timer, buffer, closed, opener }
  let bundle = null; // the bundle's load, once
  let unavailable = ''; // why the 3D view cannot open here ('' = it can)

  const buttons = () => document.querySelectorAll('[data-run3d]');
  function paintButtons() {
    for (const b of buttons()) {
      b.disabled = !!unavailable;
      b.title = unavailable || b.dataset.title || 'Show this run in 3D';
    }
  }
  function markUnavailable(reason) {
    unavailable = reason;
    paintButtons();
  }

  // WebGL: a context made and given back at once
  function webglProblem() {
    try {
      const gl = document.createElement('canvas').getContext('webgl2') || document.createElement('canvas').getContext('webgl');
      if (!gl) return 'WebGL is not available in this window, so the 3D view cannot be drawn.';
      gl.getExtension('WEBGL_lose_context')?.loseContext();
      return '';
    } catch (e) {
      return `WebGL is not available in this window: ${e.message}`;
    }
  }

  // Is the bundle there? A prefetch reads the file without running it (and warms the cache for the
  // first click); no answer within a few seconds (a page that does not prefetch) counts as "yes".
  function probeBundle() {
    if (window.Run3DScene) return;
    const link = document.createElement('link');
    link.rel = 'prefetch';
    link.href = BUNDLE;
    const done = () => { clearTimeout(timer); link.remove(); };
    const timer = setTimeout(done, 5000);
    link.onload = done;
    link.onerror = () => { done(); markUnavailable(MISSING); };
    document.head.append(link);
  }

  function loadBundle() {
    if (window.Run3DScene) return Promise.resolve();
    bundle ||= new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = BUNDLE;
      script.onload = () => (window.Run3DScene ? resolve() : reject(new Error(MISSING)));
      script.onerror = () => { bundle = null; script.remove(); reject(new Error(MISSING)); };
      document.head.append(script);
    });
    return bundle;
  }

  // The human gates drawn before the run reaches them: those of the workflow's pipeline (the gates
  // its mode turns on and the groups of human gates, RunProgress.workflowStations); any other gate
  // (a failure's) gets its station when the run reaches it.
  function mainGatesOf(started, workflows) {
    if (!started || !window.RunProgress?.workflowStations) return [];
    const wf = (workflows || []).find((w) => w && (w.file === started.file || w.name === started.workflow));
    if (!wf?.steps?.length) return [];
    return RunProgress.workflowStations({ steps: wf.steps, groups: wf.groups || [], mode: started.inputs?.mode ?? null })
      .filter((st) => st.gate || st.human).flatMap((st) => st.steps);
  }

  function message(text, { error = false } = {}) {
    if (!current) return;
    current.el.querySelector('.r3d-root').innerHTML = `<div class="r3d-message"${error ? ' role="alert"' : ''}>
      <p>${esc(text)}</p><button type="button" class="r3d-primary inline" data-r3d-close>${t('common.close')}</button></div>`;
  }

  async function open(runId, opener = null) {
    if (current || !runId || unavailable) return;
    const el = document.createElement('div');
    el.className = 'r3d';
    el.tabIndex = -1;
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-modal', 'true');
    el.setAttribute('aria-label', 'Run in 3D');
    el.dataset.testid = 'run3d';
    el.dataset.theme = Run3DTheme.load();
    el.innerHTML = '<div class="r3d-root"></div>';
    document.body.append(el);
    const session = current = { runId, el, player: null, handle: null, off: null, timer: null, buffer: [], closed: false, opener };
    el.addEventListener('click', (e) => { if (e.target.closest('[data-r3d-close]')) close(); });
    document.addEventListener('keydown', onKey, true);
    el.focus({ preventScroll: true });
    message('Loading the 3D view…');
    // live events that arrive while the recorded ones load wait, then follow in order (the player
    // skips any already taken, by its seq); they are taken while a replay is shown too
    session.off = api.onEvent((ev) => {
      if (ev.run_id !== runId) return;
      if (!session.player) { session.buffer.push(ev); return; }
      if (ev.type === 'workflow.started') session.player.setMainGates(mainGatesOf(ev, session.workflows));
      session.player.add([ev]);
    });
    let events;
    try {
      const workflows = state.workflows?.length ? state.workflows : api.listWorkflows().catch(() => []);
      [, events, session.workflows] = await Promise.all([loadBundle(), api.runEvents(runId, { activity: true }), workflows]);
    } catch (e) {
      if (session.closed) return;
      if (String(e.message) === MISSING) markUnavailable(MISSING);
      message(e.message === MISSING ? MISSING : `Could not load the run: ${errMsg(e)}`, { error: true });
      return;
    }
    if (session.closed) return;
    const started = events.find((ev) => ev.type === 'workflow.started');
    const player = new Run3DReplay.Run3DPlayer({ mainGates: mainGatesOf(started, session.workflows) });
    player.add([...events, ...session.buffer]);
    session.buffer = [];
    session.player = player;
    const live = isRunLive(runId);
    // a past run whose end was never recorded (the app closed under it)
    if (!live && events.length) player.interrupt();
    session.el.querySelector('.r3d-root').innerHTML = '';
    try {
      session.handle = Run3DScene.mount(session.el.querySelector('.r3d-root'), {
        player, workflows: session.workflows, theme: el.dataset.theme, canAnswer: live, onClose: close,
        onOpenGate: () => { close(); window.showRun?.(runId); },
        // the toggle's choice: painted at once, remembered when this window can (it works without)
        onTheme: (name) => { el.dataset.theme = name; Run3DTheme.save(name); },
      });
    } catch (e) {
      message(`The 3D view could not open: ${errMsg(e)}`, { error: true });
      return;
    }
    // nothing to tick while the window is hidden or minimised (the scene stops its loop then, #388)
    session.timer = setInterval(() => { if (!document.hidden) player.notify(); }, TICK_MS);
  }

  function close() {
    const session = current;
    if (!session) return;
    current = null;
    session.closed = true;
    session.off?.();
    clearInterval(session.timer);
    document.removeEventListener('keydown', onKey, true);
    try { session.handle?.unmount(); } catch { /* the scene failed already: nothing left to release */ }
    session.el.remove();
    session.opener?.focus({ preventScroll: true });
  }

  function onKey(e) {
    if (e.key !== 'Escape' || !current) return;
    e.preventDefault();
    e.stopPropagation();
    close();
  }

  // the run a 3D button shows: the Run screen's, or the run chat's
  const runOf = (button) => (button.dataset.run3d === 'chat' ? window.runChatShownRunId?.() : state.runId);

  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-run3d]');
    if (!b || b.disabled) return;
    open(runOf(b), b);
  });

  document.addEventListener('DOMContentLoaded', () => {
    for (const b of buttons()) b.dataset.title = b.title;
    const check = () => {
      const problem = webglProblem();
      if (problem) markUnavailable(problem);
      else probeBundle();
    };
    if (window.requestIdleCallback) requestIdleCallback(check, { timeout: 4000 });
    else setTimeout(check, 1000);
  });

  window.Run3D = { open, close, isOpen: () => !!current };
})();
