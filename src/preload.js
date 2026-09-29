const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  listWorkflows: () => ipcRenderer.invoke('workflows:list'),
  restoreWorkflow: (file) => ipcRenderer.invoke('workflows:restore', file),
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
  resolveApproval: (id, answer, feedback) => ipcRenderer.invoke('approval:resolve', { id, answer, feedback }),
  openRunDir: () => ipcRenderer.invoke('run:openDir'),
  getUsage: (scope) => ipcRenderer.invoke('usage:get', { scope }),
  // mode: 'live' (follow the session's log) or 'cli' (resume the conversation in the provider's CLI)
  openSessionTerminal: (sessionId, mode, runId) => ipcRenderer.invoke('session:terminal', { sessionId, mode, runId }),
  listProjectRuns: (id) => ipcRenderer.invoke('projects:runs', { id }),
  listRuns: () => ipcRenderer.invoke('runs:list'),
  runEvents: (runId) => ipcRenderer.invoke('runs:events', { runId }),
  setBudget: (provider, budget, scope) => ipcRenderer.invoke('usage:setBudget', { provider, budget, scope }),
  setPrice: (model, price, scope) => ipcRenderer.invoke('usage:setPrice', { model, price, scope }),
  // AI supervisor: analysis of a run and resume from a step (a new run)
  askSupervisor: (runId, question) => ipcRenderer.invoke('supervisor:analyze', { runId, question }),
  resumeRun: (runId, step, instruction) => ipcRenderer.invoke('supervisor:resume', { runId, step, instruction }),
  // documents and files produced by runs
  listArtifacts: (opts) => ipcRenderer.invoke('artifacts:list', opts || {}),
  readArtifact: (path) => ipcRenderer.invoke('artifacts:read', { path }),
  openArtifact: (path, reveal) => ipcRenderer.invoke('artifacts:open', { path, reveal: !!reveal }),
  // embedded terminals (xterm in the renderer, process in main)
  termOpen: (opts) => ipcRenderer.invoke('term:open', opts),
  termInput: (id, data) => ipcRenderer.send('term:input', { id, data }),
  termResize: (id, cols, rows) => ipcRenderer.send('term:resize', { id, cols, rows }),
  termKill: (id) => ipcRenderer.invoke('term:kill', { id }),
  onTermData: (cb) => {
    const handler = (_e, msg) => cb(msg);
    ipcRenderer.on('term:data', handler);
    return () => ipcRenderer.removeListener('term:data', handler);
  },
  onTermExit: (cb) => {
    const handler = (_e, msg) => cb(msg);
    ipcRenderer.on('term:exit', handler);
    return () => ipcRenderer.removeListener('term:exit', handler);
  },
  clipboardRead: () => ipcRenderer.invoke('clipboard:read'),
  clipboardWrite: (text) => ipcRenderer.invoke('clipboard:write', { text }),
  // account: sign-in with an OAuth provider (system browser) and the free trial
  authState: () => ipcRenderer.invoke('auth:state'),
  authRefresh: () => ipcRenderer.invoke('auth:refresh'),
  signIn: (provider) => ipcRenderer.invoke('auth:signIn', provider),
  cancelSignIn: () => ipcRenderer.invoke('auth:cancel'),
  signOut: () => ipcRenderer.invoke('auth:signOut'),
  onAuthChange: (cb) => {
    const handler = (_e, s) => cb(s);
    ipcRenderer.on('auth:changed', handler);
    return () => ipcRenderer.removeListener('auth:changed', handler);
  },
  platform: process.platform,
  onEvent: (cb) => {
    const handler = (_e, ev) => cb(ev);
    ipcRenderer.on('run:event', handler);
    return () => ipcRenderer.removeListener('run:event', handler);
  },
});
