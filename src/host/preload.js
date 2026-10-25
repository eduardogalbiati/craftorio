// window.api for the desktop app, built at load from the channel manifest the main process holds
// (packages/engine/service/manifest.js, merged from packages/engine/service/channels/*.js): nothing here lists channels, so
// a new channel needs no edit in this file. src/renderer/api-http.js builds the same object for the
// browser from the server's copy of the manifest. Sandboxed: only `electron` can be required.
const { contextBridge, ipcRenderer } = require('electron');

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

function method(entry) {
  if (entry.event) {
    return (cb) => {
      const handler = (_e, msg) => cb(msg);
      ipcRenderer.on(entry.event, handler);
      return () => ipcRenderer.removeListener(entry.event, handler);
    };
  }
  if (entry.send) return (...args) => ipcRenderer.send(entry.send, payload(entry.params, args));
  return (...args) => ipcRenderer.invoke(entry.channel, payload(entry.params, args));
}

// externalTerminal: { available, reason? }, whether the ↗ buttons can open a terminal window (#318).
// engineConnection: where the engine of this window runs; a window with this preload always shows
// the engine of this computer (a remote engine's window has no preload: api-http.js says 'remote').
const api = {
  platform: process.platform,
  externalTerminal: ipcRenderer.sendSync('terminal:external-sync'),
  engineConnection: { mode: 'local' },
};
for (const entry of ipcRenderer.sendSync('api:manifest') || []) {
  if (entry.method) api[entry.method] = method(entry);
}
contextBridge.exposeInMainWorld('api', api);
