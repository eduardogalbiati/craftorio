// window.api for the browser: the same methods as src/preload.js, built from the same channel
// manifest (src/service/manifest.js), fetched from the engine server (GET /api/manifest) and
// called over its HTTP + WebSocket API (src/server). In the desktop app the preload has already
// defined window.api and this file does nothing. Nothing here lists channels: only the few methods
// the browser does its own way (below) are named.
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

  // Synchronous on purpose: the page's scripts use window.api as soon as they run.
  function fetchManifest() {
    const xhr = new XMLHttpRequest();
    xhr.open('GET', '/api/manifest', false);
    xhr.withCredentials = true;
    try {
      xhr.send();
      return xhr.status === 200 ? JSON.parse(xhr.responseText).result || [] : [];
    } catch {
      return [];
    }
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

  // Desktop-only methods the browser can still do its own way; the others throw.
  const browser = {
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
    onReconnect: (cb) => { reconnected.add(cb); return () => reconnected.delete(cb); },
  };
  for (const entry of fetchManifest()) {
    if (entry.method) api[entry.method] = method(entry);
  }
  window.api = api;
})();
