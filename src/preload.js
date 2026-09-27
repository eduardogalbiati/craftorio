const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  listWorkflows: () => ipcRenderer.invoke('workflows:list'),
  checkEnv: () => ipcRenderer.invoke('env:check'),
  pickFolder: () => ipcRenderer.invoke('dialog:pickFolder'),
  startRun: (payload) => ipcRenderer.invoke('run:start', payload),
  stopRun: () => ipcRenderer.invoke('run:stop'),
  resolveApproval: (id, approved) => ipcRenderer.invoke('approval:resolve', { id, approved }),
  openRunDir: () => ipcRenderer.invoke('run:openDir'),
  onEvent: (cb) => {
    const handler = (_e, ev) => cb(ev);
    ipcRenderer.on('run:event', handler);
    return () => ipcRenderer.removeListener('run:event', handler);
  },
});
