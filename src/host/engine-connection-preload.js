// window.connection for the engine connection page (src/renderer/connection/), and nothing else: the
// page's own channels, answered by src/host/engine-connection-window.js only for that page's window. The
// app's window.api is not here (src/host/preload.js): this page also opens when the app runs no engine of
// its own (remote mode). Sandboxed: only `electron` can be required.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('connection', {
  // { mode: 'local' | 'remote', saved: { mode, address, hasToken, insecure? }, failure, app, remoteHost, alone }
  state: () => ipcRenderer.invoke('engine-connection:state'),
  // GET /api/version on the engine → { ok, app, contract, sameContract, message } or { ok: false, reason, message }
  // insecure: as for save; without it a plain-http address outside loopback and Tailscale answers
  // { ok: false, reason: 'insecure' } before the token is sent (#480)
  test: (address, token, insecure) => ipcRenderer.invoke('engine-connection:test', { address, token, insecure }),
  // { insecure: why the address is not encrypted, or null }: the page shows the opt-in from it (#480)
  check: (address) => ipcRenderer.invoke('engine-connection:check', { address }),
  // tests, saves and restarts the app → { saved, restarting, test?, message? }; insecure: the user
  // allowed a plain-http address outside loopback and Tailscale (#480)
  save: (mode, address, token, insecure) => ipcRenderer.invoke('engine-connection:save', { mode, address, token, insecure }),
  // remote mode, after a failure: tries the saved engine again → { ok, failure? }
  retry: () => ipcRenderer.invoke('engine-connection:retry'),
  // Cancel: closes the page, nothing changed; Quit when it is the app's only window (state().alone)
  close: () => ipcRenderer.invoke('engine-connection:close'),
  // the window was asked again (another "Change connection…"): the page reads its state again
  onChanged: (cb) => ipcRenderer.on('engine-connection:changed', () => cb()),
});
