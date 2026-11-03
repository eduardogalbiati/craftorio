// window.desktopCapture for the remote engine's window (apps/desktop/host/engine-connection-window.js), and
// nothing else (#751): the window's own pixels as a PNG data URL, for the Findings overlay and the
// release city's Save image through apps/web/renderer/api-http.js's captureWindow. The page is the
// remote engine's: no window.api, no other channel, no Node. Answered by the main process only for that
// window. Sandboxed: only `electron` can be required.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('desktopCapture', {
  capturePage: () => ipcRenderer.invoke('engine-connection:capture'),
});
