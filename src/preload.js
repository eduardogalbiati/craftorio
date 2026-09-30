const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  listWorkflows: () => ipcRenderer.invoke('workflows:list'),
  restoreWorkflow: (file) => ipcRenderer.invoke('workflows:restore', file),
  loadBuilderWorkflow: (file) => ipcRenderer.invoke('builder:load', file),
  saveBuilderWorkflow: (file, spec) => ipcRenderer.invoke('builder:save', { file, spec }),
  cloneWorkflow: (file) => ipcRenderer.invoke('builder:clone', file),
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
  // a project's issues: the last sync, and a new sync from its git platform (gh / glab)
  getBacklog: (projectId) => ipcRenderer.invoke('backlog:get', { projectId }),
  syncBacklog: (projectId, platform) => ipcRenderer.invoke('backlog:sync', { projectId, platform }),
  // assign a workflow to issues (queued, one run at a time), take one out of the queue, pause/resume it
  assignWorkflow: (projectId, numbers, workflow, inputs, mock, group) => ipcRenderer.invoke('backlog:assign', { projectId, numbers, workflow, inputs, mock, group }),
  unqueueIssue: (projectId, number, cancelGroup) => ipcRenderer.invoke('backlog:unqueue', { projectId, number, cancelGroup }),
  pauseQueue: (projectId, paused) => ipcRenderer.invoke('backlog:pause', { projectId, paused }),
  listSkills: () => ipcRenderer.invoke('skills:list'),
  createSkill: (data) => ipcRenderer.invoke('skills:create', data),
  saveSkill: (id, data) => ipcRenderer.invoke('skills:save', { id, data }),
  removeSkill: (id) => ipcRenderer.invoke('skills:remove', id),
  listAgents: () => ipcRenderer.invoke('agents:list'),
  createAgent: (data) => ipcRenderer.invoke('agents:create', data),
  saveAgent: (id, data) => ipcRenderer.invoke('agents:save', { id, data }),
  removeAgent: (id) => ipcRenderer.invoke('agents:remove', id),
  pickFolder: () => ipcRenderer.invoke('dialog:pickFolder'),
  getWorkspace: () => ipcRenderer.invoke('workspace:get'),
  changeWorkspace: () => ipcRenderer.invoke('workspace:change'),
  openWorkspace: () => ipcRenderer.invoke('workspace:open'),
  startRun: (payload) => ipcRenderer.invoke('run:start', payload),
  // runId: which run (several can be in progress, see Settings › Execution › Concurrent runs)
  stopRun: (runId) => ipcRenderer.invoke('run:stop', { runId }),
  listActiveRuns: () => ipcRenderer.invoke('runs:active'),
  resolveApproval: (id, answer, feedback, runId) => ipcRenderer.invoke('approval:resolve', { id, answer, feedback, runId }),
  openRunDir: (runId) => ipcRenderer.invoke('run:openDir', { runId }),
  getUsage: (scope) => ipcRenderer.invoke('usage:get', { scope }),
  // mode: 'live' (follow the session's log) or 'cli' (resume the conversation in the provider's CLI)
  openSessionTerminal: (sessionId, mode, runId) => ipcRenderer.invoke('session:terminal', { sessionId, mode, runId }),
  listProjectRuns: (id) => ipcRenderer.invoke('projects:runs', { id }),
  listRuns: () => ipcRenderer.invoke('runs:list'),
  runEvents: (runId, opts = {}) => ipcRenderer.invoke('runs:events', { runId, activity: !!opts.activity }),
  setBudget: (provider, budget, scope) => ipcRenderer.invoke('usage:setBudget', { provider, budget, scope }),
  setPrice: (model, price, scope) => ipcRenderer.invoke('usage:setPrice', { model, price, scope }),
  // GitHub Actions minutes of the month vs the included quota (needs gh's `user` scope)
  getActionsUsage: (force) => ipcRenderer.invoke('usage:actions', { force }),
  // AI supervisor: analysis of a run and resume from a step (a new run)
  askSupervisor: (runId, question) => ipcRenderer.invoke('supervisor:analyze', { runId, question }),
  resumeRun: (runId, step, instruction) => ipcRenderer.invoke('supervisor:resume', { runId, step, instruction }),
  // documents and files produced by runs
  listArtifacts: (opts) => ipcRenderer.invoke('artifacts:list', opts || {}),
  readArtifact: (path) => ipcRenderer.invoke('artifacts:read', { path }),
  openArtifact: (path, reveal) => ipcRenderer.invoke('artifacts:open', { path, reveal: !!reveal }),
  // Sessions screen: the CLIs' own conversations on this machine (opened with termOpen)
  listCliSessions: () => ipcRenderer.invoke('cliSessions:list'),
  renameCliSession: (provider, id, title) => ipcRenderer.invoke('cliSessions:rename', { provider, id, title }),
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
  // desktop notifications: what the window shows (none about it), and clicks on one ({ runId, workflow } | { terminalId })
  setNotifyContext: (ctx) => ipcRenderer.send('notify:context', ctx),
  onNotificationClick: (cb) => {
    const handler = (_e, target) => cb(target);
    ipcRenderer.on('notify:open', handler);
    return () => ipcRenderer.removeListener('notify:open', handler);
  },
  platform: process.platform,
  onEvent: (cb) => {
    const handler = (_e, ev) => cb(ev);
    ipcRenderer.on('run:event', handler);
    return () => ipcRenderer.removeListener('run:event', handler);
  },
});
