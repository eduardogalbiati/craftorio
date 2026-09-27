const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  listWorkflows: () => ipcRenderer.invoke('workflows:list'),
  checkEnv: () => ipcRenderer.invoke('env:check'),
  envDetails: () => ipcRenderer.invoke('env:details'),
  appInfo: () => ipcRenderer.invoke('app:info'),
  openPath: (p) => ipcRenderer.invoke('path:open', p),
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSettings: (patch) => ipcRenderer.invoke('settings:set', patch),
  listProjects: () => ipcRenderer.invoke('projects:list'),
  createProject: (data) => ipcRenderer.invoke('projects:create', data),
  updateProject: (id, patch) => ipcRenderer.invoke('projects:update', { id, patch }),
  removeProject: (id) => ipcRenderer.invoke('projects:remove', id),
  listSkills: () => ipcRenderer.invoke('skills:list'),
  createSkill: (data) => ipcRenderer.invoke('skills:create', data),
  saveSkill: (id, data) => ipcRenderer.invoke('skills:save', { id, data }),
  removeSkill: (id) => ipcRenderer.invoke('skills:remove', id),
  pickFolder: () => ipcRenderer.invoke('dialog:pickFolder'),
  getWorkspace: () => ipcRenderer.invoke('workspace:get'),
  changeWorkspace: () => ipcRenderer.invoke('workspace:change'),
  openWorkspace: () => ipcRenderer.invoke('workspace:open'),
  startRun: (payload) => ipcRenderer.invoke('run:start', payload),
  stopRun: () => ipcRenderer.invoke('run:stop'),
  resolveApproval: (id, answer) => ipcRenderer.invoke('approval:resolve', { id, answer }),
  openRunDir: () => ipcRenderer.invoke('run:openDir'),
  getUsage: (scope) => ipcRenderer.invoke('usage:get', { scope }),
  setBudget: (provider, budget, scope) => ipcRenderer.invoke('usage:setBudget', { provider, budget, scope }),
  setPrice: (model, price, scope) => ipcRenderer.invoke('usage:setPrice', { model, price, scope }),
  onEvent: (cb) => {
    const handler = (_e, ev) => cb(ev);
    ipcRenderer.on('run:event', handler);
    return () => ipcRenderer.removeListener('run:event', handler);
  },
});
