// window.api for the browser: the same methods as src/host/preload.js, built from the same channel
// manifest (packages/engine/service/manifest.js), fetched from the engine server (GET /api/manifest) and
// called over its HTTP + WebSocket API (packages/engine/server). In the desktop app the preload has already
// defined window.api and this file does nothing. Nothing here lists channels: only the few methods
// the browser does its own way (below) are named. On each connection it compares the engine's
// contract (GET /api/version) with the manifest's and shows a reload banner when they differ (#339).
// load: early (app.js calls window.api as it loads)
(() => {
  if (window.api) return;

  async function call(channel, arg) {
    const res = await fetch(`/api/${channel}`, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ arg: arg === undefined ? null : arg }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || `The server answered HTTP ${res.status}.`);
    return body.result;
  }

  // Synchronous on purpose: the page's scripts use window.api as soon as they run. → { result, contract }
  function fetchManifest() {
    const xhr = new XMLHttpRequest();
    xhr.open('GET', '/api/manifest', false);
    xhr.withCredentials = true;
    try {
      xhr.send();
      const body = xhr.status === 200 ? JSON.parse(xhr.responseText) : {};
      return { result: body.result || [], contract: body.contract || null };
    } catch {
      return { result: [], contract: null };
    }
  }
  // the interface this page was built for: the contract of the manifest window.api comes from (#339)
  const manifest = fetchManifest();

  // Version handshake (#339): on every connection, GET /api/version; an engine speaking another
  // contract than this page's window.api gets a banner offering a reload (one at a time).
  function showVersionSkew(engine) {
    if (document.querySelector('[data-testid="version-skew-banner"]')) return;
    const box = document.createElement('div');
    box.className = 'code-banner version-skew-banner';
    box.setAttribute('role', 'alert');
    box.setAttribute('data-testid', 'version-skew-banner');
    const text = document.createElement('span');
    text.textContent = t('api_http.this_engine_runs_another_version_engine', { app: engine.app, contract: engine.contract });
    const reload = document.createElement('button');
    reload.className = 'btn sm primary';
    reload.type = 'button';
    reload.setAttribute('data-testid', 'version-skew-reload');
    reload.textContent = t('api_http.reload');
    reload.addEventListener('click', () => location.reload());
    box.append(text, reload);
    document.body.appendChild(box);
  }
  async function checkVersion() {
    if (!manifest.contract) return;
    try {
      const res = await fetch('/api/version', { credentials: 'same-origin' });
      if (!res.ok) return;
      const engine = await res.json();
      if (engine?.contract == null) return;
      if (String(engine.contract) !== manifest.contract) showVersionSkew(engine);
      // back on an engine with this page's contract: nothing to reload any more
      else document.querySelector('[data-testid="version-skew-banner"]')?.remove();
    } catch { /* the engine is unreachable: the next connection checks again */ }
  }

  // Pushed channels (run:event, term:data, term:exit, auth:changed) and fire-and-forget messages.
  // Reconnects when the connection drops (server restart, network); events pushed meanwhile are
  // lost, so a reconnection is announced (onReconnect) for the UI to read the state again.
  const listeners = new Map();
  const reconnected = new Set();
  const outbox = [];
  let socket = null;
  let dropped = false;
  function connect() {
    socket = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`);
    socket.onopen = () => {
      while (outbox.length && socket.readyState === WebSocket.OPEN) socket.send(outbox.shift());
      if (dropped) for (const cb of reconnected) cb();
      dropped = false;
      checkVersion();
    };
    socket.onmessage = (m) => {
      let msg;
      try { msg = JSON.parse(m.data); } catch { return; }
      for (const cb of listeners.get(msg.channel) || []) cb(msg.payload);
    };
    socket.onclose = () => { dropped = true; setTimeout(connect, 1500); };
  }
  connect();
  const subscribe = (channel) => (cb) => {
    if (!listeners.has(channel)) listeners.set(channel, new Set());
    listeners.get(channel).add(cb);
    return () => listeners.get(channel).delete(cb);
  };
  const notify = (channel, arg) => {
    const msg = JSON.stringify({ channel, arg });
    if (socket?.readyState === WebSocket.OPEN) socket.send(msg); else outbox.push(msg);
  };

  // The positional arguments of a method -> the channel's one argument (see `params` in the manifest).
  function payload(params, args) {
    if (!params) return undefined;
    if (typeof params === 'string') return args[0];
    const out = {};
    params.forEach((name, i) => {
      if (name.startsWith('...')) Object.assign(out, args[i]);
      else out[name] = args[i];
    });
    return out;
  }

  // The desktop app showing this engine from another computer (src/host/engine-connection-window.js) marks
  // its user agent; its Settings › Execution › Engine opens the app's connection page by opening a
  // path the window catches (CONNECTION_PATH in src/host/engine-connection.js: the server never sees it).
  const desktopClient = /\bMultiagentRemoteClient\b/.test(navigator.userAgent || '');

  // Desktop-only methods the browser can still do its own way; the others throw.
  const browser = {
    // the page's interface language goes along (#329): the connection page speaks it too
    ...(desktopClient && {
      openEngineConnection: async () => {
        const lang = window.I18n?.getLanguage?.();
        window.open(`/__desktop__/engine-connection${lang ? `?lang=${encodeURIComponent(lang)}` : ''}`);
        return true;
      },
    }),
    // no native folder picker in the browser: the path is typed (a folder on the server)
    pickFolder: async () => window.prompt('Folder path on the server:')?.trim() || null,
    clipboardRead: () => navigator.clipboard.readText(),
    clipboardWrite: async (text) => { await navigator.clipboard.writeText(String(text ?? '')); return true; },
    // an artifact's image (#114): the browser's clipboard takes PNG only, so others go through a canvas.
    // Copying the file itself has no web equivalent (clipboardWriteFile throws; the UI hides it).
    clipboardWriteImage: async (path) => {
      const art = await call('artifacts:read', { path });
      if (!art.image) throw new Error('The image is too large to copy here.');
      const img = new Image();
      img.src = art.image;
      await img.decode();
      const canvas = Object.assign(document.createElement('canvas'), { width: img.naturalWidth, height: img.naturalHeight });
      canvas.getContext('2d').drawImage(img, 0, 0);
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      return true;
    },
  };

  function method(entry) {
    if (browser[entry.method]) return browser[entry.method];
    if (entry.desktop) return async () => { throw new Error(`${entry.desktop} is only available in the desktop app.`); };
    // desktop notifications are shown by the desktop app only; the browser never gets a click
    if (entry.event) return subscribe(entry.event);
    if (entry.send) return (...args) => notify(entry.send, payload(entry.params, args));
    return (...args) => call(entry.channel, payload(entry.params, args));
  }

  const api = {
    platform: 'browser',
    // the ↗ buttons open a window on the desktop app's machine only (#318)
    externalTerminal: { available: false, reason: 'External terminal windows are only available in the desktop app.' },
    // where this page's engine runs, seen from the window: 'remote' inside the desktop app, else 'browser'
    engineConnection: { mode: desktopClient ? 'remote' : 'browser', host: location.host },
    onReconnect: (cb) => { reconnected.add(cb); return () => reconnected.delete(cb); },
  };
  for (const entry of manifest.result) {
    if (entry.method) api[entry.method] = method(entry);
  }
  window.api = api;
})();
